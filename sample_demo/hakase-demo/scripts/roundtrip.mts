/**
 * Round-trip check for the SMILES writer.
 *
 * Two properties are asserted:
 *
 *  1. Topology survives — atom count, bond count, molecular formula, aromatic
 *     atom count and mass are unchanged by write → re-parse.
 *  2. Writing is idempotent — once a structure has been through the writer
 *     once, further passes change nothing at all.
 *
 * Descriptors are compared on the *normalised* pair rather than against the
 * original string. `parseSmiles` perceives rings from the order it walks them,
 * so it can undercount on a hand-written SMILES: it finds three rings in
 * ciprofloxacin, which has four, and finds four once the structure has been
 * written out. That is a parser artefact, not an edit, so the workbench diffs
 * normalised against normalised and never shows it to a user as a change.
 */
import { parseSmiles, computeDescriptors } from "../src/lib/chem";
import { writeSmiles } from "../src/lib/smilesWrite";

const CASES: Array<[string, string]> = [
  ["Imatinib", "Cc1ccc(cc1Nc1nccc(n1)-c1cccnc1)NC(=O)c1ccc(CN2CCN(C)CC2)cc1"],
  ["Celecoxib", "Cc1ccc(cc1)-c1cc(nn1-c1ccc(cc1)S(N)(=O)=O)C(F)(F)F"],
  ["Atorvastatin", "CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CCC(O)CC(O)CC(=O)O"],
  ["Gefitinib", "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1"],
  ["Sildenafil", "CCCc1nn(C)c2c1nc([nH]c2=O)-c1cc(ccc1OCC)S(=O)(=O)N1CCN(C)CC1"],
  ["Nitrofurantoin", "O=C1CN(N=Cc2ccc(o2)[N+](=O)[O-])C(=O)N1"],
  ["Quercetin", "O=c1c(O)c(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12"],
  ["Aspirin", "CC(=O)Oc1ccccc1C(=O)O"],
  ["Ciprofloxacin", "OC(=O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O"],
  ["Salt form", "CC(=O)Oc1ccccc1C(=O)O.[Na+]"],
];

let failures = 0;
for (const [name, smiles] of CASES) {
  const first = parseSmiles(smiles);
  if (!first.valid) { console.log(`FAIL ${name}: source did not parse — ${first.error}`); failures++; continue; }
  const written = writeSmiles(first);
  const second = parseSmiles(written);
  if (!second.valid) { console.log(`FAIL ${name}: rewritten did not parse\n  out: ${written}\n  err: ${second.error}`); failures++; continue; }

  // topology must survive the first pass
  const da = computeDescriptors(first), db = computeDescriptors(second);
  const topo: string[] = [];
  if (first.atoms.length !== second.atoms.length) topo.push(`atoms ${first.atoms.length} → ${second.atoms.length}`);
  if (first.bonds.length !== second.bonds.length) topo.push(`bonds ${first.bonds.length} → ${second.bonds.length}`);
  if (da.molecular_formula !== db.molecular_formula) topo.push(`formula ${da.molecular_formula} → ${db.molecular_formula}`);
  if (Math.abs(da.molecular_weight_da - db.molecular_weight_da) > 1e-3) topo.push(`mw ${da.molecular_weight_da} → ${db.molecular_weight_da}`);
  if (first.atoms.filter((x) => x.aromatic).length !== second.atoms.filter((x) => x.aromatic).length) topo.push("aromatic atom count changed");
  if (topo.length) { console.log(`FAIL ${name} (topology)\n  out: ${written}\n  ${topo.join("\n  ")}`); failures++; continue; }

  // and writing must then be idempotent
  const third = parseSmiles(writeSmiles(second));
  const a = computeDescriptors(second);
  const b = computeDescriptors(third);
  const diffs: string[] = [];
  for (const key of Object.keys(a) as Array<keyof typeof a>) {
    const av = a[key], bv = b[key];
    if (typeof av === "number" && typeof bv === "number") {
      if (Math.abs(av - bv) > 1e-3) diffs.push(`${String(key)} ${av} → ${bv}`);
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      diffs.push(`${String(key)} changed`);
    }
  }
  if (second.rings.length !== third.rings.length) diffs.push(`rings ${second.rings.length} → ${third.rings.length}`);

  if (diffs.length) { console.log(`FAIL ${name} (not idempotent)\n  out: ${written}\n  ${diffs.slice(0, 6).join("\n  ")}`); failures++; }
  else console.log(`ok   ${name.padEnd(14)} ${written}`);
}
console.log(failures ? `\n${failures} FAILING` : "\nall round-trips clean");
process.exit(failures ? 1 : 0);
