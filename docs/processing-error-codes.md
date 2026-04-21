# Каталог processing error codes

Ниже зафиксирован текущий стабильный каталог `errorCode`, который worker передает backend в MQTT-событии `charts/process/failed`.

| `errorCode` | Retryable | Смысл |
|---|---:|---|
| `input_file_missing` | `false` | Исходный файл не найден или путь к нему отсутствует |
| `storage_permission_denied` | `false` | Worker не может читать или писать storage |
| `pipeline_output_invalid` | `false` | ML-пайплайн завершился, но выходные артефакты невалидны или неполны |
| `modal_backend_unavailable` | `true` | Внешний backend/инфраструктура Modal временно недоступны |
| `network_timeout` | `true` | Временная сетевая ошибка или timeout при вызове внешних зависимостей |
| `unexpected_worker_error` | `false` | Неклассифицированная ошибка worker |
| `processing_lease_expired` | `true` | Внутренний код backend: lease истек, задача переочередена |

## Retry policy

Сейчас backend применяет разные retry-policy:

- `modal_backend_unavailable`: отдельный max attempts и retry delay;
- `network_timeout`: отдельный max attempts и retry delay;
- `processing_lease_expired`: использует базовые lease retry-настройки;
- остальные коды: terminal по умолчанию;
- `unexpected_worker_error` может быть retryable только как временный fallback для legacy worker-пейлоадов без `errorCode`.

## Правила

- Backend принимает решение о retry в первую очередь по `errorCode`.
- Поле `retryable` сейчас используется как fallback совместимости, если `errorCode` отсутствует.
- Текст `errorMessage` больше не должен быть основным источником решения о retry.

## Следующий шаг

- Уточнить каталог кодов по реальным типам ошибок ML-пайплайна.
- Постепенно убрать fallback по `retryable`, когда все worker будут стабильно отправлять `errorCode`.
