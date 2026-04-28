using DiplomWork.Controllers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.Swagger;
using Swashbuckle.AspNetCore.SwaggerGen;
using Xunit;

namespace DiplomWork.Tests;

public sealed class SwaggerGenerationTests
{
    [Fact]
    public void UploadEndpoint_GeneratesMultipartFormSwaggerDocument()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var environment = new TestWebHostEnvironment();
        services.AddSingleton<IHostEnvironment>(environment);
        services.AddSingleton<IWebHostEnvironment>(environment);
        var mvcBuilder = services.AddControllers();
        mvcBuilder.PartManager.ApplicationParts.Add(new AssemblyPart(typeof(ChartsController).Assembly));
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "diplomWork",
                Version = "v1",
            });
        });

        using var provider = services.BuildServiceProvider();
        var swaggerProvider = provider.GetRequiredService<ISwaggerProvider>();

        var document = swaggerProvider.GetSwagger("v1");
        var uploadPath = Assert.Single(document.Paths, item => item.Key == "/api/v1/charts");
        var operation = Assert.Single(uploadPath.Value.Operations, item => item.Key == OperationType.Post);

        Assert.True(operation.Value.RequestBody?.Content.ContainsKey("multipart/form-data"));
    }

    [Fact]
    public void PublicSplineEndpoints_AreVisible_AndLegacyRoutesAreHidden()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var environment = new TestWebHostEnvironment();
        services.AddSingleton<IHostEnvironment>(environment);
        services.AddSingleton<IWebHostEnvironment>(environment);
        var mvcBuilder = services.AddControllers();
        mvcBuilder.PartManager.ApplicationParts.Add(new AssemblyPart(typeof(ChartsController).Assembly));
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "diplomWork",
                Version = "v1",
            });
        });

        using var provider = services.BuildServiceProvider();
        var swaggerProvider = provider.GetRequiredService<ISwaggerProvider>();

        var document = swaggerProvider.GetSwagger("v1");
        Assert.Contains("/api/v1/charts/{chartId}/spline/preview", document.Paths.Keys);
        Assert.Contains("/api/v1/charts/{chartId}/spline/curve-points", document.Paths.Keys);
        var previewOperation = document.Paths["/api/v1/charts/{chartId}/spline/preview"].Operations[OperationType.Post];
        var curvePointsOperation = document.Paths["/api/v1/charts/{chartId}/spline/curve-points"].Operations[OperationType.Post];
        Assert.False(previewOperation.RequestBody?.Required ?? true);
        Assert.False(curvePointsOperation.RequestBody?.Required ?? true);
        Assert.DoesNotContain("/api/v1/charts/upload", document.Paths.Keys);
        Assert.DoesNotContain("/api/v1/charts/{chartId}/cubic-preview", document.Paths.Keys);
        Assert.DoesNotContain("/api/v1/charts/{chartId}/cubic-preview-random", document.Paths.Keys);
    }

    private sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = typeof(ChartsController).Assembly.GetName().Name ?? "diplomWork";

        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();

        public string WebRootPath { get; set; } = AppContext.BaseDirectory;

        public string EnvironmentName { get; set; } = Environments.Development;

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
