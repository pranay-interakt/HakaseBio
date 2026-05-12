/**
 * The 8 Bickerton-Hopkins QED "ALERTS" descriptor SMARTS.
 *
 * From Table S5 of Bickerton et al. 2012 (Nature Chem. 4:90). These are the
 * exact substructure queries the QED paper uses to compute the ALERTS
 * desirability function. Implementations elsewhere (RDKit Contrib) use the
 * same list.
 */

import { getRDKit } from "./rdkit-loader";
import type { RDKitMol } from "./rdkit-loader";

const BICKERTON_SMARTS: ReadonlyArray<readonly [string, string]> = [
  ["[#8][#6](=[#8])[#6]([#6])([#8])[#6][#6]", "α,β-keto-alcohol"],
  ["[#6;X3]=[#8]", "Carbonyl group"],
  ["[#6;X3](=[#8])[F,Cl,Br,I]", "Acyl halide"],
  ["[#6](=[#8])[#6](=[#8])", "1,2-dicarbonyl"],
  ["[#16,#15,#14]", "S/P/Si heteroatom"],
  ["[#7;!$(*=O)]-[#7]", "Hydrazine"],
  ["[#6;!a]-[#6;!a]=[#6;!a]-[#6;!a]=[#6;!a]", "Conjugated polyene"],
  ["[#7+1]", "Quaternary nitrogen"],
];

let compiledCache: RDKitMol[] | null = null;

async function getCompiledAlerts(): Promise<RDKitMol[]> {
  if (compiledCache) return compiledCache;
  const rdkit = await getRDKit();
  compiledCache = BICKERTON_SMARTS.map(([smarts]) => rdkit.get_qmol(smarts));
  return compiledCache;
}

export async function countBickertonAlerts(mol: RDKitMol): Promise<number> {
  const queries = await getCompiledAlerts();
  let n = 0;
  for (const q of queries) {
    try {
      const m = mol.get_substruct_match(q);
      // RDKit returns "{}" if no match, otherwise a JSON object with atoms.
      if (m && m !== "{}" && m !== "") {
        const parsed = JSON.parse(m);
        if (parsed.atoms && parsed.atoms.length > 0) n += 1;
      }
    } catch {
      /* Skip queries that fail to evaluate. */
    }
  }
  return n;
}

export const BICKERTON_ALERT_DESCRIPTIONS = BICKERTON_SMARTS.map(([s, d]) => ({
  smarts: s, description: d,
}));
