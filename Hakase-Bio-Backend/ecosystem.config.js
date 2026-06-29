/**
 * Canonical PM2 entry point for the Hakase BioTwin BACKEND.
 *
 * PM2 discovers `ecosystem.config.js` at the repo root by default, so the
 * whole stack can be managed with the short, standard commands:
 *
 *   pm2 start  ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --update-env      # zero-downtime
 *   pm2 stop   ecosystem.config.js
 *   pm2 logs
 *   pm2 status
 *
 * All app definitions, env loading (from .env) and process tuning live in the
 * maintained config under backend/config/ — this file simply re-exports it so
 * there is a single source of truth and the existing ops scripts
 * (ops/deploy.sh, ops/reload.sh, post-merge hooks) keep working unchanged.
 *
 * Apps managed (see backend/config/ecosystem.config.cjs):
 *   - hakase-backend     single-command orchestrator (RECOMMENDED)
 *   - hakase-api-server  Node/Express API gateway      (fallback / granular)
 *   - hakase-ai-service  Python/FastAPI ML service     (fallback / granular)
 *
 * No environment-specific values are hardcoded here; everything is read from
 * the repo-root .env at load time. NEVER commit .env.
 */
module.exports = require("./backend/config/ecosystem.config.cjs");
