# Запуск проекта

Документ описывает актуальный локальный запуск проекта без S3/MinIO. Сейчас используются:

- backend на `.NET 8`
- frontend на `Aurelia 2 + Vite`
- `PostgreSQL`
- `Python ml-worker`
- `Mosquitto` только если включен MQTT-режим

## Что должно быть установлено

- `.NET SDK 8`
- `Node.js` и `npm`
- `Python 3.10`
- `PostgreSQL`
- `Docker Desktop` только для запуска Mosquitto

## Конфигурация

### Backend

Основной локальный файл:

- `diplomWork/appsettings.Development.json`

Проверь:

- строку подключения к PostgreSQL
- `App.CorsOrigins` с `http://localhost:5173`
- `App.MqttEnabled`

Режимы backend:

- `App.MqttEnabled = true` — backend публикует задачи в MQTT и принимает события от worker
- `App.MqttEnabled = false` — backend не использует MQTT и ждет, что worker сам будет опрашивать `processing_jobs`

По умолчанию backend доступен на:

- `http://localhost:5092`
- Swagger: `http://localhost:5092/swagger`

### Frontend

Файл:

- `frontend/.env`

Типовое значение:

```env
VITE_API_BASE_URL=http://localhost:5092/api/v1
```

### ML-worker

Файл:

- `ml-worker/.env`

Шаблон:

- `ml-worker/.env.example`

Минимальный пример:

```env
DATABASE_URL=postgresql://...
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
STORAGE_DIR=...
WORK_DIR=...
POLL_INTERVAL=2
```

Режимы worker:

- `MQTT_ENABLED=1` — задачи приходят через MQTT, worker не работает с БД напрямую
- `MQTT_ENABLED=0` — worker берет задачи из `processing_jobs` напрямую через polling БД

Важно: если MQTT выключен, у backend и worker должен быть согласован один и тот же режим.

## Подготовка Python-окружения

Если `ml-worker/.venv` отсутствует:

```powershell
cd .\ml-worker
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ..\requirements.txt
```

## Запуск

### Вариант 1. Visual Studio + терминалы

#### 1. Запусти Mosquitto при `MQTT_ENABLED=1`

Если MQTT выключен, этот шаг не нужен.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

#### 2. Запусти backend

Открой `diplomWork.sln`, выбери проект `diplomWork` стартовым, профиль `http` и запусти его.

#### 3. Запусти frontend

```powershell
cd .\frontend
npm install
npm run dev
```

#### 4. Запусти worker

```powershell
cd .\ml-worker
.\.venv\Scripts\python.exe -u .\worker_local.py
```

### Вариант 2. Полностью из консоли

#### 1. Mosquitto

Только для MQTT-режима:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

#### 2. Backend

```powershell
.\run-backend.ps1
```

#### 3. Frontend

```powershell
cd .\frontend
npm install
npm run dev
```

#### 4. Worker

```powershell
cd .\ml-worker
.\.venv\Scripts\python.exe -u .\worker_local.py
```

## Быстрая проверка

После запуска проверь:

1. `http://localhost:5092/swagger` открывается
2. `http://localhost:5173` открывается
3. `ml-worker` стартует без падения
4. при MQTT-режиме контейнер `diplom-mosquitto` находится в состоянии `Running`

Дальше можно:

1. открыть frontend
2. войти или зарегистрироваться
3. загрузить изображение графика
4. дождаться статуса `done` или `error`
5. открыть страницу результата

## Автоматический smoke-check

Скрипт проверки нужен только для MQTT-режима:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\visual-studio-mqtt-smoke-check.ps1
```

Он проверяет `/health`, поднимает Mosquitto при необходимости, запускает `ml-worker`, загружает тестовый график и ждет terminal status.

## Остановка

- frontend: остановить терминал с `npm run dev`
- worker: остановить терминал с `worker_local.py`
- backend: остановить запуск в Visual Studio или завершить процесс `dotnet`
- Mosquitto: `docker compose -f .\docker-compose.mqtt.yml down`

## Типовые проблемы

### Frontend не достучался до API

Проверь:

- запущен ли backend
- совпадает ли `frontend/.env` с адресом backend
- разрешен ли `http://localhost:5173` в `CorsOrigins`

### Worker не стартует

Проверь:

- существует ли `ml-worker/.env`
- корректны ли `DATABASE_URL`, `STORAGE_DIR`, `WORK_DIR`
- установлены ли зависимости в `ml-worker/.venv`

### MQTT-режим не работает

Проверь:

- `App.MqttEnabled = true` у backend
- `MQTT_ENABLED=1` у worker
- доступен ли Mosquitto на `localhost:1883`

### Режим без MQTT не работает

Проверь:

- `App.MqttEnabled = false` у backend
- `MQTT_ENABLED=0` у worker
- worker видит ту же БД, что и backend
