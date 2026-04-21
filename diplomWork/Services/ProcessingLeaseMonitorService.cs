using DiplomWork.Configuration;

namespace DiplomWork.Services;

public sealed class ProcessingLeaseMonitorService : BackgroundService
{
    private readonly AppOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProcessingLeaseMonitorService> _logger;

    public ProcessingLeaseMonitorService(
        AppOptions options,
        IServiceScopeFactory scopeFactory,
        ILogger<ProcessingLeaseMonitorService> logger)
    {
        _options = options;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.MqttEnabled)
        {
            _logger.LogInformation("Processing lease monitor is disabled because MQTT mode is off.");
            return;
        }

        var interval = TimeSpan.FromSeconds(Math.Max(1, _options.ProcessingLeaseMonitorIntervalSeconds));
        _logger.LogInformation("Processing lease monitor started with interval {IntervalSeconds}s.", interval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var stateService = scope.ServiceProvider.GetRequiredService<ProcessingJobStateService>();
                var expired = await stateService.ExpireTimedOutJobsAsync(stoppingToken);
                if (expired > 0)
                {
                    _logger.LogWarning("Processing lease monitor expired {Count} job(s).", expired);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Processing lease monitor iteration failed.");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }
}
