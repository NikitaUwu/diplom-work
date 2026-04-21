using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class AdminUserServiceTests
{
    [Fact]
    public async Task ListUsersAsync_ReturnsNormalizedRoles()
    {
        await using var db = CreateDbContext();
        db.Users.Add(new User
        {
            Email = "user@example.com",
            HashedPassword = "hashed",
            IsActive = true,
            Role = "USER",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.Users.Add(new User
        {
            Email = "admin@example.com",
            HashedPassword = "hashed",
            IsActive = true,
            Role = "ADMIN",
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(1),
        });
        await db.SaveChangesAsync();

        var service = new AdminUserService(db);
        var users = await service.ListUsersAsync();

        Assert.Collection(users,
            item => Assert.Equal(UserRoles.User, item.Role),
            item => Assert.Equal(UserRoles.Admin, item.Role));
    }

    [Fact]
    public async Task UpdateRoleAsync_ChangesRole()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "user@example.com", UserRoles.User);
        var admin = await CreateUserAsync(db, "admin@example.com", UserRoles.Admin);
        _ = admin;

        var service = new AdminUserService(db);
        var result = await service.UpdateRoleAsync(user.Id, new UpdateUserRoleRequest { Role = UserRoles.Admin });

        Assert.Equal(UserRoles.Admin, result.Role);
        Assert.Equal(UserRoles.Admin, (await db.Users.SingleAsync(item => item.Id == user.Id)).Role);
    }

    [Fact]
    public async Task UpdateRoleAsync_RejectsDemotingLastActiveAdmin()
    {
        await using var db = CreateDbContext();
        var admin = await CreateUserAsync(db, "admin@example.com", UserRoles.Admin);
        var service = new AdminUserService(db);

        var ex = await Assert.ThrowsAsync<ApiProblemException>(() =>
            service.UpdateRoleAsync(admin.Id, new UpdateUserRoleRequest { Role = UserRoles.User }));

        Assert.Equal(StatusCodes.Status400BadRequest, ex.StatusCode);
    }

    [Fact]
    public async Task UpdateRoleAsync_RejectsUnsupportedRole()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "user@example.com", UserRoles.User);
        var admin = await CreateUserAsync(db, "admin@example.com", UserRoles.Admin);
        _ = admin;

        var service = new AdminUserService(db);
        var ex = await Assert.ThrowsAsync<ApiProblemException>(() =>
            service.UpdateRoleAsync(user.Id, new UpdateUserRoleRequest { Role = "operator" }));

        Assert.Equal(StatusCodes.Status400BadRequest, ex.StatusCode);
    }

    private static TestAppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TestAppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new TestAppDbContext(options);
    }

    private static async Task<User> CreateUserAsync(TestAppDbContext db, string email, string role)
    {
        var user = new User
        {
            Email = email,
            HashedPassword = "hashed",
            IsActive = true,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }
}
