import type { MolecularProperties } from "./chemistry";
import { runBioactivationAssessment, type BioactivationAssessment } from "./bioactivationEngine";

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

function seededRandom(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return v - Math.floor(v);
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
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

function getTherapeuticProfile(therapeuticArea: string): TherapeuticAreaProfile {
  return THERAPEUTIC_AREA_PROFILES[therapeuticArea] ?? THERAPEUTIC_AREA_PROFILES["Oncology"];
}

export function runInVitroSimulation(
  molProps: MolecularProperties,
  smiles: string,
  uniprotId: string,
  therapeuticArea: string = "Oncology",
): InVitroResults {
  const seed = hashSmiles(smiles);
  const mw = molProps.molecularWeight ?? 300;
  const logP = molProps.logP ?? 2.0;
  const tpsa = molProps.tpsa ?? 75;
  const hbd = molProps.hbdCount ?? 2;
  const hba = molProps.hbaCount ?? 5;
  const rotBonds = molProps.rotatableBonds ?? 4;
  const taProfile = getTherapeuticProfile(therapeuticArea);

  const r = (offset: number) => seededRandom(seed + offset);

  const ic50Base = 10 + (mw / 100) * 8 + Math.abs(logP - 3) * 15;
  const ic50_nM = clamp(ic50Base * taProfile.potencyMultiplier * (0.6 + r(1) * 0.8), 0.5, 5000);
  const ec50_nM = ic50_nM * (0.8 + r(2) * 0.4);
  const hillCoeff = clamp(0.8 + r(3) * 1.5, 0.7, 3.0);
  const maxInhibition = clamp(85 + r(4) * 15, 60, 100);

  const curve: DoseResponsePoint[] = [];
  for (let i = -2; i <= 5; i += 0.5) {
    const conc = Math.pow(10, i);
    const response = maxInhibition / (1 + Math.pow(ic50_nM / conc, hillCoeff));
    curve.push({ concentration: conc, response: clamp(response + (r(100 + i * 10) - 0.5) * 3, 0, 100) });
  }

  const potencyClass: DoseResponseData["potencyClass"] =
    ic50_nM < taProfile.potencyThresholds.high ? "High" : ic50_nM < taProfile.potencyThresholds.moderate ? "Moderate" : "Low";

  const caco2Base = logP > 0 && logP < 5 ? 15 + (logP * 5) : 5;
  const tpsaPenalty = tpsa > 140 ? 0.3 : tpsa > 90 ? 0.7 : 1.0;
  const caco2Papp = clamp(caco2Base * tpsaPenalty * (0.7 + r(5) * 0.6), 0.5, 60);
  const caco2Class: PermeabilityData["caco2Class"] =
    caco2Papp > 20 ? "High" : caco2Papp > 5 ? "Moderate" : "Low";

  const pampaPe = clamp(caco2Papp * (0.6 + r(6) * 0.5), 0.1, 50);
  const pampaClass: PermeabilityData["pampaClass"] =
    pampaPe > 10 ? "High" : pampaPe > 2 ? "Moderate" : "Low";

  const effluxRatio = clamp(1 + (mw / 200) * (0.5 + r(7) * 1.5), 0.8, 12);
  const pgpSubstrate = effluxRatio > 2.5;

  const lipophilicFactor = logP > 3 ? 0.6 : logP > 1 ? 1.0 : 1.3;
  const microCLint = clamp(12 + (mw * 0.08) * lipophilicFactor * (0.7 + r(8) * 0.6), 3, 200);
  const microsomalClass: MetabolicStabilityData["microsomalClass"] =
    microCLint < 15 ? "Stable" : microCLint < 50 ? "Moderate" : "Unstable";

  const hepatoCLint = clamp(microCLint * (0.5 + r(9) * 0.4), 1, 150);
  const hepatocyteClass: MetabolicStabilityData["hepatocyteClass"] =
    hepatoCLint < 10 ? "Stable" : hepatoCLint < 30 ? "Moderate" : "Unstable";

  const halfLifeMin = clamp(0.693 / (microCLint / 1000) * (0.8 + r(10) * 0.4), 5, 300);

  const cyp1a2_ic50 = clamp(5 + r(11) * 45, 1, 50);
  const cyp2c9_ic50 = clamp(8 + r(12) * 40, 1, 50);
  const cyp2c19_ic50 = clamp(6 + r(13) * 42, 1, 50);
  const cyp2d6_ic50 = clamp(4 + r(14) * 46, 1, 50);
  const cyp3a4_ic50 = clamp(3 + logP * 2 + r(15) * 30, 1, 50);

  const cypInhibition: CYPInhibitionPanel = {
    CYP1A2:  { ic50_uM: +cyp1a2_ic50.toFixed(1), risk: cypRisk(cyp1a2_ic50) },
    CYP2C9:  { ic50_uM: +cyp2c9_ic50.toFixed(1), risk: cypRisk(cyp2c9_ic50) },
    CYP2C19: { ic50_uM: +cyp2c19_ic50.toFixed(1), risk: cypRisk(cyp2c19_ic50) },
    CYP2D6:  { ic50_uM: +cyp2d6_ic50.toFixed(1), risk: cypRisk(cyp2d6_ic50) },
    CYP3A4:  { ic50_uM: +cyp3a4_ic50.toFixed(1), risk: cypRisk(cyp3a4_ic50) },
  };

  const fuBase = logP < 1 ? 40 : logP < 3 ? 15 : logP < 5 ? 5 : 1;
  const fuPercent = clamp(fuBase * (0.7 + r(16) * 0.6), 0.1, 80);
  const boundPercent = 100 - fuPercent;
  const bindingClass: PlasmaProteinBindingData["bindingClass"] =
    fuPercent > 20 ? "Weakly Bound" : fuPercent > 5 ? "Moderately Bound" : "Highly Bound";

  const hergBase = logP > 3 ? 3 + r(17) * 10 : 10 + r(17) * 40;
  const herg_ic50_uM = clamp(hergBase * (mw > 400 ? 0.7 : 1.2), 0.3, 50);
  const hergMarginThreshold = taProfile.hergWeight;
  const safetyMargin = (herg_ic50_uM * 1000) / Math.max(1, ic50_nM);
  const adjustedHergIC50 = herg_ic50_uM / hergMarginThreshold;
  const hergRisk: HERGData["riskCategory"] =
    adjustedHergIC50 < 1 ? "High" : adjustedHergIC50 < 10 ? "Moderate" : "Low";
  const patchClampResult = hergRisk === "High" ? "Significant block at 1 µM"
    : hergRisk === "Moderate" ? "Mild block at 10 µM" : "No significant block at 30 µM";

  const totalTargets = 50 + Math.round(r(18) * 100);
  const offTargetBase = logP > 4 ? 12 : logP > 2 ? 6 : 3;
  const offTargetHits = Math.round(clamp(offTargetBase * (0.5 + r(19) * 1.0), 0, 25));
  const kinaseScore = clamp(1 - (offTargetHits / totalTargets) * 10, 0, 1);
  const selectivityClass: SelectivityData["selectivityClass"] =
    kinaseScore > 0.8 ? "Selective" : kinaseScore > 0.5 ? "Moderately Selective" : "Non-Selective";

  const offTargetNames = taProfile.offTargetPanelNames;
  const topOffTargets = Array.from({ length: Math.min(offTargetHits, 5) }, (_, i) => ({
    name: offTargetNames[Math.floor(r(20 + i) * offTargetNames.length)],
    ic50_nM: clamp(ic50_nM * (5 + r(30 + i) * 50), 10, 10000),
    selectivityRatio: clamp(5 + r(40 + i) * 50, 1, 100),
  }));

  const cc50_uM = clamp(10 + r(50) * 90, 1, 100);
  const therapeuticIndex = (cc50_uM * 1000) / Math.max(1, ic50_nM);
  const viabilityAt10uM = clamp(85 + r(51) * 15 - (logP > 4 ? 20 : 0), 30, 100);
  const cellLines = taProfile.cellLinePreference;
  const cellLine = cellLines[Math.floor(r(52) * cellLines.length)];

  const riskFactors = [
    potencyClass === "Low" ? 1 : 0,
    caco2Class === "Low" ? 1 : 0,
    microsomalClass === "Unstable" ? 1 : 0,
    hergRisk === "High" ? 2 : hergRisk === "Moderate" ? 1 : 0,
    selectivityClass === "Non-Selective" ? 1 : 0,
    therapeuticIndex < 30 ? 1 : 0,
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
      ic50_nM,
    }
  );

  return {
    doseResponse: { ic50_nM, ec50_nM, hillCoefficient: hillCoeff, maxInhibition, curve, potencyClass },
    permeability: { caco2Papp, caco2Class, pampaPe, pampaClass, effluxRatio, pgpSubstrate },
    metabolicStability: {
      microsomalCLint: microCLint, microsomalClass,
      hepatocyteCLint: hepatoCLint, hepatocyteClass,
      halfLifeMin, cypInhibition,
    },
    plasmaProteinBinding: { fuPercent, boundPercent, bindingClass },
    herg: { ic50_uM: herg_ic50_uM, safetyMargin, riskCategory: hergRisk, patchClampResult },
    selectivity: { kinaseSelectivityScore: kinaseScore, offTargetHits, totalTargetsTested: totalTargets, selectivityClass, topOffTargets },
    cellViability: { cc50_uM, therapeuticIndex, cellLine, viabilityAt10uM },
    bioactivation,
    overallRisk,
    inVitroScore,
    timestamp: new Date().toISOString(),
  };
}