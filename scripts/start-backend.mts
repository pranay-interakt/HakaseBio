import { spawn, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IS_WIN = process.platform === "win32";

// ── Load .env into process.env ───────────────────────────────────────────────
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const eq = clean.indexOf("=");
    if (eq < 0) continue;
    const key = clean.slice(0, eq).trim();
    let val = clean.slice(eq + 1).trim();
    // Strip inline comment
    const hashIdx = val.indexOf("#");
    if (hashIdx >= 0) {
      val = val.slice(0, hashIdx).trim();
    }
    val = val.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

const PORT = process.env.PORT ?? "3000";
const AI_SERVICE_PORT = process.env.AI_SERVICE_PORT ?? "8090";

const AI_DIR = resolve(ROOT, "artifacts", "ai-service");
const API_DIR = resolve(ROOT, "artifacts", "api-server");
const VENV = resolve(ROOT, ".venv");
const PYTHON = IS_WIN ? resolve(VENV, "Scripts", "python.exe") : resolve(VENV, "bin", "python");

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Backend                 ║
╚══════════════════════════════════════════════════╝
  API Server  → http://localhost:${PORT}
  AI Service  → http://localhost:${AI_SERVICE_PORT}
`);

// ── Setup Python venv + deps ─────────────────────────────────────────────────
if (!existsSync(PYTHON)) {
  console.log("→ Creating Python virtual environment...");
  execSync(`python3 -m venv "${VENV}"`, { stdio: "inherit", cwd: ROOT });
}

console.log("→ Checking Python dependencies...");
// Ensure pip is installed in the virtualenv
try {
  execSync(`"${PYTHON}" -m pip --version`, { stdio: "ignore" });
} catch {
  console.log("  Installing pip...");
  execSync(`"${PYTHON}" -m ensurepip --upgrade`, { stdio: "inherit" });
}

// Upgrade pip and install requirements
execSync(`"${PYTHON}" -m pip install -q --upgrade pip`, { stdio: "inherit" });
execSync(`"${PYTHON}" -m pip install -q -r "${resolve(AI_DIR, "requirements.txt")}"`, { stdio: "inherit" });
console.log("  Python dependencies ready.\n");

// ── Launch servers concurrently ──────────────────────────────────────────────
console.log("→ Starting Uvicorn backend and Express API server in foreground...");

const aiProcess = spawn(PYTHON, ["main.py"], {
  cwd: AI_DIR,
  env: { ...process.env, AI_SERVICE_PORT },
  stdio: "inherit",
});

const apiProcess = spawn("pnpm", ["run", "dev"], {
  cwd: API_DIR,
  env: { ...process.env, PORT },
  shell: IS_WIN,
  stdio: "inherit",
});

// clean up on termination
const cleanup = () => {
  console.log("\n→ Shutting down backend processes...");
  try {
    aiProcess.kill("SIGINT");
  } catch {}
  try {
    apiProcess.kill("SIGINT");
  } catch {}
  process.exit();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Keep alive
aiProcess.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.log(`AI Service exited with code ${code}`);
  }
  cleanup();
});

apiProcess.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.log(`API Server exited with code ${code}`);
  }
  cleanup();
});
