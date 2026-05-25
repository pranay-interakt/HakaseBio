/**
 * Hakase BioTwin — cross-platform frontend launcher (Node/tsx)
 * Works on Linux, macOS, Windows, Vercel, Netlify, any static host.
 *
 * Modes (pass as first arg):
 *   serve  (default) — production build then serve locally
 *   dev              — Vite dev server with hot reload
 *   build            — production build only (for Vercel/Netlify CI)
 *
 * Run via:
 *   pnpm frontend          → build + serve
 *   pnpm frontend:dev      → dev server
 *   pnpm frontend:build    → build only
 */

import { spawn, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = resolve(__dirname, "..");
const FRONTEND    = resolve(ROOT, "artifacts", "hakase-ai");
const IS_WIN      = process.platform === "win32";
const MODE        = process.argv[2] ?? "serve";   // serve | dev | build

// ── Load .env ────────────────────────────────────────────────────────────────
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) {
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

const PORT      = process.env.PORT      ?? "4000";
const BASE_PATH = process.env.BASE_PATH ?? "/";

process.env.PORT      = PORT;
process.env.BASE_PATH = BASE_PATH;

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Frontend               ║
╚══════════════════════════════════════════════════╝
  Mode      : ${MODE}
  Port      : ${PORT}
  Base path : ${BASE_PATH}
`);

// ── Install deps ──────────────────────────────────────────────────────────────
console.log("→ Installing Node deps...");
try {
  execSync("pnpm install --frozen-lockfile", { cwd: ROOT, stdio: "pipe" });
} catch {
  execSync("pnpm install", { cwd: ROOT, stdio: "inherit" });
}
console.log("  Done.\n");

// ── Helper: run a pnpm script and inherit stdio ───────────────────────────────
function run(script: string, extraEnv: Record<string, string> = {}) {
  const proc = spawn("pnpm", ["run", script], {
    cwd: FRONTEND,
    env: { ...process.env, ...extraEnv },
    shell: IS_WIN,
    stdio: "inherit",
  });
  proc.on("exit", (code) => {
    if (code !== 0) process.exit(code ?? 1);
  });
  return proc;
}

// ── Modes ─────────────────────────────────────────────────────────────────────
if (MODE === "dev") {
  console.log(`→ Vite dev server → http://localhost:${PORT}\n`);
  run("dev");

} else if (MODE === "build") {
  console.log("→ Building for production...");
  run("build");
  console.log(`\n  Done → artifacts/hakase-ai/dist/public/`);
  console.log("  Point nginx / Vercel / Netlify / Caddy at that directory.\n");

} else {
  // serve: build then serve static output
  console.log("→ Building for production...");
  execSync("pnpm run build", { cwd: FRONTEND, env: process.env, stdio: "inherit" });

  const DIST = resolve(FRONTEND, "dist", "public");
  console.log(`\n→ Serving ${DIST} on port ${PORT}...`);

  // Try 'serve' package, fall back to python http.server
  try {
    execSync("serve --version", { stdio: "pipe" });
    const proc = spawn("serve", ["-s", DIST, "-l", PORT], {
      shell: IS_WIN,
      stdio: "inherit",
    });
    proc.on("exit", (c) => process.exit(c ?? 0));
  } catch {
    console.log("  (serve not found — using python http.server)");
    console.log("  Tip: npm i -g serve  for a better static server\n");
    const proc = spawn(
      IS_WIN ? "python" : "python3",
      ["-m", "http.server", PORT, "--directory", DIST],
      { stdio: "inherit" }
    );
    proc.on("exit", (c) => process.exit(c ?? 0));
  }
}

// Keep alive for server modes
await new Promise(() => {});
