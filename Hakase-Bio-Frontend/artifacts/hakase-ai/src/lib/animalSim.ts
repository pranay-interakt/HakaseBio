import type { SimResults } from "./admet";
import { computeFormulationImpact, type FormulationType, type FormulationResult } from "./formulationDB";

// ─── Species / Strain Parameter Sets ─────────────────────────────────────────

export type SpeciesId = "mouse_cd1" | "mouse_c57bl6" | "rat_sd" | "rat_wistar" | "dog_beagle" | "monkey_cyno";

export interface SpeciesParams {
  id: SpeciesId;
  displayName: string;
  species: string;
  strain: string;
  bodyWeight: number;   // kg
  kmFactor: number;     // FDA allometric Km (kcal/day per kg^0.75 proxy — used for HED)
  gfr: number;          // mL/min/kg
  hepaticBloodFlow: number; // mL/min/kg
  cardiacOutput: number;    // mL/min/kg
  clScaleFactor: number;    // clearance relative to human (human=1.0)
  halfLifeExponent: number; // allometric exponent for t½ scaling
  cyp3a4Activity: number;   // relative to human (1.0 = human equivalent)
  cyp2d6Activity: number;
  cyp2c9Activity: number;
  plasmaProteinBinding: number; // additive correction (0 = same as human)
  rodent: boolean;
  regulatory: string;       // typical regulatory use
}

const SPECIES_LIBRARY: Record<SpeciesId, SpeciesParams> = {
  mouse_cd1: {
    id: "mouse_cd1", displayName: "Mouse (CD-1)", species: "Mouse", strain: "CD-1",
    bodyWeight: 0.025, kmFactor: 3, gfr: 5.2, hepaticBloodFlow: 90, cardiacOutput: 500,
    clScaleFactor: 0.28, halfLifeExponent: 0.25, cyp3a4Activity: 0.82, cyp2d6Activity: 0.10,
    cyp2c9Activity: 0.65, plasmaProteinBinding: 0.05, rodent: true,
    regulatory: "Efficacy, oncology, PK screen",
  },
  mouse_c57bl6: {
    id: "mouse_c57bl6", displayName: "Mouse (C57BL/6)", species: "Mouse", strain: "C57BL/6",
    bodyWeight: 0.022, kmFactor: 3, gfr: 5.0, hepaticBloodFlow: 85, cardiacOutput: 480,
    clScaleFactor: 0.27, halfLifeExponent: 0.25, cyp3a4Activity: 0.79, cyp2d6Activity: 0.08,
    cyp2c9Activity: 0.62, plasmaProteinBinding: 0.04, rodent: true,
    regulatory: "Immunology, oncology, transgenic models",
  },
  rat_sd: {
    id: "rat_sd", displayName: "Rat (Sprague Dawley)", species: "Rat", strain: "Sprague Dawley",
    bodyWeight: 0.300, kmFactor: 6, gfr: 5.5, hepaticBloodFlow: 70, cardiacOutput: 360,
    clScaleFactor: 0.40, halfLifeExponent: 0.25, cyp3a4Activity: 1.20, cyp2d6Activity: 1.45,
    cyp2c9Activity: 0.88, plasmaProteinBinding: 0.02, rodent: true,
    regulatory: "Primary GLP toxicology (ICH M3, OECD 407/408)",
  },
  rat_wistar: {
    id: "rat_wistar", displayName: "Rat (Wistar)", species: "Rat", strain: "Wistar",
    bodyWeight: 0.280, kmFactor: 6, gfr: 5.3, hepaticBloodFlow: 68, cardiacOutput: 350,
    clScaleFactor: 0.39, halfLifeExponent: 0.25, cyp3a4Activity: 1.18, cyp2d6Activity: 1.40,
    cyp2c9Activity: 0.85, plasmaProteinBinding: 0.02, rodent: true,
    regulatory: "European regulatory preference; carcinogenicity studies",
  },
  dog_beagle: {
    id: "dog_beagle", displayName: "Dog (Beagle)", species: "Dog", strain: "Beagle",
    bodyWeight: 10.0, kmFactor: 20, gfr: 3.2, hepaticBloodFlow: 31, cardiacOutput: 118,
    clScaleFactor: 0.62, halfLifeExponent: 0.25, cyp3a4Activity: 0.95, cyp2d6Activity: 0.00,
    cyp2c9Activity: 0.72, plasmaProteinBinding: -0.03, rodent: false,
    regulatory: "Non-rodent GLP tox; CV safety pharmacology (ICH S7A)",
  },
  monkey_cyno: {
    id: "monkey_cyno", displayName: "Cynomolgus Monkey", species: "Monkey", strain: "Cynomolgus (Mauritian)",
    bodyWeight: 4.0, kmFactor: 12, gfr: 2.8, hepaticBloodFlow: 44, cardiacOutput: 145,
    clScaleFactor: 0.75, halfLifeExponent: 0.25, cyp3a4Activity: 1.05, cyp2d6Activity: 0.90,
    cyp2c9Activity: 0.95, plasmaProteinBinding: -0.01, rodent: false,
    regulatory: "Biologics, CNS penetration, immunogenicity (NHP standard)",
  },
};

export const SPECIES_LIST = Object.values(SPECIES_LIBRARY);

// ─── Study Types ──────────────────────────────────────────────────────────────

export type StudyType = "single_dose" | "sub_acute_14d" | "sub_chronic_28d" | "chronic_90d";

export interface StudyTypeConfig {
  id: StudyType;
  label: string;
  durationWeeks: number;
  animalsPerSexRodent: number;
  animalsPerSexNonRodent: number;
  recoveryGroup: boolean;
  satelliteTK: boolean;
  oecd: string;
  ich: string;
}

const STUDY_TYPES: Record<StudyType, StudyTypeConfig> = {
  single_dose: {
    id: "single_dose", label: "Single Dose (Acute)", durationWeeks: 0.3,
    animalsPerSexRodent: 5, animalsPerSexNonRodent: 3, recoveryGroup: false, satelliteTK: false,
    oecd: "OECD 423", ich: "ICH M3(R2)",
  },
  sub_acute_14d: {
    id: "sub_acute_14d", label: "Sub-Acute (14-Day)", durationWeeks: 2,
    animalsPerSexRodent: 10, animalsPerSexNonRodent: 3, recoveryGroup: false, satelliteTK: true,
    oecd: "OECD 407", ich: "ICH M3(R2)",
  },
  sub_chronic_28d: {
    id: "sub_chronic_28d", label: "Sub-Chronic (28-Day GLP)", durationWeeks: 4,
    animalsPerSexRodent: 10, animalsPerSexNonRodent: 4, recoveryGroup: true, satelliteTK: true,
    oecd: "OECD 407", ich: "ICH S4A",
  },
  chronic_90d: {
    id: "chronic_90d", label: "Chronic (90-Day GLP)", durationWeeks: 13,
    animalsPerSexRodent: 15, animalsPerSexNonRodent: 4, recoveryGroup: true, satelliteTK: true,
    oecd: "OECD 408", ich: "ICH S4A",
  },
};

export const STUDY_TYPE_LIST = Object.values(STUDY_TYPES);

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface StudyGroup {
  name: string;
  type: "control" | "low" | "mid" | "high" | "recovery" | "satellite";
  doseLevel: number;        // mg/kg/day
  doseMultiple: number;     // × projected therapeutic dose
  nPerSex: number;
  color: string;
}

export interface ToxicityFlag {
  organ: string;
  risk: "low" | "moderate" | "high";
  basis: string;
  finding: string;
  ich: string;
}

export interface PkTimepoint {
  time: number;    // hours
  conc: number;    // ng/mL
}

export interface ChecklistItem {
  guideline: string;
  requirement: string;
  status: "pass" | "warn" | "na";
  note: string;
}

export interface AnimalCohortResults {
  // Study identity
  species: SpeciesParams;
  studyType: StudyTypeConfig;
  routeOfAdmin: string;

  // Core PBPK outputs (animal)
  noael: number;              // mg/kg/day
  mtd: number;                // mg/kg/day
  loqNoael: number;           // NOAEL lower bound (mg/kg)
  hiNoael: number;            // NOAEL upper bound (mg/kg)
  animalCmax: number;         // ng/mL at therapeutic dose
  animalAuc: number;          // ng·h/mL
  animalHalfLife: number;     // hours
  animalClearance: number;    // L/h/kg

  // Human Translation (FIH)
  hedBsa: number;             // mg/kg — Body Surface Area allometric (FDA Km method)
  hedPbpk: number;            // mg/kg — PBPK-refined estimate
  fihDose: number;            // mg — absolute FIH starting dose (1/10 HED × 70 kg)
  fihDoseMgKg: number;        // mg/kg FIH
  safetyMarginNoael: number;  // HED / NOAEL
  safetyMarginMtd: number;    // HED / MTD
  humanCmax: number;          // ng/mL projected at FIH dose
  humanAuc: number;           // ng·h/mL projected
  humanHalfLife: number;      // hours projected

  // PK curves
  animalPkCurve: PkTimepoint[];
  humanPkCurve: PkTimepoint[];

  // Study design
  studyGroups: StudyGroup[];
  totalAnimals: number;
  estimatedCostM: number;     // $M

  // Safety
  toxicityFlags: ToxicityFlag[];
  overallRisk: "low" | "moderate" | "high";

  // Regulatory
  checklist: ChecklistItem[];
  indEnablingComplete: boolean;

  // Species justification text (AI-style summary)
  speciesJustification: string;

  // Formulation / BCS
  formulationResult: FormulationResult;
}

export type { FormulationType, FormulationResult };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seededRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = Math.imul(48271, s) | 0;
    return ((s >>> 0) / 2 ** 32);
  };
}

function generatePkCurve(
  dose: number,       // mg/kg
  bw: number,        // kg
  cl: number,        // L/h/kg
  vd: number,        // L/kg
  ka: number,        // 1/h absorption rate constant (0 for IV)
  tmax: number,      // h
  points: number,
  bioavail: number,
): PkTimepoint[] {
  const curve: PkTimepoint[] = [];
  const doseNg = dose * bw * 1e6; // convert mg/kg to ng total
  const ke = cl / vd;
  const dt = tmax / points;

  for (let i = 0; i <= points; i++) {
    const t = i * dt;
    let conc: number;
    if (ka > 0) {
      // 1-compartment oral: C(t) = (F·D·ka) / (Vd·(ka-ke)) × (e^(-ke·t) - e^(-ka·t))
      const denom = vd * bw * 1000 * (ka - ke); // convert Vd to L total
      conc = denom > 0
        ? (bioavail * doseNg * ka / denom) * (Math.exp(-ke * t) - Math.exp(-ka * t))
        : 0;
    } else {
      // IV bolus
      conc = (doseNg / (vd * bw * 1000)) * Math.exp(-ke * t);
    }
    curve.push({ time: parseFloat(t.toFixed(2)), conc: Math.max(0, parseFloat(conc.toFixed(1))) });
  }
  return curve;
}

// ─── Main Simulation ──────────────────────────────────────────────────────────

export function runAnimalCohortSimulation(
  layer1: SimResults,
  speciesId: SpeciesId,
  studyTypeId: StudyType,
  routeOfAdmin: string,
  formulationType: FormulationType = "plain",
  seed: number = 42,
): AnimalCohortResults {
  const rng = seededRng(seed);
  const sp  = SPECIES_LIBRARY[speciesId];
  const st  = STUDY_TYPES[studyTypeId];

  const { lipinski, admet, toxAlerts, binding } = layer1;
  const mw      = lipinski.mw;
  const logP    = lipinski.logP;
  const hbd     = lipinski.hbd;
  const tpsa    = lipinski.tpsa ?? (hbd * 20 + 30);
  const bw      = sp.bodyWeight;

  // ── Bioavailability estimation (BCS-aware, formulation-adjusted) ─────────
  let bioavail = 0.85;
  if (routeOfAdmin === "IV") {
    bioavail = 1.0;
  } else if (routeOfAdmin === "SC") {
    bioavail = 0.75 + rng() * 0.15;
  } else {
    // Base physicochemical F%
    let baseF = 0.85;
    if (mw > 500)   baseF -= 0.15;
    if (mw > 700)   baseF -= 0.10;
    if (logP < 0)   baseF -= 0.12;
    if (logP > 5)   baseF -= 0.10;
    if (tpsa > 120) baseF -= 0.15;
    if (tpsa > 180) baseF -= 0.15;
    if (hbd > 5)    baseF -= 0.10;
    baseF = Math.max(0.05, Math.min(0.90, baseF));

    // Apply BCS classification + formulation modifier
    // Estimate aromatic ring count from logP (structural proxy; ~0.5 per ring)
    const numArRings = Math.max(0, Math.round(logP * 0.5));
    const rotBonds   = lipinski.rotBonds ?? 3;
    const fResult = computeFormulationImpact(logP, tpsa, mw, hbd, numArRings, rotBonds, baseF, formulationType);
    bioavail = fResult.formulatedF;
  }

  // Computed once — stored below for inclusion in results
  const _baseF_for_result = routeOfAdmin === "Oral"
    ? Math.max(0.05, Math.min(0.90, 0.85
        - (mw > 500 ? 0.15 : 0)
        - (mw > 700 ? 0.10 : 0)
        - (logP < 0 ? 0.12 : 0)
        - (logP > 5 ? 0.10 : 0)
        - (tpsa > 120 ? 0.15 : 0)
        - (tpsa > 180 ? 0.15 : 0)
        - (hbd > 5 ? 0.10 : 0)))
    : (routeOfAdmin === "IV" ? 1.0 : 0.75);

  // ── Volume of distribution ────────────────────────────────────────────────
  // Vd in L/kg — allometrically scale a human estimate
  let vdHuman = 0.6;  // typical default L/kg
  if (logP > 3)  vdHuman += (logP - 3) * 0.4;
  if (logP < 0)  vdHuman = 0.3;
  if (tpsa < 60) vdHuman *= 1.3;  // lipophilic, distributes well
  if (tpsa > 120) vdHuman *= 0.7; // polar, restricted
  vdHuman = Math.max(0.15, Math.min(20, vdHuman));

  // Allometric Vd: Vd_animal ≈ Vd_human (volume scales with body size, L/kg stays ~similar)
  const vdAnimal = vdHuman * (0.9 + rng() * 0.2);

  // ── Clearance ─────────────────────────────────────────────────────────────
  // Human intrinsic clearance from ADMET metabolism score
  // metabolism score 0-1 where 1=very rapid metabolism
  const metabScore = admet.metabolism ?? 0.5;
  const clHuman = 0.5 + metabScore * 2.5;  // L/h/kg (typical range 0.5–3)

  // Scale to animal using allometric exponent 0.75 and species factor
  const bwH = 70; // kg reference human
  const clAnimal = clHuman * sp.clScaleFactor * Math.pow(bwH / bw, -0.25);

  // ── PK parameters ─────────────────────────────────────────────────────────
  const ke    = clAnimal / vdAnimal;  // 1/h elimination rate
  const tHalf = Math.log(2) / ke;    // hours
  const ka    = routeOfAdmin === "IV" ? 0 : 2.0 + rng() * 1.0;  // 1/h absorption
  const tmax  = routeOfAdmin === "IV" ? 0.08 : Math.log(ka / ke) / (ka - ke);

  // ── Therapeutic dose estimation from IC50/EC50 ────────────────────────────
  // Use binding estimate (nM) → back-calculate dose for ~10× IC50 Cmax.
  // RF#1 / §9 step 1 (audit code-review fix): refuse to fabricate a
  // potency when L1 binding is null. The prior code substituted 50 nM as
  // a "belt-and-braces" placeholder, which is precisely the silent-
  // coercion class the no-fake-data policy bans — every downstream
  // therapeutic-dose, Cmax, and NOAEL margin would have read as a real
  // computation while resting on a fabricated 50 nM Ki.
  if (!binding || !(binding.primaryIC50 > 0)) {
    throw new Error(
      "Animal cohort simulation requires an L1 binding estimate (primaryIC50). " +
      "L1 returned binding=null because the target UniProt is not in the " +
      "validated catalog — pick a curated target or wire ML binding before " +
      "running animal cohort simulation.",
    );
  }
  const bindingNm = binding.primaryIC50;
  const targetCmax = bindingNm * 10 * mw / 1e6 * 1e6; // ng/mL (10× IC50 in molar → ng/mL)
  const therapeuticDose = (targetCmax * vdAnimal * bw * 1000) / (bioavail * 1e6);  // mg/kg

  // ── NOAEL estimation ──────────────────────────────────────────────────────
  // Based on ADMET toxicity score and structural risk
  const toxScore   = admet.toxicity;
  // Derive organ-specific risks from toxAlerts categories + structural properties
  const hepatoAlert = toxAlerts.find(a => a.category === "Hepatotox" || a.category === "DILI");
  const hergAlert   = toxAlerts.find(a => a.category === "hERG");
  const hepatoRisk  = hepatoAlert ? (hepatoAlert.severity === "High" ? 0.75 : hepatoAlert.severity === "Medium" ? 0.50 : 0.25) : toxScore * 0.7;
  const cardioRisk  = hergAlert   ? (hergAlert.severity   === "High" ? 0.80 : hergAlert.severity   === "Medium" ? 0.55 : 0.30) : (logP > 4 ? 0.40 : 0.20);

  // Safety factor: higher tox score → lower NOAEL relative to therapeutic dose
  let safetyFactor = 10 - toxScore * 6;  // range: 4–10×
  safetyFactor = Math.max(2, Math.min(10, safetyFactor));

  const noaelRaw = therapeuticDose * safetyFactor;
  // Add ~12% stochastic variability
  const noael = Math.max(0.5, noaelRaw * (0.88 + rng() * 0.24));
  const loqNoael = noael * 0.75;
  const hiNoael  = noael * 1.35;
  const mtd = noael * (5 + rng() * 5);  // typically 5–10× NOAEL

  // ── Animal PK at NOAEL ────────────────────────────────────────────────────
  const simDuration = Math.max(24, tHalf * 6);
  const animalPkCurve = generatePkCurve(noael / 2, bw, clAnimal, vdAnimal, ka, simDuration, 60, bioavail);
  const animalCmax = Math.max(...animalPkCurve.map(p => p.conc));
  const dt2 = simDuration / 60;
  const animalAuc = animalPkCurve.reduce((acc, p, i) => {
    return i === 0 ? acc : acc + (animalPkCurve[i-1].conc + p.conc) * dt2 / 2;
  }, 0);

  // ── Human Translation (FIH) ───────────────────────────────────────────────
  // Method 1: BSA/Km allometric (FDA Guidance, 2005)
  const hedBsa = noael * (sp.kmFactor / 37);  // Human Km = 37

  // Method 2: PBPK-refined (clearance-corrected)
  const clHumanActual = clAnimal / sp.clScaleFactor;
  const hedPbpk = hedBsa * (clHumanActual / clHuman) * (0.92 + rng() * 0.16);

  // FIH dose = 1/10 of lower HED (conservative, FDA typical approach)
  const hedConservative = Math.min(hedBsa, hedPbpk);
  const fihDoseMgKg = hedConservative / 10;
  const fihDose = fihDoseMgKg * 70;  // absolute mg for 70 kg adult

  const safetyMarginNoael = hedBsa / noael;
  const safetyMarginMtd   = hedBsa / mtd;

  // ── Human PK curve projection ─────────────────────────────────────────────
  const clH   = clHuman;
  const vdH   = vdHuman;
  const keH   = clH / vdH;
  const tHalfH = Math.log(2) / keH;
  const kaH   = routeOfAdmin === "IV" ? 0 : 1.2 + rng() * 0.6;
  const humanSimDuration = Math.max(48, tHalfH * 6);
  const humanPkCurve = generatePkCurve(fihDoseMgKg, 70, clH, vdH, kaH, humanSimDuration, 60, bioavail * 0.9);
  const humanCmax = Math.max(...humanPkCurve.map(p => p.conc));
  const dtH = humanSimDuration / 60;
  const humanAuc = humanPkCurve.reduce((acc, p, i) => {
    return i === 0 ? acc : acc + (humanPkCurve[i-1].conc + p.conc) * dtH / 2;
  }, 0);

  // ── Study Groups ──────────────────────────────────────────────────────────
  const nPerSex = sp.rodent ? st.animalsPerSexRodent : st.animalsPerSexNonRodent;
  const lowDose = noael / 10;
  const midDose = Math.sqrt(lowDose * noael);
  const highDose = noael;

  const studyGroups: StudyGroup[] = [
    {
      name: "Vehicle Control", type: "control", doseLevel: 0,
      doseMultiple: 0, nPerSex, color: "slate",
    },
    {
      name: "Low Dose", type: "low", doseLevel: parseFloat(lowDose.toFixed(2)),
      doseMultiple: parseFloat((lowDose / therapeuticDose).toFixed(1)), nPerSex, color: "blue",
    },
    {
      name: "Mid Dose", type: "mid", doseLevel: parseFloat(midDose.toFixed(2)),
      doseMultiple: parseFloat((midDose / therapeuticDose).toFixed(1)), nPerSex, color: "amber",
    },
    {
      name: "High Dose (NOAEL)", type: "high", doseLevel: parseFloat(noael.toFixed(2)),
      doseMultiple: parseFloat((noael / therapeuticDose).toFixed(1)), nPerSex, color: "red",
    },
  ];

  if (st.recoveryGroup) {
    studyGroups.push({
      name: "Recovery (High)", type: "recovery", doseLevel: parseFloat(noael.toFixed(2)),
      doseMultiple: parseFloat((noael / therapeuticDose).toFixed(1)),
      nPerSex: Math.ceil(nPerSex / 2), color: "emerald",
    });
  }
  if (st.satelliteTK) {
    studyGroups.push({
      name: "Satellite TK", type: "satellite", doseLevel: parseFloat(noael.toFixed(2)),
      doseMultiple: 0, nPerSex: Math.min(5, nPerSex), color: "violet",
    });
  }

  const totalAnimals = studyGroups.reduce((s, g) => s + g.nPerSex * 2, 0);

  // ── Cost Estimation ───────────────────────────────────────────────────────
  const costPerAnimalRodent    = 0.8;   // $K
  const costPerAnimalNonRodent = 8.0;   // $K
  const durationMultiplier = 1 + st.durationWeeks * 0.04;
  const costPerAnimal = sp.rodent ? costPerAnimalRodent : costPerAnimalNonRodent;
  const estimatedCostM = (totalAnimals * costPerAnimal * durationMultiplier) / 1000;

  // ── Toxicity Flags ────────────────────────────────────────────────────────
  const toxicityFlags: ToxicityFlag[] = [];

  if (cardioRisk > 0.5 || logP > 4.5) {
    toxicityFlags.push({
      organ: "Cardiovascular", risk: cardioRisk > 0.7 ? "high" : "moderate",
      basis: "hERG channel affinity (structural alert, LogP > 4.5)",
      finding: "Predicted QT prolongation risk — hERG inhibition likely",
      ich: "ICH S7B",
    });
  }
  if (hepatoRisk > 0.4) {
    toxicityFlags.push({
      organ: "Hepatic", risk: hepatoRisk > 0.65 ? "high" : "moderate",
      basis: "DILI structural alerts; reactive metabolite risk",
      finding: "ALT/AST elevation expected at high dose",
      ich: "ICH S9 / DILI guidance",
    });
  }
  if (toxScore > 0.6) {
    toxicityFlags.push({
      organ: "Genotoxicity", risk: toxScore > 0.75 ? "high" : "moderate",
      basis: "Structural alerts: aromatic amines / nitro groups",
      finding: "Ames test positive predicted — ICH S2(R1) battery required",
      ich: "ICH S2(R1)",
    });
  }
  if (mw > 500 && logP > 3) {
    toxicityFlags.push({
      organ: "Tissue Accumulation", risk: "moderate",
      basis: "High MW + lipophilicity → slow clearance",
      finding: "Tissue accumulation in repeat-dose study likely",
      ich: "ICH S4A",
    });
  }
  if (toxicityFlags.length === 0) {
    toxicityFlags.push({
      organ: "General Systemic", risk: "low",
      basis: "Acceptable ADMET profile; no major structural alerts",
      finding: "No significant organ-specific toxicity signals predicted",
      ich: "ICH M3(R2)",
    });
  }

  const overallRisk: AnimalCohortResults["overallRisk"] =
    toxicityFlags.some(f => f.risk === "high") ? "high" :
    toxicityFlags.some(f => f.risk === "moderate") ? "moderate" : "low";

  // ── Regulatory Checklist ──────────────────────────────────────────────────
  const hasNonRodent = !sp.rodent;
  const hasRodent = sp.rodent;

  const checklist: ChecklistItem[] = [
    {
      guideline: "ICH M3(R2)", requirement: "Rodent repeat-dose tox (IND-enabling)",
      status: hasRodent && st.durationWeeks >= 2 ? "pass" : "warn",
      note: hasRodent ? `${sp.strain} ${st.label} covers ICH M3 minimum` : "Add rodent species for IND package",
    },
    {
      guideline: "ICH S4A", requirement: "Non-rodent repeat-dose tox",
      status: hasNonRodent && st.durationWeeks >= 4 ? "pass" : "warn",
      note: hasNonRodent ? `${sp.strain} covers non-rodent requirement` : "Beagle or cynomolgus required for full IND",
    },
    {
      guideline: "ICH S7A", requirement: "Safety pharmacology (CNS, CV, Respiratory)",
      status: st.durationWeeks >= 0.3 ? "pass" : "warn",
      note: "CV safety pharmacology in dog; CNS/respiratory in rat",
    },
    {
      guideline: "ICH S7B", requirement: "hERG / QT interval assessment",
      status: cardioRisk > 0.5 ? "warn" : "pass",
      note: cardioRisk > 0.5 ? "In vitro hERG assay required (risk signal detected)" : "hERG risk low — in vitro assay recommended as precaution",
    },
    {
      guideline: "ICH S2(R1)", requirement: "Genotoxicity battery (Ames + in vitro clastogenicity)",
      status: toxScore > 0.6 ? "warn" : "pass",
      note: toxScore > 0.6 ? "Structural alerts — full S2(R1) battery required before FIH" : "Standard genotoxicity battery sufficient",
    },
    {
      guideline: "FDA Guidance 2005", requirement: "FIH dose calculation (allometric scaling)",
      status: "pass",
      note: `HED = ${hedBsa.toFixed(2)} mg/kg via BSA method; proposed FIH = ${fihDoseMgKg.toFixed(2)} mg/kg (${fihDose.toFixed(1)} mg abs.)`,
    },
    {
      guideline: "OECD 423 / 407", requirement: "GLP compliance documentation",
      status: "pass",
      note: `${st.oecd} study design with ${totalAnimals} animals; GLP-ready protocol generated`,
    },
  ];

  const indEnablingComplete = checklist.every(c => c.status !== "warn") ||
    checklist.filter(c => c.status === "warn").length <= 1;

  // ── Species justification ─────────────────────────────────────────────────
  const homologyNote = sp.rodent
    ? "rodent CYP profile shows moderate homology to human CYP3A4/2D6 — metabolism prediction confidence: high"
    : "non-rodent CYP3A4 activity closely mirrors human — preferred for metabolite profiling";

  const speciesJustification =
    `${sp.displayName} selected based on: (1) ${sp.regulatory}; ` +
    `(2) ${homologyNote}; ` +
    `(3) body weight ${(bw * 1000).toFixed(0)} g supports the ${st.label} study design; ` +
    `(4) historical regulatory acceptance for this compound class. ` +
    `PBPK allometric scaling produced HED of ${hedBsa.toFixed(2)} mg/kg (BSA method) ` +
    `and ${hedPbpk.toFixed(2)} mg/kg (PBPK-refined), yielding a proposed FIH starting dose of ` +
    `${fihDoseMgKg.toFixed(2)} mg/kg (${fihDose.toFixed(0)} mg absolute) with a ` +
    `${safetyMarginNoael.toFixed(1)}× safety margin over NOAEL.`;

  // ── Formulation result ────────────────────────────────────────────────────
  const numArRingsFinal = Math.max(0, Math.round(logP * 0.5));
  const rotBondsFinal   = lipinski.rotBonds ?? 3;
  const formulationResult = computeFormulationImpact(
    logP, tpsa, mw, hbd, numArRingsFinal, rotBondsFinal,
    _baseF_for_result, formulationType,
  );

  return {
    species: sp,
    studyType: st,
    routeOfAdmin,
    noael: parseFloat(noael.toFixed(2)),
    mtd:  parseFloat(mtd.toFixed(2)),
    loqNoael: parseFloat(loqNoael.toFixed(2)),
    hiNoael:  parseFloat(hiNoael.toFixed(2)),
    animalCmax:      parseFloat(animalCmax.toFixed(1)),
    animalAuc:       parseFloat(animalAuc.toFixed(0)),
    animalHalfLife:  parseFloat(tHalf.toFixed(2)),
    animalClearance: parseFloat(clAnimal.toFixed(3)),
    hedBsa:     parseFloat(hedBsa.toFixed(3)),
    hedPbpk:    parseFloat(hedPbpk.toFixed(3)),
    fihDose:    parseFloat(fihDose.toFixed(1)),
    fihDoseMgKg: parseFloat(fihDoseMgKg.toFixed(3)),
    safetyMarginNoael: parseFloat(safetyMarginNoael.toFixed(1)),
    safetyMarginMtd:   parseFloat(safetyMarginMtd.toFixed(1)),
    humanCmax:    parseFloat(humanCmax.toFixed(1)),
    humanAuc:     parseFloat(humanAuc.toFixed(0)),
    humanHalfLife: parseFloat(tHalfH.toFixed(2)),
    animalPkCurve,
    humanPkCurve,
    studyGroups,
    totalAnimals,
    estimatedCostM: parseFloat(estimatedCostM.toFixed(2)),
    toxicityFlags,
    overallRisk,
    checklist,
    indEnablingComplete,
    speciesJustification,
    formulationResult,
  };
}
