using System.Security.Cryptography;
using System.Text;

namespace DiplomWork.Helpers;

public static class HashingHelpers
{
    public static string Sha256Hex(byte[] bytes)
    {
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
