using System.Net;
using System.Text;
using System.Text.Json;
using DiplomWork.Configuration;
using DiplomWork.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingAlertNotificationSenderTests
{
    [Fact]
    public async Task SendAsync_PostsStableWebhookPayload()
    {
        var handler = new RecordingHandler();
        var factory = new FakeHttpClientFactory(new HttpClient(handler));
        var service = new ProcessingAlertNotificationSender(
            CreateOptions(),
            factory,
            new TestHostEnvironment(Environments.Development),
            NullLogger<ProcessingAlertNotificationSender>.Instance);

        await service.SendAsync(new Models.ProcessingAlertEvent
        {
            Id = 42,
            AlertCode = "stale_processing_jobs",
            EventType = "activated",
            Severity = "critical",
            Message = "lease expired",
            Count = 2,
            SamplesText = "job:10\njob:11",
            CreatedAt = new DateTimeOffset(2026, 4, 14, 10, 0, 0, TimeSpan.Zero),
        });

        Assert.NotNull(handler.LastRequest);
        Assert.Equal("https://example.test/webhook", handler.LastRequest!.RequestUri!.ToString());

        var json = await handler.LastRequest.Content!.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal(42, root.GetProperty("eventId").GetInt64());
        Assert.Equal("diplomWork", root.GetProperty("source").GetString());
        Assert.Equal("Development", root.GetProperty("environment").GetString());
        Assert.Equal("stale_processing_jobs", root.GetProperty("alertCode").GetString());
        Assert.Equal("activated", root.GetProperty("eventType").GetString());
        Assert.Equal("critical", root.GetProperty("severity").GetString());
        Assert.Equal("lease expired", root.GetProperty("message").GetString());
        Assert.Equal(2, root.GetProperty("count").GetInt32());
        Assert.Equal(2, root.GetProperty("samples").GetArrayLength());
    }

    [Fact]
    public async Task SendAsync_PostsSlackCompatiblePayload_WhenSlackFormatIsEnabled()
    {
        var handler = new RecordingHandler();
        var factory = new FakeHttpClientFactory(new HttpClient(handler));
        var service = new ProcessingAlertNotificationSender(
            CreateOptions(slackFormat: true),
            factory,
            new TestHostEnvironment(Environments.Production),
            NullLogger<ProcessingAlertNotificationSender>.Instance);

        await service.SendAsync(new Models.ProcessingAlertEvent
        {
            Id = 99,
            AlertCode = "outbox_publish_errors",
            EventType = "resolved",
            Severity = "warning",
            Message = "publish recovered",
            Count = 1,
            SamplesText = "outbox:12",
            CreatedAt = new DateTimeOffset(2026, 4, 14, 11, 30, 0, TimeSpan.Zero),
        });

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.True(root.TryGetProperty("text", out var textElement));
        Assert.Contains("outbox_publish_errors", textElement.GetString());
        Assert.True(root.TryGetProperty("blocks", out var blocksElement));
        Assert.True(blocksElement.GetArrayLength() >= 3);
    }

    private static AppOptions CreateOptions(bool slackFormat = false) =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingAlertNotifierSourceName = "diplomWork",
            ProcessingAlertNotifierWebhookFormat = slackFormat ? "slack" : "json",
            ProcessingAlertNotifierWebhookUrl = "https://example.test/webhook",
            ProcessingAlertNotifierLogEnabled = false,
        };

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("ok", Encoding.UTF8, "text/plain"),
            });
        }
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
