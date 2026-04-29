using DiplomWork.Domain;
using DiplomWork.Helpers;
using System.Text.Json.Nodes;

namespace DiplomWork.Services;

public sealed class ChartEditorService
{
    private readonly SplineService _splineService;

    public ChartEditorService(SplineService splineService)
    {
        _splineService = splineService;
    }

    public JsonObject BuildEditorResultJson(
        JsonObject payload,
        IReadOnlyList<PanelData> panels,
        Func<List<(double X, double Y)>, List<(double X, double Y)>>? pointTransform = null)
    {
        var normalized = JsonHelpers.DeepCloneObject(payload);
        var rawPanels = payload["panels"] as JsonArray;
        var normalizedPanels = new JsonArray();

        // Сохраняем старые поля результата, но точки и кривые пересобираем из данных редактора.
        for (var panelIndex = 0; panelIndex < panels.Count; panelIndex++)
        {
            var panel = panels[panelIndex];
            var rawPanel = rawPanels is not null && panelIndex < rawPanels.Count ? rawPanels[panelIndex] as JsonObject : null;
            var nextPanel = rawPanel is null ? new JsonObject() : JsonHelpers.DeepCloneObject(rawPanel);
            var rawSeries = rawPanel?["series"] as JsonArray;
            var nextSeries = new JsonArray();

            for (var seriesIndex = 0; seriesIndex < panel.Series.Count; seriesIndex++)
            {
                var series = panel.Series[seriesIndex];
                var rawSeriesItem = rawSeries is not null && seriesIndex < rawSeries.Count ? rawSeries[seriesIndex] as JsonObject : null;
                var nextSeriesItem = rawSeriesItem is null ? new JsonObject() : JsonHelpers.DeepCloneObject(rawSeriesItem);
                nextSeriesItem["id"] = series.Id;

                if (!string.IsNullOrWhiteSpace(series.Name))
                {
                    nextSeriesItem["name"] = series.Name;
                }
                else if (nextSeriesItem.ContainsKey("name") && nextSeriesItem["name"] is null)
                {
                    nextSeriesItem.Remove("name");
                }

                var nextPoints = series.Points.ToList();
                if (pointTransform is not null)
                {
                    nextPoints = pointTransform(nextPoints);
                }

                // Кривая нужна фронту сразу после сохранения, поэтому строим ее здесь.
                nextSeriesItem["points"] = JsonHelpers.ToPointArray(nextPoints);
                nextSeriesItem["approximation_method"] = "cubic_spline";
                nextSeriesItem["curve_points"] = ToCurveJson(_splineService.SampleCubicSpline(nextPoints));
                nextSeriesItem.Remove("interp");
                nextSeries.Add(nextSeriesItem);
            }

            nextPanel["series"] = nextSeries;
            normalizedPanels.Add(nextPanel);
        }

        normalized["panels"] = normalizedPanels;
        return normalized;
    }

    private static JsonArray ToCurveJson(IEnumerable<List<double>> points)
    {
        var array = new JsonArray();
        foreach (var point in points)
        {
            if (point.Count >= 2)
            {
                array.Add(new JsonArray(point[0], point[1]));
            }
        }

        return array;
    }
}
