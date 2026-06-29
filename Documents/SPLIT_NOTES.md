# Hakase BioTwin — final layout

Your `Hakase-BioTwin-dev` folder now contains a clean split:

```
Hakase-BioTwin-dev/
├── Hakase-Bio-Backend/     standalone backend project
├── Hakase-Bio-Frontend/    standalone frontend project
├── Documents/              all documentation (you're reading this here)
└── _ORIGINAL-monorepo-backup-SAFE-TO-DELETE/   your full original repo
```

You can drag the three folders out to `Downloads` (each is self-contained) and
then delete the whole `Hakase-BioTwin-dev` folder once you're happy.

## Hakase-Bio-Backend  (281 commits of history)
- `artifacts/api-server` — Node/Express API
- `artifacts/ai-service` — Python/FastAPI AI service
- `lib/db`, `lib/api-zod`, `lib/integrations-anthropic-ai`, `lib/api-spec`
- `workers/`, `runpod_worker/`, `runpod_worker_boltz/` — ML workers
- `backend/` — docker / nginx / systemd / pm2 ops
- `pyproject.toml`, `uv.lock` — Python deps

```bash
cd Hakase-Bio-Backend
pnpm install
uv sync
pnpm run backend     # or: pnpm run api-server / pnpm run ai-service
```

## Hakase-Bio-Frontend  (336 commits of history)
- `artifacts/hakase-ai` — Vite/React app
- `artifacts/mockup-sandbox`
- `lib/api-client-react`, `lib/preclinical-handoff`
- `hakase-website/` — marketing site
- `frontend/` — docker / nginx / systemd / pm2 ops

```bash
cd Hakase-Bio-Frontend
pnpm install
pnpm run frontend    # vite dev server
```

## Documents/
All product PDFs, L1 planning/validation `.md`, sprint `.xlsx`, the technical
evaluation, and reference screenshots — pulled out of the code folders so the
projects stay clean.

## The backup folder
`_ORIGINAL-monorepo-backup-SAFE-TO-DELETE/` is your **complete, untouched
original monorepo**, including its full git history and ALL branches
(`staging`, `master`, `dev`, `experimental`, and `replit-agent` — the last has
392 commits that are not in the split). Delete it from Finder whenever you're
confident in the two new projects. (If you delete it, those non-`staging`
branches are gone — tell me first if you want them carried into the splits.)

## Verified
Both projects were installed and type-checked from their delivered on-disk
copies after the reorg: `pnpm install` ✅ and `pnpm run typecheck` → exit 0 ✅.
No application source was modified — only file organization and workspace config.
