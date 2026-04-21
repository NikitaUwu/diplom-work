using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingMetricsServiceTests
{
    [Fact]
    public async Task GetSnapshotAsync_AggregatesStatusesAndErrorCategories()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;

        db.ProcessingJobs.AddRange(
            new ProcessingJob
            {
                ChartId = 1,
                Status = "queued",
                MessageId = "job-1",
                CreatedAt = now.AddMinutes(-10),
            },
            new ProcessingJob
            {
                ChartId = 2,
                Status = "queued",
                MessageId = "job-2",
                CreatedAt = now.AddMinutes(-5),
                NextRetryAt = now.AddMinutes(2),
                ErrorCode = ProcessingErrorCatalog.Codes.ModalBackendUnavailable,
            },
            new ProcessingJob
            {
                ChartId = 3,
                Status = "error",
                MessageId = "job-3",
                CreatedAt = now.AddMinutes(-4),
                ErrorCode = ProcessingErrorCatalog.Codes.ModalBackendUnavailable,
            },
            new ProcessingJob
            {
                ChartId = 4,
                Status = "error",
                MessageId = "job-4",
                CreatedAt = now.AddMinutes(-3),
                ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
            },
            new ProcessingJob
            {
                ChartId = 5,
                Status = "processing",
                MessageId = "job-5",
                CreatedAt = now.AddMinutes(-2),
            });

        db.OutboxMessages.AddRange(
            new OutboxMessage { Topic = "charts/process/request", Status = "pending", MessageId = "outbox-1", CreatedAt = now.AddMinutes(-2) },
            new OutboxMessage { Topic = "charts/process/request", Status = "published", MessageId = "outbox-2", CreatedAt = now.AddMinutes(-1) },
            new OutboxMessage { Topic = "charts/process/request", Status = "error", MessageId = "outbox-3", CreatedAt = now.AddMinutes(-1) });

        await db.SaveChangesAsync();

        var service = new ProcessingMetricsService(db, CreateOptions());

        var snapshot = await service.GetSnapshotAsync();

        Assert.Equal(2, snapshot.JobStatusCounts["queued"]);
        Assert.Equal(2, snapshot.JobStatusCounts["error"]);
        Assert.Equal(1, snapshot.JobStatusCounts["processing"]);
        Assert.Equal(1, snapshot.OutboxStatusCounts["pending"]);
        Assert.Equal(1, snapshot.OutboxStatusCounts["published"]);
        Assert.Equal(1, snapshot.OutboxStatusCounts["error"]);
        Assert.Equal(2, snapshot.ErrorCodeCounts[ProcessingErrorCatalog.Codes.ModalBackendUnavailable]);
        Assert.Equal(1, snapshot.ErrorCodeCounts[ProcessingErrorCatalog.Codes.PipelineOutputInvalid]);
        Assert.Equal(2, snapshot.RetryableErrorJobs);
        Assert.Equal(1, snapshot.TerminalErrorJobs);
        Assert.Equal(1, snapshot.QueuedReadyJobs);
        Assert.Equal(1, snapshot.QueuedDelayedJobs);
        Assert.Equal(now.AddMinutes(-10).ToUnixTimeSeconds(), snapshot.OldestQueuedCreatedAt?.ToUnixTimeSeconds());
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
        };
}
