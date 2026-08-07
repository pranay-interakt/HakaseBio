# Hakase Bio Backend — setup & run (no Docker)

Two services boot together under one supervisor:

- **api-server** — Node/Express API + auth (default port `3000`)
- **ai-service** — Python/FastAPI ML service: ADMET, binding, properties (default port `8090`)

`pnpm run backend` starts and supervises both with one command.

---

## 1. Prerequisites (install once per machine)

| Tool           | Version | Install |
| -------------- | ------- | ------- |
| Node           | 20+     | https://nodejs.org or `nvm install 20` |
| pnpm           | 9+      | `npm install -g pnpm` |
| Python         | 3.11–3.13 | https://python.org (or via `uv python install`) |
| uv             | latest  | `curl -LsSf https://astral.sh/uv/install.sh \| sh` (Win: `irm https://astral.sh/uv/install.ps1 \| iex`) |
| PostgreSQL     | 14+     | local install or a managed DB (Neon, RDS, Supabase…) |

**OS notes**

- **Linux / macOS** — fully supported, recommended.
- **Windows** — the Node API runs natively, but the Python ML stack (torch, RDKit, ANARCI/HMMER) is much smoother under **WSL (Ubuntu)**. Develop the ML service inside WSL.

**Native system libraries** the ML service needs (pip/uv can't install these):

- Linux (Debian/Ubuntu): `sudo bash deploy/scripts/install-system-deps.sh`
- macOS: `brew install open-babel hmmer`

---

## 2. One-time project setup

```bash
cd Hakase-Bio-Backend

# 2a. Environment file — copy the template, then fill in secrets
cp .env.example .env
#   Required to boot:    PORT, AI_SERVICE_PORT, DATABASE_URL
#   Generate each secret: openssl rand -base64 48
#     JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, CSRF_SECRET
#   Optional (graceful bypass if absent): ANTHROPIC_API_KEY, RUNPOD_API_KEY, RESEND_API_KEY

# 2b. Install everything (JS workspace + Python venv with full ML deps)
pnpm run setup

# 2c. Create the database schema (uses DATABASE_URL)
pnpm run db:push

# 2d. Sanity-check the environment
pnpm run preflight
```

`pnpm run setup` is idempotent — safe to re-run on every deploy. It installs JS
deps with pnpm, then Python deps with **uv** (reproducible, CPU-only torch on
Linux) or falls back to `venv` + `pip` if uv isn't installed.

---

## 3. Run it

### Development

```bash
pnpm run backend         # supervises api-server + ai-service, with health checks
# or, granular:
pnpm run api-server      # Node API only
pnpm run ai-service      # Python AI service only (uses the .venv interpreter)
```

API → http://localhost:3000  ·  AI service → http://localhost:8090
Health check: `curl http://localhost:3000/api/health`

### Production on a Linux server with PM2 (no Docker)

```bash
npm install -g pm2

pm2 start ecosystem.config.js --env production   # boots the supervised stack
pm2 save                                         # persist the process list
pm2 startup                                       # run on boot (follow printed cmd)

pm2 status        # see processes
pm2 logs          # tail logs
pm2 reload ecosystem.config.js   # zero-downtime reload after a git pull
```

Put nginx in front to terminate TLS and proxy `:3000`. A sample server block is
in `deploy/nginx/`; sample systemd units (an alternative to PM2) are in
`deploy/systemd/`.

---

## 4. Third-party / external services

| Capability            | Env var             | If unset |
| --------------------- | ------------------- | -------- |
| Claude analysis       | `ANTHROPIC_API_KEY` | bypassed (deterministic stub) |
| Layer-2 GPU jobs      | `RUNPOD_API_KEY`    | bypassed |
| Transactional email   | `RESEND_API_KEY`    | logged instead of sent |
| ADMET / binding ML    | *(local)*           | the models are **vendored in-repo** (`modalities/small-molecule/engine/src/hakase_smallmol/vendor/hakase_admet/`, `var/cache/`) — no external API. Set `STRICT_ML=1` to make the service refuse to start if the ML engine can't load (recommended in production so you never silently fall back to heuristics). |

---

## 5. Troubleshooting

- **`pnpm` rejected with “use pnpm”** — you ran `npm`/`yarn`. Use `pnpm install`.
- **`uv: command not found`** — install uv (table above) or let setup fall back to pip.
- **ML service starts but predictions look like heuristics** — a heavy dep failed to install. Run `pnpm run setup` again on Linux/macOS and check the log; set `STRICT_ML=1` to fail loudly instead.
- **DB errors on boot** — confirm `DATABASE_URL` is reachable and run `pnpm run db:push`.
- **Frontend served by this API?** Not by default (frontend is its own repo). To serve a built SPA from this server, set `FRONTEND_DIST_PATH=/path/to/hakase-ai/dist`.
