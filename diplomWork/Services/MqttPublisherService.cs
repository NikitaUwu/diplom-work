using DiplomWork.Configuration;
using MQTTnet;
using MQTTnet.Formatter;
using MQTTnet.Protocol;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DiplomWork.Services;

public sealed class MqttPublisherService
{
    private readonly AppOptions _options;
    private readonly ILogger<MqttPublisherService> _logger;

    public MqttPublisherService(AppOptions options, ILogger<MqttPublisherService> logger)
    {
        _options = options;
        _logger = logger;
    }

    public bool IsEnabled => _options.MqttEnabled;

    public async Task PublishProcessRequestAsync(JsonNode payload, CancellationToken cancellationToken = default)
    {
        await PublishAsync(_options.MqttProcessRequestTopic, payload, cancellationToken);
    }

    public async Task PublishAsync(string topic, JsonNode payload, CancellationToken cancellationToken = default)
    {
        if (!_options.MqttEnabled)
        {
            return;
        }

        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();

        var builder = new MqttClientOptionsBuilder()
            .WithTcpServer(_options.MqttHost, _options.MqttPort)
            .WithClientId($"{_options.MqttClientIdPrefix}-{Guid.NewGuid():N}")
            .WithProtocolVersion(MqttProtocolVersion.V311)
            .WithCleanSession();

        if (!string.IsNullOrWhiteSpace(_options.MqttUsername))
        {
            builder.WithCredentials(_options.MqttUsername, _options.MqttPassword);
        }

        var options = builder.Build();
        await client.ConnectAsync(options, cancellationToken);

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithPayload(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)))
            .Build();

        await client.PublishAsync(message, cancellationToken);
        await client.DisconnectAsync(cancellationToken: cancellationToken);
        _logger.LogInformation("Published MQTT message to topic {Topic}.", topic);
    }
}
