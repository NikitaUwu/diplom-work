# Compact database schema

The active backend schema is intentionally compact. It keeps only business data and the minimal MQTT audit/retry table.

## Tables

| Table | Purpose |
|---|---|
| `users` | Users, roles, password hashes and activity flag. |
| `charts` | Uploaded charts, file metadata, processing status and `result_json`. |
| `processing_jobs` | ML processing jobs, status, lease, heartbeat, retry state and worker result payload. |
| `mqtt_messages` | Unified MQTT message table for both outbound backend requests and inbound ML events. |

## Removed tables

The previous separate tables `outbox_messages`, `inbox_messages`, `processing_alert_states` and `processing_alert_events` are no longer part of the active EF Core model.

`mqtt_messages.direction` replaces the old split:

- `out` means backend -> ML messages, formerly outbox.
- `in` means ML -> backend messages, formerly inbox.

Alert snapshots are now derived from `processing_jobs` and `mqtt_messages` at request time. Alert history and notification queue are not persisted in the compact schema.

## ER diagram

```mermaid
erDiagram
    USERS ||--o{ CHARTS : uploads
    CHARTS ||--o{ PROCESSING_JOBS : has
    PROCESSING_JOBS ||--o{ MQTT_MESSAGES : relates_to

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
