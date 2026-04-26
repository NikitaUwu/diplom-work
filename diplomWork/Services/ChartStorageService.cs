using DiplomWork.Configuration;
using DiplomWork.Exceptions;
using DiplomWork.Models;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DiplomWork.Services;

public sealed class ChartStorageService
{
    public const string DataJsonFileName = "data.json";

    private readonly AppOptions _options;

    public ChartStorageService(AppOptions options)
    {
        _options = options;
    }

    public string StorageRoot => _options.StorageDir;

    public string EnsureStorageRoot()
    {
        Directory.CreateDirectory(_options.StorageDir);
        return _options.StorageDir;
    }

    public string GetUserRoot(int userId)
    {
        var root = Path.GetFullPath(Path.Combine(EnsureStorageRoot(), $"user_{userId}"));
        Directory.CreateDirectory(root);
        EnsureInStorage(root);
        return root;
    }

    public string GetChartDirectory(int userId, int chartId)
    {
        var root = GetUserRoot(userId);
        var path = Path.GetFullPath(Path.Combine(root, chartId.ToString()));
        EnsureUnder(root, path);
        Directory.CreateDirectory(path);
        return path;
    }

    public string EnsureInStorage(string path)
    {
        var resolved = Path.GetFullPath(path);
        var storageRoot = Path.GetFullPath(EnsureStorageRoot());
        if (!IsInside(storageRoot, resolved))
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "Invalid file path");
        }

        return resolved;
    }

    public string ResolveInStorage(string rawPath, bool allowAbsolute)
    {
        if (string.IsNullOrWhiteSpace(rawPath))
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "Invalid file path");
        }

        var path = rawPath.Trim();
        if (Path.IsPathRooted(path))
        {
            if (!allowAbsolute)
            {
                throw new ApiProblemException(StatusCodes.Status400BadRequest, "Invalid file path");
            }

            return EnsureInStorage(path);
        }

        return EnsureInStorage(Path.Combine(EnsureStorageRoot(), path));
    }

    public string GetChartDirectoryFromChart(Chart chart)
    {
        if (string.IsNullOrWhiteSpace(chart.OriginalPath))
        {
            throw new ApiProblemException(StatusCodes.Status404NotFound, "Chart files are missing");
        }

        var originalPath = ResolveInStorage(chart.OriginalPath, allowAbsolute: true);
        return EnsureInStorage(Path.GetDirectoryName(originalPath)
            ?? throw new ApiProblemException(StatusCodes.Status404NotFound, "Chart files are missing"));
    }

    public string GetDataJsonPath(Chart chart)
    {
        var chartDirectory = GetChartDirectory(chart.UserId, chart.Id);
        return EnsureInStorage(Path.Combine(chartDirectory, DataJsonFileName));
    }

    public async Task WriteDataJsonAsync(Chart chart, JsonNode resultJson, CancellationToken cancellationToken = default)
    {
        var dataJsonPath = GetDataJsonPath(chart);
        var content = resultJson.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = true,
        });

        await File.WriteAllTextAsync(dataJsonPath, content, cancellationToken);
    }

    public string ResolveArtifactPath(Chart chart, string rawPath)
    {
        if (string.IsNullOrWhiteSpace(rawPath))
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "Invalid file path");
        }

        if (Path.IsPathRooted(rawPath))
        {
            return EnsureInStorage(rawPath);
        }

        var direct = ResolveInStorage(rawPath, allowAbsolute: false);
        if (File.Exists(direct) || Directory.Exists(direct))
        {
            return direct;
        }

        return EnsureInStorage(Path.Combine(GetChartDirectoryFromChart(chart), rawPath));
    }

    public static bool IsInside(string parent, string child)
    {
        var normalizedParent = Path.GetFullPath(parent)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var normalizedChild = Path.GetFullPath(child)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;

        return normalizedChild.StartsWith(normalizedParent, StringComparison.OrdinalIgnoreCase);
    }

    private static void EnsureUnder(string root, string path)
    {
        if (!IsInside(root, path))
        {
            throw new ApiProblemException(StatusCodes.Status500InternalServerError, "Invalid storage path");
        }
    }
}
