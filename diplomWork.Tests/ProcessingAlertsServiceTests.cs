using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertsServiceTests
{
    [Fact]
    public async Task GetSnapshotAsync_ReturnsOperationalAlerts_ForProblemScenarios()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;

        db.ProcessingJobs.AddRange(
            new ProcessingJob
            {
                ChartId = 1,
                Status = "processing",
                MessageId = "job-processing-stale",
                CreatedAt = now.AddMinutes(-6),
                StartedAt = now.AddMinutes(-5),
                LeasedUntil = now.AddSeconds(-30),
            },
            new ProcessingJob
            {
                ChartId = 2,
                Status = "queued",
                MessageId = "job-queued-old",
                CreatedAt = now.AddMinutes(-10),
            },
            new ProcessingJob
            {
                ChartId = 3,
                Status = "error",
                MessageId = "job-error-1",
                CreatedAt = now.AddMinutes(-8),
                FinishedAt = now.AddMinutes(-4),
                ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
            },
            new ProcessingJob
            {
                ChartId = 4,
                Status = "error",
                MessageId = "job-error-2",
                CreatedAt = now.AddMinutes(-7),
                FinishedAt = now.AddMinutes(-3),
                ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
            },
            new ProcessingJob
            {
                ChartId = 5,
                Status = "error",
                MessageId = "job-error-3",
                CreatedAt = now.AddMinutes(-6),
                FinishedAt = now.AddMinutes(-2),
                ErrorCode = ProcessingErrorCatalog.Codes.ModalBackendUnavailable,
            });

        db.MqttMessages.AddRange(
            new MqttMessage
            {
                Direction = "out",
                Topic = "charts/process/request",
                Status = "pending",
                MessageId = "mqtt-pending",
                CreatedAt = now.AddMinutes(-5),
            },
            new MqttMessage
            {
                Direction = "out",
                Topic = "charts/process/request",
                Status = "error",
                MessageId = "mqtt-error",
                CreatedAt = now.AddMinutes(-4),
                LastAttemptAt = now.AddMinutes(-1),
                ErrorMessage = "broker unavailable",
            });

        await db.SaveChangesAsync();

        var service = new ProcessingAlertsService(db, CreateOptions());

        var snapshot = await service.GetSnapshotAsync();

        Assert.False(snapshot.IsHealthy);
        Assert.Contains(snapshot.Alerts, item => item.Code == "stale_processing_jobs" && item.Count == 1);
        Assert.Contains(snapshot.Alerts, item => item.Code == "aged_queued_jobs" && item.Count == 1);
        Assert.Contains(snapshot.Alerts, item => item.Code == "stale_outbox_pending" && item.Count == 1);
        Assert.Contains(snapshot.Alerts, item => item.Code == "outbox_publish_errors" && item.Count == 1);
        Assert.Contains(snapshot.Alerts, item => item.Code == "recent_terminal_failures" && item.Count == 3);
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
