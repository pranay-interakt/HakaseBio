const path = require("node:path");
const fs = require("node:fs");

// Check if we are running in the canonical production path
const PROD_ROOT = "/var/www/html/hakase-bio";
const isProdPath = fs.existsSync(PROD_ROOT);

const REPO_ROOT = isProdPath ? PROD_ROOT : __dirname;

// Dev paths follow the modality restructure: apps/api-server -> platform/gateway,
// apps/ai-service -> service. The prod branch still points at the deploy
// artifacts/ layout, which is produced server-side and is unaffected.
const apiCwd = isProdPath
  ? path.join(PROD_ROOT, "artifacts/api-server")
  : path.join(__dirname, "platform/gateway");

const aiCwd = isProdPath
  ? path.join(PROD_ROOT, "artifacts/ai-service")
  : path.join(__dirname, "service");

const envFilePath = isProdPath
  ? path.join(PROD_ROOT, ".env")
  : path.join(__dirname, ".env");

// Load .env variables into the PM2 env block for services (especially python)
function loadDotenv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  try {
    const content = fs.readFileSync(p, "utf8");
    for (const raw of content.split("\n")) {
      const l = raw.trim();
      if (!l || l.startsWith("#")) continue;
      const eq = l.indexOf("="); if (eq < 0) continue;
      const k = l.slice(0, eq).trim();
      let v = l.slice(eq + 1).trim();
      const h = v.indexOf("#"); if (h >= 0) v = v.slice(0, h).trim();
      v = v.replace(/^["']|["']$/g, "");
      out[k] = v;
    }
  } catch (e) {
    console.error("Failed to load .env file for PM2:", e);
  }
  return out;
}

const dotenvEnv = loadDotenv(envFilePath);

// Path to python venv uvicorn executable. In dev the venv is the uv workspace
// root venv, not a per-app one.
const uvicornScript = isProdPath
  ? path.join(PROD_ROOT, "artifacts/ai-service/.venv/bin/uvicorn")
  : path.join(__dirname, ".venv/bin/uvicorn");

module.exports = {
  apps: [
    {
      name: "hakase-api",
      cwd: apiCwd,
      script: "dist/index.cjs",
      interpreter: "node",
      exec_mode: "fork",
      node_args: `--env-file=${envFilePath}`,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        ...dotenvEnv,
        NODE_ENV: "production",
      },
      env_dev: {
        ...dotenvEnv,
        NODE_ENV: "development",
      },
      env_staging: {
        ...dotenvEnv,
        NODE_ENV: "staging",
      },
      env_production: {
        ...dotenvEnv,
        NODE_ENV: "production",
      }
    },
    {
      name: "hakase-ai",
      cwd: aiCwd,
      script: uvicornScript,
      // main.py is no longer a top-level module beside cwd — it is the
      // hakase_service workspace package (see deploy/scripts/run-ai-service.mjs).
      args: "hakase_service.main:app --host :: --port 8090 --workers 2",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        ...dotenvEnv,
        NODE_ENV: "production",
        AI_SERVICE_PORT: "8090",
      },
      env_dev: {
        ...dotenvEnv,
        NODE_ENV: "development",
        AI_SERVICE_PORT: "8090"
      },
      env_staging: {
        ...dotenvEnv,
        NODE_ENV: "staging",
        AI_SERVICE_PORT: "8090"
      },
      env_production: {
        ...dotenvEnv,
        NODE_ENV: "production",
        AI_SERVICE_PORT: "8090"
      }
    }
  ]
};
