FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    MAMBA_ROOT_PREFIX=/opt/conda \
    PATH=/opt/conda/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        bzip2 \
        git \
        wget \
        tar \
    && rm -rf /var/lib/apt/lists/*

# --- micromamba (small, fast conda) ---------------------------------------
RUN curl -L https://micro.mamba.pm/api/micromamba/linux-64/latest \
      | tar -xj -C /usr/local/bin --strip-components=1 bin/micromamba

# --- conda env: chemistry stack -------------------------------------------
COPY environment.yml /tmp/environment.yml
RUN micromamba create -y -n fep -f /tmp/environment.yml \
    && micromamba clean -ay \
    && rm /tmp/environment.yml

ENV PATH=/opt/conda/envs/fep/bin:$PATH \
    CONDA_DEFAULT_ENV=fep

# --- pip-only deps (RunPod SDK + TIES-MD) ---------------------------------
COPY requirements.txt /tmp/requirements.txt
RUN /opt/conda/envs/fep/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# --- worker code ----------------------------------------------------------
WORKDIR /app
COPY handler.py ties_runner.py dock_runner.py ./

# Verify the chemistry stack actually imports at build time so we fail fast
# instead of at first job. Per project policy we never silently fall back.
RUN /opt/conda/envs/fep/bin/python -c "\
import openmm, openff.toolkit, openmmforcefields, pdbfixer, rdkit, MDAnalysis, ties_md, runpod;\
print('openmm', openmm.__version__);\
print('openff-toolkit', openff.toolkit.__version__);\
print('rdkit', rdkit.__version__);\
print('ties_md', getattr(ties_md, '__version__', 'unknown'));\
print('runpod', runpod.__version__);"

# RunPod serverless entry point. The runpod SDK reads handler.py:handler.
CMD ["python", "-u", "handler.py"]
