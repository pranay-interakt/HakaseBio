#!/usr/bin/env node
/**
 * Regenerates src/lib/drugcentralValidatedTargets.ts from a DrugCentral
 * drug.target.interaction TSV.
 *
 * Source (CC BY-SA 4.0):
 *   https://unmtid-dbs.net/download/DrugCentral/2021_09_01/drug.target.interaction.tsv.gz
 *
 * Filter (tightened after first architect review):
 *   - human (Homo sapiens)
 *   - single-accession rows only (no complex/multi-target hits)
 *   - ACT_TYPE ∈ {IC50, Ki, Kd, pIC50, pKi, pKd}  (inhibition / binding only;
 *     EC50/AC50 dropped — they require agonist-aware modeling that the L1
 *     dose-response engine does not implement)
 *   - TARGET_CLASS ∈ {Kinase, Enzyme, Ion channel}  (mechanistically
 *     compatible with the inhibition-style IC50 / Hill curve that
 *     `runInVitroSimulation` emits — GPCR / NR / Transporter / Cytokine
 *     etc. are deferred until a class-aware model is added)
 *   - numeric ACT_VALUE
 *   - ≥10 qualifying rows per UniProt  (≥5 admitted too many marginal
 *     targets per architect review)
 *
 * The conjunction enforces the "wet-lab verifiable" invariant: any UniProt
 * on the resulting list has ≥10 published quantitative inhibition/binding
 * datapoints and belongs to a class the L1 model can actually score
 * mechanistically.
 *
 * Run from repo root:
 *   node artifacts/hakase-ai/scripts/build-drugcentral-allowlist.mjs <path-to-tsv>
 */
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] || "artifacts/hakase-ai/data/drugcentral/drug.target.interaction.tsv";
const output = "artifacts/hakase-ai/src/lib/drugcentralValidatedTargets.ts";

if (!fs.existsSync(input)) {
  console.error(`Missing input TSV: ${input}`);
  console.error(`Download the DrugCentral target interaction TSV from`);
  console.error(`https://unmtid-dbs.net/download/DrugCentral/2021_09_01/drug.target.interaction.tsv.gz`);
  console.error(`(CC BY-SA 4.0), gunzip it, then re-run this script.`);
  process.exit(1);
}

const lines = fs.readFileSync(input, "utf8").split(/\r?\n/);
const header = lines[0].split("\t").map(s => s.replace(/^"|"$/g, ""));
const idx = (n) => header.indexOf(n);
const cACC = idx("ACCESSION"), cGENE = idx("GENE"), cTC = idx("TARGET_CLASS"),
      cAV = idx("ACT_VALUE"), cAT = idx("ACT_TYPE"), cORG = idx("ORGANISM"),
      cTN = idx("TARGET_NAME");

const VALID_TYPES = new Set(["IC50", "Ki", "Kd", "pIC50", "pKi", "pKd"]);
const COMPATIBLE_CLASSES = new Set(["Kinase", "Enzyme", "Ion channel"]);
const MIN_DATAPOINTS = 10;

const bucket = new Map();
for (let i = 1; i < lines.length; i++) {
  const ln = lines[i]; if (!ln) continue;
  const f = ln.split("\t").map(s => s.replace(/^"|"$/g, ""));
  const acc = f[cACC];
  if (!acc || acc.includes("|")) continue;
  if (f[cORG] !== "Homo sapiens") continue;
  if (!COMPATIBLE_CLASSES.has(f[cTC])) continue;
  if (!VALID_TYPES.has(f[cAT])) continue;
  if (!f[cAV] || isNaN(parseFloat(f[cAV]))) continue;
  const b = bucket.get(acc) ?? { gene: f[cGENE] || "", targetClass: f[cTC] || "", targetName: f[cTN] || "", count: 0 };
  b.count++;
  bucket.set(acc, b);
}

const rows = [...bucket.entries()]
  .filter(([_, v]) => v.count >= MIN_DATAPOINTS)
  .map(([acc, v]) => ({ acc, ...v }))
  .sort((a, b) => a.acc.localeCompare(b.acc));

const meta = rows.reduce((o, r) => {
  o[r.acc] = { gene: r.gene, targetClass: r.targetClass, targetName: r.targetName, bioactivityCount: r.count };
  return o;
}, {});

const ts = `// AUTO-GENERATED — do not edit by hand.
// Run \`node artifacts/hakase-ai/scripts/build-drugcentral-allowlist.mjs\` to regenerate.
//
// Source: DrugCentral 2021_09_01 drug.target.interaction.tsv
// License: CC BY-SA 4.0 — Avram, S. et al., Nucleic Acids Res. 2023;51(D1):D1276-D1287.
//          https://drugcentral.org/  https://unmtid-dbs.net/download/
//
// Filter: human, single-accession, ACT_TYPE ∈ {IC50,Ki,Kd + p-forms},
// TARGET_CLASS ∈ {Kinase, Enzyme, Ion channel}, ≥10 datapoints/UniProt.
// Both gates matter: ≥10 quantitative inhibition rows guarantees the target
// has enough literature to cross-check a predicted curve, AND the class
// restriction guarantees the L1 inhibition-style IC50/Hill model is
// mechanistically appropriate. GPCRs / NRs / transporters etc. are
// deliberately excluded until a class-aware (agonist/EC50) model lands.
//
// ${rows.length} accessions.

export interface DrugCentralTargetMeta {
  gene: string;
  targetClass: string;
  targetName: string;
  bioactivityCount: number;
}

export const DRUGCENTRAL_VALIDATED_TARGETS: ReadonlySet<string> = new Set([
${rows.map(r => `  "${r.acc}", // ${r.gene} [${r.targetClass}] n=${r.count}`).join("\n")}
]);

export const DRUGCENTRAL_TARGET_META: Readonly<Record<string, DrugCentralTargetMeta>> = ${JSON.stringify(meta, null, 2)} as const;
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, ts);
console.log(`Wrote ${output}`);
console.log(`  ${rows.length} UniProts qualifying (≥5 quantitative human bioactivity rows)`);
const byClass = {};
for (const r of rows) byClass[r.targetClass || "(none)"] = (byClass[r.targetClass || "(none)"] || 0) + 1;
console.log("  Class breakdown:");
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)} ${k}`);
