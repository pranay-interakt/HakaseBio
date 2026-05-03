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
