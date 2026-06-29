#!/usr/bin/env node
/** Build the SPA via Vite. Output ends up in artifacts/hakase-ai/dist. */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(FE_DIR, "..");

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
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
loadEnv(resolve(FE_DIR, ".env"));
loadEnv(resolve(REPO_ROOT, ".env"));

console.log("→ Vite build");
console.log("  VITE_API_BASE_URL =", process.env.VITE_API_BASE_URL ?? "(unset)");
execSync("pnpm --filter @workspace/hakase-ai run build", {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: { ...process.env },
});
console.log("✓ Frontend build complete (artifacts/hakase-ai/dist)");
