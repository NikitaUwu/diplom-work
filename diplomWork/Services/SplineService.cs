namespace DiplomWork.Services;

public sealed class SplineService
{
    public List<List<double>> SampleCubicSpline(IEnumerable<(double X, double Y)> points, int samples = 300)
    {
        var pts = points
            .Select(point => (X: point.X, Y: point.Y))
            .OrderBy(point => point.X)
            .ToList();

        if (pts.Count < 3)
        {
            return pts.Select(point => new List<double> { point.X, point.Y }).ToList();
        }

        var xs = pts.Select(point => point.X).ToArray();
        var ys = pts.Select(point => point.Y).ToArray();
        for (var index = 1; index < xs.Length; index++)
        {
            if (Math.Abs(xs[index] - xs[index - 1]) <= double.Epsilon)
            {
                return pts.Select(point => new List<double> { point.X, point.Y }).ToList();
            }
        }

        var n = xs.Length;
        var h = new double[n - 1];
        for (var index = 0; index < n - 1; index++)
        {
            h[index] = xs[index + 1] - xs[index];
            if (Math.Abs(h[index]) <= double.Epsilon)
            {
                return pts.Select(point => new List<double> { point.X, point.Y }).ToList();
            }
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
        var aa = ys.Take(n - 1).ToArray();

        for (var index = 0; index < n - 1; index++)
        {
            bb[index] = ((ys[index + 1] - ys[index]) / h[index]) - ((h[index] * (2.0 * cc[index] + cc[index + 1])) / 3.0);
            dd[index] = (cc[index + 1] - cc[index]) / (3.0 * h[index]);
        }

        var segments = Enumerable.Range(0, n - 1)
            .Select(index => new
            {
                X0 = xs[index],
                X1 = xs[index + 1],
                A = aa[index],
                B = bb[index],
                C = cc[index],
                D = dd[index],
            })
            .ToList();

        var xMin = pts[0].X;
        var xMax = pts[^1].X;
        var sampleCount = Math.Max(50, samples);
        var result = new List<List<double>>(sampleCount + 1);

        for (var index = 0; index <= sampleCount; index++)
        {
            var x = xMin + ((xMax - xMin) * index) / sampleCount;
            var segment = segments[^1];
            foreach (var candidate in segments)
            {
                if (x <= candidate.X1)
                {
                    segment = candidate;
                    break;
                }
            }

            var dx = x - segment.X0;
            var y = segment.A + segment.B * dx + segment.C * dx * dx + segment.D * dx * dx * dx;
            result.Add([x, y]);
        }

        return result;
    }
}
