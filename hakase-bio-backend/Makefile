# ==============================================================================
# Makefile — hakase-bio-backend  (ML workflow + ops entry points)
# Recipe lines MUST be indented with a TAB, not spaces.
# Run `make` or `make help` to list all targets.
# ==============================================================================

.DEFAULT_GOAL := help
UV   := uv
PNPM := pnpm

.PHONY: help \
        setup install env \
        typecheck ci verify-ml preflight build \
        serve api backend dev start \
        stop reload logs status \
        db-push clean \
        lint format test

# ── Help ──────────────────────────────────────────────────────────────────
help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ── Setup & dependencies ─────────────────────────────────────────────────────
setup:  ## Full setup: JS workspace + Python venv (ML deps) + .env
	$(PNPM) run setup

install:  ## Install Python deps only, from the lockfile (reproducible)
	$(UV) sync --frozen

env:  ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env — fill in secrets before running")

# ── Quality & verification ───────────────────────────────────────────────────
typecheck:  ## TypeScript typecheck (API gateway + libs)
	$(PNPM) run typecheck

ci:  ## Run the full L1 CI correctness gate
	bash scripts/ci_l1.sh

verify-ml:  ## Verify the ML stack loads (torch/rdkit/chemprop weights)
	$(UV) run python scripts/verify_ml_stack.py

preflight:  ## Pre-startup environment/health checks
	$(PNPM) run preflight

build:  ## Build all workspace packages
	$(PNPM) run build

# ── Run services ─────────────────────────────────────────────────────────────
serve:  ## Run the FastAPI AI/ML service only (:8090)
	$(PNPM) run ai-service

api:  ## Run the Express API gateway only (:3000)
	$(PNPM) run api-server

backend:  ## Run full backend via orchestrator (API + AI service)
	$(PNPM) run backend

dev:  ## Run backend in dev mode (watch + reload)
	$(PNPM) run backend:dev

start:  ## Production start (orchestrator: boot, health-check, warm, serve)
	$(PNPM) run start

# ── Ops (PM2) ────────────────────────────────────────────────────────────────
stop:  ## Stop backend PM2 processes
	$(PNPM) run backend:stop

reload:  ## Zero-downtime reload of the backend
	$(PNPM) run backend:reload

logs:  ## Tail PM2 logs
	$(PNPM) run backend:logs

status:  ## Show PM2 process status
	$(PNPM) run backend:status

# ── Database ─────────────────────────────────────────────────────────────────
db-push:  ## Push Drizzle schema to PostgreSQL
	$(PNPM) run db:push

# ── Housekeeping ─────────────────────────────────────────────────────────────
clean:  ## Remove Python caches and build artifacts
	find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .ruff_cache

# ── Enabled in Day 6 (ruff/black) ────────────────────────────────────────────
lint:  ## Lint Python (ruff) + check formatting (black)
	$(UV) run ruff check platform modalities service scripts
	$(UV) run black --check platform modalities service scripts
#
format:  ## Auto-fix lint + format Python
	$(UV) run ruff check --fix platform modalities service scripts
	$(UV) run black platform modalities service scripts
#
# ── Enabled in Day 7 (pytest tests) ──────────────────────────────────────────
test:  ## Run Python tests
	$(UV) run pytest platform modalities -q
