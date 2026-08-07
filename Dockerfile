# syntax=docker/dockerfile:1.7
# ───────────────────────────────────────────────────────────────────────────
# HakaseBio — Full-stack Docker image (Frontend + Backend)
# Designed for Hugging Face Spaces (Docker SDK) and any Docker host.
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend_build
WORKDIR /frontend
COPY hakase-invitro-workspace/package.json ./
RUN npm install
COPY hakase-invitro-workspace/ ./
RUN npm run build

# ── Stage 2: Backend Node.js dependencies ──────────────────────────────────
FROM node:20-bookworm AS backend_deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY hakase-bio-backend/package.json hakase-bio-backend/pnpm-workspace.yaml ./
COPY hakase-bio-backend/deploy/package.json ./deploy/
COPY hakase-bio-backend/platform/ ./platform/
COPY hakase-bio-backend/modalities/ ./modalities/
COPY hakase-bio-backend/service/ ./service/
COPY hakase-bio-backend/scripts/ ./scripts/
RUN pnpm install --frozen-lockfile=false --prefer-offline 2>/dev/null || pnpm install --no-frozen-lockfile

# ── Stage 3: Python dependencies ───────────────────────────────────────────
FROM python:3.11-slim-bookworm AS python_deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --upgrade pip setuptools wheel

COPY hakase-bio-backend/pyproject.toml ./
COPY hakase-bio-backend/platform/kernel/ ./platform/kernel/
COPY hakase-bio-backend/platform/chemistry/ ./platform/chemistry/
COPY hakase-bio-backend/platform/sequence/ ./platform/sequence/
COPY hakase-bio-backend/platform/structure/ ./platform/structure/
COPY hakase-bio-backend/modalities/small-molecule/engine/ ./modalities/small-molecule/engine/
COPY hakase-bio-backend/modalities/peptide/engine/ ./modalities/peptide/engine/
COPY hakase-bio-backend/modalities/antibody/engine/ ./modalities/antibody/engine/
COPY hakase-bio-backend/service/ ./service/

RUN pip install torch --index-url https://download.pytorch.org/whl/cpu 2>/dev/null || true
RUN pip install -e . 2>/dev/null || \
    pip install fastapi uvicorn numpy pandas pyarrow scikit-learn requests \
                docstring-parser typed-argument-parser xgboost lightgbm 2>/dev/null || true

# ── Stage 4: Runtime ──────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 appuser

WORKDIR /app

# Copy Python venv
COPY --from=python_deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

# Copy backend (Node + Python source)
COPY --from=backend_deps /app /app
COPY hakase-bio-backend/pyproject.toml /app/
COPY hakase-bio-backend/.env.example /app/
COPY hakase-bio-backend/data/ /app/data/
COPY hakase-bio-backend/assets/ /app/assets/
COPY hakase-bio-backend/deploy/ /app/deploy/

# Symlink venv so orchestrator/scripts find it
RUN ln -sfn /opt/venv /app/.venv

# Copy built frontend — served as static files
COPY --from=frontend_build /frontend/dist /app/frontend-dist

# Copy the startup script
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

# Environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    AI_SERVICE_PORT=8090 \
    AI_SERVICE_URL=http://localhost:8090 \
    REPO_ROOT=/app \
    HAKASE_SKIP_PREWARM=0 \
    STRICT_ML=0 \
    HAKASE_ERSILIA_MODE=off

# HF Spaces exposes port 7860 by default; we remap in docker-start.sh
EXPOSE 7860

RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/api/health || exit 1

CMD ["/app/docker-start.sh"]
