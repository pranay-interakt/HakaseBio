/**
 * L4 → Hakase Clinical emit builder.
 *
 * Assembles the typed PreClinicalPackage that Hakase Clinical Phase Planners
 * consume over the §8 API boundary. This module is the ONLY place where the
 * L4 cascade-output is converted to the typed handoff shape.
 *
 * §6.1 extensions (CYP/transporter panel + renal/hepatic clearance fractions)
 * are derived here from L1 ADMET-ML when available; when the required ML
 * predictions are absent the corresponding sub-payload is left null and a
 * provenance warning is added — NEVER defaulted to a guess.
 */
import {
  type PreClinicalPackage,
  type CypTransporterPanel,
  type ClearanceFractions,
  PRECLINICAL_PACKAGE_SCHEMA_VERSION,
} from "@workspace/preclinical-handoff";
import type { SimResults } from "./admet";
import type { MlAdmetResult } from "./aiService";
import type { AnimalCohortResults } from "./animalSim";

export const PRECLINICAL_EMITTER = {
  engine: "hakase-bio-l4-emitter",
  version: "1.0.0",
} as const;

export interface BuildPreClinicalPackageArgs {
  smiles: string;
  inchiKey: string | null;
  chemblId: string | null;
  compoundName: string | null;
  /** L1 In Vitro outputs (always present — L1 is the cascade entry point). */
  l1: SimResults;
  /** L1 ADMET-ML envelope; pass null if the ML model failed or was skipped. */
  mlAdmet: MlAdmetResult | null;
  /** L4 Animal Cohort cascade output. */
  l4: AnimalCohortResults;
  /** L2 In Silico outputs — populated only if L2 was actually run. */
  l2?: {
    humanCmax: number | null;
    humanAuc: number | null;
    humanHalfLife: number | null;
    humanClearance: number | null;
    fepDdgKcalMol: number | null;
    fepUncertaintyKcalMol: number | null;
  };
  /** In-vitro values not directly typed on SimResults. */
  inVitroExtras?: {
    hergIc50UM: number | null;
    caco2Permeability: number | null;
    plasmaProteinBindingFraction: number | null;
    primaryTargetUniprot: string | null;
    primaryTargetGeneSymbol: string | null;
    primaryTargetIc50nM: number | null;
  };
  /** Optional pre-collected provenance warnings (e.g. graceful-degradation). */
  warnings?: string[];
}

function readMlNumber(ml: MlAdmetResult, key: string): number | null {
  const v = ml.endpoints[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function round(x: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(x * k) / k;
}

/**
 * §6.1.a derivation. Returns null if no CYP probe is available.
 * Source is always `"ml-prediction"` here — this builder does NOT pretend to
 * have in-vitro data. Phase1Planner DDI consumers must treat ML values as
 * screening priors only.
 */
export function deriveCypTransporterPanel(
  ml: MlAdmetResult | null,
): CypTransporterPanel | null {
  if (!ml || ml.source !== "ml" || !ml.ml_available) return null;

  const cyp1a2 = readMlNumber(ml, "CYP1A2_Veith");
  const cyp2c9 = readMlNumber(ml, "CYP2C9_Veith");
  const cyp2c19 = readMlNumber(ml, "CYP2C19_Veith");
  const cyp2d6 = readMlNumber(ml, "CYP2D6_Veith");
  const cyp3a4 = readMlNumber(ml, "CYP3A4_Veith");
  const pgp = readMlNumber(ml, "Pgp_Broccatelli");

  const anyCyp = [cyp1a2, cyp2c9, cyp2c19, cyp2d6, cyp3a4].some(v => v !== null);
  if (!anyCyp && pgp === null) return null;

  return {
    cyp: {
      cyp1a2InhibitionProb: cyp1a2,
      cyp2c9InhibitionProb: cyp2c9,
      cyp2c19InhibitionProb: cyp2c19,
      cyp2d6InhibitionProb: cyp2d6,
      cyp3a4InhibitionProb: cyp3a4,
      inductionMrnaFoldChange: null,
      source: anyCyp ? "ml-prediction" : null,
    },
    transporters: {
      pgpInhibitionProb: pgp,
      bcrpInhibitionProb: null,
      oatp1b1InhibitionProb: null,
      oatp1b3InhibitionProb: null,
      oct2InhibitionProb: null,
      mate1InhibitionProb: null,
      source: pgp !== null ? "ml-prediction" : null,
    },
  };
}

/**
 * §6.1.b derivation. Conservative — requires BOTH a hepatic anchor
 * (ADMET-AI Clearance_Hepatocyte_AZ) AND a renal proxy (L1 excretion score)
 * to be present and finite. Returns null otherwise. Biliary is left at 0
 * because we have no honest basis to split it out from hepatic.
 */
export function deriveClearanceFractions(
  ml: MlAdmetResult | null,
  l1: SimResults,
): ClearanceFractions | null {
  if (!ml || ml.source !== "ml" || !ml.ml_available) return null;

  const hepClRaw = readMlNumber(ml, "Clearance_Hepatocyte_AZ");
  if (hepClRaw === null || hepClRaw <= 0) return null;

  const excScore = l1.admet?.excretion;
  if (typeof excScore !== "number" || !Number.isFinite(excScore)) return null;

  // Renal proxy: scale L1 excretion 0..1 → 0.05..0.65 (epidemiological range
  // for typical small molecules; never 0 — kidney always contributes — never
  // >0.65 to avoid implying a renal-only profile from a soft signal).
  const renalFraction = Math.max(0.05, Math.min(0.65, excScore * 0.65));
  const hepaticFraction = 1 - renalFraction;

  return {
    renalFraction: round(renalFraction, 3),
    hepaticFraction: round(hepaticFraction, 3),
    biliaryFraction: 0,
    otherFraction: 0,
    basis:
      `Hepatic anchor: ADMET-AI Clearance_Hepatocyte_AZ = ${hepClRaw.toFixed(2)} mL/min/kg. ` +
      `Renal proxy: L1 excretion score = ${excScore.toFixed(2)} → renal fraction = ${renalFraction.toFixed(2)}. ` +
      `Biliary not separately quantified (no honest basis from current inputs).`,
    source: "ml-prediction",
  };
}

export function buildPreClinicalPackage(
  a: BuildPreClinicalPackageArgs,
): PreClinicalPackage {
  const warnings: string[] = [...(a.warnings ?? [])];

  const cyp = deriveCypTransporterPanel(a.mlAdmet);
  const cl = deriveClearanceFractions(a.mlAdmet, a.l1);

  if (!cyp) {
    warnings.push(
      "CYP/transporter panel unavailable — L1 ADMET-ML did not return predictions; Phase1Planner DDI module will require an in-vitro CYP/transporter panel before proceeding.",
    );
  }
  if (!cl) {
    warnings.push(
      "Renal/hepatic clearance fractions unavailable — Phase1Planner Special-Pop module cannot branch renal-impairment vs hepatic-impairment study planning until route-fractional CL is provided.",
    );
  }

  const iv = a.inVitroExtras;

  return {
    schemaVersion: PRECLINICAL_PACKAGE_SCHEMA_VERSION,
    compound: {
      smiles: a.smiles,
      inchiKey: a.inchiKey,
      molecularWeight: a.l1.lipinski?.mw ?? null,
      chemblId: a.chemblId,
      preferredName: a.compoundName,
    },
    inVitro: {
      hergIc50UM: iv?.hergIc50UM ?? null,
      caco2Permeability: iv?.caco2Permeability ?? null,
      plasmaProteinBindingFraction: iv?.plasmaProteinBindingFraction ?? null,
      primaryTargetUniprot: iv?.primaryTargetUniprot ?? null,
      primaryTargetGeneSymbol: iv?.primaryTargetGeneSymbol ?? null,
      primaryTargetIc50nM: iv?.primaryTargetIc50nM ?? null,
    },
    inSilico: {
      humanProjectedCmaxNgPerMl: a.l2?.humanCmax ?? null,
      humanProjectedAucNgHPerMl: a.l2?.humanAuc ?? null,
      humanProjectedHalfLifeHours: a.l2?.humanHalfLife ?? null,
      humanProjectedClearanceLPerHPerKg: a.l2?.humanClearance ?? null,
      freeEnergyDdgKcalPerMol: a.l2?.fepDdgKcalMol ?? null,
      freeEnergyUncertaintyKcalPerMol: a.l2?.fepUncertaintyKcalMol ?? null,
    },
    animalCohort: {
      speciesId: a.l4.species.id,
      speciesDisplayName: a.l4.species.displayName,
      studyTypeId: a.l4.studyType.id,
      studyTypeLabel: a.l4.studyType.label,
      routeOfAdministration: a.l4.routeOfAdmin,
      noaelMgPerKg: a.l4.noael,
      mtdMgPerKg: a.l4.mtd,
      fihDoseMg: a.l4.fihDose,
      fihDoseMgPerKg: a.l4.fihDoseMgKg,
      hedBsaMgPerKg: a.l4.hedBsa,
      hedPbpkMgPerKg: a.l4.hedPbpk,
      safetyMarginNoael: a.l4.safetyMarginNoael,
      overallRisk: a.l4.overallRisk,
      toxicityFlags: a.l4.toxicityFlags.map(f => ({
        organ: f.organ,
        risk: f.risk,
        finding: f.finding,
        ichReference: f.ich,
      })),
      formulation: {
        formulationType: a.l4.formulationResult?.formulation?.id ?? "unknown",
        bcsClass: a.l4.formulationResult?.bcs?.class ?? null,
      },
      indEnablingComplete: a.l4.indEnablingComplete,
    },
    cypTransporterPanel: cyp,
    clearanceFractions: cl,
    provenance: {
      emittedAt: new Date().toISOString(),
      emitterEngine: PRECLINICAL_EMITTER.engine,
      emitterVersion: PRECLINICAL_EMITTER.version,
      l1EngineVersion: "hakase-l1-1.0",
      l2EngineVersion: a.l2 ? "hakase-l2-1.0" : null,
      l4EngineVersion: "hakase-l4-1.0",
      databaseQueries: [],
      warnings,
    },
  };
}
