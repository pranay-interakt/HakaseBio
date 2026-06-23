/* ───────────────────────────────────────────────────────────────────────────
   Lab pipeline — thin orchestration over the SAME backend computation libs the
   main dashboard uses. No new science, no hardcoded / mock / fallback numbers:
   every value comes from the real engine (chemistry RDKit, aiService ML
   endpoints, runAdmetSimulation / runInVitroSimulation, computeL1Scorecard,
   computeL2DoseProjection, the confirmation engine and the IVIVE engine).

   Performance contract (why the previous version hung):
     • Target is resolved LOCALLY first (instant) so L1 sims never block on a
       live ChEMBL similarity search.
     • Every network call is wrapped in withTimeout() — nothing can hang forever.
     • All ML + ChEMBL run in ONE bounded parallel batch (Promise.allSettled).
     • onProgress() reports real phase completion, not a fake ticker.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  initChemistry, getMolecularProperties, detectPharmacophores, getRDKitInstance, isReady as chemistryReady,
  type MolecularProperties,
} from "@/lib/chemistry";
import { smilesTo3D } from "@/lib/smilesTo3D";
import {
  predictAdmetMl, predictCardiotox, predictDiliMl, predictSolubilityMl,
  predictBindingMl, predictReactiveMets, predictBsep, predictApplicabilityDomain,
  predictKnownDrug, predictPeptide,
  type MlAdmetResult, type CardiotoxResult, type DiliMlResult, type SolubilityMlResult,
  type BindingMlResult, type ReactiveMetsResult, type BsepResult,
  type ApplicabilityDomainResult, type KnownDrugResult, type PeptideResult,
} from "@/lib/aiService";
import { buildMlOverlay, overlayHasAnyMl, type MlOverlay } from "@/lib/mlOverlay";
import { runAdmetSimulation, type SimResults } from "@/lib/admet";
import { runInVitroSimulation, type InVitroResults } from "@/lib/inVitroSim";
import {
  computeL1Scorecard, type L1Scorecard,
  type KnownDrugLookup, type ApplicabilityDomain as AdEnvelope,
} from "@/lib/l1Scorecard";
import { fetchChEMBLTargets } from "@/lib/chemblTargetLookup";
import {
  suggestTargets, convertChEMBLHitsToSuggestions, type TargetSuggestion,
} from "@/lib/targetSuggestion";
import { fetchPeptideMlSignal } from "@/lib/peptideL1Plus";
import { computePeptideL1Scorecard, type PeptideScorecard } from "@/lib/peptideL1Scorecard";

// ── Curated example compounds (real, well-characterised chemistry) ────────────
export const SM_SAMPLES: Array<{ name: string; smiles: string }> = [
  { name: "Aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { name: "Imatinib", smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1" },
  { name: "Gefitinib", smiles: "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1" },
  { name: "Ibuprofen", smiles: "CC(C)Cc1ccc(C(C)C(=O)O)cc1" },
  { name: "Sorafenib", smiles: "CNC(=O)c1cc(Oc2ccc(NC(=O)Nc3ccc(Cl)c(C(F)(F)F)c3)cc2)ccn1" },
  { name: "Caffeine", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C" },
];
export const PEP_SAMPLES: Array<{ name: string; sequence: string; cyclic?: boolean }> = [
  { name: "Magainin-2 (AMP)", sequence: "GIGKFLHSAKKFGKAFVGEIMNS" },
  { name: "Melittin", sequence: "GIGAVLKVLTTGLPALISWIKRKRQQ" },
  { name: "Oxytocin (cyclic)", sequence: "CYIQNCPLG", cyclic: true },
  { name: "GLP-1 (7-37)", sequence: "HAEGTFTSDVSSYLEGQAAKEFIAWLVKGRG" },
];

// ── Starter project templates (mirror the production dashboard) ───────────────
export interface SmTemplate { name: string; indication: string; indicationCode: string; molName: string; smiles: string; uniprotId: string; }
export const SM_TEMPLATES: SmTemplate[] = [
  { name: "CDK4/6 Inhibitor Screen", indication: "Breast Cancer", indicationCode: "C50 – Breast Cancer (HR+/HER2-)", molName: "HAK-CDK4-231", smiles: "C1CN(C(=O)c2cc3cc(NC(=O)c4ccc(F)cn4)ccc3[nH]2)CCC1N", uniprotId: "P11802" },
  { name: "EGFR-T790M Mutant", indication: "NSCLC", indicationCode: "C34.1 – Non-small-cell lung carcinoma", molName: "HAK-EGFR-047", smiles: "CN(C)CCNc1nc(Nc2cccc(c2)C(F)(F)F)c3cc(OC)c(NC(=O)/C=C/CN(C)C)cc3n1", uniprotId: "P00533" },
  { name: "KRAS G12C Series", indication: "Colorectal", indicationCode: "C18 – Colorectal carcinoma", molName: "HAK-KRAS-112", smiles: "CC1(C)CCC(=C1)c1cc(NC(=O)c2ccc(F)cc2)c2ncc(-c3ccncc3)cc2n1", uniprotId: "P01116" },
];
export interface PepTemplate { name: string; indication: string; molName: string; sequence: string; uniprotId: string; }
export const PEP_TEMPLATES: PepTemplate[] = [
  { name: "GLP-1 Agonist", indication: "T2DM / Obesity", molName: "HAK-PEP-GLP1", sequence: "HAEGTFTSDVSSYLEGQAAKEFIAWLVKGR", uniprotId: "P43220" },
  { name: "PTH Analog", indication: "Osteoporosis", molName: "HAK-PEP-PTH", sequence: "SVSEIQLMHNLGKHLNSMERVEWLRKKLQDVHNF", uniprotId: "P01270" },
  { name: "Defensin-Like AMP", indication: "Antimicrobial", molName: "HAK-PEP-DEF1", sequence: "GNFLTGLGHRSDHYNKKICLGNRGIICF", uniprotId: "P60022" },
];

// ── Therapeutic-area normalisation (mirrors HakaseAI's areaMap) ──────────────
const AREA_MAP: Record<string, string> = {
  "Oncology": "Oncology", "Oncology (CML)": "Oncology",
  "Oncology (Prostate) / Endocrinology": "Oncology",
  "Oncology (Breast) / Endocrinology": "Oncology", "Oncology / Angiogenesis": "Oncology",
  "Oncology (Hematology)": "Oncology", "Oncology / CNS": "Oncology",
  "Inflammation / Oncology": "Oncology", "Immuno-Oncology": "Immunology",
  "CNS / Psychiatry": "CNS", "CNS / Pain": "CNS", "CNS / Cardiovascular": "CNS",
  "Cardiovascular": "Cardiovascular", "Metabolic / Diabetes": "Metabolic",
  "Inflammation": "Immunology", "Inflammation / Pain": "Immunology",
  "Hematology / Autoimmune": "Immunology",
  "Infectious Disease / Immunology": "Infectious Disease",
  "Pain / Inflammation": "Immunology",
};
const VALID_AREAS = ["Oncology", "CNS", "Cardiovascular", "Metabolic", "Rare Disease", "Infectious Disease", "Immunology"];
function normaliseArea(area: string | undefined | null): string {
  if (!area) return "";
  const mapped = AREA_MAP[area];
  if (mapped) return mapped;
  const fallback = area.split(/\s*[\/·]\s*/)[0].trim();
  return VALID_AREAS.find((v) => fallback.toLowerCase().startsWith(v.toLowerCase())) ?? "";
}

function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

/** Resolve a promise to its value, or null on rejection / timeout. Never throws,
 *  never hangs. This is the single guarantee that the Run button always returns. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race<T | null>([
    p.catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
}
const ML_TIMEOUT = 30_000;     // ML model endpoints (cold-start tolerant)
const CHEMBL_TIMEOUT = 12_000; // live ChEMBL — enrichment only, never blocks sims

// ── Resolved target (provenance-honest) ──────────────────────────────────────
export interface ResolvedTarget {
  uniprotId: string;
  geneName: string;
  fullName: string;
  targetClass: string;
  area: string;
  confidence: number;
  confidenceLabel: TargetSuggestion["confidenceLabel"];
  source: TargetSuggestion["source"];
  measured: boolean;
}

export interface SmallMoleculeL1Result {
  molProps: MolecularProperties;
  simResults: SimResults;
  inVitroResults: InVitroResults;
  scorecard: L1Scorecard;
  overlay: MlOverlay;
  mlAvailable: boolean;
  target: ResolvedTarget | null;
  binding: BindingMlResult | null;
  known: KnownDrugResult | null;
  applicabilityDomain: ApplicabilityDomainResult | null;
  reactiveMets: ReactiveMetsResult | null;
  bsep: BsepResult | null;
}

export interface RunSmallMoleculeOpts {
  smiles: string;
  molName: string;
  uniprotOverride?: string;
  areaOverride?: string;
  /** When true, an off-target / kinome screen is treated as validated (binding sim). */
  offTargetScreen?: boolean;
  onProgress?: (frac: number) => void;
}

function toResolved(s: TargetSuggestion, measured: boolean): ResolvedTarget {
  return {
    uniprotId: s.uniprotId, geneName: s.geneName, fullName: s.fullName,
    targetClass: s.targetClass, area: normaliseArea(s.area),
    confidence: s.confidence, confidenceLabel: s.confidenceLabel,
    source: s.source, measured,
  };
}

export async function runSmallMoleculeL1(opts: RunSmallMoleculeOpts): Promise<SmallMoleculeL1Result> {
  const smiles = opts.smiles.trim();
  const prog = opts.onProgress ?? (() => {});
  if (!smiles) throw new Error("Enter a SMILES string to analyse.");

  prog(0.05);
  await initChemistry();
  const molProps = getMolecularProperties(smiles);
  if (!molProps || !molProps.isValid) {
    throw new Error("RDKit could not parse this SMILES. Check valences, ring closures and aromaticity.");
  }
  prog(0.15);

  // ── Phase A — instant local target so sims never wait on the network ───────
  let target: ResolvedTarget | null = null;
  if (opts.uniprotOverride && opts.uniprotOverride.trim()) {
    target = {
      uniprotId: opts.uniprotOverride.trim(), geneName: "", fullName: "Manual target",
      targetClass: "", area: normaliseArea(opts.areaOverride) || (opts.areaOverride ?? ""),
      confidence: 1, confidenceLabel: "Experimental", source: "heuristic", measured: false,
    };
  } else {
    const ph = detectPharmacophores(smiles);
    const local = suggestTargets(smiles, molProps, ph);
    if (local[0]) target = toResolved(local[0], false);
  }
  const uniprotId = target?.uniprotId ?? "";
  prog(0.25);

  // ── Phase B — all ML + ChEMBL in ONE bounded parallel batch ────────────────
  const [
    admetR, cardioR, diliR, solR, bindR, reactiveR, bsepR, adR, knownR, chemblR,
  ] = await Promise.allSettled([
    withTimeout(predictAdmetMl(smiles), ML_TIMEOUT),
    withTimeout(predictCardiotox(smiles), ML_TIMEOUT),
    withTimeout(predictDiliMl(smiles), ML_TIMEOUT),
    withTimeout(predictSolubilityMl(smiles), ML_TIMEOUT),
    uniprotId ? withTimeout(predictBindingMl(smiles, uniprotId), ML_TIMEOUT) : Promise.resolve(null),
    withTimeout(predictReactiveMets(smiles), ML_TIMEOUT),
    withTimeout(predictBsep(smiles), ML_TIMEOUT),
    withTimeout(predictApplicabilityDomain(smiles), ML_TIMEOUT),
    withTimeout(predictKnownDrug(smiles), ML_TIMEOUT),
    withTimeout(fetchChEMBLTargets(smiles), CHEMBL_TIMEOUT),
  ]);
  prog(0.8);

  const admetMl = settled(admetR);
  const cardiotox = settled(cardioR);
  const dili = settled(diliR);
  const solubility = settled(solR);
  const binding = settled(bindR) as BindingMlResult | null;
  const reactiveMets = settled(reactiveR);
  const bsep = settled(bsepR);
  const ad = settled(adR);
  const known = settled(knownR);
  const chembl = settled(chemblR);

  // Prefer a MEASURED ChEMBL target for the display + sims when one came back
  // in time. Otherwise keep the instant structure-based suggestion.
  if (!opts.uniprotOverride?.trim() && chembl?.targets?.length) {
    const sug = convertChEMBLHitsToSuggestions(chembl.targets, opts.molName || chembl.compoundName || "Compound");
    if (sug[0]) target = toResolved(sug[0], chembl.method === "exact");
  }
  const finalUniprot = target?.uniprotId ?? uniprotId;
  const area = target?.area || null;
  const targetConfidence = target?.confidence ?? null;
  const predictedKd = binding?.prediction?.Kd_nM ?? null;

  // ── MlOverlay (drops any non-ml response — never coerces) ──────────────────
  const overlay = buildMlOverlay({ admet: admetMl, cardiotox, dili, binding, solubility });
  const mlAvailable = overlayHasAnyMl(overlay);

  // ── L1 engines ─────────────────────────────────────────────────────────────
  const simResults = runAdmetSimulation(
    molProps, smiles, opts.molName || "Unnamed Molecule", finalUniprot, area, predictedKd, overlay,
  );
  const inVitroResults = runInVitroSimulation(
    molProps, smiles, finalUniprot, area, !!opts.offTargetScreen, targetConfidence, predictedKd, overlay,
  );
  prog(0.92);

  // ── Scorecard adapters ─────────────────────────────────────────────────────
  const knownDrugLookup: KnownDrugLookup | null = known?.matched
    ? {
        matched: true,
        matchType: known.match_type,
        matchConfidence: known.match_confidence,
        tanimoto: known.tanimoto ?? null,
        matchedDrugName: known.matched_drug?.name ?? undefined,
        matchedDrugStatus: known.matched_drug?.status,
        withdrawalReason: known.matched_drug?.withdrawal_reason ?? undefined,
        vetoLiabilities: known.veto_liabilities ?? known.matched_drug?.liabilities?.filter((L) => L.severity === "veto"),
        monitorLiabilities: known.monitor_liabilities ?? known.matched_drug?.liabilities?.filter((L) => L.severity === "monitor"),
      } as KnownDrugLookup
    : null;

  const applicabilityDomain: AdEnvelope | null = ad
    ? {
        adScore: ad.ad_score, adLabel: ad.ad_label, adConfidence: ad.ad_confidence,
        nnSimilarity: ad.nn_similarity, coverageNote: ad.coverage_note,
      }
    : null;

  const scorecard = computeL1Scorecard({
    admet: simResults, inVitro: inVitroResults, overlay,
    knownDrugLookup, applicabilityDomain,
    reactiveMetabolites: reactiveMets
      ? { critical_count: reactiveMets.critical_count, high_count: reactiveMets.high_count }
      : null,
  });
  prog(1);

  return {
    molProps, simResults, inVitroResults, scorecard, overlay, mlAvailable, target,
    binding, known, applicabilityDomain: ad, reactiveMets, bsep,
  };
}

// ── Peptide L1 ────────────────────────────────────────────────────────────────
export interface PeptideL1Result { result: PeptideResult; scorecard: PeptideScorecard; }
export interface RunPeptideOpts {
  sequence: string; cyclic: boolean; ph: number; ionicStrength: number;
  disulfideBridges?: string; onProgress?: (frac: number) => void;
}

export async function runPeptideL1(opts: RunPeptideOpts): Promise<PeptideL1Result> {
  const seq = opts.sequence.trim().toUpperCase();
  const prog = opts.onProgress ?? (() => {});
  if (seq.length < 2) throw new Error("Enter a peptide sequence (≥ 2 residues).");
  prog(0.15);
  const result = await predictPeptide(
    seq, opts.cyclic, opts.ph, opts.ionicStrength,
    opts.disulfideBridges && opts.disulfideBridges.trim() ? opts.disulfideBridges.trim() : undefined,
  );
  prog(0.7);
  const mlSignal = await withTimeout(fetchPeptideMlSignal(seq), ML_TIMEOUT);
  const scorecard = computePeptideL1Scorecard({ result, sequence: seq, cyclic: opts.cyclic, mlSignal });
  prog(1);
  return { result, scorecard };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live-preview helpers (instant / debounced) — power the right-hand preview rail
// ─────────────────────────────────────────────────────────────────────────────

/** Instant RDKit molecular descriptors (no network). null until RDKit ready / valid SMILES. */
export function quickMolProps(smiles: string): MolecularProperties | null {
  if (!smiles.trim() || !chemistryReady()) return null;
  const p = getMolecularProperties(smiles.trim());
  return p && p.isValid ? p : null;
}

/** Real 2D depiction from RDKit (SVG string). Returns null when RDKit isn't ready. */
export function get2dSvg(smiles: string, width = 280, height = 200): string | null {
  if (!smiles.trim() || !chemistryReady()) return null;
  try {
    const rdk = getRDKitInstance();
    if (!rdk) return null;
    const mol = rdk.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) { mol?.delete?.(); return null; }
    const svg = mol.get_svg_with_highlights(JSON.stringify({
      width, height, bondLineWidth: 1.4, addStereoAnnotation: true, backgroundColour: [1, 1, 1, 0],
    }));
    mol.delete();
    return svg;
  } catch { return null; }
}

/** Instant structure-based target suggestions (no network). */
export function localTargetMatches(smiles: string, molProps: MolecularProperties): TargetSuggestion[] {
  if (!smiles.trim() || !molProps.isValid) return [];
  return suggestTargets(smiles, molProps, detectPharmacophores(smiles)).slice(0, 5);
}

/** Live ChEMBL target match (measured / similarity). Bounded by timeout. */
export interface ChemblMatch { suggestions: TargetSuggestion[]; method: "exact" | "similarity" | "none"; status: string; }
export async function chemblTargetMatches(smiles: string, name: string): Promise<ChemblMatch> {
  const r = await withTimeout(fetchChEMBLTargets(smiles.trim()), CHEMBL_TIMEOUT);
  if (!r) return { suggestions: [], method: "none", status: "timeout" };
  const suggestions = r.targets?.length ? convertChEMBLHitsToSuggestions(r.targets, name || r.compoundName || "Compound") : [];
  return { suggestions, method: r.method ?? "none", status: r.status };
}

/** Live ADMET-AI + solubility preview (bounded). Either field may be null when offline. */
export interface AdmetPreview { admet: MlAdmetResult | null; solubility: SolubilityMlResult | null; }
export async function previewAdmet(smiles: string): Promise<AdmetPreview> {
  const [a, s] = await Promise.allSettled([
    withTimeout(predictAdmetMl(smiles.trim()), ML_TIMEOUT),
    withTimeout(predictSolubilityMl(smiles.trim()), ML_TIMEOUT),
  ]);
  return { admet: settled(a), solubility: settled(s) };
}

/** MOL block for a 3Dmol viewer. Tries true 3D (RDKit ETKDG / use3D); falls back
 *  to the 2D-extruded coords from smilesTo3D so the viewer always has geometry. */
export function molBlockFor3D(smiles: string): { molblock: string; is3D: boolean } | null {
  const s = smiles.trim();
  if (!s || !chemistryReady()) return null;
  // Attempt true 3D directly via RDKit MinimalLib.
  try {
    const rdk = getRDKitInstance();
    if (rdk) {
      const mol = rdk.get_mol(s);
      if (mol && mol.is_valid()) {
        try { mol.add_hs?.(); } catch {}
        let is3D = false;
        try { mol.set_new_coords(true); is3D = true; } catch { try { mol.set_new_coords(); } catch {} }
        const mb = mol.get_molblock();
        mol.delete();
        if (mb && mb.includes("V2000")) return { molblock: mb, is3D };
      } else { mol?.delete?.(); }
    }
  } catch { /* fall through */ }
  // Fallback: 2D-extruded coords assembled into a V2000 block.
  const m = smilesTo3D(s);
  if (!m || m.atoms.length === 0) return null;
  const f = (n: number) => n.toFixed(4).padStart(10, " ");
  const counts = `${String(m.atoms.length).padStart(3, " ")}${String(m.bonds.length).padStart(3, " ")}  0  0  0  0  0  0  0  0999 V2000`;
  const atomLines = m.atoms.map((a) => `${f(a.x)}${f(a.y)}${f(a.z)} ${a.symbol.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`);
  const bondLines = m.bonds.map((b) => `${String(b.from + 1).padStart(3, " ")}${String(b.to + 1).padStart(3, " ")}${String(b.order).padStart(3, " ")}  0`);
  return { molblock: ["", "  HakaseLab", "", counts, ...atomLines, ...bondLines, "M  END"].join("\n"), is3D: false };
}

export function ensureChemistry(): Promise<void> { return initChemistry(); }
