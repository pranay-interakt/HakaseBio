# Hakase BioTwin — Backend deploy unit

This directory packages the **backend** (Express API server + FastAPI AI
service) as a self-contained, production-grade deploy unit. It does **not**
fork the source — both processes still live under `artifacts/api-server/`
and `artifacts/ai-service/` so the monorepo's shared `lib/` packages
remain a single source of truth. What this directory adds is everything
needed to **run** the backend in production on its own server.

## Layout

```
backend/
  .env.example                # copy → .env on the deploy host
  package.json                # deploy-time scripts (pnpm start, pm2:*, deploy)
  scripts/
    install.mjs               # pnpm install + Python venv + AI deps
    build.mjs                 # api-server esbuild bundle
    start.mjs                 # single foreground entry (used by systemd / PM2 / Docker)
    preflight.mjs             # env + tool check, exits non-zero if not deployable
    healthcheck.mjs           # polls /api/health
  config/
    ecosystem.config.cjs      # PM2 (zero-downtime reloads)
  systemd/
    hakase-backend.service    # systemd unit (ExecReload = SIGHUP)
  docker/
    Dockerfile                # node20 + python3.11 multi-stage
    docker-compose.yml
  nginx/
    hakase-backend.conf       # SSE-friendly reverse proxy
  ops/
    deploy.sh                 # full deploy (pull → install → build → reload → health)
    reload.sh                 # zero-downtime reload (pm2/systemd/docker)
    post-merge-hook.sh        # git post-merge hook for auto-reload on pull
    github-actions.yml        # reference CI/CD pipeline
```

## One-command start (orchestrator — recommended)

A single command boots **everything** the backend needs (Express API server
on `:3000` + FastAPI AI service on `:8090` with all ML heads — ADMET-AI,
CardioTox, DILI, Solubility, Binding, Protein-ML, Celltype, Patient-line +
RunPod dispatchers for Boltz-2 and TIES/FEP):

```bash
# from repo root
pnpm backend                 # production foreground
pnpm backend:dev             # development + filesystem watcher
pnpm backend:reload          # zero-downtime reload

# or directly
node backend/scripts/orchestrator.mjs
```

What the orchestrator does automatically:

| Concern | Behaviour |
| --- | --- |
| Boot order | Spawns FastAPI first, then Express, then health-checks both `/health`, `/api/health`. |
| Warmup | POSTs `/models/warmup` so the first user request isn't a cold-start. |
| Git pull (CI/CD) | Polls `git rev-parse HEAD` every 10 s; when HEAD changes (e.g. post-merge hook just ran `git pull`), reinstalls deps and **SIGHUP-reloads** both children with zero downtime — SSE/bio-chat clients survive. |
| File-sync deploys | When `WATCH_SOURCE=true` (default in dev), watches `artifacts/api-server/src`, `artifacts/ai-service`, and `lib/` and reloads on change with a 1.5 s debounce. |
| Crash recovery | Exponential back-off (500 ms → 30 s, 5 retries) per child. |
| Anthropic / RunPod | Live keys → live calls. `DUMMY` keys → bypass surface returns deterministic placeholder so Layer 1 → IVIVE flow still works. |

## Hosting under PM2

```bash
# one-time
cp backend/.env.example backend/.env
$EDITOR backend/.env
node backend/scripts/preflight.mjs
node backend/scripts/install.mjs
pnpm --prefix backend pm2:start    # starts the orchestrator (single process)
pnpm --prefix backend pm2:save
pm2 startup                         # one-time, follow the printed instructions

# every deploy (also called by CI/CD and post-merge hook)
bash backend/ops/deploy.sh
```

## Hosting via systemd

```bash
sudo cp backend/systemd/hakase-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hakase-backend
# zero-downtime after git pull:
sudo systemctl reload hakase-backend
```

## Hosting via Docker

```bash
docker compose -f backend/docker/docker-compose.yml up -d --build
```

## CI/CD auto-reload on pull

The `ops/post-merge-hook.sh` is the canonical reload entry. Either:

1. **Git hook** (the deploy host pulls):
   ```bash
   ln -sf ../../backend/ops/post-merge-hook.sh .git/hooks/post-merge
   chmod +x .git/hooks/post-merge
   ```
2. **CI pipeline** (push-based): see `ops/github-actions.yml` — it SSHes to the
   server and runs `backend/ops/deploy.sh`. The deploy script does NOT restart
   the service; it `pm2 reload`s / `systemctl reload`s, so connected SSE
   clients (bio-chat) stay alive.

## Env keys

`.env.example` is the source of truth. Highlights:

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Real key → Claude analysis runs live. `DUMMY` or blank → bypass returns canned narrative. |
| `ANTHROPIC_BYPASS` | `auto`/`force`/`off` — force the bypass branch even with a real key. |
| `RUNPOD_API_KEY` + `RUNPOD_*_ENDPOINT_ID` | Real keys → Layer-2 GPU jobs dispatch to RunPod. `DUMMY` → schema-compatible bypass for every modality so the UI flow Layer 1 → IVIVE works end-to-end without a GPU. |
| `RUNPOD_BYPASS` | `auto`/`force`/`off` |
| `GPU_PROVIDER` | `local`/`runpod`/`aws`/`azure` |
| `FRONTEND_ORIGIN` | CORS allow-list for the frontend's public URL. |

## Healthcheck

```bash
node backend/scripts/healthcheck.mjs   # exits 0 when /api/health responds
```
