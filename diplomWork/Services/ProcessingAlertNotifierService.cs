using DiplomWork.Configuration;

namespace DiplomWork.Services;

public sealed class ProcessingAlertNotifierService : BackgroundService
{
    private readonly AppOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProcessingAlertNotifierService> _logger;

    public ProcessingAlertNotifierService(
        AppOptions options,
        IServiceScopeFactory scopeFactory,
        ILogger<ProcessingAlertNotifierService> logger)
    {
        _options = options;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.ProcessingAlertNotifierEnabled)
        {
            _logger.LogInformation("Processing alert notifier is disabled by configuration.");
            return;
        }

        var interval = TimeSpan.FromSeconds(Math.Max(1, _options.ProcessingAlertNotifierIntervalSeconds));
        _logger.LogInformation("Processing alert notifier started with interval {IntervalSeconds}s.", interval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var dispatcher = scope.ServiceProvider.GetRequiredService<ProcessingAlertNotificationDispatcherService>();
                var sent = await dispatcher.DispatchPendingAsync(stoppingToken);
                if (sent > 0)
                {
                    _logger.LogInformation("Processing alert notifier sent {Count} notification(s).", sent);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Processing alert notifier iteration failed.");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }
}
