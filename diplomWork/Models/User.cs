namespace DiplomWork.Models;

public sealed class User
{
    public int Id { get; set; }

    public string Email { get; set; } = string.Empty;

    public string HashedPassword { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public string Role { get; set; } = UserRoles.User;

    public DateTimeOffset CreatedAt { get; set; }
}
