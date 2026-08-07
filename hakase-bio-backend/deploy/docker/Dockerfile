# syntax=docker/dockerfile:1.7
# ───────────────────────────────────────────────────────────────────
# Hakase BioTwin — Backend (Node 20 + Python 3.11)
# Multi-stage; final image carries only what the runtime needs.
# ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS node_base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── deps ────────────────────────────────────────────────────────────
FROM node_base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY platform/ ./platform/
COPY modalities/ ./modalities/
COPY service/ ./service/
COPY scripts/ ./scripts/
RUN pnpm install --frozen-lockfile=false --prefer-offline

# ── python ──────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS py_base
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates openbabel libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock /tmp/
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip && \
    /opt/venv/bin/pip install -r /tmp/req.txt

# ── runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates openbabel libxrender1 libxext6 \
      build-essential r-base \
      && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
      && apt-get install -y nodejs \
      && npm install -g pnpm pm2 \
      && rm -rf /var/lib/apt/lists/*

# R packages for the L3 Animal Cohort mrgsolve PBPK engine. Installed into
# /root/Rlibs, the path the mrgsolve_adapter reads via R_LIBS_USER. Absence is
# non-fatal — the L3 layer falls back to the in-house kernel PBPK engine.
ENV R_LIBS_USER=/root/Rlibs
RUN mkdir -p /root/Rlibs && \
    Rscript -e "install.packages(c('mrgsolve','jsonlite'), repos='https://cloud.r-project.org', lib='/root/Rlibs')" \
    || echo "R package install failed — L3 will use the kernel PBPK engine."

WORKDIR /app
COPY --from=deps /app /app
COPY --from=py_base /opt/venv /opt/venv
COPY deploy/ /app/deploy/
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=3000 \
    AI_SERVICE_PORT=8090 \
    REPO_ROOT=/app

# venv path used by start.mjs
RUN ln -sfn /opt/venv /app/.venv

EXPOSE 3000 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# Single-process orchestrator boots BOTH Express API and FastAPI AI service
# (with all ML model heads), warms the models, and auto-reloads on git pull.
CMD ["node", "/app/deploy/scripts/orchestrator.mjs"]
