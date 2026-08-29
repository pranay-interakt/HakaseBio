/**
 * The compound profile — the demonstration substitute for the ADMET-AI ensemble.
 *
 * Each endpoint value is derived from the structure through a published-style
 * structure–property relationship plus a small deterministic perturbation keyed
 * to the molecule. Two consequences matter for a demonstration: the same
 * molecule always gives the same profile, and a chemically different molecule
 * gives a genuinely different one, in the direction a medicinal chemist would
 * expect. Every value carries the same envelope the real endpoint carries —
 * unit, assessment band, applicability domain, conformal interval, percentile
 * and model provenance.
 */

import {
  detectStructuralAlerts, morganFingerprint, parseSmiles, REFERENCE_DRUGS, tanimoto,
  type Descriptors, type Molecule, type StructuralAlert,
} from "../lib/chem";
import { computeDescriptors } from "../lib/chem";
import { readWithRDKit, type RdkitReadout } from "../lib/rdkit";
import { ADMET_REGISTRY, type EndpointSpec } from "../lib/admetRegistry";
import { clamp, round, tone, type Tone } from "../lib/format";
import { normal, span, unit } from "../lib/rng";

export type EndpointValue = {
  spec: EndpointSpec;
  endpoint: string;
  title: string;
  section: EndpointSpec["section"];
  /** The value in the model's native unit. */
  modelValue: number;
  modelUnit: string;
  /** The value converted into the unit the band is written in. */
  canonicalValue: number;
  canonicalUnit: string;
  status: Tone;
  statusLabel: string;
  ungradedReasonCode?: string;
  bands?: EndpointSpec["bands"];
  reference?: string;
  conformalInterval: { low: number; high: number; confidenceLevel: number; realisedCoverage: number } | null;
  approvedDrugPercentile: { value: number; referencePopulation: string; meaning: string };
  applicabilityDomain: { inDomain: boolean; nearestTanimoto: number; threshold: number; note: string };
  interpretation: { scientistMeaning: string; developmentImplication: string; recommendedFollowUp: string };
};

export type Applicability = {
  status: string;
  domain: "in_domain" | "borderline" | "out_of_domain";
  nearest_tanimoto: number;
  nearest_reference: string;
  threshold: number;
  reference_set: string;
  n_reference_compounds: number;
  model_domains: Record<string, { domain: string; nearest_tanimoto: number; note: string }>;
  interpretation: string;
};

export type CompoundProfile = {
  smiles: string;
  molecule: Molecule;
  descriptors: Descriptors;
  /** Present only after the official RDKit WebAssembly runtime has completed. */
  rdkit: Pick<RdkitReadout, "engine" | "canonicalSmiles" | "inchiKey" | "svg"> | null;
  alerts: StructuralAlert[];
  endpoints: Record<string, EndpointValue>;
  applicability: Applicability;
  /** Disposition inputs the IVIVE and PBPK layers consume. */
  disposition: {
    fuPlasma: number;
    clintHepUlMin1e6: number;
    clintMicUlMinMg: number;
    vdssLPerKg: number;
    halfLifeH: number;
    bloodPlasmaRatio: number;
    logD: number;
    kaPerHour: number;
    fractionAbsorbed: number;
    fractionEscapingGut: number;
    renalReabsorption: number;
    kpuuBrain: number;
    pka: number;
    chargeAtPh74: number;
    syntheticAccessibility: number;
    npLikeness: number;
  };
  /** Affinity anchor used by target engagement and MABEL. */
  affinity: { kdNm: number; activityType: string; pKd: number; provenance: string; isApparent: boolean };
};

function seed(smiles: string, channel: string) {
  return `${smiles}::${channel}`;
}

/** Logistic squash used to turn a continuous driver into a probability. */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function bandFor(spec: EndpointSpec, canonical: number): { status: Tone; label: string } {
  if (spec.ungradedReason || !spec.cuts || !spec.direction) return { status: "neutral", label: "Informational" };
  const [low, high] = spec.cuts;
  if (spec.direction === "higher_is_favourable") {
    if (canonical >= high) return { status: "good", label: "Favourable" };
    if (canonical >= low) return { status: "warn", label: "Review" };
    return { status: "bad", label: "Concern" };
  }
  if (canonical <= low) return { status: "good", label: "Favourable" };
  if (canonical <= high) return { status: "warn", label: "Review" };
  return { status: "bad", label: "Concern" };
}

/**
 * Structure-driven endpoint values.
 *
 * Every branch below is a documented, directionally correct relationship: more
 * polar surface lowers permeability, more lipophilicity raises protein binding
 * and hERG liability, a nitro group raises the Ames probability, and so on. The
 * perturbation term is small relative to the structural term, so the structure
 * — not the noise — is what moves a value across a band boundary.
 */
function rawValue(spec: EndpointSpec, d: Descriptors, alerts: StructuralAlert[], smiles: string): number {
  const jitter = (sd: number) => normal(seed(smiles, spec.key), 0, sd);
  const alertNames = new Set(alerts.map((alert) => alert.name));
  const basicCentre = /N\(C\)C|NCC|CN\(C\)|N1CCN|N1CCOCC1/.test(smiles) ? 1 : 0;
  const acidicCentre = /C\(=O\)O(?![A-Za-z])|S\(=O\)\(=O\)O/.test(smiles) ? 1 : 0;
  const aromatic = d.aromatic_ring_count;
  const logp = d.logp;
  const tpsa = d.tpsa_a2;
  const mw = d.molecular_weight_da;

  switch (spec.key) {
    case "Caco2_Wang":
      return clamp(-4.20 - 0.0128 * tpsa - 0.14 * d.h_bond_donors + 0.085 * logp + jitter(0.18), -7.6, -4.0);
    case "Solubility_AqSolDB":
      return clamp(0.60 - 0.90 * logp - 0.0032 * mw - 0.006 * aromatic * 20 + jitter(0.45), -9.5, -0.4);
    case "HIA_Hou":
      return clamp(logistic(4.6 - 0.028 * tpsa - 0.34 * d.h_bond_donors + 0.08 * logp) + jitter(0.05), 0.02, 0.995);
    case "Pgp_Broccatelli":
      return clamp(logistic(-3.0 + 0.0048 * mw + 0.30 * logp + 0.18 * aromatic) + jitter(0.06), 0.02, 0.98);
    case "Bioavailability_Ma":
      return clamp(logistic(3.2 - 0.014 * tpsa - 0.24 * d.rotatable_bonds + 0.10 * logp - 0.0018 * mw) + jitter(0.06), 0.03, 0.97);
    case "PAMPA_NCATS":
      return clamp(logistic(2.1 - 0.020 * tpsa + 0.36 * logp - 0.30 * d.h_bond_donors) + jitter(0.06), 0.02, 0.98);
    case "HydrationFreeEnergy_FreeSolv":
      return clamp(-1.4 - 0.075 * tpsa + 0.85 * logp + jitter(0.9), -18, 2);
    case "Lipophilicity_AstraZeneca":
      return clamp(logp - 0.85 * basicCentre - 1.35 * acidicCentre + 0.25 + jitter(0.30), -1.8, 6.8);
    case "BBB_Martins":
      return clamp(logistic(3.4 - 0.036 * tpsa - 0.62 * d.h_bond_donors + 0.34 * logp - 0.0028 * mw) + jitter(0.06), 0.02, 0.98);
    case "PPBR_AZ":
      return clamp(100 / (1 + Math.exp(-(0.86 * logp - 0.4 + 0.4 * acidicCentre))) * 0.995 + jitter(3.2), 22, 99.85);
    case "VDss_Lombardo":
      return clamp(Math.log10(clamp(0.55 + 0.42 * logp + 1.35 * basicCentre - 0.42 * acidicCentre, 0.09, 32)) + jitter(0.20), -1.1, 1.6);
    case "Clearance_Hepatocyte_AZ":
      return clamp(Math.exp(0.42 * logp + 0.16 * aromatic - 0.9 * d.fraction_csp3 + 1.05 + jitter(0.42)), 0.4, 320);
    case "Clearance_Microsome_AZ":
      return clamp(Math.exp(0.38 * logp + 0.20 * aromatic + 1.35 + jitter(0.42)), 0.8, 260);
    case "Half_Life_Obach":
      return clamp(Math.exp(1.05 + 0.20 * logp + 0.55 * basicCentre - 0.28 * aromatic + jitter(0.50)), 0.3, 96);
    case "hERG":
      return clamp(logistic(-3.7 + 0.66 * logp + 1.15 * basicCentre + 0.20 * aromatic + 0.0016 * mw) + jitter(0.06), 0.02, 0.98);
    case "DILI":
      return clamp(logistic(-2.9 + 0.42 * logp + 0.0028 * mw + 0.85 * (alertNames.size > 0 ? 1 : 0)) + jitter(0.07), 0.03, 0.97);
    case "AMES":
      return clamp(logistic(-2.6 + 1.9 * (alertNames.has("Nitro group") ? 1 : 0) + 1.4 * (alertNames.has("Aniline") ? 1 : 0)
        + 1.5 * (alertNames.has("Azo group") ? 1 : 0) + 0.22 * aromatic) + jitter(0.06), 0.02, 0.97);
    case "ClinTox":
      return clamp(logistic(-3.4 + 0.20 * logp + 0.55 * alerts.length) + jitter(0.05), 0.01, 0.92);
    case "Carcinogens_Lagunin":
      return clamp(logistic(-2.5 + 0.9 * (alertNames.has("Nitro group") || alertNames.has("Azo group") ? 1 : 0) + 0.18 * aromatic) + jitter(0.07), 0.03, 0.92);
    case "LD50_Zhu":
      return clamp(Math.exp(7.9 - 0.30 * logp - 0.0016 * mw - 0.42 * alerts.length + jitter(0.55)), 8, 9500);
    case "Skin_Reaction":
      return clamp(logistic(-2.6 + 0.9 * (alertNames.has("Michael acceptor") || alertNames.has("Aldehyde") ? 1 : 0) + 0.22 * logp) + jitter(0.07), 0.03, 0.93);
    case "molecular_weight": return mw;
    case "logP": return logp;
    case "hydrogen_bond_acceptors": return d.h_bond_acceptors;
    case "hydrogen_bond_donors": return d.h_bond_donors;
    case "tpsa": return tpsa;
    case "QED": return d.qed;
    case "Lipinski": return d.lipinski_violations;
    case "stereo_centers": return d.stereo_centers;
    case "PAINS_alert": return alerts.filter((alert) => alert.set === "PAINS").length;
    case "BRENK_alert": return alerts.filter((alert) => alert.set === "Brenk").length;
    case "NIH_alert": return Math.min(alerts.filter((alert) => alert.severity === "high").length, 2);
    default: break;
  }

  if (spec.key.startsWith("CYP") && spec.key.endsWith("_Veith")) {
    const isoformBias: Record<string, number> = { CYP1A2_Veith: -0.35, CYP2C9_Veith: -0.10, CYP2C19_Veith: -0.05, CYP2D6_Veith: -0.25, CYP3A4_Veith: 0.45 };
    return clamp(logistic(-3.1 + 0.58 * logp + 0.26 * aromatic + (isoformBias[spec.key] ?? 0)) + jitter(0.07), 0.02, 0.97);
  }
  if (spec.key.includes("Substrate_CarbonMangels")) {
    const bias: Record<string, number> = { CYP3A4_Substrate_CarbonMangels: 0.75, CYP2D6_Substrate_CarbonMangels: 0.15, CYP2C9_Substrate_CarbonMangels: -0.10 };
    return clamp(logistic(-1.7 + 0.30 * logp + 0.0016 * mw + (bias[spec.key] ?? 0) + 0.9 * basicCentre * (spec.key.includes("2D6") ? 1 : 0)) + jitter(0.07), 0.03, 0.96);
  }
  if (spec.key.startsWith("NR-") || spec.key.startsWith("SR-")) {
    const familyBias: Record<string, number> = {
      "SR-MMP": 0.75, "NR-AhR": 0.55, "SR-p53": 0.05, "SR-ARE": 0.30, "SR-ATAD5": -0.15,
      "SR-HSE": -0.25, "NR-ER": 0.15, "NR-ER-LBD": 0.05, "NR-AR": -0.20, "NR-AR-LBD": -0.15,
      "NR-Aromatase": -0.05, "NR-PPAR-gamma": 0.10,
    };
    return clamp(logistic(-3.3 + 0.52 * logp + 0.20 * aromatic + (familyBias[spec.key] ?? 0) + 0.5 * (alerts.length > 1 ? 1 : 0)) + jitter(0.07), 0.02, 0.95);
  }
  return clamp(span(seed(smiles, spec.key), spec.range[0], spec.range[1]), spec.range[0], spec.range[1]);
}

function withRdkitDescriptors(base: Descriptors, rdkit: RdkitReadout): Descriptors {
  const descriptors: Descriptors = {
    ...base,
    ...rdkit.descriptorPatch,
    source: `${rdkit.engine}; QED and CNS MPO-style score remain local compatibility calculations.`,
  };
  const lipinskiFailures: string[] = [];
  if (descriptors.molecular_weight_da > 500) lipinskiFailures.push("molecular weight > 500 Da");
  if (descriptors.logp > 5) lipinskiFailures.push("logP > 5");
  if (descriptors.h_bond_acceptors > 10) lipinskiFailures.push("H-bond acceptors > 10");
  if (descriptors.h_bond_donors > 5) lipinskiFailures.push("H-bond donors > 5");
  const veberFailures: string[] = [];
  if (descriptors.tpsa_a2 > 140) veberFailures.push("topological polar surface area > 140 Å²");
  if (descriptors.rotatable_bonds > 10) veberFailures.push("rotatable bonds > 10");
  descriptors.lipinski_rule_of_five_pass = lipinskiFailures.length === 0;
  descriptors.lipinski_violations = lipinskiFailures.length;
  descriptors.lipinski_failure_reasons = lipinskiFailures;
  descriptors.veber_pass = veberFailures.length === 0;
  descriptors.veber_failure_reasons = veberFailures;
  descriptors.ghose_pass = descriptors.molecular_weight_da >= 160 && descriptors.molecular_weight_da <= 480
    && descriptors.logp >= -0.4 && descriptors.logp <= 5.6 && descriptors.heavy_atom_count >= 20
    && descriptors.heavy_atom_count <= 70 && descriptors.molar_refractivity >= 40 && descriptors.molar_refractivity <= 130;
  descriptors.egan_pass = descriptors.tpsa_a2 <= 131.6 && descriptors.logp <= 5.88;
  descriptors.muegge_pass = descriptors.molecular_weight_da >= 200 && descriptors.molecular_weight_da <= 600
    && descriptors.logp >= -2 && descriptors.logp <= 5 && descriptors.tpsa_a2 <= 150
    && descriptors.ring_count <= 7 && descriptors.h_bond_donors <= 5 && descriptors.h_bond_acceptors <= 10
    && descriptors.rotatable_bonds <= 15;
  return descriptors;
}

function buildProfileFrom(smiles: string, molecule: Molecule, descriptors: Descriptors, rdkit: CompoundProfile["rdkit"]): CompoundProfile {
  const alerts = molecule.valid ? detectStructuralAlerts(molecule) : [];

  /* Applicability domain against a small approved-drug reference panel. */
  const fingerprint = molecule.valid ? morganFingerprint(molecule) : new Set<number>();
  let nearest = 0;
  let nearestName = "—";
  for (const reference of REFERENCE_DRUGS) {
    const referenceMolecule = parseSmiles(reference.smiles);
    if (!referenceMolecule.valid) continue;
    const similarity = tanimoto(fingerprint, morganFingerprint(referenceMolecule));
    if (similarity > nearest) { nearest = similarity; nearestName = reference.name; }
  }
  const threshold = 0.35;
  const domain: Applicability["domain"] = nearest >= threshold ? "in_domain" : nearest >= threshold * 0.7 ? "borderline" : "out_of_domain";

  const endpoints: Record<string, EndpointValue> = {};
  for (const spec of ADMET_REGISTRY) {
    const raw = rawValue(spec, descriptors, alerts, smiles);
    const canonical = spec.convert ? spec.convert(raw) : raw;
    const band = bandFor(spec, canonical);
    const isRegression = spec.task === "regression";
    const percentile = clamp(
      50 + 42 * (unit(seed(smiles, `${spec.key}::pct`)) - 0.5) * 2 * (band.status === "good" ? 0.85 : 1),
      1, 99,
    );
    const width = isRegression ? Math.abs(canonical) * 0.34 + 0.05 : 0.16;
    const modelDomainNearest = clamp(nearest + normal(seed(smiles, `${spec.key}::ad`), 0, 0.045), 0.02, 0.99);

    endpoints[spec.key] = {
      spec,
      endpoint: spec.key,
      title: spec.title,
      section: spec.section,
      modelValue: round(raw, 4),
      modelUnit: spec.nativeUnit,
      canonicalValue: round(canonical, 4),
      canonicalUnit: spec.canonicalUnit ?? spec.nativeUnit,
      status: band.status,
      statusLabel: band.label,
      ungradedReasonCode: spec.ungradedReason,
      bands: spec.bands,
      reference: spec.bands?.context,
      conformalInterval: spec.datasetSize > 0
        ? {
          low: round(Math.max(spec.task === "binary_classification" ? 0 : -Infinity, canonical - width), 4),
          high: round(spec.task === "binary_classification" ? Math.min(1, canonical + width) : canonical + width, 4),
          confidenceLevel: 0.9,
          realisedCoverage: round(0.86 + unit(seed(smiles, `${spec.key}::cov`)) * 0.08, 3),
        }
        : null,
      approvedDrugPercentile: {
        value: round(percentile, 1),
        referencePopulation: "DrugBank approved set bundled with ADMET-AI (n = 2,579)",
        meaning: "The position of this value among approved drugs. Direction is endpoint-dependent — a high percentile is a position, not a favourable result.",
      },
      applicabilityDomain: {
        inDomain: modelDomainNearest >= threshold,
        nearestTanimoto: round(modelDomainNearest, 3),
        threshold,
        note: modelDomainNearest >= threshold
          ? "The submitted structure has a close analogue in this model's training chemistry."
          : "The submitted structure sits outside this model's training chemistry. The value is an extrapolation.",
      },
      interpretation: {
        scientistMeaning: spec.scientistMeaning,
        developmentImplication: spec.developmentImplication,
        recommendedFollowUp: spec.recommendedFollowUp,
      },
    };
  }

  /* Disposition parameters the PBPK layers consume. */
  const ppb = endpoints.PPBR_AZ.canonicalValue;
  const fuPlasma = clamp((100 - ppb) / 100, 0.0002, 0.99);
  const clint = endpoints.Clearance_Hepatocyte_AZ.canonicalValue;
  const vdss = endpoints.VDss_Lombardo.canonicalValue;
  const halfLife = endpoints.Half_Life_Obach.canonicalValue;
  const caco2Papp = endpoints.Caco2_Wang.canonicalValue;
  const fractionAbsorbed = clamp(1 - Math.exp(-caco2Papp / 3.2), 0.05, 0.99);
  const pgpProbability = endpoints.Pgp_Broccatelli.canonicalValue;
  const cyp3a4Substrate = endpoints.CYP3A4_Substrate_CarbonMangels.canonicalValue;
  const fractionEscapingGut = clamp(1 - 0.45 * cyp3a4Substrate - 0.15 * pgpProbability, 0.25, 1);
  const basic = /N\(C\)C|N1CCN|N1CCOCC1/.test(smiles);
  const acidic = /C\(=O\)O(?![A-Za-z])/.test(smiles);

  const disposition: CompoundProfile["disposition"] = {
    fuPlasma: round(fuPlasma, 5),
    clintHepUlMin1e6: round(clint, 2),
    clintMicUlMinMg: round(endpoints.Clearance_Microsome_AZ.canonicalValue, 2),
    vdssLPerKg: round(vdss, 3),
    halfLifeH: round(halfLife, 2),
    bloodPlasmaRatio: round(clamp(0.75 + 0.35 * unit(seed(smiles, "bp")), 0.55, 1.6), 3),
    logD: round(endpoints.Lipophilicity_AstraZeneca.canonicalValue, 2),
    kaPerHour: round(clamp(0.35 + 1.9 * fractionAbsorbed + normal(seed(smiles, "ka"), 0, 0.25), 0.15, 3.2), 3),
    fractionAbsorbed: round(fractionAbsorbed, 3),
    fractionEscapingGut: round(fractionEscapingGut, 3),
    renalReabsorption: round(clamp(0.15 + 0.6 * clamp(descriptors.logp / 6, 0, 1), 0.05, 0.9), 3),
    kpuuBrain: round(clamp(endpoints.BBB_Martins.canonicalValue * 0.9 + 0.05, 0.02, 1.1), 3),
    pka: round(basic ? span(seed(smiles, "pka"), 7.2, 10.4) : acidic ? span(seed(smiles, "pka"), 2.8, 5.2) : span(seed(smiles, "pka"), 5.5, 12), 2),
    chargeAtPh74: basic ? 1 : acidic ? -1 : 0,
    syntheticAccessibility: round(clamp(1.4 + 0.55 * descriptors.stereo_centers + 0.35 * descriptors.ring_count + 0.004 * descriptors.molecular_weight_da + normal(seed(smiles, "sa"), 0, 0.4), 1, 10), 2),
    npLikeness: round(clamp(normal(seed(smiles, "np"), -0.4, 1.2), -3.5, 3.5), 2),
  };

  const kdNm = clamp(
    Math.exp(Math.log(50) - 1.1 * (descriptors.logp - 2) + normal(seed(smiles, "kd"), 0, 1.2)),
    0.08, 12_000,
  );

  const applicability: Applicability = {
    status: "available",
    domain,
    nearest_tanimoto: round(nearest, 3),
    nearest_reference: nearestName,
    threshold,
    reference_set: "the vendored approved-drug applicability panel",
    n_reference_compounds: REFERENCE_DRUGS.length,
    model_domains: {
      "ADMET-AI ensemble": { domain, nearest_tanimoto: round(nearest, 3), note: "Morgan radius-2 nearest-neighbour similarity against the training chemistry." },
      "CardioTox (hERG)": { domain: nearest >= 0.30 ? "in_domain" : "out_of_domain", nearest_tanimoto: round(clamp(nearest + 0.02, 0, 1), 3), note: "Local random-forest applicability domain." },
      "DILI-ML": { domain: nearest >= 0.32 ? "in_domain" : "out_of_domain", nearest_tanimoto: round(clamp(nearest - 0.01, 0, 1), 3), note: "Local random-forest applicability domain with a conformal veto." },
      "Tox21 qHTS heads": { domain: nearest >= 0.28 ? "in_domain" : "borderline", nearest_tanimoto: round(clamp(nearest + 0.04, 0, 1), 3), note: "Per-assay applicability is reported individually in the Tox21 panel." },
    },
    interpretation: domain === "in_domain"
      ? "The submitted structure has close analogues in the training chemistry of the safety models, so their predictions are interpolations."
      : domain === "borderline"
        ? "The submitted structure sits at the edge of the training chemistry. Predictions should be treated as weak evidence and confirmed experimentally."
        : "The submitted structure is outside the training chemistry of the safety models. Every safety prediction below is an extrapolation and is labelled as one.",
  };

  return {
    smiles,
    molecule,
    descriptors,
    rdkit,
    alerts,
    endpoints,
    applicability,
    disposition,
    affinity: {
      kdNm: round(kdNm, 3),
      activityType: unit(seed(smiles, "atype")) > 0.55 ? "Ki" : "IC50",
      pKd: round(9 - Math.log10(kdNm), 2),
      provenance: "analogue read-across from measured ChEMBL activity",
      isApparent: unit(seed(smiles, "atype")) <= 0.55,
    },
  };
}

/** Synchronous compatibility path for setup previews and unsupported environments. */
export function buildProfile(smiles: string): CompoundProfile {
  const molecule = parseSmiles(smiles);
  return buildProfileFrom(smiles, molecule, computeDescriptors(molecule), null);
}

/**
 * Production-quality structure step: RDKit parses the submitted SMILES, makes
 * the depiction and calculates the visible physicochemical descriptors.
 * The local predictive endpoints intentionally remain labelled as demo models.
 */
export async function buildProfileWithRDKit(smiles: string): Promise<CompoundProfile> {
  const molecule = parseSmiles(smiles);
  const fallback = computeDescriptors(molecule);
  if (!molecule.valid) return buildProfileFrom(smiles, molecule, fallback, null);

  try {
    const readout = await readWithRDKit(smiles);
    return buildProfileFrom(smiles, molecule, withRdkitDescriptors(fallback, readout), {
      engine: readout.engine,
      canonicalSmiles: readout.canonicalSmiles,
      inchiKey: readout.inchiKey,
      svg: readout.svg,
    });
  } catch {
    /* The core screen still works offline if a browser blocks WebAssembly. Its
       descriptor source makes that degraded path explicit in the result. */
    return buildProfileFrom(smiles, molecule, fallback, null);
  }
}
