/**
 * The combination study design: arm structure, ratio dose axis, animal cost and
 * point-of-departure attribution.
 */
import { combinationArms, combinationAccounting, attributePod } from "../src/lib/combinationStudy";
import { normalisedFractions } from "../src/lib/combination";
import type { Component } from "../src/lib/combination";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = typeof got === "number" && typeof want === "number"
    ? Math.abs(got - want) < 1e-6 : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
  if (!ok) bad++;
};

const components: Component[] = [
  { id: "a", label: "Component 1", smiles: "", role: "active", fraction: 3 },
  { id: "b", label: "Component 2", smiles: "", role: "co_active", fraction: 1 },
];
const fractions = normalisedFractions(components);   // 0.75 / 0.25
const arms = combinationArms(components, fractions, [20, 60, 100], true);

// control + one monotherapy arm per component + one arm per total dose
eq("arm count", arms.length, 1 + 2 + 3);
eq("first arm is the vehicle control", arms[0].kind, "vehicle_control");
eq("control doses nothing", arms[0].totalDoseMgPerKg, 0);

// The ratio splits every combination arm.
const top = arms.find((a) => a.label.includes("100 mg/kg total"))!;
eq("top combination: component 1 at 75%", top.perComponent.a, 75);
eq("top combination: component 2 at 25%", top.perComponent.b, 25);
eq("per-component doses sum to the total", top.perComponent.a + top.perComponent.b, 100);

// Monotherapy arms match the dose that component reaches in the TOP arm, which
// is what makes a finding attributable.
const monoA = arms.find((a) => a.isolates === "a")!;
eq("monotherapy A matches its top-arm dose", monoA.perComponent.a, 75);
eq("monotherapy A gives no B", monoA.perComponent.b, 0);
const monoB = arms.find((a) => a.isolates === "b")!;
eq("monotherapy B matches its top-arm dose", monoB.perComponent.b, 25);

// Doses are ordered low to high regardless of entry order.
const shuffled = combinationArms(components, fractions, [100, 20, 60], true)
  .filter((a) => a.kind === "combination").map((a) => a.totalDoseMgPerKg);
eq("combination arms ordered ascending", shuffled, [20, 60, 100]);

// The extra arms are animals, and that is the point of reporting them.
const acc = combinationAccounting(arms, 2, 10, 4);
eq("groups", acc.groups, 6);
eq("monotherapy groups", acc.monotherapyGroups, 2);
eq("animals", acc.animals, 6 * 2 * 10);
eq("single-agent equivalent", acc.singleAgentEquivalent, 4 * 2 * 10);
eq("additional animals for attribution", acc.additionalAnimals, 40);

// Attribution: the component reaching a POD at the lowest dose governs.
const attributed = attributePod(
  [
    { componentId: "a", componentLabel: "Component 1", doseMgPerKg: 75, armKind: "monotherapy" },
    { componentId: "b", componentLabel: "Component 2", doseMgPerKg: 25, armKind: "monotherapy" },
  ],
  { componentId: null, componentLabel: "Combination", doseMgPerKg: 30, armKind: "combination" },
)!;
eq("lowest monotherapy governs", attributed.governing.componentLabel, "Component 2");
eq("not combination-driven", attributed.combinationDriven, false);

// A combination arm reaching a POD below every monotherapy arm is flagged, not
// declared synergistic.
const driven = attributePod(
  [{ componentId: "a", componentLabel: "Component 1", doseMgPerKg: 75, armKind: "monotherapy" }],
  { componentId: null, componentLabel: "Combination", doseMgPerKg: 20, armKind: "combination" },
)!;
eq("combination-driven detected", driven.combinationDriven, true);
eq("flagged as a prompt, not a result", driven.statement.includes("prompt, not a result"), true);

eq("nothing to attribute returns null", attributePod([], null), null);

console.log(bad ? `\n${bad} FAILING` : "\ncombination study design is consistent");
process.exit(bad ? 1 : 0);
