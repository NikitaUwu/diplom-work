namespace DiplomWork.Services;

public sealed class MqttOutboxSignal
{
    private readonly SemaphoreSlim _signal = new(0);

    public void Notify()
    {
        _signal.Release();
    }

    public async Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        await _signal.WaitAsync(timeout, cancellationToken);
    }
}
