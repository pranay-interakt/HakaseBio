#!/usr/bin/env node
/**
 * Production install: pnpm workspace deps + Python venv + AI deps.
 * Idempotent. Safe to run on every deploy / post-merge.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT
  ? resolve(process.env.REPO_ROOT)
  : resolve(BACKEND_DIR, "..");

const AI_DIR = resolve(REPO_ROOT, "artifacts", "ai-service");
const API_DIR = resolve(REPO_ROOT, "artifacts", "api-server");
const VENV = resolve(REPO_ROOT, ".venv");
const IS_WIN = process.platform === "win32";
const PYTHON = IS_WIN
  ? resolve(VENV, "Scripts", "python.exe")
  : resolve(VENV, "bin", "python");

function sh(cmd, cwd = REPO_ROOT) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env } });
}

console.log("→ Backend install starting");
console.log("  REPO_ROOT =", REPO_ROOT);

// pnpm
try {
  execSync("pnpm --version", { stdio: "ignore" });
} catch {
  console.log("  installing pnpm globally...");
  sh("npm install -g pnpm@latest");
}

// JS deps (workspace)
sh("pnpm install --frozen-lockfile=false --prefer-offline", REPO_ROOT);

// Python venv
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

// API server self-build sanity (optional)
if (existsSync(resolve(API_DIR, "build.ts"))) {
  console.log("→ API server typecheck");
  try {
    sh("pnpm --filter @workspace/api-server run typecheck", REPO_ROOT);
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
