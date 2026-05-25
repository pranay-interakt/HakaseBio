/**
 * Hakase BioTwin — cross-platform backend launcher (Node/tsx)
 * Works on Linux, macOS, Windows, RunPod pods, DigitalOcean droplets, etc.
 * Run via:  pnpm backend
 */

import { spawn, execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IS_WIN = process.platform === "win32";

// ── Load .env ────────────────────────────────────────────────────────────────
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) {
  console.log("→ Loading .env");
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const eq = clean.indexOf("=");
    if (eq < 0) continue;
    const key = clean.slice(0, eq).trim();
    const val = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

const PORT            = process.env.PORT            ?? "3000";
const AI_SERVICE_PORT = process.env.AI_SERVICE_PORT ?? "8090";
const AI_SERVICE_URL  = process.env.AI_SERVICE_URL  ?? `http://localhost:${AI_SERVICE_PORT}`;
const GPU_PROVIDER    = process.env.GPU_PROVIDER    ?? "runpod";

process.env.PORT            = PORT;
process.env.AI_SERVICE_PORT = AI_SERVICE_PORT;
process.env.AI_SERVICE_URL  = AI_SERVICE_URL;
process.env.GPU_PROVIDER    = GPU_PROVIDER;
process.env.NODE_ENV        = process.env.NODE_ENV ?? "production";

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Backend                ║
╚══════════════════════════════════════════════════╝
  API Server  → http://0.0.0.0:${PORT}
  AI Service  → http://0.0.0.0:${AI_SERVICE_PORT}
  GPU Provider = ${GPU_PROVIDER}
`);

// ── Check system deps (vina + obabel) ────────────────────────────────────────
function hasCmd(cmd: string): boolean {
  const r = spawnSync(IS_WIN ? "where" : "which", [cmd], { stdio: "pipe" });
  return r.status === 0;
}

if (!hasCmd("vina") || !hasCmd("obabel")) {
  console.warn("⚠  AutoDock Vina or OpenBabel not found in PATH.");
  if (!IS_WIN) {
    console.warn("   Ubuntu/Debian:  sudo apt-get install -y autodock-vina openbabel");
    console.warn("   macOS:          brew install autodock-vina open-babel");
  } else {
    console.warn("   Windows: install via WSL or download binaries manually.");
  }
  console.warn("   Docking jobs will fail until these are installed.\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────
mkdirSync(resolve(ROOT, ".logs"), { recursive: true });

const procs: ReturnType<typeof spawn>[] = [];

function launch(
  label: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {}
) {
  const logFile = resolve(ROOT, ".logs", `${label}.log`);
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: IS_WIN,          // needed on Windows for pnpm/python
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pfx = `[${label}] `;
  proc.stdout?.on("data", (d) => process.stdout.write(pfx + d));
  proc.stderr?.on("data", (d) => process.stderr.write(pfx + d));

  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n${pfx}exited with code ${code}. Check .logs/${label}.log`);
    }
  });

  procs.push(proc);
  console.log(`→ ${label} started (PID ${proc.pid})`);
  return proc;
}

function shutdown() {
  console.log("\n→ Shutting down...");
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

// ── Start AI Service (Python) ─────────────────────────────────────────────────
const AI_DIR  = resolve(ROOT, "artifacts", "ai-service");
const VENV    = resolve(ROOT, ".venv");
const PYTHON  = IS_WIN
  ? resolve(VENV, "Scripts", "python.exe")
  : resolve(VENV, "bin", "python3");

// Create venv + install deps if needed
if (!existsSync(PYTHON)) {
  console.log("→ Creating Python venv...");
  execSync(`python3 -m venv "${VENV}"`, { stdio: "inherit" });
}

const PIP = IS_WIN
  ? resolve(VENV, "Scripts", "pip.exe")
  : resolve(VENV, "bin", "pip");

console.log("→ Installing Python deps (fast if already up to date)...");
execSync(`"${PIP}" install -q -r "${resolve(AI_DIR, "requirements.txt")}"`, {
  stdio: "inherit",
});
if (GPU_PROVIDER === "aws") {
  execSync(`"${PIP}" install -q boto3`, { stdio: "inherit" });
}

launch(
  "ai-service",
  PYTHON,
  ["main.py"],
  AI_DIR,
  { AI_SERVICE_PORT }
);

// ── Wait for AI service to be ready ──────────────────────────────────────────
async function waitForAI(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${AI_SERVICE_PORT}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn("⚠  AI service didn't respond in 30s — continuing anyway.");
}

await waitForAI();
console.log("  AI service ready ✓\n");

// ── Build API server if dist doesn't exist ────────────────────────────────────
const API_DIR  = resolve(ROOT, "artifacts", "api-server");
const DIST_IDX = resolve(API_DIR, "dist", "index.js");

if (!existsSync(DIST_IDX)) {
  console.log("→ Building API server...");
  execSync("pnpm run build", { cwd: API_DIR, stdio: "inherit" });
}

// ── Start API Server (Node) ───────────────────────────────────────────────────
if (existsSync(DIST_IDX)) {
  launch("api-server", process.execPath, [DIST_IDX], API_DIR, { PORT });
} else {
  // Fall back to tsx dev mode
  launch("api-server", "pnpm", ["run", "dev"], API_DIR, { PORT });
}

console.log(`
╔══════════════════════════════════════════════════╗
║  Backend running — Ctrl+C to stop               ║
║  API  → http://localhost:${PORT}                   ║
║  AI   → http://localhost:${AI_SERVICE_PORT}                   ║
╚══════════════════════════════════════════════════╝
`);

// Keep process alive
await new Promise(() => {});
