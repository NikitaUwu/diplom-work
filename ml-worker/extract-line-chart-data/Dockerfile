# FROM pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU-only
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir "mmcv-full==1.7.2" -f https://download.openmmlab.com/mmcv/dist/cpu/torch2.1.0/index.html

RUN pip install git+https://github.com/pengyu965/ChartDete.git

COPY . .

CMD ["python", "worker_local.py"]