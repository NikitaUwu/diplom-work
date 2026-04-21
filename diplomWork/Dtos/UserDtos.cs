namespace DiplomWork.Dtos;

public sealed class UserReadResponse
{
    public int Id { get; set; }

    public string Email { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public string Role { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }
}
