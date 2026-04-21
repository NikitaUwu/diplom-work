namespace DiplomWork.Dtos;

public sealed class ProcessingMetricsResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public Dictionary<string, int> JobStatusCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, int> OutboxStatusCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, int> ErrorCodeCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public int RetryableErrorJobs { get; set; }

    public int TerminalErrorJobs { get; set; }

    public int QueuedReadyJobs { get; set; }

    public int QueuedDelayedJobs { get; set; }

    public DateTimeOffset? OldestQueuedCreatedAt { get; set; }
}
