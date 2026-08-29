/**
 * Checks the combination null models against the published definitions, and
 * checks that the module refuses where the production kernel refuses.
 */
import {
  nullModelFor, loeweAdditiveDose, blissExpectedEffect,
  combinationIndex, interpretCombinationIndex, normalisedFractions,
} from "../src/lib/combination";

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = typeof got === "number" && typeof want === "number"
    ? Math.abs(got - want) < 1e-9 : got === want;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  got ${got}, want ${want}`}`);
  if (!ok) bad++;
};

// The declared mechanism picks the model, and an undeclared one projects nothing.
eq("same_target → Loewe", nullModelFor("same_target"), "loewe_additivity");
eq("same_pathway → Loewe", nullModelFor("same_pathway"), "loewe_additivity");
eq("independent → Bliss", nullModelFor("independent"), "bliss_independence");
eq("undeclared → not projected", nullModelFor("undeclared"), "not_projected");

// Loewe: two equipotent components at 50:50 are additive at that same potency.
eq("Loewe 50:50 equipotent", loeweAdditiveDose(0.5, 100, 0.5, 100), 100);
eq("Loewe 50:50, B 10x potent", loeweAdditiveDose(0.5, 100, 0.5, 10), 1 / (0.005 + 0.05));
eq("Loewe refuses a missing potency", loeweAdditiveDose(0.5, 0, 0.5, 10), null);

// Bliss: Ea + Eb − Ea·Eb, refusing anything that is not a probability.
eq("Bliss 0.5 / 0.5", blissExpectedEffect(0.5, 0.5), 0.75);
eq("Bliss 0 / 0.4", blissExpectedEffect(0, 0.4), 0.4);
eq("Bliss refuses a non-probability", blissExpectedEffect(1.4, 0.2), null);

// CI and its Chou 2010 bands.
eq("CI additive by construction", combinationIndex(50, 100, 50, 100), 1);
eq("CI synergy", combinationIndex(25, 100, 25, 100), 0.5);
eq("CI band 0.5", interpretCombinationIndex(0.5), "synergism");
eq("CI band 1.0", interpretCombinationIndex(1.0), "nearly additive");
eq("CI band 2.0", interpretCombinationIndex(2.0), "antagonism");

// Ratios normalise without losing the entered proportion.
const f = normalisedFractions([
  { id: "a", label: "A", smiles: "", role: "active", fraction: 3 },
  { id: "b", label: "B", smiles: "", role: "co_active", fraction: 1 },
]);
eq("fractions normalise", f[0], 0.75);
eq("fractions sum to 1", f[0] + f[1], 1);

console.log(bad ? `\n${bad} FAILING` : "\ncombination models agree with the published definitions");
process.exit(bad ? 1 : 0);
