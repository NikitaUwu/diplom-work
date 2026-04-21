using DiplomWork.Configuration;

namespace DiplomWork.Services;

public sealed record ProcessingRetryPolicy(
    string ErrorCode,
    bool Retryable,
    int MaxAttempts,
    int RetryDelaySeconds);

public static class ProcessingRetryPolicyCatalog
{
    public static ProcessingRetryPolicy ResolveForLeaseExpiry(AppOptions options) =>
        new(
            ProcessingErrorCatalog.Codes.ProcessingLeaseExpired,
            Retryable: true,
            MaxAttempts: options.ProcessingMaxAttempts,
            RetryDelaySeconds: options.ProcessingRetryDelaySeconds);

    public static ProcessingRetryPolicy ResolveForWorkerFailure(
        AppOptions options,
        string? rawErrorCode,
        bool? retryableFallback = null)
    {
        var errorCode = ProcessingErrorCatalog.NormalizeWorkerCode(rawErrorCode);
        return errorCode switch
        {
            ProcessingErrorCatalog.Codes.ModalBackendUnavailable => new(
                errorCode,
                Retryable: true,
                MaxAttempts: options.ProcessingRetryModalBackendUnavailableMaxAttempts,
                RetryDelaySeconds: options.ProcessingRetryModalBackendUnavailableDelaySeconds),

            ProcessingErrorCatalog.Codes.NetworkTimeout => new(
                errorCode,
                Retryable: true,
                MaxAttempts: options.ProcessingRetryNetworkTimeoutMaxAttempts,
                RetryDelaySeconds: options.ProcessingRetryNetworkTimeoutDelaySeconds),

            ProcessingErrorCatalog.Codes.InputFileMissing => NonRetryable(errorCode, options),
            ProcessingErrorCatalog.Codes.StoragePermissionDenied => NonRetryable(errorCode, options),
            ProcessingErrorCatalog.Codes.PipelineOutputInvalid => NonRetryable(errorCode, options),
            ProcessingErrorCatalog.Codes.UnexpectedWorkerError => new(
                errorCode,
                Retryable: retryableFallback ?? false,
                MaxAttempts: options.ProcessingMaxAttempts,
                RetryDelaySeconds: options.ProcessingRetryDelaySeconds),

            _ => NonRetryable(errorCode, options),
        };
    }

    private static ProcessingRetryPolicy NonRetryable(string errorCode, AppOptions options) =>
        new(
            errorCode,
            Retryable: false,
            MaxAttempts: options.ProcessingMaxAttempts,
            RetryDelaySeconds: options.ProcessingRetryDelaySeconds);
}
