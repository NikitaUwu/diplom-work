using System.Text.Json;

namespace DiplomWork.Models;

public sealed class Chart
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public string OriginalFilename { get; set; } = string.Empty;

    public string MimeType { get; set; } = string.Empty;

    public string Sha256 { get; set; } = string.Empty;

    public string OriginalPath { get; set; } = string.Empty;

    public string Status { get; set; } = "uploaded";

    public string? ErrorMessage { get; set; }

    public JsonDocument? ResultJson { get; set; }

    public int? NPanels { get; set; }

    public int? NSeries { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? ProcessedAt { get; set; }
}
