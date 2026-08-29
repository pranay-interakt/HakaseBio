/**
 * Combination products: what they are, and what may honestly be said about them.
 *
 * This mirrors the production kernel's combination contract
 * (`hakase_kernel/combination/`) rather than inventing a demo-only one, so what
 * is shown here is what the platform actually does.
 *
 * WHY COMPONENTS ARE FIRST-CLASS
 * ──────────────────────────────
 * The obvious way to add combinations is a second SMILES field. That is wrong:
 * a combination changes the *shape* of a study, not just its inputs. The dose
 * axis stops being a scalar and becomes a ratio, the arm structure gains the
 * monotherapy controls a regulator requires, and a point of departure has to be
 * attributed to a component. So a programme has `components` — one entry for a
 * single agent, N for a combination — and single-agent work is the N=1 case of
 * the same contract.
 *
 * WHAT IS REFUSED
 * ───────────────
 * Whether two agents interact, and how, cannot be derived from their
 * structures. Synergy is an experimental finding. The mechanism hypothesis is
 * *declared by the user*, carried as a stated assumption, and every number
 * derived from it is attributed back to that declaration.
 *
 * The two null models are not interchangeable. Two dilutions of the same drug
 * look strongly "synergistic" under Bliss; genuinely independent agents look
 * antagonistic under Loewe. The declared mechanism selects the model and the
 * selection travels with every number reported.
 *
 * References: Loewe 1926 (Ergeb Physiol 27:47); Bliss 1939 (Ann Appl Biol
 * 26:585); Chou & Talalay 1984 (Adv Enzyme Regul 22:27); Chou 2010 (Cancer Res
 * 70:440) for the CI bands; Greco et al. 1995 (Pharmacol Rev 47:331) on why the
 * null model must be declared.
 */

/** What a component is present to do — a therapeutic-intent label, not a
    pharmacological claim. It drives reporting, not simulation. */
export type ComponentRole = "active" | "co_active" | "booster" | "adjuvant";

/** The user's declared hypothesis about how the components relate. */
export type MechanismHypothesis = "same_target" | "same_pathway" | "independent" | "undeclared";

export type InteractionModel = "loewe_additivity" | "bliss_independence" | "not_projected";

export type Component = {
  id: string;
  label: string;
  smiles: string;
  role: ComponentRole;
  /** Molar fraction within the combination. Fractions across components sum to 1. */
  fraction: number;
};

export const ROLE_LABEL: Record<ComponentRole, string> = {
  active: "Active",
  co_active: "Co-active",
  booster: "Pharmacokinetic booster",
  adjuvant: "Adjuvant",
};

export const MECHANISM_LABEL: Record<MechanismHypothesis, string> = {
  same_target: "Same target",
  same_pathway: "Same pathway, different targets",
  independent: "Independent mechanisms",
  undeclared: "Not declared",
};

export const MECHANISM_NOTE: Record<MechanismHypothesis, string> = {
  same_target: "Both components bind the same site, so their effects are dose-additive by construction. Loewe additivity is the null model.",
  same_pathway: "Different targets within one pathway. Additivity remains the reasonable null but is not guaranteed by the mechanism.",
  independent: "Unrelated mechanisms, so the components' probabilities of effect are treated as independent events. Bliss independence is the null model.",
  undeclared: "No hypothesis stated. Without one there is no defensible null model, so no combined effect is projected.",
};

/**
 * Select the null model the declared mechanism implies.
 *
 * `undeclared` deliberately yields `not_projected`: guessing a null would
 * attach a number to an assumption the user never made.
 */
export function nullModelFor(mechanism: MechanismHypothesis): InteractionModel {
  if (mechanism === "same_target" || mechanism === "same_pathway") return "loewe_additivity";
  if (mechanism === "independent") return "bliss_independence";
  return "not_projected";
}

/**
 * Total combination dose that is Loewe-additive at a fixed ratio.
 *
 * For fractions `fa`/`fb` the total dose D is additive when
 * `(fa·D)/ECa + (fb·D)/ECb = 1`, so `D = 1 / (fa/ECa + fb/ECb)`.
 * Returns null when a potency is missing rather than substituting one.
 */
export function loeweAdditiveDose(fractionA: number, potencyA: number, fractionB: number, potencyB: number): number | null {
  if (!(potencyA > 0) || !(potencyB > 0)) return null;
  if (fractionA < 0 || fractionB < 0 || fractionA + fractionB <= 0) return null;
  const denominator = fractionA / potencyA + fractionB / potencyB;
  return denominator > 0 ? 1 / denominator : null;
}

/**
 * Expected fractional effect under Bliss independence: `Ea + Eb − Ea·Eb`.
 *
 * Effects must be fractions in [0, 1] — a fractional inhibition or an
 * occupancy. Anything outside that range is not a probability of effect, so
 * null is returned rather than a plausible-looking number.
 */
export function blissExpectedEffect(effectA: number, effectB: number): number | null {
  if (!(effectA >= 0 && effectA <= 1) || !(effectB >= 0 && effectB <= 1)) return null;
  return effectA + effectB - effectA * effectB;
}

/**
 * Chou–Talalay Combination Index at one effect level:
 * `CI = (Da / ECa) + (Db / ECb)`.
 *
 * CI < 1 is synergy, ≈ 1 additivity, > 1 antagonism — **but only when the
 * numerator doses come from a measured combination response**. Feeding it
 * predicted doses returns exactly 1 by construction and means nothing, which is
 * why nothing in this workspace calls it with predictions.
 */
export function combinationIndex(doseAInCombination: number, potencyAAlone: number, doseBInCombination: number, potencyBAlone: number): number | null {
  if (!(potencyAAlone > 0) || !(potencyBAlone > 0)) return null;
  if (doseAInCombination < 0 || doseBInCombination < 0) return null;
  return doseAInCombination / potencyAAlone + doseBInCombination / potencyBAlone;
}

/** Chou 2010 bands. These describe a *measured* CI and are never applied to a
    predicted one. */
const CI_BANDS: Array<[number, number, string]> = [
  [0.0, 0.10, "very strong synergism"],
  [0.10, 0.30, "strong synergism"],
  [0.30, 0.70, "synergism"],
  [0.70, 0.85, "moderate synergism"],
  [0.85, 0.90, "slight synergism"],
  [0.90, 1.10, "nearly additive"],
  [1.10, 1.20, "slight antagonism"],
  [1.20, 1.45, "moderate antagonism"],
  [1.45, 3.30, "antagonism"],
  [3.30, Infinity, "strong antagonism"],
];

export function interpretCombinationIndex(ci: number): string {
  for (const [low, high, label] of CI_BANDS) if (ci >= low && ci < high) return label;
  return "uninterpretable";
}

/* ── what *can* be derived from structure ─────────────────────────────────
   Synergy cannot. These can, because they are consequences of the components'
   own screened properties rather than of an interaction between them. Each is
   a hazard to check experimentally, not a finding. */

export type CombinationRisk = {
  id: string;
  title: string;
  detail: string;
  severity: "watch" | "concern";
  /** The experiment that would settle it. */
  resolvedBy: string;
};

export type ComponentSignal = {
  label: string;
  /** Endpoint key → canonical value, taken from that component's own profile. */
  endpoints: Record<string, number>;
  alerts: number;
};

/**
 * Hazards that follow from two agents being given together.
 *
 * Every one is an *additive* or *shared-pathway* concern read off the
 * components' individual screens. None of them is an interaction prediction.
 */
export function combinationRisks(signals: ComponentSignal[]): CombinationRisk[] {
  if (signals.length < 2) return [];
  const risks: CombinationRisk[] = [];
  const labels = signals.map((entry) => entry.label);

  const flagged = (key: string, threshold: number) =>
    signals.filter((entry) => (entry.endpoints[key] ?? 0) >= threshold).map((entry) => entry.label);

  const herg = flagged("hERG", 0.5);
  if (herg.length >= 2) {
    risks.push({
      id: "herg", severity: "concern",
      title: "Overlapping cardiac liability",
      detail: `${herg.join(" and ")} each carry an hERG signal above the screening threshold. Repolarisation effects are additive, so the combination's QT risk is not bounded by the worse single agent.`,
      resolvedBy: "A manual patch-clamp IC50 for each component, then a combined exposure–response assessment against the projected free Cmax of the pair.",
    });
  }

  const dili = flagged("DILI", 0.5);
  if (dili.length >= 2) {
    risks.push({
      id: "dili", severity: "concern",
      title: "Overlapping hepatic liability",
      detail: `${dili.join(" and ")} both sit above the DILI screening threshold. Shared hepatic injury mechanisms compound, and the combination's margin is narrower than either component's.`,
      resolvedBy: "Sandwich-cultured hepatocyte assessment of each component and of the pair at the intended ratio.",
    });
  }

  /* A booster is present precisely to inhibit the clearance of its partner, so
     the interaction is intended rather than incidental — but it still has to be
     quantified before a dose is set. */
  const clearance = signals.map((entry) => entry.endpoints.Clearance_Hepatocyte_AZ ?? 0);
  if (clearance.some((value) => value > 0) && signals.length >= 2) {
    risks.push({
      id: "cyp", severity: "watch",
      title: "Shared hepatic clearance route",
      detail: `Both components are cleared substantially by the liver, so they compete for the same enzyme capacity. A change in one component's exposure when the other is co-administered is expected, and the direction is not predictable from structure.`,
      resolvedBy: "Reversible and time-dependent CYP inhibition for each component, then the FDA basic model R1 screen (FDA In Vitro Drug Interaction Studies guidance, January 2020) before any clinical DDI study is designed.",
    });
  }

  const alerts = signals.filter((entry) => entry.alerts > 0).map((entry) => entry.label);
  if (alerts.length >= 2) {
    risks.push({
      id: "alerts", severity: "watch",
      title: "Structural alerts in more than one component",
      detail: `${alerts.join(" and ")} each matched a structural alert. Alerts do not add, but a combination carrying two independent reactive-metabolite hypotheses needs both excluded rather than one.`,
      resolvedBy: "Glutathione-trapping and covalent-binding assessment for each flagged component separately.",
    });
  }

  if (!risks.length) {
    risks.push({
      id: "none", severity: "watch",
      title: "No overlapping liability detected across the components",
      detail: `Neither ${labels.join(" nor ")} raised the same screening liability as the other. That is the absence of an overlap in the screened endpoints, not evidence that co-administration is safe.`,
      resolvedBy: "The combination toxicology package required by the regulator for the intended indication.",
    });
  }
  return risks;
}

/** Normalise fractions so they sum to 1, preserving the entered ratio. */
export function normalisedFractions(components: Component[]): number[] {
  const total = components.reduce((sum, entry) => sum + Math.max(0, entry.fraction), 0);
  if (total <= 0) return components.map(() => 1 / Math.max(components.length, 1));
  return components.map((entry) => Math.max(0, entry.fraction) / total);
}
