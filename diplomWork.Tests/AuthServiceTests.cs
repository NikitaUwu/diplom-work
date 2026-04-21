using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DiplomWork.Tests;

public sealed class AuthServiceTests
{
    [Fact]
    public async Task RegisterAsync_AssignsAdminRole_WhenEmailConfiguredInBootstrapList()
    {
        await using var db = CreateDbContext();
        var options = CreateOptions(adminEmails: ["admin@example.com"]);
        var service = new AuthService(db, options, new PasswordService(), new TokenService(options));

        var response = await service.RegisterAsync(new RegisterRequest
        {
            Email = "admin@example.com",
            Password = "secret123",
        });

        var storedUser = await db.Users.SingleAsync();
        Assert.Equal(UserRoles.Admin, storedUser.Role);
        Assert.Equal(UserRoles.Admin, response.Role);
    }

    [Fact]
    public async Task RegisterAsync_AssignsUserRole_ByDefault()
    {
        await using var db = CreateDbContext();
        var options = CreateOptions();
        var service = new AuthService(db, options, new PasswordService(), new TokenService(options));

        var response = await service.RegisterAsync(new RegisterRequest
        {
            Email = "user@example.com",
            Password = "secret123",
        });

        var storedUser = await db.Users.SingleAsync();
        Assert.Equal(UserRoles.User, storedUser.Role);
        Assert.Equal(UserRoles.User, response.Role);
    }

    private static TestAppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TestAppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new TestAppDbContext(options);
    }

    private static AppOptions CreateOptions(string[]? adminEmails = null) =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            AdminEmails = adminEmails ?? [],
        };
}
