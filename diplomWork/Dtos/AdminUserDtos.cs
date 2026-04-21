using System.ComponentModel.DataAnnotations;

namespace DiplomWork.Dtos;

public sealed class AdminUserReadResponse
{
    public int Id { get; set; }

    public string Email { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public string Role { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class UpdateUserRoleRequest
{
    [Required]
    public string Role { get; set; } = string.Empty;
}
