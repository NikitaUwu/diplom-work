from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.crud.chart import chart_crud
from app.db.models.user import User
from app.schemas.chart import (
    ChartCreateResponse,
    ChartDetail,
    ChartListItem,
    ExportFormat,
)
from app.schemas.ml import MlMeta, Panel
from app.services.charts import chart_service
from app.utils.export import export_to_csv, export_to_txt

router = APIRouter()


@router.post(
    "/upload",
    response_model=ChartCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_chart(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChartCreateResponse:
    """
    Загрузка файла с графиком и его обработка.
    Пока ML-пайплайн не реализован, вернёт 501.
    """
    return await chart_service.upload_and_process(
        db=db,
        user=current_user,
        upload=file,
    )


@router.get(
    "",
    response_model=List[ChartListItem],
)
def list_charts(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[ChartListItem]:
    """
    Список графиков текущего пользователя.
    """
    return chart_service.list_charts_for_user(
        db=db,
        user=current_user,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/{chart_id}",
    response_model=ChartDetail,
)
def get_chart(
    chart_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChartDetail:
    """
    Детальная информация по одному графику: панели, серии, точки.
    """
    return chart_service.get_chart_detail(
        db=db,
        user=current_user,
        chart_id=chart_id,
    )


@router.get(
    "/{chart_id}/export",
    response_class=PlainTextResponse,
)
def export_chart(
    chart_id: int,
    format: ExportFormat = Query(ExportFormat.csv),
    panel_id: Optional[str] = Query(None),
    series_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlainTextResponse:
    """
    Экспорт точек графика в CSV или TXT.
    Можно фильтровать по panel_id и series_id.
    """
    chart = chart_crud.get_for_user(
        db, chart_id=chart_id, user_id=current_user.id
    )
    if not chart:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chart not found",
        )

    if not chart.result_json:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chart has no processed data to export",
        )

    # Восстанавливаем панели из сохранённого JSON
    result = chart.result_json or {}
    panels_data = result.get("panels") or []
    panels: List[Panel] = [Panel.model_validate(p) for p in panels_data]
    # ml_meta пригодится позже, если будешь экспортировать и метаданные
    _ml_meta_data = result.get("ml_meta")
    _ml_meta: Optional[MlMeta] = (
        MlMeta.model_validate(_ml_meta_data) if _ml_meta_data else None
    )

    if format == ExportFormat.csv:
        text = export_to_csv(panels, panel_id=panel_id, series_id=series_id)
        media_type = "text/csv"
        ext = "csv"
    else:
        text = export_to_txt(panels, panel_id=panel_id, series_id=series_id)
        media_type = "text/plain"
        ext = "txt"

    filename = f"chart_{chart_id}.{ext}"

    return PlainTextResponse(
        content=text,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
