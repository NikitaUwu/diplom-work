from __future__ import annotations

import argparse
import fnmatch
import json
import shutil
from pathlib import Path
from typing import Iterable

import psycopg2
from psycopg2.extras import RealDictCursor


DEFAULT_PATTERNS = [
    "mqtt-live-*@example.com",
    "mqtt-probe-*@local.test",
]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _load_app_settings() -> dict:
    settings_path = _repo_root() / "diplomWork" / "appsettings.Development.json"
    return json.loads(settings_path.read_text(encoding="utf-8"))


def _parse_connection_string(connection_string: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for chunk in connection_string.split(";"):
        if not chunk.strip() or "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        parsed[key.strip().lower()] = value.strip()
    return parsed


def _connect():
    app_settings = _load_app_settings()["App"]
    db_config = _parse_connection_string(app_settings["DatabaseUrl"])
    return psycopg2.connect(
        host=db_config.get("host", "localhost"),
        port=int(db_config.get("port", "5432")),
        dbname=db_config.get("database", ""),
        user=db_config.get("username") or db_config.get("user id") or db_config.get("user"),
        password=db_config.get("password", ""),
    )


def _resolve_project_paths() -> tuple[Path, Path]:
    app_settings = _load_app_settings()["App"]
    backend_dir = _repo_root() / "diplomWork"

    storage_dir = Path(app_settings["StorageDir"])
    if not storage_dir.is_absolute():
        storage_dir = (backend_dir / storage_dir).resolve()

    worker_runs_root = Path(app_settings["WorkerRunsRoot"])
    if not worker_runs_root.is_absolute():
        worker_runs_root = (backend_dir / worker_runs_root).resolve()

    return storage_dir, worker_runs_root


def _matches_any_pattern(email: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(email, pattern) for pattern in patterns)


def _find_target_users(conn, exact_email: str | None, patterns: list[str]) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("select id, email from users order by id")
        users = cur.fetchall()

    if exact_email:
        return [user for user in users if str(user["email"]).strip().lower() == exact_email.strip().lower()]

    return [user for user in users if _matches_any_pattern(str(user["email"]).strip(), patterns)]


def _collect_target_data(conn, users: list[dict]) -> dict:
    user_ids = [int(user["id"]) for user in users]
    if not user_ids:
        return {
            "user_ids": [],
            "chart_ids": [],
            "processing_job_ids": [],
        }

    with conn.cursor() as cur:
        cur.execute("select id from charts where user_id = any(%s) order by id", (user_ids,))
        chart_ids = [row[0] for row in cur.fetchall()]

        processing_job_ids: list[int] = []
        if chart_ids:
            cur.execute("select id from processing_jobs where chart_id = any(%s) order by id", (chart_ids,))
            processing_job_ids = [row[0] for row in cur.fetchall()]

    return {
        "user_ids": user_ids,
        "chart_ids": chart_ids,
        "processing_job_ids": processing_job_ids,
    }


def _remove_tree_if_exists(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _delete_database_rows(conn, user_ids: list[int], chart_ids: list[int], processing_job_ids: list[int]) -> None:
    with conn:
        with conn.cursor() as cur:
            if processing_job_ids:
                cur.execute("delete from outbox_messages where processing_job_id = any(%s)", (processing_job_ids,))
            if chart_ids:
                cur.execute("delete from processing_jobs where chart_id = any(%s)", (chart_ids,))
                cur.execute("delete from charts where id = any(%s)", (chart_ids,))
            if user_ids:
                cur.execute("delete from users where id = any(%s)", (user_ids,))


def main() -> int:
    parser = argparse.ArgumentParser(description="Cleanup synthetic MQTT smoke/probe data.")
    parser.add_argument("--apply", action="store_true", help="Actually delete the matched test data.")
    parser.add_argument("--email", help="Delete only one exact synthetic test email.")
    parser.add_argument(
        "--pattern",
        action="append",
        default=[],
        help="Additional glob pattern for synthetic test emails.",
    )
    args = parser.parse_args()

    patterns = DEFAULT_PATTERNS + list(args.pattern)
    storage_dir, worker_runs_root = _resolve_project_paths()

    conn = _connect()
    try:
        users = _find_target_users(conn, args.email, patterns)
        data = _collect_target_data(conn, users)
    finally:
        conn.close()

    print("matched_users")
    for user in users:
        print(f"  user_id={user['id']} email={user['email']}")

    print("matched_chart_ids")
    for chart_id in data["chart_ids"]:
        print(f"  chart_id={chart_id}")

    if not users:
        print("no synthetic MQTT test users matched")
        return 0

    if not args.apply:
        print("dry-run only; pass --apply to delete the listed users, charts, jobs, and artifacts")
        return 0

    conn = _connect()
    try:
        _delete_database_rows(conn, data["user_ids"], data["chart_ids"], data["processing_job_ids"])
    finally:
        conn.close()

    for user_id in data["user_ids"]:
        _remove_tree_if_exists(storage_dir / f"user_{user_id}")

    for chart_id in data["chart_ids"]:
        _remove_tree_if_exists(worker_runs_root / f"chart_{chart_id}")

    print("cleanup_applied")
    print(f"  deleted_users={len(data['user_ids'])}")
    print(f"  deleted_charts={len(data['chart_ids'])}")
    print(f"  deleted_processing_jobs={len(data['processing_job_ids'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
