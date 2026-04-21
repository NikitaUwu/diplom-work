using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Dtos;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ChartStatus
{
    uploaded,
    processing,
    done,
    error,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ChartExportFormat
{
    csv,
    txt,
    json,
    table_csv,
}

public sealed class ChartUpdateRequest
{
    [Required]
    public JsonObject ResultJson { get; set; } = new();
}

public sealed class ChartUploadRequest
{
    [Required]
    [FromForm(Name = "file")]
    public IFormFile File { get; set; } = default!;
}

public sealed class ChartSplinePointsRequest
{
    [Range(2, int.MaxValue)]
    public int TotalPoints { get; set; } = 3;
}

public sealed class ChartResponse
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
