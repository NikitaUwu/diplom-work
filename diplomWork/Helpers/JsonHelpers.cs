using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DiplomWork.Helpers;

public static class JsonHelpers
{
    public static JsonNode? FromDocument(JsonDocument? document)
    {
        return document is null ? null : JsonNode.Parse(document.RootElement.GetRawText());
    }

    public static JsonDocument? ToDocument(JsonNode? node)
    {
        return node is null ? null : JsonDocument.Parse(node.ToJsonString());
    }

    public static JsonObject RequireObject(JsonNode? node)
    {
        return node as JsonObject ?? new JsonObject();
    }

    public static bool IsNullOrEmptyObject(JsonObject? node)
    {
        return node is null || !node.Any();
    }

    public static JsonObject DeepCloneObject(JsonObject node)
    {
        return JsonNode.Parse(node.ToJsonString())?.AsObject() ?? new JsonObject();
    }

    public static JsonArray ToPointArray(IEnumerable<(double X, double Y)> points)
    {
        var outArray = new JsonArray();
        foreach (var (x, y) in points)
        {
            outArray.Add(new JsonArray(x, y));
        }

        return outArray;
    }

    public static bool TryGetDouble(JsonNode? node, out double value)
    {
        value = default;
        if (node is null)
        {
            return false;
        }

        if (node is JsonValue jsonValue)
        {
            if (jsonValue.TryGetValue(out double d))
            {
                value = d;
                return true;
            }

            if (jsonValue.TryGetValue(out decimal m))
            {
                value = (double)m;
                return true;
            }

            if (jsonValue.TryGetValue(out int i))
            {
                value = i;
                return true;
            }

            if (jsonValue.TryGetValue(out long l))
            {
                value = l;
                return true;
            }

            if (jsonValue.TryGetValue(out string? s) &&
                double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            {
                value = parsed;
                return true;
            }
        }

        return false;
    }

    public static bool TryGetInt(JsonNode? node, out int value)
    {
        value = default;
        if (node is JsonValue jsonValue)
        {
            if (jsonValue.TryGetValue(out int i))
            {
                value = i;
                return true;
            }

            if (jsonValue.TryGetValue(out string? s) &&
                int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                value = parsed;
                return true;
            }
        }

        return false;
    }

    public static string? GetString(JsonNode? node)
    {
        return node is JsonValue jsonValue && jsonValue.TryGetValue(out string? value)
            ? value
            : null;
    }
}
