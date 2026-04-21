using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingDiagnosticsService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;

    public ProcessingDiagnosticsService(AppDbContext db, AppOptions options)
    {
        _db = db;
        _options = options;
    }

    public async Task<ProcessingDiagnosticsResponse> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var itemLimit = _options.ProcessingDiagnosticsItemLimit;

        var staleProcessingQuery = _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "processing" && item.LeasedUntil != null && item.LeasedUntil <= now);

        var queuedReadyQuery = _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "queued" && (item.NextRetryAt == null || item.NextRetryAt <= now));

        var failedJobsQuery = _db.ProcessingJobs
            .AsNoTracking()
            .Where(item => item.Status == "error");

        var pendingOutboxQuery = _db.OutboxMessages
            .AsNoTracking()
            .Where(item => item.Status == "pending" && (item.AvailableAt == null || item.AvailableAt <= now));

        var errorOutboxQuery = _db.OutboxMessages
            .AsNoTracking()
            .Where(item => item.Status == "error");

        return new ProcessingDiagnosticsResponse
        {
            GeneratedAt = now,
            ItemLimit = itemLimit,
            StaleProcessingJobCount = await staleProcessingQuery.CountAsync(cancellationToken),
            QueuedReadyJobCount = await queuedReadyQuery.CountAsync(cancellationToken),
            FailedJobCount = await failedJobsQuery.CountAsync(cancellationToken),
            PendingOutboxCount = await pendingOutboxQuery.CountAsync(cancellationToken),
            ErrorOutboxCount = await errorOutboxQuery.CountAsync(cancellationToken),
            StaleProcessingJobs = await staleProcessingQuery
                .OrderBy(item => item.LeasedUntil)
                .Take(itemLimit)
                .Select(MapProcessingJob())
                .ToListAsync(cancellationToken),
            QueuedReadyJobs = await queuedReadyQuery
                .OrderBy(item => item.NextRetryAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(MapProcessingJob())
                .ToListAsync(cancellationToken),
            FailedJobs = await failedJobsQuery
                .OrderByDescending(item => item.FinishedAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(MapProcessingJob())
                .ToListAsync(cancellationToken),
            PendingOutboxMessages = await pendingOutboxQuery
                .OrderBy(item => item.AvailableAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(MapOutboxMessage())
                .ToListAsync(cancellationToken),
            ErrorOutboxMessages = await errorOutboxQuery
                .OrderByDescending(item => item.LastAttemptAt ?? item.CreatedAt)
                .Take(itemLimit)
                .Select(MapOutboxMessage())
                .ToListAsync(cancellationToken),
            RecentInboxMessages = await _db.InboxMessages
                .AsNoTracking()
                .OrderByDescending(item => item.CreatedAt)
                .Take(itemLimit)
                .Select(item => new InboxDiagnosticItem
                {
                    Id = item.Id,
                    MessageId = item.MessageId,
                    Topic = item.Topic,
                    CreatedAt = item.CreatedAt,
                })
                .ToListAsync(cancellationToken),
        };
    }

    private static System.Linq.Expressions.Expression<Func<Models.ProcessingJob, ProcessingJobDiagnosticItem>> MapProcessingJob() =>
        item => new ProcessingJobDiagnosticItem
        {
            Id = item.Id,
            ChartId = item.ChartId,
            Status = item.Status,
            Attempt = item.Attempt,
            ErrorCode = item.ErrorCode,
            ErrorMessage = item.ErrorMessage,
            MessageId = item.MessageId,
            WorkerId = item.WorkerId,
            CreatedAt = item.CreatedAt,
            StartedAt = item.StartedAt,
            LastHeartbeatAt = item.LastHeartbeatAt,
            LeasedUntil = item.LeasedUntil,
            NextRetryAt = item.NextRetryAt,
            FinishedAt = item.FinishedAt,
        };

    private static System.Linq.Expressions.Expression<Func<Models.OutboxMessage, OutboxDiagnosticItem>> MapOutboxMessage() =>
        item => new OutboxDiagnosticItem
        {
            Id = item.Id,
            ProcessingJobId = item.ProcessingJobId,
            Topic = item.Topic,
            Status = item.Status,
            MessageId = item.MessageId,
            AttemptCount = item.AttemptCount,
            ErrorMessage = item.ErrorMessage,
            CreatedAt = item.CreatedAt,
            LastAttemptAt = item.LastAttemptAt,
            AvailableAt = item.AvailableAt,
            PublishedAt = item.PublishedAt,
        };
}
