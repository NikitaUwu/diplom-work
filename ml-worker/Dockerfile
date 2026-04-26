# ml-worker/Dockerfile
FROM pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime

WORKDIR /app

# Системные зависимости
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Копируем requirements и ставим пакеты
COPY extract-line-chart-data/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Установка mmcv
RUN mim install "mmcv-full==1.7.2"

# Установка ChartDete
RUN pip install git+https://github.com/pengyu965/ChartDete.git

# Копируем worker_local.py
COPY extract-line-chart-data/worker_local.py ./worker_local.py

# Копируем src ПОСЛЕДНИМ — это гарантирует что изменения в chartdete.py попадут в образ
COPY extract-line-chart-data/src ./src

CMD ["python", "worker_local.py"]