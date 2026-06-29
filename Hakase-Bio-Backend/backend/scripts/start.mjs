#!/usr/bin/env node
/**
 * Single foreground start for the BACKEND deploy unit:
 *   - FastAPI AI service  (Uvicorn, Python venv)
 *   - Express API server  (tsx prod or dist build)
 *
 * Production runners (systemd, Docker, PM2) wrap this exact entry so the
 * boot path is identical in every environment.
 *
 * Environment is loaded from (in order, later wins):
 *   backend/.env  → repo-root .env  → process.env
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(BACKEND_DIR, "..");
const IS_WIN = process.platform === "win32";

// ── Load .env files ──────────────────────────────────────────────────────────
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const hash = val.indexOf("#");
    if (hash >= 0) val = val.slice(0, hash).trim();
    val = val.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(resolve(BACKEND_DIR, ".env"));
loadEnv(resolve(REPO_ROOT, ".env"));

const PORT = process.env.PORT ?? "3000";
const AI_PORT = process.env.AI_SERVICE_PORT ?? "8090";
const NODE_ENV = process.env.NODE_ENV ?? "production";

const AI_DIR = resolve(REPO_ROOT, "artifacts", "ai-service");
const API_DIR = resolve(REPO_ROOT, "artifacts", "api-server");
const VENV = resolve(REPO_ROOT, ".venv");
const PYTHON = IS_WIN ? resolve(VENV, "Scripts", "python.exe") : resolve(VENV, "bin", "python");

if (!existsSync(PYTHON)) {
  console.log("→ Python venv missing — running install...");
  execSync(`node "${resolve(__dirname, "install.mjs")}"`, { stdio: "inherit", cwd: BACKEND_DIR });
}

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Backend (${NODE_ENV.padEnd(10)})║
╚══════════════════════════════════════════════════╝
  Express API  → http://0.0.0.0:${PORT}
  FastAPI AI   → http://0.0.0.0:${AI_PORT}
  REPO_ROOT    → ${REPO_ROOT}
  ANTHROPIC    → ${process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "DUMMY" ? "live" : "DUMMY/bypass"}
  RUNPOD       → ${process.env.RUNPOD_API_KEY && process.env.RUNPOD_API_KEY !== "DUMMY" ? "live" : "DUMMY/bypass"}
`);

const aiProc = spawn(
  PYTHON,
  ["main.py"],
  {
    cwd: AI_DIR,
    env: { ...process.env, AI_SERVICE_PORT: AI_PORT, PYTHONUNBUFFERED: "1" },
    stdio: "inherit",
  },
);

const apiScript = NODE_ENV === "production" ? "start" : "dev";
const apiProc = spawn(
  "pnpm",
  ["--filter", "@workspace/api-server", "run", apiScript === "start" ? "dev" : "dev"],
  {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT, NODE_ENV },
    shell: IS_WIN,
    stdio: "inherit",
  },
);

let shuttingDown = false;
function cleanup(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n→ Shutting down backend...");
  try { aiProc.kill("SIGTERM"); } catch {}
  try { apiProc.kill("SIGTERM"); } catch {}
  setTimeout(() => process.exit(code), 2000);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

aiProc.on("exit", (code) => {
  console.error(`[ai-service] exited code=${code}`);
  cleanup(code ?? 1);
});
apiProc.on("exit", (code) => {
  console.error(`[api-server] exited code=${code}`);
  cleanup(code ?? 1);
});
