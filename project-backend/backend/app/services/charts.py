from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.crud.chart import chart_crud
from app.schemas.chart import ChartCreateResponse, ChartStatus
from app.utils.hashing import sha256_bytes


def _safe_filename(name: str) -> str:
    cleaned = "".join(c for c in name if c.isalnum() or c in (".", "_", "-"))
    return (cleaned[:200] or "upload.bin")


class ChartService:
    async def upload_and_enqueue(
        self,
        db: Session,
        *,
        user_id: int,
        upload: UploadFile,
    ) -> ChartCreateResponse:
        file_bytes = await upload.read()
        if not file_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty file",
            )

        sha = sha256_bytes(file_bytes)
        filename = _safe_filename(upload.filename or "upload.bin")
        ext = Path(filename).suffix.lower() or ".bin"

        # сохраняем в STORAGE_DIR/ (важно: сохраняем абсолютный путь)
        base_dir = Path(settings.storage_dir).resolve()
        base_dir.mkdir(parents=True, exist_ok=True)

        original_path = (base_dir / f"user_{user_id}" / f"{sha}{ext}").resolve()
        original_path.parent.mkdir(parents=True, exist_ok=True)

        original_path.write_bytes(file_bytes)

        chart = chart_crud.create(
            db,
            user_id=user_id,
            original_filename=filename,
            mime_type=upload.content_type or "application/octet-stream",
            sha256=sha,
            original_path=str(original_path),
            status=ChartStatus.uploaded.value,
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
