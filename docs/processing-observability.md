# Processing Observability

The backend now exposes three operational JSON endpoints:

- `GET /health`
- `GET /metrics/processing`
- `GET /metrics/processing/alerts`
- `GET /admin/processing/overview`
- `GET /admin/processing/alerts/history`
- `GET /admin/processing/diagnostics`
- `GET /admin/processing/dashboard`

## What each endpoint is for

### `/metrics/processing`

High-level counters for:

- `processing_jobs` by status
- `outbox_messages` by status
- `errorCode` distribution
- retryable vs terminal error jobs
- queued ready vs delayed jobs

Use it as a compact machine-readable snapshot.

### `/metrics/processing/alerts`

Derived operational alerts. At the moment the backend raises alerts for:

- stale processing jobs with expired lease
- queued jobs that stayed ready for too long
- stale pending outbox messages
- outbox publish errors
- recent spikes of failed jobs

Each alert includes:

- `code`
- `severity`
- `message`
- `count`
- `samples`

### `/admin/processing/diagnostics`

Human-oriented diagnostics snapshot with top problematic records:

- stale processing jobs
- queued ready jobs
- failed jobs
- pending outbox messages
- error outbox messages
- recent inbox messages

This endpoint is intended for fast incident triage without manual SQL.

Admin access rules:

- when `AuthEnabled=false`, diagnostics stays available for the local dev user flow
- when `AuthEnabled=true` and the current user has `role=admin`, access is allowed
- `AdminEmails` now acts as bootstrap-only configuration: matching users are promoted to `admin` on startup and on registration
- when `AuthEnabled=true`, `AdminEmails` is empty, and environment is `Development`, access is allowed for any authenticated user
- otherwise the endpoint returns `403 Admin access required`

### `/admin/processing/overview`

Admin-only combined payload that returns:

- `metrics`
- `alerts`
- `diagnostics`

Use it when a client or dashboard should read one protected endpoint instead of combining multiple requests.
It now also includes `recentAlertEvents`, which are produced by the background alert monitor.

### `/admin/processing/alerts/history`

Admin-only recent alert transition history.

The backend stores and returns events such as:

- `activated`
- `severity_changed`
- `resolved`

This gives a lightweight incident timeline without an external monitoring stack.
Each event now also tracks notification delivery state:

- `notificationStatus`
- `notificationAttemptCount`
- `lastNotificationAttemptAt`
- `notificationNextAttemptAt`
- `notifiedAt`
- `notificationError`

### `/api/v1/admin/users`

Admin-only user-role management API:

- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/{userId}/role`

Supported roles:

- `user`
- `admin`

Safety rule:

- the backend rejects demotion of the last active admin user

### `/admin/processing/dashboard`

Admin-only HTML dashboard with auto-refresh every 15 seconds.

It renders:

- top-level system snapshot cards
- operational alerts
- stale/queued/failed job lists
- pending/error outbox messages
- recent inbox messages
- recent alert transition events

## Background monitor

`ProcessingAlertMonitorService` periodically evaluates the current alert snapshot and writes alert transitions
into `processing_alert_states` and `processing_alert_events`.

At the moment it records:

- first activation of an alert
- severity changes while the alert stays active
- resolution of a previously active alert

## Background notifier

`ProcessingAlertNotifierService` polls `processing_alert_events` with pending or retryable error delivery state
and sends notifications through configured sinks.

Current sinks:

- application logs
- optional webhook via `ProcessingAlertNotifierWebhookUrl`

Webhook formats:

- `json` — canonical machine-readable payload
- `slack` — Slack-compatible incoming webhook payload with `text` and `blocks`

Canonical JSON webhook payload contains:

- `eventId`
- `source`
- `environment`
- `alertCode`
- `eventType`
- `severity`
- `message`
- `count`
- `samples`
- `createdAt`

Dispatcher behavior:

- successful delivery marks event as `sent`
- failed delivery marks event as `error`
- failed delivery is retried after `ProcessingAlertNotifierRetryDelaySeconds`
- events filtered out by notifier policy are marked as `suppressed`
- dashboard history shows the current delivery state

Notification policy:

- `ProcessingAlertNotifierMinimumSeverity` sets the minimum severity for delivery
- `ProcessingAlertNotifierEventTypes` restricts which transition types are delivered
- `ProcessingAlertNotifierWebhookFormat` chooses `json` or `slack`
- default configuration keeps current broad behavior: `info` and all current event types

## Config knobs

The following `App` settings control alert sensitivity and payload size:

- `AdminEmails` (bootstrap only)
- `ProcessingAlertQueuedReadyAgeSeconds`
- `ProcessingAlertOutboxPendingAgeSeconds`
- `ProcessingAlertRecentFailureWindowMinutes`
- `ProcessingAlertRecentFailureCountThreshold`
- `ProcessingDiagnosticsItemLimit`
- `ProcessingAlertMonitorEnabled`
- `ProcessingAlertMonitorIntervalSeconds`
- `ProcessingAlertHistoryItemLimit`
- `ProcessingAlertNotifierEnabled`
- `ProcessingAlertNotifierLogEnabled`
- `ProcessingAlertNotifierSourceName`
- `ProcessingAlertNotifierMinimumSeverity`
- `ProcessingAlertNotifierEventTypes`
- `ProcessingAlertNotifierWebhookFormat`
- `ProcessingAlertNotifierWebhookUrl`
- `ProcessingAlertNotifierIntervalSeconds`
- `ProcessingAlertNotifierRetryDelaySeconds`
- `ProcessingAlertNotifierBatchSize`

## Recommended next step

Integrate `/metrics/processing/alerts`, `/admin/processing/overview` or `/admin/processing/alerts/history`
with external monitoring, tune real alert thresholds from production-like runs, or replace the current email allowlist with полноценные роли пользователей when they appear in the project.
