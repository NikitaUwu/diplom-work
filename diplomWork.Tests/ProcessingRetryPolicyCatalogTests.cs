using DiplomWork.Configuration;
using DiplomWork.Services;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingRetryPolicyCatalogTests
{
    [Fact]
    public void ResolveForWorkerFailure_UsesModalSpecificPolicy()
    {
        var options = CreateOptions();

        var policy = ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(
            options,
            ProcessingErrorCatalog.Codes.ModalBackendUnavailable);

        Assert.True(policy.Retryable);
        Assert.Equal(7, policy.MaxAttempts);
        Assert.Equal(30, policy.RetryDelaySeconds);
    }

    [Fact]
    public void ResolveForWorkerFailure_UsesNetworkSpecificPolicy()
    {
        var options = CreateOptions();

        var policy = ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(
            options,
            ProcessingErrorCatalog.Codes.NetworkTimeout);

        Assert.True(policy.Retryable);
        Assert.Equal(4, policy.MaxAttempts);
        Assert.Equal(12, policy.RetryDelaySeconds);
    }

    [Fact]
    public void ResolveForWorkerFailure_UsesFallbackPolicy_WhenRetryableFlagProvidedForUnknownCode()
    {
        var options = CreateOptions();

        var policy = ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(
            options,
            null,
            retryableFallback: true);

        Assert.True(policy.Retryable);
        Assert.Equal(3, policy.MaxAttempts);
        Assert.Equal(15, policy.RetryDelaySeconds);
        Assert.Equal(ProcessingErrorCatalog.Codes.UnexpectedWorkerError, policy.ErrorCode);
    }

    [Fact]
    public void ResolveForWorkerFailure_LeavesInputFileMissingTerminal()
    {
        var options = CreateOptions();

        var policy = ProcessingRetryPolicyCatalog.ResolveForWorkerFailure(
            options,
            ProcessingErrorCatalog.Codes.InputFileMissing,
            retryableFallback: true);

        Assert.False(policy.Retryable);
        Assert.Equal(ProcessingErrorCatalog.Codes.InputFileMissing, policy.ErrorCode);
    }

    private static AppOptions CreateOptions() =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            ProcessingMaxAttempts = 3,
            ProcessingRetryDelaySeconds = 15,
            ProcessingRetryModalBackendUnavailableMaxAttempts = 7,
            ProcessingRetryModalBackendUnavailableDelaySeconds = 30,
            ProcessingRetryNetworkTimeoutMaxAttempts = 4,
            ProcessingRetryNetworkTimeoutDelaySeconds = 12,
        };
}
