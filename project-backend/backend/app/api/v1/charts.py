from pathlib import Path
import codecs
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models.chart import Chart
from app.schemas.chart import (
    ChartCreateResponse,
    ChartExportFormat,
    ChartSplinePointsRequest,
    ChartStatus,
    ChartUpdateRequest,
)
from app.schemas.ml import Panel
from app.services.chart_editor import build_editor_result_json
from app.services.charts import ChartService
from app.services.cubic_selection import select_cubic_spline_points
from app.services.editor_overlay import ensure_editor_alignment
from app.utils.export import export_to_csv, export_to_json, export_to_table_csv, export_to_txt

router = APIRouter()
chart_service = ChartService()


def _csv_excel_bytes(text: str) -> bytes:
    return codecs.BOM_UTF16_LE + text.encode('utf-16-le')


def _get_user_chart_or_404(db: Session, chart_id: int, user_id: int) -> Chart:
    chart = db.query(Chart).filter(Chart.id == chart_id, Chart.user_id == user_id).first()
    if not chart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Chart not found')
    return chart


def _parse_chart_status(raw_status: str) -> ChartStatus:
    try:
        return ChartStatus(raw_status)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Invalid chart status in DB: {raw_status}',
        ) from exc


def _to_chart_response(
    chart: Chart,
    *,
    result_json: dict | None = None,
) -> ChartCreateResponse:
    return ChartCreateResponse(
        id=chart.id,
        status=_parse_chart_status(chart.status),
        original_filename=chart.original_filename,
        mime_type=chart.mime_type,
        created_at=chart.created_at,
        processed_at=chart.processed_at,
        n_panels=chart.n_panels,
        n_series=chart.n_series,
        result_json=chart.result_json if result_json is None else result_json,
        error_message=chart.error_message,
    )


def _storage_root() -> Path:
    return Path(settings.storage_dir).resolve()


def _ensure_in_storage(file_path: Path) -> Path:
    storage_root = _storage_root()
    resolved = file_path.resolve()

    if resolved != storage_root and storage_root not in resolved.parents:
        raise HTTPException(status_code=400, detail='Invalid file path')

    return resolved


def _resolve_in_storage(raw_path: str, *, allow_absolute: bool) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail='Invalid file path')

    storage_root = _storage_root()
    path = Path(raw_path)

    if path.is_absolute():
        if not allow_absolute:
            raise HTTPException(status_code=400, detail='Invalid file path')
        return _ensure_in_storage(path)

    return _ensure_in_storage(storage_root / path)


def _chart_dir_from_chart(chart: Chart) -> Path:
    if not isinstance(chart.original_path, str) or not chart.original_path.strip():
        raise HTTPException(status_code=404, detail='Chart files are missing')

    original_path = _resolve_in_storage(chart.original_path, allow_absolute=True)
    return _ensure_in_storage(original_path.parent)


def _resolve_artifact_path(chart: Chart, raw_path: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail='Invalid file path')

    path = Path(raw_path)
    if path.is_absolute():
        return _ensure_in_storage(path)

    by_storage = _resolve_in_storage(raw_path, allow_absolute=False)
    if by_storage.exists():
        return by_storage

    chart_dir = _chart_dir_from_chart(chart)
    return _ensure_in_storage(chart_dir / raw_path)


def _parse_panels(
    payload: dict,
    *,
    missing_status: int = 400,
    invalid_status: int = 400,
    missing_detail: str = 'Invalid panels',
    invalid_detail: str = 'Invalid panels',
) -> list[Panel]:
    panels_raw = payload.get('panels')
    if not isinstance(panels_raw, list) or not panels_raw:
        raise HTTPException(status_code=missing_status, detail=missing_detail)

    panels: list[Panel] = []
    for panel_raw in panels_raw:
        try:
            panels.append(Panel.model_validate(panel_raw))
        except (ValidationError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=invalid_status, detail=invalid_detail) from exc
    return panels


def _parse_panels_or_409(chart: Chart) -> list[Panel]:
    payload = chart.result_json or {}
    if isinstance(payload, dict):
        payload = ensure_editor_alignment(chart.id, payload)
    return _parse_panels(
        payload,
        missing_status=409,
        invalid_status=500,
        missing_detail='Export is not available yet',
        invalid_detail='Invalid panels format in result_json',
    )


def _prepare_result_json(payload: dict) -> tuple[list[Panel], dict]:
    panels = _parse_panels(payload)
    return panels, build_editor_result_json(payload, panels)


def _prepared_chart_response(chart: Chart) -> ChartCreateResponse:
    result_json = chart.result_json
    if chart.status == ChartStatus.done.value and isinstance(result_json, dict):
        result_json = ensure_editor_alignment(chart.id, result_json)
        try:
            _, result_json = _prepare_result_json(result_json)
        except HTTPException:
            if isinstance(chart.result_json, dict):
                result_json = ensure_editor_alignment(chart.id, chart.result_json)
            else:
                result_json = chart.result_json

    return _to_chart_response(chart, result_json=result_json)


def _resolve_chart_file(chart: Chart, file_key: str) -> tuple[Path, str | None]:
    if file_key == 'original':
        file_path = _resolve_in_storage(chart.original_path, allow_absolute=True)
        media_type = chart.mime_type or None
    else:
        payload = chart.result_json or {}
        artifacts = payload.get('artifacts')
        if not isinstance(artifacts, dict) or file_key not in artifacts:
            raise HTTPException(status_code=404, detail='File not found')
        file_path = _resolve_artifact_path(chart, artifacts[file_key])
        media_type = None

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail='File is missing on disk')

    return file_path, media_type


@router.post('/upload', response_model=ChartCreateResponse)
async def upload_chart(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    return await chart_service.upload_and_enqueue(db, user_id=current_user.id, upload=file)


@router.get('', response_model=list[ChartCreateResponse])
def list_my_charts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = (
        db.query(Chart)
        .filter(Chart.user_id == current_user.id)
        .order_by(Chart.created_at.desc())
        .all()
    )
    return [_to_chart_response(chart) for chart in rows]


@router.get('/{chart_id}', response_model=ChartCreateResponse)
def get_chart(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    return _prepared_chart_response(chart)


@router.get('/{chart_id}/files/{file_key}')
def get_chart_file(
    chart_id: int,
    file_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    file_path, media_type = _resolve_chart_file(chart, file_key)
    return FileResponse(str(file_path), media_type=media_type)


@router.get('/{chart_id}/export')
def export_chart(
    chart_id: int,
    format: ChartExportFormat = Query(...),
    panel_id: str | None = None,
    series_id: str | None = None,
    pretty: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    panels = _parse_panels_or_409(chart)

    if format == ChartExportFormat.csv:
        content = export_to_csv(panels, panel_id=panel_id, series_id=series_id)
        return Response(
            content=_csv_excel_bytes(content),
            media_type='application/vnd.ms-excel',
            headers={'Content-Disposition': f'attachment; filename="chart_{chart_id}.csv"'},
        )

    if format == ChartExportFormat.txt:
        content = export_to_txt(panels, panel_id=panel_id, series_id=series_id)
        return Response(
            content=content,
            media_type='text/plain; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="chart_{chart_id}.txt"'},
        )

    if format == ChartExportFormat.json:
        content = export_to_json(panels, panel_id=panel_id, series_id=series_id, pretty=pretty)
        return Response(
            content=content,
            media_type='application/json; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="chart_{chart_id}.json"'},
        )

    content = export_to_table_csv(
        panels,
        panel_id=panel_id,
        series_ids=[series_id] if series_id else None,
    )
    if not content:
        raise HTTPException(status_code=409, detail='Export is not available yet')

    return Response(
        content=_csv_excel_bytes(content),
        media_type='application/vnd.ms-excel',
        headers={'Content-Disposition': f'attachment; filename="chart_{chart_id}_table.csv"'},
    )


@router.patch('/{chart_id}', response_model=ChartCreateResponse)
def patch_chart(
    chart_id: int,
    payload: ChartUpdateRequest,
    persist: bool = Query(True),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    if chart.status != ChartStatus.done.value:
        raise HTTPException(status_code=409, detail='Chart is not ready for editing')

    aligned_payload = ensure_editor_alignment(chart.id, payload.result_json)
    panels, prepared_result_json = _prepare_result_json(aligned_payload)
    prepared_result_json = ensure_editor_alignment(chart.id, prepared_result_json)

    if not persist:
        return _to_chart_response(chart, result_json=prepared_result_json)

    chart.result_json = prepared_result_json
    chart.n_panels = len(panels)
    chart.n_series = sum(len(panel.series) for panel in panels)

    db.commit()
    db.refresh(chart)
    return _to_chart_response(chart, result_json=prepared_result_json)


@router.post('/{chart_id}/cubic-preview', response_model=ChartCreateResponse)
def preview_chart_with_cubic_points(
    chart_id: int,
    payload: ChartSplinePointsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    if chart.status != ChartStatus.done.value:
        raise HTTPException(status_code=409, detail='Chart is not ready for editing')

    base_result_json = chart.result_json or {}
    if isinstance(base_result_json, dict):
        base_result_json = ensure_editor_alignment(chart.id, base_result_json)
    panels = _parse_panels(
        base_result_json,
        missing_status=409,
        invalid_status=500,
        missing_detail='Export is not available yet',
        invalid_detail='Invalid panels format in result_json',
    )
    prepared_result_json = build_editor_result_json(
        base_result_json,
        panels,
        point_transform=lambda points: select_cubic_spline_points(points, total_points=payload.total_points),
    )
    prepared_result_json = ensure_editor_alignment(chart.id, prepared_result_json)
    return _to_chart_response(chart, result_json=prepared_result_json)


@router.delete('/{chart_id}', status_code=204)
def delete_chart(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    chart_dir: Path | None = None
    try:
        chart_dir = _chart_dir_from_chart(chart)
    except HTTPException:
        chart_dir = None

    db.delete(chart)
    db.commit()

    if chart_dir and chart_dir.exists() and chart_dir.is_dir():
        shutil.rmtree(chart_dir, ignore_errors=True)

    return Response(status_code=204)
