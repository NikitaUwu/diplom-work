using System.Text.Json;
using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingAlertNotifierAdminService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ProcessingAlertNotificationPolicyService _policyService;
    private readonly ProcessingAlertNotificationSender _sender;

    public ProcessingAlertNotifierAdminService(
        AppDbContext db,
        AppOptions options,
        ProcessingAlertNotificationPolicyService policyService,
        ProcessingAlertNotificationSender sender)
    {
        _db = db;
        _options = options;
        _policyService = policyService;
        _sender = sender;
    }

    public async Task<ProcessingAlertNotifierStatusResponse> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var items = await _db.ProcessingAlertEvents
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var readyItems = items
            .Where(item =>
                item.NotificationStatus == "pending" ||
                (item.NotificationStatus == "error" && (item.NotificationNextAttemptAt == null || item.NotificationNextAttemptAt <= now)))
            .ToList();

        return new ProcessingAlertNotifierStatusResponse
        {
            GeneratedAt = now,
            Enabled = _options.ProcessingAlertNotifierEnabled,
            LogEnabled = _options.ProcessingAlertNotifierLogEnabled,
            WebhookConfigured = !string.IsNullOrWhiteSpace(_options.ProcessingAlertNotifierWebhookUrl),
            WebhookFormat = _options.ProcessingAlertNotifierWebhookFormat,
            MinimumSeverity = _options.ProcessingAlertNotifierMinimumSeverity,
            EventTypes = _options.ProcessingAlertNotifierEventTypes.ToList(),
            BatchSize = _options.ProcessingAlertNotifierBatchSize,
            PendingCount = items.Count(item => item.NotificationStatus == "pending"),
            ErrorCount = items.Count(item => item.NotificationStatus == "error"),
            SentCount = items.Count(item => item.NotificationStatus == "sent"),
            SuppressedCount = items.Count(item => item.NotificationStatus == "suppressed"),
            ReadyToDispatchCount = readyItems.Count,
            OldestReadyEventCreatedAt = readyItems
                .OrderBy(item => item.CreatedAt)
                .Select(item => (DateTimeOffset?)item.CreatedAt)
                .FirstOrDefault(),
        };
    }

    public async Task<ProcessingAlertNotificationPreviewResponse> GetPreviewAsync(long eventId, CancellationToken cancellationToken = default)
    {
        var item = await _db.ProcessingAlertEvents
            .AsNoTracking()
            .FirstOrDefaultAsync(alertEvent => alertEvent.Id == eventId, cancellationToken);

        if (item is null)
        {
            throw new ApiProblemException(StatusCodes.Status404NotFound, "Alert event not found");
        }

        var canonicalPayload = _sender.BuildPayload(item);
        var webhookBody = _sender.BuildWebhookRequestBody(canonicalPayload);
        var json = JsonSerializer.SerializeToElement(webhookBody);

        return new ProcessingAlertNotificationPreviewResponse
        {
            EventId = item.Id,
            NotificationStatus = item.NotificationStatus,
            ShouldNotify = _policyService.ShouldNotify(item),
            WebhookFormat = _options.ProcessingAlertNotifierWebhookFormat,
            CanonicalPayload = canonicalPayload,
            WebhookBody = json,
        };
    }
}
