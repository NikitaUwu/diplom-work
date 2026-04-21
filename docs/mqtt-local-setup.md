# Локальный запуск MQTT для backend и ml-worker

## Что уже работает

- `.NET backend` после загрузки графика создает `processing_jobs` и кладет команду в `outbox_messages`.
- `MqttOutboxDispatcherService` публикует `charts/process/request` в MQTT.
- `ml-worker` в MQTT-режиме слушает `charts/process/request`, публикует:
  - `charts/process/accepted`
  - `charts/process/heartbeat`
  - `charts/process/completed`
  - `charts/process/failed`
- `charts/process/failed` теперь может нести `errorCode` и `retryable`, чтобы backend различал временные и terminal ошибки worker.
- Актуальный каталог кодов описан в [processing-error-codes.md](C:\Users\nikit\Documents\New project\diplomWork-stage\docs\processing-error-codes.md).
- `.NET backend` принимает эти события, идемпотентно применяет terminal-события через `inbox_messages` и поддерживает lease по `processing_jobs`.
- `ProcessingLeaseMonitorService` при истечении lease:
  - переочередит job через `outbox_messages`, если лимит попыток еще не исчерпан;
  - пометит job как `error`, если попытки закончились.

## Что нужно установить

### 1. MQTT broker

Самый простой локальный вариант для Windows: Mosquitto.

Параметры по умолчанию:

- host: `localhost`
- port: `1883`

### 2. Python-зависимости

В `requirements.txt` уже есть `paho-mqtt==1.6.1`.

Обновление зависимостей:

```powershell
cd C:\Users\nikit\source\repos\diplomWork
.\ml-worker\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

## Как включить MQTT

### Backend

В `diplomWork/appsettings.Development.json`:

```json
"MqttEnabled": true,
"MqttHost": "localhost",
"MqttPort": 1883,
"MqttClientIdPrefix": "diplom-backend",
"MqttProcessRequestTopic": "charts/process/request",
"MqttProcessAcceptedTopic": "charts/process/accepted",
"MqttProcessHeartbeatTopic": "charts/process/heartbeat",
"MqttProcessCompletedTopic": "charts/process/completed",
"MqttProcessFailedTopic": "charts/process/failed",
"ProcessingLeaseSeconds": 45,
"ProcessingLeaseMonitorIntervalSeconds": 10,
"ProcessingMaxAttempts": 3,
"ProcessingRetryDelaySeconds": 15,
"ProcessingRetryModalBackendUnavailableMaxAttempts": 5,
"ProcessingRetryModalBackendUnavailableDelaySeconds": 20,
"ProcessingRetryNetworkTimeoutMaxAttempts": 4,
"ProcessingRetryNetworkTimeoutDelaySeconds": 10
```

### ML worker

В `ml-worker/.env`:

```env
MQTT_ENABLED=1
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_CLIENT_ID_PREFIX=diplom-worker
MQTT_PROCESS_REQUEST_TOPIC=charts/process/request
MQTT_PROCESS_ACCEPTED_TOPIC=charts/process/accepted
MQTT_PROCESS_HEARTBEAT_TOPIC=charts/process/heartbeat
MQTT_PROCESS_COMPLETED_TOPIC=charts/process/completed
MQTT_PROCESS_FAILED_TOPIC=charts/process/failed
PROCESSING_HEARTBEAT_INTERVAL_SECONDS=10
```

Опционально для нескольких worker:

```env
MQTT_SHARED_GROUP=diplom-workers
```

Тогда worker подпишется на `$share/diplom-workers/charts/process/request`.

## Как запускать

### Backend

```powershell
cd C:\Users\nikit\source\repos\diplomWork
powershell -ExecutionPolicy Bypass -File .\run-backend.ps1
```

### ML worker

```powershell
cd C:\Users\nikit\source\repos\diplomWork\ml-worker
.\.venv\Scripts\python.exe .\worker_modal.py
```

## Поведение режимов

- При `MQTT_ENABLED=1` worker работает через MQTT-события.
- При `MQTT_ENABLED=0` worker остается на старом polling по `charts.status='uploaded'`.
- Источник истины:
  - `PostgreSQL` для состояния;
  - `storage` для файлов и артефактов.
- Retry policy сейчас применяется для безопасного случая `lease expired`: backend выдает новую MQTT-команду с новым `messageId`, а запоздалые события старой попытки игнорируются.
- Для `failed` от worker backend тоже умеет делать controlled retry, если событие помечено как `retryable=true` или попадает под fallback-классификацию временной ошибки.
- Операционный snapshot метрик доступен на `GET /metrics/processing`.
