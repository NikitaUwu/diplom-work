using DiplomWork.Configuration;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using Microsoft.Extensions.Hosting;

namespace DiplomWork.Services;

public sealed class AdminAccessService
{
    private readonly CurrentUserService _currentUserService;
    private readonly AppOptions _options;
    private readonly IHostEnvironment _hostEnvironment;

    public AdminAccessService(
        CurrentUserService currentUserService,
        AppOptions options,
        IHostEnvironment hostEnvironment)
    {
        _currentUserService = currentUserService;
        _options = options;
        _hostEnvironment = hostEnvironment;
    }

    public async Task<User> RequireAdminAsync(HttpContext httpContext, CancellationToken cancellationToken = default)
    {
        var user = await _currentUserService.RequireCurrentUserAsync(httpContext, cancellationToken);
        if (IsAdmin(user))
        {
            return user;
        }

        throw new ApiProblemException(StatusCodes.Status403Forbidden, "Admin access required");
    }

    public bool IsAdmin(User user)
    {
        if (!_options.AuthEnabled)
        {
            return true;
        }

        if (UserRoles.IsAdmin(user.Role))
        {
            return true;
        }

        return _hostEnvironment.IsDevelopment() && _options.AdminEmails.Length == 0;
    }
}
