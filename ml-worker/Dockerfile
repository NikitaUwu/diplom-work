# ml-worker/Dockerfile
# Альтернативная база для GPU-режима, если понадобится CUDA.
# FROM pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime
FROM python:3.10-slim

# Рабочая директория внутри контейнера. Структура ниже важна для поиска REPO_ROOT в worker_local.py.
WORKDIR /app

# Системные зависимости
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# CPU-версия PyTorch. Версия должна совпадать с индексом колёс mmcv-full ниже.
RUN pip install --no-cache-dir torch==2.1.0+cpu torchvision==0.16.0+cpu --index-url https://download.pytorch.org/whl/cpu

# Копируем requirements и ставим пакеты
COPY extract-line-chart-data/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Установка mmcv для MMDetection/ChartDete.
RUN pip install --no-cache-dir "mmcv-full==1.7.2" -f https://download.openmmlab.com/mmcv/dist/cpu/torch2.1.0/index.html

# Установка ChartDete из GitHub, так как он нужен для детекции областей графика.
RUN pip install git+https://github.com/pengyu965/ChartDete.git

# Копируем только нужный код worker'а в ожидаемую структуру:
# /app/ml-worker/extract-line-chart-data/worker_local.py
COPY extract-line-chart-data/worker_local.py ./ml-worker/extract-line-chart-data/worker_local.py
COPY extract-line-chart-data/src ./ml-worker/extract-line-chart-data/src

# Точка входа контейнера: запускает основной worker.
CMD ["python", "ml-worker/extract-line-chart-data/worker_local.py"]
