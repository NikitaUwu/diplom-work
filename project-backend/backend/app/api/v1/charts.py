from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.schemas.chart import ChartCreateResponse
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
