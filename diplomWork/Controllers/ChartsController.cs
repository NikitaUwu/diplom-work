using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Helpers;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Nodes;

namespace DiplomWork.Controllers;

[ApiController]
[Route("api/v1/charts")]
public sealed class ChartsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly CurrentUserService _currentUserService;
    private readonly ChartApiService _chartApiService;

    public ChartsController(AppDbContext db, CurrentUserService currentUserService, ChartApiService chartApiService)
    {
        _db = db;
        _currentUserService = currentUserService;
        _chartApiService = chartApiService;
    }

    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<ChartResponse>> Upload([FromForm] ChartUploadRequest request, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var response = await _chartApiService.UploadAndEnqueueAsync(currentUser.Id, request.File, cancellationToken);
        return response;
    }

    [HttpGet]
    public async Task<ActionResult<List<ChartResponse>>> List(CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        return await _chartApiService.ListChartsAsync(currentUser.Id, cancellationToken);
    }

    [HttpGet("{chartId:int}")]
    public async Task<ActionResult<ChartResponse>> Get(int chartId, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        var response = _chartApiService.PreparedChartResponse(chart);

        if (string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase) &&
            response.ResultJson is JsonObject preparedResultJson)
        {
            var dataJsonPath = _chartApiService.GetDataJsonPath(chart);
            var currentJson = JsonHelpers.FromDocument(chart.ResultJson)?.ToJsonString();
            var nextJson = preparedResultJson.ToJsonString();
            if (!string.Equals(currentJson, nextJson, StringComparison.Ordinal))
            {
                chart.ResultJson = JsonHelpers.ToDocument(preparedResultJson);
                chart.NPanels = preparedResultJson["panels"] is JsonArray panels ? panels.Count : chart.NPanels;
                chart.NSeries = preparedResultJson["panels"] is JsonArray panelsForSeries
                    ? panelsForSeries.OfType<JsonObject>().Sum(panel => (panel["series"] as JsonArray)?.Count ?? 0)
                    : chart.NSeries;
                await _db.SaveChangesAsync(cancellationToken);
                await _chartApiService.WriteDataJsonAsync(chart, preparedResultJson, cancellationToken);
            }
            else if (!System.IO.File.Exists(dataJsonPath))
            {
                await _chartApiService.WriteDataJsonAsync(chart, preparedResultJson, cancellationToken);
            }
        }

        return response;
    }

    [HttpGet("{chartId:int}/files/{fileKey}")]
    public async Task<IActionResult> GetFile(int chartId, string fileKey, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        if (string.Equals(fileKey, "data", StringComparison.OrdinalIgnoreCase) &&
            !System.IO.File.Exists(_chartApiService.GetDataJsonPath(chart)) &&
            JsonHelpers.FromDocument(chart.ResultJson) is JsonObject resultJson)
        {
            await _chartApiService.WriteDataJsonAsync(chart, resultJson, cancellationToken);
        }

        var (filePath, mediaType) = _chartApiService.ResolveChartFile(chart, fileKey);
        return PhysicalFile(filePath, mediaType ?? "application/octet-stream");
    }

    [HttpGet("{chartId:int}/export")]
    public async Task<IActionResult> Export(int chartId, [FromQuery] ChartExportFormat format, [FromQuery] string? panelId, [FromQuery] string? seriesId, [FromQuery] bool pretty, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        var content = _chartApiService.Export(chart, format, panelId, seriesId, pretty, out var mediaType, out var fileName, out var utf16);
        var bytes = utf16 ? ExportService.ToExcelFriendlyUtf16(content) : System.Text.Encoding.UTF8.GetBytes(content);
        return File(bytes, mediaType, fileName);
    }

    [HttpPatch("{chartId:int}")]
    public async Task<ActionResult<ChartResponse>> Patch(int chartId, [FromBody] ChartUpdateRequest payload, [FromQuery] bool persist = true, CancellationToken cancellationToken = default)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        if (!string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "Chart is not ready for editing");
        }

        var alignedPayload = _chartApiService.EnsureEditorAlignment(chart.Id, payload.ResultJson);
        var (panels, preparedResultJson) = _chartApiService.PrepareResultJson(alignedPayload);
        preparedResultJson = _chartApiService.EnsureEditorAlignment(chart.Id, preparedResultJson);

        if (!persist)
        {
            return _chartApiService.ToChartResponse(chart, preparedResultJson);
        }

        chart.ResultJson = JsonHelpers.ToDocument(preparedResultJson);
        chart.NPanels = panels.Count;
        chart.NSeries = panels.Sum(panel => panel.Series.Count);
        await _db.SaveChangesAsync(cancellationToken);
        await _chartApiService.WriteDataJsonAsync(chart, preparedResultJson, cancellationToken);
        return _chartApiService.ToChartResponse(chart, preparedResultJson);
    }

    [HttpPost("{chartId:int}/cubic-preview")]
    public async Task<ActionResult<ChartResponse>> CubicPreview(int chartId, [FromBody] ChartSplinePointsRequest payload, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        if (!string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "Chart is not ready for editing");
        }

        var baseResultJson = payload.ResultJson ?? JsonHelpers.FromDocument(chart.ResultJson) as JsonObject ?? new();
        var preparedResultJson = _chartApiService.PreviewWithSelectedCubicPoints(chart.Id, baseResultJson, payload.TotalPoints);
        return _chartApiService.ToChartResponse(chart, preparedResultJson);
    }

    [HttpPost("{chartId:int}/cubic-preview-random")]
    public async Task<ActionResult<ChartResponse>> CubicPreviewRandom(int chartId, [FromBody] ChartSplinePointsRequest payload, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        if (!string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "Chart is not ready for editing");
        }

        var baseResultJson = payload.ResultJson ?? JsonHelpers.FromDocument(chart.ResultJson) as JsonObject ?? new();
        var preparedResultJson = _chartApiService.PreviewWithRandomCubicPoints(chart.Id, baseResultJson, payload.TotalPoints);
        return _chartApiService.ToChartResponse(chart, preparedResultJson);
    }

    [HttpDelete("{chartId:int}")]
    public async Task<IActionResult> Delete(int chartId, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        await _chartApiService.DeleteChartAsync(chart, cancellationToken);
        return NoContent();
    }
}
