/**
 * PM2 ecosystem for the BACKEND deploy unit.
 *
 *   pm2 start  backend/config/ecosystem.config.cjs --env production
 *   pm2 reload backend/config/ecosystem.config.cjs --update-env   # zero-downtime
 *   pm2 stop   backend/config/ecosystem.config.cjs
 *
 * Two apps share the env from backend/.env:
 *   - hakase-api-server (Node/Express)
 *   - hakase-ai-service (Python/FastAPI via venv interpreter)
 *
 * Both reload via SIGHUP on `pm2 reload` so deploy.sh / post-merge hook
 * can refresh code with zero downtime.
 */
const path = require("node:path");
const fs = require("node:fs");

const BACKEND_DIR = __dirname.replace(/\/config$/, "");
const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(BACKEND_DIR, "..");
const isWin = process.platform === "win32";

// Load backend/.env into the PM2 env block
function loadDotenv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("="); if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    const h = v.indexOf("#"); if (h >= 0) v = v.slice(0, h).trim();
    v = v.replace(/^["']|["']$/g, "");
    out[k] = v;
  }
  return out;
}
const envFile = { ...loadDotenv(path.resolve(REPO_ROOT, ".env")),
                  ...loadDotenv(path.resolve(BACKEND_DIR, ".env")) };

const PYTHON = isWin
  ? path.resolve(REPO_ROOT, ".venv", "Scripts", "python.exe")
  : path.resolve(REPO_ROOT, ".venv", "bin", "python");

/*
 * NOTE: The single-process orchestrator (`backend/scripts/orchestrator.mjs`)
 * is the RECOMMENDED entry — it boots and supervises both children, watches
 * for git pulls and source changes, and reloads via SIGHUP without losing
 * connected SSE clients.
 *
 *   pm2 start backend/config/ecosystem.config.cjs --only hakase-backend --env production
 *   pm2 reload hakase-backend --update-env
 *
 * The two legacy apps (hakase-api-server, hakase-ai-service) are retained as
 * fallback so PM2 users can run children directly if they prefer.
 */
module.exports = {
  apps: [
    {
      name: "hakase-backend",
      cwd: REPO_ROOT,
      script: path.resolve(BACKEND_DIR, "scripts", "orchestrator.mjs"),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "6G",
      autorestart: true,
      watch: false,
      env: { ...envFile, NODE_ENV: "production", PORT: envFile.PORT ?? "3000",
             AI_SERVICE_PORT: envFile.AI_SERVICE_PORT ?? "8090",
             AUTO_RELOAD_ON_PULL: envFile.AUTO_RELOAD_ON_PULL ?? "true",
             WATCH_SOURCE: "false",  // PM2 controls reload; orchestrator polls git
             WARMUP_ON_BOOT: "true" },
      env_production: { ...envFile, NODE_ENV: "production" },
      out_file: path.resolve(REPO_ROOT, ".logs", "orchestrator.out.log"),
      error_file: path.resolve(REPO_ROOT, ".logs", "orchestrator.err.log"),
      merge_logs: true,
      time: true,
      kill_timeout: 12000,
      listen_timeout: 60000,
      shutdown_with_message: true,
    },
    {
      name: "hakase-api-server",
      cwd: path.resolve(REPO_ROOT, "artifacts", "api-server"),
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      autorestart: true,
      watch: false,
      env: { ...envFile, NODE_ENV: "production", PORT: envFile.PORT ?? "3000" },
      env_production: { ...envFile, NODE_ENV: "production" },
      out_file: path.resolve(BACKEND_DIR, "..", ".logs", "api-server.out.log"),
      error_file: path.resolve(BACKEND_DIR, "..", ".logs", "api-server.err.log"),
      merge_logs: true,
      time: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      // SIGHUP reload from post-merge hook → graceful in-place reload
      shutdown_with_message: true,
    },
    {
      name: "hakase-ai-service",
      cwd: path.resolve(REPO_ROOT, "artifacts", "ai-service"),
      script: PYTHON,
      args: "main.py",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "4G",
      autorestart: true,
      watch: false,
      env: {
        ...envFile,
        AI_SERVICE_PORT: envFile.AI_SERVICE_PORT ?? "8090",
        PYTHONUNBUFFERED: "1",
      },
      env_production: { ...envFile, PYTHONUNBUFFERED: "1" },
      out_file: path.resolve(BACKEND_DIR, "..", ".logs", "ai-service.out.log"),
      error_file: path.resolve(BACKEND_DIR, "..", ".logs", "ai-service.err.log"),
      merge_logs: true,
      time: true,
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};
