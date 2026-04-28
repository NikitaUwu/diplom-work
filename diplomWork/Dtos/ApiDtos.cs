namespace DiplomWork.Dtos;

/// <summary>
/// Стандартная структура ошибки API, возвращаемая сервером.
/// </summary>
public sealed class ApiErrorResponse
{
    public string Detail { get; set; } = string.Empty;
}

/// <summary>
/// Простой ответ об успешном выполнении для методов, которые только подтверждают действие.
/// </summary>
public sealed class OperationStatusResponse
{
    public bool Ok { get; set; }
}
