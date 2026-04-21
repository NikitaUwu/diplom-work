using DiplomWork.Models;

namespace DiplomWork.Services;

public interface IProcessingAlertNotificationSender
{
    Task SendAsync(ProcessingAlertEvent alertEvent, CancellationToken cancellationToken = default);
}
