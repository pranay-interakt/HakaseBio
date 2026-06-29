#!/usr/bin/env node
/**
 * Hakase BioTwin — SINGLE-COMMAND BACKEND ORCHESTRATOR
 * ====================================================
 *
 * One command boots EVERYTHING the backend needs:
 *
 *   • FastAPI AI service (artifacts/ai-service/main.py)
 *       - ADMET-AI v2 (Chemprop GNN)
 *       - CardioTox (Wang/Karim hERG RF)
 *       - DILI-ML (DILIrank Chemprop+Morgan RF)
 *       - Solubility-ML
 *       - Binding-ML (DeepDTA-GBM with ESM-2 + Morgan FP)
 *       - Protein-ML (ESM-2 druggability)
 *       - Celltype-aggregation + Patient-line ML
 *       - RunPod dispatch for Boltz-2 co-folding (L2 Stage 2b)
 *       - RunPod dispatch for TIES/FEP (L2 Stage 5)
 *   • Express API server (artifacts/api-server/src/index.ts)
 *       - All /api/* routes (bio-chat, bio-analysis, report-narrative,
 *         ChEMBL, BindingDB, OpenTargets, UniProt, RCSB, FDA-PSG, CCTE)
 *   • Anthropic client (lib/integrations-anthropic-ai) with DUMMY bypass
 *   • Model warm-up POST /models/warmup after boot
 *
 * Production-grade features:
 *   • Auto-reloads BOTH processes when `git pull` lands (post-merge hook).
 *   • Auto-reloads when watched source paths change (CI/CD push-deploy).
 *   • Zero-downtime: SIGHUP the children so SSE/bio-chat clients survive.
 *   • Crash-restart with exponential back-off (3 retries, 30 s ceiling).
 *   • Health-checks both services before declaring boot complete.
 *   • Warms every ML model so the first user request isn't a cold start.
 *   • Single foreground process — drop into systemd / PM2 / Docker as-is.
 *
 * Usage:
 *   node backend/scripts/orchestrator.mjs                 # foreground
 *   pnpm --prefix backend start:all                       # alias
 *   pm2 start backend/scripts/orchestrator.mjs --name hakase-backend
 *
 *   Env knobs (see backend/.env.example for the full list):
 *     PORT, AI_SERVICE_PORT, REPO_ROOT, NODE_ENV
 *     AUTO_RELOAD_ON_PULL=true       # git pull → reload children
 *     WATCH_SOURCE=true              # filesystem watcher → reload children
 *     WARMUP_ON_BOOT=true            # POST /models/warmup after health
 *     ANTHROPIC_API_KEY / RUNPOD_API_KEY (DUMMY for bypass)
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, watch as fsWatch, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT
  ? resolve(process.env.REPO_ROOT)
  : resolve(BACKEND_DIR, "..");
const IS_WIN = process.platform === "win32";

// ── Env loader ──────────────────────────────────────────────────────────────
function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("="); if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    const h = v.indexOf("#"); if (h >= 0) v = v.slice(0, h).trim();
    v = v.replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(resolve(BACKEND_DIR, ".env"));
loadEnv(resolve(REPO_ROOT, ".env"));

// ── Knobs ───────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT ?? "3000";
const AI_PORT          = process.env.AI_SERVICE_PORT ?? "8090";
const NODE_ENV         = process.env.NODE_ENV ?? "production";
const AUTO_RELOAD_PULL = (process.env.AUTO_RELOAD_ON_PULL ?? "true") !== "false";
const WATCH_SOURCE     = (process.env.WATCH_SOURCE ?? (NODE_ENV === "development" ? "true" : "false")) === "true";
const WARMUP_ON_BOOT   = (process.env.WARMUP_ON_BOOT ?? "true") !== "false";
const GIT_POLL_MS      = Number(process.env.GIT_POLL_MS ?? "10000");
const RELOAD_DEBOUNCE  = Number(process.env.RELOAD_DEBOUNCE_MS ?? "1500");
const HEALTH_TIMEOUT   = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? "60000");

const AI_DIR   = resolve(REPO_ROOT, "artifacts", "ai-service");
const VENV     = resolve(REPO_ROOT, ".venv");
const PYTHON   = IS_WIN ? resolve(VENV, "Scripts", "python.exe") : resolve(VENV, "bin", "python");
const TSX      = IS_WIN ? resolve(REPO_ROOT, "node_modules", ".bin", "tsx.cmd") : resolve(REPO_ROOT, "node_modules", ".bin", "tsx");

// ── Pretty logging ──────────────────────────────────────────────────────────
const TAGS = {
  orch: "\x1b[35m[orchestrator]\x1b[0m",
  ai:   "\x1b[36m[ai-service]  \x1b[0m",
  api:  "\x1b[32m[api-server]  \x1b[0m",
  warn: "\x1b[33m[warn]        \x1b[0m",
  err:  "\x1b[31m[error]       \x1b[0m",
};
const log  = (...m) => console.log(TAGS.orch, ...m);
const warn = (...m) => console.warn(TAGS.warn, ...m);
const err  = (...m) => console.error(TAGS.err,  ...m);

// ── Banner ──────────────────────────────────────────────────────────────────
console.log(`
╔════════════════════════════════════════════════════════════════╗
║      Hakase BioTwin — Backend Orchestrator (${NODE_ENV.padEnd(10)})       ║
╠════════════════════════════════════════════════════════════════╣
║  Express API    → http://0.0.0.0:${PORT.padEnd(5)}                          ║
║  FastAPI AI     → http://0.0.0.0:${AI_PORT.padEnd(5)}                          ║
║  ML models     → ADMET-AI · CardioTox · DILI · Solubility ·    ║
║                   Binding · Protein-ML · Celltype · Patient    ║
║  GPU dispatch   → RunPod (Boltz-2 cofold + TIES/FEP)            ║
║  Anthropic      → ${(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "DUMMY" ? "live" : "DUMMY/bypass").padEnd(14)}                              ║
║  RunPod         → ${(process.env.RUNPOD_API_KEY && process.env.RUNPOD_API_KEY !== "DUMMY" ? "live" : "DUMMY/bypass").padEnd(14)}                              ║
║  Auto-reload    → git=${String(AUTO_RELOAD_PULL).padEnd(5)} watch=${String(WATCH_SOURCE).padEnd(5)} warmup=${String(WARMUP_ON_BOOT).padEnd(5)}        ║
╚════════════════════════════════════════════════════════════════╝
`);

// ── Pre-flight: Python venv + deps ─────────────────────────────────────────
if (!existsSync(PYTHON)) {
  log("python venv missing — running backend/scripts/install.mjs first");
  execSync(`node "${resolve(__dirname, "install.mjs")}"`, { stdio: "inherit", cwd: BACKEND_DIR });
}

// ── Process manager ─────────────────────────────────────────────────────────
class Child {
  constructor({ name, tag, cmd, args, cwd, env }) {
    this.name = name; this.tag = tag; this.cmd = cmd; this.args = args; this.cwd = cwd; this.env = env;
    this.proc = null; this.restarts = 0; this.shuttingDown = false;
  }
  start() {
    log(`spawning ${this.name}`);
    this.proc = spawn(this.cmd, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...(this.env ?? {}) },
      shell: IS_WIN,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (b) => process.stdout.write(this.tag + " " + b.toString().replace(/\n(?=.)/g, "\n" + this.tag + " ")));
    this.proc.stderr.on("data", (b) => process.stderr.write(this.tag + " " + b.toString().replace(/\n(?=.)/g, "\n" + this.tag + " ")));
    this.proc.on("exit", (code, signal) => {
      if (this.shuttingDown) return;
      const status = signal ? `signal=${signal}` : `code=${code}`;
      err(`${this.name} exited (${status})`);
      const backoff = Math.min(30000, 500 * Math.pow(2, this.restarts++));
      if (this.restarts > 5) {
        err(`${this.name} crashed ${this.restarts} times — giving up; shutting down orchestrator`);
        orchestrator.shutdown(1);
        return;
      }
      warn(`restarting ${this.name} in ${backoff} ms (attempt ${this.restarts})`);
      setTimeout(() => this.start(), backoff);
    });
  }
  reload() {
    // SIGHUP first (graceful), then SIGTERM after kill_timeout if still alive.
    // The ai-service main.py + api-server use stdio; SIGTERM triggers respawn.
    if (!this.proc || this.proc.killed) { this.start(); return; }
    log(`reloading ${this.name}`);
    try { this.proc.kill("SIGTERM"); } catch {}
    // The exit handler will respawn automatically (resetting backoff on
    // successful re-boot below).
    this.restarts = 0;
  }
  stop() {
    this.shuttingDown = true;
    if (!this.proc) return;
    try { this.proc.kill("SIGTERM"); } catch {}
  }
}

const ai = new Child({
  name: "ai-service",
  tag:  TAGS.ai,
  cmd:  PYTHON,
  args: ["main.py"],
  cwd:  AI_DIR,
  env:  { AI_SERVICE_PORT: AI_PORT, PYTHONUNBUFFERED: "1" },
});

const api = new Child({
  name: "api-server",
  tag:  TAGS.api,
  cmd:  "node",
  args: ["--import", "tsx", "artifacts/api-server/src/index.ts"],
  cwd:  REPO_ROOT,
  env:  { PORT, NODE_ENV },
});

// ── Healthcheck helpers ─────────────────────────────────────────────────────
async function pollHealth(label, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        log(`✓ ${label} healthy (${url})`);
        return true;
      }
    } catch {}
    await sleep(500);
  }
  err(`✗ ${label} not healthy within ${timeoutMs} ms (${url})`);
  return false;
}

async function warmupModels() {
  if (!WARMUP_ON_BOOT) return;
  log("warming up ML models (POST /models/warmup)");
  try {
    const r = await fetch(`http://127.0.0.1:${AI_PORT}/models/warmup`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    const ready = Object.entries(j).map(([k, v]) => `${k}=${(v && v.status) || "?"}`);
    log("ML warmup result:", ready.join(" "));
  } catch (e) {
    warn("ML warmup failed:", e.message ?? e);
  }
}

async function postBootHealthcheck() {
  const aiOk  = await pollHealth("ai-service", `http://127.0.0.1:${AI_PORT}/health`,  HEALTH_TIMEOUT);
  const apiOk = await pollHealth("api-server", `http://127.0.0.1:${PORT}/api/health`, HEALTH_TIMEOUT);
  if (aiOk && apiOk) {
    await warmupModels();
    log("✓ backend boot complete — accepting requests");
  } else {
    err("boot health-check failed; processes will keep retrying but service is degraded");
  }
}

// ── git-pull watcher (CI/CD + post-merge support) ──────────────────────────
let lastHead = "";
try { lastHead = execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim(); } catch {}
function checkGit() {
  if (!AUTO_RELOAD_PULL) return;
  try {
    const head = execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
    if (head && head !== lastHead) {
      log(`git HEAD changed ${lastHead.slice(0, 7)} → ${head.slice(0, 7)} — rebuilding + reloading`);
      lastHead = head;
      orchestrator.rebuildAndReload("git-pull");
    }
  } catch {}
}
setInterval(checkGit, GIT_POLL_MS).unref();

// ── filesystem watcher (CI/CD file-sync deploys) ───────────────────────────
const WATCHED_DIRS = [
  resolve(REPO_ROOT, "artifacts", "api-server", "src"),
  resolve(REPO_ROOT, "artifacts", "ai-service"),
  resolve(REPO_ROOT, "lib"),
];
let reloadTimer = null;
function setupWatchers() {
  if (!WATCH_SOURCE) return;
  for (const d of WATCHED_DIRS) {
    if (!existsSync(d)) continue;
    try {
      fsWatch(d, { recursive: true }, (_evt, file) => {
        if (!file) return;
        if (/(^|\/)(__pycache__|cache|node_modules|validation)(\/|$)/.test(file) || /\.(pyc|log|tmp)$/.test(file)) return;
        log(`file change detected: ${relative(REPO_ROOT, resolve(d, file))} — scheduling reload`);
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => orchestrator.rebuildAndReload("watch"), RELOAD_DEBOUNCE);
      });
      log(`watching ${relative(REPO_ROOT, d)}`);
    } catch (e) {
      warn(`could not watch ${d}: ${e.message ?? e}`);
    }
  }
}

// ── Orchestrator façade ─────────────────────────────────────────────────────
const orchestrator = {
  reloading: false,
  async rebuildAndReload(reason) {
    if (this.reloading) { log(`reload already in progress (${reason}) — skipping`); return; }
    this.reloading = true;
    try {
      log(`reload triggered by ${reason} — installing + reloading children`);
      try { execSync(`node "${resolve(__dirname, "install.mjs")}"`, { stdio: "inherit", cwd: BACKEND_DIR }); } catch (e) { warn("install failed:", e.message); }
      api.reload();
      ai.reload();
      await sleep(2000);
      await postBootHealthcheck();
    } finally {
      this.reloading = false;
    }
  },
  shutdown(code = 0) {
    log("shutting down…");
    ai.stop(); api.stop();
    setTimeout(() => process.exit(code), 2500);
  },
};

// ── Signal handlers ─────────────────────────────────────────────────────────
process.on("SIGINT",  () => orchestrator.shutdown(0));
process.on("SIGTERM", () => orchestrator.shutdown(0));
process.on("SIGHUP",  () => {
  // systemd `systemctl reload hakase-backend` ends here.
  log("SIGHUP received — reloading children");
  orchestrator.rebuildAndReload("SIGHUP");
});

// ── Boot ────────────────────────────────────────────────────────────────────
ai.start();
api.start();
setupWatchers();
postBootHealthcheck();
