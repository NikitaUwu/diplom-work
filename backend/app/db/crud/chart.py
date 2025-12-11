from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.models.chart import Chart
from app.db.models.user import User


class ChartCRUD:
    def create(
        self,
        db: Session,
        *,
        user: User,
        original_filename: str,
        mime_type: str,
        sha256: str,
        original_path: str,
        status: str = "uploaded",
    ) -> Chart:
        db_obj = Chart(
            user_id=user.id,
            original_filename=original_filename,
            mime_type=mime_type,
            sha256=sha256,
            status=status,
            original_path=original_path,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_id(self, db: Session, chart_id: int) -> Optional[Chart]:
        return db.query(Chart).filter(Chart.id == chart_id).first()

    def get_for_user(
        self,
        db: Session,
        *,
        chart_id: int,
        user_id: int,
    ) -> Optional[Chart]:
        return (
            db.query(Chart)
            .filter(Chart.id == chart_id, Chart.user_id == user_id)
            .first()
        )

    def get_multi_for_user(
        self,
        db: Session,
        *,
        user_id: int,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Chart]:
        return (
            db.query(Chart)
            .filter(Chart.user_id == user_id)
            .order_by(Chart.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def get_by_hash_for_user(
        self,
        db: Session,
        *,
        user_id: int,
        sha256: str,
    ) -> Optional[Chart]:
        """
        Можно использовать для кэша: если пользователь загружает тот же файл,
        не обязательно считать его заново.
        """
        return (
            db.query(Chart)
            .filter(Chart.user_id == user_id, Chart.sha256 == sha256, Chart.status == "done")
            .first()
        )

    def set_status(
        self,
        db: Session,
        *,
        chart: Chart,
        status: str,
        error_message: Optional[str] = None,
    ) -> Chart:
        chart.status = status
        if status == "error":
            chart.error_message = error_message
            chart.processed_at = datetime.now(timezone.utc)
        db.add(chart)
        db.commit()
        db.refresh(chart)
        return chart

    def save_result(
        self,
        db: Session,
        *,
        chart: Chart,
        result_json: Dict[str, Any],
        n_panels: Optional[int],
        n_series: Optional[int],
        preview_path: Optional[str] = None,
    ) -> Chart:
        chart.result_json = result_json
        chart.n_panels = n_panels
        chart.n_series = n_series
        chart.status = "done"
        chart.processed_at = datetime.now(timezone.utc)
        if preview_path is not None:
            chart.preview_path = preview_path

        db.add(chart)
        db.commit()
        db.refresh(chart)
        return chart


chart_crud = ChartCRUD()
