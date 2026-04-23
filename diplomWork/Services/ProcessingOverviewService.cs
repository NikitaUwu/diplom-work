using DiplomWork.Dtos;

namespace DiplomWork.Services;

public sealed class ProcessingOverviewService
{
    private readonly ProcessingMetricsService _metricsService;
    private readonly ProcessingAlertsService _alertsService;
    private readonly ProcessingDiagnosticsService _diagnosticsService;

    public ProcessingOverviewService(
        ProcessingMetricsService metricsService,
        ProcessingAlertsService alertsService,
        ProcessingDiagnosticsService diagnosticsService)
    {
        _metricsService = metricsService;
        _alertsService = alertsService;
        _diagnosticsService = diagnosticsService;
    }

    public async Task<ProcessingOverviewResponse> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var metrics = await _metricsService.GetSnapshotAsync(cancellationToken);
        var alerts = await _alertsService.GetSnapshotAsync(cancellationToken);
        var diagnostics = await _diagnosticsService.GetSnapshotAsync(cancellationToken);

        return new ProcessingOverviewResponse
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Metrics = metrics,
            Alerts = alerts,
            Diagnostics = diagnostics,
        };
    }
}
