using System.Text.Json.Nodes;

namespace DiplomWork.Dtos;

public sealed class ProcessingEventPayload
{
    public int SchemaVersion { get; set; }

    public string? MessageId { get; set; }

    public string? RequestMessageId { get; set; }

    public long? JobId { get; set; }

    public int? ChartId { get; set; }

    public string? WorkerId { get; set; }

    public JsonNode? ResultJson { get; set; }

    public string? ResultJsonPath { get; set; }

    public int? NPanels { get; set; }

    public int? NSeries { get; set; }

    public string? ErrorMessage { get; set; }

    public string? ErrorCode { get; set; }

    public bool? Retryable { get; set; }
}
