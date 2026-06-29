/**
 * Canonical PM2 entry point for the Hakase BioTwin FRONTEND.
 *
 * PM2 discovers `ecosystem.config.js` at the repo root by default:
 *
 *   pm2 start  ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --update-env      # zero-downtime
 *   pm2 stop   ecosystem.config.js
 *   pm2 logs
 *   pm2 status
 *
 * The app definition, env loading (from .env) and process tuning live in the
 * maintained config under frontend/config/ — this file re-exports it so there
 * is a single source of truth and the existing ops scripts keep working.
 *
 * App managed (see frontend/config/ecosystem.config.cjs):
 *   - hakase-frontend   Vite preview server for the built React app
 *
 * On hosts that serve the static build via nginx, this PM2 unit is optional —
 * point nginx at artifacts/hakase-ai/dist/public directly.
 *
 * No environment-specific values are hardcoded here; everything is read from
 * the repo-root .env at load time. NEVER commit .env.
 */
module.exports = require("./frontend/config/ecosystem.config.cjs");
