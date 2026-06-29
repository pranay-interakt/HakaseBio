#!/usr/bin/env node
/** Serve the already-built dist/ via vite preview. */
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(__dirname, "..", "..");
const PORT = process.env.PORT ?? "4000";
const HOST = process.env.HOST ?? "0.0.0.0";
execSync(`pnpm --filter @workspace/hakase-ai run serve --host ${HOST} --port ${PORT}`, {
  cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env },
});
