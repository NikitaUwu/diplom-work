# Компактная схема БД

Текущая схема backend намеренно упрощена. В ней остались только основные бизнес-таблицы и единая таблица MQTT-сообщений.

## Таблицы

| Таблица | Назначение |
|---|---|
| `users` | Пользователи, роли, пароль, флаг активности |
| `charts` | Загруженные графики, файловые метаданные, статус обработки и `result_json` |
| `processing_jobs` | Задачи обработки, попытки, lease, heartbeat, результат worker |
| `mqtt_messages` | Исходящие и входящие MQTT-сообщения |

## Связи

- один `user` может иметь много `charts`
- один `chart` может иметь много `processing_jobs`
- один `processing_job` может иметь много `mqtt_messages`

## Особенности

- `mqtt_messages` используется только в MQTT-режиме
- при `App.MqttEnabled = false` backend и worker могут продолжать работать без активного использования `mqtt_messages`
- alert history и notification queue в БД больше не хранятся

## Что было убрано

Из активной EF Core-модели удалены:

- `outbox_messages`
- `inbox_messages`
- `processing_alert_states`
- `processing_alert_events`

Логика старых `outbox` и `inbox` объединена в `mqtt_messages`:

- `direction = out` — сообщения backend -> worker
- `direction = in` — сообщения worker -> backend

## ER-диаграмма

```mermaid
erDiagram
    USERS ||--o{ CHARTS : uploads
    CHARTS ||--o{ PROCESSING_JOBS : has
    PROCESSING_JOBS ||--o{ MQTT_MESSAGES : has

    USERS {
        int id PK
        string email UK
        string hashed_password
        bool is_active
        string role
        timestamptz created_at
    }

    CHARTS {
        int id PK
        int user_id FK
        string original_filename
        string mime_type
        string sha256
        string original_path
        string status
        jsonb result_json
        timestamptz created_at
        timestamptz processed_at
    }

    PROCESSING_JOBS {
        bigint id PK
        int chart_id FK
        string status
        jsonb request_payload
        jsonb result_payload
        string message_id UK
        string worker_id
        int attempt
        timestamptz last_heartbeat_at
        timestamptz leased_until
        timestamptz next_retry_at
        timestamptz finished_at
    }

    MQTT_MESSAGES {
        bigint id PK
        bigint processing_job_id FK
        string direction
        string topic
        string status
        jsonb payload
        string message_id
        int attempt_count
        timestamptz available_at
        timestamptz processed_at
    }
```
