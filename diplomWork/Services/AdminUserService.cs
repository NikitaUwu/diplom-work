using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class AdminUserService
{
    private readonly AppDbContext _db;

    public AdminUserService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<AdminUserReadResponse>> ListUsersAsync(CancellationToken cancellationToken = default)
    {
        var users = await _db.Users
            .AsNoTracking()
            .OrderBy(item => item.CreatedAt)
            .ThenBy(item => item.Email)
            .ToListAsync(cancellationToken);

        return users.Select(ToAdminUserRead).ToList();
    }

    public async Task<AdminUserReadResponse> UpdateRoleAsync(int userId, UpdateUserRoleRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedRole = NormalizeRequestedRole(request.Role);
        var user = await _db.Users.FirstOrDefaultAsync(item => item.Id == userId, cancellationToken);
        if (user is null)
        {
            throw new ApiProblemException(StatusCodes.Status404NotFound, "User not found");
        }

        var currentRole = UserRoles.Normalize(user.Role);
        if (currentRole == normalizedRole)
        {
            return ToAdminUserRead(user);
        }

        if (currentRole == UserRoles.Admin && normalizedRole != UserRoles.Admin)
        {
            var hasAnotherActiveAdmin = await _db.Users.AnyAsync(
                item => item.Id != user.Id && item.IsActive && item.Role == UserRoles.Admin,
                cancellationToken);

            if (!hasAnotherActiveAdmin)
            {
                throw new ApiProblemException(StatusCodes.Status400BadRequest, "Cannot demote the last active admin user");
            }
        }

        user.Role = normalizedRole;
        await _db.SaveChangesAsync(cancellationToken);
        return ToAdminUserRead(user);
    }

    public static AdminUserReadResponse ToAdminUserRead(User user) =>
        new()
        {
            Id = user.Id,
            Email = user.Email,
            IsActive = user.IsActive,
            Role = UserRoles.Normalize(user.Role),
            CreatedAt = user.CreatedAt,
        };

    private static string NormalizeRequestedRole(string? requestedRole)
    {
        var normalized = requestedRole?.Trim().ToLowerInvariant();
        return normalized switch
        {
            UserRoles.Admin => UserRoles.Admin,
            UserRoles.User => UserRoles.User,
            _ => throw new ApiProblemException(StatusCodes.Status400BadRequest, "Unsupported user role"),
        };
    }
}
