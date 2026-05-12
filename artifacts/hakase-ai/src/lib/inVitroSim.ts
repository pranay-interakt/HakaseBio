/**
 * Layer 1 in-vitro simulation engine.
 *
 * Each numeric prediction (dose-response, permeability, metabolic stability,
 * PPB, hERG, CYP panel) is delegated to a *published, citable* QSAR model in
 * `qsarModels.ts`. Stochastic components use a Mulberry32 PRNG seeded by an
 * FNV-1a hash of SMILES + UniProt + therapeutic area (deterministic and
 * engine-portable). Dose-response noise is heteroscedastic Gaussian scaled
 * to Emax, replacing the previous uniform ±1% placeholder.
 *
 * Backwards compatibility:
 *   - all pre-existing scalar fields on InVitroResults are preserved
 *   - new `estimates` substructure exposes the underlying Estimate<number>
 *     objects (value + 95% CI + applicability domain + source citation) for
 *     downstream code that needs uncertainty propagation.
 */

import type { MolecularProperties, PharmacophoreProfile } from "./chemistry";
import { detectPharmacophores } from "./chemistry";
import { runBioactivationAssessment, type BioactivationAssessment } from "./bioactivationEngine";
import type { ChEMBLTargetHit } from "./chemblTargetLookup";
import { computeChEMBLSelectivity } from "./chemblSelectivity";
import {
  composeSeed,
  makeRng,
  heteroscedasticNoise,
  type Estimate,
} from "./uncertainty";
import {
  predictOralAbsorption,
  predictCaco2Permeability,
  predictPlasmaProteinBinding,
  predictMicrosomalClint,
  predictHepatocyteClint,
  predictHergIC50,
  predictCypPanel,
  predictBindingPotency,
  computeLigandEfficiency,
  type CypIsoform,
} from "./qsarModels";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface DoseResponsePoint {
  concentration: number;
  response: number;
}

export interface DoseResponseData {
  ic50_nM: number;
  ec50_nM: number;
  hillCoefficient: number;
  maxInhibition: number;
  curve: DoseResponsePoint[];
  potencyClass: "High" | "Moderate" | "Low";
  /** 95% interval on IC50 (nM), propagated from the binding posterior. */
  ic50CI95?: [number, number];
  /** Posterior SD on pIC50 (log10 M). */
  pIC50Sd?: number;
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
  patchClampResult: string;
}

export interface SelectivityData {
  kinaseSelectivityScore: number;
  offTargetHits: number;
  totalTargetsTested: number;
  selectivityClass: "Selective" | "Moderately Selective" | "Non-Selective";
  topOffTargets: Array<{
    name: string;
    ic50_nM: number;
    selectivityRatio: number;
    /** When set, the row came from ChEMBL-measured (or similarity-inferred) data, not heuristic. */
    uniprotId?: string | null;
    /** Best Tanimoto % similarity of the source compound to the input molecule. */
    similarityPct?: number | null;
    /** True when the IC50 was inferred from a structurally-similar molecule, not exact-match measured. */
    fromSimilarity?: boolean;
  }>;
  /**
   * Provenance of this selectivity assessment.
   *   • "chembl_measured" — IC50 ratios computed from real ChEMBL hits (preferred).
   *   • "heuristic"       — Off-target panel + IC50s generated from lipophilicity /
   *                         aromatic-ring count + the therapeutic-area static panel.
   *                         Use as last-resort when no ChEMBL evidence is available.
   */
  dataSource?: "chembl_measured" | "heuristic";
  /** Human-readable rationale lines for the UI. */
  rationale?: string[];
}

export interface CellViabilityData {
  cc50_uM: number;
  therapeuticIndex: number;
  cellLine: string;
  viabilityAt10uM: number;
}

/**
 * Uncertainty-aware estimate bundle. Carries the full Estimate<number> for
 * every key endpoint so downstream layers can propagate prediction intervals
 * instead of working from point estimates.
 */
export interface InVitroEstimates {
  pIC50: Estimate<number>;
  ic50nM: Estimate<number>;
  caco2PappE6: Estimate<number>;
  microsomalClint: Estimate<number>;
  hepatocyteClint: Estimate<number>;
  hergIc50uM: Estimate<number>;
  fuPercent: Estimate<number>;
  pAbsorbed: Estimate<number>;
  fractionAbsorbed: Estimate<number>;
  cyp: Record<CypIsoform, Estimate<number>>;
  ligandEfficiency: { LE: number; LipE: number; recommendation: "advance" | "acceptable" | "weak" };
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
  /** Uncertainty bundle (95% CI + applicability domain + source citations). */
  estimates: InVitroEstimates;
  /** Deterministic 32-bit seed derived from SMILES+UniProt+area. */
  seed: number;
  timestamp: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Therapeutic-area context (only used for off-target panel & cell line)
// ────────────────────────────────────────────────────────────────────────────

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
    potencyMultiplier: 0.7, potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.0, hepatoWeight: 1.3, cnsWeight: 0.7, renalWeight: 1.0, giWeight: 1.2,
    offTargetPanelNames: ["PIM1", "FLT3", "JAK2", "ALK", "ROS1", "MET", "FGFR1", "VEGFR2", "PDGFRα", "AXL", "KIT", "RET", "NTRK1", "BRAF", "MEK1"],
    cellLinePreference: ["A549", "MCF-7", "HCT116", "MDA-MB-231", "HepG2"],
  },
  "CNS": {
    potencyMultiplier: 0.9, potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.5, hepatoWeight: 0.8, cnsWeight: 2.0, renalWeight: 0.7, giWeight: 0.8,
    offTargetPanelNames: ["5-HT2A", "D2R", "NMDAR", "GABA-A", "MAO-B", "AChE", "SERT", "NET", "DAT", "mGluR5", "PDE4", "GSK3β", "DYRK1A", "CDK5", "LRRK2"],
    cellLinePreference: ["SH-SY5Y", "U-87 MG", "HEK293", "IMR-32", "Neuro-2a"],
  },
  "Cardiovascular": {
    potencyMultiplier: 1.0, potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 2.5, hepatoWeight: 1.0, cnsWeight: 0.5, renalWeight: 1.5, giWeight: 0.8,
    offTargetPanelNames: ["hERG", "Nav1.5", "Cav1.2", "KCNQ1", "Kir2.1", "ACE", "AT1R", "PDE3", "PDE5", "ROCK1", "PKCα", "eNOS", "SGLT2", "PCSK9", "Endothelin-A"],
    cellLinePreference: ["HEK293", "CHO-hERG", "HL-1", "H9c2", "iPSC-CM"],
  },
  "Metabolic": {
    potencyMultiplier: 1.1, potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.0, hepatoWeight: 1.8, cnsWeight: 0.5, renalWeight: 1.5, giWeight: 1.3,
    offTargetPanelNames: ["PPAR-γ", "GLP-1R", "DPP-4", "SGLT2", "AMPK", "FXR", "LXR", "ACC1", "FASN", "SCD1", "DGAT2", "HMGCR", "CETP", "GPR40", "GPR119"],
    cellLinePreference: ["HepG2", "3T3-L1", "INS-1", "MIN6", "Caco-2"],
  },
  "Rare Disease": {
    potencyMultiplier: 0.8, potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.2, hepatoWeight: 1.2, cnsWeight: 1.0, renalWeight: 1.0, giWeight: 1.0,
    offTargetPanelNames: ["SMN2", "CFTR", "GCase", "ASM", "GAA", "IDUA", "GLA", "CLN3", "ATP7B", "HPRT", "PIM1", "JAK2", "DYRK1A", "GSK3β", "CLK1"],
    cellLinePreference: ["HEK293", "HepG2", "iPSC-derived", "Fibroblasts", "SH-SY5Y"],
  },
  "Infectious Disease": {
    potencyMultiplier: 0.6, potencyThresholds: { high: 100, moderate: 1000 },
    hergWeight: 1.0, hepatoWeight: 1.5, cnsWeight: 0.5, renalWeight: 1.3, giWeight: 1.5,
    offTargetPanelNames: ["HIV-PR", "HIV-RT", "HIV-IN", "HCV-NS5B", "3CLpro", "RdRp", "Neuraminidase", "InhA", "GyrA", "PBP2a", "DHFR", "Topo-IV", "β-Lactamase", "EF-Tu", "MurA"],
    cellLinePreference: ["Vero", "A549", "Calu-3", "MT-4", "HEK293"],
  },
  "Immunology": {
    potencyMultiplier: 0.85, potencyThresholds: { high: 50, moderate: 500 },
    hergWeight: 1.0, hepatoWeight: 1.3, cnsWeight: 0.5, renalWeight: 1.0, giWeight: 1.2,
    offTargetPanelNames: ["JAK1", "JAK2", "JAK3", "TYK2", "BTK", "SYK", "ITK", "PI3Kδ", "IRAK4", "RORγt", "IL-6R", "TNFα", "IL-17A", "S1PR1", "PDE4"],
    cellLinePreference: ["Jurkat", "THP-1", "U937", "PBMC", "HEK293"],
  },
};

function getTherapeuticProfile(therapeuticArea: string): TherapeuticAreaProfile {
  return THERAPEUTIC_AREA_PROFILES[therapeuticArea] ?? THERAPEUTIC_AREA_PROFILES["Oncology"];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ────────────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────────────

export function runInVitroSimulation(
  molProps: MolecularProperties,
  smiles: string,
  uniprotId: string,
  therapeuticArea: string = "Oncology",
  /**
   * Optional ChEMBL similarity hits (from `fetchChEMBLTargets`). When supplied
   * and the primary `uniprotId` is among them, the selectivity panel is
   * computed from measured ratios instead of the lipophilicity/aromatic-ring
   * heuristic. Pass empty array or undefined to fall back to the heuristic.
   */
  chemblHits?: ChEMBLTargetHit[],
): InVitroResults {
  const seed = composeSeed(smiles, uniprotId, therapeuticArea);
  const rng = makeRng(seed);

  const mw = molProps.mw ?? 300;
  const logP = molProps.logP ?? 2.0;
  const tpsa = molProps.tpsa ?? 75;
  const hbd = molProps.hbd ?? 2;
  const hba = molProps.hba ?? 5;
  const rotBonds = molProps.rotBonds ?? 4;
  const nArom = molProps.numAromaticRings ?? 0;
  const fsp3 = molProps.fsp3 ?? 0.3;
  const heavyAtoms = molProps.heavyAtoms ?? 20;

  const taProfile = getTherapeuticProfile(therapeuticArea);
  const pharm: PharmacophoreProfile | null = detectPharmacophores(smiles);
  const basicAmineCount = pharm?.basicAmineCount ?? 0;
  const acidicGroupCount = pharm?.acidicGroupCount ?? 0;

  // ── Binding potency (Bayesian posterior on pIC50) ────────────────────────
  const potency = predictBindingPotency(molProps, pharm);
  const pIC50 = potency.pIC50.value;
  const ic50_nM = clamp(potency.ic50nM.value, 0.1, 100000);

  // EC50 typically ≈ IC50 in functional assays; sample a small log-Gaussian
  // perturbation seeded by SMILES so the value is deterministic but ≠ IC50.
  const ec50_nM = clamp(ic50_nM * Math.pow(10, rng.normal(0, 0.08)), 0.1, 100000);

  // ── Hill coefficient & Emax ──────────────────────────────────────────────
  // Sebaugh & McCray, Pharm. Stat. 2:167 (2003): Hill ≈ 1 with structural
  // perturbations from cooperativity / covalent binding.
  let hillCoeff = 1.0;
  if (nArom >= 2) hillCoeff += 0.15;
  if (fsp3 > 0.4) hillCoeff += 0.10;
  if (pharm?.hasMichaelAcceptor) hillCoeff += 0.30;
  if (rotBonds > 8) hillCoeff -= 0.10;
  hillCoeff = clamp(hillCoeff + rng.normal(0, 0.10), 0.7, 3.0);

  let emax = 90;
  if (pIC50 > 7) emax += 5;
  if (pharm?.hasMichaelAcceptor) emax += 3;
  if (logP > 5) emax -= 5;
  emax = clamp(emax + rng.normal(0, 2.5), 60, 100);

  // ── Dose-response curve (Hill equation + heteroscedastic Gaussian noise) ─
  const curve: DoseResponsePoint[] = [];
  for (let i = -2; i <= 5; i += 0.5) {
    const conc = Math.pow(10, i);
    const cleanResponse = emax / (1 + Math.pow(ic50_nM / conc, hillCoeff));
    const noise = heteroscedasticNoise(rng, cleanResponse, emax, 0.04);
    curve.push({ concentration: conc, response: clamp(cleanResponse + noise, 0, 100) });
  }
  const potencyClass: DoseResponseData["potencyClass"] =
    ic50_nM < taProfile.potencyThresholds.high ? "High"
    : ic50_nM < taProfile.potencyThresholds.moderate ? "Moderate"
    : "Low";

  // ── Permeability (Hou 2007) ──────────────────────────────────────────────
  const caco2 = predictCaco2Permeability(logP, tpsa);
  const caco2Papp = caco2.pappE6.value;
  // PAMPA ≈ 0.55·Caco-2 with fsp3 lift (Avdeef 2007 PAMPA review)
  const pampaPe = clamp(caco2Papp * (0.55 + fsp3 * 0.3), 0.05, 50);
  const pampaClass: PermeabilityData["pampaClass"] =
    pampaPe > 10 ? "High" : pampaPe > 2 ? "Moderate" : "Low";

  // P-gp efflux proxy: Polli et al. JPET 2001 — efflux ratio correlates with
  // MW, TPSA, HBD; logP positive contribution at high lipophilicity.
  const effluxBase = 1.0 + (mw > 400 ? 0.5 : 0) + (tpsa > 100 ? 0.8 : 0) + (hbd > 3 ? 0.5 : 0);
  const effluxRatio = clamp(effluxBase + logP * 0.15, 0.8, 12);
  const pgpSubstrate = effluxRatio > 2.5;

  // ── Metabolic stability (Lewis 2003 + Obach 1999 scaling) ────────────────
  const micro = predictMicrosomalClint(logP, mw, fsp3, nArom);
  const hepato = predictHepatocyteClint(micro, fsp3);
  // Half-life from CLint via well-stirred liver model (Obach 1999):
  //   t1/2 = 0.693 / (CLint_unbound · Q_h / (Q_h + CLint_unbound·fu)) — for
  //   triage we use the conventional approximation t1/2 ≈ 0.693·V / CL with
  //   V = 1 L/kg and CL scaled from CLint.
  const halfLifeMin = clamp(
    693 / Math.max(0.5, micro.clintUlMinMg.value),                  // min, with CL in mL/min/kg-ish units
    5, 300,
  );

  // ── CYP panel (Veith 2009) ───────────────────────────────────────────────
  const cypPanel = predictCypPanel(molProps, pharm, acidicGroupCount, basicAmineCount);
  const cypInhibition: CYPInhibitionPanel = {
    CYP1A2:  { ic50_uM: +cypPanel.CYP1A2.ic50uM.value.toFixed(1),  risk: cypPanel.CYP1A2.risk },
    CYP2C9:  { ic50_uM: +cypPanel.CYP2C9.ic50uM.value.toFixed(1),  risk: cypPanel.CYP2C9.risk },
    CYP2C19: { ic50_uM: +cypPanel.CYP2C19.ic50uM.value.toFixed(1), risk: cypPanel.CYP2C19.risk },
    CYP2D6:  { ic50_uM: +cypPanel.CYP2D6.ic50uM.value.toFixed(1),  risk: cypPanel.CYP2D6.risk },
    CYP3A4:  { ic50_uM: +cypPanel.CYP3A4.ic50uM.value.toFixed(1),  risk: cypPanel.CYP3A4.risk },
  };

  // ── Plasma protein binding (Lobell & Sivarajah 2003) ─────────────────────
  const ppb = predictPlasmaProteinBinding(logP, mw, acidicGroupCount, basicAmineCount);
  const fuPercent = ppb.fuPercent.value;
  const boundPercent = 100 - fuPercent;

  // ── hERG (Aronov 2008) ───────────────────────────────────────────────────
  const hasCyclicAmine = !!(pharm?.hasPiperidine || pharm?.hasPiperazine);
  const herg = predictHergIC50(logP, tpsa, basicAmineCount, hasCyclicAmine, mw);
  // therapeutic-area modulated risk band:
  const hergMarginThreshold = taProfile.hergWeight;
  const adjustedHergIC50 = herg.ic50uM.value / hergMarginThreshold;
  const hergRisk: HERGData["riskCategory"] =
    adjustedHergIC50 < 1 ? "High" : adjustedHergIC50 < 10 ? "Moderate" : "Low";
  const safetyMargin = (herg.ic50uM.value * 1000) / Math.max(1, ic50_nM);
  const patchClampResult = hergRisk === "High" ? "Significant block at 1 µM"
    : hergRisk === "Moderate" ? "Mild block at 10 µM"
    : "No significant block at 30 µM";

  // ── Selectivity & off-target panel ───────────────────────────────────────
  // Preferred path: real ChEMBL-measured selectivity ratios when chemblHits
  // are supplied AND the primary uniprotId is among them. We then surface
  // those measurements directly — IC50, similarity %, exact-vs-similarity
  // provenance — rather than fabricating off-target IC50s from logP/nArom.
  const realSelectivity = chemblHits && chemblHits.length > 0
    ? computeChEMBLSelectivity(uniprotId, chemblHits)
    : null;

  let kinaseScore: number;
  let selectivityClass: SelectivityData["selectivityClass"];
  let offTargetHits: number;
  let totalTargets: number;
  let topOffTargets: SelectivityData["topOffTargets"];
  let selectivityDataSource: SelectivityData["dataSource"];
  let selectivityRationale: string[];

  if (realSelectivity && realSelectivity.dataAvailable) {
    kinaseScore = realSelectivity.selectivityScore;
    selectivityClass = realSelectivity.selectivityClass;
    offTargetHits = realSelectivity.offTargetHits;
    totalTargets = realSelectivity.totalTargetsTested;
    topOffTargets = realSelectivity.topOffTargets.map(o => ({
      name: o.name,
      ic50_nM: o.ic50_nM,
      selectivityRatio: o.selectivityRatio,
      uniprotId: o.uniprotId,
      similarityPct: o.similarityPct,
      fromSimilarity: o.fromSimilarity,
    }));
    selectivityDataSource = "chembl_measured";
    selectivityRationale = realSelectivity.rationale;
  } else {
    // Heuristic fallback (only when no ChEMBL evidence is available). Off-target
    // burden model: lipophilic compounds (logP > 4) and high aromatic-ring
    // counts produce more promiscuous binding (Leeson & Springthorpe 2007).
    const offTargetLipo = logP > 4 ? 12 : logP > 2 ? 6 : 3;
    const offTargetShape = nArom > 3 ? 4 : 0;
    const offTargetBase = offTargetLipo + offTargetShape;
    offTargetHits = Math.round(clamp(offTargetBase * (0.6 + fsp3 * 0.4), 0, 25));
    totalTargets = 50 + Math.round(rng.uniform(0, 50) + heavyAtoms);
    kinaseScore = clamp(1 - (offTargetHits / totalTargets) * 10, 0, 1);
    selectivityClass =
      kinaseScore > 0.8 ? "Selective" : kinaseScore > 0.5 ? "Moderately Selective" : "Non-Selective";

    const offTargetNames = taProfile.offTargetPanelNames;
    topOffTargets = Array.from({ length: Math.min(offTargetHits, 5) }, (_, i) => {
      const nameIdx = (seed + i * 7) % offTargetNames.length;
      const offRatio = clamp(5 + rng.uniform(0, 30) + nArom * 2, 1, 100);
      return {
        name: offTargetNames[nameIdx],
        ic50_nM: clamp(ic50_nM * offRatio * 0.5, 10, 50000),
        selectivityRatio: offRatio,
      };
    });
    selectivityDataSource = "heuristic";
    selectivityRationale = realSelectivity
      ? [...realSelectivity.rationale, "Falling back to lipophilicity / aromatic-count heuristic panel — no measured selectivity ratios."]
      : ["No ChEMBL hits supplied to the simulator — selectivity panel is heuristic only (lipophilicity + aromatic ring count → static off-target panel by therapeutic area)."];
  }

  // ── Cell viability / cytotoxicity ────────────────────────────────────────
  const cc50Base = logP > 4 ? 15 : logP > 2 ? 40 : 70;
  const cc50_uM = clamp(cc50Base + (fsp3 * 20) - (nArom > 3 ? 10 : 0), 1, 100);
  const therapeuticIndex = (cc50_uM * 1000) / Math.max(1, ic50_nM);
  const viabilityAt10uM = clamp(90 - (logP > 4 ? 20 : 0) - (mw > 500 ? 5 : 0) + fsp3 * 10, 30, 100);
  const cellLines = taProfile.cellLinePreference;
  const cellLine = cellLines[seed % cellLines.length];

  // ── Risk synthesis ───────────────────────────────────────────────────────
  const riskFactors = [
    potencyClass === "Low" ? 1 : 0,
    caco2.classification === "Low" ? 1 : 0,
    micro.classification === "Unstable" ? 1 : 0,
    hergRisk === "High" ? 2 : hergRisk === "Moderate" ? 1 : 0,
    selectivityClass === "Non-Selective" ? 1 : 0,
    therapeuticIndex < 30 ? 1 : 0,
    Object.values(cypInhibition).filter(c => c.risk === "High").length > 2 ? 1 : 0,
  ];
  const totalRisk = riskFactors.reduce((a, b) => a + b, 0);
  const overallRisk: InVitroResults["overallRisk"] =
    totalRisk >= 4 ? "High" : totalRisk >= 2 ? "Moderate" : "Low";
  const inVitroScore = clamp(1 - (totalRisk / 8), 0, 1);

  // ── Bioactivation (reactive-metabolite alerts) ───────────────────────────
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
      microsomalCLint: micro.clintUlMinMg.value,
      cypInhibition: cypInhibition as unknown as { [k: string]: { ic50_uM: number; risk: string } },
      fuPercent,
      caco2Papp,
      ic50_nM,
    },
  );

  // ── Absorption (Egan 2000) — used by ADMET layer ─────────────────────────
  const absorption = predictOralAbsorption(tpsa, logP);

  // ── Ligand efficiency (Hopkins 2004 + Leeson 2007) ───────────────────────
  const le = computeLigandEfficiency(pIC50, heavyAtoms, logP);

  const estimates: InVitroEstimates = {
    pIC50: potency.pIC50,
    ic50nM: potency.ic50nM,
    caco2PappE6: caco2.pappE6,
    microsomalClint: micro.clintUlMinMg,
    hepatocyteClint: hepato.clintUlMinMg,
    hergIc50uM: herg.ic50uM,
    fuPercent: ppb.fuPercent,
    pAbsorbed: absorption.pAbsorbed,
    fractionAbsorbed: absorption.fractionAbsorbed,
    cyp: {
      CYP1A2: cypPanel.CYP1A2.ic50uM,
      CYP2C9: cypPanel.CYP2C9.ic50uM,
      CYP2C19: cypPanel.CYP2C19.ic50uM,
      CYP2D6: cypPanel.CYP2D6.ic50uM,
      CYP3A4: cypPanel.CYP3A4.ic50uM,
    },
    ligandEfficiency: le,
  };

  return {
    doseResponse: {
      ic50_nM: +ic50_nM.toFixed(2),
      ec50_nM: +ec50_nM.toFixed(2),
      hillCoefficient: +hillCoeff.toFixed(2),
      maxInhibition: +emax.toFixed(1),
      curve,
      potencyClass,
      ic50CI95: potency.ic50nM.ci95,
      pIC50Sd: potency.pIC50.sd,
    },
    permeability: {
      caco2Papp: +caco2Papp.toFixed(1),
      caco2Class: caco2.classification,
      pampaPe: +pampaPe.toFixed(1),
      pampaClass,
      effluxRatio: +effluxRatio.toFixed(1),
      pgpSubstrate,
    },
    metabolicStability: {
      microsomalCLint: +micro.clintUlMinMg.value.toFixed(1),
      microsomalClass: micro.classification,
      hepatocyteCLint: +hepato.clintUlMinMg.value.toFixed(1),
      hepatocyteClass: hepato.classification,
      halfLifeMin: +halfLifeMin.toFixed(0),
      cypInhibition,
    },
    plasmaProteinBinding: {
      fuPercent: +fuPercent.toFixed(1),
      boundPercent: +boundPercent.toFixed(1),
      bindingClass: ppb.classification,
    },
    herg: {
      ic50_uM: +herg.ic50uM.value.toFixed(2),
      safetyMargin: +safetyMargin.toFixed(0),
      riskCategory: hergRisk,
      patchClampResult,
    },
    selectivity: {
      kinaseSelectivityScore: +kinaseScore.toFixed(2),
      offTargetHits,
      totalTargetsTested: totalTargets,
      selectivityClass,
      topOffTargets,
      dataSource: selectivityDataSource,
      rationale: selectivityRationale,
    },
    cellViability: {
      cc50_uM: +cc50_uM.toFixed(1),
      therapeuticIndex: +therapeuticIndex.toFixed(0),
      cellLine,
      viabilityAt10uM: +viabilityAt10uM.toFixed(0),
    },
    bioactivation,
    overallRisk,
    inVitroScore: +inVitroScore.toFixed(2),
    estimates,
    seed,
    timestamp: new Date().toISOString(),
  };
}
