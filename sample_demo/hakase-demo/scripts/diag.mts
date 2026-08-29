import { parseSmiles, computeDescriptors } from "../src/lib/chem";
import { writeSmiles } from "../src/lib/smilesWrite";
const S = "OC(=O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O";
const a = parseSmiles(S);
const out = writeSmiles(a);
const b = parseSmiles(out);
const key = (m: any) => ({
  atoms: m.atoms.length, bonds: m.bonds.length,
  formula: computeDescriptors(m).molecular_formula,
  arom: m.atoms.filter((x: any) => x.aromatic).length,
  rings: m.rings.map((r: number[]) => r.length).sort().join(","),
  mw: computeDescriptors(m).molecular_weight_da,
});
console.log("in :", JSON.stringify(key(a)));
console.log("out:", JSON.stringify(key(b)));
console.log("smiles:", out);
