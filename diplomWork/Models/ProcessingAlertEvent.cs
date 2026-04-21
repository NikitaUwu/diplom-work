namespace DiplomWork.Models;

public sealed class ProcessingAlertEvent
{
    public long Id { get; set; }

    public string AlertCode { get; set; } = string.Empty;

    public string EventType { get; set; } = string.Empty;

    public string Severity { get; set; } = "info";

    public string Message { get; set; } = string.Empty;

    public int Count { get; set; }

    public string? SamplesText { get; set; }

    public string NotificationStatus { get; set; } = "pending";

    public int NotificationAttemptCount { get; set; }

    public DateTimeOffset? LastNotificationAttemptAt { get; set; }

    public DateTimeOffset? NotificationNextAttemptAt { get; set; }

    public DateTimeOffset? NotifiedAt { get; set; }

    public string? NotificationError { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
