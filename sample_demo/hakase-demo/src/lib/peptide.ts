/**
 * Peptide sequence properties.
 *
 * Mirrors the descriptor set the production sequence platform computes
 * (`platform/sequence/src/hakase_sequence/properties.py`), so the demo shows the
 * same quantities the real service returns rather than an invented subset.
 *
 * WHY THIS IS NOT THE SMALL-MOLECULE PATH
 * ───────────────────────────────────────
 * A peptide is submitted as a sequence, not a structure, and the two are not
 * interchangeable. Almost nothing from the small-molecule screen transfers: the
 * rule of five is a heuristic derived from approved *oral small molecules* and
 * a 2 kDa peptide fails it by construction without that meaning anything, and
 * the ADMET-AI endpoints are trained on small-molecule chemistry so their
 * applicability domain excludes a peptide outright. This module therefore
 * computes peptide-appropriate properties and the workspace reports the
 * small-molecule cascade as not applicable rather than running it and showing
 * numbers that do not mean what they appear to.
 *
 * WHAT A BARE SEQUENCE CANNOT CARRY
 * ─────────────────────────────────
 * Every value here is for the linear, free-acid, fully reduced peptide, because
 * that is all a one-letter sequence encodes. Disulfide bridges, C-terminal
 * amidation, N-terminal acetylation, glycosylation and non-natural residues all
 * change the mass and often the charge, and none of them is expressible in this
 * input. Oxytocin is the standard illustration: this module returns 1010.19 Da
 * for CYIQNCPLG, while the natural hormone is 1007.19 Da because it is
 * disulfide-bridged (−2.02) and C-amidated (−0.99). A modified peptide has to be
 * declared as such, not inferred from its letters.
 *
 * Ambiguous residues are rejected rather than guessed, matching the service:
 * B (D/N), Z (E/Q), J (I/L), X (any), U (selenocysteine) and O (pyrrolysine)
 * would each change the mass and charge that follow.
 */

/** The twenty standard residues. Anything else is refused. */
const STANDARD = "ACDEFGHIKLMNPQRSTVWY";

/** Average residue masses (Da), i.e. the free amino acid less one water. */
const RESIDUE_MASS: Record<string, number> = {
  A: 71.0788, C: 103.1388, D: 115.0886, E: 129.1155, F: 147.1766,
  G: 57.0519, H: 137.1411, I: 113.1594, K: 128.1741, L: 113.1594,
  M: 131.1926, N: 114.1038, P: 97.1167, Q: 128.1307, R: 156.1875,
  S: 87.0782, T: 101.1051, V: 99.1326, W: 186.2132, Y: 163.1760,
};
const WATER = 18.0153;

/** Kyte & Doolittle 1982 hydropathy. */
const HYDROPATHY: Record<string, number> = {
  A: 1.8, C: 2.5, D: -3.5, E: -3.5, F: 2.8, G: -0.4, H: -3.2, I: 4.5,
  K: -3.9, L: 3.8, M: 1.9, N: -3.5, P: -1.6, Q: -3.5, R: -4.5, S: -0.8,
  T: -0.7, V: 4.2, W: -0.9, Y: -1.3,
};

/** Boman 1999 potential protein-interaction index, in kcal/mol. */
const BOMAN: Record<string, number> = {
  A: -0.5, C: -1.0, D: 3.0, E: 3.0, F: -2.5, G: 0.0, H: -0.5, I: -1.8,
  K: 3.0, L: -1.8, M: -1.3, N: 0.2, P: 0.0, Q: 0.2, R: 3.0, S: 0.3,
  T: -0.4, V: -1.5, W: -3.4, Y: -2.3,
};

/** EMBOSS pKa set, as used for isoelectric point titration. */
const PKA_SIDE: Record<string, number> = { D: 3.65, E: 4.25, C: 8.18, Y: 10.07, H: 6.00, K: 10.53, R: 12.48 };
const PKA_N_TERM = 8.6;
const PKA_C_TERM = 3.6;
const ACIDIC = new Set(["D", "E", "C", "Y"]);

export type SequenceIssue = { code: "empty" | "ambiguous" | "invalid" | "too_short"; detail: string };

export type PeptideProperties = {
  sequence: string;
  length: number;
  molecularWeightDa: number;
  /** Net charge at physiological pH. */
  netChargeAtPh74: number;
  isoelectricPoint: number;
  gravy: number;
  aliphaticIndex: number;
  bomanIndex: number;
  aromaticity: number;
  /** Molar extinction at 280 nm, M⁻¹cm⁻¹, assuming reduced cysteines. */
  extinctionCoefficient: number;
  counts: Record<string, number>;
};

/** Validate a sequence, refusing anything the mass and charge would have to guess at. */
export function validateSequence(raw: string): SequenceIssue | null {
  const sequence = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!sequence) return { code: "empty", detail: "Enter a one-letter amino-acid sequence." };
  const ambiguous = [...new Set([...sequence].filter((residue) => "BZJXUO".includes(residue)))];
  if (ambiguous.length) {
    return {
      code: "ambiguous",
      detail: `Ambiguous residues are rejected rather than guessed: ${ambiguous.join(", ")}. Each would change the mass and the charge that follow from it.`,
    };
  }
  const invalid = [...new Set([...sequence].filter((residue) => !STANDARD.includes(residue)))];
  if (invalid.length) return { code: "invalid", detail: `Not an amino-acid letter: ${invalid.join(", ")}.` };
  if (sequence.length < 2) return { code: "too_short", detail: "A peptide needs at least two residues." };
  return null;
}

export function cleanSequence(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Net charge at a given pH, by Henderson–Hasselbalch over the ionisable groups. */
function chargeAtPh(counts: Record<string, number>, ph: number): number {
  let charge = 1 / (1 + 10 ** (ph - PKA_N_TERM));
  charge -= 1 / (1 + 10 ** (PKA_C_TERM - ph));
  for (const [residue, pka] of Object.entries(PKA_SIDE)) {
    const n = counts[residue] ?? 0;
    if (!n) continue;
    charge += ACIDIC.has(residue)
      ? -n / (1 + 10 ** (pka - ph))
      : n / (1 + 10 ** (ph - pka));
  }
  return charge;
}

export function computePeptideProperties(raw: string): PeptideProperties | null {
  const sequence = cleanSequence(raw);
  if (validateSequence(sequence)) return null;

  const counts: Record<string, number> = {};
  for (const residue of sequence) counts[residue] = (counts[residue] ?? 0) + 1;

  const molecularWeightDa = [...sequence].reduce((sum, residue) => sum + RESIDUE_MASS[residue], 0) + WATER;
  const gravy = [...sequence].reduce((sum, residue) => sum + HYDROPATHY[residue], 0) / sequence.length;
  const bomanIndex = [...sequence].reduce((sum, residue) => sum + BOMAN[residue], 0) / sequence.length;

  /* Ikai 1980: A + a·V + b·(I + L), as mole percentages, with a = 2.9, b = 3.9. */
  const molePercent = (residue: string) => ((counts[residue] ?? 0) / sequence.length) * 100;
  const aliphaticIndex = molePercent("A") + 2.9 * molePercent("V") + 3.9 * (molePercent("I") + molePercent("L"));

  const aromaticity = (["F", "W", "Y"].reduce((sum, residue) => sum + (counts[residue] ?? 0), 0)) / sequence.length;

  /* Gill & von Hippel 1989, reduced cysteines. */
  const extinctionCoefficient = (counts.W ?? 0) * 5500 + (counts.Y ?? 0) * 1490;

  /* Bisection on the titration curve — the charge function is monotonic in pH,
     so this converges without needing a derivative. */
  let low = 0, high = 14;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (chargeAtPh(counts, mid) > 0) low = mid; else high = mid;
  }
  const isoelectricPoint = (low + high) / 2;

  return {
    sequence, length: sequence.length, molecularWeightDa,
    netChargeAtPh74: chargeAtPh(counts, 7.4),
    isoelectricPoint, gravy, aliphaticIndex, bomanIndex, aromaticity,
    extinctionCoefficient, counts,
  };
}

export type PeptideFlag = { title: string; detail: string; tone: "good" | "warn" | "bad" };

/**
 * Developability observations.
 *
 * Each is a screening heuristic with a stated basis, not a measurement, and
 * each names what would settle it. Nothing here grades the peptide overall —
 * averaging a charge against a hydrophobicity has no more meaning for a peptide
 * than averaging a permeability against a genotoxicity flag has for a small
 * molecule.
 */
export function peptideFlags(properties: PeptideProperties): PeptideFlag[] {
  const flags: PeptideFlag[] = [];

  if (properties.gravy > 0) {
    flags.push({
      title: "Net hydrophobic", tone: "warn",
      detail: "A positive GRAVY indicates net hydrophobic character, which raises aggregation and non-specific-binding risk in formulation. Settled by a solubility screen and SEC in the intended buffer.",
    });
  }
  if (properties.netChargeAtPh74 > 2) {
    flags.push({
      title: "Cationic at physiological pH", tone: "warn",
      detail: `Net charge ${properties.netChargeAtPh74.toFixed(1)} at pH 7.4. Cationic peptides are associated with membrane activity and haemolysis; that is the mechanism for an antimicrobial peptide and a liability for anything else. Settled by a haemolysis assay against the intended therapeutic concentration.`,
    });
  }
  if (properties.bomanIndex > 2.48) {
    flags.push({
      title: "High protein-binding potential", tone: "warn",
      detail: "Boman index above 2.48 kcal/mol indicates a high propensity for non-specific protein interaction, which usually reads as poor selectivity rather than as affinity. Settled by a counter-screen against an unrelated target panel.",
    });
  }
  if (properties.molecularWeightDa > 5000) {
    flags.push({
      title: "Above the oral-absorption range", tone: "bad",
      detail: "Beyond roughly 5 kDa, passive oral absorption is negligible and a parenteral route is assumed unless a delivery technology is declared.",
    });
  }
  if (!flags.length) {
    flags.push({
      title: "No screening flag raised", tone: "good",
      detail: "None of the sequence-derived heuristics above their thresholds. That is the absence of a flag, not evidence of developability.",
    });
  }
  return flags;
}
