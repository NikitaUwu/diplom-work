using DiplomWork.Configuration;
using DiplomWork.Helpers;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace DiplomWork.Services;

public sealed class EditorOverlayService
{
    private const double ValueEps = 1e-9;
    private const string LineformerPointSource = "lineformer_coordinates";
    private const string LineformerAlignmentVersion = "lineformer_overlay_v4";
    private readonly AppOptions _options;

    public EditorOverlayService(AppOptions options)
    {
        _options = options;
    }

    public JsonObject EnsureEditorAlignment(int chartId, JsonObject resultJson)
    {
        var searchRoot = LatestWorkerOutputRoot(chartId);
        if (searchRoot is null)
        {
            return resultJson;
        }

        var enriched = JsonHelpers.DeepCloneObject(resultJson);
        var rawMeta = resultJson["ml_meta"] as JsonObject;
        var rawOverlay = rawMeta?["editor_overlay"] as JsonObject;
        var hasAxisSamples =
            rawOverlay?["x_axis_samples"] is JsonArray xAxisSamples && xAxisSamples.Count >= 2 &&
            rawOverlay["y_axis_samples"] is JsonArray yAxisSamples && yAxisSamples.Count >= 2;

        JsonObject? overlay = hasAxisSamples ? rawOverlay : null;
        if (overlay is null)
        {
            var overlayMeta = BuildOverlayFromSearchRoot(searchRoot);
            if (overlayMeta is not null)
            {
                var baseMeta = enriched["ml_meta"] as JsonObject ?? new JsonObject();
                foreach (var item in overlayMeta)
                {
                    baseMeta[item.Key] = item.Value?.DeepClone();
                }

                enriched["ml_meta"] = baseMeta;
                overlay = baseMeta["editor_overlay"] as JsonObject;
            }
        }

        var currentMeta = enriched["ml_meta"] as JsonObject ?? new JsonObject();
        var pointSource = JsonHelpers.GetString(currentMeta["point_source"])?.Trim().ToLowerInvariant() ?? string.Empty;
        var alignmentVersion = JsonHelpers.GetString(currentMeta["editor_alignment_version"])?.Trim() ?? string.Empty;
        if ((pointSource == LineformerPointSource && alignmentVersion == LineformerAlignmentVersion) || overlay is null)
        {
            enriched["ml_meta"] = currentMeta;
            return enriched;
        }

        var lineformerSeries = ExtractLineformerSeries(searchRoot);
        if (lineformerSeries.Count == 0)
        {
            enriched["ml_meta"] = currentMeta;
            return enriched;
        }

        var mappedLineformerPoints = MapLineformerSeriesToAxisPoints(lineformerSeries, overlay);
        if (mappedLineformerPoints.Count == 0)
        {
            enriched["ml_meta"] = currentMeta;
            return enriched;
        }

        var currentSeries = ExtractResultSeriesPoints(enriched);
        if (currentSeries.Count == 0)
        {
            enriched["ml_meta"] = currentMeta;
            return enriched;
        }

        var convertedSeries = ExtractConvertedSeries(searchRoot);
        var shouldReplaceWithLineformer = pointSource == LineformerPointSource
            ? currentSeries.Count == mappedLineformerPoints.Count
            : convertedSeries.Count > 0 && SeriesListsMatch(currentSeries, convertedSeries);

        if (shouldReplaceWithLineformer)
        {
            enriched = ReplaceResultSeriesPoints(enriched, mappedLineformerPoints);
            currentMeta = enriched["ml_meta"] as JsonObject ?? new JsonObject();
            currentMeta["point_source"] = LineformerPointSource;
            currentMeta["editor_alignment_version"] = LineformerAlignmentVersion;
            enriched["ml_meta"] = currentMeta;
        }

        return enriched;
    }

    private JsonObject? BuildOverlayFromSearchRoot(string searchRoot)
    {
        var plotArea = ExtractPlotArea(searchRoot);
        if (plotArea is null)
        {
            return null;
        }

        var xSamples = ExtractAxisSamples(searchRoot, "x");
        var ySamples = ExtractAxisSamples(searchRoot, "y");
        if (xSamples.Count < 2 || ySamples.Count < 2)
        {
            return null;
        }

        var (left, top, right, bottom) = plotArea.Value;
        var xDomain = FitAxisDomain(xSamples, left, right);
        var yDomain = FitAxisDomain(ySamples, bottom, top);
        if (xDomain is null || yDomain is null)
        {
            return null;
        }

        var yDomainSorted = (Math.Min(yDomain.Value.Start, yDomain.Value.End), Math.Max(yDomain.Value.Start, yDomain.Value.End));
        var xAxisSamples = BuildAxisScreenSamples(xSamples, left, right);
        var yAxisSamples = BuildAxisScreenSamples(ySamples, bottom, top);
        if (xAxisSamples.Count < 2 || yAxisSamples.Count < 2)
        {
            return null;
        }

        return new JsonObject
        {
            ["editor_overlay"] = new JsonObject
            {
                ["artifact_key"] = "original",
                ["plot_area"] = new JsonObject
                {
                    ["left"] = left,
                    ["top"] = top,
                    ["right"] = right,
                    ["bottom"] = bottom,
                },
                ["x_domain"] = new JsonArray(xDomain.Value.Start, xDomain.Value.End),
                ["y_domain"] = new JsonArray(yDomainSorted.Item1, yDomainSorted.Item2),
                ["x_ticks"] = new JsonArray(xAxisSamples.Select(sample => JsonValue.Create(sample.Value)).ToArray()),
                ["y_ticks"] = new JsonArray(yAxisSamples.Select(sample => JsonValue.Create(sample.Value)).ToArray()),
                ["x_axis_samples"] = new JsonArray(xAxisSamples.Select(sample => sample.ToJsonNode()).ToArray()),
                ["y_axis_samples"] = new JsonArray(yAxisSamples.Select(sample => sample.ToJsonNode()).ToArray()),
            },
        };
    }

    private string? LatestWorkerOutputRoot(int chartId)
    {
        var chartRunsRoot = Path.Combine(_options.WorkerRunsRoot, $"chart_{chartId}");
        if (!Directory.Exists(chartRunsRoot))
        {
            return null;
        }

        var runs = Directory.GetDirectories(chartRunsRoot);
        var latestRun = PickLatest(runs);
        if (latestRun is null)
        {
            return null;
        }

        var output = Path.Combine(latestRun, "output");
        return Directory.Exists(output) ? output : null;
    }

    private static string? PickLatest(IEnumerable<string> paths)
    {
        var existing = paths.Where(File.Exists).ToList();
        if (existing.Count > 0)
        {
            return existing.MaxBy(File.GetLastWriteTimeUtc);
        }

        var existingDirs = paths.Where(Directory.Exists).ToList();
        return existingDirs.Count == 0 ? null : existingDirs.MaxBy(Directory.GetLastWriteTimeUtc);
    }

    private static JsonNode? LoadJson(string path) => JsonNode.Parse(File.ReadAllText(path));

    private static (double Left, double Top, double Right, double Bottom)? NormalizeBox(JsonNode? rawBox)
    {
        if (rawBox is not JsonArray array || array.Count < 4)
        {
            return null;
        }

        if (!JsonHelpers.TryGetDouble(array[0], out var left) ||
            !JsonHelpers.TryGetDouble(array[1], out var top) ||
            !JsonHelpers.TryGetDouble(array[2], out var right) ||
            !JsonHelpers.TryGetDouble(array[3], out var bottom) ||
            right <= left ||
            bottom <= top)
        {
            return null;
        }

        return (left, top, right, bottom);
    }

    private static double? ParseNumericLabel(JsonNode? rawText)
    {
        var text = JsonHelpers.GetString(rawText) ?? rawText?.ToString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var normalized = text.Trim()
            .Replace(" ", string.Empty, StringComparison.Ordinal)
            .Replace(",", ".", StringComparison.Ordinal)
            .Replace("\u2212", "-", StringComparison.Ordinal)
            .Replace("\u2013", "-", StringComparison.Ordinal)
            .Replace("\u2014", "-", StringComparison.Ordinal);

        var match = Regex.Match(normalized, @"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?");
        return match.Success && double.TryParse(match.Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    private static (double Left, double Top, double Right, double Bottom)? ExtractPlotArea(string searchRoot)
    {
        var labelPath = PickLatest(Directory.EnumerateFiles(searchRoot, "label_coordinates.json", SearchOption.AllDirectories)
            .Where(path => path.Split(Path.DirectorySeparatorChar).Contains("chartdete")));
        if (labelPath is not null)
        {
            try
            {
                var payload = LoadJson(labelPath) as JsonObject;
                var plotArea = NormalizeBox(payload?["plot_area"]);
                if (plotArea is not null)
                {
                    return plotArea;
                }
            }
            catch
            {
            }
        }

        var boxPath = PickLatest(Directory.EnumerateFiles(searchRoot, "bounding_boxes.json", SearchOption.AllDirectories)
            .Where(path => path.Split(Path.DirectorySeparatorChar).Contains("chartdete")));
        if (boxPath is null)
        {
            return null;
        }

        try
        {
            var payload = LoadJson(boxPath) as JsonObject;
            var rawCandidates = payload?["plot_area"] as JsonArray;
            if (rawCandidates is null)
            {
                return null;
            }

            (double Left, double Top, double Right, double Bottom)? bestBox = null;
            var bestConfidence = double.NegativeInfinity;
            foreach (var candidate in rawCandidates)
            {
                var box = NormalizeBox(candidate);
                if (box is null)
                {
                    continue;
                }

                var confidence = 0.0;
                if (candidate is JsonArray candidateArray && candidateArray.Count >= 5 && JsonHelpers.TryGetDouble(candidateArray[4], out var parsedConfidence))
                {
                    confidence = parsedConfidence;
                }

                if (confidence >= bestConfidence)
                {
                    bestConfidence = confidence;
                    bestBox = box;
                }
            }

            return bestBox;
        }
        catch
        {
            return null;
        }
    }

    private static List<(double Coord, double Value)> ExtractAxisSamples(string searchRoot, string axis)
    {
        var labelPath = PickLatest(Directory.EnumerateFiles(searchRoot, "label_coordinates.json", SearchOption.AllDirectories)
            .Where(path => path.Split(Path.DirectorySeparatorChar).Contains("chartdete")));
        var textPath = PickLatest(Directory.EnumerateFiles(searchRoot, "axis_label_texts.json", SearchOption.AllDirectories));
        if (labelPath is null || textPath is null)
        {
            return [];
        }

        try
        {
            var labelPayload = LoadJson(labelPath) as JsonObject;
            var textPayload = LoadJson(textPath) as JsonObject;
            if (labelPayload is null || textPayload is null)
            {
                return [];
            }

            var prefix = axis == "x" ? "cropped_xlabels_" : "cropped_ylabels_";
            var textByName = textPayload.ToDictionary(
                item => Path.GetFileName(item.Key).ToLowerInvariant(),
                item => item.Value);

            var samples = new List<(double Coord, double Value)>();
            foreach (var item in labelPayload)
            {
                var fileName = Path.GetFileName(item.Key).ToLowerInvariant();
                if (!fileName.StartsWith(prefix, StringComparison.Ordinal))
                {
                    continue;
                }

                var value = ParseNumericLabel(textByName.GetValueOrDefault(fileName));
                var box = NormalizeBox(item.Value);
                if (value is null || box is null)
                {
                    continue;
                }

                var coord = axis == "x"
                    ? (box.Value.Left + box.Value.Right) / 2
                    : (box.Value.Top + box.Value.Bottom) / 2;
                samples.Add((coord, value.Value));
            }

            return samples.OrderBy(sample => sample.Coord).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static (double Start, double End)? FitAxisDomain(List<(double Coord, double Value)> samples, double axisStartPx, double axisEndPx)
    {
        if (samples.Count < 2)
        {
            return null;
        }

        var meanCoord = samples.Average(sample => sample.Coord);
        var meanValue = samples.Average(sample => sample.Value);
        var denom = samples.Sum(sample => Math.Pow(sample.Coord - meanCoord, 2));
        if (denom <= 1e-12)
        {
            return null;
        }

        var slope = samples.Sum(sample => (sample.Coord - meanCoord) * (sample.Value - meanValue)) / denom;
        if (Math.Abs(slope) <= 1e-12)
        {
            return null;
        }

        var intercept = meanValue - (slope * meanCoord);
        var startValue = (slope * axisStartPx) + intercept;
        var endValue = (slope * axisEndPx) + intercept;
        if (!double.IsFinite(startValue) || !double.IsFinite(endValue) || Math.Abs(startValue - endValue) <= 1e-12)
        {
            return null;
        }

        return (startValue, endValue);
    }

    private static List<AxisSample> BuildAxisScreenSamples(List<(double Coord, double Value)> samples, double axisStartPx, double axisEndPx)
    {
        var span = axisEndPx - axisStartPx;
        if (Math.Abs(span) <= 1e-12)
        {
            return [];
        }

        var normalized = samples
            .Select(sample => (sample.Value, Screen: (sample.Coord - axisStartPx) / span))
            .Where(sample => sample.Screen >= -0.25 && sample.Screen <= 1.25)
            .Select(sample => new AxisSample(sample.Value, Math.Clamp(sample.Screen, 0.0, 1.0)))
            .OrderBy(sample => sample.Value)
            .ThenBy(sample => sample.Screen)
            .ToList();

        var output = new List<AxisSample>();
        foreach (var sample in normalized)
        {
            var last = output.LastOrDefault();
            if (last is not null && Math.Abs(last.Value - sample.Value) <= ValueEps)
            {
                output[^1] = sample;
                continue;
            }

            if (last is not null && sample.Screen <= last.Screen + 1e-4)
            {
                continue;
            }

            output.Add(sample);
        }

        return output;
    }

    private static List<List<(double X, double Y)>> ExtractConvertedSeries(string searchRoot)
    {
        var sourcePath = PickLatest(Directory.EnumerateFiles(searchRoot, "data.json", SearchOption.AllDirectories)
            .Where(path => path.Split(Path.DirectorySeparatorChar).Contains("converted_datapoints")));
        if (sourcePath is null)
        {
            return [];
        }

        try
        {
            return ParseNamedSeriesPayload(LoadJson(sourcePath));
        }
        catch
        {
            return [];
        }
    }

    private static List<List<(double X, double Y)>> ExtractLineformerSeries(string searchRoot)
    {
        var sourcePath = PickLatest(Directory.EnumerateFiles(searchRoot, "coordinates.json", SearchOption.AllDirectories)
            .Where(path => path.Split(Path.DirectorySeparatorChar).Contains("lineformer")));
        if (sourcePath is null)
        {
            return [];
        }

        try
        {
            var payload = LoadJson(sourcePath);
            if (payload is JsonArray array)
            {
                var directSeries = ParsePointSeries(array);
                if (directSeries.Count > 0)
                {
                    return [directSeries];
                }

                var outSeries = new List<List<(double X, double Y)>>();
                foreach (var item in array)
                {
                    var series = ParsePointSeries(item);
                    if (series.Count > 0)
                    {
                        outSeries.Add(series);
                    }
                }

                return outSeries;
            }

            return ParseNamedSeriesPayload(payload);
        }
        catch
        {
            return [];
        }
    }

    private static List<List<(double X, double Y)>> ParseNamedSeriesPayload(JsonNode? payload)
    {
        if (payload is not JsonObject obj)
        {
            return [];
        }

        static (int, string) SortKey(string name)
        {
            var match = Regex.Match(name, @"(\d+)$");
            return match.Success ? (int.Parse(match.Value), name) : (int.MaxValue, name);
        }

        var output = new List<List<(double X, double Y)>>();
        foreach (var key in obj.Select(item => item.Key).OrderBy(key => SortKey(key)))
        {
            var series = ParsePointSeries(obj[key]);
            if (series.Count > 0)
            {
                output.Add(series);
            }
        }

        return output;
    }

    private static List<(double X, double Y)> ParsePointSeries(JsonNode? value)
    {
        if (value is not JsonArray array)
        {
            return [];
        }

        var output = new List<(double X, double Y)>();
        foreach (var item in array)
        {
            if (TryToFloatPair(item, out var point))
            {
                output.Add(point);
            }
        }

        return output;
    }

    private static bool TryToFloatPair(JsonNode? item, out (double X, double Y) point)
    {
        point = default;
        if (item is JsonObject obj)
        {
            if (JsonHelpers.TryGetDouble(obj["x"] ?? obj["X"], out var x) &&
                JsonHelpers.TryGetDouble(obj["y"] ?? obj["Y"], out var y))
            {
                point = (x, y);
                return true;
            }

            return false;
        }

        if (item is JsonArray array && array.Count >= 2 &&
            JsonHelpers.TryGetDouble(array[0], out var ax) &&
            JsonHelpers.TryGetDouble(array[1], out var ay))
        {
            point = (ax, ay);
            return true;
        }

        return false;
    }

    private sealed record AxisSample(double Value, double Screen)
    {
        public JsonObject ToJsonNode() => new()
        {
            ["value"] = Value,
            ["screen"] = Screen,
        };
    }

    private static List<List<(double X, double Y)>> MapLineformerSeriesToAxisPoints(List<List<(double X, double Y)>> lineformerSeries, JsonObject overlay)
    {
        var plotArea = overlay["plot_area"] as JsonObject;
        if (plotArea is null ||
            !JsonHelpers.TryGetDouble(plotArea["left"], out var left) ||
            !JsonHelpers.TryGetDouble(plotArea["top"], out var top) ||
            !JsonHelpers.TryGetDouble(plotArea["right"], out var right) ||
            !JsonHelpers.TryGetDouble(plotArea["bottom"], out var bottom) ||
            overlay["x_domain"] is not JsonArray xDomainArray ||
            overlay["y_domain"] is not JsonArray yDomainArray ||
            xDomainArray.Count < 2 ||
            yDomainArray.Count < 2 ||
            !JsonHelpers.TryGetDouble(xDomainArray[0], out var x0) ||
            !JsonHelpers.TryGetDouble(xDomainArray[1], out var x1) ||
            !JsonHelpers.TryGetDouble(yDomainArray[0], out var y0) ||
            !JsonHelpers.TryGetDouble(yDomainArray[1], out var y1))
        {
            return [];
        }

        var spanX = right - left;
        var spanY = bottom - top;
        if (spanX <= ValueEps || spanY <= ValueEps)
        {
            return [];
        }

        var warpX = BuildAxisWarp((x0, x1), overlay["x_axis_samples"]);
        var warpY = BuildAxisWarp((y0, y1), overlay["y_axis_samples"]);
        var output = new List<List<(double X, double Y)>>();

        foreach (var series in lineformerSeries)
        {
            var mapped = new List<(double X, double Y)>();
            foreach (var (px, py) in series)
            {
                var screenX = (px - left) / spanX;
                var screenY = (bottom - py) / spanY;
                mapped.Add((
                    AxisScreenToValue(screenX, (x0, x1), warpX),
                    AxisScreenToValue(screenY, (y0, y1), warpY)));
            }

            var compacted = SortAndCompactPoints(mapped);
            if (compacted.Count > 0)
            {
                output.Add(compacted);
            }
        }

        return output;
    }

    private sealed record AxisWarp(List<double> DataKnots, List<double> ScreenKnots);

    private static AxisWarp? BuildAxisWarp((double Start, double End) domain, JsonNode? rawSamples)
    {
        if (Math.Abs(domain.End - domain.Start) <= ValueEps)
        {
            return null;
        }

        var samples = NormalizeAxisSamples(rawSamples);
        if (samples.Count < 2)
        {
            return null;
        }

        var dataKnots = new List<double> { domain.Start };
        var screenKnots = new List<double> { 0.0 };
        foreach (var sample in samples)
        {
            if (sample.Value <= domain.Start + ValueEps || sample.Value >= domain.End - ValueEps)
            {
                continue;
            }

            if (sample.Screen <= screenKnots[^1] + ValueEps || sample.Screen >= 1.0 - ValueEps)
            {
                continue;
            }

            dataKnots.Add(sample.Value);
            screenKnots.Add(sample.Screen);
        }

        dataKnots.Add(domain.End);
        screenKnots.Add(1.0);
        return new AxisWarp(dataKnots, screenKnots);
    }

    private static List<AxisSample> NormalizeAxisSamples(JsonNode? rawSamples)
    {
        if (rawSamples is not JsonArray array)
        {
            return [];
        }

        var parsed = new List<AxisSample>();
        foreach (var item in array.OfType<JsonObject>())
        {
            if (JsonHelpers.TryGetDouble(item["value"], out var value) &&
                JsonHelpers.TryGetDouble(item["screen"], out var screen))
            {
                parsed.Add(new AxisSample(value, Clamp(screen, 0.0, 1.0)));
            }
        }

        parsed = parsed.OrderBy(sample => sample.Value).ThenBy(sample => sample.Screen).ToList();
        var output = new List<AxisSample>();
        foreach (var sample in parsed)
        {
            var previous = output.LastOrDefault();
            if (previous is not null && Math.Abs(previous.Value - sample.Value) <= ValueEps)
            {
                output[^1] = sample;
                continue;
            }

            if (previous is not null && sample.Screen <= previous.Screen + ValueEps)
            {
                continue;
            }

            output.Add(sample);
        }

        return output;
    }

    private static double AxisScreenToValue(double screen, (double Start, double End) domain, AxisWarp? warp)
    {
        var s = Clamp(screen, 0.0, 1.0);
        if (warp is null || warp.DataKnots.Count < 2 || warp.DataKnots.Count != warp.ScreenKnots.Count)
        {
            return domain.Start + (s * (domain.End - domain.Start));
        }

        for (var index = 0; index < warp.ScreenKnots.Count - 1; index++)
        {
            if (s <= warp.ScreenKnots[index + 1] + ValueEps)
            {
                var sa = warp.ScreenKnots[index];
                var sb = warp.ScreenKnots[index + 1];
                var a = warp.DataKnots[index];
                var b = warp.DataKnots[index + 1];
                var t = Math.Abs(sb - sa) <= ValueEps ? 0.0 : (s - sa) / (sb - sa);
                return a + (t * (b - a));
            }
        }

        return warp.DataKnots[^1];
    }

    private static List<(double X, double Y)> SortAndCompactPoints(List<(double X, double Y)> points)
    {
        var compacted = points
            .OrderBy(point => point.X)
            .ThenBy(point => point.Y)
            .ToList();

        var output = new List<(double X, double Y, int Count)>();
        foreach (var (x, y) in compacted)
        {
            if (output.Count > 0 && Math.Abs(output[^1].X - x) <= ValueEps)
            {
                var last = output[^1];
                output[^1] = (last.X, ((last.Y * last.Count) + y) / (last.Count + 1), last.Count + 1);
            }
            else
            {
                output.Add((x, y, 1));
            }
        }

        return output.Select(item => (item.X, item.Y)).ToList();
    }

    private static List<List<(double X, double Y)>> ExtractResultSeriesPoints(JsonObject resultJson)
    {
        var panels = resultJson["panels"] as JsonArray;
        if (panels is null)
        {
            return [];
        }

        var output = new List<List<(double X, double Y)>>();
        foreach (var panel in panels.OfType<JsonObject>())
        {
            var seriesList = panel["series"] as JsonArray;
            if (seriesList is null)
            {
                continue;
            }

            foreach (var series in seriesList.OfType<JsonObject>())
            {
                output.Add(ParsePointSeries(series["points"]));
            }
        }

        return output;
    }

    private static JsonObject ReplaceResultSeriesPoints(JsonObject resultJson, List<List<(double X, double Y)>> seriesPoints)
    {
        var panels = resultJson["panels"] as JsonArray;
        if (panels is null)
        {
            return resultJson;
        }

        var totalSeries = panels
            .OfType<JsonObject>()
            .Sum(panel => (panel["series"] as JsonArray)?.Count ?? 0);
        if (totalSeries != seriesPoints.Count)
        {
            return resultJson;
        }

        var output = JsonHelpers.DeepCloneObject(resultJson);
        var index = 0;
        foreach (var panel in (output["panels"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            var seriesList = panel["series"] as JsonArray;
            if (seriesList is null)
            {
                continue;
            }

            foreach (var series in seriesList.OfType<JsonObject>())
            {
                series["points"] = JsonHelpers.ToPointArray(seriesPoints[index]);
                series.Remove("curve_points");
                index++;
            }
        }

        return output;
    }

    private static bool SeriesListsMatch(List<List<(double X, double Y)>> currentSeries, List<List<(double X, double Y)>> referenceSeries)
    {
        if (currentSeries.Count != referenceSeries.Count)
        {
            return false;
        }

        for (var seriesIndex = 0; seriesIndex < currentSeries.Count; seriesIndex++)
        {
            var current = currentSeries[seriesIndex];
            var reference = referenceSeries[seriesIndex];
            if (current.Count != reference.Count)
            {
                return false;
            }

            if (current.Count == 0)
            {
                continue;
            }

            var sampleIndexes = new SortedSet<int> { 0, current.Count / 4, current.Count / 2, (3 * current.Count) / 4, current.Count - 1 };
            foreach (var idx in sampleIndexes)
            {
                var (cx, cy) = current[idx];
                var (rx, ry) = reference[idx];
                if (Math.Abs(cx - rx) > 1e-6 || Math.Abs(cy - ry) > 1e-6)
                {
                    return false;
                }
            }
        }

        return true;
    }

    private static double Clamp(double value, double low, double high) => Math.Max(low, Math.Min(high, value));
}
