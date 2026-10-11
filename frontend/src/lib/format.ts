// Display labels and formatting. Presentation only: no scientific arithmetic happens here.

/** snake_case or dotted identifiers as words ("chronic_non_oncology" -> "Chronic non oncology"). */
export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const words = s.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(map: Record<string, string>) {
  return (key: string | null | undefined): string => (key ? (map[key] ?? humanize(key)) : "—");
}

export const MODALITIES: Record<string, string> = {
  small_molecule: "Small molecule",
  peptide: "Synthetic peptide",
  oligonucleotide: "Oligonucleotide",
  monoclonal_antibody: "Monoclonal antibody",
  recombinant_protein: "Recombinant protein",
  antibody_drug_conjugate: "Antibody–drug conjugate",
  cell_therapy: "Cell therapy",
  gene_therapy: "Gene therapy",
  vaccine: "Vaccine",
};
export const INDICATIONS: Record<string, string> = {
  chronic_non_oncology: "Chronic, non-oncology",
  acute_non_oncology: "Acute, non-oncology",
  advanced_cancer: "Advanced cancer (ICH S9)",
  oncology_non_advanced: "Oncology, not advanced",
  life_threatening_non_oncology: "Life-threatening, non-oncology",
  rare_genetic: "Rare genetic disease",
};
export const ROUTES: Record<string, string> = {
  oral: "Oral",
  intravenous: "Intravenous",
  subcutaneous: "Subcutaneous",
  intramuscular: "Intramuscular",
  topical_dermal: "Topical / dermal",
  inhalation: "Inhalation",
  intrathecal: "Intrathecal",
  intravitreal: "Intravitreal",
  other_parenteral: "Other parenteral",
};
export const POPULATIONS: Record<string, string> = {
  healthy_volunteers: "Healthy volunteers",
  patients: "Patients",
  women_of_childbearing_potential: "Women of childbearing potential",
  pregnant_women: "Pregnant women",
  pediatric: "Paediatric",
};
export const TIMINGS: Record<string, string> = {
  before_first_in_human: "Before first-in-human",
  before_multiple_dose_trials: "Before multiple-dose trials",
  before_phase_2: "Before phase 2",
  before_inclusion_of_wocbp: "Before including WOCBP",
  before_phase_3: "Before phase 3",
  marketing_application: "Marketing application",
};
export const TIMING_ORDER = Object.keys(TIMINGS);

export const STATES: Record<string, string> = {
  proposed: "Proposed",
  designed: "Designed",
  planned: "Planned",
  dispatched: "Dispatched",
  data_received: "Data received",
  analyzed: "Analysed",
  reported: "Reported",
  approved: "Approved",
  cancelled: "Cancelled",
  failed: "Failed",
  import_draft: "Import draft",
  imported: "Imported",
  superseded: "Superseded",
};
export const STATUSES: Record<string, string> = {
  required: "Required",
  conditional: "Conditional",
  not_required: "Not required",
  done: "Done",
  missing: "Missing",
  imported: "Imported",
  in_progress: "In progress",
  partial: "Partial",
  simulated_only: "Simulated only",
  done_qc_failed: "Done, QC failed",
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
  found: "Found",
  ok: "Found",
  not_found: "Not found",
  unreachable: "Unreachable",
  rate_limited: "Rate limited",
};
export const MEANINGS: Record<string, string> = {
  approval: "Approval",
  review: "Review",
  authorship: "Authorship",
  responsibility: "Responsibility",
  qa_compliance_statement: "QA compliance statement",
};
export const TARGETS: Record<string, string> = {
  external_lab: "External laboratory",
  in_house: "In-house laboratory",
  simulation: "Simulation",
};

/** Audit-trail actions as people read them. */
export const ACTIONS: Record<string, string> = {
  "principal.registered": "User registered",
  "principal.roles_changed": "Roles changed",
  "principal.deactivated": "User deactivated",
  "principal.reactivated": "User reactivated",
  "principal.locked": "Account locked",
  "principal.unlocked": "Account unlocked",
  "principal.password_reset": "Password reset",
  "principal.password_changed": "Password changed",
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.failed": "Failed sign-in",
  "program.created": "Programme created",
  "program.context_updated": "Programme facts changed",
  "program.determination_recorded": "Programme determination signed",
  "program.member_added": "Guest given access",
  "program.member_removed": "Guest access removed",
  "compound.registered": "Compound registered",
  "compound.external_attached": "External record attached",
  "study.created": "Study created",
  "study.designed": "Protocol designed",
  "study.protocol_signed": "Protocol approved",
  "study.planned": "Study planned",
  "study.dispatched": "Study dispatched",
  "data.received": "Data received",
  "study.inputs_set": "Analysis inputs recorded",
  "study.analyzed": "Analysis run",
  "study.determination_recorded": "Expert determination signed",
  "study.reported": "Report generated",
  "study.signed": "Report signed",
  "study.approved": "Study approved",
  "study.cancelled": "Study cancelled",
  "study.failed": "Study failed",
  "import.created": "Import started",
  "import.value_added": "Imported value recorded",
  "import.dataset_added": "Dataset attached",
  "import.signed": "Import signed",
  "import.completed": "Import completed",
  "import.superseded": "Import superseded",
  "import.value_proposed": "Value proposed for import",
  "import.value_withdrawn": "Imported value withdrawn",
  "import.proposal_confirmed": "Proposed value confirmed",
  "import.proposal_rejected": "Proposed value rejected",
  "principal.agent_token_issued": "Agent key issued",
  "data.origin_overridden": "Data origin overridden",
  "data.rejected": "Data file rejected",
  "program.rehearsed": "Programme rehearsed",
  "study.approval_refused": "Approval refused",
  "study.send_exported": "SEND package exported",
  "study.send_export_refused": "SEND export refused",
  "system.schema_upgraded": "Database schema upgraded",
};

export const modalityLabel = lookup(MODALITIES);
export const indicationLabel = lookup(INDICATIONS);
export const routeLabel = lookup(ROUTES);
export const populationLabel = lookup(POPULATIONS);
export const timingLabel = lookup(TIMINGS);
export const stateLabel = lookup(STATES);
export const statusLabel = lookup(STATUSES);
export const meaningLabel = lookup(MEANINGS);
export const targetLabel = lookup(TARGETS);
export const actionLabel = lookup(ACTIONS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11 Oct 2026, 14:06 UTC": records are kept in UTC, so times are shown in UTC too. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 h ago"; the exact time belongs in a title attribute. */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(s)) return iso;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? h.slice(0, n) : "—";
}
