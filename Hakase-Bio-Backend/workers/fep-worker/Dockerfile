# Hakase BioTwin — FEP/TIES RunPod Worker
# Base: NVIDIA CUDA 12.1 + Ubuntu 22.04
# GPU requirement: A100 or H100 (40+ GB VRAM for large systems)

FROM runpod/base:0.6.2-cuda12.1.0

# ── System deps ───────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    openbabel \
    libopenbabel-dev \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ───────────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Worker code ───────────────────────────────────────────────────────────────
COPY handler.py .

# ── RunPod entrypoint ─────────────────────────────────────────────────────────
CMD ["python", "-u", "handler.py"]
