using DiplomWork.Configuration;
using DiplomWork.Dtos;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Controllers;

/// <summary>
/// Методы аутентификации для регистрации, входа и получения текущего пользователя.
/// </summary>
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

    /// <summary>
    /// Регистрирует новую учётную запись пользователя.
    /// </summary>
    [HttpPost("register")]
    [ProducesResponseType(typeof(UserReadResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<UserReadResponse>> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        var user = await _authService.RegisterAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, user);
    }

    /// <summary>
    /// Выполняет вход пользователя и возвращает токен доступа.
    /// </summary>
    [HttpPost("login")]
    [ProducesResponseType(typeof(TokenResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
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

    /// <summary>
    /// Удаляет cookie аутентификации для текущего клиента.
    /// </summary>
    [HttpPost("logout")]
    [ProducesResponseType(typeof(OperationStatusResponse), StatusCodes.Status200OK)]
    public ActionResult<OperationStatusResponse> Logout()
    {
        Response.Cookies.Delete(_options.AuthCookieName, new CookieOptions { Path = "/" });
        return new OperationStatusResponse { Ok = true };
    }

    /// <summary>
    /// Возвращает текущего аутентифицированного пользователя.
    /// </summary>
    [HttpGet("me")]
    [ProducesResponseType(typeof(UserReadResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<UserReadResponse>> Me(CancellationToken cancellationToken)
    {
        var user = await _currentUserService.RequireCurrentUserAsync(HttpContext, cancellationToken);
        return AuthService.ToUserRead(user);
    }
}
