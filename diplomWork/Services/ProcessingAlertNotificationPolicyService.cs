using DiplomWork.Configuration;
using DiplomWork.Models;

namespace DiplomWork.Services;

public sealed class ProcessingAlertNotificationPolicyService
{
    private readonly AppOptions _options;

    public ProcessingAlertNotificationPolicyService(AppOptions options)
    {
        _options = options;
    }

    public bool ShouldNotify(ProcessingAlertEvent alertEvent)
    {
        if (!_options.ProcessingAlertNotifierEventTypes.Contains(alertEvent.EventType, StringComparer.OrdinalIgnoreCase))
        {
            return false;
        }

        return GetSeverityRank(alertEvent.Severity) >= GetSeverityRank(_options.ProcessingAlertNotifierMinimumSeverity);
    }

    public static int GetSeverityRank(string? severity)
    {
        var normalized = severity?.Trim().ToLowerInvariant();
        return normalized switch
        {
            "critical" => 3,
            "warning" => 2,
            _ => 1,
        };
    }
}
