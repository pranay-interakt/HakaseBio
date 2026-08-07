#!/usr/bin/env node
/** Validate env + tool availability before booting. Exits non-zero if not deployable. */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(BACKEND_DIR, "..");

let problems = 0;
const warn = (m) => { console.warn("⚠ " + m); };
const fail = (m) => { console.error("✗ " + m); problems++; };
const ok   = (m) => { console.log("✓ " + m); };

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
loadEnv(resolve(BACKEND_DIR, ".env"));
loadEnv(resolve(REPO_ROOT, ".env"));

try { execSync("node -v",  { stdio: "ignore" }); ok("node available"); } catch { fail("node missing"); }
try { execSync("pnpm -v",  { stdio: "ignore" }); ok("pnpm available"); } catch { fail("pnpm missing"); }
try { execSync("python3 --version", { stdio: "ignore" }); ok("python3 available"); } catch { fail("python3 missing"); }

for (const v of ["PORT", "AI_SERVICE_PORT"]) {
  if (!process.env[v]) fail(`${v} missing in .env`);
  else ok(`${v}=${process.env[v]}`);
}

const aKey = process.env.ANTHROPIC_API_KEY;
if (!aKey || aKey === "DUMMY") warn("ANTHROPIC_API_KEY missing/DUMMY — Claude analysis will use bypass");
else ok("ANTHROPIC_API_KEY present");

const rKey = process.env.RUNPOD_API_KEY;
if (!rKey || rKey === "DUMMY") warn("RUNPOD_API_KEY missing/DUMMY — Layer 2 GPU jobs will use bypass");
else ok("RUNPOD_API_KEY present");

const aiReq = resolve(REPO_ROOT, "pyproject.toml");
if (!existsSync(aiReq)) fail(`AI service requirements.txt missing at ${aiReq}`);
else ok("AI service requirements.txt present");

process.exit(problems > 0 ? 1 : 0);
