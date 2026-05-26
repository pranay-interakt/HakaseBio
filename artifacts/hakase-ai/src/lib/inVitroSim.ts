import type { MolecularProperties, PharmacophoreProfile } from "./chemistry";
import { detectPharmacophores } from "./chemistry";
import { runBioactivationAssessment, type BioactivationAssessment } from "./bioactivationEngine";
import { DRUGCENTRAL_VALIDATED_TARGETS } from "./drugcentralValidatedTargets";
import type { MlOverlay } from "./mlOverlay";
import { emptyOverlay, overlayHasAnyMl, cypProbToIc50_uM, hergProbToIc50_uM } from "./mlOverlay";
import {
  type CalDescriptors,
  calCaco2Papp,
  calPPBfuPercent,
  calHalfLifeHours,
  calHepatocyteCLint,
  calHERGBlockerProbability,
  calCYPInhibitorProbabilities,
} from "./l1Calibration";

export interface DoseResponsePoint {
  concentration: number;
  response: number;
}

export interface DoseResponseData {
  /**
   * IC50 in nM. `null` when no validated target is available (no UniProt
   * in the curated catalog AND no ML binding signal) — the simulator
   * refuses to emit an "IC50" derived from physchem alone, with no target
   * and no QSAR (audit RF#7 / §9 step 7).
   */
  ic50_nM: number | null;
  ec50_nM: number | null;
  hillCoefficient: number | null;
  maxInhibition: number | null;
  curve: DoseResponsePoint[];
  /**
   * Qualitative potency class. `null` when the therapeutic-area profile
   * is neutral / undefined (no honest threshold convention to report)
   * OR when ic50_nM is null (audit RF#12 / §9 step 11). Consumers MUST
   * render the convention next to the label when not null
   * (e.g. "High (IC50 < 10 nM, Oncology profile)").
   */
  potencyClass: "High" | "Moderate" | "Low" | null;
  /**
   * Therapeutic-area name whose threshold convention `potencyClass` was
   * computed under. Null when potencyClass is null. Surfaces in the UI
   * tooltip so the qualitative label is never shown without its
   * convention.
   */
  potencyConvention: string | null;
}

export interface PermeabilityData {
  caco2Papp: number;
  caco2Class: "High" | "Moderate" | "Low";
  pampaPe: number;
  pampaClass: "High" | "Moderate" | "Low";
  effluxRatio: number;
  pgpSubstrate: boolean;
}

export interface MetabolicStabilityData {
  microsomalCLint: number;
  microsomalClass: "Stable" | "Moderate" | "Unstable";
  hepatocyteCLint: number;
  hepatocyteClass: "Stable" | "Moderate" | "Unstable";
  halfLifeMin: number;
  cypInhibition: CYPInhibitionPanel;
}

export interface CYPInhibitionPanel {
  CYP1A2:  { ic50_uM: number; risk: "Low" | "Moderate" | "High" };
  CYP2C9:  { ic50_uM: number; risk: "Low" | "Moderate" | "High" };
  CYP2C19: { ic50_uM: number; risk: "Low" | "Moderate" | "High" };
  CYP2D6:  { ic50_uM: number; risk: "Low" | "Moderate" | "High" };
  CYP3A4:  { ic50_uM: number; risk: "Low" | "Moderate" | "High" };
}

export interface PlasmaProteinBindingData {
  fuPercent: number;
  boundPercent: number;
  bindingClass: "Highly Bound" | "Moderately Bound" | "Weakly Bound";
}

export interface HERGData {
  ic50_uM: number;
  safetyMargin: number;
  riskCategory: "Low" | "Moderate" | "High";
  /**
   * Provenance phrase — describes how `ic50_uM` was derived. The field
   * NAME is retained from the prior schema (so `safetyFlags.ts` and the
   * UI display continue to compile without modification — `safetyFlags.ts`
   * is a NEVER-MODIFY file per project policy), but the CONTENT no longer
   * masquerades as patch-clamp electrophysiology output. Today the
   * heuristic IC50 surfaces as "Heuristic prediction (no patch-clamp
   * data)"; when CardioTox ML runs the consumer overwrites with
   * "ML-predicted block (DeepHIT) — no patch-clamp data"; only real assay
   * results would surface as "Measured: <observation> at <concentration>".
   * Audit RF#6 / §9 step 6.
   */
  patchClampResult: string;
}

export interface SelectivityData {
  /**
   * Kinase selectivity score. `null` when no real off-target screen has
   * been performed (audit RF#3 / §9 step 3) — the simulator refuses to
   * emit a "selectivity" number when the denominator is fabricated.
   */
  kinaseSelectivityScore: number | null;
  /**
   * Number of off-target hits. `null` when no real screen has been run.
   */
  offTargetHits: number | null;
  /**
   * Total off-targets tested. `null` when no real off-target panel has
   * been run (audit RF#3 / §9 step 3) — the prior heuristic
   * `50 + jitter*50 + heavyAtoms` rendered as "tested against ~100
   * targets" and was a fabricated experimental claim.
   */
  totalTargetsTested: number | null;
  /**
   * Selectivity class. `null` when no real screen exists.
   */
  selectivityClass: "Selective" | "Moderately Selective" | "Non-Selective" | null;
  /**
   * Top off-target hits (empty when no real screen — audit RF#4 / §9 step 4).
   */
  topOffTargets: Array<{ name: string; ic50_nM: number; selectivityRatio: number }>;
}

export interface CellViabilityData {
  cc50_uM: number;
  therapeuticIndex: number;
  cellLine: string;
  viabilityAt10uM: number;
}

export interface InVitroResults {
  doseResponse: DoseResponseData;
  permeability: PermeabilityData;
  metabolicStability: MetabolicStabilityData;
  plasmaProteinBinding: PlasmaProteinBindingData;
  herg: HERGData;
  selectivity: SelectivityData;
  cellViability: CellViabilityData;
  bioactivation: BioactivationAssessment;
  overallRisk: "Low" | "Moderate" | "High";
  inVitroScore: number;
  timestamp: string;
  /**
   * Per-field provenance map ("ml" / "heuristic" / "experimental").
   * Stamped based on whether each value came from the ML overlay or the
   * deterministic literature rule. The L1 UI renders a per-row badge using
   * this map. Optional for backward compatibility with consumers that
   * pre-date the overlay refactor (treat missing as "all heuristic").
   */
  provenance?: Record<string, "ml" | "heuristic" | "experimental">;
  /**
   * True iff any field on this record was driven by a real ML inference.
   * Surfaces an "ML-Enhanced" badge on the In-Vitro result panel header.
   * Optional for backward compatibility (missing → render as `false`).
   */
  mlEnhanced?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Deterministic seeded PRNG using the mulberry32 algorithm.
 * Produces a float in [0, 1) from a uint32 seed.
 * Replaces the former Math.sin LCG which had poor spectral properties
 * and was not reproducible across JS engines.
 */
function seededRandom(seed: number): number {
  let t = ((seed >>> 0) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function cypRisk(ic50: number): "Low" | "Moderate" | "High" {
  if (ic50 > 20) return "Low";
  if (ic50 > 5) return "Moderate";
  return "High";
}

export interface TherapeuticAreaProfile {
  potencyMultiplier: number;
  potencyThresholds: { high: number; moderate: number };
  hergWeight: number;
  hepatoWeight: number;
  cnsWeight: number;
  renalWeight: number;
  giWeight: number;
  offTargetPanelNames: string[];
  cellLinePreference: string[];
}

const THERAPEUTIC_AREA_PROFILES: Record<string, TherapeuticAreaProfile> = {
  "Oncology": {
    potencyMultiplier: 0.7,
    potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.0, hepatoWeight: 1.3, cnsWeight: 0.7, renalWeight: 1.0, giWeight: 1.2,
    offTargetPanelNames: ["PIM1", "FLT3", "JAK2", "ALK", "ROS1", "MET", "FGFR1", "VEGFR2", "PDGFRα", "AXL", "KIT", "RET", "NTRK1", "BRAF", "MEK1"],
    cellLinePreference: ["A549", "MCF-7", "HCT116", "MDA-MB-231", "HepG2"],
  },
  "CNS": {
    potencyMultiplier: 0.9,
    potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.5, hepatoWeight: 0.8, cnsWeight: 2.0, renalWeight: 0.7, giWeight: 0.8,
    offTargetPanelNames: ["5-HT2A", "D2R", "NMDAR", "GABA-A", "MAO-B", "AChE", "SERT", "NET", "DAT", "mGluR5", "PDE4", "GSK3β", "DYRK1A", "CDK5", "LRRK2"],
    cellLinePreference: ["SH-SY5Y", "U-87 MG", "HEK293", "IMR-32", "Neuro-2a"],
  },
  "Cardiovascular": {
    potencyMultiplier: 1.0,
    potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 2.5, hepatoWeight: 1.0, cnsWeight: 0.5, renalWeight: 1.5, giWeight: 0.8,
    offTargetPanelNames: ["hERG", "Nav1.5", "Cav1.2", "KCNQ1", "Kir2.1", "ACE", "AT1R", "PDE3", "PDE5", "ROCK1", "PKCα", "eNOS", "SGLT2", "PCSK9", "Endothelin-A"],
    cellLinePreference: ["HEK293", "CHO-hERG", "HL-1", "H9c2", "iPSC-CM"],
  },
  "Metabolic": {
    potencyMultiplier: 1.1,
    potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.0, hepatoWeight: 1.8, cnsWeight: 0.5, renalWeight: 1.5, giWeight: 1.3,
    offTargetPanelNames: ["PPAR-γ", "GLP-1R", "DPP-4", "SGLT2", "AMPK", "FXR", "LXR", "ACC1", "FASN", "SCD1", "DGAT2", "HMGCR", "CETP", "GPR40", "GPR119"],
    cellLinePreference: ["HepG2", "3T3-L1", "INS-1", "MIN6", "Caco-2"],
  },
  "Rare Disease": {
    potencyMultiplier: 0.8,
    potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.2, hepatoWeight: 1.2, cnsWeight: 1.0, renalWeight: 1.0, giWeight: 1.0,
    offTargetPanelNames: ["SMN2", "CFTR", "GCase", "ASM", "GAA", "IDUA", "GLA", "CLN3", "ATP7B", "HPRT", "PIM1", "JAK2", "DYRK1A", "GSK3β", "CLK1"],
    cellLinePreference: ["HEK293", "HepG2", "iPSC-derived", "Fibroblasts", "SH-SY5Y"],
  },
  "Infectious Disease": {
    potencyMultiplier: 0.6,
    potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.0, hepatoWeight: 1.5, cnsWeight: 0.5, renalWeight: 1.3, giWeight: 1.5,
    offTargetPanelNames: ["HIV-PR", "HIV-RT", "HIV-IN", "HCV-NS5B", "3CLpro", "RdRp", "Neuraminidase", "InhA", "GyrA", "PBP2a", "DHFR", "Topo-IV", "β-Lactamase", "EF-Tu", "MurA"],
    cellLinePreference: ["Vero", "A549", "Calu-3", "MT-4", "HEK293"],
  },
  "Immunology": {
    potencyMultiplier: 0.85,
    potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.0, hepatoWeight: 1.3, cnsWeight: 0.5, renalWeight: 1.0, giWeight: 1.2,
    offTargetPanelNames: ["JAK1", "JAK2", "JAK3", "TYK2", "BTK", "SYK", "ITK", "PI3Kδ", "IRAK4", "RORγt", "IL-6R", "TNFα", "IL-17A", "S1PR1", "PDE4"],
    cellLinePreference: ["Jurkat", "THP-1", "U937", "PBMC", "HEK293"],
  },
};

// Identity / neutral therapeutic-area profile — used when no TA preset has
// been selected or inferred. potencyMultiplier=1.0 means no TA-specific
// potency adjustment; all sensitivity weights = 1.0 so toxicity scoring is
// unbiased; no curated off-target panel and no TA-preferred cell lines (the
// caller must hide / fall back instead of silently presenting an unrelated
// panel). Required to keep the simulator honest for off-catalogue chemistry
// (e.g. antioxidants like α-tocopherol) where coercing to "Oncology" would
// fabricate kinase-style off-target panels and cell-line preferences.
const TA_PROFILE_NEUTRAL: TherapeuticAreaProfile = {
  potencyMultiplier: 1.0,
  potencyThresholds: { high: 50, moderate: 500 },
  hergWeight: 1.0, hepatoWeight: 1.0, cnsWeight: 1.0, renalWeight: 1.0, giWeight: 1.0,
  offTargetPanelNames: [],
  cellLinePreference: [],
};

function getTherapeuticProfile(therapeuticArea: string | null | undefined): TherapeuticAreaProfile {
  if (!therapeuticArea) return TA_PROFILE_NEUTRAL;
  return THERAPEUTIC_AREA_PROFILES[therapeuticArea] ?? TA_PROFILE_NEUTRAL;
}

/**
 * RULE-BASED ESTIMATE — not a trained QSAR model.
 *
 * Computes a baseline pIC50 from physicochemical descriptors using a
 * hand-tuned additive scoring function anchored to mean oral-drug pIC50 ≈ 5.2.
 * Penalty/bonus terms are derived from literature correlations (logP parabola,
 * MW sweet-spot, HBD/HBA ranges, Ligand Efficiency) but have NOT been fitted
 * to a labelled dataset.  Expected MAE ≈ 0.8–1.2 log units versus DrugCentral
 * IC50 values.  Do not report as a quantitative pIC50 prediction.
 *
 * Exported for the internal L1 bioactivity QC harness
 * (scripts/qc-l1-bioactivity.mts) which back-tests this predictor against
 * DrugCentral literature IC50 / Ki / Kd values. Not part of the public
 * runtime API — UI code should call runInVitroSimulation instead.
 */
export function computeBaselinePIC50(
  mw: number, logP: number, tpsa: number,
  hbd: number, hba: number, rotBonds: number,
  nArom: number, fsp3: number, heavyAtoms: number,
  chi1v: number, kappa2: number, crippenMR: number,
  numHeterocycles: number, labuteASA: number,
): number {
  let pIC50 = 5.2;

  const logPOpt = -0.18 * Math.pow(logP - 2.5, 2) + 0.45;
  pIC50 += clamp(logPOpt, -0.6, 0.5);

  if (mw >= 300 && mw <= 500) pIC50 += 0.25;
  else if (mw >= 200 && mw < 300) pIC50 += 0.05;
  else if (mw > 500 && mw <= 650) pIC50 -= 0.15;
  else if (mw > 650) pIC50 -= 0.4;
  else if (mw < 200) pIC50 -= 0.3;

  if (tpsa >= 40 && tpsa <= 120) pIC50 += 0.15;
  else if (tpsa > 140) pIC50 -= 0.35;
  else if (tpsa < 20) pIC50 -= 0.1;

  const hbdScore = hbd >= 1 && hbd <= 3 ? 0.15 : hbd === 0 ? -0.1 : hbd <= 5 ? 0.0 : -0.2;
  pIC50 += hbdScore;

  const hbaScore = hba >= 3 && hba <= 7 ? 0.15 : hba <= 2 ? -0.05 : hba <= 10 ? 0.0 : -0.15;
  pIC50 += hbaScore;

  if (nArom >= 2 && nArom <= 4) pIC50 += 0.3;
  else if (nArom === 1) pIC50 += 0.1;
  else if (nArom > 4) pIC50 -= 0.1;

  pIC50 += clamp(fsp3 * 0.35, 0, 0.35);

  if (rotBonds > 10) pIC50 -= 0.05 * (rotBonds - 10);
  else if (rotBonds >= 2 && rotBonds <= 7) pIC50 += 0.1;

  if (chi1v > 0) {
    pIC50 += clamp((chi1v - 3) * 0.03, -0.15, 0.2);
  }

  if (kappa2 > 0) {
    pIC50 += clamp((kappa2 - 4) * 0.04, -0.15, 0.25);
  }

  if (numHeterocycles >= 1 && numHeterocycles <= 3) pIC50 += 0.15;

  if (crippenMR >= 50 && crippenMR <= 130) pIC50 += 0.1;

  if (labuteASA > 0 && heavyAtoms > 0) {
    const asaPerAtom = labuteASA / heavyAtoms;
    if (asaPerAtom >= 6 && asaPerAtom <= 12) pIC50 += 0.1;
  }

  if (heavyAtoms > 0) {
    const currentLE = (1.37 * pIC50) / heavyAtoms;
    if (currentLE > 0.4) pIC50 += 0.15;
    else if (currentLE < 0.2) pIC50 -= 0.2;
  }

  return clamp(pIC50, 4.0, 9.0);
}

// Exported for the L1 bioactivity QC harness — see computeBaselinePIC50.
export function computePharmacophoreBonus(
  pharm: PharmacophoreProfile | null,
  therapeuticArea: string | null | undefined,
): number {
  if (!pharm) return 0;
  // No TA selected → no TA-specific pharmacophore bonus. We refuse to fall
  // through to the generic "else" branch here because that branch was a
  // proxy for kinase-style chemistry; applying it to off-catalog molecules
  // (e.g. α-tocopherol) would silently inflate predicted potency.
  if (!therapeuticArea) return 0;
  let bonus = 0;

  if (therapeuticArea === "Oncology") {
    if (pharm.aromaticNCount >= 2) bonus += 0.4;
    if (pharm.hasMichaelAcceptor) bonus += 0.35;
    if (pharm.hasPyrimidine || pharm.hasQuinazoline) bonus += 0.3;
    if (pharm.hasAmide) bonus += 0.15;
    if (pharm.hasSulfonamide) bonus += 0.2;
    if (pharm.hasHalogen) bonus += 0.1;
  } else if (therapeuticArea === "CNS") {
    if (pharm.basicAmineCount >= 1) bonus += 0.5;
    if (pharm.hasPiperidine || pharm.hasPiperazine) bonus += 0.35;
    if (pharm.hasIndole) bonus += 0.3;
    if (pharm.aromaticNCount >= 1) bonus += 0.15;
    if (pharm.hasHalogen) bonus += 0.1;
  } else if (therapeuticArea === "Cardiovascular") {
    if (pharm.hasCarboxylicAcid) bonus += 0.3;
    if (pharm.hasSulfonamide) bonus += 0.25;
    if (pharm.basicAmineCount >= 1) bonus += 0.2;
    if (pharm.hasPiperidine) bonus += 0.2;
    if (pharm.aromaticNCount >= 1) bonus += 0.15;
  } else if (therapeuticArea === "Metabolic") {
    if (pharm.hasCarboxylicAcid) bonus += 0.3;
    if (pharm.hasSulfonamide) bonus += 0.2;
    if (pharm.hasPyrimidine) bonus += 0.2;
    if (pharm.basicAmineCount >= 1) bonus += 0.15;
    if (pharm.hasHalogen) bonus += 0.1;
  } else if (therapeuticArea === "Infectious Disease") {
    if (pharm.aromaticNCount >= 2) bonus += 0.4;
    if (pharm.hasPyrimidine) bonus += 0.3;
    if (pharm.hasAmide) bonus += 0.2;
    if (pharm.hasHalogen) bonus += 0.15;
    if (pharm.hasSulfonamide) bonus += 0.2;
  } else if (therapeuticArea === "Immunology") {
    if (pharm.aromaticNCount >= 2) bonus += 0.35;
    if (pharm.hasPyrimidine) bonus += 0.25;
    if (pharm.hasSulfonamide) bonus += 0.2;
    if (pharm.basicAmineCount >= 1) bonus += 0.2;
    if (pharm.hasAmide) bonus += 0.15;
  } else {
    if (pharm.aromaticNCount >= 2) bonus += 0.3;
    if (pharm.basicAmineCount >= 1) bonus += 0.2;
    if (pharm.hasHalogen) bonus += 0.1;
  }

  return clamp(bonus, 0, 1.5);
}

/**
 * CALIBRATED QSPR ESTIMATE — Ridge regression fitted to the public
 * TDC Caco2_Wang dataset (n=910, 5-fold CV R²=0.578, geomean fold-error
 * 2.5×). Replaces the former hand-tuned log-linear rule (which was never
 * fitted and showed ~3.5× benchmark fold-error). Still a heuristic
 * fallback — the ADMET-AI Caco2_Wang GNN takes priority when available.
 * Coefficients live in `l1Calibration.ts`.
 */
function computeCaco2Permeability(
  cal: CalDescriptors,
): { papp: number; cls: PermeabilityData["caco2Class"] } {
  const papp = calCaco2Papp(cal);
  const cls: PermeabilityData["caco2Class"] =
    papp > 20 ? "High" : papp > 5 ? "Moderate" : "Low";
  return { papp, cls };
}

/**
 * CALIBRATED QSPR ESTIMATE — Ridge regression fitted to the public TDC
 * Clearance_Hepatocyte_AZ dataset (n=1213). Returns HEPATOCYTE intrinsic
 * clearance (µL/min/10⁶ cells); the caller scales to microsomal CLint with
 * the published hepatocyte→microsome factor (~2.5×, Brown 2007 / Foster
 * 2011), mirroring the ML-overlay path. CLint is intrinsically hard to
 * predict from 2-D structure (CV R²≈0.05, geomean fold-error ~3×) — treat
 * as a coarse triage band. Coefficients live in `l1Calibration.ts`.
 */
function computeHepatocyteCLint(cal: CalDescriptors): number {
  return calHepatocyteCLint(cal);
}

/**
 * CALIBRATED QSAR ESTIMATE — hERG channel IC50 (µM).
 *
 * Computes the hERG blocker probability with an L2-logistic model fitted to
 * the public TDC hERG_Karim dataset (n=13,445, 5-fold CV ROC-AUC 0.739),
 * then maps probability → IC50 via the calibrated inverse-logistic shared
 * with the ML path (`hergProbToIc50_uM`, anchored p=0.5 ≈ 10 µM). Replaces
 * the former hand-tuned rule, which showed ~27× benchmark fold-error.
 *
 * This logistic fallback is a SCREEN. The CardioTox RF in the AI-service
 * (ROC-AUC ≈ 0.90 on the same chemistry) is materially stronger and takes
 * priority via the ML overlay. Actual hERG liability still requires
 * patch-clamp (IonWorks / QPatch) confirmation.
 */
function computeHERGIC50(cal: CalDescriptors): number {
  const p = calHERGBlockerProbability(cal);
  const ic50 = hergProbToIc50_uM(p);
  return ic50 === null ? 10 : clamp(ic50, 0.05, 200);
}

/**
 * CALIBRATED QSPR ESTIMATE — fraction unbound in plasma (fu, %).
 * Ridge regression on log10(fu) fitted to the public TDC PPBR_AZ dataset
 * (n=1614, 5-fold CV R²=0.358, geomean fold-error 2.8×). Replaces the
 * former hand-tuned rule (~7.5× benchmark fold-error on this panel).
 * Coefficients live in `l1Calibration.ts`.
 */
function computePPB(cal: CalDescriptors): {
  fu: number; cls: PlasmaProteinBindingData["bindingClass"];
} {
  const fu = calPPBfuPercent(cal);
  const cls: PlasmaProteinBindingData["bindingClass"] =
    fu > 20 ? "Weakly Bound" : fu > 5 ? "Moderately Bound" : "Highly Bound";
  return { fu, cls };
}

/**
 * CALIBRATED QSAR ESTIMATE — CYP isoform inhibition.
 *
 * Per-isoform L2-logistic classifiers fitted to the public TDC Veith CYP
 * inhibition datasets (CYP1A2/2C9/2C19/2D6/3A4, n≈12–13k each, 5-fold CV
 * ROC-AUC 0.75–0.85). The inhibitor probability is mapped to an IC50 (µM)
 * via the same calibrated inverse-logistic the ML overlay uses
 * (`cypProbToIc50_uM`, anchored p=0.5 ≈ 10 µM). Replaces the former
 * hand-tuned per-isoform rule with SMILES-hash jitter — output is now
 * deterministic (a molecule gives the same answer every run).
 * Actual CYP DDI risk still requires reversible + time-dependent inhibition
 * assays. Coefficients live in `l1Calibration.ts`.
 */
function computeCYPInhibition(cal: CalDescriptors): CYPInhibitionPanel {
  const probs = calCYPInhibitorProbabilities(cal);
  const toEntry = (p: number): { ic50_uM: number; risk: "Low" | "Moderate" | "High" } => {
    const ic = cypProbToIc50_uM(p);
    const v = ic === null ? 30 : clamp(ic, 0.05, 50);
    return { ic50_uM: +v.toFixed(2), risk: cypRisk(v) };
  };
  return {
    CYP1A2:  toEntry(probs.CYP1A2),
    CYP2C9:  toEntry(probs.CYP2C9),
    CYP2C19: toEntry(probs.CYP2C19),
    CYP2D6:  toEntry(probs.CYP2D6),
    CYP3A4:  toEntry(probs.CYP3A4),
  };
}

/**
 * Set of UniProt IDs for which the simulator has a validated target binding
 * signal — must be kept in sync with `TARGET_MAP` in `admet.ts`. When the
 * caller's `uniprotId` is in this set, `ic50_nM` and `potencyClass` are
 * computed; otherwise they are null (audit RF#7 / §9 step 7).
 *
 * Off-target screen availability is a SEPARATE gate (`hasValidatedScreen`
 * argument) — having a target does NOT imply the kinome / GPCR panel was
 * actually run; that requires a real off-target service which is not yet
 * wired (audit RF#3 / RF#4 / §9 steps 3–4).
 *
 * Curated seed below = kinases + HDAC family with deep in-house literature
 * coverage. Kept explicit (rather than relying only on the DrugCentral
 * allow-list) so that if the DrugCentral snapshot is regenerated against a
 * newer release that re-classifies one of these, the Layer 1 dose-response
 * gate doesn't silently regress.
 */
const CURATED_VALIDATED_TARGETS = new Set([
  // Kinases — well-characterized, abundant public IC50 data
  "P00533", // EGFR
  "P04626", // HER2 / ERBB2
  "P01116", // KRAS
  "P11802", // CDK4
  "Q00534", // CDK6
  "Q06187", // BTK
  "P00519", // ABL1
  "P15056", // BRAF
  // HDAC family — extensive published IC50 / Ki data, well-validated
  // biochemical assays (HDAC-Glo, fluorogenic peptide deacetylation)
  "Q13547", // HDAC1
  "Q92769", // HDAC2
  "O15379", // HDAC3
  "Q9UBN7", // HDAC6
  "Q9UQL6", // HDAC5
  "Q8WUI4", // HDAC7
  "Q9BY41", // HDAC8
]);

/**
 * Final allow-list = curated seed ∪ DrugCentral targets with ≥5 quantitative
 * human bioactivities. The DrugCentral expansion lifts coverage from 15 →
 * ~570 UniProts — kinases, GPCRs, ion channels, transporters, NRs — so
 * Layer 1 dose-response curves render for targets that genuinely have
 * published activity to cross-check against, without weakening the
 * "no fabrication for unvalidated targets" gate.
 *
 * DrugCentral source: CC BY-SA 4.0, Avram et al. NAR 2023 (D1276–D1287).
 * See src/lib/drugcentralValidatedTargets.ts for the full attribution and
 * the build script under scripts/build-drugcentral-allowlist.mjs.
 */
const VALIDATED_TARGET_UNIPROTS = new Set<string>([
  ...CURATED_VALIDATED_TARGETS,
  ...DRUGCENTRAL_VALIDATED_TARGETS,
]);

export function runInVitroSimulation(
  molProps: MolecularProperties,
  smiles: string,
  uniprotId: string,
  therapeuticArea: string | null = null,
  /**
   * Pass `true` only when a real off-target / kinome screen has been
   * fetched and bound to this molecule. Defaults to `false` so the audit
   * invariant "no fabricated 'tested against N' counts" holds for the
   * current MVP where no such service exists. Audit RF#3 / RF#4.
   */
  hasValidatedScreen: boolean = false,
  /**
   * Auto-match confidence for the chosen UniProt (0–1), as scored by
   * `suggestTargets` / `convertChEMBLHitsToSuggestions`. When >= 0.65
   * (the "High" / "Experimental" threshold the UI uses), the target is
   * treated as validated for dose-response generation, even if it is
   * not in the hard-coded `VALIDATED_TARGET_UNIPROTS` allow-list. Pass
   * `null` to fall back to the allow-list only.
   */
  targetConfidence: number | null = null,
  /**
   * Optional predicted Kd in nM from the backend ML model (DeepDTA-GBM / binding_ml).
   * If provided and valid, it dynamically unlocks dose-response generation
   * and populates binding potency calculations directly using the ML prediction.
   */
  predictedKd_nM: number | null = null,
  /**
   * Optional ML overlay (ADMET-AI v2 Chemprop + CardioTox / DILI /
   * Solubility / Binding RFs). When supplied, the corresponding clinical
   * readouts (Caco-2 Papp, hERG IC50, CYP panel, PPB fu%, hepatocyte
   * CL_int, half-life, P-gp substrate flag) override the deterministic
   * rule estimates. Each field's provenance is stamped in the result.
   */
  mlOverlay: MlOverlay | null = null,
): InVitroResults {
  const overlay = mlOverlay ?? emptyOverlay();
  const provenance: Record<string, "ml" | "heuristic" | "experimental"> = {};
  // Prefer Kd from the overlay over the positional `predictedKd_nM` so
  // callers that pass both stay consistent (Kd_nM is the canonical channel).
  const effectiveKd_nM = overlay.Kd_nM !== null ? overlay.Kd_nM : predictedKd_nM;
  const seed = hashSmiles(smiles);
  const mw = molProps.mw ?? 300;
  const logP = molProps.logP ?? 2.0;
  const tpsa = molProps.tpsa ?? 75;
  const hbd = molProps.hbd ?? 2;
  const hba = molProps.hba ?? 5;
  const rotBonds = molProps.rotBonds ?? 4;
  const nArom = molProps.numAromaticRings ?? 0;
  const fsp3 = molProps.fsp3 ?? 0.3;
  const heavyAtoms = molProps.heavyAtoms ?? 20;
  const chi1v = molProps.chi1v ?? 3;
  const kappa2 = molProps.kappa2 ?? 4;
  const crippenMR = molProps.crippenMR ?? 80;
  const numHeterocycles = molProps.numHeterocycles ?? 0;
  const labuteASA = molProps.labuteASA ?? 100;
  const taProfile = getTherapeuticProfile(therapeuticArea);

  const pharm = detectPharmacophores(smiles);
  const basicN = pharm?.basicAmineCount ?? 0;
  const acidicGroups = pharm?.acidicGroupCount ?? 0;

  // Descriptor bundle for the calibrated QSPR/QSAR fallback models
  // (l1Calibration.ts). Every field is a real RDKit descriptor already on
  // `molProps` or a pharmacophore count — no new descriptor is computed.
  const cal: CalDescriptors = {
    mw, logP, tpsa, hbd, hba, rotBonds,
    numAromaticRings: nArom,
    numAromaticHeterocycles: molProps.numAromaticHeterocycles ?? 0,
    fsp3, crippenMR,
    aromaticNCount: pharm?.aromaticNCount ?? 0,
    basicAmineCount: basicN,
    acidicGroupCount: acidicGroups,
  };

  const r = (offset: number) => seededRandom(seed + offset);

  const basePIC50 = computeBaselinePIC50(
    mw, logP, tpsa, hbd, hba, rotBonds,
    nArom, fsp3, heavyAtoms, chi1v, kappa2, crippenMR,
    numHeterocycles, labuteASA,
  );
  const pharmBonus = computePharmacophoreBonus(pharm, therapeuticArea);
  const taMult = taProfile.potencyMultiplier < 1 ? (1 - taProfile.potencyMultiplier) * 0.5 : -(taProfile.potencyMultiplier - 1) * 0.3;
  const finalPIC50 = clamp(basePIC50 + pharmBonus + taMult, 4.0, 9.5);

  // RF#7 / §9 step 7: only emit dose-response numbers when the UniProt is
  // in the validated catalog or has a valid neural binding (ESM-2 + GNN)
  // prediction from the backend. Off-catalog molecule with no ML binding signal
  // → no IC50 / EC50 / curve, and downstream consumers (UI cards,
  // overallRisk scoring) must treat these as "no data" rather than zero.
  // A target is treated as "validated" — and therefore eligible for
  // dose-response generation — when EITHER:
  //   (a) its UniProt is in the curated allow-list (kinases / HDACs with
  //       extensive published IC50 data), OR
  //   (b) the auto-match (suggestTargets / ChEMBL) scored it at "High"
  //       confidence (≥ 0.65), OR
  //   (c) a valid neural predictedKd_nM is active for the target.
  const hasValidatedTarget =
    !!uniprotId &&
    (VALIDATED_TARGET_UNIPROTS.has(uniprotId) ||
      (targetConfidence !== null && targetConfidence >= 0.65) ||
      effectiveKd_nM !== null);

  // ML primary path: Kd → IC50 via Cheng-Prusoff (Ki ≈ 0.85 Kd, IC50 ≈ 2 Ki
  // at assay [S] ≈ Km). Heuristic fallback: hand-tuned QSPR pIC50.
  const ic50_nM_raw = effectiveKd_nM !== null
    ? clamp(effectiveKd_nM * 0.85 * 2, 0.3, 50000)
    : clamp(Math.pow(10, 9 - finalPIC50), 0.3, 50000);
  const ic50_nM: number | null = hasValidatedTarget ? ic50_nM_raw : null;
  if (hasValidatedTarget) {
    provenance.doseResponse_IC50 = effectiveKd_nM !== null ? "ml" : "heuristic";
  }
  // EC50 — for a single-site competitive logistic dose-response the
  // half-maximal concentration IS the IC50 by definition. The former
  // SMILES-hash jitter multiplier had no physical meaning and is removed,
  // so EC50 is now a defensible, deterministic value for any molecule.
  const ec50_nM: number | null = ic50_nM;

  // Hill coefficient — deterministic: base 1.0 (single-site mass action)
  // with small, structure-based adjustments (extra aromatic rings, sp3
  // content, a Michael-acceptor warhead → steeper slope). The former
  // ±0.15 seeded-random term is removed so a molecule gives the same
  // slope every run; the 1.0–1.5 range it now produces is physically
  // sensible for an arbitrary new compound.
  const hillCoeffRaw = (() => {
    let h = 1.0;
    if (nArom >= 2) h += 0.15;
    if (fsp3 > 0.4) h += 0.1;
    if (pharm?.hasMichaelAcceptor) h += 0.3;
    if (rotBonds > 8) h -= 0.1;
    return clamp(h, 0.7, 3.0);
  })();
  const hillCoefficient: number | null = hasValidatedTarget ? hillCoeffRaw : null;

  // Maximum inhibition (Emax) — deterministic. A competitive inhibitor
  // approaches ~100 % effect at saturating dose; the former ±3 seeded-random
  // term is removed. Structure adjustments stay deterministic.
  const maxInhibitionRaw = (() => {
    let m = 90;
    if (finalPIC50 > 7) m += 5;
    if (pharm?.hasMichaelAcceptor) m += 3;
    if (logP > 5) m -= 5;
    return clamp(m, 60, 100);
  })();
  const maxInhibition: number | null = hasValidatedTarget ? maxInhibitionRaw : null;

  // Curve only when target is validated; otherwise empty array (the UI's
  // dose-response chart renders its no-data state for length === 0).
  //
  // Clean predicted 4-parameter logistic (Hill) curve:
  //   response = Emax / (1 + (IC50 / conc)^Hill)
  // The former synthetic Box-Muller "plate-reader noise" is removed — a
  // predicted curve must not masquerade as noisy measured data. Genuine
  // uncertainty belongs in a confidence band derived from the IC50
  // prediction error, not in fabricated scatter. The curve is now fully
  // deterministic and well-formed for any molecule.
  const curve: DoseResponsePoint[] = [];
  if (hasValidatedTarget) {
    for (let i = -2; i <= 5; i += 0.5) {
      const conc = Math.pow(10, i);
      const response = maxInhibitionRaw / (1 + Math.pow(ic50_nM_raw / conc, hillCoeffRaw));
      curve.push({ concentration: conc, response: clamp(response, 0, 100) });
    }
  }

  // RF#12 / §9 step 11: only emit qualitative potencyClass when both a
  // validated target AND a defined therapeutic-area threshold convention
  // exist. Neutral TA → null; unknown target → null. Surfaces convention
  // to the UI so the label is never shown without its threshold story.
  const potencyClass: DoseResponseData["potencyClass"] =
    hasValidatedTarget && therapeuticArea && ic50_nM !== null
      ? (ic50_nM < taProfile.potencyThresholds.high ? "High"
        : ic50_nM < taProfile.potencyThresholds.moderate ? "Moderate" : "Low")
      : null;
  const potencyConvention: string | null =
    potencyClass !== null && therapeuticArea
      ? `${therapeuticArea}: High < ${taProfile.potencyThresholds.high} nM, Moderate < ${taProfile.potencyThresholds.moderate} nM`
      : null;

  // ── Caco-2 / PAMPA permeability ─────────────────────────────────────────
  // Primary: ADMET-AI Caco2_Wang (Chemprop GNN, TDC Caco-2 benchmark).
  // Fallback: literature-cited logP/TPSA QSPR.
  let caco2Papp: number;
  let caco2Class: PermeabilityData["caco2Class"];
  if (overlay.caco2_Papp_1e6_cm_s !== null) {
    caco2Papp = clamp(overlay.caco2_Papp_1e6_cm_s, 0.05, 200);
    caco2Class = caco2Papp > 20 ? "High" : caco2Papp > 5 ? "Moderate" : "Low";
    provenance.caco2Papp = "ml";
  } else {
    const r = computeCaco2Permeability(cal);
    caco2Papp = r.papp; caco2Class = r.cls;
    provenance.caco2Papp = "heuristic";
  }
  const pampaPe = clamp(caco2Papp * (0.55 + fsp3 * 0.3), 0.1, 50);
  const pampaClass: PermeabilityData["pampaClass"] =
    pampaPe > 10 ? "High" : pampaPe > 2 ? "Moderate" : "Low";
  provenance.pampaPe = "heuristic";

  // ── P-gp efflux ─────────────────────────────────────────────────────────
  // Primary: ADMET-AI Pgp_Broccatelli probability → efflux ratio via
  // Polli 2001 / Schinkel calibration (substrates routinely show E.R. 3–10,
  // non-substrates ≤ 2). Fallback: legacy logP/MW/TPSA step rule.
  let effluxRatio: number;
  let pgpSubstrate: boolean;
  if (overlay.pgp_substrate_prob !== null) {
    const p = overlay.pgp_substrate_prob;
    effluxRatio = clamp(1 + 9 * p, 0.8, 12);
    pgpSubstrate = p >= 0.50;
    provenance.effluxRatio = "ml";
  } else {
    const effluxBase = 1.0 + (mw > 400 ? 0.5 : 0) + (tpsa > 100 ? 0.8 : 0) + (hbd > 3 ? 0.5 : 0);
    effluxRatio = clamp(effluxBase + logP * 0.15, 0.8, 12);
    pgpSubstrate = effluxRatio > 2.5;
    provenance.effluxRatio = "heuristic";
  }

  // ── Microsomal / hepatocyte CL_int ──────────────────────────────────────
  // Primary: ADMET-AI Clearance_Hepatocyte_AZ (µL/min/10⁶ cells). Convert
  // to microsomal CL_int using the published hepatocyte→microsome scaling
  // factor (Brown 2007 / Foster 2011 mean ratio ≈ 2.5×).
  let microCLint: number;
  let hepatoCLint: number;
  if (overlay.hepatocyte_clint_ul_min_1e6_cells !== null) {
    hepatoCLint = clamp(overlay.hepatocyte_clint_ul_min_1e6_cells, 0.5, 500);
    microCLint  = clamp(hepatoCLint * 2.5, 3, 500);
    provenance.microCLint = "ml";
    provenance.hepatoCLint = "ml";
  } else {
    // Calibrated QSPR — hepatocyte CL_int fitted to TDC Clearance_Hepatocyte_AZ
    // (l1Calibration.ts); microsomal CL_int derived with the same 2.5×
    // hepatocyte→microsome factor the ML path above uses, keeping the two
    // paths dimensionally consistent.
    hepatoCLint = clamp(computeHepatocyteCLint(cal), 0.5, 500);
    microCLint  = clamp(hepatoCLint * 2.5, 3, 500);
    provenance.microCLint = "heuristic";
    provenance.hepatoCLint = "heuristic";
  }
  const microsomalClass: MetabolicStabilityData["microsomalClass"] =
    microCLint < 15 ? "Stable" : microCLint < 50 ? "Moderate" : "Unstable";
  const hepatocyteClass: MetabolicStabilityData["hepatocyteClass"] =
    hepatoCLint < 10 ? "Stable" : hepatoCLint < 30 ? "Moderate" : "Unstable";

  // ── Plasma protein binding (moved up — required by half-life PK math) ──
  // Primary: ADMET-AI PPBR_AZ (predicted % bound → fu = 1 - bound/100).
  // Fallback: literature-cited logP/MW QSPR (Sui 2008 surrogate).
  let fuPercent: number;
  let bindingClass: PlasmaProteinBindingData["bindingClass"];
  if (overlay.ppb_fu_fraction !== null) {
    fuPercent = clamp(overlay.ppb_fu_fraction * 100, 0.05, 100);
    bindingClass = fuPercent > 20 ? "Weakly Bound" : fuPercent > 5 ? "Moderately Bound" : "Highly Bound";
    provenance.fuPercent = "ml";
  } else {
    const r = computePPB(cal);
    fuPercent = r.fu; bindingClass = r.cls;
    provenance.fuPercent = "heuristic";
  }
  const boundPercent = 100 - fuPercent;

  // ── Half-life ───────────────────────────────────────────────────────────
  // Primary: ADMET-AI Half_Life_Obach (hours; convert to minutes).
  // Fallback: calibrated direct QSPR — Ridge regression on log10(t½) fitted
  // to the public TDC Half_Life_Obach dataset (n=667, 5-fold CV geomean
  // fold-error 2.7×; coefficients in l1Calibration.ts). This replaces the
  // earlier well-stirred-liver fallback, which — having no fitted CL_int to
  // feed it — over-predicted t½ by ~9× for high-Vd / high-PPB drugs such as
  // atorvastatin. The well-stirred PBPK math still lives in
  // l2DoseProjection.ts for the Layer-2 dose projection, where a
  // measured / ML CL_int and Vd are available.
  let halfLifeMin: number;
  if (overlay.half_life_h !== null && overlay.half_life_h > 0) {
    halfLifeMin = clamp(overlay.half_life_h * 60, 1, 7200);
    provenance.halfLifeMin = "ml";
  } else {
    halfLifeMin = clamp(calHalfLifeHours(cal) * 60, 5, 7200);
    provenance.halfLifeMin = "heuristic";
  }

  // ── CYP inhibition panel ────────────────────────────────────────────────
  // Primary: per-isoform ADMET-AI CYP head (5 GNN classifiers). Probability
  // → IC50 µM via the calibrated inverse-logistic in mlOverlay. Fallback:
  // legacy linear-combination rule per isoform.
  let cypInhibition: CYPInhibitionPanel;
  const cypMlAvailable =
    overlay.cyp1a2_inhibitor_prob !== null ||
    overlay.cyp2c9_inhibitor_prob !== null ||
    overlay.cyp2c19_inhibitor_prob !== null ||
    overlay.cyp2d6_inhibitor_prob !== null ||
    overlay.cyp3a4_inhibitor_prob !== null;
  if (cypMlAvailable) {
    const mlIc50 = (p: number | null): { ic50_uM: number; risk: "Low" | "Moderate" | "High" } => {
      const ic = cypProbToIc50_uM(p);
      const v = ic === null ? 30 : clamp(ic, 0.1, 50);
      return { ic50_uM: +v.toFixed(2), risk: cypRisk(v) };
    };
    cypInhibition = {
      CYP1A2:  mlIc50(overlay.cyp1a2_inhibitor_prob),
      CYP2C9:  mlIc50(overlay.cyp2c9_inhibitor_prob),
      CYP2C19: mlIc50(overlay.cyp2c19_inhibitor_prob),
      CYP2D6:  mlIc50(overlay.cyp2d6_inhibitor_prob),
      CYP3A4:  mlIc50(overlay.cyp3a4_inhibitor_prob),
    };
    provenance.cypInhibition = "ml";
  } else {
    cypInhibition = computeCYPInhibition(cal);
    provenance.cypInhibition = "heuristic";
  }

  // (Plasma protein binding moved above — required by half-life PK math.)

  // ── hERG IC50 ───────────────────────────────────────────────────────────
  // Primary: CardioTox-ML (dedicated Wang/Karim 2016 RF). If CardioTox
  // returned a parsed IC50 band midpoint, use that. Otherwise translate the
  // blocker probability via the calibrated inverse in mlOverlay. Fallback:
  // legacy logP/HBD/basicN QSPR rule.
  let herg_ic50_uM: number;
  let hergProvenance: "ml" | "heuristic";
  if (overlay.herg_ic50_band_um !== null) {
    herg_ic50_uM = clamp(overlay.herg_ic50_band_um, 0.05, 200);
    hergProvenance = "ml";
  } else if (overlay.herg_blocker_prob !== null) {
    const ic = hergProbToIc50_uM(overlay.herg_blocker_prob);
    herg_ic50_uM = ic === null ? computeHERGIC50(cal) : clamp(ic, 0.05, 200);
    hergProvenance = "ml";
  } else {
    herg_ic50_uM = computeHERGIC50(cal);
    hergProvenance = "heuristic";
  }
  provenance.herg_ic50_uM = hergProvenance;
  const hergMarginThreshold = taProfile.hergWeight;
  // Safety margin only meaningful when on-target IC50 exists; without a
  // validated target we cannot compute "hERG IC50 / on-target IC50".
  const safetyMargin = ic50_nM !== null ? (herg_ic50_uM * 1000) / Math.max(1, ic50_nM) : 0;
  const adjustedHergIC50 = herg_ic50_uM / hergMarginThreshold;
  // hERG risk band — prefer the CardioTox RF class when available, else
  // fall back to the µM-band rule (which still respects TA weighting).
  const hergRisk: HERGData["riskCategory"] = overlay.herg_blocker_prob !== null
    ? (overlay.herg_blocker_prob >= 0.66 ? "High"
       : overlay.herg_blocker_prob >= 0.33 ? "Moderate" : "Low")
    : (adjustedHergIC50 < 1 ? "High" : adjustedHergIC50 < 10 ? "Moderate" : "Low");
  provenance.hergRisk = overlay.herg_blocker_prob !== null ? "ml" : "heuristic";
  // Honest provenance phrase. Field NAME retained for safetyFlags.ts
  // back-compat (NEVER-MODIFY file), but the CONTENT reflects what
  // actually ran instead of falsely implying patch-clamp data.
  const patchClampResult = overlay.herg_blocker_prob !== null
    ? `CardioTox-ML blocker probability ${(overlay.herg_blocker_prob * 100).toFixed(0)}% (Wang/Karim 2016 hERG RF — no patch-clamp data)`
    : "Heuristic prediction from physchem (no patch-clamp data)";

  // RF#3 / RF#4 / §9 steps 3–4: gate ALL selectivity output on
  // `hasValidatedScreen`. Without a real off-target panel run, the
  // simulator emits null for the "tested against N" count, the off-target
  // hit count, the kinase selectivity score, and the qualitative class —
  // and an empty list of named off-target hits.
  let totalTargets: number | null = null;
  let offTargetHits: number | null = null;
  let kinaseScore: number | null = null;
  let selectivityClass: SelectivityData["selectivityClass"] = null;
  let topOffTargets: SelectivityData["topOffTargets"] = [];

  if (hasValidatedScreen) {
    totalTargets = 50 + Math.round(r(18) * 50 + heavyAtoms);
    const offTargetLogP = logP > 4 ? 12 : logP > 2 ? 6 : 3;
    const offTargetShape = nArom > 3 ? 4 : 0;
    const offTargetBase = offTargetLogP + offTargetShape;
    offTargetHits = Math.round(clamp(offTargetBase * (0.6 + fsp3 * 0.4), 0, 25));
    kinaseScore = clamp(1 - (offTargetHits / totalTargets) * 10, 0, 1);
    selectivityClass =
      kinaseScore > 0.8 ? "Selective" : kinaseScore > 0.5 ? "Moderately Selective" : "Non-Selective";

    const offTargetNames = taProfile.offTargetPanelNames;
    // Even with hasValidatedScreen, the TA panel must be non-empty AND
    // the on-target IC50 must be computable for off-target ratios to mean
    // anything. Otherwise emit empty list.
    if (offTargetNames.length > 0 && ic50_nM !== null) {
      const ic50OnTarget = ic50_nM;
      topOffTargets = Array.from({ length: Math.min(offTargetHits, 5) }, (_, i) => {
        const nameIdx = (seed + i * 7) % offTargetNames.length;
        const offRatio = 5 + (kappa2 + chi1v) * 2 + r(40 + i) * 30;
        return {
          name: offTargetNames[nameIdx],
          ic50_nM: clamp(ic50OnTarget * offRatio * 0.5, 10, 50000),
          selectivityRatio: clamp(offRatio, 1, 100),
        };
      });
    }
  }

  // ── Cytotoxicity CC50 ───────────────────────────────────────────────────
  // No dedicated CC50 head exists in ai-service today. The LD50_Zhu acute
  // tox endpoint is the closest analogue; when available we map LD50 mg/kg
  // → CC50 µM via the empirically observed correlation in Lou 2014 (oral
  // LD50 ~ 10⁰·⁵ × HepG2 CC50, r ≈ 0.6). Without an ML signal we keep the
  // literature-derived logP/Fsp3/aromatic-ring rule.
  let cc50_uM: number;
  if (overlay.ld50_mg_per_kg !== null && overlay.ld50_mg_per_kg > 0) {
    const logCc = Math.log10(overlay.ld50_mg_per_kg) - 0.5;
    cc50_uM = clamp(Math.pow(10, logCc), 1, 200);
    provenance.cc50_uM = "ml";
  } else {
    const cc50Base = logP > 4 ? 15 : logP > 2 ? 40 : 70;
    cc50_uM = clamp(cc50Base + (fsp3 * 20) - (nArom > 3 ? 10 : 0), 1, 100);
    provenance.cc50_uM = "heuristic";
  }
  // Therapeutic index only meaningful when on-target IC50 exists.
  const therapeuticIndex = ic50_nM !== null ? (cc50_uM * 1000) / Math.max(1, ic50_nM) : 0;
  const viabilityAt10uM = clamp(90 - (logP > 4 ? 20 : 0) - (mw > 500 ? 5 : 0) + fsp3 * 10, 30, 100);
  const cellLines = taProfile.cellLinePreference;
  // Empty list → no TA selected (neutral profile). Emit a sentinel string
  // ("—") rather than `undefined` so the type contract holds and the UI
  // renders an honest "no preferred cell line" placeholder instead of the
  // literal text "undefined".
  const cellLine = cellLines.length === 0 ? "—" : cellLines[seed % cellLines.length];

  const riskFactors = [
    potencyClass === "Low" ? 1 : 0,
    caco2Class === "Low" ? 1 : 0,
    microsomalClass === "Unstable" ? 1 : 0,
    hergRisk === "High" ? 2 : hergRisk === "Moderate" ? 1 : 0,
    selectivityClass === "Non-Selective" ? 1 : 0,
    // Therapeutic-index risk only counts when on-target IC50 was real
    // (otherwise therapeuticIndex is 0 and would look like infinite risk).
    ic50_nM !== null && therapeuticIndex < 30 ? 1 : 0,
    Object.values(cypInhibition).filter(c => c.risk === "High").length > 2 ? 1 : 0,
  ];
  const totalRisk = riskFactors.reduce((a, b) => a + b, 0);
  const overallRisk: InVitroResults["overallRisk"] =
    totalRisk >= 4 ? "High" : totalRisk >= 2 ? "Moderate" : "Low";

  const inVitroScore = clamp(1 - (totalRisk / 8), 0, 1);

  const bioactivation = runBioactivationAssessment(
    {
      smiles,
      molecularWeight: mw,
      logP,
      tpsa,
      hbdCount: hbd,
      hbaCount: hba,
      rotatableBonds: rotBonds,
    },
    {
      hergRisk,
      microsomalCLint: microCLint,
      cypInhibition: cypInhibition as unknown as { [key: string]: { ic50_uM: number; risk: string } },
      fuPercent,
      caco2Papp,
      // Bioactivation engine takes a baseline IC50 to scale GSH-trap
      // recommendations. Pass 0 when on-target IC50 is not computable —
      // engine treats 0 as "no on-target potency signal" and falls back
      // to logP/CYP inhibition signals only.
      ic50_nM: ic50_nM ?? 0,
    }
  );

  return {
    doseResponse: {
      ic50_nM: ic50_nM === null ? null : +ic50_nM.toFixed(2),
      ec50_nM: ec50_nM === null ? null : +ec50_nM.toFixed(2),
      hillCoefficient: hillCoefficient === null ? null : +hillCoefficient.toFixed(2),
      maxInhibition: maxInhibition === null ? null : +maxInhibition.toFixed(1),
      curve,
      potencyClass,
      potencyConvention,
    },
    permeability: { caco2Papp: +caco2Papp.toFixed(1), caco2Class, pampaPe: +pampaPe.toFixed(1), pampaClass, effluxRatio: +effluxRatio.toFixed(1), pgpSubstrate },
    metabolicStability: {
      microsomalCLint: +microCLint.toFixed(1), microsomalClass,
      hepatocyteCLint: +hepatoCLint.toFixed(1), hepatocyteClass,
      halfLifeMin: +halfLifeMin.toFixed(0), cypInhibition,
    },
    plasmaProteinBinding: { fuPercent: +fuPercent.toFixed(1), boundPercent: +boundPercent.toFixed(1), bindingClass },
    herg: { ic50_uM: +herg_ic50_uM.toFixed(1), safetyMargin: +safetyMargin.toFixed(0), riskCategory: hergRisk, patchClampResult },
    selectivity: {
      kinaseSelectivityScore: kinaseScore === null ? null : +kinaseScore.toFixed(2),
      offTargetHits,
      totalTargetsTested: totalTargets,
      selectivityClass,
      topOffTargets,
    },
    cellViability: {
      cc50_uM: +cc50_uM.toFixed(1),
      // Therapeutic index is meaningless without on-target IC50; render 0
      // and let the consumer treat it as "not computable" (the surface UI
      // still reads `iv.doseResponse.ic50_nM === null` to know to suppress
      // TI display).
      therapeuticIndex: ic50_nM === null ? 0 : +therapeuticIndex.toFixed(0),
      cellLine,
      viabilityAt10uM: +viabilityAt10uM.toFixed(0),
    },
    bioactivation,
    overallRisk,
    inVitroScore: +inVitroScore.toFixed(2),
    timestamp: new Date().toISOString(),
    provenance,
    mlEnhanced: overlayHasAnyMl(overlay),
  };
}
