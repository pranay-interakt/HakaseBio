/**
 * PM2 ecosystem for the FRONTEND deploy unit.
 *
 *   pm2 start frontend/config/ecosystem.config.cjs --env production
 *   pm2 reload frontend/config/ecosystem.config.cjs --update-env
 *
 * One app: vite preview against the built dist/. On production hosts using
 * nginx for static serving, this PM2 unit is optional — point nginx at
 * artifacts/hakase-ai/dist directly.
 */
const path = require("node:path");
const fs = require("node:fs");

const FE_DIR = __dirname.replace(/\/config$/, "");
const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(FE_DIR, "..");

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
                  ...loadDotenv(path.resolve(FE_DIR, ".env")) };

module.exports = {
  apps: [
    {
      name: "hakase-frontend",
      cwd: REPO_ROOT,
      script: "node",
      args: path.resolve(FE_DIR, "scripts", "start.mjs"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: { ...envFile, NODE_ENV: "production", PORT: envFile.PORT ?? "4000" },
      env_production: { ...envFile, NODE_ENV: "production" },
      out_file: path.resolve(REPO_ROOT, ".logs", "frontend.out.log"),
      error_file: path.resolve(REPO_ROOT, ".logs", "frontend.err.log"),
      time: true,
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
