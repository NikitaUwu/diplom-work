namespace DiplomWork.Models;

public static class UserRoles
{
    public const string User = "user";
    public const string Admin = "admin";

    public static bool IsAdmin(string? role) =>
        string.Equals(Normalize(role), Admin, StringComparison.OrdinalIgnoreCase);

    public static string Normalize(string? role)
    {
        var normalized = role?.Trim().ToLowerInvariant();
        return normalized switch
        {
            Admin => Admin,
            User => User,
            _ => User,
        };
    }
}
