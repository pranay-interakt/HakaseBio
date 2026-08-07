import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Boxes, Database,
  Download, FlaskConical, GitCompare, Layers, LoaderCircle, Microscope, Play,
  Rabbit, Scale, ShieldCheck, Split, Target, Waves,
} from "lucide-react";
import type { Gate } from "./StageGatePanel";
import {
  API_ROOT, Card, DataTable, PresentationGroups, RunProgress, StatusPill, downloadMarkdown,
  num, text, titleCase, type Group,
} from "./ui";
import {
  BiodistributionCard, DdiCard, DesignConformanceCard, DoseComparisonCard,
  EvidenceCard, ModelPanelCard, PointsOfDepartureCard, ReadinessWarnings,
  ResolvedInputsCard, SafetyPharmacologyCard, StudyOutcomesCard,
  ToxicokineticsCard, ToxicologyCard, type Biodistribution, type Curve,
  type DesignConformance, type Ddi, type ModelPanel, type PointsOfDeparture,
  type SafetyPharmacology, type StudyOutcomes, type Toxicokinetics,
  type ToxicologyPanel,
} from "./L3Blocks";
import { OrganRiskBodyMap, OrganRiskSummary, type OrganRisk } from "./OrganRiskBodyMap";
import { ExternalEvidencePanel } from "./ExternalEvidencePanel";

export type CascadeContext = {
  gate: Gate;
  species: string;
  strain: string;
  /* Measured disposition inputs entered at IVIVE. They outrank the ML
     prediction in `pk_ivive`, so they must travel with the dossier — running
     the animal study on predicted disposition after the exposure projection
     was corrected by measurement would silently split the two apart. */
  overrides?: Record<string, number>;
};

type Summary = { median?: number; p05?: number; p95?: number };
type Arm = {
  available?: boolean;
  reason?: string;
  arm?: { label?: string; dose_mg_per_kg?: number; route?: string; frequency?: string | null };
  confidence?: { level?: string; rationale?: string };
  cohort?: { time?: number[]; curves?: Record<string, Curve>; endpoints?: Record<string, Record<string, Summary>> };
  warnings?: string[];
};
type Criterion = { status?: string; rationale?: string };

type StudyRecord = {
  available?: boolean;
  reason?: string;
  study_id?: string;
  analysis_id?: string;
  smiles?: string;
  study_summary?: Record<string, any>;
  readiness_warnings?: string[];
  gate?: Record<string, any>;
  signoff?: Record<string, any>;
  resolved_inputs?: Record<string, any>;
  arms?: Arm[];
  pkpd?: {
    per_arm?: { arm?: { label?: string }; target_coverage?: Record<string, any> }[];
    dose_proportionality?: { available?: boolean; beta_slope?: number; classification?: string };
    exposure_response?: Record<string, any>;
  };
  biodistribution?: Biodistribution;
  toxicokinetics?: Toxicokinetics;
  toxicology?: ToxicologyPanel;
  safety_pharmacology?: SafetyPharmacology;
  organ_risk?: OrganRisk;
  ddi?: Ddi;
  points_of_departure?: PointsOfDeparture;
  model_panel?: ModelPanel;
  study_outcomes?: StudyOutcomes;
  safety?: {
    anchors?: Record<string, any>;
    per_arm_margins?: { arm?: string; dose_mg_per_kg?: number; margin_to_allometric_noael?: number | null; margin_to_ld50?: number | null }[];
    hazard_flags?: { endpoint?: string; signal?: unknown; probability?: unknown }[];
  };
  sensitivity?: { available?: boolean; dominant_driver?: string; ranking?: { input?: string; max_abs_sensitivity?: number }[] };
  evidence?: Record<string, any>;
  stage_gate?: { recommendation?: string; headline?: string; criteria?: Record<string, Criterion>; value_of_information?: string[] };
  presentation?: { groups?: Group[] };
  selected_scientific_models?: Array<{ block?: string; model?: string; provenance?: string }>;
};

type EngineOption = { id?: string; name?: string; available?: boolean; version?: string; description?: string };
type Contract = {
  source?: { potency?: any; target?: Record<string, any>; smiles?: string; therapeutic_area?: string | null };
  readiness?: { overall_ready?: boolean; checks?: { block?: string; ready?: boolean; note?: string }[] };
  study_design_options?: {
    species?: { species?: string; strain?: string; default_strain?: boolean }[];
    routes?: string[];
    frequencies?: string[];
    engines?: EngineOption[];
    guidelines?: Array<{ id: string; name: string; duration_window_h: number[]; animals_per_sex_per_group: number; min_dose_groups: number; control_required: boolean }>;
  };
};

type Props = {
  analysisId: string;
  onBack: () => void;
  onContinueFirstInHuman?: (studyId: string) => void;
  cascade?: CascadeContext | null;
  l1Verdict?: string;
  /** Display label for the inherited-dossier chain (the canonical SMILES). */
  compoundName?: string;
  /** Registry identifiers for the public-database hazard lookups. */
  inchikey?: string | null;
  preferredName?: string | null;
};

/* Result sections. The record is large enough that one scroll is unusable, so
   it is grouped the way a preclinical package is actually reviewed. */
const TABS = [
  { key: "decision", label: "Decision", icon: <ShieldCheck size={15} /> },
  { key: "pk", label: "PK & exposure", icon: <Activity size={15} /> },
  { key: "distribution", label: "Distribution", icon: <Boxes size={15} /> },
  { key: "toxicology", label: "Toxicology", icon: <Microscope size={15} /> },
  { key: "interactions", label: "Interactions", icon: <Split size={15} /> },
  { key: "translation", label: "Translation", icon: <Scale size={15} /> },
  { key: "evidence", label: "Evidence", icon: <Database size={15} /> },
  { key: "provenance", label: "Provenance", icon: <Layers size={15} /> },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function ArmChart({ time, curve, unit }: { time?: number[]; curve?: Curve; unit: string }) {
  if (!time || !curve || !time.length || !curve.mean.length) return null;
  const width = 560, height = 240, pl = 60, pr = 16, pt = 16, pb = 34;
  const cw = width - pl - pr, ch = height - pt - pb;
  const xMin = time[0], xMax = time[time.length - 1];
  const yMax = Math.max(...curve.p95) * 1.15 || 1;
  const gx = (t: number) => pl + ((t - xMin) / (xMax - xMin || 1)) * cw;
  const gy = (c: number) => pt + ch - (c / (yMax || 1)) * ch;
  const mean = curve.mean.map((c, i) => `${gx(time[i])},${gy(c)}`).join(" ");
  const ribbon = [...curve.p95.map((c, i) => `${gx(time[i])},${gy(c)}`), ...curve.p05.map((c, i) => `${gx(time[i])},${gy(c)}`).reverse()].join(" ");
  const yTicks = Array.from({ length: 5 }, (_, i) => (i * yMax) / 4);
  const xTicks = Array.from({ length: 6 }, (_, i) => xMin + (i * (xMax - xMin)) / 5);
  return (
    <div className="chart-svg-wrapper">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        {yTicks.map((v, i) => (<g key={`y${i}`}><line x1={pl} y1={gy(v)} x2={width - pr} y2={gy(v)} className="chart-gridline" /><text x={pl - 8} y={gy(v) + 4} textAnchor="end" className="chart-axis-label">{v < 0.1 ? v.toFixed(3) : v.toFixed(1)}</text></g>))}
        {xTicks.map((v, i) => (<text key={`x${i}`} x={gx(v)} y={height - pb + 16} textAnchor="middle" className="chart-axis-label">{v.toFixed(0)}</text>))}
        <text transform={`rotate(-90 16 ${pt + ch / 2})`} x={16} y={pt + ch / 2} textAnchor="middle" className="chart-title">{unit}</text>
        <text x={pl + cw / 2} y={height - 6} textAnchor="middle" className="chart-title">Time (h)</text>
        <polygon points={ribbon} className="chart-ribbon" />
        <polyline points={mean} className="chart-line-mean" />
      </svg>
    </div>
  );
}

export function AnimalStudyWorkspace({ analysisId, onBack, onContinueFirstInHuman, cascade, l1Verdict, compoundName, inchikey, preferredName }: Props) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [species, setSpecies] = useState(cascade?.species ?? "rat");
  const [strain, setStrain] = useState(cascade?.strain ?? "sprague_dawley");
  const [sex, setSex] = useState("male");
  const [route, setRoute] = useState("ORAL");
  const [doses, setDoses] = useState("5, 25, 100");
  const [includeControl, setIncludeControl] = useState(true);
  const [frequency, setFrequency] = useState("QD");
  const [duration, setDuration] = useState("48");
  const [cohortSize, setCohortSize] = useState("10");
  const [formulation, setFormulation] = useState("plain");
  const [engine, setEngine] = useState("auto");
  const [evidence, setEvidence] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [record, setRecord] = useState<StudyRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("decision");
  const [preflight, setPreflight] = useState<{ warnings?: string[]; design_conformance?: DesignConformance } | null>(null);

  useEffect(() => {
    void fetch(`${API_ROOT}/api/ai/l3/contract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis_id: analysisId }) })
      .then((r) => r.json()).then((c) => setContract(c)).catch(() => setContract(null));
  }, [analysisId]);

  const speciesOptions = contract?.study_design_options?.species ?? [];
  const doseGroups = useMemo(() => doses.split(",").map((d) => Number(d.trim())).filter((d) => d > 0), [doses]);
  const validInputs = doseGroups.length >= 1 && Number(duration) > 0 && Number(cohortSize) >= 2;

  function doseGroupPayload() {
    const groups = doseGroups.map((d) => ({ dose_mg_per_kg: d }));
    return includeControl ? [{ label: "Control", dose_mg_per_kg: 0, is_control: true }, ...groups] : groups;
  }

  /* Pre-run design check. The backend returns the guideline conformance verdict
     so a non-conformant design is visible before the cohort simulation is paid
     for. Debounced — this fires while the user is still typing. */
  useEffect(() => {
    if (!validInputs) { setPreflight(null); return; }
    const timer = window.setTimeout(() => {
      void fetch(`${API_ROOT}/api/ai/l3/design`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          animal: { species, strain: strain || null, sex },
          dose_groups: doseGroupPayload(),
          route, frequency: frequency || null,
          duration_h: Number(duration), formulation: formulation.trim(),
          cohort_size: Number(cohortSize),
        }),
      })
        .then((r) => r.json())
        .then((payload) => setPreflight(payload?.available ? payload : null))
        .catch(() => setPreflight(null));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [analysisId, species, strain, sex, route, doses, includeControl, frequency, duration, formulation, cohortSize]);

  async function runStudy() {
    setBusy(true); setError(null); setRecord(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l3/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          animal: { species, strain: strain || null, sex },
          dose_groups: doseGroupPayload(),
          route, frequency: frequency || null,
          duration_h: Number(duration), formulation: formulation.trim(),
          cohort_size: Number(cohortSize), collect_public_evidence: evidence, engine,
          ...(cascade?.overrides && Object.keys(cascade.overrides).length ? { overrides: cascade.overrides } : {}),
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const d = payload?.detail;
        throw new Error(typeof d === "string" ? d : d?.reason ?? "The virtual study could not be completed.");
      }
      if (payload?.available === false) { setError(payload.reason ?? "The study could not be simulated as designed."); return; }
      setRecord(payload as StudyRecord);
      setTab("decision");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The virtual study could not be completed.");
    } finally { setBusy(false); }
  }

  async function downloadReport() {
    if (!record?.study_id) return;
    setReportBusy(true);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l3/report/${encodeURIComponent(record.study_id)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "The study report could not be generated.");
      downloadMarkdown(payload.markdown, `hakase-animal-study-${record.study_id}.md`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The study report could not be downloaded.");
    } finally { setReportBusy(false); }
  }

  const gate = record?.stage_gate;
  const gateClass = gate?.recommendation === "GO" ? "l3-gate-go" : gate?.recommendation === "NO-GO" ? "l3-gate-nogo" : "l3-gate-cond";
  const target = contract?.source?.target ?? {};

  return <section className="ivive-workspace">
    <header className="ivive-banner">
      <div><p>Layer 3 · Animal Cohort</p><h1>Virtual Preclinical Study Engine</h1><span>Design a virtual animal study over the completed disposition evidence — dose groups, target coverage, biodistribution, the regulatory toxicology panel, safety pharmacology, interactions, points of departure and a stage-gate recommendation. Every number is model-, evidence-, or mechanism-derived; nothing is fabricated.</span></div>
      <div className="ivive-banner-mark"><Rabbit size={27} /><span>Preclinical workflow</span></div>
    </header>

    {cascade?.gate?.signoff && (
      <section className="l3-cascade">
        <div className="l3-cascade-head">
          <Layers size={17} />
          <div>
            <b>Inherited dossier</b>
            <span>Evidence carried forward from the sealed Layer 2 → Layer 3 gate. The animal study is parameterised from this record, not re-derived.</span>
          </div>
          <span className="l3-cascade-seal"><BadgeCheck size={14} /> Sealed</span>
        </div>
        <div className="l3-cascade-chain">
          <div className="l3-cascade-node">
            <small>Layer 1 · In Vitro</small>
            <b>{l1Verdict ?? "Analysis complete"}</b>
            {compoundName && <code title={compoundName}>{compoundName.length > 28 ? `${compoundName.slice(0, 28)}…` : compoundName}</code>}
          </div>
          <span className="l3-cascade-arrow" />
          <div className="l3-cascade-node">
            <small>Layer 2 · Confirmation</small>
            <b>Sealed at gate</b>
            <code>{cascade.gate.counts?.warn ?? 0} warning{(cascade.gate.counts?.warn ?? 0) === 1 ? "" : "s"} acknowledged</code>
          </div>
          <span className="l3-cascade-arrow" />
          <div className="l3-cascade-node">
            <small>IVIVE · Exposure</small>
            <b>{cascade.species}{cascade.strain ? ` · ${cascade.strain}` : ""}</b>
            <code>disposition handed off</code>
          </div>
          <span className="l3-cascade-arrow" />
          <div className="l3-cascade-node l3-cascade-node-current">
            <small>Layer 3 · Animal Cohort</small>
            <b>Ready to design</b>
            <code>this layer</code>
          </div>
        </div>
        <div className="l3-cascade-sign">
          <ShieldCheck size={14} />
          <span>
            Signed by <strong>{cascade.gate.signoff.name}</strong>
            {cascade.gate.signoff.role ? ` · ${cascade.gate.signoff.role}` : ""}
            {cascade.gate.signoff.signed_at ? ` · ${new Date(cascade.gate.signoff.signed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
        </div>
      </section>
    )}

    {!cascade?.gate?.signoff && (
      <div className="l3-unsealed">
        <AlertTriangle size={17} />
        <div>
          <b>No sealed gate on this session</b>
          <span>Run the IVIVE exposure projection and sign the stage gate to carry the in-vitro and confirmation evidence forward. The backend will refuse an unsigned study.</span>
        </div>
      </div>
    )}

    <div className="ivive-layout">
      <aside className="ivive-controls">
        <div className="ivive-control-heading"><FlaskConical size={19} /><div><b>Study design</b><span>Species, route, dose groups, schedule, and cohort settings.</span></div></div>
        <label>Species<select value={species} onChange={(e) => {
          const next = e.target.value; setSpecies(next);
          const match = speciesOptions.find((s) => s.species === next && s.default_strain);
          setStrain(match?.strain ?? "");
        }}>
          {(speciesOptions.length ? [...new Set(speciesOptions.map((s) => s.species))] : ["rat", "mouse", "dog", "monkey"]).map((sp) => <option key={sp} value={sp}>{sp ? sp[0].toUpperCase() + sp.slice(1) : sp}</option>)}
        </select></label>
        <label>Strain<input value={strain} onChange={(e) => setStrain(e.target.value)} placeholder="e.g. sprague_dawley" /></label>
        <label>Sex<select value={sex} onChange={(e) => setSex(e.target.value)}><option value="male">Male</option><option value="female">Female</option><option value="both">Both</option></select></label>
        <label>Route<select value={route} onChange={(e) => setRoute(e.target.value)}>{(contract?.study_design_options?.routes ?? ["IV", "ORAL", "SC"]).map((r) => <option key={r} value={r}>{r === "ORAL" ? "Oral" : r === "IV" ? "Intravenous" : r === "SC" ? "Subcutaneous" : r}</option>)}</select></label>
        <label>Dose groups (mg/kg, comma-separated)<input value={doses} onChange={(e) => setDoses(e.target.value)} placeholder="5, 25, 100" /></label>
        <label className="l3-check"><input type="checkbox" checked={includeControl} onChange={(e) => setIncludeControl(e.target.checked)} /> Include a concurrent vehicle control group</label>
        <label>Dosing schedule<select value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="">Single dose</option><option value="QD">QD (once daily)</option><option value="BID">BID (twice daily)</option><option value="TID">TID (three times daily)</option></select></label>
        <label>Study duration (hours)<input type="number" min="1" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label>Formulation<input value={formulation} onChange={(e) => setFormulation(e.target.value)} placeholder="e.g. plain" /></label>
        <label>Virtual cohort size / arm<input type="number" min="2" step="1" value={cohortSize} onChange={(e) => setCohortSize(e.target.value)} /></label>
        <label>PBPK simulation engine<select value={engine} onChange={(e) => setEngine(e.target.value)}>
          {(contract?.study_design_options?.engines ?? [{ id: "auto", name: "Automatic" }]).map((op) => (
            <option key={op.id} value={op.id} disabled={op.available === false}>
              {op.name}{op.version ? ` v${op.version}` : ""}{op.available === false ? " — unavailable" : ""}
            </option>
          ))}
        </select></label>
        <label className="l3-check"><input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} /> Query public animal evidence (ChEMBL, EPA, PubChem)</label>

        {/* Pre-run guideline conformance — visible while the design is still cheap to change */}
        {preflight?.design_conformance && !record && (
          <div className={`preflight ${preflight.design_conformance.conformant ? "ok" : "gap"}`}>
            <div className="preflight-head">
              <StatusPill status={preflight.design_conformance.conformant ? "pass" : "caution"} label={preflight.design_conformance.conformant ? "Conformant" : `${preflight.design_conformance.gaps?.length ?? 0} gap${(preflight.design_conformance.gaps?.length ?? 0) === 1 ? "" : "s"}`} />
              <span>{preflight.design_conformance.closest_guideline}</span>
            </div>
            {(preflight.design_conformance.gaps?.length ?? 0) > 0 && <ul>
              {preflight.design_conformance.gaps!.map((gap, i) => <li key={i}>{gap}</li>)}
            </ul>}
            {(preflight.warnings?.length ?? 0) > 0 && <ul className="preflight-warnings">
              {preflight.warnings!.map((w, i) => <li key={i}>{w}</li>)}
            </ul>}
          </div>
        )}

        <div className="ivive-note"><ShieldCheck size={16} /><span>A screening projection over a validated PBPK exposure engine — not a substitute for an in-vivo study. Non-human clearance driven by human-trained ML is flagged low-confidence.</span></div>
        <button className="primary-run ivive-run" onClick={runStudy} disabled={busy || !validInputs}>{busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />} {busy ? "Simulating study…" : "Run virtual study"}</button>
      </aside>

      <main className="ivive-main">
        {contract?.readiness && !record && !busy && (
          <div className="l3-readiness">
            <div className="l3-readiness-head"><Activity size={18} /><b>Simulation readiness</b><span className={contract.readiness.overall_ready ? "l3-ready-yes" : "l3-ready-no"}>{contract.readiness.overall_ready ? "Ready" : "Blocked"}</span></div>
            <ul>{(contract.readiness.checks ?? []).map((c, i) => <li key={i}><span className={c.ready ? "l3-dot-ok" : "l3-dot-no"} />{c.block}{c.note ? <em> — {c.note}</em> : null}</li>)}</ul>
            {contract.source?.potency ? <p className="l3-hint"><Target size={14} /> Target potency available (Kd {num(contract.source.potency.value_nM)} nM) — target coverage will be computed.</p> : <p className="l3-hint l3-hint-muted"><Target size={14} /> No target potency in the record — coverage sought from ChEMBL or marked not predicted.</p>}
          </div>
        )}

        {contract?.study_design_options?.guidelines && !record && !busy && (
          <Card icon={<Scale size={16} />} title="Guideline envelopes your design is checked against">
            <DataTable
              columns={[
                { key: "n", header: "Guideline", render: (r: any) => r.name },
                { key: "d", header: "Duration window (h)", align: "right", render: (r: any) => `${r.duration_window_h[0]} – ${r.duration_window_h[1]}` },
                { key: "a", header: "Animals / sex / group", align: "right", render: (r: any) => r.animals_per_sex_per_group },
                { key: "g", header: "Min dose groups", align: "right", render: (r: any) => r.min_dose_groups },
                { key: "c", header: "Control", render: (r: any) => r.control_required ? "Required" : "Optional" },
              ]}
              rows={contract.study_design_options.guidelines}
            />
          </Card>
        )}

        {error && <div className="ivive-error"><AlertTriangle size={18} /><span>{error}</span></div>}
        {busy && <RunProgress
          title={`Running the virtual preclinical study — ${doseGroups.length} dose group${doseGroups.length === 1 ? "" : "s"}`}
          typicalSeconds={120}
          steps={[
            "Resolving disposition inputs",
            "PBPK cohort simulation per arm",
            "Toxicokinetics and dose proportionality",
            "Biodistribution and organ exposure",
            "Toxicology and safety pharmacology",
            "Interactions and points of departure",
            "Stage gate and report assembly",
          ]}
        />}
        {!record && !busy && !error && !contract?.readiness && <div className="ivive-empty"><Rabbit size={32} /><b>Design a virtual animal study</b><span>Set the species and dose groups, then run the completed analysis through the preclinical study engine.</span></div>}

        {record?.available && (
          <section className="ivive-results">
            <div className="l3-engine-badge">
              <FlaskConical size={14} />
              <span>Simulated with <strong>{String(record.study_summary?.simulation_engine ?? "PBPK engine")}</strong></span>
              {record.study_summary?.engine_used === "mrgsolve" && <span className="l3-xval">cross-validated vs kernel</span>}
              <span className="l3-study-id">Study {String(record.study_id ?? "").slice(0, 8)}</span>
            </div>

            <ReadinessWarnings warnings={record.readiness_warnings} />

            {gate && (
              <div className={`l3-gate ${gateClass}`}>
                <div className="l3-gate-badge">{gate.recommendation}</div>
                <div><b>Stage-gate recommendation</b><p>{gate.headline}</p></div>
              </div>
            )}

            <nav className="l3-tabs" role="tablist">
              {TABS.map((entry) => (
                <button key={entry.key} role="tab" aria-selected={tab === entry.key}
                  className={tab === entry.key ? "active" : ""} onClick={() => setTab(entry.key)}>
                  {entry.icon}<span>{entry.label}</span>
                </button>
              ))}
            </nav>

            {/* ── Decision ── */}
            {tab === "decision" && <>
              {gate?.criteria && (
                <Card icon={<ShieldCheck size={16} />} title="Decision criteria">
                  <div className="l3-criteria">{Object.entries(gate.criteria).map(([k, v]) => (
                    <div key={k} className="l3-criterion"><div className="l3-criterion-head"><strong>{titleCase(k)}</strong><StatusPill status={v.status} /></div><span>{v.rationale}</span></div>
                  ))}</div>
                  {gate.value_of_information?.length ? <div className="l3-voi"><b>Recommended next measurements</b><ul>{gate.value_of_information.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></div> : null}
                </Card>
              )}

              {record.presentation?.groups && (
                <Card icon={<Layers size={16} />} title="Study summary" subtitle="The server-owned presentation contract — the backend decides which fields appear and how they are labelled.">
                  <PresentationGroups groups={record.presentation.groups} />
                </Card>
              )}

              {record.safety && (
                <Card icon={<Scale size={16} />} title="Safety margins">
                  <div className="l3-safety-anchors">
                    <div><b>Evidence NOAEL</b><span>{record.safety.anchors?.evidence_noael?.value_mg_kg_day ? `${num(record.safety.anchors.evidence_noael.value_mg_kg_day)} mg/kg/day` : "not located"}</span></div>
                    <div><b>Allometric NOAEL (model)</b><span>{record.safety.anchors?.allometric_mtd_noael?.available ? `${num(record.safety.anchors.allometric_mtd_noael.estimated_noael_mg_kg_study_species)} mg/kg (${record.safety.anchors.allometric_mtd_noael.confidence})` : "not predicted"}</span></div>
                    <div><b>Preferred point of departure</b><span>{record.points_of_departure?.preferred_pod ? `${num(record.points_of_departure.preferred_pod.dose_mg_per_kg)} mg/kg` : "not selected"}</span></div>
                  </div>
                  {record.safety.per_arm_margins?.some((m) => m.margin_to_allometric_noael != null) && (
                    <DataTable
                      columns={[
                        { key: "a", header: "Arm", render: (m: any) => m.arm },
                        { key: "d", header: "Dose (mg/kg)", align: "right", render: (m: any) => num(m.dose_mg_per_kg) },
                        { key: "n", header: "Margin → NOAEL", align: "right", render: (m: any) => m.margin_to_allometric_noael != null ? `${num(m.margin_to_allometric_noael)}×` : "—" },
                        { key: "l", header: "Margin → LD50", align: "right", render: (m: any) => m.margin_to_ld50 != null ? `${num(m.margin_to_ld50)}×` : "—" },
                      ]}
                      rows={record.safety.per_arm_margins}
                    />
                  )}
                  {record.safety.hazard_flags?.length ? <div className="l3-hazards"><b>Hazard flags</b>{record.safety.hazard_flags.map((h, i) => <span key={i} className="l3-hazard">{h.endpoint}: {String(h.signal ?? "—")}{typeof h.probability === "number" ? ` (${(h.probability as number).toFixed(2)})` : ""}</span>)}</div> : null}
                </Card>
              )}

              {record.sensitivity?.available && (
                <Card icon={<GitCompare size={16} />} title="Sensitivity & uncertainty">
                  <p>The exposure prediction is most sensitive to <strong>{record.sensitivity.dominant_driver}</strong>. Ranked drivers:</p>
                  <ul className="l3-sens">{(record.sensitivity.ranking ?? []).map((r, i) => <li key={i}><code>{r.input}</code><span className="l3-sens-bar"><span style={{ width: `${Math.min(100, Math.abs(r.max_abs_sensitivity ?? 0) * 100)}%` }} /></span>{num(r.max_abs_sensitivity)}</li>)}</ul>
                </Card>
              )}
            </>}

            {/* ── PK & exposure ── */}
            {tab === "pk" && <>
              <Card icon={<Activity size={16} />} title="Plasma PK & target coverage by dose group">
                <div className="l3-arm-grid">
                  {(record.arms ?? []).map((arm, i) => {
                    if (!arm.available) return <div key={i} className="l3-arm l3-arm-fail"><b>{arm.arm?.label ?? "Arm"} — unavailable</b><span>{arm.reason}</span></div>;
                    const plasma = arm.cohort?.endpoints?.plasma ?? {};
                    const cov = (record.pkpd?.per_arm ?? []).find((p) => p.arm?.label === arm.arm?.label)?.target_coverage as any;
                    return (
                      <div key={i} className="l3-arm">
                        <div className="l3-arm-head"><b>{arm.arm?.label} · {num(arm.arm?.dose_mg_per_kg)} mg/kg</b>{arm.confidence?.level === "low" && <span className="l3-pill l3-pill-caution" title={arm.confidence?.rationale}>low confidence</span>}</div>
                        <ArmChart time={arm.cohort?.time} curve={arm.cohort?.curves?.plasma} unit="Plasma (mg/L)" />
                        <dl className="l3-metrics">
                          <div><dt>Cmax</dt><dd>{num(plasma.c_max?.median)} mg/L</dd></div>
                          <div><dt>AUC</dt><dd>{num(plasma.auc?.median)} mg·h/L</dd></div>
                          <div><dt>t½</dt><dd>{num(plasma.t_half?.median)} h</dd></div>
                          <div><dt>Coverage</dt><dd>{cov?.available ? `${(cov.average_occupancy * 100).toFixed(0)}% avg occ.` : "not predicted"}</dd></div>
                        </dl>
                        {(arm.warnings?.length ?? 0) > 0 && <div className="l3-arm-warnings">{arm.warnings!.map((w, j) => <small key={j}><AlertTriangle size={11} /> {w}</small>)}</div>}
                      </div>
                    );
                  })}
                </div>
              </Card>
              <ToxicokineticsCard tk={record.toxicokinetics} />
              <DoseComparisonCard pkpd={record.pkpd} />
            </>}

            {/* ── Distribution ── */}
            {tab === "distribution" && <>
              <BiodistributionCard bio={record.biodistribution} arms={record.arms} />
              {record.organ_risk?.available ? (
                <Card
                  icon={<Boxes size={16} />}
                  title="Target-organ map"
                  subtitle="The mechanistic hazard panel joined onto the simulated tissue exposure. An organ is a concern only where a flagged mechanism and meaningful exposure coincide."
                  note={record.organ_risk.limitations}
                >
                  <OrganRiskSummary risk={record.organ_risk} />
                  <OrganRiskBodyMap risk={record.organ_risk} />
                </Card>
              ) : record.organ_risk && (
                <Card icon={<Boxes size={16} />} title="Target-organ map"><p className="l3-hint-muted">{record.organ_risk.reason}</p></Card>
              )}
            </>}

            {/* ── Toxicology ── */}
            {tab === "toxicology" && <>
              <ToxicologyCard tox={record.toxicology} />
              <SafetyPharmacologyCard sp={record.safety_pharmacology} />
              <StudyOutcomesCard outcomes={record.study_outcomes} />
            </>}

            {/* ── Interactions ── */}
            {tab === "interactions" && <DdiCard ddi={record.ddi} />}

            {/* ── Translation ── */}
            {tab === "translation" && <>
              <PointsOfDepartureCard pod={record.points_of_departure} />
              <Card icon={<ArrowRight size={16} />} title="Hand off to the first-in-human layer" subtitle="Layer 4 consumes this study record: its points of departure, toxicology summary, potency and disposition.">
                <p>
                  The preferred point of departure and its exposure are the inputs the first-in-human layer translates
                  through the FDA (2005) body-surface-area conversion and reconciles against MABEL.
                </p>
                <button className="continue-button" onClick={() => record.study_id && onContinueFirstInHuman?.(record.study_id)} disabled={!record.study_id || !onContinueFirstInHuman}>
                  Continue to first in human <ArrowRight size={16} />
                </button>
              </Card>
            </>}

            {/* ── Evidence ── */}
            {tab === "evidence" && <>
              <EvidenceCard evidence={record.evidence} />
              <ExternalEvidencePanel
                panel="hazard"
                identifiers={{ inchikey: inchikey ?? null, compound_name: preferredName ?? null }}
              />
              <ExternalEvidencePanel
                panel="target"
                identifiers={{ gene_symbol: target.gene_symbol ?? null, uniprot_id: target.uniprot_id ?? null }}
              />
            </>}

            {/* ── Provenance ── */}
            {tab === "provenance" && <>
              <ResolvedInputsCard resolved={record.resolved_inputs} />
              <ModelPanelCard panel={record.model_panel} />
              {(record.selected_scientific_models?.length ?? 0) > 0 && (
                <Card icon={<BadgeCheck size={16} />} title="Selected scientific models" subtitle="What actually produced the numbers in this study.">
                  <DataTable
                    columns={[
                      { key: "b", header: "Block", render: (r: any) => <b>{r.block}</b> },
                      { key: "m", header: "Model", render: (r: any) => r.model },
                      { key: "p", header: "Provenance", render: (r: any) => r.provenance },
                    ]}
                    rows={record.selected_scientific_models ?? []}
                  />
                </Card>
              )}
              {record.signoff && (
                <Card icon={<ShieldCheck size={16} />} title="Gate signature carried onto this record">
                  <dl className="resolved-grid">
                    <div><dt>Name</dt><dd>{text(record.signoff.name)}</dd></div>
                    <div><dt>Role</dt><dd>{text(record.signoff.role)}</dd></div>
                    <div><dt>Signed at</dt><dd>{record.signoff.signed_at ? new Date(record.signoff.signed_at).toLocaleString() : "—"}</dd></div>
                    <div><dt>Acknowledged warnings</dt><dd>{text(record.signoff.acknowledged_codes)}</dd></div>
                  </dl>
                  {record.signoff.justification && <p className="l3-hint-muted">{record.signoff.justification}</p>}
                </Card>
              )}
            </>}

            <div className="l3-actions">
              <button className="report-button large" onClick={downloadReport} disabled={reportBusy}>
                {reportBusy ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />} Download study report
              </button>
              <button className="continue-button" onClick={() => record.study_id && onContinueFirstInHuman?.(record.study_id)} disabled={!record.study_id || !onContinueFirstInHuman}>
                Continue to first in human <ArrowRight size={16} />
              </button>
            </div>
            <button className="return-l1" onClick={onBack}><ArrowLeft size={16} /> Return to IVIVE</button>
          </section>
        )}
      </main>
    </div>
  </section>;
}

export { Waves };
