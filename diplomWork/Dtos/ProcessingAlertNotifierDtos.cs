using System.Text.Json;

namespace DiplomWork.Dtos;

public sealed class ProcessingAlertNotifierStatusResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public bool Enabled { get; set; }

    public bool LogEnabled { get; set; }

    public bool WebhookConfigured { get; set; }

    public string WebhookFormat { get; set; } = string.Empty;

    public string MinimumSeverity { get; set; } = string.Empty;

    public List<string> EventTypes { get; set; } = [];

    public int BatchSize { get; set; }

    public int PendingCount { get; set; }

    public int ErrorCount { get; set; }

    public int SentCount { get; set; }

    public int SuppressedCount { get; set; }

    public int ReadyToDispatchCount { get; set; }

    public DateTimeOffset? OldestReadyEventCreatedAt { get; set; }
}

public sealed class ProcessingAlertDispatchResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public int DispatchedCount { get; set; }
}

public sealed class ProcessingAlertNotificationPreviewResponse
{
    public long EventId { get; set; }

    public string NotificationStatus { get; set; } = string.Empty;

    public bool ShouldNotify { get; set; }

    public string WebhookFormat { get; set; } = string.Empty;

    public ProcessingAlertNotificationPayload CanonicalPayload { get; set; } = new();

    public JsonElement WebhookBody { get; set; }
}
