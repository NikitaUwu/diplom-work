using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingMetricsService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;

    public ProcessingMetricsService(AppDbContext db, AppOptions options)
    {
        _db = db;
        _options = options;
    }

    public async Task<ProcessingMetricsResponse> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var jobs = await _db.ProcessingJobs
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        var outbox = await _db.OutboxMessages
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var jobStatusCounts = jobs
            .GroupBy(item => string.IsNullOrWhiteSpace(item.Status) ? "unknown" : item.Status)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        var outboxStatusCounts = outbox
            .GroupBy(item => string.IsNullOrWhiteSpace(item.Status) ? "unknown" : item.Status)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        var errorCodeCounts = jobs
            .Where(item => !string.IsNullOrWhiteSpace(item.ErrorCode))
            .GroupBy(item => item.ErrorCode!)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        var retryableErrorJobs = jobs.Count(item =>
            !string.IsNullOrWhiteSpace(item.ErrorCode) &&
            ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(_options, item.ErrorCode).Retryable);

        var terminalErrorJobs = jobs.Count(item =>
            !string.IsNullOrWhiteSpace(item.ErrorCode) &&
            !ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(_options, item.ErrorCode).Retryable);

        var queuedJobs = jobs
            .Where(item => string.Equals(item.Status, "queued", StringComparison.OrdinalIgnoreCase))
            .ToList();

        return new ProcessingMetricsResponse
        {
            GeneratedAt = now,
            JobStatusCounts = jobStatusCounts,
            OutboxStatusCounts = outboxStatusCounts,
            ErrorCodeCounts = errorCodeCounts,
            RetryableErrorJobs = retryableErrorJobs,
            TerminalErrorJobs = terminalErrorJobs,
            QueuedReadyJobs = queuedJobs.Count(item => item.NextRetryAt is null || item.NextRetryAt <= now),
            QueuedDelayedJobs = queuedJobs.Count(item => item.NextRetryAt is not null && item.NextRetryAt > now),
            OldestQueuedCreatedAt = queuedJobs
                .OrderBy(item => item.CreatedAt)
                .Select(item => (DateTimeOffset?)item.CreatedAt)
                .FirstOrDefault(),
        };
    }
}
