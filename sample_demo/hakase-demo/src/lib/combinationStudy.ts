/**
 * What a combination toxicology study actually looks like.
 *
 * This is the part the kernel means when it says a combination changes the
 * *shape* of a study rather than its inputs. Three things change, and none of
 * them is expressible by screening a second structure:
 *
 *  1. **The dose axis becomes a ratio.** A combination arm is specified by a
 *     total dose, which the declared molar ratio splits into a dose per
 *     component. Two arms at the same total dose but different ratios are
 *     different arms.
 *
 *  2. **The arm structure gains monotherapy controls.** A finding in a
 *     combination arm cannot be attributed to anything without arms that give
 *     each component alone. FDA's 2013 codevelopment guidance expects the
 *     nonclinical package to characterise the combination *and* the individual
 *     components; without the monotherapy arms there is no way to say which
 *     component carried a finding, or whether the combination carried it.
 *
 *  3. **A point of departure has to be attributed.** "NOAEL 30 mg/kg" is
 *     meaningless for a combination unless it says 30 mg/kg *of what* — the
 *     total, or one component — and which arm it came from.
 *
 * The extra arms are not free: each one is animals. The accounting here is
 * arithmetic on the declared design, and it is reported precisely because a
 * combination study costs more lives than a single-agent one.
 *
 * Nothing here predicts an interaction. Monotherapy and combination arms are
 * simulated independently and compared; a departure between them is what an
 * experiment would measure, and this module marks where that comparison belongs
 * rather than filling it in.
 */
import type { Component } from "./combination";

export type ArmKind = "vehicle_control" | "monotherapy" | "combination";

export type StudyArm = {
  id: string;
  kind: ArmKind;
  label: string;
  /** Total dose across all components, mg/kg. Zero for the vehicle control. */
  totalDoseMgPerKg: number;
  /** Dose of each component in this arm, keyed by component id. */
  perComponent: Record<string, number>;
  /** Which component a monotherapy arm isolates, if any. */
  isolates: string | null;
  purpose: string;
};

/**
 * Build the arm structure a combination study needs.
 *
 * Monotherapy arms are set at each component's dose *in the top combination
 * arm*, not at its own standalone MTD: the question they answer is "did this
 * component cause the finding at the exposure it actually had in the
 * combination", and only a matched dose answers that.
 */
export function combinationArms(components: Component[], fractions: number[], totalDoses: number[], includeControl: boolean): StudyArm[] {
  const arms: StudyArm[] = [];
  const ordered = [...totalDoses].sort((a, b) => a - b);
  const top = ordered[ordered.length - 1] ?? 0;

  if (includeControl) {
    arms.push({
      id: "vehicle", kind: "vehicle_control", label: "Vehicle control",
      totalDoseMgPerKg: 0,
      perComponent: Object.fromEntries(components.map((component) => [component.id, 0])),
      isolates: null,
      purpose: "The only basis on which a finding can be attributed to the test article rather than to the vehicle or the procedure.",
    });
  }

  components.forEach((component, index) => {
    const dose = top * fractions[index];
    arms.push({
      id: `mono-${component.id}`, kind: "monotherapy",
      label: `${component.label} alone · ${round(dose)} mg/kg`,
      totalDoseMgPerKg: dose,
      perComponent: Object.fromEntries(components.map((entry, position) =>
        [entry.id, position === index ? dose : 0])),
      isolates: component.id,
      purpose: `Gives ${component.label} at the dose it reaches in the top combination arm, so a finding there can be attributed to this component rather than to the pair.`,
    });
  });

  ordered.forEach((total, index) => {
    arms.push({
      id: `combo-${index}`, kind: "combination",
      label: `Combination · ${round(total)} mg/kg total`,
      totalDoseMgPerKg: total,
      perComponent: Object.fromEntries(components.map((component, position) =>
        [component.id, total * fractions[position]])),
      isolates: null,
      purpose: index === ordered.length - 1
        ? "The top combination arm. Findings here are compared against the monotherapy arms to see whether the pair did something neither component did alone."
        : "Establishes the shape of the dose–response for the combination at the declared ratio.",
    });
  });

  return arms;
}

function round(value: number): number {
  return Number(value.toFixed(value < 10 ? 2 : 1));
}

/**
 * Animals the declared design consumes.
 *
 * Reported against the single-agent equivalent because the difference is the
 * real cost of being able to attribute a finding, and it is a 3Rs number a
 * committee will ask about.
 */
export function combinationAccounting(arms: StudyArm[], sexes: number, perSexPerGroup: number, singleAgentGroups: number) {
  const groups = arms.length;
  const total = groups * sexes * perSexPerGroup;
  const singleAgentTotal = singleAgentGroups * sexes * perSexPerGroup;
  return {
    groups,
    monotherapyGroups: arms.filter((arm) => arm.kind === "monotherapy").length,
    combinationGroups: arms.filter((arm) => arm.kind === "combination").length,
    animals: total,
    singleAgentEquivalent: singleAgentTotal,
    additionalAnimals: total - singleAgentTotal,
    basis: "Arithmetic on the declared design: arms × sexes × animals per sex per group. The comparison is against the same design run for one agent, so the difference is the cost of the monotherapy arms that make attribution possible.",
  };
}

export type PodCandidate = {
  componentId: string | null;
  componentLabel: string;
  /** Dose of the *governing component* at the point of departure, mg/kg. */
  doseMgPerKg: number;
  armKind: ArmKind;
};

export type PodAttribution = {
  governing: PodCandidate;
  /** True when the combination arm departs from every monotherapy arm — the
      only pattern in a simulated design that would prompt an interaction
      question, and one only a measured study can answer. */
  combinationDriven: boolean;
  statement: string;
};

/**
 * Decide what a point of departure belongs to.
 *
 * A finding first seen in a monotherapy arm belongs to that component. One seen
 * only in the combination arm belongs to the combination, and that is a
 * finding in its own right rather than something to average away.
 */
export function attributePod(monotherapy: PodCandidate[], combination: PodCandidate | null): PodAttribution | null {
  const usable = monotherapy.filter((entry) => entry.doseMgPerKg > 0);
  if (!usable.length && !combination) return null;

  const lowestMono = usable.length
    ? usable.reduce((worst, entry) => (entry.doseMgPerKg < worst.doseMgPerKg ? entry : worst))
    : null;

  /* The combination arm is "driving" when it reaches a point of departure at a
     lower per-component dose than that component managed alone. */
  const combinationDriven = Boolean(
    combination && lowestMono && combination.doseMgPerKg < lowestMono.doseMgPerKg,
  );

  if (combinationDriven && combination) {
    return {
      governing: combination, combinationDriven: true,
      statement: `The combination reached its point of departure at a lower dose than any component did alone. In a simulated design that is a prompt, not a result: only a measured study with these arms can say whether the components interacted or whether the difference is within the variability of the model.`,
    };
  }
  if (lowestMono) {
    return {
      governing: lowestMono, combinationDriven: false,
      statement: `${lowestMono.componentLabel} reached the point of departure at the lowest dose, so it governs. The dose is that component's own dose, not the combination total — a total-dose NOAEL for a combination is not interpretable without the ratio it was given at.`,
    };
  }
  return {
    governing: combination!, combinationDriven: false,
    statement: "Only the combination arms reached a point of departure. Without a monotherapy arm at a matched dose the finding cannot be attributed to a component.",
  };
}
