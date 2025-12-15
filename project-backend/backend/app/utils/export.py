from __future__ import annotations

import csv
from io import StringIO
from typing import Iterable, Optional, Tuple, List

from app.schemas.ml import Panel


def _iter_flat_points(
    panels: List[Panel],
    panel_filter: Optional[str] = None,
    series_filter: Optional[str] = None,
) -> Iterable[Tuple[str, str, float, float]]:
    """
    Плоский итератор по точкам:
    (panel_id, series_id, x, y), с учётом фильтров panel_id / series_id.
    """
    for panel in panels:
        if panel_filter and panel.id != panel_filter:
            continue
        for series in panel.series:
            if series_filter and series.id != series_filter:
                continue
            for x, y in series.points:
                yield panel.id, series.id, x, y


def export_to_csv(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    """
    CSV со столбцами: panel_id,series_id,x,y
    Если заданы panel_id / series_id — экспортируем только их.
    """
    output = StringIO()
    writer = csv.writer(output)

    writer.writerow(["panel_id", "series_id", "x", "y"])
    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        writer.writerow([p_id, s_id, x, y])

    return output.getvalue()


def export_to_txt(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    """
    Простой текстовый формат с табуляцией:
    panel_id<TAB>series_id<TAB>x<TAB>y
    """
    output = StringIO()
    output.write("panel_id\tseries_id\tx\ty\n")

    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        output.write(f"{p_id}\t{s_id}\t{x}\t{y}\n")

    return output.getvalue()
