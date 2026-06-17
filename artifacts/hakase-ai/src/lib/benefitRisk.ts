/**
 * FDA Benefit-Risk Assessment layer
 * ─────────────────────────────────────────────────────────────────────────
 * Implements the structured Benefit-Risk Framework (BRF) that the FDA uses to
 * decide approvals — final guidance "Benefit-Risk Assessment for New Drug and
 * Biological Products" (Oct 2023, developed under PDUFA VI and the 21st
 * Century Cures Act). The central principle this encodes, in the FDA's own
 * words, is that the acceptable level of RISK is weighed against the severity
 * of the CONDITION and the UNMET MEDICAL NEED: a serious liability that sinks
 * a candidate for a mild condition can be acceptable for a life-threatening
 * disease with no good alternatives (this is why oncology drugs with serious
 * toxicity are approved while the same toxicity would not be tolerated in a
 * benign indication).
 *
 * The BRF assesses each application across five dimensions:
 *   1. Analysis of Condition       — severity / seriousness of the disease
 *   2. Current Treatment Options   — what's already available (unmet need)
 *   3. Benefit                     — magnitude & importance of the effect
 *   4. Risk                        — nature, severity, reversibility of harms
 *   5. Risk Management             — whether risks can be mitigated (REMS, …)
 *
 * IMPORTANT — this layer does NOT overturn a safety veto. A deterministic
 * genotoxicity / hERG / DILI stop (ICH M7 / S7B) still stands; FDA likewise
 * requires a control strategy. What this adds is the *regulatory context*:
 * for a severe, high-unmet-need indication a hard liability is reframed as
 * "potentially acceptable WITH a risk-management strategy — escalate to a
 * benefit-risk committee", not as an automatic GO. For a non-serious
 * indication the same liability is "not justified by the benefit". The
 * verdict from l1Scorecard remains the source of truth for the go/no-go call.
 *
 * References:
 *   • FDA (2023) Benefit-Risk Assessment for New Drug and Biological Products
 *     — Guidance for Industry. https://www.fda.gov/media/152544/download
 *   • 21 CFR 312.300(b) — definition of "serious condition".
 *   • 21st Century Cures Act §3001 — structured benefit-risk + patient
 *     experience data.
 */

import type { L1Scorecard } from "./l1Scorecard";

// ─────────────────────────────────────────────────────────────────────────
// Condition severity + unmet-need classification
// ─────────────────────────────────────────────────────────────────────────

export type ConditionSeverity = "life-threatening" | "serious" | "moderate" | "non-serious" | "unknown";
export type UnmetNeed = "high" | "moderate" | "low" | "unknown";

/** Keyword → severity map. Grounded in 21 CFR 312.300 "serious condition". */
const LIFE_THREATENING = [
  "cancer", "carcinoma", "oncology", "tumor", "tumour", "leukemia", "leukaemia",
  "lymphoma", "melanoma", "glioblastoma", "metasta", "sarcoma", "myeloma",
  "als", "amyotrophic", "sepsis", "septic", "ebola", "hiv", "aids",
  "pulmonary arterial hypertension", "cystic fibrosis", "duchenne",
];
const SERIOUS = [
  "alzheimer", "parkinson", "multiple sclerosis", "huntington", "epilep",
  "heart failure", "myocardial", "stroke", "cirrhosis", "hepatitis",
  "copd", "pulmonary fibrosis", "renal failure", "kidney disease",
  "rheumatoid", "lupus", "crohn", "ulcerative colitis", "schizophren",
  "rare disease", "orphan", "genetic disorder", "immunodeficien", "anemia",
  "diabetes type 1", "tuberculosis", "severe",
];
const MODERATE = [
  "diabetes", "hypertension", "asthma", "depression", "anxiety", "migraine",
  "osteoporosis", "psoriasis", "eczema", "obesity", "gout", "hypothyroid",
  "gerd", "ibs", "adhd", "chronic pain",
];
const NON_SERIOUS = [
  "cosmetic", "wrinkle", "aesthetic", "hair loss", "alopecia", "acne",
  "allergic rhinitis", "seasonal allergy", "dandruff", "athlete's foot",
  "mild", "common cold", "halitosis",
];

function matchAny(text: string, keys: string[]): boolean {
  return keys.some((k) => text.includes(k));
}

export function classifyCondition(indication: string, therapeuticArea?: string): {
  severity: ConditionSeverity;
  unmetNeed: UnmetNeed;
  severityScore: number; // 0–1
  unmetScore: number;    // 0–1
  rationale: string;
} {
  const t = `${indication ?? ""} ${therapeuticArea ?? ""}`.toLowerCase().trim();
  if (!t) {
    return { severity: "unknown", unmetNeed: "unknown", severityScore: 0.5, unmetScore: 0.5,
      rationale: "No indication specified — benefit-risk uses a neutral midpoint. Set the indication for a calibrated assessment." };
  }

  let severity: ConditionSeverity;
  let severityScore: number;
  if (matchAny(t, LIFE_THREATENING)) { severity = "life-threatening"; severityScore = 1.0; }
  else if (matchAny(t, SERIOUS))      { severity = "serious";          severityScore = 0.78; }
  else if (matchAny(t, NON_SERIOUS))  { severity = "non-serious";      severityScore = 0.22; }
  else if (matchAny(t, MODERATE))     { severity = "moderate";         severityScore = 0.5; }
  else                                { severity = "unknown";          severityScore = 0.5; }

  // Unmet-need heuristic: life-threatening & rare/neuro skew to high unmet need;
  // well-served common conditions skew low. (FDA "Current Treatment Options".)
  let unmetNeed: UnmetNeed;
  let unmetScore: number;
  if (severity === "life-threatening" || matchAny(t, ["rare disease", "orphan", "refractory", "relapsed", "metasta", "glioblastoma", "als", "duchenne"])) {
    unmetNeed = "high"; unmetScore = 0.9;
  } else if (severity === "serious") {
    unmetNeed = "moderate"; unmetScore = 0.6;
  } else if (severity === "non-serious" || matchAny(t, ["hypertension", "gerd", "allergic rhinitis", "acne"])) {
    unmetNeed = "low"; unmetScore = 0.25;
  } else {
    unmetNeed = "unknown"; unmetScore = 0.5;
  }

  const rationale =
    `Indication "${indication || therapeuticArea || "—"}" classified as ${severity} ` +
    `(severity ${(severityScore * 100).toFixed(0)}/100) with ${unmetNeed} unmet medical need ` +
    `(${(unmetScore * 100).toFixed(0)}/100). Per FDA BRF, acceptable risk rises with both.`;
  return { severity, unmetNeed, severityScore, unmetScore, rationale };
}

// ─────────────────────────────────────────────────────────────────────────
// Live FDA grounding (openFDA) — replaces hardcoded priors with real signals
// ─────────────────────────────────────────────────────────────────────────
/**
 * openFDA is the FDA's public API over its own datasets (drug labels / SPL,
 * FAERS adverse events). There is NO API that returns "disease severity" or
 * "unmet need" directly, so we derive defensible proxies from real label data:
 *
 *   • Number of APPROVED drug labels that list this indication
 *     → a treatment-landscape / unmet-need proxy (few approved therapies ⇒
 *       higher unmet need; many ⇒ well-served). This is the data behind the
 *       BRF "Current Treatment Options" dimension.
 *   • Fraction of those labels that carry a BOXED WARNING
 *     → a risk-tolerance precedent: indications where the FDA has approved
 *       drugs despite black-box risks are, by revealed regulatory preference,
 *       conditions where serious risk is tolerated for benefit (oncology,
 *       etc.). This informs the "Analysis of Condition" severity proxy.
 *
 * Free, key-less (low volume), CORS-enabled, time-boxed, fail-soft. When the
 * API is unreachable the assessment falls back to the keyword prior and says
 * so — nothing is fabricated.
 */
export interface FdaConditionContext {
  status: "ok" | "unavailable";
  approvedLabelCount: number | null;
  boxedWarningCount: number | null;
  boxedFraction: number | null;
  queries: string[];
  note: string;
  error?: string;
}

const OPENFDA = "https://api.fda.gov/drug/label.json";

async function ofCount(url: string): Promise<number | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (res.status === 404) return 0; // openFDA returns 404 for zero matches
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j?.meta?.results?.total ?? 0;
}

/** Reduce a free-text indication to a searchable phrase for openFDA. */
function indicationTerm(indication: string, therapeuticArea?: string): string {
  const t = (indication || therapeuticArea || "").trim().replace(/["\\]/g, "");
  return t;
}

export async function fetchFdaConditionContext(indication: string, therapeuticArea?: string): Promise<FdaConditionContext> {
  const base: FdaConditionContext = {
    status: "unavailable", approvedLabelCount: null, boxedWarningCount: null,
    boxedFraction: null, queries: [], note: "openFDA not queried.",
  };
  const term = indicationTerm(indication, therapeuticArea);
  if (!term) return { ...base, error: "no indication" };
  const phrase = encodeURIComponent(`"${term}"`);
  const qAll = `${OPENFDA}?search=indications_and_usage:${phrase}&limit=1`;
  const qBoxed = `${OPENFDA}?search=indications_and_usage:${phrase}+AND+_exists_:boxed_warning&limit=1`;
  try {
    const [all, boxed] = await Promise.all([ofCount(qAll), ofCount(qBoxed)]);
    const total = all ?? 0;
    const bx = boxed ?? 0;
    const boxedFraction = total > 0 ? +(bx / total).toFixed(2) : null;
    return {
      status: "ok",
      approvedLabelCount: total,
      boxedWarningCount: bx,
      boxedFraction,
      queries: [qAll, qBoxed],
      note:
        total === 0
          ? "No approved drug label lists this exact indication phrase in openFDA — treated as a high-unmet-need / possibly novel indication."
          : `${total} openFDA drug label(s) list this indication; ${bx} carry a boxed warning (${boxedFraction != null ? (boxedFraction * 100).toFixed(0) : "—"}%).`,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

/**
 * Drug-specific FDA label check (openFDA drug/label by generic/brand name).
 * For a compound that resolves to an approved drug this reveals whether its
 * official label carries a BOXED WARNING — the FDA's most serious safety
 * signal and a concrete, molecule-specific risk fact. For a novel compound
 * there is no label, so it has no effect (honest, not fabricated).
 */
export interface FdaDrugLabel {
  status: "ok" | "unavailable";
  found: boolean;
  boxedWarning: boolean;
  url: string | null;
  note: string;
  error?: string;
}

export async function fetchFdaDrugLabel(drugName: string): Promise<FdaDrugLabel> {
  const base: FdaDrugLabel = { status: "unavailable", found: false, boxedWarning: false, url: null, note: "openFDA label not queried." };
  const n = (drugName ?? "").trim();
  if (!n) return { ...base, error: "no drug name" };
  const phrase = encodeURIComponent(`"${n}"`);
  const url = `${OPENFDA}?search=(openfda.generic_name:${phrase}+OR+openfda.brand_name:${phrase})&limit=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (res.status === 404) return { ...base, status: "ok", found: false, note: `No FDA label for "${n}" — not an approved drug.` };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json();
    const r = j?.results?.[0];
    if (!r) return { ...base, status: "ok", found: false, note: `No FDA label for "${n}".` };
    const boxed = Array.isArray(r.boxed_warning) && r.boxed_warning.length > 0;
    const setid = r.openfda?.spl_set_id?.[0] ?? r.set_id ?? null;
    return {
      status: "ok", found: true, boxedWarning: boxed,
      url: setid ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}` : null,
      note: boxed ? `FDA label for "${n}" carries a BOXED WARNING (most serious FDA safety signal).` : `FDA label for "${n}" — no boxed warning.`,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

/** Map a 0–1 severity score back to a label. */
function severityLabelFromScore(s: number): ConditionSeverity {
  if (s >= 0.88) return "life-threatening";
  if (s >= 0.62) return "serious";
  if (s >= 0.38) return "moderate";
  return "non-serious";
}
function unmetLabelFromScore(s: number): UnmetNeed {
  if (s >= 0.7) return "high";
  if (s >= 0.45) return "moderate";
  return "low";
}

/** Blend the keyword prior with live openFDA signals (FDA evidence wins 50–60%). */
function refineConditionWithFda(
  prior: ReturnType<typeof classifyCondition>,
  fda: FdaConditionContext | null,
): ReturnType<typeof classifyCondition> & { fdaUsed: boolean } {
  if (!fda || fda.status !== "ok") return { ...prior, fdaUsed: false };
  const total = fda.approvedLabelCount ?? 0;
  // Treatment-landscape → unmet-need (fewer approved labels ⇒ higher unmet).
  const unmetFromFda = total === 0 ? 0.9 : total < 10 ? 0.82 : total < 50 ? 0.62 : total < 200 ? 0.45 : 0.22;
  // Boxed-warning prevalence → revealed risk tolerance ⇒ severity proxy.
  const sevFromFda = fda.boxedFraction == null ? prior.severityScore : Math.max(0, Math.min(1, 0.4 + fda.boxedFraction * 0.6));
  // Live FDA evidence dominates (0.65) over the keyword prior (0.35) whenever
  // openFDA returns data — the prior is only a fallback when the API is dark.
  const severityScore = +(0.35 * prior.severityScore + 0.65 * sevFromFda).toFixed(2);
  const unmetScore = +(0.3 * prior.unmetScore + 0.7 * unmetFromFda).toFixed(2);
  return {
    severity: severityLabelFromScore(severityScore),
    unmetNeed: unmetLabelFromScore(unmetScore),
    severityScore,
    unmetScore,
    rationale: `${prior.rationale} Grounded in openFDA: ${fda.note}`,
    fdaUsed: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Benefit-risk balance
// ─────────────────────────────────────────────────────────────────────────

export type BenefitRiskBalance = "favorable" | "borderline" | "unfavorable" | "conditional";

export interface BrfDimension {
  dimension: "Analysis of Condition" | "Current Treatment Options" | "Benefit" | "Risk" | "Risk Management";
  evidence: string;
  conclusion: string;
}

export interface BenefitRiskAssessment {
  balance: BenefitRiskBalance;
  /** 0–1 risk tolerance implied by the condition (severity × unmet need). */
  riskTolerance: number;
  severity: ConditionSeverity;
  unmetNeed: UnmetNeed;
  /** Headline for the UI. */
  headline: string;
  /** One-paragraph regulatory-style conclusion. */
  rationale: string;
  /** The five FDA BRF rows. */
  dimensions: BrfDimension[];
  /** Whether the safety verdict and the benefit-risk view diverge (needs a committee). */
  divergesFromVerdict: boolean;
  recommendation: string;
  disclaimer: string;
}

export interface BenefitRiskInput {
  scorecard: L1Scorecard;
  indication: string;
  therapeuticArea?: string;
  /** Optional efficacy/potency 0–100 (defaults to the Potency dimension). */
  benefitScore?: number;
  /** Optional live openFDA grounding (from fetchFdaConditionContext). */
  fda?: FdaConditionContext | null;
  /** Optional NCATS Pharos target development level (Tclin/Tchem/Tbio/Tdark)
   *  — feeds the BENEFIT side: a clinically-validated target (Tclin) raises
   *  benefit credibility; an under-studied one (Tdark) lowers it. */
  targetValidation?: { tdl: string | null } | null;
  /** Optional FDA-label boxed-warning fact for the molecule (openFDA) — a
   *  concrete drug-specific RISK signal folded into the Risk dimension. */
  drugLabel?: FdaDrugLabel | null;
}

/** Map the L1 verdict to a coarse risk level (0 = low, 1 = high/veto). */
function riskFromVerdict(sc: L1Scorecard): { level: number; label: string; hard: boolean } {
  const hard = sc.flags.some((f) => f.hardNoGo);
  if (sc.verdict === "NO-GO" || sc.verdict === "KNOWN-LIABILITY-NO-GO") return { level: 0.9, label: "high", hard: true };
  if (sc.verdict === "WATCH") return { level: 0.55, label: "moderate", hard };
  return { level: 0.2, label: "low", hard };
}

export function assessBenefitRisk(input: BenefitRiskInput): BenefitRiskAssessment {
  const sc = input.scorecard;
  const fda = input.fda ?? null;
  const drugLabel = input.drugLabel ?? null;
  const boxedWarning = drugLabel?.status === "ok" && drugLabel.found && drugLabel.boxedWarning === true;
  const cond = refineConditionWithFda(classifyCondition(input.indication, input.therapeuticArea), fda);
  const risk = riskFromVerdict(sc);

  // Benefit factors — derived from THIS molecule's own predicted dimensions
  // (potency/efficacy, selectivity, developability), not a hardcoded value.
  // Each is molecule-specific (ML/measured per the scorecard provenance). The
  // benefit score is their mean, so a potent + selective + developable
  // candidate scores higher benefit than a merely potent one.
  const benefitDims = sc.dimensions.filter((d) => /potency|selectivity|drug-likeness/i.test(d.dimension));
  const benefitRaw = input.benefitScore != null
    ? input.benefitScore / 100
    : benefitDims.length > 0
      ? benefitDims.reduce((s, d) => s + d.score, 0) / benefitDims.length / 100
      : sc.compositeRaw / 100;
  // Pharos target-development-level modifier — a clinically-validated target
  // (Tclin) makes the predicted benefit more credible; an under-studied one
  // (Tdark) discounts it. This is how the live Pharos signal actually moves
  // the benefit-risk output (not just decoration).
  const tdl = input.targetValidation?.tdl ?? null;
  const tdlMult = tdl === "Tclin" ? 1.08 : tdl === "Tchem" ? 1.0 : tdl === "Tbio" ? 0.92 : tdl === "Tdark" ? 0.82 : 1.0;
  const benefit01 = Math.max(0, Math.min(1, benefitRaw * tdlMult));
  const benefitFactorText =
    (benefitDims.length > 0
      ? benefitDims.map((d) => `${d.dimension} ${d.score.toFixed(0)}/100 (${d.provenance})`).join("; ")
      : `composite ${sc.compositeRaw}/100`) +
    (tdl ? ` · target validation ${tdl} (Pharos, ×${tdlMult.toFixed(2)})` : "");

  // Risk tolerance the condition affords (FDA: severity × unmet need).
  const riskTolerance = +(0.55 * cond.severityScore + 0.45 * cond.unmetScore).toFixed(2);

  // Hard liabilities present?
  const hardFlags = sc.flags.filter((f) => f.hardNoGo);
  const watchFlags = sc.flags.filter((f) => f.severity === "warn");

  // ── Balance logic ──────────────────────────────────────────────────────
  // The acceptable-risk line: a candidate is favorable when the benefit +
  // condition-driven tolerance outweigh the risk level. A hard safety veto
  // can only ever reach "conditional" (needs mitigation + committee), never
  // "favorable" outright — the safety stop is sovereign.
  const margin = +(benefit01 * 0.4 + riskTolerance * 0.6 - risk.level).toFixed(2);
  let balance: BenefitRiskBalance;
  if (risk.hard) {
    // Veto present. Only a serious/high-unmet condition makes it "conditional".
    balance = riskTolerance >= 0.7 ? "conditional" : "unfavorable";
  } else if (margin >= 0.2) {
    balance = "favorable";
  } else if (margin >= 0.0) {
    balance = "borderline";
  } else {
    balance = "unfavorable";
  }

  // A documented FDA BOXED WARNING on this molecule is the most serious safety
  // signal there is — it cannot read as cleanly "favorable". Step it down one
  // notch (favorable → borderline). This is how the FDA-label signal actually
  // moves the output. (Novel compounds have no label, so no effect.)
  if (boxedWarning && balance === "favorable") balance = "borderline";

  const divergesFromVerdict =
    (balance === "conditional") || // veto but condition justifies escalation
    (sc.verdict === "WATCH" && balance === "favorable");

  // ── FDA BRF five dimensions ──────────────────────────────────────────────
  const dimensions: BrfDimension[] = [
    {
      dimension: "Analysis of Condition",
      evidence: cond.rationale,
      conclusion:
        cond.severity === "life-threatening" ? "Life-threatening condition — high tolerance for serious risk is appropriate."
        : cond.severity === "serious" ? "Serious condition — elevated risk may be acceptable for meaningful benefit."
        : cond.severity === "non-serious" ? "Non-serious condition — only a low risk burden is acceptable."
        : cond.severity === "moderate" ? "Moderate condition — risk must be proportionate to a clear benefit."
        : "Condition severity unspecified — assessment uses a neutral midpoint.",
    },
    {
      dimension: "Current Treatment Options",
      evidence:
        (cond.unmetNeed === "high" ? "Few or no adequate therapies / refractory population — high unmet medical need."
        : cond.unmetNeed === "moderate" ? "Some therapies exist but with meaningful limitations."
        : cond.unmetNeed === "low" ? "Multiple effective therapies already available."
        : "Treatment landscape not specified.")
        + (fda?.status === "ok"
            ? ` Live openFDA: ${fda.approvedLabelCount} approved label(s) list this indication` +
              (fda.boxedFraction != null ? `, ${(fda.boxedFraction * 100).toFixed(0)}% with a boxed warning.` : ".")
            : " (openFDA unavailable — using indication prior.)"),
      conclusion:
        cond.unmetScore >= 0.7 ? "High unmet need raises the acceptable risk ceiling."
        : cond.unmetScore <= 0.3 ? "Well-served indication — a new entrant must clear a higher safety bar."
        : "Unmet need is intermediate.",
    },
    {
      dimension: "Benefit",
      evidence:
        `Molecule-specific benefit factors → ${benefitFactorText}. Composite benefit ≈ ${(benefit01 * 100).toFixed(0)}/100. ` +
        `Pre-clinical surrogate from this molecule's predictions — not a clinical efficacy endpoint.`,
      conclusion:
        benefit01 >= 0.8 ? "Strong predicted benefit signal."
        : benefit01 >= 0.5 ? "Moderate predicted benefit."
        : "Weak predicted benefit — limits acceptable risk.",
    },
    {
      dimension: "Risk",
      evidence:
        (hardFlags.length > 0 ? `Hard liabilit${hardFlags.length === 1 ? "y" : "ies"}: ${hardFlags.map((f) => f.label).join("; ")}.`
        : watchFlags.length > 0 ? `Monitor-level signals: ${watchFlags.map((f) => f.label).join("; ")}.`
        : "No hard or monitor-level liabilities flagged at L1.")
        + (boxedWarning ? ` ⚠ FDA BOXED WARNING on the matched drug label (openFDA) — most serious regulatory safety signal.`
            : drugLabel?.status === "ok" && drugLabel.found ? ` FDA label present, no boxed warning.` : ""),
      conclusion:
        risk.hard ? "Serious predicted safety liability — would normally stop development absent mitigation."
        : watchFlags.length > 0 ? "Manageable risk signals requiring monitoring."
        : "Low predicted risk at this stage.",
    },
    {
      dimension: "Risk Management",
      evidence:
        risk.hard ? "Mitigation options: structural re-design to remove the alert, a qualified control strategy, intensive monitoring, or a REMS-type program with restricted use."
        : watchFlags.length > 0 ? "Standard monitoring / labelling and orthogonal confirmation (patch-clamp, hepatocyte assays) at L2."
        : "Routine pharmacovigilance expected to suffice.",
      conclusion:
        risk.hard && riskTolerance >= 0.7 ? "For this severe, high-unmet-need indication, a risk-management strategy may render the liability acceptable — escalate to a benefit-risk committee."
        : risk.hard ? "Mitigation required before the candidate is viable; benefit does not currently justify the risk for this indication."
        : "Risks appear manageable with standard measures.",
    },
  ];

  // ── Narrative ────────────────────────────────────────────────────────────
  const balanceWord = {
    favorable: "Favorable", borderline: "Borderline", unfavorable: "Unfavorable", conditional: "Conditional",
  }[balance];

  const headline =
    balance === "conditional"
      ? `Benefit-risk: CONDITIONAL — liability may be acceptable for this ${cond.severity} indication with risk management`
      : `Benefit-risk: ${balanceWord.toUpperCase()} for a ${cond.severity} indication (risk tolerance ${(riskTolerance * 100).toFixed(0)}/100)`;

  const rationale =
    balance === "conditional"
      ? `The L1 safety verdict is ${sc.verdict}, but under the FDA Benefit-Risk Framework the high severity / unmet need of this indication (risk tolerance ${(riskTolerance * 100).toFixed(0)}/100) means the flagged liability is not automatically disqualifying. Approval-grade precedent exists for serious diseases where a meaningful benefit is paired with a robust risk-management strategy. This is NOT an automatic advance — it requires the liability to be mitigated and the trade-off reviewed by a benefit-risk committee.`
      : balance === "favorable"
        ? `Predicted benefit (${(benefit01 * 100).toFixed(0)}/100) and the condition's risk tolerance (${(riskTolerance * 100).toFixed(0)}/100) outweigh the L1 risk level. The benefit-risk balance supports advancing, consistent with the safety verdict (${sc.verdict}).`
      : balance === "unfavorable"
        ? `The predicted risk is not justified by the benefit for a ${cond.severity} indication with ${cond.unmetNeed} unmet need. Under FDA benefit-risk logic the bar for this indication is high; de-prioritize unless the liability is removed or a higher-severity indication applies.`
        : `Benefit and risk are finely balanced for this ${cond.severity} indication. Advance only with the flagged endpoints de-risked; the trade-off is sensitive to the eventual clinical efficacy.`;

  const recommendation =
    balance === "conditional"
      ? "Escalate to benefit-risk review: define a risk-management strategy (structural mitigation / REMS / monitoring) before any L2 commitment."
      : balance === "favorable"
        ? "Benefit-risk supports progression to Layer 2 confirmation."
        : balance === "unfavorable"
          ? "Benefit-risk does not support progression for this indication as-is."
          : "Advance only after de-risking the flagged endpoints; revisit benefit-risk with clinical efficacy data.";

  return {
    balance, riskTolerance, severity: cond.severity, unmetNeed: cond.unmetNeed,
    headline, rationale, dimensions, divergesFromVerdict, recommendation,
    disclaimer:
      "Pre-clinical benefit-risk CONTEXT modelled on the FDA Benefit-Risk Framework (2023). It informs prioritisation; it is not a regulatory determination and does not override the safety verdict.",
  };
}
