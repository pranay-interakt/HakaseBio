# HakaseAI Boltz-2 co-folding worker — RunPod Serverless GPU image.
#
# Boltz-2 is an AlphaFold3-class biomolecular co-folding model released under the
# MIT license, so — unlike AlphaFold 3's own weights — it can be used inside a
# commercial product. This image runs `boltz predict` on the RunPod GPU.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Boltz model weights + CCD cache. Mount a RunPod network volume here so the
    # ~2-3 GB of weights download exactly once and persist across cold starts.
    BOLTZ_CACHE=/runpod-volume/boltz_cache

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        python3.10 \
        python3.10-dev \
        python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python \
    && python -m pip install --upgrade pip setuptools wheel

# --- Python deps: Boltz-2 (+ CUDA kernels) and the RunPod SDK ---------------
COPY requirements.txt /tmp/requirements.txt
RUN python -m pip install -r /tmp/requirements.txt && rm /tmp/requirements.txt

# --- worker code -----------------------------------------------------------
WORKDIR /app
COPY handler.py boltz_runner.py ./

# Fail fast at build time if the stack does not import — per project policy we
# never want to pay for a worker that was broken before the first job. The
# resolved versions printed here are what you MUST pin in requirements.txt.
RUN python -c "\
import boltz, torch, numpy, runpod;\
from importlib.metadata import version;\
print('boltz   ', version('boltz'));\
print('torch   ', torch.__version__);\
print('numpy   ', numpy.__version__);\
print('runpod  ', runpod.__version__);\
print('cuda compiled:', torch.version.cuda)"

# RunPod serverless entry point. The runpod SDK reads handler.py:handler.
CMD ["python", "-u", "handler.py"]
