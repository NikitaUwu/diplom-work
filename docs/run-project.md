# Запуск проекта

Этот документ описывает текущий способ локального запуска всего проекта без S3/MinIO. Сейчас используются:

- backend на `.NET 8`
- frontend на `Aurelia 2 + Vite`
- `PostgreSQL`
- `Mosquitto` через Docker
- `Python ml-worker`

## Что должно быть установлено

- `.NET SDK 8`
- `Node.js` и `npm`
- `Python 3.10`
- `PostgreSQL`
- `Docker Desktop`

## Что должно быть настроено

### 1. Backend

Файл локальной конфигурации:

- `diplomWork/appsettings.Development.json`

Проверь, что в нем корректны:

- строка подключения к PostgreSQL
- `App.MqttEnabled = true`
- `App.MqttHost = "localhost"`
- `App.MqttPort = 1883`
- `App.CorsOrigins` содержит `http://localhost:5173`

Локальный backend по умолчанию запускается на:

- `http://localhost:5092`

Swagger:

- `http://localhost:5092/swagger`

### 2. Frontend

Во фронтенде уже используется:

- `frontend/.env`

Текущее значение:

```env
VITE_API_BASE_URL=http://localhost:5092/api/v1
```

Если backend запускается на другом адресе или порту, обнови это значение.

### 3. ML-worker

Файл окружения:

- `ml-worker/.env`

Можно взять за основу:

- `ml-worker/.env.example`

Минимально должны быть заданы:

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
```

Если `.venv` отсутствует, создай его и установи зависимости:

```powershell
cd .\ml-worker
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ..\requirements.txt
```

## Порядок запуска

### Вариант 1. Через Visual Studio + терминалы

#### Шаг 1. Запусти Mosquitto

Из корня проекта:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

Порт брокера:

- `localhost:1883`

Mosquitto можно потом запускать и останавливать через Docker Desktop.

#### Шаг 2. Запусти backend

Открой:

- `diplomWork.sln`

В Visual Studio:

1. Выбери проект `diplomWork` стартовым.
2. Выбери профиль `http`.
3. Запусти проект.

Backend будет доступен по адресу:

- `http://localhost:5092`

#### Шаг 3. Запусти frontend

В отдельном терминале:

```powershell
cd .\frontend
npm install
npm run dev
```

Фронтенд по умолчанию будет доступен по адресу:

- `http://localhost:5173`

#### Шаг 4. Запусти ML-worker

В отдельном терминале:

```powershell
cd .\ml-worker
.\.venv\Scripts\python.exe -u .\worker_modal.py
```

Worker читает настройки из:

- `ml-worker/.env`

## Вариант 2. Полностью из консоли

### 1. Mosquitto

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mosquitto.ps1 -Detached
```

### 2. Backend

```powershell
.\run-backend.ps1
```

### 3. Frontend

```powershell
cd .\frontend
npm install
npm run dev
```

### 4. ML-worker

```powershell
cd .\ml-worker
.\.venv\Scripts\python.exe -u .\worker_modal.py
```

## Быстрая проверка

После запуска всех частей проверь:

1. Swagger backend открывается на `http://localhost:5092/swagger`
2. frontend открывается на `http://localhost:5173`
3. в Docker Desktop контейнер `diplom-mosquitto` находится в состоянии `Running`
4. `ml-worker` не падает при старте

Дальше сценарий проверки такой:

1. открыть frontend
2. зарегистрироваться или войти
3. загрузить изображение графика
4. дождаться завершения обработки
5. открыть страницу результата и редактор

## Автоматический smoke-check

Если backend уже запущен из Visual Studio, можно использовать встроенный скрипт проверки MQTT-контура:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\visual-studio-mqtt-smoke-check.ps1
```

Он:

- проверяет `/health`
- поднимает Mosquitto при необходимости
- запускает `ml-worker`, если он еще не запущен
- загружает тестовый график
- ждет terminal status у chart

## Остановка

### Frontend

Остановить терминал с `npm run dev`.

### ML-worker

Остановить терминал с `worker_modal.py`.

### Backend

Остановить запуск в Visual Studio или завершить процесс `dotnet`.

### Mosquitto

Из корня проекта:

```powershell
docker compose -f .\docker-compose.mqtt.yml down
```

## Если что-то не работает

### Frontend пустой или не может достучаться до API

Проверь:

- запущен ли backend
- совпадает ли `frontend/.env` с адресом backend
- разрешен ли `http://localhost:5173` в `CorsOrigins`

### Worker не подключается к backend/MQTT

Проверь:

- существует ли `ml-worker/.env`
- корректен ли `DATABASE_URL`
- включен ли `MQTT_ENABLED=1`
- поднят ли Mosquitto на `localhost:1883`

### Backend не стартует

Проверь:

- доступность PostgreSQL
- корректность строки подключения
- занятость порта `5092`

### Python-модули не найдены

Переустанови зависимости в `ml-worker/.venv`:

```powershell
cd .\ml-worker
.\.venv\Scripts\python.exe -m pip install -r ..\requirements.txt
```
