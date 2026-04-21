using System.Text.Json;

namespace DiplomWork.Models;

public sealed class ProcessingJob
{
    public long Id { get; set; }

    public int ChartId { get; set; }

    public string Status { get; set; } = "queued";

    public JsonDocument? RequestPayload { get; set; }

    public JsonDocument? ResultPayload { get; set; }

    public string? ErrorMessage { get; set; }

    public string? ErrorCode { get; set; }

    public string? MessageId { get; set; }

    public string? WorkerId { get; set; }

    public int Attempt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? LastHeartbeatAt { get; set; }

    public DateTimeOffset? LeasedUntil { get; set; }

    public DateTimeOffset? NextRetryAt { get; set; }

    public DateTimeOffset? FinishedAt { get; set; }
}
