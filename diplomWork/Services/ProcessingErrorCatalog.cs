namespace DiplomWork.Services;

public static class ProcessingErrorCatalog
{
    public static class Codes
    {
        public const string InputFileMissing = "input_file_missing";
        public const string StoragePermissionDenied = "storage_permission_denied";
        public const string PipelineOutputInvalid = "pipeline_output_invalid";
        public const string ModalBackendUnavailable = "modal_backend_unavailable";
        public const string NetworkTimeout = "network_timeout";
        public const string UnexpectedWorkerError = "unexpected_worker_error";
        public const string ProcessingLeaseExpired = "processing_lease_expired";
    }

    private static readonly HashSet<string> RetryableWorkerCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        Codes.ModalBackendUnavailable,
        Codes.NetworkTimeout,
    };

    public static string NormalizeWorkerCode(string? rawCode)
    {
        if (string.IsNullOrWhiteSpace(rawCode))
        {
            return Codes.UnexpectedWorkerError;
        }

        return rawCode.Trim().ToLowerInvariant() switch
        {
            Codes.InputFileMissing => Codes.InputFileMissing,
            Codes.StoragePermissionDenied => Codes.StoragePermissionDenied,
            Codes.PipelineOutputInvalid => Codes.PipelineOutputInvalid,
            Codes.ModalBackendUnavailable => Codes.ModalBackendUnavailable,
            Codes.NetworkTimeout => Codes.NetworkTimeout,
            Codes.UnexpectedWorkerError => Codes.UnexpectedWorkerError,
            _ => Codes.UnexpectedWorkerError,
        };
    }

    public static bool IsRetryableWorkerCode(string code) =>
        RetryableWorkerCodes.Contains(NormalizeWorkerCode(code));
}
