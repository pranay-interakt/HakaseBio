# Hakase BioTwin — Backend

Backend deploy unit for the **Hakase BioTwin** preclinical digital-twin platform. This
repository contains the API gateway and the AI/ML inference service. The web UI lives
in a separate repository: **[hakase-bio-frontend](https://github.com/Hakase-ai/hakase-bio-frontend)**.

> Process management is **PM2-based** (no Docker required). All configuration is read
> from a local `.env` file — nothing environment-specific is hardcoded, and `.env` is
> never committed.

---

## Architecture

```mermaid
graph TD
    A[React Client / Vite  ·  separate repo] -- /api/* --> B[Express API Gateway · :3000]
    B -- /api/ai/* --> C[Python AI/ML Service · :8090]
    C --> D[(Morgan FP / Chemprop GNN)]
    C --> E[RDKit Physchem Engine]
    B --> F[(PostgreSQL · users, sessions, audit)]
```

### Repository layout

The backend is **two tiers**: `platform/` is modality-agnostic, `modalities/` holds
the therapeutic verticals. One rule keeps the split real, enforced by
`scripts/check_boundaries.py` in CI:

> **Nothing under `platform/` may import from `modalities/`, and no modality may
> import another.**

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the reasoning and
**[CONTRIBUTING.md](CONTRIBUTING.md)** for how to add a modality.

| Path | Purpose | Stack |
| --- | --- | --- |
| `platform/gateway` | **API gateway & auth** | Express 5, TypeScript, Drizzle ORM, JWT + CSRF + rate limiting |
| `platform/datasources` | **Open-data proxies** | ChEMBL · PubChem · UniProt · RCSB · AlphaFold · OpenTargets · CompTox · FDA PSG |
| `platform/narrative` | **LLM report generation** | Claude client; per-modality prompts are modality-owned |
| `platform/db` · `integrations` · `contract` | Schema · Anthropic SDK · OpenAPI + Zod | TypeScript |
| `platform/kernel` | **Modality-agnostic science** | decision (MCDC/DSM) · uncertainty (conformal) · translational · runtime |
| `platform/chemistry` · `sequence` · `structure` | **Shared substrates** | SMILES/RDKit · amino acids/ESM · 3D/co-folding/docking |
| `modalities/small-molecule` | ADMET, tox, PK, binding | FastAPI, Chemprop GNN (ADMET-AI), RDKit, scikit-learn |
| `modalities/peptide` | Physicochemistry, developability, structure | FastAPI, ESM-2, Boltz-2 |
| `modalities/antibody` | CDR numbering, developability | FastAPI, ANARCI |
| `modalities/_template` | Scaffold for oligonucleotide · PROTAC · ADC | — |
| `service/` | **FastAPI composition root** | Mounts every modality router |
| `deploy/` | **Orchestrator, PM2, nginx, systemd** | Boots and supervises both processes |

The API gateway implements a production-grade security suite: double-submit CSRF
(`csrf-csrf`), sliding-session JWTs (in-memory access token + signed HTTP-only refresh
cookie), account lockout on repeated failures, new-device notification emails, and
CIDR-based IP allow/block lists.

Despite the package count this still runs as **exactly two processes** — modalities
are libraries mounted into the gateway and the engine, not separate services.

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 10 (workspace package manager — do **not** use `npm`/`yarn`)
- **Python** ≥ 3.11 with **uv**
- **PostgreSQL** (local or remote)
- **PM2** (`pnpm add -g pm2`) — for production process management
- **Git & Git LFS** — model weights / large datasets are stored via LFS

```bash
git lfs install && git lfs pull
```

---

## 1 · Configure environment

All settings come from `.env` at the repo root. Copy the template and fill it in:

```bash
cp .env.example .env
```

Minimum required values (see `.env.example` for the full, documented list):

```env
PORT=3000                  # Express API gateway
AI_SERVICE_PORT=8090       # FastAPI AI service
AI_SERVICE_URL=http://localhost:8090
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/hakase_bio

# Generate each with: openssl rand -base64 48
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
COOKIE_SECRET=...
CSRF_SECRET=...

RESEND_API_KEY=re_...       # email verify + password reset
```

> **Never commit `.env`.** It is git-ignored. The server fails loudly if a required
> variable is missing. In development, rate limits are auto-relaxed and verification
> links are printed to the console instead of emailed.

---

## 2 · Install dependencies

```bash
pnpm install                # Node workspace
uv venv .venv && uv sync    # Python virtual env (.venv)
```

---

## 3 · Database setup

```bash
createdb hakase_bio                       # or: psql -c "CREATE DATABASE hakase_bio;"
pnpm --filter @workspace/db run push      # apply Drizzle schema
pnpm typecheck:libs                       # compile TS declarations for lib packages
```

Optional dev shortcut to verify + promote a user to admin:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET status='active', role='admin', email_verified_at=NOW() WHERE email='you@example.com';"
```

---

## 4 · Run in development

The orchestrator boots **both** the API gateway and the AI service with model warm-up
and hot-reload:

```bash
PATH=".venv/bin:$PATH" pnpm run backend:dev
```

- Express API gateway → `http://localhost:3000`
- FastAPI AI/ML service → `http://localhost:8090`

Run the **frontend** from its own repository
([hakase-bio-frontend](https://github.com/Hakase-ai/hakase-bio-frontend)); its Vite dev
server proxies `/api/*` to this gateway.

---

## 5 · Run in production (PM2)

Process management is handled entirely by PM2 using the root `ecosystem.config.js`:

```bash
pnpm install && pnpm run build                    # verify the build first
PATH=".venv/bin:$PATH" pm2 start ecosystem.config.js --env production
pm2 save                                           # persist across reboots
pm2 startup                                         # (once) generate boot script
```

Common operations:

```bash
pm2 reload ecosystem.config.js --update-env   # zero-downtime reload
pm2 stop   ecosystem.config.js
pm2 logs                                       # tail logs
pm2 status                                     # process table
```

PM2 manages three apps (defined in `deploy/config/ecosystem.config.cjs`):

- `hakase-backend` — the orchestrator (**recommended**; supervises both children)
- `hakase-api-server` — Express gateway, for granular control
- `hakase-ai-service` — FastAPI service, for granular control

To run the children directly instead of the orchestrator:

```bash
pm2 start ecosystem.config.js --only hakase-api-server,hakase-ai-service --env production
```

All PM2 env values are loaded from `.env` at start time — no secrets live in the config.

---

## 6 · Build & verify

Always confirm a clean build before pushing:

```bash
pnpm run build      # runs typecheck across the workspace, then per-package builds
```

Health checks:

```bash
curl -s http://localhost:8090/health      # AI service  → {"status":"ok",...}
curl -s http://localhost:3000/api/health  # API gateway → {"status":"ok"}
```

---

## Deployment workflow

- Push application changes to the **`staging`** branch only — never directly to
  `main`/`master` or any production branch.
- Verify `pnpm run build` succeeds before pushing.
- `.env`, secrets, API keys, and compiled artifacts (`__pycache__`, `*.pyc`, `dist/`)
  are git-ignored and must never be committed.
- The test/staging server pulls `staging`; the orchestrator (or `pm2 reload`) performs a
  zero-downtime reload via the post-merge hook in `deploy/ops/`.

---

## Repository layout

```
.
├── ARCHITECTURE.md                  # the two-tier model and why
├── CONTRIBUTING.md                  # how to add a modality
├── ecosystem.config.js              # root PM2 entry (re-exports deploy/config)
│
├── platform/                        # MODALITY-AGNOSTIC — may never import modalities/
│   ├── gateway/                     # Express API gateway + auth + modality mounting
│   ├── datasources/                 # third-party scientific DB proxies
│   ├── narrative/                   # LLM plumbing (prompts are modality-owned)
│   ├── db/ · integrations/ · contract/
│   ├── kernel/                      # decision · uncertainty · translational · runtime
│   ├── chemistry/                   # SUBSTRATE — SMILES / RDKit
│   ├── sequence/                    # SUBSTRATE — amino acids / ESM
│   └── structure/                   # SUBSTRATE — 3D, co-folding, docking (+ boltz worker)
│
├── modalities/                      # THE VERTICALS
│   ├── small-molecule/              # engine · gateway · contract · validation · data · workers
│   ├── peptide/                     # engine · gateway · contract · docs
│   ├── antibody/                    # engine · gateway · contract · narrative
│   └── _template/                   # scaffold for oligonucleotide · PROTAC · ADC
│
├── service/                         # FastAPI composition root — mounts each modality
│
├── deploy/                          # ops/infra only — NOT application code
│   ├── scripts/orchestrator.mjs     # single-command supervisor
│   ├── config/ecosystem.config.cjs  # PM2 app definitions
│   ├── ops/                         # deploy.sh, reload.sh, post-merge hook
│   ├── docker/                      # Dockerfile + docker-compose
│   └── nginx/ · systemd/            # sample host configs
│
├── assets/calibration/              # tracked, versioned build artifacts
├── var/cache/                       # regenerable runtime artifacts (git-ignored)
├── scripts/check_boundaries.py      # enforces the import rule
├── .env.example                     # documented env reference (copy to .env)
├── pyproject.toml                   # uv workspace root (Python members)
└── pnpm-workspace.yaml              # pnpm workspace (TypeScript members)
```
