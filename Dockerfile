# HakaseBio — Full-stack image (HF Pro: 8 vCPU, 32GB RAM)
# Frontend (static) + Express API gateway + FastAPI AI/ML service

# ── Build frontend ─────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app
COPY hakase-invitro-workspace/package.json hakase-invitro-workspace/tsconfig.json ./
RUN npm install
COPY hakase-invitro-workspace/index.html ./
COPY hakase-invitro-workspace/vite.config.ts ./
COPY hakase-invitro-workspace/src/ ./src/
RUN npx vite build

# ── Runtime ────────────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates build-essential pkg-config \
      libxrender1 libxext6 libx11-6 libsm6 libice6 \
      libfreetype6 libpng16-16 libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Backend Node deps ──────────────────────────────────────────────────────
COPY hakase-bio-backend/package.json hakase-bio-backend/pnpm-workspace.yaml ./
COPY hakase-bio-backend/tsconfig.base.json hakase-bio-backend/tsconfig.json ./
COPY hakase-bio-backend/deploy/ ./deploy/
COPY hakase-bio-backend/platform/ ./platform/
COPY hakase-bio-backend/modalities/ ./modalities/
COPY hakase-bio-backend/service/ ./service/
COPY hakase-bio-backend/scripts/ ./scripts/
RUN pnpm install --no-frozen-lockfile 2>&1 || true

# ── Python deps ────────────────────────────────────────────────────────────
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --upgrade pip setuptools wheel

RUN pip install fastapi uvicorn numpy pandas pyarrow scikit-learn requests \
               docstring-parser typed-argument-parser pydantic xgboost lightgbm \
               rdkit-pypi matplotlib scipy httpx tqdm seaborn

# Install workspace Python packages
RUN pip install -e /app/platform/kernel 2>&1 || true && \
    pip install -e /app/platform/chemistry 2>&1 || true && \
    pip install -e /app/platform/sequence 2>&1 || true && \
    pip install -e /app/platform/structure 2>&1 || true && \
    pip install -e /app/modalities/small-molecule/engine 2>&1 || true && \
    pip install -e /app/modalities/peptide/engine 2>&1 || true && \
    pip install -e /app/modalities/antibody/engine 2>&1 || true && \
    pip install -e /app/service 2>&1 || true

# PyTorch CPU — large but fits in Pro tier build
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu 2>&1 || true
RUN pip install lightning transformers chemprop 2>&1 || true

# ── Data & assets ──────────────────────────────────────────────────────────
COPY hakase-bio-backend/data/ /app/data/
COPY hakase-bio-backend/assets/ /app/assets/
COPY hakase-bio-backend/.env.example /app/

# ── Frontend dist + server ─────────────────────────────────────────────────
COPY --from=frontend /app/dist /app/frontend-dist
COPY server.js /app/server.js
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

ENV NODE_ENV=production \
    PORT=3000 \
    AI_SERVICE_PORT=8090 \
    AI_SERVICE_URL=http://localhost:8090 \
    REPO_ROOT=/app \
    PYTHONUNBUFFERED=1 \
    HAKASE_SKIP_PREWARM=1 \
    STRICT_ML=0 \
    HAKASE_ERSILIA_MODE=off \
    TRUST_PROXY=true \
    FRONTEND_DIST_PATH=/app/frontend-dist

EXPOSE 7860

CMD ["/app/docker-start.sh"]
