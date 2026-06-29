/**
 * Stage 5 — DILI biomarker proxy (deterministic rule table per Spec v1.1 §3.6).
 *
 * Maps Stage 2 mechanism flags (mitochondrial / BSEP / ROS / immune) to the
 * expected serum / urine biomarker pattern that a wet-lab DILI assay panel
 * would surface. References are the original DILI biomarker literature:
 *   - Antoine 2013 (mitochondrial → GLDH)
 *   - DILIN classification (cholestatic / hepatocellular pattern)
 *   - Wang 2009 / Starkey Lewis 2011 (miR-122 as early hepatocellular biomarker)
 *   - Andrade 2019 (immune-mediated DILI priors)
 *
 * Pure function, no I/O, no ML. Tagged as in-house deterministic so the
 * Amber Curator surfaces it as t0 (vs t-user manual entry).
 */

export interface DiliMechanisms {
  mitochondrial: boolean;
  bsep: boolean;
  ros: boolean;
  immune: boolean;
}

export interface BiomarkerEntry {
  name: string;
  rationale: string;
}

export function deriveBiomarkers(mech: DiliMechanisms): BiomarkerEntry[] {
  const out: BiomarkerEntry[] = [];
  if (mech.mitochondrial) {
    out.push({ name: "GLDH (glutamate dehydrogenase)", rationale: "Mitochondrial damage marker · Antoine 2013" });
  }
  if (mech.bsep) {
    out.push({ name: "ALP (alkaline phosphatase)", rationale: "Cholestatic pattern from BSEP inhibition · DILIN classification" });
    out.push({ name: "Total bilirubin",            rationale: "Cholestatic pattern · Hy's Law triad component" });
  }
  if (mech.ros) {
    out.push({ name: "ALT (alanine aminotransferase)", rationale: "Hepatocellular damage from oxidative stress" });
    out.push({ name: "miR-122",                        rationale: "Early hepatocellular biomarker · Wang 2009 / Starkey Lewis 2011" });
  }
  if (mech.immune) {
    out.push({ name: "Eosinophil count",       rationale: "Immune-mediated DILI prior · Andrade 2019" });
    out.push({ name: "ALT + IgE elevation",     rationale: "Hypersensitivity reaction marker" });
  }
  if (out.length === 0) {
    out.push({ name: "Routine LFT panel", rationale: "No DILI mechanism flagged — ALT/AST/ALP routine monitoring only" });
  }
  return out;
}
