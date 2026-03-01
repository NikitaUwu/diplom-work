from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.crud.chart import chart_crud
from app.schemas.chart import ChartCreateResponse, ChartStatus
from app.utils.hashing import sha256_bytes


def _safe_filename(name: str) -> str:
    cleaned = "".join(c for c in name if c.isalnum() or c in (".", "_", "-"))
    return cleaned[:200] or "upload.bin"


def _max_upload_bytes() -> int:
    raw = getattr(settings, "max_upload_bytes", 10 * 1024 * 1024)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 10 * 1024 * 1024
    return max(value, 1)


def _parse_chart_status(raw_status: str) -> ChartStatus:
    try:
        return ChartStatus(raw_status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Invalid chart status in DB: {raw_status}",
        )


def _to_chart_response(chart) -> ChartCreateResponse:
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


class ChartService:
    async def upload_and_enqueue(
        self,
        db: Session,
        *,
        user_id: int,
        upload: UploadFile,
    ) -> ChartCreateResponse:
        original_path: Path | None = None
        wrote_new_file = False

        try:
            max_bytes = _max_upload_bytes()
            buf = bytearray()

            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File is too large (max {max_bytes} bytes)",
                    )

            if not buf:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Empty file",
                )

            file_bytes = bytes(buf)
            sha = sha256_bytes(file_bytes)
            filename = _safe_filename(upload.filename or "upload.bin")
            ext = Path(filename).suffix.lower() or ".bin"

            base_dir = Path(settings.storage_dir).resolve()
            base_dir.mkdir(parents=True, exist_ok=True)

            original_path = (base_dir / f"user_{user_id}" / f"{sha}{ext}").resolve()
            if original_path != base_dir and base_dir not in original_path.parents:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Invalid storage path",
                )

            original_path.parent.mkdir(parents=True, exist_ok=True)

            if not original_path.exists():
                await run_in_threadpool(original_path.write_bytes, file_bytes)
                wrote_new_file = True

            try:
                chart = chart_crud.create(
                    db,
                    user_id=user_id,
                    original_filename=filename,
                    mime_type=upload.content_type or "application/octet-stream",
                    sha256=sha,
                    original_path=str(original_path),
                    status=ChartStatus.uploaded.value,
                )
            except Exception:
                db.rollback()
                if wrote_new_file and original_path is not None:
                    try:
                        await run_in_threadpool(original_path.unlink)
                    except FileNotFoundError:
                        pass
                raise

            return _to_chart_response(chart)

        finally:
            await upload.close()