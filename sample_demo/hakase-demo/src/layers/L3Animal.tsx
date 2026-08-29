/**
 * Layer 3 — Animal Cohort. The virtual preclinical study.
 *
 * Design in the rail, guideline conformance and dose-setting before the run,
 * then the full preclinical package across fourteen deliverable tabs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Boxes, ClipboardList, Database,
  Download, FileText, FlaskConical, GitCompare, HeartPulse, Layers, LoaderCircle, Microscope,
  Play, Rabbit, Scale, ShieldAlert, ShieldCheck, Split, Target, Users, Waves,
} from "lucide-react";
import { GUIDELINES, STUDY_TYPES } from "../lib/catalogs";
import { SPECIES, TISSUE_LABEL } from "../lib/pk";
import { num, pct, round, text, titleCase, tone } from "../lib/format";
import { downloadScientificPdf } from "../lib/pdfReport";
import type { CompoundProfile } from "../engine/profile";
import type { L1Record } from "../engine/l1";
import type { MeasuredOverrides } from "../engine/l3ivive";
import {
  animalAccounting, designConformance, doseSetting, runAnimalStudy,
  type AnimalDesign, type AnimalStudyRecord,
} from "../engine/l3animal";
import { BarChart, Heatmap, MetricDonut, ProfileChart, RankChart, SegmentDonut } from "../components/charts";
import { ExternalEvidencePanel } from "../components/ExternalPanel";
import { BioTwinStage, type StageCallout, type StageStat } from "../components/BioTwinStage";
import { CombinationStudyPanel } from "../components/CombinationStudyPanel";
import type { Component } from "../lib/combination";
import { t } from "../i18n";
import {
  Anchors, Card, DataTable, DlGrid, DossierFlow, Field, Notice, PresentationGroups, RunProgress,
  SectionHeader, StatusPill, Tile, TileRow, Unavailable,
} from "../components/ui";

const TABS = [
  { key: "glance", label: "At a glance", icon: <Rabbit size={14} /> },
  { key: "decision", label: "Decision", icon: <ShieldCheck size={14} /> },
  { key: "endpoints", label: "TA endpoints", icon: <Target size={14} /> },
  { key: "protocol", label: "Protocol & schedule", icon: <ClipboardList size={14} /> },
  { key: "design", label: "Design & conformance", icon: <ClipboardList size={14} /> },
  { key: "welfare", label: "Welfare & 3Rs", icon: <Rabbit size={14} /> },
  { key: "tk", label: "Toxicokinetics", icon: <Activity size={14} /> },
  { key: "exposure", label: "Exposure & distribution", icon: <Boxes size={14} /> },
  { key: "toxicology", label: "Toxicology", icon: <Microscope size={14} /> },
  { key: "safetypharm", label: "Safety pharmacology", icon: <HeartPulse size={14} /> },
  { key: "interactions", label: "Interactions", icon: <Split size={14} /> },
  { key: "translation", label: "Points of departure", icon: <Scale size={14} /> },
  { key: "evidence", label: "Evidence", icon: <Database size={14} /> },
  { key: "validation", label: "Validation", icon: <BadgeCheck size={14} /> },
  { key: "provenance", label: "Provenance", icon: <Layers size={14} /> },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export type L3AnimalState = {
  design: AnimalDesign;
  dosesText: string;
  record: AnimalStudyRecord | null;
  tab: TabKey;
};

export const emptyAnimalState: L3AnimalState = {
  design: {
    studyType: "repeat_dose_28d", speciesId: "rat", strain: "sprague_dawley", sex: "both",
    route: "ORAL", doses: [5, 25, 100], includeControl: true, frequency: "QD",
    durationH: 672, formulation: "0.5% methylcellulose", cohortSize: 10,
    recoveryDays: 14, satelliteTk: true, satelliteSize: 3, collectEvidence: true,
  },
  dosesText: "5, 25, 100",
  record: null,
  tab: "glance",
};

type Props = {
  profile: CompoundProfile;
  l1: L1Record;
  overrides: MeasuredOverrides;
  areaCode: string;
  /** Empty for a single agent. Two or more turns this into a combination study. */
  components: Component[];
  signoff: { name: string; role: string; signed_at: string; acknowledged_codes: string[]; justification: string | null } | null;
  inheritedHalfLifeH?: number;
  state: L3AnimalState;
  setState: (updater: (current: L3AnimalState) => L3AnimalState) => void;
  railHost: HTMLElement | null;
  onBack: () => void;
  onContinue: (studyId: string) => void;
};

const HEADER_H = 104;

/* Matched to the specimen clip so the run and the animation land together. */
const SIM_MS = 9600;

const SIM_STEPS = [
  "Resolving disposition inputs and their provenance",
  "PBPK cohort simulation, one arm at a time",
  "Toxicokinetics and dose proportionality (ICH S3A)",
  "Biodistribution and per-organ exposure",
  "Mechanistic toxicology panel and organ risk map",
  "Safety pharmacology core battery (ICH S7A/S7B)",
  "Drug-interaction assessment and points of departure",
  "Welfare, 3Rs accounting and protocol assembly",
  "Stage gate and dossier",
];

/**
 * The completed stage: the clip's last frame with this run's own readings
 * annotated onto it.
 *
 * The top dose group is used throughout, because that is the arm the target
 * organs and the point of departure are argued from. Anchor coordinates are in
 * the clip's source pixels so a label lands on the organ it refers to.
 */
function stageAnnotations(record: any): { stats: StageStat[]; callouts: StageCallout[]; coverage: { value: number; label: string } | null } {
  const tk = record.toxicokinetics.per_arm;
  const top = tk[tk.length - 1];
  const organs: string[] = record.organ_risk.summary.target_organs_of_concern ?? [];
  const severity: string = record.welfare.severity.study_prospective_severity;
  const pod = record.points_of_departure.preferred_pod;

  /* Rounded harder than the tables below. This is the read-at-a-glance panel;
     the full precision is in the ICH S3A exposure table. */
  const stats: StageStat[] = [
    { label: "Peak plasma concentration", value: num(top.c_max_mg_per_l, 2), unit: "mg/L" },
    { label: "Systemic exposure", value: num(top.auc_mg_h_per_l, 0), unit: "mg·h/L" },
    { label: "Time to peak", value: num(top.t_max_h, 1), unit: "h" },
    { label: "Terminal half-life", value: num(top.t_half_h, 1), unit: "h" },
  ];

  /* Label positions are ordered so no leader line crosses another: the two on
     the right run almost horizontally to the shoulder and head, and the
     remaining three sit in the plate's empty corners. */
  const callouts: StageCallout[] = [
    { anchor: [560, 385], at: [330, 205], from: "right", label: "PK profile",
      value: t("{n} arms simulated", { n: record.arms.length }) },
    { anchor: [700, 330], at: [1010, 200], from: "left", label: "Tissue distribution",
      value: record.organ_risk.summary.highest_exposure_organ
        ? titleCase(String(record.organ_risk.summary.highest_exposure_organ))
        : t("Not resolved") },
    { anchor: [430, 455], at: [905, 585], from: "left", label: "Target organs",
      value: organs.length ? organs.map((organ) => titleCase(organ)).join(t(" · ")) : t("None flagged"),
      tone: organs.length ? "warn" : "good" },
    { anchor: [268, 500], at: [520, 655], from: "right", label: "Prospective severity",
      value: titleCase(severity),
      tone: severity === "mild" ? "good" : severity === "moderate" ? "warn" : "bad" },
  ];

  if (pod) {
    callouts.splice(2, 0, { anchor: [845, 405], at: [1010, 330], from: "left", label: "Point of departure",
      value: `${num(pod.dose_mg_per_kg, 1)} mg/kg` });
  }

  /* Occupancy is only present when Layer 1 resolved a target and an affinity
     anchor came with it; without one the engine records why, and the dial is
     simply absent rather than showing a zero. */
  const engagement = record.pkpd.per_arm.filter((entry: any) => entry.target_coverage?.available);
  const occupancy = engagement.length ? engagement[engagement.length - 1].target_coverage.average_occupancy : null;
  return {
    stats, callouts,
    coverage: typeof occupancy === "number" ? { value: occupancy, label: "Target coverage" } : null,
  };
}

export function L3Animal({ profile, l1, overrides, areaCode, components, signoff, inheritedHalfLifeH, state, setState, railHost, onBack, onContinue }: Props) {
  const [busy, setBusy] = useState(false);
  const design = state.design;
  const physiology = SPECIES.find((row) => row.id === design.speciesId) ?? SPECIES[0];
  const preflight = useMemo(() => ({
    conformance: designConformance(design, inheritedHalfLifeH),
    dose: doseSetting(design, inheritedHalfLifeH),
    accounting: animalAccounting(design),
  }), [JSON.stringify(design), inheritedHalfLifeH]);

  function update(patch: Partial<AnimalDesign>) {
    setState((current) => ({ ...current, design: { ...current.design, ...patch }, record: null }));
  }

  function applyStudyType(id: string) {
    const type = STUDY_TYPES.find((entry) => entry.id === id);
    if (!type) { update({ studyType: "" }); return; }
    update({
      studyType: id,
      durationH: type.suggested_duration_h,
      cohortSize: type.animals_per_sex_per_group,
      includeControl: type.control_required,
      sex: type.both_sexes_expected ? "both" : "male",
      recoveryDays: type.recovery_policy === "conditional" ? type.recovery_typical_days : 0,
      satelliteTk: type.satellite_tk_policy === "conditional_in_small_rodents" && ["rat", "mouse"].includes(design.speciesId),
    });
  }

  function scrollTo(selector: string) {
    const scroller = document.querySelector(".main");
    const anchor = document.querySelector(selector);
    if (!scroller || !anchor) return;
    const top = scroller.scrollTop + anchor.getBoundingClientRect().top - HEADER_H - 16;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function run() {
    setBusy(true);
    window.setTimeout(() => scrollTo(".biotwin"), 60);
    window.setTimeout(() => {
      const record = runAnimalStudy(profile, l1, design, overrides, areaCode, signoff);
      setState((current) => ({ ...current, record, tab: "glance" }));
      setBusy(false);
    }, SIM_MS);
  }

  /* Landing on the finished specimen, not in the tables underneath it.
     This has to wait for the record to be committed — the result and its tab
     strip do not exist yet at the moment the run resolves, so scrolling from
     inside `run` found nothing to scroll to. */
  const landedOn = useRef<string | null>(null);
  useEffect(() => {
    const id = state.record?.study_id ?? null;
    if (!id || busy || landedOn.current === id) return;
    landedOn.current = id;
    /* Deferred past the frame the result mounts in. On that frame the blocks
       above the tab strip have not finished laying out, so the anchor still
       measures near the top and the scroll lands nowhere. */
    const timer = window.setTimeout(() => scrollTo(".tabs-anchor"), 160);
    return () => window.clearTimeout(timer);
  }, [state.record, busy]);

  const record = state.record;

  /* ── rail ─────────────────────────────────────────────────────────────── */
  const rail = railHost && createPortal(<>
    <div className="rail-scroll">
      <div className="rail-head">
        <div><span>Study design</span><b>Virtual preclinical study</b></div>
        <small><FlaskConical size={13} /> ICH / OECD</small>
      </div>

      <section className="card-input">
        <Field label="Study type" hint="pre-fills the envelope it expects">
          <select value={design.studyType} onChange={(event) => applyStudyType(event.target.value)}>
            <option value="">Not declared — infer from duration</option>
            {STUDY_TYPES.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </Field>
        {design.studyType && <p className="input-helper">{STUDY_TYPES.find((type) => type.id === design.studyType)?.purpose}</p>}
      </section>

      <section className="card-input">
        <Field label="Species">
          <select value={design.speciesId} onChange={(event) => {
            const next = SPECIES.find((row) => row.id === event.target.value)!;
            update({ speciesId: next.id, strain: next.defaultStrain });
          }}>
            {SPECIES.filter((row) => row.id !== "human").map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </Field>
        <Field label="Strain">
          <select value={design.strain} onChange={(event) => update({ strain: event.target.value })}>
            {physiology.strains.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </Field>
        <Field label="Sex">
          <select value={design.sex} onChange={(event) => update({ sex: event.target.value as AnimalDesign["sex"] })}>
            <option value="male">Male</option><option value="female">Female</option><option value="both">Both</option>
          </select>
        </Field>
        <Field label="Route">
          <select value={design.route} onChange={(event) => update({ route: event.target.value as AnimalDesign["route"] })}>
            <option value="ORAL">Oral gavage</option><option value="IV">Intravenous</option><option value="SC">Subcutaneous</option>
          </select>
        </Field>
      </section>

      <section className="card-input">
        <Field label="Dose groups (mg/kg, comma-separated)">
          <input value={state.dosesText} onChange={(event) => {
            const parsed = event.target.value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0);
            setState((current) => ({ ...current, dosesText: event.target.value, design: { ...current.design, doses: parsed.length ? parsed : current.design.doses }, record: null }));
          }} placeholder="5, 25, 100" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={design.includeControl} onChange={(event) => update({ includeControl: event.target.checked })} />
          <span>Include a concurrent vehicle control group</span>
        </label>
        <Field label="Dosing schedule">
          <select value={design.frequency} onChange={(event) => update({ frequency: event.target.value as AnimalDesign["frequency"] })}>
            <option value="">Single dose</option><option value="QD">QD (once daily)</option>
            <option value="BID">BID (twice daily)</option><option value="TID">TID (three times daily)</option>
          </select>
        </Field>
        <Field label="Study duration (hours)">
          <input type="number" min="1" step="1" value={design.durationH} onChange={(event) => update({ durationH: Number(event.target.value) })} />
        </Field>
        <Field label="Formulation">
          <input value={design.formulation} onChange={(event) => update({ formulation: event.target.value })} />
        </Field>
        <Field label="Animals per sex per group">
          <input type="number" min="2" step="1" value={design.cohortSize} onChange={(event) => update({ cohortSize: Number(event.target.value) })} />
        </Field>
      </section>

      <section className="card-input">
        <Field label="Recovery period (days off drug)">
          <input type="number" min="0" step="1" value={design.recoveryDays} onChange={(event) => update({ recoveryDays: Number(event.target.value) })} />
        </Field>
        {design.recoveryDays > 0 && <p className="input-helper">Control and high-dose animals are held off drug to establish whether findings reverse.</p>}
        <label className="check">
          <input type="checkbox" checked={design.satelliteTk} onChange={(event) => update({ satelliteTk: event.target.checked })} />
          <span>Satellite toxicokinetic cohort</span>
        </label>
        {design.satelliteTk && <Field label="Satellite animals per sex per dose group">
          <input type="number" min="1" step="1" value={design.satelliteSize} onChange={(event) => update({ satelliteSize: Number(event.target.value) })} />
        </Field>}
        <label className="check">
          <input type="checkbox" checked={design.collectEvidence} onChange={(event) => update({ collectEvidence: event.target.checked })} />
          <span>Query public animal evidence (EPA CCTE, ChEMBL, PubChem, PK-DB)</span>
        </label>
      </section>

      {!record && <div className={`notice ${preflight.conformance.conformant ? "good" : "warn"}`} style={{ marginBottom: 0 }}>
        <ClipboardList size={16} />
        <span>
          <b>{preflight.conformance.conformant ? "Conformant" : `${preflight.conformance.gaps.length} gap${preflight.conformance.gaps.length === 1 ? "" : "s"}`}</b>
          <p style={{ marginTop: 3 }}>Measured against {preflight.conformance.closest_guideline}</p>
          <p style={{ marginTop: 6 }}><b>{preflight.accounting.total_animals} animals</b> · {preflight.accounting.main_study_animals} main{preflight.accounting.recovery_animals > 0 ? ` · ${preflight.accounting.recovery_animals} recovery` : ""}{preflight.accounting.satellite_tk_animals > 0 ? ` · ${preflight.accounting.satellite_tk_animals} satellite TK` : ""}</p>
          {preflight.conformance.gaps.slice(0, 2).map((gap, index) => <p key={index} style={{ marginTop: 6, fontSize: 11.5 }}>· {gap}</p>)}
        </span>
      </div>}

      <div className="notice info" style={{ marginBottom: 0 }}>
        <ShieldCheck size={15} />
        <span>A screening projection over a validated PBPK exposure engine — not a substitute for an in-vivo study. Non-human clearance driven by a human-trained model is flagged low confidence.</span>
      </div>
    </div>
    <div className="rail-foot">
      <button className="btn primary full lg" onClick={run} disabled={busy || !design.doses.length}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
        {busy ? "Simulating study…" : "Run virtual study"}
      </button>
    </div>
  </>, railHost);

  return <>
    {rail}

    {signoff ? <section className="cascade">
      <div className="cascade-head">
        <Layers size={17} style={{ color: "var(--l3)" }} />
        <div><b>Confirmed evidence</b><span>Inputs carried forward from the sealed stage gate.</span></div>
        <span className="cascade-seal"><BadgeCheck size={13} /> Sealed</span>
      </div>
      <div className="cascade-chain">
        <div className="cascade-node"><small>Layer 1 · In Vitro</small><b>{l1.verdict.verdict}</b><code title={l1.canonical_smiles}>{l1.canonical_smiles.slice(0, 26)}{l1.canonical_smiles.length > 26 ? "…" : ""}</code></div>
        <span className="cascade-arrow" />
        <div className="cascade-node"><small>Layer 2 · Confirmation</small><b>Sealed at gate</b><code>{signoff.acknowledged_codes.length} warning{signoff.acknowledged_codes.length === 1 ? "" : "s"} acknowledged</code></div>
        <span className="cascade-arrow" />
        <div className="cascade-node"><small>IVIVE · Exposure</small><b>{titleCase(design.speciesId)}</b><code>disposition handed off</code></div>
        <span className="cascade-arrow" />
        <div className="cascade-node current"><small>Layer 3 · Animal Cohort</small><b>Ready to design</b><code>this layer</code></div>
      </div>
      <div className="cascade-sign">
        <ShieldCheck size={14} />
        <span>Signed by <strong>{signoff.name}</strong> · {signoff.role} · {signoff.signed_at}</span>
      </div>
    </section> : (
      <Notice kind="warn" icon={<AlertTriangle size={16} />}>
        <b>No sealed gate on this session</b><br />Complete the IVIVE projection and seal the stage gate before starting the study.
      </Notice>
    )}

    {!record && !busy && <>
      <section className="panel">
        <SectionHeader icon={<ClipboardList size={18} />} eyebrow="PRE-FLIGHT" title="The study you are about to run" accent="l3"
          description="The rail is a form. This is the place that says what those controls add up to — before the cohort simulation is paid for." />
        <div className="dl-grid">
          <div><dt>Study type</dt><dd>{design.studyType ? STUDY_TYPES.find((type) => type.id === design.studyType)?.name : "Not declared — inferred from duration"}</dd></div>
          <div><dt>Animal model</dt><dd>{physiology.label} · {physiology.strains.find((row) => row.id === design.strain)?.label ?? design.strain} · {design.sex === "both" ? "both sexes" : design.sex}</dd></div>
          <div><dt>Administration</dt><dd>{design.route} · {design.frequency || "single dose"}</dd></div>
          <div><dt>Duration</dt><dd>{design.durationH >= 48 ? `${round(design.durationH / 24, 1)} days (${design.durationH} h)` : `${design.durationH} h`}{design.recoveryDays > 0 ? ` + ${design.recoveryDays} d recovery` : ""}</dd></div>
          <div><dt>Arms</dt><dd>{design.includeControl ? "Vehicle control + " : ""}{design.doses.map((dose) => `${dose} mg/kg`).join(", ")}</dd></div>
          <div><dt>Group size</dt><dd>{design.cohortSize} animals per sex per group{design.satelliteTk ? ` · ${design.satelliteSize} satellite TK` : " · no satellite TK cohort"}</dd></div>
        </div>

        <div className="sub-label">Animals required</div>
        <Anchors entries={[
          ["Main study", preflight.accounting.main_study_animals],
          ["Recovery", preflight.accounting.recovery_animals],
          ["Satellite TK", preflight.accounting.satellite_tk_animals],
          ["Total", <b key="t" style={{ color: "var(--l3)" }}>{preflight.accounting.total_animals}</b>],
        ]} />
        <p className="hint-muted">{preflight.accounting.basis}</p>

        <div className={`gate-banner ${preflight.conformance.conformant ? "go" : "cond"}`} style={{ marginTop: 16 }}>
          <span className="badge">{preflight.conformance.conformant ? "CONFORMANT" : `${preflight.conformance.gaps.length} GAP${preflight.conformance.gaps.length === 1 ? "" : "S"}`}</span>
          <div><b>{preflight.conformance.closest_guideline}</b><p>{preflight.conformance.guideline_purpose}</p></div>
        </div>
        {preflight.conformance.selection_note && <p className="hint-muted">{preflight.conformance.selection_note}</p>}
        {preflight.conformance.gaps.length > 0 && <>
          <div className="sub-label">Departures from the envelope</div>
          <ul className="rail-tags">{preflight.conformance.gaps.map((gap, index) => <li key={index}><AlertTriangle size={12} />{gap}</li>)}</ul>
        </>}
        {preflight.conformance.considerations.length > 0 && <>
          <div className="sub-label">Considerations</div>
          <ul className="rail-tags">{preflight.conformance.considerations.map((item, index) => <li key={index} className="muted"><AlertTriangle size={12} />{item}</li>)}</ul>
        </>}
      </section>

      <section className="panel">
        <SectionHeader icon={<Scale size={18} />} eyebrow="DOSE SETTING" title="What this dose design implies" accent="l3"
          description="Read against the ICH M3(R2) limit dose, conventional group spacing, and the accumulation the inherited half-life predicts for this dosing interval." />
        <div className={`notice ${preflight.dose.high_dose.exceeds_limit_dose ? "warn" : "good"}`}>
          <Scale size={16} />
          <span><b>{preflight.dose.high_dose.headline}</b><p style={{ marginTop: 3 }}>{preflight.dose.high_dose.rule}</p></span>
        </div>
        <div className={`notice ${preflight.dose.spacing.within_conventional_range ? "good" : "warn"}`}>
          <GitCompare size={16} />
          <span>
            <b>Dose spacing: {preflight.dose.spacing.ratios.map((ratio) => `${ratio}×`).join(" · ") || "single group"}</b>
            <p style={{ marginTop: 3 }}>{preflight.dose.spacing.notes.length ? preflight.dose.spacing.notes.join(" ") : preflight.dose.spacing.basis}</p>
          </span>
        </div>
        {preflight.dose.accumulation.available ? <>
          <Anchors entries={[
            ["Projected t½", `${num((preflight.dose.accumulation as any).t_half_h)} h`],
            ["Dosing interval", `${(preflight.dose.accumulation as any).dosing_interval_h} h`],
            ["Accumulation at steady state", `${num((preflight.dose.accumulation as any).accumulation_ratio)}×`],
            ["Time to steady state", preflight.dose.steady_state.available ? `${num((preflight.dose.steady_state as any).time_to_steady_state_h)} h` : "—"],
          ]} />
          <p className="hint-muted">{(preflight.dose.accumulation as any).interpretation}</p>
          {preflight.dose.steady_state.available && <p className={`hint-muted mt`}>{(preflight.dose.steady_state as any).interpretation}</p>}
          <p className="limitation">{(preflight.dose.accumulation as any).basis}</p>
        </> : <p className="hint-muted">{(preflight.dose.accumulation as any).reason}</p>}
      </section>

      <Card icon={<Scale size={16} />} title="Guideline envelopes your design is checked against"
        subtitle="The study types a design can be declared against, and the envelope each expects.">
        <DataTable
          columns={[
            { key: "n", header: "Study type", render: (row: any) => <b>{row.name}</b> },
            { key: "d", header: "Duration window (h)", align: "right", render: (row: any) => `${row.duration_window_h[0]} – ${row.duration_window_h[1]}` },
            { key: "a", header: "Animals / sex / group", align: "right", render: (row: any) => row.animals_per_sex_per_group },
            { key: "g", header: "Min dose groups", align: "right", render: (row: any) => row.min_dose_groups },
            { key: "c", header: "Control", render: (row: any) => row.control_required ? "Required" : "Optional" },
          ]}
          rows={GUIDELINES}
        />
      </Card>
    </>}

    {busy && <BioTwinStage
      running steps={SIM_STEPS} durationMs={SIM_MS}
      subject={t("{species} · virtual subject 01", { species: titleCase(design.speciesId) })}
      footnote="The animation is an illustration of a repeat-dose study, not a rendering of this compound. Nothing in it is computed."
    />}

    {record && !busy && <AnimalResult record={record} state={state} setState={setState} onBack={onBack} onContinue={onContinue}
      l1={l1} design={design} components={components} profile={profile} overrides={overrides} areaCode={areaCode}
      signoff={signoff} inheritedHalfLifeH={inheritedHalfLifeH} />}
  </>;
}

/* ── result surface ──────────────────────────────────────────────────────── */

function AnimalResult({ record, state, setState, onBack, onContinue, l1, design, components, profile, overrides, areaCode, signoff, inheritedHalfLifeH }: {
  record: AnimalStudyRecord; state: L3AnimalState; components: Component[];
  setState: (updater: (current: L3AnimalState) => L3AnimalState) => void;
  onBack: () => void; onContinue: (studyId: string) => void;
  l1: L1Record; design: AnimalDesign; profile: CompoundProfile; overrides: MeasuredOverrides; areaCode: string;
  signoff: Props["signoff"]; inheritedHalfLifeH?: number;
}) {
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  const [selectedOrgan, setSelectedOrgan] = useState<string>(() => {
    const concern = record.organ_risk.organs.find((organ) => organ.call === "target_organ_of_concern");
    return concern?.organ ?? record.organ_risk.organs[0]?.organ ?? "";
  });
  const [armIndex, setArmIndex] = useState(record.arms.length - 1);
  const gate = record.stage_gate;
  const tab = state.tab;
  /* Now that the tab strip is pinned it can be used from anywhere in a very
     tall record, so a switch has to take the reader to the top of the new
     section rather than leaving them at whatever offset they were at. */
  const setTab = (next: TabKey) => {
    setState((current) => ({ ...current, tab: next }));
    const anchor = document.querySelector(".tabs-anchor");
    const scroller = document.querySelector(".main");
    if (!anchor || !scroller) return;
    const top = scroller.scrollTop + anchor.getBoundingClientRect().top - HEADER_H - 14;
    if (top < scroller.scrollTop) scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  };

  const tkRows = record.toxicokinetics.per_arm;
  const activeOrgan = record.organ_risk.organs.find((organ) => organ.organ === selectedOrgan) ?? record.organ_risk.organs[0];
  const bio = record.biodistribution.per_arm[Math.min(armIndex, record.biodistribution.per_arm.length - 1)];
  const arm = record.arms[Math.min(armIndex, record.arms.length - 1)];

  const ORGAN_FILL: Record<string, string> = {
    target_organ_of_concern: "#dc2626",
    flagged_but_unexposed: "#d97706",
    flagged_exposure_unknown: "#eab308",
    exposed_no_signal: "#7dd3fc",
    no_signal: "#e2e8f0",
    not_predicted: "#f1f5f9",
  };

  function report() {
    const toxicology = record.toxicology as any;
    const safetyPharmacology = record.safety_pharmacology as any;
    const pointsOfDeparture = record.points_of_departure as any;
    const studyProtocol = record.study_protocol as any;
    const welfare = record.welfare as any;
    const topDoseDistribution = record.biodistribution.per_arm[record.biodistribution.per_arm.length - 1];
    const preferredPod = pointsOfDeparture.preferred_pod;
    downloadScientificPdf({
      filename: `hakase-animal-cohort-${record.study_id}.pdf`,
      title: "Hakase Animal Cohort - scientific decision dossier",
      subtitle: `${gate.recommendation} - ${gate.headline}`,
      findings: [
        { label: "Stage-gate recommendation", value: gate.recommendation },
        { label: "Decision headline", value: gate.headline },
        { label: "Study ID", value: record.study_id },
        { label: "Species / strain", value: `${record.study_summary.species} / ${record.study_summary.strain}` },
        { label: "Route and regimen", value: `${record.study_summary.route}; ${record.study_summary.frequency}` },
        { label: "Dose groups", value: `${record.study_summary.dose_groups_mg_kg.join(", ")} mg/kg` },
        { label: "Arms simulated", value: record.study_summary.arms_simulated },
        { label: "Design warnings", value: record.readiness_warnings.length ? record.readiness_warnings.join("; ") : "None recorded" },
      ],
      sections: [
        {
          title: "Study design and protocol",
          summary: "The declared study design, guideline context and planned arms. This is a virtual protocol review, not an executed animal study.",
          tables: [
            { headers: ["Design field", "Value"], rows: [
              ["Species / strain", `${record.study_summary.species} / ${record.study_summary.strain}`],
              ["Sex", record.study_summary.sex], ["Route / frequency", `${record.study_summary.route} / ${record.study_summary.frequency}`],
              ["Duration", `${record.study_summary.duration_h} h`], ["Formulation", record.study_summary.formulation],
              ["Guideline", studyProtocol.study_identity.guideline], ["Recovery period", `${record.study_summary.recovery_period_days} days`],
            ] },
            { title: "Dose groups and control", headers: ["Arm", "Dose (mg/kg)", "Animals / sex", "Study purpose"], rows: studyProtocol.arms.map((arm: any) => [arm.label, arm.dose_mg_per_kg, arm.n_per_sex, arm.purpose]) },
            { title: "Protocol gaps that must be resolved before a real study", headers: ["Required item", "Why it is needed"], rows: studyProtocol.planning_gaps.map((gap: any) => [gap.item, gap.reason]) },
          ],
        },
        {
          title: "Toxicokinetics and exposure",
          summary: record.toxicokinetics.limitations,
          tables: [
            { title: "ICH S3A toxicokinetics by dose group", headers: ["Arm", "Dose", "Cmax", "Tmax", "AUC", "AUC CV", "t1/2", "Accumulation"], rows: record.toxicokinetics.per_arm.map((row) => [row.arm, `${row.dose_mg_per_kg} mg/kg`, `${row.c_max_mg_per_l} mg/L`, `${row.t_max_h} h`, `${row.auc_mg_h_per_l} mg h/L`, `${row.auc_cv_percent}%`, `${row.t_half_h} h`, row.accumulation.available ? row.accumulation.accumulation_ratio : row.accumulation.reason]) },
            { title: "Exposure interpretation", headers: ["Assessment", "Result"], rows: [
              ["Dose proportionality", record.toxicokinetics.exposure_linearity.interpretation],
              ["Relative spread in dose-normalised AUC", record.toxicokinetics.exposure_linearity.relative_spread],
              ["Elimination context", topDoseDistribution.elimination_routes.interpretation],
              ["CNS penetration", `${topDoseDistribution.cns_penetration.classification}; brain:plasma AUC ${topDoseDistribution.cns_penetration.brain_plasma_auc_ratio}`],
            ] },
          ],
          notes: record.toxicokinetics.not_modelled.map((item) => `Not modelled - ${item.item}: ${item.reason}`),
        },
        {
          title: "Biodistribution and target-organ assessment",
          summary: `${record.organ_risk.summary.n_concern} target organ(s) of concern were identified by joining predicted mechanism with simulated tissue exposure.`,
          tables: [
            { title: "Top-dose tissue exposure", headers: ["Tissue", "AUC", "Cmax", "Tissue:plasma AUC", "Kp", "Partitioning"], rows: topDoseDistribution.tissues.map((tissue: any) => [tissue.label, `${tissue.auc_median} mg h/L`, `${tissue.c_max_median} mg/L`, tissue.tissue_plasma_auc_ratio, tissue.kp, tissue.partitioning]) },
            { title: "Organ risk map", headers: ["Organ", "Call", "Hazard", "Tissue:plasma AUC", "Driving domain"], rows: record.organ_risk.organs.map((organ) => [organ.label, organ.call_label, organ.hazard_probability ?? "Not predicted", organ.exposure.available ? organ.exposure.tissue_plasma_auc_ratio : "No compartment", organ.driving_domain ?? "None"]) },
          ],
          notes: [record.biodistribution.limitations, record.organ_risk.limitations],
        },
        {
          title: "Mechanistic toxicology and safety pharmacology",
          summary: toxicology.limitations,
          tables: [
            { title: "Mechanistic hazard panel", headers: ["Domain", "Guideline", "Hazard call", "Driver", "Organ / exposure"], rows: toxicology.domains.map((domain: any) => [domain.name, domain.guideline, domain.hazard_call.level, domain.hazard_call.driving_endpoint ?? "Not predicted", domain.organ ? `${domain.organ} / ${domain.exposure_context.available ? `${domain.exposure_context.tissue_plasma_auc_ratio}x plasma` : "unresolved"}` : "Systemic"]) },
            { title: "ICH S7A/S7B safety pharmacology", headers: ["System", "Assessment", "Study equivalent", "Next measurement"], rows: safetyPharmacology.systems.map((system: any) => [system.system, system.assessment, system.study_equivalent, system.next_measurement]) },
            { title: "Safety margins", headers: ["Arm", "Dose", "Margin to model NOAEL", "Margin to LD50", "Margin to public NOAEL"], rows: record.safety.per_arm_margins.map((margin) => [margin.arm, `${margin.dose_mg_per_kg} mg/kg`, margin.margin_to_allometric_noael, margin.margin_to_ld50, margin.margin_to_evidence_noael ?? "No public anchor"]) },
          ],
          notes: [safetyPharmacology.limitations, record.safety.limitation],
        },
        {
          title: "Study observations and welfare",
          summary: "The observation schedule identifies procedures and endpoints that a real study must perform. It does not predict clinical findings or pathology incidence.",
          tables: [
            { title: "Outcome schedule", headers: ["Procedure", "Timing", "Priority", "Focused parameters"], rows: record.study_outcomes.sections.map((section) => [section.name, section.schedule, section.status, section.focus_parameters.length ? section.focus_parameters.join(", ") : "Standard endpoint set"]) },
            { title: "Welfare and 3Rs", headers: ["Item", "Result"], rows: [
              ["Prospective severity", welfare.severity.study_prospective_severity], ["Monitoring frequency", welfare.humane_endpoints.monitoring_frequency],
              ["Animals in equivalent wet study", welfare.reduction_3rs.animals_in_equivalent_wet_study], ["Animals avoided by simulation", welfare.reduction_3rs.animals_avoided],
              ["Dosing administrations / animal", welfare.procedure_burden.dosing_administrations_per_animal], ["Humane endpoint principle", welfare.humane_endpoints.note],
            ] },
          ],
          notes: [welfare.severity.limitations, welfare.reduction_3rs.note],
        },
        {
          title: "Points of departure, model context and limitations",
          summary: "These are planning anchors for the next decision. They do not establish a NOAEL or replace measured evidence.",
          tables: [
            { title: "Points of departure", headers: ["Anchor", "Dose", "Strength", "Basis"], rows: pointsOfDeparture.candidates.map((candidate: any) => [candidate.name, `${candidate.dose_mg_per_kg} mg/kg`, candidate.strength, candidate.basis]) },
            { title: "Preferred planning anchor", headers: ["Item", "Value"], rows: preferredPod ? [["Selected anchor", preferredPod.name], ["Dose", `${preferredPod.dose_mg_per_kg} mg/kg`], ["Strength", preferredPod.strength], ["Provenance", preferredPod.provenance]] : [["Selected anchor", "None"]] },
            { title: "Models used", headers: ["Block", "Model", "Provenance"], rows: record.selected_scientific_models.map((model) => [model.block, model.model, model.provenance]) },
          ],
          notes: [pointsOfDeparture.noael_determination.reason, record.validation_evidence.headline, record.validation_evidence.limitations],
        },
      ],
    });
  }

  return <>
    <div className="row" style={{ marginBottom: 14, gap: 8 }}>
      <span className="pill"><FlaskConical size={12} /> {record.study_summary.simulation_engine}</span>
      <span className="pill">Study {record.study_id}</span>
      <span className="pill">{record.arms.length} arms simulated</span>
    </div>

    {record.readiness_warnings.length > 0 && (
      <Notice kind="warn" icon={<AlertTriangle size={16} />}>
        <b>Design warnings returned with this study</b>
        <ul style={{ marginTop: 6 }}>{record.readiness_warnings.map((warning, index) => <li key={index}>· {warning}</li>)}</ul>
      </Notice>
    )}

    <div className={`gate-banner ${gate.recommendation === "GO" ? "go" : gate.recommendation === "NO-GO" ? "nogo" : "cond"}`}>
      <span className="badge">{gate.recommendation}</span>
      <div><b>Stage-gate recommendation</b><p>{gate.headline}</p></div>
    </div>

    <TileRow>
      <Tile icon={<Boxes size={16} />} label="Dose groups simulated" value={record.arms.length}
        note={record.arms.some((entry) => entry.confidence.level === "low") ? `${record.arms.filter((entry) => entry.confidence.level === "low").length} arms flagged low confidence by the engine` : "All arms at the engine's stated confidence"}
        tone={record.arms.some((entry) => entry.confidence.level === "low") ? "warn" : "good"} />
      <Tile icon={<Users size={16} />} label="Animals in an equivalent wet study" value={record.welfare.reduction_3rs.animals_in_equivalent_wet_study}
        note={`${record.welfare.reduction_3rs.breakdown.main_study_animals} main · ${record.welfare.reduction_3rs.breakdown.recovery_animals} recovery · ${record.welfare.reduction_3rs.breakdown.satellite_tk_animals} satellite TK`} />
      <Tile icon={<Rabbit size={16} />} label="Animals not used" value={record.welfare.reduction_3rs.animals_avoided}
        note="This simulation used none; the count is what the same design would have consumed" tone="good" />
      <Tile icon={<Scale size={16} />} label="Preferred point of departure"
        value={record.points_of_departure.preferred_pod ? num(record.points_of_departure.preferred_pod.dose_mg_per_kg) : "—"} unit="mg/kg"
        note={record.points_of_departure.preferred_pod ? `${record.points_of_departure.preferred_pod.name} · rated ${record.points_of_departure.preferred_pod.strength}` : "No anchor rated strong or moderate"}
        tone={record.points_of_departure.preferred_pod?.strength === "strong" ? "good" : "warn"} />
      <Tile icon={<Activity size={16} />} label="Exposure linearity"
        value={(record.toxicokinetics.exposure_linearity as any).linear ? "Linear" : "Non-linear"}
        note={`Dose-normalised AUC spread ${num((record.toxicokinetics.exposure_linearity as any).relative_spread)} against a ${(record.toxicokinetics.exposure_linearity as any).tolerance} tolerance`}
        tone={(record.toxicokinetics.exposure_linearity as any).linear ? "good" : "warn"} />
    </TileRow>

    {record.therapeutic_area_endpoints && (() => {
      const resolution = record.therapeutic_area_endpoints;
      return <section className="panel">
        <SectionHeader icon={<Target size={18} />} eyebrow="ENDPOINT READINESS" title={`Therapeutic-area endpoints — ${resolution.therapeutic_area.label}`} accent="l3"
          description="What fraction of the therapeutic area's endpoints this programme has resolved, and which are below their cited target." />
        <TileRow>
          <Tile label="Endpoints resolved" value={`${resolution.summary.resolved}/${resolution.summary.applicable}`} note="Applicable to this layer" tone="brand" />
          <Tile label="Efficacy answered" value={`${resolution.summary.efficacy_resolved}/${resolution.summary.efficacy_total}`} note="Efficacy endpoints with a value" />
          <Tile label="Below target" value={resolution.summary.cautions} note="Resolved but under the cited threshold" tone={resolution.summary.cautions ? "warn" : "good"} />
          <Tile label="Need an input" value={resolution.summary.unresolved} note="Named in the table below" tone={resolution.summary.unresolved ? "warn" : "good"} />
        </TileRow>
      </section>;
    })()}

    {/* A non-sticky marker at the strip's resting position. The strip itself
        is pinned, so its own rect can never tell us how far we have scrolled
        past it. */}
    <div className="tabs-anchor" aria-hidden="true" />
    <nav className="tabs" role="tablist">
      {TABS.map((entry) => (
        <button key={entry.key} role="tab" aria-selected={tab === entry.key}
          className={tab === entry.key ? "active" : ""} onClick={() => setTab(entry.key)}>
          {entry.icon}<span>{entry.label}</span>
        </button>
      ))}
    </nav>

    {/* ── Decision ────────────────────────────────────────────────────── */}
    {tab === "glance" && (() => {
      const stage = stageAnnotations(record);
      return <BioTwinStage
        running={false} steps={SIM_STEPS} durationMs={SIM_MS}
        subject={t("{species} · virtual subject 01", { species: titleCase(design.speciesId) })}
        stats={stage.stats} callouts={stage.callouts} coverage={stage.coverage}
        footnote="Readings are taken from this study's record at the top dose group. The animation is an illustration of a repeat-dose study, not a rendering of this compound."
      />;
    })()}

    {tab === "decision" && <>
      <Card icon={<Waves size={16} />} title="PK study" subtitle="Protocol, endpoint groups and model qualification" note={record.pk_study.qualification.message}>
        <DlGrid entries={[
          ["Study type", titleCase(String(record.pk_study.study_type))],
          ["Species", record.pk_study.protocol.species],
          ["Strain", record.pk_study.protocol.strain],
          ["Route", record.pk_study.protocol.route],
          ["Schedule", record.pk_study.protocol.frequency],
          ["Duration", `${record.pk_study.protocol.duration_h} h`],
          ["Dose groups", `${(record.pk_study.protocol.dose_groups_mg_kg as number[]).join(", ")} mg/kg`],
          ["Cohort size", record.pk_study.protocol.cohort_size],
          ["Formulation", record.pk_study.protocol.formulation],
        ]} />
        <div className="sub-label">Endpoint groups</div>
        <div className="criteria">
          {record.pk_study.endpoint_groups.map((group: any) => (
            <div className="criterion" data-tone={tone(group.status)} key={group.id}>
              <div className="criterion-head"><strong>{group.title}</strong><StatusPill status={group.status} /></div>
              {/* One chip per endpoint. Joined into a single " · " string these
                  ran together into an unreadable line of names and units. */}
              <ul className="criterion-chips">
                {group.endpoints.map((endpoint: any) => (
                  <li key={endpoint.label}>{endpoint.label}{endpoint.unit ? <em>{endpoint.unit}</em> : null}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="sub-label">Models and methods</div>
        <DataTable
          columns={[
            { key: "m", header: "Model", render: (row: any) => <b>{row.name}</b> },
            { key: "r", header: "Use", render: (row: any) => row.role },
            { key: "s", header: "Study status", render: (row: any) => <StatusPill status={row.status === "completed" ? "pass" : "unknown"} label={titleCase(row.status)} /> },
            { key: "q", header: "Qualification", render: (row: any) => <StatusPill status={row.qualification} /> },
            { key: "l", header: "Limitations", render: (row: any) => (row.limitations ?? []).join(" ") || row.availability_reason || "—" },
          ]}
          rows={record.pk_study.model_executions}
        />
        <p className="hint-muted mt">{record.pk_study.data_retention.message}</p>
      </Card>

      <DossierFlow dossier={record.study_dossier} />

      {/* The tally is a header strip rather than a column beside the criteria.
          A donut is a few hundred pixels tall and the criteria list runs to
          nearly a thousand, so side-by-side left most of the card empty and
          squeezed eight criteria into one narrow column. */}
      <Card icon={<ShieldCheck size={16} />} title="Decision criteria" note={gate.limitations}>
        <div className="criteria-summary">
          <SegmentDonut
            segments={[
              { key: "pass", label: "Met", value: Object.values(gate.criteria).filter((entry) => entry.status === "pass").length, tone: "good" },
              { key: "caution", label: "Conditional", value: Object.values(gate.criteria).filter((entry) => entry.status === "caution").length, tone: "warn" },
              { key: "fail", label: "Not met", value: Object.values(gate.criteria).filter((entry) => entry.status === "fail").length, tone: "bad" },
            ]}
            centreValue={Object.values(gate.criteria).filter((entry) => entry.status === "pass").length}
            centreTotal={Object.keys(gate.criteria).length} centreLabel="criteria met"
          />
          <p className="criteria-summary-note">
            Each criterion is judged independently. A single unmet criterion can set the recommendation
            regardless of the others.
          </p>
        </div>
        <div className="criteria">
          {Object.entries(gate.criteria).map(([key, value]) => (
            <div className="criterion" data-tone={tone(value.status)} key={key}>
              <div className="criterion-head"><strong>{titleCase(key)}</strong><StatusPill status={value.status} /></div>
              <span>{value.rationale}</span>
            </div>
          ))}
        </div>
        <div className="sub-label">Recommended next measurements — ordered by value of information</div>
        <ol className="rail-list">
          {gate.value_of_information.map((item, index) => <li key={index}><span className="n">{index + 1}</span><span>{item}</span></li>)}
        </ol>
      </Card>

      <Card icon={<Layers size={16} />} title="Study summary"><PresentationGroups groups={record.presentation.groups as any} /></Card>

      <Card icon={<Scale size={16} />} title="Safety margins" note={record.safety.limitation}>
        <Anchors entries={[
          ["Evidence NOAEL", record.safety.anchors.evidence_noael.value_mg_kg_day != null ? `${num(record.safety.anchors.evidence_noael.value_mg_kg_day)} mg/kg/day` : "not located"],
          ["Allometric NOAEL (model)", `${num(record.safety.anchors.allometric_mtd_noael.estimated_noael_mg_kg_study_species)} mg/kg (${record.safety.anchors.allometric_mtd_noael.confidence})`],
          ["Acute LD50 anchor", `${num(record.safety.anchors.ld50.value_mg_kg)} mg/kg`],
          ["Preferred point of departure", record.points_of_departure.preferred_pod ? `${num(record.points_of_departure.preferred_pod.dose_mg_per_kg)} mg/kg` : "not selected"],
        ]} />
        <BarChart
          title="Margin to the allometric NOAEL by arm"
          subtitle="Ratio of the model NOAEL to the administered dose"
          points={record.safety.per_arm_margins.map((margin: any) => ({
            label: margin.arm, value: margin.margin_to_allometric_noael,
            detail: `${num(margin.margin_to_allometric_noael)}×`,
            tone: margin.margin_to_allometric_noael >= 1 ? ("good" as const) : ("bad" as const),
          }))}
          valueLabel="fold" axisLabel="Dose group"
          reference={{ value: 1, label: "1× — the dose meets the NOAEL estimate" }}
          footnote="The anchor is an allometrically scaled model NOAEL, not a measured one. Every margin inherits that model's confidence."
        />
        <div className="mt">
          <DataTable
            columns={[
              { key: "a", header: "Arm", render: (row: any) => <b>{row.arm}</b> },
              { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
              { key: "n", header: "Margin → model NOAEL", align: "right", render: (row: any) => `${num(row.margin_to_allometric_noael)}×` },
              { key: "e", header: "Margin → measured NOAEL", align: "right", render: (row: any) => row.margin_to_evidence_noael != null ? `${num(row.margin_to_evidence_noael)}×` : "—" },
              { key: "l", header: "Margin → LD50", align: "right", render: (row: any) => `${num(row.margin_to_ld50)}×` },
            ]}
            rows={record.safety.per_arm_margins}
          />
        </div>
        {record.safety.hazard_flags.length > 0 && <>
          <div className="sub-label">Hazard flags carried into the margin discussion</div>
          <ul className="rail-tags">
            {record.safety.hazard_flags.map((flag: any, index: number) => (
              <li key={index}><AlertTriangle size={12} />{flag.endpoint} — {flag.signal}{flag.probability != null ? ` (p ${num(flag.probability, 2)})` : ""}{flag.organ ? ` · ${titleCase(flag.organ)}` : ""}</li>
            ))}
          </ul>
        </>}
      </Card>

      <Card icon={<GitCompare size={16} />} title="Sensitivity and uncertainty" note={record.sensitivity.interpretation} subtitle={record.sensitivity.method}>
        <p className="card-sub">The exposure projection is most sensitive to <strong>{record.sensitivity.dominant_driver}</strong>. That is the measurement worth buying first.</p>
        <RankChart
          title="Local sensitivity of projected AUC"
          subtitle="Each input perturbed ±20%, one at a time"
          points={record.sensitivity.ranking.map((entry: any) => ({
            label: entry.input, value: entry.max_abs_sensitivity, detail: num(entry.max_abs_sensitivity),
            tone: entry.max_abs_sensitivity > 0.6 ? ("warn" as const) : ("neutral" as const),
          }))}
          valueLabel="|Δ AUC / Δ input|" domain={[0, 1]}
        />
        <div className="mt">
          <DataTable
            columns={[
              { key: "i", header: "Input", render: (row: any) => <code>{row.input}</code> },
              { key: "s", header: "Sensitivity", align: "right", render: (row: any) => num(row.max_abs_sensitivity) },
              { key: "n", header: "Why", render: (row: any) => row.note },
            ]}
            rows={record.sensitivity.ranking}
          />
        </div>
      </Card>
    </>}

    {/* ── TA endpoints ────────────────────────────────────────────────── */}
    {tab === "endpoints" && (record.therapeutic_area_endpoints
      ? <Card icon={<FlaskConical size={16} />}
        title={`Therapeutic-area endpoints — ${record.therapeutic_area_endpoints.therapeutic_area.label}`}
        subtitle={`${record.therapeutic_area_endpoints.layer} · ${record.therapeutic_area_endpoints.summary.resolved}/${record.therapeutic_area_endpoints.summary.applicable} resolved · ${record.therapeutic_area_endpoints.summary.cautions} below target`}
        note="Endpoint values are read from the models this run produced and compared against published thresholds. An unresolved endpoint names the input that would complete it; nothing is substituted.">
        <DataTable
          columns={[
            { key: "n", header: "Endpoint", render: (row: any) => <><b>{row.name}</b><small>{titleCase(row.kind)} · {row.layer}</small></> },
            { key: "v", header: "Value", align: "right", render: (row: any) => row.state === "resolved" ? `${typeof row.value === "number" ? num(row.value) : titleCase(String(row.value))}${row.unit && row.unit !== "categorical" ? ` ${row.unit}` : ""}` : "—" },
            { key: "t", header: "Threshold", render: (row: any) => row.threshold ? `${row.threshold.comparator} ${row.threshold.value ?? "—"} · ${row.threshold.is_regulatory ? "regulatory" : "operating point"}` : "—" },
            { key: "s", header: "Call", render: (row: any) => <StatusPill status={row.state === "unresolved" ? "model_required" : row.verdict === "pass" ? "pass" : row.verdict === "caution" ? "caution" : "computed"} label={row.state === "unresolved" ? "Needs input" : row.verdict === "pass" ? "Within target" : row.verdict === "caution" ? "Below target" : "Reported"} /> },
            { key: "r", header: "Basis", render: (row: any) => row.state === "resolved" ? row.rationale : <>{row.reason} {row.missing_input && <small>Needs: <code>{row.missing_input}</code></small>}</> },
            { key: "c", header: "Citation", render: (row: any) => row.threshold?.citation ?? "—" },
          ]}
          rows={record.therapeutic_area_endpoints.endpoints}
        />
      </Card>
      : <Unavailable title="Therapeutic-area endpoints" reason="No therapeutic area was stated for this project, so no endpoint panel was resolved." remediation="Select a therapeutic area in the Layer 1 rail and re-run the cascade." />)}

    {/* ── Protocol ────────────────────────────────────────────────────── */}
    {tab === "protocol" && <>
      {/* Before the single-agent protocol, because for a combination that
          protocol describes a design that cannot answer the question. */}
      {components.length >= 2 && <CombinationStudyPanel
        components={components}
        doses={design.doses}
        includeControl={design.includeControl}
        sexes={design.sex === "both" ? 2 : 1}
        perSexPerGroup={design.cohortSize}
        podByComponent={undefined}
        combinationPod={record.points_of_departure.preferred_pod?.dose_mg_per_kg}
      />}
      <Card icon={<ClipboardList size={16} />} title="Study protocol" subtitle="Planned design and measurements — no simulated clinical findings." note={record.study_protocol.limitations}>
        <DlGrid entries={Object.entries(record.study_protocol.study_identity).map(([key, value]) => [titleCase(key), value] as [string, unknown])} />
        <div className="sub-label">Treatment arms</div>
        <DataTable
          columns={[
            { key: "l", header: "Arm", render: (row: any) => <b>{row.label}</b> },
            { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
            { key: "n", header: "n / sex", align: "right", render: (row: any) => row.n_per_sex },
            { key: "p", header: "Role", render: (row: any) => row.purpose },
          ]}
          rows={record.study_protocol.arms}
        />
        <div className="sub-label">Planned animal accounting</div>
        <Anchors entries={[
          ["Main study", record.study_protocol.animal_accounting.main_study_animals],
          ["Recovery", record.study_protocol.animal_accounting.recovery_animals],
          ["Satellite TK", record.study_protocol.animal_accounting.satellite_tk_animals],
          ["Total planned", record.study_protocol.animal_accounting.total_animals],
        ]} />
        <p className="hint-muted">{record.study_protocol.animal_accounting.basis}</p>
      </Card>

      <Card icon={<Activity size={16} />} title="In-life timeline">
        <ol className="rail-list">
          {record.study_protocol.timeline.map((phase: any, index: number) => (
            <li key={phase.id ?? index}>
              <span className="n">{index + 1}</span>
              <span>
                <b style={{ display: "block" }}>{phase.phase}</b>
                <small style={{ color: "var(--faint)" }}>{phase.timing}</small>
                <ul style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {phase.activities.map((activity: string, itemIndex: number) => <li key={itemIndex} className="pill">{activity}</li>)}
                </ul>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card icon={<Microscope size={16} />} title="Measurement schedule" subtitle="Every planned measurement, with the priority the flagged mechanisms give it.">
        {record.study_protocol.measurement_schedule.map((procedure: any) => (
          <div key={procedure.id} style={{ borderBottom: "1px solid var(--hair)", padding: "12px 0" }}>
            <div className="row between">
              <div><b style={{ fontSize: 13 }}>{procedure.procedure}</b><br /><small className="muted">{procedure.timing}</small></div>
              <StatusPill status={procedure.priority === "heightened" ? "caution" : procedure.priority === "monitor" ? "caution" : "pass"} label={titleCase(procedure.priority)} />
            </div>
            <div className="ext-chips" style={{ marginTop: 8 }}>
              {procedure.parameters.map((parameter: string) => (
                <span key={parameter} style={procedure.focus_parameters.includes(parameter) ? { background: "var(--warn-soft)", borderColor: "var(--warn-line)", color: "var(--warn-ink)", fontWeight: 620 } : undefined}>{parameter}</span>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card icon={<AlertTriangle size={16} />} title="Required inputs before a live study"
        subtitle="ARRIVE 2.0 and 3Rs protocol items that were not supplied to the virtual-design request.">
        <DataTable
          columns={[
            { key: "i", header: "Item", render: (row: any) => <b>{row.item}</b> },
            { key: "r", header: "Why it is required", render: (row: any) => row.reason },
          ]}
          rows={record.study_protocol.planning_gaps}
        />
      </Card>
    </>}

    {/* ── Design ──────────────────────────────────────────────────────── */}
    {tab === "design" && (() => {
      const conformance = record.study_outcomes.design_conformance;
      const expectations = conformance.expectations;
      const submitted = conformance.submitted;
      const yesNo = (value: unknown) => (value === true ? "Yes" : value === false ? "No" : text(value));
      return <>
        <Card icon={<ClipboardList size={16} />} title="Study design and conformance"
          subtitle={`${conformance.selection_mode === "declared" ? "Declared study type" : "Inferred from duration"}: ${conformance.closest_guideline}`}
          note={conformance.note}>
          <p className="card-sub">{conformance.guideline_purpose}</p>
          <div className={`gate-banner ${conformance.conformant ? "go" : "cond"}`}>
            <span className="badge">{conformance.conformant ? "CONFORMANT" : `${conformance.gaps.length} GAP${conformance.gaps.length === 1 ? "" : "S"}`}</span>
            <div><b>{conformance.conformant ? "The submitted design sits inside the guideline envelope." : "The submitted design departs from the guideline envelope."}</b>
              <p>This is a design check only. It says nothing about GLP status, facility accreditation or study conduct.</p></div>
          </div>
          {conformance.selection_note && <p className="hint-muted">{conformance.selection_note}</p>}
          <DataTable
            columns={[
              { key: "p", header: "Parameter", render: (row: any) => <b>{row.parameter}</b> },
              { key: "s", header: "Submitted", render: (row: any) => row.submitted },
              { key: "e", header: "Guideline expects", render: (row: any) => row.expected },
            ]}
            rows={[
              { parameter: "Animals per sex per group", submitted: text(submitted.cohort_size_per_group), expected: `≥ ${text(expectations.animals_per_sex_per_group)}` },
              { parameter: "Active dose groups", submitted: text(submitted.active_dose_groups), expected: `≥ ${text(expectations.min_dose_groups)}` },
              { parameter: "Concurrent control", submitted: yesNo(submitted.control_group_present), expected: expectations.control_required ? "Required" : "Optional" },
              { parameter: "Species", submitted: titleCase(String(submitted.species)), expected: Array.isArray(expectations.allowed_species) ? expectations.allowed_species.map(titleCase).join(", ") : "Study-specific" },
              { parameter: "Route", submitted: text(submitted.route), expected: Array.isArray(expectations.allowed_routes) ? expectations.allowed_routes.join(", ") : "Study-specific" },
              { parameter: "Duration (h)", submitted: text(submitted.duration_h), expected: `${expectations.duration_window_h[0]} – ${expectations.duration_window_h[1]}` },
              { parameter: "Sexes", submitted: text(submitted.sexes), expected: expectations.both_sexes_expected ? "Both (2)" : "Either" },
              { parameter: "Dosing schedule", submitted: text(submitted.frequency), expected: "Study-specific" },
              { parameter: "Recovery period (days)", submitted: text(submitted.recovery_period_days), expected: expectations.recovery_policy === "conditional" ? `Conditional when reversibility is an objective · ~${expectations.recovery_typical_days} days typical` : "Not standard" },
              { parameter: "Satellite TK cohort", submitted: yesNo(submitted.satellite_tk), expected: expectations.satellite_tk_policy === "conditional_in_small_rodents" ? "Conditional; sampling-plan dependent (ICH S3A)" : "Case by case" },
              { parameter: "Formulation", submitted: text(submitted.formulation), expected: "Declared by the sponsor" },
            ]}
          />
          {conformance.gaps.length > 0 && <>
            <div className="sub-label">Gaps</div>
            <ul className="rail-tags">{conformance.gaps.map((gap, index) => <li key={index}><AlertTriangle size={12} />{gap}</li>)}</ul>
          </>}
          {conformance.considerations.length > 0 && <>
            <div className="sub-label">Considerations</div>
            <ul className="rail-tags">{conformance.considerations.map((item, index) => <li key={index} className="muted"><AlertTriangle size={12} />{item}</li>)}</ul>
          </>}
          <div className="sub-label">Animal accounting</div>
          <Anchors entries={[
            ["Main study", conformance.animal_accounting.main_study_animals],
            ["Recovery", conformance.animal_accounting.recovery_animals],
            ["Satellite TK", conformance.animal_accounting.satellite_tk_animals],
            ["Total", conformance.animal_accounting.total_animals],
          ]} />
          <p className="hint-muted">{conformance.animal_accounting.basis}</p>
          <div className="sub-label">Recovery washout</div>
          {conformance.recovery_adequacy.available ? <>
            <Anchors entries={[
              ["Recovery period", `${(conformance.recovery_adequacy as any).recovery_period_days} days`],
              ["Terminal half-life", `${num((conformance.recovery_adequacy as any).terminal_half_life_h)} h`],
              ["Half-lives covered", num((conformance.recovery_adequacy as any).half_lives_covered)],
              ["Adequate for washout", (conformance.recovery_adequacy as any).adequate_for_washout ? "Yes" : "No"],
            ]} />
            <p className="hint-muted">{(conformance.recovery_adequacy as any).interpretation}</p>
            <p className="limitation">{(conformance.recovery_adequacy as any).basis}</p>
          </> : <p className="hint-muted">{(conformance.recovery_adequacy as any).reason}</p>}
        </Card>

        <Card icon={<ClipboardList size={16} />} title="Study-report rollup — procedures and where the scrutiny falls"
          subtitle={`${record.study_outcomes.summary.n_sections} procedures · ${record.study_outcomes.summary.n_under_heightened_scrutiny} under heightened scrutiny`}
          note={record.study_outcomes.limitations}>
          {record.study_outcomes.summary.sections_to_watch.length > 0 && (
            <Notice kind="warn" icon={<AlertTriangle size={15} />}>Sections to watch: <b>{record.study_outcomes.summary.sections_to_watch.join(", ")}</b></Notice>
          )}
          {record.study_outcomes.sections.map((section: any) => (
            <div key={section.id} style={{ borderBottom: "1px solid var(--hair)", padding: "12px 0" }}>
              <div className="row between">
                <div><b style={{ fontSize: 13 }}>{section.name}</b><br /><small className="muted">{section.schedule}</small></div>
                <StatusPill status={section.status === "heightened_scrutiny" ? "fail" : section.status === "monitor" ? "caution" : "pass"} label={titleCase(section.status)} />
              </div>
              <div className="ext-chips" style={{ marginTop: 8 }}>
                {section.parameters.map((parameter: string) => (
                  <span key={parameter} style={section.focus_parameters.includes(parameter) ? { background: "var(--warn-soft)", borderColor: "var(--warn-line)", color: "var(--warn-ink)", fontWeight: 620 } : undefined}>{parameter}</span>
                ))}
              </div>
              {section.driven_by.length > 0 && <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {section.driven_by.map((driver: any, index: number) => (
                  <span className="pill warn" key={index}>{driver.domain}{driver.organ ? ` · ${titleCase(driver.organ)}` : ""}{driver.probability != null ? ` · ${num(driver.probability, 2)}` : ""}</span>
                ))}
              </div>}
            </div>
          ))}
        </Card>
      </>;
    })()}

    {/* ── Welfare ─────────────────────────────────────────────────────── */}
    {tab === "welfare" && <>
      <Card icon={<Users size={16} />} title="3Rs Reduction — animals not used"
        subtitle="Every simulated cohort is animals that were not used. This is the count an equivalent wet study of this exact design would consume."
        note={record.welfare.reduction_3rs.note}>
        {/* A donut beside a table: the donut is the shorter of the two by a
            wide margin, so its column is sized to the figure and centred
            against the table rather than stretched to the table's height. */}
        <div className="metric-split">
          <MetricDonut value={record.welfare.reduction_3rs.animals_avoided} total={record.welfare.reduction_3rs.animals_in_equivalent_wet_study}
            label="avoided" tone="good" caption="Exact wet-study animal count avoided — arithmetic on the declared design, not an estimate." />
          <div>
            <TileRow>
              <Tile label="Animals not used" value={record.welfare.reduction_3rs.animals_avoided} note="This study" tone="good" />
              <Tile label="Used by the simulation" value={0} note="No animal was used" tone="good" />
            </TileRow>
            <DataTable
              columns={[
                { key: "k", header: "Cohort", render: (row: any) => row.k },
                { key: "v", header: "Animals", align: "right", render: (row: any) => row.v == null ? "—" : num(row.v) },
              ]}
              rows={[
                { k: "Main study", v: record.welfare.reduction_3rs.breakdown.main_study_animals },
                { k: "Recovery", v: record.welfare.reduction_3rs.breakdown.recovery_animals },
                { k: "Satellite TK", v: record.welfare.reduction_3rs.breakdown.satellite_tk_animals },
                { k: "Groups × sexes", v: record.welfare.reduction_3rs.breakdown.groups_total * record.welfare.reduction_3rs.breakdown.sexes },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card icon={<AlertTriangle size={16} />} title="Prospective severity (EU 2010/63)"
        subtitle={record.welfare.severity.framework} note={record.welfare.severity.limitations}>
        <div className="grid-2">
          <SegmentDonut
            segments={(() => {
              const counts = new Map<string, number>();
              for (const entry of record.welfare.severity.per_arm) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
              const order = ["mild", "moderate", "severe"];
              return [...counts.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([category, value]) => ({
                key: category, label: titleCase(category), value,
                tone: category === "mild" ? ("good" as const) : category === "moderate" ? ("warn" as const) : ("bad" as const),
              }));
            })()}
            centreValue={record.welfare.severity.per_arm.filter((entry: any) => entry.category === "mild").length}
            centreTotal={record.welfare.severity.per_arm.length} centreLabel="arms at mild"
            caption="The study-level severity is the most severe arm, not an average. A single severe arm sets the classification."
          />
          <div>
            <Anchors entries={[
              ["Study-level severity", <span key="s" className={`pill ${record.welfare.severity.study_prospective_severity === "mild" ? "good" : record.welfare.severity.study_prospective_severity === "moderate" ? "warn" : "bad"}`}>{titleCase(record.welfare.severity.study_prospective_severity)}</span>],
              ["Procedural baseline", record.welfare.severity.procedural_baseline],
            ]} />
            <p className="hint-muted">{record.welfare.severity.basis}</p>
            <p className="hint-muted mt">{record.welfare.severity.terminal_procedure}</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "a", header: "Arm", render: (row: any) => <b>{row.arm}</b> },
            { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
            { key: "c", header: "Severity", render: (row: any) => <StatusPill status={row.category === "mild" ? "pass" : row.category === "moderate" ? "caution" : "fail"} label={titleCase(row.category)} /> },
            { key: "r", header: "Rationale", render: (row: any) => row.rationale },
            { key: "h", header: "Hazard drivers", render: (row: any) => row.hazard_drivers.join(", ") || "—" },
          ]}
          rows={record.welfare.severity.per_arm}
        />
      </Card>

      <Card icon={<HeartPulse size={16} />} title="Humane-endpoint monitoring plan"
        subtitle={record.welfare.humane_endpoints.monitoring_frequency} note={record.welfare.humane_endpoints.note}>
        <DataTable
          columns={[
            { key: "t", header: "Trigger", render: (row: any) => <b>{row.trigger}</b> },
            { key: "h", header: "Threshold", render: (row: any) => row.threshold },
            { key: "a", header: "Action", render: (row: any) => row.action },
            { key: "s", header: "Source", render: (row: any) => row.source },
          ]}
          rows={record.welfare.humane_endpoints.monitoring_plan}
        />
      </Card>

      <Card icon={<Activity size={16} />} title="Procedure burden" note={record.welfare.procedure_burden.note}>
        <Anchors entries={[
          ["Dosing administrations / animal", num(record.welfare.procedure_burden.dosing_administrations_per_animal)],
          ["Total administrations", num(record.welfare.procedure_burden.total_dosing_administrations)],
          ["Route", record.welfare.procedure_burden.route],
        ]} />
        <p className="hint-muted">{record.welfare.procedure_burden.dosing_note}</p>
        {record.welfare.procedure_burden.blood_sampling.available ? <>
          <div className="sub-label">Blood-sampling limits</div>
          <DataTable
            columns={[
              { key: "k", header: "Limit", render: (row: any) => row.k },
              { key: "v", header: "Value", align: "right", render: (row: any) => row.v },
            ]}
            rows={[
              { k: "Reference body weight", v: `${num((record.welfare.procedure_burden.blood_sampling as any).reference_body_weight_kg)} kg` },
              { k: "Blood volume", v: `${num((record.welfare.procedure_burden.blood_sampling as any).blood_volume_ml_per_kg)} mL/kg` },
              { k: "Estimated total blood volume", v: `${num((record.welfare.procedure_burden.blood_sampling as any).estimated_total_blood_volume_ml)} mL` },
              { k: "Max single sample (10%)", v: `${num((record.welfare.procedure_burden.blood_sampling as any).max_single_sample_ml)} mL` },
              { k: "Max cumulative / 28 d (15%)", v: `${num((record.welfare.procedure_burden.blood_sampling as any).max_cumulative_28d_ml)} mL` },
            ]}
          />
          <p className="hint-muted mt">{(record.welfare.procedure_burden.blood_sampling as any).guidance}</p>
          <p className="limitation">{(record.welfare.procedure_burden.blood_sampling as any).source}</p>
        </> : <p className="hint-muted">{(record.welfare.procedure_burden.blood_sampling as any).reason}</p>}
      </Card>

      <Card icon={<Database size={16} />} title="Welfare sources" note={record.welfare.limitations}>
        <ul className="rail-tags">
          {record.welfare.sources.map((source: any, index: number) => (
            <li key={index}><Database size={12} /><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>
          ))}
        </ul>
      </Card>
    </>}

    {/* ── Toxicokinetics ──────────────────────────────────────────────── */}
    {tab === "tk" && <>
      <Card icon={<Waves size={16} />} title="Exposure across the dose range"
        subtitle="The ICH S3A table plotted. Values are the medians from the table below; nothing is interpolated between dose groups."
        note={record.toxicokinetics.limitations}>
        <div className="chart-grid-2">
          <BarChart title="AUC by dose group" subtitle="Median simulated plasma exposure per arm"
            points={tkRows.map((row) => ({ label: row.arm, value: row.auc_mg_h_per_l, detail: num(row.auc_mg_h_per_l) }))}
            valueLabel="mg·h/L" axisLabel="Dose group" />
          <BarChart title="Cmax by dose group" subtitle="Median simulated peak plasma concentration per arm"
            points={tkRows.map((row) => ({ label: row.arm, value: row.c_max_mg_per_l, detail: num(row.c_max_mg_per_l) }))}
            valueLabel="mg/L" axisLabel="Dose group" />
          <BarChart title="Dose-normalised AUC" subtitle="Flat across dose groups is dose-proportional exposure"
            points={tkRows.map((row) => ({
              label: row.arm, value: row.dose_normalised_auc, detail: num(row.dose_normalised_auc),
              tone: (record.toxicokinetics.exposure_linearity as any).linear ? ("good" as const) : ("warn" as const),
            }))}
            valueLabel="mg·h/L per mg/kg" axisLabel="Dose group"
            footnote={(record.toxicokinetics.exposure_linearity as any).interpretation} />
          <BarChart title="AUC variability by dose group" subtitle="Coefficient of variation across the simulated cohort"
            points={tkRows.map((row) => ({ label: row.arm, value: row.auc_cv_percent, detail: `${num(row.auc_cv_percent, 1)}%` }))}
            valueLabel="CV %" axisLabel="Dose group" />
        </div>
      </Card>

      <Card icon={<Waves size={16} />} title="Toxicokinetics — ICH S3A exposure table"
        subtitle={`${record.toxicokinetics.schedule.frequency} · ${record.toxicokinetics.schedule.n_doses} dose(s) over ${record.toxicokinetics.schedule.study_duration_h} h`}
        note={record.toxicokinetics.limitations}>
        <DataTable
          columns={[
            { key: "arm", header: "Dose group", render: (row: any) => <b>{row.arm}</b> },
            { key: "dose", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
            { key: "cmax", header: "Cmax (mg/L)", align: "right", render: (row: any) => <span title={`90% interval ${num(row.c_max_interval[0])} – ${num(row.c_max_interval[1])}`}>{num(row.c_max_mg_per_l)}</span> },
            { key: "tmax", header: "Tmax (h)", align: "right", render: (row: any) => num(row.t_max_h) },
            { key: "auc", header: "AUC (mg·h/L)", align: "right", render: (row: any) => <span title={`90% interval ${num(row.auc_interval[0])} – ${num(row.auc_interval[1])}`}>{num(row.auc_mg_h_per_l)}</span> },
            { key: "cv", header: "AUC CV%", align: "right", render: (row: any) => num(row.auc_cv_percent, 1) },
            { key: "thalf", header: "t½ (h)", align: "right", render: (row: any) => num(row.t_half_h) },
            { key: "dn", header: "Dose-norm. AUC", align: "right", render: (row: any) => num(row.dose_normalised_auc) },
            { key: "acc", header: "Accumulation", align: "right", render: (row: any) => row.accumulation.available ? `${num(row.accumulation.accumulation_ratio)}×` : "—" },
          ]}
          rows={tkRows}
        />
        <div className={`notice ${(record.toxicokinetics.exposure_linearity as any).linear ? "good" : "warn"}`} style={{ marginTop: 14 }}>
          <Activity size={16} />
          <span>
            <b>{(record.toxicokinetics.exposure_linearity as any).linear ? "Linear exposure" : "Non-linear exposure"}</b>
            <p style={{ marginTop: 3 }}>{(record.toxicokinetics.exposure_linearity as any).interpretation}</p>
            <p className="tiny" style={{ marginTop: 5 }}>Relative spread {num((record.toxicokinetics.exposure_linearity as any).relative_spread)} against a tolerance of {(record.toxicokinetics.exposure_linearity as any).tolerance}.</p>
          </span>
        </div>
        <div className="sub-label">Exposure separation between dose groups</div>
        <DataTable
          columns={[
            { key: "f", header: "From", render: (row: any) => row.from_arm },
            { key: "t", header: "To", render: (row: any) => row.to_arm },
            { key: "d", header: "Dose ratio", align: "right", render: (row: any) => `${num(row.dose_ratio)}×` },
            { key: "a", header: "AUC ratio", align: "right", render: (row: any) => `${num(row.auc_ratio)}×` },
          ]}
          rows={record.toxicokinetics.dose_group_separation}
        />
        <div className="sub-label">Explicitly not modelled</div>
        <DataTable
          columns={[
            { key: "i", header: "Item", render: (row: any) => <b>{row.item}</b> },
            { key: "r", header: "Why", render: (row: any) => row.reason },
          ]}
          rows={record.toxicokinetics.not_modelled}
        />
      </Card>

      <Card icon={<GitCompare size={16} />} title="Dose comparison">
        {record.pkpd.dose_proportionality.available ? <>
          <Anchors entries={[
            ["Power-model slope β", num((record.pkpd.dose_proportionality as any).beta_slope)],
            ["Classification", titleCase((record.pkpd.dose_proportionality as any).classification)],
            ["Confidence interval", (record.pkpd.dose_proportionality as any).confidence_interval.map((value: number) => num(value)).join(" – ")],
            ["Model", (record.pkpd.dose_proportionality as any).model],
          ]} />
          <p className="hint-muted">{(record.pkpd.dose_proportionality as any).interpretation}</p>
        </> : <p className="hint-muted">{(record.pkpd.dose_proportionality as any).reason}</p>}
        {record.pkpd.exposure_response.available && <p className="hint-muted mt">{record.pkpd.exposure_response.interpretation}</p>}
      </Card>
    </>}

    {/* ── Exposure & distribution ─────────────────────────────────────── */}
    {tab === "exposure" && <>
      {record.pkpd.per_arm.some((entry: any) => entry.target_coverage?.available) && (
        <Card icon={<Target size={16} />} title="Target engagement across the dose range"
          subtitle="1:1 mass-action occupancy from simulated free drug and the resolved affinity anchor.">
          <BarChart
            title="Average target occupancy by dose group"
            subtitle="Occupancy averaged across the dosing interval"
            points={record.pkpd.per_arm.filter((entry: any) => entry.target_coverage?.available).map((entry: any) => ({
              label: entry.arm.label, value: entry.target_coverage.average_occupancy * 100,
              detail: `${(entry.target_coverage.average_occupancy * 100).toFixed(0)}%`,
              tone: entry.target_coverage.average_occupancy >= 0.5 ? ("good" as const) : ("neutral" as const),
            }))}
            valueLabel="% occupancy" axisLabel="Dose group"
            reference={{ value: 50, label: "50% engagement cutoff" }}
            footnote="Target engagement, not an efficacy or pharmacodynamic-effect prediction. Plasma free drug is the biophase surrogate."
          />
          <div className="mt">
            <DataTable
              columns={[
                { key: "a", header: "Arm", render: (row: any) => <b>{row.arm.label}</b> },
                { key: "k", header: "Kd (nM)", align: "right", render: (row: any) => num(row.target_coverage.kd_nm) },
                { key: "p", header: "Peak free (nM)", align: "right", render: (row: any) => num(row.target_coverage.peak_free_concentration_nm, 4) },
                { key: "v", header: "Average free (nM)", align: "right", render: (row: any) => num(row.target_coverage.average_free_concentration_nm, 4) },
                { key: "po", header: "Peak occupancy", align: "right", render: (row: any) => pct(row.target_coverage.peak_occupancy, 1) },
                { key: "ao", header: "Average occupancy", align: "right", render: (row: any) => pct(row.target_coverage.average_occupancy, 1) },
              ]}
              rows={record.pkpd.per_arm.filter((entry: any) => entry.target_coverage?.available)}
            />
          </div>
        </Card>
      )}

      <Card icon={<Activity size={16} />} title="Plasma pharmacokinetics by dose group"
        actions={record.arms.length > 1 ? <select value={armIndex} onChange={(event) => setArmIndex(Number(event.target.value))} style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}>
          {record.arms.map((entry, index) => <option key={index} value={index}>{entry.arm.label}</option>)}
        </select> : undefined}>
        <ProfileChart
          title={`Plasma concentration–time — ${arm.arm.label}`}
          subtitle="Cohort mean with the 5th–95th percentile population band"
          time={arm.cohort.time}
          series={[{ label: "Plasma", mean: arm.cohort.curves.plasma.mean, p05: arm.cohort.curves.plasma.p05, p95: arm.cohort.curves.plasma.p95 }]}
          xLabel="Time (h)" yLabel="Concentration (mg/L)"
        />
        <div className="mt">
          <Anchors entries={[
            ["Cmax", `${num(arm.cohort.endpoints.plasma.c_max.median, 4)} mg/L`],
            ["AUC", `${num(arm.cohort.endpoints.plasma.auc.median, 4)} mg·h/L`],
            ["t½", `${num(arm.cohort.endpoints.plasma.t_half.median, 2)} h`],
            ["Confidence", titleCase(arm.confidence.level)],
          ]} />
          <p className="hint-muted">{arm.confidence.rationale}</p>
          {arm.warnings.length > 0 && <ul className="rail-tags mt">{arm.warnings.map((warning, index) => <li key={index}><AlertTriangle size={12} />{warning}</li>)}</ul>}
        </div>
      </Card>

      <Card icon={<Boxes size={16} />} title="Biodistribution — per-organ exposure"
        subtitle={record.biodistribution.model} note={record.biodistribution.limitations}
        actions={record.biodistribution.per_arm.length > 1 ? <select value={armIndex} onChange={(event) => setArmIndex(Number(event.target.value))} style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}>
          {record.biodistribution.per_arm.map((entry: any, index: number) => <option key={index} value={index}>{entry.arm.label}</option>)}
        </select> : undefined}>
        <div className="grid-2">
          <RankChart
            title="Cross-arm tissue ranking"
            subtitle="Mean tissue:plasma AUC ratio across every simulated dose group"
            points={record.biodistribution.consensus_tissue_ranking.map((row: any) => ({
              label: row.label, value: row.mean_tissue_plasma_ratio, detail: `${num(row.mean_tissue_plasma_ratio, 2)}×`,
              tone: row.dose_dependent ? ("warn" as const) : ("neutral" as const),
            }))}
            valueLabel="× plasma"
            reference={{ value: 1, label: "1× — equal to plasma" }}
            footnote={record.biodistribution.dose_dependent_distribution ? "At least one tissue partitions differently across the dose range, so partitioning is not dose-independent." : "Partitioning is consistent across the studied dose range."}
          />
          <ProfileChart
            title="Plasma versus the five highest-exposure tissues"
            subtitle={`${bio.arm.label} dose group`}
            time={arm.cohort.time}
            series={[
              { label: "Plasma", mean: arm.cohort.curves.plasma.mean },
              ...bio.exposure_rank.slice(0, 5).map((row: any) => ({ label: row.label, mean: arm.cohort.curves[row.organ].mean })),
            ]}
            xLabel="Time (h)" yLabel="Concentration (mg/L)"
          />
        </div>
        <div className="sub-label">Per-organ exposure — {bio.arm.label}</div>
        <DataTable
          columns={[
            { key: "t", header: "Tissue", render: (row: any) => <b>{row.label}</b> },
            { key: "cmax", header: "Cmax (mg/L)", align: "right", render: (row: any) => num(row.c_max_median, 4) },
            { key: "tmax", header: "Tmax (h)", align: "right", render: (row: any) => num(row.t_max_median_h, 2) },
            { key: "auc", header: "AUC (mg·h/L)", align: "right", render: (row: any) => num(row.auc_median, 4) },
            { key: "ratio", header: "Tissue:plasma AUC", align: "right", render: (row: any) => num(row.tissue_plasma_auc_ratio, 3) },
            { key: "kp", header: "Kp", align: "right", render: (row: any) => num(row.kp, 3) },
            { key: "p", header: "Partitioning", render: (row: any) => <StatusPill status={row.partitioning === "high" ? "caution" : "pass"} label={titleCase(row.partitioning)} /> },
          ]}
          rows={bio.tissues}
        />
        <div className="grid-2 mt">
          <Card icon={<Boxes size={15} />} title="CNS penetration">
            <Anchors entries={[
              ["Classification", bio.cns_penetration.classification],
              ["Brain:plasma AUC", num(bio.cns_penetration.brain_plasma_auc_ratio, 3)],
              ["Kp,uu estimate", num(bio.cns_penetration.kp_uu_estimate, 3)],
              ["BBB model", num(bio.cns_penetration.bbb_permeability_probability, 3)],
            ]} />
            {bio.cns_penetration.concordance_note && <p className="limitation"><AlertTriangle size={13} /> {bio.cns_penetration.concordance_note}</p>}
          </Card>
          <Card icon={<Activity size={15} />} title="Elimination and accumulation">
            <Anchors entries={[
              ["Hepatic fraction", pct(bio.elimination_routes.fraction_hepatic, 1)],
              ["Renal fraction", pct(bio.elimination_routes.fraction_renal, 1)],
              ["Repeat-dose accumulation", bio.accumulation.available ? `${num(bio.accumulation.accumulation_ratio)}×` : "not projected"],
              ["Highest-exposure tissue", bio.highest_exposure_tissue ?? "not resolved"],
            ]} />
            <p className="hint-muted">{bio.elimination_routes.interpretation}</p>
            {bio.accumulation.available ? <p className="hint-muted mt">{bio.accumulation.basis}</p> : <p className="hint-muted mt">{bio.accumulation.reason}</p>}
          </Card>
        </div>
      </Card>

      <Card icon={<Boxes size={16} />} title="Target-organ map"
        subtitle="The mechanistic hazard panel joined onto simulated tissue exposure. An organ is a concern only where a flagged mechanism and meaningful exposure coincide."
        note={record.organ_risk.limitations}>
        <div className="organ-map">
          <div>
            <div className="organ-grid">
              {record.organ_risk.organs.map((organ: any) => (
                <button key={organ.organ} className={`organ-tile ${selectedOrgan === organ.organ ? "selected" : ""}`}
                  style={{ ["--tile" as string]: ORGAN_FILL[organ.call] ?? ORGAN_FILL.no_signal }}
                  data-muted={organ.call === "not_predicted"}
                  title={`${organ.label} — ${organ.call_label}`}
                  onClick={() => setSelectedOrgan(organ.organ)}>
                  <span className="swatch" />
                  <span className="name">{organ.label}</span>
                  <span className="ratio">{organ.exposure.available ? `${num((organ.exposure as any).tissue_plasma_auc_ratio, 2)}×` : "—"}</span>
                </button>
              ))}
            </div>
            <div className="organ-legend">
              {record.organ_risk.legend.map((entry: any) => (
                <span key={entry.call}><i style={{ background: ORGAN_FILL[entry.call] ?? ORGAN_FILL.no_signal }} />{entry.label}</span>
              ))}
            </div>
            <div className="mt">
              <Anchors entries={[
                ["Target organs of concern", record.organ_risk.summary.target_organs_of_concern.join(", ") || "None"],
                ["Flagged, limited exposure", record.organ_risk.summary.flagged_but_unexposed.join(", ") || "None"],
                ["Highest-exposure organ", record.organ_risk.summary.highest_exposure_organ ?? "not resolved"],
              ]} />
            </div>
          </div>
          <div>
            <div className="organ-chips">
              {record.organ_risk.organs.map((organ: any) => (
                <button key={organ.organ} className={`organ-chip ${selectedOrgan === organ.organ ? "selected" : ""}`} onClick={() => setSelectedOrgan(organ.organ)}>
                  <i style={{ background: ORGAN_FILL[organ.call] ?? ORGAN_FILL.no_signal }} />{organ.label}
                </button>
              ))}
            </div>
            {activeOrgan && <div className="organ-detail">
              <div className="organ-detail-head">
                <div><b>{activeOrgan.label}</b><span>{activeOrgan.call_label}</span></div>
                <StatusPill status={activeOrgan.hazard_level} />
              </div>
              <p className="hint-muted">{activeOrgan.call_basis}</p>
              <div className="dl-grid" style={{ marginTop: 12 }}>
                <div><dt>Tissue:plasma AUC</dt><dd>{activeOrgan.exposure.available ? num((activeOrgan.exposure as any).tissue_plasma_auc_ratio, 3) : "—"}</dd></div>
                <div><dt>Cross-arm mean</dt><dd>{activeOrgan.exposure.available ? num((activeOrgan.exposure as any).consensus_tissue_plasma_ratio, 3) : "—"}</dd></div>
                <div><dt>Tissue Cmax</dt><dd>{activeOrgan.exposure.available ? `${num((activeOrgan.exposure as any).c_max_mg_per_l, 4)} mg/L` : "—"}</dd></div>
                <div><dt>Tissue AUC</dt><dd>{activeOrgan.exposure.available ? `${num((activeOrgan.exposure as any).auc_mg_h_per_l, 4)} mg·h/L` : "—"}</dd></div>
              </div>
              {activeOrgan.exposure.available && <p className="hint-muted mt">
                Exposure read at the <strong>{(activeOrgan.exposure as any).arm}</strong> dose group; the threshold for "meaningfully exposed" is {(activeOrgan.exposure as any).threshold}× plasma.
              </p>}
              {activeOrgan.domains.length > 0 ? <>
                <div className="sub-label">Toxicology domains scoring this organ</div>
                {activeOrgan.domains.map((domain: any, index: number) => (
                  <div className="organ-domain" key={domain.id ?? index}>
                    <div>
                      <div><b>{domain.name}</b><small>{domain.guideline}</small></div>
                      <div className="row" style={{ gap: 8 }}>
                        <StatusPill status={domain.hazard_level} />
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{domain.probability != null ? num(domain.probability, 2) : "—"}</span>
                      </div>
                    </div>
                    {domain.mechanism && <p>{domain.mechanism}</p>}
                  </div>
                ))}
              </> : <p className="hint-muted mt">No toxicology domain in the panel scores this organ.</p>}
              {activeOrgan.safety_pharmacology && <div className="notice warn mt">
                <ShieldAlert size={15} />
                <span><b>{activeOrgan.safety_pharmacology.system} — {titleCase(activeOrgan.safety_pharmacology.assessment)}</b><p style={{ marginTop: 3 }}>{activeOrgan.safety_pharmacology.rationale}</p></span>
              </div>}
            </div>}
            {record.organ_risk.systemic_domains.length > 0 && <div className="mt">
              <div className="sub-label">Systemic domains with no single target organ</div>
              <div className="row" style={{ gap: 6 }}>
                {record.organ_risk.systemic_domains.map((domain: any, index: number) => (
                  <span className={`pill ${domain.hazard_level === "high" ? "bad" : domain.hazard_level === "moderate" ? "warn" : ""}`} key={index}>
                    {domain.name}{domain.probability != null ? ` · ${num(domain.probability, 2)}` : ""}
                  </span>
                ))}
              </div>
            </div>}
          </div>
        </div>
      </Card>
    </>}

    {/* ── Toxicology ──────────────────────────────────────────────────── */}
    {tab === "toxicology" && <>
      <Card icon={<Microscope size={16} />} title="Regulatory toxicology panel"
        subtitle={`${record.toxicology.summary.n_domains} domains · ${record.toxicology.summary.n_predicted} predicted · ${record.toxicology.summary.n_flagged} flagged · ${record.toxicology.summary.n_high} high`}
        note={record.toxicology.limitations}>
        <div className="tox-summary-row">
          <div><small>High-hazard domains</small><b>{record.toxicology.summary.high_hazard_domains.join(", ") || "None reached the high band"}</b></div>
          <div><small>Target organs of concern</small><b>{record.toxicology.summary.target_organs_of_concern.map(titleCase).join(", ") || "None"}</b></div>
          <div><small>Not predicted</small><b>{record.toxicology.summary.not_predicted_domains.join(", ") || "None"}</b></div>
        </div>

        <Heatmap
          title="Hazard probability by domain"
          subtitle="The highest driver probability in each domain, against the 0.45 moderate and 0.70 high thresholds"
          columns={5} valueLabel="driving probability"
          cells={record.toxicology.domains.map((domain: any) => ({
            label: domain.name, value: domain.hazard_call.driving_probability ?? 0,
            detail: domain.hazard_call.driving_probability != null ? num(domain.hazard_call.driving_probability, 2) : "n/p",
          }))}
          footnote="A domain with no driver is reported as not predicted rather than assumed negative — the two are different scientific statements."
        />

        <div className="tox-matrix mt">
          {record.toxicology.domains.map((domain: any) => {
            const open = openDomain === domain.id;
            const call = domain.hazard_call;
            return <div key={domain.id} className={`tox-domain ${call.level}`}>
              <button className="tox-domain-head" onClick={() => setOpenDomain(open ? null : domain.id)}>
                <div><b>{domain.name}</b><small>{domain.guideline}</small></div>
                <div className="tox-domain-right">
                  {domain.organ && <span className="tox-organ">{titleCase(domain.organ)}</span>}
                  <StatusPill status={call.level} label={call.level === "not_predicted" ? "Not predicted" : titleCase(call.level)} />
                  <span className="tox-prob">{call.driving_probability != null ? num(call.driving_probability, 2) : "—"}</span>
                </div>
              </button>
              {open && <div className="tox-domain-body">
                <p className="tox-mechanism">{domain.mechanism}</p>
                <p className="tox-basis">{call.basis}</p>
                {domain.drivers.length > 0 ? <DataTable
                  columns={[
                    { key: "l", header: "Driver", render: (row: any) => <><b>{row.label}</b><small>{row.endpoint}</small></> },
                    { key: "v", header: "Normalised", align: "right", render: (row: any) => num(row.value, 3) },
                    { key: "r", header: "Raw value", align: "right", render: (row: any) => `${num(row.raw_value)} ${row.raw_unit ?? ""}` },
                    { key: "m", header: "Model", render: (row: any) => row.model },
                    { key: "p", header: "Provenance", render: (row: any) => <>{row.provenance}{row.in_domain === false && <small style={{ color: "var(--warn-ink)" }}>out of applicability domain</small>}</> },
                  ]}
                  rows={domain.drivers}
                /> : <p className="hint-muted">No model in the resolved panel produces a driver for this domain.</p>}
                {domain.exposure_context.available ? <div className={`notice ${(domain.exposure_context as any).meaningfully_exposed ? "warn" : "good"}`} style={{ marginTop: 12 }}>
                  <Boxes size={15} />
                  <span>
                    <b>{(domain.exposure_context as any).meaningfully_exposed ? "Organ meaningfully exposed" : "Limited organ exposure"}</b>
                    <p style={{ marginTop: 3 }}>{(domain.exposure_context as any).note}</p>
                    <p className="tiny" style={{ marginTop: 4 }}>Tissue AUC {num((domain.exposure_context as any).organ_auc_mg_h_per_l, 4)} mg·h/L · Cmax {num((domain.exposure_context as any).organ_cmax_mg_per_l, 4)} mg/L · threshold {(domain.exposure_context as any).threshold}× plasma</p>
                  </span>
                </div> : <p className="hint-muted mt">{(domain.exposure_context as any).reason}</p>}
                {domain.anticipated_findings && <div className="tox-findings">
                  <div className="sub-label">Endpoints a study would score for this mechanism</div>
                  {Object.entries(domain.anticipated_findings).filter(([key]) => key !== "note").map(([key, items]) => (
                    Array.isArray(items) && items.length > 0 && <div key={key}>
                      <b>{titleCase(key)}</b>
                      <ul>{(items as string[]).map((item, index) => <li key={index}>{item}</li>)}</ul>
                    </div>
                  ))}
                  <p className="limitation">{(domain.anticipated_findings as any).note}</p>
                </div>}
              </div>}
            </div>;
          })}
        </div>

        <div className="sub-label">Panel provenance</div>
        <DlGrid entries={[
          ["Panel sources", record.toxicology.panel_sources.join(", ")],
          ["Unresolved endpoints", record.toxicology.unresolved_endpoints.join(", ")],
        ]} />
      </Card>
    </>}

    {/* ── Safety pharmacology ─────────────────────────────────────────── */}
    {tab === "safetypharm" && <Card icon={<ShieldAlert size={16} />} title="Safety pharmacology — ICH S7A/S7B core battery"
      subtitle={`Referenced to the ${record.safety_pharmacology.reference_arm} group (${num(record.safety_pharmacology.reference_dose_mg_per_kg)} mg/kg)`}
      note={record.safety_pharmacology.limitations}>
      <div className={`gate-banner ${record.safety_pharmacology.summary.overall === "concern" ? "cond" : "go"}`}>
        <span className="badge">{titleCase(record.safety_pharmacology.summary.overall)}</span>
        <div>
          <b>Core battery projection</b>
          <p>
            {record.safety_pharmacology.summary.systems_of_concern.length ? `Systems of concern: ${record.safety_pharmacology.summary.systems_of_concern.join(", ")}. ` : ""}
            {record.safety_pharmacology.summary.systems_to_monitor.length ? `Systems to monitor: ${record.safety_pharmacology.summary.systems_to_monitor.join(", ")}.` : "No system was raised above the monitoring threshold."}
          </p>
        </div>
      </div>

      <Anchors entries={[
        ["Free Cmax at the top dose", `${num(record.safety_pharmacology.free_concentrations.free_cmax_uM, 5)} µM`],
        ["Total Cmax", `${num(record.safety_pharmacology.free_concentrations.total_cmax_uM, 4)} µM`],
        ["Unbound fraction", num(record.safety_pharmacology.free_concentrations.fu_plasma, 5)],
        ["Free Cmax (mass)", `${num(record.safety_pharmacology.free_concentrations.free_cmax_mg_per_l, 6)} mg/L`],
      ]} />

      {record.safety_pharmacology.systems.map((system: any, index: number) => (
        <div key={index} style={{ border: "1px solid var(--line)", borderRadius: 13, padding: 15, marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div><b style={{ fontSize: 14 }}>{system.system}</b><br /><small className="muted">{system.guideline}</small></div>
            <StatusPill status={system.assessment === "concern" ? "fail" : system.assessment === "monitor" ? "caution" : "pass"} label={titleCase(system.assessment)} />
          </div>
          <p className="hint-muted">{system.study_equivalent}</p>
          <p className="hint-muted mt">{system.rationale}</p>
          <div className="dl-grid mt">
            {Object.entries(system)
              .filter(([key, value]) => !["system", "guideline", "study_equivalent", "rationale", "assessment", "provenance", "next_measurement"].includes(key) && value !== null && value !== undefined && typeof value !== "object")
              .map(([key, value]) => <div key={key}><dt>{titleCase(key)}</dt><dd>{text(value)}</dd></div>)}
          </div>
          <p className="hint mt"><FlaskConical size={13} /> Next measurement: {system.next_measurement}</p>
        </div>
      ))}
    </Card>}

    {/* ── Interactions ────────────────────────────────────────────────── */}
    {tab === "interactions" && <Card icon={<Split size={16} />} title="Drug–drug interaction — FDA (2020) basic model"
      subtitle={`Unbound exposure from the ${record.ddi.reference_arm ?? "top-dose"} group`} note={record.ddi.limitations}>
      <div className="sub-label">Concentrations used in the basic model</div>
      <Anchors entries={Object.entries(record.ddi.concentrations).map(([key, value]) => [titleCase(key), num(value as number, 5)] as [string, React.ReactNode])} />

      <div className="sub-label">Perpetrator — could this compound change a co-medication's exposure?</div>
      <BarChart
        title="CYP inhibition probability by isoform"
        subtitle="Screening probabilities from the Veith qHTS heads, against the 0.5 call"
        points={(record.ddi.perpetrator as any).isoforms.map((isoform: any) => ({
          label: isoform.isoform, value: isoform.inhibitor_probability, detail: num(isoform.inhibitor_probability, 3),
          tone: isoform.inhibitor_probability >= 0.5 ? ("bad" as const) : isoform.inhibitor_probability >= 0.3 ? ("warn" as const) : ("good" as const),
        }))}
        valueLabel="P(inhibitor)" axisLabel="CYP isoform"
        reference={{ value: 0.5, label: "0.5 — the inhibition call" }}
        footnote="A probability is not a Ki. The FDA basic model needs a measured Ki; a flag defines which isoform to measure first."
      />
      <div className="mt">
        <DataTable
          columns={[
            { key: "i", header: "Isoform", render: (row: any) => <b>{row.isoform}</b> },
            { key: "c", header: "Call", render: (row: any) => <StatusPill status={row.inhibitor_probability >= 0.5 ? "caution" : "pass"} label={row.call} /> },
            { key: "p", header: "Inhibitor probability", align: "right", render: (row: any) => num(row.inhibitor_probability, 3) },
            { key: "k", header: "Ki that would trigger the cut-off", align: "right", render: (row: any) => row.ki_threshold_uM != null ? `${num(row.ki_threshold_uM)} µM` : "—" },
            { key: "s", header: "Index substrate", render: (row: any) => row.index_substrate },
            { key: "f", header: "Population fm", align: "right", render: (row: any) => pct(row.fraction_metabolised_population, 0) },
          ]}
          rows={(record.ddi.perpetrator as any).isoforms}
        />
      </div>
      <p className="hint">
        Flagged isoforms: <strong>{(record.ddi.perpetrator as any).flagged_isoforms.join(", ") || "none above the 0.5 call"}</strong> ·
        regulatory cut-offs R1 {num((record.ddi.perpetrator as any).cutoffs.hepatic_R1)} (hepatic), {num((record.ddi.perpetrator as any).cutoffs.intestinal_R1_CYP3A)} (intestinal CYP3A) ·
        {(record.ddi.perpetrator as any).reference}
      </p>

      <div className="sub-label">Victim — could a co-medication change this compound's exposure?</div>
      <div className={`notice ${(record.ddi.victim as any).risk === "high" ? "error" : (record.ddi.victim as any).risk === "moderate" ? "warn" : "good"}`}>
        <Split size={16} />
        <span>
          <b>{titleCase((record.ddi.victim as any).risk)} victim risk</b>
          <p style={{ marginTop: 3 }}>{(record.ddi.victim as any).rationale}</p>
          <p className="tiny" style={{ marginTop: 5 }}>
            Hepatic clearance fraction {pct((record.ddi.victim as any).fraction_cleared_hepatically, 0)} ·
            extraction ratio {num((record.ddi.victim as any).extraction_ratio)} ·
            hepatic first pass {num((record.ddi.victim as any).hepatic_first_pass)}
          </p>
        </span>
      </div>
      <DataTable
        columns={[
          { key: "i", header: "Isoform", render: (row: any) => <b>{row.isoform}</b> },
          { key: "c", header: "Substrate call", render: (row: any) => row.call },
          { key: "p", header: "Probability", align: "right", render: (row: any) => num(row.substrate_probability, 3) },
        ]}
        rows={(record.ddi.victim as any).substrate_calls}
      />
      <p className="limitation"><AlertTriangle size={13} /> {(record.ddi.victim as any).limitation}</p>

      <div className="sub-label">Transporters</div>
      <DlGrid entries={[
        ["P-gp inhibitor probability", num((record.ddi.transporters as any).pgp_inhibitor_probability, 3)],
        ["Role", (record.ddi.transporters as any).pgp_role],
        ["Coverage", (record.ddi.transporters as any).note],
      ]} />

      <div className="sub-label">In-vitro studies required to make this quantitative</div>
      <ol className="rail-list">
        {record.ddi.recommended_studies.map((study: string, index: number) => <li key={index}><span className="n">{index + 1}</span><span>{study}</span></li>)}
      </ol>
    </Card>}

    {/* ── Points of departure ─────────────────────────────────────────── */}
    {tab === "translation" && <>
      <Card icon={<Scale size={16} />} title="Points of departure — the Layer 4 bridge"
        subtitle="Every anchor the study can defend, with its strength and provenance. The lowest defensible anchor governs."
        note={record.points_of_departure.limitations}>
        {record.points_of_departure.preferred_pod ? <Anchors entries={[
          ["Preferred anchor", record.points_of_departure.preferred_pod.name],
          ["Dose", `${num(record.points_of_departure.preferred_pod.dose_mg_per_kg)} mg/kg`],
          ["Strength", titleCase(record.points_of_departure.preferred_pod.strength)],
          ["Provenance", record.points_of_departure.preferred_pod.provenance],
        ]} /> : <Notice kind="warn" icon={<AlertTriangle size={15} />}>No anchor rated strong or moderate was available, so no preferred point of departure was selected.</Notice>}

        <BarChart
          title="Candidate points of departure"
          subtitle="Every anchor the study can defend, on a log dose scale"
          logScale
          points={record.points_of_departure.candidates.map((candidate: any) => ({
            label: candidate.name.length > 22 ? `${candidate.name.slice(0, 20)}…` : candidate.name,
            value: candidate.dose_mg_per_kg, detail: `${num(candidate.dose_mg_per_kg)} mg/kg`,
            tone: candidate.strength === "strong" ? ("good" as const) : candidate.strength === "moderate" ? ("warn" as const) : ("neutral" as const),
          }))}
          valueLabel="mg/kg" axisLabel="Anchor"
          footnote="Colour is anchor strength, not dose. A weak anchor at a low dose is still a weak anchor."
        />
        <div className="mt">
          <DataTable
            columns={[
              { key: "n", header: "Anchor", render: (row: any) => <><b>{row.name}</b><small>{row.note}</small></> },
              { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => num(row.dose_mg_per_kg) },
              { key: "s", header: "Strength", render: (row: any) => <StatusPill status={row.strength === "strong" ? "pass" : row.strength === "moderate" ? "caution" : "unknown"} label={titleCase(row.strength)} /> },
              { key: "p", header: "Provenance", render: (row: any) => row.provenance },
              { key: "b", header: "Basis", render: (row: any) => row.basis },
              { key: "src", header: "Source", render: (row: any) => row.source },
            ]}
            rows={record.points_of_departure.candidates}
          />
        </div>

        {record.points_of_departure.preferred_pod_exposure.available && <>
          <div className="sub-label">Exposure at the preferred point of departure — reverse dosimetry</div>
          <Anchors entries={[
            ["Free Cmax", `${num((record.points_of_departure.preferred_pod_exposure as any).free_cmax_uM, 5)} µM`],
            ["Total Cmax", `${num((record.points_of_departure.preferred_pod_exposure as any).total_cmax_uM, 4)} µM`],
            ["AUC", `${num((record.points_of_departure.preferred_pod_exposure as any).auc_uM_h, 4)} µM·h`],
            ["Free AUC", `${num((record.points_of_departure.preferred_pod_exposure as any).free_auc_uM_h, 5)} µM·h`],
          ]} />
          <p className="limitation"><AlertTriangle size={13} /> {(record.points_of_departure.preferred_pod_exposure as any).basis}</p>
        </>}

        {record.points_of_departure.pharmacological_pod.available && <>
          <div className="sub-label">Occupancy ladder — the dose required for target engagement</div>
          <DataTable
            columns={[
              { key: "o", header: "Target occupancy", render: (row: any) => pct(row.target_occupancy, 0) },
              { key: "d", header: "Dose (mg/kg)", align: "right", render: (row: any) => row.available ? num(row.dose_mg_per_kg) : "not derivable" },
              { key: "c", header: "Required free Cmax (µM)", align: "right", render: (row: any) => num(row.required_free_cmax_uM, 5) },
            ]}
            rows={(record.points_of_departure.pharmacological_pod as any).occupancy_ladder}
          />
        </>}

        <div className="notice warn mt">
          <AlertTriangle size={16} />
          <span>
            <b>NOAEL not determined</b>
            <p style={{ marginTop: 4 }}>{record.points_of_departure.noael_determination.reason}</p>
            <p style={{ marginTop: 6 }}><b>What would establish it:</b> {record.points_of_departure.noael_determination.what_would_establish_it}</p>
            {record.points_of_departure.noael_determination.hazard_context.length > 0 && (
              <p style={{ marginTop: 6 }}><b>Hazard context:</b> {record.points_of_departure.noael_determination.hazard_context.join(", ")}</p>
            )}
          </span>
        </div>
      </Card>

      <Card icon={<ArrowRight size={16} />} title="Hand off to the first-in-human layer"
        subtitle="Layer 4 consumes this record: its points of departure, toxicology summary, potency and disposition.">
        <p className="card-sub">
          The preferred point of departure and its exposure are the inputs the first-in-human layer translates through the
          FDA (2005) body-surface-area conversion, and reconciles against an independently derived MABEL.
        </p>
        <button className="btn primary" onClick={() => onContinue(record.study_id)} disabled={!record.study_id}>
          Continue to first in human <ArrowRight size={15} />
        </button>
      </Card>
    </>}

    {/* ── Evidence ────────────────────────────────────────────────────── */}
    {tab === "evidence" && <>
      <Card icon={<Activity size={16} />} title="Public animal evidence"
        subtitle="Live lookups against EPA CCTE, ChEMBL, PubChem and PK-DB for measured animal data on this structure or close analogues.">
        {record.evidence.available ? <>
          <p className="card-sub">Data located from: <strong>{(record.evidence as any).sources_with_data.join(", ")}</strong> — {(record.evidence as any).n_records} records.</p>
          <Anchors entries={[
            ["Measured NOAEL", (record.evidence as any).noael_anchor.value_mg_kg_day != null ? `${num((record.evidence as any).noael_anchor.value_mg_kg_day)} mg/kg/day` : "not located"],
            ["Measured LD50", `${num((record.evidence as any).ld50_anchor.value_mg_kg)} mg/kg`],
            ["Species covered", (record.evidence as any).species_covered.join(", ")],
            ["Critical effect", (record.evidence as any).noael_anchor.critical_effect ?? "—"],
          ]} />
          <p className="limitation"><AlertTriangle size={13} /> {(record.evidence as any).limitation}</p>
        </> : <p className="hint-muted">{(record.evidence as any).reason}</p>}
        <p className="hint-muted mt">Sources queried: {((record.evidence as any).sources_queried ?? []).join(", ") || "none"}</p>
      </Card>

      <Card icon={<Database size={16} />} title="Animal Cohort source catalogue"
        subtitle="Supported toxicology, mechanism, benchmark, structure and regulatory-standard integrations."
        note={record.data_source_catalogue.statement}>
        <DataTable
          columns={[
            { key: "s", header: "Source", render: (row: any) => row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : row.name },
            { key: "c", header: "Category", render: (row: any) => row.category },
            { key: "r", header: "Animal Cohort role", render: (row: any) => row.role },
            { key: "m", header: "Integration", render: (row: any) => row.integration_mode },
            { key: "p", header: "Priority", render: (row: any) => titleCase(row.priority) },
          ]}
          rows={record.data_source_catalogue.sources}
        />
      </Card>

      <ExternalEvidencePanel panel="hazard" identifiers={{ inchikey: l1.inchikey, compound_name: (l1.regulatory_outlook as any).identity_name ?? null }} />
      <ExternalEvidencePanel panel="target" identifiers={{ gene_symbol: l1.target_resolution.gene_symbol ?? null, uniprot_id: l1.target_resolution.uniprot_id ?? null }} />
    </>}

    {/* ── Validation ──────────────────────────────────────────────────── */}
    {tab === "validation" && <>
      <Card icon={<Database size={16} />} title="Observed validation evidence"
        subtitle={`Assessed ${record.validation_evidence.assessment_date} · ${record.validation_evidence.scope}`}
        note={record.validation_evidence.headline}>
        <div className="row" style={{ marginBottom: 14 }}>
          <StatusPill status={record.validation_evidence.status} label={`Overall: ${titleCase(record.validation_evidence.status)}`} />
        </div>
        {record.validation_evidence.studies.map((study: any) => (
          <div key={study.id} style={{ border: "1px solid var(--line)", borderRadius: 13, padding: 15, marginBottom: 12 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div><b style={{ fontSize: 13.5 }}>{study.title}</b><br /><small className="muted">{study.endpoint} · {study.species} · n = {study.n_test} ({study.n_skipped} skipped)</small></div>
              <StatusPill status={study.status} />
            </div>
            <p className="hint-muted">{study.use_decision}</p>
            <DataTable
              columns={[
                { key: "mfe", header: "Median fold error", align: "right", render: (row: any) => `${num(row.median_fold_error)}×` },
                { key: "two", header: "Within 2×", align: "right", render: (row: any) => pct(row.within_2x) },
                { key: "three", header: "Within 3×", align: "right", render: (row: any) => pct(row.within_3x) },
                { key: "raw", header: "Raw cohort coverage", align: "right", render: (row: any) => pct(row.raw_interval_coverage) },
                { key: "cal", header: "Calibrated coverage", align: "right", render: (row: any) => pct(row.calibrated_coverage) },
                { key: "width", header: "Calibrated band", align: "right", render: (row: any) => `${num(row.calibrated_halfwidth_fold)}×` },
              ]}
              rows={[study.metrics]}
            />
            <p className="hint-muted mt">{study.interpretation}</p>
            <div className="row" style={{ marginTop: 10, gap: 14 }}>
              <span className="tiny muted">Input mode: {study.input_mode}</span>
              <span className="tiny muted">Reference set: <code>{String(study.benchmark).split("/").pop()}</code></span>
              <span className="tiny muted">Reproduce: <code>{study.reproduce}</code></span>
            </div>
          </div>
        ))}
      </Card>

      <Card icon={<ClipboardList size={16} />} title="Endpoint qualification map"
        subtitle="A missing validation set is a stated boundary, not a negative result.">
        <DataTable
          columns={[
            { key: "e", header: "Endpoint", render: (row: any) => <b>{row.endpoint}</b> },
            { key: "s", header: "Qualification", render: (row: any) => <StatusPill status={row.status} /> },
            { key: "c", header: "What current evidence supports", render: (row: any) => row.coverage },
          ]}
          rows={record.validation_evidence.endpoint_coverage}
        />
        <div className="sub-label">Methodology</div>
        <ul className="rail-tags">{record.validation_evidence.methodology.map((item: string, index: number) => <li key={index} className="muted"><BadgeCheck size={12} />{item}</li>)}</ul>
        <div className="sub-label">Limitations</div>
        <ul className="rail-tags">{record.validation_evidence.limitations.map((item: string, index: number) => <li key={index}><AlertTriangle size={12} />{item}</li>)}</ul>
      </Card>
    </>}

    {/* ── Provenance ──────────────────────────────────────────────────── */}
    {tab === "provenance" && <>
      <Card icon={<Layers size={16} />} title="Inherited inputs"
        subtitle="What the animal layer received from Layers 1 and 2. The study is parameterised from this record, not re-derived.">
        <DlGrid entries={[
          ["Analysis", record.resolved_inputs.analysis_id],
          ["Layer 1 verdict", record.resolved_inputs.l1_verdict],
          ["Target protein", record.resolved_inputs.target.target_protein],
          ["Gene symbol", record.resolved_inputs.target.gene_symbol],
          ["UniProt", record.resolved_inputs.target.uniprot_id],
          ["PDB", record.resolved_inputs.target.pdb_id],
          ["Therapeutic area", record.resolved_inputs.therapeutic_area],
          ["Target potency", record.resolved_inputs.potency ? `${record.resolved_inputs.potency.activity_type} ${num(record.resolved_inputs.potency.value_nM)} nM` : "not carried through"],
          ["Potency provenance", record.resolved_inputs.potency?.provenance],
          ["Input mode", record.resolved_inputs.input_mode],
        ]} />
        <div className="sub-label">Disposition inputs and their provenance</div>
        <DataTable
          columns={[
            { key: "p", header: "Parameter", render: (row: any) => <b>{titleCase(row[0])}</b> },
            { key: "v", header: "Value", align: "right", render: (row: any) => num(row[1].value, 5) },
            { key: "s", header: "Provenance", render: (row: any) => <StatusPill status={String(row[1].provenance).startsWith("measured") ? "pass" : String(row[1].provenance).startsWith("ml") ? "caution" : "unknown"} label={row[1].provenance} /> },
          ]}
          rows={Object.entries(record.resolved_inputs.disposition)}
        />
        {record.resolved_inputs.safety_flags.length > 0 && <>
          <div className="sub-label">Safety flags carried forward</div>
          <ul className="rail-tags">{record.resolved_inputs.safety_flags.map((flag: any, index: number) => <li key={index}><AlertTriangle size={12} />{flag.label} — {flag.risk_class}</li>)}</ul>
        </>}
      </Card>

      <Card icon={<Database size={16} />} title="Predictor provenance"
        subtitle={`${Object.keys(record.model_panel.endpoints).length} endpoints resolved · ${record.model_panel.unresolved.length} unresolved · MW ${num(record.model_panel.mw_g_per_mol)} g/mol`}
        note="Every study-level engine consumed this one normalised bundle, so two blocks can never disagree about the same endpoint.">
        <DlGrid entries={[
          ["Sources", record.model_panel.sources.join(", ")],
          ["Unresolved", record.model_panel.unresolved.join(", ")],
        ]} />
        <DataTable
          columns={[
            { key: "e", header: "Endpoint", render: (row: any) => <code>{row[0]}</code> },
            { key: "v", header: "Value", align: "right", render: (row: any) => num(row[1].value, 4) },
            { key: "s", header: "Source", render: (row: any) => <StatusPill status={row[1].source === "l1_record" ? "pass" : "caution"} label={row[1].source === "l1_record" ? "Immutable L1 record" : String(row[1].source)} /> },
            { key: "m", header: "Model", render: (row: any) => row[1].model },
            { key: "p", header: "Provenance", render: (row: any) => row[1].provenance },
            { key: "d", header: "In domain", render: (row: any) => row[1].in_domain === false ? <span style={{ color: "var(--warn-ink)" }}>out of domain</span> : "yes" },
            { key: "f", header: "Flagged", render: (row: any) => row[1].flagged ? <StatusPill status="fail" label="Flagged" /> : "—" },
          ]}
          rows={Object.entries(record.model_panel.endpoints)}
        />
      </Card>

      <Card icon={<BadgeCheck size={16} />} title="Selected scientific models" subtitle="What actually produced the numbers in this study.">
        <DataTable
          columns={[
            { key: "b", header: "Block", render: (row: any) => <b>{row.block}</b> },
            { key: "m", header: "Model", render: (row: any) => row.model },
            { key: "p", header: "Provenance", render: (row: any) => row.provenance },
          ]}
          rows={record.selected_scientific_models}
        />
      </Card>

      {record.signoff && <Card icon={<ShieldCheck size={16} />} title="Gate signature carried onto this record">
        <DlGrid entries={[
          ["Name", record.signoff.name],
          ["Role", record.signoff.role],
          ["Signed at", record.signoff.signed_at],
          ["Acknowledged warnings", record.signoff.acknowledged_codes.join(", ") || "None"],
          ["Justification", record.signoff.justification],
        ]} />
      </Card>}

      <Card icon={<Layers size={16} />} title="Record provenance">
        <DlGrid entries={[
          ["Owner", record.provenance.owner],
          ["Client contract", record.provenance.client_contract],
          ["Input mode", record.provenance.input_mode],
          ["Upstream layers executed", record.provenance.upstream_layers_executed],
          ["Computed at", record.provenance.computed_at],
          ["Schema version", record.schema_version],
          ["Study id", record.study_id],
        ]} />
      </Card>
    </>}

    <div className="actions-row">
      <button className="btn" onClick={onBack}><ArrowLeft size={15} /> Return to IVIVE</button>
      <button className="btn" onClick={report}><FileText size={15} /> {t("Download scientific report (PDF)")}</button>
      <button className="btn primary" onClick={() => onContinue(record.study_id)}>Continue to first in human <ArrowRight size={15} /></button>
    </div>
  </>;
}
