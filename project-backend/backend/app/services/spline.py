from __future__ import annotations

from typing import Iterable


Point = tuple[float, float]


def _sorted_points(points: Iterable[Point]) -> list[Point]:
    clean = [(float(x), float(y)) for x, y in points]
    clean.sort(key=lambda item: item[0])
    return clean


def sample_cubic_spline(
    points: Iterable[Point],
    *,
    samples: int = 300,
) -> list[list[float]]:
    pts = _sorted_points(points)
    if len(pts) < 3:
        return [[x, y] for x, y in pts]

    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]

    for idx in range(1, len(xs)):
        if xs[idx] == xs[idx - 1]:
            return [[x, y] for x, y in pts]

    n = len(xs)
    h = [xs[idx + 1] - xs[idx] for idx in range(n - 1)]
    if any(step == 0 for step in h):
        return [[x, y] for x, y in pts]

    a = [0.0] * n
    b = [0.0] * n
    c = [0.0] * n
    d = [0.0] * n

    b[0] = 1.0
    b[n - 1] = 1.0

    for idx in range(1, n - 1):
        a[idx] = h[idx - 1]
        b[idx] = 2.0 * (h[idx - 1] + h[idx])
        c[idx] = h[idx]
        d[idx] = 3.0 * (
            (ys[idx + 1] - ys[idx]) / h[idx]
            - (ys[idx] - ys[idx - 1]) / h[idx - 1]
        )

    for idx in range(1, n):
        weight = a[idx] / b[idx - 1]
        b[idx] = b[idx] - weight * c[idx - 1]
        d[idx] = d[idx] - weight * d[idx - 1]

    cc = [0.0] * n
    cc[n - 1] = d[n - 1] / b[n - 1]
    for idx in range(n - 2, -1, -1):
        cc[idx] = (d[idx] - c[idx] * cc[idx + 1]) / b[idx]

    bb = [0.0] * (n - 1)
    dd = [0.0] * (n - 1)
    aa = ys[:-1]

    for idx in range(n - 1):
        bb[idx] = (
            (ys[idx + 1] - ys[idx]) / h[idx]
            - (h[idx] * (2.0 * cc[idx] + cc[idx + 1])) / 3.0
        )
        dd[idx] = (cc[idx + 1] - cc[idx]) / (3.0 * h[idx])

    segments = [
        {
            'x0': xs[idx],
            'x1': xs[idx + 1],
            'a': aa[idx],
            'b': bb[idx],
            'c': cc[idx],
            'd': dd[idx],
        }
        for idx in range(n - 1)
    ]

    x_min = pts[0][0]
    x_max = pts[-1][0]
    sample_count = max(50, int(samples))

    out: list[list[float]] = []
    for idx in range(sample_count + 1):
        x = x_min + ((x_max - x_min) * idx) / sample_count
        seg_index = len(segments) - 1
        for candidate_idx, segment in enumerate(segments):
            if x <= segment['x1']:
                seg_index = candidate_idx
                break

        segment = segments[seg_index]
        dx = x - segment['x0']
        y = (
            segment['a']
            + segment['b'] * dx
            + segment['c'] * dx * dx
            + segment['d'] * dx * dx * dx
        )
        out.append([x, y])

    return out
