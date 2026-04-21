using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Dtos;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class AuthService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly PasswordService _passwordService;
    private readonly TokenService _tokenService;

    public AuthService(AppDbContext db, AppOptions options, PasswordService passwordService, TokenService tokenService)
    {
        _db = db;
        _options = options;
        _passwordService = passwordService;
        _tokenService = tokenService;
    }

    public async Task<UserReadResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email.Trim();
        var exists = await _db.Users.AnyAsync(item => item.Email == email, cancellationToken);
        if (exists)
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "User with this email already exists");
        }

        var user = new User
        {
            Email = email,
            HashedPassword = _passwordService.HashPassword(request.Password),
            IsActive = true,
            Role = _options.AdminEmails.Contains(email, StringComparer.OrdinalIgnoreCase)
                ? UserRoles.Admin
                : UserRoles.User,
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(cancellationToken);
        return ToUserRead(user);
    }

    public async Task<TokenResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email.Trim();
        var user = await _db.Users.FirstOrDefaultAsync(item => item.Email == email, cancellationToken);
        if (user is null || !user.IsActive || !_passwordService.VerifyPassword(request.Password, user.HashedPassword))
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "Incorrect email or password");
        }

        return new TokenResponse
        {
            AccessToken = _tokenService.CreateAccessToken(user.Id.ToString()),
        };
    }

    public static UserReadResponse ToUserRead(User user) =>
        new()
        {
            Id = user.Id,
            Email = user.Email,
            IsActive = user.IsActive,
            Role = UserRoles.Normalize(user.Role),
            CreatedAt = user.CreatedAt,
        };
}
