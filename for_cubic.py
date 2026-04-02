import numpy as np
from scipy.interpolate import CubicSpline


def _prepare_xy(x, y):
    """
    Приводит x, y к numpy-массивам, сортирует по x и проверяет входные данные.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    if x.ndim != 1 or y.ndim != 1:
        raise ValueError("x и y должны быть одномерными массивами")
    if x.size != y.size:
        raise ValueError("x и y должны быть одинаковой длины")
    if x.size < 2:
        raise ValueError("Нужно минимум 2 точки")

    order = np.argsort(x)
    x_sorted = x[order]
    y_sorted = y[order]

    if np.any(np.diff(x_sorted) <= 0):
        raise ValueError("Значения x должны быть строго уникальны и возрастающими")

    return x_sorted, y_sorted, order


def _build_interpolator(x_nodes, y_nodes, bc_type="natural"):
    """
    Если узлов 2 -> линейная интерполяция.
    Если узлов >= 3 -> кубический сплайн.
    """
    x_nodes = np.asarray(x_nodes, dtype=float)
    y_nodes = np.asarray(y_nodes, dtype=float)

    if x_nodes.size == 2:
        return lambda xq: np.interp(xq, x_nodes, y_nodes)

    return CubicSpline(x_nodes, y_nodes, bc_type=bc_type)


def _calc_metric(y_true, y_pred, metric="max"):
    """
    metric:
        - 'max'  : максимальная абсолютная ошибка
        - 'rmse' : среднеквадратичная ошибка
    """
    diff = y_true - y_pred

    if metric == "max":
        return float(np.max(np.abs(diff)))
    if metric == "rmse":
        return float(np.sqrt(np.mean(diff * diff)))

    raise ValueError("metric должен быть 'max' или 'rmse'")


def _gap_mask(x, selected_indices, min_x_gap):
    """
    Возвращает булеву маску допустимых кандидатов с учётом минимального расстояния по x.
    """
    n = x.size
    mask = np.ones(n, dtype=bool)
    mask[selected_indices] = False

    if min_x_gap is None:
        return mask

    selected_x = x[selected_indices]
    for xs in selected_x:
        mask &= (np.abs(x - xs) >= min_x_gap)

    return mask


def select_spline_points_greedy(
    x,
    y,
    total_points=5,
    metric="max",
    bc_type="natural",
    min_x_gap=None,
    refine_passes=2,
    refine_radius=30,
):
    """
    Жадный выбор узлов для сплайна:
    - первая и последняя точки фиксированы;
    - внутренние добавляются по максимуму текущей абсолютной ошибки;
    - затем выполняется локальное улучшение.

    Параметры:
        x, y           : исходные точки
        total_points   : сколько точек оставить всего (включая 2 границы)
        metric         : 'max' или 'rmse' для итоговой оценки качества
        bc_type        : тип граничных условий для CubicSpline
        min_x_gap      : минимальное расстояние по x между выбранными узлами
        refine_passes  : число проходов локального улучшения
        refine_radius  : радиус поиска по индексам при локальном улучшении

    Возвращает:
        dict с полями:
            selected_indices_sorted  - индексы в отсортированном массиве
            selected_indices_original - индексы в исходном массиве
            selected_x, selected_y
            model
            error
    """
    x, y, order = _prepare_xy(x, y)
    n = x.size

    if total_points < 2 or total_points > n:
        raise ValueError("total_points должно быть в диапазоне [2, len(x)]")

    # Левая и правая границы фиксированы
    selected = [0, n - 1]

    # Жадное добавление узлов
    while len(selected) < total_points:
        selected.sort()

        model = _build_interpolator(x[selected], y[selected], bc_type=bc_type)
        y_pred = model(x)
        abs_err = np.abs(y - y_pred)

        candidate_mask = _gap_mask(x, selected, min_x_gap=min_x_gap)

        # Границы уже выбраны и не могут быть кандидатами
        candidate_mask[0] = False
        candidate_mask[-1] = False

        if not np.any(candidate_mask):
            break

        masked_err = np.where(candidate_mask, abs_err, -np.inf)
        best_idx = int(np.argmax(masked_err))
        selected.append(best_idx)

    selected.sort()

    # Локальное улучшение
    for _ in range(refine_passes):
        improved = False

        for pos in range(1, len(selected) - 1):
            current_idx = selected[pos]

            current_model = _build_interpolator(x[selected], y[selected], bc_type=bc_type)
            current_error = _calc_metric(y, current_model(x), metric=metric)

            best_idx = current_idx
            best_error = current_error

            left = max(1, current_idx - refine_radius)
            right = min(n - 2, current_idx + refine_radius)

            for cand in range(left, right + 1):
                if cand == current_idx or cand in selected:
                    continue

                trial = selected.copy()
                trial[pos] = cand
                trial.sort()

                if min_x_gap is not None:
                    gaps = np.diff(x[trial])
                    if np.any(gaps < min_x_gap):
                        continue

                trial_model = _build_interpolator(x[trial], y[trial], bc_type=bc_type)
                trial_error = _calc_metric(y, trial_model(x), metric=metric)

                if trial_error < best_error:
                    best_error = trial_error
                    best_idx = cand

            if best_idx != current_idx:
                selected[pos] = best_idx
                selected.sort()
                improved = True

        if not improved:
            break

    selected = np.array(sorted(selected), dtype=int)
    model = _build_interpolator(x[selected], y[selected], bc_type=bc_type)
    final_error = _calc_metric(y, model(x), metric=metric)

    original_indices = order[selected]

    return {
        "selected_indices_sorted": selected,
        "selected_indices_original": original_indices,
        "selected_x": x[selected],
        "selected_y": y[selected],
        "model": model,
        "error": final_error,
    }