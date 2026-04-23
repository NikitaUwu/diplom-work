using System.Text.Json;

namespace DiplomWork.Models;

public sealed class MqttMessage
{
    public long Id { get; set; }

    public long? ProcessingJobId { get; set; }

    public string Direction { get; set; } = "out";

    public string Topic { get; set; } = string.Empty;

    public string Status { get; set; } = "pending";

    public JsonDocument? Payload { get; set; }

    public string? MessageId { get; set; }

    public int AttemptCount { get; set; }

    public string? ErrorMessage { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset? AvailableAt { get; set; }

    public DateTimeOffset? ProcessedAt { get; set; }
}
