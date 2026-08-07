#!/usr/bin/env node
/**
 * Production install: pnpm workspace deps + Python venv + AI deps.
 * Idempotent. Safe to run on every deploy / post-merge.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT
  ? resolve(process.env.REPO_ROOT)
  : resolve(BACKEND_DIR, "..");

const AI_DIR = resolve(REPO_ROOT, "service");
const API_DIR = resolve(REPO_ROOT, "platform", "gateway");
const VENV = resolve(REPO_ROOT, ".venv");
const IS_WIN = process.platform === "win32";
const PYTHON = IS_WIN
  ? resolve(VENV, "Scripts", "python.exe")
  : resolve(VENV, "bin", "python");

function sh(cmd, cwd = REPO_ROOT) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, PIP_USER: "false" } });
}

function hasCmd(c) {
  try {
    execSync(IS_WIN ? `where ${c}` : `command -v ${c}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("→ Backend install starting");
console.log("  REPO_ROOT =", REPO_ROOT);

// Copy .env.example to .env if missing to satisfy required variables on startup
const envPath = resolve(REPO_ROOT, ".env");
const examplePath = resolve(REPO_ROOT, ".env.example");
if (!existsSync(envPath) && existsSync(examplePath)) {
  console.log("→ Copying .env.example to .env");
  try {
    copyFileSync(examplePath, envPath);
  } catch (e) {
    console.warn("  failed to copy .env.example to .env:", e.message);
  }
}

// pnpm
try {
  execSync("pnpm --version", { stdio: "ignore" });
} catch {
  console.log("  installing pnpm globally...");
  sh("npm install -g pnpm@latest");
}

// JS deps (workspace)
sh("pnpm install --frozen-lockfile=false --prefer-offline", REPO_ROOT);
sh("pnpm run typecheck:libs", REPO_ROOT);

// ── Python deps (full ML) ───────────────────────────────────────────────────
// Preferred path: uv. It reads pyproject.toml + uv.lock, creates .venv, and
// pulls CPU-only torch on Linux (per the pyproject index), giving a fast,
// reproducible install across machines. Install uv once:
//   curl -LsSf https://astral.sh/uv/install.sh | sh   (macOS/Linux)
//   irm https://astral.sh/uv/install.ps1 | iex         (Windows PowerShell)
// Fallback path: stdlib venv + pip install -r pyproject.toml.
const pyproject = resolve(REPO_ROOT, "pyproject.toml");
let usedUv = false;
if (existsSync(pyproject) && hasCmd("uv")) {
  console.log("→ Installing Python deps with uv (uv sync)");
  try {
    sh("uv sync --frozen", REPO_ROOT); // build .venv from the committed uv.lock
    usedUv = true;
  } catch {
    console.warn("  uv sync --frozen failed; retrying with lock refresh (uv sync)");
    try {
      sh("uv sync", REPO_ROOT);
      usedUv = true;
    } catch (e) {
      console.warn("  uv sync failed, falling back to pip:", e?.message ?? e);
    }
  }
}

if (!usedUv) {
  console.log("→ Installing Python deps with venv + pip (uv not found)");
  if (!existsSync(PYTHON)) {
    console.log("→ Creating Python venv");
    sh(`${IS_WIN ? "python" : "python3"} -m venv "${VENV}"`, REPO_ROOT);
  }
  try {
    execSync(`"${PYTHON}" -m pip --version`, { stdio: "ignore" });
  } catch {
    sh(`"${PYTHON}" -m ensurepip --upgrade`, REPO_ROOT);
  }
  sh(`"${PYTHON}" -m pip install --upgrade pip`, REPO_ROOT);
  sh(`"${PYTHON}" -m pip install -r "${resolve(AI_DIR, "requirements.txt")}"`, REPO_ROOT);
}

// API server self-build sanity (optional)
if (existsSync(resolve(API_DIR, "build.ts"))) {
  console.log("→ API server typecheck");
  try {
    sh("pnpm --filter @platform/gateway run typecheck", REPO_ROOT);
  } catch (e) {
    console.warn("  typecheck failed (continuing):", e?.message ?? e);
  }
}

// Ensure data dir exists
const dataDir = process.env.HAKASE_DATA_DIR ?? "/var/lib/hakase";
try {
  mkdirSync(dataDir, { recursive: true });
} catch {}

console.log("✓ Backend install complete");
