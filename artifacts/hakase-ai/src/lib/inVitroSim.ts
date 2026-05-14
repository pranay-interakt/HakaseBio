import type { MolecularProperties, PharmacophoreProfile } from "./chemistry";
import { detectPharmacophores } from "./chemistry";
import { runBioactivationAssessment, type BioactivationAssessment } from "./bioactivationEngine";

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
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
}

function seededRandom(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return v - Math.floor(v);
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

function computeBaselinePIC50(
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

function computePharmacophoreBonus(
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

function computeCaco2Permeability(
  logP: number, tpsa: number, mw: number, hbd: number,
): { papp: number; cls: PermeabilityData["caco2Class"] } {
  let logPapp = -5.75;
  if (logP >= 0 && logP <= 4) logPapp += 0.35 * logP;
  else if (logP > 4) logPapp += 0.35 * 4 - 0.2 * (logP - 4);
  else logPapp += 0.15 * logP;

  logPapp -= 0.012 * tpsa;
  if (hbd > 3) logPapp -= 0.15 * (hbd - 3);
  if (mw > 500) logPapp -= 0.001 * (mw - 500);

  const papp = Math.pow(10, logPapp + 6) * 10;
  const pappClamped = clamp(papp, 0.1, 80);

  const cls: PermeabilityData["caco2Class"] =
    pappClamped > 20 ? "High" : pappClamped > 5 ? "Moderate" : "Low";
  return { papp: pappClamped, cls };
}

function computeMicrosomalCLint(
  logP: number, mw: number, nArom: number, fsp3: number, rotBonds: number,
): number {
  let logCLint = 0.8;
  logCLint += 0.25 * Math.max(0, logP - 1);
  if (logP > 4) logCLint += 0.3 * (logP - 4);

  logCLint += 0.0015 * mw;
  if (nArom >= 3) logCLint += 0.15 * (nArom - 2);

  logCLint -= 0.2 * fsp3;

  if (rotBonds > 8) logCLint += 0.05 * (rotBonds - 8);

  return clamp(Math.pow(10, logCLint), 3, 250);
}

function computeHERGIC50(
  logP: number, mw: number, basicN: number, tpsa: number,
  nArom: number, pharm: PharmacophoreProfile | null,
): number {
  let logIC50 = 1.8;

  logIC50 -= 0.22 * Math.max(0, logP - 2);
  if (logP > 4) logIC50 -= 0.15 * (logP - 4);

  if (basicN >= 1) logIC50 -= 0.35;
  if (basicN >= 2) logIC50 -= 0.25;

  if (pharm?.hasPiperidine || pharm?.hasPiperazine) logIC50 -= 0.2;

  logIC50 -= 0.001 * Math.max(0, mw - 350);

  if (tpsa > 100) logIC50 += 0.15;

  if (nArom >= 3) logIC50 -= 0.1 * (nArom - 2);

  return clamp(Math.pow(10, logIC50), 0.1, 100);
}

function computePPB(logP: number, mw: number, acidic: number): {
  fu: number; cls: PlasmaProteinBindingData["bindingClass"];
} {
  let logFu = 1.6;
  logFu -= 0.35 * Math.max(0, logP);
  if (logP > 3) logFu -= 0.2 * (logP - 3);

  if (acidic >= 1) logFu -= 0.3;

  if (mw > 500) logFu -= 0.1;

  const fu = clamp(Math.pow(10, logFu), 0.1, 80);
  const cls: PlasmaProteinBindingData["bindingClass"] =
    fu > 20 ? "Weakly Bound" : fu > 5 ? "Moderately Bound" : "Highly Bound";
  return { fu, cls };
}

function computeCYPInhibition(
  logP: number, mw: number, nArom: number, pharm: PharmacophoreProfile | null,
  seed: number,
): CYPInhibitionPanel {
  const base1A2 = 20 + (nArom >= 3 ? -8 : 0) + (logP > 3 ? -4 : 2);
  const base2C9 = 22 + (pharm?.hasCarboxylicAcid ? -6 : 0) + (logP > 2.5 ? -3 : 2);
  const base2C19 = 18 + (pharm?.aromaticNCount && pharm.aromaticNCount >= 2 ? -5 : 0) + (logP > 2 ? -3 : 1);
  const base2D6 = 15 + (pharm?.basicAmineCount && pharm.basicAmineCount >= 1 ? -6 : 2) + (logP > 3 ? -3 : 1);
  const base3A4 = 12 + (mw > 400 ? -4 : 2) + (logP > 3 ? -3 : 1) + (nArom >= 2 ? -2 : 0);

  const r = (offset: number) => seededRandom(seed + offset);
  const jitter = (base: number, idx: number) => clamp(base * (0.85 + r(idx) * 0.3), 1, 50);

  const cyp1a2_ic50 = jitter(clamp(base1A2, 2, 50), 101);
  const cyp2c9_ic50 = jitter(clamp(base2C9, 2, 50), 102);
  const cyp2c19_ic50 = jitter(clamp(base2C19, 2, 50), 103);
  const cyp2d6_ic50 = jitter(clamp(base2D6, 2, 50), 104);
  const cyp3a4_ic50 = jitter(clamp(base3A4, 2, 50), 105);

  return {
    CYP1A2:  { ic50_uM: +cyp1a2_ic50.toFixed(1), risk: cypRisk(cyp1a2_ic50) },
    CYP2C9:  { ic50_uM: +cyp2c9_ic50.toFixed(1), risk: cypRisk(cyp2c9_ic50) },
    CYP2C19: { ic50_uM: +cyp2c19_ic50.toFixed(1), risk: cypRisk(cyp2c19_ic50) },
    CYP2D6:  { ic50_uM: +cyp2d6_ic50.toFixed(1), risk: cypRisk(cyp2d6_ic50) },
    CYP3A4:  { ic50_uM: +cyp3a4_ic50.toFixed(1), risk: cypRisk(cyp3a4_ic50) },
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
 */
const VALIDATED_TARGET_UNIPROTS = new Set([
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
): InVitroResults {
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
  // in the validated catalog. Off-catalog molecule + no ML binding signal
  // → no IC50 / EC50 / curve, and downstream consumers (UI cards,
  // overallRisk scoring) must treat these as "no data" rather than zero.
  const hasValidatedTarget = !!uniprotId && VALIDATED_TARGET_UNIPROTS.has(uniprotId);

  const ic50_nM_raw = clamp(Math.pow(10, 9 - finalPIC50), 0.3, 50000);
  const ic50_nM: number | null = hasValidatedTarget ? ic50_nM_raw : null;
  const ec50_nM: number | null = hasValidatedTarget
    ? ic50_nM_raw * clamp(0.85 + (hashSmiles(smiles + "ec50") % 100) / 500, 0.8, 1.2)
    : null;

  const hillCoeffRaw = (() => {
    let h = 1.0;
    if (nArom >= 2) h += 0.15;
    if (fsp3 > 0.4) h += 0.1;
    if (pharm?.hasMichaelAcceptor) h += 0.3;
    if (rotBonds > 8) h -= 0.1;
    return clamp(h + (r(3) - 0.5) * 0.3, 0.7, 3.0);
  })();
  const hillCoefficient: number | null = hasValidatedTarget ? hillCoeffRaw : null;

  const maxInhibitionRaw = (() => {
    let m = 90;
    if (finalPIC50 > 7) m += 5;
    if (pharm?.hasMichaelAcceptor) m += 3;
    if (logP > 5) m -= 5;
    return clamp(m + (r(4) - 0.5) * 6, 60, 100);
  })();
  const maxInhibition: number | null = hasValidatedTarget ? maxInhibitionRaw : null;

  // Curve only when target is validated; otherwise empty array (the UI's
  // dose-response chart renders its no-data state for length === 0).
  const curve: DoseResponsePoint[] = [];
  if (hasValidatedTarget) {
    for (let i = -2; i <= 5; i += 0.5) {
      const conc = Math.pow(10, i);
      const response = maxInhibitionRaw / (1 + Math.pow(ic50_nM_raw / conc, hillCoeffRaw));
      const noise = (r(200 + i * 10) - 0.5) * 2;
      curve.push({ concentration: conc, response: clamp(response + noise, 0, 100) });
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

  const { papp: caco2Papp, cls: caco2Class } = computeCaco2Permeability(logP, tpsa, mw, hbd);
  const pampaPe = clamp(caco2Papp * (0.55 + fsp3 * 0.3), 0.1, 50);
  const pampaClass: PermeabilityData["pampaClass"] =
    pampaPe > 10 ? "High" : pampaPe > 2 ? "Moderate" : "Low";

  const effluxBase = 1.0 + (mw > 400 ? 0.5 : 0) + (tpsa > 100 ? 0.8 : 0) + (hbd > 3 ? 0.5 : 0);
  const effluxRatio = clamp(effluxBase + logP * 0.15, 0.8, 12);
  const pgpSubstrate = effluxRatio > 2.5;

  const microCLint = computeMicrosomalCLint(logP, mw, nArom, fsp3, rotBonds);
  const microsomalClass: MetabolicStabilityData["microsomalClass"] =
    microCLint < 15 ? "Stable" : microCLint < 50 ? "Moderate" : "Unstable";

  const hepatoScaling = clamp(0.4 + fsp3 * 0.2, 0.3, 0.65);
  const hepatoCLint = clamp(microCLint * hepatoScaling, 1, 150);
  const hepatocyteClass: MetabolicStabilityData["hepatocyteClass"] =
    hepatoCLint < 10 ? "Stable" : hepatoCLint < 30 ? "Moderate" : "Unstable";

  const halfLifeMin = clamp(0.693 / (microCLint / 1000) * 0.9, 5, 300);

  const cypInhibition = computeCYPInhibition(logP, mw, nArom, pharm, seed);

  const { fu: fuPercent, cls: bindingClass } = computePPB(logP, mw, acidicGroups);
  const boundPercent = 100 - fuPercent;

  const herg_ic50_uM = computeHERGIC50(logP, mw, basicN, tpsa, nArom, pharm);
  const hergMarginThreshold = taProfile.hergWeight;
  // Safety margin only meaningful when on-target IC50 exists; without a
  // validated target we cannot compute "hERG IC50 / on-target IC50".
  const safetyMargin = ic50_nM !== null ? (herg_ic50_uM * 1000) / Math.max(1, ic50_nM) : 0;
  const adjustedHergIC50 = herg_ic50_uM / hergMarginThreshold;
  const hergRisk: HERGData["riskCategory"] =
    adjustedHergIC50 < 1 ? "High" : adjustedHergIC50 < 10 ? "Moderate" : "Low";
  // RF#6 / §9 step 6: prior `patchClampResult` was three string literals
  // ("Significant block at 1 µM" / "Mild block at 10 µM" / "No significant
  // block at 30 µM") keyed off a heuristic-derived hergRisk band, falsely
  // implying patch-clamp electrophysiology. Replaced with a single honest
  // provenance phrase. Field NAME retained for safetyFlags.ts back-compat
  // (NEVER-MODIFY file).
  const patchClampResult = "Heuristic prediction from physchem (no patch-clamp data)";

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

  const cc50Base = logP > 4 ? 15 : logP > 2 ? 40 : 70;
  const cc50_uM = clamp(cc50Base + (fsp3 * 20) - (nArom > 3 ? 10 : 0), 1, 100);
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
  };
}
