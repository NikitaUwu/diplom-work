using DiplomWork.Domain;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace DiplomWork.Services;

public sealed class ExportService
{
    private const char CsvDelimiter = '\t';
    private const string CsvExcelSepHint = "sep=\t\r\n";

    public string ExportToCsv(List<PanelData> panels, string? panelId = null, string? seriesId = null)
    {
        var output = new StringBuilder(CsvExcelSepHint);
        output.AppendLine("series_id\tx\ty");

        foreach (var (seriesName, x, y) in IterateFlatPoints(panels, panelId, seriesId))
        {
            output.Append(seriesName)
                .Append('\t')
                .Append(ToInvariant(x))
                .Append('\t')
                .Append(ToInvariant(y))
                .Append("\r\n");
        }

        return output.ToString();
    }

    public string ExportToTxt(List<PanelData> panels, string? panelId = null, string? seriesId = null)
    {
        var output = new StringBuilder();
        output.AppendLine("series_id\tx\ty");
        foreach (var (seriesName, x, y) in IterateFlatPoints(panels, panelId, seriesId))
        {
            output.Append(seriesName)
                .Append('\t')
                .Append(ToInvariant(x))
                .Append('\t')
                .Append(ToInvariant(y))
                .Append('\n');
        }

        return output.ToString();
    }

    public string ExportToJson(List<PanelData> panels, string? panelId = null, string? seriesId = null, bool pretty = false)
    {
        var outPanels = new List<object>();
        foreach (var panel in panels)
        {
            if (!string.IsNullOrWhiteSpace(panelId) && panel.Id != panelId)
            {
                continue;
            }

            var outSeries = new List<object>();
            foreach (var series in panel.Series)
            {
                if (!string.IsNullOrWhiteSpace(seriesId) && series.Id != seriesId)
                {
                    continue;
                }

                outSeries.Add(new
                {
                    id = series.Id,
                    name = series.Name,
                    points = series.Points.Select(point => new[] { point.X, point.Y }).ToList(),
                });
            }

            if (outSeries.Count > 0)
            {
                outPanels.Add(new
                {
                    id = panel.Id,
                    series = outSeries,
                });
            }
        }

        return JsonSerializer.Serialize(
            new { panels = outPanels },
            new JsonSerializerOptions
            {
                WriteIndented = pretty,
            });
    }

    public string ExportToTableCsv(List<PanelData> panels, string? panelId = null, List<string>? seriesIds = null)
    {
        var selectedPanels = panels
            .Where(panel => string.IsNullOrWhiteSpace(panelId) || panel.Id == panelId)
            .ToList();
        if (selectedPanels.Count == 0)
        {
            return string.Empty;
        }

        var allowedSeries = seriesIds is null ? null : seriesIds.ToHashSet();
        var seriesColumns = new List<(string Name, Dictionary<double, double> Points)>();
        var usedNames = new HashSet<string>(StringComparer.Ordinal);

        foreach (var panel in selectedPanels)
        {
            foreach (var series in panel.Series)
            {
                if (allowedSeries is not null && !allowedSeries.Contains(series.Id))
                {
                    continue;
                }

                var name = UniqueName(string.IsNullOrWhiteSpace(series.Name) ? series.Id : series.Name!, usedNames);
                var values = new Dictionary<double, double>();
                foreach (var (x, y) in series.Points)
                {
                    if (!double.IsNaN(x) && !double.IsNaN(y))
                    {
                        values[x] = y;
                    }
                }

                seriesColumns.Add((name, values));
            }
        }

        if (seriesColumns.Count == 0)
        {
            return string.Empty;
        }

        var allX = seriesColumns
            .SelectMany(column => column.Points.Keys)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var output = new StringBuilder(CsvExcelSepHint);
        output.Append("x");
        foreach (var (name, _) in seriesColumns)
        {
            output.Append(CsvDelimiter).Append(name);
        }
        output.Append("\r\n");

        foreach (var x in allX)
        {
            output.Append(FormatNumber(x));
            foreach (var (_, mapping) in seriesColumns)
            {
                output.Append(CsvDelimiter);
                if (mapping.TryGetValue(x, out var y))
                {
                    output.Append(FormatNumber(y));
                }
            }

            output.Append("\r\n");
        }

        return output.ToString();
    }

    public static byte[] ToExcelFriendlyUtf16(string text)
    {
        var bom = Encoding.Unicode.GetPreamble();
        var content = Encoding.Unicode.GetBytes(text);
        return bom.Concat(content).ToArray();
    }

    private static IEnumerable<(string SeriesName, double X, double Y)> IterateFlatPoints(
        IEnumerable<PanelData> panels,
        string? panelFilter,
        string? seriesFilter)
    {
        foreach (var panel in panels)
        {
            if (!string.IsNullOrWhiteSpace(panelFilter) && panel.Id != panelFilter)
            {
                continue;
            }

            foreach (var series in panel.Series)
            {
                if (!string.IsNullOrWhiteSpace(seriesFilter) && series.Id != seriesFilter)
                {
                    continue;
                }

                foreach (var (x, y) in series.Points)
                {
                    yield return (series.Id, x, y);
                }
            }
        }
    }

    private static string UniqueName(string baseName, ISet<string> used)
    {
        var name = string.IsNullOrWhiteSpace(baseName) ? "series" : baseName.Trim();
        if (used.Add(name))
        {
            return name;
        }

        var index = 2;
        while (!used.Add($"{name} ({index})"))
        {
            index++;
        }

        return $"{name} ({index})";
    }

    private static string FormatNumber(double value) => value.ToString("G15", CultureInfo.InvariantCulture);

    private static string ToInvariant(double value) => value.ToString(CultureInfo.InvariantCulture);
}
