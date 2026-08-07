---
title: HakaseBio
emoji: 🧬
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# HakaseBio

Hakase BioTwin — AI-powered drug discovery platform.

## Structure

- **hakase-bio-backend/** — Python (FastAPI) AI/ML service + Node.js (Express) API gateway
- **hakase-invitro-workspace/** — React (Vite) frontend for the in-vitro workspace

## Quick Start (Replit)

1. Click **Run** — the `start.sh` script installs dependencies and boots all three services.
2. Copy `.env.example` to `.env` inside `hakase-bio-backend/` and fill in your API keys.

## Quick Start (Local)

```bash
# Backend
cd hakase-bio-backend
cp .env.example .env   # fill in secrets
pnpm install
python3 -m venv .venv && source .venv/bin/activate
uv sync   # or: pip install -e .
pnpm run backend

# Frontend (separate terminal)
cd hakase-invitro-workspace
pnpm install
pnpm run dev
```

## Services

| Service       | Port  | Description                              |
|---------------|-------|------------------------------------------|
| Frontend      | 4176  | Vite React app (in-vitro workspace)      |
| API Gateway   | 3000  | Express API server (auth, routes, proxy) |
| AI Service    | 8090  | FastAPI ML prediction service            |

## Environment Variables

See `hakase-bio-backend/.env.example` for the full reference. Key variables:

- `PORT` — Express API server port (default: 3000)
- `AI_SERVICE_PORT` — FastAPI AI service port (default: 8090)
- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` — For bio-chat and report generation
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — Auth secrets
