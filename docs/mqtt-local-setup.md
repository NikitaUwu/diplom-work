# Локальный MQTT через Mosquitto

MQTT в проекте теперь опционален. Этот документ нужен только для режима, где:

- у backend `App.MqttEnabled = true`
- у worker `MQTT_ENABLED=1`

Если оба значения выключены, Mosquitto не нужен.

## Что происходит в MQTT-режиме

```text
Backend
  -> mqtt_messages (direction=out)
  -> charts/process/request
  -> ML-worker
  -> charts/process/accepted | heartbeat | completed | failed
  -> Backend
  -> mqtt_messages (direction=in)
```

Backend остается источником истины по статусам задач. Worker не меняет БД напрямую и отправляет результат в storage, а backend узнает о нем по MQTT-событиям.

## Файлы

| Файл | Назначение |
|---|---|
| `docker-compose.mqtt.yml` | Локальный запуск Mosquitto через Docker Compose |
| `infra/mosquitto/config/mosquitto.conf` | Конфигурация брокера |
| `scripts/start-mosquitto.ps1` | Удобный скрипт запуска |

## Запуск

Из корня проекта:

```powershell
.\scripts\start-mosquitto.ps1
```

В фоне:

```powershell
.\scripts\start-mosquitto.ps1 -Detached
```

Если мешает `ExecutionPolicy`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

Альтернатива:

```powershell
docker compose -f .\docker-compose.mqtt.yml up
```

Остановка:

```powershell
docker compose -f .\docker-compose.mqtt.yml down
```

## Настройки backend

В `diplomWork/appsettings.Development.json`:

```json
{
  "App": {
    "MqttEnabled": true,
    "MqttHost": "localhost",
    "MqttPort": 1883,
    "MqttClientIdPrefix": "diplom-backend",
    "MqttProcessRequestTopic": "charts/process/request",
    "MqttProcessAcceptedTopic": "charts/process/accepted",
    "MqttProcessHeartbeatTopic": "charts/process/heartbeat",
    "MqttProcessCompletedTopic": "charts/process/completed",
    "MqttProcessFailedTopic": "charts/process/failed"
  }
}
```

## Настройки worker

Пример находится в `ml-worker/.env.example`.

Минимум:

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
STORAGE_DIR=...
WORK_DIR=...
```

## Topics

| Topic | Направление | Назначение |
|---|---|---|
| `charts/process/request` | backend -> worker | Новая задача |
| `charts/process/accepted` | worker -> backend | Задача принята |
| `charts/process/heartbeat` | worker -> backend | Задача еще выполняется |
| `charts/process/completed` | worker -> backend | Успешное завершение |
| `charts/process/failed` | worker -> backend | Завершение с ошибкой |

## Что хранится в `mqtt_messages`

- `direction = out` — исходящие задачи backend
- `direction = in` — входящие события от worker
- `status` отражает состояние публикации или обработки сообщения

Если `App.MqttEnabled = false`, таблица `mqtt_messages` в рабочем процессе почти не используется.

## Локальные замечания

Текущий `mosquitto.conf` подходит для разработки и допускает anonymous-доступ. Для production его нужно ужесточать отдельно.
