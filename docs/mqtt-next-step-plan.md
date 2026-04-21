# Следующие шаги после retry policy

## Что уже сделано

Сейчас цепочка `backend -> worker -> backend` выглядит так:

1. backend сохраняет `processing_job`;
2. backend кладет MQTT-команду в `outbox_messages`;
3. dispatcher публикует `charts/process/request`;
4. worker публикует `accepted`, периодические `heartbeat` и terminal-событие `completed` или `failed`;
5. backend обновляет `processing_jobs` и `charts`, а monitor следит за протухшими lease.

Это уже дает:

- outbox для надежной отправки команд;
- inbox для идемпотентной обработки `accepted/completed/failed`;
- lease/heartbeat для обнаружения зависших задач;
- controlled retry для `lease expired`;
- controlled retry для `failed`, если worker пометил ошибку как `retryable`;
- защиту от stale MQTT-событий старой попытки через `requestMessageId`.

## Следующая цель

Сделать классификацию `failed` более доменной и предсказуемой, а не опираться только на `retryable/errorCode` и fallback-эвристики по тексту ошибки.

## Рекомендуемый следующий этап

### 1. Нормализованный каталог error codes

Нужно зафиксировать:

- стабильный список `errorCode`;
- какие коды retryable;
- какие коды terminal;
- какие коды должны отображаться пользователю как понятные статусы.

Сейчас уже есть:

- `errorCode`;
- `retryable`;
- fallback-классификация на backend по тексту ошибки.

Следующий шаг: убрать fallback по `retryable`, когда все worker будут стабильно отправлять коды из [processing-error-codes.md](C:\Users\nikit\Documents\New project\diplomWork-stage\docs\processing-error-codes.md).

### 2. Метрики и алерты

Нужно определить:

- какие значения с `/metrics/processing` считать тревожными;
- какие error categories выводить в мониторинг в первую очередь;
- нужны ли отдельные алерты на рост `modal_backend_unavailable`, `network_timeout` и `processing_lease_expired`.

### 3. Shared subscriptions для нескольких worker

Если worker станет больше одного, стоит использовать shared subscription:

```text
$share/diplom-workers/charts/process/request
```

Это позволит распределять задачи между несколькими ML-инстансами без ручной координации.

### 4. Наблюдаемость

Полезно добавить:

- счетчики `queued / processing / done / error` по `processing_jobs`;
- число истекших lease;
- число retryable `failed` и terminal `failed`;
- возраст старейшей `queued` job;
- число duplicate inbox/outbox событий;
- корреляцию логов по `chartId / jobId / messageId`.

## Что пока можно не менять

- REST-контракт фронта;
- формат `result_json`;
- storage-структуру файлов;
- редактор и spline-логику.
