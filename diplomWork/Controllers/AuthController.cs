using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Controllers;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly AppOptions _options;
    private readonly AuthService _authService;
    private readonly CurrentUserService _currentUserService;

    public AuthController(AppOptions options, AuthService authService, CurrentUserService currentUserService)
    {
        _options = options;
        _authService = authService;
        _currentUserService = currentUserService;
    }

    [HttpPost("register")]
    [ProducesResponseType(typeof(UserReadResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<UserReadResponse>> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        var user = await _authService.RegisterAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, user);
    }

    [HttpPost("login")]
    public async Task<ActionResult<TokenResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var token = await _authService.LoginAsync(request, cancellationToken);
        Response.Cookies.Append(_options.AuthCookieName, token.AccessToken, new CookieOptions
        {
            HttpOnly = true,
            SameSite = _options.CookieSameSiteMode,
            Secure = _options.CookieSecure,
            Path = "/",
            MaxAge = TimeSpan.FromSeconds(_options.CookieMaxAge),
        });
        return token;
    }

    [HttpPost("logout")]
    public ActionResult<object> Logout()
    {
        Response.Cookies.Delete(_options.AuthCookieName, new CookieOptions { Path = "/" });
        return new { ok = true };
    }

    [HttpGet("me")]
    public async Task<ActionResult<UserReadResponse>> Me(CancellationToken cancellationToken)
    {
        var user = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        return AuthService.ToUserRead(user);
    }
}
