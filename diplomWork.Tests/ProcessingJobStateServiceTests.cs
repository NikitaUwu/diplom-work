using System.Text.Json;
using System.Text.Json.Nodes;
using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingJobStateServiceTests
{
    [Fact]
    public async Task ApplyAcceptedAsync_SetsProcessingLeaseAndChartStatus()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "uploaded");
        var job = await SeedJobAsync(db, chart.Id, status: "queued", messageId: "request-1");
        var service = CreateService(db, leaseSeconds: 45);

        var payload = new ProcessingEventPayload
        {
            MessageId = "accepted-1",
            RequestMessageId = "request-1",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
        };

        var applied = await service.ApplyAcceptedAsync(
            "charts/process/accepted",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();

        Assert.True(applied);
        Assert.Equal("processing", actualJob.Status);
        Assert.Equal(1, actualJob.Attempt);
        Assert.Equal("worker-a", actualJob.WorkerId);
        Assert.NotNull(actualJob.StartedAt);
        Assert.NotNull(actualJob.LastHeartbeatAt);
        Assert.NotNull(actualJob.LeasedUntil);
        Assert.True(actualJob.LeasedUntil > actualJob.LastHeartbeatAt);
        Assert.Null(actualJob.NextRetryAt);
        Assert.Equal("processing", actualChart.Status);
        Assert.Null(actualChart.ErrorMessage);
        Assert.Single(db.InboxMessages);
    }

    [Fact]
    public async Task ApplyHeartbeatAsync_ExtendsLeaseForProcessingJob()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var now = DateTimeOffset.UtcNow;
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-2",
            workerId: "worker-a",
            attempt: 1,
            startedAt: now.AddMinutes(-2),
            lastHeartbeatAt: now.AddSeconds(-20),
            leasedUntil: now.AddSeconds(-5));
        var previousHeartbeat = job.LastHeartbeatAt;
        var previousLease = job.LeasedUntil;
        var service = CreateService(db, leaseSeconds: 60);

        var payload = new ProcessingEventPayload
        {
            MessageId = "heartbeat-1",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-b",
        };

        var applied = await service.ApplyHeartbeatAsync(payload, CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        Assert.True(applied);
        Assert.Equal("worker-b", actualJob.WorkerId);
        Assert.NotNull(actualJob.LastHeartbeatAt);
        Assert.NotNull(actualJob.LeasedUntil);
        Assert.NotNull(previousHeartbeat);
        Assert.NotNull(previousLease);
        Assert.True(actualJob.LastHeartbeatAt!.Value > previousHeartbeat!.Value);
        Assert.True(actualJob.LeasedUntil!.Value > previousLease!.Value);
        Assert.Empty(await db.InboxMessages.ToListAsync());
    }

    [Fact]
    public async Task ApplyCompletedAsync_ClearsLeaseAndMarksChartDone()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-3",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddSeconds(-10),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(30));
        var service = CreateService(db, leaseSeconds: 45);

        var resultJson = new JsonObject
        {
            ["panels"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = "panel_0",
                    ["series"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["id"] = "series_0",
                            ["points"] = new JsonArray
                            {
                                new JsonArray(0, 0),
                                new JsonArray(1, 1),
                            },
                        },
                    },
                },
            },
        };

        var payload = new ProcessingEventPayload
        {
            MessageId = "completed-1",
            RequestMessageId = "request-3",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            ResultJson = resultJson,
            NPanels = 1,
            NSeries = 1,
        };

        var applied = await service.ApplyCompletedAsync(
            "charts/process/completed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();

        Assert.True(applied);
        Assert.Equal("done", actualJob.Status);
        Assert.NotNull(actualJob.FinishedAt);
        Assert.Null(actualJob.LeasedUntil);
        Assert.NotNull(actualJob.ResultPayload);
        Assert.Equal("done", actualChart.Status);
        Assert.NotNull(actualChart.ProcessedAt);
        Assert.Equal(1, actualChart.NPanels);
        Assert.Equal(1, actualChart.NSeries);
        Assert.NotNull(actualChart.ResultJson);
        Assert.Single(db.InboxMessages);
    }

    [Fact]
    public async Task ExpireTimedOutJobsAsync_MarksTimedOutJobAndChartAsError()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-4",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-5),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddMinutes(-3),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(-1));
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 1, retryDelaySeconds: 15);

        var expired = await service.ExpireTimedOutJobsAsync(CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();

        Assert.Equal(1, expired);
        Assert.Equal("error", actualJob.Status);
        Assert.Equal("Processing lease expired after 1 attempt(s)", actualJob.ErrorMessage);
        Assert.Null(actualJob.LeasedUntil);
        Assert.NotNull(actualJob.FinishedAt);
        Assert.Equal("error", actualChart.Status);
        Assert.Equal("Processing lease expired after 1 attempt(s)", actualChart.ErrorMessage);
        Assert.NotNull(actualChart.ProcessedAt);
    }

    [Fact]
    public async Task ExpireTimedOutJobsAsync_RequeuesTimedOutJob_WhenAttemptsRemain()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-5",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-5),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddMinutes(-3),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(-1));
        var oldMessageId = job.MessageId;
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 20);

        var processed = await service.ExpireTimedOutJobsAsync(CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();
        var outbox = await db.OutboxMessages.SingleAsync();

        Assert.Equal(1, processed);
        Assert.Equal("queued", actualJob.Status);
        Assert.NotEqual(oldMessageId, actualJob.MessageId);
        Assert.Null(actualJob.WorkerId);
        Assert.Null(actualJob.StartedAt);
        Assert.Null(actualJob.LeasedUntil);
        Assert.Null(actualJob.LastHeartbeatAt);
        Assert.NotNull(actualJob.NextRetryAt);
        Assert.Contains("retry scheduled", actualJob.ErrorMessage);
        Assert.Equal("processing", actualChart.Status);
        Assert.Null(actualChart.ErrorMessage);
        Assert.Null(actualChart.ProcessedAt);
        Assert.Equal("pending", outbox.Status);
        Assert.Equal(actualJob.Id, outbox.ProcessingJobId);
        Assert.Equal(actualJob.MessageId, outbox.MessageId);
        Assert.NotNull(outbox.AvailableAt);
    }

    [Fact]
    public async Task ApplyCompletedAsync_IgnoresStaleAttemptPayload()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "queued",
            messageId: "request-new",
            attempt: 1,
            startedAt: null,
            leasedUntil: null,
            nextRetryAt: DateTimeOffset.UtcNow.AddSeconds(15));
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 15);

        var payload = new ProcessingEventPayload
        {
            MessageId = "completed-stale-1",
            RequestMessageId = "request-old",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            ResultJson = new JsonObject
            {
                ["panels"] = new JsonArray(),
            },
        };

        var applied = await service.ApplyCompletedAsync(
            "charts/process/completed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();

        Assert.True(applied);
        Assert.Equal("queued", actualJob.Status);
        Assert.Equal("request-new", actualJob.MessageId);
        Assert.Null(actualChart.ResultJson);
        Assert.Equal("processing", actualChart.Status);
        Assert.Single(db.InboxMessages);
    }

    [Fact]
    public async Task ApplyFailedAsync_RequeuesRetryableWorkerFailure_WhenAttemptsRemain()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-6",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddSeconds(-10),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(30));
        var oldMessageId = job.MessageId;
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 25);

        var payload = new ProcessingEventPayload
        {
            MessageId = "failed-1",
            RequestMessageId = "request-6",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            ErrorCode = "modal_backend_unavailable",
            Retryable = true,
            ErrorMessage = "Modal backend timeout",
        };

        var applied = await service.ApplyFailedAsync(
            "charts/process/failed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();
        var outbox = await db.OutboxMessages.SingleAsync();

        Assert.True(applied);
        Assert.Equal("queued", actualJob.Status);
        Assert.NotEqual(oldMessageId, actualJob.MessageId);
        Assert.Equal("modal_backend_unavailable", actualJob.ErrorCode);
        Assert.Contains("retry scheduled", actualJob.ErrorMessage);
        Assert.NotNull(actualJob.NextRetryAt);
        Assert.Null(actualJob.LeasedUntil);
        Assert.Null(actualJob.LastHeartbeatAt);
        Assert.Null(actualJob.WorkerId);
        Assert.Equal("processing", actualChart.Status);
        Assert.Null(actualChart.ErrorMessage);
        Assert.Equal("pending", outbox.Status);
        Assert.Equal(actualJob.MessageId, outbox.MessageId);
        Assert.Single(db.InboxMessages);
    }

    [Fact]
    public async Task ApplyFailedAsync_MarksTerminalError_ForNonRetryableWorkerFailure()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-7",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddSeconds(-10),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(30));
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 25);

        var payload = new ProcessingEventPayload
        {
            MessageId = "failed-2",
            RequestMessageId = "request-7",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            ErrorCode = "pipeline_output_invalid",
            Retryable = false,
            ErrorMessage = "No series_* points found in data.json",
        };

        var applied = await service.ApplyFailedAsync(
            "charts/process/failed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        var actualChart = await db.Charts.SingleAsync();

        Assert.True(applied);
        Assert.Equal("error", actualJob.Status);
        Assert.Equal("pipeline_output_invalid", actualJob.ErrorCode);
        Assert.Equal("No series_* points found in data.json", actualJob.ErrorMessage);
        Assert.Null(actualJob.NextRetryAt);
        Assert.Equal("error", actualChart.Status);
        Assert.Equal("No series_* points found in data.json", actualChart.ErrorMessage);
        Assert.Empty(await db.OutboxMessages.ToListAsync());
        Assert.Single(db.InboxMessages);
    }

    [Fact]
    public async Task ApplyFailedAsync_DoesNotRetryTerminalErrorCode_EvenIfMessageLooksTransient()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-8",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddSeconds(-10),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(30));
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 25);

        var payload = new ProcessingEventPayload
        {
            MessageId = "failed-3",
            RequestMessageId = "request-8",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            ErrorCode = "unexpected_worker_error",
            ErrorMessage = "Timeout while parsing result payload",
        };

        var applied = await service.ApplyFailedAsync(
            "charts/process/failed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        Assert.True(applied);
        Assert.Equal("error", actualJob.Status);
        Assert.Equal("unexpected_worker_error", actualJob.ErrorCode);
        Assert.Empty(await db.OutboxMessages.ToListAsync());
    }

    [Fact]
    public async Task ApplyFailedAsync_UsesRetryableFlagAsCompatibilityFallback_WhenCodeMissing()
    {
        await using var db = CreateDbContext();
        var chart = await SeedChartAsync(db, status: "processing");
        var job = await SeedJobAsync(
            db,
            chart.Id,
            status: "processing",
            messageId: "request-9",
            workerId: "worker-a",
            attempt: 1,
            startedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            lastHeartbeatAt: DateTimeOffset.UtcNow.AddSeconds(-10),
            leasedUntil: DateTimeOffset.UtcNow.AddSeconds(30));
        var oldMessageId = job.MessageId;
        var service = CreateService(db, leaseSeconds: 45, maxAttempts: 3, retryDelaySeconds: 25);

        var payload = new ProcessingEventPayload
        {
            MessageId = "failed-4",
            RequestMessageId = "request-9",
            JobId = job.Id,
            ChartId = chart.Id,
            WorkerId = "worker-a",
            Retryable = true,
            ErrorMessage = "Legacy worker failure payload",
        };

        var applied = await service.ApplyFailedAsync(
            "charts/process/failed",
            payload,
            ToJsonNode(payload),
            CancellationToken.None);

        var actualJob = await db.ProcessingJobs.SingleAsync();
        Assert.True(applied);
        Assert.Equal("queued", actualJob.Status);
        Assert.NotEqual(oldMessageId, actualJob.MessageId);
        Assert.Equal("unexpected_worker_error", actualJob.ErrorCode);
        Assert.Single(await db.OutboxMessages.ToListAsync());
    }

    private static ProcessingJobStateService CreateService(
        TestAppDbContext db,
        int leaseSeconds,
        int maxAttempts = 3,
        int retryDelaySeconds = 15)
    {
        var options = new AppOptions
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingLeaseSeconds = leaseSeconds,
            ProcessingMaxAttempts = maxAttempts,
            ProcessingRetryDelaySeconds = retryDelaySeconds,
            MqttProcessRequestTopic = "charts/process/request",
        };

        return new ProcessingJobStateService(db, options, NullLogger<ProcessingJobStateService>.Instance);
    }

    private static TestAppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TestAppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new TestAppDbContext(options);
    }

    private static async Task<Chart> SeedChartAsync(TestAppDbContext db, string status)
    {
        var chart = new Chart
        {
            UserId = 1,
            OriginalFilename = "plot.png",
            MimeType = "image/png",
            Sha256 = Guid.NewGuid().ToString("N").PadRight(64, '0')[..64],
            OriginalPath = "C:\\temp\\plot.png",
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Charts.Add(chart);
        await db.SaveChangesAsync();
        return chart;
    }

    private static async Task<ProcessingJob> SeedJobAsync(
        TestAppDbContext db,
        int chartId,
        string status,
        string messageId,
        string? workerId = null,
        int attempt = 0,
        DateTimeOffset? startedAt = null,
        DateTimeOffset? lastHeartbeatAt = null,
        DateTimeOffset? leasedUntil = null,
        DateTimeOffset? nextRetryAt = null)
    {
        var job = new ProcessingJob
        {
            ChartId = chartId,
            Status = status,
            MessageId = messageId,
            WorkerId = workerId,
            Attempt = attempt,
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-10),
            StartedAt = startedAt,
            LastHeartbeatAt = lastHeartbeatAt,
            LeasedUntil = leasedUntil,
            NextRetryAt = nextRetryAt,
            RequestPayload = JsonDocument.Parse(
                $$"""
                {
                  "schemaVersion": 1,
                  "messageId": "{{messageId}}",
                  "chartId": {{chartId}}
                }
                """),
        };

        db.ProcessingJobs.Add(job);
        await db.SaveChangesAsync();
        return job;
    }

    private static JsonNode ToJsonNode(ProcessingEventPayload payload) =>
        JsonNode.Parse(JsonSerializer.Serialize(payload))!;
}
