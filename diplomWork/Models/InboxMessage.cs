using System.Text.Json;

namespace DiplomWork.Models;

public sealed class InboxMessage
{
    public long Id { get; set; }

    public string MessageId { get; set; } = string.Empty;

    public string Topic { get; set; } = string.Empty;

    public JsonDocument? Payload { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
