/**
 * Modality Router — auto-detects therapeutic modality from user input.
 *
 * The platform supports multiple drug modalities, each with its own L1 engine
 * and L2 pipeline. This module provides:
 *
 *   1. A canonical `Modality` union type shared across the entire codebase.
 *   2. `detectModality(input)` — heuristic classifier that examines raw text
 *      and returns the most likely modality + a confidence score.
 *   3. Metadata (labels, icons, availability) for the UI modality selector.
 *
 * Detection strategy (no ML, pure heuristics — deterministic):
 *   - SMILES syntax (brackets, @, =, #, rings)  → small_molecule
 *   - Pure amino-acid one-letter codes (≥ 2 AA)  → peptide (short) or antibody (long + CDR)
 *   - Nucleotide codes (ACGTU)                    → oligonucleotide
 *   - SMILES with PROTAC linkers (high MW, two pharmacophores) → protac
 *   - Ambiguous                                   → small_molecule (safe default)
 *
 * The router never fabricates modality assignments. When confidence is below
 * the `CONFIDENT` threshold, the UI should show the auto-detected choice but
 * highlight it for user confirmation.
 */

// ── Modality types ──────────────────────────────────────────────────────────

export type Modality =
  | "small_molecule"
  | "peptide"
  | "antibody"
  | "oligonucleotide"
  | "protac"
  | "adc";

export interface ModalityMeta {
  id:           Modality;
  label:        string;
  shortLabel:   string;
  icon:         string;
  available:    boolean;
  comingSoon:   boolean;
  description:  string;
}

/** Canonical registry — ordered by implementation priority. */
export const MODALITY_REGISTRY: readonly ModalityMeta[] = [
  {
    id: "small_molecule",
    label: "Small Molecule",
    shortLabel: "SM",
    icon: "⚗️",
    available: true,
    comingSoon: false,
    description: "SMILES-based compounds (MW < ~900 Da). Full L1 + L2 pipeline.",
  },
  {
    id: "peptide",
    label: "Peptide",
    shortLabel: "Pep",
    icon: "🧬",
    available: true,
    comingSoon: false,
    description: "Linear or cyclic peptides (2–100 AA). Physicochemistry, stability, permeability, developability.",
  },
  {
    id: "antibody",
    label: "Antibody / Nanobody",
    shortLabel: "Ab",
    icon: "🛡️",
    available: true,
    comingSoon: false,
    description: "Monoclonal antibodies, nanobodies, bispecifics. CDR analysis, developability, immunogenicity.",
  },
  {
    id: "oligonucleotide",
    label: "Oligonucleotide",
    shortLabel: "Oligo",
    icon: "🔗",
    available: false,
    comingSoon: true,
    description: "ASO, siRNA, aptamers. Sequence-based design, off-target prediction, stability.",
  },
  {
    id: "protac",
    label: "PROTAC",
    shortLabel: "PRTC",
    icon: "🔄",
    available: false,
    comingSoon: true,
    description: "Proteolysis-targeting chimeras. Ternary complex modelling, linker optimization.",
  },
  {
    id: "adc",
    label: "ADC",
    shortLabel: "ADC",
    icon: "💉",
    available: false,
    comingSoon: true,
    description: "Antibody-drug conjugates. Linker-payload-antibody integration, DAR optimization.",
  },
] as const;

export function getModalityMeta(id: Modality): ModalityMeta {
  return MODALITY_REGISTRY.find(m => m.id === id) ?? MODALITY_REGISTRY[0];
}

// ── Auto-detection ──────────────────────────────────────────────────────────

export interface DetectionResult {
  modality:    Modality;
  confidence:  number;     // 0–1
  reason:      string;
  /** When true, the UI should prompt the user to confirm. */
  needsConfirmation: boolean;
}

const CONFIDENT = 0.80;

/** Characters that strongly suggest SMILES notation. */
const SMILES_CHARS = /[=#@\[\]\\\/\(\)\.%]/;

/** Pure amino-acid sequence (one-letter codes, allows X for unknown). */
const AA_RE = /^[ACDEFGHIKLMNPQRSTVWYX]+$/i;

/** Standard amino acids (excluding ambiguous single letters). */
const STANDARD_AA = new Set("ACDEFGHIKLMNPQRSTVWY");

/** Nucleotide-only (DNA/RNA). */
const NUCLEOTIDE_RE = /^[ACGTURYMKSWBDHVN]+$/i;
/** Strong nucleotide characters (not ambiguous with AA). */
const STRONG_NUC = new Set("UGTR");  // U and T are rare in AA; G is also AA but combo matters

/** CDR-like patterns (Kabat/IMGT numbering clue: heavy chain CDR3 is typically 3–25 AA
 *  preceded by C...W motif). This is a rough heuristic. */
const CDR_MOTIF = /C[A-Z]{3,25}WG[A-Z]G/i;

/**
 * Detect the therapeutic modality from raw user input.
 *
 * Pure function — no I/O. The heuristic is intentionally conservative:
 * when in doubt, it returns small_molecule (the original and most common case)
 * with `needsConfirmation: true`.
 */
export function detectModality(input: string): DetectionResult {
  const raw = input.trim();
  if (!raw) {
    return {
      modality: "small_molecule",
      confidence: 0,
      reason: "No input provided.",
      needsConfirmation: true,
    };
  }

  // Strip FASTA header if present
  const lines = raw.split(/\r?\n/);
  const hasFasta = lines[0].startsWith(">");
  const seq = hasFasta
    ? lines.slice(1).map(l => l.replace(/\s+/g, "")).join("").toUpperCase()
    : raw.replace(/\s+/g, "").toUpperCase();

  // ── 1. SMILES detection: brackets, double/triple bonds, aromatic rings ────
  if (SMILES_CHARS.test(seq)) {
    // Could be PROTAC if very large SMILES with linker pattern
    // PROTACs typically have MW > 700 and contain long alkyl chains or PEG linkers
    const parenDepth = (seq.match(/\(/g) || []).length;
    const hasLongChain = /CCCCCC/.test(seq) || /OCCOCCOCC/.test(seq); // alkyl or PEG linker
    if (seq.length > 100 && parenDepth > 10 && hasLongChain) {
      return {
        modality: "protac",
        confidence: 0.65,
        reason: "Large SMILES with linker-like substructure — possible PROTAC/molecular glue.",
        needsConfirmation: true,
      };
    }
    return {
      modality: "small_molecule",
      confidence: 0.95,
      reason: "SMILES syntax detected (brackets, bonds, or ring notation).",
      needsConfirmation: false,
    };
  }

  // ── 2. Nucleotide detection ───────────────────────────────────────────────
  if (NUCLEOTIDE_RE.test(seq) && seq.length >= 10) {
    // Check if it's more nucleotide-like than AA-like
    const nucChars = [...seq].filter(c => STRONG_NUC.has(c)).length;
    const nucFraction = nucChars / seq.length;
    // U is almost never in protein sequences; T is rare (only in some codes)
    const hasU = seq.includes("U");
    if (hasU || nucFraction > 0.3) {
      return {
        modality: "oligonucleotide",
        confidence: hasU ? 0.92 : 0.75,
        reason: hasU
          ? "Contains U (uracil) — RNA/oligonucleotide sequence."
          : "Nucleotide-enriched sequence (high G/T/R content).",
        needsConfirmation: !hasU,
      };
    }
  }

  // ── 3. Amino acid sequence detection ──────────────────────────────────────
  if (AA_RE.test(seq) && seq.length >= 2) {
    // Check for non-standard AA chars (distinguishes AA from nucleotide-only)
    const aaOnlyChars = [...seq].filter(c => STANDARD_AA.has(c) && !STRONG_NUC.has(c)).length;
    const aaFraction = aaOnlyChars / seq.length;

    // Length-based classification: peptide vs antibody
    if (seq.length >= 100) {
      // Could be antibody (VH ~120 AA, full IgG ~450 AA) or just a long peptide/protein
      if (CDR_MOTIF.test(seq)) {
        return {
          modality: "antibody",
          confidence: 0.85,
          reason: `Amino acid sequence (${seq.length} residues) with CDR-like motif — probable antibody/nanobody variable domain.`,
          needsConfirmation: false,
        };
      }
      if (seq.length >= 200) {
        return {
          modality: "antibody",
          confidence: 0.60,
          reason: `Long amino acid sequence (${seq.length} residues) — could be antibody, nanobody, or protein therapeutic. Confirm modality.`,
          needsConfirmation: true,
        };
      }
    }

    // Short-to-medium sequence → peptide
    if (aaFraction > 0.3 || seq.length <= 8) {
      return {
        modality: "peptide",
        confidence: seq.length >= 5 ? 0.90 : 0.70,
        reason: `Amino acid sequence detected (${seq.length} residues).`,
        needsConfirmation: seq.length < 5,
      };
    }
  }

  // ── 4. Fallback — treat as small molecule (SMILES without special chars) ──
  // Some SMILES are just element symbols: "C", "CC", "CCC" (methane, ethane, propane)
  if (/^[A-Za-z0-9]+$/.test(seq) && seq.length <= 20) {
    return {
      modality: "small_molecule",
      confidence: 0.50,
      reason: "Short alphanumeric input — could be simple SMILES or a name. Defaulting to small molecule.",
      needsConfirmation: true,
    };
  }

  return {
    modality: "small_molecule",
    confidence: 0.30,
    reason: "Could not confidently classify input. Defaulting to small molecule.",
    needsConfirmation: true,
  };
}

// ── Peptide modification types ──────────────────────────────────────────────

export type CyclizationType = "none" | "head_to_tail" | "disulfide" | "staple" | "lactam";
export type TerminalCap = "none" | "acetyl" | "pyroglutamate";
export type CTerminalCap = "none" | "amide" | "ester";

export interface PeptideModification {
  /** D-amino acid positions (0-indexed). */
  dAminoAcidPositions: number[];
  /** N-terminal cap. */
  nTermCap: TerminalCap;
  /** C-terminal cap. */
  cTermCap: CTerminalCap;
  /** Cyclization type. */
  cyclization: CyclizationType;
  /** For disulfide/lactam cyclization: residue indices of the bond. */
  cyclizationResidues: [number, number] | null;
  /** PEGylation site (0-indexed residue position), null = none. */
  pegylationSite: number | null;
  /** PEG MW in Da. */
  pegMwDa: number;
  /** Lipidation site (0-indexed), null = none. */
  lipidationSite: number | null;
  /** Lipid type. */
  lipidType: "palmitic" | "myristic" | "stearic" | "none";
  /** Non-natural amino acid substitutions: position → replacement code. */
  nnaaSubstitutions: Record<number, string>;
}

export function defaultPeptideModification(): PeptideModification {
  return {
    dAminoAcidPositions: [],
    nTermCap: "none",
    cTermCap: "none",
    cyclization: "none",
    cyclizationResidues: null,
    pegylationSite: null,
    pegMwDa: 2000,
    lipidationSite: null,
    lipidType: "none",
    nnaaSubstitutions: {},
  };
}

/**
 * Estimate the impact of modifications on peptide properties.
 * Used by the UI to show quick feedback before running the full analysis.
 */
export interface ModificationImpact {
  halfLifeMultiplier:       number;   // >1 means longer half-life
  permeabilityMultiplier:   number;   // >1 means better permeability
  proteolyticStabilityGain: string;   // "minimal" | "moderate" | "substantial"
  mwDelta:                  number;   // additional MW from modifications
  notes:                    string[];
}

export function estimateModificationImpact(
  sequenceLength: number,
  mod: PeptideModification,
): ModificationImpact {
  let halfLifeMult = 1.0;
  let permMult = 1.0;
  let stabilityGain: "minimal" | "moderate" | "substantial" = "minimal";
  let mwDelta = 0;
  const notes: string[] = [];

  // D-amino acids: each substitution at a protease cleavage site improves stability
  if (mod.dAminoAcidPositions.length > 0) {
    const fraction = mod.dAminoAcidPositions.length / Math.max(1, sequenceLength);
    halfLifeMult *= 1 + fraction * 3; // up to 4× for all-D
    stabilityGain = fraction > 0.5 ? "substantial" : fraction > 0.2 ? "moderate" : "minimal";
    notes.push(`${mod.dAminoAcidPositions.length} D-amino acid substitution(s) — improved protease resistance.`);
  }

  // Terminal caps
  if (mod.nTermCap === "acetyl") {
    halfLifeMult *= 1.3;
    mwDelta += 42; // acetyl group
    notes.push("N-terminal acetylation — blocks aminopeptidase degradation.");
  }
  if (mod.cTermCap === "amide") {
    halfLifeMult *= 1.4;
    mwDelta += -1; // OH → NH2 (negligible)
    notes.push("C-terminal amidation — blocks carboxypeptidase degradation, improves receptor binding.");
  }

  // Cyclization
  if (mod.cyclization !== "none") {
    halfLifeMult *= 2.0;
    permMult *= 1.8; // cyclic peptides have better membrane permeability
    if (stabilityGain === "minimal") stabilityGain = "moderate";
    notes.push(`Cyclization (${mod.cyclization}) — improved stability and membrane permeability.`);
    if (mod.cyclization === "staple") {
      permMult *= 1.3; // stapled peptides are even more permeable
      notes.push("Hydrocarbon staple — enforces α-helical conformation, further enhances cell penetration.");
    }
  }

  // PEGylation
  if (mod.pegylationSite !== null) {
    halfLifeMult *= 3.0 + (mod.pegMwDa / 10000); // PEG 2kDa ~3.2×, PEG 40kDa ~7×
    mwDelta += mod.pegMwDa;
    notes.push(`PEGylation (${(mod.pegMwDa / 1000).toFixed(0)} kDa) — extends circulating half-life via reduced renal clearance and steric shielding.`);
  }

  // Lipidation
  if (mod.lipidationSite !== null && mod.lipidType !== "none") {
    const lipidMw: Record<string, number> = { palmitic: 256, myristic: 228, stearic: 284 };
    halfLifeMult *= 5.0; // albumin binding → dramatically extended t½
    mwDelta += lipidMw[mod.lipidType] ?? 256;
    notes.push(`Lipidation (${mod.lipidType} acid) — enables albumin binding for extended half-life (semaglutide-class strategy).`);
  }

  return {
    halfLifeMultiplier: parseFloat(halfLifeMult.toFixed(2)),
    permeabilityMultiplier: parseFloat(permMult.toFixed(2)),
    proteolyticStabilityGain: stabilityGain,
    mwDelta,
    notes,
  };
}
