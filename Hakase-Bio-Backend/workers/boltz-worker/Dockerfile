# Hakase BioTwin — Boltz-2 Co-folding RunPod Worker
# Base: NVIDIA CUDA 12.1 + Ubuntu 22.04
# GPU requirement: A100 40GB minimum (H100 80GB recommended for large complexes)

FROM runpod/base:0.6.2-cuda12.1.0

# ── System deps ───────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ───────────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Pre-download Boltz-2 model weights (~3 GB) at build time ──────────────────
# This bakes the weights into the image layer so cold-start is fast (~10s vs ~5min)
RUN python -c "import boltz; boltz.download_weights()" || \
    boltz check --download 2>/dev/null || \
    echo "Weight pre-download skipped — will download on first run"

# ── Worker code ───────────────────────────────────────────────────────────────
COPY handler.py .

# ── RunPod entrypoint ─────────────────────────────────────────────────────────
CMD ["python", "-u", "handler.py"]
