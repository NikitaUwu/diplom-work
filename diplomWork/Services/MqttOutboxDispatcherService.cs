using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Helpers;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class MqttOutboxDispatcherService : BackgroundService
{
    private readonly AppOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MqttPublisherService _mqttPublisherService;
    private readonly MqttOutboxSignal _outboxSignal;
    private readonly ILogger<MqttOutboxDispatcherService> _logger;

    public MqttOutboxDispatcherService(
        AppOptions options,
        IServiceScopeFactory scopeFactory,
        MqttPublisherService mqttPublisherService,
        MqttOutboxSignal outboxSignal,
        ILogger<MqttOutboxDispatcherService> logger)
    {
        _options = options;
        _scopeFactory = scopeFactory;
        _mqttPublisherService = mqttPublisherService;
        _outboxSignal = outboxSignal;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.MqttEnabled)
        {
            _logger.LogInformation("MQTT outbox dispatcher is disabled.");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await DispatchBatchAsync(stoppingToken);
                if (processed == 0)
                {
                    // Если новых сообщений нет, ждем сигнал от загрузки файла или короткую паузу.
                    await _outboxSignal.WaitAsync(TimeSpan.FromSeconds(2), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MQTT outbox dispatcher failed. Retrying in 5 seconds.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task<int> DispatchBatchAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;

        // Берем только те сообщения, которые уже можно отправлять.
        var messages = await db.MqttMessages
            .Where(item => item.Direction == "out" &&
                           (item.Status == "pending" || item.Status == "error") &&
                           (item.AvailableAt == null || item.AvailableAt <= now))
            .OrderBy(item => item.CreatedAt)
            .Take(10)
            .ToListAsync(cancellationToken);

        foreach (var message in messages)
        {
            var attemptStartedAt = DateTimeOffset.UtcNow;
            message.AttemptCount += 1;
            message.LastAttemptAt = attemptStartedAt;

            try
            {
                var payload = JsonHelpers.FromDocument(message.Payload);
                if (payload is null)
                {
                    throw new InvalidOperationException($"Outbox message {message.Id} has no payload.");
                }

                await _mqttPublisherService.PublishAsync(message.Topic, payload, cancellationToken);

                message.Status = "published";
                message.ErrorMessage = null;
                message.ProcessedAt = DateTimeOffset.UtcNow;
                message.AvailableAt = null;

                if (message.ProcessingJobId is long processingJobId)
                {
                    var job = await db.ProcessingJobs.FirstOrDefaultAsync(item => item.Id == processingJobId, cancellationToken);
                    if (job is not null && string.Equals(job.Status, "queued", StringComparison.OrdinalIgnoreCase))
                    {
                        job.Status = "published";
                        job.ErrorMessage = null;
                        job.NextRetryAt = null;
                    }
                }
            }
            catch (Exception ex)
            {
                // Ошибку не теряем: сообщение останется в базе и будет отправлено позже.
                var delaySeconds = Math.Min(30, Math.Max(5, message.AttemptCount * 5));
                message.Status = "error";
                message.ErrorMessage = ex.Message.Length <= 2000 ? ex.Message : ex.Message[..2000];
                message.AvailableAt = DateTimeOffset.UtcNow.AddSeconds(delaySeconds);
                _logger.LogWarning(ex, "Failed to publish outbox message {OutboxId}; retry in {DelaySeconds}s.", message.Id, delaySeconds);
            }

            await db.SaveChangesAsync(cancellationToken);
        }

        return messages.Count;
    }
}
