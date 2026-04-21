using DiplomWork.Dtos;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Controllers;

[ApiController]
[Route("api/v1/admin/users")]
public sealed class AdminUsersController : ControllerBase
{
    private readonly AdminAccessService _adminAccessService;
    private readonly AdminUserService _adminUserService;

    public AdminUsersController(AdminAccessService adminAccessService, AdminUserService adminUserService)
    {
        _adminAccessService = adminAccessService;
        _adminUserService = adminUserService;
    }

    [HttpGet]
    public async Task<ActionResult<List<AdminUserReadResponse>>> List(CancellationToken cancellationToken)
    {
        await _adminAccessService.RequireAdminAsync(HttpContext, cancellationToken);
        return await _adminUserService.ListUsersAsync(cancellationToken);
    }

    [HttpPatch("{userId:int}/role")]
    public async Task<ActionResult<AdminUserReadResponse>> UpdateRole(int userId, [FromBody] UpdateUserRoleRequest request, CancellationToken cancellationToken)
    {
        await _adminAccessService.RequireAdminAsync(HttpContext, cancellationToken);
        return await _adminUserService.UpdateRoleAsync(userId, request, cancellationToken);
    }
}
