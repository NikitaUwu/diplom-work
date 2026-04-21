namespace DiplomWork.Dtos;

public sealed class ProcessingAlertEventReadResponse
{
    public long Id { get; set; }

    public string AlertCode { get; set; } = string.Empty;

    public string EventType { get; set; } = string.Empty;

    public string Severity { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public int Count { get; set; }

    public List<string> Samples { get; set; } = [];

    public string NotificationStatus { get; set; } = string.Empty;

    public int NotificationAttemptCount { get; set; }

    public DateTimeOffset? LastNotificationAttemptAt { get; set; }

    public DateTimeOffset? NotificationNextAttemptAt { get; set; }

    public DateTimeOffset? NotifiedAt { get; set; }

    public string? NotificationError { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
