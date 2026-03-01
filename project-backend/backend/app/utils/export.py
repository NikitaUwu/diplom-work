from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Iterable, Optional, Tuple, List, Any

from app.schemas.ml import Panel


def _model_to_dict(obj: Any) -> dict:
    if hasattr(obj, "model_dump"):  # pydantic v2
        return obj.model_dump()
    if hasattr(obj, "dict"):  # pydantic v1
        return obj.dict()
    raise TypeError(f"Unsupported model type: {type(obj)!r}")


def _iter_flat_points(
    panels: List[Panel],
    panel_filter: Optional[str] = None,
    series_filter: Optional[str] = None,
) -> Iterable[Tuple[str, str, float, float]]:
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
    output = StringIO()
    writer = csv.writer(output, lineterminator="\n")

    writer.writerow(["series_id", "x", "y"])
    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        writer.writerow([s_id, x, y])

    return output.getvalue()


def export_to_txt(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    output = StringIO()
    output.write("series_id\tx\ty\n")

    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        output.write(f"{s_id}\t{x}\t{y}\n")

    return output.getvalue()


def export_to_json(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
    pretty: bool = False,
) -> str:
    out: dict = {"panels": []}

    for panel in panels:
        if panel_id and panel.id != panel_id:
            continue

        panel_dict = _model_to_dict(panel)
        panel_dict.pop("id", None)

        filtered_series = []
        for series in panel.series:
            if series_id and series.id != series_id:
                continue
            filtered_series.append(_model_to_dict(series))

        panel_dict["series"] = filtered_series
        out["panels"].append(panel_dict)

    return json.dumps(out, ensure_ascii=False, indent=2 if pretty else None)