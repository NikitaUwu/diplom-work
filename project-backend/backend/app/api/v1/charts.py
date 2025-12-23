from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.core.config import settings
from app.db.models.chart import Chart
from app.schemas.chart import ChartCreateResponse, ChartStatus
from app.services.charts import ChartService

router = APIRouter()
chart_service = ChartService()


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
    chart = (
        db.query(Chart)
        .filter(Chart.id == chart_id, Chart.user_id == current_user.id)
        .first()
    )
    if not chart:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chart not found",
        )

    return ChartCreateResponse(
        id=chart.id,
        status=ChartStatus(chart.status),
        original_filename=chart.original_filename,
        mime_type=chart.mime_type,
        created_at=chart.created_at,
        processed_at=chart.processed_at,
        n_panels=chart.n_panels,
        n_series=chart.n_series,
        result_json=chart.result_json,
        error_message=chart.error_message,
    )


@router.get("/{chart_id}/artifact/{key}")
def get_chart_artifact(
    chart_id: int,
    key: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Отдаёт артефакт пайплайна (картинки/plot) по ключу из result_json["artifacts"].
    Ключи: lineformer_prediction, chartdete_predictions, converted_plot.
    """
    chart = (
        db.query(Chart)
        .filter(Chart.id == chart_id, Chart.user_id == current_user.id)
        .first()
    )
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    payload = chart.result_json or {}
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, dict) or key not in artifacts:
        raise HTTPException(status_code=404, detail="Artifact not found")

    rel = artifacts[key]
    if not isinstance(rel, str) or rel.startswith(("/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    storage_root = settings.storage_dir.resolve()
    file_path = (storage_root / Path(rel)).resolve()

    # защита от выхода за пределы storage (path traversal)
    if storage_root not in file_path.parents:
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Artifact file missing on disk")

    return FileResponse(str(file_path))
