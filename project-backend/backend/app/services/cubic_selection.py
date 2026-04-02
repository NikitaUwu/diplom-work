from __future__ import annotations

from bisect import bisect_right
from typing import Iterable


Point = tuple[float, float]


def _sorted_points(points: Iterable[Point]) -> list[Point]:
    clean = [(float(x), float(y)) for x, y in points]
    clean.sort(key=lambda item: item[0])
    return clean


def _linear_value(x_nodes: list[float], y_nodes: list[float], xq: float) -> float:
    if xq <= x_nodes[0]:
        return y_nodes[0]
    if xq >= x_nodes[-1]:
        return y_nodes[-1]

    right = bisect_right(x_nodes, xq)
    left = max(0, right - 1)
    right = min(len(x_nodes) - 1, right)

    x0 = x_nodes[left]
    x1 = x_nodes[right]
    y0 = y_nodes[left]
    y1 = y_nodes[right]

    if x1 == x0:
        return y0

    ratio = (xq - x0) / (x1 - x0)
    return y0 + (y1 - y0) * ratio


def _build_interpolator(points: list[Point]):
    if len(points) <= 1:
        y = points[0][1] if points else 0.0
        return lambda xq: y

    xs = [x for x, _ in points]
    ys = [y for _, y in points]

    if len(points) == 2:
        return lambda xq: _linear_value(xs, ys, xq)

    for idx in range(1, len(xs)):
        if xs[idx] <= xs[idx - 1]:
            return lambda xq: _linear_value(xs, ys, xq)

    n = len(xs)
    h = [xs[idx + 1] - xs[idx] for idx in range(n - 1)]

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

    for idx in range(n - 1):
        bb[idx] = (
            (ys[idx + 1] - ys[idx]) / h[idx]
            - (h[idx] * (2.0 * cc[idx] + cc[idx + 1])) / 3.0
        )
        dd[idx] = (cc[idx + 1] - cc[idx]) / (3.0 * h[idx])

    def evaluate(xq: float) -> float:
        if xq <= xs[0]:
            seg_idx = 0
        elif xq >= xs[-1]:
            seg_idx = len(xs) - 2
        else:
            seg_idx = min(len(xs) - 2, max(0, bisect_right(xs, xq) - 1))

        dx = xq - xs[seg_idx]
        return ys[seg_idx] + bb[seg_idx] * dx + cc[seg_idx] * dx * dx + dd[seg_idx] * dx * dx * dx

    return evaluate


def _calc_metric(points: list[Point], interpolate, metric: str) -> float:
    diffs = [y - interpolate(x) for x, y in points]

    if metric == 'max':
        return max(abs(diff) for diff in diffs)
    if metric == 'rmse':
        return (sum(diff * diff for diff in diffs) / max(1, len(diffs))) ** 0.5

    raise ValueError("metric must be 'max' or 'rmse'")


def select_cubic_spline_points(
    points: Iterable[Point],
    *,
    total_points: int,
    metric: str = 'max',
    refine_passes: int = 2,
    refine_radius: int = 30,
) -> list[Point]:
    sorted_points = _sorted_points(points)
    n = len(sorted_points)

    if total_points < 2:
        raise ValueError('total_points must be at least 2')

    if n <= 2 or total_points >= n:
        return sorted_points

    xs = [x for x, _ in sorted_points]
    for idx in range(1, len(xs)):
        if xs[idx] <= xs[idx - 1]:
            return sorted_points

    selected = [0, n - 1]

    while len(selected) < total_points:
        selected.sort()
        interpolate = _build_interpolator([sorted_points[idx] for idx in selected])

        best_idx: int | None = None
        best_error = float('-inf')
        selected_set = set(selected)

        for idx in range(1, n - 1):
            if idx in selected_set:
                continue

            x, y = sorted_points[idx]
            error = abs(y - interpolate(x))
            if error > best_error:
                best_error = error
                best_idx = idx

        if best_idx is None:
            break

        selected.append(best_idx)

    selected.sort()

    for _ in range(max(0, refine_passes)):
        improved = False

        for pos in range(1, len(selected) - 1):
            current_idx = selected[pos]
            current_interpolate = _build_interpolator([sorted_points[idx] for idx in selected])
            best_error = _calc_metric(sorted_points, current_interpolate, metric)
            best_idx = current_idx

            left = max(1, current_idx - refine_radius)
            right = min(n - 2, current_idx + refine_radius)

            for candidate_idx in range(left, right + 1):
                if candidate_idx == current_idx or candidate_idx in selected:
                    continue

                trial = selected.copy()
                trial[pos] = candidate_idx
                trial.sort()

                trial_interpolate = _build_interpolator([sorted_points[idx] for idx in trial])
                trial_error = _calc_metric(sorted_points, trial_interpolate, metric)

                if trial_error < best_error:
                    best_error = trial_error
                    best_idx = candidate_idx

            if best_idx != current_idx:
                selected[pos] = best_idx
                selected.sort()
                improved = True

        if not improved:
            break

    return [sorted_points[idx] for idx in sorted(selected)]