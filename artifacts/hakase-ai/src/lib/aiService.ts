const API_BASE = "/api/ai";

export interface AiAdmetResult {
  smiles: string;
  descriptors: Record<string, number>;
  absorption: {
    caco2_permeability: number;
    caco2_class: string;
    human_intestinal_absorption: number;
    hia_class: string;
    pgp_substrate: boolean;
    oral_bioavailability_score: number;
  };
  distribution: {
    bbb_permeant: boolean;
    bbb_score: number;
    plasma_protein_binding_pct: number;
    volume_of_distribution_L_kg: number;
    cns_penetration: string;
  };
  metabolism: {
    cyp2d6_inhibitor: boolean;
    cyp3a4_inhibitor: boolean;
    cyp2c9_inhibitor: boolean;
    cyp1a2_inhibitor: boolean;
    hepatic_clearance_mL_min_kg: number;
    clearance_class: string;
  };
  excretion: {
    half_life_hours: number;
    half_life_class: string;
  };
  toxicity: {
    ld50_mg_kg: number;
    toxicity_class: string;
    herg_inhibitor: boolean;
    ames_mutagenicity: boolean;
    dili_risk: string;
    max_recommended_daily_dose_mg: number;
  };
  druglikeness: {
    lipinski_violations: number;
    lipinski_pass: boolean;
    veber_pass: boolean;
    qed_estimate: number;
  };
  model_info: {
    engine: string;
    method: string;
    confidence: string;
  };
}

export interface AiPropertiesResult {
  smiles: string;
  physicochemical: Record<string, number | string>;
  solubility: {
    logS_predicted: number;
    solubility_mg_mL: number;
    solubility_class: string;
  };
  bioavailability: {
    oral_bioavailability_pct: number;
    bioavailability_class: string;
    rule_of_five_pass: boolean;
    veber_pass: boolean;
    ghose_pass: boolean;
    egan_pass: boolean;
  };
  ionization: {
    estimated_pka: number | null;
    charge_at_pH_7_4: string;
  };
  complexity: Record<string, number | string>;
  lead_likeness: {
    lead_like: boolean;
    fragment_like: boolean;
    ppi_like: boolean;
  };
  model_info: { engine: string; method: string };
}

export interface AiBindingPrediction {
  target_id: string;
  uniprot: string;
  target_name: string;
  target_class: string;
  binding_probability: number;
  estimated_pIC50: number;
  estimated_IC50_nM: number;
  confidence: string;
  evidence: string[];
}

export interface AiBindingResult {
  smiles: string;
  predictions: AiBindingPrediction[];
  // status differentiates "ChEMBL has no neighbors" (biological signal) from
  // "ChEMBL service unreachable" (infrastructure failure) — UI must NOT
  // conflate these two cases (architect review).
  // Possible values: "found" | "no_targets" | "requested_target_not_found" | "service_unreachable"
  model_info: {
    engine: string;
    method: string;
    targets_screened: number;
    status?: string;
  };
}

export interface AiProteinResult {
  uniprot_id: string;
  protein_name: string;
  gene_name: string;
  organism: string;
  sequence_length: number;
  amino_acid_composition: Record<string, number>;
  secondary_structure_prediction: Record<string, number | string>;
  physicochemical_properties: Record<string, number | string>;
  binding_sites: Array<{ type: string; start: number; end: number; description: string }>;
  active_sites: Array<{ type: string; start: number; end: number; description: string }>;
  alphafold: {
    has_structure: boolean;
    pdb_url: string | null;
    confidence_score: number | null;
    model_version: string | null;
  };
  druggability: {
    druggability_score: number;
    druggability_class: string;
    evidence: string[];
  };
  model_info: { engine: string; method: string; data_sources: string[] };
}

export interface AiFullPipelineResult {
  smiles: string;
  admet: AiAdmetResult;
  molecular_properties: AiPropertiesResult;
  drug_target_interaction: AiBindingResult;
  protein_analysis: AiProteinResult | null;
  pipeline_info: { engine: string; modules_run: string[] };
}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "AI service error");
  }
  return res.json();
}

export async function predictAdmet(smiles: string): Promise<AiAdmetResult> {
  return post<AiAdmetResult>("/admet", { smiles });
}

export async function predictProperties(smiles: string): Promise<AiPropertiesResult> {
  return post<AiPropertiesResult>("/properties", { smiles });
}

export async function predictBinding(smiles: string, targetId?: string): Promise<AiBindingResult> {
  return post<AiBindingResult>("/binding", { smiles, target_id: targetId ?? null });
}

export async function predictProtein(uniprotId: string): Promise<AiProteinResult> {
  return post<AiProteinResult>("/protein", { uniprot_id: uniprotId });
}

export async function runFullPipeline(
  smiles: string,
  uniprotId?: string,
  targetId?: string,
): Promise<AiFullPipelineResult> {
  return post<AiFullPipelineResult>("/full-pipeline", {
    smiles,
    uniprot_id: uniprotId ?? null,
    target_id: targetId ?? null,
  });
}

export async function checkAiHealth(): Promise<{ status: string; service: string; version: string }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

// ---------------------------------------------------------------------------
// ML-Enhanced predictions (ADMET-AI, etc.)
// ---------------------------------------------------------------------------

export interface MlEndpointValue {
  value: number | string | null;
  label: string;
}

export interface MlAdmetStructured {
  absorption: Record<string, MlEndpointValue>;
  distribution: Record<string, MlEndpointValue>;
  metabolism: Record<string, MlEndpointValue>;
  excretion: Record<string, MlEndpointValue>;
  toxicity: Record<string, MlEndpointValue>;
}

export interface MlAdmetResult {
  smiles: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  endpoints: Record<string, number | string | null>;
  structured: MlAdmetStructured;
  model_info: {
    engine: string;
    method: string;
    endpoint_count?: number;
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export interface ModelLoadStatus {
  loaded: boolean;
  load_time_s: number | null;
  error: string | null;
  engine: string;
}

export interface CardiotoxResult {
  smiles: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  prediction: {
    blocker_probability: number | null;
    risk_class: "Low" | "Moderate" | "High" | null;
    ic50_band: string | null;
  };
  model_info: {
    engine: string;
    method: string;
    training?: {
      dataset: string;
      n_train: number;
      n_positives: number;
      n_negatives: number;
      label_threshold: string;
    };
    performance?: {
      cv_roc_auc_mean: number | null;
      cv_roc_auc_std: number | null;
      cv_folds: number;
    };
    features?: {
      morgan_nbits: number;
      morgan_radius: number;
      rdkit_descriptors: string[];
    };
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export interface ProteinMlResult {
  uniprot_id: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  sequence_length?: number;
  prediction: {
    druggability_probability: number | null;
    druggability_class: "Druggable" | "Borderline" | "Likely undruggable" | null;
  };
  model_info: {
    engine: string;
    method: string;
    training?: {
      n_train: number;
      n_positives: number;
      n_negatives: number;
      label_definition: string;
    };
    performance?: {
      cv_roc_auc_mean: number | null;
      cv_roc_auc_std: number | null;
      cv_folds: number;
    };
    features?: {
      esm_model: string;
      embed_dim: number;
      pooling: string;
      max_chunk_residues: number;
      chunk_stride: number;
      chunks_used: number;
    };
    thresholds?: {
      druggable: number;
      borderline: number;
    };
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export interface SolubilityMlResult {
  smiles: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  prediction: {
    logS_predicted: number | null;
    solubility_class:
      | "Highly soluble"
      | "Soluble"
      | "Slightly soluble"
      | "Insoluble"
      | null;
    solubility_mg_mL: number | null;
  };
  model_info: {
    engine: string;
    method: string;
    training?: {
      dataset: string;
      n_train: number;
      logS_min: number;
      logS_max: number;
      logS_mean: number;
    };
    performance?: {
      cv_r2_mean: number | null;
      cv_r2_std: number | null;
      cv_rmse_mean: number | null;
      cv_rmse_std: number | null;
      cv_folds: number;
    };
    features?: {
      morgan_nbits: number;
      morgan_radius: number;
      rdkit_descriptors: string[];
    };
    thresholds?: {
      highly_soluble: number;
      soluble: number;
      slightly_soluble: number;
    };
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export interface BindingMlResult {
  smiles: string;
  uniprot_id: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  prediction: {
    pKd_predicted: number | null;
    Kd_nM: number | null;
    affinity_class:
      | "High affinity"
      | "Moderate affinity"
      | "Weak affinity"
      | "Negligible"
      | null;
  };
  model_info: {
    engine: string;
    method: string;
    training?: {
      dataset: string;
      n_train: number;
      n_unique_targets: number;
      n_unique_drugs: number;
      pkd_min: number;
      pkd_max: number;
      pkd_mean: number;
    };
    performance?: {
      cv_r2_mean: number | null;
      cv_r2_std: number | null;
      cv_rmse_mean: number | null;
      cv_rmse_std: number | null;
      cv_pearson_mean: number | null;
      cv_pearson_std: number | null;
      cv_folds: number;
    };
    features?: {
      morgan_nbits: number;
      morgan_radius: number;
      rdkit_descriptors: string[];
      esm_model: string;
      protein_feature_dim: number;
      feature_dim_total: number;
    };
    thresholds?: {
      high_affinity_pkd: number;
      moderate_pkd: number;
      weak_pkd: number;
    };
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export interface ModelStatusResponse {
  admet_ml: ModelLoadStatus;
  cardiotox: ModelLoadStatus;
  protein_ml?: ModelLoadStatus;
  solubility_ml?: ModelLoadStatus;
  binding_ml?: ModelLoadStatus;
  dili_ml?: ModelLoadStatus;
  celltype_aggregation?: {
    loaded: boolean;
    atlas_path?: string;
    rows?: number;
    loaded_at?: string;
    exists_on_disk?: boolean;
    load_error?: string | null;
    provenance?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// L3 Stage 3 — Cell-type aggregation (Drug2cell + Tabula Sapiens v2)
// ---------------------------------------------------------------------------

export interface CellTypeAggregationTarget {
  gene_symbol: string;
  uniprot_id?: string;
  affinity_pKi?: number;
}

export interface CellTypeAggregationRow {
  cell_type: string;
  tissue: string;
  organ: string;
  score: number;
  mean_expression_unweighted: number;
  n_cells: number;
  pct_expressing_mean: number;
  n_target_genes_present: number;
}

export interface CellTypeAggregationOrganRow {
  organ: string;
  organ_score: number;
  n_cell_types: number;
  top_cell_type: string;
}

export interface CellTypeAggregationPrediction {
  top_cell_types: CellTypeAggregationRow[];
  bottom_cell_types: CellTypeAggregationRow[];
  per_organ: CellTypeAggregationOrganRow[];
  targets_in_domain: string[];
  targets_out_of_domain: string[];
  weights: Array<{ gene_symbol: string; weight: number }>;
  weighting_mode: string;
}

export interface CellTypeAggregationModelInfo {
  engine: string;
  method: string;
  scope_caveat: string;
  atlas: {
    name: string;
    sha?: string;
    preparation_date?: string;
    n_genes?: string;
    n_cell_types?: string;
    n_organs?: string;
    notebook_version?: string;
    loaded_at?: string;
  };
  license: string;
}

/** Discriminated by `source`. Errors and the data-not-provisioned condition are
 *  surfaced explicitly — callers must NOT silently coerce them into a fake "ml" success. */
export type CellTypeAggregationResult =
  | {
      source: "ml";
      ml_available: true;
      prediction: CellTypeAggregationPrediction;
      model_info: CellTypeAggregationModelInfo;
    }
  | {
      source: "data-not-provisioned";
      ml_available: false;
      error: string;
      atlas_path?: string;
      remediation?: string;
    }
  | {
      source: "out-of-domain";
      ml_available: true;
      error: string;
      targets_out_of_domain: string[];
      model_info: { engine: string; atlas: string };
    }
  | {
      source: "input-error";
      ml_available: false;
      error: string;
    };

export async function predictCellTypeAggregation(
  targets: CellTypeAggregationTarget[],
  topN: number = 25,
): Promise<CellTypeAggregationResult> {
  const res = await fetch(`${API_BASE}/celltype-aggregation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets, top_n: topN }),
  });
  // 503 carries the data-not-provisioned envelope inside `detail` (FastAPI HTTPException shape).
  // 400 carries input-error. Surface them as the typed result, not as thrown errors,
  // so the UI can render the explicit remediation copy instead of a generic toast.
  if (res.status === 503 || res.status === 400) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? body;
    if (detail && typeof detail === "object" && "source" in detail) {
      return detail as CellTypeAggregationResult;
    }
    return {
      source: res.status === 503 ? "data-not-provisioned" : "input-error",
      ml_available: false,
      error: typeof detail === "string" ? detail : "Cell-type aggregation unavailable.",
    };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "Cell-type aggregation failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// L3 Stage 4 — Patient-line projection (DepMap PRISM 24Q2, oncology only)
// ---------------------------------------------------------------------------

export interface PatientLineCellLine {
  depmap_id: string;
  cell_line_name: string;
  primary_disease: string;
  lineage: string;
  essentiality_chronos: number;
  expression_log2_tpm: number;
  modifier: number | null;
  predicted_IC50_uM: number | null;
  category: "highly_sensitive" | "sensitive" | "near_baseline" | "resistant" | "resistant_no_target";
}

export interface PatientLineDistribution {
  n: number;
  median_uM: number | null;
  p10_uM: number | null;
  p90_uM: number | null;
  min_uM: number | null;
  max_uM: number | null;
}

export interface PatientLineLineageRollup {
  lineage: string;
  n_cell_lines: number;
  median_predicted_IC50_uM: number;
  n_highly_sensitive: number;
  n_sensitive: number;
  n_near_baseline: number;
  n_resistant: number;
}

export interface PatientLinePrediction {
  query_gene_symbol: string;
  l1_ic50_nM: number;
  alpha: number;
  indication_keyword: string | null;
  n_cell_lines_total: number;
  n_resistant_no_target: number;
  distribution: PatientLineDistribution;
  top_sensitive_lines: PatientLineCellLine[];
  bottom_resistant_lines: PatientLineCellLine[];
  per_lineage: PatientLineLineageRollup[];
}

export interface PatientLineModelInfo {
  engine: string;
  method: string;
  scope_caveat: string;
  snapshot: {
    name: string;
    release?: string;
    preparation_date?: string;
    n_cell_lines?: string;
    n_target_genes?: string;
    n_oncology_lineages?: string;
    notebook_version?: string;
    loaded_at?: string;
  };
  license: string;
}

export type PatientLineResult =
  | {
      source: "ml";
      ml_available: true;
      prediction: PatientLinePrediction;
      model_info: PatientLineModelInfo;
    }
  | {
      source: "data-not-provisioned";
      ml_available: false;
      error: string;
      snapshot_path?: string;
      remediation?: string;
    }
  | {
      source: "out-of-domain";
      ml_available: boolean;
      error: string;
      targets_out_of_domain?: string[];
      model_info?: { engine: string; snapshot: string };
    }
  | {
      source: "input-error";
      ml_available: false;
      error: string;
    };

export interface PatientLineRequestOptions {
  indicationKeyword?: string;
  alpha?: number;
  topN?: number;
}

export async function predictPatientLine(
  targetGeneSymbol: string,
  l1Ic50_nM: number,
  oncology: boolean,
  opts: PatientLineRequestOptions = {},
): Promise<PatientLineResult> {
  const res = await fetch(`${API_BASE}/patient-line`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_gene_symbol: targetGeneSymbol,
      l1_ic50_nM: l1Ic50_nM,
      oncology,
      indication_keyword: opts.indicationKeyword ?? null,
      alpha: opts.alpha ?? 1.0,
      top_n: opts.topN ?? 25,
    }),
  });
  // 503 → data-not-provisioned envelope; 400 → out-of-domain or input-error envelope.
  if (res.status === 503 || res.status === 400) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? body;
    if (detail && typeof detail === "object" && "source" in detail) {
      return detail as PatientLineResult;
    }
    return {
      source: res.status === 503 ? "data-not-provisioned" : "input-error",
      ml_available: false,
      error: typeof detail === "string" ? detail : "Patient-line projection unavailable.",
    };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "Patient-line projection failed");
  }
  return res.json();
}

export interface DiliMlResult {
  smiles: string;
  source: "ml" | "fallback";
  ml_available: boolean;
  error?: string;
  prediction: {
    dili_probability: number | null;
    risk_class: "Low" | "Moderate" | "High" | null;
    severity_hint:
      | "none-or-mild"
      | "moderate"
      | "severe"
      | "most-concern"
      | null;
  };
  model_info: {
    engine: string;
    method?: string;
    scope_caveat?: string;
    training?: {
      dataset: string;
      n_train: number;
      n_positives: number;
      n_negatives: number;
      label_definition: string;
    };
    performance?: {
      cv_roc_auc_mean: number | null;
      cv_roc_auc_std: number | null;
      cv_folds: number;
    };
    features?: {
      morgan_nbits: number;
      morgan_radius: number;
      rdkit_descriptors: string[];
    };
    inference_time_ms?: number;
    license?: string;
    reference?: string;
    load_status?: ModelLoadStatus;
  };
}

export async function predictAdmetMl(smiles: string): Promise<MlAdmetResult> {
  return post<MlAdmetResult>("/admet-ml", { smiles });
}

export async function predictDiliMl(smiles: string): Promise<DiliMlResult> {
  return post<DiliMlResult>("/dili-ml", { smiles });
}

export async function predictCardiotox(smiles: string): Promise<CardiotoxResult> {
  return post<CardiotoxResult>("/cardiotox", { smiles });
}

export async function predictProteinMl(uniprotId: string): Promise<ProteinMlResult> {
  return post<ProteinMlResult>("/protein-ml", { uniprot_id: uniprotId });
}

export async function predictSolubilityMl(smiles: string): Promise<SolubilityMlResult> {
  return post<SolubilityMlResult>("/solubility-ml", { smiles });
}

export async function predictBindingMl(
  smiles: string,
  uniprotId: string,
): Promise<BindingMlResult> {
  return post<BindingMlResult>("/binding-ml", {
    smiles,
    uniprot_id: uniprotId,
  });
}

// ---------------------------------------------------------------------------
// L2 Stage 2 — AutoDock Vina docking (async job)
// ---------------------------------------------------------------------------

export interface DockPose {
  mode: number;
  affinity_kcal_mol: number;
  rmsd_lb: number;
  rmsd_ub: number;
}

export interface DockBox {
  center: [number, number, number];
  size:   [number, number, number];
  /** "co_crystal" — centered on a co-crystallized HETATM ligand.
   *  "blind_dock" — whole-receptor box (last-resort fallback). */
  method: "co_crystal" | "blind_dock";
  /** Residue label like "XK2 A 263" when method = co_crystal; null for blind dock. */
  source_residue: string | null;
}

export interface DockHetatmCandidate {
  label: string;
  resname: string;
  chain: string;
  resi: number;
  atom_count: number;
  center: [number, number, number];
  size:   [number, number, number];
}

export interface DockResult {
  poses: DockPose[];
  box: DockBox;
  pdb_id: string;
  co_crystal_ligands: DockHetatmCandidate[];
  chosen_box_ligand: string | null;
  receptor_atom_count: number;
  ligand_atom_count: number;
  runtime_seconds: number;
  vina_version: string;
  warnings: string[];
}

export interface DockJobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  smiles: string;
  pdb_id: string;
  progress: string;
  started_at: number;
  finished_at: number;
  error: string | null;
  result: DockResult | null;
}

export async function startDocking(
  smiles: string,
  pdbId: string,
  opts: { exhaustiveness?: number; numModes?: number } = {},
): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/dock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      smiles,
      pdb_id: pdbId,
      exhaustiveness: opts.exhaustiveness ?? 8,
      num_modes: opts.numModes ?? 5,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "Docking submission failed");
  }
  return res.json();
}

export async function getDockStatus(jobId: string): Promise<DockJobStatus> {
  const res = await fetch(`${API_BASE}/dock/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "Docking status fetch failed");
  }
  return res.json();
}

/** Submit a docking job, then poll until done | failed | timeout. Resolves with
 *  the final terminal status (caller checks .status to differentiate done/failed).
 *  No silent fallback: a timeout produces a failed status with a specific error. */
export async function runDockingToCompletion(
  smiles: string,
  pdbId: string,
  opts: {
    exhaustiveness?: number;
    numModes?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    onProgress?: (status: DockJobStatus) => void;
  } = {},
): Promise<DockJobStatus> {
  const { job_id } = await startDocking(smiles, pdbId, opts);
  const interval = opts.pollIntervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 600_000;  // 10 min hard cap
  const deadline = Date.now() + timeout;
  // Initial sleep so the worker thread has a chance to enter "running"
  await new Promise(r => setTimeout(r, 500));
  while (Date.now() < deadline) {
    const s = await getDockStatus(job_id);
    opts.onProgress?.(s);
    if (s.status === "done" || s.status === "failed") return s;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Docking job ${job_id} exceeded ${timeout / 1000}s timeout`);
}

// ---------------------------------------------------------------------------
// L2 Stage 5 — TIES relative-binding FEP via RunPod Serverless (async, ~24 GPU-h)
// ---------------------------------------------------------------------------

export interface FepWindow {
  lambda: number;
  dG_kcal_mol: number;
  stderr_kcal_mol: number;
}

export interface FepResult {
  /** Relative binding free energy ΔΔG = ΔG_bind(B) − ΔG_bind(A), in kcal/mol. */
  ddg_kcal_mol: number;
  /** 1-σ uncertainty on ΔΔG, in kcal/mol (forward/backward bootstrap or BAR). */
  ddg_uncertainty_kcalmol: number;
  /** Same ΔΔG expressed in units of k_B T at 298 K — for occupancy ratio math. */
  ddg_kT: number;
  /** Per-lambda-window ΔG accumulation (TI integral or BAR per window). */
  windows: FepWindow[];
  wallclock_minutes: number;
  gpu_minutes: number;
  /** Worker-reported toolchain string, e.g. "OpenMM 8.1.1 + OpenFF Sage 2.2.0 + TIES-MD 1.7". */
  engine_version: string;
  /** Worker-reported FF tag, e.g. "openff-2.2.0". */
  force_field: string;
  warnings: string[];
  runpod_job_id: string;
}

export interface FepJobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  ligand_a_smiles: string;
  ligand_b_smiles: string;
  pdb_id: string;
  progress: string;
  started_at: number;
  finished_at: number;
  runpod_job_id: string | null;
  error: string | null;
  result: FepResult | null;
}

export interface FepConfigStatus {
  configured: boolean;
  reason: string | null;
}

export async function getFepConfig(): Promise<FepConfigStatus> {
  const res = await fetch(`${API_BASE}/fep/config`);
  if (!res.ok) {
    return { configured: false, reason: `Could not reach FEP config endpoint (HTTP ${res.status})` };
  }
  return res.json();
}

export async function startFep(
  ligandASmiles: string,
  ligandBSmiles: string,
  pdbId: string,
  opts: { nLambdaWindows?: number; nReplicas?: number; nsPerWindow?: number } = {},
): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/fep`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ligand_a_smiles:  ligandASmiles,
      ligand_b_smiles:  ligandBSmiles,
      pdb_id:           pdbId,
      n_lambda_windows: opts.nLambdaWindows ?? 12,
      n_replicas:       opts.nReplicas      ?? 3,
      ns_per_window:    opts.nsPerWindow    ?? 5.0,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "FEP submission failed");
  }
  return res.json();
}

export async function getFepStatus(jobId: string): Promise<FepJobStatus> {
  const res = await fetch(`${API_BASE}/fep/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI service error" }));
    throw new Error(err.detail ?? err.error ?? "FEP status fetch failed");
  }
  return res.json();
}

/** Submit a FEP job and poll until done | failed | timeout. Default 36 h hard cap
 *  matches the worker side. No silent fallback: timeout produces an explicit error. */
export async function runFepToCompletion(
  ligandASmiles: string,
  ligandBSmiles: string,
  pdbId: string,
  opts: {
    nLambdaWindows?: number;
    nReplicas?: number;
    nsPerWindow?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    onProgress?: (status: FepJobStatus) => void;
  } = {},
): Promise<FepJobStatus> {
  const { job_id } = await startFep(ligandASmiles, ligandBSmiles, pdbId, opts);
  const interval = opts.pollIntervalMs ?? 30_000;       // 30 s — match worker poll cadence
  const timeout  = opts.timeoutMs      ?? 36 * 3600_000; // 36 h hard cap
  const deadline = Date.now() + timeout;
  await new Promise(r => setTimeout(r, 1_000));
  while (Date.now() < deadline) {
    const s = await getFepStatus(job_id);
    opts.onProgress?.(s);
    if (s.status === "done" || s.status === "failed") return s;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`FEP job ${job_id} exceeded ${(timeout / 3600_000).toFixed(1)} h timeout`);
}

export async function getModelStatus(): Promise<ModelStatusResponse> {
  const res = await fetch(`${API_BASE}/models/status`);
  if (!res.ok) throw new Error("Failed to fetch model status");
  return res.json();
}

export async function warmupModels(): Promise<ModelStatusResponse> {
  const res = await fetch(`${API_BASE}/models/warmup`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to warm up models");
  return res.json();
}

/** UI helper: returns the badge state for a given source value. */
export function mlBadgeFromSource(source: "ml" | "fallback" | string): {
  label: string;
  tone: "ml" | "heuristic" | "browser";
} {
  if (source === "ml") return { label: "ML-Enhanced", tone: "ml" };
  if (source === "fallback") return { label: "Heuristic Only", tone: "heuristic" };
  return { label: "Browser-Only", tone: "browser" };
}

// ---------------------------------------------------------------------------
// L2 Stage 2b — Biologics Co-Folding (Boltz-2, AlphaFold3-class structure + affinity)
//
// Boltz-2 is an open, MIT-licensed AlphaFold3-class biomolecular foundation
// model. It co-folds an arbitrary complex — proteins, peptides, DNA, RNA,
// small-molecule ligands, ions, modified residues, covalent bonds — and
// predicts a binding affinity for ligand binders. This extends the platform
// beyond small-molecule-only scope to peptide / antibody / nucleic-acid work.
//
// AlphaFold 3's own weights are non-commercial-only and are intentionally NOT
// a backend here. See artifacts/ai-service/models/cofolding.py for rationale.
// ---------------------------------------------------------------------------

export type CoFoldEntityType = "protein" | "peptide" | "dna" | "rna" | "ligand" | "ion";

export interface CoFoldModification {
  position: number;
  ccd: string;
}

export interface CoFoldEntityInput {
  type: CoFoldEntityType;
  id: string;
  sequence?: string;
  smiles?: string;
  ccd?: string;
  copies?: number;
  use_msa?: boolean;
  cyclic?: boolean;
  modifications?: CoFoldModification[];
}

export interface CoFoldAtomRef {
  chain: string;
  residue: number;
  atom: string;
}

export interface CoFoldBond {
  atom1: CoFoldAtomRef;
  atom2: CoFoldAtomRef;
}

export interface CoFoldContact {
  chain: string;
  residue: number;
}

export interface CoFoldPocket {
  binder: string;
  contacts: CoFoldContact[];
  max_distance?: number;
}

export interface CoFoldOptions {
  diffusion_samples?: number;
  recycling_steps?: number;
  sampling_steps?: number;
  use_msa_server?: boolean;
  use_potentials?: boolean;
  no_kernels?: boolean;
  affinity_mw_correction?: boolean;
  output_format?: "mmcif" | "pdb";
}

export interface CoFoldRequest {
  name?: string;
  entities: CoFoldEntityInput[];
  bonds?: CoFoldBond[];
  pocket?: CoFoldPocket | null;
  affinity_binder?: string | null;
  options?: CoFoldOptions;
}

export interface CoFoldSummary {
  n_entities: number;
  n_chains: number;
  entity_breakdown: Record<string, number>;
  estimated_tokens: number;
  affinity_requested: boolean;
  uses_msa_server: boolean;
  has_covalent_bonds: boolean;
  has_pocket_conditioning: boolean;
  estimated_runtime_minutes: number;
  estimated_cost_usd_range: [number, number];
  estimate_caveat: string;
}

export interface CoFoldValidateResult {
  valid: boolean;
  boltz_yaml: string;
  uses_msa_server: boolean;
  summary: CoFoldSummary;
  engine: string;
}

/** Per-residue + interface confidence, exactly as Boltz reports it (no estimates). */
export interface CoFoldConfidence {
  confidence_score: number | null;
  ptm: number | null;
  iptm: number | null;
  ligand_iptm: number | null;
  protein_iptm: number | null;
  complex_plddt: number | null;
  complex_iplddt: number | null;
  complex_pde: number | null;
  complex_ipde: number | null;
  chains_ptm: Record<string, number> | null;
  pair_chains_iptm: Record<string, Record<string, number>> | null;
  raw?: Record<string, unknown>;
}

/** Boltz-2 binding-affinity head. affinity_pred_value is log10(IC50 / µM). */
export interface CoFoldAffinity {
  affinity_pred_value: number | null;
  affinity_probability_binary: number | null;
  affinity_pred_value1: number | null;
  affinity_probability_binary1: number | null;
  affinity_pred_value2: number | null;
  affinity_probability_binary2: number | null;
  ic50_uM: number | null;
  binding_dg_kcal_mol: number | null;
  units_note: string;
  raw?: Record<string, unknown>;
}

export interface CoFoldModel {
  rank: number;
  structure: string;
  structure_format: "mmcif" | "pdb";
  confidence: CoFoldConfidence;
  per_residue_plddt: number[] | null;
}

export interface CoFoldResult {
  structure: string;
  structure_format: "mmcif" | "pdb";
  confidence: CoFoldConfidence;
  per_residue_plddt: number[] | null;
  pae_matrix: number[][] | null;
  affinity: CoFoldAffinity | null;
  models: CoFoldModel[];
  n_models: number;
  n_chains: number;
  n_residues_modeled: number;
  engine: string;
  boltz_version: string;
  gpu_name: string;
  msa_source: string;
  wallclock_seconds: number;
  warnings: string[];
  runpod_job_id: string;
  boltz_yaml: string;
}

export interface CoFoldJobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  name: string;
  progress: string;
  started_at: number;
  finished_at: number;
  summary: CoFoldSummary | null;
  runpod_job_id: string | null;
  error: string | null;
  result: CoFoldResult | null;
}

export interface CoFoldConfigStatus {
  configured: boolean;
  reason: string | null;
  engine: string;
  engine_label: string;
}

/** GPU-backend availability. Never throws — a failure resolves to not-configured. */
export async function getCofoldConfig(): Promise<CoFoldConfigStatus> {
  try {
    const res = await fetch(`${API_BASE}/cofold/config`);
    if (!res.ok) {
      return {
        configured: false,
        reason: `Could not reach the co-folding config endpoint (HTTP ${res.status})`,
        engine: "boltz2",
        engine_label: "Boltz-2 (AlphaFold3-class co-folding)",
      };
    }
    return res.json();
  } catch {
    return {
      configured: false,
      reason: "AI service unreachable",
      engine: "boltz2",
      engine_label: "Boltz-2 (AlphaFold3-class co-folding)",
    };
  }
}

/** GPU-free: validate a design and return the generated Boltz YAML + summary.
 *  Throws with the exact validation message (HTTP 400) on a bad design. */
export async function validateCofold(req: CoFoldRequest): Promise<CoFoldValidateResult> {
  const res = await fetch(`${API_BASE}/cofold/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Validation failed" }));
    throw new Error(err.detail ?? err.error ?? "Co-folding validation failed");
  }
  return res.json();
}

/** Submit a co-folding job. Throws the exact backend message on a bad design
 *  (400) or an unconfigured GPU backend (503) — no silent fallback. */
export async function startCofold(
  req: CoFoldRequest,
): Promise<{ job_id: string; status: string; summary: CoFoldSummary }> {
  const res = await fetch(`${API_BASE}/cofold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Submission failed" }));
    throw new Error(err.detail ?? err.error ?? "Co-folding submission failed");
  }
  return res.json();
}

export async function getCofoldStatus(jobId: string): Promise<CoFoldJobStatus> {
  const res = await fetch(`${API_BASE}/cofold/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Status fetch failed" }));
    throw new Error(err.detail ?? err.error ?? "Co-folding status fetch failed");
  }
  return res.json();
}

/** Submit a co-folding job and poll until done | failed | timeout.
 *  No silent fallback: a timeout produces an explicit error. */
export async function runCofoldToCompletion(
  req: CoFoldRequest,
  opts: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    onProgress?: (status: CoFoldJobStatus) => void;
  } = {},
): Promise<CoFoldJobStatus> {
  const { job_id } = await startCofold(req);
  const interval = opts.pollIntervalMs ?? 8000;
  const timeout = opts.timeoutMs ?? 2 * 3600_000; // 2 h hard cap (matches worker)
  const deadline = Date.now() + timeout;
  await new Promise((r) => setTimeout(r, 1000));
  while (Date.now() < deadline) {
    const s = await getCofoldStatus(job_id);
    opts.onProgress?.(s);
    if (s.status === "done" || s.status === "failed") return s;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Co-folding job ${job_id} exceeded ${(timeout / 3600_000).toFixed(1)} h timeout`);
}

// ---------------------------------------------------------------------------
// L1 Peptide — native peptide property engine (no GPU; pure Python analytics)
//
// Calls POST /ai/peptide → predict_peptide_properties()
// All results are computed from published formulae:
//   MW: monoisotopic residue masses
//   Charge / pI: Henderson-Hasselbalch + binary search
//   GRAVY: Kyte-Doolittle hydrophobicity scale
//   Instability: Guruprasad dipeptide weight table
//   Aliphatic: Ikai index (Val, Ile, Leu, Ala fractions)
//   Boman: protein-lipid interaction index
//   Hydrophobic moment: Eisenberg 100° rotation
//   Secondary structure: Chou-Fasman helix/sheet propensities
//   Proteolytic stability: regex rules for 9 common proteases
//   Membrane permeability: CPP heuristic + cyclic bonus
//   AMP: 7-factor antimicrobial peptide score
//   Half-life: plasma / GI / renal empirical estimates
//   Developability: oral, parenteral, PEGylation, aggregation risk
// ---------------------------------------------------------------------------

export interface PeptidePhysicochemical {
  sequence_length: number;
  molecular_weight_da: number;
  net_charge_pH7: number;
  isoelectric_point: number;
  gravy: number;
  instability_index: number;
  aliphatic_index: number;
  boman_index: number;
  aromaticity: number;
  hydrophobic_moment: number;
  instability_class: "Stable" | "Unstable";
  charge_class: "Anionic" | "Cationic" | "Neutral";
  /** Pace et al. 1995: ε₂₈₀ = (nW×5500)+(nY×1490)+(nSS×125), M⁻¹cm⁻¹ */
  extinction_280_oxidised: number;
  extinction_280_reduced: number;
  n_disulfide_pairs: number;
}

export interface PeptideSecondaryStructure {
  helix_fraction: number;
  beta_sheet_fraction: number;
  coil_fraction: number;
  dominant_class: string;
}

export interface PeptideProteaseSite {
  protease: string;
  sites: number[];
  n_sites: number;
}

export interface PeptideProteolytic {
  sites: PeptideProteaseSite[];
  most_labile_protease: string | null;
  most_labile_n_sites: number;
}

export interface PeptidePermeability {
  membrane_permeability_score: number;
  permeability_class: string;
  cyclic_bonus_applied: boolean;
  cpp_signal_detected: boolean;
  notes: string[];
}

export interface PeptideAmpScore {
  score: number;
  max_score: number;
  amp_class: string;
  contributing_factors: string[];
}

export interface PeptideHalfLife {
  plasma_h: string;
  gi_h: string;
  renal_h: string;
  dominant_route: string;
}

export interface PeptideDevelopability {
  recommended_route: string;
  oral_potential: boolean;
  oral_blockers: string[];
  pegylation_recommended: boolean;
  lipidation_recommended: boolean;
  aggregation_risk: string;
  notes: string[];
}

export type ModificationImpact = "high" | "moderate" | "low";

export interface ModificationSuggestion {
  type: string;
  position: number;
  original_residue: string;
  suggested_modification: string;
  rationale: string;
  expected_impact: ModificationImpact;
  reference?: string;
}

export interface PeptideModificationAdvice {
  suggestions: ModificationSuggestion[];
  total_suggestions: number;
  priority_type: string | null;
  priority_position: number | null;
}

/** A single chemical-degradation liability hit. */
export interface PeptideChemicalLiability {
  type: string;
  motif: string;
  position: number;
  severity: "high" | "moderate" | "low";
  note: string;
}

export interface PeptideChemicalLiabilities {
  liabilities: PeptideChemicalLiability[];
  n_high: number;
  n_moderate: number;
  n_total: number;
  risk: "High" | "Moderate" | "Low";
  /** "rule-based" | "heuristic" | "calculated" | "unavailable" */
  provenance: string;
}

export interface PeptideSolubility {
  solubility_score: number;
  solubility_class: "High" | "Moderate" | "Low" | "Very low";
  drivers: string[];
  note: string;
  provenance: string;
}

/** One AGGRESCAN aggregation hot spot. */
export interface PeptideAggRegion {
  start: number;
  end: number;
  sequence: string;
  /** Peak of the smoothed a4v aggregation profile across the hot spot. */
  peak_a4v: number;
  /** Area of the profile above the hot-spot threshold. */
  area: number;
}

export interface PeptideAggregation {
  risk: "High" | "Moderate" | "Low";
  n_regions: number;
  regions: PeptideAggRegion[];
  mean_a3v: number;
  hotspot_area: number;
  method: string;
  provenance: string;
}

export interface PeptideImmunogenicity {
  candidate_epitope_windows: number;
  band: "Elevated" | "Moderate" | "Low";
  method: string;
  caveat: string;
  provenance: string;
}

export interface PeptideSynthesis {
  difficulty_class: "Routine" | "Moderate" | "Difficult" | "Very difficult";
  difficulty_score: number;
  factors: string[];
  note: string;
  provenance: string;
}

export interface PeptideResult {
  sequence: string;
  cyclic: boolean;
  physicochemical: PeptidePhysicochemical;
  secondary_structure: PeptideSecondaryStructure;
  proteolytic_stability: PeptideProteolytic;
  membrane_permeability: PeptidePermeability;
  amp_score: PeptideAmpScore;
  half_life: PeptideHalfLife;
  developability: PeptideDevelopability;
  modification_advice: PeptideModificationAdvice;
  /** Expanded Layer-1 readouts (May 2026). */
  chemical_liabilities: PeptideChemicalLiabilities;
  solubility: PeptideSolubility;
  aggregation: PeptideAggregation;
  immunogenicity: PeptideImmunogenicity;
  synthesis: PeptideSynthesis;
  engine: string;
}

/** Analyze a peptide sequence — returns physicochemical, stability, permeability,
 *  AMP score, half-life, and developability predictions.
 *  No GPU required. Fails with a descriptive error on invalid sequences. */
export async function predictPeptide(
  sequence: string,
  cyclic: boolean = false,
): Promise<PeptideResult> {
  return post<PeptideResult>("/peptide", {
    sequence: sequence.trim().toUpperCase(),
    cyclic,
  });
}

// ---------------------------------------------------------------------------
// L1 Antibody — native antibody developability engine (no GPU; pure Python)
//
// Calls POST /ai/antibody → predict_antibody_properties()
// All results are computed from published, citable rules:
//   Chain-type / format    : length + Gly-Ser linker + FGxG/WGxG motifs
//   CDR localisation       : CDR-H3/L3 anchored on Cys...WGxG / Cys...FGxG;
//                            CDR-H1/H2/L1/L2 framework-estimated (approximate)
//   Liability scan         : N-glycosylation sequons, deamidation (NG/NS/...),
//                            isomerisation (DG/DS/...), DP hydrolysis,
//                            Met/Trp oxidation, unpaired cysteine, RGD
//   Developability         : Therapeutic-Antibody-Profiler-style flags
//   Aggregation            : sliding hydrophobic-window APR scan
//   Immunogenicity         : coarse MHC-II agretope screen (humanness = null,
//                            never fabricated — needs a germline reference set)
// ---------------------------------------------------------------------------

export interface AntibodyArchitecture {
  chain_type: string;
  confidence: string;
  note: string;
}

export interface AntibodyPhysicochemical {
  molecular_weight_da: number;
  isoelectric_point: number;
  net_charge_pH7: number;
  gravy: number;
  aromaticity: number;
  aliphatic_index: number;
  instability_index: number;
  instability_class: "Stable" | "Unstable";
  extinction_280_oxidised: number;
  n_disulfide_pairs: number;
  cysteine_count: number;
}

export interface AntibodyCDR {
  name: string;
  sequence: string;
  start: number | null;
  end: number | null;
  length: number;
  /** "imgt_anarci" = exact ANARCI/IMGT numbering; others = heuristic. */
  confidence: "imgt_anarci" | "anchored" | "approximate" | "not_found";
}

export interface AntibodyLiability {
  type: string;
  chain: string;
  motif: string;
  position: number;
  location: string;
  severity: "high" | "moderate" | "low";
  note: string;
}

export interface AntibodyDevFlag {
  metric: string;
  value: string;
  level: "green" | "amber" | "red";
  note: string;
}

export interface AntibodyDevelopability {
  tier: string;
  total_cdr_length: number;
  flags: AntibodyDevFlag[];
}

/** One AGGRESCAN aggregation hot spot. */
export interface AntibodyAggRegion {
  start: number;
  end: number;
  sequence: string;
  /** Peak of the smoothed a4v aggregation profile across the hot spot. */
  peak_a4v: number;
  /** Area of the profile above the hot-spot threshold. */
  area: number;
  /** CDR name if the hot spot overlaps a CDR, else "framework". */
  location: string;
}

export interface AntibodyAggregation {
  risk: string;
  n_regions: number;
  /** Hot spots overlapping any CDR (some CDR boundaries are only approximate). */
  cdr_hotspots: number;
  /** Hot spots overlapping an anchored CDR-H3/L3 — what the risk verdict uses. */
  anchored_cdr_hotspots: number;
  regions: AntibodyAggRegion[];
  mean_a3v: number;
  hotspot_area: number;
  method: string;
  note: string;
  provenance: string;
}

export interface AntibodyImmunogenicity {
  candidate_agretope_windows: number;
  band: string;
  method: string;
  /** null by design — a calibrated humanness score is never fabricated. */
  humanness: number | null;
  caveat: string;
}

export interface AntibodyChain {
  label: string;
  length: number;
  architecture: AntibodyArchitecture;
  physicochemical: AntibodyPhysicochemical;
  cdrs: AntibodyCDR[];
  liabilities: AntibodyLiability[];
  developability: AntibodyDevelopability;
  aggregation: AntibodyAggregation;
  immunogenicity: AntibodyImmunogenicity;
}

export interface AntibodySummary {
  verdict: string;
  developability_tier: string;
  /** Transparent tally of the real TAP-style flags — not a tuned score. */
  developability_flags: { red: number; amber: number; green: number };
  aggregation_risk: string;
  stability_outlook: string;
  expression_outlook: string;
  n_liabilities_high: number;
  n_liabilities_moderate: number;
  n_liabilities_total: number;
}

/** One sequence-level conformational-stability signal. */
export interface AntibodyStabilitySignal {
  chain: string;
  signal: string;
  value: string;
  level: "ok" | "watch" | "concern";
  detail: string;
}

/** Honest sequence-level conformational-stability assessment.
 *  A numeric Tm is NOT predicted from sequence — `tm_numeric_c` is always null;
 *  obtain it from DSF/nanoDSF/DSC or a structure-based L2 calculation. */
export interface AntibodyStability {
  tm_numeric_c: number | null;
  assay_required: string;
  outlook: "Favourable" | "Monitor" | "Concern";
  signals: AntibodyStabilitySignal[];
  provenance: string;
  method: string;
  caveat: string;
}

/** Expression / manufacturability triage. */
export interface AntibodyManufacturability {
  expression_outlook: string;
  risk_score: number;
  factors: string[];
  provenance: string;
  note: string;
}

export interface AntibodyResult {
  engine: string;
  modality: string;
  format_hint: string | null;
  inferred_format: string;
  /** "ANARCI · IMGT — exact" or the motif-anchored heuristic. */
  numbering_method: string;
  chains: AntibodyChain[];
  stability: AntibodyStability;
  manufacturability: AntibodyManufacturability;
  summary: AntibodySummary;
  limitations: string;
}

/** Analyse an antibody — heavy chain required, light chain optional (omit for a
 *  VHH / nanobody / single-domain construct). Returns a Layer-1 developability
 *  profile. No GPU; fails with a descriptive error on an invalid sequence. */
export async function predictAntibody(
  heavyChain: string,
  lightChain?: string,
  formatHint?: string,
): Promise<AntibodyResult> {
  const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z]/g, "");
  return post<AntibodyResult>("/antibody", {
    heavy_chain: clean(heavyChain),
    light_chain: lightChain && lightChain.trim() ? clean(lightChain) : null,
    format_hint: formatHint && formatHint.trim() ? formatHint.trim() : null,
  });
}

/** UI helper — the AlphaFold/Boltz pLDDT confidence bands and their colours. */
export function plddtBand(plddt: number | null | undefined): {
  label: string;
  color: string;
  tone: "very-high" | "confident" | "low" | "very-low" | "unknown";
} {
  if (plddt === null || plddt === undefined || !isFinite(plddt)) {
    return { label: "—", color: "#64748b", tone: "unknown" };
  }
  if (plddt >= 90) return { label: "Very high", color: "#2563eb", tone: "very-high" };
  if (plddt >= 70) return { label: "Confident", color: "#22d3ee", tone: "confident" };
  if (plddt >= 50) return { label: "Low", color: "#facc15", tone: "low" };
  return { label: "Very low", color: "#f97316", tone: "very-low" };
}
