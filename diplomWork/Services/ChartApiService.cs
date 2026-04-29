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
    private static readonly (string Key, string DirectoryName, string SearchPattern)[] KnownArtifactFiles =
    [
        ("lineformer_prediction", "lineformer", "prediction.png"),
        ("converted_plot", "converted_datapoints", "plot.png"),
        ("chartdete_predictions", "chartdete", "predictions.*"),
    ];

    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ChartStorageService _storageService;
    private readonly SplineService _splineService;
    private readonly ChartEditorService _chartEditorService;
    private readonly CubicSelectionService _cubicSelectionService;
    private readonly ExportService _exportService;
    private readonly EditorOverlayService _editorOverlayService;
    private readonly MqttOutboxSignal _outboxSignal;

    public ChartApiService(
        AppDbContext db,
        AppOptions options,
        ChartStorageService storageService,
        SplineService splineService,
        ChartEditorService chartEditorService,
        CubicSelectionService cubicSelectionService,
        ExportService exportService,
        EditorOverlayService editorOverlayService,
        MqttOutboxSignal outboxSignal)
    {
        _db = db;
        _options = options;
        _storageService = storageService;
        _splineService = splineService;
        _chartEditorService = chartEditorService;
        _cubicSelectionService = cubicSelectionService;
        _exportService = exportService;
        _editorOverlayService = editorOverlayService;
        _outboxSignal = outboxSignal;
    }

    public async Task<Chart> GetUserChartOrThrowAsync(int chartId, int userId, CancellationToken cancellationToken = default)
    {
        var chart = await _db.Charts.FirstOrDefaultAsync(item => item.Id == chartId && item.UserId == userId, cancellationToken);
        return chart ?? throw new ApiProblemException(StatusCodes.Status404NotFound, "Chart not found");
    }

    public async Task<List<ChartDetailsResponse>> ListChartsAsync(int userId, CancellationToken cancellationToken = default)
    {
        var charts = await _db.Charts
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .ToListAsync(cancellationToken);

        return charts.Select(chart => ToChartResponse(chart)).ToList();
    }

    public async Task<ChartDetailsResponse> UploadAndEnqueueAsync(
        int userId,
        IFormFile upload,
        bool lineformerUsePreprocessing = true,
        CancellationToken cancellationToken = default)
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

        // Сначала заводим запись, чтобы у файла появился постоянный id для папки хранения.
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
            // Путь проверяем вручную, чтобы имя файла не смогло вывести запись за папку пользователя.
            chartDirectory = _storageService.GetChartDirectory(userId, chart.Id);
            originalPath = Path.GetFullPath(Path.Combine(chartDirectory, fileName));
            var userRoot = _storageService.GetUserRoot(userId);
            if (!ChartStorageService.IsInside(userRoot, originalPath))
            {
                throw new ApiProblemException(StatusCodes.Status500InternalServerError, "Invalid storage path");
            }

            await File.WriteAllBytesAsync(originalPath, fileBytes, cancellationToken);
            wroteFile = true;

            chart.OriginalPath = ToStorageRelativePath(originalPath);
            chart.Status = ChartStatus.uploaded.ToString();
            var processingJob = await CreateProcessingJobAsync(chart, lineformerUsePreprocessing, cancellationToken);
            await EnqueueProcessRequestAsync(processingJob, cancellationToken);
            return ToChartResponse(chart);
        }
        catch
        {
            // Если на середине загрузки что-то упало, убираем и файл, и запись из базы.
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

    public ChartDetailsResponse ToChartResponse(Chart chart, JsonNode? resultJson = null)
    {
        var responseResultJson = WithAvailableArtifacts(chart, resultJson ?? JsonHelpers.FromDocument(chart.ResultJson));

        return new ChartDetailsResponse
        {
            Id = chart.Id,
            Status = ParseStatus(chart.Status),
            OriginalFilename = chart.OriginalFilename,
            MimeType = chart.MimeType,
            CreatedAt = chart.CreatedAt,
            ProcessedAt = chart.ProcessedAt,
            NPanels = chart.NPanels,
            NSeries = chart.NSeries,
            ResultJson = responseResultJson,
            ErrorMessage = chart.ErrorMessage,
        };
    }

    public ChartDetailsResponse PreparedChartResponse(Chart chart)
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
            var filePath = ResolveOriginalFilePath(chart);
            EnsureFileExists(filePath);
            return (filePath, string.IsNullOrWhiteSpace(chart.MimeType) ? null : chart.MimeType);
        }

        if (string.Equals(fileKey, "data", StringComparison.Ordinal))
        {
            var filePath = _storageService.GetDataJsonPath(chart);
            EnsureFileExists(filePath);
            return (filePath, "application/json; charset=utf-8");
        }

        var payload = JsonHelpers.FromDocument(chart.ResultJson) as JsonObject;
        var artifacts = payload?["artifacts"] as JsonObject;
        var rawPath = JsonHelpers.GetString(artifacts?[fileKey]) ?? TryFindAvailableArtifactRawPath(chart, fileKey);
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
                var resultJson = JsonHelpers.FromDocument(chart.ResultJson) as JsonObject ?? new JsonObject();
                resultJson = _editorOverlayService.EnsureEditorAlignment(chart.Id, resultJson);
                return _exportService.ExportToJson(resultJson, panels, panelId, seriesId, pretty);
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

    public string GetDataJsonPath(Chart chart) =>
        _storageService.GetDataJsonPath(chart);

    public Task WriteDataJsonAsync(Chart chart, JsonObject resultJson, CancellationToken cancellationToken = default) =>
        _storageService.WriteDataJsonAsync(chart, resultJson, cancellationToken);

    public JsonObject PreviewWithSplineControlPoints(
        int chartId,
        JsonObject baseResultJson,
        SplineControlPointMode controlPointMode,
        int totalPoints)
    {
        var aligned = _editorOverlayService.EnsureEditorAlignment(chartId, baseResultJson);
        var panels = ParsePanels(aligned, StatusCodes.Status409Conflict, StatusCodes.Status500InternalServerError, "Export is not available yet", "Invalid panels format in result_json");
        Func<List<(double X, double Y)>, List<(double X, double Y)>>? pointTransform = controlPointMode == SplineControlPointMode.original
            ? null
            : points => SelectSplineControlPoints(points, controlPointMode, totalPoints);
        var prepared = _chartEditorService.BuildEditorResultJson(aligned, panels, pointTransform);
        return _editorOverlayService.EnsureEditorAlignment(chartId, prepared);
    }

    public JsonObject PreviewWithSelectedCubicPoints(int chartId, JsonObject baseResultJson, int totalPoints)
    {
        return PreviewWithSplineControlPoints(chartId, baseResultJson, SplineControlPointMode.selected, totalPoints);
    }

    public JsonObject PreviewWithRandomCubicPoints(int chartId, JsonObject baseResultJson, int totalPoints)
    {
        return PreviewWithSplineControlPoints(chartId, baseResultJson, SplineControlPointMode.auto, totalPoints);
    }

    public ChartSplineCurvesResponse BuildSplineCurvePointsResponse(
        int chartId,
        JsonObject baseResultJson,
        SplineControlPointMode controlPointMode,
        int? totalControlPoints,
        int samplesPerSeries)
    {
        var aligned = _editorOverlayService.EnsureEditorAlignment(chartId, baseResultJson);
        var panels = ParsePanels(aligned, StatusCodes.Status409Conflict, StatusCodes.Status500InternalServerError, "Export is not available yet", "Invalid panels format in result_json");
        var response = new ChartSplineCurvesResponse
        {
            ChartId = chartId,
            ControlPointMode = controlPointMode,
            SamplesPerSeries = Math.Max(2, samplesPerSeries),
        };

        foreach (var panel in panels)
        {
            var panelResponse = new ChartSplinePanelResponse
            {
                Id = panel.Id,
                XUnit = panel.XUnit,
                YUnit = panel.YUnit,
            };

            foreach (var series in panel.Series)
            {
                var sourcePoints = series.Points.ToList();
                var controlPoints = SelectSplineControlPoints(sourcePoints, controlPointMode, totalControlPoints);
                panelResponse.Series.Add(new ChartSplineSeriesResponse
                {
                    Id = series.Id,
                    Name = series.Name,
                    ControlPoints = controlPoints.Select(ToPointResponse).ToList(),
                });
            }

            response.Panels.Add(panelResponse);
        }

        return response;
    }

    public ChartSplineCurvesResponse? TryBuildStoredAutoSplineCurvePointsResponse(
        int chartId,
        JsonObject persistedResultJson,
        int? requestedTotalControlPoints,
        int samplesPerSeries)
    {
        var aligned = _editorOverlayService.EnsureEditorAlignment(chartId, persistedResultJson);
        var autoSpline = aligned["auto_spline"] as JsonObject;
        if (autoSpline is null || autoSpline["panels"] is not JsonArray autoPanels || autoPanels.Count == 0)
        {
            return null;
        }

        if (JsonHelpers.TryGetInt(autoSpline["selected_point_count"], out var storedSelectedPointCount) &&
            requestedTotalControlPoints.HasValue &&
            requestedTotalControlPoints.Value > 0 &&
            requestedTotalControlPoints.Value != storedSelectedPointCount)
        {
            return null;
        }

        var basePanels = ParsePanels(aligned, StatusCodes.Status409Conflict, StatusCodes.Status500InternalServerError, "Export is not available yet", "Invalid panels format in result_json");
        var baseSeriesById = basePanels
            .SelectMany(panel => panel.Series.Select(series => (Panel: panel, Series: series)))
            .ToDictionary(item => item.Series.Id, item => item, StringComparer.Ordinal);
        var response = new ChartSplineCurvesResponse
        {
            ChartId = chartId,
            ControlPointMode = SplineControlPointMode.auto,
            SamplesPerSeries = Math.Max(2, samplesPerSeries),
        };

        foreach (var autoPanelNode in autoPanels)
        {
            if (autoPanelNode is not JsonObject autoPanelObject)
            {
                return null;
            }

            var panelId = JsonHelpers.GetString(autoPanelObject["id"]);
            if (string.IsNullOrWhiteSpace(panelId) || autoPanelObject["series"] is not JsonArray autoSeriesArray)
            {
                return null;
            }

            var panelResponse = new ChartSplinePanelResponse
            {
                Id = panelId,
                XUnit = basePanels.FirstOrDefault(panel => string.Equals(panel.Id, panelId, StringComparison.Ordinal))?.XUnit,
                YUnit = basePanels.FirstOrDefault(panel => string.Equals(panel.Id, panelId, StringComparison.Ordinal))?.YUnit,
            };

            foreach (var autoSeriesNode in autoSeriesArray)
            {
                if (autoSeriesNode is not JsonObject autoSeriesObject)
                {
                    return null;
                }

                var controlPoints = ParsePointList(autoSeriesObject["points"], StatusCodes.Status500InternalServerError, "Invalid auto_spline points format");
                if (controlPoints.Count == 0)
                {
                    return null;
                }

                var storedCurvePoints = autoSeriesObject["curve_points"] is null
                    ? []
                    : ParsePointList(autoSeriesObject["curve_points"], StatusCodes.Status500InternalServerError, "Invalid auto_spline curve_points format");
                var sourceSeriesId = JsonHelpers.GetString(autoSeriesObject["source_series_id"])
                    ?? JsonHelpers.GetString(autoSeriesObject["id"]);
                baseSeriesById.TryGetValue(sourceSeriesId ?? string.Empty, out var baseSeries);
                var curvePointResponses = storedCurvePoints.Count == response.SamplesPerSeries
                    ? storedCurvePoints.Select(ToPointResponse).ToList()
                    : _splineService.SampleCubicSpline(controlPoints, response.SamplesPerSeries)
                        .Select(point => ToPointResponse((point[0], point[1])))
                        .ToList();
                panelResponse.Series.Add(new ChartSplineSeriesResponse
                {
                    Id = sourceSeriesId ?? string.Empty,
                    Name = JsonHelpers.GetString(autoSeriesObject["source_name"])
                        ?? baseSeries.Series?.Name
                        ?? JsonHelpers.GetString(autoSeriesObject["name"]),
                    ControlPoints = controlPoints.Select(ToPointResponse).ToList(),
                });
            }

            response.Panels.Add(panelResponse);
        }

        return response;
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

        var points = ParsePointList(seriesObject["points"], invalidStatus, invalidDetail);

        return new SeriesData
        {
            Id = id,
            Name = JsonHelpers.GetString(seriesObject["name"]),
            Style = seriesObject["style"]?.DeepClone(),
            Points = points,
        };
    }

    private static List<(double X, double Y)> ParsePointList(JsonNode? pointsNode, int invalidStatus, string invalidDetail)
    {
        if (pointsNode is not JsonArray pointsArray)
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

        return points;
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

    private string ResolveOriginalFilePath(Chart chart)
    {
        if (!string.IsNullOrWhiteSpace(chart.OriginalPath))
        {
            try
            {
                var filePath = _storageService.ResolveInStorage(chart.OriginalPath, allowAbsolute: true);
                if (File.Exists(filePath))
                {
                    return filePath;
                }
            }
            catch (ApiProblemException) when (Path.IsPathRooted(chart.OriginalPath))
            {
            }
        }

        var fallbackPath = Path.Combine(_storageService.GetChartDirectory(chart.UserId, chart.Id), SafeFilename(chart.OriginalFilename));
        if (File.Exists(fallbackPath))
        {
            return fallbackPath;
        }

        return _storageService.ResolveInStorage(chart.OriginalPath, allowAbsolute: true);
    }

    private string ToStorageRelativePath(string filePath)
    {
        return Path.GetRelativePath(_storageService.EnsureStorageRoot(), filePath)
            .Replace('\\', '/');
    }

    private JsonNode? WithAvailableArtifacts(Chart chart, JsonNode? resultJson)
    {
        var availableArtifacts = DiscoverAvailableArtifacts(chart);
        if (availableArtifacts.Count == 0)
        {
            return resultJson;
        }

        var resultObject = resultJson as JsonObject ?? new JsonObject();
        if (resultObject["artifacts"] is not JsonObject artifacts)
        {
            artifacts = new JsonObject();
            resultObject["artifacts"] = artifacts;
        }

        foreach (var (key, rawPath) in availableArtifacts)
        {
            if (JsonHelpers.GetString(artifacts[key]) is null)
            {
                artifacts[key] = rawPath;
            }
        }

        return resultObject;
    }

    private Dictionary<string, string> DiscoverAvailableArtifacts(Chart chart)
    {
        var artifacts = new Dictionary<string, string>(StringComparer.Ordinal);
        string chartDirectory;
        try
        {
            chartDirectory = _storageService.GetChartDirectoryFromChart(chart);
        }
        catch (ApiProblemException)
        {
            return artifacts;
        }

        foreach (var (key, directoryName, searchPattern) in KnownArtifactFiles)
        {
            var artifactDirectory = Path.Combine(chartDirectory, directoryName);
            if (!Directory.Exists(artifactDirectory))
            {
                continue;
            }

            var filePath = Directory.EnumerateFiles(artifactDirectory, searchPattern)
                .Order(StringComparer.Ordinal)
                .FirstOrDefault();
            if (filePath is not null)
            {
                artifacts[key] = ToStorageRelativePath(filePath);
            }
        }

        if (artifacts.TryGetValue("converted_plot", out var convertedPlot))
        {
            artifacts.TryAdd("restored_plot", convertedPlot);
        }

        return artifacts;
    }

    private string? TryFindAvailableArtifactRawPath(Chart chart, string fileKey)
    {
        return DiscoverAvailableArtifacts(chart).TryGetValue(fileKey, out var rawPath)
            ? rawPath
            : null;
    }

    private static string SafeFilename(string? fileName)
    {
        var source = string.IsNullOrWhiteSpace(fileName) ? "upload.bin" : fileName;
        var cleaned = new string(source.Where(ch => char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-').ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "upload.bin" : cleaned[..Math.Min(cleaned.Length, 200)];
    }

    private List<(double X, double Y)> SelectSplineControlPoints(
        IEnumerable<(double X, double Y)> points,
        SplineControlPointMode controlPointMode,
        int? totalControlPoints)
    {
        var normalizedPoints = points.ToList();
        var requestedPoints = Math.Max(2, totalControlPoints ?? 3);
        return controlPointMode switch
        {
            SplineControlPointMode.original => normalizedPoints,
            SplineControlPointMode.selected => _cubicSelectionService.SelectCubicSplinePoints(normalizedPoints, requestedPoints),
            SplineControlPointMode.auto => _cubicSelectionService.SelectAutoCubicSplinePoints(normalizedPoints, requestedPoints),
            _ => normalizedPoints,
        };
    }

    private static ChartPointResponse ToPointResponse((double X, double Y) point)
    {
        return new ChartPointResponse
        {
            X = point.X,
            Y = point.Y,
        };
    }

    private static ChartPointResponse ToPointResponse(IReadOnlyList<double> point)
    {
        return new ChartPointResponse
        {
            X = point.Count > 0 ? point[0] : 0d,
            Y = point.Count > 1 ? point[1] : 0d,
        };
    }

    private async Task<ProcessingJob> CreateProcessingJobAsync(
        Chart chart,
        bool lineformerUsePreprocessing,
        CancellationToken cancellationToken)
    {
        // Этот id связывает запрос к воркеру со всеми ответами по этой же попытке.
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
            ["lineformerUsePreprocessing"] = lineformerUsePreprocessing,
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

        // Сообщение сначала сохраняется в базе, а фоновая служба отправит его в MQTT.
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
        _outboxSignal.Notify();
    }
}
