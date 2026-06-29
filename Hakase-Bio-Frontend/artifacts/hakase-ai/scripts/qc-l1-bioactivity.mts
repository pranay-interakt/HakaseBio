/**
 * L1 Bioactivity QC Harness  (internal, never user-facing)
 *
 * Back-tests the L1 IC50 / Ki / Kd predictor (computeBaselinePIC50 +
 * computePharmacophoreBonus, defined in src/lib/inVitroSim.ts) against
 * DrugCentral 2021_09_01 literature bioactivity values, restricted to the
 * 179 inhibition-compatible UniProts in DRUGCENTRAL_VALIDATED_TARGETS.
 *
 * Run:  pnpm --filter @workspace/hakase-ai run qc:l1
 * Output:  artifacts/hakase-ai/docs/qc/l1-bioactivity.md
 *
 * Data sources (CC BY-SA 4.0, attribution in docs/qc/l1-bioactivity.md):
 *   artifacts/hakase-ai/data/drugcentral/drug.target.interaction.tsv
 *   artifacts/hakase-ai/data/drugcentral/structures.smiles.tsv
 * These files are .gitignored (raw third-party data); regenerate with
 * the documented curl commands in data/drugcentral/README.md.
 *
 * This script intentionally does NOT mutate any shipped source.  It
 * imports the production predictor by name so any drift in the model
 * is immediately reflected in the next QC report.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeBaselinePIC50,
  computePharmacophoreBonus,
} from "../src/lib/inVitroSim.ts";
import {
  DRUGCENTRAL_VALIDATED_TARGETS,
  DRUGCENTRAL_TARGET_META,
} from "../src/lib/drugcentralValidatedTargets.ts";
import type { PharmacophoreProfile } from "../src/lib/chemistry.ts";

// ─── paths ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const INTERACTIONS_TSV = resolve(ROOT, "data/drugcentral/drug.target.interaction.tsv");
const STRUCTURES_TSV   = resolve(ROOT, "data/drugcentral/structures.smiles.tsv");
const REPORT_PATH      = resolve(ROOT, "docs/qc/l1-bioactivity.md");

for (const p of [INTERACTIONS_TSV, STRUCTURES_TSV]) {
  if (!existsSync(p)) {
    console.error(`Missing data file: ${p}`);
    console.error("See artifacts/hakase-ai/data/drugcentral/README.md to download.");
    process.exit(1);
  }
}

// ─── RDKit (Node, via createRequire so the WASM loader can resolve) ────
const require = createRequire(pathToFileURL(resolve(ROOT, "package.json")).href);
const initRDKit = require("@rdkit/rdkit");
const rdkit: any = await initRDKit();

// Lightweight, Node-safe replacements for chemistry.ts helpers. We do not
// import getMolecularProperties / detectPharmacophores from chemistry.ts
// because those touch `window` / `import.meta.env.DEV` and would crash
// at first call in Node.  Property formulas are kept aligned with the
// browser implementations by deriving the same fields from the same RDKit
// JSON descriptor blob.
type MolProps = {
  mw: number; logP: number; tpsa: number; hbd: number; hba: number;
  rotBonds: number; numAromaticRings: number; fsp3: number;
  heavyAtoms: number; chi1v: number; kappa2: number; crippenMR: number;
  numHeterocycles: number; labuteASA: number;
};

function computePropsNode(smiles: string): MolProps | null {
  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return null;
    const d = JSON.parse(mol.get_descriptors());
    return {
      mw: Number(d.amw ?? d.exactmw ?? 0),
      logP: Number(d.CrippenClogP ?? 0),
      tpsa: Number(d.tpsa ?? 0),
      hbd: Number(d.lipinskiHBD ?? d.NumHBD ?? 0),
      hba: Number(d.lipinskiHBA ?? d.NumHBA ?? 0),
      rotBonds: Number(d.NumRotatableBonds ?? 0),
      numAromaticRings: Number(d.NumAromaticRings ?? 0),
      fsp3: Number(d.FractionCSP3 ?? 0),
      heavyAtoms: Number(d.NumHeavyAtoms ?? 0),
      chi1v: Number(d.chi1v ?? 0),
      kappa2: Number(d.kappa2 ?? 0),
      crippenMR: Number(d.CrippenMR ?? 0),
      numHeterocycles: Number(d.NumHeterocycles ?? 0),
      labuteASA: Number(d.labuteASA ?? 0),
    };
  } catch { return null; }
  finally { mol?.delete(); }
}

function trySubstruct(mol: any, smarts: string): boolean {
  let q: any = null;
  try {
    q = rdkit.get_qmol(smarts);
    if (!q) return false;
    const m: string = mol.get_substruct_match(q);
    return !!m && m.length > 2 && m !== "{}";
  } catch { return false; }
  finally { q?.delete(); }
}
function cntSubstruct(mol: any, smarts: string): number {
  let q: any = null;
  try {
    q = rdkit.get_qmol(smarts);
    if (!q) return 0;
    const m: string = mol.get_substruct_matches(q);
    if (!m || m.length <= 2) return 0;
    const parsed = JSON.parse(m);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
  finally { q?.delete(); }
}

function detectPharmNode(smiles: string): PharmacophoreProfile | null {
  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return null;
    const has = (s: string) => trySubstruct(mol, s);
    const cnt = (s: string) => cntSubstruct(mol, s);
    return {
      aromaticNCount:    cnt("[n]"),
      basicAmineCount:   cnt("[NX3;H1,H2;!$(NC=O);!$(NS=O);!$(N=*);!$(Nc)]"),
      aromaticAmineCount: cnt("[NX3;H1,H2;$(Nc);!$(NC=O)]"),
      acidicGroupCount:  cnt("[OX2H][CX3]=O") + cnt("[OX1H]S(=O)=O"),
      amideCount:        cnt("[NX3][CX3](=O)[#6]"),
      hasCarboxylicAcid: has("[CX3](=O)[OX2H1]"),
      hasSulfonamide:    has("[NX3]S(=O)(=O)") || has("NS(=O)(=O)"),
      hasSulfone:        has("S(=O)(=O)"),
      hasPhenol:         has("[OX2H]c"),
      hasMichaelAcceptor: has("[CX3]=[CX3][CX3]=O") || has("C=CC(=O)"),
      hasAmide:          has("[NX3][CX3](=O)[#6]"),
      hasUrea:           has("[NX3][CX3](=O)[NX3]"),
      hasTrifluoromethyl: has("[CX4](F)(F)F"),
      hasHalogen:        has("[F,Cl,Br,I]"),
      hasHydroxamicAcid: has("[CX3](=O)[NX3][OX2H]") || has("C(=O)NO"),
      hasThiol:          has("[SX2H]"),
      hasPiperidine:     has("C1CCNCC1"),
      hasPiperazine:     has("C1CNCCN1"),
      hasIndole:         has("c1ccc2[nH]ccc2c1") || has("c1cc2cc[nH]c2cc1"),
      hasQuinazoline:    has("c1cnc2ccccc2n1") || has("c1ccc2ncncc2c1"),
      hasPyrimidine:     has("c1ncccn1") || has("c1ccncn1") || has("c1nccnc1"),
      hasBenzimidazole:  has("c1ccc2[nH]cnc2c1"),
      hasEpoxide:        has("C1OC1"),
      hasPhosphate:      has("[PX4](=O)([OX2])[OX2]"),
      hasNitro:          has("[NX3](=O)=O") || has("[N+](=O)[O-]"),
      hasEster:          has("[#6][CX3](=O)[OX2][#6]"),
      hasLactam:         has("[NX3R][CX3R](=O)"),
      hasAlkoxy:         has("[OX2]([#6;!$(C=O)])[#6;!$(C=O)]"),
      hasAniline:        has("[NX3;H1,H2;$(Nc);!$(NC=O)]"),
    };
  } catch { return null; }
  finally { mol?.delete(); }
}

// ─── TSV utilities ────────────────────────────────────────────────────
function stripQuotes(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}
function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const header = lines[0].split("\t").map(stripQuotes);
  const rows = lines.slice(1).map(l => l.split("\t").map(stripQuotes));
  return { header, rows };
}

// ─── 1. Build struct_id → SMILES map ──────────────────────────────────
console.error("Loading structures.smiles.tsv …");
const structuresRaw = readFileSync(STRUCTURES_TSV, "utf-8");
const structures = parseTsv(structuresRaw);
const smilesCol = structures.header.indexOf("SMILES");
const idCol     = structures.header.indexOf("ID");
if (smilesCol < 0 || idCol < 0) {
  console.error("structures.smiles.tsv missing SMILES or ID column.");
  process.exit(1);
}
const structIdToSmiles = new Map<string, string>();
for (const r of structures.rows) {
  const id = r[idCol]; const smi = r[smilesCol];
  if (id && smi) structIdToSmiles.set(id, smi);
}
console.error(`  ${structIdToSmiles.size} structures.`);

// ─── 2. Filter interactions to allow-list + inhibition ACT_TYPEs ──────
const ACCEPTED_ACT_TYPES = new Set(["IC50", "Ki", "Kd", "pIC50", "pKi", "pKd"]);
// Map UniProt → target class (for default-TA assignment in the "with-pharm" arm).
const uniprotToClass = new Map<string, string>();
for (const accession of DRUGCENTRAL_VALIDATED_TARGETS) {
  const meta = DRUGCENTRAL_TARGET_META[accession];
  if (meta) uniprotToClass.set(accession, meta.targetClass);
}

console.error("Loading drug.target.interaction.tsv …");
const interactionsRaw = readFileSync(INTERACTIONS_TSV, "utf-8");
const interactions = parseTsv(interactionsRaw);
const I = {
  structId:  interactions.header.indexOf("STRUCT_ID"),
  gene:      interactions.header.indexOf("GENE"),
  accession: interactions.header.indexOf("ACCESSION"),
  actValue:  interactions.header.indexOf("ACT_VALUE"),
  actType:   interactions.header.indexOf("ACT_TYPE"),
  organism:  interactions.header.indexOf("ORGANISM"),
};
for (const [k, v] of Object.entries(I)) {
  if (v < 0) { console.error(`drug.target.interaction.tsv missing column: ${k}`); process.exit(1); }
}

type Row = {
  structId: string; smiles: string; gene: string; uniprotId: string;
  targetClass: string; actType: string; literaturePIC50: number;
};
const rows: Row[] = [];
for (const r of interactions.rows) {
  const accession = r[I.accession];
  // Tighten to single-accession + must be in the curated allow-list.
  if (!accession || accession.includes("|")) continue;
  const tcRec = uniprotToClass.get(accession);
  if (!tcRec) continue;

  const organism = r[I.organism];
  if (organism && organism !== "Homo sapiens") continue;

  const actType = r[I.actType];
  if (!ACCEPTED_ACT_TYPES.has(actType)) continue;

  const valStr = r[I.actValue];
  if (!valStr) continue;
  const val = Number(valStr);
  if (!Number.isFinite(val) || val <= 0) continue;

  // ACT_UNIT is blank in the 2021_09_01 dump for these rows; per the
  // DrugCentral schema, IC50/Ki/Kd are stored as nM and pIC50/pKi/pKd
  // as -log10(M).  We convert everything to pIC50-equivalent.
  let pIC50: number;
  if (actType.startsWith("p")) {
    pIC50 = val;            // already -log10(M)
  } else {
    pIC50 = 9 - Math.log10(val);   // value is nM → -log10(M)
  }
  // Filter out pathological literature values (model only ever emits 4–9.5).
  if (!Number.isFinite(pIC50) || pIC50 < 3 || pIC50 > 12) continue;

  const structId = r[I.structId];
  const smiles = structIdToSmiles.get(structId);
  if (!smiles) continue;

  rows.push({
    structId, smiles,
    gene: r[I.gene],
    uniprotId: accession,
    targetClass: tcRec,
    actType,
    literaturePIC50: pIC50,
  });
}
console.error(`  ${rows.length} eligible (compound, target, activity) rows.`);

// ─── 3. Compute mol props + pharmacophore per unique SMILES ───────────
console.error("Computing RDKit descriptors per unique SMILES …");
const uniqueSmiles = Array.from(new Set(rows.map(r => r.smiles)));
const propsCache = new Map<string, MolProps>();
const pharmCache = new Map<string, PharmacophoreProfile | null>();
let propsFails = 0;
for (let i = 0; i < uniqueSmiles.length; i++) {
  const s = uniqueSmiles[i];
  const p = computePropsNode(s);
  if (!p) { propsFails++; continue; }
  propsCache.set(s, p);
  pharmCache.set(s, detectPharmNode(s));
  if ((i + 1) % 250 === 0) console.error(`  ${i + 1}/${uniqueSmiles.length}`);
}
console.error(`  ${propsCache.size} OK, ${propsFails} failed to parse.`);

// ─── 4. Score predictions ─────────────────────────────────────────────
// Default TA per target class (used only by the "with-pharm" arm).
const classDefaultTA: Record<string, string> = {
  Kinase: "Oncology",
  Enzyme: "Oncology",      // most allow-list enzymes are oncology targets
  "Ion channel": "CNS",
};

type Score = { actual: number; predBase: number; predPartial: number; targetClass: string; actType: string };
const scores: Score[] = [];
for (const r of rows) {
  const p = propsCache.get(r.smiles);
  if (!p) continue;
  const pharm = pharmCache.get(r.smiles) ?? null;
  const base = computeBaselinePIC50(
    p.mw, p.logP, p.tpsa, p.hbd, p.hba, p.rotBonds,
    p.numAromaticRings, p.fsp3, p.heavyAtoms, p.chi1v, p.kappa2, p.crippenMR,
    p.numHeterocycles, p.labuteASA,
  );
  const ta = classDefaultTA[r.targetClass];
  const withPharm = base + computePharmacophoreBonus(pharm, ta);
  // Clamp same as runInVitroSimulation final step.  Note we do NOT apply
  // the TA potency multiplier (`taMult`) — see the Method section in the
  // report for why this arm is labelled "partial runtime".
  const predPartialClamped = Math.max(4, Math.min(9.5, withPharm));
  scores.push({
    actual: r.literaturePIC50,
    predBase: base,
    predPartial: predPartialClamped,
    targetClass: r.targetClass,
    actType: r.actType,
  });
}
console.error(`  ${scores.length} (compound, target, activity) scored.`);

// ─── 5. Stats helpers ─────────────────────────────────────────────────
// Rank each value 1..n, averaging ties (standard "average" tie-break used
// for Spearman ρ). O(n log n).
function rankAverage(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j + 2) / 2; // ranks are 1-based; sum/(count) of [i+1..j+1]
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

function summarise(label: string, arm: "predBase" | "predPartial", subset: Score[]) {
  if (subset.length === 0) return `### ${label} (${arm})\n_no data_\n\n`;
  const actuals = subset.map(s => s.actual);
  const preds   = subset.map(s => s[arm]);
  const errs    = preds.map((p, i) => p - actuals[i]);
  const absErrs = errs.map(Math.abs);
  const mae = absErrs.reduce((a, b) => a + b, 0) / errs.length;
  const rmse = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  const sorted = [...absErrs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const within1 = absErrs.filter(e => e <= 1).length / errs.length;
  const within2 = absErrs.filter(e => e <= 2).length / errs.length;
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;

  // R² (1 - SSres / SStot) — will be very negative if the predictor has a
  // strong constant bias, even with reasonable rank-order.
  const meanActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  const ssRes = errs.reduce((a, e) => a + e * e, 0);
  const ssTot = actuals.reduce((a, v) => a + Math.pow(v - meanActual, 2), 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

  const pr = pearson(actuals, preds);
  const sp = pearson(rankAverage(actuals), rankAverage(preds));   // Spearman ρ

  const armLabel = arm === "predBase"
    ? "baseline only (no TA, no pharmacophore bonus)"
    : "baseline + pharmacophore bonus (partial runtime — see Method)";
  return [
    `### ${label} — ${armLabel}`,
    ``,
    `| n | MAE | RMSE | Median \\|err\\| | Mean bias | R² | Pearson r | Spearman ρ | within ±1 logU | within ±2 logU |`,
    `|---|-----|------|---------------:|----------:|----|-----------|------------|---------------:|---------------:|`,
    `| ${subset.length} | ${mae.toFixed(2)} | ${rmse.toFixed(2)} | ${median.toFixed(2)} | ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} | ${r2.toFixed(2)} | ${pr.toFixed(2)} | ${sp.toFixed(2)} | ${(within1 * 100).toFixed(0)}% | ${(within2 * 100).toFixed(0)}% |`,
    ``,
  ].join("\n");
}

// ─── 6. Write report ──────────────────────────────────────────────────
const lines: string[] = [];
lines.push(`# L1 Bioactivity QC — DrugCentral back-test`);
lines.push(``);
lines.push(`_Auto-generated by \`scripts/qc-l1-bioactivity.mts\`. Do not edit by hand._`);
lines.push(``);
lines.push(`Run date: ${new Date().toISOString().slice(0, 10)}`);
lines.push(``);
lines.push(`## What this measures`);
lines.push(``);
lines.push(`The L1 dose-response engine (\`src/lib/inVitroSim.ts\`) emits a predicted`);
lines.push(`pIC50 from physicochemical descriptors plus an optional therapeutic-area`);
lines.push(`pharmacophore bonus.  This harness compares those predictions against`);
lines.push(`DrugCentral 2021_09_01 literature IC50 / Ki / Kd values for the **179`);
lines.push(`inhibition-compatible UniProts in our validated-target allow-list**.`);
lines.push(``);
lines.push(`The harness is **internal QC only** — its outputs are never shown to`);
lines.push(`users.  No L1 numbers in the product are derived from the harness or`);
lines.push(`from any individual DrugCentral row.`);
lines.push(``);
lines.push(`## Method`);
lines.push(``);
lines.push(`- **Data**: \`drug.target.interaction.tsv\` ⨝ \`structures.smiles.tsv\` on \`STRUCT_ID\`.`);
lines.push(`- **Filter**: \`ACCESSION\` ∈ allow-list (single-accession, human), \`ACT_TYPE\` ∈ {IC50, Ki, Kd, pIC50, pKi, pKd}, finite positive \`ACT_VALUE\`.`);
lines.push(`- **Unit handling**: IC50/Ki/Kd are nM in this dump (ACT_UNIT is blank — per DrugCentral schema); p-forms are already −log10(M).  Both converted to pIC50.`);
lines.push(`- **Two scoring arms**:`);
lines.push(`  1. \`predBase\` — \`computeBaselinePIC50\` only (no TA, no pharmacophore bonus). Measures the pure physchem prior.`);
lines.push(`  2. \`predPartial\` — \`computeBaselinePIC50 + computePharmacophoreBonus(pharm, TA)\` where TA is the default per target class (Kinase→Oncology, Enzyme→Oncology, Ion channel→CNS).`);
lines.push(`- **Clamp**: \`predPartial\` is clamped to [4.0, 9.5] (matches \`runInVitroSimulation\`).`);
lines.push(``);
lines.push(`> \`predPartial\` is **not** the full runtime prediction: the production`);
lines.push(`> \`runInVitroSimulation\` also applies a therapeutic-area \`taMult\``);
lines.push(`> potency-multiplier term from \`getTherapeuticProfile\` that this`);
lines.push(`> harness does not replicate.  In practice that term shifts the`);
lines.push(`> predicted pIC50 by a few tenths of a log unit per TA, so absolute`);
lines.push(`> error here is a lower-bound estimate of the full runtime calibration`);
lines.push(`> gap.  Rank-order metrics (Pearson r, Spearman ρ, within-±k) are`);
lines.push(`> unaffected because \`taMult\` is per-TA, not per-compound.`);
lines.push(``);
lines.push(`Note: this is a calibration benchmark, **not** a predictive-modelling`);
lines.push(`metric.  The predictor was not fit on this data; both arms therefore`);
lines.push(`have explicit prior assumptions that bias the absolute scale (in`);
lines.push(`particular, \`predBase\` rarely exits the 5.0–6.5 window).  Use MAE,`);
lines.push(`Pearson r and the within-±1/±2 columns rather than R²: a model with`);
lines.push(`reasonable rank-order but a constant offset will show low R² but`);
lines.push(`useful Pearson r.`);
lines.push(``);
lines.push(`## Overall`);
lines.push(``);
lines.push(summarise("All scored rows", "predBase", scores));
lines.push(summarise("All scored rows", "predPartial", scores));

lines.push(`## By target class`);
lines.push(``);
for (const cls of ["Kinase", "Enzyme", "Ion channel"]) {
  const sub = scores.filter(s => s.targetClass === cls);
  lines.push(summarise(cls, "predBase", sub));
  lines.push(summarise(cls, "predPartial", sub));
}

lines.push(`## By ACT_TYPE`);
lines.push(``);
for (const at of ["IC50", "Ki", "Kd", "pIC50", "pKi", "pKd"]) {
  const sub = scores.filter(s => s.actType === at);
  if (sub.length === 0) continue;
  lines.push(summarise(at, "predBase", sub));
  lines.push(summarise(at, "predPartial", sub));
}

lines.push(`## Predicted-vs-actual distribution`);
lines.push(``);
lines.push(`Cumulative distribution of |predPartial − actual| (log10 units).`);
lines.push(`Each row is the share of rows whose absolute error is **at least** the`);
lines.push(`threshold (i.e. the right-tail mass at that point).`);
lines.push(``);
const thresholds = [0, 0.5, 1, 1.5, 2, 3, 4];
const cumulativeCounts = thresholds.map(t =>
  scores.filter(s => Math.abs(s.predPartial - s.actual) >= t).length,
);
lines.push(`| \\|err\\| ≥ | count | share |`);
lines.push(`|----------|------:|------:|`);
for (let i = 0; i < thresholds.length; i++) {
  const share = scores.length > 0 ? (cumulativeCounts[i] / scores.length) * 100 : 0;
  lines.push(`| ${thresholds[i].toFixed(1)} | ${cumulativeCounts[i]} | ${share.toFixed(1)}% |`);
}
lines.push(``);

lines.push(`## Data licence`);
lines.push(``);
lines.push(`DrugCentral 2021_09_01 — CC BY-SA 4.0. Ursu O. et al., _Nucleic Acids`);
lines.push(`Res._ 2017, https://drugcentral.org. Raw TSV files are gitignored;`);
lines.push(`only this aggregated QC report and the derived allow-list are committed.`);
lines.push(``);

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, lines.join("\n"));
console.error(`Wrote ${REPORT_PATH}`);
