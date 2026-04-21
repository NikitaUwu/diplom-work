using System.Net.Http.Json;
using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Models;
using Microsoft.Extensions.Hosting;

namespace DiplomWork.Services;

public sealed class ProcessingAlertNotificationSender : IProcessingAlertNotificationSender
{
    private readonly AppOptions _options;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHostEnvironment _hostEnvironment;
    private readonly ILogger<ProcessingAlertNotificationSender> _logger;

    public ProcessingAlertNotificationSender(
        AppOptions options,
        IHttpClientFactory httpClientFactory,
        IHostEnvironment hostEnvironment,
        ILogger<ProcessingAlertNotificationSender> logger)
    {
        _options = options;
        _httpClientFactory = httpClientFactory;
        _hostEnvironment = hostEnvironment;
        _logger = logger;
    }

    public async Task SendAsync(ProcessingAlertEvent alertEvent, CancellationToken cancellationToken = default)
    {
        var payload = BuildPayload(alertEvent);

        if (_options.ProcessingAlertNotifierLogEnabled)
        {
            LogAlert(payload);
        }

        if (!string.IsNullOrWhiteSpace(_options.ProcessingAlertNotifierWebhookUrl))
        {
            var client = _httpClientFactory.CreateClient(nameof(ProcessingAlertNotificationSender));
            var body = BuildWebhookRequestBody(payload);
            var response = await client.PostAsJsonAsync(
                _options.ProcessingAlertNotifierWebhookUrl,
                body,
                cancellationToken);

            response.EnsureSuccessStatusCode();
        }
    }

    public ProcessingAlertNotificationPayload BuildPayload(ProcessingAlertEvent alertEvent) =>
        new()
        {
            EventId = alertEvent.Id,
            Source = _options.ProcessingAlertNotifierSourceName,
            Environment = _hostEnvironment.EnvironmentName,
            AlertCode = alertEvent.AlertCode,
            EventType = alertEvent.EventType,
            Severity = alertEvent.Severity,
            Message = alertEvent.Message,
            Count = alertEvent.Count,
            Samples = DeserializeSamples(alertEvent.SamplesText),
            CreatedAt = alertEvent.CreatedAt,
        };

    public object BuildWebhookRequestBody(ProcessingAlertNotificationPayload payload)
    {
        var format = _options.ProcessingAlertNotifierWebhookFormat.Trim().ToLowerInvariant();
        return format switch
        {
            "slack" => BuildSlackPayload(payload),
            _ => payload,
        };
    }

    private void LogAlert(ProcessingAlertNotificationPayload payload)
    {
        var message = "Processing alert event {EventType} [{Severity}] {AlertCode}: {Message}. Count={Count}. Samples={Samples}.";
        var samples = payload.Samples.Count == 0 ? "-" : string.Join(';', payload.Samples);

        if (string.Equals(payload.Severity, "critical", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogError(message, payload.EventType, payload.Severity, payload.AlertCode, payload.Message, payload.Count, samples);
            return;
        }

        if (string.Equals(payload.Severity, "warning", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning(message, payload.EventType, payload.Severity, payload.AlertCode, payload.Message, payload.Count, samples);
            return;
        }

        _logger.LogInformation(message, payload.EventType, payload.Severity, payload.AlertCode, payload.Message, payload.Count, samples);
    }

    private static object BuildSlackPayload(ProcessingAlertNotificationPayload payload)
    {
        var emoji = payload.Severity.Trim().ToLowerInvariant() switch
        {
            "critical" => ":red_circle:",
            "warning" => ":large_orange_circle:",
            _ => ":large_blue_circle:",
        };

        var title = $"{emoji} {payload.Source}/{payload.Environment}: {payload.EventType} {payload.AlertCode}";
        var facts = $"*Severity:* {payload.Severity}\n*Count:* {payload.Count}\n*Event ID:* {payload.EventId}\n*Created:* {payload.CreatedAt:O}";
        var samples = payload.Samples.Count == 0
            ? "No samples"
            : string.Join("\n", payload.Samples.Select(item => $"- `{item}`"));

        return new
        {
            text = $"{title} — {payload.Message}",
            blocks = new object[]
            {
                new
                {
                    type = "header",
                    text = new
                    {
                        type = "plain_text",
                        text = title,
                    },
                },
                new
                {
                    type = "section",
                    text = new
                    {
                        type = "mrkdwn",
                        text = payload.Message,
                    },
                },
                new
                {
                    type = "section",
                    fields = new object[]
                    {
                        new
                        {
                            type = "mrkdwn",
                            text = facts,
                        },
                        new
                        {
                            type = "mrkdwn",
                            text = $"*Type:* {payload.EventType}\n*Code:* {payload.AlertCode}",
                        },
                    },
                },
                new
                {
                    type = "section",
                    text = new
                    {
                        type = "mrkdwn",
                        text = $"*Samples*\n{samples}",
                    },
                },
            },
        };
    }

    private static List<string> DeserializeSamples(string? samplesText) =>
        string.IsNullOrWhiteSpace(samplesText)
            ? []
            : samplesText.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
