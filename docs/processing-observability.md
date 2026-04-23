# Processing Observability

The backend currently exposes only the operational endpoints that are backed by the compact database schema and live processing state.

## Active endpoints

- `GET /health`
- `GET /metrics/processing`
- `GET /metrics/processing/alerts`
- `GET /admin/processing/overview`
- `GET /admin/processing/diagnostics`
- `GET /admin/processing/dashboard`

## Endpoint purpose

### `/health`

Simple liveness probe:

- returns `{ "status": "ok" }`

### `/metrics/processing`

Compact machine-readable counters for:

- `processing_jobs` by status
- `mqtt_messages` by status
- `errorCode` distribution
- retryable vs terminal error jobs
- queued ready vs delayed jobs

### `/metrics/processing/alerts`

Derived operational alerts built from the current database state.

The backend currently raises alerts for:

- stale processing jobs with expired lease
- queued jobs that stayed ready for too long
- stale pending outbound MQTT messages
- outbound MQTT publish errors
- recent spikes of failed jobs

Each alert contains:

- `code`
- `severity`
- `message`
- `count`
- `samples`

### `/admin/processing/diagnostics`

Admin-only human-oriented diagnostics snapshot with top problematic records:

- stale processing jobs
- queued ready jobs
- failed jobs
- pending outbound MQTT messages
- errored outbound MQTT messages
- recent inbound MQTT messages

This endpoint is intended for fast incident triage without manual SQL.

### `/admin/processing/overview`

Admin-only combined payload that returns:

- `metrics`
- `alerts`
- `diagnostics`

Use it when a client or dashboard should read one protected endpoint instead of combining multiple requests.

### `/admin/processing/dashboard`

Admin-only HTML dashboard with auto-refresh every 15 seconds.

It renders:

- top-level system snapshot cards
- operational alerts
- stale/queued/failed job lists
- pending/error MQTT message lists
- recent inbound MQTT messages

## Removed endpoints

The following routes were removed because they were no longer backed by the compact schema and only returned empty or stubbed responses:

- `GET /admin/processing/alerts/history`
- `GET /admin/processing/notifier/status`
- `GET /admin/processing/alerts/{eventId}/preview`
- `POST /admin/processing/notifier/dispatch`

The compact schema does not persist alert history or notification queues, so these APIs were intentionally dropped.

## Admin access rules

- when `AuthEnabled=false`, admin-only operational endpoints are available through the local dev user flow
- when `AuthEnabled=true` and the current user has `role=admin`, access is allowed
- otherwise the endpoint returns `403 Admin access required`

## Config knobs still used by the active monitoring flow

- `AdminEmails` (bootstrap only)
- `ProcessingAlertQueuedReadyAgeSeconds`
- `ProcessingAlertOutboxPendingAgeSeconds`
- `ProcessingAlertRecentFailureWindowMinutes`
- `ProcessingAlertRecentFailureCountThreshold`
- `ProcessingDiagnosticsItemLimit`

## Recommended next step

Integrate `/metrics/processing/alerts`, `/metrics/processing`, or `/admin/processing/overview`
with external monitoring and tune thresholds based on real runs of the MQTT processing pipeline.
