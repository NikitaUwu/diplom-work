using DiplomWork.Configuration;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using DiplomWork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace DiplomWork.Tests;

public sealed class AdminAccessServiceTests
{
    [Fact]
    public async Task RequireAdminAsync_AllowsAdminRole()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "admin@example.com", UserRoles.Admin);
        var bundle = CreateService(db, CreateOptions(adminEmails: ["admin@example.com"]), Environments.Production);

        var resolved = await bundle.Service.RequireAdminAsync(CreateHttpContext(bundle.TokenService, user.Id));

        Assert.Equal(user.Email, resolved.Email);
    }

    [Fact]
    public async Task RequireAdminAsync_RejectsAuthenticatedNonAdminInProduction()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "user@example.com", UserRoles.User);
        var bundle = CreateService(db, CreateOptions(adminEmails: ["admin@example.com"]), Environments.Production);

        var ex = await Assert.ThrowsAsync<ApiProblemException>(() =>
            bundle.Service.RequireAdminAsync(CreateHttpContext(bundle.TokenService, user.Id)));

        Assert.Equal(StatusCodes.Status403Forbidden, ex.StatusCode);
    }

    [Fact]
    public async Task RequireAdminAsync_AllowsAuthenticatedUserInDevelopment_WhenAllowlistIsEmpty()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "user@example.com", UserRoles.User);
        var bundle = CreateService(db, CreateOptions(adminEmails: []), Environments.Development);

        var resolved = await bundle.Service.RequireAdminAsync(CreateHttpContext(bundle.TokenService, user.Id));

        Assert.Equal(user.Id, resolved.Id);
    }

    [Fact]
    public async Task RequireAdminAsync_DoesNotGrantAdminByEmailWithoutRoleInProduction()
    {
        await using var db = CreateDbContext();
        var user = await CreateUserAsync(db, "admin@example.com", UserRoles.User);
        var bundle = CreateService(db, CreateOptions(adminEmails: ["admin@example.com"]), Environments.Production);

        var ex = await Assert.ThrowsAsync<ApiProblemException>(() =>
            bundle.Service.RequireAdminAsync(CreateHttpContext(bundle.TokenService, user.Id)));

        Assert.Equal(StatusCodes.Status403Forbidden, ex.StatusCode);
    }

    [Fact]
    public async Task RequireAdminAsync_AllowsDevUser_WhenAuthDisabled()
    {
        await using var db = CreateDbContext();
        var bundle = CreateService(db, CreateOptions(authEnabled: false), Environments.Production);
        var httpContext = new DefaultHttpContext();

        var resolved = await bundle.Service.RequireAdminAsync(httpContext);

        Assert.Equal("dev@local", resolved.Email);
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

    private static DefaultHttpContext CreateHttpContext(TokenService tokenService, int userId)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Authorization = $"Bearer {tokenService.CreateAccessToken(userId.ToString())}";
        return httpContext;
    }

    private static ServiceBundle CreateService(TestAppDbContext db, AppOptions options, string environmentName)
    {
        var passwordService = new PasswordService();
        var tokenService = new TokenService(options);
        var currentUserService = new CurrentUserService(db, options, passwordService, tokenService);
        var adminAccessService = new AdminAccessService(
            currentUserService,
            options,
            new TestHostEnvironment(environmentName));

        return new ServiceBundle(adminAccessService, tokenService);
    }

    private static AppOptions CreateOptions(bool authEnabled = true, string[]? adminEmails = null) =>
        new()
        {
            DatabaseUrl = "Host=localhost;Database=test;",
            JwtSecretKey = "test-secret-value-1234567890-extra-bytes-for-hs256",
            StorageDir = Path.GetTempPath(),
            WorkerRunsRoot = Path.GetTempPath(),
            AuthEnabled = authEnabled,
            DevUserEmail = "dev@local",
            DevUserPassword = "devpass",
            AdminEmails = adminEmails ?? [],
        };

    private sealed record ServiceBundle(AdminAccessService Service, TokenService TokenService);

    private sealed class TestHostEnvironment : IWebHostEnvironment
    {
        public TestHostEnvironment(string environmentName)
        {
            EnvironmentName = environmentName;
        }

        public string ApplicationName { get; set; } = "diplomWork.Tests";

        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();

        public string WebRootPath { get; set; } = AppContext.BaseDirectory;

        public string EnvironmentName { get; set; }

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
