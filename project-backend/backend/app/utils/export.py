from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Dict, Iterable, List, Optional, Tuple

from app.schemas.ml import Panel


CSV_DELIM = "\t"
CSV_EXCEL_SEP_HINT = f"sep={CSV_DELIM}\r\n"

def _csv_output() -> StringIO:
    return StringIO(CSV_EXCEL_SEP_HINT)


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


from typing import Iterable, Optional, Tuple, List
import json
import csv
from io import StringIO

from app.schemas.ml import Panel


def _iter_flat_points(
    panels: List[Panel],
    panel_filter: Optional[str] = None,
    series_filter: Optional[str] = None,
) -> Iterable[Tuple[str, float, float]]:
    for panel in panels:
        if panel_filter and panel.id != panel_filter:
            continue
        for series in panel.series:
            if series_filter and series.id != series_filter:
                continue
            for x, y in series.points:
                yield series.id, x, y


def export_to_csv(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    output = _csv_output()
    writer = csv.writer(output, delimiter=CSV_DELIM, lineterminator="\r\n")

    writer.writerow(["series_id", "x", "y"])
    for s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        writer.writerow([s_id, x, y])

    return output.getvalue()


def export_to_txt(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    output = StringIO()
    output.write("series_id\tx\ty\n")

    for s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        output.write(f"{s_id}\t{x}\t{y}\n")

    return output.getvalue()


def export_to_json(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
    pretty: bool = False,
) -> str:
    out_panels: list[dict] = []

    for p in panels:
        if panel_id and p.id != panel_id:
            continue

        out_series: list[dict] = []
        for s in p.series:
            if series_id and s.id != series_id:
                continue
            out_series.append(
                {
                    "id": s.id,
                    "name": getattr(s, "name", None),
                    "points": [[float(x), float(y)] for (x, y) in s.points],
                }
            )

        if out_series:
            out_panels.append({"series": out_series})

    return json.dumps(
        {"panels": out_panels},
        ensure_ascii=False,
        indent=2 if pretty else None,
    )


def _fmt_num(v: float) -> str:
    return format(float(v), ".15g")


def _unique_name(base: str, used: set[str]) -> str:
    base = (base or "").strip() or "series"
    if base not in used:
        used.add(base)
        return base
    i = 2
    while f"{base} ({i})" in used:
        i += 1
    name = f"{base} ({i})"
    used.add(name)
    return name


def export_to_table_csv(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_ids: Optional[List[str]] = None,
) -> str:
    """
    Табличный CSV:
    x; <series.name 1>; <series.name 2>; ...
    X — общий уникальный список по возрастанию.
    Ячейка пустая, если для данного X нет точки в серии.
    """
    selected = [p for p in panels if (not panel_id or p.id == panel_id)]
    if not selected:
        return ""

    allow_series = set(series_ids) if series_ids else None

    series_cols: List[Tuple[str, Dict[float, float]]] = []
    used_names: set[str] = set()

    for p in selected:
        for s in p.series:
            if allow_series and s.id not in allow_series:
                continue

            name = _unique_name(getattr(s, "name", "") or getattr(s, "id", ""), used_names)

            xy: Dict[float, float] = {}
            for x, y in s.points:
                try:
                    fx = float(x)
                    fy = float(y)
                except (TypeError, ValueError):
                    continue
                if not (fx == fx and fy == fy):  # NaN
                    continue
                xy[fx] = fy

            series_cols.append((name, xy))

    if not series_cols:
        return ""

    x_all = sorted({x for _, m in series_cols for x in m.keys()})

    output = _csv_output()
    writer = csv.writer(output, delimiter=CSV_DELIM, lineterminator="\r\n")

    header = ["x", *[name for name, _ in series_cols]]
    writer.writerow(header)

    for x in x_all:
        row = [_fmt_num(x)]
        for _, m in series_cols:
            y = m.get(x)
            row.append("" if y is None else _fmt_num(y))
        writer.writerow(row)

    return output.getvalue()