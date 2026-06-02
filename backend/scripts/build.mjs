#!/usr/bin/env node
/**
 * Backend build step — compiles Express api-server to dist/ via esbuild,
 * leaves Python AI service in-place (FastAPI is launched with the venv interpreter).
 */
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(BACKEND_DIR, "..");

function sh(cmd, cwd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env } });
}

console.log("→ Building backend bundle");
sh("pnpm --filter @workspace/api-server run build", REPO_ROOT);
console.log("✓ Backend build complete");
