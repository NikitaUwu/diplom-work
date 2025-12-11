from io import StringIO
from typing import Iterable, List, Optional, Tuple

from app.schemas.ml import Panel, Series


def _iter_flat_points(
    panels: List[Panel],
    panel_filter: Optional[str] = None,
    series_filter: Optional[str] = None,
) -> Iterable[Tuple[str, str, float, float]]:
    """
    Плоский итератор по точкам:
    на выходе кортежи (panel_id, series_id, x, y),
    с учётом фильтров panel_id / series_id.
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
    Формирует CSV-строку со столбцами:
    panel_id,series_id,x,y

    Если заданы panel_id / series_id — экспортируем только их.
    """
    output = StringIO()

    # Шапка
    output.write("panel_id,series_id,x,y\n")

    # Строки
    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        # Простейшее форматирование: через запятую, без экранирования
        output.write(f"{p_id},{s_id},{x},{y}\n")

    return output.getvalue()


def export_to_txt(
    panels: List[Panel],
    panel_id: Optional[str] = None,
    series_id: Optional[str] = None,
) -> str:
    """
    Формирует простой текстовый формат.
    По умолчанию: табличные строки с разделителем табуляции:

    panel_id<TAB>series_id<TAB>x<TAB>y
    """
    output = StringIO()

    # Шапка
    output.write("panel_id\tseries_id\tx\ty\n")

    # Строки
    for p_id, s_id, x, y in _iter_flat_points(panels, panel_id, series_id):
        output.write(f"{p_id}\t{s_id}\t{x}\t{y}\n")

    return output.getvalue()
