#!/usr/bin/env node
/** Frontend install — pnpm workspace deps. Idempotent. */
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(FE_DIR, "..");

function sh(cmd, cwd = REPO_ROOT) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env } });
}

try { execSync("pnpm --version", { stdio: "ignore" }); }
catch { sh("npm install -g pnpm@latest"); }

sh("pnpm install --frozen-lockfile=false --prefer-offline", REPO_ROOT);

console.log("✓ Frontend install complete");
