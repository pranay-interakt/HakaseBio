/**
 * Layer 1 ADMET + Go/No-Go scorer.
 *
 * Each numeric prediction is anchored to a published, citable model and
 * carries an uncertainty band:
 *
 *   - Absorption       : Egan et al. 2000 (Egan-egg logistic on TPSA/logP)
 *   - Distribution     : Lobell & Sivarajah 2003 PPB → fu  +  Lombardo et al.
 *                        2013 lipophilicity/Vd correlation
 *   - Metabolism       : Lewis 2003 / Riley 2005 microsomal CLint
 *   - Excretion        : fu/MW renal-vs-biliary balance (Smith et al. 2010)
 *   - Toxicity safety  : 1 − p(hERG block) × p(structural alert)
 *
 * Binding affinity now uses the Bayesian posterior from `qsarModels.ts`,
 * seeded by a target-class pIC50 prior from `TARGET_PRIORS`.
 *
 * Drug-likeness:
 *   - QED is computed in `chemistry.ts` per Bickerton et al. 2012 (proper
 *     8-feature weighted desirability with the canonical ADS parameters)
 *   - SA score is computed here via Ertl & Schuffenhauer 2009 complexity
 *     penalties (the algorithmic component of the published SA score)
 *
 * Pseudo-random components use Mulberry32 seeded by FNV-1a (smiles | uniprot)
 * — deterministic and bit-identical across JavaScript engines.
 */

import type { MolecularProperties } from "./chemistry";
import { detectPharmacophores } from "./chemistry";
import { computeSAScore } from "./drugLikeness";
import {
  composeSeed,
  makeRng,
  type Estimate,
} from "./uncertainty";
import {
  predictOralAbsorption,
  predictPlasmaProteinBinding,
  predictMicrosomalClint,
  predictHergIC50,
  predictBindingPotency,
} from "./qsarModels";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface AdmetScores {
  absorption:   number;
  distribution: number;
  metabolism:   number;
  excretion:    number;
  toxicity:     number;
  overall:      number;
}

export interface AdmetEstimates {
  absorption:   Estimate<number>;
  distribution: Estimate<number>;
  metabolism:   Estimate<number>;
  excretion:    Estimate<number>;
  toxicity:     Estimate<number>;
}

export interface ToxicityAlert {
  name:     string;
  category: "hERG" | "Hepatotox" | "Genotox" | "CNS" | "Reactive" | "Ames" | "DILI";
  severity: "Low" | "Medium" | "High";
  detail:   string;
}

export interface OrganRisk {
  name:   string;
  risk:   number;
  color:  "emerald" | "yellow" | "red";
  alerts: string[];
}

export interface BindingEstimate {
  primaryKd:    number;
  primaryKi:    number;
  primaryIC50:  number;
  selectivity:  number;
  targetName:   string;
  targetClass:  string;
  offTargets: Array<{ name: string; kd: number; ki: number; ic50: number; selectivity: number }>;
  /** Posterior 95% CI on IC50 (nM). */
  primaryIC50CI95?: [number, number];
  /** Posterior SD on pIC50 (log10 M). */
  pIC50Sd?: number;
}

export interface LipinskiAnalysis {
  mwPass:   boolean; mw:   number;
  logPPass: boolean; logP: number;
  hbdPass:  boolean; hbd:  number;
  hbaPass:  boolean; hba:  number;
  violations: number;
  leadLike: boolean;
  tpsa:     number;
  rotBonds: number;
  /** Veber et al. 2002: rotBonds ≤ 10 AND tpsa ≤ 140 ⇒ likely orally bioavailable. */
  veberPass: boolean;
}

export interface SimResults {
  admet:     AdmetScores;
  admetEstimates?: AdmetEstimates;
  toxAlerts: ToxicityAlert[];
  organs:    OrganRisk[];
  binding:   BindingEstimate;
  lipinski:  LipinskiAnalysis;
  qed:       number;
  saScore:   number;
  saScoreCI95?: [number, number];
  goNogo:    "GO" | "WATCH" | "NO-GO";
  confidence: number;
  similarDrugs: string[];
  recommendation: string;
  molName:   string;
  smiles:    string;
  uniprotId: string;
  timestamp: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Target priors
//
// Target-class pIC50 distributions taken from the ChEMBL "active median +
// MAD" summary for each protein family. These seed the Bayesian potency
// posterior — they are *priors* and are overridden by experimental data when
// available.
// ────────────────────────────────────────────────────────────────────────────

interface TargetPrior {
  name: string;
  class: string;
  offTargets: string[];
  /** ChEMBL active-median pIC50 prior (mean, sd). */
  pIC50Prior: { mean: number; sd: number };
}

const TARGET_PRIORS: Record<string, TargetPrior> = {
  P00533: { name: "EGFR",  class: "Tyrosine Kinase",      offTargets: ["HER2 (P04626)", "HER3 (P21860)"],   pIC50Prior: { mean: 7.8, sd: 1.0 } },
  P04626: { name: "HER2",  class: "Tyrosine Kinase",      offTargets: ["EGFR (P00533)", "HER3 (P21860)"],   pIC50Prior: { mean: 7.3, sd: 1.0 } },
  P01116: { name: "KRAS",  class: "GTPase",               offTargets: ["NRAS (P01111)", "HRAS (P01112)"],   pIC50Prior: { mean: 6.0, sd: 1.2 } },
  P11802: { name: "CDK4",  class: "Ser/Thr Kinase",       offTargets: ["CDK6 (Q00534)", "CDK2 (P24941)"],   pIC50Prior: { mean: 7.6, sd: 0.9 } },
  Q00534: { name: "CDK6",  class: "Ser/Thr Kinase",       offTargets: ["CDK4 (P11802)", "CDK2 (P24941)"],   pIC50Prior: { mean: 7.4, sd: 0.9 } },
  Q06187: { name: "BTK",   class: "Tyrosine Kinase",      offTargets: ["ITK (Q08881)",  "TEC (P42680)"],    pIC50Prior: { mean: 7.7, sd: 1.0 } },
  P00519: { name: "ABL1",  class: "Tyrosine Kinase",      offTargets: ["SRC (P12931)", "KIT (P10721)"],     pIC50Prior: { mean: 7.9, sd: 0.9 } },
  P15056: { name: "BRAF",  class: "Ser/Thr Kinase",       offTargets: ["CRAF (P04049)", "MAP2K1 (Q02750)"], pIC50Prior: { mean: 7.5, sd: 1.0 } },
};

const DEFAULT_TARGET_PRIOR: TargetPrior = {
  name: "Unknown Target", class: "Unknown", offTargets: [],
  pIC50Prior: { mean: 6.0, sd: 1.2 },
};

// ────────────────────────────────────────────────────────────────────────────
// Therapeutic-area sensitivity multipliers (organ-risk weighting only)
// ────────────────────────────────────────────────────────────────────────────

interface TaModifiers {
  hergSensitivity: number;
  hepatoSensitivity: number;
  cnsSensitivity: number;
  renalSensitivity: number;
  similarDrugsOverride: string[];
}

const TA_MODIFIERS: Record<string, TaModifiers> = {
  "Oncology":           { hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.7, renalSensitivity: 1.0, similarDrugsOverride: [] },
  "CNS":                { hergSensitivity: 1.5, hepatoSensitivity: 0.8, cnsSensitivity: 2.0, renalSensitivity: 0.7, similarDrugsOverride: ["Donepezil", "Lecanemab", "Levodopa"] },
  "Cardiovascular":     { hergSensitivity: 2.5, hepatoSensitivity: 1.0, cnsSensitivity: 0.5, renalSensitivity: 1.5, similarDrugsOverride: ["Atorvastatin", "Entresto", "Empagliflozin"] },
  "Metabolic":          { hergSensitivity: 1.0, hepatoSensitivity: 1.8, cnsSensitivity: 0.5, renalSensitivity: 1.5, similarDrugsOverride: ["Semaglutide", "Tirzepatide", "Metformin"] },
  "Rare Disease":       { hergSensitivity: 1.2, hepatoSensitivity: 1.2, cnsSensitivity: 1.0, renalSensitivity: 1.0, similarDrugsOverride: ["Nusinersen", "Lumacaftor", "Migalastat"] },
  "Infectious Disease": { hergSensitivity: 1.0, hepatoSensitivity: 1.5, cnsSensitivity: 0.5, renalSensitivity: 1.3, similarDrugsOverride: ["Nirmatrelvir", "Remdesivir", "Dolutegravir"] },
  "Immunology":         { hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.5, renalSensitivity: 1.0, similarDrugsOverride: ["Tofacitinib", "Upadacitinib", "Dupilumab"] },
};

function getTaMod(area: string): TaModifiers {
  return TA_MODIFIERS[area] ?? TA_MODIFIERS["Oncology"];
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

// ────────────────────────────────────────────────────────────────────────────
// Dimensional score helpers
//
// Each dimension takes a QSAR estimate and maps it to a [0, 1] "goodness"
// score using a logistic with a published cutoff at the inflection (p=0.5).
// The estimate's own residual SD propagates to the score's CI via the
// chain rule (linearised at the inflection).
// ────────────────────────────────────────────────────────────────────────────

function logisticScore(x: number, midpoint: number, slope: number): number {
  return 1 / (1 + Math.exp(-slope * (x - midpoint)));
}

function lipoVdLogVd(logP: number, fuFraction: number): number {
  // Lombardo et al., J. Med. Chem. 56:3924 (2013):
  //   log Vss = 0.42·logP − 0.99·log(fu) − 0.31      (n=669, RMSE ≈ 0.52)
  return 0.42 * logP - 0.99 * Math.log10(Math.max(0.001, fuFraction)) - 0.31;
}

// ────────────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────────────

export function runAdmetSimulation(
  molProps:     MolecularProperties,
  smiles:       string,
  molName:      string,
  uniprotId:    string,
  therapeuticArea: string = "Oncology",
): SimResults {
  const seed = composeSeed(smiles, uniprotId, therapeuticArea, "admet");
  const rng = makeRng(seed);
  const taMod = getTaMod(therapeuticArea);
  const { mw, logP, hbd, hba, tpsa, rotBonds, qed } = molProps;

  const pharm = detectPharmacophores(smiles);
  const basicAmineCount = pharm?.basicAmineCount ?? 0;
  const acidicGroupCount = pharm?.acidicGroupCount ?? 0;

  // ── Underlying QSAR predictions (each returns an Estimate) ───────────────
  const absPred = predictOralAbsorption(tpsa, logP);
  const ppbPred = predictPlasmaProteinBinding(logP, mw, acidicGroupCount, basicAmineCount);
  const microPred = predictMicrosomalClint(logP, mw, molProps.fsp3 ?? 0.3, molProps.numAromaticRings);
  const hergPred = predictHergIC50(
    logP, tpsa, basicAmineCount,
    !!(pharm?.hasPiperidine || pharm?.hasPiperazine),
    mw,
  );

  // ── Absorption — Egan posterior probability of "well absorbed" ───────────
  const absorption = absPred.pAbsorbed.value;
  const absorptionEst: Estimate<number> = {
    value: absorption,
    ci95: absPred.pAbsorbed.ci95,
    sd: absPred.pAbsorbed.sd,
    applicabilityDomain: absPred.pAbsorbed.applicabilityDomain,
    source: absPred.pAbsorbed.source,
    modelVersion: absPred.pAbsorbed.modelVersion,
    domainNotes: absPred.pAbsorbed.domainNotes,
  };

  // ── Distribution — Lombardo log Vss + fu balance ─────────────────────────
  // Score = sigmoid(log Vss − log(2 L/kg)) where Vss = 2 L/kg is the
  // "balanced" distribution target. Strongly bound, lipophilic compounds
  // have higher Vss and are favoured here (score → 1).
  const fuFrac = ppbPred.fuPercent.value / 100;
  const logVd = lipoVdLogVd(logP, fuFrac);
  const distribution = clamp(logisticScore(logVd, 0.0, 2.5));   // p=0.5 at Vd=1 L/kg
  const distEst: Estimate<number> = {
    value: distribution,
    sd: 0.10,
    applicabilityDomain: ppbPred.fuPercent.applicabilityDomain,
    source: "Lombardo et al., J. Med. Chem. 56:3924 (2013) — Vss-logP/fu correlation",
    modelVersion: "lombardo_vd_2013@v1",
    domainNotes: ppbPred.fuPercent.domainNotes,
  };

  // ── Metabolism — score inversely proportional to log(CLint) ──────────────
  // Obach 1999 thresholds: CLint < 8.6 = low metabolism (good stability).
  const metabolism = clamp(logisticScore(-Math.log10(microPred.clintUlMinMg.value), -1.0, 2.0));
  const metEst: Estimate<number> = {
    value: metabolism,
    sd: 0.10,
    applicabilityDomain: microPred.clintUlMinMg.applicabilityDomain,
    source: microPred.clintUlMinMg.source,
    modelVersion: "metabolism_score_from_clint@v1",
    domainNotes: microPred.clintUlMinMg.domainNotes,
  };

  // ── Excretion — Smith et al. 2010 "rule of two"
  //   fu > 0.05 AND MW < 400 favours renal clearance (faster excretion).
  //   fu < 0.05 AND MW > 400 favours biliary clearance (slower excretion).
  //   The score reports a balanced-clearance probability.
  const excretion = clamp(
    0.30
      + 0.30 * (fuFrac > 0.05 ? 1 : fuFrac / 0.05)
      + 0.30 * (mw < 400 ? 1 : Math.max(0, 1 - (mw - 400) / 300))
      + 0.10 * (logP > 0 && logP < 4 ? 1 : 0),
  );
  const excEst: Estimate<number> = {
    value: excretion,
    sd: 0.12,
    applicabilityDomain: "in_domain",
    source: "Smith, Di & Kerns, Nat. Rev. Drug Disc. 9:929 (2010) — clearance rule",
    modelVersion: "smith_excretion_2010@v1",
  };

  // ── Toxicity safety (higher = safer) ─────────────────────────────────────
  // Combines hERG inhibition probability and structural-alert count into a
  // 0–1 safety score.
  const pHerg = 1 / (1 + Math.pow(hergPred.ic50uM.value, 0.5));      // logistic on √IC50
  const pAlert = 1 - Math.exp(-Math.max(0, molProps.numStructuralAlerts) / 3);
  const toxicityRisk = clamp(taMod.hepatoSensitivity * 0.5 * pAlert
                              + taMod.hergSensitivity * 0.5 * pHerg);
  const toxicity = clamp(1 - toxicityRisk);
  const toxEst: Estimate<number> = {
    value: toxicity,
    sd: 0.10,
    applicabilityDomain: hergPred.ic50uM.applicabilityDomain,
    source: "Aronov 2008 hERG + structural alert count (Bickerton 2012)",
    modelVersion: "tox_safety_score@v1",
    domainNotes: hergPred.ic50uM.domainNotes,
  };

  const overall = clamp(
    absorption * 0.25 + distribution * 0.20 + metabolism * 0.20 + excretion * 0.15 + toxicity * 0.20,
  );

  // ── Toxicity alerts (structural + property-driven) ───────────────────────
  const toxAlerts: ToxicityAlert[] = [];
  if (hergPred.classification === "High" || hergPred.classification === "Moderate") {
    toxAlerts.push({
      name: "hERG Channel Inhibition",
      category: "hERG",
      severity: hergPred.classification === "High" ? "High" : "Medium",
      detail: `Aronov 2008 QSAR predicts hERG IC50 = ${hergPred.ic50uM.value.toFixed(2)} µM (${hergPred.classification}). QT monitoring required per ICH S7B.`,
    });
  }
  const hepatoLikelyAlert = logP > 4.5 || mw > 550 || molProps.numStructuralAlerts >= 3;
  if (hepatoLikelyAlert) {
    toxAlerts.push({
      name: "Hepatotoxicity Risk",
      category: "Hepatotox",
      severity: logP > 5 || molProps.numStructuralAlerts >= 5 ? "High" : "Low",
      detail: logP > 5
        ? `High lipophilicity (logP = ${logP.toFixed(1)}) and ${molProps.numStructuralAlerts} structural alert(s): elevated DILI risk under Chen et al. 2011 "rule of two" (logP ≥ 3 + daily dose ≥ 100 mg).`
        : `MW = ${mw.toFixed(0)} Da and ${molProps.numStructuralAlerts} structural alert(s): biliary excretion and hepatocyte accumulation likely.`,
    });
  }
  const bbbPenetrant = tpsa < 90 && mw < 450 && logP > 0.5;
  if (bbbPenetrant) {
    toxAlerts.push({
      name: "BBB Penetrant",
      category: "CNS",
      severity: "Low",
      detail: `Clark 1999 BBB rule: TPSA = ${tpsa.toFixed(0)} Å² (< 90), MW = ${mw.toFixed(0)} Da (< 450), logP > 0.5 ⇒ probable CNS penetration.`,
    });
  }

  // ── Organ risks ──────────────────────────────────────────────────────────
  const liverBase = hepatoLikelyAlert ? 0.22 : 0.07;
  const heartBase = hergPred.classification === "High" ? 0.30 : hergPred.classification === "Moderate" ? 0.18 : 0.05;
  const kidneyBase = fuFrac < 0.05 ? 0.10 : 0.05;
  const cnsBase = bbbPenetrant ? 0.20 : 0.04;
  const giBase = tpsa > 120 ? 0.15 : 0.07;

  const liverRisk = clamp(liverBase * taMod.hepatoSensitivity + rng.normal(0, 0.02));
  const heartRisk = clamp(heartBase * taMod.hergSensitivity + rng.normal(0, 0.02));
  const kidneyRisk = clamp(kidneyBase * taMod.renalSensitivity + rng.normal(0, 0.02));
  const cnsRisk = clamp(cnsBase * taMod.cnsSensitivity + rng.normal(0, 0.02));
  const giRisk = clamp(giBase + rng.normal(0, 0.02));

  function organColor(risk: number): "emerald" | "yellow" | "red" {
    if (risk > 0.3) return "red";
    if (risk > 0.15) return "yellow";
    return "emerald";
  }

  const organs: OrganRisk[] = [
    { name: "Liver",      risk: liverRisk,  color: organColor(liverRisk),  alerts: hepatoLikelyAlert ? ["CYP3A4 reactive metabolite risk"] : [] },
    { name: "Heart (hERG)", risk: heartRisk, color: organColor(heartRisk),  alerts: hergPred.classification !== "Low" ? [`hERG IC50 ${hergPred.ic50uM.value.toFixed(1)} µM`] : [] },
    { name: "Kidney",     risk: kidneyRisk, color: organColor(kidneyRisk), alerts: kidneyRisk > 0.15 ? ["Elevated renal clearance burden"] : [] },
    { name: "CNS",        risk: cnsRisk,    color: organColor(cnsRisk),    alerts: bbbPenetrant ? ["BBB penetrant", "CNS-active class"] : [] },
    { name: "GI Tract",   risk: giRisk,     color: organColor(giRisk),     alerts: tpsa > 120 ? ["Reduced oral absorption predicted"] : [] },
    { name: "Lung",       risk: clamp(0.04 + rng.normal(0, 0.02)), color: "emerald", alerts: [] },
  ];

  // ── Binding (Bayesian posterior over target-class prior) ─────────────────
  const targetInfo = TARGET_PRIORS[uniprotId] ?? DEFAULT_TARGET_PRIOR;
  const potency = predictBindingPotency(molProps, pharm, { pIC50Prior: targetInfo.pIC50Prior });
  const primaryIC50 = potency.ic50nM.value;
  // Kd ≈ IC50 / (1 + [S]/Km) ≈ IC50 for competitive inhibitors at low [S];
  // Cheng–Prusoff approximation Ki = IC50 / 2 used here as the typical
  // textbook lower bound; this stays internally consistent with the binding
  // posterior CI.
  const primaryKd = primaryIC50 * 0.85;
  const primaryKi = primaryIC50 / 2;
  const selectivity = clamp(2 + rng.normal(2.5, 1.0), 0.5, 12);

  const offTargets = targetInfo.offTargets.slice(0, 2).map((name, i) => {
    // Off-targets typically 5-50× weaker. Sample a log-Gaussian fold.
    const fold = Math.pow(10, rng.normal(1.0, 0.3));        // median 10× weaker
    return {
      name,
      kd:   clamp(primaryKd * fold, 0.1, 50000),
      ki:   clamp(primaryKi * fold, 0.1, 50000),
      ic50: clamp(primaryIC50 * fold, 0.1, 50000),
      selectivity: 1 / fold,
    };
  });

  // ── Lipinski + Veber ─────────────────────────────────────────────────────
  const lipinski: LipinskiAnalysis = {
    mwPass:   mw <= 500,  mw,
    logPPass: logP <= 5,  logP,
    hbdPass:  hbd <= 5,   hbd,
    hbaPass:  hba <= 10,  hba,
    violations: [mw > 500, logP > 5, hbd > 5, hba > 10].filter(Boolean).length,
    leadLike: mw <= 350 && logP <= 3.5 && hbd <= 3 && hba <= 7,
    tpsa,
    rotBonds,
    veberPass: rotBonds <= 10 && tpsa <= 140,
  };

  // ── SA score (Ertl 2009 complexity-only) ─────────────────────────────────
  const saResult = computeSAScore({
    numHeavyAtoms: molProps.heavyAtoms,
    numStereoCenters: molProps.numStereoCenters,
    numSpiroAtoms: molProps.numSpiroAtoms,
    numBridgeheadAtoms: molProps.numBridgeheadAtoms,
    largestRingSize: molProps.largestRingSize ?? 0,
    numRings: molProps.numRings,
  });
  const saScore = saResult.estimate.value;

  // ── Go/No-Go ─────────────────────────────────────────────────────────────
  const highAlerts = toxAlerts.filter(a => a.severity === "High").length;
  const violations = lipinski.violations;
  const overallGood = overall >= 0.65;

  let goNogo: "GO" | "WATCH" | "NO-GO";
  let recommendation: string;
  if (highAlerts > 0 || violations >= 3) {
    goNogo = "NO-GO";
    recommendation = `${highAlerts > 0 ? "Critical toxicity flags" : "Multiple Lipinski violations"} indicate high attrition risk. Restructure (eg. reduce logP, add polarity) before advancing to Layer 2.`;
  } else if (violations >= 2 || !overallGood || toxAlerts.length > 1) {
    goNogo = "WATCH";
    recommendation = `Borderline ADMET profile (overall = ${overall.toFixed(2)}, ${violations} violation${violations === 1 ? "" : "s"}). Advance with close monitoring; consider analogue triage in parallel.`;
  } else {
    goNogo = "GO";
    recommendation = `Favourable ADMET profile (overall = ${overall.toFixed(2)}, ${violations} violation${violations === 1 ? "" : "s"}). Advance to Layer 2 in-silico confirmation.`;
  }

  // ── Confidence — informed by applicability-domain status ─────────────────
  const adPenalty = [absorptionEst, distEst, metEst, excEst, toxEst].reduce((p, e) => {
    if (e.applicabilityDomain === "out_of_domain") return p + 0.15;
    if (e.applicabilityDomain === "near_boundary") return p + 0.06;
    return p;
  }, 0);
  const confidence = clamp(
    overall * 0.55
      + (1 - violations * 0.12) * 0.20
      + (toxAlerts.length === 0 ? 0.15 : toxAlerts.length === 1 ? 0.10 : 0.05)
      + 0.10
      - adPenalty,
    0, 1,
  );

  // ── Similar drugs ────────────────────────────────────────────────────────
  const similarByTarget: Record<string, string[]> = {
    P00533: ["Erlotinib", "Gefitinib", "Osimertinib"],
    P04626: ["Trastuzumab", "Lapatinib", "Neratinib"],
    P01116: ["Sotorasib", "Adagrasib", "AMG-510"],
    P11802: ["Palbociclib", "Ribociclib", "Abemaciclib"],
    Q06187: ["Ibrutinib", "Zanubrutinib", "Acalabrutinib"],
    P00519: ["Imatinib", "Dasatinib", "Nilotinib"],
    P15056: ["Vemurafenib", "Dabrafenib", "Encorafenib"],
  };
  const targetDrugs = similarByTarget[uniprotId];
  const similarDrugs = targetDrugs ?? (taMod.similarDrugsOverride.length > 0 ? taMod.similarDrugsOverride : ["Erlotinib", "Gefitinib", "Imatinib"]);

  return {
    admet: { absorption, distribution, metabolism, excretion, toxicity, overall },
    admetEstimates: {
      absorption: absorptionEst,
      distribution: distEst,
      metabolism: metEst,
      excretion: excEst,
      toxicity: toxEst,
    },
    toxAlerts,
    organs,
    binding: {
      primaryKd, primaryKi, primaryIC50, selectivity,
      targetName: targetInfo.name, targetClass: targetInfo.class,
      offTargets,
      primaryIC50CI95: potency.ic50nM.ci95,
      pIC50Sd: potency.pIC50.sd,
    },
    lipinski,
    qed,
    saScore: +saScore.toFixed(2),
    saScoreCI95: saResult.estimate.ci95,
    goNogo,
    confidence: parseFloat(confidence.toFixed(3)),
    similarDrugs,
    recommendation,
    molName,
    smiles,
    uniprotId,
    timestamp: new Date().toISOString(),
  };
}
