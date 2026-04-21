using Microsoft.AspNetCore.Http;

namespace DiplomWork.Configuration;

public sealed class AppOptions
{
    public string DatabaseUrl { get; init; } = string.Empty;
    public string JwtSecretKey { get; init; } = string.Empty;
    public string JwtAlgorithm { get; init; } = "HS256";
    public int JwtAccessTokenExpireMinutes { get; init; } = 60;
    public int MaxUploadBytes { get; init; } = 10 * 1024 * 1024;
    public string StorageDir { get; init; } = string.Empty;
    public string WorkerRunsRoot { get; init; } = string.Empty;
    public bool AuthEnabled { get; init; } = true;
    public string AuthCookieName { get; init; } = "access_token";
    public bool CookieSecure { get; init; }
    public string CookieSameSite { get; init; } = "lax";
    public int CookieMaxAge { get; init; } = 3600;
    public string DevUserEmail { get; init; } = "dev@local";
    public string DevUserPassword { get; init; } = "devpass";
    public string[] AdminEmails { get; init; } = [];
    public string[] CorsOrigins { get; init; } = ["http://localhost:5173"];
    public bool MqttEnabled { get; init; }
    public string MqttHost { get; init; } = "localhost";
    public int MqttPort { get; init; } = 1883;
    public string? MqttUsername { get; init; }
    public string? MqttPassword { get; init; }
    public string MqttClientIdPrefix { get; init; } = "diplom-backend";
    public string MqttProcessRequestTopic { get; init; } = "charts/process/request";
    public string MqttProcessAcceptedTopic { get; init; } = "charts/process/accepted";
    public string MqttProcessHeartbeatTopic { get; init; } = "charts/process/heartbeat";
    public string MqttProcessCompletedTopic { get; init; } = "charts/process/completed";
    public string MqttProcessFailedTopic { get; init; } = "charts/process/failed";
    public int ProcessingLeaseSeconds { get; init; } = 45;
    public int ProcessingLeaseMonitorIntervalSeconds { get; init; } = 10;
    public int ProcessingMaxAttempts { get; init; } = 3;
    public int ProcessingRetryDelaySeconds { get; init; } = 15;
    public int ProcessingRetryModalBackendUnavailableMaxAttempts { get; init; } = 5;
    public int ProcessingRetryModalBackendUnavailableDelaySeconds { get; init; } = 20;
    public int ProcessingRetryNetworkTimeoutMaxAttempts { get; init; } = 4;
    public int ProcessingRetryNetworkTimeoutDelaySeconds { get; init; } = 10;
    public int ProcessingAlertQueuedReadyAgeSeconds { get; init; } = 120;
    public int ProcessingAlertOutboxPendingAgeSeconds { get; init; } = 60;
    public int ProcessingAlertRecentFailureWindowMinutes { get; init; } = 15;
    public int ProcessingAlertRecentFailureCountThreshold { get; init; } = 3;
    public int ProcessingDiagnosticsItemLimit { get; init; } = 20;
    public bool ProcessingAlertMonitorEnabled { get; init; } = true;
    public int ProcessingAlertMonitorIntervalSeconds { get; init; } = 30;
    public int ProcessingAlertHistoryItemLimit { get; init; } = 30;
    public bool ProcessingAlertNotifierEnabled { get; init; } = true;
    public bool ProcessingAlertNotifierLogEnabled { get; init; } = true;
    public string ProcessingAlertNotifierSourceName { get; init; } = "diplomWork";
    public string ProcessingAlertNotifierMinimumSeverity { get; init; } = "info";
    public string[] ProcessingAlertNotifierEventTypes { get; init; } = ["activated", "severity_changed", "resolved"];
    public string ProcessingAlertNotifierWebhookFormat { get; init; } = "json";
    public string? ProcessingAlertNotifierWebhookUrl { get; init; }
    public int ProcessingAlertNotifierIntervalSeconds { get; init; } = 15;
    public int ProcessingAlertNotifierRetryDelaySeconds { get; init; } = 60;
    public int ProcessingAlertNotifierBatchSize { get; init; } = 10;

    public SameSiteMode CookieSameSiteMode =>
        CookieSameSite.Trim().ToLowerInvariant() switch
        {
            "strict" => SameSiteMode.Strict,
            "none" => SameSiteMode.None,
            _ => SameSiteMode.Lax,
        };

    public static AppOptions FromConfiguration(IConfiguration configuration, string contentRoot)
    {
        var section = configuration.GetSection("App");
        var storageDir = section["StorageDir"];
        var workerRunsRoot = section["WorkerRunsRoot"];
        var databaseUrl = configuration["DATABASE_URL"] ?? section["DatabaseUrl"] ?? string.Empty;
        var jwtSecret = configuration["JWT_SECRET_KEY"] ?? section["JwtSecretKey"] ?? string.Empty;
        var cors = configuration["CORS_ORIGINS"];

        string[] corsOrigins;
        if (!string.IsNullOrWhiteSpace(cors))
        {
            corsOrigins = cors
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(origin => !string.Equals(origin, "*", StringComparison.Ordinal))
                .ToArray();
        }
        else
        {
            corsOrigins = section.GetSection("CorsOrigins").Get<string[]>() ?? ["http://localhost:5173"];
        }

        if (corsOrigins.Length == 0)
        {
            corsOrigins = ["http://localhost:5173"];
        }

        string[] adminEmails;
        var adminEmailsRaw = configuration["ADMIN_EMAILS"];
        if (!string.IsNullOrWhiteSpace(adminEmailsRaw))
        {
            adminEmails = adminEmailsRaw
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        else
        {
            adminEmails = (section.GetSection("AdminEmails").Get<string[]>() ?? [])
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        string[] processingAlertNotifierEventTypes;
        var processingAlertNotifierEventTypesRaw = configuration["PROCESSING_ALERT_NOTIFIER_EVENT_TYPES"];
        if (!string.IsNullOrWhiteSpace(processingAlertNotifierEventTypesRaw))
        {
            processingAlertNotifierEventTypes = processingAlertNotifierEventTypesRaw
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        else
        {
            processingAlertNotifierEventTypes = (section.GetSection("ProcessingAlertNotifierEventTypes").Get<string[]>() ?? ["activated", "severity_changed", "resolved"])
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        if (processingAlertNotifierEventTypes.Length == 0)
        {
            processingAlertNotifierEventTypes = ["activated", "severity_changed", "resolved"];
        }

        var options = new AppOptions
        {
            DatabaseUrl = databaseUrl,
            JwtSecretKey = jwtSecret,
            JwtAlgorithm = configuration["JWT_ALGORITHM"] ?? section["JwtAlgorithm"] ?? "HS256",
            JwtAccessTokenExpireMinutes = configuration.GetValue<int?>("JWT_ACCESS_TOKEN_EXPIRE_MINUTES")
                ?? section.GetValue<int?>("JwtAccessTokenExpireMinutes")
                ?? 60,
            MaxUploadBytes = configuration.GetValue<int?>("MAX_UPLOAD_BYTES")
                ?? section.GetValue<int?>("MaxUploadBytes")
                ?? (10 * 1024 * 1024),
            StorageDir = ResolvePath(
                configuration["STORAGE_DIR"] ?? storageDir,
                Path.Combine(contentRoot, "storage")),
            WorkerRunsRoot = ResolvePath(
                configuration["WORKER_RUNS_ROOT"] ?? workerRunsRoot,
                Path.Combine(contentRoot, "..", "ml-worker", "runs", "worker")),
            AuthEnabled = configuration.GetValue<bool?>("AUTH_ENABLED")
                ?? section.GetValue<bool?>("AuthEnabled")
                ?? true,
            AuthCookieName = configuration["AUTH_COOKIE_NAME"] ?? section["AuthCookieName"] ?? "access_token",
            CookieSecure = configuration.GetValue<bool?>("COOKIE_SECURE")
                ?? section.GetValue<bool?>("CookieSecure")
                ?? false,
            CookieSameSite = configuration["COOKIE_SAMESITE"] ?? section["CookieSameSite"] ?? "lax",
            CookieMaxAge = configuration.GetValue<int?>("COOKIE_MAX_AGE")
                ?? section.GetValue<int?>("CookieMaxAge")
                ?? 3600,
            DevUserEmail = configuration["DEV_USER_EMAIL"] ?? section["DevUserEmail"] ?? "dev@local",
            DevUserPassword = configuration["DEV_USER_PASSWORD"] ?? section["DevUserPassword"] ?? "devpass",
            AdminEmails = adminEmails,
            CorsOrigins = corsOrigins,
            MqttEnabled = configuration.GetValue<bool?>("MQTT_ENABLED")
                ?? section.GetValue<bool?>("MqttEnabled")
                ?? false,
            MqttHost = configuration["MQTT_HOST"] ?? section["MqttHost"] ?? "localhost",
            MqttPort = configuration.GetValue<int?>("MQTT_PORT")
                ?? section.GetValue<int?>("MqttPort")
                ?? 1883,
            MqttUsername = configuration["MQTT_USERNAME"] ?? section["MqttUsername"],
            MqttPassword = configuration["MQTT_PASSWORD"] ?? section["MqttPassword"],
            MqttClientIdPrefix = configuration["MQTT_CLIENT_ID_PREFIX"] ?? section["MqttClientIdPrefix"] ?? "diplom-backend",
            MqttProcessRequestTopic = configuration["MQTT_PROCESS_REQUEST_TOPIC"] ?? section["MqttProcessRequestTopic"] ?? "charts/process/request",
            MqttProcessAcceptedTopic = configuration["MQTT_PROCESS_ACCEPTED_TOPIC"] ?? section["MqttProcessAcceptedTopic"] ?? "charts/process/accepted",
            MqttProcessHeartbeatTopic = configuration["MQTT_PROCESS_HEARTBEAT_TOPIC"] ?? section["MqttProcessHeartbeatTopic"] ?? "charts/process/heartbeat",
            MqttProcessCompletedTopic = configuration["MQTT_PROCESS_COMPLETED_TOPIC"] ?? section["MqttProcessCompletedTopic"] ?? "charts/process/completed",
            MqttProcessFailedTopic = configuration["MQTT_PROCESS_FAILED_TOPIC"] ?? section["MqttProcessFailedTopic"] ?? "charts/process/failed",
            ProcessingLeaseSeconds = configuration.GetValue<int?>("PROCESSING_LEASE_SECONDS")
                ?? section.GetValue<int?>("ProcessingLeaseSeconds")
                ?? 45,
            ProcessingLeaseMonitorIntervalSeconds = configuration.GetValue<int?>("PROCESSING_LEASE_MONITOR_INTERVAL_SECONDS")
                ?? section.GetValue<int?>("ProcessingLeaseMonitorIntervalSeconds")
                ?? 10,
            ProcessingMaxAttempts = configuration.GetValue<int?>("PROCESSING_MAX_ATTEMPTS")
                ?? section.GetValue<int?>("ProcessingMaxAttempts")
                ?? 3,
            ProcessingRetryDelaySeconds = configuration.GetValue<int?>("PROCESSING_RETRY_DELAY_SECONDS")
                ?? section.GetValue<int?>("ProcessingRetryDelaySeconds")
                ?? 15,
            ProcessingRetryModalBackendUnavailableMaxAttempts = configuration.GetValue<int?>("PROCESSING_RETRY_MODAL_BACKEND_UNAVAILABLE_MAX_ATTEMPTS")
                ?? section.GetValue<int?>("ProcessingRetryModalBackendUnavailableMaxAttempts")
                ?? 5,
            ProcessingRetryModalBackendUnavailableDelaySeconds = configuration.GetValue<int?>("PROCESSING_RETRY_MODAL_BACKEND_UNAVAILABLE_DELAY_SECONDS")
                ?? section.GetValue<int?>("ProcessingRetryModalBackendUnavailableDelaySeconds")
                ?? 20,
            ProcessingRetryNetworkTimeoutMaxAttempts = configuration.GetValue<int?>("PROCESSING_RETRY_NETWORK_TIMEOUT_MAX_ATTEMPTS")
                ?? section.GetValue<int?>("ProcessingRetryNetworkTimeoutMaxAttempts")
                ?? 4,
            ProcessingRetryNetworkTimeoutDelaySeconds = configuration.GetValue<int?>("PROCESSING_RETRY_NETWORK_TIMEOUT_DELAY_SECONDS")
                ?? section.GetValue<int?>("ProcessingRetryNetworkTimeoutDelaySeconds")
                ?? 10,
            ProcessingAlertQueuedReadyAgeSeconds = configuration.GetValue<int?>("PROCESSING_ALERT_QUEUED_READY_AGE_SECONDS")
                ?? section.GetValue<int?>("ProcessingAlertQueuedReadyAgeSeconds")
                ?? 120,
            ProcessingAlertOutboxPendingAgeSeconds = configuration.GetValue<int?>("PROCESSING_ALERT_OUTBOX_PENDING_AGE_SECONDS")
                ?? section.GetValue<int?>("ProcessingAlertOutboxPendingAgeSeconds")
                ?? 60,
            ProcessingAlertRecentFailureWindowMinutes = configuration.GetValue<int?>("PROCESSING_ALERT_RECENT_FAILURE_WINDOW_MINUTES")
                ?? section.GetValue<int?>("ProcessingAlertRecentFailureWindowMinutes")
                ?? 15,
            ProcessingAlertRecentFailureCountThreshold = configuration.GetValue<int?>("PROCESSING_ALERT_RECENT_FAILURE_COUNT_THRESHOLD")
                ?? section.GetValue<int?>("ProcessingAlertRecentFailureCountThreshold")
                ?? 3,
            ProcessingDiagnosticsItemLimit = configuration.GetValue<int?>("PROCESSING_DIAGNOSTICS_ITEM_LIMIT")
                ?? section.GetValue<int?>("ProcessingDiagnosticsItemLimit")
                ?? 20,
            ProcessingAlertMonitorEnabled = configuration.GetValue<bool?>("PROCESSING_ALERT_MONITOR_ENABLED")
                ?? section.GetValue<bool?>("ProcessingAlertMonitorEnabled")
                ?? true,
            ProcessingAlertMonitorIntervalSeconds = configuration.GetValue<int?>("PROCESSING_ALERT_MONITOR_INTERVAL_SECONDS")
                ?? section.GetValue<int?>("ProcessingAlertMonitorIntervalSeconds")
                ?? 30,
            ProcessingAlertHistoryItemLimit = configuration.GetValue<int?>("PROCESSING_ALERT_HISTORY_ITEM_LIMIT")
                ?? section.GetValue<int?>("ProcessingAlertHistoryItemLimit")
                ?? 30,
            ProcessingAlertNotifierEnabled = configuration.GetValue<bool?>("PROCESSING_ALERT_NOTIFIER_ENABLED")
                ?? section.GetValue<bool?>("ProcessingAlertNotifierEnabled")
                ?? true,
            ProcessingAlertNotifierLogEnabled = configuration.GetValue<bool?>("PROCESSING_ALERT_NOTIFIER_LOG_ENABLED")
                ?? section.GetValue<bool?>("ProcessingAlertNotifierLogEnabled")
                ?? true,
            ProcessingAlertNotifierSourceName = configuration["PROCESSING_ALERT_NOTIFIER_SOURCE_NAME"]
                ?? section["ProcessingAlertNotifierSourceName"]
                ?? "diplomWork",
            ProcessingAlertNotifierMinimumSeverity = configuration["PROCESSING_ALERT_NOTIFIER_MINIMUM_SEVERITY"]
                ?? section["ProcessingAlertNotifierMinimumSeverity"]
                ?? "info",
            ProcessingAlertNotifierEventTypes = processingAlertNotifierEventTypes,
            ProcessingAlertNotifierWebhookFormat = configuration["PROCESSING_ALERT_NOTIFIER_WEBHOOK_FORMAT"]
                ?? section["ProcessingAlertNotifierWebhookFormat"]
                ?? "json",
            ProcessingAlertNotifierWebhookUrl = configuration["PROCESSING_ALERT_NOTIFIER_WEBHOOK_URL"]
                ?? section["ProcessingAlertNotifierWebhookUrl"],
            ProcessingAlertNotifierIntervalSeconds = configuration.GetValue<int?>("PROCESSING_ALERT_NOTIFIER_INTERVAL_SECONDS")
                ?? section.GetValue<int?>("ProcessingAlertNotifierIntervalSeconds")
                ?? 15,
            ProcessingAlertNotifierRetryDelaySeconds = configuration.GetValue<int?>("PROCESSING_ALERT_NOTIFIER_RETRY_DELAY_SECONDS")
                ?? section.GetValue<int?>("ProcessingAlertNotifierRetryDelaySeconds")
                ?? 60,
            ProcessingAlertNotifierBatchSize = configuration.GetValue<int?>("PROCESSING_ALERT_NOTIFIER_BATCH_SIZE")
                ?? section.GetValue<int?>("ProcessingAlertNotifierBatchSize")
                ?? 10,
        };

        if (string.IsNullOrWhiteSpace(options.DatabaseUrl))
        {
            throw new InvalidOperationException("DATABASE_URL is required.");
        }

        if (string.IsNullOrWhiteSpace(options.JwtSecretKey) || options.JwtSecretKey == "CHANGE_ME")
        {
            throw new InvalidOperationException("JWT_SECRET_KEY must be set and must not be CHANGE_ME.");
        }

        if (options.CookieSameSiteMode == SameSiteMode.None && !options.CookieSecure)
        {
            throw new InvalidOperationException("COOKIE_SECURE must be true when COOKIE_SAMESITE=none.");
        }

        if (options.ProcessingLeaseSeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_LEASE_SECONDS must be >= 1.");
        }

        if (options.ProcessingMaxAttempts < 1)
        {
            throw new InvalidOperationException("PROCESSING_MAX_ATTEMPTS must be >= 1.");
        }

        if (options.ProcessingRetryDelaySeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_RETRY_DELAY_SECONDS must be >= 1.");
        }

        if (options.ProcessingRetryModalBackendUnavailableMaxAttempts < 1)
        {
            throw new InvalidOperationException("PROCESSING_RETRY_MODAL_BACKEND_UNAVAILABLE_MAX_ATTEMPTS must be >= 1.");
        }

        if (options.ProcessingRetryModalBackendUnavailableDelaySeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_RETRY_MODAL_BACKEND_UNAVAILABLE_DELAY_SECONDS must be >= 1.");
        }

        if (options.ProcessingRetryNetworkTimeoutMaxAttempts < 1)
        {
            throw new InvalidOperationException("PROCESSING_RETRY_NETWORK_TIMEOUT_MAX_ATTEMPTS must be >= 1.");
        }

        if (options.ProcessingRetryNetworkTimeoutDelaySeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_RETRY_NETWORK_TIMEOUT_DELAY_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertQueuedReadyAgeSeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_QUEUED_READY_AGE_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertOutboxPendingAgeSeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_OUTBOX_PENDING_AGE_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertRecentFailureWindowMinutes < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_RECENT_FAILURE_WINDOW_MINUTES must be >= 1.");
        }

        if (options.ProcessingAlertRecentFailureCountThreshold < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_RECENT_FAILURE_COUNT_THRESHOLD must be >= 1.");
        }

        if (options.ProcessingDiagnosticsItemLimit < 1)
        {
            throw new InvalidOperationException("PROCESSING_DIAGNOSTICS_ITEM_LIMIT must be >= 1.");
        }

        if (options.ProcessingAlertMonitorIntervalSeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_MONITOR_INTERVAL_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertHistoryItemLimit < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_HISTORY_ITEM_LIMIT must be >= 1.");
        }

        if (options.ProcessingAlertNotifierIntervalSeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_NOTIFIER_INTERVAL_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertNotifierRetryDelaySeconds < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_NOTIFIER_RETRY_DELAY_SECONDS must be >= 1.");
        }

        if (options.ProcessingAlertNotifierBatchSize < 1)
        {
            throw new InvalidOperationException("PROCESSING_ALERT_NOTIFIER_BATCH_SIZE must be >= 1.");
        }

        var minimumSeverity = options.ProcessingAlertNotifierMinimumSeverity.Trim().ToLowerInvariant();
        if (minimumSeverity is not ("info" or "warning" or "critical"))
        {
            throw new InvalidOperationException("PROCESSING_ALERT_NOTIFIER_MINIMUM_SEVERITY must be one of: info, warning, critical.");
        }

        var webhookFormat = options.ProcessingAlertNotifierWebhookFormat.Trim().ToLowerInvariant();
        if (webhookFormat is not ("json" or "slack"))
        {
            throw new InvalidOperationException("PROCESSING_ALERT_NOTIFIER_WEBHOOK_FORMAT must be one of: json, slack.");
        }

        return options;
    }

    private static string ResolvePath(string? configured, string fallback)
    {
        var raw = string.IsNullOrWhiteSpace(configured) ? fallback : configured;
        return Path.GetFullPath(raw);
    }
}
