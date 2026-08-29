/**
 * Peptide descriptors checked against published values.
 *
 * Melittin (bee venom, 26 residues) and oxytocin are standard reference
 * sequences with tabulated MW, pI and GRAVY, so a formula error shows up as a
 * disagreement with the literature rather than as a plausible number.
 */
import { computePeptideProperties, validateSequence } from "../src/lib/peptide";

let bad = 0;
const near = (name: string, got: number | undefined, want: number, tol: number) => {
  const ok = typeof got === "number" && Math.abs(got - want) <= tol;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${got?.toFixed(3)} (expected ~${want})`);
  if (!ok) bad++;
};
const is = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  got ${got}, want ${want}`}`);
  if (!ok) bad++;
};

// Melittin — GIGAVLKVLTTGLPALISWIKRKRQQ
const melittin = computePeptideProperties("GIGAVLKVLTTGLPALISWIKRKRQQ");
near("melittin MW", melittin?.molecularWeightDa, 2846.5, 1.5);
near("melittin pI", melittin?.isoelectricPoint, 12.0, 0.6);
near("melittin GRAVY", melittin?.gravy, 0.273, 0.005);   // Σ hydropathy 7.1 / 26
near("melittin net charge pH 7.4", melittin?.netChargeAtPh74, 5.0, 0.4);
is("melittin length", melittin?.length, 26);
// W1 + Y0 → 5500
is("melittin extinction (1×W)", melittin?.extinctionCoefficient, 5500);

/* Oxytocin — CYIQNCPLG. The tabulated 1007.19 Da is the natural hormone, which
   is disulfide-bridged and C-amidated; a bare sequence carries neither, so the
   linear free acid at 1010.19 is the correct answer for this input. That gap is
   the modification limitation the module states rather than hides. */
const oxytocin = computePeptideProperties("CYIQNCPLG");
near("oxytocin MW (linear free acid)", oxytocin?.molecularWeightDa, 1010.19, 0.05);
near("oxytocin MW − S-S − amide = hormone", (oxytocin?.molecularWeightDa ?? 0) - 2.016 - 0.985, 1007.19, 0.05);
near("oxytocin GRAVY", oxytocin?.gravy, 0.333, 0.005);   // Σ hydropathy 3.0 / 9
// Y1 → 1490
is("oxytocin extinction (1×Y)", oxytocin?.extinctionCoefficient, 1490);

// Aliphatic index: poly-alanine is 100 by definition of the mole-percent term.
near("poly-A aliphatic index", computePeptideProperties("AAAAAAAAAA")?.aliphaticIndex, 100, 0.01);

// Ambiguity is refused, not guessed.
is("rejects X", validateSequence("GIGAXVLK")?.code, "ambiguous");
is("rejects B", validateSequence("GIGABVLK")?.code, "ambiguous");
is("rejects a non-residue", validateSequence("GIG1VLK")?.code, "invalid");
is("accepts a clean sequence", validateSequence("GIGAVLKVL"), null);
is("lowercase and spaces tolerated", validateSequence(" gig avlk "), null);

console.log(bad ? `\n${bad} FAILING` : "\npeptide descriptors agree with published values");
process.exit(bad ? 1 : 0);
