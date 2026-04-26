"""
One-shot script that repairs `artifacts` entries in `charts.result_json`
when the local worker saved them relative to `storage/user_<id>`
instead of the real storage root `storage/`.

For every chart where any artifact path points to a file that does not
exist in storage but would exist when prefixed with `user_<user_id>/`,
the script rewrites the path and updates the row.

Run with the environment that has psycopg2 available:

    & 'C:\\ProgramData\\miniconda3\\envs\\plextract1\\python.exe' `
        'C:\\Users\\Kiruma Souchi\\Desktop\\6lab\\test2\\scripts\\fix_artifact_paths.py'
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

import psycopg2
from psycopg2.extras import Json, RealDictCursor


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORAGE = REPO_ROOT / "diplomWork" / "storage"

CONNINFO = os.getenv(
    "DATABASE_URL_PLAIN",
    "host=localhost port=5432 dbname=chart_db user=postgres password=admin",
)
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(DEFAULT_STORAGE))).resolve()


def _fix_path(raw: str, user_id: int) -> tuple[str, bool]:
    """Return (possibly patched path, was_patched)."""
    if not isinstance(raw, str) or not raw:
        return raw, False

    normalized = raw.replace("\\", "/").lstrip("/")
    direct = (STORAGE_DIR / normalized).resolve()
    if direct.is_file():
        return normalized, normalized != raw

    prefixed = f"user_{user_id}/{normalized}"
    candidate = (STORAGE_DIR / prefixed).resolve()
    if candidate.is_file():
        return prefixed, True

    return normalized, normalized != raw


def _iter_charts(cur) -> list[Dict[str, Any]]:
    cur.execute(
        """
        SELECT id, user_id, result_json
        FROM charts
        WHERE status = 'done'
          AND result_json IS NOT NULL
        ORDER BY id
        """,
    )
    return cur.fetchall()


def main() -> None:
    print(f"[FIX] storage root: {STORAGE_DIR}")
    conn = psycopg2.connect(CONNINFO)
    conn.autocommit = False
    touched = 0
    scanned = 0
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            rows = _iter_charts(cur)
        print(f"[FIX] scanning {len(rows)} charts in status='done'")

        for row in rows:
            chart_id = row["id"]
            user_id = row["user_id"]
            result_json = row["result_json"]
            if not isinstance(result_json, dict):
                continue

            artifacts = result_json.get("artifacts")
            if not isinstance(artifacts, dict) or not artifacts:
                continue

            scanned += 1
            changed = False
            fixed_artifacts: Dict[str, str] = {}
            for key, raw in artifacts.items():
                new_value, was_patched = _fix_path(raw, user_id)
                fixed_artifacts[key] = new_value
                if was_patched:
                    changed = True
                    print(f"  [PATCH] chart {chart_id} {key}: {raw!r} -> {new_value!r}")

            if not changed:
                continue

            new_result_json = dict(result_json)
            new_result_json["artifacts"] = fixed_artifacts

            with conn.cursor() as upd:
                upd.execute(
                    "UPDATE charts SET result_json = %s WHERE id = %s",
                    (Json(new_result_json), chart_id),
                )
            touched += 1

        conn.commit()
        print(f"[FIX] done. scanned={scanned} touched={touched}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
