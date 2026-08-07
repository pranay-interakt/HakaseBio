import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Atom,
  BadgeCheck,
  Beaker,
  BookOpen,
  Box,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  Droplets,
  FlaskConical,
  HeartPulse,
  LoaderCircle,
  Network,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TestTube2,
  Workflow,
  Zap,
  X,
} from "lucide-react";
import hakaseLogo from "./assets/hakase-logo.png";
import { AnimalStudyWorkspace, type CascadeContext } from "./AnimalStudyWorkspace";
import { AssayBench } from "./AssayBench";
import { ConfirmationWorkspace } from "./ConfirmationWorkspace";
import { ExternalEvidencePanel, FdaPsgPanel } from "./ExternalEvidencePanel";
import { FirstInHumanWorkspace } from "./FirstInHumanWorkspace";
import { IviveWorkspace } from "./IviveWorkspace";
import { Landing } from "./Landing";
import { CaseStudiesPage, DevelopersPage, SciencePage } from "./SitePages";
import { useHashRoute } from "./useHashRoute";

const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";
const DEFAULT_SMILES = "CC(=O)Oc1ccccc1C(=O)O";

/* The pre-clinical pipeline, in order. `layer` drives the per-stage accent
   colour that themes the rail, banner and section marks for that stage. */
const STAGES = [
  { key: "in-vitro", label: "In Vitro", layer: 1 },
  { key: "confirmation", label: "Confirmation", layer: 2 },
  { key: "ivive", label: "IVIVE", layer: 3 },
  { key: "animal-cohort", label: "Animal Cohort", layer: 3 },
  { key: "first-in-human", label: "First in Human", layer: 4 },
] as const;

/* Sticky sub-navigation for the Layer 1 result pane. The pane is long by
   nature — one screen holds structure, ADMET, the assay bench, target evidence,
   safety and the handoff — so the sections are named once here and reused for
   both the jump links and the section anchors. */
const L1_SECTIONS = [
  { id: "l1-overview", label: "Overview" },
  { id: "l1-structure", label: "Structure" },
  { id: "l1-admet", label: "ADMET" },
  { id: "l1-bench", label: "Assay bench" },
  { id: "l1-target", label: "Target" },
  { id: "l1-safety", label: "Safety" },
  { id: "l1-handoff", label: "Handoff" },
] as const;

const ADMET_ICONS: Record<string, React.ReactNode> = {
  Absorption: <Droplets size={16} />,
  Distribution: <Network size={16} />,
  Metabolism: <Zap size={16} />,
  Excretion: <FlaskConical size={16} />,
  Toxicity: <HeartPulse size={16} />,
  Physchem: <Atom size={16} />,
  "Additional ADMET-AI endpoints": <Box size={16} />,
};

type Endpoint = {
  endpoint: string;
  model_value: string | number | boolean | null;
  source: string;
  assessment?: { status?: string; unit?: string; reference?: string; basis?: string };
};

type TargetHit = {
  targetChemblId: string;
  targetName: string;
  targetType: string;
  uniprotId: string | null;
  geneName?: string | null;
  organism?: string | null;
  bestActivityType: string;
  bestValue_nM: number;
  pChembl: number | null;
  bestSimilarity?: number;
  fromSimilarity?: boolean;
  pdbIds?: string[];
  pdbCount?: number;
  source?: "exact" | "similarity";
};

type TargetResolution = {
  status: "resolved" | "unresolved" | "invalid_override";
  target_protein: string | null;
  uniprot_id: string | null;
  pdb_id: string | null;
  organism: string | null;
  gene_symbol?: string | null;
  confidence: "high" | "moderate" | "not_confident";
  evidence_type: "database_derived" | "user_provided" | "predicted_evidence" | "unavailable";
  provenance: string[];
  limitations: string[];
  reason?: string;
};

type Analysis = {
  analysis_id: string;
  canonical_smiles: string;
  verdict: {
    verdict: "GO" | "WATCH" | "NO-GO";
    headline: string;
    rationale: string;
    checks: Array<{ name: string; value: string; source: string; status: string }>;
    recommendation?: string;
    major_risks?: string[];
    missing_evidence?: string[];
    recommended_next_experiments?: string[];
    policy?: Record<string, string>;
  };
  rdkit_feasibility: Record<string, unknown>;
  rdkit_assessments: Record<string, Endpoint>;
  tanimoto_applicability: Record<string, unknown>;
  safety: Record<string, unknown>;
  safety_assessments: Record<string, Endpoint>;
  admet_ai_sections: Record<string, Record<string, Endpoint>>;
  three_dimensional_structure: { available?: boolean; molblock?: string; source?: string; reason?: string };
  regulatory_outlook: Record<string, unknown>;
  assay_reliability?: Record<string, unknown>;
  simulation_configuration?: SimulationOptions & { confidence_threshold_note?: string };
  optional_model_runs?: Record<string, OptionalModelRun>;
};

type SimulationOptions = {
  admet_profiling: boolean;
  binding_simulation: boolean;
  toxicity_signal_detection: boolean;
  confidence_threshold: number;
};

type OptionalModelRun = {
  status?: string;
  reason?: string | null;
  result?: { prediction?: Record<string, unknown> };
};

type L1Response = { analysis: { status: string; data?: Analysis; reason?: string }; provenance?: { engines?: string[]; computed_at?: string; inference_time_ms?: number } };

declare global {
  interface Window { $3Dmol?: any }
}

let threeDMolLoader: Promise<any> | undefined;
function load3DMol() {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (!threeDMolLoader) {
    threeDMolLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://3dmol.org/build/3Dmol-min.js";
      script.async = true;
      script.onload = () => window.$3Dmol ? resolve(window.$3Dmol) : reject(new Error("3D renderer was not available"));
      script.onerror = () => reject(new Error("Unable to load 3D renderer"));
      document.head.appendChild(script);
    });
  }
  return threeDMolLoader;
}

function MolViewer({ structure }: { structure: Analysis["three_dimensional_structure"] }) {
  const node = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let viewer: any;
    if (!structure.available || !structure.molblock || !node.current) return;
    void load3DMol().then((ThreeDMol) => {
      if (cancelled || !node.current) return;
      node.current.replaceChildren();
      viewer = ThreeDMol.createViewer(node.current, { backgroundColor: "#f7fbfe" });
      viewer.addModel(structure.molblock, "mol");
      viewer.setStyle({}, { stick: { radius: 0.14, colorscheme: "Jmol" }, sphere: { scale: 0.26, colorscheme: "Jmol" } });
      viewer.zoomTo();
      viewer.zoom(1.2, 0);
      viewer.render();
      // The viewer receives only the server-generated mol block.  Motion is a
      // presentation affordance, not a client-side structural calculation.
      if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) viewer.spin("y", 0.18);
    }).catch(() => setFailed(true));
    return () => { cancelled = true; viewer?.spin?.(false); viewer?.clear?.(); };
  }, [structure]);

  if (!structure.available) return <div className="viewer-empty"><Box size={25} /><span>{structure.reason ?? "A 3D structure could not be generated."}</span></div>;
  if (failed) return <div className="viewer-empty"><CircleHelp size={25} /><span>3D viewer unavailable. The structure remains available in the analysis.</span></div>;
  // The molecule floats above a soft cast shadow — presentation only; the
  // conformer itself is entirely server-generated.
  return <div className="molecule-stage">
    <div className="molecule-viewer" ref={node} aria-label="3D molecular structure" />
    <div className="molecule-shadow" aria-hidden />
  </div>;
}

function tone(status?: string) {
  if (["good", "available", "in_domain", "Low", "GO"].includes(status ?? "")) return "good";
  if (["poor", "High", "NO-GO"].includes(status ?? "")) return "bad";
  return "warn";
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(Math.abs(value) < 1 ? 3 : 2);
  if (typeof value === "boolean") return value ? "Pass" : "Review";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replaceAll("_", " ");
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clientSectionLabel(section: string) {
  return section === "Additional ADMET-AI endpoints" ? "Additional properties" : section;
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  const assessment = endpoint.assessment ?? {};
  return <div className="endpoint-row">
    <div>
      <strong>{endpoint.endpoint}</strong>
    </div>
    <div className="endpoint-value">
      <b>{display(endpoint.model_value)}{assessment.unit ? ` ${assessment.unit}` : ""}</b>
      <em className={`status-dot ${tone(assessment.status)}`}>{assessment.status ?? "reported"}</em>
    </div>
  </div>;
}

function ModelRunSummary({ configuration, runs }: { configuration?: Analysis["simulation_configuration"]; runs?: Analysis["optional_model_runs"] }) {
  if (!configuration) return null;
  const options: Array<[keyof SimulationOptions, string, string]> = [
    ["admet_profiling", "ADMET profiling", "ADMET-AI endpoint ensemble"],
    ["binding_simulation", "Binding simulation", "BindingML target-affinity model"],
    ["toxicity_signal_detection", "Toxicity signal detection", "CardioTox and DILI-ML safety screens"],
  ];
  const binding = runs?.binding_simulation;
  const bindingPrediction = binding?.result?.prediction ?? {};
  return <section className="panel model-run-panel">
    <SectionHeader icon={<SlidersHorizontal size={18} />} eyebrow="SERVER RUN CONFIGURATION" title="Enabled model groups" description="Every selected model group and its availability are returned by the backend." />
    <div className="model-option-summary">{options.map(([key, label, detail]) => <div key={key} className={configuration[key] ? "enabled" : "disabled"}><b>{label}</b><span>{detail}</span><em>{configuration[key] ? "Requested" : "Not requested"}</em></div>)}</div>
    <div className="confidence-summary"><b>Review confidence threshold</b><span>{display(configuration.confidence_threshold)} · {configuration.confidence_threshold_note ?? "Model-calibrated thresholds remain unchanged."}</span></div>
    {binding && <div className="optional-run-summary">
      {binding && <div><b>BindingML</b><span>{binding.status ?? "not returned"}</span>{binding.reason ? <small>{binding.reason}</small> : <small>Predicted pKd: {display(bindingPrediction.pKd_predicted ?? bindingPrediction.pkd)}</small>}</div>}
    </div>}
  </section>;
}

/**
 * Sticky jump-nav for the Layer 1 result pane. It only scrolls: the active
 * chip is driven by which section is actually on screen, so it can never
 * disagree with what the reader is looking at.
 */
function SectionNav() {
  const [active, setActive] = useState<string>(L1_SECTIONS[0].id);

  useEffect(() => {
    const nodes = L1_SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => Boolean(node),
    );
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return <nav className="l1-section-nav" aria-label="Layer 1 result sections">
    {L1_SECTIONS.map((section) => <button
      key={section.id}
      className={active === section.id ? "active" : ""}
      onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
    >{section.label}</button>)}
  </nav>;
}

function SectionHeader({ icon, eyebrow, title, description }: { icon: React.ReactNode; eyebrow?: string; title: string; description?: string }) {
  return <div className="section-header">
    <div className="section-icon">{icon}</div>
    <div><p>{eyebrow}</p><h2>{title}</h2>{description && <span>{description}</span>}</div>
  </div>;
}

function Regulatory({ outlook }: { outlook: Record<string, unknown> }) {
  const status = String(outlook.status ?? "unavailable");
  const labels = Array.isArray(outlook.drug_labels) ? outlook.drug_labels as Array<Record<string, unknown>> : [];
  const apps = Array.isArray(outlook.drugsfda_applications) ? outlook.drugsfda_applications as Array<Record<string, unknown>> : [];
  return <section className="panel regulatory-panel">
    <SectionHeader icon={<ShieldCheck size={18} />} eyebrow="REGULATORY REVIEW" title="Regulatory outlook" description="Exact-structure match against public FDA records." />
    <div className={`regulatory-status ${tone(status)}`}>
      {status === "available" ? <BadgeCheck size={18} /> : status === "not_found" ? <ScanSearch size={18} /> : <AlertTriangle size={18} />}
      <div><b>{status === "available" ? "Public regulatory records found" : status === "not_found" ? "No exact regulatory record found" : "Regulatory lookup unavailable"}</b><span>{String(outlook.reason ?? `InChIKey: ${outlook.inchikey ?? "not returned"}`)}</span></div>
    </div>
    {status === "available" && <div className="regulatory-grid">
      <div><small>Identity</small><strong>{String(outlook.identity_name ?? "Exact structure match")}</strong><span>InChIKey · {String(outlook.inchikey ?? "—")}</span></div>
      <div><small>Drugs@FDA</small><strong>{apps.length} application{apps.length === 1 ? "" : "s"}</strong><span>{apps[0]?.application_number ? String(apps[0].application_number) : "No application ID"}</span></div>
      <div><small>Drug labels</small><strong>{labels.length} label{labels.length === 1 ? "" : "s"}</strong><span>{labels[0]?.brand_name ? String(labels[0].brand_name) : "No brand name returned"}</span></div>
    </div>}
    <div className="source-line"><Database size={14} /> Evidence provenance is available in the report.</div>
  </section>;
}

type SelectivityEvidence = {
  status: string;
  method?: string;
  reason?: string | null;
  threshold?: number;
  primary_target_evidence?: Array<EvidenceTarget>;
  off_targets?: Array<EvidenceTarget>;
  insufficient_off_target_target_count?: number;
  limitations?: string[];
};
type PotencyGroup = { activity_type: string; independent_compound_count: number; supporting_measurement_count: number; potency_estimate: { median_nM: number; display: string } | null; organisms: string[]; assay_contexts: string[]; reported_units: string[]; insufficient_reason: string | null };
type EvidenceTarget = { target_chembl_id: string; target_name: string; potency_groups: PotencyGroup[] };

type DockingConfig = { configured: boolean; engine?: string; mode?: string; reason?: string | null; requirements?: Record<string, boolean>; limitations?: string[] };
type DockJob = { job_id: string; status: "queued" | "running" | "done" | "failed"; progress?: string; error?: string | null; result?: { pdb_id: string; poses: Array<{ mode: number; affinity_kcal_mol: number; rmsd_lb: number; rmsd_ub: number }>; box?: { method?: string; source_residue?: string | null }; runtime_seconds?: number; vina_version?: string; warnings?: string[] } | null };

function AssayReliability({ report }: { report?: Record<string, unknown> }) {
  if (!report) return null;
  const pains = (report.pains ?? {}) as { count?: number; alerts?: Array<{ name?: string }> };
  const brenk = (report.brenk ?? {}) as { count?: number; alerts?: Array<{ name?: string }> };
  const controls = Array.isArray(report.recommended_controls) ? report.recommended_controls as string[] : [];
  return <section className="assay-summary">
    <SectionHeader icon={<ScanSearch size={18} />} eyebrow="STRUCTURAL REVIEW" title="Structural alerts" description="PAINS and Brenk substructure screen." />
    <div className="reliability-summary"><div className={`reliability-count ${tone(String(report.overall_alert_level))}`}><b>{String(report.display_summary ?? "No structural alerts")}</b><span>{String(report.display_recommendation ?? "Review status not returned")}</span></div><div><b>{pains.count ?? 0} PAINS · {brenk.count ?? 0} Brenk</b><p>{String(report.interpretation ?? "No reliability result returned.")}</p></div></div>
    <div className="alert-groups"><div><b>PAINS</b>{(pains.alerts?.length ?? 0) ? <div className="alert-chip-list">{pains.alerts?.map((alert, index) => <span key={`pains-${alert.name}-${index}`}><AlertTriangle size={13} /> {alert.name ?? "Structural alert"}</span>)}</div> : <small>No PAINS alerts returned.</small>}</div><div><b>Brenk</b>{(brenk.alerts?.length ?? 0) ? <div className="alert-chip-list">{brenk.alerts?.map((alert, index) => <span key={`brenk-${alert.name}-${index}`}><AlertTriangle size={13} /> {alert.name ?? "Structural alert"}</span>)}</div> : <small>No Brenk alerts returned.</small>}<small>Brenk alerts identify structural features for review; they do not confirm assay interference.</small></div></div>
    {controls.length > 0 && <div className="assay-controls"><b>Recommended follow-up</b>{controls.map((control) => <span key={control}><Check size={14} /> {control}</span>)}</div>}
    <p className="model-note">{String(report.display_rule ?? "Structural alerts are not experimental evidence.")}</p>
  </section>;
}

function PotencyEvidence({ group }: { group: PotencyGroup }) {
  return <div className="potency-group"><div><b>{group.activity_type}</b><span>{group.assay_contexts.length ? group.assay_contexts.join(" · ") : "Assay context not returned"}</span></div>{group.potency_estimate ? <strong>Analogue read-across median: {group.activity_type} {group.potency_estimate.display}</strong> : <div className="insufficient-evidence"><b>Insufficient evidence</b><span>Only {group.independent_compound_count} suitable analogue compound(s) were found.</span><span>At least 3 independent analogues are required for a potency estimate.</span></div>}<small>{group.organisms.length ? `Organism: ${group.organisms.join(", ")}` : "Organism not returned"} · {group.supporting_measurement_count} supporting measurement{group.supporting_measurement_count === 1 ? "" : "s"} · {group.independent_compound_count} supporting compound{group.independent_compound_count === 1 ? "" : "s"}{group.reported_units.length ? ` · reported units: ${group.reported_units.join(", ")}` : ""}</small></div>;
}

function SelectivityPanel({ data, loading }: { data: SelectivityEvidence | null; loading: boolean }) {
  return <section className="panel selectivity-panel">
    <SectionHeader icon={<Target size={18} />} eyebrow="TARGET EVIDENCE" title="Off-target & selectivity" description="Measured activity from structurally related compounds." />
    {loading && <div className="panel-loading"><LoaderCircle className="spin" size={18} /> Retrieving available evidence…</div>}
    {!loading && !data && <div className="soft-note"><CircleHelp size={15} /> Select a resolved protein target, then run Layer 1 to retrieve evidence.</div>}
    {!loading && data?.status === "completed" && <>
      {data.primary_target_evidence?.map((entry) => <div className="primary-evidence" key={entry.target_name}><div className="evidence-target-heading"><span>Selected protein</span><b>{entry.target_name}</b></div>{entry.potency_groups.map((group) => <PotencyEvidence key={group.activity_type} group={group} />)}</div>)}
      {(data.off_targets?.length ?? 0) > 0 && <div className="offtarget-list">{(data.off_targets ?? []).slice(0, 6).map((entry) => <div key={entry.target_chembl_id}><b>{entry.target_name}</b>{entry.potency_groups.filter((group) => group.potency_estimate).map((group) => <PotencyEvidence key={group.activity_type} group={group} />)}</div>)}</div>}
      {(data.off_targets?.length ?? 0) === 0 && <div className="soft-note"><CircleHelp size={15} /> <span>No eligible off-target records were found in this retrieval.<br />This does not demonstrate that the molecule is selective.</span></div>}
      {(data.insufficient_off_target_target_count ?? 0) > 0 && <p className="model-note">{data.insufficient_off_target_target_count} other retrieved target{data.insufficient_off_target_target_count === 1 ? "" : "s"} did not meet the independent-analogue threshold, so no off-target potency estimate is shown.</p>}
    </>}
    {!loading && data && data.status !== "completed" && <div className="soft-note"><CircleHelp size={15} /> {data.reason ?? "Insufficient evidence was returned for this selected target."}</div>}
    {data?.limitations?.map((limitation) => <p className="model-note" key={limitation}>{limitation}</p>)}
  </section>;
}

function DockingPanel({ hasResolvedTarget, pdbId, setPdbId, config, job, onRun }: { hasResolvedTarget: boolean; pdbId: string; setPdbId: (value: string) => void; config: DockingConfig | null; job: DockJob | null; onRun: () => void }) {
  const busy = job?.status === "queued" || job?.status === "running";
  const pose = job?.result?.poses?.[0];
  return <section className="panel docking-panel">
    <SectionHeader icon={<FlaskConical size={18} />} eyebrow="OPTIONAL ANALYSIS" title="Molecular docking" description="A separate computational run; it is not part of the standard screen." />
    <div className="docking-controls"><label>Receptor PDB ID<input value={pdbId} onChange={(event) => setPdbId(event.target.value.toUpperCase())} placeholder="Validated structure ID" maxLength={4} /></label><div><b>{config?.configured ? "Ready for submission" : "Unavailable"}</b><small>{config?.configured ? "Separate asynchronous analysis" : config?.reason ?? "Checking availability…"}</small></div><button className="secondary-button" onClick={onRun} disabled={!config?.configured || !pdbId.trim() || busy || !hasResolvedTarget}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} fill="currentColor" />} {busy ? (job?.progress ?? "Running docking…") : "Run docking"}</button></div>
    {!hasResolvedTarget && <div className="soft-note"><CircleHelp size={15} /> Resolve and validate a protein target before submitting a receptor-specific docking job.</div>}
    {config && !config.configured && <div className="soft-note"><AlertTriangle size={15} /> {config.reason}</div>}
    {job?.status === "failed" && <div className="toast-error"><X size={16} /> {job.error ?? "Docking job failed."}</div>}
    {job?.status === "done" && pose && <div className="dock-result"><div><span>Best binding score</span><b>{display(pose.affinity_kcal_mol)} kcal/mol</b></div><div><span>Receptor</span><b>{job.result?.pdb_id}</b></div><div><span>Box selection</span><b>{job.result?.box?.method ?? "not returned"}</b></div><div><span>Runtime</span><b>{display(job.result?.runtime_seconds)} s</b></div></div>}
    {config?.limitations?.map((limitation) => <p className="model-note" key={limitation}>{limitation}</p>)}
  </section>;
}

function App() {
  const [view, setView] = useState<"landing" | "workspace">("landing");
  const [smiles, setSmiles] = useState(DEFAULT_SMILES);
  const [therapeuticArea, setTherapeuticArea] = useState("Cardiometabolic");
  const [targets, setTargets] = useState<TargetHit[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetHit | null>(null);
  const [targetProtein, setTargetProtein] = useState("");
  const [uniprotId, setUniprotId] = useState("");
  const [targetResolution, setTargetResolution] = useState<TargetResolution | null>(null);
  const [resolvingTarget, setResolvingTarget] = useState(false);
  const [targetStatus, setTargetStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [result, setResult] = useState<L1Response | null>(null);
  const [running, setRunning] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeAdmetSection, setActiveAdmetSection] = useState("Absorption");
  const [activeStage, setActiveStage] = useState<"in-vitro" | "confirmation" | "ivive" | "animal-cohort" | "first-in-human">("in-vitro");
  /* The first-in-human layer consumes a completed animal study, so the stage is
     reachable only once Layer 3 has produced and persisted a study_id. */
  const [studyId, setStudyId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDecision, setOverrideDecision] = useState<"GO" | "WATCH" | "NO-GO">("WATCH");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideRecord, setOverrideRecord] = useState<Record<string, unknown> | null>(null);
  const [cascade, setCascade] = useState<CascadeContext | null>(null);
  const [route, navigate] = useHashRoute();
  const [selectivity, setSelectivity] = useState<SelectivityEvidence | null>(null);
  const [selectivityLoading, setSelectivityLoading] = useState(false);
  const [pdbId, setPdbId] = useState("");
  const [dockingConfig, setDockingConfig] = useState<DockingConfig | null>(null);
  const [dockJob, setDockJob] = useState<DockJob | null>(null);
  const [simulationOptions, setSimulationOptions] = useState<SimulationOptions>({ admet_profiling: true, binding_simulation: false, toxicity_signal_detection: true, confidence_threshold: 0.70 });

  const analysis = result?.analysis.data;
  const allDescriptors = useMemo(() => Object.entries(analysis?.rdkit_feasibility ?? {}).filter(([key]) => !["source", "lipinski_failure_reasons", "veber_failure_reasons"].includes(key)), [analysis]);
  const compactDescriptors = allDescriptors.slice(0, 8);
  const admetSections = useMemo(() => Object.entries(analysis?.admet_ai_sections ?? {}), [analysis]);
  const activeAdmetEndpoints = analysis?.admet_ai_sections[activeAdmetSection] ?? admetSections[0]?.[1] ?? {};
  const gateNeedsReview = analysis?.verdict.verdict === "WATCH" || analysis?.verdict.verdict === "NO-GO";
  const canContinue = Boolean(analysis && (!gateNeedsReview || overrideRecord));
  const checksCleared = analysis?.verdict.checks.filter((check) => check.status === "good").length ?? 0;
  const checksTotal = analysis?.verdict.checks.length ?? 0;

  useEffect(() => {
    setSelectivity(null);
    setDockJob(null);
  }, [selectedTarget?.targetChemblId]);

  useEffect(() => {
    if (!analysis || !selectedTarget?.targetChemblId) return;
    let cancelled = false;
    setSelectivityLoading(true);
    void fetch(`${API_ROOT}/api/chembl/selectivity-evidence?smiles=${encodeURIComponent(analysis.canonical_smiles)}&selected_target_chembl_id=${encodeURIComponent(selectedTarget.targetChemblId)}`, { signal: AbortSignal.timeout(45_000) })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setSelectivity(data as SelectivityEvidence | null); })
      .catch(() => { if (!cancelled) setSelectivity(null); })
      .finally(() => { if (!cancelled) setSelectivityLoading(false); });
    return () => { cancelled = true; };
  }, [analysis?.analysis_id, selectedTarget?.targetChemblId]);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    void fetch(`${API_ROOT}/api/ai/dock/config`, { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setDockingConfig(data as DockingConfig | null); })
      .catch(() => { if (!cancelled) setDockingConfig(null); });
    return () => { cancelled = true; };
  }, [analysis?.analysis_id]);

  async function predictTargets() {
    setMessage(null);
    setTargetStatus("loading");
    try {
      const exactResponse = await fetch(`${API_ROOT}/api/chembl/target-search?smiles=${encodeURIComponent(smiles)}`, { signal: AbortSignal.timeout(20_000) });
      if (!exactResponse.ok) throw new Error("Target discovery service did not respond");
      const exact = await exactResponse.json() as { targets?: TargetHit[] };
      let rawTargets = exact.targets ?? [];
      let source: TargetHit["source"] = "exact";
      // For new chemistry, the backend's similarity route aggregates measured
      // ChEMBL activity and attaches UniProt/PDB evidence. The browser only displays it.
      if (!rawTargets.length) {
        const similarResponse = await fetch(`${API_ROOT}/api/chembl/similar-targets/v2?smiles=${encodeURIComponent(smiles)}&threshold=70&limit=25`, { signal: AbortSignal.timeout(25_000) });
        if (similarResponse.ok) {
          const similar = await similarResponse.json() as { targets?: TargetHit[] };
          rawTargets = similar.targets ?? [];
          source = "similarity";
        }
      }
      const nextTargets = rawTargets.slice(0, 5).map((target) => ({ ...target, source }));
      setTargets(nextTargets);
      const first = nextTargets[0] ?? null;
      setSelectedTarget(first);
      if (first) {
        setTargetProtein(first.targetName);
        setUniprotId(first.uniprotId ?? "");
        setPdbId(first.pdbIds?.[0] ?? "");
        setTargetResolution(null);
        if (first.uniprotId) void resolveTargetValues({ uniprot_id: first.uniprotId, pdb_id: first.pdbIds?.[0] }).catch((error) => setMessage(error instanceof Error ? error.message : "Protein target could not be resolved."));
      }
      setTargetStatus(nextTargets.length ? "ready" : "empty");
    } catch (error) {
      setTargetStatus("error");
      setTargets([]);
      setSelectedTarget(null);
      setMessage(error instanceof Error ? error.message : "Unable to predict targets.");
    }
  }

  function applyTargetResolution(resolution: TargetResolution) {
    setTargetResolution(resolution);
    if (resolution.status !== "resolved") return;
    if (resolution.target_protein) setTargetProtein(resolution.target_protein);
    if (resolution.uniprot_id) setUniprotId(resolution.uniprot_id);
    if (resolution.pdb_id) setPdbId(resolution.pdb_id);
  }

  async function resolveTargetValues(values: { protein?: string; uniprot_id?: string; pdb_id?: string }) {
    const params = new URLSearchParams();
    if (values.protein?.trim()) params.set("protein", values.protein.trim());
    if (values.uniprot_id?.trim()) params.set("uniprot_id", values.uniprot_id.trim());
    if (values.pdb_id?.trim()) params.set("pdb_id", values.pdb_id.trim());
    if (!params.size) return;
    const response = await fetch(`${API_ROOT}/api/chembl/resolve-protein?${params.toString()}`, { signal: AbortSignal.timeout(25_000) });
    const resolution = await response.json().catch(() => ({})) as TargetResolution & { error?: string };
    if (!response.ok) throw new Error(resolution.error ?? "Protein target could not be resolved.");
    applyTargetResolution(resolution);
  }

  async function resolveTarget(field: "protein" | "uniprot" | "pdb") {
    const value = field === "protein" ? targetProtein : field === "uniprot" ? uniprotId : pdbId;
    if (!value.trim()) return;
    setResolvingTarget(true);
    setMessage(null);
    try {
      await resolveTargetValues(field === "protein" ? { protein: targetProtein } : field === "uniprot" ? { uniprot_id: uniprotId } : { uniprot_id: uniprotId, pdb_id: pdbId });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Protein target could not be resolved.");
    } finally { setResolvingTarget(false); }
  }

  async function recordOverride() {
    if (!analysis || !overrideReason.trim()) return;
    setOverrideBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l1/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: analysis.analysis_id, reviewer: "Workspace reviewer", decision: overrideDecision, rationale: overrideReason.trim(), flagged_checks: analysis.verdict.checks.filter((check) => check.status !== "good").map((check) => check.name) }),
      });
      const record = await response.json();
      if (!response.ok) throw new Error(typeof record.detail === "string" ? record.detail : "Manual review could not be recorded");
      setOverrideRecord(record);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual review could not be recorded.");
    } finally { setOverrideBusy(false); }
  }

  async function runSimulation() {
    setMessage(null);
    setRunning(true);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smiles, target_protein: targetResolution?.status === "resolved" ? targetProtein.trim() || undefined : undefined, uniprot_id: targetResolution?.status === "resolved" ? uniprotId.trim() || undefined : undefined, pdb_id: targetResolution?.status === "resolved" ? pdbId.trim() || undefined : undefined, target_resolution: targetResolution ?? undefined, target_evidence: selectedTarget ? { target_chembl_id: selectedTarget.targetChemblId, gene_symbol: targetResolution?.gene_symbol ?? selectedTarget.geneName ?? null, uniprot_id: selectedTarget.uniprotId ?? null, activity_type: selectedTarget.bestActivityType, value_nM: selectedTarget.bestValue_nM } : undefined, therapeutic_area: therapeuticArea, simulation_options: simulationOptions }),
        signal: AbortSignal.timeout(90_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Layer 1 simulation failed");
      setResult(payload as L1Response);
      setOverrideRecord(null);
      setOverrideReason("");
      setOverrideDecision(payload.analysis?.data?.verdict.verdict === "NO-GO" ? "NO-GO" : "WATCH");
      setActiveStage("in-vitro");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run the Layer 1 simulation.");
    } finally {
      setRunning(false);
    }
  }

  async function runDocking() {
    if (!analysis || targetResolution?.status !== "resolved" || !pdbId.trim()) return;
    setMessage(null);
    setDockJob({ job_id: "", status: "queued", progress: "Submitting docking job…" });
    try {
      const response = await fetch(`${API_ROOT}/api/ai/dock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smiles: analysis.canonical_smiles, pdb_id: pdbId.trim(), exhaustiveness: 8, num_modes: 5 }),
        signal: AbortSignal.timeout(20_000),
      });
      const submitted = await response.json().catch(() => ({})) as { job_id?: string; detail?: string };
      if (!response.ok || !submitted.job_id) throw new Error(submitted.detail ?? "Docking job was not accepted.");
      const poll = async () => {
        const statusResponse = await fetch(`${API_ROOT}/api/ai/dock/status/${encodeURIComponent(submitted.job_id!)}`, { signal: AbortSignal.timeout(15_000) });
        const status = await statusResponse.json().catch(() => ({})) as DockJob;
        if (!statusResponse.ok) throw new Error((status as unknown as { detail?: string }).detail ?? "Docking status could not be retrieved.");
        setDockJob(status);
        if (status.status === "queued" || status.status === "running") window.setTimeout(() => { void poll().catch((error) => setMessage(error instanceof Error ? error.message : "Docking status could not be retrieved.")); }, 2_000);
      };
      await poll();
    } catch (error) {
      setDockJob(null);
      setMessage(error instanceof Error ? error.message : "Could not submit docking job.");
    }
  }

  async function downloadWetLabReport() {
    if (!analysis) return;
    setReportBusy(true);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l1/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis_id: analysis.analysis_id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not generate wet-lab report");
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(new Blob([data.content], { type: "text/markdown" }));
      anchor.download = data.filename ?? "hakase-layer-1-wetlab-report.md";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download report.");
    } finally { setReportBusy(false); }
  }

  if (view === "landing") {
    const enter = () => { navigate(""); setView("workspace"); window.scrollTo({ top: 0 }); };
    if (route === "science") return <SciencePage onNavigate={navigate} onEnter={enter} />;
    if (route === "cases") return <CaseStudiesPage onNavigate={navigate} onEnter={enter} />;
    if (route === "developers") return <DevelopersPage onNavigate={navigate} onEnter={enter} />;
    return <Landing onEnter={enter} onNavigate={navigate} />;
  }

  return <div className="app-shell" data-stage={activeStage}>
    <header className="topbar">
      <button className="brand" onClick={() => { setView("landing"); window.scrollTo({ top: 0 }); }} aria-label="Back to home"><img src={hakaseLogo} alt="HakaseAI" /></button>
      <nav aria-label="Pre-clinical pipeline">
        {STAGES.map((stage, index) => {
          // First-in-human unlocks only when a completed animal study exists to
          // translate — the backend refuses the projection without one.
          const locked = stage.key !== "in-vitro" && (stage.key === "first-in-human" ? !studyId : !canContinue);
          const current = activeStage === stage.key;
          const done = Boolean(analysis) && index < STAGES.findIndex((s) => s.key === activeStage);
          return <button
            key={stage.key}
            className={`stage-step ${current ? "active" : ""} ${done ? "done" : ""}`}
            data-layer={stage.layer}
            disabled={locked}
            title={stage.key === "first-in-human" && !studyId ? "Run a virtual animal study first — the first-in-human layer translates its point of departure." : undefined}
            aria-current={current ? "step" : undefined}
            onClick={() => { setActiveStage(stage.key as typeof activeStage); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            <span className="stage-step-num">{done ? <Check size={12} strokeWidth={3} /> : stage.layer}</span>
            <span className="stage-step-label">{stage.label}</span>
          </button>;
        })}
      </nav>
      <div className="topbar-right">
        {analysis && <span className="topbar-chip"><span className={`status-dot ${tone(analysis.verdict.verdict)}`} /> {analysis.verdict.verdict}</span>}
        <div className="avatar">HC</div>
      </div>
    </header>

    {/* Only Layer 1 renders the fixed input rail, so only it gets the
        two-column `workspace` grid. Every other stage carries its own
        controls inside the page and must run full-bleed — otherwise it is
        squeezed into the second grid column with 374px of dead space beside it. */}
    <main className={activeStage === "in-vitro" ? "workspace" : "confirmation-page"}>
      {activeStage === "in-vitro" && <aside className="input-rail">
        <div className="rail-scroll">
        <div className="rail-head">
          <div><span>SETUP</span><b>Layer 1 screening</b></div>
          <small><Workflow size={13} /> 3 steps</small>
        </div>
        <section className="input-card modality-card">
          <label>Modality</label>
          <div className="selectish"><Atom size={17} /><strong>Small molecule</strong><span className="selectish-ok"><Check size={12} strokeWidth={3} /></span><ChevronDown size={17} /></div>
          <div className="disabled-modalities"><span>Peptide <em>soon</em></span><span>Antibody <em>soon</em></span></div>
        </section>

        <section className="input-card">
          <div className="input-title"><span>01</span><div><b>Structure input</b><small>Provide the molecule for scientific evaluation.</small></div></div>
          <label htmlFor="smiles">SMILES string</label>
          <textarea id="smiles" value={smiles} onChange={(event) => { setSmiles(event.target.value); setTargetStatus("idle"); setTargets([]); setSelectedTarget(null); }} spellCheck="false" />
          <div className="inline-meta"><span><BadgeCheck size={14} /> Structure validation on run</span><span>100–1500 Da</span></div>
          <p className="input-helper">The structure is validated and analyzed when you run the screen.</p>
        </section>

        <section className="input-card">
          <div className="input-title"><span>02</span><div><b>Protein target</b><small>Resolve a biological protein target and its linked identifiers.</small></div></div>
          <button className="secondary-button full" onClick={predictTargets} disabled={targetStatus === "loading" || !smiles.trim()}>{targetStatus === "loading" ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} Predict protein target</button>
          <p className="input-helper">Candidate proteins come with measured activity, confidence, and organism context.</p>
          {targetStatus === "ready" && <div className="target-list">
            {targets.map((target) => <button key={target.targetChemblId} className={`target-option ${selectedTarget?.targetChemblId === target.targetChemblId ? "selected" : ""}`} onClick={() => { setSelectedTarget(target); setTargetProtein(target.targetName); setUniprotId(target.uniprotId ?? ""); setPdbId(target.pdbIds?.[0] ?? ""); setTargetResolution(null); if (target.uniprotId) void resolveTargetValues({ uniprot_id: target.uniprotId, pdb_id: target.pdbIds?.[0] }).catch((error) => setMessage(error instanceof Error ? error.message : "Protein target could not be resolved.")); }}>
              <Target size={15} /><span><b>{target.targetName}</b><small>{target.uniprotId ? `UniProt ${target.uniprotId}` : "Not confidently resolved"} · {target.bestActivityType} {display(target.bestValue_nM)} nM</small><small>{target.organism ? `Organism: ${target.organism}` : "Organism not returned"}</small></span><Check size={15} /></button>)}
          </div>}
          {targetStatus === "empty" && <div className="soft-note"><CircleHelp size={15} /> No reliable protein-target evidence was returned. You can still run a structure-only Layer 1 screen.</div>}
          <div className="target-fields">
            <label>Target protein<input value={targetProtein} onChange={(event) => { setTargetProtein(event.target.value); setTargetResolution(null); setSelectedTarget(null); }} onBlur={() => void resolveTarget("protein")} placeholder="Resolved protein target" /></label>
            <label>UniProt ID<input value={uniprotId} onChange={(event) => { setUniprotId(event.target.value.toUpperCase()); setTargetResolution(null); setSelectedTarget(null); }} onBlur={() => void resolveTarget("uniprot")} placeholder="Validated accession" /></label>
            <label>PDB ID<input value={pdbId} onChange={(event) => { setPdbId(event.target.value.toUpperCase()); setTargetResolution(null); setSelectedTarget(null); }} onBlur={() => void resolveTarget("pdb")} placeholder="Validated structure ID" maxLength={4} /></label>
          </div>
          <button className="text-action" onClick={() => void resolveTarget(targetProtein.trim() ? "protein" : uniprotId.trim() ? "uniprot" : "pdb")} disabled={resolvingTarget || (!targetProtein.trim() && !uniprotId.trim() && !pdbId.trim())}>{resolvingTarget ? <LoaderCircle className="spin" size={14} /> : <BadgeCheck size={14} />} Validate and resolve target</button>
          {targetResolution && <div className={`target-resolution ${targetResolution.status === "resolved" ? "good" : "warn"}`}><b>{targetResolution.status === "resolved" ? "Target resolved" : targetResolution.reason ?? "Not confidently resolved"}</b><span>Confidence: {targetResolution.confidence.replace("_", " ")} · Evidence: {targetResolution.evidence_type.replace("_", " ")}</span>{targetResolution.organism && <span>Organism: {targetResolution.organism}</span>}{targetResolution.limitations.map((limitation) => <small key={limitation}>{limitation}</small>)}</div>}
        </section>

        <section className="input-card compact-input">
          <label htmlFor="area">Therapeutic area <small>optional context</small></label>
          <input id="area" value={therapeuticArea} onChange={(event) => setTherapeuticArea(event.target.value)} />
        </section>

        <section className="input-card simulation-options-card">
          <div className="input-title"><span>03</span><div><b>Simulation options</b><small>Choose the server model groups to include in this Layer 1 run.</small></div></div>
          <label className="simulation-toggle"><span><b>ADMET profiling</b><small>ADMET-AI endpoint ensemble</small></span><input type="checkbox" checked={simulationOptions.admet_profiling} onChange={(event) => setSimulationOptions((current) => ({ ...current, admet_profiling: event.target.checked }))} /></label>
          <label className="simulation-toggle"><span><b>Binding simulation</b><small>BindingML with a resolved UniProt target</small></span><input type="checkbox" checked={simulationOptions.binding_simulation} onChange={(event) => setSimulationOptions((current) => ({ ...current, binding_simulation: event.target.checked }))} /></label>
          <label className="simulation-toggle"><span><b>Toxicity signal detection</b><small>CardioTox and DILI-ML screening</small></span><input type="checkbox" checked={simulationOptions.toxicity_signal_detection} onChange={(event) => setSimulationOptions((current) => ({ ...current, toxicity_signal_detection: event.target.checked }))} /></label>
          {/* This is an audit annotation, not a control. The models are
              calibrated server-side and this value never changes a threshold or
              filters a result — it is recorded with the run so a reviewer's
              stated confidence bar is reconstructable later. It is labelled as
              such rather than styled like a filter that does nothing. */}
          <label className="confidence-control annotation"><span><b>Reviewer confidence annotation: {simulationOptions.confidence_threshold.toFixed(2)}</b><em className="annotation-badge">Recorded, not applied</em><small>Stored with the run for audit. It does not change any calibrated model threshold and does not filter results.</small></span><input type="range" min="0.50" max="0.95" step="0.05" value={simulationOptions.confidence_threshold} onChange={(event) => setSimulationOptions((current) => ({ ...current, confidence_threshold: Number(event.target.value) }))} /><div><span>0.50 Low</span><span>0.95 High</span></div></label>
        </section>
        </div>

        <div className="rail-action">
          <button className="run-button" onClick={runSimulation} disabled={running || !smiles.trim()}>{running ? <LoaderCircle size={19} className="spin" /> : <Play size={19} fill="currentColor" />} {running ? "Running Layer 1…" : "Run in vitro simulation"}</button>
          <small><Workflow size={14} /> Estimated runtime: 10–90 seconds</small>
        </div>
      </aside>}

      <section className={`outcomes ${activeStage === "confirmation" ? "confirmation-outcomes" : ""}`}>
        {message && <div className="toast-error"><X size={17} /><span>{message}</span><button onClick={() => setMessage(null)}><X size={16} /></button></div>}
        {!analysis && <div className="empty-state panel">
          <div className="empty-orb"><Beaker size={28} /></div>
          <h1>Ready when you are</h1>
          <p>Configure the small-molecule inputs on the left, then run the in vitro simulation. Your Layer 1 read will appear here.</p>
          <div className="empty-preview">
            {[
              { icon: <Box size={17} />, label: "3D structure" },
              { icon: <Atom size={17} />, label: "Physicochemistry" },
              { icon: <BrainCircuit size={17} />, label: "ADMET profile" },
              { icon: <Target size={17} />, label: "Target evidence" },
              { icon: <AlertTriangle size={17} />, label: "Safety review" },
              { icon: <ShieldCheck size={17} />, label: "Regulatory" },
            ].map((item) => <div key={item.label}>{item.icon}<span>{item.label}</span></div>)}
          </div>
        </div>}

        {analysis && activeStage === "confirmation" && <ConfirmationWorkspace analysisId={analysis.analysis_id} target={selectedTarget} onBack={() => { setActiveStage("in-vitro"); window.scrollTo({ top: 0, behavior: "smooth" }); }} onContinueIvive={() => { setActiveStage("ivive"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
        {analysis && activeStage === "ivive" && <IviveWorkspace
          analysisId={analysis.analysis_id}
          onBack={() => { setActiveStage("in-vitro"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onContinueAnimal={(context) => { setCascade(context); setActiveStage("animal-cohort"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />}
        {analysis && activeStage === "animal-cohort" && <AnimalStudyWorkspace
          analysisId={analysis.analysis_id}
          cascade={cascade}
          l1Verdict={analysis.verdict.verdict}
          compoundName={analysis.canonical_smiles}
          /* Chemical identifiers for the public-database lookups. These come
             from the Layer-1 regulatory record — a SMILES string will not
             resolve in a substance registry, an InChIKey or a name will. */
          inchikey={String(analysis.regulatory_outlook?.inchikey ?? "") || null}
          preferredName={String(analysis.regulatory_outlook?.identity_name ?? "") || null}
          onBack={() => { setActiveStage("ivive"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onContinueFirstInHuman={(id) => { setStudyId(id); setActiveStage("first-in-human"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />}
        {analysis && activeStage === "first-in-human" && studyId && <FirstInHumanWorkspace
          studyId={studyId}
          /* Measured disposition entered at IVIVE travels the whole cascade, so
             the human projection and the animal study share one set of inputs. */
          overrides={cascade?.overrides}
          onBack={() => { setActiveStage("animal-cohort"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />}

        {analysis && activeStage === "in-vitro" && <>
          <SectionNav />
          <section id="l1-overview" className={`verdict-card ${analysis.verdict.verdict.toLowerCase().replace("-", "")}`}>
            <div className="verdict-copy"><div className="eyebrow">LAYER 1 REVIEW</div><div className="verdict-title"><i /> {analysis.verdict.verdict}</div><h1>{analysis.verdict.headline}</h1><p>{analysis.verdict.rationale}</p><div className="verdict-foot"><BadgeCheck size={15} /> Analysis complete</div></div>
            <div className="decision-stamp" style={{ ["--pct" as string]: checksTotal ? checksCleared / checksTotal : 0 }}><div className="stamp-ring"><span><b>{checksCleared}<i>/{checksTotal}</i></b><small>checks clear</small></span></div></div>
          </section>

          <section className="check-strip panel">
            {analysis.verdict.checks.map((check) => <div className="check-item" key={check.name}><span className={`status-dot ${tone(check.status)}`} /><div><small>{check.name.replace(" local safety model", "")}</small><b>{check.value}</b></div></div>)}
          </section>

          <ModelRunSummary configuration={analysis.simulation_configuration} runs={analysis.optional_model_runs} />

          <div id="l1-structure" className="results-grid">
            <section className="panel structure-panel">
              <SectionHeader icon={<Box size={18} />} eyebrow="STRUCTURE RESULT" title="3D molecular structure" description="Server-generated 3D conformer." />
              <MolViewer structure={analysis.three_dimensional_structure} />
              <div className="smiles-result"><span>Canonical SMILES</span><code>{analysis.canonical_smiles}</code></div>
            </section>
            <section className="panel property-panel">
              <SectionHeader icon={<Atom size={18} />} eyebrow="PHYSICOCHEMISTRY" title="Molecule at a glance" description="Key structure-derived descriptors." />
              <div className="property-grid">{compactDescriptors.map(([key, value]) => <div key={key}><span>{titleCase(key.replace(/_(da|a2)$/, ""))}</span><b>{display(value)}</b>{key.includes("weight") && <small>Da</small>}{key === "tpsa_a2" && <small>Å²</small>}</div>)}</div>
              <details className="more-props"><summary>Show {allDescriptors.length - compactDescriptors.length} more descriptors <ChevronDown size={15} /></summary><div className="all-properties">{allDescriptors.slice(compactDescriptors.length).map(([key, value]) => <div key={key}><span>{titleCase(key)}</span><b>{display(value)}</b></div>)}</div></details>
            </section>
          </div>

          <section id="l1-admet" className="panel admet-panel">
            <SectionHeader icon={<BrainCircuit size={18} />} eyebrow="ADMET PROPERTIES" title="ADMET profile" description="Predicted properties and supporting context." />
            <div className="admet-tabs" role="tablist" aria-label="ADMET property sections">{admetSections.map(([section, endpoints]) => <button key={section} className={activeAdmetSection === section ? "active" : ""} role="tab" aria-selected={activeAdmetSection === section} onClick={() => setActiveAdmetSection(section)}>{ADMET_ICONS[section] ?? <TestTube2 size={16} />}<span>{clientSectionLabel(section)}</span><em>{Object.keys(endpoints).length}</em></button>)}</div>
            <div className="admet-table-shell">
              <div className="admet-table-head"><div>{ADMET_ICONS[activeAdmetSection] ?? <TestTube2 size={17} />}<span><b>{clientSectionLabel(activeAdmetSection)}</b><small>Reported properties</small></span></div><span>{Object.keys(activeAdmetEndpoints).length} properties</span></div>
              <div className="endpoint-table single-column">{Object.values(activeAdmetEndpoints).map((endpoint) => <EndpointRow key={endpoint.endpoint} endpoint={endpoint} />)}</div>
            </div>
          </section>

          {/* The extended in-vitro model catalogue. It is a separate, opt-in
              server job because it runs a much broader model stack than the
              compact Layer 1 contract and includes remote providers. */}
          <div id="l1-bench"><AssayBench smiles={analysis.canonical_smiles} /></div>

          <div id="l1-target"><DockingPanel hasResolvedTarget={targetResolution?.status === "resolved"} pdbId={pdbId} setPdbId={(value) => { setPdbId(value); setTargetResolution(null); }} config={dockingConfig} job={dockJob} onRun={runDocking} /></div>

          <div id="l1-safety" className="review-stack">
            <SelectivityPanel data={selectivity} loading={selectivityLoading} />
            <section className="panel safety-panel">
              <SectionHeader icon={<AlertTriangle size={18} />} eyebrow="SAFETY REVIEW" title="Safety & applicability" description="Predicted safety signals and model applicability." />
              <div className="safety-list">{Object.values(analysis.safety_assessments).map((endpoint) => <EndpointRow key={endpoint.endpoint} endpoint={endpoint} />)}</div>
              <p className="model-note">Screening predictions; these results do not establish clinical safety.</p>
              <div className="domain-box"><Network size={18} /><div><span>Applicability</span>{Object.entries((analysis.tanimoto_applicability.model_domains ?? {}) as Record<string, Record<string, unknown>>).map(([name, outcome]) => <small key={name}>{name}: {titleCase(String(outcome.domain ?? "unavailable"))}</small>)}</div></div>
              <AssayReliability report={analysis.assay_reliability} />
            </section>
            <Regulatory outlook={analysis.regulatory_outlook} />
            {/* Public-database evidence for the resolved target. Assembled by the
                backend in one call; the browser renders what comes back. */}
            <ExternalEvidencePanel
              panel="target"
              identifiers={{
                gene_symbol: targetResolution?.gene_symbol ?? selectedTarget?.geneName ?? null,
                uniprot_id: targetResolution?.uniprot_id ?? selectedTarget?.uniprotId ?? null,
              }}
            />
            <FdaPsgPanel drugName={String(analysis.regulatory_outlook?.identity_name ?? "") || null} />
            <section className="panel stage-gate-panel">
              <SectionHeader icon={<ShieldCheck size={18} />} eyebrow="FINAL REVIEW" title="Stage-gate review" description="Overall recommendation and rationale." />
              <div className={`stage-gate-recommendation ${analysis.verdict.verdict.toLowerCase().replace("-", "")}`}><b>{String(analysis.verdict.recommendation ?? analysis.verdict.verdict)}</b><p>{analysis.verdict.rationale}</p></div>
              <div className="stage-gate-details"><div><span>Major risks</span><b>{display(analysis.verdict.major_risks)}</b></div><div><span>Missing evidence</span><b>{display(analysis.verdict.missing_evidence)}</b></div><div><span>Recommended next experiments</span><b>{display(analysis.verdict.recommended_next_experiments)}</b></div></div>
              {gateNeedsReview && <div className="override-box"><div><AlertTriangle size={17} /><span><b>Manual review required before confirmation</b><small>Record a rationale; it does not alter the original recommendation.</small></span></div>{overrideRecord ? <p><Check size={15} /> Review recorded: {String(overrideRecord.effective_verdict ?? "reviewed")}</p> : <><div className="override-decisions">{(["GO", "WATCH", "NO-GO"] as const).map((decision) => <button key={decision} className={overrideDecision === decision ? "selected" : ""} onClick={() => setOverrideDecision(decision)}>{decision}</button>)}</div><textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Reason for the review decision and planned orthogonal confirmation" /><button className="secondary-button" onClick={recordOverride} disabled={overrideBusy || !overrideReason.trim()}>{overrideBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Record manual review</button></>}</div>}
            </section>
          </div>

          <section id="l1-handoff" className="panel report-panel">
            <div><SectionHeader icon={<BookOpen size={18} />} eyebrow="HANDOFF" title="Wet-lab review report" description="Compiles the exact Layer 1 result, endpoint context, regulatory result, and any recorded review." /></div>
            <div className="handoff-actions"><button className="report-button large" onClick={downloadWetLabReport} disabled={reportBusy}>{reportBusy ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />} Download report</button><button className="continue-button" onClick={() => { setActiveStage("confirmation"); window.scrollTo({ top: 0, behavior: "smooth" }); }} disabled={!canContinue}>{gateNeedsReview && !overrideRecord ? "Record review to continue" : "Continue to confirmation"}<ArrowRight size={16} /></button></div>
          </section>

          <footer className="trace-footer"><span><RefreshCw size={14} /> Analysis complete {result?.provenance?.computed_at ? new Date(result.provenance.computed_at).toLocaleString() : ""}</span></footer>
        </>}
      </section>
    </main>
  </div>;
}

export default App;
