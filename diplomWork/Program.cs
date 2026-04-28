using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Middleware;
using DiplomWork.Services;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.OpenApi.Models;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

var appOptions = AppOptions.FromConfiguration(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(appOptions);
builder.Services.Configure<HostOptions>(options =>
{
    options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore;
});

builder.Logging.AddSimpleConsole(options =>
{
    options.SingleLine = false;
    options.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(appOptions.DatabaseUrl));

builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "API DiplomWork",
        Version = "v1",
        Description = "API для загрузки графиков, извлечения данных, редактирования результатов, экспорта и работы с кубическими сплайнами.",
    });
    options.SupportNonNullableReferenceTypes();
    options.OrderActionsBy(api => $"{api.ActionDescriptor.RouteValues["controller"]}_{api.RelativePath}");
    options.TagActionsBy(api =>
    {
        var endpointTags = api.ActionDescriptor.EndpointMetadata
            .OfType<ITagsMetadata>()
            .SelectMany(metadata => metadata.Tags)
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (endpointTags.Length > 0)
        {
            return endpointTags;
        }

        var controller = api.ActionDescriptor.RouteValues.TryGetValue("controller", out var controllerName)
            ? controllerName
            : null;
        return controller switch
        {
            "Auth" => ["Аутентификация"],
            "AdminUsers" => ["Администрирование пользователей"],
            "Charts" => ["Графики"],
            _ => [controller ?? "API"],
        };
    });
    options.MapType<JsonObject>(() => new OpenApiSchema
    {
        Type = "object",
        AdditionalPropertiesAllowed = true,
    });
    options.MapType<JsonNode>(() => new OpenApiSchema
    {
        Type = "object",
        AdditionalPropertiesAllowed = true,
    });

    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath, includeControllerXmlComments: true);
    }
});
builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
    options.AddPolicy("default", policy =>
    {
        policy
            .WithOrigins(appOptions.CorsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddScoped<PasswordService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<CurrentUserService>();
builder.Services.AddScoped<AdminAccessService>();
builder.Services.AddScoped<AdminUserService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ChartStorageService>();
builder.Services.AddSingleton<SplineService>();
builder.Services.AddSingleton<CubicSelectionService>();
builder.Services.AddSingleton<ChartEditorService>();
builder.Services.AddSingleton<ExportService>();
builder.Services.AddSingleton<EditorOverlayService>();
builder.Services.AddScoped<DatabaseInitializationService>();
builder.Services.AddScoped<ProcessingJobStateService>();
builder.Services.AddScoped<ProcessingAlertsService>();
builder.Services.AddScoped<ProcessingMetricsService>();
builder.Services.AddScoped<ProcessingDiagnosticsService>();
builder.Services.AddScoped<ProcessingOverviewService>();
builder.Services.AddSingleton<ProcessingDashboardPageService>();
builder.Services.AddSingleton<MqttPublisherService>();
builder.Services.AddHostedService<MqttOutboxDispatcherService>();
builder.Services.AddHostedService<MqttProcessingConsumerService>();
builder.Services.AddHostedService<ProcessingLeaseMonitorService>();
builder.Services.AddScoped<ChartApiService>();

var app = builder.Build();
var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");

AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
{
    if (eventArgs.ExceptionObject is Exception exception)
    {
        startupLogger.LogCritical(exception, "Unhandled exception reached AppDomain.");
    }
    else
    {
        startupLogger.LogCritical("Unhandled non-exception object reached AppDomain: {ExceptionObject}", eventArgs.ExceptionObject);
    }
};

TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
{
    startupLogger.LogCritical(eventArgs.Exception, "Unobserved task exception.");
    eventArgs.SetObserved();
};

Directory.CreateDirectory(appOptions.StorageDir);

using (var scope = app.Services.CreateScope())
{
    var initializer = scope.ServiceProvider.GetRequiredService<DatabaseInitializationService>();
    await initializer.InitializeAsync();
}

app.UseMiddleware<ApiExceptionMiddleware>();
app.UseCors("default");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.DocumentTitle = "API DiplomWork";
        options.DefaultModelsExpandDepth(-1);
        options.DisplayRequestDuration();
        options.EnableFilter();
        options.DocExpansion(Swashbuckle.AspNetCore.SwaggerUI.DocExpansion.List);
    });
}

app.MapGet("/health", () => Results.Json(new { status = "ok" })).WithTags("Прочее");
app.MapGet("/metrics/processing/alerts", async (ProcessingAlertsService alertsService, CancellationToken cancellationToken) =>
    Results.Json(await alertsService.GetSnapshotAsync(cancellationToken))).WithTags("Прочее");
app.MapGet("/metrics/processing", async (ProcessingMetricsService metricsService, CancellationToken cancellationToken) =>
    Results.Json(await metricsService.GetSnapshotAsync(cancellationToken))).WithTags("Прочее");
app.MapGet("/admin/processing/overview", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingOverviewService overviewService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await overviewService.GetSnapshotAsync(cancellationToken));
}).WithTags("Прочее");
app.MapGet("/admin/processing/diagnostics", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingDiagnosticsService diagnosticsService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await diagnosticsService.GetSnapshotAsync(cancellationToken));
}).WithTags("Прочее");
app.MapGet("/admin/processing/dashboard", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingDashboardPageService dashboardPageService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Content(dashboardPageService.Render(), "text/html; charset=utf-8");
}).WithTags("Прочее");
app.MapControllers();

app.Run();
