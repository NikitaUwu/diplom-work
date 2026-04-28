using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Dtos;

/// <summary>
/// Текущее состояние обработки загруженного графика.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ChartStatus
{
    uploaded,
    processing,
    done,
    error,
}

/// <summary>
/// Поддерживаемые форматы экспорта данных графика.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ChartExportFormat
{
    csv,
    txt,
    json,
    table_csv,
}

/// <summary>
/// Режим выбора опорных точек сплайна перед построением кривой.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SplineControlPointMode
{
    original,
    selected,
    auto,
}

/// <summary>
/// Тело запроса для сохранения или предпросмотра отредактированных данных графика.
/// </summary>
public sealed class UpdateChartResultRequest
{
    [Required]
    public JsonObject ResultJson { get; set; } = new();
}

/// <summary>
/// Multipart-запрос для загрузки нового изображения графика на обработку.
/// </summary>
public sealed class UploadChartRequest
{
    [Required]
    [FromForm(Name = "file")]
    public IFormFile File { get; set; } = default!;

    [FromForm(Name = "lineformerUsePreprocessing")]
    public bool LineformerUsePreprocessing { get; set; } = true;
}

/// <summary>
/// Тело запроса для предпросмотра данных графика, преобразованных для интерполяции кубическим сплайном.
/// </summary>
public sealed class GenerateSplinePreviewRequest
{
    [DefaultValue(5)]
    [Range(2, int.MaxValue)]
    public int TotalPoints { get; set; } = 5;

    /// <summary>
    /// Режим выбора опорных точек. По умолчанию используется автоматический выбор опорных точек.
    /// </summary>
    [DefaultValue(SplineControlPointMode.auto)]
    public SplineControlPointMode ControlPointMode { get; set; } = SplineControlPointMode.auto;

    /// <summary>
    /// Необязательный JSON результата. Если не передавать или передать пустой объект, будет использован сохранённый результат графика.
    /// </summary>
    public JsonObject? ResultJson { get; set; }
}

/// <summary>
/// Тело запроса для получения выборки точек кубического сплайна по всем сериям графика.
/// </summary>
public sealed class GenerateSplineCurvePointsRequest
{
    [DefaultValue(100)]
    [Range(2, 5000)]
    public int SamplesPerSeries { get; set; } = 100;

    [DefaultValue(5)]
    [Range(2, int.MaxValue)]
    public int? TotalControlPoints { get; set; } = 5;

    /// <summary>
    /// Режим выбора опорных точек для построения сплайна. По умолчанию используется автоматический выбор.
    /// </summary>
    [DefaultValue(SplineControlPointMode.auto)]
    public SplineControlPointMode ControlPointMode { get; set; } = SplineControlPointMode.auto;

    /// <summary>
    /// Необязательный JSON результата. Если не передавать или передать пустой объект, будет использован сохранённый результат графика.
    /// </summary>
    public JsonObject? ResultJson { get; set; }
}

/// <summary>
/// Ответ с метаданными графика и извлечённым результатом в формате JSON.
/// </summary>
public sealed class ChartDetailsResponse
{
    public int Id { get; set; }

    public ChartStatus Status { get; set; }

    public string OriginalFilename { get; set; } = string.Empty;

    public string MimeType { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? ProcessedAt { get; set; }

    public int? NPanels { get; set; }

    public int? NSeries { get; set; }

    public JsonNode? ResultJson { get; set; }

    public string? ErrorMessage { get; set; }
}

/// <summary>
/// Ответ с вычисленными точками кубического сплайна для панелей и серий графика.
/// </summary>
public sealed class ChartSplineCurvesResponse
{
    public int ChartId { get; set; }

    public SplineControlPointMode ControlPointMode { get; set; }

    public int SamplesPerSeries { get; set; }

    public List<ChartSplinePanelResponse> Panels { get; set; } = [];
}

/// <summary>
/// Результат кубического сплайна для одной панели графика.
/// </summary>
public sealed class ChartSplinePanelResponse
{
    public string Id { get; set; } = string.Empty;

    public string? XUnit { get; set; }

    public string? YUnit { get; set; }

    public List<ChartSplineSeriesResponse> Series { get; set; } = [];
}

/// <summary>
/// Результат кубического сплайна для одной серии графика.
/// </summary>
public sealed class ChartSplineSeriesResponse
{
    public string Id { get; set; } = string.Empty;

    public string? Name { get; set; }

    public string ApproximationMethod { get; set; } = "cubic_spline";

    public List<ChartPointResponse> ControlPoints { get; set; } = [];
}

/// <summary>
/// Одна двумерная точка графика.
/// </summary>
public sealed class ChartPointResponse
{
    public double X { get; set; }

    public double Y { get; set; }
}
