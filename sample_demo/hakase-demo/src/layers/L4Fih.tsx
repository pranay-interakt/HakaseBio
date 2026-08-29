/**
 * Layer 4 — First-in-Human translation.
 *
 * The block this layer exists for is the starting-dose reconciliation:
 * EMA/CHMP/SWP/28367/07 Rev.1 requires the NOAEL/HED route and MABEL to be
 * derived independently, with the lower value governing. Both appear side by
 * side with their fold difference, because a large divergence is a finding.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowLeft, BadgeCheck, BookOpen, Download, FlaskConical, Gauge, Landmark,
  Layers, LoaderCircle, Play, Scale, Stethoscope, Syringe, TrendingUp, Users,
} from "lucide-react";
import { ESCALATION_SCHEMES } from "../lib/pk";
import { FDA_RISK_FACTORS, REGULATORY_REGIONS } from "../lib/catalogs";
import { num, pct, text, titleCase, tone } from "../lib/format";
import type { CompoundProfile } from "../engine/profile";
import type { AnimalStudyRecord } from "../engine/l3animal";
import type { MeasuredOverrides } from "../engine/l3ivive";
import { l4Contract, runFirstInHuman, type FihDesign } from "../engine/l4";
import { BarChart, LineChart, MetricDonut, SegmentDonut } from "../components/charts";
import { ExternalEvidencePanel } from "../components/ExternalPanel";
import {
  Anchors, Card, DataTable, DlGrid, DossierFlow, Field, Notice, PresentationGroups, RunProgress,
  SectionHeader, StatusPill, Tile, TileRow, Unavailable, downloadText,
} from "../components/ui";

export type L4State = { design: FihDesign; record: ReturnType<typeof runFirstInHuman> | null; dltText: string };

export const emptyL4State: L4State = {
  design: {
    route: "ORAL", frequency: "", durationH: 168, cohortSize: 20, bodyWeightKg: 60,
    scheme: "modified_fibonacci", levels: 7, fold: 2, maxDoseMg: null,
    riskFlags: {}, dltProbabilities: [], sadCohort: 8, madCohort: 12, madFrequency: "QD",
    indication: "", region: "FDA", attested: {}, overrideJustification: "", collectPrecedent: true,
  },
  record: null,
  dltText: "",
};

type Props = {
  profile: CompoundProfile;
  study: AnimalStudyRecord;
  overrides: MeasuredOverrides;
  areaCode: string;
  state: L4State;
  setState: (updater: (current: L4State) => L4State) => void;
  railHost: HTMLElement | null;
  onBack: () => void;
};

export function L4Fih({ profile, study, overrides, areaCode, state, setState, railHost, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const contract = useMemo(() => l4Contract(study, profile), [study.study_id]);
  const design = state.design;
  const options = contract.clinical_design_options;

  function update(patch: Partial<FihDesign>) {
    setState((current) => ({ ...current, design: { ...current.design, ...patch }, record: null }));
  }

  function run() {
    setBusy(true);
    window.setTimeout(() => {
      const record = runFirstInHuman(profile, study, design, overrides, areaCode);
      setState((current) => ({ ...current, record }));
      setBusy(false);
    }, 1800);
  }

  const record = state.record;

  /* ── rail ─────────────────────────────────────────────────────────────── */
  const rail = railHost && createPortal(<>
    <div className="rail-scroll">
      <div className="rail-head">
        <div><span>Clinical design</span><b>First-in-human plan</b></div>
        <small><Stethoscope size={13} /> Phase 1</small>
      </div>

      <section className="card-input">
        <Field label="Clinical route">
          <select value={design.route} onChange={(event) => update({ route: event.target.value as FihDesign["route"] })}>
            <option value="ORAL">Oral</option><option value="IV">Intravenous</option><option value="SC">Subcutaneous</option>
          </select>
        </Field>
        <Field label="Dosing schedule">
          <select value={design.frequency} onChange={(event) => update({ frequency: event.target.value as FihDesign["frequency"] })}>
            <option value="">Single dose</option><option value="QD">QD</option><option value="BID">BID</option>
          </select>
        </Field>
        <Field label="Simulation window (hours)">
          <input type="number" min="1" step="1" value={design.durationH} onChange={(event) => update({ durationH: Number(event.target.value) })} />
        </Field>
        <Field label="Virtual cohort size">
          <input type="number" min="2" max="60" step="1" value={design.cohortSize} onChange={(event) => update({ cohortSize: Number(event.target.value) })} />
        </Field>
        <Field label="Reference body weight (kg)">
          <input type="number" min="30" step="1" value={design.bodyWeightKg} onChange={(event) => update({ bodyWeightKg: Number(event.target.value) })} />
        </Field>
      </section>

      <section className="card-input">
        <div className="step-title"><span>↗</span><div><b>Escalation</b><small>The ladder is arithmetic on the scheme. It carries no toxicity assumption.</small></div></div>
        <Field label="Scheme">
          <select value={design.scheme} onChange={(event) => update({ scheme: event.target.value })}>
            {ESCALATION_SCHEMES.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
          </select>
        </Field>
        <p className="input-helper">{ESCALATION_SCHEMES.find((scheme) => scheme.id === design.scheme)?.reference}</p>
        <Field label="Dose levels">
          <input type="number" min="1" max="14" step="1" value={design.levels} onChange={(event) => update({ levels: Number(event.target.value) })} />
        </Field>
        {design.scheme === "fixed_fold" && <Field label="Fold per step">
          <input type="number" min="1.1" step="0.1" value={design.fold} onChange={(event) => update({ fold: Number(event.target.value) })} />
        </Field>}
        <Field label="Maximum planned dose (mg)" hint="blank for no cap">
          <input type="number" min="0" step="1" value={design.maxDoseMg ?? ""} placeholder="No cap"
            onChange={(event) => update({ maxDoseMg: event.target.value ? Number(event.target.value) : null })} />
        </Field>
      </section>

      <section className="card-input">
        <div className="step-title"><span>⚠</span><div><b>FDA (2005) safety-factor risk flags</b><small>Each flag raises the safety factor above the default 10× and is itemised in the output.</small></div></div>
        {FDA_RISK_FACTORS.map((factor) => (
          <label className="check" key={factor.id}>
            <input type="checkbox" checked={Boolean(design.riskFlags[factor.id])}
              onChange={(event) => update({ riskFlags: { ...design.riskFlags, [factor.id]: event.target.checked } })} />
            <span>{factor.label} <em>×{factor.additional_factor}</em></span>
          </label>
        ))}
      </section>

      <section className="card-input">
        <div className="step-title"><span>👥</span><div><b>Phase 1 cohorts</b><small>Cohort structure for the single- and multiple-ascending-dose parts.</small></div></div>
        <Field label="SAD cohort size"><input type="number" min="2" step="1" value={design.sadCohort} onChange={(event) => update({ sadCohort: Number(event.target.value) })} /></Field>
        <Field label="MAD cohort size"><input type="number" min="2" step="1" value={design.madCohort} onChange={(event) => update({ madCohort: Number(event.target.value) })} /></Field>
        <Field label="MAD frequency">
          <select value={design.madFrequency} onChange={(event) => update({ madFrequency: event.target.value })}>
            {["QD", "BID", "TID", "Q12H", "Q8H"].map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
          </select>
        </Field>
      </section>

      <section className="card-input">
        <div className="step-title"><span>?</span><div><b>Dose–toxicity assumption</b><small>Optional. Without it the operating characteristics are reported as not simulable rather than guessed.</small></div></div>
        <p className="input-helper">
          This platform predicts hazard mechanisms, not human dose-limiting-toxicity rates. Supply one DLT probability per
          dose level to simulate how the 3+3 rule behaves against that assumption.
        </p>
        <Field label="DLT probabilities per level">
          <input value={state.dltText} placeholder="0.02, 0.05, 0.1, 0.2, 0.33"
            onChange={(event) => {
              const parsed = event.target.value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
              setState((current) => ({ ...current, dltText: event.target.value, design: { ...current.design, dltProbabilities: parsed }, record: null }));
            }} />
        </Field>
      </section>

      <section className="card-input">
        <div className="step-title"><span>§</span><div><b>Regulatory context</b><small>Selects the filing checklist and the benefit-risk framing.</small></div></div>
        <Field label="Indication" hint="required for the benefit-risk assessment">
          <input value={design.indication} onChange={(event) => update({ indication: event.target.value })} placeholder="e.g. advanced solid tumours" />
        </Field>
        <Field label="Regulatory region">
          <select value={design.region} onChange={(event) => update({ region: event.target.value })}>
            {REGULATORY_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={design.collectPrecedent} onChange={(event) => update({ collectPrecedent: event.target.checked })} />
          <span>Query clinical precedent (ClinicalTrials.gov, ChEMBL)</span>
        </label>
      </section>

      <details className="measured-inputs">
        <summary><Landmark size={14} /> Sponsor attestations<em>{Object.values(design.attested).filter(Boolean).length}</em></summary>
        <p className="measured-note">
          Tick a requirement your programme has generated outside this platform. It is recorded as an attestation and
          stamped unverified — this platform never treats a simulated study as a completed one.
        </p>
        {options.ind_checklist_items!.filter((item) => !item.satisfiable_by_simulation).map((item) => (
          <label className="check" key={item.id} style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={Boolean(design.attested[item.id])}
              onChange={(event) => update({ attested: { ...design.attested, [item.id]: event.target.checked } })} />
            <span>{item.requirement}</span>
          </label>
        ))}
        <Field label="Override justification">
          <textarea value={design.overrideJustification} rows={3} placeholder="Recorded verbatim. It cannot make an ungenerated study exist."
            onChange={(event) => update({ overrideJustification: event.target.value })} />
        </Field>
      </details>

      <div className="notice info" style={{ marginBottom: 0 }}>
        <Scale size={15} />
        <span>A computational aid for protocol design. It is not regulatory clearance and does not substitute for the nonclinical studies ICH M3(R2) requires before human dosing.</span>
      </div>
    </div>
    <div className="rail-foot">
      <button className="btn primary full lg" onClick={run} disabled={busy}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
        {busy ? "Projecting…" : "Run first-in-human projection"}
      </button>
    </div>
  </>, railHost);

  return <>
    {rail}

    <section className="cascade">
      <div className="cascade-head">
        <BadgeCheck size={17} style={{ color: "var(--l4)" }} />
        <div><b>Animal-study handoff</b><span>Point of departure, exposure and safety context carried into the human translation.</span></div>
        <span className="cascade-seal">Study {String(contract.source.study_id).slice(0, 14)}</span>
      </div>
      <div className="cascade-chain">
        <div className="cascade-node">
          <small>Animal species</small><b>{contract.source.animal_species}</b>
          <code>{contract.source.animal_route} · {(contract.source.animal_dose_groups_mg_kg as number[]).join(", ")} mg/kg</code>
        </div>
        <span className="cascade-arrow" />
        <div className="cascade-node">
          <small>Animal stage gate</small><b>{contract.source.stage_gate}</b>
          <code>{contract.inherited.high_hazard_domains.length} high-hazard domain(s)</code>
        </div>
        <span className="cascade-arrow" />
        <div className="cascade-node">
          <small>Point of departure</small>
          <b>{contract.inherited.preferred_pod ? `${num(contract.inherited.preferred_pod.dose_mg_per_kg)} mg/kg` : "not selected"}</b>
          <code>{contract.inherited.preferred_pod?.name ?? "no anchor rated strong or moderate"}</code>
        </div>
        <span className="cascade-arrow" />
        <div className="cascade-node current"><small>Layer 4 · First in Human</small><b>Ready to design</b><code>this layer</code></div>
      </div>
    </section>

    {!record && !busy && <>
      <section className="panel">
        <SectionHeader icon={<Gauge size={18} />} eyebrow="TRANSLATION READINESS" title="Whether this layer has what it needs" accent="l4"
          description={contract.readiness.limitations} />
        <div className={`gate-banner ${contract.readiness.overall_ready ? "go" : "cond"}`}>
          <span className="badge">{contract.readiness.overall_ready ? "READY" : "BLOCKED"}</span>
          <div><b>Translation readiness</b><p>Readiness describes whether this layer can compute a translation. It is not a statement that the nonclinical package is complete.</p></div>
        </div>
        <DataTable
          columns={[
            { key: "b", header: "Block", render: (row: any) => <b>{row.block}</b> },
            { key: "r", header: "Ready", render: (row: any) => <StatusPill status={row.ready ? "pass" : "fail"} label={row.ready ? "Ready" : "Blocked"} /> },
            { key: "q", header: "Requires", render: (row: any) => row.requires },
            { key: "n", header: "Detail", render: (row: any) => row.note },
          ]}
          rows={contract.readiness.checks}
        />
      </section>

      <Card icon={<Scale size={16} />} title="Points of departure inherited from the animal study"
        subtitle="The lowest defensible anchor governs the starting-dose calculation.">
        <DataTable
          columns={[
            { key: "n", header: "Anchor", render: (row: any) => <><b>{row.name}</b><small>{row.note}</small></> },
            { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
            { key: "s", header: "Strength", render: (row: any) => <StatusPill status={row.strength === "strong" ? "pass" : row.strength === "moderate" ? "caution" : "unknown"} label={titleCase(row.strength)} /> },
            { key: "p", header: "Provenance", render: (row: any) => row.provenance },
          ]}
          rows={contract.inherited.points_of_departure}
        />
        <div className="sub-label">Safety context carried in</div>
        <DlGrid entries={[
          ["High-hazard domains", contract.inherited.high_hazard_domains.join(", ") || "None"],
          ["Target organs of concern", contract.inherited.target_organs_of_concern.join(", ") || "None"],
          ["Safety-pharmacology overall", titleCase(String(contract.inherited.safety_pharmacology.overall))],
          ["Target potency", contract.inherited.potency ? `${contract.inherited.potency.activity_type} ${num(contract.inherited.potency.value_nM)} nM` : "not carried through"],
        ]} />
      </Card>
    </>}

    {busy && <RunProgress
      title="Projecting the first-in-human plan"
      typicalSeconds={11}
      steps={[
        "Translating animal points of departure through the FDA (2005) conversion",
        "Human PBPK dose–exposure calibration",
        "MABEL, pharmacologically active dose and the starting-dose reconciliation",
        "Escalation ladder and 3+3 operating characteristics",
        "Exposure margins and safety-pharmacology margins",
        "Phase 1 design, sub-study feasibility and stopping rules",
        "Filing gate and benefit-risk framing",
      ]}
    />}

    {record && (() => {
      const gate = record.gate;
      const starting = record.starting_dose as any;
      const translation = record.translation as any;
      const margins = record.exposure_margins as any;
      const ladder = record.escalation_ladder as any;
      const trial = record.trial_design as any;
      const mabel = record.mabel as any;

      function dossier() {
        if (!record) return;
        const lines = [
          `# Hakase first-in-human dossier — ${record.projection_id}`,
          ``,
          `Animal study: ${record.study_id} (${record.animal_species})`,
          `Route: ${record.route} · ${record.frequency ?? "single dose"}`,
          `Reference body weight: ${record.reference_human_weight_kg} kg`,
          ``,
          `## Readiness — ${gate.recommendation}`,
          ``,
          gate.headline,
          ``,
          ...Object.entries(gate.criteria).map(([key, value]: any) => `- **${titleCase(key)}** (${value.status}): ${value.rationale}`),
          ``,
          `## Starting dose`,
          ``,
          starting.available
            ? `Recommended: **${starting.recommended_starting_dose_total_mg} mg** (${starting.recommended_starting_dose_mg_per_kg} mg/kg), governed by ${starting.governing_approach_name}.`
            : starting.reason,
          ``,
          ...(starting.approaches ?? []).map((approach: any) => approach.available
            ? `- ${approach.name}: ${approach.dose_total_mg} mg — ${approach.basis}`
            : `- ${approach.name}: not computed — ${approach.reason}`),
          ``,
          `## Required before dosing`,
          ``,
          ...gate.required_before_dosing.map((item: string, index: number) => `${index + 1}. ${item}`),
          ``,
          `---`,
          `Generated by the HakaseAI demonstration workspace. Values are produced by local heuristic engines, not by the production models.`,
        ];
        downloadText(lines.join("\n"), `hakase-first-in-human-${record.projection_id}.md`);
      }

      return <>
        <div className={`gate-banner ${gate.recommendation === "READY" ? "go" : gate.recommendation === "NOT-READY" ? "nogo" : "cond"}`}>
          <span className="badge">{gate.recommendation}</span>
          <div><b>First-in-human readiness</b><p>{gate.headline}</p></div>
        </div>

        <TileRow>
          <Tile icon={<Syringe size={16} />} label="Recommended starting dose"
            value={starting.available ? num(starting.recommended_starting_dose_total_mg) : "—"} unit="mg"
            note={starting.available ? `${num(starting.recommended_starting_dose_mg_per_kg, 5)} mg/kg · governed by ${starting.governing_approach_name}` : starting.reason}
            tone={starting.available ? "brand" : "bad"} />
          <Tile icon={<TrendingUp size={16} />} label="Total safety factor" value={`${num(translation.safety_factor?.total_factor ?? 10)}×`}
            note={`Default 10× · ${(translation.safety_factor?.applied ?? []).length} additional risk factor(s) applied`} />
          <Tile icon={<Scale size={16} />} label="Limiting margin at the start"
            value={margins.available ? `${num(margins.per_dose_level[0].limiting_margin)}×` : "—"}
            note={margins.available ? `Target ${margins.thresholds.target}× · minimum ${margins.thresholds.minimum}×` : margins.reason}
            tone={margins.available ? (margins.per_dose_level[0].limiting_margin >= margins.thresholds.target ? "good" : margins.per_dose_level[0].limiting_margin >= margins.thresholds.minimum ? "warn" : "bad") : "warn"} />
          <Tile icon={<Users size={16} />} label="Phase 1 subjects"
            value={(trial.sad.available ? trial.sad.n_subjects_total : 0) + (trial.mad.available ? trial.mad.n_subjects_total : 0)}
            note={`${trial.sad.available ? trial.sad.n_subjects_total : 0} SAD · ${trial.mad.available ? trial.mad.n_subjects_total : 0} MAD`} />
        </TileRow>

        <Card icon={<BadgeCheck size={16} />} title="Readiness criteria" note={gate.limitations}>
          {/* Tally above, criteria across the full width — the same shape the
              animal layer's gate uses. Side by side, the donut left most of
              the card empty and squeezed eight criteria into one column. */}
          <div className="criteria-summary">
            <SegmentDonut
              segments={[
                { key: "pass", label: "Met", value: Object.values(gate.criteria).filter((entry: any) => entry.status === "pass").length, tone: "good" },
                { key: "caution", label: "Conditional", value: Object.values(gate.criteria).filter((entry: any) => entry.status === "caution").length, tone: "warn" },
                { key: "fail", label: "Not met", value: Object.values(gate.criteria).filter((entry: any) => entry.status === "fail").length, tone: "bad" },
              ]}
              centreValue={Object.values(gate.criteria).filter((entry: any) => entry.status === "pass").length}
              centreTotal={Object.keys(gate.criteria).length} centreLabel="criteria met"
            />
            <p className="criteria-summary-note">
              Several criteria are conditional by construction: this platform can design a study it
              cannot conduct, and says so rather than marking it complete.
            </p>
          </div>
          <div className="criteria">
            {Object.entries(gate.criteria).map(([key, value]: any) => (
              <div className="criterion" data-tone={tone(value.status)} key={key}>
                <div className="criterion-head"><strong>{titleCase(key)}</strong><StatusPill status={value.status} /></div>
                <span>{value.rationale}</span>
              </div>
            ))}
          </div>
          <div className="sub-label">Required before dosing</div>
          <ol className="rail-list">
            {gate.required_before_dosing.map((item: string, index: number) => <li key={index}><span className="n">{index + 1}</span><span>{item}</span></li>)}
          </ol>
        </Card>

        {/* ── the block this layer exists for ─────────────────────────── */}
        <Card icon={<Syringe size={16} />} title="Recommended starting dose"
          subtitle="EMA/CHMP/SWP/28367/07 Rev.1 requires the NOAEL/HED route and MABEL to be derived independently, with the lower value governing."
          note={starting.limitations} accent="l4">
          {starting.available ? <>
            <Anchors entries={[
              ["Recommended starting dose", <b key="d" style={{ color: "var(--l4)", fontSize: 20 }}>{num(starting.recommended_starting_dose_total_mg)} mg</b>],
              ["Per kilogram", `${num(starting.recommended_starting_dose_mg_per_kg, 5)} mg/kg`],
              ["Governed by", starting.governing_approach_name],
              ["Reference body weight", `${starting.reference_human_weight_kg} kg`],
            ]} />
            <BarChart
              title="The two required routes, side by side"
              subtitle="Both derived independently. The lower value governs."
              logScale
              points={(starting.approaches ?? []).filter((approach: any) => approach.available).map((approach: any) => ({
                label: approach.name.length > 20 ? `${approach.name.slice(0, 18)}…` : approach.name,
                value: approach.dose_total_mg, detail: `${num(approach.dose_total_mg)} mg`,
                tone: approach.id === starting.governing_approach ? ("good" as const) : ("neutral" as const),
              }))}
              valueLabel="mg" axisLabel="Approach"
              footnote="The governing approach is highlighted. A wide divergence between the two required routes is a finding, not a rounding detail."
            />
            <div className="mt">
              <DataTable
                columns={[
                  { key: "n", header: "Approach", render: (row: any) => <><b>{row.name}</b>{row.id === starting.governing_approach && <small style={{ color: "var(--good-ink)" }}>Governs</small>}</> },
                  { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => row.available ? num(row.dose_total_mg) : "—" },
                  { key: "k", header: "Dose (mg/kg)", align: "right", render: (row: any) => row.available ? num(row.dose_mg_per_kg, 6) : "—" },
                  { key: "b", header: "Basis", render: (row: any) => row.available ? row.basis : `Not computed — ${row.reason}` },
                  { key: "s", header: "Strength", render: (row: any) => row.available ? <StatusPill status={row.strength === "strong" ? "pass" : "caution"} label={titleCase(String(row.strength))} /> : "—" },
                  { key: "r", header: "Regulatory role", render: (row: any) => row.role ?? "—" },
                ]}
                rows={starting.approaches}
              />
            </div>
            {starting.approach_disagreement && (
              <div className={`notice ${starting.approach_disagreement.fold_difference > 3 ? "warn" : "good"}`} style={{ marginTop: 14 }}>
                <AlertTriangle size={16} />
                <span>
                  <b>{num(starting.approach_disagreement.fold_difference, 2)}× between {starting.approach_disagreement.lower_approach} and {starting.approach_disagreement.higher_approach}</b>
                  <p style={{ marginTop: 4 }}>{starting.approach_disagreement.note}</p>
                </span>
              </div>
            )}
          </> : <>
            <Notice kind="error" icon={<AlertTriangle size={16} />}>{starting.reason}</Notice>
            <DataTable
              columns={[
                { key: "n", header: "Approach", render: (row: any) => <b>{row.name}</b> },
                { key: "r", header: "Outcome", render: (row: any) => row.available ? `${num(row.dose_total_mg)} mg` : `Not computed — ${row.reason}` },
              ]}
              rows={starting.approaches}
            />
          </>}
        </Card>

        {/* ── NOAEL / HED translation ─────────────────────────────────── */}
        {translation.available ? <Card icon={<TrendingUp size={16} />} title="Animal → human dose translation (FDA 2005)"
          subtitle={`${translation.animal_species} → human, body-surface-area (Km) conversion`} note={translation.limitations}>
          <Anchors entries={[
            ["Total safety factor", `${num(translation.safety_factor.total_factor)}×`],
            ["Default factor", `${num(translation.safety_factor.default_factor)}×`],
            ["Applied risk factors", (translation.safety_factor.applied ?? []).length ? translation.safety_factor.applied.map((factor: any) => `${factor.label} ×${factor.additional_factor}`).join(", ") : "None selected"],
            ["Method", translation.method],
          ]} />
          <p className="hint-muted">{translation.safety_factor.note}</p>
          <div className="mt">
            <DataTable
              columns={[
                { key: "n", header: "Point of departure", render: (row: any) => <><b>{row.pod_name}</b><small>{row.pod_provenance}</small></> },
                { key: "a", header: "Animal dose (mg/kg)", align: "right", render: (row: any) => num(row.animal_dose_mg_per_kg) },
                { key: "c", header: "Km factor", align: "right", render: (row: any) => num(row.hed.conversion_factor, 4) },
                { key: "h", header: "HED (mg/kg)", align: "right", render: (row: any) => num(row.hed.hed_mg_per_kg, 5) },
                { key: "hm", header: "HED (mg/m²)", align: "right", render: (row: any) => num(row.hed.hed_mg_per_m2, 3) },
                { key: "m", header: "MRSD (mg)", align: "right", render: (row: any) => row.eligible_for_mrsd ? num(row.mrsd.mrsd_total_mg_60kg) : <span className="muted">excluded</span> },
                { key: "s", header: "Strength", render: (row: any) => <StatusPill status={row.pod_strength === "strong" ? "pass" : row.pod_strength === "moderate" ? "caution" : "unknown"} label={titleCase(String(row.pod_strength))} /> },
                { key: "x", header: "Note", render: (row: any) => row.excluded_reason ?? "—" },
              ]}
              rows={translation.translations}
            />
          </div>
        </Card> : <Unavailable title="Animal → human dose translation" reason={translation.reason} />}

        {/* ── MABEL ───────────────────────────────────────────────────── */}
        <Card icon={<Gauge size={16} />} title="MABEL — minimum anticipated biological effect level" note={mabel.limitations}>
          {mabel.available ? <>
            <Anchors entries={[
              ["MABEL", `${num(mabel.mabel_total_mg, 5)} mg`],
              ["Per kilogram", `${num(mabel.mabel_mg_per_kg, 7)} mg/kg`],
              ["Anchor occupancy", pct(mabel.anchor_occupancy)],
              ["Uncertainty factor", `${num(mabel.uncertainty_factor)}×`],
            ]} />
            <DlGrid entries={[
              ["Kd", `${num(mabel.kd_uM, 5)} µM`],
              ["Required free Cmax", `${num(mabel.required_free_cmax_uM, 6)} µM`],
              ["Required total Cmax", `${num(mabel.required_total_cmax_mg_per_l, 6)} mg/L`],
              ["Model", mabel.model],
            ]} />
            {record.pharmacologically_active_dose.available && (
              <Notice kind="info" icon={<Gauge size={15} />}>
                Pharmacologically active dose ({pct((record.pharmacologically_active_dose as any).target_occupancy)} occupancy):
                <b> {num((record.pharmacologically_active_dose as any).pad_total_mg)} mg</b> — the target the escalation climbs toward, not a starting dose.
              </Notice>
            )}
          </> : <p className="hint-muted">{mabel.reason}</p>}
        </Card>

        {/* ── escalation ──────────────────────────────────────────────── */}
        {ladder.available && <Card icon={<TrendingUp size={16} />} title="Escalation ladder"
          subtitle={`${ladder.scheme_name} — ${ladder.reference}`} note={ladder.limitations}>
          <LineChart
            title="Returned dose progression"
            subtitle="Each point is a dose level calculated by the selected escalation scheme"
            valueLabel="Dose (mg)" logScale
            points={ladder.levels.map((level: any) => ({ label: `L${level.level}`, value: level.dose_total_mg, detail: `${num(level.dose_total_mg)} mg` }))}
          />
          <div className="mt">
            <DataTable
              columns={[
                { key: "l", header: "Level", render: (row: any) => <b>{row.level}</b> },
                { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
                { key: "k", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg ?? row.dose_total_mg / design.bodyWeightKg, 6) },
                { key: "s", header: "Step from previous", align: "right", render: (row: any) => row.step_from_previous != null ? `${num(row.step_from_previous)}×` : "—" },
                { key: "f", header: "Fold over start", align: "right", render: (row: any) => `${num(row.fold_over_starting_dose)}×` },
              ]}
              rows={ladder.levels}
            />
          </div>
          {ladder.capped_at_max_dose && <Notice kind="warn" icon={<AlertTriangle size={15} />}>The ladder was truncated at the maximum planned dose of {num(ladder.max_dose_mg)} mg.</Notice>}
        </Card>}

        {/* ── margins ─────────────────────────────────────────────────── */}
        {margins.available ? <Card icon={<Scale size={16} />} title="Human exposure and safety margin"
          subtitle={`Against the ${margins.animal_pod?.name ?? "animal point of departure"} in ${margins.animal_species}`}
          note={margins.limitations}>
          <Anchors entries={[
            ["Animal POD dose", `${num(margins.animal_pod?.dose_mg_per_kg)} mg/kg`],
            ["POD AUC", `${num(margins.animal_pod?.auc_uM_h)} µM·h`],
            ["POD free Cmax", `${num(margins.animal_pod?.free_cmax_uM, 5)} µM`],
            ["Thresholds", `target ${num(margins.thresholds?.target)}× · minimum ${num(margins.thresholds?.minimum)}×`],
          ]} />
          <LineChart
            title="Limiting margin by dose level"
            subtitle="The narrower of the AUC and free-Cmax margins at each calculated human dose"
            valueLabel="Margin (×)" logScale
            points={margins.per_dose_level.map((level: any) => ({
              label: `${num(level.dose_total_mg)} mg`, value: level.limiting_margin, detail: `${num(level.limiting_margin)}×`,
            }))}
            footnote={`Target margin ${margins.thresholds.target}×, minimum ${margins.thresholds.minimum}×. The margin is measured against an anchor that is itself a model output unless a measured NOAEL was located.`}
          />
          <div className="mt">
            <DataTable
              columns={[
                { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
                { key: "auc", header: "Human AUC (µM·h)", align: "right", render: (row: any) => num(row.human_auc_uM_h, 5) },
                { key: "cmax", header: "Human Cmax (µM)", align: "right", render: (row: any) => num(row.human_cmax_uM, 5) },
                { key: "free", header: "Free Cmax (µM)", align: "right", render: (row: any) => num(row.human_free_cmax_uM, 6) },
                { key: "am", header: "AUC margin", align: "right", render: (row: any) => `${num(row.auc_margin)}×` },
                { key: "cm", header: "Cmax margin", align: "right", render: (row: any) => `${num(row.cmax_margin)}×` },
                { key: "lm", header: "Limiting", align: "right", render: (row: any) => <b>{num(row.limiting_margin)}×</b> },
                { key: "b", header: "Band", render: (row: any) => <StatusPill status={row.band === "comfortable" ? "pass" : row.band === "modest" ? "caution" : "fail"} label={titleCase(row.band)} /> },
              ]}
              rows={margins.per_dose_level}
            />
          </div>
          {margins.highest_dose_with_acceptable_margin && (
            <Notice kind="info" icon={<Scale size={15} />}>
              Highest dose retaining the minimum margin: <b>{num(margins.highest_dose_with_acceptable_margin.dose_total_mg)} mg</b> ({num(margins.highest_dose_with_acceptable_margin.limiting_margin)}× limiting).
            </Notice>
          )}
        </Card> : <Unavailable title="Exposure-based safety margin" reason={margins.reason} />}

        {/* ── human PK ────────────────────────────────────────────────── */}
        {record.human_exposures.available && <Card icon={<FlaskConical size={16} />} title="Projected human pharmacokinetics"
          subtitle={record.human_exposures.model} note={record.human_exposures.limitations}>
          <DataTable
            columns={[
              { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
              { key: "c", header: "Cmax (mg/L)", align: "right", render: (row: any) => num(row.cmax_mg_per_l, 5) },
              { key: "t", header: "Tmax (h)", align: "right", render: (row: any) => num(row.tmax_h) },
              { key: "a", header: "AUC (mg·h/L)", align: "right", render: (row: any) => num(row.auc_mg_h_per_l, 5) },
              { key: "h", header: "t½ (h)", align: "right", render: (row: any) => num(row.t_half_h) },
              { key: "cl", header: "CL (L/h)", align: "right", render: (row: any) => num(row.cl_l_per_h) },
              { key: "v", header: "Vss (L/kg)", align: "right", render: (row: any) => num(row.vss_l_per_kg) },
              { key: "fu", header: "fu", align: "right", render: (row: any) => num(row.fu_plasma, 5) },
            ]}
            rows={record.human_exposures.exposures}
          />
          <div className="sub-label">Human PBPK calibration</div>
          <DlGrid entries={[
            ["Calibration dose", `${(record.human_dose_exposure_calibration as any).calibration_dose_mg} mg`],
            ["AUC per mg", `${num((record.human_dose_exposure_calibration as any).auc_mg_h_per_l_per_mg, 6)} mg·h/L`],
            ["Cmax per mg", `${num((record.human_dose_exposure_calibration as any).cmax_mg_per_l_per_mg, 6)} mg/L`],
            ["Terminal half-life", `${num((record.human_dose_exposure_calibration as any).t_half_h)} h`],
            ["Clearance", `${num((record.human_dose_exposure_calibration as any).cl_l_per_h)} L/h`],
            ["Vss", `${num((record.human_dose_exposure_calibration as any).vss_l_per_kg)} L/kg`],
            ["Bioavailability (F)", num((record.human_dose_exposure_calibration as any).bioavailability.F, 3)],
            ["Model", (record.human_dose_exposure_calibration as any).model],
            ["Limitation", (record.human_dose_exposure_calibration as any).limitation],
          ]} />
          {record.allometric_cross_check.available && <Notice kind="plain" icon={<TrendingUp size={15} />}>
            <b>Allometric cross-check</b> — animal clearance of {num((record.allometric_cross_check as any).animal_cl_l_per_h)} L/h at {(record.allometric_cross_check as any).animal_body_weight_kg} kg
            scales to {num((record.allometric_cross_check as any).human_cl_l_per_h_60kg)} L/h in human, a {num((record.allometric_cross_check as any).fold_difference)}× difference from the PBPK projection
            of {num((record.allometric_cross_check as any).pbpk_human_cl_l_per_h)} L/h. {(record.allometric_cross_check as any).note}
          </Notice>}
        </Card>}

        {/* ── safety pharmacology margins ─────────────────────────────── */}
        {record.safety_pharmacology_margins.available && <Card icon={<Stethoscope size={16} />} title="Safety-pharmacology margins"
          note={record.safety_pharmacology_margins.limitations}>
          <p className="card-sub">{(record.safety_pharmacology_margins.cardiovascular as any).statement}</p>
          <DataTable
            columns={[
              { key: "l", header: "Level", render: (row: any) => row.level },
              { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
              { key: "f", header: "Human free Cmax (µM)", align: "right", render: (row: any) => num(row.human_free_cmax_uM, 6) },
              { key: "i", header: "hERG IC50 required for a 30× margin (µM)", align: "right", render: (row: any) => num(row.required_herg_ic50_uM, 5) },
            ]}
            rows={(record.safety_pharmacology_margins.cardiovascular as any).per_dose_level}
          />
          <div className="grid-2 mt">
            <Card icon={<Stethoscope size={15} />} title="Cardiovascular">
              <DlGrid entries={[
                ["hERG risk class", (record.safety_pharmacology_margins.cardiovascular as any).herg_risk_class],
                ["Blocker probability", num((record.safety_pharmacology_margins.cardiovascular as any).herg_blocker_probability, 3)],
                ["Target margin", `${(record.safety_pharmacology_margins.cardiovascular as any).target_margin}×`],
              ]} />
            </Card>
            <Card icon={<Stethoscope size={15} />} title="CNS and respiratory">
              <DlGrid entries={[
                ["CNS assessment", titleCase(String((record.safety_pharmacology_margins.central_nervous_system as any).assessment))],
                ["Brain:plasma AUC", num((record.safety_pharmacology_margins.central_nervous_system as any).brain_plasma_auc_ratio, 3)],
                ["Kp,uu", num((record.safety_pharmacology_margins.central_nervous_system as any).kp_uu_estimate, 3)],
                ["CNS note", (record.safety_pharmacology_margins.central_nervous_system as any).note],
                ["Respiratory assessment", titleCase(String((record.safety_pharmacology_margins.respiratory as any).assessment))],
                ["Phospholipidosis class", (record.safety_pharmacology_margins.respiratory as any).phospholipidosis_risk_class],
                ["Respiratory note", (record.safety_pharmacology_margins.respiratory as any).note],
              ]} />
            </Card>
          </div>
        </Card>}

        {/* ── trial design ────────────────────────────────────────────── */}
        {trial.sad.available && <Card icon={<Users size={16} />} title="Phase 1 SAD design" subtitle={trial.sad.design} note={trial.sad.population}>
          <Anchors entries={[
            ["Subjects", trial.sad.n_subjects_total],
            ["Randomisation", trial.sad.randomisation_ratio],
            ["Inter-cohort washout", `${num(trial.sad.inter_cohort_washout_h)} h`],
            ["Sentinel cohort", trial.sad.sentinel_cohort_size],
          ]} />
          <DataTable
            columns={[
              { key: "c", header: "Cohort", render: (row: any) => <b>{row.cohort}</b> },
              { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
              { key: "n", header: "n", align: "right", render: (row: any) => row.n_total },
              { key: "a", header: "Active", align: "right", render: (row: any) => row.n_active },
              { key: "p", header: "Placebo", align: "right", render: (row: any) => row.n_placebo },
              { key: "s", header: "Sentinel", render: (row: any) => row.sentinel_dosing ? <StatusPill status="caution" label="Sentinel" /> : "—" },
            ]}
            rows={trial.sad.cohorts}
          />
          {trial.sad.pk_sampling.available && <>
            <div className="sub-label">PK sampling schedule — {trial.sad.pk_sampling.n_samples} samples to {num(trial.sad.pk_sampling.horizon_h)} h</div>
            <div className="ext-chips">{trial.sad.pk_sampling.sampling_times_h.map((time: number, index: number) => <span key={index}>{num(time, 2)} h</span>)}</div>
            <p className="hint-muted mt">{trial.sad.pk_sampling.basis}</p>
            <p className="limitation">{trial.sad.pk_sampling.note}</p>
          </>}
        </Card>}

        {trial.mad.available ? <Card icon={<Users size={16} />} title="Phase 1 MAD design" subtitle={trial.mad.design} note={trial.mad.prerequisite}>
          <Anchors entries={[
            ["Frequency", trial.mad.dosing_frequency],
            ["Treatment duration", `${trial.mad.treatment_duration_days} days`],
            ["Subjects", trial.mad.n_subjects_total],
          ]} />
          <p className="hint-muted">{trial.mad.duration_basis}</p>
          <DataTable
            columns={[
              { key: "c", header: "Cohort", render: (row: any) => <b>{row.cohort}</b> },
              { key: "d", header: "Dose (mg)", align: "right", render: (row: any) => num(row.dose_total_mg) },
              { key: "n", header: "n", align: "right", render: (row: any) => row.n_total },
              { key: "a", header: "Active", align: "right", render: (row: any) => row.n_active },
              { key: "p", header: "Placebo", align: "right", render: (row: any) => row.n_placebo },
            ]}
            rows={trial.mad.cohorts}
          />
        </Card> : <Unavailable title="Phase 1 MAD design" reason={trial.mad.reason} />}

        <Card icon={<AlertTriangle size={16} />} title="Stopping rules">
          <DataTable
            columns={[
              { key: "r", header: "Rule", render: (row: any) => <b>{row.rule}</b> },
              { key: "a", header: "Action", render: (row: any) => row.action },
              { key: "s", header: "Source", render: (row: any) => row.source },
            ]}
            rows={trial.stopping_rules.rules}
          />
          {trial.stopping_rules.exposure_cap && <Notice kind="warn" icon={<Scale size={15} />}>
            <b>Exposure cap: {num(trial.stopping_rules.exposure_cap.dose_total_mg)} mg</b>
            <p style={{ marginTop: 3 }}>{trial.stopping_rules.exposure_cap.note}</p>
          </Notice>}
        </Card>

        <Card icon={<Gauge size={16} />} title="Escalation operating characteristics (3+3)">
          {trial.escalation_operating_characteristics.available ? <>
            <Anchors entries={[
              ["Simulated trials", trial.escalation_operating_characteristics.n_simulated_trials.toLocaleString()],
              ["Mean patients / trial", num(trial.escalation_operating_characteristics.mean_patients_per_trial, 1)],
              ["Mean DLTs / trial", num(trial.escalation_operating_characteristics.mean_dlts_per_trial, 2)],
            ]} />
            <BarChart
              title="Distribution of the declared MTD"
              subtitle="Across the simulated trials, conditional on the supplied DLT probabilities"
              points={trial.escalation_operating_characteristics.mtd_distribution.map((row: any) => ({
                label: row.label.length > 18 ? `${row.label.slice(0, 16)}…` : row.label,
                value: row.probability * 100, detail: `${(row.probability * 100).toFixed(1)}%`,
              }))}
              valueLabel="% of trials" axisLabel="Declared MTD"
            />
            <p className="limitation"><AlertTriangle size={13} /> {trial.escalation_operating_characteristics.limitations}</p>
          </> : <>
            <p className="hint-muted">{trial.escalation_operating_characteristics.reason}</p>
            <Notice kind="info" icon={<Gauge size={15} />}>{trial.escalation_operating_characteristics.how_to_enable}</Notice>
          </>}
        </Card>

        {/* ── sub-studies ─────────────────────────────────────────────── */}
        <Card icon={<FlaskConical size={16} />} title="Phase 1 sub-study feasibility"
          subtitle={`${record.sub_studies.summary.n_advised} advised · ${record.sub_studies.summary.n_not_advised} not advised · ${record.sub_studies.summary.n_undetermined} undetermined`}
          note={record.sub_studies.limitations}>
          <DataTable
            columns={[
              { key: "n", header: "Sub-study", render: (row: any) => <><b>{row.name}</b><small>{row.guideline}</small></> },
              { key: "s", header: "Status", render: (row: any) => <StatusPill status={row.status === "advised" ? "caution" : row.status === "undetermined" ? "unknown" : "pass"} label={titleCase(row.status)} /> },
              { key: "r", header: "Rationale", render: (row: any) => row.rationale },
              { key: "g", header: "Gating input", render: (row: any) => row.gating_input },
              { key: "e", header: "Evidence", render: (row: any) => Object.entries(row.evidence ?? {}).map(([key, value]) => `${titleCase(key)}: ${text(value)}`).join(" · ") || "—" },
            ]}
            rows={record.sub_studies.sub_studies}
          />
        </Card>

        {/* ── IND / CTA ───────────────────────────────────────────────── */}
        <Card icon={<Landmark size={16} />} title={`IND / CTA filing readiness — ${record.ind_gate.region.name}`}
          subtitle={`${record.ind_gate.region.application} · ${record.ind_gate.region.framework}`}
          note={record.ind_gate.limitations}>
          <div className={`gate-banner ${record.ind_gate.recommendation === "NOT-FILEABLE" ? "nogo" : record.ind_gate.recommendation === "PACKAGE-COMPLETE-AS-ATTESTED" ? "go" : "cond"}`}>
            <span className="badge">{record.ind_gate.recommendation}</span>
            <div><b>Nonclinical package</b><p>{record.ind_gate.headline}</p></div>
          </div>
          <div className="grid-2">
            <MetricDonut
              value={record.ind_gate.items.filter((item: any) => item.status === "computed" || item.status === "sponsor_attested").length}
              total={record.ind_gate.items.length} label="items addressed"
              caption="Computed items were produced by this cascade. Attested items are sponsor declarations, recorded as unverified."
            />
            <div>
              <TileRow>
                <Tile label="Computed by this platform" value={record.ind_gate.items.filter((item: any) => item.status === "computed").length} tone="good" note="Produced by the cascade" />
                <Tile label="Sponsor attested" value={record.ind_gate.items.filter((item: any) => item.status === "sponsor_attested").length} tone="warn" note="Recorded as unverified" />
                <Tile label="Requires wet lab" value={record.ind_gate.items.filter((item: any) => item.status === "requires_wet_lab").length} tone="bad" note="A study that has to be conducted" />
              </TileRow>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "r", header: "Requirement", render: (row: any) => <><b>{row.requirement}</b><small>{row.contribution}</small></> },
              { key: "g", header: "Guideline", render: (row: any) => row.guideline },
              { key: "s", header: "Status", render: (row: any) => <StatusPill status={row.status === "computed" ? "pass" : row.status === "sponsor_attested" ? "caution" : "fail"} label={titleCase(row.status)} /> },
              { key: "a", header: "Attested", render: (row: any) => row.sponsor_attested ? "Yes — unverified" : "—" },
            ]}
            rows={record.ind_gate.items}
          />
          <div className="sub-label">Region-specific expectations</div>
          <ul className="rail-tags">
            {record.ind_gate.region.region_specific.map((note: string, index: number) => <li key={index} className="muted"><Landmark size={12} />{note}</li>)}
          </ul>
          {record.ind_gate.override.supplied && (
            <p className="limitation"><AlertTriangle size={13} /> Override recorded: {(record.ind_gate.override as any).justification}. {(record.ind_gate.override as any).effect} {(record.ind_gate.override as any).note}</p>
          )}
        </Card>

        {/* ── benefit-risk ────────────────────────────────────────────── */}
        {record.benefit_risk.available ? <Card icon={<Scale size={16} />} title="Benefit-risk context — FDA (2023) framework"
          subtitle={(record.benefit_risk as any).headline} note={(record.benefit_risk as any).limitations}>
          {(record.benefit_risk as any).condition.fda_grounded === false && (
            <Notice kind="warn" icon={<AlertTriangle size={16} />}>
              <b>openFDA was unavailable — this card is not grounded in label data</b>
              <p style={{ marginTop: 4 }}>Condition severity and unmet need below fall back to a keyword prior over 21 CFR 312.300(b). Treat them as a placeholder classification, not as evidence, and re-run when the service is reachable.</p>
            </Notice>
          )}
          <div className={`gate-banner ${(record.benefit_risk as any).balance === "favourable" ? "go" : (record.benefit_risk as any).balance === "unfavourable" ? "nogo" : "cond"}`}>
            <span className="badge">{titleCase((record.benefit_risk as any).balance)}</span>
            <div><b>{(record.benefit_risk as any).rationale}</b><p>{(record.benefit_risk as any).recommendation}</p></div>
          </div>
          <Anchors entries={[
            ["Condition severity", titleCase(String((record.benefit_risk as any).severity))],
            ["Unmet medical need", titleCase(String((record.benefit_risk as any).unmet_need))],
            ["Risk tolerance", pct((record.benefit_risk as any).risk_tolerance)],
            ["Benefit surrogate", (record.benefit_risk as any).benefit.score != null ? pct((record.benefit_risk as any).benefit.score) : "not quantified"],
          ]} />
          <p className="hint-muted">{(record.benefit_risk as any).benefit.basis}</p>
          <DataTable
            columns={[
              { key: "d", header: "Dimension", render: (row: any) => <b>{row.dimension}</b> },
              { key: "e", header: "Evidence", render: (row: any) => row.evidence },
              { key: "c", header: "Conclusion", render: (row: any) => row.conclusion },
            ]}
            rows={(record.benefit_risk as any).dimensions}
          />
          <p className="hint-muted mt">Condition classification: {(record.benefit_risk as any).condition.rationale}</p>
        </Card> : <Unavailable title="Benefit-risk context" reason={(record.benefit_risk as any).reason} remediation={(record.benefit_risk as any).remediation} />}

        {/* ── precedent ───────────────────────────────────────────────── */}
        <Card icon={<BookOpen size={16} />} title="Clinical precedent" note={(record.clinical_precedent as any).limitations}>
          {record.clinical_precedent.available ? <>
            <p className="card-sub">{(record.clinical_precedent as any).novelty_note}</p>
            <Anchors entries={[
              ["Target precedented", (record.clinical_precedent as any).target_precedented ? "Yes" : "Not located"],
              ["Sources with data", (record.clinical_precedent as any).sources_with_data.join(", ")],
              ["Registered Phase 1 studies", (record.clinical_precedent as any).phase1_trials.n_trials],
              ["Approved compounds on target", (record.clinical_precedent as any).target_compounds.n_approved],
            ]} />
            {(record.clinical_precedent as any).target_compounds.compounds.length > 0 && <DataTable
              columns={[
                { key: "c", header: "ChEMBL id", render: (row: any) => <code>{row.molecule_chembl_id}</code> },
                { key: "a", header: "Action", render: (row: any) => row.action_type },
                { key: "m", header: "Mechanism", render: (row: any) => row.mechanism_of_action },
                { key: "p", header: "Max phase", align: "right", render: (row: any) => row.max_phase },
                { key: "f", header: "First approval", align: "right", render: (row: any) => row.first_approval },
              ]}
              rows={(record.clinical_precedent as any).target_compounds.compounds}
            />}
          </> : <p className="hint-muted">{(record.clinical_precedent as any).reason}</p>}
        </Card>

        <ExternalEvidencePanel panel="clinical" identifiers={{
          gene_symbol: contract.source.target.gene_symbol ?? null,
          target_protein: contract.source.target.target_protein ?? null,
          therapeutic_area: design.indication.trim() || null,
        }} />

        <DossierFlow dossier={record.study_dossier} />

        <Card icon={<BookOpen size={16} />} title="Key results"><PresentationGroups groups={record.presentation.groups as any} /></Card>

        <Card icon={<BadgeCheck size={16} />} title="Selected scientific models">
          <DataTable
            columns={[
              { key: "b", header: "Block", render: (row: any) => <b>{row.block}</b> },
              { key: "m", header: "Model", render: (row: any) => row.model },
              { key: "p", header: "Provenance", render: (row: any) => row.provenance },
            ]}
            rows={record.selected_scientific_models}
          />
          <div className="sub-label">Record provenance</div>
          <DlGrid entries={[
            ["Projection id", record.projection_id],
            ["Study id", record.study_id],
            ["Owner", record.provenance.owner],
            ["Computed at", record.provenance.computed_at],
            ["Schema version", record.schema_version],
          ]} />
        </Card>

        <div className="actions-row">
          <button className="btn" onClick={onBack}><ArrowLeft size={15} /> Return to the animal study</button>
          <button className="btn primary" onClick={dossier}><Download size={15} /> Download first-in-human dossier</button>
        </div>
      </>;
    })()}
  </>;
}
