from typing import List, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.crud.chart import chart_crud
from app.db.models.chart import Chart
from app.db.models.user import User
from app.ml.pipeline import process_image
from app.schemas.chart import (
    ChartCreateResponse,
    ChartDetail,
    ChartListItem,
    ChartStatus,
)
from app.schemas.ml import MlMeta, Panel
from app.utils.files import build_original_file_path, save_bytes_to_file
from app.utils.hashing import sha256_bytes


class ChartService:
    """
    Сервис для работы с графиками:
    - приём и обработка загрузки,
    - чтение результатов,
    - список графиков пользователя.
    """

    async def upload_and_process(
        self,
        db: Session,
        *,
        user: User,
        upload: UploadFile,
        use_cache: bool = True,
    ) -> ChartCreateResponse:
        """
        Принимает загруженный файл, сохраняет его, запускает ML-пайплайн,
        сохраняет результат в БД и возвращает детальную информацию о графике.
        """
        # 1. Читаем файл в память
        file_bytes = await upload.read()
        if not file_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty file",
            )

        # 2. Считаем sha256 (для кэша и уникального имени файла)
        sha = sha256_bytes(file_bytes)

        # 3. Попробуем найти уже обработанный график с тем же sha256
        if use_cache:
            existing = chart_crud.get_by_hash_for_user(
                db, user_id=user.id, sha256=sha
            )
            if existing and existing.result_json:
                panels, ml_meta = self._parse_result_json(existing.result_json)
                return self._build_chart_detail(existing, panels, ml_meta)

        # 4. Формируем путь и сохраняем исходный файл
        original_path = build_original_file_path(
            user_id=user.id,
            sha256=sha,
            original_filename=upload.filename or "upload.bin",
        )
        save_bytes_to_file(file_bytes, original_path)

        # 5. Создаём запись Chart со статусом processing
        chart = chart_crud.create(
            db,
            user=user,
            original_filename=upload.filename or original_path.name,
            mime_type=upload.content_type or "application/octet-stream",
            sha256=sha,
            original_path=str(original_path),
            status=ChartStatus.processing.value,
        )

        # 6. Запускаем ML-пайплайн
        try:
            panels, ml_meta = process_image(original_path)
        except NotImplementedError:
            # Специальный случай: ML ещё не внедрён
            chart_crud.set_status(
                db,
                chart=chart,
                status=ChartStatus.error.value,
                error_message="ML pipeline is not implemented yet",
            )
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="ML pipeline is not implemented yet",
            )
        except Exception as e:
            # Любая другая ошибка обработки
            chart_crud.set_status(
                db,
                chart=chart,
                status=ChartStatus.error.value,
                error_message=str(e),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to process image",
            )

        # 7. Подсчитываем агрегаты
        n_panels = len(panels)
        n_series = sum(len(p.series) for p in panels)

        # 8. Готовим JSON для сохранения в БД
        result_json = {
            "panels": [p.model_dump() for p in panels],
            "ml_meta": ml_meta.model_dump() if ml_meta else None,
        }

        # 9. Сохраняем результат в БД (status = done)
        chart = chart_crud.save_result(
            db,
            chart=chart,
            result_json=result_json,
            n_panels=n_panels,
            n_series=n_series,
            preview_path=None,  # позже можно добавить путь к превью
        )

        # 10. Возвращаем детальную информацию
        return self._build_chart_detail(chart, panels, ml_meta)

    def get_chart_detail(
        self,
        db: Session,
        *,
        user: User,
        chart_id: int,
    ) -> ChartDetail:
        """
        Возвращает детальную информацию по одному графику для текущего пользователя.
        """
        chart = chart_crud.get_for_user(
            db, chart_id=chart_id, user_id=user.id
        )
        if not chart:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chart not found",
            )

        panels: List[Panel] = []
        ml_meta: Optional[MlMeta] = None
        if chart.result_json:
            panels, ml_meta = self._parse_result_json(chart.result_json)

        return self._build_chart_detail(chart, panels, ml_meta)

    def list_charts_for_user(
        self,
        db: Session,
        *,
        user: User,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ChartListItem]:
        """
        Возвращает список графиков для текущего пользователя.
        """
        charts = chart_crud.get_multi_for_user(
            db, user_id=user.id, skip=skip, limit=limit
        )
        items: List[ChartListItem] = []
        for c in charts:
            items.append(
                ChartListItem(
                    id=c.id,
                    status=ChartStatus(c.status),
                    original_filename=c.original_filename,
                    mime_type=c.mime_type,
                    created_at=c.created_at,
                    processed_at=c.processed_at,
                    n_panels=c.n_panels,
                    n_series=c.n_series,
                    error_message=c.error_message,
                )
            )
        return items

    def _parse_result_json(
        self, result_json: dict
    ) -> Tuple[List[Panel], Optional[MlMeta]]:
        """
        Восстанавливает Pydantic-модели Panel и MlMeta из JSON,
        лежащего в Chart.result_json.
        """
        panels_data = result_json.get("panels") or []
        ml_meta_data = result_json.get("ml_meta")

        panels = [Panel.model_validate(p) for p in panels_data]
        ml_meta = MlMeta.model_validate(ml_meta_data) if ml_meta_data else None

        return panels, ml_meta

    def _build_chart_detail(
        self,
        chart: Chart,
        panels: List[Panel],
        ml_meta: Optional[MlMeta],
    ) -> ChartCreateResponse:
        """
        Собирает Pydantic-схему детального графика из ORM-модели и Pydantic-моделей.
        """
        return ChartCreateResponse(
            id=chart.id,
            status=ChartStatus(chart.status),
            original_filename=chart.original_filename,
            mime_type=chart.mime_type,
            created_at=chart.created_at,
            processed_at=chart.processed_at,
            n_panels=chart.n_panels,
            n_series=chart.n_series,
            panels=panels,
            ml_meta=ml_meta,
            error_message=chart.error_message,
        )


chart_service = ChartService()
