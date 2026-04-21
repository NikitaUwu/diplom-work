using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace DiplomWork.Services;

public sealed class CurrentUserService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly PasswordService _passwordService;
    private readonly TokenService _tokenService;

    public CurrentUserService(
        AppDbContext db,
        AppOptions options,
        PasswordService passwordService,
        TokenService tokenService)
    {
        _db = db;
        _options = options;
        _passwordService = passwordService;
        _tokenService = tokenService;
    }

    public async Task<User> RequireCurrentUserAsync(HttpContext httpContext, CancellationToken cancellationToken = default)
    {
        if (!_options.AuthEnabled)
        {
            return await GetOrCreateDevUserAsync(cancellationToken);
        }

        var token = GetRequestToken(httpContext.Request);
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new ApiProblemException(StatusCodes.Status401Unauthorized, "Not authenticated");
        }

        var principal = _tokenService.ValidateToken(token);
        var subject = principal.Claims.FirstOrDefault(claim => claim.Type == JwtRegisteredClaimNames.Sub)?.Value
            ?? principal.Claims.FirstOrDefault(claim => claim.Type == "sub")?.Value
            ?? principal.Claims.FirstOrDefault(claim => claim.Type == ClaimTypes.NameIdentifier)?.Value;

        if (!int.TryParse(subject, out var userId))
        {
            throw new ApiProblemException(StatusCodes.Status401Unauthorized, "Could not validate credentials");
        }

        var user = await _db.Users.FirstOrDefaultAsync(item => item.Id == userId, cancellationToken);
        if (user is null || !user.IsActive)
        {
            throw new ApiProblemException(StatusCodes.Status401Unauthorized, "Could not validate credentials");
        }

        return user;
    }

    private string? GetRequestToken(HttpRequest request)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (!string.IsNullOrWhiteSpace(authorization) &&
            authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return authorization["Bearer ".Length..].Trim();
        }

        return request.Cookies.TryGetValue(_options.AuthCookieName, out var cookieToken)
            ? cookieToken
            : null;
    }

    private async Task<User> GetOrCreateDevUserAsync(CancellationToken cancellationToken)
    {
        var user = await _db.Users.FirstOrDefaultAsync(item => item.Email == _options.DevUserEmail, cancellationToken);
        if (user is not null)
        {
            if (!user.IsActive)
            {
                user.IsActive = true;
            }

            if (!UserRoles.IsAdmin(user.Role))
            {
                user.Role = UserRoles.Admin;
            }

            if (_db.ChangeTracker.HasChanges())
            {
                await _db.SaveChangesAsync(cancellationToken);
            }

            return user;
        }

        user = new User
        {
            Email = _options.DevUserEmail,
            HashedPassword = _passwordService.HashPassword(_options.DevUserPassword),
            IsActive = true,
            Role = UserRoles.Admin,
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(cancellationToken);
        return user;
    }
}
