// ── BindingDB Integration ──────────────────────────────────────────────────
// Curated experimental binding affinity database (Johns Hopkins)
// REST API: https://www.bindingdb.org/rest/json/
// CORS: blocked from browser — routed through /api/bindingdb proxy

export interface BindingDBLigand {
  name:         string;
  smiles:       string;
  kd_nM:        number | null;
  ki_nM:        number | null;
  ic50_nM:      number | null;
  source:       string;  // journal/assay source
  bindingdbId:  string;
}

export interface BindingDBResult {
  uniprotId:    string;
  targetName:   string;
  ligandCount:  number;
  topLigands:   BindingDBLigand[];
  medianKi_nM:  number | null;
  medianIC50_nM:number | null;
  status:       "live" | "unavailable" | "error";
}

function parseNm(val: string | null | undefined): number | null {
  if (!val || val === "" || val === "N/A") return null;
  const n = parseFloat(val.replace(/[^0-9.eE+-]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  // Convert to nM if needed — BindingDB usually returns nM
  return n;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function fetchBindingDB(uniprotId: string): Promise<BindingDBResult> {
  const base: BindingDBResult = {
    uniprotId, targetName: "", ligandCount: 0,
    topLigands: [], medianKi_nM: null, medianIC50_nM: null, status: "unavailable",
  };
  if (!uniprotId) return base;

  try {
    // Proxy route handles CORS
    const res = await fetch(`/api/bindingdb?uniprot=${encodeURIComponent(uniprotId)}`);
    if (!res.ok) return { ...base, status: "error" };
    const json = await res.json();

    // BindingDB returns { affinities: { affinity: [...] }, ... }
    const affinities: any[] = json?.affinities?.affinity ?? [];
    if (!affinities.length) return { ...base, status: "unavailable" };

    const ligands: BindingDBLigand[] = affinities.slice(0, 20).map((a: any) => ({
      name:        a["Ligand InChI Name"] ?? a["Ligand InChI Key"] ?? "Unknown",
      smiles:      a["Ligand SMILES"] ?? "",
      kd_nM:       parseNm(a["Kd (nM)"]),
      ki_nM:       parseNm(a["Ki (nM)"]),
      ic50_nM:     parseNm(a["IC50 (nM)"]),
      source:      a["Journal"] ?? a["Reference"] ?? "BindingDB",
      bindingdbId: a["BindingDB MonomerID"] ?? a["BindingDB Reactant_set_id"] ?? "",
    }));

    const kiVals   = ligands.map(l => l.ki_nM!).filter(Boolean) as number[];
    const ic50Vals = ligands.map(l => l.ic50_nM!).filter(Boolean) as number[];

    return {
      uniprotId,
      targetName:   affinities[0]?.["UniProt (SwissProt) Primary ID of Target Chain"] ?? "",
      ligandCount:  affinities.length,
      topLigands:   ligands,
      medianKi_nM:  median(kiVals),
      medianIC50_nM:median(ic50Vals),
      status:       "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
