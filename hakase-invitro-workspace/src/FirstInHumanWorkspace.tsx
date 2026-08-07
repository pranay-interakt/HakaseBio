/**
 * Layer 4 — First-in-Human Translation workspace.
 *
 * Structured exactly like `AnimalStudyWorkspace`: the left rail collects the
 * clinical-design choices a pharmacologist makes, and the main column renders
 * the projection the backend computed. Nothing here derives a dose, a margin,
 * a ladder or a verdict — `l4/pipeline.py` does all of it and every number
 * below is read straight out of the returned record.
 *
 * The block this layer exists to show is the starting-dose reconciliation:
 * EMA/CHMP/SWP/28367/07 Rev.1 requires the NOAEL/HED route and MABEL to be
 * derived *independently* and the lower value to govern. Both are shown side by
 * side with their fold difference, because a large divergence is a finding, not
 * a rounding detail.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BadgeCheck, BookOpen, Download, FlaskConical,
  Gauge, Landmark, LoaderCircle, Play, Scale, Stethoscope, Syringe, TrendingUp, Users,
} from "lucide-react";
import {
  API_ROOT, Card, DataTable, PresentationGroups, RunProgress, StatusPill, Unavailable,
  downloadMarkdown, num, pct, text, titleCase, type Group,
} from "./ui";
import { ExternalEvidencePanel } from "./ExternalEvidencePanel";

type ContractCheck = { block?: string; ready?: boolean; requires?: string; note?: string | null };
type RiskFactor = { id: string; label: string; additional_factor: number };
type Region = { id: string; name: string; application: string; framework: string; region_specific?: string[] };
type ChecklistItem = { id: string; requirement: string; guideline: string; satisfiable_by_simulation: boolean; contribution: string };

type Contract = {
  status?: string;
  source?: Record<string, any>;
  inherited?: Record<string, any>;
  readiness?: { overall_ready?: boolean; checks?: ContractCheck[]; limitations?: string };
  clinical_design_options?: {
    routes?: string[];
    frequencies?: string[];
    escalation_schemes?: Array<{ id: string; name: string; reference: string }>;
    risk_factors?: RiskFactor[];
    reference_human_weight_kg?: number;
    cohort_defaults?: Record<string, any>;
    regulatory_regions?: Region[];
    ind_checklist_items?: ChecklistItem[];
    benefit_risk?: { requires?: string; note?: string };
  };
};

type Projection = {
  available?: boolean;
  reason?: string;
  projection_id?: string;
  study_id?: string;
  animal_species?: string;
  route?: string;
  frequency?: string | null;
  indication?: string | null;
  translation?: Record<string, any>;
  human_dose_exposure_calibration?: Record<string, any>;
  mabel?: Record<string, any>;
  pharmacologically_active_dose?: Record<string, any>;
  starting_dose?: Record<string, any>;
  allometric_cross_check?: Record<string, any>;
  escalation_ladder?: Record<string, any>;
  human_exposures?: Record<string, any>;
  exposure_margins?: Record<string, any>;
  safety_pharmacology_margins?: Record<string, any>;
  trial_design?: Record<string, any>;
  clinical_precedent?: Record<string, any>;
  sub_studies?: Record<string, any>;
  ind_gate?: Record<string, any>;
  benefit_risk?: Record<string, any>;
  gate?: Record<string, any>;
  presentation?: { groups?: Group[] };
  selected_scientific_models?: Array<{ block?: string; model?: string; provenance?: string }>;
};

type Props = {
  studyId: string;
  onBack: () => void;
  /* Measured disposition carried from IVIVE. The human projection must run on
     the same disposition the animal study did, or the exposure margin between
     them compares two different molecules' worth of assumptions. */
  overrides?: Record<string, number>;
};

export function FirstInHumanWorkspace({ studyId, onBack, overrides }: Props) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [route, setRoute] = useState("ORAL");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("168");
  const [cohortSize, setCohortSize] = useState("20");
  const [bodyWeight, setBodyWeight] = useState("60");
  const [scheme, setScheme] = useState("modified_fibonacci");
  const [levels, setLevels] = useState("7");
  const [fold, setFold] = useState("2");
  const [maxDose, setMaxDose] = useState("");
  const [riskFlags, setRiskFlags] = useState<Record<string, boolean>>({});
  const [dltInput, setDltInput] = useState("");
  const [sadCohort, setSadCohort] = useState("8");
  const [madCohort, setMadCohort] = useState("12");
  const [madFrequency, setMadFrequency] = useState("QD");
  const [indication, setIndication] = useState("");
  const [region, setRegion] = useState("FDA");
  const [attested, setAttested] = useState<Record<string, boolean>>({});
  const [indOverride, setIndOverride] = useState("");
  const [precedent, setPrecedent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [record, setRecord] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContractError(null);
    void fetch(`${API_ROOT}/api/ai/l4/contract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study_id: studyId }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "The first-in-human contract could not be retrieved.");
        setContract(payload as Contract);
      })
      .catch((reason) => setContractError(reason instanceof Error ? reason.message : String(reason)));
  }, [studyId]);

  const options = contract?.clinical_design_options ?? {};
  const dltProbabilities = dltInput
    .split(",").map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);

  async function runProjection() {
    setBusy(true); setError(null); setRecord(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l4/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: studyId,
          route,
          frequency: frequency || null,
          duration_h: Number(duration),
          cohort_size: Number(cohortSize),
          body_weight_kg: Number(bodyWeight),
          risk_flags: riskFlags,
          escalation_scheme: scheme,
          escalation_levels: Number(levels),
          escalation_fold: Number(fold) > 1 ? Number(fold) : 2,
          max_dose_mg: maxDose.trim() ? Number(maxDose) : null,
          dlt_probabilities: dltProbabilities.length ? dltProbabilities : null,
          sad_cohort_size: Number(sadCohort),
          mad_cohort_size: Number(madCohort),
          mad_frequency: madFrequency,
          collect_precedent: precedent,
          indication: indication.trim() || null,
          regulatory_region: region,
          ind_declared_complete: attested,
          ind_override_justification: indOverride.trim() || null,
          ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : detail?.reason ?? "The first-in-human projection could not be completed.");
      }
      setRecord(payload as Projection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The first-in-human projection could not be completed.");
    } finally { setBusy(false); }
  }

  async function downloadDossier() {
    if (!record?.projection_id) return;
    setReportBusy(true);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l4/report/${encodeURIComponent(record.projection_id)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "The dossier could not be generated.");
      downloadMarkdown(payload.markdown, `hakase-first-in-human-${record.projection_id}.md`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The dossier could not be downloaded.");
    } finally { setReportBusy(false); }
  }

  const gate = record?.gate;
  const gateClass = gate?.recommendation === "READY" ? "l3-gate-go" : gate?.recommendation === "NOT-READY" ? "l3-gate-nogo" : "l3-gate-cond";
  const starting = record?.starting_dose ?? {};
  const validInputs = Number(duration) > 0 && Number(cohortSize) >= 2 && Number(bodyWeight) > 0 && Number(levels) >= 1;

  return <section className="ivive-workspace">
    <header className="ivive-banner">
      <div>
        <p>Layer 4 · First in Human</p>
        <h1>First-in-Human Translation Engine</h1>
        <span>
          Translate the completed animal study into a defensible human starting dose, escalation ladder,
          exposure margin and Phase-1 design. Every quantity is produced by a published regulatory
          calculation or the same PBPK engine that produced the animal exposure — nothing is fabricated.
        </span>
      </div>
      <div className="ivive-banner-mark"><Syringe size={27} /><span>Clinical translation</span></div>
    </header>

    {contractError && <div className="ivive-error"><AlertTriangle size={18} /><span>{contractError}</span></div>}

    {contract?.source && <section className="l3-cascade">
      <div className="l3-cascade-head">
        <BadgeCheck size={17} />
        <div>
          <b>Inherited from the animal study</b>
          <span>The first-in-human layer consumes this record; it does not re-run the preclinical science.</span>
        </div>
        <span className="l3-cascade-seal">Study {String(contract.source.study_id ?? "").slice(0, 8)}</span>
      </div>
      <div className="l3-cascade-chain">
        <div className="l3-cascade-node">
          <small>Animal species</small><b>{titleCase(String(contract.source.animal_species ?? "—"))}</b>
          <code>{String(contract.source.animal_route ?? "")} · {(contract.source.animal_dose_groups_mg_kg ?? []).join(", ")} mg/kg</code>
        </div>
        <span className="l3-cascade-arrow" />
        <div className="l3-cascade-node">
          <small>Animal stage gate</small><b>{text(contract.source.stage_gate)}</b>
          <code>{(contract.inherited?.high_hazard_domains ?? []).length} high-hazard domain(s)</code>
        </div>
        <span className="l3-cascade-arrow" />
        <div className="l3-cascade-node">
          <small>Point of departure</small>
          <b>{text(contract.inherited?.preferred_pod?.name)}</b>
          <code>{num(contract.inherited?.preferred_pod?.dose_mg_per_kg)} mg/kg</code>
        </div>
        <span className="l3-cascade-arrow" />
        <div className="l3-cascade-node l3-cascade-node-current">
          <small>Layer 4 · First in Human</small><b>Ready to design</b><code>this layer</code>
        </div>
      </div>
    </section>}

    <div className="ivive-layout">
      <aside className="ivive-controls">
        <div className="ivive-control-heading"><Stethoscope size={19} /><div><b>Clinical design</b><span>Route, schedule, escalation, cohorts and the regulatory context.</span></div></div>

        <label>Clinical route<select value={route} onChange={(e) => setRoute(e.target.value)}>
          {(options.routes ?? ["ORAL", "IV", "SC"]).map((r) => <option key={r} value={r}>{r === "ORAL" ? "Oral" : r === "IV" ? "Intravenous" : r === "SC" ? "Subcutaneous" : r}</option>)}
        </select></label>
        <label>Dosing schedule<select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="">Single dose</option>
          {(options.frequencies ?? ["QD", "BID"]).filter((f) => f !== "SINGLE").map((f) => <option key={f} value={f}>{f}</option>)}
        </select></label>
        <label>Simulation window (hours)<input type="number" min="1" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label>Virtual cohort size<input type="number" min="2" step="1" value={cohortSize} onChange={(e) => setCohortSize(e.target.value)} /></label>
        <label>Reference body weight (kg)<input type="number" min="1" step="1" value={bodyWeight} onChange={(e) => setBodyWeight(e.target.value)} /></label>

        <div className="l4-group-label">Escalation</div>
        <label>Scheme<select value={scheme} onChange={(e) => setScheme(e.target.value)}>
          {(options.escalation_schemes ?? [{ id: "modified_fibonacci", name: "Modified Fibonacci", reference: "" }]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>Dose levels<input type="number" min="1" max="20" step="1" value={levels} onChange={(e) => setLevels(e.target.value)} /></label>
        {scheme !== "modified_fibonacci" && <label>Fold per step<input type="number" min="1.1" step="0.1" value={fold} onChange={(e) => setFold(e.target.value)} /></label>}
        <label>Maximum planned dose (mg, optional)<input type="number" min="0" step="1" value={maxDose} onChange={(e) => setMaxDose(e.target.value)} placeholder="Leave blank for no cap" /></label>

        <div className="l4-group-label">FDA (2005) safety-factor risk flags</div>
        <p className="l4-group-note">Each flag raises the safety factor above the default 10× and is itemised in the output.</p>
        {(options.risk_factors ?? []).map((factor) => (
          <label key={factor.id} className="l3-check">
            <input type="checkbox" checked={Boolean(riskFlags[factor.id])}
              onChange={(e) => setRiskFlags((current) => ({ ...current, [factor.id]: e.target.checked }))} />
            {factor.label} <em>×{factor.additional_factor}</em>
          </label>
        ))}

        <div className="l4-group-label">Phase 1 cohorts</div>
        <label>SAD cohort size<input type="number" min="2" step="1" value={sadCohort} onChange={(e) => setSadCohort(e.target.value)} /></label>
        <label>MAD cohort size<input type="number" min="2" step="1" value={madCohort} onChange={(e) => setMadCohort(e.target.value)} /></label>
        <label>MAD frequency<select value={madFrequency} onChange={(e) => setMadFrequency(e.target.value)}>
          {["QD", "BID", "TID", "Q12H", "Q8H"].map((f) => <option key={f} value={f}>{f}</option>)}
        </select></label>

        <div className="l4-group-label">Dose–toxicity assumption (optional)</div>
        <p className="l4-group-note">
          This platform predicts hazard mechanisms, not human dose-limiting-toxicity rates. Supply one DLT
          probability per dose level to simulate how the 3+3 rule behaves against that assumption; leave it
          blank and the operating characteristics are reported as not simulable rather than guessed.
        </p>
        <label>DLT probabilities per level<input value={dltInput} onChange={(e) => setDltInput(e.target.value)} placeholder="0.02, 0.05, 0.1, 0.2, 0.33" /></label>

        <div className="l4-group-label">Regulatory context</div>
        <label>Indication<input value={indication} onChange={(e) => setIndication(e.target.value)} placeholder="Required for the benefit-risk assessment" /></label>
        <label>Regulatory region<select value={region} onChange={(e) => setRegion(e.target.value)}>
          {(options.regulatory_regions ?? [{ id: "FDA", name: "United States FDA" }] as Region[]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
        <label className="l3-check"><input type="checkbox" checked={precedent} onChange={(e) => setPrecedent(e.target.checked)} /> Query clinical precedent (ClinicalTrials.gov, ChEMBL)</label>

        <details className="l4-attestation">
          <summary>Sponsor attestations ({Object.values(attested).filter(Boolean).length})</summary>
          <p className="l4-group-note">
            Tick a requirement your programme has generated outside this platform. It is recorded as an
            attestation and stamped as unverified — this platform never treats a simulated study as a
            completed one.
          </p>
          {(options.ind_checklist_items ?? []).filter((i) => !i.satisfiable_by_simulation).map((item) => (
            <label key={item.id} className="l3-check">
              <input type="checkbox" checked={Boolean(attested[item.id])}
                onChange={(e) => setAttested((current) => ({ ...current, [item.id]: e.target.checked }))} />
              {item.requirement}
            </label>
          ))}
          <label>Override justification<textarea value={indOverride} onChange={(e) => setIndOverride(e.target.value)} placeholder="Recorded verbatim; it cannot make an ungenerated study exist." rows={3} /></label>
        </details>

        <div className="ivive-note">
          <Scale size={16} />
          <span>
            A computational aid for protocol design. It is not regulatory clearance and does not substitute
            for the nonclinical studies ICH M3(R2) requires before human dosing.
          </span>
        </div>
        <button className="primary-run ivive-run" onClick={runProjection} disabled={busy || !validInputs}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
          {busy ? "Projecting…" : "Run first-in-human projection"}
        </button>
      </aside>

      <main className="ivive-main">
        {contract?.readiness && !record && !busy && <div className="l3-readiness">
          <div className="l3-readiness-head">
            <Gauge size={18} /><b>Translation readiness</b>
            <span className={contract.readiness.overall_ready ? "l3-ready-yes" : "l3-ready-no"}>
              {contract.readiness.overall_ready ? "Ready" : "Blocked"}
            </span>
          </div>
          <ul>{(contract.readiness.checks ?? []).map((check, i) => (
            <li key={i}>
              <span className={check.ready ? "l3-dot-ok" : "l3-dot-no"} />
              {check.block}
              {check.note ? <em> — {check.note}</em> : null}
            </li>
          ))}</ul>
          <p className="l3-limitation">{contract.readiness.limitations}</p>
        </div>}

        {contract?.inherited && !record && !busy && <Card icon={<Scale size={16} />} title="Points of departure inherited from the animal study">
          <DataTable
            columns={[
              { key: "n", header: "Anchor", render: (r: any) => r.name },
              { key: "d", header: "Dose (mg/kg)", align: "right", render: (r: any) => num(r.dose_mg_per_kg) },
              { key: "s", header: "Strength", render: (r: any) => <StatusPill status={r.strength === "strong" ? "pass" : r.strength === "moderate" ? "caution" : "unknown"} label={titleCase(String(r.strength ?? ""))} /> },
              { key: "p", header: "Provenance", render: (r: any) => r.provenance },
            ]}
            rows={contract.inherited.points_of_departure ?? []}
          />
        </Card>}

        {error && <div className="ivive-error"><AlertTriangle size={18} /><span>{error}</span></div>}
        {busy && <RunProgress
          title="Projecting the first-in-human plan"
          typicalSeconds={90}
          steps={[
            "Translating animal points of departure",
            "Human PBPK dose-exposure calibration",
            "MABEL, PAD and starting dose",
            "Escalation ladder and 3+3 operating characteristics",
            "Safety margins and sub-study feasibility",
            "Filing gate and benefit-risk",
          ]}
        />}

        {record && record.available === false && <Unavailable title="First-in-human projection" reason={record.reason} />}

        {/* When no starting dose could be derived the projection is not
            "empty" — the layer still returns the readiness gate, the
            sub-study feasibility, the filing checklist and the benefit-risk
            context, all of which are driven by the inherited L3 record rather
            than by the dose ladder. Rendering only the failure would hide
            work the backend actually did. */}
        {record && <section className="ivive-results">
          {gate && <div className={`l3-gate ${gateClass}`}>
            <div className="l3-gate-badge">{gate.recommendation}</div>
            <div><b>First-in-human readiness</b><p>{gate.headline}</p></div>
          </div>}

          {gate?.criteria && <Card icon={<BadgeCheck size={16} />} title="Readiness criteria" note={gate.limitations}>
            <div className="l3-criteria">
              {Object.entries(gate.criteria as Record<string, any>).map(([key, value]) => (
                <div key={key} className="l3-criterion">
                  <div className="l3-criterion-head"><strong>{titleCase(key)}</strong><StatusPill status={value.status} /></div>
                  <span>{value.rationale}</span>
                </div>
              ))}
            </div>
            {(gate.required_before_dosing?.length ?? 0) > 0 && <div className="l3-voi">
              <b>Required before dosing</b>
              <ul>{gate.required_before_dosing.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul>
            </div>}
          </Card>}

          {/* ── the block this layer exists for ── */}
          {starting.available ? <Card
            icon={<Syringe size={16} />}
            title="Recommended starting dose"
            subtitle="EMA (2017) requires the NOAEL/HED route and MABEL to be derived independently, with the lower value governing."
            note={starting.limitations}
          >
            <div className="fih-headline">
              <div>
                <small>Recommended starting dose</small>
                <b>{num(starting.recommended_starting_dose_total_mg)} mg</b>
                <span>{num(starting.recommended_starting_dose_mg_per_kg, 5)} mg/kg at {num(record.human_dose_exposure_calibration?.reference_body_weight_kg ?? starting.reference_human_weight_kg)} kg</span>
              </div>
              <div>
                <small>Governed by</small>
                <b>{starting.governing_approach_name}</b>
                <span>The lowest defensible approach governs.</span>
              </div>
            </div>

            <div className="fih-approaches">
              {(starting.approaches ?? []).map((approach: any) => (
                <div key={approach.id} className={`fih-approach ${approach.id === starting.governing_approach ? "governing" : ""} ${approach.available ? "" : "absent"}`}>
                  <div className="fih-approach-head">
                    <b>{approach.name}</b>
                    {approach.id === starting.governing_approach && <StatusPill status="pass" label="Governs" />}
                  </div>
                  {approach.available ? <>
                    <div className="fih-approach-dose">{num(approach.dose_total_mg)} mg <small>{num(approach.dose_mg_per_kg, 5)} mg/kg</small></div>
                    <p>{approach.basis}</p>
                    <small>{approach.provenance}{approach.strength ? ` · point of departure rated ${approach.strength}` : ""}</small>
                    {approach.role && <small className="warn-note">{approach.role}</small>}
                  </> : <p className="l3-hint-muted">Not computed — {approach.reason}</p>}
                </div>
              ))}
            </div>

            {starting.approach_disagreement && <div className={`fih-disagreement ${(starting.approach_disagreement.fold_difference ?? 0) > 3 ? "warn" : "ok"}`}>
              <AlertTriangle size={16} />
              <div>
                <b>{num(starting.approach_disagreement.fold_difference, 2)}× between {starting.approach_disagreement.lower_approach} and {starting.approach_disagreement.higher_approach}</b>
                <span>{starting.approach_disagreement.note}</span>
              </div>
            </div>}
          </Card> : <Card
            icon={<Syringe size={16} />}
            title="Recommended starting dose"
            subtitle="EMA (2017) requires the NOAEL/HED route and MABEL to be derived independently, with the lower value governing."
          >
            <p className="l3-hint-muted">{starting.reason}</p>
            <div className="fih-approaches">
              {(starting.approaches ?? []).map((approach: any) => (
                <div key={approach.id} className={`fih-approach ${approach.available ? "" : "absent"}`}>
                  <div className="fih-approach-head"><b>{approach.name}</b></div>
                  {approach.available
                    ? <div className="fih-approach-dose">{num(approach.dose_total_mg)} mg</div>
                    : <p className="l3-hint-muted">Not computed — {approach.reason}</p>}
                </div>
              ))}
            </div>
          </Card>}

          {/* NOAEL / HED translation */}
          {record.translation?.available ? <Card
            icon={<TrendingUp size={16} />}
            title="Animal → human dose translation (FDA 2005)"
            subtitle={`${titleCase(String(record.translation.animal_species ?? ""))} → human, body-surface-area (km) conversion`}
            note={record.translation.limitations}
          >
            <div className="fih-safety-factor">
              <div><small>Total safety factor</small><b>{num(record.translation.safety_factor?.total_factor)}×</b></div>
              <div><small>Default</small><b>{num(record.translation.safety_factor?.default_factor ?? 10)}×</b></div>
              <div className="fih-safety-factor-flags">
                <small>Applied risk factors</small>
                {(record.translation.safety_factor?.applied ?? []).length
                  ? (record.translation.safety_factor.applied ?? []).map((f: any, i: number) => <span key={i}>{f.label ?? f.id} ×{num(f.additional_factor)}</span>)
                  : <span className="l3-hint-muted">None selected</span>}
              </div>
            </div>
            <DataTable
              columns={[
                { key: "n", header: "Point of departure", render: (r: any) => <><b>{r.pod_name}</b><small>{r.pod_provenance}</small></> },
                { key: "a", header: "Animal dose (mg/kg)", align: "right", render: (r: any) => num(r.animal_dose_mg_per_kg) },
                { key: "h", header: "HED (mg/kg)", align: "right", render: (r: any) => num(r.hed?.hed_mg_per_kg) },
                { key: "hm", header: "HED (mg/m²)", align: "right", render: (r: any) => num(r.hed?.hed_mg_per_m2) },
                { key: "m", header: "MRSD (mg)", align: "right", render: (r: any) => r.eligible_for_mrsd ? num(r.mrsd?.mrsd_total_mg_60kg) : <span className="l3-hint-muted">excluded</span> },
                { key: "s", header: "Strength", render: (r: any) => <StatusPill status={r.pod_strength === "strong" ? "pass" : r.pod_strength === "moderate" ? "caution" : "unknown"} label={titleCase(String(r.pod_strength ?? ""))} /> },
                { key: "x", header: "Note", render: (r: any) => r.excluded_reason ?? "—" },
              ]}
              rows={record.translation.translations ?? []}
            />
          </Card> : record.translation && <Unavailable title="Animal → human dose translation" reason={record.translation.reason} />}

          {/* MABEL */}
          {record.mabel && <Card icon={<Gauge size={16} />} title="MABEL — minimum anticipated biological effect level" note={record.mabel?.limitations}>
            {record.mabel?.available ? <>
              <dl className="l3-metrics">
                <div><dt>MABEL</dt><dd>{num(record.mabel.mabel_total_mg)} mg</dd></div>
                <div><dt>mg/kg</dt><dd>{num(record.mabel.mabel_mg_per_kg, 6)}</dd></div>
                <div><dt>Anchor occupancy</dt><dd>{pct(record.mabel.anchor_occupancy)}</dd></div>
                <div><dt>Uncertainty factor</dt><dd>{num(record.mabel.uncertainty_factor)}×</dd></div>
                <div><dt>Kd</dt><dd>{num(record.mabel.kd_uM)} µM</dd></div>
                <div><dt>Required free Cmax</dt><dd>{num(record.mabel.required_free_cmax_uM)} µM</dd></div>
              </dl>
              <p className="l3-hint-muted">{record.mabel.model}</p>
              {record.pharmacologically_active_dose?.available && <p className="l3-hint">
                Pharmacologically active dose ({pct(record.pharmacologically_active_dose.target_occupancy)} occupancy):
                <strong> {num(record.pharmacologically_active_dose.pad_total_mg)} mg</strong> — the target the escalation climbs toward, not a starting dose.
              </p>}
            </> : <p className="l3-hint-muted">{record.mabel?.reason}</p>}
          </Card>}

          {/* Escalation ladder */}
          {record.escalation_ladder?.available && <Card
            icon={<TrendingUp size={16} />}
            title="Escalation ladder"
            subtitle={`${record.escalation_ladder.scheme_name} — ${record.escalation_ladder.reference}`}
            note={record.escalation_ladder.limitations}
          >
            <DataTable
              columns={[
                { key: "l", header: "Level", render: (r: any) => r.level },
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "k", header: "Dose (mg/kg)", align: "right", render: (r: any) => num(r.dose_mg_per_kg, 5) },
                { key: "s", header: "Step from previous", align: "right", render: (r: any) => r.step_from_previous != null ? `${num(r.step_from_previous)}×` : "—" },
                { key: "f", header: "Fold over start", align: "right", render: (r: any) => `${num(r.fold_over_starting_dose)}×` },
              ]}
              rows={record.escalation_ladder.levels ?? []}
            />
            {record.escalation_ladder.capped_at_max_dose && <p className="l3-hint"><AlertTriangle size={13} /> The ladder was truncated at the maximum planned dose of {num(record.escalation_ladder.max_dose_mg)} mg.</p>}
          </Card>}

          {/* Human exposure + margins */}
          {record.exposure_margins?.available ? <Card
            icon={<Scale size={16} />}
            title="Human exposure and safety margin"
            subtitle={`Against the ${record.exposure_margins.animal_pod?.name ?? "animal point of departure"} in ${titleCase(String(record.exposure_margins.animal_species ?? ""))}`}
            note={record.exposure_margins.limitations}
          >
            <div className="fih-pod-anchor">
              <div><small>Animal POD dose</small><b>{num(record.exposure_margins.animal_pod?.dose_mg_per_kg)} mg/kg</b></div>
              <div><small>POD AUC</small><b>{num(record.exposure_margins.animal_pod?.auc_uM_h)} µM·h</b></div>
              <div><small>POD free Cmax</small><b>{num(record.exposure_margins.animal_pod?.free_cmax_uM)} µM</b></div>
              <div><small>Thresholds</small><b>target {num(record.exposure_margins.thresholds?.target)}× · minimum {num(record.exposure_margins.thresholds?.minimum)}×</b></div>
            </div>
            <DataTable
              columns={[
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "auc", header: "Human AUC (µM·h)", align: "right", render: (r: any) => num(r.human_auc_uM_h) },
                { key: "cmax", header: "Human Cmax (µM)", align: "right", render: (r: any) => num(r.human_cmax_uM) },
                { key: "free", header: "Free Cmax (µM)", align: "right", render: (r: any) => num(r.human_free_cmax_uM) },
                { key: "am", header: "AUC margin", align: "right", render: (r: any) => r.auc_margin != null ? `${num(r.auc_margin)}×` : "—" },
                { key: "cm", header: "Cmax margin", align: "right", render: (r: any) => r.cmax_margin != null ? `${num(r.cmax_margin)}×` : "—" },
                { key: "lm", header: "Limiting", align: "right", render: (r: any) => r.limiting_margin != null ? `${num(r.limiting_margin)}×` : "—" },
                { key: "b", header: "Band", render: (r: any) => <StatusPill status={r.band} label={titleCase(String(r.band ?? ""))} /> },
              ]}
              rows={record.exposure_margins.per_dose_level ?? []}
            />
            {record.exposure_margins.highest_dose_with_acceptable_margin && <p className="l3-hint">
              Highest dose retaining the minimum margin: <strong>{num(record.exposure_margins.highest_dose_with_acceptable_margin.dose_total_mg)} mg</strong>
              {" "}({num(record.exposure_margins.highest_dose_with_acceptable_margin.limiting_margin)}× limiting).
            </p>}
          </Card> : record.exposure_margins && <Unavailable title="Exposure-based safety margin" reason={record.exposure_margins.reason} />}

          {/* Human PK table */}
          {record.human_exposures?.available && <Card
            icon={<FlaskConical size={16} />}
            title="Projected human pharmacokinetics"
            subtitle={record.human_exposures.model}
            note={record.human_exposures.limitations}
          >
            <DataTable
              columns={[
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "c", header: "Cmax (mg/L)", align: "right", render: (r: any) => num(r.cmax_mg_per_l) },
                { key: "t", header: "Tmax (h)", align: "right", render: (r: any) => num(r.tmax_h) },
                { key: "a", header: "AUC (mg·h/L)", align: "right", render: (r: any) => num(r.auc_mg_h_per_l) },
                { key: "h", header: "t½ (h)", align: "right", render: (r: any) => num(r.t_half_h) },
                { key: "cl", header: "CL (L/h)", align: "right", render: (r: any) => num(r.cl_l_per_h) },
                { key: "v", header: "Vss (L/kg)", align: "right", render: (r: any) => num(r.vss_l_per_kg) },
                { key: "fu", header: "fu", align: "right", render: (r: any) => num(r.fu_plasma, 4) },
              ]}
              rows={(record.human_exposures.exposures ?? []).filter((r: any) => r.available)}
            />
            {record.allometric_cross_check?.available && <p className="l3-hint">
              Allometric cross-check: animal clearance scaled to human gives {num(record.allometric_cross_check.human_cl_l_per_h_per_kg)} L/h/kg
              ({num(record.allometric_cross_check.human_cl_l_per_h_60kg)} L/h at 60 kg) — a sanity check on the PBPK projection, not a substitute for it.
            </p>}
          </Card>}

          {/* Safety pharmacology margins */}
          {record.safety_pharmacology_margins?.available && <Card
            icon={<Stethoscope size={16} />}
            title="Safety-pharmacology margins"
            note={record.safety_pharmacology_margins.limitations}
          >
            <p>{record.safety_pharmacology_margins.cardiovascular?.statement}</p>
            <DataTable
              columns={[
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "f", header: "Human free Cmax (µM)", align: "right", render: (r: any) => num(r.human_free_cmax_uM) },
                { key: "i", header: "hERG IC50 required to clear the margin (µM)", align: "right", render: (r: any) => num(r.required_herg_ic50_uM) },
              ]}
              rows={record.safety_pharmacology_margins.cardiovascular?.per_dose_level ?? []}
            />
            <div className="fih-sp-systems">
              <div><b>Cardiovascular</b><span>{text(record.safety_pharmacology_margins.cardiovascular?.herg_risk_class)} · target margin {num(record.safety_pharmacology_margins.cardiovascular?.target_margin)}×</span></div>
              <div><b>Central nervous system</b><span>{text(record.safety_pharmacology_margins.central_nervous_system?.assessment)} · brain:plasma {num(record.safety_pharmacology_margins.central_nervous_system?.brain_plasma_auc_ratio)}</span></div>
              <div><b>Respiratory</b><span>{text(record.safety_pharmacology_margins.respiratory?.assessment)} · phospholipidosis {text(record.safety_pharmacology_margins.respiratory?.phospholipidosis_risk_class)}</span></div>
            </div>
          </Card>}

          {/* SAD */}
          {record.trial_design?.sad?.available && <Card
            icon={<Users size={16} />}
            title="Phase 1 SAD design"
            subtitle={record.trial_design.sad.design}
            note={record.trial_design.sad.population}
          >
            <div className="fih-design-meta">
              <div><small>Subjects</small><b>{text(record.trial_design.sad.n_subjects_total)}</b></div>
              <div><small>Randomisation</small><b>{text(record.trial_design.sad.randomisation_ratio)}</b></div>
              <div><small>Inter-cohort washout</small><b>{num(record.trial_design.sad.inter_cohort_washout_h)} h</b></div>
              <div><small>Sentinel cohort</small><b>{text(record.trial_design.sad.sentinel_cohort_size)}</b></div>
            </div>
            <DataTable
              columns={[
                { key: "c", header: "Cohort", render: (r: any) => r.cohort },
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "n", header: "n", align: "right", render: (r: any) => r.n_total },
                { key: "a", header: "Active", align: "right", render: (r: any) => r.n_active },
                { key: "p", header: "Placebo", align: "right", render: (r: any) => r.n_placebo },
                { key: "s", header: "Sentinel", render: (r: any) => r.sentinel_dosing ? <StatusPill status="caution" label="Sentinel" /> : "—" },
              ]}
              rows={record.trial_design.sad.cohorts ?? []}
            />
            {record.trial_design.sad.pk_sampling?.available && <div className="fih-sampling">
              <div className="l3-sub-label">PK sampling schedule ({record.trial_design.sad.pk_sampling.n_samples} samples to {num(record.trial_design.sad.pk_sampling.horizon_h)} h)</div>
              <div className="fih-sampling-times">
                {(record.trial_design.sad.pk_sampling.sampling_times_h ?? []).map((t: number, i: number) => <span key={i}>{num(t, 2)} h</span>)}
              </div>
              <p className="l3-hint-muted">{record.trial_design.sad.pk_sampling.basis}</p>
              <p className="l3-limitation">{record.trial_design.sad.pk_sampling.note}</p>
            </div>}
          </Card>}

          {/* MAD */}
          {record.trial_design?.mad?.available ? <Card
            icon={<Users size={16} />}
            title="Phase 1 MAD design"
            subtitle={record.trial_design.mad.design}
            note={record.trial_design.mad.prerequisite}
          >
            <div className="fih-design-meta">
              <div><small>Frequency</small><b>{text(record.trial_design.mad.dosing_frequency)}</b></div>
              <div><small>Treatment duration</small><b>{text(record.trial_design.mad.treatment_duration_days)} days</b></div>
              <div><small>Subjects</small><b>{text(record.trial_design.mad.n_subjects_total)}</b></div>
            </div>
            <p className="l3-hint-muted">{record.trial_design.mad.duration_basis}</p>
            <DataTable
              columns={[
                { key: "c", header: "Cohort", render: (r: any) => r.cohort },
                { key: "d", header: "Dose (mg)", align: "right", render: (r: any) => num(r.dose_total_mg) },
                { key: "n", header: "n", align: "right", render: (r: any) => r.n_total },
                { key: "a", header: "Active", align: "right", render: (r: any) => r.n_active },
                { key: "p", header: "Placebo", align: "right", render: (r: any) => r.n_placebo },
              ]}
              rows={record.trial_design.mad.cohorts ?? []}
            />
          </Card> : record.trial_design?.mad && <Unavailable title="Phase 1 MAD design" reason={record.trial_design.mad.reason} />}

          {/* Stopping rules */}
          {record.trial_design?.stopping_rules?.available && <Card icon={<AlertTriangle size={16} />} title="Stopping rules">
            <DataTable
              columns={[
                { key: "r", header: "Rule", render: (r: any) => r.rule },
                { key: "a", header: "Action", render: (r: any) => r.action },
                { key: "s", header: "Source", render: (r: any) => r.source },
              ]}
              rows={record.trial_design.stopping_rules.rules ?? []}
            />
            {record.trial_design.stopping_rules.exposure_cap && <div className="fih-cap">
              <b>Exposure cap: {num(record.trial_design.stopping_rules.exposure_cap.dose_total_mg)} mg</b>
              <span>{record.trial_design.stopping_rules.exposure_cap.note}</span>
            </div>}
          </Card>}

          {/* 3+3 operating characteristics */}
          {record.trial_design?.escalation_operating_characteristics && <Card icon={<Gauge size={16} />} title="Escalation operating characteristics (3+3)">
            {record.trial_design?.escalation_operating_characteristics?.available ? <>
              <div className="fih-design-meta">
                <div><small>Simulated trials</small><b>{text(record.trial_design.escalation_operating_characteristics.n_simulated_trials)}</b></div>
                <div><small>Mean patients / trial</small><b>{num(record.trial_design.escalation_operating_characteristics.mean_patients_per_trial)}</b></div>
                <div><small>Mean DLTs / trial</small><b>{num(record.trial_design.escalation_operating_characteristics.mean_dlts_per_trial)}</b></div>
              </div>
              <DataTable
                columns={[
                  { key: "l", header: "Declared MTD", render: (r: any) => r.label },
                  { key: "p", header: "Probability", align: "right", render: (r: any) => pct(r.probability, 1) },
                ]}
                rows={record.trial_design.escalation_operating_characteristics.mtd_distribution ?? []}
              />
              <p className="l3-limitation">{record.trial_design.escalation_operating_characteristics.limitations}</p>
            </> : <>
              <p className="l3-hint-muted">{record.trial_design?.escalation_operating_characteristics?.reason}</p>
              {record.trial_design?.escalation_operating_characteristics?.how_to_enable && <p className="l3-hint">{record.trial_design.escalation_operating_characteristics.how_to_enable}</p>}
            </>}
          </Card>}

          {/* Sub-studies */}
          {record.sub_studies?.available && <Card
            icon={<FlaskConical size={16} />}
            title="Phase 1 sub-study feasibility"
            subtitle={`${text(record.sub_studies.summary?.n_advised)} advised · ${text(record.sub_studies.summary?.n_undetermined)} undetermined`}
            note={record.sub_studies.limitations}
          >
            <div className="fih-substudies">
              {(record.sub_studies.sub_studies ?? []).map((sub: any) => (
                <div key={sub.id} className={`fih-substudy ${sub.status.replace(" ", "-")}`}>
                  <div className="fih-substudy-head">
                    <div><b>{sub.name}</b><small>{sub.guideline}</small></div>
                    <StatusPill status={sub.status === "advised" ? "caution" : sub.status === "undetermined" ? "unknown" : "pass"} label={titleCase(sub.status)} />
                  </div>
                  <p>{sub.rationale}</p>
                  <small>Gating input: {sub.gating_input}</small>
                  {Object.keys(sub.evidence ?? {}).length > 0 && <div className="fih-substudy-evidence">
                    {Object.entries(sub.evidence).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => (
                      <span key={k}>{titleCase(k)}: <b>{text(v)}</b></span>
                    ))}
                  </div>}
                </div>
              ))}
            </div>
          </Card>}

          {/* IND / CTA readiness */}
          {record.ind_gate?.available && <Card
            icon={<Landmark size={16} />}
            title={`IND / CTA filing readiness — ${record.ind_gate.region?.name}`}
            subtitle={`${record.ind_gate.region?.application} · ${record.ind_gate.region?.framework}`}
            note={record.ind_gate.limitations}
          >
            <div className={`l3-gate ${record.ind_gate.recommendation === "NOT-FILEABLE" ? "l3-gate-nogo" : record.ind_gate.recommendation === "PACKAGE-COMPLETE-AS-ATTESTED" ? "l3-gate-go" : "l3-gate-cond"}`}>
              <div className="l3-gate-badge">{record.ind_gate.recommendation}</div>
              <div><b>Nonclinical package</b><p>{record.ind_gate.headline}</p></div>
            </div>
            <DataTable
              columns={[
                { key: "r", header: "Requirement", render: (r: any) => <><b>{r.requirement}</b><small>{r.contribution}</small></> },
                { key: "g", header: "Guideline", render: (r: any) => r.guideline },
                { key: "s", header: "Status", render: (r: any) => <StatusPill
                    status={r.status === "computed" ? "pass" : r.status === "requires_wet_lab" || r.status === "not_met" ? "fail" : "caution"}
                    label={titleCase(r.status)} /> },
                { key: "a", header: "Attested", render: (r: any) => r.sponsor_attested ? "Yes — unverified" : "—" },
              ]}
              rows={record.ind_gate.items ?? []}
            />
            {(record.ind_gate.region?.region_specific?.length ?? 0) > 0 && <div className="fih-region-notes">
              <div className="l3-sub-label">Region-specific expectations</div>
              <ul>{record.ind_gate.region.region_specific.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
            </div>}
            {record.ind_gate.override?.supplied && <p className="l3-limitation">
              Override recorded: {record.ind_gate.override.justification}. {record.ind_gate.override.effect}
              {record.ind_gate.override.note ? ` ${record.ind_gate.override.note}` : ""}
            </p>}
          </Card>}

          {/* Benefit-risk */}
          {record.benefit_risk?.available ? <Card
            icon={<Scale size={16} />}
            title="Benefit-risk context — FDA (2023) framework"
            subtitle={record.benefit_risk.headline}
            note={record.benefit_risk.limitations}
          >
            {/* Provenance first. The severity and unmet-need scores are a
                keyword prior over 21 CFR 312.300(b) when the live openFDA label
                landscape cannot be reached. That changes how every number in
                this card should be read, so it is stated above them rather
                than in a footnote underneath. */}
            {record.benefit_risk.condition?.fda_grounded === false && <div className="fih-provenance-banner warn">
              <AlertTriangle size={16} />
              <div>
                <b>openFDA was unavailable — this card is not grounded in label data</b>
                <span>Condition severity and unmet need below fall back to a keyword prior over 21 CFR 312.300(b). Treat them as a placeholder classification, not as evidence, and re-run when the service is reachable.</span>
              </div>
            </div>}
            <div className={`fih-br-banner ${record.benefit_risk.balance}`}>
              <StatusPill status={record.benefit_risk.balance} label={titleCase(record.benefit_risk.balance)} />
              <div>
                <p>{record.benefit_risk.rationale}</p>
                <small>{record.benefit_risk.recommendation}</small>
              </div>
            </div>
            {record.benefit_risk.diverges_from_readiness_gate && <div className="fih-disagreement warn">
              <AlertTriangle size={16} />
              <div>
                <b>This diverges from the readiness gate</b>
                <span>The benefit-risk view and the safety gate disagree. The gate remains the source of truth for go/no-go; this divergence is what a benefit-risk committee exists to resolve.</span>
              </div>
            </div>}
            <div className="fih-br-scores">
              <div><small>Condition severity</small><b>{titleCase(String(record.benefit_risk.severity))}</b></div>
              <div><small>Unmet medical need</small><b>{titleCase(String(record.benefit_risk.unmet_need))}</b></div>
              <div><small>Risk tolerance</small><b>{pct(record.benefit_risk.risk_tolerance)}</b></div>
              <div><small>Benefit surrogate</small><b>{record.benefit_risk.benefit?.score != null ? pct(record.benefit_risk.benefit.score) : "not quantified"}</b></div>
            </div>
            <DataTable
              columns={[
                { key: "d", header: "Dimension", render: (r: any) => <b>{r.dimension}</b> },
                { key: "e", header: "Evidence", render: (r: any) => r.evidence },
                { key: "c", header: "Conclusion", render: (r: any) => r.conclusion },
              ]}
              rows={record.benefit_risk.dimensions ?? []}
            />
            <p className="l3-hint-muted">
              Condition classification: {record.benefit_risk.condition?.rationale}
              {record.benefit_risk.condition?.fda_grounded ? " (grounded in the live openFDA label landscape)" : " (openFDA unavailable — keyword prior used)"}
            </p>
          </Card> : record.benefit_risk && <Unavailable title="Benefit-risk context" reason={record.benefit_risk.reason} remediation={record.benefit_risk.remediation} />}

          {/* Clinical precedent */}
          {record.clinical_precedent && <Card icon={<BookOpen size={16} />} title="Clinical precedent" note={record.clinical_precedent?.limitations}>
            {record.clinical_precedent?.available ? <>
              <p>{record.clinical_precedent.novelty_note}</p>
              <div className="fih-design-meta">
                <div><small>Target precedented</small><b>{record.clinical_precedent.target_precedented ? "Yes" : "Not located"}</b></div>
                <div><small>Sources with data</small><b>{(record.clinical_precedent.sources_with_data ?? []).join(", ") || "—"}</b></div>
                <div><small>Registered Phase 1 studies</small><b>{text(record.clinical_precedent.phase1_trials?.n_trials)}</b></div>
                <div><small>Approved compounds on target</small><b>{text(record.clinical_precedent.target_compounds?.n_approved)}</b></div>
              </div>
              {(record.clinical_precedent.target_compounds?.compounds?.length ?? 0) > 0 && <DataTable
                columns={[
                  { key: "c", header: "ChEMBL id", render: (r: any) => r.molecule_chembl_id },
                  { key: "a", header: "Action", render: (r: any) => r.action_type },
                  { key: "m", header: "Mechanism", render: (r: any) => r.mechanism_of_action },
                  { key: "p", header: "Max phase", align: "right", render: (r: any) => text(r.max_phase) },
                  { key: "f", header: "First approval", align: "right", render: (r: any) => text(r.first_approval) },
                ]}
                rows={record.clinical_precedent.target_compounds?.compounds ?? []}
              />}
            </> : <p className="l3-hint-muted">{record.clinical_precedent?.reason ?? "Clinical precedent was not collected for this run."}</p>}
          </Card>}

          {/* Population and clinical-registry evidence for the target */}
          <ExternalEvidencePanel
            panel="clinical"
            identifiers={{
              gene_symbol: contract?.source?.target?.gene_symbol ?? null,
              target_protein: contract?.source?.target?.target_protein ?? null,
              therapeutic_area: indication.trim() || null,
            }}
          />

          {/* Server-owned presentation contract */}
          {record.presentation?.groups && <Card icon={<BookOpen size={16} />} title="Dossier summary" subtitle="The server-owned presentation contract — which fields appear and how they are labelled is decided by the backend.">
            <PresentationGroups groups={record.presentation.groups} />
          </Card>}

          {(record.selected_scientific_models?.length ?? 0) > 0 && <Card icon={<BadgeCheck size={16} />} title="Selected scientific models">
            <DataTable
              columns={[
                { key: "b", header: "Block", render: (r: any) => <b>{r.block}</b> },
                { key: "m", header: "Model", render: (r: any) => r.model },
                { key: "p", header: "Provenance", render: (r: any) => r.provenance },
              ]}
              rows={record.selected_scientific_models ?? []}
            />
          </Card>}

          <div className="l3-actions">
            <button className="report-button large" onClick={downloadDossier} disabled={reportBusy}>
              {reportBusy ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />} Download first-in-human dossier
            </button>
            <button className="return-l1" onClick={onBack}><ArrowLeft size={16} /> Return to the animal study</button>
          </div>
        </section>}

        {!record && !busy && <button className="return-l1" onClick={onBack}><ArrowLeft size={16} /> Return to the animal study</button>}
      </main>
    </div>
  </section>;
}
