# Каталог `processing error codes`

Ниже зафиксированы актуальные `errorCode`, которые используются при завершении обработки с ошибкой.

В MQTT-режиме worker передает их backend в событии `charts/process/failed`.

В режиме без MQTT эти же коды должны попадать в `processing_jobs.error_code`.

| `errorCode` | Retryable | Смысл |
|---|---:|---|
| `input_file_missing` | `false` | Исходный файл не найден или путь к нему отсутствует |
| `storage_permission_denied` | `false` | Worker не может читать или писать storage |
| `pipeline_output_invalid` | `false` | Пайплайн завершился, но выходные артефакты невалидны или неполны |
| `modal_backend_unavailable` | `true` | Внешняя инфраструктура временно недоступна |
| `network_timeout` | `true` | Временная сетевая ошибка или timeout |
| `unexpected_worker_error` | `false` | Неклассифицированная ошибка worker |
| `processing_lease_expired` | `true` | Внутренний код backend: lease истек, задача переочередена |

## Правила обработки

- backend принимает решение о retry в первую очередь по `errorCode`
- `retryable` остается fallback-полем совместимости
- `errorMessage` используется для текста ошибки, но не как главный признак retry

## Замечание

Каталог еще можно уточнять по мере накопления реальных ошибок ML-пайплайна, но текущие коды уже считаются рабочим контрактом между backend и worker.
