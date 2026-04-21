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
        var uploadPath = Assert.Single(document.Paths, item => item.Key == "/api/v1/charts/upload");
        var operation = Assert.Single(uploadPath.Value.Operations);

        Assert.True(operation.Value.RequestBody?.Content.ContainsKey("multipart/form-data"));
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
