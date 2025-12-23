# Информационная система извлечения данных из графиков

Система принимает изображение с графиком, запускает ML-пайплайн, сохраняет результаты (точки и/или артефакты) и отображает их во фронтенде: диагностические изображения (LineFormer/ChartDete/plot) и интерактивный график, а также экспорт точек в CSV.

## 1) Требования

* **Windows 10/11 / Linux / macOS**
* **Python 3.10** (важно: ML-пакеты привязаны к 3.10)
* **Node.js 18+** и npm
* **PostgreSQL 13+**
* (Опционально для ML в Modal) установлен и настроен **Modal CLI** и токен

## 2) Скачивание проекта

1. На GitHub откройте репозиторий → **Code → Download ZIP**.
2. Распакуйте архив в удобную папку (например `diplom/`).
3. Откройте папку проекта в VS Code.

Далее в инструкциях предполагается, что структура такая:

* `project-backend/` — бэкенд (FastAPI + PostgreSQL)
* `ml-worker/` — воркер, который забирает задания из БД и запускает ML
* `frontend/` — фронтенд (Vite + React)

---

# 3) Настройка базы данных (PostgreSQL)

Создайте БД и пользователя (если нужно). Минимально вам понадобятся:

* база: `chart_extraction`
* пользователь и пароль (любые)
* строка подключения вида:

`postgresql+psycopg2://USER:PASSWORD@HOST:PORT/chart_extraction`

Пример для локального Postgres:

`postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/chart_extraction`

---

# 4) Запуск бэкенда

## 4.1 Создать .env для бэкенда

Создайте файл **`project-backend/.env`**:

```env
DATABASE_URL=postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/chart_extraction
JWT_SECRET_KEY=CHANGE_ME
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60

# куда сохраняются загруженные файлы и артефакты
STORAGE_DIR=./backend/storage

# если в проекте предусмотрен dev-режим авторизации:
AUTH_ENABLED=0
DEV_USER_EMAIL=dev@local
DEV_USER_PASSWORD=devpass
```

Важно: `STORAGE_DIR` можно оставить как есть. При запуске бэкенда из `project-backend` это будет папка `project-backend/backend/storage`.

## 4.2 Установить зависимости

Откройте терминал в VS Code и перейдите в `project-backend`:

```bat
cd project-backend
```

Создайте и активируйте виртуальное окружение (пример для Windows):

```bat
py -3.10 -m venv .venv
.venv\Scripts\activate
```

Установите зависимости (если в репозитории есть `requirements.txt` — используйте его; иначе установите вручную):

```bat
pip install -r requirements.txt
```

Если `requirements.txt` нет:

```bat
pip install fastapi "uvicorn[standard]" sqlalchemy psycopg2-binary alembic "pydantic>=2" python-multipart python-dotenv "python-jose[cryptography]" "passlib[bcrypt]"
```

## 4.3 Применить миграции

Перейдите в папку `backend` и примените миграции:

```bat
cd backend
alembic upgrade head
cd ..
```

## 4.4 Запустить сервер

Запуск из папки `project-backend`:

```bat
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

Проверка:

* `http://127.0.0.1:8000/health`
* `http://127.0.0.1:8000/docs`

---

# 5) Запуск ML-воркера

Воркер периодически опрашивает БД, берёт записи `charts` со статусом `uploaded`, переводит в `processing`, запускает ML и обновляет запись на `done` или `error`.

## 5.1 .env для воркера

Создайте файл **`ml-worker/.env`**:

```env
DATABASE_URL=postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/chart_extraction

# должен совпадать с STORAGE_DIR бэкенда, чтобы артефакты сохранялись туда же
STORAGE_DIR=../project-backend/backend/storage

POLL_INTERVAL=2
WORK_DIR=./runs/worker
```

## 5.2 Виртуальное окружение и зависимости

Перейдите в `ml-worker`:

```bat
cd ..\ml-worker
py -3.10 -m venv .venv
.venv\Scripts\activate
```

Установите зависимости воркера:

```bat
pip install psycopg2-binary python-dotenv
```

Далее нужен пакет `plextract` (из `extract-line-chart-data`). Способ установки зависит от того, как он лежит в вашем репозитории:

* если папка `extract-line-chart-data/` находится внутри `ml-worker/`, выполните:

```bat
cd extract-line-chart-data
pip install -e ".[modal]"
cd ..
```

## 5.3 Настройка Modal (если используете backend="modal")

Если ML запускается через Modal, убедитесь, что токен настроен (один раз):

```bat
modal token new
```

(или тот способ авторизации, который вы используете в Modal).

## 5.4 Запуск воркера

Из папки `ml-worker`:

```bat
python worker_modal.py
```

Если воркер запущен и бэкенд работает, загрузки из фронтенда будут переходить в статусы `processing → done/error`.

---

# 6) Запуск фронтенда

## 6.1 Настройка API URL

Создайте файл **`frontend/.env`**:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

## 6.2 Установка и запуск

Перейдите в папку `frontend`:

```bat
cd ..\frontend
npm install
npm run dev
```

Откройте в браузере:

* `http://localhost:5173`

---

# 7) Проверка работы (коротко)

1. Откройте фронтенд → загрузите изображение.
2. Фронтенд отправляет файл в бэкенд → создаётся запись `charts` со статусом `uploaded`.
3. Воркер забирает задачу → `processing`.
4. После завершения:

   * если точки извлечены → `done` и интерактивный график + экспорт CSV;
   * если точки не извлечены (например, не появился `data.json`) → `error`, но артефакты (изображения) всё равно отображаются на странице результата.

---

# 8) Частые проблемы

* **Статус всегда `uploaded`:** воркер не запущен или не может подключиться к БД.
* **`ERR_CONNECTION_REFUSED` во фронте:** неверный `VITE_API_BASE_URL` или бэкенд не запущен.
* **Ошибка “converted_datapoints/data.json not found”:** пайплайн не сформировал точки; это допустимый сценарий — артефакты должны отображаться.
* **Воркер на другом ПК/сервере:** пути `original_path` и `STORAGE_DIR` должны быть доступны воркеру (общая папка/сетевое хранилище/объектное хранилище). В локальном запуске это не требуется.
