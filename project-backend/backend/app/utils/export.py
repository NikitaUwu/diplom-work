from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Dict, Iterable, List, Optional, Tuple

from app.schemas.ml import Panel


CSV_DELIM = '\t'
CSV_EXCEL_SEP_HINT = f'sep={CSV_DELIM}\r\n'


def _csv_output() -> StringIO:
    return StringIO(CSV_EXCEL_SEP_HINT)


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
    writer = csv.writer(output, delimiter=CSV_DELIM, lineterminator='\r\n')

    writer.writerow(['series_id', 'x', 'y'])
    for series_name, x, y in _iter_flat_points(panels, panel_id, series_id):
        writer.writerow([series_name, x, y])

    return output.getvalue()


def export_to_txt(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    output = StringIO()
    output.write('series_id\tx\ty\n')

    for series_name, x, y in _iter_flat_points(panels, panel_id, series_id):
        output.write(f'{series_name}\t{x}\t{y}\n')

    return output.getvalue()


def export_to_json(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
    pretty: bool = False,
) -> str:
    out_panels: list[dict] = []

    for panel in panels:
        if panel_id and panel.id != panel_id:
            continue

        out_series: list[dict] = []
        for series in panel.series:
            if series_id and series.id != series_id:
                continue
            out_series.append(
                {
                    'id': series.id,
                    'name': getattr(series, 'name', None),
                    'points': [[float(x), float(y)] for (x, y) in series.points],
                }
            )

        if out_series:
            out_panels.append({'id': panel.id, 'series': out_series})

    return json.dumps(
        {'panels': out_panels},
        ensure_ascii=False,
        indent=2 if pretty else None,
    )


def _fmt_num(value: float) -> str:
    return format(float(value), '.15g')


def _unique_name(base: str, used: set[str]) -> str:
    base = (base or '').strip() or 'series'
    if base not in used:
        used.add(base)
        return base

    idx = 2
    while f'{base} ({idx})' in used:
        idx += 1

    name = f'{base} ({idx})'
    used.add(name)
    return name


def export_to_table_csv(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_ids: Optional[List[str]] = None,
) -> str:
    selected_panels = [panel for panel in panels if not panel_id or panel.id == panel_id]
    if not selected_panels:
        return ''

    allowed_series = set(series_ids) if series_ids else None

    series_cols: List[Tuple[str, Dict[float, float]]] = []
    used_names: set[str] = set()

    for panel in selected_panels:
        for series in panel.series:
            if allowed_series and series.id not in allowed_series:
                continue

            name = _unique_name(getattr(series, 'name', '') or getattr(series, 'id', ''), used_names)
            xy: Dict[float, float] = {}

            for x, y in series.points:
                try:
                    fx = float(x)
                    fy = float(y)
                except (TypeError, ValueError):
                    continue

                if not (fx == fx and fy == fy):
                    continue
                xy[fx] = fy

            series_cols.append((name, xy))

    if not series_cols:
        return ''

    x_all = sorted({x for _, mapping in series_cols for x in mapping.keys()})
    output = _csv_output()
    writer = csv.writer(output, delimiter=CSV_DELIM, lineterminator='\r\n')

    writer.writerow(['x', *[name for name, _ in series_cols]])
    for x in x_all:
        row = [_fmt_num(x)]
        for _, mapping in series_cols:
            y = mapping.get(x)
            row.append('' if y is None else _fmt_num(y))
        writer.writerow(row)

    return output.getvalue()
