namespace DiplomWork.Services;

public sealed class CubicSelectionService
{
    public List<(double X, double Y)> SelectCubicSplinePoints(
        IEnumerable<(double X, double Y)> points,
        int totalPoints,
        string metric = "max",
        int refinePasses = 2,
        int refineRadius = 30)
    {
        var sortedPoints = points
            .Select(point => (X: point.X, Y: point.Y))
            .OrderBy(point => point.X)
            .ToList();

        var count = sortedPoints.Count;
        if (totalPoints < 2)
        {
            throw new ArgumentOutOfRangeException(nameof(totalPoints), "totalPoints must be at least 2");
        }

        if (count <= 2 || totalPoints >= count)
        {
            return sortedPoints;
        }

        for (var index = 1; index < sortedPoints.Count; index++)
        {
            if (sortedPoints[index].X <= sortedPoints[index - 1].X)
            {
                return sortedPoints;
            }
        }

        var selected = new List<int> { 0, count - 1 };
        while (selected.Count < totalPoints)
        {
            selected.Sort();
            var interpolate = BuildInterpolator(selected.Select(index => sortedPoints[index]).ToList());

            int? bestIndex = null;
            var bestError = double.NegativeInfinity;
            var selectedSet = selected.ToHashSet();

            for (var index = 1; index < count - 1; index++)
            {
                if (selectedSet.Contains(index))
                {
                    continue;
                }

                var point = sortedPoints[index];
                var error = Math.Abs(point.Y - interpolate(point.X));
                if (error > bestError)
                {
                    bestError = error;
                    bestIndex = index;
                }
            }

            if (bestIndex is null)
            {
                break;
            }

            selected.Add(bestIndex.Value);
        }

        selected.Sort();

        for (var pass = 0; pass < Math.Max(0, refinePasses); pass++)
        {
            var improved = false;
            for (var position = 1; position < selected.Count - 1; position++)
            {
                var currentIndex = selected[position];
                var currentInterpolator = BuildInterpolator(selected.Select(index => sortedPoints[index]).ToList());
                var bestError = CalculateMetric(sortedPoints, currentInterpolator, metric);
                var bestIndex = currentIndex;

                var left = Math.Max(1, currentIndex - refineRadius);
                var right = Math.Min(count - 2, currentIndex + refineRadius);

                for (var candidateIndex = left; candidateIndex <= right; candidateIndex++)
                {
                    if (candidateIndex == currentIndex || selected.Contains(candidateIndex))
                    {
                        continue;
                    }

                    var trial = selected.ToList();
                    trial[position] = candidateIndex;
                    trial.Sort();

                    var trialInterpolator = BuildInterpolator(trial.Select(index => sortedPoints[index]).ToList());
                    var trialError = CalculateMetric(sortedPoints, trialInterpolator, metric);
                    if (trialError < bestError)
                    {
                        bestError = trialError;
                        bestIndex = candidateIndex;
                    }
                }

                if (bestIndex != currentIndex)
                {
                    selected[position] = bestIndex;
                    selected.Sort();
                    improved = true;
                }
            }

            if (!improved)
            {
                break;
            }
        }

        return selected.OrderBy(index => index).Select(index => sortedPoints[index]).ToList();
    }

    private static Func<double, double> BuildInterpolator(List<(double X, double Y)> points)
    {
        if (points.Count <= 1)
        {
            var y = points.Count == 0 ? 0.0 : points[0].Y;
            return _ => y;
        }

        var xs = points.Select(point => point.X).ToArray();
        var ys = points.Select(point => point.Y).ToArray();

        if (points.Count == 2)
        {
            return xq => LinearValue(xs, ys, xq);
        }

        for (var index = 1; index < xs.Length; index++)
        {
            if (xs[index] <= xs[index - 1])
            {
                return xq => LinearValue(xs, ys, xq);
            }
        }

        var n = xs.Length;
        var h = new double[n - 1];
        for (var index = 0; index < n - 1; index++)
        {
            h[index] = xs[index + 1] - xs[index];
        }

        var a = new double[n];
        var b = new double[n];
        var c = new double[n];
        var d = new double[n];
        b[0] = 1.0;
        b[n - 1] = 1.0;

        for (var index = 1; index < n - 1; index++)
        {
            a[index] = h[index - 1];
            b[index] = 2.0 * (h[index - 1] + h[index]);
            c[index] = h[index];
            d[index] = 3.0 * (((ys[index + 1] - ys[index]) / h[index]) - ((ys[index] - ys[index - 1]) / h[index - 1]));
        }

        for (var index = 1; index < n; index++)
        {
            var weight = a[index] / b[index - 1];
            b[index] -= weight * c[index - 1];
            d[index] -= weight * d[index - 1];
        }

        var cc = new double[n];
        cc[n - 1] = d[n - 1] / b[n - 1];
        for (var index = n - 2; index >= 0; index--)
        {
            cc[index] = (d[index] - c[index] * cc[index + 1]) / b[index];
        }

        var bb = new double[n - 1];
        var dd = new double[n - 1];
        for (var index = 0; index < n - 1; index++)
        {
            bb[index] = ((ys[index + 1] - ys[index]) / h[index]) - ((h[index] * (2.0 * cc[index] + cc[index + 1])) / 3.0);
            dd[index] = (cc[index + 1] - cc[index]) / (3.0 * h[index]);
        }

        return xq =>
        {
            int segmentIndex;
            if (xq <= xs[0])
            {
                segmentIndex = 0;
            }
            else if (xq >= xs[^1])
            {
                segmentIndex = xs.Length - 2;
            }
            else
            {
                segmentIndex = Math.Min(xs.Length - 2, Array.FindLastIndex(xs, x => x <= xq));
                segmentIndex = Math.Max(0, segmentIndex);
            }

            var dx = xq - xs[segmentIndex];
            return ys[segmentIndex] + bb[segmentIndex] * dx + cc[segmentIndex] * dx * dx + dd[segmentIndex] * dx * dx * dx;
        };
    }

    private static double LinearValue(IReadOnlyList<double> xs, IReadOnlyList<double> ys, double xq)
    {
        if (xq <= xs[0])
        {
            return ys[0];
        }

        if (xq >= xs[^1])
        {
            return ys[^1];
        }

        var right = 0;
        while (right < xs.Count && xs[right] <= xq)
        {
            right++;
        }

        var left = Math.Max(0, right - 1);
        right = Math.Min(xs.Count - 1, right);

        var x0 = xs[left];
        var x1 = xs[right];
        var y0 = ys[left];
        var y1 = ys[right];
        if (Math.Abs(x1 - x0) <= double.Epsilon)
        {
            return y0;
        }

        var ratio = (xq - x0) / (x1 - x0);
        return y0 + ((y1 - y0) * ratio);
    }

    private static double CalculateMetric(IEnumerable<(double X, double Y)> points, Func<double, double> interpolate, string metric)
    {
        var diffs = points.Select(point => point.Y - interpolate(point.X)).ToList();
        return metric switch
        {
            "max" => diffs.Max(diff => Math.Abs(diff)),
            "rmse" => Math.Sqrt(diffs.Sum(diff => diff * diff) / Math.Max(1, diffs.Count)),
            _ => throw new ArgumentException("metric must be 'max' or 'rmse'", nameof(metric)),
        };
    }
}
