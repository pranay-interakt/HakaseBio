// ── Shared types ─────────────────────────────────────────────────────────────

export interface ProteinInfo {
  uniprotId: string;
  name: string;
  gene: string;
  organism: string;
  sequenceLength: number;
  activeSites: number;
  bindingSites: number;
  /** Full amino-acid sequence from UniProt (one-letter codes), null when unavailable. */
  sequence: string | null;
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
  // Optional enriched fields populated by `fetchAlphaFoldFull`. Absent on
  // entries fetched via the lightweight `fetchAlphaFold` to avoid the extra
  // PDB download cost when callers only need the scalar pLDDT.
  plddt?: number[];
  analysis?: PlddtAnalysis;
}

/** Per-residue pLDDT-derived structural quality analysis. */
export interface PlddtAnalysis {
  /** Total residues with pLDDT data. */
  length: number;
  /** Mean pLDDT across all residues (0–100). */
  meanPlddt: number;
  /** Median pLDDT (0–100). */
  medianPlddt: number;
  /** Standard deviation of per-residue pLDDT. */
  stdPlddt: number;
  /** Fraction of residues with pLDDT < 50 (likely disordered). */
  disorderedFraction: number;
  /** Fraction of residues with pLDDT ≥ 70 (confident structure). */
  confidentFraction: number;
  /** Contiguous low-confidence runs (pLDDT < 50, length ≥ 10). */
  disorderRegions: PlddtRegion[];
  /** Contiguous well-folded domains (pLDDT ≥ 70, length ≥ 40). */
  foldedDomains: PlddtRegion[];
  /** Largest folded domain — typically the druggable core in big proteins. */
  largestFoldedDomain: PlddtRegion | null;
  /**
   * Overall structural quality classification:
   *   Excellent — mean ≥ 90 (mostly very high confidence)
   *   Good      — mean ≥ 70
   *   Fair      — mean ≥ 50
   *   Poor      — mean < 50 (mostly disordered)
   */
  qualityClass: "Excellent" | "Good" | "Fair" | "Poor";
}

export interface PlddtRegion {
  start: number;     // 1-indexed residue number
  end: number;       // 1-indexed residue number, inclusive
  length: number;    // end - start + 1
  meanPlddt: number; // average within the region
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

  // Sequence
  const sequence: string | null = typeof data?.sequence?.value === "string" ? data.sequence.value : null;
  const sequenceLength: number = data?.sequence?.length ?? (sequence?.length ?? 0);

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
    sequence,
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
    // Prefer the URLs the API returns (versioned to the latest model release).
    // Fallback uses v6, the current major version as of late 2024 / 2025; this
    // path is only hit when the API response omits the field, which is rare.
    pdbUrl: entry.pdbUrl ?? `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v6.pdb`,
    cifUrl: entry.cifUrl ?? `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v6.cif`,
    // The API returns the scalar mean pLDDT as `globalMetricValue`; older
    // clients sometimes saw it under `meanPlddt`. Accept either to be robust.
    meanPlddt: entry.globalMetricValue ?? entry.meanPlddt ?? 0,
    modelCreatedDate: entry.modelCreatedDate ?? "—",
  };
}

// ── AlphaFold per-residue pLDDT ──────────────────────────────────────────────
// AlphaFold encodes per-residue pLDDT in the B-factor column of the PDB file
// it serves (cols 61–66 of ATOM records, 1-indexed). One value per CA atom
// gives a per-residue confidence array. This is the underlying signal that
// `meanPlddt` summarizes — extracting it lets us identify disordered regions
// vs. well-folded druggable domains, which matters most for huge multi-domain
// targets where the druggable core is buried in mostly-disordered context.

/** Fetch the AlphaFold PDB file and extract the per-residue pLDDT array. */
export async function fetchAlphaFoldPlddt(pdbUrl: string): Promise<number[]> {
  const res = await fetch(pdbUrl);
  if (!res.ok) throw new Error(`AlphaFold PDB fetch failed: ${res.status}`);
  const text = await res.text();
  return parsePlddtFromPdb(text);
}

/**
 * Parse per-residue pLDDT from an AlphaFold PDB file. We take the B-factor of
 * each CA atom and keep one value per residue (residues without a CA — rare
 * for AlphaFold output — produce gaps that we skip; downstream analysis treats
 * the returned array as the residues we have data for, so the indices are
 * dense, not sparse).
 *
 * Exported for unit test reuse; callers normally use `fetchAlphaFoldPlddt`.
 */
export function parsePlddtFromPdb(pdbText: string): number[] {
  const plddt: number[] = [];
  const seen = new Set<string>();
  for (const line of pdbText.split("\n")) {
    if (!line.startsWith("ATOM")) continue;
    // PDB ATOM fixed-column layout (1-indexed):
    //   13–16 atom name, 18–20 resName, 22 chainID, 23–26 resSeq, 27 iCode,
    //   61–66 B-factor (= pLDDT for AlphaFold)
    const atomName = line.slice(12, 16).trim();
    if (atomName !== "CA") continue;
    const chain = line.slice(21, 22);
    const resSeq = line.slice(22, 26).trim();
    const iCode = line.slice(26, 27).trim();
    const key = `${chain}|${resSeq}|${iCode}`;
    if (seen.has(key)) continue; // skip alternate locations
    seen.add(key);
    const bFactor = parseFloat(line.slice(60, 66).trim());
    if (!Number.isFinite(bFactor)) continue;
    plddt.push(bFactor);
  }
  return plddt;
}

/**
 * Compute structural-quality summary from a per-residue pLDDT array.
 *
 * Thresholds follow the AlphaFold-DB convention:
 *   pLDDT ≥ 90 → very high confidence (often near-experimental accuracy)
 *   pLDDT ≥ 70 → confident (good backbone, generally reliable)
 *   pLDDT ≥ 50 → low (caution; often flexible or context-dependent)
 *   pLDDT < 50 → very low (frequently disordered or in a non-folded state)
 *
 * Region calls require contiguous runs above/below the threshold to avoid
 * fragmenting on noise: disorder ≥ 10 residues, folded domain ≥ 40 residues.
 */
export function analyzePlddt(plddt: number[]): PlddtAnalysis {
  const n = plddt.length;
  if (n === 0) {
    return {
      length: 0, meanPlddt: 0, medianPlddt: 0, stdPlddt: 0,
      disorderedFraction: 0, confidentFraction: 0,
      disorderRegions: [], foldedDomains: [], largestFoldedDomain: null,
      qualityClass: "Poor",
    };
  }

  const sum = plddt.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sortedAsc = [...plddt].sort((a, b) => a - b);
  const median = n % 2
    ? sortedAsc[(n - 1) >> 1]
    : (sortedAsc[n / 2 - 1] + sortedAsc[n / 2]) / 2;
  const variance = plddt.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const disorderedCount = plddt.filter(v => v < 50).length;
  const confidentCount = plddt.filter(v => v >= 70).length;

  const disorderRegions = findRegions(plddt, v => v < 50, 10);
  const foldedDomains = findRegions(plddt, v => v >= 70, 40);
  const largestFoldedDomain = foldedDomains.length
    ? foldedDomains.reduce((best, r) => (r.length > best.length ? r : best))
    : null;

  let qualityClass: PlddtAnalysis["qualityClass"];
  if (mean >= 90) qualityClass = "Excellent";
  else if (mean >= 70) qualityClass = "Good";
  else if (mean >= 50) qualityClass = "Fair";
  else qualityClass = "Poor";

  return {
    length: n,
    meanPlddt: round1(mean),
    medianPlddt: round1(median),
    stdPlddt: round1(std),
    disorderedFraction: round3(disorderedCount / n),
    confidentFraction: round3(confidentCount / n),
    disorderRegions,
    foldedDomains,
    largestFoldedDomain,
    qualityClass,
  };
}

function findRegions(
  plddt: number[],
  predicate: (v: number) => boolean,
  minLength: number,
): PlddtRegion[] {
  const regions: PlddtRegion[] = [];
  let runStart = -1;
  let runSum = 0;
  for (let i = 0; i < plddt.length; i++) {
    if (predicate(plddt[i])) {
      if (runStart === -1) { runStart = i; runSum = 0; }
      runSum += plddt[i];
    } else if (runStart !== -1) {
      const len = i - runStart;
      if (len >= minLength) {
        regions.push({
          start: runStart + 1,
          end: i,
          length: len,
          meanPlddt: round1(runSum / len),
        });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const len = plddt.length - runStart;
    if (len >= minLength) {
      regions.push({
        start: runStart + 1,
        end: plddt.length,
        length: len,
        meanPlddt: round1(runSum / len),
      });
    }
  }
  return regions;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Convenience: fetch the AlphaFold prediction *and* enrich it with
 * per-residue pLDDT and structural analysis. Falls back gracefully — if the
 * PDB download fails, returns the basic prediction without `plddt`/`analysis`.
 */
export async function fetchAlphaFoldFull(uniprotId: string): Promise<AlphafoldPrediction | null> {
  const base = await fetchAlphaFold(uniprotId);
  if (!base) return null;
  try {
    const plddt = await fetchAlphaFoldPlddt(base.pdbUrl);
    const analysis = analyzePlddt(plddt);
    return { ...base, plddt, analysis };
  } catch {
    // Surface the basic prediction even if the enrichment download fails;
    // the UI continues to work with just `meanPlddt`.
    return base;
  }
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
