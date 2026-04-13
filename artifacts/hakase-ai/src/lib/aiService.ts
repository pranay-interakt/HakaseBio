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
  model_info: { engine: string; method: string; targets_screened: number };
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
