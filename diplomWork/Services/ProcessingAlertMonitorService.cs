using DiplomWork.Configuration;

namespace DiplomWork.Services;

public sealed class ProcessingAlertMonitorService : BackgroundService
{
    private readonly AppOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProcessingAlertMonitorService> _logger;

    public ProcessingAlertMonitorService(
        AppOptions options,
        IServiceScopeFactory scopeFactory,
        ILogger<ProcessingAlertMonitorService> logger)
    {
        _options = options;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.ProcessingAlertMonitorEnabled)
        {
            _logger.LogInformation("Processing alert monitor is disabled by configuration.");
            return;
        }

        var interval = TimeSpan.FromSeconds(Math.Max(1, _options.ProcessingAlertMonitorIntervalSeconds));
        _logger.LogInformation("Processing alert monitor started with interval {IntervalSeconds}s.", interval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var alertsService = scope.ServiceProvider.GetRequiredService<ProcessingAlertsService>();
                var historyService = scope.ServiceProvider.GetRequiredService<ProcessingAlertHistoryService>();
                var snapshot = await alertsService.GetSnapshotAsync(stoppingToken);
                var recordedEvents = await historyService.CaptureSnapshotAsync(snapshot, stoppingToken);
                if (recordedEvents > 0)
                {
                    _logger.LogWarning("Processing alert monitor recorded {Count} alert event(s).", recordedEvents);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Processing alert monitor iteration failed.");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }
}
