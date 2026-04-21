using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DiplomWork.Configuration;
using DiplomWork.Dtos;
using MQTTnet;
using MQTTnet.Formatter;

namespace DiplomWork.Services;

public sealed class MqttProcessingConsumerService : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly AppOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MqttProcessingConsumerService> _logger;

    public MqttProcessingConsumerService(
        AppOptions options,
        IServiceScopeFactory scopeFactory,
        ILogger<MqttProcessingConsumerService> logger)
    {
        _options = options;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.MqttEnabled)
        {
            _logger.LogInformation("MQTT processing consumer is disabled.");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunClientAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MQTT processing consumer failed. Retrying in 5 seconds.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task RunClientAsync(CancellationToken stoppingToken)
    {
        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();
        var disconnected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        client.ConnectedAsync += async _ =>
        {
            var subscribeOptions = factory.CreateSubscribeOptionsBuilder()
                .WithTopicFilter(filter => filter.WithTopic(_options.MqttProcessAcceptedTopic))
                .WithTopicFilter(filter => filter.WithTopic(_options.MqttProcessHeartbeatTopic))
                .WithTopicFilter(filter => filter.WithTopic(_options.MqttProcessCompletedTopic))
                .WithTopicFilter(filter => filter.WithTopic(_options.MqttProcessFailedTopic))
                .Build();

            await client.SubscribeAsync(subscribeOptions, CancellationToken.None);
            _logger.LogInformation(
                "MQTT processing consumer subscribed to {AcceptedTopic}, {HeartbeatTopic}, {CompletedTopic}, {FailedTopic}.",
                _options.MqttProcessAcceptedTopic,
                _options.MqttProcessHeartbeatTopic,
                _options.MqttProcessCompletedTopic,
                _options.MqttProcessFailedTopic);
        };

        client.DisconnectedAsync += _ =>
        {
            disconnected.TrySetResult();
            return Task.CompletedTask;
        };

        client.ApplicationMessageReceivedAsync += async args =>
        {
            await HandleMessageAsync(args.ApplicationMessage.Topic, args.ApplicationMessage.Payload.ToArray(), stoppingToken);
        };

        var builder = new MqttClientOptionsBuilder()
            .WithTcpServer(_options.MqttHost, _options.MqttPort)
            .WithClientId($"{_options.MqttClientIdPrefix}-consumer-{Guid.NewGuid():N}")
            .WithProtocolVersion(MqttProtocolVersion.V311)
            .WithCleanSession();

        if (!string.IsNullOrWhiteSpace(_options.MqttUsername))
        {
            builder.WithCredentials(_options.MqttUsername, _options.MqttPassword);
        }

        await client.ConnectAsync(builder.Build(), stoppingToken);
        _logger.LogInformation("MQTT processing consumer connected to {Host}:{Port}.", _options.MqttHost, _options.MqttPort);

        await Task.WhenAny(disconnected.Task, Task.Delay(Timeout.Infinite, stoppingToken));

        if (client.IsConnected)
        {
            await client.DisconnectAsync(cancellationToken: stoppingToken);
        }
    }

    private async Task HandleMessageAsync(string topic, byte[] payloadBytes, CancellationToken cancellationToken)
    {
        ProcessingEventPayload? payload;
        JsonNode? payloadNode;
        try
        {
            payload = JsonSerializer.Deserialize<ProcessingEventPayload>(payloadBytes, JsonOptions);
            payloadNode = JsonNode.Parse(Encoding.UTF8.GetString(payloadBytes));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse MQTT payload for topic {Topic}.", topic);
            return;
        }

        if (payload is null || (payload.JobId is null && payload.ChartId is null))
        {
            _logger.LogWarning("Ignoring MQTT payload without jobId/chartId on topic {Topic}.", topic);
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var stateService = scope.ServiceProvider.GetRequiredService<ProcessingJobStateService>();

        try
        {
            if (string.Equals(topic, _options.MqttProcessAcceptedTopic, StringComparison.Ordinal))
            {
                await stateService.ApplyAcceptedAsync(topic, payload, payloadNode, cancellationToken);
            }
            else if (string.Equals(topic, _options.MqttProcessHeartbeatTopic, StringComparison.Ordinal))
            {
                await stateService.ApplyHeartbeatAsync(payload, cancellationToken);
            }
            else if (string.Equals(topic, _options.MqttProcessCompletedTopic, StringComparison.Ordinal))
            {
                await stateService.ApplyCompletedAsync(topic, payload, payloadNode, cancellationToken);
            }
            else if (string.Equals(topic, _options.MqttProcessFailedTopic, StringComparison.Ordinal))
            {
                await stateService.ApplyFailedAsync(topic, payload, payloadNode, cancellationToken);
            }
            else
            {
                _logger.LogDebug("Ignoring MQTT message from unexpected topic {Topic}.", topic);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply MQTT processing event from topic {Topic}.", topic);
        }
    }
}
