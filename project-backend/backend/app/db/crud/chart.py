from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.models.chart import Chart


class ChartCRUD:
    def create(
        self,
        db: Session,
        *,
        user_id: int,
        original_filename: str,
        mime_type: str,
        sha256: str,
        original_path: str,
        status: str,
    ) -> Chart:
        obj = Chart(
            user_id=user_id,
            original_filename=original_filename,
            mime_type=mime_type,
            sha256=sha256,
            original_path=original_path,
            status=status,
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    def get(self, db: Session, chart_id: int) -> Optional[Chart]:
        return db.query(Chart).filter(Chart.id == chart_id).first()

    def set_status(
        self,
        db: Session,
        chart_id: int,
        *,
        status: str,
        error_message: Optional[str] = None,
    ) -> Optional[Chart]:
        obj = self.get(db, chart_id)
        if not obj:
            return None
        obj.status = status
        obj.error_message = error_message
        db.commit()
        db.refresh(obj)
        return obj

    def set_result(
        self,
        db: Session,
        chart_id: int,
        *,
        result_json: dict[str, Any],
        n_panels: int,
        n_series: int,
    ) -> Optional[Chart]:
        obj = self.get(db, chart_id)
        if not obj:
            return None
        obj.result_json = result_json
        obj.n_panels = n_panels
        obj.n_series = n_series
        obj.status = "done"
        obj.error_message = None
        db.commit()
        db.refresh(obj)
        return obj


chart_crud = ChartCRUD()
