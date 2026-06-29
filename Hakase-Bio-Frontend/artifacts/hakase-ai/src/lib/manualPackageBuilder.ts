import {
  PRECLINICAL_PACKAGE_SCHEMA_VERSION,
  type PreClinicalPackage,
} from "@workspace/preclinical-handoff";

/**
 * Manual Entry form fields. Strings (not numbers) so the input layer can
 * stay raw and validation centralizes here. Empty string / undefined ⇒
 * the field is missing → emits null per project policy.
 */
export interface ManualPackageInput {
  // Compound
  smiles: string;
  preferredName: string;
  chemblId: string;
  inchiKey: string;
  molecularWeight: string;

  // L1
  hergIc50UM: string;
  caco2Permeability: string;
  plasmaProteinBindingFraction: string;
  primaryTargetUniprot: string;
  primaryTargetGeneSymbol: string;
  primaryTargetIc50nM: string;

  // L2
  humanProjectedCmaxNgPerMl: string;
  humanProjectedAucNgHPerMl: string;
  humanProjectedHalfLifeHours: string;
  humanProjectedClearanceLPerHPerKg: string;

  // L4
  speciesId: string;
  speciesDisplayName: string;
  studyTypeId: string;
  studyTypeLabel: string;
  routeOfAdministration: string;
  noaelMgPerKg: string;
  mtdMgPerKg: string;
  fihDoseMg: string;
  fihDoseMgPerKg: string;
  hedBsaMgPerKg: string;
  hedPbpkMgPerKg: string;
  safetyMarginNoael: string;
  overallRisk: "low" | "moderate" | "high";
}

export const EMPTY_MANUAL_INPUT: ManualPackageInput = {
  smiles: "",
  preferredName: "",
  chemblId: "",
  inchiKey: "",
  molecularWeight: "",
  hergIc50UM: "",
  caco2Permeability: "",
  plasmaProteinBindingFraction: "",
  primaryTargetUniprot: "",
  primaryTargetGeneSymbol: "",
  primaryTargetIc50nM: "",
  humanProjectedCmaxNgPerMl: "",
  humanProjectedAucNgHPerMl: "",
  humanProjectedHalfLifeHours: "",
  humanProjectedClearanceLPerHPerKg: "",
  speciesId: "",
  speciesDisplayName: "",
  studyTypeId: "",
  studyTypeLabel: "",
  routeOfAdministration: "",
  noaelMgPerKg: "",
  mtdMgPerKg: "",
  fihDoseMg: "",
  fihDoseMgPerKg: "",
  hedBsaMgPerKg: "",
  hedPbpkMgPerKg: "",
  safetyMarginNoael: "",
  overallRisk: "moderate",
};

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function reqNum(s: string, label: string, errs: string[]): number {
  const v = numOrNull(s);
  if (v === null) {
    errs.push(`${label} must be a finite number`);
    return Number.NaN;
  }
  return v;
}

function reqStr(s: string, label: string, errs: string[]): string {
  const t = s.trim();
  if (t === "") {
    errs.push(`${label} is required`);
    return "";
  }
  return t;
}

export interface BuildResult {
  ok: boolean;
  pkg: PreClinicalPackage | null;
  errors: string[];
}

/**
 * Build a v1.0.0 PreClinicalPackage from the manual form. Honest about
 * what's missing: required L4 numbers (NOAEL/MTD/FIH/etc.) are validated;
 * everything optional is emitted as `null` (not defaulted) and a warning
 * is appended to provenance.warnings naming the gap. The §6.1.a CYP/
 * Transporter panel and §6.1.b Clearance Fractions are always emitted as
 * `null` from manual entry (those require ML probes / hepatocyte clearance
 * data the user does not have on hand).
 */
export function buildManualPackage(input: ManualPackageInput): BuildResult {
  const errors: string[] = [];

  const noael = reqNum(input.noaelMgPerKg, "NOAEL (mg/kg)", errors);
  const mtd = reqNum(input.mtdMgPerKg, "MTD (mg/kg)", errors);
  const fihMg = reqNum(input.fihDoseMg, "FIH dose (mg)", errors);
  const fihMgKg = reqNum(input.fihDoseMgPerKg, "FIH dose (mg/kg)", errors);
  const hedBsa = reqNum(input.hedBsaMgPerKg, "HED-BSA (mg/kg)", errors);
  const hedPbpk = reqNum(input.hedPbpkMgPerKg, "HED-PBPK (mg/kg)", errors);
  const margin = reqNum(input.safetyMarginNoael, "Safety margin", errors);

  const smiles = reqStr(input.smiles, "SMILES", errors);
  const speciesId = reqStr(input.speciesId, "Species ID", errors);
  const speciesDisplayName = reqStr(
    input.speciesDisplayName,
    "Species display name",
    errors,
  );
  const studyTypeId = reqStr(input.studyTypeId, "Study type ID", errors);
  const studyTypeLabel = reqStr(
    input.studyTypeLabel,
    "Study type label",
    errors,
  );
  const route = reqStr(input.routeOfAdministration, "Route", errors);

  if (errors.length > 0) {
    return { ok: false, pkg: null, errors };
  }

  const warnings: string[] = [];

  const inchiKey = strOrNull(input.inchiKey);
  const chemblId = strOrNull(input.chemblId);
  const preferredName = strOrNull(input.preferredName);
  const mw = numOrNull(input.molecularWeight);

  const hergIc50UM = numOrNull(input.hergIc50UM);
  const caco2 = numOrNull(input.caco2Permeability);
  const ppb = numOrNull(input.plasmaProteinBindingFraction);
  const tgtUniprot = strOrNull(input.primaryTargetUniprot);
  const tgtGene = strOrNull(input.primaryTargetGeneSymbol);
  const tgtIc50 = numOrNull(input.primaryTargetIc50nM);

  const cmax = numOrNull(input.humanProjectedCmaxNgPerMl);
  const auc = numOrNull(input.humanProjectedAucNgHPerMl);
  const t12 = numOrNull(input.humanProjectedHalfLifeHours);
  const cl = numOrNull(input.humanProjectedClearanceLPerHPerKg);

  if (hergIc50UM === null && caco2 === null && ppb === null) {
    warnings.push(
      "Manual entry: no L1 in-vitro values provided (hERG / Caco-2 / PPB all null).",
    );
  }
  if (cmax === null && auc === null && t12 === null && cl === null) {
    warnings.push(
      "Manual entry: no L2 in-silico human PK projections provided.",
    );
  }
  warnings.push(
    "Manual entry: §6.1.a CYP/Transporter panel emitted as null — Phase 1 DDI module will refuse to run.",
  );
  warnings.push(
    "Manual entry: §6.1.b Clearance Fractions emitted as null — Special-Pop renal/hepatic branching will refuse to run.",
  );

  const pkg: PreClinicalPackage = {
    schemaVersion: PRECLINICAL_PACKAGE_SCHEMA_VERSION,
    compound: {
      smiles,
      inchiKey,
      molecularWeight: mw,
      chemblId,
      preferredName,
    },
    inVitro: {
      hergIc50UM,
      caco2Permeability: caco2,
      plasmaProteinBindingFraction: ppb,
      primaryTargetUniprot: tgtUniprot,
      primaryTargetGeneSymbol: tgtGene,
      primaryTargetIc50nM: tgtIc50,
    },
    inSilico: {
      humanProjectedCmaxNgPerMl: cmax,
      humanProjectedAucNgHPerMl: auc,
      humanProjectedHalfLifeHours: t12,
      humanProjectedClearanceLPerHPerKg: cl,
      freeEnergyDdgKcalPerMol: null,
      freeEnergyUncertaintyKcalPerMol: null,
    },
    animalCohort: {
      speciesId,
      speciesDisplayName,
      studyTypeId,
      studyTypeLabel,
      routeOfAdministration: route,
      noaelMgPerKg: noael,
      mtdMgPerKg: mtd,
      fihDoseMg: fihMg,
      fihDoseMgPerKg: fihMgKg,
      hedBsaMgPerKg: hedBsa,
      hedPbpkMgPerKg: hedPbpk,
      safetyMarginNoael: margin,
      overallRisk: input.overallRisk,
      toxicityFlags: [],
      formulation: { formulationType: "user-provided", bcsClass: null },
      indEnablingComplete: false,
    },
    cypTransporterPanel: null,
    clearanceFractions: null,
    provenance: {
      emittedAt: new Date().toISOString(),
      emitterEngine: "hakase-clinical-manual-entry",
      emitterVersion: "1.0.0",
      l1EngineVersion: null,
      l2EngineVersion: null,
      l4EngineVersion: null,
      databaseQueries: [],
      warnings,
    },
  };

  return { ok: true, pkg, errors: [] };
}
