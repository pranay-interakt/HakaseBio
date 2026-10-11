// Shapes returned by the HOS API (mirrors of the backend to_dict() payloads).
// The frontend renders these; it never computes a scientific value.

export type ProvenanceKind =
  | "measured"
  | "literature"
  | "computed"
  | "predicted"
  | "guideline"
  | "user_supplied"
  | "simulated"
  | "unavailable";

export interface Citation {
  key: string;
  text: string;
  doi?: string | null;
  url?: string | null;
  year?: number | null;
}

export interface Method {
  id: string;
  version: string;
  name: string;
  citations: Citation[];
  assumptions: string[];
  limits: string[];
}

export interface Provenance {
  kind: ProvenanceKind;
  method: Method | null;
  citation: Citation | null;
  citations: Citation[];
  source_name: string | null;
  source_url: string | null;
  source_record_id: string | null;
  retrieved_at: string | null;
  actor: string | null;
  input_ids: string[];
  software: Record<string, string>;
  parameter_set_version: string | null;
  applicability: {
    in_domain: boolean;
    reason: string | null;
    descriptor_ranges_checked: string[];
  } | null;
  reason: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface Uncertainty {
  kind: string;
  lower: number | null;
  upper: number | null;
  sd: number | null;
  n: number | null;
}

export interface Quantity {
  id: string;
  label: string | null;
  value: number | null;
  unit: string;
  available: boolean;
  provenance: Provenance;
  uncertainty: Uncertainty | null;
  qc_flags: string[];
}

export function isQuantity(x: unknown): x is Quantity {
  return (
    typeof x === "object" &&
    x !== null &&
    "provenance" in x &&
    "unit" in x &&
    "available" in x
  );
}

export interface Principal {
  id: string;
  name: string;
  kind: "human" | "agent" | "system";
  roles: string[];
  organisation?: string | null;
}

export interface Requirement {
  id: string;
  name: string;
  category: string;
  status: "required" | "conditional" | "not_required";
  timing: string;
  citation: Citation;
  section: string;
  rationale: string;
  glp: boolean;
  species: string[];
  duration_weeks: number | null;
  driver_id: string | null;
  pending_fact: string | null;
  ctd_section: string | null;
}

export interface StudySummary {
  id: string;
  title: string;
  state: string;
  driver_id: string;
  origin: "driver" | "import";
  requirement_id: string | null;
  compound_id: string;
  glp: boolean;
  evidence_admissible: boolean;
  simulated: boolean;
  updated_at: string;
}

export interface Compound {
  id: string;
  program_id: string;
  name: string;
  smiles: string;
  inchikey: string | null;
  profile: {
    canonical_smiles: string;
    formula: string;
    rdkit_version: string;
    lipinski_pass: boolean;
    veber_pass: boolean;
    descriptors: Record<string, Quantity>;
  };
  external: Record<string, SourceResult>;
}

export interface SourceResult {
  source: string;
  status: string;
  query: string;
  url: string;
  retrieved_at: string | null;
  from_cache: boolean;
  records: Record<string, unknown>[];
  quantities: Record<string, Quantity>;
  license: string | null;
  attribution: string | null;
  error: string | null;
}

export interface Program {
  id: string;
  name: string;
  sponsor: string | null;
  context: Record<string, unknown>;
  study_set: {
    requirements: Requirement[];
    governing_guidelines: Citation[];
    notes: string[];
    summary: { required: number; conditional: number; not_required: number };
  };
  compounds: Compound[];
  studies: StudySummary[];
}

export interface QCFinding {
  code: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface Table {
  title: string;
  columns: string[];
  rows: unknown[][];
  note: string | null;
}

export interface Statement {
  statement: string;
  basis: string;
  citation_keys: string[];
  citations: Citation[];
  severity: "info" | "notable" | "concern";
}

export interface ExpertDeterminationSpec {
  key: string;
  label: string;
  unit: string | null;
  role: string;
  required_for_approval: boolean;
  guidance: string;
}

export interface Study extends StudySummary {
  program_id: string;
  driver_version: string;
  hypothesis: string | null;
  parameters: Record<string, unknown>;
  protocol: Record<string, unknown> | null;
  protocol_version: number;
  protocol_hash: string | null;
  plan: Record<string, unknown> | null;
  execution: Record<string, unknown> | null;
  raw_files: { sha256: string; filename: string; origin: string; received_at: string }[];
  data: Record<string, unknown> | null;
  analysis_inputs: Record<string, Record<string, unknown>>;
  results: {
    quantities: Record<string, Quantity>;
    tables: Table[];
    qc: { status: string; findings: QCFinding[] };
    evidence_admissible: boolean;
    notes: string[];
    analysis_hash: string;
  } | null;
  interpretation: { statements: Statement[]; requires_expert_judgement: string[] } | null;
  determinations: {
    key: string;
    label: string;
    quantity: Quantity;
    rationale: string;
    role: string;
    signer_name: string;
    signed_at: string;
    analysis_hash: string;
  }[];
  report: { markdown: string; title: string; content_hash: string; disclaimer: string | null } | null;
  report_hash: string | null;
  signatures: {
    signer_name: string;
    role: string;
    meaning: string;
    signed_at: string;
    statement: string;
    subject_hash: string;
  }[];
  allowed_transitions: string[];
  approval_missing?: string[];
  import_record?: ImportRecord | null;
  import?: {
    fields: ImportFieldSpec[];
    missing: string[];
    import_hash: string;
    signatures_missing: string[];
    attestation_sentence: string;
  };
  driver?: { id: string; name: string; version: string; ctd_section: string };
  expected_inputs?: Record<string, string>;
  expert_determinations?: ExpertDeterminationSpec[];
}

export interface Driver {
  id: string;
  name: string;
  version: string;
  description: string;
  requirement_ids: string[];
  ctd_section: string;
  glp_capable: boolean;
  can_simulate: boolean;
  parameters_schema: JsonSchema;
  simulation_parameters_schema: JsonSchema | null;
  references: Citation[];
}

export interface JsonSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  anyOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  default?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
}

export interface LedgerEntry {
  seq: number;
  recorded_at: string;
  actor_id: string;
  actor_kind: string;
  action: string;
  subject_id: string;
  payload: Record<string, unknown>;
  entry_hash: string;
  reason: string | null;
}

export interface ReadinessItem {
  requirement_id: string;
  name: string;
  category: string;
  timing: string;
  due_for_milestone: boolean;
  status: string;
  glp: boolean;
  section: string;
  citation: Citation;
  pending_fact: string | null;
  driver_available: boolean;
  ctd_section: string | null;
  studies: { id: string; state: string; simulated: boolean }[];
}

export interface Readiness {
  milestone: string;
  summary: {
    required_for_milestone: number;
    done: number;
    percent_done: number | null;
    imported: number;
    covered: number;
    percent_covered: number | null;
    runnable_in_hos: number;
    percent_runnable_in_hos: number | null;
    by_status: Record<string, number>;
    conditional_pending_facts: string[];
  };
  items: ReadinessItem[];
  notes: string[];
}

export interface ImportFieldSpec {
  key: string;
  label: string;
  value_type: "quantity" | "categorical";
  unit: string | null;
  choices: string[];
  required: boolean;
  needs_species: boolean;
  note: string;
}

export interface ImportValue {
  id: string;
  key: string;
  label: string;
  value_type: "quantity" | "categorical";
  quantity?: Quantity;
  category?: string;
  page: string;
  table: string | null;
  species: string | null;
  sex: string | null;
  entered_by_name: string;
  entered_at: string;
  origin: string;
  withdrawn?: { by: string; at: string; reason: string };
}

export interface ImportProposal {
  id: string;
  key: string;
  label: string | null;
  value: number | null;
  unit: string | null;
  category: string | null;
  page: string;
  table: string | null;
  species: string | null;
  sex: string | null;
  excerpt: string | null;
  proposed_by: string;
  proposed_by_kind: string;
  status: "proposed" | "confirmed" | "rejected";
  reason?: string;
}

export interface ImportRecord {
  report: {
    sha256: string;
    filename: string;
    size_bytes: number;
    title: string;
    laboratory: string;
    report_date: string;
    lab_study_number: string | null;
  };
  ctd_section: string;
  requirement: { id: string; name: string; section: string; citation: Citation };
  datasets: { sha256: string; filename: string; description: string; size_bytes: number }[];
  values: ImportValue[];
  proposals: ImportProposal[];
  superseded_by?: { study_id: string; reason: string; at: string };
}
