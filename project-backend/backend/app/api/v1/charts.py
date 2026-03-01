from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status, Response
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.core.config import settings
from app.db.models.chart import Chart
from app.schemas.chart import ChartCreateResponse, ChartStatus
from app.schemas.ml import Panel
from app.services.charts import ChartService
from app.utils.export import export_to_csv, export_to_txt, export_to_json

router = APIRouter()
chart_service = ChartService()


def _get_user_chart_or_404(db: Session, chart_id: int, user_id: int) -> Chart:
    chart = (
        db.query(Chart)
        .filter(Chart.id == chart_id, Chart.user_id == user_id)
        .first()
    )
    if not chart:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chart not found",
        )
    return chart


def _parse_chart_status(raw_status: str) -> ChartStatus:
    try:
        return ChartStatus(raw_status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Invalid chart status in DB: {raw_status}",
        )


def _to_chart_response(chart: Chart) -> ChartCreateResponse:
    return ChartCreateResponse(
        id=chart.id,
        status=_parse_chart_status(chart.status),
        original_filename=chart.original_filename,
        mime_type=chart.mime_type,
        created_at=chart.created_at,
        processed_at=chart.processed_at,
        n_panels=chart.n_panels,
        n_series=chart.n_series,
        result_json=chart.result_json,
        error_message=chart.error_message,
    )


def _storage_root() -> Path:
    return Path(settings.storage_dir).resolve()


def _resolve_in_storage(raw_path: str, *, allow_absolute: bool) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Invalid file path")

    storage_root = _storage_root()
    p = Path(raw_path)

    if p.is_absolute():
        if not allow_absolute:
            raise HTTPException(status_code=400, detail="Invalid file path")
        file_path = p.resolve()
    else:
        file_path = (storage_root / p).resolve()

    # path traversal protection
    if file_path != storage_root and storage_root not in file_path.parents:
        raise HTTPException(status_code=400, detail="Invalid file path")

    return file_path


def _parse_panels_or_409(chart: Chart) -> list[Panel]:
    payload = chart.result_json or {}
    panels_raw = payload.get("panels")
    if not isinstance(panels_raw, list) or not panels_raw:
        raise HTTPException(status_code=409, detail="Export is not available yet")

    panels: list[Panel] = []
    for p in panels_raw:
        try:
            panels.append(Panel.model_validate(p))
        except (ValidationError, TypeError, ValueError):
            raise HTTPException(status_code=500, detail="Invalid panels format in result_json")
    return panels


@router.post("/upload", response_model=ChartCreateResponse)
async def upload_chart(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    return await chart_service.upload_and_enqueue(
        db,
        user_id=current_user.id,
        upload=file,
    )


@router.get("/{chart_id}", response_model=ChartCreateResponse)
def get_chart(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ChartCreateResponse:
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    return _to_chart_response(chart)


@router.get("/{chart_id}/artifact/{key}")
def get_chart_artifact(
    chart_id: int,
    key: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    payload = chart.result_json or {}
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, dict) or key not in artifacts:
        raise HTTPException(status_code=404, detail="Artifact not found")

    rel = artifacts[key]
    file_path = _resolve_in_storage(rel, allow_absolute=False)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Artifact file missing on disk")

    return FileResponse(str(file_path))


@router.get("/{chart_id}/export.csv")
def export_chart_csv(
    chart_id: int,
    panel_id: str | None = None,
    series_id: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    panels = _parse_panels_or_409(chart)

    content = export_to_csv(panels, panel_id=panel_id, series_id=series_id)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="chart_{chart_id}.csv"'},
    )


@router.get("/{chart_id}/export.txt")
def export_chart_txt(
    chart_id: int,
    panel_id: str | None = None,
    series_id: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    panels = _parse_panels_or_409(chart)

    content = export_to_txt(panels, panel_id=panel_id, series_id=series_id)
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="chart_{chart_id}.txt"'},
    )


@router.get("/{chart_id}/export.json")
def export_chart_json(
    chart_id: int,
    panel_id: str | None = None,
    series_id: str | None = None,
    pretty: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)
    panels = _parse_panels_or_409(chart)

    content = export_to_json(panels, panel_id=panel_id, series_id=series_id, pretty=pretty)
    return Response(
        content=content,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="chart_{chart_id}.json"'},
    )


@router.get("", response_model=list[ChartCreateResponse])
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
    return [_to_chart_response(c) for c in rows]


@router.get("/{chart_id}/original")
def get_original_image(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    # поддерживает и относительные, и абсолютные пути (но только внутри storage_dir)
    file_path = _resolve_in_storage(chart.original_path, allow_absolute=True)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Original file missing on disk")

    return FileResponse(str(file_path), media_type=chart.mime_type or None)


@router.delete("/{chart_id}", status_code=204)
def delete_chart(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    chart = _get_user_chart_or_404(db, chart_id, current_user.id)

    # удаление файлов безопасно внутри storage_dir
    db.delete(chart)
    db.commit()

    return Response(status_code=204)