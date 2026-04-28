using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Helpers;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Nodes;

namespace DiplomWork.Controllers;

/// <summary>
/// Методы для загрузки графиков, работы с результатами обработки, файлами, экспортом и кубическими сплайнами.
/// </summary>
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

    /// <summary>
    /// Загружает изображение графика и ставит его в очередь на обработку.
    /// </summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(typeof(ChartDetailsResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartDetailsResponse>> Create([FromForm] UploadChartRequest request, CancellationToken cancellationToken)
    {
        return await CreateChartAsync(request, cancellationToken);
    }

    [HttpPost("upload")]
    [ApiExplorerSettings(IgnoreApi = true)]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<ChartDetailsResponse>> UploadLegacy([FromForm] UploadChartRequest request, CancellationToken cancellationToken)
    {
        return await CreateChartAsync(request, cancellationToken);
    }

    /// <summary>
    /// Возвращает список графиков текущего пользователя.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ChartDetailsResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<List<ChartDetailsResponse>>> List(CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        return await _chartApiService.ListChartsAsync(currentUser.Id, cancellationToken);
    }

    /// <summary>
    /// Возвращает один график с подготовленным результатом в формате JSON.
    /// </summary>
    [HttpGet("{chartId:int}")]
    [ProducesResponseType(typeof(ChartDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartDetailsResponse>> GetById(int chartId, CancellationToken cancellationToken)
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

    /// <summary>
    /// Скачивает исходный файл графика или сгенерированный артефакт.
    /// </summary>
    [HttpGet("{chartId:int}/files/{fileKey}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
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

    /// <summary>
    /// Экспортирует данные графика в выбранном формате.
    /// </summary>
    [HttpGet("{chartId:int}/export")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Export(int chartId, [FromQuery] ChartExportFormat format, [FromQuery] string? panelId, [FromQuery] string? seriesId, [FromQuery] bool pretty, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        var content = _chartApiService.Export(chart, format, panelId, seriesId, pretty, out var mediaType, out var fileName, out var utf16);
        var bytes = utf16 ? ExportService.ToExcelFriendlyUtf16(content) : System.Text.Encoding.UTF8.GetBytes(content);
        return File(bytes, mediaType, fileName);
    }

    /// <summary>
    /// Сохраняет отредактированный JSON результата графика.
    /// </summary>
    [HttpPut("{chartId:int}/result")]
    [ProducesResponseType(typeof(ChartDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartDetailsResponse>> SaveResult(int chartId, [FromBody] UpdateChartResultRequest payload, CancellationToken cancellationToken = default)
    {
        return await UpdateResultInternalAsync(chartId, payload, persist: true, cancellationToken);
    }

    /// <summary>
    /// Возвращает предпросмотр отредактированного JSON результата без сохранения.
    /// </summary>
    [HttpPost("{chartId:int}/result/preview")]
    [ProducesResponseType(typeof(ChartDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartDetailsResponse>> PreviewResult(int chartId, [FromBody] UpdateChartResultRequest payload, CancellationToken cancellationToken = default)
    {
        return await UpdateResultInternalAsync(chartId, payload, persist: false, cancellationToken);
    }

    [HttpPatch("{chartId:int}")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public async Task<ActionResult<ChartDetailsResponse>> PatchLegacy(int chartId, [FromBody] UpdateChartResultRequest payload, [FromQuery] bool persist = true, CancellationToken cancellationToken = default)
    {
        return await UpdateResultInternalAsync(chartId, payload, persist, cancellationToken);
    }

    /// <summary>
    /// Возвращает предпросмотр данных графика с применённой интерполяцией кубическим сплайном.
    /// </summary>
    [HttpPost("{chartId:int}/spline/preview")]
    [ProducesResponseType(typeof(ChartDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartDetailsResponse>> PreviewSpline(
        int chartId,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] GenerateSplinePreviewRequest? payload,
        CancellationToken cancellationToken)
    {
        return await PreviewSplineInternalAsync(chartId, payload ?? new GenerateSplinePreviewRequest(), cancellationToken);
    }

    /// <summary>
    /// Возвращает явный набор точек кубического сплайна для каждой серии графика.
    /// </summary>
    [HttpPost("{chartId:int}/spline/curve-points")]
    [ProducesResponseType(typeof(ChartSplineCurvesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<ChartSplineCurvesResponse>> GetSplineCurvePoints(
        int chartId,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] GenerateSplineCurvePointsRequest? payload,
        CancellationToken cancellationToken)
    {
        var requestBodyWasOmitted = payload is null;
        payload ??= new GenerateSplineCurvePointsRequest();
        var (chart, baseResultJson) = await GetEditableChartContextAsync(chartId, payload.ResultJson, cancellationToken);
        if (JsonHelpers.IsNullOrEmptyObject(payload.ResultJson) && payload.ControlPointMode == SplineControlPointMode.auto)
        {
            var storedResponse = _chartApiService.TryBuildStoredAutoSplineCurvePointsResponse(
                chart.Id,
                baseResultJson,
                requestBodyWasOmitted ? null : payload.TotalControlPoints,
                payload.SamplesPerSeries);
            if (storedResponse is not null)
            {
                return storedResponse;
            }
        }

        var response = _chartApiService.BuildSplineCurvePointsResponse(
            chart.Id,
            baseResultJson,
            payload.ControlPointMode,
            payload.TotalControlPoints,
            payload.SamplesPerSeries);
        return response;
    }

    [HttpPost("{chartId:int}/cubic-preview")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public async Task<ActionResult<ChartDetailsResponse>> CubicPreviewLegacy(int chartId, [FromBody] GenerateSplinePreviewRequest payload, CancellationToken cancellationToken)
    {
        payload.ControlPointMode = SplineControlPointMode.selected;
        return await PreviewSplineInternalAsync(chartId, payload, cancellationToken);
    }

    [HttpPost("{chartId:int}/cubic-preview-random")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public async Task<ActionResult<ChartDetailsResponse>> CubicPreviewRandomLegacy(int chartId, [FromBody] GenerateSplinePreviewRequest payload, CancellationToken cancellationToken)
    {
        payload.ControlPointMode = SplineControlPointMode.auto;
        return await PreviewSplineInternalAsync(chartId, payload, cancellationToken);
    }

    /// <summary>
    /// Удаляет график и все связанные с ним сохранённые артефакты.
    /// </summary>
    [HttpDelete("{chartId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Delete(int chartId, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        await _chartApiService.DeleteChartAsync(chart, cancellationToken);
        return NoContent();
    }

    private async Task<ActionResult<ChartDetailsResponse>> CreateChartAsync(UploadChartRequest request, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var response = await _chartApiService.UploadAndEnqueueAsync(
            currentUser.Id,
            request.File,
            request.LineformerUsePreprocessing,
            cancellationToken);
        return CreatedAtAction(nameof(GetById), new { chartId = response.Id }, response);
    }

    private async Task<ActionResult<ChartDetailsResponse>> UpdateResultInternalAsync(int chartId, UpdateChartResultRequest payload, bool persist, CancellationToken cancellationToken)
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

    private async Task<ActionResult<ChartDetailsResponse>> PreviewSplineInternalAsync(int chartId, GenerateSplinePreviewRequest payload, CancellationToken cancellationToken)
    {
        var (chart, baseResultJson) = await GetEditableChartContextAsync(chartId, payload.ResultJson, cancellationToken);
        var preparedResultJson = _chartApiService.PreviewWithSplineControlPoints(
            chart.Id,
            baseResultJson,
            payload.ControlPointMode,
            payload.TotalPoints);
        return _chartApiService.ToChartResponse(chart, preparedResultJson);
    }

    private async Task<(Chart Chart, JsonObject BaseResultJson)> GetEditableChartContextAsync(int chartId, JsonObject? resultJson, CancellationToken cancellationToken)
    {
        var currentUser = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        var chart = await _chartApiService.GetUserChartOrThrowAsync(chartId, currentUser.Id, cancellationToken);
        if (!string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "Chart is not ready for editing");
        }

        var persistedResultJson = JsonHelpers.FromDocument(chart.ResultJson) as JsonObject ?? new JsonObject();
        var baseResultJson = JsonHelpers.IsNullOrEmptyObject(resultJson)
            ? persistedResultJson
            : resultJson!;
        return (chart, baseResultJson);
    }
}
