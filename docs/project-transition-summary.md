# Промежуточный итог миграции проекта

## 1. Что было сделано

Проект перенесен на новый стек в каталоге `diplomWork`.

Выполнено:

- backend переписан на `.NET 8`;
- frontend переведен на `Aurelia 2`;
- ML-часть оставлена на `Python`;
- связка backend <-> ML переведена на `MQTT`;
- добавлены `processing_jobs`, `outbox`, `inbox`, lease/heartbeat, retry и классификация ошибок;
- добавлены метрики, alerts, diagnostics и operational dashboard;
- временная схема admin-доступа по email заменена на role-based модель;
- редактор графиков перенесен на нативный `Aurelia` без активной зависимости от `React`;
- добавлены smoke-check и cleanup-скрипты для воспроизводимой проверки MQTT-контура.

## 2. Что сейчас работает

На текущем этапе работает полный новый контур обработки:

1. frontend отправляет запросы в новый `.NET` backend;
2. backend сохраняет график, создает задачу и публикует MQTT request;
3. `Python ml-worker` принимает задачу по MQTT;
4. worker запускает ML pipeline, получает артефакты и публикует итоговые MQTT events;
5. backend обновляет состояние `charts` и `processing_jobs`;
6. frontend получает готовый результат со статусом `done`.

Это подтверждено:

- успешной сборкой backend;
- успешным прогоном `dotnet test` (`44/44`);
- живыми E2E smoke-check прогонами в MQTT-режиме;
- успешным завершением свежих тестовых загрузок в `done`.

## 3. Как сейчас устроена система

Текущий поток данных:

1. `Aurelia 2 frontend` -> HTTP -> `.NET 8 backend`
2. `backend` -> `PostgreSQL` и файловое `storage`
3. `backend` -> MQTT request
4. `Python ml-worker` -> обработка + артефакты
5. `ml-worker` -> MQTT accepted / heartbeat / completed / failed
6. `backend` -> обновление БД и отдача результата frontend

Источник истины в системе:

- `PostgreSQL` для статусов, метаданных и `result_json`;
- `storage` для исходных файлов и ML-артефактов.

## 4. Примененный стек технологий

### Backend

- `C#`
- `ASP.NET Core 8`
- `Entity Framework Core`
- `Npgsql`
- `PostgreSQL`
- `MQTTnet`
- `JWT + cookie auth`

### Frontend

- `TypeScript`
- `Aurelia 2`
- `Vite`

### ML / Processing

- `Python 3.10`
- `paho-mqtt`
- `psycopg2`
- `Modal`
- `plextract / extract-line-chart-data`

### Инфраструктура

- `PostgreSQL`
- `MQTT broker`
- файловое `storage` на стороне backend
- `Visual Studio` для backend-разработки
- `PowerShell`-скрипты для smoke-check и cleanup

## 5. Что добавлено для эксплуатации

В проект уже включены:

- operational dashboard для processing-контура;
- alerts и diagnostics;
- retry policy по ошибкам;
- role-based доступ для admin-endpoints;
- скрипт smoke-check для проверки MQTT-контура;
- скрипт cleanup для удаления синтетических тестовых данных.

## 6. Текущий статус

Если кратко:

- миграция backend выполнена;
- миграция frontend выполнена;
- MQTT-связка с ML доведена до рабочего E2E;
- базовая эксплуатационная наблюдаемость уже реализована;
- новый стек уже реально запускается и проходит полный сценарий обработки графика.
