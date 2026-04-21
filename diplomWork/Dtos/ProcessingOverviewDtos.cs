namespace DiplomWork.Dtos;

public sealed class ProcessingOverviewResponse
{
    public DateTimeOffset GeneratedAt { get; set; }

    public ProcessingMetricsResponse Metrics { get; set; } = new();

    public ProcessingAlertsResponse Alerts { get; set; } = new();

    public ProcessingDiagnosticsResponse Diagnostics { get; set; } = new();

    public List<ProcessingAlertEventReadResponse> RecentAlertEvents { get; set; } = [];
}
