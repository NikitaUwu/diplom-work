using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Domain;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Helpers;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;

namespace DiplomWork.Services;

public sealed class ChartApiService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ChartStorageService _storageService;
    private readonly ChartEditorService _chartEditorService;
    private readonly CubicSelectionService _cubicSelectionService;
    private readonly ExportService _exportService;
    private readonly EditorOverlayService _editorOverlayService;

    public ChartApiService(
        AppDbContext db,
        AppOptions options,
        ChartStorageService storageService,
        ChartEditorService chartEditorService,
        CubicSelectionService cubicSelectionService,
        ExportService exportService,
        EditorOverlayService editorOverlayService)
    {
        _db = db;
        _options = options;
        _storageService = storageService;
        _chartEditorService = chartEditorService;
        _cubicSelectionService = cubicSelectionService;
        _exportService = exportService;
        _editorOverlayService = editorOverlayService;
    }

    public async Task<Chart> GetUserChartOrThrowAsync(int chartId, int userId, CancellationToken cancellationToken = default)
    {
        var chart = await _db.Charts.FirstOrDefaultAsync(item => item.Id == chartId && item.UserId == userId, cancellationToken);
        return chart ?? throw new ApiProblemException(StatusCodes.Status404NotFound, "Chart not found");
    }

    public async Task<List<ChartResponse>> ListChartsAsync(int userId, CancellationToken cancellationToken = default)
    {
        var charts = await _db.Charts
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .ToListAsync(cancellationToken);

        return charts.Select(chart => ToChartResponse(chart)).ToList();
    }

    public async Task<ChartResponse> UploadAndEnqueueAsync(int userId, IFormFile upload, CancellationToken cancellationToken = default)
    {
        await using var input = upload.OpenReadStream();
        using var buffer = new MemoryStream();
        await input.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length == 0)
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "Empty file");
        }

        if (buffer.Length > _options.MaxUploadBytes)
        {
            throw new ApiProblemException(StatusCodes.Status413PayloadTooLarge, $"File is too large (max {_options.MaxUploadBytes} bytes)");
        }

        var fileBytes = buffer.ToArray();
        var sha = HashingHelpers.Sha256Hex(fileBytes);
        var fileName = SafeFilename(upload.FileName);

        var chart = new Chart
        {
            UserId = userId,
            OriginalFilename = fileName,
            MimeType = string.IsNullOrWhiteSpace(upload.ContentType) ? "application/octet-stream" : upload.ContentType,
            Sha256 = sha,
            OriginalPath = string.Empty,
            Status = ChartStatus.processing.ToString(),
        };

        _db.Charts.Add(chart);
        await _db.SaveChangesAsync(cancellationToken);

        string? chartDirectory = null;
        string? originalPath = null;
        var wroteFile = false;
        try
        {
            chartDirectory = _storageService.GetChartDirectory(userId, chart.Id);
            originalPath = Path.GetFullPath(Path.Combine(chartDirectory, fileName));
            var userRoot = _storageService.GetUserRoot(userId);
            if (!ChartStorageService.IsInside(userRoot, originalPath))
            {
                throw new ApiProblemException(StatusCodes.Status500InternalServerError, "Invalid storage path");
            }

            await File.WriteAllBytesAsync(originalPath, fileBytes, cancellationToken);
            wroteFile = true;

            chart.OriginalPath = originalPath;
            chart.Status = ChartStatus.uploaded.ToString();
            var processingJob = await CreateProcessingJobAsync(chart, cancellationToken);
            await EnqueueProcessRequestAsync(processingJob, cancellationToken);
            return ToChartResponse(chart);
        }
        catch
        {
            if (wroteFile && originalPath is not null && File.Exists(originalPath))
            {
                File.Delete(originalPath);
            }

            if (chartDirectory is not null && Directory.Exists(chartDirectory) && !Directory.EnumerateFileSystemEntries(chartDirectory).Any())
            {
                Directory.Delete(chartDirectory);
            }

            var jobs = await _db.ProcessingJobs
                .Where(item => item.ChartId == chart.Id)
                .ToListAsync(cancellationToken);
            if (jobs.Count > 0)
            {
                _db.ProcessingJobs.RemoveRange(jobs);
            }

            _db.Charts.Remove(chart);
            await _db.SaveChangesAsync(cancellationToken);
            throw;
        }
    }

    public ChartResponse ToChartResponse(Chart chart, JsonNode? resultJson = null)
    {
        return new ChartResponse
        {
            Id = chart.Id,
            Status = ParseStatus(chart.Status),
            OriginalFilename = chart.OriginalFilename,
            MimeType = chart.MimeType,
            CreatedAt = chart.CreatedAt,
            ProcessedAt = chart.ProcessedAt,
            NPanels = chart.NPanels,
            NSeries = chart.NSeries,
            ResultJson = resultJson ?? JsonHelpers.FromDocument(chart.ResultJson),
            ErrorMessage = chart.ErrorMessage,
        };
    }

    public ChartResponse PreparedChartResponse(Chart chart)
    {
        var resultJson = JsonHelpers.FromDocument(chart.ResultJson);
        if (chart.Status == ChartStatus.done.ToString() && resultJson is JsonObject resultObject)
        {
            resultObject = _editorOverlayService.EnsureEditorAlignment(chart.Id, resultObject);
            try
            {
                (_, var prepared) = PrepareResultJson(resultObject);
                resultJson = _editorOverlayService.EnsureEditorAlignment(chart.Id, prepared);
            }
            catch (ApiProblemException)
            {
                resultJson = _editorOverlayService.EnsureEditorAlignment(chart.Id, resultObject);
            }
        }

        return ToChartResponse(chart, resultJson);
    }

    public (List<PanelData> Panels, JsonObject PreparedResultJson) PrepareResultJson(JsonObject payload)
    {
        var panels = ParsePanels(payload);
        return (panels, _chartEditorService.BuildEditorResultJson(payload, panels));
    }

    public List<PanelData> ParsePanelsOr409(Chart chart)
    {
        var payload = JsonHelpers.FromDocument(chart.ResultJson) as JsonObject ?? new JsonObject();
        payload = _editorOverlayService.EnsureEditorAlignment(chart.Id, payload);
        return ParsePanels(payload, StatusCodes.Status409Conflict, StatusCodes.Status500InternalServerError, "Export is not available yet", "Invalid panels format in result_json");
    }

    public (string FilePath, string? MediaType) ResolveChartFile(Chart chart, string fileKey)
    {
        if (string.Equals(fileKey, "original", StringComparison.Ordinal))
        {
            var filePath = _storageService.ResolveInStorage(chart.OriginalPath, allowAbsolute: true);
            EnsureFileExists(filePath);
            return (filePath, string.IsNullOrWhiteSpace(chart.MimeType) ? null : chart.MimeType);
        }

        var payload = JsonHelpers.FromDocument(chart.ResultJson) as JsonObject;
        var artifacts = payload?["artifacts"] as JsonObject;
        var rawPath = JsonHelpers.GetString(artifacts?[fileKey]);
        if (rawPath is null)
        {
            throw new ApiProblemException(StatusCodes.Status404NotFound, "File not found");
        }

        var artifactPath = _storageService.ResolveArtifactPath(chart, rawPath);
        EnsureFileExists(artifactPath);
        return (artifactPath, null);
    }

    public async Task DeleteChartAsync(Chart chart, CancellationToken cancellationToken = default)
    {
        string? chartDirectory = null;
        try
        {
            chartDirectory = _storageService.GetChartDirectoryFromChart(chart);
        }
        catch (ApiProblemException)
        {
            chartDirectory = null;
        }

        _db.Charts.Remove(chart);
        await _db.SaveChangesAsync(cancellationToken);

        if (chartDirectory is not null && Directory.Exists(chartDirectory))
        {
            Directory.Delete(chartDirectory, recursive: true);
        }
    }

    public string Export(Chart chart, ChartExportFormat format, string? panelId, string? seriesId, bool pretty, out string mediaType, out string fileName, out bool utf16)
    {
        var panels = ParsePanelsOr409(chart);
        utf16 = false;

        switch (format)
        {
            case ChartExportFormat.csv:
                mediaType = "application/vnd.ms-excel";
                fileName = $"chart_{chart.Id}.csv";
                utf16 = true;
                return _exportService.ExportToCsv(panels, panelId, seriesId);
            case ChartExportFormat.txt:
                mediaType = "text/plain; charset=utf-8";
                fileName = $"chart_{chart.Id}.txt";
                return _exportService.ExportToTxt(panels, panelId, seriesId);
            case ChartExportFormat.json:
                mediaType = "application/json; charset=utf-8";
                fileName = $"chart_{chart.Id}.json";
                return _exportService.ExportToJson(panels, panelId, seriesId, pretty);
            default:
                mediaType = "application/vnd.ms-excel";
                fileName = $"chart_{chart.Id}_table.csv";
                utf16 = true;
                var content = _exportService.ExportToTableCsv(panels, panelId, string.IsNullOrWhiteSpace(seriesId) ? null : [seriesId]);
                if (string.IsNullOrWhiteSpace(content))
                {
                    throw new ApiProblemException(StatusCodes.Status409Conflict, "Export is not available yet");
                }

                return content;
        }
    }

    public JsonObject EnsureEditorAlignment(int chartId, JsonObject resultJson) =>
        _editorOverlayService.EnsureEditorAlignment(chartId, resultJson);

    public JsonObject PreviewWithSelectedCubicPoints(int chartId, JsonObject baseResultJson, int totalPoints)
    {
        var aligned = _editorOverlayService.EnsureEditorAlignment(chartId, baseResultJson);
        var panels = ParsePanels(aligned, StatusCodes.Status409Conflict, StatusCodes.Status500InternalServerError, "Export is not available yet", "Invalid panels format in result_json");
        var prepared = _chartEditorService.BuildEditorResultJson(
            aligned,
            panels,
            points => _cubicSelectionService.SelectCubicSplinePoints(points, totalPoints));
        return _editorOverlayService.EnsureEditorAlignment(chartId, prepared);
    }

    public List<PanelData> ParsePanels(
        JsonObject payload,
        int missingStatus = StatusCodes.Status400BadRequest,
        int invalidStatus = StatusCodes.Status400BadRequest,
        string missingDetail = "Invalid panels",
        string invalidDetail = "Invalid panels")
    {
        if (payload["panels"] is not JsonArray panelsArray || panelsArray.Count == 0)
        {
            throw new ApiProblemException(missingStatus, missingDetail);
        }

        var output = new List<PanelData>();
        foreach (var panelNode in panelsArray)
        {
            if (panelNode is not JsonObject panelObject)
            {
                throw new ApiProblemException(invalidStatus, invalidDetail);
            }

            output.Add(ParsePanel(panelObject, invalidStatus, invalidDetail));
        }

        return output;
    }

    private static PanelData ParsePanel(JsonObject panelObject, int invalidStatus, string invalidDetail)
    {
        var id = JsonHelpers.GetString(panelObject["id"]);
        if (string.IsNullOrWhiteSpace(id) || panelObject["series"] is not JsonArray seriesArray)
        {
            throw new ApiProblemException(invalidStatus, invalidDetail);
        }

        var panel = new PanelData
        {
            Id = id,
            Row = JsonHelpers.TryGetInt(panelObject["row"], out var row) ? row : null,
            Col = JsonHelpers.TryGetInt(panelObject["col"], out var col) ? col : null,
            XUnit = JsonHelpers.GetString(panelObject["x_unit"]),
            YUnit = JsonHelpers.GetString(panelObject["y_unit"]),
            XScale = JsonHelpers.GetString(panelObject["x_scale"]) ?? "linear",
            YScale = JsonHelpers.GetString(panelObject["y_scale"]) ?? "linear",
        };

        foreach (var seriesNode in seriesArray)
        {
            if (seriesNode is not JsonObject seriesObject)
            {
                throw new ApiProblemException(invalidStatus, invalidDetail);
            }

            panel.Series.Add(ParseSeries(seriesObject, invalidStatus, invalidDetail));
        }

        return panel;
    }

    private static SeriesData ParseSeries(JsonObject seriesObject, int invalidStatus, string invalidDetail)
    {
        var id = JsonHelpers.GetString(seriesObject["id"]);
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ApiProblemException(invalidStatus, invalidDetail);
        }

        if (seriesObject["points"] is not JsonArray pointsArray)
        {
            throw new ApiProblemException(invalidStatus, invalidDetail);
        }

        var points = new List<(double X, double Y)>();
        foreach (var pointNode in pointsArray)
        {
            if (pointNode is not JsonArray pointArray ||
                pointArray.Count < 2 ||
                !JsonHelpers.TryGetDouble(pointArray[0], out var x) ||
                !JsonHelpers.TryGetDouble(pointArray[1], out var y))
            {
                throw new ApiProblemException(invalidStatus, invalidDetail);
            }

            points.Add((x, y));
        }

        return new SeriesData
        {
            Id = id,
            Name = JsonHelpers.GetString(seriesObject["name"]),
            Style = seriesObject["style"]?.DeepClone(),
            Points = points,
        };
    }

    private static ChartStatus ParseStatus(string rawStatus)
    {
        return Enum.TryParse<ChartStatus>(rawStatus, ignoreCase: true, out var value)
            ? value
            : throw new ApiProblemException(StatusCodes.Status500InternalServerError, $"Invalid chart status in DB: {rawStatus}");
    }

    private static void EnsureFileExists(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new ApiProblemException(StatusCodes.Status404NotFound, "File is missing on disk");
        }
    }

    private static string SafeFilename(string? fileName)
    {
        var source = string.IsNullOrWhiteSpace(fileName) ? "upload.bin" : fileName;
        var cleaned = new string(source.Where(ch => char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-').ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "upload.bin" : cleaned[..Math.Min(cleaned.Length, 200)];
    }

    private async Task<ProcessingJob> CreateProcessingJobAsync(Chart chart, CancellationToken cancellationToken)
    {
        var messageId = Guid.NewGuid().ToString("N");
        var payload = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["messageId"] = messageId,
            ["jobId"] = null,
            ["chartId"] = chart.Id,
            ["userId"] = chart.UserId,
            ["originalPath"] = chart.OriginalPath,
            ["storageRoot"] = _storageService.StorageRoot,
        };

        var processingJob = new ProcessingJob
        {
            ChartId = chart.Id,
            Status = "queued",
            MessageId = messageId,
            NextRetryAt = DateTimeOffset.UtcNow,
            RequestPayload = JsonHelpers.ToDocument(payload),
        };

        _db.ProcessingJobs.Add(processingJob);
        await _db.SaveChangesAsync(cancellationToken);

        payload["jobId"] = processingJob.Id;
        processingJob.RequestPayload = JsonHelpers.ToDocument(payload);
        await _db.SaveChangesAsync(cancellationToken);
        return processingJob;
    }

    private async Task EnqueueProcessRequestAsync(ProcessingJob processingJob, CancellationToken cancellationToken)
    {
        if (!_options.MqttEnabled)
        {
            return;
        }

        var payload = JsonHelpers.FromDocument(processingJob.RequestPayload) as JsonNode ?? new JsonObject
        {
            ["schemaVersion"] = 1,
            ["messageId"] = processingJob.MessageId,
            ["jobId"] = processingJob.Id,
            ["chartId"] = processingJob.ChartId,
            ["originalPath"] = string.Empty,
            ["storageRoot"] = _storageService.StorageRoot,
        };

        var outboxMessage = new MqttMessage
        {
            ProcessingJobId = processingJob.Id,
            Direction = "out",
            Topic = _options.MqttProcessRequestTopic,
            Status = "pending",
            Payload = JsonHelpers.ToDocument(payload),
            MessageId = processingJob.MessageId,
            AvailableAt = processingJob.NextRetryAt ?? DateTimeOffset.UtcNow,
        };

        _db.MqttMessages.Add(outboxMessage);
        await _db.SaveChangesAsync(cancellationToken);
    }
}
