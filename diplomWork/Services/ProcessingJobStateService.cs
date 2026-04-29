using System.Text.Json;
using System.Text.Json.Nodes;
using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Helpers;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingJobStateService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ChartStorageService _chartStorageService;
    private readonly ILogger<ProcessingJobStateService> _logger;

    public ProcessingJobStateService(AppDbContext db, AppOptions options, ChartStorageService chartStorageService, ILogger<ProcessingJobStateService> logger)
    {
        _db = db;
        _options = options;
        _chartStorageService = chartStorageService;
        _logger = logger;
    }

    public async Task<bool> ApplyAcceptedAsync(
        string topic,
        ProcessingEventPayload payload,
        JsonNode? payloadNode,
        CancellationToken cancellationToken)
    {
        // Сначала запоминаем событие, чтобы повторное такое же сообщение не изменило задачу второй раз.
        return await ExecuteWithInboxAsync(topic, payload, payloadNode, cancellationToken, async () =>
        {
            var context = await LoadContextAsync(payload, cancellationToken);
            if (context is null)
            {
                return;
            }

            var (job, chart) = context.Value;
            if (!MatchesCurrentAttempt(job, payload))
            {
                _logger.LogInformation(
                    "Ignoring stale accepted event for job {JobId}. CurrentRequest={CurrentRequestMessageId}, EventRequest={EventRequestMessageId}.",
                    job.Id,
                    job.MessageId,
                    payload.RequestMessageId);
                return;
            }

            if (IsTerminal(job.Status))
            {
                _logger.LogDebug("Ignoring accepted event for finished job {JobId}.", job.Id);
                return;
            }

            var now = DateTimeOffset.UtcNow;
            job.Status = "processing";
            job.ErrorMessage = null;
            job.ErrorCode = null;
            job.WorkerId = payload.WorkerId ?? job.WorkerId;
            job.Attempt += 1;
            job.StartedAt = now;
            job.FinishedAt = null;
            job.ResultPayload = null;
            job.LastHeartbeatAt = now;
            job.LeasedUntil = now.AddSeconds(_options.ProcessingLeaseSeconds);
            job.NextRetryAt = null;

            chart.Status = ChartStatus.processing.ToString();
            chart.ErrorMessage = null;
            chart.ProcessedAt = null;
        });
    }

    public async Task<bool> ApplyHeartbeatAsync(
        ProcessingEventPayload payload,
        CancellationToken cancellationToken)
    {
        // Это короткий сигнал "воркер жив", поэтому он только продлевает время ожидания.
        var context = await LoadContextAsync(payload, cancellationToken);
        if (context is null)
        {
            return false;
        }

        var (job, _) = context.Value;
        if (!MatchesCurrentAttempt(job, payload))
        {
            _logger.LogDebug(
                "Ignoring stale heartbeat for job {JobId}. CurrentRequest={CurrentRequestMessageId}, EventRequest={EventRequestMessageId}.",
                job.Id,
                job.MessageId,
                payload.RequestMessageId);
            return false;
        }

        if (!string.Equals(job.Status, "processing", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogDebug("Ignoring heartbeat for job {JobId} because status is {Status}.", job.Id, job.Status);
            return false;
        }

        var now = DateTimeOffset.UtcNow;
        job.WorkerId = payload.WorkerId ?? job.WorkerId;
        job.LastHeartbeatAt = now;
        job.LeasedUntil = now.AddSeconds(_options.ProcessingLeaseSeconds);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> ApplyCompletedAsync(
        string topic,
        ProcessingEventPayload payload,
        JsonNode? payloadNode,
        CancellationToken cancellationToken)
    {
        bool loadedResultJsonFromStorage = false;

        // Готовый результат принимаем только один раз и только от текущей попытки.
        var applied = await ExecuteWithInboxAsync(topic, payload, payloadNode, cancellationToken, async () =>
        {
            var context = await LoadContextAsync(payload, cancellationToken);
            if (context is null)
            {
                return;
            }

            var (job, chart) = context.Value;
            if (!MatchesCurrentAttempt(job, payload))
            {
                _logger.LogInformation(
                    "Ignoring stale completed event for job {JobId}. CurrentRequest={CurrentRequestMessageId}, EventRequest={EventRequestMessageId}.",
                    job.Id,
                    job.MessageId,
                    payload.RequestMessageId);
                return;
            }

            if (string.Equals(job.Status, "error", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(job.ErrorCode, ProcessingErrorCatalog.Codes.ProcessingLeaseExpired, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Ignoring completed event for job {JobId} because it is already marked as error.", job.Id);
                return;
            }

            JsonObject? resultJson;
            bool resultLoadedFromStorage;
            try
            {
                (resultJson, resultLoadedFromStorage) = await ResolveResultJsonAsync(chart, payload, cancellationToken);
            }
            catch (Exception ex) when (ex is JsonException or ApiProblemException)
            {
                MarkCompletedResultInvalid(job, chart, DateTimeOffset.UtcNow, $"Invalid completed result JSON: {ex.Message}");
                return;
            }

            if (resultJson is null)
            {
                MarkCompletedResultInvalid(job, chart, DateTimeOffset.UtcNow, "Completed event did not include resultJson or resultJsonPath.");
                return;
            }

            loadedResultJsonFromStorage = resultLoadedFromStorage;

            JsonDocument? resultDocument;
            (int nPanels, int nSeries) counts;
            try
            {
                resultDocument = JsonHelpers.ToDocument(resultJson);
                counts = CountPanelsAndSeries(resultJson);
            }
            catch (JsonException ex)
            {
                MarkCompletedResultInvalid(job, chart, DateTimeOffset.UtcNow, $"Invalid completed result JSON: {ex.Message}");
                return;
            }

            var now = DateTimeOffset.UtcNow;
            var (nPanels, nSeries) = counts;

            job.Status = "done";
            job.ErrorMessage = null;
            job.ErrorCode = null;
            job.WorkerId = payload.WorkerId ?? job.WorkerId;
            job.LastHeartbeatAt = now;
            job.LeasedUntil = null;
            job.NextRetryAt = null;
            job.FinishedAt = now;
            job.ResultPayload = resultDocument is null ? null : JsonDocument.Parse(resultDocument.RootElement.GetRawText());

            chart.Status = ChartStatus.done.ToString();
            chart.ErrorMessage = null;
            chart.ProcessedAt = now;
            chart.ResultJson = resultDocument;
            chart.NPanels = payload.NPanels ?? nPanels;
            chart.NSeries = payload.NSeries ?? nSeries;
        });

        if (applied && !loadedResultJsonFromStorage)
        {
            var chartForDataJson = await _db.Charts.FirstOrDefaultAsync(item => item.Id == payload.ChartId, cancellationToken);
            var resultJsonForDataJson = payload.ResultJson as JsonObject;
            if (chartForDataJson is not null && resultJsonForDataJson is not null)
            {
                await _chartStorageService.WriteDataJsonAsync(chartForDataJson, resultJsonForDataJson, cancellationToken);
            }
        }

        return applied;
    }

    public async Task<bool> ApplyFailedAsync(
        string topic,
        ProcessingEventPayload payload,
        JsonNode? payloadNode,
        CancellationToken cancellationToken)
    {
        bool loadedResultJsonFromStorage = false;

        // Даже при ошибке воркер может прислать полезные картинки, поэтому результат тоже читаем.
        var applied = await ExecuteWithInboxAsync(topic, payload, payloadNode, cancellationToken, async () =>
        {
            var context = await LoadContextAsync(payload, cancellationToken);
            if (context is null)
            {
                return;
            }

            var (job, chart) = context.Value;
            if (!MatchesCurrentAttempt(job, payload))
            {
                _logger.LogInformation(
                    "Ignoring stale failed event for job {JobId}. CurrentRequest={CurrentRequestMessageId}, EventRequest={EventRequestMessageId}.",
                    job.Id,
                    job.MessageId,
                    payload.RequestMessageId);
                return;
            }

            if (string.Equals(job.Status, "done", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Ignoring failed event for job {JobId} because it is already marked as done.", job.Id);
                return;
            }

            var now = DateTimeOffset.UtcNow;
            var (resultJson, resultLoadedFromStorage) = await ResolveResultJsonAsync(chart, payload, cancellationToken);
            loadedResultJsonFromStorage = resultLoadedFromStorage;
            var failurePolicy = GetWorkerFailurePolicy(payload);
            if (ShouldRetryFailedEvent(job, failurePolicy))
            {
                ScheduleRetry(job, chart, now, BuildWorkerRetryReason(payload), failurePolicy);
                return;
            }

            var normalizedErrorCode = failurePolicy.ErrorCode;
            job.Status = "error";
            job.ErrorMessage = TrimError(payload.ErrorMessage);
            job.ErrorCode = normalizedErrorCode;
            job.WorkerId = payload.WorkerId ?? job.WorkerId;
            job.LastHeartbeatAt = now;
            job.LeasedUntil = null;
            job.NextRetryAt = null;
            job.FinishedAt = now;
            job.ResultPayload = JsonHelpers.ToDocument(resultJson);

            chart.Status = ChartStatus.error.ToString();
            chart.ErrorMessage = TrimError(payload.ErrorMessage);
            chart.ProcessedAt = now;
            if (resultJson is not null)
            {
                chart.ResultJson = JsonHelpers.ToDocument(resultJson);
            }
        });

        if (applied && !loadedResultJsonFromStorage)
        {
            var chartForDataJson = await _db.Charts.FirstOrDefaultAsync(item => item.Id == payload.ChartId, cancellationToken);
            var resultJsonForDataJson = payload.ResultJson as JsonObject;
            if (chartForDataJson is not null && resultJsonForDataJson is not null)
            {
                await _chartStorageService.WriteDataJsonAsync(chartForDataJson, resultJsonForDataJson, cancellationToken);
            }
        }

        return applied;
    }

    public async Task<int> ExpireTimedOutJobsAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        // Если от воркера давно нет сигнала, считаем задачу зависшей.
        var expiredJobs = await _db.ProcessingJobs
            .Where(item => item.Status == "processing" && item.LeasedUntil != null && item.LeasedUntil < now)
            .OrderBy(item => item.LeasedUntil)
            .ToListAsync(cancellationToken);

        if (expiredJobs.Count == 0)
        {
            return 0;
        }

        var chartIds = expiredJobs.Select(item => item.ChartId).Distinct().ToList();
        var charts = await _db.Charts
            .Where(item => chartIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        foreach (var job in expiredJobs)
        {
            if (!charts.TryGetValue(job.ChartId, out var chart))
            {
                continue;
            }

            var leasePolicy = ProcessingRetryPolicyCatalog.ResolveForLeaseExpiry(_options);
            if (job.Attempt < leasePolicy.MaxAttempts)
            {
                ScheduleRetry(job, chart, now, "Processing lease expired", leasePolicy);
                continue;
            }

            MarkLeaseExpiredAsTerminal(job, chart, now);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return expiredJobs.Count;
    }

    private void ScheduleRetry(ProcessingJob job, Chart chart, DateTimeOffset now, string reason, ProcessingRetryPolicy retryPolicy)
    {
        var nextRetryAt = now.AddSeconds(Math.Max(1, retryPolicy.RetryDelaySeconds));
        // Новая попытка получает новый id, чтобы поздний ответ от старой попытки был проигнорирован.
        var newMessageId = Guid.NewGuid().ToString("N");
        var requestPayload = BuildRetryRequestPayload(job, chart, newMessageId);
        var requestDocument = JsonHelpers.ToDocument(requestPayload);

        job.Status = "queued";
        job.ErrorMessage = TrimError($"{reason}; retry scheduled ({job.Attempt + 1}/{retryPolicy.MaxAttempts})");
        job.ErrorCode = retryPolicy.ErrorCode;
        job.MessageId = newMessageId;
        job.WorkerId = null;
        job.StartedAt = null;
        job.LastHeartbeatAt = null;
        job.LeasedUntil = null;
        job.NextRetryAt = nextRetryAt;
        job.FinishedAt = null;
        job.ResultPayload = null;
        job.RequestPayload = requestDocument;

        _db.MqttMessages.Add(new MqttMessage
        {
            ProcessingJobId = job.Id,
            Direction = "out",
            Topic = _options.MqttProcessRequestTopic,
            Status = "pending",
            Payload = requestDocument is null ? null : JsonDocument.Parse(requestDocument.RootElement.GetRawText()),
            MessageId = newMessageId,
            AvailableAt = nextRetryAt,
        });

        chart.Status = ChartStatus.processing.ToString();
        chart.ErrorMessage = null;
        chart.ProcessedAt = null;

        _logger.LogWarning(
            "{Reason} for job {JobId}; scheduled retry {NextAttempt}/{MaxAttempts} at {NextRetryAt}.",
            reason,
            job.Id,
            job.Attempt + 1,
            retryPolicy.MaxAttempts,
            nextRetryAt);
    }

    private void MarkLeaseExpiredAsTerminal(ProcessingJob job, Chart chart, DateTimeOffset now)
    {
        var errorMessage = $"Processing lease expired after {job.Attempt} attempt(s)";
        job.Status = "error";
        job.ErrorMessage = errorMessage;
        job.ErrorCode = ProcessingErrorCatalog.Codes.ProcessingLeaseExpired;
        job.LeasedUntil = null;
        job.NextRetryAt = null;
        job.FinishedAt = now;

        if (!string.Equals(chart.Status, ChartStatus.done.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            chart.Status = ChartStatus.error.ToString();
            chart.ErrorMessage = errorMessage;
            chart.ProcessedAt = now;
        }
    }

    private void MarkCompletedResultInvalid(ProcessingJob job, Chart chart, DateTimeOffset now, string errorMessage)
    {
        var trimmedMessage = TrimError(errorMessage);
        job.Status = "error";
        job.ErrorMessage = trimmedMessage;
        job.ErrorCode = ProcessingErrorCatalog.Codes.PipelineOutputInvalid;
        job.WorkerId = null;
        job.LastHeartbeatAt = now;
        job.LeasedUntil = null;
        job.NextRetryAt = null;
        job.FinishedAt = now;
        job.ResultPayload = JsonHelpers.ToDocument(_buildInvalidResultJson(trimmedMessage));

        chart.Status = ChartStatus.error.ToString();
        chart.ErrorMessage = trimmedMessage;
        chart.ProcessedAt = now;
        chart.ResultJson = JsonHelpers.ToDocument(_buildInvalidResultJson(trimmedMessage));

        _logger.LogWarning(
            "Completed event for job {JobId} was converted to terminal error because result JSON is invalid: {ErrorMessage}",
            job.Id,
            trimmedMessage);

        static JsonObject _buildInvalidResultJson(string? message) => new()
        {
            ["artifacts"] = new JsonObject(),
            ["ml_meta"] = new JsonObject
            {
                ["worker_error"] = new JsonObject
                {
                    ["message"] = message,
                    ["code"] = ProcessingErrorCatalog.Codes.PipelineOutputInvalid,
                },
            },
        };
    }

    private JsonObject BuildRetryRequestPayload(ProcessingJob job, Chart chart, string newMessageId)
    {
        var payload = JsonHelpers.FromDocument(job.RequestPayload) as JsonObject ?? new JsonObject();
        payload["schemaVersion"] = 1;
        payload["messageId"] = newMessageId;
        payload["jobId"] = job.Id;
        payload["chartId"] = chart.Id;
        payload["userId"] = chart.UserId;
        payload["originalPath"] = chart.OriginalPath;
        return payload;
    }

    private async Task<bool> ExecuteWithInboxAsync(
        string topic,
        ProcessingEventPayload payload,
        JsonNode? payloadNode,
        CancellationToken cancellationToken,
        Func<Task> applyAction)
    {
        // Запись события и изменение задачи идут вместе: либо сохраняется все, либо ничего.
        if (!_db.Database.IsRelational())
        {
            try
            {
                if (!await TryAddInboxMessageAsync(topic, payload, payloadNode, cancellationToken))
                {
                    return false;
                }

                await applyAction();
                await _db.SaveChangesAsync(cancellationToken);
                return true;
            }
            catch (DbUpdateException ex) when (LooksLikeDuplicateInboxMessage(ex, payload.MessageId))
            {
                _logger.LogDebug("Duplicate MQTT event {MessageId} ignored.", payload.MessageId);
                return false;
            }
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            if (!await TryAddInboxMessageAsync(topic, payload, payloadNode, cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await applyAction();
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException ex) when (LooksLikeDuplicateInboxMessage(ex, payload.MessageId))
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogDebug("Duplicate MQTT event {MessageId} ignored.", payload.MessageId);
            return false;
        }
    }

    private async Task<bool> TryAddInboxMessageAsync(
        string topic,
        ProcessingEventPayload payload,
        JsonNode? payloadNode,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(payload.MessageId))
        {
            _logger.LogWarning("MQTT event on topic {Topic} has no messageId; processing without inbox deduplication.", topic);
            return true;
        }

        var exists = await _db.MqttMessages.AnyAsync(
            item => item.Direction == "in" && item.MessageId == payload.MessageId,
            cancellationToken);
        if (exists)
        {
            _logger.LogDebug("MQTT event {MessageId} already processed.", payload.MessageId);
            return false;
        }

        _db.MqttMessages.Add(new MqttMessage
        {
            MessageId = payload.MessageId,
            Direction = "in",
            Topic = topic,
            Status = "processed",
            Payload = JsonHelpers.ToDocument(payloadNode),
            ProcessedAt = DateTimeOffset.UtcNow,
        });

        return true;
    }

    private async Task<(ProcessingJob Job, Chart Chart)?> LoadContextAsync(
        ProcessingEventPayload payload,
        CancellationToken cancellationToken)
    {
        ProcessingJob? job = null;
        if (payload.JobId is long jobId)
        {
            job = await _db.ProcessingJobs.FirstOrDefaultAsync(item => item.Id == jobId, cancellationToken);
        }

        if (job is null && !string.IsNullOrWhiteSpace(payload.RequestMessageId))
        {
            job = await _db.ProcessingJobs.FirstOrDefaultAsync(item => item.MessageId == payload.RequestMessageId, cancellationToken);
        }

        if (job is null && payload.ChartId is int chartId)
        {
            job = await _db.ProcessingJobs
                .Where(item => item.ChartId == chartId)
                .OrderByDescending(item => item.CreatedAt)
                .ThenByDescending(item => item.Id)
                .FirstOrDefaultAsync(cancellationToken);
        }

        if (job is null)
        {
            _logger.LogWarning("MQTT event ignored because processing job was not found. JobId={JobId}, ChartId={ChartId}", payload.JobId, payload.ChartId);
            return null;
        }

        var chart = await _db.Charts.FirstOrDefaultAsync(item => item.Id == job.ChartId, cancellationToken);
        if (chart is null)
        {
            _logger.LogWarning("MQTT event ignored because chart {ChartId} was not found for job {JobId}.", job.ChartId, job.Id);
            return null;
        }

        return (job, chart);
    }

    private static bool MatchesCurrentAttempt(ProcessingJob job, ProcessingEventPayload payload)
    {
        if (string.IsNullOrWhiteSpace(payload.RequestMessageId) || string.IsNullOrWhiteSpace(job.MessageId))
        {
            return true;
        }

        // Старые ответы не должны перезаписывать новую попытку обработки.
        return string.Equals(payload.RequestMessageId, job.MessageId, StringComparison.Ordinal);
    }

    private bool ShouldRetryFailedEvent(ProcessingJob job, ProcessingRetryPolicy retryPolicy) =>
        retryPolicy.Retryable && job.Attempt < retryPolicy.MaxAttempts;

    private static string BuildWorkerRetryReason(ProcessingEventPayload payload)
    {
        var normalizedCode = NormalizeFailedErrorCode(payload);
        var code = $"Worker failure [{normalizedCode}]";

        if (string.IsNullOrWhiteSpace(payload.ErrorMessage))
        {
            return code;
        }

        return $"{code}: {TrimError(payload.ErrorMessage)}";
    }

    private static string NormalizeFailedErrorCode(ProcessingEventPayload payload)
    {
        if (string.IsNullOrWhiteSpace(payload.ErrorCode))
        {
            return ProcessingErrorCatalog.Codes.UnexpectedWorkerError;
        }

        return ProcessingErrorCatalog.NormalizeWorkerCode(payload.ErrorCode);
    }

    private ProcessingRetryPolicy GetWorkerFailurePolicy(ProcessingEventPayload payload) =>
        ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(
            _options,
            NormalizeFailedErrorCode(payload),
            payload.Retryable);

    private async Task<(JsonObject? ResultJson, bool LoadedFromStorage)> ResolveResultJsonAsync(
        Chart chart,
        ProcessingEventPayload payload,
        CancellationToken cancellationToken)
    {
        if (payload.ResultJson is JsonObject inlineResultJson)
        {
            return (inlineResultJson, false);
        }

        if (!string.IsNullOrWhiteSpace(payload.ResultJsonPath))
        {
            var storedResultJson = await _chartStorageService.ReadJsonObjectAsync(chart, payload.ResultJsonPath, cancellationToken);
            return (storedResultJson, true);
        }

        return (null, false);
    }

    private static (int Panels, int Series) CountPanelsAndSeries(JsonObject resultJson)
    {
        if (resultJson["panels"] is not JsonArray panels)
        {
            return (0, 0);
        }

        var seriesCount = 0;
        foreach (var panelNode in panels)
        {
            if (panelNode is JsonObject panel && panel["series"] is JsonArray series)
            {
                seriesCount += series.Count;
            }
        }

        return (panels.Count, seriesCount);
    }

    private static bool IsTerminal(string? status) =>
        string.Equals(status, "done", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, "error", StringComparison.OrdinalIgnoreCase);

    private static string? TrimError(string? errorMessage)
    {
        if (string.IsNullOrWhiteSpace(errorMessage))
        {
            return null;
        }

        return errorMessage.Length <= 2000 ? errorMessage : errorMessage[..2000];
    }

    private static bool LooksLikeDuplicateInboxMessage(DbUpdateException ex, string? messageId)
    {
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return false;
        }

        return ex.InnerException?.Message?.Contains("ix_mqtt_messages_direction_message_id", StringComparison.OrdinalIgnoreCase) == true
            || ex.Message.Contains("ix_mqtt_messages_direction_message_id", StringComparison.OrdinalIgnoreCase);
    }
}
