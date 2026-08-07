import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Beaker,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Crosshair,
  Database,
  Dna,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Microscope,
  Play,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";

type TargetEvidence = {
  uniprotId?: string | null;
  geneName?: string | null;
  pdbIds?: string[];
  bestValue_nM?: number;
};

type Props = { analysisId: string; target: TargetEvidence | null; onBack: () => void; onContinueIvive: () => void };
type AnyRecord = Record<string, unknown>;

const stageIcon: Record<string, React.ReactNode> = {
  "0": <Database size={17} />,
  "1": <Dna size={17} />,
  "2": <Microscope size={17} />,
  "3": <Sparkles size={17} />,
  "4": <ShieldCheck size={17} />,
  "5": <FlaskConical size={17} />,
  "6": <Beaker size={17} />,
  "7": <Crosshair size={17} />,
  "8": <Scale size={17} />,
  "9": <ClipboardCheck size={17} />,
};

/**
 * Stage phases. The roster is long enough that a flat list hides which stages
 * actually run together, so the stack is grouped by how a stage executes:
 * evidence carried in, models the server runs, physical jobs the user
 * dispatches, and the rollup that closes the layer.
 */
const STAGE_PHASES: Array<{ id: string; label: string; hint: string; stages: string[] }> = [
  { id: "handoff", label: "Handoff", hint: "Evidence carried in from Layer 1.", stages: ["0"] },
  { id: "models", label: "Server models", hint: "Run synchronously by the backend.", stages: ["1", "3", "4", "6", "7", "8"] },
  { id: "physical", label: "Physical jobs", hint: "Explicitly dispatched; each needs its own inputs.", stages: ["2", "5"] },
  { id: "decision", label: "Decision", hint: "Rollup of everything that ran.", stages: ["9"] },
];

/** Stage-level study context. These are inputs, never results. */
type StageOptions = { dose_mg: string; hill_coefficient: string; herg_ic50_nm: string };

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serverText(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not returned";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "Structured response available";
}

function statusTone(status?: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (text.includes("available") || text.includes("ready")) return "good";
  if (text.includes("unavailable") || text.includes("partial") || text.includes("needs") || text.includes("requires")) return "warn";
  return "neutral";
}

function hasUsableOutcome(response: AnyRecord) {
  const result = isRecord(response.result) ? response.result : null;
  if (!result) return false;
  const presentation = isRecord(response.presentation) ? response.presentation : null;
  const groups = Array.isArray(presentation?.groups) ? presentation.groups.filter(isRecord) : [];
  return groups.length > 0 && result.ml_available !== false && result.available !== false && result.source !== "fallback" && result.source !== "unavailable";
}

function outcomeModelLabel(response: AnyRecord) {
  const stage = isRecord(response.stage) ? response.stage : {};
  return typeof stage.models === "string" ? stage.models : "Backend model output";
}

/**
 * Renders only the presentation contract emitted by the backend for a completed
 * model.  Labels, units and values are selected server-side; this component
 * performs no scientific calculation, scoring or result derivation.
 */
function ServerOutcome({ response }: { response: AnyRecord }) {
  const presentation = isRecord(response.presentation) ? response.presentation : null;
  const groups = Array.isArray(presentation?.groups) ? presentation.groups.filter(isRecord) : [];
  if (!groups.length) return null;
  return <div className="server-outcome">
    {groups.map((group, groupIndex) => {
      const fields = Array.isArray(group.fields) ? group.fields.filter(isRecord).filter((field) => field.value !== null && field.value !== undefined && field.value !== "") : [];
      if (!fields.length) return null;
      return <section key={`${serverText(group.title)}-${groupIndex}`}>
        <h3>{serverText(group.title)}</h3>
        <dl>{fields.map((field, fieldIndex) => {
          const label = serverText(field.label);
          const value = serverText(field.value);
          const narrative = /summary|rationale|reason|limitation|recommendation|interpretation|description|note/i.test(label) || value.length > 180;
          return <div className={narrative ? "server-field narrative" : "server-field"} key={`${label}-${fieldIndex}`}><dt>{label}</dt><dd title={value}>{value}</dd></div>;
        })}</dl>
      </section>;
    })}
  </div>;
}

/** Draws only the λ-window values supplied by the completed backend FEP job. */
function FepWindowChart({ response }: { response: AnyRecord }) {
  const presentation = isRecord(response.presentation) ? response.presentation : null;
  const visualization = isRecord(presentation?.visualization) ? presentation.visualization : null;
  if (visualization?.kind !== "fep_lambda_windows" || !Array.isArray(visualization.series)) return null;
  const points = visualization.series
    .filter(isRecord)
    .map((item) => ({ lambda: Number(item.lambda), dG: Number(item.dG_kcal_mol), stderr: Number(item.stderr_kcal_mol) }))
    .filter((item) => Number.isFinite(item.lambda) && Number.isFinite(item.dG) && Number.isFinite(item.stderr));
  if (points.length < 2) return null;

  const width = 640; const height = 260; const left = 62; const right = 22; const top = 20; const bottom = 42;
  const xMin = Math.min(...points.map((point) => point.lambda)); const xMax = Math.max(...points.map((point) => point.lambda));
  const yMin = Math.min(...points.map((point) => point.dG - point.stderr)); const yMax = Math.max(...points.map((point) => point.dG + point.stderr));
  const xSpan = xMax - xMin || 1; const yPad = Math.max((yMax - yMin) * 0.12, 0.1); const ySpan = (yMax - yMin) + 2 * yPad || 1;
  const x = (value: number) => left + ((value - xMin) / xSpan) * (width - left - right);
  const y = (value: number) => top + (height - top - bottom) - ((value - (yMin - yPad)) / ySpan) * (height - top - bottom);
  const polyline = points.map((point) => `${x(point.lambda)},${y(point.dG)}`).join(" ");

  return <section className="fep-window-chart"><div className="chart-header"><h3>{serverText(visualization.title)}</h3><span>Worker-returned mean ± 1σ</span></div><div className="chart-svg-wrapper"><svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-label="Per-window free-energy estimates"><line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} className="chart-gridline" /><line x1={left} y1={top} x2={left} y2={height - bottom} className="chart-gridline" />{points.map((point, index) => <g key={`${point.lambda}-${index}`}><line x1={x(point.lambda)} y1={y(point.dG - point.stderr)} x2={x(point.lambda)} y2={y(point.dG + point.stderr)} className="fep-error-bar" /><circle cx={x(point.lambda)} cy={y(point.dG)} r="4" className="fep-point" /><text x={x(point.lambda)} y={height - bottom + 17} textAnchor="middle" className="chart-axis-label">{point.lambda.toFixed(2)}</text></g>)}<polyline points={polyline} className="chart-line-mean" /><text x={left + (width - left - right) / 2} y={height - 8} textAnchor="middle" className="chart-title">{serverText(visualization.x_label)}</text><text transform={`rotate(-90 17 ${top + (height - top - bottom) / 2})`} x="17" y={top + (height - top - bottom) / 2} textAnchor="middle" className="chart-title">{serverText(visualization.y_label)}</text></svg></div></section>;
}

export function ConfirmationWorkspace({ analysisId, target, onBack, onContinueIvive }: Props) {
  const [contract, setContract] = useState<AnyRecord | null>(null);
  const [stageResults, setStageResults] = useState<Record<string, AnyRecord>>({});
  const [activeStage, setActiveStage] = useState("0");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subtrack, setSubtrack] = useState<"in-silico" | "virtual-tissue">("in-silico");
  const [pdbId, setPdbId] = useState(target?.pdbIds?.[0] ?? "");
  const [ligandB, setLigandB] = useState("");
  const [fepConfig, setFepConfig] = useState<AnyRecord | null>(null);
  const [dockingConfig, setDockingConfig] = useState<AnyRecord | null>(null);
  const [virtualRun, setVirtualRun] = useState<AnyRecord | null>(null);
  const [options, setOptions] = useState<StageOptions>({ dose_mg: "", hill_coefficient: "", herg_ic50_nm: "" });

  const l1 = isRecord(contract?.l1) ? contract.l1 : undefined;
  const stages = useMemo(() => Array.isArray(contract?.stages) ? contract.stages.filter(isRecord) : [], [contract]);
  /* The configured batch runs the ready synchronous stages only. Docking (2)
     and refinement (5) are always excluded because each needs its own inputs. */
  const readyStages = useMemo(
    () => stages.filter((stage) => stage.status === "ready" && !["2", "5"].includes(String(stage.id ?? ""))),
    [stages],
  );
  const blockedStages = useMemo(
    () => stages.filter((stage) => stage.status !== "ready" && !["2", "5"].includes(String(stage.id ?? ""))),
    [stages],
  );
  const descriptor = isRecord(l1?.descriptors) ? l1.descriptors : {};
  const verdict = isRecord(l1?.verdict) ? l1.verdict : {};
  const review = isRecord(l1?.review) ? l1.review : {};
  const resolution = isRecord(l1?.target_resolution) ? l1.target_resolution : {};
  const virtualTissue = isRecord(contract?.virtual_tissue) ? contract.virtual_tissue : {};
  const virtualModels = Array.isArray(virtualTissue.models) ? virtualTissue.models.filter(isRecord) : [];
  const resolvedUniprot = typeof l1?.uniprot_id === "string" ? l1.uniprot_id : target?.uniprotId;
  const contractFields: Array<[string, unknown]> = [
    ["Canonical SMILES", l1?.canonical_smiles], ["UniProt target", l1?.uniprot_id ?? target?.uniprotId],
    ["Layer 1 gate", verdict.verdict], ["Recorded review", review.effective_verdict],
    ["Molecular weight", descriptor.molecular_weight_da], ["LogP", descriptor.logp],
  ];

  async function request(path: string, body: AnyRecord) {
    const response = await fetch(`${API_ROOT}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : isRecord(detail) && typeof detail.message === "string"
            ? detail.message
            : isRecord(detail) && typeof detail.reason === "string"
              ? detail.reason
              : "The request failed.",
      );
    }
    return payload as AnyRecord;
  }

  async function loadContract() {
    setBusy("contract"); setError(null);
    try { setContract(await request("/api/ai/l2/contract", { analysis_id: analysisId })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the Confirmation contract."); }
    finally { setBusy(null); }
  }

  useEffect(() => { void loadContract(); }, [analysisId]);
  useEffect(() => {
    void fetch(`${API_ROOT}/api/ai/fep/config`).then((response) => response.json()).then((data) => setFepConfig(isRecord(data) ? data : null)).catch(() => setFepConfig({ configured: false, reason: "Refinement configuration could not be read." }));
  }, []);
  useEffect(() => {
    void fetch(`${API_ROOT}/api/ai/dock/config`).then((response) => response.json()).then((data) => setDockingConfig(isRecord(data) ? data : null)).catch(() => setDockingConfig({ configured: false, reason: "Docking configuration could not be read." }));
  }, []);

  /**
   * Assemble the optional study context. Every field is omitted when blank, so
   * an empty box narrows what a stage can report rather than sending a default
   * the user never chose.
   */
  function stageOptions(): AnyRecord | undefined {
    const numeric = (value: string) => {
      const parsed = Number(value.trim());
      return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    const body: AnyRecord = {};
    const dose = numeric(options.dose_mg);
    const hill = numeric(options.hill_coefficient);
    const herg = numeric(options.herg_ic50_nm);
    if (dose !== undefined) body.dose_mg = dose;
    if (hill !== undefined) body.hill_coefficient = hill;
    if (herg !== undefined) body.measured_safety_concentrations = { herg_ic50_nm: herg };
    return Object.keys(body).length ? body : undefined;
  }

  async function runServerStage(stage: string) {
    setBusy(stage); setError(null);
    try {
      const payload = await request("/api/ai/l2/stage", { analysis_id: analysisId, stage, options: stageOptions() });
      setStageResults((previous) => ({ ...previous, [stage]: payload }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Stage run failed."); }
    finally { setBusy(null); }
  }

  async function runConfiguredInSilico() {
    setBusy("in-silico-all"); setError(null);
    try {
      const payload = await request("/api/ai/l2/run-configured", { analysis_id: analysisId, options: stageOptions() });
      const received = Array.isArray(payload.stages) ? payload.stages.filter(isRecord) : [];
      // Only completed backend results are outcomes. Readiness, IDs and blocked
      // stages remain in the stage controls and never occupy the outcome grid.
      const completed = received.filter((item) => String(isRecord(item.stage) ? item.stage.id : "") !== "0" && hasUsableOutcome(item));
      setStageResults((previous) => ({ ...previous, ...Object.fromEntries(completed.map((item) => [String(isRecord(item.stage) ? item.stage.id : "stage"), item])) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Configured Confirmation run failed."); }
    finally { setBusy(null); }
  }

  async function submitJob(kind: "dock" | "fep") {
    const smiles = l1?.canonical_smiles;
    if (typeof smiles !== "string" || !pdbId.trim() || (kind === "fep" && !ligandB.trim())) return;
    setBusy(kind); setError(null);
    try {
      const body = kind === "dock" ? { smiles, pdb_id: pdbId.trim(), exhaustiveness: 8, num_modes: 5 } : { ligand_a_smiles: smiles, ligand_b_smiles: ligandB.trim(), pdb_id: pdbId.trim() };
      const payload = await request(`/api/ai/${kind}`, body);
      const stage = kind === "dock" ? "2" : "5";
      setStageResults((previous) => ({ ...previous, [stage]: { status: "queued", result: payload, provenance: { owner: "asynchronous job" } } }));
      if (kind === "dock" && typeof payload.job_id === "string") {
        const pollDocking = async (): Promise<void> => {
          const response = await fetch(`${API_ROOT}/api/ai/dock/status/${encodeURIComponent(payload.job_id as string)}`);
          const job = await response.json().catch(() => ({})) as AnyRecord;
          if (!response.ok) throw new Error(typeof job.detail === "string" ? job.detail : "Docking status could not be retrieved.");
          // The docking status endpoint supplies this presentation contract on
          // completion; no affinity value or outcome is calculated in React.
          setStageResults((previous) => ({ ...previous, [stage]: { status: job.status, result: job, presentation: job.presentation } }));
          if (job.status === "queued" || job.status === "running") window.setTimeout(() => { void pollDocking().catch((reason) => setError(reason instanceof Error ? reason.message : "Docking status could not be retrieved.")); }, 2_000);
        };
        void pollDocking().catch((reason) => setError(reason instanceof Error ? reason.message : "Docking status could not be retrieved."));
      }
      if (kind === "fep" && typeof payload.job_id === "string") {
        const pollFep = async (): Promise<void> => {
          const response = await fetch(`${API_ROOT}/api/ai/fep/status/${encodeURIComponent(payload.job_id as string)}`);
          const job = await response.json().catch(() => ({})) as AnyRecord;
          if (!response.ok) throw new Error(typeof job.detail === "string" ? job.detail : "FEP status could not be retrieved.");
          setStageResults((previous) => ({ ...previous, [stage]: { status: job.status, result: job.result, presentation: job.presentation } }));
          if (job.status === "queued" || job.status === "running") window.setTimeout(() => { void pollFep().catch((reason) => setError(reason instanceof Error ? reason.message : "FEP status could not be retrieved.")); }, 5_000);
        };
        void pollFep().catch((reason) => setError(reason instanceof Error ? reason.message : "FEP status could not be retrieved."));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Job could not be submitted."); }
    finally { setBusy(null); }
  }

  async function runConfiguredVirtualTissue() {
    setBusy("virtual-all"); setError(null);
    try {
    setVirtualRun(await request("/api/ai/l2/virtual-tissue/run-configured", {
        analysis_id: analysisId,
        oncology: true,
        top_n: 25,
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Configured virtual-tissue run failed."); }
    finally { setBusy(null); }
  }

  return <section className="confirmation-workspace">
    <header className="confirmation-banner">
      <div><p>Layer 2 · Confirmation</p><h1>Evidence reconciliation</h1><span>Run server-configured models, review their returned evidence, then decide whether to progress.</span></div>
      <div className="confirmation-tabs">
        <button className={subtrack === "in-silico" ? "active" : ""} onClick={() => setSubtrack("in-silico")}>In-silico</button>
        <button className={subtrack === "virtual-tissue" ? "active" : ""} onClick={() => setSubtrack("virtual-tissue")}>Virtual tissue</button>
      </div>
    </header>

    {error && <div className="confirmation-error"><AlertTriangle size={18} /><span>{error}</span></div>}
    {busy === "contract" && <div className="confirmation-loading"><LoaderCircle className="spin" size={20} /> Loading the Layer 1 → Layer 2 contract…</div>}

    {contract && <div className="confirmation-grid">
      <aside className="confirmation-rail">
        <div className="contract-rail-head"><span>L1 → L2 HANDOFF</span><b>Server input contract</b></div>
        <div className="contract-summary"><div className="good-line"><ShieldCheck size={16} /> Layer 1 analysis received</div><small>Carried over directly from the completed Layer 1 analysis.</small></div>
        <div className="contract-fields">{contractFields.map(([label, value]) => <div key={label}><span>{label}</span><b title={serverText(value)}>{serverText(value)}</b></div>)}</div>

        {subtrack === "in-silico" ? <>
          {/* The run plan is stated before the button, so what the batch will
              actually execute is visible without expanding every stage card. */}
          <div className="batch-run-card">
            <div><Layers3 size={18} /><b>Run available in-silico models</b></div>
            <p>Runs the synchronous model stages in dependency order. Docking and refinement stay separate because each needs its own inputs and explicit dispatch.</p>
            <div className="run-plan">
              <div className="run-plan-row"><span>Will run</span><b>{readyStages.length ? readyStages.map((stage) => String(stage.id)).join(" · ") : "nothing — no stage is ready"}</b></div>
              <div className="run-plan-row"><span>Blocked</span><b>{blockedStages.length ? blockedStages.map((stage) => String(stage.id)).join(" · ") : "none"}</b></div>
              <div className="run-plan-row"><span>Manual dispatch</span><b>2 · 5</b></div>
            </div>
            <button className="primary-run" onClick={runConfiguredInSilico} disabled={busy === "in-silico-all" || !readyStages.length}>{busy === "in-silico-all" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Run available models</button>
          </div>

          {/* Study context. These are inputs the backend needs to widen what a
              stage can report; leaving one blank never substitutes a default. */}
          <div className="stage-options-card">
            <b>Study context <em>optional</em></b>
            <label>Dose to project (mg)<input inputMode="decimal" value={options.dose_mg} onChange={(event) => setOptions((current) => ({ ...current, dose_mg: event.target.value }))} placeholder="Enables exposure and achieved occupancy" /></label>
            <label>Measured hERG IC50 (nM)<input inputMode="decimal" value={options.herg_ic50_nm} onChange={(event) => setOptions((current) => ({ ...current, herg_ic50_nm: event.target.value }))} placeholder="Converts the hERG liability into a ranked margin" /></label>
            <label>Hill coefficient<input inputMode="decimal" value={options.hill_coefficient} onChange={(event) => setOptions((current) => ({ ...current, hill_coefficient: event.target.value }))} placeholder="Left blank the server assumes n = 1" /></label>
            <small>Supplied values are study inputs recorded with the run. Cooperativity and measured constants are never inferred.</small>
          </div>

          <div className="stage-stack">{STAGE_PHASES.map((phase) => {
            const phaseStages = stages.filter((stage) => phase.stages.includes(String(stage.id ?? "")));
            if (!phaseStages.length) return null;
            return <section className="stage-phase" key={phase.id}>
              <header className="stage-phase-head"><b>{phase.label}</b><small>{phase.hint}</small></header>
              {phaseStages.map((stage) => {
                const id = String(stage.id ?? ""); const result = stageResults[id]; const open = activeStage === id;
                const done = Boolean(result) && hasUsableOutcome(result);
                return <article className={`stage-card ${open ? "open" : ""} ${done ? "done" : ""}`} key={id}>
                  <button onClick={() => setActiveStage(open ? "" : id)}>
                    <span className="stage-number">{id}</span>
                    <span>{stageIcon[id] ?? <CircleDot size={17} />}</span>
                    <strong>{stage.name ? String(stage.name) : `Stage ${id}`}</strong>
                    <em className={`stage-chip ${statusTone(stage.status)}`}>{serverText(stage.status)}</em>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  {open && <div className="stage-detail">
                    <p>{serverText(stage.reason)}</p>
                    {Boolean(stage.models) && <p className="model-line"><b>Backend models</b> {serverText(stage.models)}</p>}
                    {id === "2" ? <>
                      <label>Receptor PDB ID <input value={pdbId} onChange={(event) => setPdbId(event.target.value)} placeholder="Returned target PDB ID" /></label>
                      <small className="fep-config">{dockingConfig?.configured ? "Docking service ready" : serverText(dockingConfig?.reason)}</small>
                      <button className="stage-run" onClick={() => submitJob("dock")} disabled={busy === "dock" || !dockingConfig?.configured || !pdbId.trim()}>{busy === "dock" ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Dispatch docking</button>
                    </> : id === "5" ? <>
                      <label>Ligand B SMILES <input value={ligandB} onChange={(event) => setLigandB(event.target.value)} placeholder="Perturbed ligand SMILES" /></label>
                      <label>Receptor PDB ID <input value={pdbId} onChange={(event) => setPdbId(event.target.value)} placeholder="Returned target PDB ID" /></label>
                      <small className="fep-config">{fepConfig?.configured ? "Refinement service ready" : serverText(fepConfig?.reason)}</small>
                      <button className="stage-run" onClick={() => submitJob("fep")} disabled={busy === "fep" || !fepConfig?.configured || !ligandB.trim() || !pdbId.trim()}>{busy === "fep" ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Dispatch refinement</button>
                    </> : <button className="stage-run" onClick={() => runServerStage(id)} disabled={busy === id || stage.status !== "ready"}>{busy === id ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{stage.status === "ready" ? "Run analysis stage" : serverText(stage.status)}</button>}
                    {result && <><ServerOutcome response={result} /><FepWindowChart response={result} /></>}
                  </div>}
                </article>;
              })}
            </section>;
          })}</div>
        </> : <div className="batch-run-card virtual-batch"><div><Microscope size={18} /><b>Run configured virtual-tissue models</b></div><p>Uses the stored Layer 1 target handoff. Missing datasets or potency evidence are returned as unavailable—not simulated.</p><div className="virtual-model-list">{virtualModels.map((model) => <div key={String(model.id)}><b>{serverText(model.name)}</b><span>{serverText(model.engine)}</span></div>)}</div><button className="primary-run" onClick={runConfiguredVirtualTissue} disabled={busy === "virtual-all" || !resolvedUniprot}>{busy === "virtual-all" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Run virtual-tissue models</button><small>{resolvedUniprot ? `Resolved protein: ${resolvedUniprot}${typeof resolution.gene_symbol === "string" ? ` · ${resolution.gene_symbol}` : ""}` : "A validated UniProt target is required before these models can run."}</small></div>}
      </aside>

      <main className="confirmation-main">
        {subtrack === "in-silico" ? <>
          <section className="confirmation-section"><div className="confirmation-section-title"><Database size={20} /><div><h2>What this sub-track does</h2><p>Confirms the Layer 1 handoff with target, binding, ADMET, safety and IVIVE analyses.</p></div></div><div className="workflow-explainer"><div><b>1. Handoff</b><span>Uses the exact Layer 1 analysis record.</span></div><div><b>2. Model run</b><span>Runs configured synchronous stages.</span></div><div><b>3. Explicit jobs</b><span>Docking and refinement require a user dispatch.</span></div></div></section>
          <section className="confirmation-section"><div className="confirmation-section-title"><Sparkles size={20} /><div><h2>Confirmation outcomes</h2><p>Only completed backend model outputs appear here; the model portfolio is shown on every result.</p></div></div>{Object.entries(stageResults).filter(([, response]) => hasUsableOutcome(response)).length ? <div className="confirmation-result-grid">{Object.entries(stageResults).filter(([, response]) => hasUsableOutcome(response)).map(([stage, response]) => <article key={stage}><header><div><span>Stage {stage}</span><small>{outcomeModelLabel(response)}</small></div><b className={statusTone(response.status)}>{serverText(response.status)}</b></header><ServerOutcome response={response} /><FepWindowChart response={response} /></article>)}</div> : <div className="confirmation-empty"><Microscope size={30} /><b>No completed model outcome yet</b><span>Run a model after Layer 1 has returned target evidence, or dispatch docking/refinement with their required inputs.</span></div>}</section>
        </> : <>
          <section className="confirmation-section"><div className="confirmation-section-title"><Microscope size={20} /><div><h2>What this sub-track does</h2><p>Provides computational projections across configured reference datasets. These are not physical ex-vivo measurements.</p></div></div><div className="virtual-source-grid">{virtualModels.map((model) => <div key={String(model.id)}><b>{serverText(model.name)}</b><span>{serverText(model.requires)}</span></div>)}</div><p className="virtual-limit">{serverText(virtualTissue.limitations)}</p></section>
          <section className="confirmation-section"><div className="confirmation-section-title"><Database size={20} /><div><h2>Virtual-tissue outcomes</h2><p>Completed model outputs appear here. Unavailable datasets are reported, never simulated.</p></div></div>{virtualRun && Array.isArray(virtualRun.models) && virtualRun.models.filter(isRecord).length ? <div className="virtual-results">{virtualRun.models.filter(isRecord).map((model) => <article key={String(model.id)}><header><span>{serverText(model.name)}</span><b className={statusTone(model.status)}>{serverText(model.status)}</b></header>{hasUsableOutcome(model) ? <ServerOutcome response={model} /> : <div className="virtual-unavailable"><b>{String(model.status) === "needs_input" ? "Additional evidence required" : "Result unavailable"}</b><span>{serverText(model.reason)}</span></div>}</article>)}</div> : <div className="confirmation-empty"><Microscope size={30} /><b>No virtual-tissue outcome returned yet</b><span>Run the models after Layer 1 has returned target and potency evidence.</span></div>}</section>
        </>}
        <section className="confirmation-handoff ivive-handoff"><div><b>Continue to IVIVE</b><span>Set a species and study context to generate an exposure projection from this completed Layer 1 analysis.</span></div><button onClick={onContinueIvive}>Continue to IVIVE <ChevronRight size={16} /></button></section>
        <button className="return-l1" onClick={onBack}>Return to in vitro results</button>
      </main>
    </div>}
  </section>;
}
