using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingOverviewServiceTests
{
    [Fact]
    public async Task GetSnapshotAsync_ComposesMetricsAlertsAndDiagnostics()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;

        db.ProcessingJobs.AddRange(
            new ProcessingJob
            {
                ChartId = 1,
                Status = "queued",
                MessageId = "job-queued",
                CreatedAt = now.AddMinutes(-10),
            },
            new ProcessingJob
            {
                ChartId = 2,
                Status = "processing",
                MessageId = "job-processing",
                CreatedAt = now.AddMinutes(-4),
                StartedAt = now.AddMinutes(-3),
                LeasedUntil = now.AddSeconds(-30),
            },
            new ProcessingJob
            {
                ChartId = 3,
                Status = "error",
                MessageId = "job-error",
                CreatedAt = now.AddMinutes(-2),
                FinishedAt = now.AddMinutes(-1),
                ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
            });

        db.MqttMessages.Add(new MqttMessage
        {
            Direction = "out",
            Topic = "charts/process/request",
            Status = "pending",
            MessageId = "mqtt-pending",
            CreatedAt = now.AddMinutes(-3),
        });

        db.MqttMessages.Add(new MqttMessage
        {
            Direction = "in",
            Status = "processed",
            MessageId = "mqtt-in-1",
            Topic = "charts/process/accepted",
            CreatedAt = now.AddMinutes(-1),
        });

        await db.SaveChangesAsync();

        var options = CreateOptions();
        var overviewService = new ProcessingOverviewService(
            new ProcessingMetricsService(db, options),
            new ProcessingAlertsService(db, options),
            new ProcessingDiagnosticsService(db, options));

        var snapshot = await overviewService.GetSnapshotAsync();

        Assert.Equal(1, snapshot.Metrics.JobStatusCounts["queued"]);
        Assert.False(snapshot.Alerts.IsHealthy);
        Assert.Equal(1, snapshot.Diagnostics.StaleProcessingJobCount);
        Assert.Equal(1, snapshot.Diagnostics.PendingMqttMessageCount);
        Assert.Single(snapshot.Diagnostics.RecentInboundMqttMessages);
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
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
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
            ProcessingAlertRecentFailureCountThreshold = 2,
            ProcessingDiagnosticsItemLimit = 10,
        };
}
