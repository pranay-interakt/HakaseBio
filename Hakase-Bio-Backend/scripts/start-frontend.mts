import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FRONTEND = resolve(ROOT, "artifacts", "hakase-ai");
const IS_WIN = process.platform === "win32";

// Load .env
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const eq = clean.indexOf("=");
    if (eq < 0) continue;
    const key = clean.slice(0, eq).trim();
    let val = clean.slice(eq + 1).trim();
    // Strip inline comment
    const hashIdx = val.indexOf("#");
    if (hashIdx >= 0) {
      val = val.slice(0, hashIdx).trim();
    }
    val = val.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

const PORT = process.env.PORT ?? "4000";
const BASE_PATH = process.env.BASE_PATH ?? "/";

process.env.PORT = PORT;
process.env.BASE_PATH = BASE_PATH;

console.log(`
╔══════════════════════════════════════════════════╗
║         Hakase BioTwin — Frontend               ║
╚══════════════════════════════════════════════════╝
  Frontend → http://localhost:${PORT}
`);

console.log("→ Starting Vite dev server...");
const proc = spawn("pnpm", ["run", "dev"], {
  cwd: FRONTEND,
  env: { ...process.env, PORT },
  shell: IS_WIN,
  stdio: "inherit",
});

const cleanup = () => {
  try {
    proc.kill("SIGINT");
  } catch {}
  process.exit();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
