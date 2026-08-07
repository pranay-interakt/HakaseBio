# ───────────────────────────────────────────────────────────────────────────
# HakaseBio — Lightweight Docker image for Hugging Face Spaces (free tier)
# Frontend (static) + API Gateway (Express) + AI Service (FastAPI, light deps)
# Heavy ML deps (torch, rdkit) installed best-effort; predictions degrade
# gracefully if they're missing.
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      curl ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 appuser
WORKDIR /app

# ── Frontend build ─────────────────────────────────────────────────────────
COPY hakase-invitro-workspace/package.json /tmp/frontend/
RUN cd /tmp/frontend && npm install
COPY hakase-invitro-workspace/ /tmp/frontend/
RUN cd /tmp/frontend && npm run build && mv dist /app/frontend-dist && rm -rf /tmp/frontend

# ── Backend Node.js deps ──────────────────────────────────────────────────
RUN npm install -g pnpm
COPY hakase-bio-backend/package.json hakase-bio-backend/pnpm-workspace.yaml ./
COPY hakase-bio-backend/deploy/ ./deploy/
COPY hakase-bio-backend/platform/ ./platform/
COPY hakase-bio-backend/modalities/ ./modalities/
COPY hakase-bio-backend/service/ ./service/
COPY hakase-bio-backend/scripts/ ./scripts/
COPY hakase-bio-backend/tsconfig.base.json hakase-bio-backend/tsconfig.json ./
RUN pnpm install --no-frozen-lockfile 2>&1 || true

# ── Python deps (light) ──────────────────────────────────────────────────
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --upgrade pip setuptools wheel

COPY hakase-bio-backend/pyproject.toml /tmp/pyproject.toml
RUN pip install fastapi uvicorn numpy pandas pyarrow scikit-learn requests \
               docstring-parser typed-argument-parser pydantic 2>&1 || true

# Install workspace Python packages as editable (kernel, chemistry, etc.)
RUN pip install -e /app/platform/kernel 2>&1 || true && \
    pip install -e /app/platform/chemistry 2>&1 || true && \
    pip install -e /app/platform/sequence 2>&1 || true && \
    pip install -e /app/platform/structure 2>&1 || true && \
    pip install -e /app/modalities/small-molecule/engine 2>&1 || true && \
    pip install -e /app/modalities/peptide/engine 2>&1 || true && \
    pip install -e /app/modalities/antibody/engine 2>&1 || true && \
    pip install -e /app/service 2>&1 || true

# Heavy ML deps — best effort, app degrades gracefully without them
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu 2>&1 || true
RUN pip install xgboost lightgbm 2>&1 || true

# ── Data & config ────────────────────────────────────────────────────────
COPY hakase-bio-backend/data/ /app/data/
COPY hakase-bio-backend/assets/ /app/assets/
COPY hakase-bio-backend/.env.example /app/

# ── Startup ──────────────────────────────────────────────────────────────
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
    HAKASE_ERSILIA_MODE=off

EXPOSE 7860

RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/health || curl -fsS http://127.0.0.1:7860/api/health || exit 1

CMD ["/app/docker-start.sh"]
