#!/usr/bin/env node
/**
 * Cross-OS launcher for the Python AI service (service/src/hakase_service/main.py).
 * Uses the project's .venv interpreter so heavy ML deps (torch, rdkit, the
 * vendored ADMET engine, ...) resolve correctly on Windows/macOS/Linux.
 *
 * For the full supervised stack (API + AI together) prefer `pnpm run backend`
 * (deploy/scripts/orchestrator.mjs). This script runs only the AI service.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.REPO_ROOT
  ? resolve(process.env.REPO_ROOT)
  : resolve(here, "..", "..");

const isWin = process.platform === "win32";
const venvPython = isWin
  ? resolve(repoRoot, ".venv", "Scripts", "python.exe")
  : resolve(repoRoot, ".venv", "bin", "python");
const python = existsSync(venvPython) ? venvPython : isWin ? "python" : "python3";

if (!existsSync(venvPython)) {
  console.warn(
    "⚠ .venv not found — falling back to system Python. " +
      "Run `pnpm run setup` first to create the venv with all ML deps.",
  );
}

const aiDir = resolve(repoRoot, "service");
const child = spawn(python, ["-m", "hakase_service.main"], {
  cwd: aiDir,
  stdio: "inherit",
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
