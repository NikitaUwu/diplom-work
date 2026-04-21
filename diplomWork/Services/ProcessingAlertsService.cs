using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingAlertsService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;

    public ProcessingAlertsService(AppDbContext db, AppOptions options)
    {
        _db = db;
        _options = options;
    }

    public async Task<ProcessingAlertsResponse> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var itemLimit = _options.ProcessingDiagnosticsItemLimit;
        var alerts = new List<ProcessingAlertItem>();

        var staleProcessingCount = await _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "processing" && item.LeasedUntil != null && item.LeasedUntil <= now)
            .CountAsync(cancellationToken);

        if (staleProcessingCount > 0)
        {
            var samples = await _db.ProcessingJobs
                .AsNoTracking()
                .Where(item => item.Status == "processing" && item.LeasedUntil != null && item.LeasedUntil <= now)
                .OrderBy(item => item.LeasedUntil)
                .Take(itemLimit)
                .Select(item => $"job:{item.Id}")
                .ToListAsync(cancellationToken);

            alerts.Add(new ProcessingAlertItem
            {
                Code = "stale_processing_jobs",
                Severity = "critical",
                Message = "Есть processing-задачи с истекшим lease.",
                Count = staleProcessingCount,
                Samples = samples,
            });
        }

        var queuedAgeCutoff = now.AddSeconds(-_options.ProcessingAlertQueuedReadyAgeSeconds);
        var queuedReadyCount = await _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "queued" && (item.NextRetryAt ?? item.CreatedAt) <= queuedAgeCutoff)
            .CountAsync(cancellationToken);

        if (queuedReadyCount > 0)
        {
            var samples = await _db.ProcessingJobs
                .AsNoTracking()
                .Where(item => item.Status == "queued" && (item.NextRetryAt ?? item.CreatedAt) <= queuedAgeCutoff)
                .OrderBy(item => item.NextRetryAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(item => $"job:{item.Id}")
                .ToListAsync(cancellationToken);

            alerts.Add(new ProcessingAlertItem
            {
                Code = "aged_queued_jobs",
                Severity = queuedReadyCount >= _options.ProcessingAlertRecentFailureCountThreshold ? "critical" : "warning",
                Message = "Есть queued-задачи, которые слишком долго готовы к исполнению.",
                Count = queuedReadyCount,
                Samples = samples,
            });
        }

        var outboxPendingCutoff = now.AddSeconds(-_options.ProcessingAlertOutboxPendingAgeSeconds);
        var staleOutboxPendingCount = await _db.OutboxMessages
            .AsNoTracking()
            .Where(item => item.Status == "pending" && (item.AvailableAt ?? item.CreatedAt) <= outboxPendingCutoff)
            .CountAsync(cancellationToken);

        if (staleOutboxPendingCount > 0)
        {
            var samples = await _db.OutboxMessages
                .AsNoTracking()
                .Where(item => item.Status == "pending" && (item.AvailableAt ?? item.CreatedAt) <= outboxPendingCutoff)
                .OrderBy(item => item.AvailableAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(item => $"outbox:{item.Id}")
                .ToListAsync(cancellationToken);

            alerts.Add(new ProcessingAlertItem
            {
                Code = "stale_outbox_pending",
                Severity = "warning",
                Message = "Есть pending outbox-сообщения, которые давно должны были быть опубликованы.",
                Count = staleOutboxPendingCount,
                Samples = samples,
            });
        }

        var outboxErrorCount = await _db.OutboxMessages
            .AsNoTracking()
            .Where(item => item.Status == "error")
            .CountAsync(cancellationToken);

        if (outboxErrorCount > 0)
        {
            var samples = await _db.OutboxMessages
                .AsNoTracking()
                .Where(item => item.Status == "error")
                .OrderByDescending(item => item.LastAttemptAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(item => $"outbox:{item.Id}")
                .ToListAsync(cancellationToken);

            alerts.Add(new ProcessingAlertItem
            {
                Code = "outbox_publish_errors",
                Severity = outboxErrorCount >= _options.ProcessingAlertRecentFailureCountThreshold ? "critical" : "warning",
                Message = "Есть ошибки публикации сообщений в MQTT outbox.",
                Count = outboxErrorCount,
                Samples = samples,
            });
        }

        var recentFailureWindowStart = now.AddMinutes(-_options.ProcessingAlertRecentFailureWindowMinutes);
        var recentFailedGroups = await _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "error" && item.FinishedAt != null && item.FinishedAt >= recentFailureWindowStart)
            .GroupBy(item => item.ErrorCode ?? "unknown")
            .Select(group => new
            {
                ErrorCode = group.Key,
                Count = group.Count(),
            })
            .OrderByDescending(item => item.Count)
            .Take(itemLimit)
            .ToListAsync(cancellationToken);

        var recentFailureCount = recentFailedGroups.Sum(item => item.Count);
        if (recentFailureCount >= _options.ProcessingAlertRecentFailureCountThreshold)
        {
            alerts.Add(new ProcessingAlertItem
            {
                Code = "recent_terminal_failures",
                Severity = recentFailureCount >= _options.ProcessingAlertRecentFailureCountThreshold * 2 ? "critical" : "warning",
                Message = "За последнее окно времени накопилось много failed-задач.",
                Count = recentFailureCount,
                Samples = recentFailedGroups
                    .Select(item => $"{item.ErrorCode}:{item.Count}")
                    .ToList(),
            });
        }

        return new ProcessingAlertsResponse
        {
            GeneratedAt = now,
            IsHealthy = alerts.Count == 0,
            Alerts = alerts,
        };
    }
}
