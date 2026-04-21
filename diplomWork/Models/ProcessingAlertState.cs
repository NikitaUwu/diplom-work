namespace DiplomWork.Models;

public sealed class ProcessingAlertState
{
    public long Id { get; set; }

    public string AlertCode { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public string Severity { get; set; } = "info";

    public string Message { get; set; } = string.Empty;

    public int LastCount { get; set; }

    public string? SamplesText { get; set; }

    public DateTimeOffset? FirstActivatedAt { get; set; }

    public DateTimeOffset LastObservedAt { get; set; }

    public DateTimeOffset? LastResolvedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
