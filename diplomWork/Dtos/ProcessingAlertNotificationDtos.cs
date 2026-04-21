namespace DiplomWork.Dtos;

public sealed class ProcessingAlertNotificationPayload
{
    public long EventId { get; set; }

    public string Source { get; set; } = string.Empty;

    public string Environment { get; set; } = string.Empty;

    public string AlertCode { get; set; } = string.Empty;

    public string EventType { get; set; } = string.Empty;

    public string Severity { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public int Count { get; set; }

    public List<string> Samples { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
}
