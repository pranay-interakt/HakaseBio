/**
 * Layer-3 result blocks.
 *
 * Every block below renders one top-level key of the study record returned by
 * `POST /api/ai/l3/run`. The backend computes all of it — hazard bands,
 * exposure ratios, conformance gaps, thresholds, and the wording of every
 * limitation. These components choose layout and nothing else.
 *
 * Where a block reports `available: false`, its own `reason` is shown. That
 * reason is scientific content: "not predicted, because no model in the
 * resolved panel produces this endpoint" is a different statement from
 * "negative", and the UI must not collapse the two.
 */
import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Beaker, Boxes, CircleHelp, ClipboardList,
  Database, GitCompare, Layers, Microscope, Scale, ShieldAlert, Split, Waves,
} from "lucide-react";
import { Card, DataTable, StatusPill, Unavailable, num, pct, text, titleCase } from "./ui";

/* ── shared types (mirrors of the backend blocks, display-side only) ─────── */

export type Curve = { mean: number[]; p05: number[]; p95: number[] };

type Available = { available?: boolean; reason?: string; limitations?: string; model?: string; provenance?: string };

export type Toxicokinetics = Available & {
  units?: Record<string, string>;
  schedule?: { frequency?: string; dosing_interval_h?: number | null; study_duration_h?: number; n_doses?: number };
  per_arm?: Array<Record<string, any>>;
  exposure_linearity?: Record<string, any>;
  dose_group_separation?: Array<{ from_arm?: string; to_arm?: string; dose_ratio?: number; auc_ratio?: number }>;
  not_modelled?: Array<{ item?: string; reason?: string }>;
};

export type Biodistribution = Available & {
  per_arm?: Array<{
    arm?: { label?: string; dose_mg_per_kg?: number };
    units?: Record<string, string>;
    plasma_auc_median?: number | null;
    tissues?: Array<Record<string, any>>;
    exposure_rank?: Array<{ organ?: string; label?: string; auc_median?: number }>;
    highest_exposure_tissue?: string | null;
    cns_penetration?: Record<string, any>;
    accumulation?: Record<string, any>;
    elimination_routes?: Record<string, any>;
  }>;
  consensus_tissue_ranking?: Array<{ organ?: string; label?: string; mean_tissue_plasma_ratio?: number; dose_dependent?: boolean }>;
  dose_dependent_distribution?: boolean;
};

export type ToxicologyPanel = Available & {
  domains?: Array<Record<string, any>>;
  summary?: Record<string, any>;
  panel_sources?: string[];
  unresolved_endpoints?: string[];
};

export type SafetyPharmacology = Available & {
  reference_arm?: string;
  reference_dose_mg_per_kg?: number;
  free_concentrations?: Record<string, any>;
  systems?: Array<Record<string, any>>;
  summary?: Record<string, any>;
};

export type Ddi = Available & {
  reference_arm?: string;
  concentrations?: Record<string, any>;
  perpetrator?: { isoforms?: Array<Record<string, any>>; flagged_isoforms?: string[]; highest_risk?: string; cutoffs?: Record<string, number> };
  victim?: Record<string, any>;
  transporters?: Record<string, any>;
  recommended_studies?: string[];
};

export type PointsOfDeparture = Available & {
  dose_exposure_calibration?: Record<string, any>;
  candidates?: Array<Record<string, any>>;
  preferred_pod?: Record<string, any> | null;
  preferred_pod_exposure?: Record<string, any>;
  pharmacological_pod?: Record<string, any>;
  acute_anchor?: Record<string, any>;
  noael_determination?: Record<string, any>;
};

export type StudyOutcomes = Available & {
  sections?: Array<Record<string, any>>;
  design_conformance?: DesignConformance;
  summary?: Record<string, any>;
};

export type DesignConformance = {
  closest_guideline?: string;
  guideline_id?: string;
  expectations?: Record<string, any>;
  submitted?: Record<string, any>;
  conformant?: boolean;
  gaps?: string[];
  note?: string;
};

export type ModelPanel = {
  mw_g_per_mol?: number | null;
  endpoints?: Record<string, { value?: number; source?: string; model?: string; provenance?: string; in_domain?: boolean; flagged?: boolean }>;
  unresolved?: string[];
  sources?: string[];
};

/* ── charts ─────────────────────────────────────────────────────────────── */

const SERIES_COLORS = ["#12b6d8", "#c0392b", "#1aa36f", "#dd9b12", "#7b5ea7", "#0a809d", "#e0605d", "#5a6a80"];

/** Multi-tissue concentration–time plot from the cohort's simulated curves. */
export function TissueCurveChart({ time, series }: { time?: number[]; series: Array<{ label: string; curve?: Curve }> }) {
  const usable = series.filter((s) => s.curve && s.curve.mean.length);
  if (!time || !time.length || !usable.length) return null;
  const width = 620, height = 260, pl = 62, pr = 14, pt = 14, pb = 36;
  const cw = width - pl - pr, ch = height - pt - pb;
  const xMin = time[0], xMax = time[time.length - 1];
  const yMax = Math.max(...usable.flatMap((s) => s.curve!.mean)) * 1.15 || 1;
  const gx = (t: number) => pl + ((t - xMin) / (xMax - xMin || 1)) * cw;
  const gy = (c: number) => pt + ch - (c / yMax) * ch;
  const yTicks = Array.from({ length: 5 }, (_, i) => (i * yMax) / 4);
  const xTicks = Array.from({ length: 6 }, (_, i) => xMin + (i * (xMax - xMin)) / 5);
  return <div className="chart-svg-wrapper">
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      {yTicks.map((v, i) => <g key={`y${i}`}>
        <line x1={pl} y1={gy(v)} x2={width - pr} y2={gy(v)} className="chart-gridline" />
        <text x={pl - 8} y={gy(v) + 4} textAnchor="end" className="chart-axis-label">{v < 0.1 ? v.toFixed(3) : v.toFixed(1)}</text>
      </g>)}
      {xTicks.map((v, i) => <text key={`x${i}`} x={gx(v)} y={height - pb + 16} textAnchor="middle" className="chart-axis-label">{v.toFixed(0)}</text>)}
      <text transform={`rotate(-90 16 ${pt + ch / 2})`} x={16} y={pt + ch / 2} textAnchor="middle" className="chart-title">Concentration (mg/L)</text>
      <text x={pl + cw / 2} y={height - 5} textAnchor="middle" className="chart-title">Time (h)</text>
      {usable.map((s, i) => (
        <polyline key={s.label} points={s.curve!.mean.map((c, j) => `${gx(time[j])},${gy(c)}`).join(" ")}
          fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={1.9} />
      ))}
    </svg>
    <div className="chart-series-legend">
      {usable.map((s, i) => <span key={s.label}><i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />{s.label}</span>)}
    </div>
  </div>;
}

/** Horizontal ranked bars for tissue:plasma exposure ratios. */
export function RankBars({ rows, unit }: { rows: Array<{ label?: string; value?: number | null }>; unit?: string }) {
  const usable = rows.filter((r) => typeof r.value === "number");
  if (!usable.length) return <p className="l3-hint-muted">No ranked values were returned.</p>;
  const max = Math.max(...usable.map((r) => r.value as number)) || 1;
  return <div className="rank-bars">
    {usable.map((row) => (
      <div key={row.label} className="rank-bar">
        <span className="rank-bar-label">{row.label}</span>
        <span className="rank-bar-track"><span style={{ width: `${Math.max(2, ((row.value as number) / max) * 100)}%` }} /></span>
        <span className="rank-bar-value">{num(row.value)}{unit ? ` ${unit}` : ""}</span>
      </div>
    ))}
  </div>;
}

/* ── blocks ─────────────────────────────────────────────────────────────── */

export function ReadinessWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return <div className="l3-warnings">
    <AlertTriangle size={16} />
    <div>
      <b>Design warnings returned with this study</b>
      <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>
  </div>;
}

export function DesignConformanceCard({ conformance }: { conformance?: DesignConformance }) {
  if (!conformance?.closest_guideline) return null;
  const expectations = conformance.expectations ?? {};
  const submitted = conformance.submitted ?? {};
  const window = expectations.duration_window_h as number[] | undefined;
  return <Card
    icon={<ClipboardList size={16} />}
    title="Design conformance"
    subtitle={`Closest guideline: ${conformance.closest_guideline}`}
    note={conformance.note}
  >
    <div className={`conformance-banner ${conformance.conformant ? "ok" : "gap"}`}>
      <StatusPill status={conformance.conformant ? "pass" : "caution"} label={conformance.conformant ? "Conformant" : `${conformance.gaps?.length ?? 0} gap${(conformance.gaps?.length ?? 0) === 1 ? "" : "s"}`} />
      <span>{conformance.conformant
        ? "The submitted design sits inside the guideline envelope."
        : "The submitted design departs from the guideline envelope. This is a design check only — it says nothing about GLP status."}</span>
    </div>
    <DataTable
      columns={[
        { key: "p", header: "Parameter", render: (r: any) => r.parameter },
        { key: "s", header: "Submitted", render: (r: any) => r.submitted },
        { key: "e", header: "Guideline expects", render: (r: any) => r.expected },
      ]}
      rows={[
        { parameter: "Animals per group", submitted: text(submitted.cohort_size_per_group), expected: `≥ ${text(expectations.animals_per_sex_per_group)} per sex` },
        { parameter: "Active dose groups", submitted: text(submitted.active_dose_groups), expected: `≥ ${text(expectations.min_dose_groups)}` },
        { parameter: "Concurrent control", submitted: text(submitted.control_group_present), expected: expectations.control_required ? "Required" : "Optional" },
        { parameter: "Duration (h)", submitted: text(submitted.duration_h), expected: window ? `${window[0]} – ${window[1]}` : "—" },
      ]}
    />
    {(conformance.gaps?.length ?? 0) > 0 && <ul className="conformance-gaps">
      {conformance.gaps!.map((gap, i) => <li key={i}><AlertTriangle size={13} /> {gap}</li>)}
    </ul>}
  </Card>;
}

export function ToxicokineticsCard({ tk }: { tk?: Toxicokinetics }) {
  if (!tk) return null;
  if (!tk.available) return <Unavailable title="Toxicokinetics (ICH S3A)" reason={tk.reason} />;
  const linearity = tk.exposure_linearity ?? {};
  const schedule = tk.schedule ?? {};
  return <Card
    icon={<Waves size={16} />}
    title="Toxicokinetics — ICH S3A exposure table"
    subtitle={`${schedule.frequency ?? "single dose"} · ${text(schedule.n_doses)} dose(s) over ${text(schedule.study_duration_h)} h`}
    note={tk.limitations}
  >
    <DataTable
      columns={[
        { key: "arm", header: "Dose group", render: (r: any) => r.arm },
        { key: "dose", header: "Dose (mg/kg)", align: "right", render: (r: any) => num(r.dose_mg_per_kg) },
        { key: "cmax", header: "Cmax (mg/L)", align: "right", render: (r: any) => <span title={r.c_max_interval ? `90% interval ${num(r.c_max_interval[0])} – ${num(r.c_max_interval[1])}` : undefined}>{num(r.c_max_mg_per_l)}</span> },
        { key: "tmax", header: "Tmax (h)", align: "right", render: (r: any) => num(r.t_max_h) },
        { key: "auc", header: "AUC (mg·h/L)", align: "right", render: (r: any) => <span title={r.auc_interval ? `90% interval ${num(r.auc_interval[0])} – ${num(r.auc_interval[1])}` : undefined}>{num(r.auc_mg_h_per_l)}</span> },
        { key: "cv", header: "AUC CV%", align: "right", render: (r: any) => num(r.auc_cv_percent, 1) },
        { key: "thalf", header: "t½ (h)", align: "right", render: (r: any) => num(r.t_half_h) },
        { key: "dn", header: "Dose-norm. AUC", align: "right", render: (r: any) => num(r.dose_normalised_auc) },
        { key: "acc", header: "Accumulation", align: "right", render: (r: any) => r.accumulation?.available ? `${num(r.accumulation.accumulation_ratio)}×` : "—" },
      ]}
      rows={tk.per_arm ?? []}
    />

    {linearity.available && <div className={`tk-linearity ${linearity.linear ? "ok" : "warn"}`}>
      <StatusPill status={linearity.linear ? "pass" : "caution"} label={linearity.linear ? "Linear" : "Non-linear"} />
      <span>{linearity.interpretation}</span>
      <small>Relative spread {num(linearity.relative_spread)} against a tolerance of {num(linearity.tolerance)}.</small>
    </div>}
    {!linearity.available && linearity.reason && <p className="l3-hint-muted">{linearity.reason}</p>}

    {(tk.dose_group_separation?.length ?? 0) > 0 && <>
      <div className="l3-sub-label">Exposure separation between dose groups</div>
      <DataTable
        columns={[
          { key: "f", header: "From", render: (r: any) => r.from_arm },
          { key: "t", header: "To", render: (r: any) => r.to_arm },
          { key: "d", header: "Dose ratio", align: "right", render: (r: any) => `${num(r.dose_ratio)}×` },
          { key: "a", header: "AUC ratio", align: "right", render: (r: any) => `${num(r.auc_ratio)}×` },
        ]}
        rows={tk.dose_group_separation ?? []}
      />
    </>}

    {(tk.not_modelled?.length ?? 0) > 0 && <div className="not-modelled">
      <div className="l3-sub-label"><CircleHelp size={13} /> Explicitly not modelled</div>
      {tk.not_modelled!.map((entry, i) => <div key={i}><b>{entry.item}</b><span>{entry.reason}</span></div>)}
    </div>}
  </Card>;
}

export function BiodistributionCard({ bio, arms }: { bio?: Biodistribution; arms?: Array<any> }) {
  const perArm = bio?.per_arm ?? [];
  const [armIndex, setArmIndex] = useState(Math.max(0, perArm.length - 1));
  const block = perArm[Math.min(armIndex, perArm.length - 1)];

  const curveArm = arms?.filter((a) => a.available)?.[Math.min(armIndex, (arms?.filter((a) => a.available).length ?? 1) - 1)];
  const tissueSeries = useMemo(() => {
    const curves = curveArm?.cohort?.curves ?? {};
    const ranked = (block?.exposure_rank ?? []).slice(0, 5);
    return [
      { label: "Plasma", curve: curves.plasma as Curve | undefined },
      ...ranked.map((r) => ({ label: r.label ?? r.organ ?? "", curve: curves[r.organ ?? ""] as Curve | undefined })),
    ].filter((s) => s.curve);
  }, [curveArm, block]);

  if (!bio) return null;
  if (!bio.available) return <Unavailable title="Biodistribution" reason={bio.reason} />;

  const cns = block?.cns_penetration ?? {};
  const elimination = block?.elimination_routes ?? {};
  const accumulation = block?.accumulation ?? {};

  return <Card
    icon={<Boxes size={16} />}
    title="Biodistribution — per-organ exposure"
    subtitle="Rodgers & Rowland mechanistic Kp driving a 13-compartment perfusion-limited PBPK cohort."
    note={bio.limitations}
    actions={perArm.length > 1 ? <select value={armIndex} onChange={(e) => setArmIndex(Number(e.target.value))}>
      {perArm.map((a, i) => <option key={i} value={i}>{a.arm?.label ?? `Arm ${i + 1}`}</option>)}
    </select> : undefined}
  >
    <div className="bio-split">
      <div>
        <div className="l3-sub-label">Cross-arm tissue ranking (mean tissue:plasma AUC)</div>
        <RankBars rows={(bio.consensus_tissue_ranking ?? []).map((r) => ({ label: r.label, value: r.mean_tissue_plasma_ratio }))} unit="×" />
        {bio.dose_dependent_distribution && <p className="l3-hint"><AlertTriangle size={13} /> Distribution varies across dose groups — partitioning is not dose-independent over the studied range.</p>}
      </div>
      <div>
        <div className="l3-sub-label">Concentration–time, plasma vs the five highest-exposure tissues</div>
        <TissueCurveChart time={curveArm?.cohort?.time} series={tissueSeries} />
      </div>
    </div>

    <div className="l3-sub-label">Per-organ exposure — {block?.arm?.label ?? "dose group"}</div>
    <DataTable
      columns={[
        { key: "t", header: "Tissue", render: (r: any) => r.label },
        { key: "cmax", header: "Cmax (mg/L)", align: "right", render: (r: any) => num(r.c_max_median) },
        { key: "tmax", header: "Tmax (h)", align: "right", render: (r: any) => num(r.t_max_median_h) },
        { key: "auc", header: "AUC (mg·h/L)", align: "right", render: (r: any) => num(r.auc_median) },
        { key: "ratio", header: "Tissue:plasma AUC", align: "right", render: (r: any) => num(r.tissue_plasma_auc_ratio) },
        { key: "kp", header: "Kp", align: "right", render: (r: any) => num(r.kp) },
        { key: "part", header: "Partitioning", render: (r: any) => r.partitioning ? <StatusPill status={r.partitioning === "high" ? "caution" : "pass"} label={titleCase(r.partitioning)} /> : "—" },
      ]}
      rows={block?.tissues ?? []}
    />

    <div className="bio-callouts">
      <div>
        <b>CNS penetration</b>
        {cns.available ? <>
          <span>{cns.classification}</span>
          <small>Brain:plasma AUC {num(cns.brain_plasma_auc_ratio)} · Kp,uu {num(cns.kp_uu_estimate)}{cns.bbb_permeability_probability != null ? ` · BBB model ${num(cns.bbb_permeability_probability, 2)}` : ""}</small>
          {cns.concordance_note && <small className="warn-note">{cns.concordance_note}</small>}
        </> : <span className="l3-hint-muted">{cns.reason}</span>}
      </div>
      <div>
        <b>Repeat-dose accumulation</b>
        {accumulation.available ? <>
          <span>{num(accumulation.accumulation_ratio)}× at steady state</span>
          <small>{accumulation.basis ?? accumulation.interpretation ?? ""}</small>
        </> : <span className="l3-hint-muted">{accumulation.reason ?? "Not projected."}</span>}
      </div>
      <div>
        <b>Route of elimination</b>
        {elimination.available ? <>
          <span>Hepatic {pct(elimination.fraction_hepatic)} · Renal {pct(elimination.fraction_renal)}</span>
          <small>{elimination.interpretation ?? ""}</small>
        </> : <span className="l3-hint-muted">{elimination.reason ?? "Not resolved."}</span>}
      </div>
      <div>
        <b>Highest-exposure tissue</b>
        <span>{block?.highest_exposure_tissue ?? "not resolved"}</span>
        <small>Plasma AUC reference {num(block?.plasma_auc_median)} mg·h/L</small>
      </div>
    </div>
  </Card>;
}

export function ToxicologyCard({ tox }: { tox?: ToxicologyPanel }) {
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  if (!tox) return null;
  if (!tox.available) return <Unavailable title="Regulatory toxicology panel" reason={tox.reason} />;
  const summary = tox.summary ?? {};
  const domains = tox.domains ?? [];

  return <Card
    icon={<Microscope size={16} />}
    title="Regulatory toxicology panel"
    subtitle={`${text(summary.n_domains)} domains · ${text(summary.n_predicted)} predicted · ${text(summary.n_flagged)} flagged · ${text(summary.n_high)} high`}
    note={tox.limitations}
  >
    <div className="tox-summary-row">
      <div><small>High-hazard domains</small><b>{summary.high_hazard_domains?.length ? summary.high_hazard_domains.join(", ") : "None reached the high band"}</b></div>
      <div><small>Target organs of concern</small><b>{summary.target_organs_of_concern?.length ? summary.target_organs_of_concern.join(", ") : "None"}</b></div>
      <div><small>Not predicted</small><b>{summary.not_predicted_domains?.length ? summary.not_predicted_domains.join(", ") : "None"}</b></div>
    </div>

    <div className="tox-matrix">
      {domains.map((domain) => {
        const call = domain.hazard_call ?? {};
        const exposure = domain.exposure_context ?? {};
        const open = openDomain === domain.id;
        return <div key={domain.id} className={`tox-domain ${call.level}`}>
          <button className="tox-domain-head" onClick={() => setOpenDomain(open ? null : domain.id)}>
            <div>
              <b>{domain.name}</b>
              <small>{domain.guideline}</small>
            </div>
            <div className="tox-domain-right">
              {domain.organ && <span className="tox-organ">{titleCase(domain.organ)}</span>}
              <StatusPill status={call.level} label={call.level === "not_predicted" ? "Not predicted" : titleCase(call.level ?? "")} />
              <span className="tox-prob">{call.driving_probability != null ? num(call.driving_probability, 2) : "—"}</span>
            </div>
          </button>
          {open && <div className="tox-domain-body">
            <p className="tox-mechanism">{domain.mechanism}</p>
            <p className="tox-basis">{call.basis}</p>

            {(domain.drivers?.length ?? 0) > 0 ? <DataTable
              columns={[
                { key: "l", header: "Driver", render: (d: any) => <><b>{d.label}</b><small>{d.endpoint}</small></> },
                { key: "v", header: "Value", align: "right", render: (d: any) => num(d.value, 3) },
                { key: "m", header: "Model", render: (d: any) => d.model ?? "—" },
                { key: "p", header: "Provenance", render: (d: any) => <><span>{d.provenance ?? "—"}</span>{d.in_domain === false && <small className="warn-note">out of applicability domain</small>}</> },
              ]}
              rows={domain.drivers ?? []}
            /> : <p className="l3-hint-muted">No model in the resolved panel produces a driver for this domain.</p>}

            {exposure.available && <p className="tox-exposure">
              <StatusPill status={exposure.meaningfully_exposed ? "caution" : "pass"} label={exposure.meaningfully_exposed ? "Organ exposed" : "Limited organ exposure"} />
              {exposure.note} (tissue:plasma AUC {num(exposure.tissue_plasma_auc_ratio)}, {exposure.arm} group)
            </p>}
            {!exposure.available && exposure.reason && <p className="l3-hint-muted">{exposure.reason}</p>}

            {domain.anticipated_findings && <div className="tox-findings">
              <div className="l3-sub-label">Endpoints a study would score for this mechanism</div>
              {Object.entries(domain.anticipated_findings).filter(([key]) => key !== "note").map(([key, items]) => (
                Array.isArray(items) && items.length > 0 && <div key={key}>
                  <b>{titleCase(key)}</b>
                  <ul>{(items as string[]).map((item, i) => <li key={i}>{item}</li>)}</ul>
                </div>
              ))}
              <p className="l3-limitation">{(domain.anticipated_findings as any).note}</p>
            </div>}
          </div>}
        </div>;
      })}
    </div>

    <div className="tox-provenance">
      <div><b>Panel sources</b><span>{tox.panel_sources?.join(", ") || "—"}</span></div>
      <div><b>Unresolved endpoints</b><span>{tox.unresolved_endpoints?.length ? tox.unresolved_endpoints.join(", ") : "None"}</span></div>
    </div>
  </Card>;
}

export function SafetyPharmacologyCard({ sp }: { sp?: SafetyPharmacology }) {
  if (!sp) return null;
  if (!sp.available) return <Unavailable title="Safety pharmacology (ICH S7A/S7B)" reason={sp.reason} />;
  const summary = sp.summary ?? {};
  const free = sp.free_concentrations ?? {};
  return <Card
    icon={<ShieldAlert size={16} />}
    title="Safety pharmacology — ICH S7A/S7B core battery"
    subtitle={`Referenced to the ${sp.reference_arm} group (${num(sp.reference_dose_mg_per_kg)} mg/kg)`}
    note={sp.limitations}
  >
    <div className={`sp-overall ${summary.overall === "concern" ? "warn" : ""}`}>
      <StatusPill status={summary.overall} label={titleCase(String(summary.overall ?? "unknown"))} />
      <span>
        {summary.systems_of_concern?.length ? `Systems of concern: ${summary.systems_of_concern.join(", ")}. ` : ""}
        {summary.systems_to_monitor?.length ? `Systems to monitor: ${summary.systems_to_monitor.join(", ")}.` : "No system was raised above the monitoring threshold."}
      </span>
    </div>

    {free && (free.free_cmax_uM != null || free.free_cmax_mg_per_l != null) && <div className="sp-free">
      <b>Free concentration at the site of action</b>
      <span>Free Cmax {num(free.free_cmax_uM)} µM{free.fu_plasma != null ? ` · fu ${num(free.fu_plasma, 4)}` : ""}</span>
    </div>}

    <div className="sp-systems">
      {(sp.systems ?? []).map((system, i) => (
        <div key={i} className={`sp-system ${system.assessment}`}>
          <div className="sp-system-head">
            <div><b>{system.system}</b><small>{system.guideline}</small></div>
            <StatusPill status={system.assessment} label={titleCase(String(system.assessment ?? ""))} />
          </div>
          <p className="sp-equivalent">{system.study_equivalent}</p>
          <p>{system.rationale}</p>
          <dl className="sp-metrics">
            {Object.entries(system)
              .filter(([key, value]) =>
                !["system", "guideline", "study_equivalent", "rationale", "assessment", "provenance", "next_measurement"].includes(key)
                && value !== null && value !== undefined && typeof value !== "object")
              .map(([key, value]) => <div key={key}><dt>{titleCase(key)}</dt><dd>{text(value)}</dd></div>)}
          </dl>
          {system.next_measurement && <p className="sp-next"><Beaker size={13} /> Next measurement: {system.next_measurement}</p>}
        </div>
      ))}
    </div>
  </Card>;
}

export function DdiCard({ ddi }: { ddi?: Ddi }) {
  if (!ddi) return null;
  if (!ddi.available) return <Unavailable title="Drug–drug interaction" reason={ddi.reason} />;
  const perpetrator = ddi.perpetrator ?? {};
  const victim = ddi.victim ?? {};
  const concentrations = ddi.concentrations ?? {};
  return <Card
    icon={<Split size={16} />}
    title="Drug–drug interaction — FDA 2020 basic model"
    subtitle={`Unbound exposure from the ${ddi.reference_arm} group`}
    note={ddi.limitations}
  >
    <div className="ddi-conc">
      {Object.entries(concentrations).filter(([, v]) => typeof v === "number").map(([key, value]) => (
        <div key={key}><small>{titleCase(key)}</small><b>{num(value as number)}</b></div>
      ))}
    </div>

    <div className="l3-sub-label">Perpetrator — could this compound change a co-medication's exposure?</div>
    <DataTable
      columns={[
        { key: "i", header: "Isoform", render: (r: any) => r.isoform },
        { key: "c", header: "Call", render: (r: any) => r.available ? <StatusPill status={r.inhibitor_probability >= 0.5 ? "caution" : "pass"} label={r.call ?? ""} /> : <span className="l3-hint-muted">{r.reason}</span> },
        { key: "p", header: "Inhibitor probability", align: "right", render: (r: any) => num(r.inhibitor_probability, 3) },
        { key: "k", header: "Ki that would trigger the cut-off", align: "right", render: (r: any) => r.ki_threshold_uM != null ? `${num(r.ki_threshold_uM)} µM` : "—" },
        { key: "m", header: "Model", render: (r: any) => r.model ?? "—" },
      ]}
      rows={perpetrator.isoforms ?? []}
    />
    <p className="l3-hint">
      Flagged isoforms: <strong>{perpetrator.flagged_isoforms?.length ? perpetrator.flagged_isoforms.join(", ") : "none above the 0.5 call"}</strong>
      {perpetrator.cutoffs && ` · regulatory cut-offs R1 ${num(perpetrator.cutoffs.hepatic_R1)} (hepatic), ${num(perpetrator.cutoffs.intestinal_R1_CYP3A)} (intestinal CYP3A)`}
    </p>

    <div className="l3-sub-label">Victim — could a co-medication change this compound's exposure?</div>
    <div className={`ddi-victim ${victim.risk}`}>
      <StatusPill status={victim.risk} label={titleCase(String(victim.risk ?? ""))} />
      <div>
        <p>{victim.rationale}</p>
        <small>
          Hepatic clearance fraction {pct(victim.fraction_cleared_hepatically)} ·
          extraction ratio {num(victim.extraction_ratio)} ·
          hepatic first pass {num(victim.hepatic_first_pass)}
        </small>
        <small className="warn-note">{victim.limitation}</small>
      </div>
    </div>
    <DataTable
      columns={[
        { key: "i", header: "Isoform", render: (r: any) => r.isoform },
        { key: "c", header: "Substrate call", render: (r: any) => r.available ? r.call : <span className="l3-hint-muted">{r.reason}</span> },
        { key: "p", header: "Probability", align: "right", render: (r: any) => num(r.substrate_probability, 3) },
      ]}
      rows={victim.substrate_calls ?? []}
    />

    {ddi.transporters && <div className="ddi-transporters">
      <b>Transporters</b>
      <span>P-gp substrate probability {num(ddi.transporters.pgp_substrate_probability, 3)}</span>
      <small>{ddi.transporters.note}</small>
    </div>}

    {(ddi.recommended_studies?.length ?? 0) > 0 && <div className="ddi-studies">
      <div className="l3-sub-label">In-vitro studies required to make this quantitative</div>
      <ul>{ddi.recommended_studies!.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>}
  </Card>;
}

export function PointsOfDepartureCard({ pod }: { pod?: PointsOfDeparture }) {
  if (!pod) return null;
  if (!pod.available) return <Unavailable title="Points of departure" reason={pod.reason} />;
  const preferred = pod.preferred_pod ?? null;
  const exposure = pod.preferred_pod_exposure ?? {};
  const determination = pod.noael_determination ?? {};
  const pharmacological = pod.pharmacological_pod ?? {};
  return <Card
    icon={<Scale size={16} />}
    title="Points of departure — the Layer-4 bridge"
    subtitle="Every anchor the study can defend, with its strength and provenance. The lowest defensible anchor governs."
    note={pod.limitations}
  >
    {preferred ? <div className="pod-preferred">
      <div><small>Preferred point of departure</small><b>{preferred.name}</b></div>
      <div><small>Dose</small><b>{num(preferred.dose_mg_per_kg)} mg/kg</b></div>
      <div><small>Strength</small><StatusPill status={preferred.strength === "strong" ? "pass" : "caution"} label={titleCase(String(preferred.strength ?? ""))} /></div>
      <div><small>Provenance</small><b>{preferred.provenance}</b></div>
    </div> : <p className="l3-hint-muted">No anchor rated strong or moderate was available, so no preferred point of departure was selected.</p>}

    <DataTable
      columns={[
        { key: "n", header: "Anchor", render: (r: any) => <><b>{r.name}</b>{r.note && <small>{r.note}</small>}</> },
        { key: "d", header: "Dose (mg/kg)", align: "right", render: (r: any) => num(r.dose_mg_per_kg) },
        { key: "s", header: "Strength", render: (r: any) => <StatusPill status={r.strength === "strong" ? "pass" : r.strength === "moderate" ? "caution" : "unknown"} label={titleCase(String(r.strength ?? ""))} /> },
        { key: "p", header: "Provenance", render: (r: any) => r.provenance },
        { key: "b", header: "Basis / source", render: (r: any) => r.basis ?? r.source ?? "—" },
      ]}
      rows={pod.candidates ?? []}
    />

    {exposure.available && <div className="pod-exposure">
      <div className="l3-sub-label">Exposure at the preferred point of departure — reverse dosimetry</div>
      <dl className="l3-metrics">
        <div><dt>Free Cmax</dt><dd>{num(exposure.free_cmax_uM)} µM</dd></div>
        <div><dt>Total Cmax</dt><dd>{num(exposure.total_cmax_uM)} µM</dd></div>
        <div><dt>AUC</dt><dd>{num(exposure.auc_uM_h)} µM·h</dd></div>
        <div><dt>Dose</dt><dd>{num(exposure.dose_mg_per_kg)} mg/kg</dd></div>
      </dl>
      <p className="l3-hint-muted">{exposure.basis}</p>
    </div>}

    {pharmacological.available && (pharmacological.occupancy_ladder?.length ?? 0) > 0 && <>
      <div className="l3-sub-label">Occupancy ladder — dose required for target engagement</div>
      <DataTable
        columns={[
          { key: "o", header: "Target occupancy", render: (r: any) => pct(r.target_occupancy) },
          { key: "d", header: "Dose (mg/kg)", align: "right", render: (r: any) => r.available ? num(r.dose_mg_per_kg) : "not derivable" },
          { key: "c", header: "Required free Cmax (µM)", align: "right", render: (r: any) => num(r.required_free_cmax_uM) },
        ]}
        rows={pharmacological.occupancy_ladder ?? []}
      />
    </>}

    <div className="pod-determination">
      <AlertTriangle size={15} />
      <div>
        <b>NOAEL not determined</b>
        <p>{determination.reason}</p>
        <p><b>What would establish it:</b> {determination.what_would_establish_it}</p>
        {(determination.hazard_context?.length ?? 0) > 0 && <p><b>Hazard context:</b> {determination.hazard_context.join(", ")}</p>}
      </div>
    </div>
  </Card>;
}

export function StudyOutcomesCard({ outcomes }: { outcomes?: StudyOutcomes }) {
  if (!outcomes) return null;
  if (!outcomes.available) return <Unavailable title="Study-report rollup" reason={outcomes.reason} />;
  const summary = outcomes.summary ?? {};
  return <>
    <Card
      icon={<ClipboardList size={16} />}
      title="Study-report rollup — procedures and where the scrutiny falls"
      subtitle={`${text(summary.n_sections)} procedures · ${text(summary.n_under_heightened_scrutiny)} under heightened scrutiny`}
      note={outcomes.limitations}
    >
      {(summary.sections_to_watch?.length ?? 0) > 0 && <div className="outcomes-watch">
        <AlertTriangle size={15} /> <span>Sections to watch: <strong>{summary.sections_to_watch.join(", ")}</strong></span>
      </div>}
      <div className="outcomes-sections">
        {(outcomes.sections ?? []).map((section) => (
          <div key={section.id} className={`outcome-section ${section.status}`}>
            <div className="outcome-section-head">
              <div><b>{section.name}</b><small>{section.schedule}</small></div>
              <StatusPill status={section.status} label={titleCase(String(section.status ?? ""))} />
            </div>
            <div className="outcome-params">
              {(section.parameters ?? []).map((p: string) => {
                const focus = (section.focus_parameters ?? []).includes(p);
                return <span key={p} className={focus ? "focus" : ""}>{p}</span>;
              })}
            </div>
            {(section.driven_by?.length ?? 0) > 0 && <div className="outcome-drivers">
              {section.driven_by.map((d: any, i: number) => (
                <span key={i}><StatusPill status={d.hazard_level} /> {d.domain}{d.organ ? ` · ${titleCase(d.organ)}` : ""}{d.probability != null ? ` · ${num(d.probability, 2)}` : ""}</span>
              ))}
            </div>}
          </div>
        ))}
      </div>
    </Card>
    <DesignConformanceCard conformance={outcomes.design_conformance} />
  </>;
}

export function ModelPanelCard({ panel }: { panel?: ModelPanel }) {
  const [open, setOpen] = useState(false);
  if (!panel || !panel.endpoints) return null;
  const entries = Object.entries(panel.endpoints);
  return <Card
    icon={<Database size={16} />}
    title="Predictor provenance"
    subtitle={`${entries.length} endpoints resolved · ${panel.unresolved?.length ?? 0} unresolved · MW ${num(panel.mw_g_per_mol)} g/mol`}
    note="Every study-level engine consumed this one normalised bundle, so two blocks can never disagree about the same endpoint."
    actions={<button className="text-action" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} endpoint table</button>}
  >
    <div className="panel-sources">
      <div><b>Sources</b><span>{panel.sources?.join(", ") || "—"}</span></div>
      <div><b>Unresolved</b><span>{panel.unresolved?.length ? panel.unresolved.join(", ") : "None"}</span></div>
    </div>
    {open && <DataTable
      columns={[
        { key: "e", header: "Endpoint", render: (r: any) => r[0] },
        { key: "v", header: "Value", align: "right", render: (r: any) => num(r[1]?.value, 4) },
        { key: "s", header: "Source", render: (r: any) => r[1]?.source === "l1_record" ? <StatusPill status="pass" label="Immutable L1 record" /> : <StatusPill status="caution" label={String(r[1]?.source ?? "live inference")} /> },
        { key: "m", header: "Model", render: (r: any) => r[1]?.model ?? "—" },
        { key: "p", header: "Provenance", render: (r: any) => r[1]?.provenance ?? "—" },
        { key: "d", header: "In domain", render: (r: any) => r[1]?.in_domain === false ? <span className="warn-note">out of domain</span> : r[1]?.in_domain === true ? "yes" : "—" },
      ]}
      rows={entries}
    />}
  </Card>;
}

export function ResolvedInputsCard({ resolved }: { resolved?: Record<string, any> }) {
  if (!resolved) return null;
  const target = resolved.target ?? {};
  const potency = resolved.potency ?? null;
  return <Card
    icon={<Layers size={16} />}
    title="Inherited inputs"
    subtitle="What the animal layer received from Layers 1 and 2. The study is parameterised from this record, not re-derived."
  >
    <dl className="resolved-grid">
      <div><dt>Analysis</dt><dd><code>{text(resolved.analysis_id)}</code></dd></div>
      <div><dt>Layer 1 verdict</dt><dd>{text(resolved.l1_verdict)}</dd></div>
      <div><dt>Target protein</dt><dd>{text(target.target_protein)}</dd></div>
      <div><dt>Gene symbol</dt><dd>{text(target.gene_symbol)}</dd></div>
      <div><dt>UniProt</dt><dd>{text(target.uniprot_id)}</dd></div>
      <div><dt>Therapeutic area</dt><dd>{text(resolved.therapeutic_area)}</dd></div>
      <div><dt>Target potency</dt><dd>{potency ? `${text(potency.activity_type ?? "Kd")} ${num(potency.value_nM)} nM` : "not carried through"}</dd></div>
      <div><dt>Potency provenance</dt><dd>{text(potency?.provenance ?? potency?.source)}</dd></div>
    </dl>
    {(resolved.safety_flags?.length ?? 0) > 0 && <div className="resolved-flags">
      <div className="l3-sub-label">Safety flags carried forward</div>
      {(resolved.safety_flags ?? []).map((flag: any, i: number) => (
        <span key={i}><AlertTriangle size={12} /> {typeof flag === "string" ? flag : flag.label ?? flag.endpoint ?? "flag"}</span>
      ))}
    </div>}
  </Card>;
}

export function EvidenceCard({ evidence }: { evidence?: Record<string, any> }) {
  if (!evidence) return null;
  const noael = evidence.noael_anchor ?? {};
  const ld50 = evidence.ld50_anchor ?? {};
  return <Card
    icon={<Activity size={16} />}
    title="Public animal evidence"
    subtitle="Live lookups against EPA CCTE, ChEMBL, PubChem and PK-DB for measured animal data on this structure or close analogues."
  >
    {evidence.available ? <>
      <p>Data located from: <strong>{(evidence.sources_with_data ?? []).join(", ")}</strong>.</p>
      <div className="l3-safety-anchors">
        <div><b>Measured NOAEL</b><span>{noael.value_mg_kg_day != null ? `${num(noael.value_mg_kg_day)} mg/kg/day` : "not located"}</span></div>
        <div><b>Measured LD50</b><span>{ld50.value_mg_kg != null ? `${num(ld50.value_mg_kg)} mg/kg` : "not located"}</span></div>
        <div><b>Species covered</b><span>{(noael.species_covered ?? evidence.species_covered ?? []).join(", ") || "—"}</span></div>
      </div>
    </> : <p className="l3-hint-muted">
      {evidence.reason ?? evidence.error ?? "No public animal PK or toxicology evidence was located for this compound or its near analogues. That is an absence of a public record, not evidence of safety."}
    </p>}
  </Card>;
}

export function DoseComparisonCard({ pkpd }: { pkpd?: Record<string, any> }) {
  const proportionality = pkpd?.dose_proportionality;
  const exposureResponse = pkpd?.exposure_response;
  if (!proportionality && !exposureResponse) return null;
  return <Card icon={<GitCompare size={16} />} title="Dose comparison">
    {proportionality?.available ? <p>
      Dose-proportionality slope β = <strong>{num(proportionality.beta_slope)}</strong> — {proportionality.classification}.
      {proportionality.interpretation ? ` ${proportionality.interpretation}` : ""}
    </p> : <p className="l3-hint-muted">{proportionality?.reason ?? "Dose proportionality was not assessed."}</p>}
    {exposureResponse?.available && <p>{exposureResponse.interpretation ?? exposureResponse.summary}</p>}
  </Card>;
}
