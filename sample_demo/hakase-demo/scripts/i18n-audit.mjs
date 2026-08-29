#!/usr/bin/env node
/**
 * Reports which user-visible strings still lack a Japanese translation.
 *
 * It reads every `t("…")` call in the source and checks it against the JA
 * catalogue, so translation coverage is a measured number rather than a claim.
 * Run: node scripts/i18n-audit.mjs [--list]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const files = walk("src").filter((f) => !f.includes("/i18n/"));
const call = /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;

const used = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(call)) {
    const text = m[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (!used.has(text)) used.set(text, new Set());
    used.get(text).add(file);
  }
}

const ja = readFileSync("src/i18n/ja.ts", "utf8");
const translated = new Set();
for (const m of ja.matchAll(/^\s*(["'`])((?:\\.|(?!\1)[^\\])*?)\1\s*:/gms)) {
  translated.add(m[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'"));
}

const missing = [...used.keys()].filter((k) => !translated.has(k));
const total = used.size;
const done = total - missing.length;
const pct = total ? ((done / total) * 100).toFixed(1) : "0.0";

console.log(`i18n coverage: ${done}/${total} strings translated (${pct}%)`);
if (missing.length) {
  const byFile = new Map();
  for (const key of missing) {
    for (const f of used.get(key)) byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }
  console.log("\nuntranslated, by file:");
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
  if (process.argv.includes("--list")) {
    console.log("\nuntranslated strings:");
    for (const key of missing) console.log(`  ${JSON.stringify(key)}`);
  }
}
