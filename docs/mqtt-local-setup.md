# Локальный MQTT через Mosquitto

В проекте MQTT используется как транспорт между backend и ML-worker. Конкретная реализация брокера теперь зафиксирована как Mosquitto.

## Схема

```text
Backend (.NET 8)
  -> mqtt_messages direction=out
  -> Mosquitto topic charts/process/request
  -> ML-worker
  -> Mosquitto topics accepted/heartbeat/completed/failed
  -> Backend
  -> mqtt_messages direction=in
```

Backend остается источником истины: статусы задач хранятся в PostgreSQL, а MQTT только доставляет команды и события.

## Файлы Mosquitto

| Файл | Назначение |
|---|---|
| `docker-compose.mqtt.yml` | Запуск Mosquitto через Docker Compose. |
| `infra/mosquitto/config/mosquitto.conf` | Конфигурация брокера. |
| `infra/mosquitto/data` | Локальная persistence-директория Mosquitto. |
| `infra/mosquitto/log` | Локальные логи Mosquitto. |
| `scripts/start-mosquitto.ps1` | Удобный PowerShell-скрипт запуска брокера. |

## Запуск через Docker

Из корня проекта:

```powershell
.\scripts\start-mosquitto.ps1
```

В фоне:

```powershell
.\scripts\start-mosquitto.ps1 -Detached
```

Если PowerShell блокирует запуск `.ps1` из-за ExecutionPolicy, используй команду с локальным обходом политики только для этого запуска:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

Альтернативно напрямую:

```powershell
docker compose -f .\docker-compose.mqtt.yml up
```

Остановка:

```powershell
docker compose -f .\docker-compose.mqtt.yml down
```

## Настройки backend

В `diplomWork/appsettings.Development.json` или через переменные окружения:

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

Backend публикует исходящие сообщения из таблицы `mqtt_messages`, где:

```text
direction = out
status = pending | published | error
```

## Настройки ML-worker

Пример находится в `ml-worker/.env.example`.

Для локального запуска можно создать `ml-worker/.env`:

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

Для нескольких worker можно включить shared subscription:

```env
MQTT_SHARED_GROUP=diplom-workers
```

Тогда worker подпишется на:

```text
$share/diplom-workers/charts/process/request
```

Mosquitto поддерживает такие shared subscriptions.

## Topics

| Topic | Направление | Назначение |
|---|---|---|
| `charts/process/request` | Backend -> ML-worker | Новая задача обработки. |
| `charts/process/accepted` | ML-worker -> Backend | Worker принял задачу. |
| `charts/process/heartbeat` | ML-worker -> Backend | Worker продолжает обработку. |
| `charts/process/completed` | ML-worker -> Backend | Обработка завершена успешно. |
| `charts/process/failed` | ML-worker -> Backend | Обработка завершена ошибкой. |

## QoS

Backend публикует сообщения с QoS 1. ML-worker подписывается на задачи с QoS 1.

Повторная доставка MQTT-сообщения не должна ломать состояние системы, потому что backend использует `messageId` и таблицу `mqtt_messages`:

```text
direction = in
message_id = уникальный id события
```

Если входящее событие уже было обработано, backend игнорирует дубль.

## Production-заметки

Текущий `mosquitto.conf` предназначен для локальной разработки:

```conf
allow_anonymous true
```

Для production нужно:

- отключить anonymous-доступ;
- настроить `password_file`;
- включить TLS;
- вынести host, port, username и password в переменные окружения;
- открыть порт `1883` только для backend и ML-worker, либо использовать защищенную сеть.
