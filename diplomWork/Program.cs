using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Middleware;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Text.Json;
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
builder.Services.AddSwaggerGen();
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
builder.Services.AddScoped<ProcessingAlertHistoryService>();
builder.Services.AddScoped<ProcessingAlertNotificationPolicyService>();
builder.Services.AddScoped<ProcessingAlertNotifierAdminService>();
builder.Services.AddScoped<ProcessingAlertNotificationDispatcherService>();
builder.Services.AddScoped<ProcessingMetricsService>();
builder.Services.AddScoped<ProcessingDiagnosticsService>();
builder.Services.AddScoped<ProcessingOverviewService>();
builder.Services.AddSingleton<ProcessingDashboardPageService>();
builder.Services.AddSingleton<ProcessingAlertNotificationSender>();
builder.Services.AddSingleton<IProcessingAlertNotificationSender>(serviceProvider =>
    serviceProvider.GetRequiredService<ProcessingAlertNotificationSender>());
builder.Services.AddSingleton<MqttPublisherService>();
builder.Services.AddHostedService<MqttOutboxDispatcherService>();
builder.Services.AddHostedService<MqttProcessingConsumerService>();
builder.Services.AddHostedService<ProcessingLeaseMonitorService>();
builder.Services.AddHostedService<ProcessingAlertMonitorService>();
builder.Services.AddHostedService<ProcessingAlertNotifierService>();
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
    app.UseSwaggerUI();
}

app.MapGet("/health", () => Results.Json(new { status = "ok" }));
app.MapGet("/metrics/processing/alerts", async (ProcessingAlertsService alertsService, CancellationToken cancellationToken) =>
    Results.Json(await alertsService.GetSnapshotAsync(cancellationToken)));
app.MapGet("/metrics/processing", async (ProcessingMetricsService metricsService, CancellationToken cancellationToken) =>
    Results.Json(await metricsService.GetSnapshotAsync(cancellationToken)));
app.MapGet("/admin/processing/overview", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingOverviewService overviewService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await overviewService.GetSnapshotAsync(cancellationToken));
});
app.MapGet("/admin/processing/alerts/history", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingAlertHistoryService alertHistoryService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await alertHistoryService.GetRecentEventsAsync(cancellationToken: cancellationToken));
});
app.MapGet("/admin/processing/notifier/status", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingAlertNotifierAdminService notifierAdminService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await notifierAdminService.GetStatusAsync(cancellationToken));
});
app.MapGet("/admin/processing/alerts/{eventId:long}/preview", async (HttpContext httpContext, long eventId, AdminAccessService adminAccessService, ProcessingAlertNotifierAdminService notifierAdminService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await notifierAdminService.GetPreviewAsync(eventId, cancellationToken));
});
app.MapPost("/admin/processing/notifier/dispatch", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingAlertNotificationDispatcherService dispatcherService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    var dispatchedCount = await dispatcherService.DispatchPendingAsync(cancellationToken);
    return Results.Json(new ProcessingAlertDispatchResponse
    {
        GeneratedAt = DateTimeOffset.UtcNow,
        DispatchedCount = dispatchedCount,
    });
});
app.MapGet("/admin/processing/diagnostics", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingDiagnosticsService diagnosticsService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Json(await diagnosticsService.GetSnapshotAsync(cancellationToken));
});
app.MapGet("/admin/processing/dashboard", async (HttpContext httpContext, AdminAccessService adminAccessService, ProcessingDashboardPageService dashboardPageService, CancellationToken cancellationToken) =>
{
    await adminAccessService.RequireAdminAsync(httpContext, cancellationToken);
    return Results.Content(dashboardPageService.Render(), "text/html; charset=utf-8");
});
app.MapControllers();

app.Run();
