using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertNotificationPolicyServiceTests
{
    [Fact]
    public void ShouldNotify_ReturnsTrue_WhenSeverityAndEventTypeMatchPolicy()
    {
        var options = CreateOptions();
        var service = new ProcessingAlertNotificationPolicyService(options);

        var result = service.ShouldNotify(new ProcessingAlertEvent
        {
            EventType = "activated",
            Severity = "critical",
        });

        Assert.True(result);
    }

    [Fact]
    public void ShouldNotify_ReturnsFalse_WhenSeverityIsBelowMinimum()
    {
        var options = CreateOptions();
        var service = new ProcessingAlertNotificationPolicyService(options);

        var result = service.ShouldNotify(new ProcessingAlertEvent
        {
            EventType = "activated",
            Severity = "info",
        });

        Assert.False(result);
    }

    [Fact]
    public void ShouldNotify_ReturnsFalse_WhenEventTypeIsNotIncluded()
    {
        var options = CreateOptions();
        var service = new ProcessingAlertNotificationPolicyService(options);

        var result = service.ShouldNotify(new ProcessingAlertEvent
        {
            EventType = "severity_changed",
            Severity = "critical",
        });

        Assert.False(result);
    }

    private static AppOptions CreateOptions() =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingAlertNotifierMinimumSeverity = "warning",
            ProcessingAlertNotifierEventTypes = ["activated", "resolved"],
        };
}
