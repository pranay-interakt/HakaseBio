/**
 * Drug-likeness rules — exact published thresholds.
 *
 * Each rule returns `passes` plus the list of which sub-constraints failed,
 * so the UI can render specific violations instead of a single boolean.
 *
 * References:
 *   Lipinski, C. A. et al. "Experimental and computational approaches to
 *     estimate solubility and permeability in drug discovery and development
 *     settings." Adv. Drug Deliv. Rev. 1997, 23, 3–25.
 *   Veber, D. F. et al. "Molecular properties that influence the oral
 *     bioavailability of drug candidates." J. Med. Chem. 2002, 45, 2615.
 *   Egan, W. J.; Merz, K. M.; Baldwin, J. J. "Prediction of drug absorption
 *     using multivariate statistics." J. Med. Chem. 2000, 43, 3867.
 *   Ghose, A. K.; Viswanadhan, V. N.; Wendoloski, J. J. J. Comb. Chem. 1999, 1, 55.
 *   Muegge, I.; Heald, S. L.; Brittelli, D. J. Med. Chem. 2001, 44, 1841.
 *   Hughes, J. D. et al. (Pfizer). "Physiochemical drug properties associated
 *     with in vivo toxicological outcomes." Bioorg. Med. Chem. Lett. 2008,
 *     18, 4872 — the "3/75 rule" (logP < 3, TPSA > 75).
 *   Gleeson, M. P. (GSK). "Generation of a set of simple, interpretable ADMET
 *     rules of thumb." J. Med. Chem. 2008, 51, 817 — the "4/400 rule".
 */

import type { Descriptors, DrugLikeness, DrugLikenessRule } from "./types";

function rule(name: string, reference: string, checks: Array<[string, boolean]>): DrugLikenessRule {
  const violations = checks.filter(([, ok]) => !ok).map(([msg]) => msg);
  return { name, reference, passes: violations.length === 0, violations };
}

export function lipinski(d: Descriptors): DrugLikenessRule {
  // Original "Rule of Five": allow at most one violation among the four criteria.
  const checks: Array<[string, boolean]> = [
    [`MW ≤ 500 (got ${d.mw.toFixed(1)})`, d.mw <= 500],
    [`logP ≤ 5 (got ${d.clogP.toFixed(2)})`, d.clogP <= 5],
    [`HBD ≤ 5 (got ${d.hbd})`, d.hbd <= 5],
    [`HBA ≤ 10 (got ${d.hba})`, d.hba <= 10],
  ];
  const violations = checks.filter(([, ok]) => !ok).map(([msg]) => msg);
  return {
    name: "Lipinski Rule of Five",
    reference: "Lipinski 1997 (Adv. Drug Deliv. Rev. 23:3)",
    passes: violations.length <= 1, // canonical: ≤1 violation
    violations,
  };
}

export function veber(d: Descriptors): DrugLikenessRule {
  return rule(
    "Veber",
    "Veber 2002 (J. Med. Chem. 45:2615)",
    [
      [`Rotatable bonds ≤ 10 (got ${d.rotatableBonds})`, d.rotatableBonds <= 10],
      [`TPSA ≤ 140 Å² (got ${d.tpsa.toFixed(1)})`, d.tpsa <= 140],
    ],
  );
}

export function egan(d: Descriptors): DrugLikenessRule {
  return rule(
    "Egan",
    "Egan 2000 (J. Med. Chem. 43:3867)",
    [
      [`logP ≤ 5.88 (got ${d.clogP.toFixed(2)})`, d.clogP <= 5.88],
      [`TPSA ≤ 131.6 Å² (got ${d.tpsa.toFixed(1)})`, d.tpsa <= 131.6],
    ],
  );
}

export function ghose(d: Descriptors): DrugLikenessRule {
  return rule(
    "Ghose",
    "Ghose 1999 (J. Comb. Chem. 1:55)",
    [
      [`160 ≤ MW ≤ 480 (got ${d.mw.toFixed(1)})`, d.mw >= 160 && d.mw <= 480],
      [`-0.4 ≤ logP ≤ 5.6 (got ${d.clogP.toFixed(2)})`, d.clogP >= -0.4 && d.clogP <= 5.6],
      [`40 ≤ MR ≤ 130 (got ${d.mr.toFixed(1)})`, d.mr >= 40 && d.mr <= 130],
      [`20 ≤ atoms ≤ 70 (got ${d.heavyAtoms})`, d.heavyAtoms >= 20 && d.heavyAtoms <= 70],
    ],
  );
}

export function muegge(d: Descriptors): DrugLikenessRule {
  return rule(
    "Muegge",
    "Muegge 2001 (J. Med. Chem. 44:1841)",
    [
      [`200 ≤ MW ≤ 600 (got ${d.mw.toFixed(1)})`, d.mw >= 200 && d.mw <= 600],
      [`-2 ≤ logP ≤ 5 (got ${d.clogP.toFixed(2)})`, d.clogP >= -2 && d.clogP <= 5],
      [`TPSA ≤ 150 Å² (got ${d.tpsa.toFixed(1)})`, d.tpsa <= 150],
      [`Rings ≤ 7 (got ${d.totalRings})`, d.totalRings <= 7],
      [`HBD ≤ 5 (got ${d.hbd})`, d.hbd <= 5],
      [`HBA ≤ 10 (got ${d.hba})`, d.hba <= 10],
      [`Rotatable bonds ≤ 15 (got ${d.rotatableBonds})`, d.rotatableBonds <= 15],
    ],
  );
}

export function pfizer3_75(d: Descriptors): DrugLikenessRule {
  // Pfizer 3/75: compounds with logP > 3 AND TPSA < 75 are 2.5× more likely
  // to show in-vivo toxicity. The rule "passes" when the compound is OUTSIDE
  // that toxic-prone box.
  const inToxBox = d.clogP > 3 && d.tpsa < 75;
  return rule(
    "Pfizer 3/75",
    "Hughes 2008 (Bioorg. Med. Chem. Lett. 18:4872)",
    [
      [
        `Not in toxicity-prone region (logP > 3 AND TPSA < 75)` +
          ` — got logP=${d.clogP.toFixed(2)}, TPSA=${d.tpsa.toFixed(1)}`,
        !inToxBox,
      ],
    ],
  );
}

export function gsk4_400(d: Descriptors): DrugLikenessRule {
  return rule(
    "GSK 4/400",
    "Gleeson 2008 (J. Med. Chem. 51:817)",
    [
      [`MW ≤ 400 (got ${d.mw.toFixed(1)})`, d.mw <= 400],
      [`logP ≤ 4 (got ${d.clogP.toFixed(2)})`, d.clogP <= 4],
    ],
  );
}

export function computeDrugLikeness(d: Descriptors): DrugLikeness {
  const rules = {
    lipinski: lipinski(d),
    veber: veber(d),
    egan: egan(d),
    ghose: ghose(d),
    muegge: muegge(d),
    pfizer3_75: pfizer3_75(d),
    gsk4_400: gsk4_400(d),
  };
  const passCount = Object.values(rules).filter((r) => r.passes).length;
  const overall: DrugLikeness["overall"] =
    passCount >= 6 ? "drug-like" : passCount >= 4 ? "borderline" : "non-drug-like";
  return { ...rules, overall };
}
