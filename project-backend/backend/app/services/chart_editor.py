from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

from app.schemas.ml import Panel
from app.services.spline import sample_cubic_spline


APPROXIMATION_METHOD = 'cubic_spline'
PointTransform = Callable[[list[tuple[float, float]]], list[tuple[float, float]]]


def build_editor_result_json(
    payload: dict[str, Any],
    panels: list[Panel],
    *,
    point_transform: PointTransform | None = None,
) -> dict[str, Any]:
    normalized: dict[str, Any] = deepcopy(payload)
    raw_panels = payload.get('panels') if isinstance(payload.get('panels'), list) else []

    normalized_panels: list[dict[str, Any]] = []
    for panel_index, panel in enumerate(panels):
        raw_panel = (
            raw_panels[panel_index]
            if panel_index < len(raw_panels) and isinstance(raw_panels[panel_index], dict)
            else {}
        )
        next_panel = dict(raw_panel)

        raw_series = raw_panel.get('series') if isinstance(raw_panel.get('series'), list) else []
        next_series: list[dict[str, Any]] = []

        for series_index, series in enumerate(panel.series):
            raw_series_item = (
                raw_series[series_index]
                if series_index < len(raw_series) and isinstance(raw_series[series_index], dict)
                else {}
            )
            next_series_item = dict(raw_series_item)
            next_series_item['id'] = series.id
            if series.name is not None:
                next_series_item['name'] = series.name
            elif 'name' in next_series_item and next_series_item['name'] is None:
                next_series_item.pop('name', None)

            next_points = [(float(x), float(y)) for x, y in series.points]
            if point_transform is not None:
                next_points = [(float(x), float(y)) for x, y in point_transform(next_points)]

            next_series_item['points'] = [[x, y] for x, y in next_points]
            next_series_item['approximation_method'] = APPROXIMATION_METHOD
            next_series_item['curve_points'] = sample_cubic_spline(next_points)
            next_series_item.pop('interp', None)
            next_series.append(next_series_item)

        next_panel['series'] = next_series
        normalized_panels.append(next_panel)

    normalized['panels'] = normalized_panels
    return normalized