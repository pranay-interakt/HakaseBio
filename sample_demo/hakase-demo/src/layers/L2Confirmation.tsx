/**
 * Layer 2 — Confirmation.
 *
 * Loads the Layer 1 → Layer 2 handoff contract, runs the synchronous model
 * stages in dependency order, dispatches the two physical jobs explicitly, and
 * renders the rollup. Docking and free-energy refinement are never included in
 * the batch: each needs its own inputs and carries a real compute cost.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Beaker, ChevronDown, ChevronRight, CircleDot,
  ClipboardCheck, Crosshair, Database, Dna, FlaskConical, Layers3, LoaderCircle, Microscope,
  Play, Scale, ShieldCheck, Sparkles,
} from "lucide-react";
import { L2_PHASES } from "../lib/catalogs";
import { num, text, titleCase } from "../lib/format";
import type { CompoundProfile } from "../engine/profile";
import type { L1Record } from "../engine/l1";
import {
  confirmationBlock, fepResult, l2Contract, l2Dossier, runStage, stageRoster,
  virtualTissueRun, type StageMeta, type StageOptions, type StageResult,
} from "../engine/l2";
import { dockingResult } from "../engine/l1";
import { ErrorBarChart, MetricDonut, SegmentDonut } from "../components/charts";
import {
  Card, DataTable, DlGrid, DossierFlow, Field, Notice, PresentationGroups, SectionHeader,
  StatusPill, Tile, TileRow, Unavailable,
} from "../components/ui";

const STAGE_ICON: Record<string, React.ReactNode> = {
  "0": <Database size={16} />, "1": <Dna size={16} />, "2": <Microscope size={16} />,
  "3": <Sparkles size={16} />, "4": <ShieldCheck size={16} />, "5": <FlaskConical size={16} />,
  "6": <Beaker size={16} />, "7": <Crosshair size={16} />, "8": <Scale size={16} />,
  "9": <ClipboardCheck size={16} />,
};

export type L2State = {
  results: Record<string, StageResult>;
  activeStage: string;
  subtrack: "in-silico" | "virtual-tissue";
  pdbId: string;
  ligandB: string;
  options: { dose_mg: string; hill_coefficient: string; herg_ic50_nm: string };
  virtualRun: ReturnType<typeof virtualTissueRun> | null;
  dockJob: ReturnType<typeof dockingResult> | null;
  fepJob: ReturnType<typeof fepResult> | null;
};

export const emptyL2State: L2State = {
  results: {}, activeStage: "0", subtrack: "in-silico", pdbId: "", ligandB: "",
  options: { dose_mg: "", hill_coefficient: "", herg_ic50_nm: "" },
  virtualRun: null, dockJob: null, fepJob: null,
};

type Props = {
  profile: CompoundProfile;
  l1: L1Record;
  executionProfile: "full_cascade" | "in_vitro";
  state: L2State;
  setState: (updater: (current: L2State) => L2State) => void;
  railHost: HTMLElement | null;
  onBack: () => void;
  onContinue?: () => void;
};

export function L2Confirmation({ profile, l1, executionProfile, state, setState, railHost, onBack, onContinue }: Props) {
  const contract = useMemo(() => l2Contract(l1, executionProfile), [l1.analysis_id, executionProfile]);
  const stages = contract.stages;
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setState((current) => ({ ...current, pdbId: current.pdbId || (l1.target_resolution.pdb_id ?? "") })); }, [l1.analysis_id]);

  const readyStages = stages.filter((stage) => stage.status === "ready" && !["0", "2", "5"].includes(stage.id));
  const blockedStages = stages.filter((stage) => !["ready", "requires_explicit_dispatch"].includes(stage.status) && !["2", "5"].includes(stage.id));

  function stageOptions(): StageOptions {
    const numeric = (value: string) => {
      const parsed = Number(value.trim());
      return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    return {
      dose_mg: numeric(state.options.dose_mg),
      hill_coefficient: numeric(state.options.hill_coefficient),
      herg_ic50_nm: numeric(state.options.herg_ic50_nm),
    };
  }

  function executeStage(meta: StageMeta) {
    setBusy(meta.id);
    window.setTimeout(() => {
      const result = runStage(meta.id, profile, l1, meta, stageOptions());
      setState((current) => ({ ...current, results: { ...current.results, [meta.id]: result } }));
      setBusy(null);
    }, 600);
  }

  function runAll() {
    setBusy("all");
    window.setTimeout(() => {
      const options = stageOptions();
      const next: Record<string, StageResult> = { ...state.results };
      for (const meta of stages) {
        if (["0", "2", "5", "9"].includes(meta.id) || meta.status !== "ready") continue;
        next[meta.id] = runStage(meta.id, profile, l1, meta, options);
      }
      const rollupMeta = stages.find((stage) => stage.id === "9");
      if (rollupMeta) next["9"] = confirmationBlock(next, rollupMeta, l1, profile, stages);
      setState((current) => ({ ...current, results: next }));
      setBusy(null);
    }, 1500);
  }

  const executed = Object.entries(state.results).filter(([id, result]) => id !== "0" && result.status === "available");
  const executableCount = stages.filter((stage) => stage.id !== "0").length;

  /* ── rail ─────────────────────────────────────────────────────────────── */
  const rail = railHost && createPortal(<>
    <div className="rail-scroll">
      <div className="rail-head">
        <div><span>L1 → L2 handoff</span><b>Server input contract</b></div>
      </div>

      <div className="notice good" style={{ marginBottom: 0 }}>
        <ShieldCheck size={16} />
        <span><b>Layer 1 analysis received</b><br />Carried over unchanged from the completed screen. Nothing is re-derived here.</span>
      </div>

      <section className="card-input">
        <div className="dl-grid" style={{ gridTemplateColumns: "1fr" }}>
          {([
            ["Canonical SMILES", contract.l1.canonical_smiles],
            ["UniProt target", contract.l1.uniprot_id],
            ["Gene symbol", contract.l1.gene_symbol],
            ["Layer 1 gate", contract.l1.verdict.verdict],
            ["Applicability domain", titleCase(String(contract.l1.applicability_domain))],
            ["Molecular weight", `${num(contract.l1.descriptors.molecular_weight_da)} Da`],
            ["cLogP", num(contract.l1.descriptors.logp)],
            ["TPSA", `${num(contract.l1.descriptors.tpsa_a2)} Å²`],
            ["QED", num(contract.l1.descriptors.qed)],
            ["Safety flags carried", contract.l1.safety_flags.length ? contract.l1.safety_flags.map((flag: any) => `${flag.endpoint} (${flag.risk_class})`).join(", ") : "None"],
            ["Regulatory class", titleCase(String(contract.l1.regulatory_class))],
          ] as Array<[string, unknown]>).map(([label, value], index) => (
            <div key={index}><dt>{label}</dt><dd style={{ wordBreak: "break-all" }}>{text(value)}</dd></div>
          ))}
        </div>
      </section>

      <div className="tabs">
        <button className={state.subtrack === "in-silico" ? "active" : ""} onClick={() => setState((current) => ({ ...current, subtrack: "in-silico" }))}>In-silico</button>
        <button className={state.subtrack === "virtual-tissue" ? "active" : ""} onClick={() => setState((current) => ({ ...current, subtrack: "virtual-tissue" }))}>Tissue context</button>
      </div>

      {state.subtrack === "in-silico" ? <>
        <div className="batch-card">
          <div><Layers3 size={17} style={{ color: "var(--brand-700)" }} /><b>Run available in-silico models</b></div>
          <p>Runs the synchronous model stages in dependency order. Docking and refinement stay separate because each needs its own inputs and its own compute allocation.</p>
          <div className="run-plan">
            <div className="run-plan-row"><span>Will run</span><b>{readyStages.length ? readyStages.map((stage) => stage.id).join(" · ") : "nothing — no stage is ready"}</b></div>
            <div className="run-plan-row"><span>Blocked</span><b>{blockedStages.length ? blockedStages.map((stage) => stage.id).join(" · ") : "none"}</b></div>
            <div className="run-plan-row"><span>Manual dispatch</span><b>2 · 5</b></div>
            <div className="run-plan-row"><span>Rollup</span><b>9</b></div>
          </div>
          <button className="btn primary full" onClick={runAll} disabled={busy !== null || !readyStages.length}>
            {busy === "all" ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Run available models
          </button>
        </div>

        <section className="card-input">
          <div className="step-title"><span>⚙</span><div><b>Study context</b><small>Optional inputs that widen what a stage can report. Leaving one blank narrows the result rather than substituting a default.</small></div></div>
          <Field label="Dose to project (mg)" hint="enables achieved occupancy">
            <input inputMode="decimal" value={state.options.dose_mg} placeholder="e.g. 100"
              onChange={(event) => setState((current) => ({ ...current, options: { ...current.options, dose_mg: event.target.value } }))} />
          </Field>
          <Field label="Measured hERG IC50 (nM)" hint="converts the liability into a ranked margin">
            <input inputMode="decimal" value={state.options.herg_ic50_nm} placeholder="e.g. 12000"
              onChange={(event) => setState((current) => ({ ...current, options: { ...current.options, herg_ic50_nm: event.target.value } }))} />
          </Field>
          <Field label="Hill coefficient" hint="blank assumes n = 1">
            <input inputMode="decimal" value={state.options.hill_coefficient} placeholder="1.0"
              onChange={(event) => setState((current) => ({ ...current, options: { ...current.options, hill_coefficient: event.target.value } }))} />
          </Field>
          <p className="input-helper">Supplied values are study inputs recorded with the run. Cooperativity and measured constants are never inferred from the structure.</p>
        </section>

        {L2_PHASES.map((phase) => {
          const phaseStages = stages.filter((stage) => (phase.stages as readonly string[]).includes(stage.id));
          if (!phaseStages.length) return null;
          return <section className="stage-phase" key={phase.id}>
            <header className="stage-phase-head"><b>{phase.label}</b><small>{phase.hint}</small></header>
            {phaseStages.map((meta) => {
              const result = state.results[meta.id];
              const open = state.activeStage === meta.id;
              const done = result?.status === "available";
              return <article className={`stage-card ${open ? "open" : ""} ${done ? "done" : ""}`} key={meta.id}>
                <button onClick={() => setState((current) => ({ ...current, activeStage: open ? "" : meta.id }))}>
                  <span className="stage-num">{meta.id}</span>
                  {STAGE_ICON[meta.id] ?? <CircleDot size={16} />}
                  <strong>{meta.name}</strong>
                  <StatusPill status={meta.status === "ready" ? "pass" : meta.status === "requires_explicit_dispatch" ? "caution" : "unknown"} label={titleCase(meta.status)} />
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {open && <div className="stage-detail">
                  <p>{meta.reason}</p>
                  <p className="model-line"><b>Models</b> {meta.models}</p>
                  {meta.id === "2" ? <div style={{ marginTop: 11 }}>
                    <Field label="Receptor PDB ID">
                      <input value={state.pdbId} maxLength={4} onChange={(event) => setState((current) => ({ ...current, pdbId: event.target.value.toUpperCase() }))} placeholder="Validated structure" />
                    </Field>
                    <button className="btn full" style={{ marginTop: 9 }} disabled={!state.pdbId.trim() || busy !== null}
                      onClick={() => {
                        setBusy("dock");
                        window.setTimeout(() => {
                          setState((current) => ({ ...current, dockJob: dockingResult(profile, current.pdbId.trim()) }));
                          setBusy(null);
                        }, 1400);
                      }}>
                      {busy === "dock" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Dispatch docking
                    </button>
                  </div> : meta.id === "5" ? <div style={{ marginTop: 11 }}>
                    <Field label="Ligand B SMILES" hint="the perturbed analogue">
                      <input value={state.ligandB} onChange={(event) => setState((current) => ({ ...current, ligandB: event.target.value }))} placeholder="Perturbed ligand" />
                    </Field>
                    <Field label="Receptor PDB ID">
                      <input value={state.pdbId} maxLength={4} onChange={(event) => setState((current) => ({ ...current, pdbId: event.target.value.toUpperCase() }))} placeholder="Validated structure" />
                    </Field>
                    <button className="btn full" style={{ marginTop: 9 }} disabled={!state.ligandB.trim() || !state.pdbId.trim() || busy !== null}
                      onClick={() => {
                        setBusy("fep");
                        window.setTimeout(() => {
                          setState((current) => ({ ...current, fepJob: fepResult(profile, current.ligandB.trim(), current.pdbId.trim()) }));
                          setBusy(null);
                        }, 2200);
                      }}>
                      {busy === "fep" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Dispatch refinement
                    </button>
                    <p className="input-helper">This dispatches a GPU job with a real compute cost. It is never included in a batch run.</p>
                  </div> : meta.id === "9" ? <button className="btn full" style={{ marginTop: 9 }} disabled={busy !== null}
                    onClick={() => {
                      setBusy("9");
                      window.setTimeout(() => {
                        setState((current) => ({ ...current, results: { ...current.results, "9": confirmationBlock(current.results, meta, l1, profile, stages) } }));
                        setBusy(null);
                      }, 500);
                    }}><Play size={14} /> Roll up the executed stages</button>
                    : <button className="btn full" style={{ marginTop: 9 }} disabled={meta.status !== "ready" || busy !== null}
                      onClick={() => executeStage(meta)}>
                      {busy === meta.id ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                      {meta.status === "ready" ? "Run this stage" : titleCase(meta.status)}
                    </button>}
                </div>}
              </article>;
            })}
          </section>;
        })}
      </> : <div className="batch-card">
        <div><Microscope size={17} style={{ color: "var(--brand-700)" }} /><b>Run tissue-context evidence</b></div>
        <p>An optional post-Layer-1 reference-data view, not another wet-lab layer. The engine returns measured tissue and cell-type expression for the resolved target; oncology projections appear only for oncology projects.</p>
        <div className="run-plan">
          {contract.virtual_tissue.models.map((model) => (
            <div className="run-plan-row" key={model.id}><span>{model.name}</span><b>{model.engine}</b></div>
          ))}
        </div>
        <button className="btn primary full" disabled={busy !== null || !contract.l1.uniprot_id}
          onClick={() => {
            setBusy("virtual");
            window.setTimeout(() => {
              setState((current) => ({ ...current, virtualRun: virtualTissueRun(l1, profile) }));
              setBusy(null);
            }, 900);
          }}>
          {busy === "virtual" ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Load tissue context
        </button>
        <p className="input-helper" style={{ marginTop: 9 }}>
          {contract.l1.uniprot_id ? `Resolved protein: ${contract.l1.uniprot_id}${contract.l1.gene_symbol ? ` · ${contract.l1.gene_symbol}` : ""}` : "A validated UniProt target is required before this evidence can load."}
        </p>
      </div>}
    </div>
  </>, railHost);

  const rollup = state.results["9"];

  return <>
    {rail}

    <section className="panel">
      <SectionHeader icon={<Sparkles size={18} />} eyebrow="LAYER 2 · CONFIRMATION" title="Evidence reconciliation" accent="l2"
        description="Run the configured models, review the evidence each returned, then decide whether the package supports progressing to an exposure projection." />
      {executableCount > 0 && <div className="grid-2">
        <MetricDonut value={executed.length} total={executableCount} label="stages complete"
          caption="Completed model outputs. A stage that was blocked or never dispatched is absent from this count, not treated as a pass." />
        <div>
          <TileRow>
            <Tile label="Configured to run" value={readyStages.length} note="Synchronous model stages in dependency order" tone="brand" />
            <Tile label="Awaiting evidence" value={blockedStages.length} note="Blocked on an input the handoff does not carry" tone={blockedStages.length ? "warn" : "good"} />
            <Tile label="Explicit jobs" value={2} note="Docking and free-energy refinement, never batched" />
            <Tile label="Study context supplied" value={Object.values(stageOptions()).filter((value) => value !== undefined).length} unit="/3" note="Dose, hERG IC50 and Hill coefficient" />
          </TileRow>
        </div>
      </div>}
    </section>

    {state.subtrack === "in-silico" ? <>
      <DossierFlow dossier={l2Dossier(
        Object.fromEntries(Object.entries(state.results).map(([id, result]) => [id, result.status])),
        executionProfile,
      )} />

      <section className="panel">
        <SectionHeader icon={<Database size={18} />} eyebrow="WHAT THIS SUB-TRACK DOES" title="Orthogonal confirmation" accent="l2"
          description="Confirms the Layer 1 handoff with independent target, binding, ADME, safety and exposure analyses, then rolls up only what actually ran." />
        <div className="dl-grid">
          <div><dt>1 · Handoff</dt><dd>Uses the exact Layer 1 analysis record. Nothing is recomputed.</dd></div>
          <div><dt>2 · Model run</dt><dd>Runs the configured synchronous stages in dependency order.</dd></div>
          <div><dt>3 · Explicit jobs</dt><dd>Docking and free-energy refinement require a user dispatch and their own inputs.</dd></div>
          <div><dt>4 · Rollup</dt><dd>Stage 9 rolls up only the stages that produced a usable result.</dd></div>
        </div>
      </section>

      {rollup?.status === "available" && (() => {
        const result = rollup.result as any;
        return <section className="panel">
          <SectionHeader icon={<ClipboardCheck size={18} />} eyebrow="STAGE 9" title="Confirmation decision" accent="l2"
            description="The rollup over the stages that actually ran." />
          <div className={`gate-banner ${result.verdict === "PROCEED" ? "go" : result.verdict === "HOLD" ? "nogo" : "cond"}`}>
            <span className="badge">{result.verdict}</span>
            <div><b>Confirmation block</b><p>{result.headline}</p></div>
          </div>
          <div className="grid-2">
            <SegmentDonut
              segments={[
                { key: "pass", label: "Satisfied", value: result.counts.pass, tone: "good" },
                { key: "warn", label: "Reservation", value: result.counts.warn, tone: "warn" },
                { key: "block", label: "Blocking", value: result.counts.block, tone: "bad" },
              ]}
              centreValue={result.counts.pass} centreTotal={result.counts.pass + result.counts.warn + result.counts.block}
              centreLabel="satisfied"
              caption="Each condition is judged independently. A single blocking condition sets the verdict regardless of how many are satisfied."
            />
            <div>
              <TileRow>
                <Tile label="Executable stages" value={result.evidence_completeness.stages_in_roster} note="In this execution profile's roster" />
                <Tile label="Usable results" value={result.evidence_completeness.stages_with_a_usable_result} note={result.evidence_completeness.stages_available.join(", ") || "none"} tone="brand" />
              </TileRow>
              <p className="hint-muted">{result.evidence_completeness.note}</p>
            </div>
          </div>
          {(["block", "warn", "pass"] as const).map((severity) => {
            const conditions = result.conditions.filter((condition: any) => condition.severity === severity);
            if (!conditions.length) return null;
            return <div key={severity}>
              <div className="sub-label">{severity === "block" ? "Blocking conditions" : severity === "warn" ? "Reservations to carry into Layer 3" : "Satisfied conditions"}</div>
              {conditions.map((condition: any, index: number) => (
                <div className={`condition ${severity === "pass" ? "" : severity}`} key={index}>
                  <div className="condition-head">
                    {severity !== "pass" && <span className={`sev ${severity}`}>{severity.toUpperCase()}</span>}
                    <b>{condition.title}</b>
                  </div>
                  <p>{condition.detail}</p>
                </div>
              ))}
            </div>;
          })}
        </section>;
      })()}

      <section className="panel">
        <SectionHeader icon={<Sparkles size={18} />} eyebrow="CONFIRMATION RESULTS" title="Completed model outputs" accent="l2"
          description="Only stages that returned a usable result appear here. Readiness, blocked stages and undispatched jobs stay in the stage controls." />
        {executed.length ? executed.map(([id, result]) => (
          <Card key={id} icon={STAGE_ICON[id]} title={`Stage ${id} — ${result.stage.name}`} subtitle={result.stage.models}
            actions={<StatusPill status="pass" label="Complete" />}>
            <PresentationGroups groups={result.presentation.groups} />
          </Card>
        )) : <div className="empty">
          <div className="orb"><Microscope size={26} /></div>
          <h2>No completed analysis yet</h2>
          <p>Run the available models from the rail, or dispatch docking or free-energy refinement individually.</p>
        </div>}
      </section>

      {state.dockJob && <section className="panel">
        <SectionHeader icon={<Microscope size={18} />} eyebrow="STAGE 2 · PHYSICAL JOB" title="Molecular docking" accent="l2"
          description={`${state.dockJob.result.engine} · receptor ${state.dockJob.result.pdb_id}`} />
        <DataTable
          columns={[
            { key: "m", header: "Mode", render: (row: any) => row.mode },
            { key: "a", header: "Affinity (kcal/mol)", align: "right", render: (row: any) => num(row.affinity_kcal_mol) },
            { key: "l", header: "RMSD l.b.", align: "right", render: (row: any) => num(row.rmsd_lb) },
            { key: "u", header: "RMSD u.b.", align: "right", render: (row: any) => num(row.rmsd_ub) },
          ]}
          rows={state.dockJob.result.poses}
        />
        <DlGrid entries={[
          ["Box method", state.dockJob.result.box.method],
          ["Source residue", state.dockJob.result.box.source_residue],
          ["Runtime", `${num(state.dockJob.result.runtime_seconds)} s`],
          ["Exhaustiveness", state.dockJob.result.exhaustiveness],
        ]} />
        {state.dockJob.result.warnings.map((warning, index) => <p className="limitation" key={index}><AlertTriangle size={13} /> {warning}</p>)}
      </section>}

      {state.fepJob && <section className="panel">
        <SectionHeader icon={<FlaskConical size={18} />} eyebrow="STAGE 5 · PHYSICAL JOB" title="Free-energy refinement" accent="l2"
          description={state.fepJob.result.engine} />
        <ErrorBarChart
          title="Per-window free-energy estimate"
          subtitle="Worker-returned mean ± 1σ across the alchemical path"
          points={(state.fepJob.presentation.visualization.series as any[]).map((point) => ({ x: point.lambda, y: point.dG_kcal_mol, error: point.stderr_kcal_mol }))}
          xLabel="λ (alchemical coupling parameter)" yLabel="Cumulative ΔG (kcal/mol)"
          footnote="A relative free-energy perturbation returns the difference between two ligands, never an absolute affinity."
        />
        <div className="mt"><PresentationGroups groups={state.fepJob.presentation.groups} /></div>
      </section>}
    </> : <>
      <section className="panel">
        <SectionHeader icon={<Microscope size={18} />} eyebrow="TISSUE CONTEXT" title="What this sub-track does" accent="l2"
          description="Computational projections across configured reference datasets. These are not physical ex-vivo measurements, and an unavailable dataset is reported rather than simulated." />
        <DataTable
          columns={[
            { key: "n", header: "Model", render: (row: any) => <b>{row.name}</b> },
            { key: "e", header: "Engine", render: (row: any) => row.engine },
            { key: "r", header: "Requires", render: (row: any) => row.requires },
          ]}
          rows={contract.virtual_tissue.models as any}
        />
        <p className="limitation"><AlertTriangle size={13} /> {contract.virtual_tissue.limitations}</p>
      </section>

      <section className="panel">
        <SectionHeader icon={<Database size={18} />} eyebrow="OUTCOMES" title="Virtual-tissue outcomes" accent="l2"
          description="Completed model outputs appear here. Unavailable datasets are reported, never simulated." />
        {state.virtualRun ? state.virtualRun.models.map((model: any) => (
          model.status === "available"
            ? <Card key={model.id} icon={<Microscope size={16} />} title={model.name} subtitle={model.engine} actions={<StatusPill status="pass" label="Live" />}>
              <PresentationGroups groups={model.presentation.groups} />
            </Card>
            : <Unavailable key={model.id} title={model.name} reason={model.reason} />
        )) : <div className="empty">
          <div className="orb"><Microscope size={26} /></div>
          <h2>No tissue-context outcome yet</h2>
          <p>Load the reference datasets from the rail once Layer 1 has returned a resolved target.</p>
        </div>}
      </section>
    </>}

    <section className="panel">
      <div className="row between">
        <div>
          <b style={{ fontSize: 14 }}>{onContinue ? "Continue to IVIVE" : "In-vitro evidence package complete"}</b>
          <p className="hint-muted" style={{ marginTop: 4 }}>
            {onContinue
              ? "Set a species and study context to generate a whole-body exposure projection from this completed evidence package."
              : "This project is scoped to in-vitro screening and confirmation. The complete package remains saved here for review."}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={onBack}>Return to Layer 1</button>
          {onContinue
            ? <button className="btn primary" onClick={onContinue}>Continue to IVIVE <ArrowRight size={15} /></button>
            : <BadgeCheck size={22} style={{ color: "var(--good)" }} />}
        </div>
      </div>
    </section>
  </>;
}
