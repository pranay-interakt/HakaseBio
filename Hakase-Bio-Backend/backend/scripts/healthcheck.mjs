#!/usr/bin/env node
/** Poll /api/health until 200 OR timeout. Used by deploy.sh & CI gates. */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    const h = v.indexOf("#"); if (h >= 0) v = v.slice(0, h).trim();
    v = v.replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(resolve(BACKEND_DIR, ".env"));

const PORT = process.env.PORT ?? "3000";
const path = process.env.HEALTHCHECK_PATH ?? "/api/health";
const timeout = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? "15000");
const url = `http://127.0.0.1:${PORT}${path}`;
const deadline = Date.now() + timeout;

async function once() {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch { return false; }
}

(async () => {
  while (Date.now() < deadline) {
    if (await once()) {
      console.log(`✓ ${url} healthy`);
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.error(`✗ ${url} did not become healthy within ${timeout}ms`);
  process.exit(1);
})();
