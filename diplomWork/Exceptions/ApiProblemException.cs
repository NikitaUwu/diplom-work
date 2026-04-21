namespace DiplomWork.Exceptions;

public sealed class ApiProblemException : Exception
{
    public ApiProblemException(int statusCode, string detail)
        : base(detail)
    {
        StatusCode = statusCode;
        Detail = detail;
    }

    public int StatusCode { get; }

    public string Detail { get; }
}
