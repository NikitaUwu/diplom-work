using System.Text.Json.Nodes;

namespace DiplomWork.Domain;

public sealed class PanelData
{
    public string Id { get; set; } = string.Empty;

    public int? Row { get; set; }

    public int? Col { get; set; }

    public string? XUnit { get; set; }

    public string? YUnit { get; set; }

    public string XScale { get; set; } = "linear";

    public string YScale { get; set; } = "linear";

    public List<SeriesData> Series { get; set; } = [];
}

public sealed class SeriesData
{
    public string Id { get; set; } = string.Empty;

    public string? Name { get; set; }

    public JsonNode? Style { get; set; }

    public List<(double X, double Y)> Points { get; set; } = [];
}
