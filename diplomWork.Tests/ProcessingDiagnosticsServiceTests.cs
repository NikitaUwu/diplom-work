using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingDiagnosticsServiceTests
{
    [Fact]
    public async Task GetSnapshotAsync_ReturnsProblemListsAndCounts()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;

        db.ProcessingJobs.AddRange(
            new ProcessingJob
            {
                ChartId = 1,
                Status = "processing",
                MessageId = "job-processing-stale",
                CreatedAt = now.AddMinutes(-10),
                StartedAt = now.AddMinutes(-9),
                LeasedUntil = now.AddMinutes(-1),
            },
            new ProcessingJob
            {
                ChartId = 2,
                Status = "queued",
                MessageId = "job-queued-ready",
                CreatedAt = now.AddMinutes(-8),
            },
            new ProcessingJob
            {
                ChartId = 3,
                Status = "error",
                MessageId = "job-error",
                CreatedAt = now.AddMinutes(-7),
                FinishedAt = now.AddMinutes(-2),
                ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
            });

        db.OutboxMessages.AddRange(
            new OutboxMessage
            {
                ProcessingJobId = 2,
                Topic = "charts/process/request",
                Status = "pending",
                MessageId = "outbox-pending",
                CreatedAt = now.AddMinutes(-6),
            },
            new OutboxMessage
            {
                ProcessingJobId = 3,
                Topic = "charts/process/request",
                Status = "error",
                MessageId = "outbox-error",
                CreatedAt = now.AddMinutes(-5),
                LastAttemptAt = now.AddMinutes(-1),
                ErrorMessage = "publish failed",
            });

        db.InboxMessages.AddRange(
            new InboxMessage
            {
                MessageId = "inbox-older",
                Topic = "charts/process/accepted",
                CreatedAt = now.AddMinutes(-4),
            },
            new InboxMessage
            {
                MessageId = "inbox-newer",
                Topic = "charts/process/completed",
                CreatedAt = now.AddMinutes(-1),
            });

        await db.SaveChangesAsync();

        var service = new ProcessingDiagnosticsService(db, CreateOptions());

        var snapshot = await service.GetSnapshotAsync();

        Assert.Equal(1, snapshot.StaleProcessingJobCount);
        Assert.Equal(1, snapshot.QueuedReadyJobCount);
        Assert.Equal(1, snapshot.FailedJobCount);
        Assert.Equal(1, snapshot.PendingOutboxCount);
        Assert.Equal(1, snapshot.ErrorOutboxCount);
        Assert.Single(snapshot.StaleProcessingJobs);
        Assert.Single(snapshot.QueuedReadyJobs);
        Assert.Single(snapshot.FailedJobs);
        Assert.Single(snapshot.PendingOutboxMessages);
        Assert.Single(snapshot.ErrorOutboxMessages);
        Assert.Equal(2, snapshot.RecentInboxMessages.Count);
        Assert.Equal("inbox-newer", snapshot.RecentInboxMessages[0].MessageId);
    }

    private static TestAppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TestAppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new TestAppDbContext(options);
    }

    private static AppOptions CreateOptions() =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingMaxAttempts = 3,
            ProcessingRetryDelaySeconds = 15,
            ProcessingRetryModalBackendUnavailableMaxAttempts = 5,
            ProcessingRetryModalBackendUnavailableDelaySeconds = 20,
            ProcessingRetryNetworkTimeoutMaxAttempts = 4,
            ProcessingRetryNetworkTimeoutDelaySeconds = 10,
            ProcessingAlertQueuedReadyAgeSeconds = 120,
            ProcessingAlertOutboxPendingAgeSeconds = 60,
            ProcessingAlertRecentFailureWindowMinutes = 15,
            ProcessingAlertRecentFailureCountThreshold = 3,
            ProcessingDiagnosticsItemLimit = 10,
        };
}
