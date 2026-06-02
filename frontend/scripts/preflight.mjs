#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(FE_DIR, "..");

let probs = 0;
const fail = (m) => { console.error("✗ " + m); probs++; };
const ok = (m) => { console.log("✓ " + m); };
const warn = (m) => { console.warn("⚠ " + m); };

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

try { execSync("node -v", { stdio: "ignore" }); ok("node"); } catch { fail("node missing"); }
try { execSync("pnpm -v", { stdio: "ignore" }); ok("pnpm"); } catch { fail("pnpm missing"); }
if (!process.env.VITE_API_BASE_URL) warn("VITE_API_BASE_URL not set — frontend will call same origin");
else ok(`VITE_API_BASE_URL=${process.env.VITE_API_BASE_URL}`);

const vite = resolve(REPO_ROOT, "artifacts", "hakase-ai", "vite.config.ts");
if (!existsSync(vite)) fail("artifacts/hakase-ai/vite.config.ts missing");
else ok("Vite config present");

process.exit(probs > 0 ? 1 : 0);
