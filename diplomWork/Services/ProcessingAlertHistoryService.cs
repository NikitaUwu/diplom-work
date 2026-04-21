using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class ProcessingAlertHistoryService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;

    public ProcessingAlertHistoryService(AppDbContext db, AppOptions options)
    {
        _db = db;
        _options = options;
    }

    public async Task<int> CaptureSnapshotAsync(ProcessingAlertsResponse snapshot, CancellationToken cancellationToken = default)
    {
        var now = snapshot.GeneratedAt == default ? DateTimeOffset.UtcNow : snapshot.GeneratedAt;
        var activeAlerts = snapshot.Alerts
            .GroupBy(item => item.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.OrdinalIgnoreCase);

        var states = await _db.ProcessingAlertStates.ToListAsync(cancellationToken);
        var stateByCode = states.ToDictionary(item => item.AlertCode, StringComparer.OrdinalIgnoreCase);
        var createdEvents = 0;

        foreach (var alert in activeAlerts.Values)
        {
            var samplesText = SerializeSamples(alert.Samples);
            if (!stateByCode.TryGetValue(alert.Code, out var state))
            {
                state = new ProcessingAlertState
                {
                    AlertCode = alert.Code,
                    CreatedAt = now,
                };

                _db.ProcessingAlertStates.Add(state);
                stateByCode[alert.Code] = state;
            }

            if (!state.IsActive)
            {
                ApplyAlertState(state, alert, now, isActive: true);
                state.FirstActivatedAt = now;
                state.LastResolvedAt = null;
                _db.ProcessingAlertEvents.Add(CreateEvent(alert, "activated", samplesText, now));
                createdEvents++;
                continue;
            }

            var severityChanged = !string.Equals(state.Severity, alert.Severity, StringComparison.OrdinalIgnoreCase);
            ApplyAlertState(state, alert, now, isActive: true);
            state.SamplesText = samplesText;

            if (severityChanged)
            {
                _db.ProcessingAlertEvents.Add(CreateEvent(alert, "severity_changed", samplesText, now));
                createdEvents++;
            }
        }

        foreach (var state in states.Where(item => item.IsActive && !activeAlerts.ContainsKey(item.AlertCode)))
        {
            state.IsActive = false;
            state.LastObservedAt = now;
            state.LastResolvedAt = now;
            state.UpdatedAt = now;
            _db.ProcessingAlertEvents.Add(new ProcessingAlertEvent
            {
                AlertCode = state.AlertCode,
                EventType = "resolved",
                Severity = state.Severity,
                Message = state.Message,
                Count = state.LastCount,
                SamplesText = state.SamplesText,
                NotificationStatus = "pending",
                NotificationNextAttemptAt = now,
                CreatedAt = now,
            });
            createdEvents++;
        }

        if (_db.ChangeTracker.HasChanges())
        {
            await _db.SaveChangesAsync(cancellationToken);
        }

        return createdEvents;
    }

    public async Task<List<ProcessingAlertEventReadResponse>> GetRecentEventsAsync(int? limit = null, CancellationToken cancellationToken = default)
    {
        var take = Math.Max(1, limit ?? _options.ProcessingAlertHistoryItemLimit);
        var items = await _db.ProcessingAlertEvents
            .AsNoTracking()
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .Take(take)
            .ToListAsync(cancellationToken);

        return items
            .Select(item => new ProcessingAlertEventReadResponse
            {
                Id = item.Id,
                AlertCode = item.AlertCode,
                EventType = item.EventType,
                Severity = item.Severity,
                Message = item.Message,
                Count = item.Count,
                Samples = DeserializeSamples(item.SamplesText),
                NotificationStatus = item.NotificationStatus,
                NotificationAttemptCount = item.NotificationAttemptCount,
                LastNotificationAttemptAt = item.LastNotificationAttemptAt,
                NotificationNextAttemptAt = item.NotificationNextAttemptAt,
                NotifiedAt = item.NotifiedAt,
                NotificationError = item.NotificationError,
                CreatedAt = item.CreatedAt,
            })
            .ToList();
    }

    private static void ApplyAlertState(ProcessingAlertState state, ProcessingAlertItem alert, DateTimeOffset now, bool isActive)
    {
        state.IsActive = isActive;
        state.Severity = alert.Severity;
        state.Message = alert.Message;
        state.LastCount = alert.Count;
        state.LastObservedAt = now;
        state.UpdatedAt = now;
    }

    private static ProcessingAlertEvent CreateEvent(ProcessingAlertItem alert, string eventType, string? samplesText, DateTimeOffset now) =>
        new()
        {
            AlertCode = alert.Code,
            EventType = eventType,
            Severity = alert.Severity,
            Message = alert.Message,
            Count = alert.Count,
            SamplesText = samplesText,
            NotificationStatus = "pending",
            NotificationNextAttemptAt = now,
            CreatedAt = now,
        };

    private static string? SerializeSamples(List<string> samples) =>
        samples.Count == 0 ? null : string.Join('\n', samples);

    private static List<string> DeserializeSamples(string? samplesText) =>
        string.IsNullOrWhiteSpace(samplesText)
            ? []
            : samplesText.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
