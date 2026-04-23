namespace DiplomWork.Dtos;

public sealed class ProcessingAlertsResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public bool IsHealthy { get; set; }

    public List<ProcessingAlertItem> Alerts { get; set; } = [];
}

public sealed class ProcessingAlertItem
{
    public string Code { get; set; } = string.Empty;

    public string Severity { get; set; } = "info";

    public string Message { get; set; } = string.Empty;

    public int Count { get; set; }

    public List<string> Samples { get; set; } = [];
}

public sealed class ProcessingDiagnosticsResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public int ItemLimit { get; set; }

    public int StaleProcessingJobCount { get; set; }

    public int QueuedReadyJobCount { get; set; }

    public int FailedJobCount { get; set; }

    public int PendingMqttMessageCount { get; set; }

    public int ErrorMqttMessageCount { get; set; }

    public List<ProcessingJobDiagnosticItem> StaleProcessingJobs { get; set; } = [];

    public List<ProcessingJobDiagnosticItem> QueuedReadyJobs { get; set; } = [];

    public List<ProcessingJobDiagnosticItem> FailedJobs { get; set; } = [];

    public List<MqttDiagnosticItem> PendingMqttMessages { get; set; } = [];

    public List<MqttDiagnosticItem> ErrorMqttMessages { get; set; } = [];

    public List<MqttDiagnosticItem> RecentInboundMqttMessages { get; set; } = [];
}

public sealed class ProcessingJobDiagnosticItem
{
    public long Id { get; set; }

    public int ChartId { get; set; }

    public string Status { get; set; } = string.Empty;

    public int Attempt { get; set; }

    public string? ErrorCode { get; set; }

    public string? ErrorMessage { get; set; }

    public string? MessageId { get; set; }

    public string? WorkerId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? LastHeartbeatAt { get; set; }

    public DateTimeOffset? LeasedUntil { get; set; }

    public DateTimeOffset? NextRetryAt { get; set; }

    public DateTimeOffset? FinishedAt { get; set; }
}

public sealed class MqttDiagnosticItem
{
    public long Id { get; set; }

    public long? ProcessingJobId { get; set; }

    public string Direction { get; set; } = string.Empty;

    public string Topic { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string? MessageId { get; set; }

    public int AttemptCount { get; set; }

    public string? ErrorMessage { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset? AvailableAt { get; set; }

    public DateTimeOffset? ProcessedAt { get; set; }
}
