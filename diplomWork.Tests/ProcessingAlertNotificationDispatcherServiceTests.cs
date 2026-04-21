using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertNotificationDispatcherServiceTests
{
    [Fact]
    public async Task DispatchPendingAsync_MarksEventAsSent_WhenSenderSucceeds()
    {
        await using var db = CreateDbContext();
        db.ProcessingAlertEvents.Add(new ProcessingAlertEvent
        {
            AlertCode = "stale_processing_jobs",
            EventType = "activated",
            Severity = "critical",
            Message = "lease expired",
            Count = 2,
            NotificationStatus = "pending",
            NotificationNextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        });
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        var dispatcher = new ProcessingAlertNotificationDispatcherService(
            db,
            CreateOptions(),
            new ProcessingAlertNotificationPolicyService(CreateOptions()),
            sender,
            NullLogger<ProcessingAlertNotificationDispatcherService>.Instance);

        var sent = await dispatcher.DispatchPendingAsync();
        var item = await db.ProcessingAlertEvents.SingleAsync();

        Assert.Equal(1, sent);
        Assert.Single(sender.SentIds);
        Assert.Equal("sent", item.NotificationStatus);
        Assert.Equal(1, item.NotificationAttemptCount);
        Assert.NotNull(item.NotifiedAt);
        Assert.Null(item.NotificationError);
    }

    [Fact]
    public async Task DispatchPendingAsync_MarksEventAsError_WhenSenderFails()
    {
        await using var db = CreateDbContext();
        db.ProcessingAlertEvents.Add(new ProcessingAlertEvent
        {
            AlertCode = "outbox_publish_errors",
            EventType = "activated",
            Severity = "warning",
            Message = "mqtt publish failed",
            Count = 1,
            NotificationStatus = "pending",
            NotificationNextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        });
        await db.SaveChangesAsync();

        var sender = new FakeSender { ExceptionToThrow = new InvalidOperationException("webhook failed") };
        var dispatcher = new ProcessingAlertNotificationDispatcherService(
            db,
            CreateOptions(),
            new ProcessingAlertNotificationPolicyService(CreateOptions()),
            sender,
            NullLogger<ProcessingAlertNotificationDispatcherService>.Instance);

        var sent = await dispatcher.DispatchPendingAsync();
        var item = await db.ProcessingAlertEvents.SingleAsync();

        Assert.Equal(0, sent);
        Assert.Equal("error", item.NotificationStatus);
        Assert.Equal(1, item.NotificationAttemptCount);
        Assert.NotNull(item.NotificationNextAttemptAt);
        Assert.Contains("webhook failed", item.NotificationError);
    }

    [Fact]
    public async Task DispatchPendingAsync_SuppressesEvent_WhenItDoesNotMatchPolicy()
    {
        await using var db = CreateDbContext();
        db.ProcessingAlertEvents.Add(new ProcessingAlertEvent
        {
            AlertCode = "stale_processing_jobs",
            EventType = "severity_changed",
            Severity = "info",
            Message = "noise",
            Count = 1,
            NotificationStatus = "pending",
            NotificationNextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        });
        await db.SaveChangesAsync();

        var options = new AppOptions
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingAlertNotifierRetryDelaySeconds = 60,
            ProcessingAlertNotifierBatchSize = 10,
            ProcessingAlertNotifierMinimumSeverity = "warning",
            ProcessingAlertNotifierEventTypes = ["activated", "resolved"],
        };

        var sender = new FakeSender();
        var dispatcher = new ProcessingAlertNotificationDispatcherService(
            db,
            options,
            new ProcessingAlertNotificationPolicyService(options),
            sender,
            NullLogger<ProcessingAlertNotificationDispatcherService>.Instance);

        var sent = await dispatcher.DispatchPendingAsync();
        var item = await db.ProcessingAlertEvents.SingleAsync();

        Assert.Equal(0, sent);
        Assert.Empty(sender.SentIds);
        Assert.Equal("suppressed", item.NotificationStatus);
        Assert.Contains("Suppressed by notification policy", item.NotificationError);
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
            ProcessingAlertNotifierRetryDelaySeconds = 60,
            ProcessingAlertNotifierBatchSize = 10,
        };

    private sealed class FakeSender : IProcessingAlertNotificationSender
    {
        public List<long> SentIds { get; } = [];

        public Exception? ExceptionToThrow { get; set; }

        public Task SendAsync(ProcessingAlertEvent alertEvent, CancellationToken cancellationToken = default)
        {
            if (ExceptionToThrow is not null)
            {
                throw ExceptionToThrow;
            }

            SentIds.Add(alertEvent.Id);
            return Task.CompletedTask;
        }
    }
}
