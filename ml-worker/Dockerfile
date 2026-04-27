# ml-worker/Dockerfile
# FROM pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime
FROM python:3.10-slim

# WORKDIR is the repo root so worker_local.py's parents[2] resolves correctly
WORKDIR /app

# Системные зависимости
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU-only
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Копируем requirements и ставим пакеты
COPY extract-line-chart-data/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Установка mmcv
RUN pip install --no-cache-dir "mmcv-full==1.7.2" -f https://download.openmmlab.com/mmcv/dist/cpu/torch2.1.0/index.html

# Установка ChartDete
RUN pip install git+https://github.com/pengyu965/ChartDete.git

# Создаем структуру директорий, чтобы worker_local.py нашел REPO_ROOT через parents[2]
# Ожидаемая структура: /app/ml-worker/extract-line-chart-data/worker_local.py
COPY extract-line-chart-data/worker_local.py ./ml-worker/extract-line-chart-data/worker_local.py
COPY extract-line-chart-data/src ./ml-worker/extract-line-chart-data/src

CMD ["python", "ml-worker/extract-line-chart-data/worker_local.py"]
