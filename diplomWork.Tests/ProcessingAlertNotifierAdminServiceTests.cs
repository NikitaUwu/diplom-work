using DiplomWork.Configuration;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertNotifierAdminServiceTests
{
    [Fact]
    public async Task GetStatusAsync_AggregatesNotifierState()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;

        db.ProcessingAlertEvents.AddRange(
            new ProcessingAlertEvent
            {
                AlertCode = "a",
                EventType = "activated",
                Severity = "critical",
                Message = "msg",
                Count = 1,
                NotificationStatus = "pending",
                NotificationNextAttemptAt = now.AddMinutes(-1),
                CreatedAt = now.AddMinutes(-5),
            },
            new ProcessingAlertEvent
            {
                AlertCode = "b",
                EventType = "resolved",
                Severity = "warning",
                Message = "msg",
                Count = 1,
                NotificationStatus = "error",
                NotificationNextAttemptAt = now.AddMinutes(-1),
                CreatedAt = now.AddMinutes(-4),
            },
            new ProcessingAlertEvent
            {
                AlertCode = "c",
                EventType = "activated",
                Severity = "info",
                Message = "msg",
                Count = 1,
                NotificationStatus = "sent",
                CreatedAt = now.AddMinutes(-3),
            },
            new ProcessingAlertEvent
            {
                AlertCode = "d",
                EventType = "activated",
                Severity = "info",
                Message = "msg",
                Count = 1,
                NotificationStatus = "suppressed",
                CreatedAt = now.AddMinutes(-2),
            });

        await db.SaveChangesAsync();

        var options = CreateOptions();
        var service = new ProcessingAlertNotifierAdminService(
            db,
            options,
            new ProcessingAlertNotificationPolicyService(options),
            CreateSender(options));

        var snapshot = await service.GetStatusAsync();

        Assert.True(snapshot.Enabled);
        Assert.True(snapshot.WebhookConfigured);
        Assert.Equal("json", snapshot.WebhookFormat);
        Assert.Equal(1, snapshot.PendingCount);
        Assert.Equal(1, snapshot.ErrorCount);
        Assert.Equal(1, snapshot.SentCount);
        Assert.Equal(1, snapshot.SuppressedCount);
        Assert.Equal(2, snapshot.ReadyToDispatchCount);
    }

    [Fact]
    public async Task GetPreviewAsync_ReturnsCanonicalAndWebhookBodies()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;
        db.ProcessingAlertEvents.Add(new ProcessingAlertEvent
        {
            AlertCode = "stale_processing_jobs",
            EventType = "activated",
            Severity = "critical",
            Message = "lease expired",
            Count = 2,
            SamplesText = "job:1\njob:2",
            NotificationStatus = "pending",
            CreatedAt = now,
        });
        await db.SaveChangesAsync();

        var baseOptions = CreateOptions();
        var options = new AppOptions
        {
            DatabaseUrl = baseOptions.DatabaseUrl,
            JwtSecretKey = baseOptions.JwtSecretKey,
            StorageDir = baseOptions.StorageDir,
            WorkerRunsRoot = baseOptions.WorkerRunsRoot,
            ProcessingAlertNotifierSourceName = baseOptions.ProcessingAlertNotifierSourceName,
            ProcessingAlertNotifierWebhookUrl = baseOptions.ProcessingAlertNotifierWebhookUrl,
            ProcessingAlertNotifierLogEnabled = baseOptions.ProcessingAlertNotifierLogEnabled,
            ProcessingAlertNotifierWebhookFormat = "slack",
            ProcessingAlertNotifierMinimumSeverity = baseOptions.ProcessingAlertNotifierMinimumSeverity,
            ProcessingAlertNotifierEventTypes = baseOptions.ProcessingAlertNotifierEventTypes,
            ProcessingAlertNotifierEnabled = baseOptions.ProcessingAlertNotifierEnabled,
            ProcessingAlertNotifierBatchSize = baseOptions.ProcessingAlertNotifierBatchSize,
            ProcessingAlertNotifierIntervalSeconds = baseOptions.ProcessingAlertNotifierIntervalSeconds,
            ProcessingAlertNotifierRetryDelaySeconds = baseOptions.ProcessingAlertNotifierRetryDelaySeconds,
        };

        var service = new ProcessingAlertNotifierAdminService(
            db,
            options,
            new ProcessingAlertNotificationPolicyService(options),
            CreateSender(options));

        var preview = await service.GetPreviewAsync((await db.ProcessingAlertEvents.SingleAsync()).Id);

        Assert.True(preview.ShouldNotify);
        Assert.Equal("slack", preview.WebhookFormat);
        Assert.Equal("stale_processing_jobs", preview.CanonicalPayload.AlertCode);
        Assert.True(preview.WebhookBody.TryGetProperty("text", out _));
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
            ProcessingAlertNotifierEnabled = true,
            ProcessingAlertNotifierSourceName = "diplomWork",
            ProcessingAlertNotifierWebhookUrl = "https://example.test/webhook",
            ProcessingAlertNotifierWebhookFormat = "json",
            ProcessingAlertNotifierLogEnabled = false,
            ProcessingAlertNotifierMinimumSeverity = "info",
            ProcessingAlertNotifierEventTypes = ["activated", "resolved", "severity_changed"],
            ProcessingAlertNotifierBatchSize = 10,
            ProcessingAlertNotifierIntervalSeconds = 15,
            ProcessingAlertNotifierRetryDelaySeconds = 60,
        };

    private static ProcessingAlertNotificationSender CreateSender(AppOptions options) =>
        new(
            options,
            new FakeHttpClientFactory(new HttpClient(new NoopHandler())),
            new TestHostEnvironment(Environments.Development),
            NullLogger<ProcessingAlertNotificationSender>.Instance);

    private sealed class NoopHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK));
    }

    private sealed class FakeHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpClient _httpClient;

        public FakeHttpClientFactory(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public HttpClient CreateClient(string name) => _httpClient;
    }

    private sealed class TestHostEnvironment : IWebHostEnvironment
    {
        public TestHostEnvironment(string environmentName)
        {
            EnvironmentName = environmentName;
        }

        public string ApplicationName { get; set; } = "diplomWork.Tests";

        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();

        public string WebRootPath { get; set; } = AppContext.BaseDirectory;

        public string EnvironmentName { get; set; }

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
