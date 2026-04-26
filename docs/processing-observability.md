# Наблюдаемость processing-контура

Backend сейчас отдает только те operational endpoints, которые реально поддерживаются текущей схемой БД и живым состоянием обработки.

## Актуальные endpoints

- `GET /health`
- `GET /metrics/processing`
- `GET /metrics/processing/alerts`
- `GET /admin/processing/overview`
- `GET /admin/processing/diagnostics`
- `GET /admin/processing/dashboard`

## Что они показывают

### `/health`

Простая liveness-проверка:

- возвращает `{ "status": "ok" }`

### `/metrics/processing`

Машиночитаемые счетчики по:

- `processing_jobs` по статусам
- `mqtt_messages` по статусам
- распределению `errorCode`
- retryable и terminal ошибкам
- queued ready и delayed задачам

### `/metrics/processing/alerts`

Снимок operational alerts, вычисленный из текущего состояния БД.

Сейчас backend поднимает alerts для:

- processing-задач с истекшим lease
- queued-задач, которые слишком долго ждут выполнения
- застарелых pending MQTT-сообщений
- ошибок публикации MQTT-сообщений
- всплеска failed-задач

### `/admin/processing/diagnostics`

Admin-only диагностика с проблемными записями:

- stale processing jobs
- queued ready jobs
- failed jobs
- pending outbound MQTT messages
- errored outbound MQTT messages
- recent inbound MQTT messages

### `/admin/processing/overview`

Admin-only объединенный ответ:

- `metrics`
- `alerts`
- `diagnostics`

### `/admin/processing/dashboard`

HTML dashboard с автообновлением, построенный поверх этих же данных.

## Что меняется при отключенном MQTT

Если `App.MqttEnabled = false`:

- endpoints продолжают работать
- блоки по `processing_jobs` остаются актуальными
- блоки по `mqtt_messages` обычно пустые или почти пустые
- alerts про pending и errored MQTT messages в норме отсутствуют

## Удаленные endpoints

Следующие маршруты удалены как неактуальные:

- `GET /admin/processing/alerts/history`
- `GET /admin/processing/notifier/status`
- `GET /admin/processing/alerts/{eventId}/preview`
- `POST /admin/processing/notifier/dispatch`

Они больше не поддерживаются компактной схемой.

## Правила доступа

- при `AuthEnabled=false` admin-endpoints доступны через локальный dev-flow
- при `AuthEnabled=true` нужен пользователь с `role=admin`
- иначе возвращается `403`

## Важные настройки

- `ProcessingAlertQueuedReadyAgeSeconds`
- `ProcessingAlertOutboxPendingAgeSeconds`
- `ProcessingAlertRecentFailureWindowMinutes`
- `ProcessingAlertRecentFailureCountThreshold`
- `ProcessingDiagnosticsItemLimit`

## Практический смысл

Для локальной диагностики обычно достаточно `GET /health`, `GET /metrics/processing` и `GET /admin/processing/overview`.
