from __future__ import annotations

import json
import math
import os
import shutil
import sys
import threading
import queue
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import paho.mqtt.client as mqtt
import psycopg2
from dotenv import load_dotenv
from PIL import Image
from psycopg2.extras import Json, RealDictCursor


class PipelineOutputInvalidError(ValueError):
    def __init__(self, message: str, partial_result_json: Dict[str, Any]):
        super().__init__(message)
        artifacts = partial_result_json.get("artifacts")
        self.artifacts = dict(artifacts) if isinstance(artifacts, dict) else {}

os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECT_BACKEND_DIR = REPO_ROOT / "diplomWork"
ENV_PATH = PROJECT_BACKEND_DIR / ".env"

current_src = str(BASE_DIR / "src")
sys.path.insert(0, current_src)

try:
    from plextract.extract import extract

    print("[SUCCESS] plextract module found")
except ImportError as e:
    print(f"[ERROR] Failed to import plextract: {e}")
    sys.exit(1)


def _resolve_path(raw: str, base_dir: Path) -> Path:
    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (base_dir / candidate).resolve()


def _storage_dir_from_original(original_path: Path) -> Path:
    env = os.getenv("STORAGE_DIR")
    if env:
        return _resolve_path(env, PROJECT_BACKEND_DIR)

    if original_path.is_absolute():
        resolved = original_path.resolve()
        if len(resolved.parents) >= 3:
            return resolved.parents[2]

    return (PROJECT_BACKEND_DIR / "storage").resolve()


if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
    print(f"[DEBUG] Loaded env file: {ENV_PATH}")

def _env_flag(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in {"0", "false", "no", "off"}

MQTT_ENABLED = _env_flag("MQTT_ENABLED", True)
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_REQUEST_TOPIC = os.getenv("MQTT_PROCESS_REQUEST_TOPIC", "charts/process/request")
MQTT_ACCEPTED_TOPIC = os.getenv("MQTT_PROCESS_ACCEPTED_TOPIC", "charts/process/accepted")
MQTT_HEARTBEAT_TOPIC = os.getenv("MQTT_PROCESS_HEARTBEAT_TOPIC", "charts/process/heartbeat")
MQTT_COMPLETED_TOPIC = os.getenv("MQTT_PROCESS_COMPLETED_TOPIC", "charts/process/completed")
MQTT_FAILED_TOPIC = os.getenv("MQTT_PROCESS_FAILED_TOPIC", "charts/process/failed")
HEARTBEAT_INTERVAL_SECONDS = max(5, int(os.getenv("PROCESSING_HEARTBEAT_INTERVAL_SECONDS", "10")))
WORK_DIR = Path(os.getenv("WORK_DIR", str(REPO_ROOT / "ml-worker" / "runs" / "worker"))).resolve()
WORKER_ID = os.getenv("WORKER_ID", f"local-worker-{os.getpid()}-{uuid.uuid4().hex[:8]}")
POLL_INTERVAL_SECONDS = max(1.0, float(os.getenv("POLL_INTERVAL", "2")))
PROCESSING_LEASE_SECONDS = max(5, int(os.getenv("PROCESSING_LEASE_SECONDS", "45")))
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value


def _to_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        raw = value.strip().lower()
        if not raw:
            return default
        return raw not in {"0", "false", "no", "off"}
    return default


PIPELINE_MAX_INPUT_SIZE = max(0, _env_int("PIPELINE_MAX_INPUT_SIZE", 1600))
PIPELINE_MIN_INPUT_SIZE = max(128, _env_int("PIPELINE_MIN_INPUT_SIZE", 512))
PIPELINE_OOM_MAX_RETRIES = max(0, _env_int("PIPELINE_OOM_MAX_RETRIES", 4))
PIPELINE_OOM_SHRINK_FACTOR = max(0.3, min(0.95, float(os.getenv("PIPELINE_OOM_SHRINK_FACTOR") or "0.8")))
MQTT_STATUS_QOS = max(0, min(1, _env_int("MQTT_STATUS_QOS", 1)))
MQTT_PUBLISH_ACK_TIMEOUT_SECONDS = max(0, _env_int("MQTT_PUBLISH_ACK_TIMEOUT_SECONDS", 2))
MQTT_PUBLISH_MAX_ATTEMPTS = max(1, _env_int("MQTT_PUBLISH_MAX_ATTEMPTS", 5))
MQTT_PUBLISH_RETRY_DELAY_SECONDS = max(1, _env_int("MQTT_PUBLISH_RETRY_DELAY_SECONDS", 2))


def _save_pipeline_input(src_file: Path, dst_path: Path, max_size: int) -> int:
    with Image.open(src_file) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        if max_size > 0 and max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.LANCZOS)
        actual = max(img.size)
        save_format = "PNG" if src_file.suffix.lower() == ".png" else "JPEG"
        save_kwargs = {} if save_format == "PNG" else {"quality": 95}
        img.save(dst_path, save_format, **save_kwargs)
    return actual


def _is_cuda_oom(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "out of memory" in message or "cuda out of memory" in message


def _release_cuda_memory() -> None:
    try:
        import gc

        gc.collect()
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


def _run_extract_with_adaptive_downscale(
    src_file: Path,
    dst_path: Path,
    input_dir: Path,
    output_dir: Path,
    lineformer_use_preprocessing: bool,
) -> int:
    """Run the pipeline, shrinking the input image on CUDA OOM errors."""
    current_size = PIPELINE_MAX_INPUT_SIZE
    last_error: Optional[BaseException] = None
    for attempt in range(PIPELINE_OOM_MAX_RETRIES + 1):
        # Start each attempt from a clean output tree so stale files
        # from a previous OOM run cannot be picked up downstream.
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        actual_size = _save_pipeline_input(src_file, dst_path, current_size)
        print(f"[PIPELINE] attempt {attempt + 1}: input max dimension = {actual_size}px (cap {current_size or 'unbounded'})")

        try:
            extract(
                input_dir=str(input_dir),
                output_dir=str(output_dir),
                backend="local",
                lineformer_use_preprocessing=lineformer_use_preprocessing,
            )
            return actual_size
        except Exception as exc:
            if not _is_cuda_oom(exc):
                raise
            last_error = exc
            _release_cuda_memory()
            next_size = max(PIPELINE_MIN_INPUT_SIZE, int(actual_size * PIPELINE_OOM_SHRINK_FACTOR))
            if next_size >= actual_size:
                break
            print(f"[PIPELINE] CUDA OOM at {actual_size}px, retrying at {next_size}px")
            current_size = next_size

    if last_error is not None:
        raise last_error
    raise RuntimeError("extract pipeline failed without a captured error")


@dataclass
class Job:
    chart_id: int
    original_path: str
    job_id: int = None
    message_id: str = None
    lineformer_use_preprocessing: bool = True


_job_queue: "queue.Queue[Job]" = queue.Queue()


def _normalize_db_url(url: str) -> str:
    return url.replace("postgresql+psycopg2://", "postgresql://", 1)


def _connect_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required when MQTT_ENABLED=0")

    conn = psycopg2.connect(_normalize_db_url(DATABASE_URL))
    conn.autocommit = False
    return conn


def _fetch_next_db_job(conn) -> Optional[Job]:
    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    job.id AS job_id,
                    job.message_id AS message_id,
                    job.request_payload AS request_payload,
                    chart.id AS chart_id,
                    chart.original_path AS original_path
                FROM processing_jobs AS job
                INNER JOIN charts AS chart ON chart.id = job.chart_id
                WHERE job.status = %s
                  AND (job.next_retry_at IS NULL OR job.next_retry_at <= NOW())
                ORDER BY job.created_at ASC, job.id ASC
                FOR UPDATE OF job SKIP LOCKED
                LIMIT 1
                """,
                ("queued",),
            )
            row = cur.fetchone()
            if not row:
                return None

            now = datetime.utcnow()
            cur.execute(
                """
                UPDATE processing_jobs
                SET status = %s,
                    error_message = NULL,
                    error_code = NULL,
                    worker_id = %s,
                    attempt = attempt + 1,
                    started_at = %s,
                    last_heartbeat_at = %s,
                    leased_until = NULL,
                    next_retry_at = NULL,
                    finished_at = NULL
                WHERE id = %s
                """,
                ("processing", WORKER_ID, now, now, int(row["job_id"])),
            )
            cur.execute(
                """
                UPDATE charts
                SET status = %s,
                    error_message = NULL,
                    processed_at = NULL
                WHERE id = %s
                """,
                ("processing", int(row["chart_id"])),
            )

            return Job(
                chart_id=int(row["chart_id"]),
                original_path=str(row["original_path"]),
                job_id=int(row["job_id"]),
                message_id=str(row["message_id"]) if row["message_id"] is not None else None,
                lineformer_use_preprocessing=_to_bool(
                    (row["request_payload"] or {}).get("lineformerUsePreprocessing"),
                    True,
                ),
            )


def _mark_db_done(conn, job: Job, result_json: Dict[str, Any], n_panels: int, n_series: int) -> None:
    with conn:
        with conn.cursor() as cur:
            now = datetime.utcnow()
            cur.execute(
                """
                UPDATE processing_jobs
                SET status = %s,
                    error_message = NULL,
                    error_code = NULL,
                    worker_id = %s,
                    last_heartbeat_at = %s,
                    leased_until = NULL,
                    next_retry_at = NULL,
                    finished_at = %s,
                    result_payload = %s
                WHERE id = %s
                """,
                ("done", WORKER_ID, now, now, Json(result_json), job.job_id),
            )
            cur.execute(
                """
                UPDATE charts
                SET status = %s,
                    error_message = NULL,
                    processed_at = %s,
                    result_json = %s,
                    n_panels = %s,
                    n_series = %s
                WHERE id = %s
                """,
                ("done", now, Json(result_json), n_panels, n_series, job.chart_id),
            )


def _mark_db_error(
    conn,
    job: Job,
    message: str,
    error_code: str,
    result_json: Optional[Dict[str, Any]] = None,
) -> None:
    trimmed_message = message[:2000]
    with conn:
        with conn.cursor() as cur:
            now = datetime.utcnow()
            cur.execute(
                """
                UPDATE processing_jobs
                SET status = %s,
                    error_message = %s,
                    error_code = %s,
                    worker_id = %s,
                    last_heartbeat_at = %s,
                    leased_until = NULL,
                    next_retry_at = NULL,
                    finished_at = %s,
                    result_payload = %s
                WHERE id = %s
                """,
                ("error", trimmed_message, error_code, WORKER_ID, now, now, Json(result_json) if result_json is not None else None, job.job_id),
            )
            if result_json is None:
                cur.execute(
                    """
                    UPDATE charts
                    SET status = %s,
                        error_message = %s,
                        processed_at = %s
                    WHERE id = %s
                    """,
                    ("error", trimmed_message, now, job.chart_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE charts
                    SET status = %s,
                        error_message = %s,
                        processed_at = %s,
                        result_json = %s
                    WHERE id = %s
                    """,
                    ("error", trimmed_message, now, Json(result_json), job.chart_id),
                )


def _publish_processing_event(mqtt_client, topic: str, payload: Dict[str, Any], wait_for_ack: bool = False) -> bool:
    attempts = MQTT_PUBLISH_MAX_ATTEMPTS if wait_for_ack else 1
    payload_json = json.dumps(payload)
    success_rc = getattr(mqtt, "MQTT_ERR_SUCCESS", 0)

    for attempt in range(1, attempts + 1):
        try:
            message_info = mqtt_client.publish(topic, payload_json, qos=MQTT_STATUS_QOS)
            if message_info.rc != success_rc:
                print(f"[MQTT_WARN] Publish failed for topic {topic}: rc={message_info.rc}, attempt={attempt}/{attempts}")
            elif wait_for_ack and MQTT_STATUS_QOS > 0 and MQTT_PUBLISH_ACK_TIMEOUT_SECONDS > 0:
                message_info.wait_for_publish(timeout=MQTT_PUBLISH_ACK_TIMEOUT_SECONDS)
                if message_info.is_published():
                    return True
                print(f"[MQTT_WARN] Publish ack timeout for topic {topic}, attempt={attempt}/{attempts}")
            else:
                return True
        except Exception as exc:
            print(f"[MQTT_WARN] Publish exception for topic {topic}, attempt={attempt}/{attempts}: {exc}")

        if attempt < attempts:
            time.sleep(MQTT_PUBLISH_RETRY_DELAY_SECONDS)

    return False


def _ensure_json_finite(value: Any, path: str = "$") -> None:
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Non-finite numeric value at {path}: {value}")
        return

    if isinstance(value, dict):
        for key, nested_value in value.items():
            _ensure_json_finite(nested_value, f"{path}.{key}")
        return

    if isinstance(value, list):
        for index, nested_value in enumerate(value):
            _ensure_json_finite(nested_value, f"{path}[{index}]")


def _write_result_json_to_storage(result_json: Dict[str, Any], src_file: Path, storage_dir: Path) -> str:
    _ensure_json_finite(result_json)
    result_path = src_file.parent / "data.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    with result_path.open("w", encoding="utf-8") as f:
        json.dump(result_json, f, ensure_ascii=False, indent=2, allow_nan=False)
    return result_path.relative_to(storage_dir).as_posix()


def _start_heartbeat_loop(mqtt_client, chart_id: int, job_id: Optional[int], message_id: Optional[str]) -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()

    def _heartbeat_worker() -> None:
        while not stop_event.wait(HEARTBEAT_INTERVAL_SECONDS):
            heartbeat_payload = {
                "schemaVersion": 1,
                "jobId": job_id,
                "chartId": chart_id,
                "messageId": f"heartbeat-{message_id}-{uuid.uuid4().hex[:8]}",
                "requestMessageId": message_id,
                "workerId": WORKER_ID,
            }
            _publish_processing_event(mqtt_client, MQTT_HEARTBEAT_TOPIC, heartbeat_payload)

    thread = threading.Thread(target=_heartbeat_worker, daemon=True)
    thread.start()
    return stop_event, thread


def _execute_pipeline(
    chart_id: int,
    original_path: str,
    lineformer_use_preprocessing: bool = True,
) -> tuple[Dict[str, Any], str, int, int]:
    src_file = Path(original_path)
    storage_dir = _storage_dir_from_original(src_file)
    if not src_file.is_absolute():
        src_file = storage_dir / src_file

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + f"_{uuid.uuid4().hex[:8]}"
    run_root = WORK_DIR / f"chart_{chart_id}" / run_id
    input_dir = run_root / "input"
    output_dir = run_root / "output"

    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not src_file.exists():
        raise FileNotFoundError(f"File not found: {src_file}")

    dst_path = input_dir / src_file.name
    _run_extract_with_adaptive_downscale(
        src_file,
        dst_path,
        input_dir,
        output_dir,
        lineformer_use_preprocessing,
    )

    data_files = list(output_dir.rglob("data.json"))
    if not data_files:
        raise Exception("Pipeline did not create data.json")

    with open(data_files[0], "r", encoding="utf-8") as f:
        points_data = json.load(f)

    series_list = [
        {"id": sid, "name": sid, "points": [[p["x"], p["y"]] for p in pts]}
        for sid, pts in points_data.items()
    ]

    result_json = {
        "panels": [{"id": "panel_0", "series": series_list, "x_unit": "X", "y_unit": "Y"}],
        "artifacts": {},
    }

    artifact_specs = [
        ("lineformer_prediction", "lineformer", "prediction.png"),
        ("converted_plot", "converted_datapoints", "plot.png"),
        ("chartdete_predictions", "chartdete", "predictions.*"),
    ]
    for art_name, artifact_dir, glob_pattern in artifact_specs:
        files = list(output_dir.rglob(glob_pattern))
        if files:
            target_dir = src_file.parent / artifact_dir
            target_dir.mkdir(parents=True, exist_ok=True)
            art_path = target_dir / files[0].name
            shutil.copy2(files[0], art_path)
            result_json["artifacts"][art_name] = art_path.relative_to(storage_dir).as_posix()

    if "converted_plot" in result_json["artifacts"]:
        result_json["artifacts"]["restored_plot"] = result_json["artifacts"]["converted_plot"]

    try:
        result_json_path = _write_result_json_to_storage(result_json, src_file, storage_dir)
    except ValueError as exc:
        raise PipelineOutputInvalidError(str(exc), result_json) from exc

    return result_json, result_json_path, 1, len(series_list)


def _build_failed_result_json(
    error_message: str,
    error_code: str,
    artifacts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "artifacts": artifacts or {},
        "ml_meta": {
            "worker_error": {
                "message": error_message,
                "code": error_code,
            }
        },
    }


def _error_code_for_exception(error: Exception) -> str:
    if isinstance(error, ValueError) and "Non-finite numeric value" in str(error):
        return "pipeline_output_invalid"
    return "unexpected_worker_error"


def _artifacts_for_exception(error: Exception) -> Dict[str, Any]:
    if isinstance(error, PipelineOutputInvalidError):
        return error.artifacts
    return {}


def process_job(chart_id, original_path, mqtt_client, job_id=None, message_id=None, lineformer_use_preprocessing=True):
    print(f"\n[WORKER] >>> Processing chart ID: {chart_id}")
    print(f"[WORKER] LineFormer preprocessing: {lineformer_use_preprocessing}")

    accepted_payload = {
        "schemaVersion": 1,
        "jobId": job_id,
        "chartId": chart_id,
        "messageId": f"accepted-{message_id}-{uuid.uuid4().hex[:8]}",
        "requestMessageId": message_id,
        "workerId": WORKER_ID,
    }
    _publish_processing_event(mqtt_client, MQTT_ACCEPTED_TOPIC, accepted_payload)
    heartbeat_stop, heartbeat_thread = _start_heartbeat_loop(mqtt_client, chart_id, job_id, message_id)

    try:
        _, result_json_path, n_panels, n_series = _execute_pipeline(
            chart_id,
            original_path,
            lineformer_use_preprocessing,
        )

        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print(f"[SUCCESS] Chart {chart_id} is ready. Sending result to backend.")
        
        # КРИТИЧНО: requestMessageId должен совпадать с messageId из запроса
        completed_payload = {
            "schemaVersion": 1,
            "jobId": job_id,
            "chartId": chart_id,
            "messageId": f"completed-{message_id}-{uuid.uuid4().hex[:8]}",
            "requestMessageId": message_id,
            "workerId": WORKER_ID,
            "resultJsonPath": result_json_path,
            "nPanels": n_panels,
            "nSeries": n_series,
            "completedAt": datetime.now().isoformat()
        }

        if not _publish_processing_event(mqtt_client, MQTT_COMPLETED_TOPIC, completed_payload, wait_for_ack=True):
            print(f"[MQTT_ERROR] Completed event was not acknowledged for chart {chart_id}, job {job_id}")

    except Exception as e:
        print(f"[ERROR] {e}")
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        src_file = Path(original_path)
        storage_dir = _storage_dir_from_original(src_file)
        if not src_file.is_absolute():
            src_file = storage_dir / src_file

        error_code = _error_code_for_exception(e)
        failed_result_json = _build_failed_result_json(str(e), error_code, _artifacts_for_exception(e))
        failed_result_json_path = _write_result_json_to_storage(failed_result_json, src_file, storage_dir)

        failed_payload = {
            "schemaVersion": 1,
            "jobId": job_id,
            "chartId": chart_id,
            "messageId": f"failed-{message_id}-{uuid.uuid4().hex[:8]}",
            "requestMessageId": message_id,
            "workerId": WORKER_ID,
            "errorMessage": str(e),
            "errorCode": error_code,
            "retryable": False,
            "resultJsonPath": failed_result_json_path,
            "failedAt": datetime.now().isoformat()
        }

        if not _publish_processing_event(mqtt_client, MQTT_FAILED_TOPIC, failed_payload, wait_for_ack=True):
            print(f"[MQTT_ERROR] Failed event was not acknowledged for chart {chart_id}, job {job_id}")
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=1)


def _process_db_job(conn, job: Job) -> None:
    print(f"[WORKER] Processing chart {job.chart_id} (DB mode)")
    try:
        result_json, _, n_panels, n_series = _execute_pipeline(
            job.chart_id,
            job.original_path,
            job.lineformer_use_preprocessing,
        )
        _mark_db_done(conn, job, result_json, n_panels, n_series)
        print(f"[WORKER] Chart {job.chart_id} done (DB mode)")
    except Exception as e:
        error_code = _error_code_for_exception(e)
        failed_result_json = _build_failed_result_json(str(e), error_code, _artifacts_for_exception(e))
        _mark_db_error(conn, job, str(e), error_code, failed_result_json)
        print(f"[WORKER_ERROR] Chart {job.chart_id} failed (DB mode): {e}")


def _run_db_poll_loop() -> int:
    print("[WORKER] MQTT disabled; switching to DB polling mode.")
    conn = _connect_db()
    try:
        while True:
            job = _fetch_next_db_job(conn)
            if job is None:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            _process_db_job(conn, job)
    finally:
        conn.close()


def _job_worker(mqtt_client):
    # Это отдельный фоновый работяга: он сидит и ждёт задачи из очереди.
    # MQTT-сообщения сюда напрямую не обрабатываются — они только складывают задания в _job_queue,
    # а уже этот поток спокойно берёт их по одному и запускает тяжёлую обработку картинки.
    while True:
        job = _job_queue.get()
        try:
            process_job(
                job.chart_id,
                job.original_path,
                mqtt_client,
                job.job_id,
                job.message_id,
                job.lineformer_use_preprocessing,
            )
        except Exception as e:
            print(f"[WORKER_ERROR] Job {job.chart_id} failed: {e}")
        finally:
            # Говорим очереди: с этой задачей закончили, даже если она упала с ошибкой.
            _job_queue.task_done()


def _create_mqtt_client():
    callback_api_version = getattr(mqtt, "CallbackAPIVersion", None)
    if callback_api_version is not None and hasattr(callback_api_version, "VERSION1"):
        return mqtt.Client(callback_api_version.VERSION1)
    return mqtt.Client()


def on_connect(client, userdata, flags, rc):
    # Этот callback срабатывает, когда worker наконец достучался до MQTT-брокера.
    # После подключения подписываемся на канал, куда backend кидает просьбы обработать график.
    print(f"[MQTT] Connected to broker {MQTT_BROKER}:{MQTT_PORT}")
    client.subscribe(MQTT_REQUEST_TOPIC)


def on_message(client, userdata, msg):
    # Сюда прилетает каждое сообщение из MQTT-топика charts/process/request.
    # В идеале внутри лежит JSON с chartId и originalPath — то есть "какую картинку обработать".
    try:
        task_data = json.loads(msg.payload.decode())
        print(f"[MQTT] Received raw data: {task_data}")
        
        chart_id = task_data.get("chartId")
        original_path = task_data.get("originalPath")
        job_id = task_data.get("jobId")
        message_id = task_data.get("messageId")
        lineformer_use_preprocessing = _to_bool(task_data.get("lineformerUsePreprocessing"), True)

        if chart_id and original_path:
            print(f"[WORKER] Queuing job {chart_id}")
            # Не запускаем обработку прямо внутри MQTT callback.
            # Просто кладём задачу в очередь, чтобы MQTT-клиент не зависал на долгой ML-обработке.
            _job_queue.put(Job(
                chart_id=int(chart_id), 
                original_path=str(original_path),
                job_id=job_id,
                message_id=message_id,
                lineformer_use_preprocessing=lineformer_use_preprocessing,
            ))
        else:
            print(f"[MQTT_ERROR] Missing keys. Got: {list(task_data.keys())}")
            
    except Exception as e:
        print(f"[MQTT_ERROR] Message parsing error: {e}")


def main():
    if not MQTT_ENABLED:
        return _run_db_poll_loop()

    print("[WORKER] Initializing MQTT client...")
    # Создаём MQTT-клиент. Это главный объект, через который worker слушает задачи
    # и потом отправляет статусы обратно: accepted, heartbeat, completed или failed.
    client = _create_mqtt_client()
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        # Запускаем отдельный поток для реальной обработки задач.
        # Основной поток ниже будет занят MQTT loop_forever(), поэтому без этого worker бы не мог
        # одновременно слушать новые сообщения и обрабатывать уже полученные задания.
        worker_thread = threading.Thread(
            target=_job_worker,
            args=(client,),
            daemon=True,
        )
        worker_thread.start()
        # Подключаемся к брокеру и дальше живём в бесконечном MQTT-цикле:
        # ждём сообщения, вызываем callbacks и поддерживаем соединение.
        while True:
            try:
                client.connect(MQTT_BROKER, MQTT_PORT, 60)
                break
            except OSError as e:
                print(f"[MQTT] Broker is not ready ({e}); retrying in 1s...")
                time.sleep(1)
        print("[WORKER] Listening for jobs (MQTT mode)...")
        client.loop_forever()
        return 0
    except ConnectionRefusedError:
        print(f"[FATAL] MQTT broker is not running on {MQTT_BROKER}:{MQTT_PORT}!")
        print("Start Eclipse Mosquitto locally or run the broker in Docker.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
