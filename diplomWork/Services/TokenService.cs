using DiplomWork.Configuration;
using DiplomWork.Exceptions;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace DiplomWork.Services;

public sealed class TokenService
{
    private readonly AppOptions _options;
    private readonly JwtSecurityTokenHandler _handler = new();

    public TokenService(AppOptions options)
    {
        _options = options;
    }

    public string CreateAccessToken(string subject)
    {
        var expires = DateTime.UtcNow.AddMinutes(_options.JwtAccessTokenExpireMinutes);
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.JwtSecretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            claims: [new Claim(JwtRegisteredClaimNames.Sub, subject)],
            expires: expires,
            signingCredentials: credentials);

        return _handler.WriteToken(token);
    }

    public ClaimsPrincipal ValidateToken(string token)
    {
        try
        {
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.JwtSecretKey)),
                ClockSkew = TimeSpan.Zero,
            };

            return _handler.ValidateToken(token, validationParameters, out _);
        }
        catch (Exception)
        {
            throw new ApiProblemException(StatusCodes.Status401Unauthorized, "Could not validate credentials");
        }
    }
}
