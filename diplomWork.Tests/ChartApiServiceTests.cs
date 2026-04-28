using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
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
        Assert.False(Path.IsPathRooted(chart.OriginalPath));
        var (originalFilePath, originalMediaType) = harness.Service.ResolveChartFile(chart, "original");
        Assert.True(File.Exists(originalFilePath));
        Assert.Equal("image/png", originalMediaType);

        var requestPayload = ParseJson(processingJob.RequestPayload);
        Assert.Equal(chart.Id, requestPayload["chartId"]!.GetValue<int>());
        Assert.Equal(processingJob.Id, requestPayload["jobId"]!.GetValue<long>());
        Assert.Equal(chart.OriginalPath, requestPayload["originalPath"]!.GetValue<string>());
        Assert.True(requestPayload["lineformerUsePreprocessing"]!.GetValue<bool>());

        var outboxPayload = ParseJson(outboxMessage.Payload);
        Assert.Equal(processingJob.MessageId, outboxPayload["messageId"]!.GetValue<string>());
        Assert.Equal(processingJob.Id, outboxPayload["jobId"]!.GetValue<long>());
        Assert.True(outboxPayload["lineformerUsePreprocessing"]!.GetValue<bool>());
    }

    [Fact]
    public async Task UploadAndEnqueueAsync_CanDisableLineFormerPreprocessing()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: true);
        await using var input = CreateUploadStream("image-bytes");
        var upload = CreateFormFile(input, "plot.png", "image/png");

        await harness.Service.UploadAndEnqueueAsync(
            userId: 7,
            upload,
            lineformerUsePreprocessing: false);

        var processingJob = await harness.Db.ProcessingJobs.SingleAsync();
        var outboxMessage = await harness.Db.MqttMessages.SingleAsync(item => item.Direction == "out");
        var requestPayload = ParseJson(processingJob.RequestPayload);
        var outboxPayload = ParseJson(outboxMessage.Payload);

        Assert.False(requestPayload["lineformerUsePreprocessing"]!.GetValue<bool>());
        Assert.False(outboxPayload["lineformerUsePreprocessing"]!.GetValue<bool>());
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
        Assert.False(Path.IsPathRooted(chart.OriginalPath));
        var (originalFilePath, originalMediaType) = harness.Service.ResolveChartFile(chart, "original");
        Assert.True(File.Exists(originalFilePath));
        Assert.Equal("image/png", originalMediaType);
    }

    [Fact]
    public void BuildSplineCurvePointsResponse_ReturnsStructuredCurvePoints()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: false);
        var resultJson = new JsonObject
        {
            ["panels"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = "panel_0",
                    ["x_unit"] = "s",
                    ["y_unit"] = "V",
                    ["series"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["id"] = "series_0",
                            ["name"] = "Series 0",
                            ["points"] = new JsonArray
                            {
                                new JsonArray(0, 0),
                                new JsonArray(1, 1),
                                new JsonArray(2, 0),
                                new JsonArray(3, 1),
                            },
                        },
                    },
                },
            },
        };

        var response = harness.Service.BuildSplineCurvePointsResponse(
            chartId: 42,
            baseResultJson: resultJson,
            controlPointMode: SplineControlPointMode.selected,
            totalControlPoints: 3,
            samplesPerSeries: 25);

        Assert.Equal(42, response.ChartId);
        Assert.Equal(SplineControlPointMode.selected, response.ControlPointMode);
        var panel = Assert.Single(response.Panels);
        Assert.Equal("panel_0", panel.Id);
        var series = Assert.Single(panel.Series);
        Assert.Equal("series_0", series.Id);
        Assert.Equal("cubic_spline", series.ApproximationMethod);
        Assert.Equal(3, series.ControlPoints.Count);
    }

    [Fact]
    public void BuildSplineCurvePointsResponse_WithPersistedResultJson_WorksWithoutRequestPayloadJson()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: false);
        var persistedResultJson = new JsonObject
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
                                new JsonArray(2, 0),
                            },
                        },
                    },
                },
            },
        };

        var response = harness.Service.BuildSplineCurvePointsResponse(
            chartId: 7,
            baseResultJson: persistedResultJson,
            controlPointMode: SplineControlPointMode.original,
            totalControlPoints: null,
            samplesPerSeries: 20);

        var panel = Assert.Single(response.Panels);
        var series = Assert.Single(panel.Series);
        Assert.Equal(3, series.ControlPoints.Count);
    }

    [Fact]
    public void TryBuildStoredAutoSplineCurvePointsResponse_UsesPersistedAutoSplinePoints()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: false);
        var persistedResultJson = new JsonObject
        {
            ["panels"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = "panel_0",
                    ["x_unit"] = "s",
                    ["y_unit"] = "V",
                    ["series"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["id"] = "series_0",
                            ["name"] = "Series 0",
                            ["points"] = new JsonArray
                            {
                                new JsonArray(0, 0),
                                new JsonArray(1, 1),
                                new JsonArray(2, 0),
                                new JsonArray(3, 1),
                            },
                        },
                    },
                },
            },
            ["auto_spline"] = new JsonObject
            {
                ["selected_point_count"] = 3,
                ["panels"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["id"] = "panel_0",
                        ["series"] = new JsonArray
                        {
                            new JsonObject
                            {
                                ["id"] = "series_0_spline",
                                ["source_series_id"] = "series_0",
                                ["source_name"] = "Series 0",
                                ["points"] = new JsonArray
                                {
                                    new JsonArray(0, 0),
                                    new JsonArray(2, 0),
                                    new JsonArray(3, 1),
                                },
                                ["curve_points"] = new JsonArray
                                {
                                    new JsonArray(0, 0),
                                    new JsonArray(1.5, 0.5),
                                    new JsonArray(3, 1),
                                },
                            },
                        },
                    },
                },
            },
        };

        var response = harness.Service.TryBuildStoredAutoSplineCurvePointsResponse(
            chartId: 42,
            persistedResultJson: persistedResultJson,
            requestedTotalControlPoints: null,
            samplesPerSeries: 3);

        Assert.NotNull(response);
        Assert.Equal(SplineControlPointMode.auto, response!.ControlPointMode);
        var panel = Assert.Single(response.Panels);
        Assert.Equal("s", panel.XUnit);
        var series = Assert.Single(panel.Series);
        Assert.Equal("series_0", series.Id);
        Assert.Equal(3, series.ControlPoints.Count);
    }

    [Fact]
    public void TryBuildStoredAutoSplineCurvePointsResponse_ReturnsNull_WhenRequestedPointCountDiffersFromStoredSelection()
    {
        using var harness = new ChartApiServiceHarness(mqttEnabled: false);
        var persistedResultJson = new JsonObject
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
                                new JsonArray(2, 0),
                            },
                        },
                    },
                },
            },
            ["auto_spline"] = new JsonObject
            {
                ["selected_point_count"] = 3,
                ["panels"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["id"] = "panel_0",
                        ["series"] = new JsonArray
                        {
                            new JsonObject
                            {
                                ["id"] = "series_0_spline",
                                ["source_series_id"] = "series_0",
                                ["points"] = new JsonArray
                                {
                                    new JsonArray(0, 0),
                                    new JsonArray(1, 1),
                                    new JsonArray(2, 0),
                                },
                            },
                        },
                    },
                },
            },
        };

        var response = harness.Service.TryBuildStoredAutoSplineCurvePointsResponse(
            chartId: 7,
            persistedResultJson: persistedResultJson,
            requestedTotalControlPoints: 5,
            samplesPerSeries: 10);

        Assert.Null(response);
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
                splineService,
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
