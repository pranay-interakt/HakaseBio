// ── Shared types ─────────────────────────────────────────────────────────────

export interface ProteinInfo {
  uniprotId: string;
  name: string;
  gene: string;
  organism: string;
  sequenceLength: number;
  activeSites: number;
  bindingSites: number;
  pdbIds: string[];           // Experimental PDB cross-refs from UniProt
  alphafoldId: string | null; // AlphaFold DB entry ID (same as UniProt ID when available)
}

export interface PdbStructure {
  pdbId: string;
  title: string;
  method: string;           // X-RAY DIFFRACTION, ELECTRON MICROSCOPY, etc.
  resolution: number | null; // Å, null for cryo-EM/NMR when not reported
  ligands: string[];
  releaseDate: string;
  chains: number;
}

export interface AlphafoldPrediction {
  entryId: string;
  uniprotId: string;
  pdbUrl: string;
  cifUrl: string;
  meanPlddt: number;        // Mean confidence 0–100
  modelCreatedDate: string;
}

// ── UniProt ───────────────────────────────────────────────────────────────────
// https://rest.uniprot.org/uniprotkb/{id}.json
// Free, no auth. Rate limit: generous (10,000 req/sec). CORS enabled.

export async function fetchUniProt(id: string): Promise<ProteinInfo> {
  const res = await fetch(`https://rest.uniprot.org/uniprotkb/${id.toUpperCase()}.json`);
  if (!res.ok) throw new Error(`UniProt: entry not found for "${id}" (${res.status})`);
  const data = await res.json();

  // Protein name
  const name: string =
    data?.proteinDescription?.recommendedName?.fullName?.value ??
    data?.proteinDescription?.submittedName?.[0]?.fullName?.value ??
    id;

  // Gene symbol
  const gene: string = data?.genes?.[0]?.geneName?.value ?? "—";

  // Organism
  const organism: string = data?.organism?.scientificName ?? "—";

  // Sequence length
  const sequenceLength: number = data?.sequence?.length ?? 0;

  // Features — active sites & binding sites
  const features: Array<{ type: string }> = data?.features ?? [];
  const activeSites = features.filter(f => f.type === "Active site").length;
  const bindingSites = features.filter(f => f.type === "Binding site").length;

  // PDB cross-references
  const dbRefs: Array<{ database: string; id: string }> = data?.uniProtKBCrossReferences ?? [];
  const pdbIds = dbRefs
    .filter(r => r.database === "PDB")
    .map(r => r.id)
    .slice(0, 20); // cap at 20 for display

  // AlphaFold cross-reference (same UniProt ID is the AlphaFold entry ID)
  const hasAlphaFold = dbRefs.some(r => r.database === "AlphaFoldDB");

  return {
    uniprotId: id.toUpperCase(),
    name,
    gene,
    organism,
    sequenceLength,
    activeSites,
    bindingSites,
    pdbIds,
    alphafoldId: hasAlphaFold ? id.toUpperCase() : null,
  };
}

// ── RCSB PDB ──────────────────────────────────────────────────────────────────
// https://data.rcsb.org/rest/v1/core/entry/{pdbId}
// Free, no auth, CORS enabled.

export async function fetchPdbStructure(pdbId: string): Promise<PdbStructure> {
  const id = pdbId.toUpperCase();
  const res = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`);
  if (!res.ok) throw new Error(`RCSB PDB: structure not found for "${id}" (${res.status})`);
  const data = await res.json();

  const title: string = data?.struct?.title ?? id;
  const method: string = data?.exptl?.[0]?.method ?? "Unknown";

  // Resolution — prefer rcsb_entry_info, fall back to refine
  const resolution: number | null =
    data?.rcsb_entry_info?.resolution_combined?.[0] ??
    data?.refine?.[0]?.ls_d_res_high ??
    null;

  // Ligands bound to this structure
  const ligandIds: string[] = (data?.rcsb_binding_affinity ?? []).map((b: any) => b.comp_id as string);

  // Also pull from nonpolymer entities
  const entities: any[] = data?.rcsb_entry_info?.nonpolymer_entity_count != null
    ? [] // skip — use separate endpoint if needed
    : [];
  const ligands = ligandIds.length ? ligandIds : entities;

  const releaseDate: string =
    data?.rcsb_accession_info?.initial_release_date?.split("T")[0] ?? "—";

  const chains: number = data?.rcsb_entry_info?.deposited_polymer_entity_instance_count ?? 1;

  return { pdbId: id, title, method, resolution, ligands, releaseDate, chains };
}

// ── AlphaFold DB ──────────────────────────────────────────────────────────────
// https://alphafold.ebi.ac.uk/api/prediction/{uniprotId}
// Free, no auth, CORS enabled. Returns AI-predicted structures when no
// experimental PDB structure exists.

export async function fetchAlphaFold(uniprotId: string): Promise<AlphafoldPrediction | null> {
  const id = uniprotId.toUpperCase();
  const res = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${id}`);
  if (!res.ok) return null; // Not all proteins have AlphaFold entries — return null gracefully
  const data: any[] = await res.json();
  if (!data.length) return null;

  const entry = data[0];
  return {
    entryId: entry.entryId ?? id,
    uniprotId: id,
    pdbUrl: entry.pdbUrl ?? `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v4.pdb`,
    cifUrl: entry.cifUrl ?? `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v4.cif`,
    meanPlddt: entry.meanPlddt ?? 0,
    modelCreatedDate: entry.modelCreatedDate ?? "—",
  };
}

// ── Convenience: resolve best structure for a UniProt ID ─────────────────────
// Returns the first available experimental PDB structure, or null if none.
// Caller can then fall back to fetchAlphaFold.
export async function resolveBestStructure(
  uniprotId: string,
  preferredPdbId?: string,
): Promise<PdbStructure | null> {
  try {
    if (preferredPdbId?.trim()) {
      return await fetchPdbStructure(preferredPdbId.trim());
    }
    // Try first PDB cross-ref from UniProt
    const protein = await fetchUniProt(uniprotId);
    if (protein.pdbIds.length) {
      return await fetchPdbStructure(protein.pdbIds[0]);
    }
    return null;
  } catch {
    return null;
  }
}
