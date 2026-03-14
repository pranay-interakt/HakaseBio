export interface ApiCompound {
  name: string;
  smiles: string;
  mw: string;
  source: string;
  sourceId: string;
  formula?: string;
  logP?: string;
  hbd?: string;
  hba?: string;
  tpsa?: string;
  qed?: string;
  inchiKey?: string;
  maxPhase?: number;
}

// ── ChEMBL ─────────────────────────────────────────────────────────────────
// https://www.ebi.ac.uk/chembl/api/data/
// No auth required. Rate limit: 1 req/sec. CORS supported.
const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";

async function fetchChEMBL(idOrName: string): Promise<ApiCompound> {
  const isId = /^CHEMBL\d+$/i.test(idOrName.trim());

  let data: Record<string, any>;

  if (isId) {
    const res = await fetch(`${CHEMBL_BASE}/molecule/${idOrName.trim().toUpperCase()}.json`);
    if (!res.ok) throw new Error(`ChEMBL: compound not found (${res.status})`);
    data = await res.json();
  } else {
    // Name-based search
    const res = await fetch(
      `${CHEMBL_BASE}/molecule.json?pref_name__icontains=${encodeURIComponent(idOrName.trim())}&limit=1`,
    );
    if (!res.ok) throw new Error(`ChEMBL search failed (${res.status})`);
    const json = await res.json();
    const molecules = json?.molecules ?? [];
    if (!molecules.length) throw new Error(`ChEMBL: no compound found matching "${idOrName}"`);
    data = molecules[0];
  }

  const smiles: string = data?.molecule_structures?.canonical_smiles ?? "";
  if (!smiles) throw new Error("ChEMBL: compound has no SMILES structure");

  const props = data.molecule_properties ?? {};
  const id: string = data.molecule_chembl_id ?? idOrName.toUpperCase();

  return {
    name: data.pref_name ?? id,
    smiles,
    mw: props.full_mwt ? `${parseFloat(props.full_mwt).toFixed(1)} Da` : "— Da",
    formula: data.molecule_properties?.full_molformula ?? undefined,
    logP: props.alogp ?? undefined,
    hbd: props.hbd ?? undefined,
    hba: props.hba ?? undefined,
    tpsa: props.psa ?? undefined,
    qed: props.qed_weighted ?? undefined,
    inchiKey: data.molecule_structures?.standard_inchi_key ?? undefined,
    maxPhase: data.max_phase ?? undefined,
    source: "ChEMBL",
    sourceId: id,
  };
}

// ── PubChem ─────────────────────────────────────────────────────────────────
// https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/
// No auth required. Rate limit: 5 req/sec. CORS supported. Public domain.
const PC_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
const PC_PROPS =
  "CanonicalSMILES,IsomericSMILES,MolecularWeight,MolecularFormula,XLogP,HBondDonorCount,HBondAcceptorCount,TPSA,InChIKey";

async function fetchPubChem(idOrName: string): Promise<ApiCompound> {
  const trimmed = idOrName.trim();
  const isNumericCID = /^\d+$/.test(trimmed);

  let cid: number;

  if (isNumericCID) {
    cid = parseInt(trimmed, 10);
  } else {
    // Step 1: resolve name → CID
    const cidRes = await fetch(
      `${PC_BASE}/name/${encodeURIComponent(trimmed)}/cids/JSON`,
    );
    if (!cidRes.ok) throw new Error(`PubChem: compound not found for "${trimmed}"`);
    const cidJson = await cidRes.json();
    const cids: number[] = cidJson?.IdentifierList?.CID ?? [];
    if (!cids.length) throw new Error(`PubChem: no CID found for "${trimmed}"`);
    cid = cids[0];
  }

  // Step 2: fetch properties by CID
  const propRes = await fetch(`${PC_BASE}/cid/${cid}/property/${PC_PROPS}/JSON`);
  if (!propRes.ok) throw new Error(`PubChem: failed to fetch properties for CID ${cid}`);
  const propJson = await propRes.json();

  const props = propJson?.PropertyTable?.Properties?.[0];
  if (!props) throw new Error("PubChem: empty property response");

  // Prefer isomeric SMILES (preserves stereochemistry), fall back to canonical
  const smiles: string = props.IsomericSMILES ?? props.CanonicalSMILES ?? "";
  if (!smiles) throw new Error("PubChem: no SMILES in response");

  return {
    name: trimmed && !isNumericCID ? trimmed : `CID ${cid}`,
    smiles,
    mw: props.MolecularWeight != null ? `${parseFloat(props.MolecularWeight).toFixed(1)} Da` : "— Da",
    formula: props.MolecularFormula ?? undefined,
    logP: props.XLogP != null ? String(props.XLogP) : undefined,
    hbd: props.HBondDonorCount != null ? String(props.HBondDonorCount) : undefined,
    hba: props.HBondAcceptorCount != null ? String(props.HBondAcceptorCount) : undefined,
    tpsa: props.TPSA != null ? String(props.TPSA) : undefined,
    inchiKey: props.InChIKey ?? undefined,
    source: "PubChem",
    sourceId: `CID ${cid}`,
  };
}

// ── ZINC ────────────────────────────────────────────────────────────────────
// https://cartblanche22.docking.org/
// No auth required. Fair-use rate limit (~2-3 req/sec). CORS may need proxy.
const ZINC_BASE = "https://cartblanche22.docking.org";

function normaliseZincId(id: string): string {
  const upper = id.toUpperCase();
  if (upper.startsWith("ZINC")) return upper;
  // Pad numeric suffix to 12 digits
  const num = upper.replace(/\D/g, "").padStart(12, "0");
  return `ZINC${num}`;
}

async function fetchZINC(id: string): Promise<ApiCompound> {
  const zincId = normaliseZincId(id.trim());
  const url = `${ZINC_BASE}/substances.json?zinc_id=${zincId}&output_fields=zinc_id,smiles,logp,mw,formula`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ZINC: compound not found (${res.status})`);
  const json = await res.json();

  // Response is an array of result objects
  const items: Record<string, any>[] = Array.isArray(json) ? json : (json?.results ?? []);
  const item = items[0];
  if (!item) throw new Error(`ZINC: no data returned for ${zincId}`);

  const smiles: string = item.smiles ?? "";
  if (!smiles) throw new Error("ZINC: no SMILES in response");

  return {
    name: item.name ?? zincId,
    smiles,
    mw: item.mw != null ? `${parseFloat(item.mw).toFixed(1)} Da` : "— Da",
    formula: item.formula ?? undefined,
    logP: item.logp != null ? String(item.logp) : undefined,
    source: "ZINC",
    sourceId: zincId,
  };
}

// ── UniChem ─────────────────────────────────────────────────────────────────
// UniChem cross-references IDs across 40+ databases but does NOT serve SMILES.
// Strategy: resolve via PubChem cross-reference (src_id=22).
// Input is treated as a ChEMBL ID (src=1) and we find the matching PubChem CID.
const UNICHEM_BASE = "https://www.ebi.ac.uk/unichem/rest";

async function fetchUniChem(idOrName: string): Promise<ApiCompound> {
  const trimmed = idOrName.trim();

  // Normalise to CHEMBL format for the cross-ref lookup
  const chemblId = /^CHEMBL\d+$/i.test(trimmed)
    ? trimmed.toUpperCase()
    : `CHEMBL${trimmed.replace(/\D/g, "")}`;

  const xrefRes = await fetch(`${UNICHEM_BASE}/src_compound_id/${chemblId}/1`);
  if (!xrefRes.ok) throw new Error(`UniChem: could not resolve "${trimmed}" (${xrefRes.status})`);

  const xrefs: Array<{ src_compound_id: string; src_id: string }> = await xrefRes.json();

  // src_id "22" = PubChem Compound
  const pubchemEntry = xrefs.find(x => x.src_id === "22");
  if (!pubchemEntry) throw new Error("UniChem: no PubChem cross-reference found — try ChEMBL or PubChem directly");

  const compound = await fetchPubChem(pubchemEntry.src_compound_id);
  return { ...compound, source: "UniChem → PubChem", sourceId: `${chemblId} → CID ${pubchemEntry.src_compound_id}` };
}

// ── Public dispatcher ────────────────────────────────────────────────────────
export type ApiSource = "chembl" | "pubchem" | "unichem" | "zinc";

export async function fetchCompoundFromApi(
  source: ApiSource,
  id: string,
): Promise<ApiCompound> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Please enter a compound ID or name.");

  switch (source) {
    case "chembl":  return fetchChEMBL(trimmed);
    case "pubchem": return fetchPubChem(trimmed);
    case "unichem": return fetchUniChem(trimmed);
    case "zinc":    return fetchZINC(trimmed);
    default:        throw new Error(`Unknown source: ${source}`);
  }
}
