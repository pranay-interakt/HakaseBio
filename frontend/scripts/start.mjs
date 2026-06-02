#!/usr/bin/env node
/**
 * Foreground start for the FRONTEND deploy unit.
 *
 *   NODE_ENV=production → vite preview (serves the built dist/)
 *   NODE_ENV=development → vite dev (HMR)
 *
 * Production hosts will typically front this with nginx (see nginx/) and let
 * vite preview serve the static dist/, OR skip vite entirely and point nginx
 * straight at artifacts/hakase-ai/dist (see nginx/static-only.conf).
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(FE_DIR, "..");
const SPA_DIR = resolve(REPO_ROOT, "artifacts", "hakase-ai");
const IS_WIN = process.platform === "win32";

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
loadEnv(resolve(FE_DIR, ".env"));
loadEnv(resolve(REPO_ROOT, ".env"));

const NODE_ENV = process.env.NODE_ENV ?? "production";
const PORT = process.env.PORT ?? (NODE_ENV === "production" ? "4000" : "5173");
const HOST = process.env.HOST ?? "0.0.0.0";

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Frontend (${NODE_ENV.padEnd(10)})║
╚══════════════════════════════════════════════════╝
  URL → http://${HOST}:${PORT}
  API → ${process.env.VITE_API_BASE_URL ?? "(unset)"}
`);

if (NODE_ENV === "production") {
  const distDir = resolve(SPA_DIR, "dist");
  if (!existsSync(distDir)) {
    console.log("→ dist missing — building first");
    execSync(`node "${resolve(__dirname, "build.mjs")}"`, { stdio: "inherit", cwd: FE_DIR });
  }
}

const script = NODE_ENV === "production" ? "serve" : "dev";
const proc = spawn(
  "pnpm",
  ["--filter", "@workspace/hakase-ai", "run", script, "--port", PORT, "--host", HOST],
  { cwd: REPO_ROOT, env: { ...process.env, PORT, HOST }, shell: IS_WIN, stdio: "inherit" },
);

const cleanup = (code = 0) => { try { proc.kill("SIGTERM"); } catch {} setTimeout(() => process.exit(code), 1000); };
process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
proc.on("exit", (code) => process.exit(code ?? 0));
