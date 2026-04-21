using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertHistoryServiceTests
{
    [Fact]
    public async Task CaptureSnapshotAsync_WritesActivatedAndResolvedEvents()
    {
        await using var db = CreateDbContext();
        var options = CreateOptions();
        var service = new ProcessingAlertHistoryService(db, options);
        var now = DateTimeOffset.UtcNow;

        var firstSnapshot = new ProcessingAlertsResponse
        {
            GeneratedAt = now,
            IsHealthy = false,
            Alerts =
            [
                new ProcessingAlertItem
                {
                    Code = "stale_processing_jobs",
                    Severity = "critical",
                    Message = "lease expired",
                    Count = 2,
                    Samples = ["job:10", "job:11"],
                }
            ],
        };

        var createdOnActivation = await service.CaptureSnapshotAsync(firstSnapshot);
        var afterActivation = await service.GetRecentEventsAsync();

        Assert.Equal(1, createdOnActivation);
        Assert.Single(afterActivation);
        Assert.Equal("activated", afterActivation[0].EventType);
        Assert.Equal("pending", afterActivation[0].NotificationStatus);

        var secondSnapshot = new ProcessingAlertsResponse
        {
            GeneratedAt = now.AddMinutes(1),
            IsHealthy = true,
            Alerts = [],
        };

        var createdOnResolution = await service.CaptureSnapshotAsync(secondSnapshot);
        var afterResolution = await service.GetRecentEventsAsync();

        Assert.Equal(1, createdOnResolution);
        Assert.Equal(2, afterResolution.Count);
        Assert.Equal("resolved", afterResolution[0].EventType);
        Assert.Equal("stale_processing_jobs", afterResolution[0].AlertCode);
        Assert.Equal("pending", afterResolution[0].NotificationStatus);
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
            ProcessingAlertHistoryItemLimit = 30,
        };
}
