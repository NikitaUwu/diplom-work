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


def _storage_root() -> Path:
    root = Path(settings.storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _user_root(user_id: int) -> Path:
    root = (_storage_root() / f"user_{user_id}").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _chart_dir(user_id: int, chart_id: int) -> Path:
    root = _user_root(user_id)
    path = (root / str(chart_id)).resolve()
    if path != root and root not in path.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid storage path",
        )
    path.mkdir(parents=True, exist_ok=True)
    return path


class ChartService:
    async def upload_and_enqueue(
        self,
        db: Session,
        *,
        user_id: int,
        upload: UploadFile,
    ) -> ChartCreateResponse:
        original_path: Path | None = None
        chart_dir: Path | None = None
        wrote_new_file = False
        chart = None

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

            # 1) сначала создаём запись, чтобы получить chart.id
            chart = chart_crud.create(
                db,
                user_id=user_id,
                original_filename=filename,
                mime_type=upload.content_type or "application/octet-stream",
                sha256=sha,
                original_path="",  # обновим ниже
                status=ChartStatus.processing.value,
            )

            # 2) создаём папку user_N/<chart_id> и кладём туда оригинал
            chart_dir = _chart_dir(user_id, chart.id)
            original_path = (chart_dir / filename).resolve()

            user_root = _user_root(user_id)
            if original_path != user_root and user_root not in original_path.parents:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Invalid storage path",
                )

            await run_in_threadpool(original_path.write_bytes, file_bytes)
            wrote_new_file = True

            # 3) обновляем путь в БД
            chart.original_path = str(original_path)
            chart.status = ChartStatus.uploaded.value
            db.add(chart)
            db.commit()
            db.refresh(chart)

            return _to_chart_response(chart)

        except Exception:
            db.rollback()

            if wrote_new_file and original_path is not None:
                try:
                    await run_in_threadpool(original_path.unlink)
                except FileNotFoundError:
                    pass

            if chart_dir is not None:
                try:
                    await run_in_threadpool(chart_dir.rmdir)
                except OSError:
                    pass

            if chart is not None:
                try:
                    db.delete(chart)
                    db.commit()
                except Exception:
                    db.rollback()

            raise

        finally:
            await upload.close()