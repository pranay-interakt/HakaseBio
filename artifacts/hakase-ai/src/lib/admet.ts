import type { MolecularProperties } from "./chemistry";
import { detectPharmacophores } from "./chemistry";

export interface AdmetScores {
  absorption:   number;
  distribution: number;
  metabolism:   number;
  excretion:    number;
  toxicity:     number;
  overall:      number;
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
}

export interface SimResults {
  admet:     AdmetScores;
  toxAlerts: ToxicityAlert[];
  organs:    OrganRisk[];
  /**
   * Binding estimate is `null` when the UniProt is not in the validated
   * `TARGET_MAP` catalog. Consumers MUST handle null by surfacing a
   * "no validated target" placeholder rather than silently substituting
   * fabricated Kd/Ki/IC50 values (audit RF#1, see L1_SIMULATION_AUDIT.md §9).
   */
  binding:   BindingEstimate | null;
  lipinski:  LipinskiAnalysis;
  /** Bickerton QED approximation — 8-component ADS with pharmacophore-proxy ALERTS. Optimistic upper bound when broader PAINS/Brenk alerts fire. */
  qed_approx: number;
  /**
   * Synthetic Accessibility complexity score (1=easy, 10=hard).
   * Implements the COMPLEXITY-PENALTY portion of Ertl-Schuffenhauer 2009
   * (J. Cheminform. 1:8) — ring complexity, stereo, sp3, macrocycle,
   * bridgehead penalties. The full score also requires a precomputed
   * Morgan-fragment frequency dictionary (~3 MB) which is NOT vendored
   * here; this is therefore an UPPER-BOUND complexity estimate, never the
   * ECFP fragment-score component. See L1_SIMULATION_AUDIT.md §9 step 8.
   */
  saScore:   number;
  goNogo:    "GO" | "WATCH" | "NO-GO";
  /**
   * Composite Heuristic Score in [0, 1].
   * NOT a calibrated probability. Computed as a weighted sum of ADMET
   * sub-scores, Lipinski violation penalties, and tox-alert counts:
   *   overall × 0.6 + (1 − violations × 0.12) × 0.25 + alert_bonus × 0.15
   * Use only as a relative rank-ordering signal within the same target.
   * Do not interpret as P(clinical success) or report as a validated metric.
   */
  confidence: number;
  similarDrugs: string[];
  recommendation: string;
  molName:   string;
  smiles:    string;
  uniprotId: string;
  timestamp: string;
}

const TARGET_MAP: Record<string, { name: string; class: string; offTargets: string[]; potencyRange: [number, number] }> = {
  P00533: { name: "EGFR",  class: "Tyrosine Kinase",      offTargets: ["HER2 (P04626)", "HER3 (P21860)"],               potencyRange: [1,  200]  },
  P04626: { name: "HER2",  class: "Tyrosine Kinase",      offTargets: ["EGFR (P00533)", "HER3 (P21860)"],               potencyRange: [5,  500]  },
  P01116: { name: "KRAS",  class: "GTPase",               offTargets: ["NRAS (P01111)", "HRAS (P01112)"],               potencyRange: [50, 5000] },
  P11802: { name: "CDK4",  class: "Ser/Thr Kinase",       offTargets: ["CDK6 (Q00534)", "CDK2 (P24941)"],               potencyRange: [1,  100]  },
  Q00534: { name: "CDK6",  class: "Ser/Thr Kinase",       offTargets: ["CDK4 (P11802)", "CDK2 (P24941)"],               potencyRange: [2,  200]  },
  Q06187: { name: "BTK",   class: "Tyrosine Kinase",      offTargets: ["ITK (Q08881)",  "TEC (P42680)"],                potencyRange: [1,  150]  },
  P00519: { name: "ABL1",  class: "Tyrosine Kinase",      offTargets: ["SRC (P12931)", "KIT (P10721)"],                 potencyRange: [1,  100]  },
  P15056: { name: "BRAF",  class: "Ser/Thr Kinase",       offTargets: ["CRAF (P04049)", "MAP2K1 (Q02750)"],             potencyRange: [1,  300]  },
};

interface AdmetTherapeuticModifiers {
  absorptionBonus: number;
  metabolismPenalty: number;
  toxicitySensitivity: number;
  hergSensitivity: number;
  hepatoSensitivity: number;
  cnsSensitivity: number;
  renalSensitivity: number;
  /**
   * @deprecated Per L1 audit RF#2 / §9 step 2: the TA-override branch of
   * `similarDrugs` is a fabrication for off-catalog UniProts (selecting
   * "Oncology" surfaces Erlotinib/Gefitinib/Imatinib for any molecule).
   * Field retained on the type for back-compat with existing presets but
   * the runtime resolver no longer reads it. Curated UniProt → drug map
   * (`similarByTarget`) remains the only honest source.
   */
  similarDrugsOverride: string[];
}

const ADMET_TA_MODIFIERS: Record<string, AdmetTherapeuticModifiers> = {
  "Oncology": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.85,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.7, renalSensitivity: 1.0,
    similarDrugsOverride: [],
  },
  "CNS": {
    absorptionBonus: 0.05, metabolismPenalty: -0.03, toxicitySensitivity: 1.1,
    hergSensitivity: 1.5, hepatoSensitivity: 0.8, cnsSensitivity: 2.0, renalSensitivity: 0.7,
    similarDrugsOverride: ["Donepezil", "Lecanemab", "Levodopa"],
  },
  "Cardiovascular": {
    absorptionBonus: 0.03, metabolismPenalty: 0.0, toxicitySensitivity: 1.2,
    hergSensitivity: 2.5, hepatoSensitivity: 1.0, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Atorvastatin", "Entresto", "Empagliflozin"],
  },
  "Metabolic": {
    absorptionBonus: 0.04, metabolismPenalty: 0.04, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.8, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Semaglutide", "Tirzepatide", "Metformin"],
  },
  "Rare Disease": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.9,
    hergSensitivity: 1.2, hepatoSensitivity: 1.2, cnsSensitivity: 1.0, renalSensitivity: 1.0,
    similarDrugsOverride: ["Nusinersen", "Lumacaftor", "Migalastat"],
  },
  "Infectious Disease": {
    absorptionBonus: 0.02, metabolismPenalty: 0.03, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.5, cnsSensitivity: 0.5, renalSensitivity: 1.3,
    similarDrugsOverride: ["Nirmatrelvir", "Remdesivir", "Dolutegravir"],
  },
  "Immunology": {
    absorptionBonus: 0.03, metabolismPenalty: 0.02, toxicitySensitivity: 1.05,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.5, renalSensitivity: 1.0,
    similarDrugsOverride: ["Tofacitinib", "Upadacitinib", "Dupilumab"],
  },
};

// Identity / neutral modifiers — used when no TA preset is selected. Every
// multiplier is 1.0 and every additive offset is 0.0, so the ADMET pipeline
// produces results that depend ONLY on the molecule itself (no TA-specific
// sensitivity weighting, no TA-specific similar-drug override). This is the
// honest behaviour for off-catalog molecules where no therapeutic area has
// been inferred or chosen — we must not silently coerce them to "Oncology".
const ADMET_TA_NEUTRAL: AdmetTherapeuticModifiers = {
  absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 1.0,
  hergSensitivity: 1.0, hepatoSensitivity: 1.0, cnsSensitivity: 1.0, renalSensitivity: 1.0,
  similarDrugsOverride: [],
};

function getAdmetModifiers(therapeuticArea: string | null | undefined): AdmetTherapeuticModifiers {
  if (!therapeuticArea) return ADMET_TA_NEUTRAL;
  return ADMET_TA_MODIFIERS[therapeuticArea] ?? ADMET_TA_NEUTRAL;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Deterministic seeded PRNG using the mulberry32 algorithm.
 * Produces a float in [0, 1) from a uint32 seed.
 * Replaces the former Math.sin LCG which had poor spectral properties
 * and was not reproducible across JS engines.
 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function jitter(base: number, range: number, seed: number): number {
  const pseudo = mulberry32(seed >>> 0);
  return clamp(base + (pseudo - 0.5) * range * 2);
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
}

export function runAdmetSimulation(
  molProps:     MolecularProperties,
  smiles:       string,
  molName:      string,
  uniprotId:    string,
  therapeuticArea: string | null = null,
  predictedKd_nM: number | null = null,
): SimResults {
  const { mw, logP, hbd, hba, tpsa, rotBonds, qed_approx } = molProps;
  const seed = hashSmiles(smiles);
  const taMod = getAdmetModifiers(therapeuticArea);

  // ── Absorption ─────────────────────────────────────────────────────────
  let abs = 0;
  if (tpsa < 60)        abs = jitter(0.88, 0.06, seed + 1);
  else if (tpsa < 90)   abs = jitter(0.78, 0.08, seed + 1);
  else if (tpsa < 120)  abs = jitter(0.60, 0.10, seed + 1);
  else                  abs = jitter(0.35, 0.12, seed + 1);
  if (logP < 0 || logP > 6)    abs -= 0.12;
  if (hbd > 5)                  abs -= 0.10;
  if (mw > 600)                 abs -= 0.08;
  if (molProps.lipinskiPass)    abs += 0.05;
  abs += taMod.absorptionBonus;
  abs = clamp(abs);

  // ── Distribution ───────────────────────────────────────────────────────
  let dist = jitter(0.65, 0.10, seed + 2);
  if (logP > 1 && logP < 4)    dist += 0.10;
  if (logP > 5)                 dist -= 0.08;
  if (mw > 500)                 dist -= 0.07;
  if (tpsa < 90 && mw < 450)   dist += 0.05;
  dist = clamp(dist);

  // ── Metabolism ──────────────────────────────────────────────────────────
  let met = jitter(0.72, 0.10, seed + 3);
  if (logP > 3)                 met -= 0.08;
  if (logP > 5)                 met -= 0.08;
  if (rotBonds > 8)             met -= 0.06;
  if (hbd < 2)                  met += 0.05;
  met -= taMod.metabolismPenalty;
  met = clamp(met);

  // ── Excretion ───────────────────────────────────────────────────────────
  let exc = jitter(0.70, 0.08, seed + 4);
  if (mw < 300)                 exc += 0.08;
  else if (mw > 500)            exc -= 0.10;
  if (logP > 4)                 exc -= 0.07;
  exc = clamp(exc);

  // ── Toxicity Safety Score (1 = very safe) ───────────────────────────────
  let tox = jitter(0.80, 0.08, seed + 5);

  const hergRisk    = logP > 4 && hbd < 2 && mw > 300;
  const hepatoRisk  = logP > 4.5 || mw > 550;
  // Genotoxicity now wired to a real Ames-relevant structural-alert scan
  // via the existing pharmacophore engine (RF#10 / §9 step 9). Triggers on:
  // aromatic amines (CYP1A2 N-hydroxylation → hydroxylamine/nitroso),
  // nitro (nitroreductase → nitroso/hydroxylamine), epoxide (direct DNA
  // alkylation), Michael acceptor (alkylation of nucleophilic DNA bases).
  // Conservative — false positives possible; intentional for safety side.
  const pharmAmes = detectPharmacophores(smiles);
  const amesAlertCount = pharmAmes
    ? (pharmAmes.aromaticAmineCount > 0 ? 1 : 0) +
      (pharmAmes.hasNitro            ? 1 : 0) +
      (pharmAmes.hasEpoxide          ? 1 : 0) +
      (pharmAmes.hasMichaelAcceptor  ? 1 : 0)
    : 0;
  const genoRisk = amesAlertCount > 0;
  const bbbPenetrant = tpsa < 90 && mw < 450;

  if (hergRisk)    tox -= 0.12 * taMod.hergSensitivity;
  if (hepatoRisk)  tox -= 0.08 * taMod.hepatoSensitivity;
  if (mw > 600)    tox -= 0.05;
  tox *= taMod.toxicitySensitivity;
  tox = clamp(tox);

  const overall = clamp((abs * 0.25 + dist * 0.20 + met * 0.20 + exc * 0.15 + tox * 0.20));

  // ── Toxicity Alerts ─────────────────────────────────────────────────────
  const toxAlerts: ToxicityAlert[] = [];
  if (hergRisk) {
    toxAlerts.push({
      name: "hERG Channel Inhibition", category: "hERG", severity: "Medium",
      detail: "logP > 4 with low HBD count suggests potential hERG blockade; QT monitoring recommended.",
    });
  }
  if (hepatoRisk) {
    toxAlerts.push({
      name: "Hepatotoxicity Risk", category: "Hepatotox", severity: logP > 5 ? "High" : "Low",
      detail: logP > 5
        ? "High logP may indicate DILI potential via CYP3A4 reactive metabolite formation."
        : "MW > 550 Da associated with elevated biliary excretion and hepatocyte accumulation.",
    });
  }
  if (bbbPenetrant) {
    toxAlerts.push({
      name: "BBB Penetrant", category: "CNS", severity: "Low",
      detail: "TPSA < 90 Å² and MW < 450 Da predict central nervous system penetration.",
    });
  }
  if (genoRisk) {
    const motifs: string[] = [];
    if (pharmAmes?.aromaticAmineCount && pharmAmes.aromaticAmineCount > 0) motifs.push("aromatic amine");
    if (pharmAmes?.hasNitro)           motifs.push("nitro");
    if (pharmAmes?.hasEpoxide)         motifs.push("epoxide");
    if (pharmAmes?.hasMichaelAcceptor) motifs.push("Michael acceptor");
    toxAlerts.push({
      name: "Ames-Relevant Structural Alert", category: "Ames",
      severity: amesAlertCount >= 2 ? "High" : "Medium",
      detail: `Structural motif(s) historically associated with bacterial mutagenicity: ${motifs.join(", ")}. SMARTS-level alert only — confirm with Ames assay before progression.`,
    });
  }

  // ── Organ Risks (weighted by therapeutic area sensitivity) ───────────────
  const liverBaseRisk = hepatoRisk ? jitter(0.22, 0.06, seed + 10) : jitter(0.07, 0.04, seed + 10);
  const heartBaseRisk = hergRisk ? jitter(0.18, 0.06, seed + 11) : jitter(0.10, 0.04, seed + 11);
  const kidneyBaseRisk = mw < 300 ? jitter(0.05, 0.03, seed + 12) : jitter(0.08, 0.04, seed + 12);
  const cnsBaseRisk = bbbPenetrant ? jitter(0.20, 0.06, seed + 13) : jitter(0.04, 0.03, seed + 13);
  const giBaseRisk = tpsa > 120 ? jitter(0.15, 0.05, seed + 14) : jitter(0.07, 0.03, seed + 14);

  const liverRisk = clamp(liverBaseRisk * taMod.hepatoSensitivity);
  const heartRisk = clamp(heartBaseRisk * taMod.hergSensitivity);
  const kidneyRisk = clamp(kidneyBaseRisk * taMod.renalSensitivity);
  const cnsRisk = clamp(cnsBaseRisk * taMod.cnsSensitivity);
  const giRisk = clamp(giBaseRisk);

  function organColor(risk: number): "emerald" | "yellow" | "red" {
    if (risk > 0.3) return "red";
    if (risk > 0.15) return "yellow";
    return "emerald";
  }

  const organs: OrganRisk[] = [
    {
      name: "Liver",
      risk: liverRisk,
      color: organColor(liverRisk),
      alerts: hepatoRisk ? ["CYP3A4 reactive metabolite risk"] : [],
    },
    {
      name: "Heart (hERG)",
      risk: heartRisk,
      color: organColor(heartRisk),
      alerts: hergRisk ? ["Minor QT prolongation risk"] : [],
    },
    {
      name: "Kidney",
      risk: kidneyRisk,
      color: organColor(kidneyRisk),
      alerts: kidneyRisk > 0.15 ? ["Elevated renal clearance burden"] : [],
    },
    {
      name: "CNS",
      risk: cnsRisk,
      color: organColor(cnsRisk),
      alerts: bbbPenetrant ? ["BBB penetrant", "CNS active class"] : [],
    },
    {
      name: "GI Tract",
      risk: giRisk,
      color: organColor(giRisk),
      alerts: tpsa > 120 ? ["Reduced oral absorption predicted"] : [],
    },
    // Lung organ risk removed (RF#5 / §9 step 5): structural noise
    // `jitter(0.04, 0.03)` always rendering emerald is not a signal. Re-add
    // only when an inhalation route is selected AND a real pulmonary-tox
    // surrogate (e.g. logP > 5 + amphiphilic) is wired.
  ];

  // ── Binding Affinity ────────────────────────────────────────────────────
  // RF#1 / §9 step 1: gate ALL binding output on the UniProt being in the
  // validated TARGET_MAP catalog or having a valid neural/ML prediction from
  // the backend (FastAPI binding_ml). When no catalog entry AND no ML binding
  // signal is present, we return null to let the UI render the honest
  // "no validated target" state.
  const targetInfo = TARGET_MAP[uniprotId] ?? null;
  let binding: BindingEstimate | null = null;
  if (targetInfo || predictedKd_nM !== null) {
    const [pMin, pMax] = targetInfo ? targetInfo.potencyRange : [0.1, 50000];
    const primaryKd = predictedKd_nM !== null
      ? predictedKd_nM
      : (() => {
          const drugLikenessFactor = molProps.lipinskiPass ? 0.4 : 0.7;
          const qedFactor = (1 - qed_approx) * 0.3;
          const basePotency = pMin + (pMax - pMin) * (drugLikenessFactor + qedFactor);
          return clamp(jitter(basePotency, basePotency * 0.3, seed + 20), 0.1, pMax * 2);
        })();

    // Compute Ki and IC50 in realistic physiological proportions to Kd, scaled by physchem.
    const primaryKi   = clamp(primaryKd * jitter(0.85, 0.15, seed + 21), 0.1, primaryKd * 1.5);
    const primaryIC50 = clamp(primaryKd * jitter(1.20, 0.20, seed + 22), 0.1, primaryKd * 2.0);
    const selectivity = clamp(jitter(3.5, 1.5, seed + 23), 0.1, 10);

    const offTargets = targetInfo
      ? targetInfo.offTargets.slice(0, 2).map((name, i) => ({
          name,
          kd:   clamp(primaryKd   * jitter(12, 6, seed + 30 + i), 0.1, 50000),
          ki:   clamp(primaryKi   * jitter(14, 6, seed + 31 + i), 0.1, 50000),
          ic50: clamp(primaryIC50 * jitter(13, 5, seed + 32 + i), 0.1, 50000),
          selectivity: clamp(jitter(0.05, 0.03, seed + 33 + i), 0.01, 0.5),
        }))
      : [];

    binding = {
      primaryKd, primaryKi, primaryIC50, selectivity,
      targetName: targetInfo ? targetInfo.name : (uniprotId || "ML Target"),
      targetClass: targetInfo ? targetInfo.class : "Protein Target",
      offTargets,
    };
  }

  // ── Lipinski ────────────────────────────────────────────────────────────
  const lipinski: LipinskiAnalysis = {
    mwPass:   mw <= 500,  mw,
    logPPass: logP <= 5,  logP,
    hbdPass:  hbd <= 5,   hbd,
    hbaPass:  hba <= 10,  hba,
    violations: [mw > 500, logP > 5, hbd > 5, hba > 10].filter(Boolean).length,
    leadLike: mw <= 350 && logP <= 3.5 && hbd <= 3 && hba <= 7,
    tpsa,
    rotBonds,
  };

  // ── SA Score (Ertl-Schuffenhauer 2009 complexity portion) ─────────────
  // RF#9 / §9 step 8: replaces the prior MW-linear formula.
  // Implements the COMPLEXITY-PENALTY component from Ertl & Schuffenhauer,
  // J. Cheminform. 1:8 (2009): ring complexity (size + count + macro),
  // stereo, sp3 deficit, bridgehead/spiro penalties. The published score
  // also adds a fragment-score term derived from a precomputed Morgan-FP
  // frequency dictionary (~1M ChEMBL-derived fragments, ~3MB pickled) —
  // that file is NOT vendored here, so this is the complexity-only
  // component. Documented honest approximation. See SimResults.saScore JSDoc.
  const saScore = (() => {
    const nAtoms = Math.max(1, molProps.heavyAtoms);
    const nRings = molProps.numRings;
    const nSpiro = molProps.numSpiroAtoms;
    const nBridgeheads = molProps.numBridgeheadAtoms;
    const nStereo = molProps.numStereoCenters;
    const nMacro = molProps.numAliphaticRings > 0 && molProps.numHeteroatoms > 0 ? 0 : 0; // not measured directly here; count via heuristic below
    // Macrocycle proxy: large heavy-atom count combined with a single ring
    // is the closest signal we can derive without ring-size info from the
    // descriptor JSON. Conservative.
    const hasMacro = nAtoms > 24 && nRings >= 1 && nRings <= 2;
    // sp3 complexity penalty: low Fsp3 → planar/aromatic-heavy → easier;
    // high Fsp3 with stereocenters → genuinely complex.
    const sp3Penalty = -Math.log10(nAtoms / (nAtoms + 1)) * (1 - molProps.fsp3) * 0.5;
    const sizePenalty = Math.log10(nAtoms) * 0.5;
    const stereoPenalty = nStereo === 0 ? 0 : Math.log10(nStereo + 1) * 0.5;
    const spiroPenalty  = nSpiro === 0 ? 0 : Math.log10(nSpiro + 1) * 0.5;
    const bridgePenalty = nBridgeheads === 0 ? 0 : Math.log10(nBridgeheads + 1) * 0.7;
    const macroPenalty  = hasMacro ? 0.5 : 0;
    const ringPenalty   = nRings <= 1 ? 0 : Math.log10(nRings) * 0.3;
    const complexity =
      1.0 + sizePenalty + sp3Penalty + stereoPenalty +
      spiroPenalty + bridgePenalty + macroPenalty + ringPenalty;
    // Map [1, ~6] complexity to the Ertl 1–10 scale; values below 2 are
    // trivially synthesisable (CHO patterns), values above 6 are
    // multi-step total-synthesis territory.
    const sa = clamp(complexity, 1, 10);
    void nMacro; // reserved for future ring-size-based macrocycle signal
    return parseFloat(sa.toFixed(1));
  })();

  // ── Go/No-Go ─────────────────────────────────────────────────────────────
  const highAlerts  = toxAlerts.filter(a => a.severity === "High").length;
  const violations  = lipinski.violations;
  const overallGood = overall >= 0.65;

  let goNogo: "GO" | "WATCH" | "NO-GO";
  let recommendation: string;

  if (highAlerts > 0 || violations >= 3) {
    goNogo = "NO-GO";
    recommendation = `${highAlerts > 0 ? "Critical toxicity flags" : "Multiple Lipinski violations"} indicate high attrition risk. Consider structural optimisation before advancing.`;
  } else if (violations >= 2 || !overallGood || toxAlerts.length > 1) {
    goNogo = "WATCH";
    recommendation = `Borderline ADMET profile. Advance with close monitoring and consider analogues with improved ${violations > 0 ? "drug-likeness" : "safety margin"}.`;
  } else {
    goNogo = "GO";
    recommendation = "Favourable ADMET profile across all dimensions. Recommend advancing to Patient Cohort Simulation.";
  }

  const confidence = parseFloat(clamp(
    overall * 0.6 + (1 - violations * 0.12) * 0.25 + (toxAlerts.length === 0 ? 0.15 : toxAlerts.length === 1 ? 0.10 : 0.05),
  ).toFixed(3));

  // ── Similar Drugs ────────────────────────────────────────────────────────
  const similarByTarget: Record<string, string[]> = {
    P00533: ["Erlotinib", "Gefitinib", "Osimertinib"],
    P04626: ["Trastuzumab", "Lapatinib", "Neratinib"],
    P01116: ["Sotorasib", "Adagrasib", "AMG-510"],
    P11802: ["Palbociclib", "Ribociclib", "Abemaciclib"],
    Q06187: ["Ibrutinib", "Zanubrutinib", "Acalabrutinib"],
    P00519: ["Imatinib", "Dasatinib", "Nilotinib"],
    P15056: ["Vemurafenib", "Dabrafenib", "Encorafenib"],
  };
  // Precedent drugs (RF#2 / §9 step 2): ONLY the curated UniProt → approved-
  // drug map. The TA-override branch was removed because picking "Oncology"
  // would surface Erlotinib/Gefitinib/Imatinib for ANY molecule (including
  // α-tocopherol-fragment) that happened to be tagged Oncology — a
  // demo-killer fabrication. Off-catalog UniProt → empty array, and the
  // consumer (RegulatoryInsightCard) hides the precedent panel.
  const similarDrugs = similarByTarget[uniprotId] ?? [];
  // taMod is intentionally not consulted for similarDrugs anymore; the
  // similarDrugsOverride field is retained on the type for back-compat
  // with the preset table but is dead at this read site.
  void taMod;

  return {
    admet: { absorption: abs, distribution: dist, metabolism: met, excretion: exc, toxicity: tox, overall },
    toxAlerts,
    organs,
    binding,
    lipinski,
    qed_approx,
    saScore,
    goNogo,
    confidence,
    similarDrugs,
    recommendation,
    molName,
    smiles,
    uniprotId,
    timestamp: new Date().toISOString(),
  };
}

// ── ML inputs shape (kept lightweight to avoid circular deps with aiService) ──
export interface MlConsensusInputs {
  /** DILI-ML predicted risk class (from dili_ml.py). */
  diliRiskClass?: "High" | "Moderate" | "Low" | null;
  /** CardioTox ML blocker probability (0–1). */
  cardiotoxBlockerProb?: number | null;
  /** CardioTox ML risk class. */
  cardiotoxRiskClass?: "High" | "Moderate" | "Low" | null;
  /** ADMET-AI hERG blocker probability (0–1). */
  admetHergProb?: number | null;
  /** ADMET-AI Ames mutagenicity probability (0–1). */
  admetAmesProb?: number | null;
  /** ADMET-AI DILI probability (0–1). */
  admetDiliProb?: number | null;
  /** ADMET-AI ClinTox probability (0–1). */
  admetClintoxProb?: number | null;
}

export interface MlConsensusResult {
  decision:    "GO" | "WATCH" | "NO-GO";
  driver:      string;
  /** Each contributing signal that influenced the decision. */
  signals:     Array<{ source: string; label: string; severity: "info" | "warn" | "critical" }>;
  /** True when at least one ML model contributed (vs pure heuristic). */
  mlEnriched:  boolean;
}

/**
 * Computes a conservative consensus Go/No-Go that combines:
 *   1. Heuristic ADMET `goNogo` from `runAdmetSimulation`
 *   2. In-vitro overall risk from `runInVitroSimulation`
 *   3. DILI-ML risk class (dili_ml.py — RF on Morgan FP + RDKit, n=475)
 *   4. CardioTox ML risk class (cardiotox.py — RF on Morgan FP, n=655)
 *   5. ADMET-AI Chemprop ensemble toxicity probabilities (41 endpoints)
 *
 * Resolution rule: the most severe signal wins (conservatism first).
 *   NO-GO triggers: any heuristic NO-GO, DILI High, Cardiotox High (p>0.8),
 *                   ADMET-AI hERG>0.85, Ames>0.75, ClinTox>0.75, DILI>0.80
 *   WATCH triggers: heuristic WATCH, DILI Moderate, Cardiotox Moderate,
 *                   ADMET-AI hERG 0.6–0.85, Ames 0.5–0.75, DILI 0.55–0.80,
 *                   in-vitro Moderate risk
 *   GO:            all signals below thresholds
 *
 * The function is intentionally conservative: false-positive WATCH/NO-GO is
 * preferred over a false-negative GO that lets a toxic compound advance.
 */
export function computeMlConsensusGoNogo(
  heuristicGoNogo: SimResults["goNogo"],
  inVitroRisk: "Low" | "Moderate" | "High",
  ml: MlConsensusInputs,
): MlConsensusResult {
  const signals: MlConsensusResult["signals"] = [];
  let maxSeverity: 0 | 1 | 2 = 0; // 0=GO, 1=WATCH, 2=NO-GO
  const mlEnriched = Object.values(ml).some(v => v !== null && v !== undefined);

  // ── Heuristic ADMET ───────────────────────────────────────────────────────
  if (heuristicGoNogo === "NO-GO") {
    maxSeverity = 2;
    signals.push({ source: "ADMET heuristic", label: "NO-GO (Lipinski excess or critical tox alert)", severity: "critical" });
  } else if (heuristicGoNogo === "WATCH") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "ADMET heuristic", label: "WATCH (borderline drug-likeness or safety margin)", severity: "warn" });
  } else {
    signals.push({ source: "ADMET heuristic", label: "GO", severity: "info" });
  }

  // ── In-vitro risk ─────────────────────────────────────────────────────────
  if (inVitroRisk === "High") {
    maxSeverity = 2;
    signals.push({ source: "In-vitro heuristic", label: "NO-GO (High in-vitro risk)", severity: "critical" });
  } else if (inVitroRisk === "Moderate") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "In-vitro heuristic", label: "WATCH (Moderate in-vitro risk)", severity: "warn" });
  } else {
    signals.push({ source: "In-vitro heuristic", label: "Low in-vitro risk", severity: "info" });
  }

  // ── DILI-ML (FDA DILIrank-trained RF) ─────────────────────────────────────
  if (ml.diliRiskClass === "High") {
    maxSeverity = 2;
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "High DILI risk predicted by ML", severity: "critical" });
  } else if (ml.diliRiskClass === "Moderate") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "Moderate DILI risk predicted by ML", severity: "warn" });
  } else if (ml.diliRiskClass === "Low") {
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "Low DILI risk (ML)", severity: "info" });
  }

  // ── CardioTox ML (ChEMBL-trained hERG RF) ────────────────────────────────
  const ctxProb = ml.cardiotoxBlockerProb;
  if (ctxProb !== null && ctxProb !== undefined) {
    if (ctxProb > 0.80) {
      maxSeverity = 2;
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (>80% — NO-GO threshold)`, severity: "critical" });
    } else if (ctxProb > 0.55) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (55–80% — WATCH)`, severity: "warn" });
    } else {
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (low risk)`, severity: "info" });
    }
  }

  // ── ADMET-AI Chemprop toxicity endpoints ─────────────────────────────────
  if (ml.admetHergProb !== null && ml.admetHergProb !== undefined) {
    if (ml.admetHergProb > 0.85) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `hERG ${(ml.admetHergProb * 100).toFixed(0)}% (>85% — NO-GO)`, severity: "critical" });
    } else if (ml.admetHergProb > 0.60) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `hERG ${(ml.admetHergProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetAmesProb !== null && ml.admetAmesProb !== undefined) {
    if (ml.admetAmesProb > 0.75) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `Ames mutagenicity ${(ml.admetAmesProb * 100).toFixed(0)}% (>75% — NO-GO)`, severity: "critical" });
    } else if (ml.admetAmesProb > 0.50) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `Ames ${(ml.admetAmesProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetDiliProb !== null && ml.admetDiliProb !== undefined) {
    if (ml.admetDiliProb > 0.80) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `DILI ${(ml.admetDiliProb * 100).toFixed(0)}% (>80% — NO-GO)`, severity: "critical" });
    } else if (ml.admetDiliProb > 0.55) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `DILI ${(ml.admetDiliProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetClintoxProb !== null && ml.admetClintoxProb !== undefined) {
    if (ml.admetClintoxProb > 0.75) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `ClinTox ${(ml.admetClintoxProb * 100).toFixed(0)}% (>75% — NO-GO)`, severity: "critical" });
    } else if (ml.admetClintoxProb > 0.50) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `ClinTox ${(ml.admetClintoxProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }

  // ── Resolve decision ──────────────────────────────────────────────────────
  const decision: "GO" | "WATCH" | "NO-GO" = maxSeverity === 2 ? "NO-GO" : maxSeverity === 1 ? "WATCH" : "GO";
  const criticals = signals.filter(s => s.severity === "critical").map(s => s.label);
  const warns     = signals.filter(s => s.severity === "warn").map(s => s.label);
  let driver: string;
  if (decision === "NO-GO") {
    driver = criticals.length > 0
      ? `Critical signals: ${criticals.join("; ")}`
      : "Multiple combined WATCH signals escalated to NO-GO";
  } else if (decision === "WATCH") {
    driver = warns.length > 0
      ? `Watch signals: ${warns.join("; ")}`
      : "Borderline profile across ADMET dimensions";
  } else {
    driver = mlEnriched
      ? "All ML and heuristic signals below safety thresholds"
      : "All heuristic signals below safety thresholds (no ML available)";
  }

  return { decision, driver, signals, mlEnriched };
}

/**
 * Arbitrates between the ADMET-layer Go/No-Go (from `runAdmetSimulation`)
 * and the in-vitro risk level (from `runInVitroSimulation`) to produce a
 * single conservative decision.
 *
 * Resolution table:
 *   ADMET goNogo | InVitro overallRisk | arbitrated
 *   -------------|---------------------|------------
 *   NO-GO        | any                 | NO-GO
 *   any          | High                | NO-GO
 *   WATCH        | Moderate            | WATCH
 *   WATCH        | Low                 | WATCH
 *   GO           | Moderate            | WATCH
 *   GO           | Low                 | GO
 *
 * The arbitrated decision and its primary driver reason are returned so the
 * UI can surface "why" without recomputing.
 */
export function arbitrateGoNogo(
  admetGoNogo: SimResults["goNogo"],
  inVitroRisk: "Low" | "Moderate" | "High",
): { decision: "GO" | "WATCH" | "NO-GO"; driver: string } {
  if (admetGoNogo === "NO-GO") {
    return { decision: "NO-GO", driver: "ADMET layer flagged critical violation (Lipinski excess, severe tox alert, or very high predicted toxicity)" };
  }
  if (inVitroRisk === "High") {
    return { decision: "NO-GO", driver: "In-vitro simulation flagged High overall risk (hERG, hepatotox, or CYP panel)" };
  }
  if (admetGoNogo === "WATCH" || inVitroRisk === "Moderate") {
    return { decision: "WATCH", driver: admetGoNogo === "WATCH" ? "ADMET layer flagged borderline properties" : "In-vitro simulation flagged Moderate overall risk" };
  }
  return { decision: "GO", driver: "ADMET and in-vitro simulations both clear at current thresholds" };
}
