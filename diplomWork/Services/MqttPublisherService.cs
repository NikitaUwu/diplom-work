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
    private readonly MqttClientFactory _factory = new();
    private readonly SemaphoreSlim _clientLock = new(1, 1);
    private readonly string _clientId;
    private IMqttClient? _client;
    private MqttClientOptions? _clientOptions;

    public MqttPublisherService(AppOptions options, ILogger<MqttPublisherService> logger)
    {
        _options = options;
        _logger = logger;
        _clientId = $"{_options.MqttClientIdPrefix}-publisher-{Guid.NewGuid():N}";
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

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithPayload(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)))
            .Build();

        await _clientLock.WaitAsync(cancellationToken);
        try
        {
            var client = await GetConnectedClientAsync(cancellationToken);
            await client.PublishAsync(message, cancellationToken);
            _logger.LogInformation("Published MQTT message to topic {Topic}.", topic);
        }
        finally
        {
            _clientLock.Release();
        }
    }

    private async Task<IMqttClient> GetConnectedClientAsync(CancellationToken cancellationToken)
    {
        _client ??= _factory.CreateMqttClient();

        if (_client.IsConnected)
        {
            return _client;
        }

        _clientOptions ??= BuildClientOptions();
        await _client.ConnectAsync(_clientOptions, cancellationToken);
        _logger.LogInformation("MQTT publisher connected to {Host}:{Port}.", _options.MqttHost, _options.MqttPort);
        return _client;
    }

    private MqttClientOptions BuildClientOptions()
    {
        var builder = new MqttClientOptionsBuilder()
            .WithTcpServer(_options.MqttHost, _options.MqttPort)
            .WithClientId(_clientId)
            .WithProtocolVersion(MqttProtocolVersion.V311)
            .WithCleanSession();

        if (!string.IsNullOrWhiteSpace(_options.MqttUsername))
        {
            builder.WithCredentials(_options.MqttUsername, _options.MqttPassword);
        }

        return builder.Build();
    }
}
