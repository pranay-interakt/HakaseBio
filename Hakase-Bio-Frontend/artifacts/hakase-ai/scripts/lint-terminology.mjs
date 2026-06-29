#!/usr/bin/env node
/**
 * Terminology regression lint for the Zero-Lab pivot (May 2026).
 *
 * Scans customer-facing route/page surfaces + rendered UI components for
 * legacy CRO / wet-lab / auto-substrate phrasing that conflicts with the
 * canonical LITERATURE / IN-HOUSE / CLASS-MEDIAN ladder.
 *
 * Scope is narrow on purpose:
 *   - src/pages/**.tsx          (routed pages — always customer-facing)
 *   - src/components/**.tsx     (rendered UI components)
 *   - HakaseAI_Platform_and_User_Guide.md (spec doc)
 * Does NOT scan src/lib/** or other non-rendered code, so the deferred
 * schema rewrite (consultant #2 / #6) is not blocked.
 *
 * Allowlist exists for intentional technical IDs (e.g. alert id
 * "ivie-auto-substrate") and intentional Zero-Lab marketing claims
 * (e.g. "no wet-lab dependency").
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const REPO_ROOT = join(ROOT, "..", "..");

const SCAN = [
  { root: join(ROOT, "src/pages"),      ext: ".tsx" },
  { root: join(ROOT, "src/components"), ext: ".tsx" },
  { root: REPO_ROOT, files: ["HakaseAI_Platform_and_User_Guide.md"] },
];

const BANNED = [
  /\bwet-lab substrate\b/i,
  /\bwet-lab matrix\b/i,
  /\bwet-lab inputs?\b/i,
  /\bauto-substrate\b/i,
  /\bauto-estimated substrate\b/i,
  /\bmeasured CRO\b/i,
  /\bmeasured \(CRO\)/i,
];

// Substrings that, if they contain a banned phrase, should NOT trip the lint
// (intentional technical IDs + Zero-Lab marketing disclaimers).
const ALLOW = [
  /id:\s*["']ivie-auto-substrate["']/,           // alert id, referenced as ID
  /no wet-lab/i,                                  // marketing claim
  /no\s+wet[\s-]lab\s+dependency/i,               // marketing claim
  /without.*wet[\s-]lab/i,                        // marketing claim
];

function walk(dir, ext, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const files = [];
for (const s of SCAN) {
  if (s.files) for (const f of s.files) files.push(join(s.root, f));
  else files.push(...walk(s.root, s.ext));
}

let violations = 0;
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW.some(re => re.test(line))) continue;
    for (const re of BANNED) {
      if (re.test(line)) {
        violations++;
        console.error(`${relative(REPO_ROOT, file)}:${i + 1}: matches /${re.source}/`);
        console.error(`    ${line.trim()}`);
        break;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n✖ ${violations} terminology violation(s). Use LITERATURE / IN-HOUSE / CLASS-MEDIAN ladder.`);
  process.exit(1);
}
console.log("✓ terminology lint passed");
