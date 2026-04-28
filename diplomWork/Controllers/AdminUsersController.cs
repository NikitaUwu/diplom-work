using DiplomWork.Dtos;
using DiplomWork.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiplomWork.Controllers;

/// <summary>
/// Административные методы для управления пользователями.
/// </summary>
[ApiController]
[ApiExplorerSettings(IgnoreApi = true)]
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

    /// <summary>
    /// Возвращает список всех зарегистрированных пользователей для администратора.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<AdminUserReadResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<List<AdminUserReadResponse>>> List(CancellationToken cancellationToken)
    {
        await _adminAccessService.RequireAdminAsync(HttpContext, cancellationToken);
        return await _adminUserService.ListUsersAsync(cancellationToken);
    }

    /// <summary>
    /// Обновляет роль пользователя.
    /// </summary>
    [HttpPatch("{userId:int}/role")]
    [ProducesResponseType(typeof(AdminUserReadResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<AdminUserReadResponse>> UpdateRole(int userId, [FromBody] UpdateUserRoleRequest request, CancellationToken cancellationToken)
    {
        await _adminAccessService.RequireAdminAsync(HttpContext, cancellationToken);
        return await _adminUserService.UpdateRoleAsync(userId, request, cancellationToken);
    }
}
