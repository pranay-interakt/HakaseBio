#!/usr/bin/env node
/**
 * Cross-OS `preinstall` guard (works on Windows/macOS/Linux — pure Node, no shell).
 * - Refuses npm/yarn so the workspace is always installed with pnpm.
 * - Removes stray npm/yarn lockfiles that would confuse the workspace.
 */
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

for (const f of ["package-lock.json", "yarn.lock"]) {
  try {
    rmSync(resolve(repoRoot, f), { force: true });
  } catch {}
}

const ua = process.env.npm_config_user_agent ?? "";
if (!ua.startsWith("pnpm/")) {
  console.error(
    "\n✗ This project uses pnpm. Install it once with `npm install -g pnpm`,\n" +
      "  then run `pnpm install` (not npm/yarn).\n",
  );
  process.exit(1);
}
