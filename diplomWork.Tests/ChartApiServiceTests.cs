using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ChartApiServiceTests
{
    [Fact]
    public async Task UploadAndEnqueueAsync_WithMqttEnabled_CreatesProcessingJobAndOutboxMessage()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: true);
        await using var input = CreateUploadStream("image-bytes");
        var upload = CreateFormFile(input, "plot.png", "image/png");

        var response = await harness.Service.UploadAndEnqueueAsync(userId: 7, upload);

        var chart = await harness.Db.Charts.SingleAsync();
        var processingJob = await harness.Db.ProcessingJobs.SingleAsync();
        var outboxMessage = await harness.Db.MqttMessages.SingleAsync(item => item.Direction == "out");

        Assert.Equal(chart.Id, response.Id);
        Assert.Equal("uploaded", chart.Status);
        Assert.Equal("queued", processingJob.Status);
        Assert.Equal("out", outboxMessage.Direction);
        Assert.Equal("pending", outboxMessage.Status);
        Assert.Equal(processingJob.Id, outboxMessage.ProcessingJobId);
        Assert.Equal(harness.Options.MqttProcessRequestTopic, outboxMessage.Topic);
        Assert.True(File.Exists(chart.OriginalPath));

        var requestPayload = ParseJson(processingJob.RequestPayload);
        Assert.Equal(chart.Id, requestPayload["chartId"]!.GetValue<int>());
        Assert.Equal(processingJob.Id, requestPayload["jobId"]!.GetValue<long>());
        Assert.Equal(chart.OriginalPath, requestPayload["originalPath"]!.GetValue<string>());

        var outboxPayload = ParseJson(outboxMessage.Payload);
        Assert.Equal(processingJob.MessageId, outboxPayload["messageId"]!.GetValue<string>());
        Assert.Equal(processingJob.Id, outboxPayload["jobId"]!.GetValue<long>());
    }

    [Fact]
    public async Task UploadAndEnqueueAsync_WithMqttDisabled_CreatesProcessingJobWithoutOutboxMessage()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: false);
        await using var input = CreateUploadStream("image-bytes");
        var upload = CreateFormFile(input, "plot.png", "image/png");

        var response = await harness.Service.UploadAndEnqueueAsync(userId: 11, upload);

        var chart = await harness.Db.Charts.SingleAsync();
        var processingJob = await harness.Db.ProcessingJobs.SingleAsync();

        Assert.Equal(chart.Id, response.Id);
        Assert.Equal("uploaded", chart.Status);
        Assert.Equal("queued", processingJob.Status);
        Assert.Empty(await harness.Db.MqttMessages.Where(item => item.Direction == "out").ToListAsync());
        Assert.True(File.Exists(chart.OriginalPath));
    }

    private static MemoryStream CreateUploadStream(string content) =>
        new(Encoding.UTF8.GetBytes(content));

    private static FormFile CreateFormFile(Stream stream, string fileName, string contentType)
    {
        return new FormFile(stream, 0, stream.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType,
        };
    }

    private static JsonObject ParseJson(System.Text.Json.JsonDocument? document) =>
        JsonNode.Parse(document!.RootElement.GetRawText())!.AsObject();

    private sealed class ChartApiServiceHarness : IDisposable
    {
        private readonly string _root;

        public ChartApiServiceHarness(bool mqttEnabled)
        {
            _root = Path.Combine(Path.GetTempPath(), "diplomWork-tests", Guid.NewGuid().ToString("N"));
            var storageDir = Path.Combine(_root, "storage");
            var workerRunsRoot = Path.Combine(_root, "worker-runs");
            Directory.CreateDirectory(storageDir);
            Directory.CreateDirectory(workerRunsRoot);

            Options = new AppOptions
            {
                DatabaseUrl = "Host=localhost;Database=test;",
                JwtSecretKey = "test-secret",
                StorageDir = storageDir,
                WorkerRunsRoot = workerRunsRoot,
                MqttEnabled = mqttEnabled,
                MqttProcessRequestTopic = "charts/process/request",
            };

            var dbOptions = new DbContextOptionsBuilder<TestAppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                .Options;

            Db = new TestAppDbContext(dbOptions);

            var storageService = new ChartStorageService(Options);
            var splineService = new SplineService();
            var chartEditorService = new ChartEditorService(splineService);
            var cubicSelectionService = new CubicSelectionService();
            var exportService = new ExportService();
            var editorOverlayService = new EditorOverlayService(Options);

            Service = new ChartApiService(
                Db,
                Options,
                storageService,
                chartEditorService,
                cubicSelectionService,
                exportService,
                editorOverlayService);
        }

        public AppOptions Options { get; }

        public TestAppDbContext Db { get; }

        public ChartApiService Service { get; }

        public void Dispose()
        {
            Db.Dispose();
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
    }
}
