from __future__ import annotations

import json
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

# Keep Windows console output predictable.
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
        # Expected layout: <storage>/user_<user_id>/<chart_id>/<filename>
        # so storage root is three levels above the file.
        if len(resolved.parents) >= 3:
            return resolved.parents[2]

    return (PROJECT_BACKEND_DIR / "storage").resolve()


if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
    print(f"[DEBUG] Loaded env file: {ENV_PATH}")

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_ACCEPTED_TOPIC = os.getenv("MQTT_PROCESS_ACCEPTED_TOPIC", "charts/process/accepted")
MQTT_HEARTBEAT_TOPIC = os.getenv("MQTT_PROCESS_HEARTBEAT_TOPIC", "charts/process/heartbeat")
MQTT_COMPLETED_TOPIC = os.getenv("MQTT_PROCESS_COMPLETED_TOPIC", "charts/process/completed")
MQTT_FAILED_TOPIC = os.getenv("MQTT_PROCESS_FAILED_TOPIC", "charts/process/failed")
HEARTBEAT_INTERVAL_SECONDS = max(5, int(os.getenv("PROCESSING_HEARTBEAT_INTERVAL_SECONDS", "10")))
WORK_DIR = Path(os.getenv("WORK_DIR", str(REPO_ROOT / "ml-worker" / "runs" / "worker"))).resolve()
WORKER_ID = os.getenv("WORKER_ID", f"local-worker-{os.getpid()}-{uuid.uuid4().hex[:8]}")


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value


PIPELINE_MAX_INPUT_SIZE = max(0, _env_int("PIPELINE_MAX_INPUT_SIZE", 1600))
PIPELINE_MIN_INPUT_SIZE = max(128, _env_int("PIPELINE_MIN_INPUT_SIZE", 512))
PIPELINE_OOM_MAX_RETRIES = max(0, _env_int("PIPELINE_OOM_MAX_RETRIES", 4))
PIPELINE_OOM_SHRINK_FACTOR = max(0.3, min(0.95, float(os.getenv("PIPELINE_OOM_SHRINK_FACTOR") or "0.8")))


def _save_pipeline_input(src_file: Path, dst_path: Path, max_size: int) -> int:
    """Write a possibly downscaled copy of ``src_file`` to ``dst_path``.

    Returns the actual max dimension written.
    """
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


def _run_extract_with_adaptive_downscale(src_file: Path, dst_path: Path, input_dir: Path, output_dir: Path) -> int:
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
            extract(input_dir=str(input_dir), output_dir=str(output_dir), backend="local")
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


_job_queue: "queue.Queue[Job]" = queue.Queue()


def _publish_processing_event(mqtt_client, topic: str, payload: Dict[str, Any]) -> None:
    mqtt_client.publish(topic, json.dumps(payload))


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


def process_job(chart_id, original_path, mqtt_client, job_id=None, message_id=None):
    print(f"\n[WORKER] >>> Processing chart ID: {chart_id}")

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
        if not src_file.exists():
            raise FileNotFoundError(f"File not found: {src_file}")

        dst_path = input_dir / src_file.name
        _run_extract_with_adaptive_downscale(src_file, dst_path, input_dir, output_dir)

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
            "status": "completed",
            "resultJson": result_json,
            "nPanels": 1,
            "nSeries": len(series_list),
            "completedAt": datetime.now().isoformat()
        }

        _publish_processing_event(mqtt_client, MQTT_COMPLETED_TOPIC, completed_payload)

    except Exception as e:
        print(f"[ERROR] {e}")
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        failed_payload = {
            "schemaVersion": 1,
            "jobId": job_id,
            "chartId": chart_id,
            "messageId": f"failed-{message_id}-{uuid.uuid4().hex[:8]}",
            "requestMessageId": message_id,
            "workerId": WORKER_ID,
            "status": "failed",
            "errorMessage": str(e),
            "errorCode": "unexpected_worker_error",
            "retryable": False,
            "failedAt": datetime.now().isoformat()
        }

        _publish_processing_event(mqtt_client, MQTT_FAILED_TOPIC, failed_payload)
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=1)


def _job_worker(mqtt_client):
    # Это отдельный фоновый работяга: он сидит и ждёт задачи из очереди.
    # MQTT-сообщения сюда напрямую не обрабатываются — они только складывают задания в _job_queue,
    # а уже этот поток спокойно берёт их по одному и запускает тяжёлую обработку картинки.
    while True:
        job = _job_queue.get()
        try:
            process_job(job.chart_id, job.original_path, mqtt_client, job.job_id, job.message_id)
        except Exception as e:
            print(f"[WORKER_ERROR] Job {job.chart_id} failed: {e}")
        finally:
            # Говорим очереди: с этой задачей закончили, даже если она упала с ошибкой.
            _job_queue.task_done()


def on_connect(client, userdata, flags, rc):
    # Этот callback срабатывает, когда worker наконец достучался до MQTT-брокера.
    # После подключения подписываемся на канал, куда backend кидает просьбы обработать график.
    print(f"[MQTT] Connected to broker {MQTT_BROKER}:{MQTT_PORT}")
    client.subscribe("charts/process/request")


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

        if chart_id and original_path:
            print(f"[WORKER] Queuing job {chart_id}")
            # Не запускаем обработку прямо внутри MQTT callback.
            # Просто кладём задачу в очередь, чтобы MQTT-клиент не зависал на долгой ML-обработке.
            _job_queue.put(Job(
                chart_id=int(chart_id), 
                original_path=str(original_path),
                job_id=job_id,
                message_id=message_id
            ))
        else:
            print(f"[MQTT_ERROR] Missing keys. Got: {list(task_data.keys())}")
            
    except Exception as e:
        print(f"[MQTT_ERROR] Message parsing error: {e}")


def main():
    print("[WORKER] Initializing MQTT client...")
    # Создаём MQTT-клиент. Это главный объект, через который worker слушает задачи
    # и потом отправляет статусы обратно: accepted, heartbeat, completed или failed.
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
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
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        print("[WORKER] Listening for jobs (MQTT mode)...")
        client.loop_forever()
    except ConnectionRefusedError:
        print(f"[FATAL] MQTT broker is not running on {MQTT_BROKER}:{MQTT_PORT}!")
        print("Start Eclipse Mosquitto locally or run the broker in Docker.")


if __name__ == "__main__":
    main()
