# Visual Studio MQTT Smoke Check

Быстрый способ воспроизводимо проверить связку `.NET backend + MQTT broker + ml-worker` рядом с Visual Studio.

## Перед запуском

1. Открой решение `diplomWork.sln` в Visual Studio.
2. Сделай проект `diplomWork` стартовым.
3. Запусти backend с профилем `http`.
4. Убедись, что PostgreSQL доступен по настройкам из `diplomWork/appsettings.Development.json`.

## Команда smoke-check

Из терминала в корне проекта:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\visual-studio-mqtt-smoke-check.ps1
```

Скрипт:

- проверяет `/health` у backend;
- поднимает MQTT broker, если порт `1883` еще не открыт;
- поднимает `ml-worker`, если он еще не запущен;
- создает синтетического пользователя `mqtt-live-...@example.com`;
- загружает тестовый PNG-график;
- опрашивает `GET /api/v1/charts/{id}` до terminal status.

Успех выглядит так:

```text
chart_id=...
test_email=mqtt-live-...@example.com
initial_status=uploaded
...
poll_14=status:done;series:2;error:
smoke_check=passed
```

## Автоочистка тестовых данных

Если нужно автоматически убрать синтетического пользователя, его графики и артефакты:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\visual-studio-mqtt-smoke-check.ps1 -CleanupAfter
```

## Ручная очистка старых MQTT smoke/probe данных

Dry-run:

```powershell
.\ml-worker\.venv\Scripts\python.exe .\scripts\cleanup-mqtt-test-data.py
```

Применить удаление:

```powershell
.\ml-worker\.venv\Scripts\python.exe .\scripts\cleanup-mqtt-test-data.py --apply
```

Скрипт чистит только синтетические email-паттерны:

- `mqtt-live-*@example.com`
- `mqtt-probe-*@local.test`

Он удаляет:

- пользователей;
- связанные `charts`;
- связанные `processing_jobs` и `outbox_messages`;
- storage-папки `storage/user_<id>`;
- worker-run папки `ml-worker/runs/worker/chart_<id>`.
