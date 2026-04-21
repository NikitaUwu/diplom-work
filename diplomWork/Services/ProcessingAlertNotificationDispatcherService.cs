using DiplomWork.Configuration;
using DiplomWork.Data;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingAlertNotificationDispatcherService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ProcessingAlertNotificationPolicyService _policyService;
    private readonly IProcessingAlertNotificationSender _sender;
    private readonly ILogger<ProcessingAlertNotificationDispatcherService> _logger;

    public ProcessingAlertNotificationDispatcherService(
        AppDbContext db,
        AppOptions options,
        ProcessingAlertNotificationPolicyService policyService,
        IProcessingAlertNotificationSender sender,
        ILogger<ProcessingAlertNotificationDispatcherService> logger)
    {
        _db = db;
        _options = options;
        _policyService = policyService;
        _sender = sender;
        _logger = logger;
    }

    public async Task<int> DispatchPendingAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var items = await _db.ProcessingAlertEvents
            .Where(item =>
                item.NotificationStatus == "pending" ||
                (item.NotificationStatus == "error" && (item.NotificationNextAttemptAt == null || item.NotificationNextAttemptAt <= now)))
            .OrderBy(item => item.CreatedAt)
            .ThenBy(item => item.Id)
            .Take(_options.ProcessingAlertNotifierBatchSize)
            .ToListAsync(cancellationToken);

        var sentCount = 0;
        foreach (var item in items)
        {
            if (!_policyService.ShouldNotify(item))
            {
                item.NotificationStatus = "suppressed";
                item.NotificationNextAttemptAt = null;
                item.NotificationError = "Suppressed by notification policy.";
                continue;
            }

            try
            {
                await _sender.SendAsync(item, cancellationToken);
                item.NotificationStatus = "sent";
                item.NotificationAttemptCount += 1;
                item.LastNotificationAttemptAt = now;
                item.NotificationNextAttemptAt = null;
                item.NotifiedAt = now;
                item.NotificationError = null;
                sentCount++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                item.NotificationStatus = "error";
                item.NotificationAttemptCount += 1;
                item.LastNotificationAttemptAt = now;
                item.NotificationNextAttemptAt = now.AddSeconds(_options.ProcessingAlertNotifierRetryDelaySeconds);
                item.NotificationError = Truncate(ex.Message, 1000);
                _logger.LogError(ex, "Failed to send processing alert notification for event {EventId}.", item.Id);
            }
        }

        if (_db.ChangeTracker.HasChanges())
        {
            await _db.SaveChangesAsync(cancellationToken);
        }

        return sentCount;
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
