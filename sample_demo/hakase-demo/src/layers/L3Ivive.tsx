/**
 * Layer 3 — IVIVE exposure projection and the Layer 2 → Layer 3 stage gate.
 *
 * The rail collects the animal and the study context, plus any measured
 * disposition input that should replace a prediction. The main column renders
 * the concentration–time profile, the projected endpoints with their
 * provenance, the observed-PK anchor, and the stage gate that separates hard
 * blocks from acknowledgeable warnings.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Beaker, Boxes, Database, Droplets,
  FlaskConical, LoaderCircle, PenLine, Play, ShieldAlert, ShieldCheck, Waves,
} from "lucide-react";
import { SPECIES, TISSUE_KEYS, TISSUE_LABEL } from "../lib/pk";
import { num, pct, round, titleCase } from "../lib/format";
import type { CompoundProfile } from "../engine/profile";
import type { L1Record } from "../engine/l1";
import { evaluateGate, pkAnchor, runExposure, type ExposureInput, type MeasuredOverrides } from "../engine/l3ivive";
import { BarChart, MetricDonut, ProfileChart, RankChart, SegmentDonut } from "../components/charts";
import {
  Anchors, Card, DataTable, DlGrid, Field, Notice, PresentationGroups, RunProgress,
  SectionHeader, StatusPill, Tile, TileRow,
} from "../components/ui";

const MEASURED_INPUTS = [
  { key: "fu_plasma" as const, label: "Fraction unbound in plasma (fu)", unit: "fraction 0–1", hint: "e.g. 0.0002 for a ~99.98% albumin-bound compound" },
  { key: "clint_hep_ul_min_1e6" as const, label: "Hepatocyte intrinsic clearance", unit: "µL/min/10⁶ cells", hint: "Measured in the study species" },
  { key: "vdss_l_per_kg" as const, label: "Steady-state volume of distribution", unit: "L/kg", hint: "" },
  { key: "half_life_obach_h" as const, label: "Terminal half-life", unit: "h", hint: "" },
  { key: "blood_plasma_ratio" as const, label: "Blood:plasma ratio", unit: "ratio", hint: "Defaults to the haematocrit model when not supplied" },
];

export type L3IviveState = {
  speciesId: string;
  strain: string;
  bodyWeight: string;
  route: "IV" | "ORAL" | "SC";
  dose: string;
  duration: string;
  infusion: string;
  formulation: string;
  cohortSize: string;
  measured: Record<string, string>;
  exposure: ReturnType<typeof runExposure> | null;
  anchor: ReturnType<typeof pkAnchor> | null;
  gate: ReturnType<typeof evaluateGate> | null;
  acknowledged: Record<string, boolean>;
  signoff: { name: string; role: string; justification: string | null; acknowledged_codes: string[]; signed_at: string } | null;
};

export const emptyIviveState: L3IviveState = {
  speciesId: "rat", strain: "sprague_dawley", bodyWeight: "0.3", route: "IV",
  dose: "1", duration: "24", infusion: "", formulation: "solution", cohortSize: "24",
  measured: {}, exposure: null, anchor: null, gate: null, acknowledged: {}, signoff: null,
};

type Props = {
  profile: CompoundProfile;
  l1: L1Record;
  hasReview: boolean;
  state: L3IviveState;
  setState: (updater: (current: L3IviveState) => L3IviveState) => void;
  railHost: HTMLElement | null;
  onBack: () => void;
  onContinue: () => void;
};

export function L3Ivive({ profile, l1, hasReview, state, setState, railHost, onBack, onContinue }: Props) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [justification, setJustification] = useState("");
  const physiology = SPECIES.find((row) => row.id === state.speciesId) ?? SPECIES[0];

  const overrides: MeasuredOverrides = useMemo(() => {
    const out: MeasuredOverrides = {};
    for (const [key, raw] of Object.entries(state.measured)) {
      const value = Number(raw);
      if (raw?.trim() && Number.isFinite(value) && value > 0) (out as any)[key] = value;
    }
    return out;
  }, [state.measured]);

  useEffect(() => {
    if (!state.gate) {
      setState((current) => ({ ...current, gate: evaluateGate(profile, l1, current.speciesId, hasReview) }));
    }
  }, [profile.smiles, l1.analysis_id, state.speciesId, hasReview]);

  function run() {
    setBusy(true);
    window.setTimeout(() => {
      const input: ExposureInput = {
        speciesId: state.speciesId, strain: state.strain, bodyWeightKg: Number(state.bodyWeight),
        route: state.route, doseMgPerKg: Number(state.dose), durationH: Number(state.duration),
        infusionDurationH: state.infusion ? Number(state.infusion) : null,
        formulation: state.formulation, cohortSize: Number(state.cohortSize), overrides,
      };
      const exposure = runExposure(profile, l1, input);
      setState((current) => ({
        ...current, exposure,
        gate: evaluateGate(profile, l1, current.speciesId, hasReview),
      }));
      setBusy(false);
    }, 1200);
  }

  const exposure = state.exposure;
  const gate = state.gate;
  const sealed = Boolean(state.signoff);
  const allAcknowledged = (gate?.warnings ?? []).every((warning) => state.acknowledged[warning.code]);
  const canSign = Boolean(gate) && (gate!.blocks.length === 0) && allAcknowledged && name.trim().length > 0 && role.trim().length > 0;

  /* ── rail ─────────────────────────────────────────────────────────────── */
  const rail = railHost && createPortal(<>
    <div className="rail-scroll">
      <div className="rail-head">
        <div><span>Study setup</span><b>Exposure projection</b></div>
        <small><Beaker size={13} /> PBPK</small>
      </div>

      <section className="card-input">
        <Field label="Species">
          <select value={state.speciesId} onChange={(event) => {
            const next = SPECIES.find((row) => row.id === event.target.value)!;
            setState((current) => ({
              ...current, speciesId: next.id, strain: next.defaultStrain,
              bodyWeight: String(next.bodyWeightKg), exposure: null, anchor: null,
              gate: evaluateGate(profile, l1, next.id, hasReview),
            }));
          }}>
            {SPECIES.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </Field>
        <Field label="Strain or reference row">
          <select value={state.strain} onChange={(event) => {
            const row = physiology.strains.find((entry) => entry.id === event.target.value);
            setState((current) => ({ ...current, strain: event.target.value, bodyWeight: row ? String(row.bodyWeightKg) : current.bodyWeight, exposure: null }));
          }}>
            {physiology.strains.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </Field>
        <Field label="Body weight (kg)">
          <input type="number" min="0.001" step="0.001" value={state.bodyWeight} onChange={(event) => setState((current) => ({ ...current, bodyWeight: event.target.value }))} />
        </Field>
      </section>

      <section className="card-input">
        <Field label="Administration route">
          <select value={state.route} onChange={(event) => setState((current) => ({ ...current, route: event.target.value as any, exposure: null }))}>
            <option value="IV">Intravenous</option>
            <option value="ORAL">Oral</option>
            <option value="SC">Subcutaneous</option>
          </select>
        </Field>
        <Field label="Study dose (mg/kg)">
          <input type="number" min="0.001" step="0.1" value={state.dose} onChange={(event) => setState((current) => ({ ...current, dose: event.target.value }))} />
        </Field>
        <Field label="Simulation window (h)">
          <input type="number" min="0.5" step="0.5" value={state.duration} onChange={(event) => setState((current) => ({ ...current, duration: event.target.value }))} />
        </Field>
        {state.route === "IV" && <Field label="Infusion duration (h)" hint="blank for a bolus">
          <input type="number" min="0" step="0.1" value={state.infusion} onChange={(event) => setState((current) => ({ ...current, infusion: event.target.value }))} placeholder="Bolus" />
        </Field>}
        <Field label="Formulation">
          <input value={state.formulation} onChange={(event) => setState((current) => ({ ...current, formulation: event.target.value }))} placeholder="e.g. solution" />
        </Field>
        <Field label="Virtual cohort size">
          <input type="number" min="2" max="60" step="1" value={state.cohortSize} onChange={(event) => setState((current) => ({ ...current, cohortSize: event.target.value }))} />
        </Field>
      </section>

      <details className="measured-inputs" open={Object.keys(overrides).length > 0}>
        <summary><FlaskConical size={14} /> Measured inputs{Object.keys(overrides).length > 0 && <em>{Object.keys(overrides).length} in force</em>}</summary>
        <p className="measured-note">
          A value entered here <strong>replaces the model prediction</strong>, is carried through the animal study and the
          first-in-human projection, and is stamped <em>measured (user-supplied)</em>. Leave a field blank to keep the prediction.
        </p>
        {MEASURED_INPUTS.map((input) => (
          <Field key={input.key} label={input.label} hint={input.unit}>
            <input type="number" min="0" step="any" inputMode="decimal" value={state.measured[input.key] ?? ""}
              placeholder={input.hint || "Predicted"}
              onChange={(event) => setState((current) => ({ ...current, measured: { ...current.measured, [input.key]: event.target.value }, exposure: null }))} />
          </Field>
        ))}
        {Object.keys(overrides).length > 0 && (
          <button className="text-action" onClick={() => setState((current) => ({ ...current, measured: {}, exposure: null }))}>Clear measured inputs</button>
        )}
      </details>

      <div className="notice info" style={{ marginBottom: 0 }}>
        <ShieldCheck size={15} />
        <span>Results carry their uncertainty and provenance. They are screening projections, not a dosing recommendation and not a substitute for measured pharmacokinetics.</span>
      </div>
    </div>
    <div className="rail-foot">
      <button className="btn primary full lg" onClick={run} disabled={busy || !(Number(state.bodyWeight) > 0 && Number(state.dose) > 0 && Number(state.duration) > 0)}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
        {busy ? "Running exposure projection…" : "Run exposure projection"}
      </button>
    </div>
  </>, railHost);

  return <>
    {rail}

    <section className="panel">
      <SectionHeader icon={<Beaker size={18} />} eyebrow="LAYER 3 · IVIVE" title="Species-aware exposure projection" accent="l3"
        description="Translates the completed in-vitro evidence into a whole-body concentration–time projection: 13 perfusion-limited compartments, well-stirred hepatic clearance, glomerular-filtration renal clearance, and a log-normally sampled virtual cohort." />
      <div className="dl-grid">
        <div><dt>Engine</dt><dd>Whole-body perfusion-limited PBPK, RK4 integration</dd></div>
        <div><dt>Partitioning</dt><dd>Poulin &amp; Theil tissue composition from logP and fu</dd></div>
        <div><dt>Clearance</dt><dd>Well-stirred hepatic model + glomerular filtration</dd></div>
        <div><dt>Population variability</dt><dd>Log-normal on clearance, fu, absorption rate and body weight</dd></div>
      </div>
    </section>

    {busy && <RunProgress
      title="Projecting whole-body exposure"
      typicalSeconds={7}
      steps={[
        "Resolving disposition inputs and their provenance",
        "Scaling intrinsic clearance to the species liver",
        "Computing tissue:plasma partition coefficients",
        "Integrating the 13-compartment cohort",
        "Deriving plasma endpoints and population percentiles",
        "Assembling the presentation contract",
      ]}
    />}

    {!busy && !exposure && (
      <div className="panel empty">
        <div className="orb"><Beaker size={28} /></div>
        <h2>Ready for the exposure projection</h2>
        <p>Choose a species and a study context in the rail, then run the completed Layer 1 evidence through the IVIVE and PBPK workflow.</p>
      </div>
    )}

    {!busy && exposure && !exposure.available && (
      <section className="panel">
        <Notice kind="error" icon={<AlertTriangle size={16} />}>
          <b>Exposure projection unavailable</b>
          <p style={{ marginTop: 4 }}>{(exposure as any).reason}</p>
        </Notice>
        <div className="sub-label">Missing parameters</div>
        <ul className="rail-tags">
          {(exposure as any).missing.map((item: string, index: number) => <li key={index}><AlertTriangle size={12} /><code>{item}</code></li>)}
        </ul>
        <Notice kind="info" icon={<FlaskConical size={16} />}>{(exposure as any).remediation}</Notice>
      </section>
    )}

    {!busy && exposure?.available && (() => {
      const plasma = exposure.endpoints.plasma;
      const clearance = exposure.clearance;
      const tissueRows = TISSUE_KEYS.filter((key) => key !== "rest").map((key) => ({
        organ: key, label: TISSUE_LABEL[key], ...exposure.endpoints.tissue[key],
      })).sort((a, b) => b.aucMedian - a.aucMedian);
      const topTissues = tissueRows.slice(0, 5);

      return <>
        <TileRow>
          <Tile icon={<Waves size={16} />} label="Cmax" value={num(plasma.c_max.median, 4)} unit="mg/L"
            note={`90% interval ${num(plasma.c_max.p05, 4)} – ${num(plasma.c_max.p95, 4)}`} tone="brand" />
          <Tile icon={<Activity size={16} />} label="AUC" value={num(plasma.auc.median, 4)} unit="mg·h/L"
            note={`CV ${num(plasma.auc.cv * 100, 1)}% across the cohort`} />
          <Tile icon={<Droplets size={16} />} label="Terminal half-life" value={num(plasma.t_half.median, 2)} unit="h"
            note={`Vss ${num(exposure.vssLPerKg, 2)} L/kg · CL ${num(plasma.cl.median, 3)} L/h`} />
          <Tile icon={<ShieldCheck size={16} />} label="Projection confidence" value={titleCase(exposure.confidence)}
            note={exposure.confidence === "low" ? "A measured disposition input would narrow this substantially" : "Inputs sit inside their models' training chemistry"}
            tone={exposure.confidence === "low" ? "warn" : "good"} />
        </TileRow>

        <section className="panel">
          <SectionHeader icon={<Waves size={18} />} eyebrow="CONCENTRATION–TIME" title="Plasma profile with the population interval" accent="l3"
            description={`${state.cohortSize} virtual subjects, ${physiology.label} · ${state.dose} mg/kg ${state.route} over ${state.duration} h.`} />
          <ProfileChart
            title="Plasma concentration–time profile"
            subtitle="Cohort mean with the 5th–95th percentile population band"
            time={exposure.time}
            series={[{ label: "Plasma", mean: exposure.curves.plasma.mean, p05: exposure.curves.plasma.p05, p95: exposure.curves.plasma.p95 }]}
            xLabel="Time (h)" yLabel="Concentration (mg/L)"
            footnote="The band is population variability from the sampled cohort, not model uncertainty. Model uncertainty is reported separately in the confidence block."
          />
        </section>

        <section className="panel">
          <SectionHeader icon={<Boxes size={18} />} eyebrow="TISSUE DISTRIBUTION" title="Where the drug goes" accent="l3"
            description="Simulated exposure in every compartment the model carries, ranked by area under the curve." />
          <div className="grid-2">
            <ProfileChart
              title="Plasma versus the five highest-exposure tissues"
              subtitle="Simulated cohort means"
              time={exposure.time}
              series={[
                { label: "Plasma", mean: exposure.curves.plasma.mean },
                ...topTissues.map((row) => ({ label: row.label, mean: exposure.curves[row.organ].mean })),
              ]}
              xLabel="Time (h)" yLabel="Concentration (mg/L)"
            />
            <RankChart
              title="Tissue:plasma AUC ratio"
              subtitle="Poulin & Theil partitioning from the predicted logP and unbound fraction"
              points={tissueRows.map((row) => ({
                label: row.label, value: row.tissuePlasmaAucRatio, detail: `${num(row.tissuePlasmaAucRatio, 2)}×`,
                tone: row.tissuePlasmaAucRatio > 5 ? ("warn" as const) : ("neutral" as const),
              }))}
              valueLabel="× plasma"
              reference={{ value: 1, label: "1× — equal to plasma" }}
              footnote="Adipose and brain are the least reliable compartments: adipose because the partition is exquisitely logP-sensitive, brain because active efflux is not captured by a passive partition model."
            />
          </div>
          <div className="sub-label">Per-compartment exposure</div>
          <DataTable
            columns={[
              { key: "t", header: "Tissue", render: (row: any) => <b>{row.label}</b> },
              { key: "c", header: "Cmax (mg/L)", align: "right", render: (row: any) => num(row.cMaxMedian, 4) },
              { key: "x", header: "Tmax (h)", align: "right", render: (row: any) => num(row.tMaxMedianH, 2) },
              { key: "a", header: "AUC (mg·h/L)", align: "right", render: (row: any) => num(row.aucMedian, 4) },
              { key: "r", header: "Tissue:plasma AUC", align: "right", render: (row: any) => num(row.tissuePlasmaAucRatio, 3) },
              { key: "k", header: "Kp", align: "right", render: (row: any) => num(row.kp, 3) },
              { key: "p", header: "Partitioning", render: (row: any) => <StatusPill status={row.kp > 10 ? "caution" : "pass"} label={row.kp > 10 ? "High" : row.kp > 2 ? "Moderate" : "Low"} /> },
            ]}
            rows={tissueRows}
          />
        </section>

        <section className="panel">
          <SectionHeader icon={<Activity size={18} />} eyebrow="CLEARANCE" title="How the compound is eliminated" accent="l3"
            description="The well-stirred hepatic model with glomerular filtration, and the bioavailability decomposition that follows from it." />
          <div className="grid-2">
            <BarChart
              title="Clearance decomposition"
              subtitle="Hepatic and renal contributions to total plasma clearance"
              points={[
                { label: "Hepatic", value: clearance.clHepaticPlasmaLPerH, detail: `${num(clearance.clHepaticPlasmaLPerH, 3)} L/h`, tone: "neutral" },
                { label: "Renal", value: clearance.clRenalPlasmaLPerH, detail: `${num(clearance.clRenalPlasmaLPerH, 3)} L/h`, tone: "neutral" },
                { label: "Total", value: clearance.clTotalPlasmaLPerH, detail: `${num(clearance.clTotalPlasmaLPerH, 3)} L/h`, tone: "good" },
                { label: "Liver blood flow", value: clearance.qhLPerH, detail: `${num(clearance.qhLPerH, 1)} L/h`, tone: "warn" },
              ]}
              valueLabel="L/h" axisLabel="Clearance route"
              footnote={`Extraction ratio ${num(clearance.extractionRatio, 3)} — a ${clearance.extractionClass}-extraction compound. ${clearance.extractionClass === "high" ? "Clearance approaches liver blood flow and becomes insensitive to intrinsic clearance." : "Clearance is driven by intrinsic clearance rather than by flow."}`}
            />
            <BarChart
              title="Bioavailability decomposition"
              subtitle="Each term carries its own uncertainty, and they multiply"
              points={[
                { label: "Fa", value: exposure.bioavailability.Fa, detail: num(exposure.bioavailability.Fa, 3), tone: "neutral" },
                { label: "Fg", value: exposure.bioavailability.Fg, detail: num(exposure.bioavailability.Fg, 3), tone: "neutral" },
                { label: "Fh", value: exposure.bioavailability.Fh, detail: num(exposure.bioavailability.Fh, 3), tone: "neutral" },
                { label: "F", value: exposure.bioavailability.F, detail: num(exposure.bioavailability.F, 3), tone: "good" },
              ]}
              valueLabel="fraction" axisLabel="Absorption term" reference={{ value: 1, label: "Complete availability" }}
              footnote={state.route === "ORAL" ? "F is the product of the three terms. For a parenteral route it is 1 by definition." : "For this parenteral route F is 1 by definition; the absorption terms are reference only."}
            />
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={<Database size={18} />} eyebrow="RESULT DETAIL" title="Projected measures with provenance" accent="l3"
            description="Every value the projection returned, with the provenance of the input that produced it." />
          <PresentationGroups groups={exposure.presentation.groups as any} />
        </section>

        <section className="panel">
          <SectionHeader icon={<Database size={18} />} eyebrow="OBSERVED ANCHOR" title="Comparison against measured pharmacokinetics" accent="l3"
            description="The one check that grades this projection against real measurements rather than against its own internal consistency."
            actions={<button className="btn" onClick={() => setState((current) => ({
              ...current,
              anchor: pkAnchor(profile, { cl: plasma.cl.median, vss: exposure.vssLPerKg, halfLife: plasma.t_half.median }),
            }))}><Database size={15} /> {state.anchor ? "Re-check" : "Look up observed PK"}</button>} />
          {state.anchor ? (
            state.anchor.status === "matched" ? <>
              <Anchors entries={[
                ["Matched record", (state.anchor as any).matched_compound],
                ["Studies", (state.anchor as any).n_studies],
                ["Population", (state.anchor as any).population],
                ["Source", state.anchor.source],
              ]} />
              <DataTable
                columns={[
                  { key: "p", header: "Parameter", render: (row: any) => <b>{row.parameter}</b> },
                  { key: "o", header: "Observed", align: "right", render: (row: any) => num(row.observed) },
                  { key: "j", header: "Projected", align: "right", render: (row: any) => num(row.projected) },
                  { key: "f", header: "Fold error", align: "right", render: (row: any) => `${num(row.fold_error)}×` },
                  { key: "w", header: "Within 2×", render: (row: any) => <StatusPill status={row.within_2x ? "pass" : "caution"} label={row.within_2x ? "Yes" : "No"} /> },
                ]}
                rows={(state.anchor as any).comparisons}
              />
              <p className="limitation"><AlertTriangle size={13} /> {(state.anchor as any).limitation}</p>
            </> : <Notice kind="plain" icon={<Database size={16} />}>{state.anchor.reason}</Notice>
          ) : <p className="hint-muted">No lookup has been run for this projection yet.</p>}
        </section>
      </>;
    })()}

    {/* ── stage gate ────────────────────────────────────────────────────── */}
    {gate && <section className="panel">
      <SectionHeader icon={<ShieldCheck size={18} />} eyebrow="STAGE GATE · LAYER 2 → LAYER 3" title="Accumulated-evidence review" accent="l3"
        description="Everything the cascade has produced so far, checked before an animal study may be designed. A block records an evidence gap a signature cannot close; a warning records residual risk a named reviewer may accept on the record." />

      <div className="grid-2">
        <SegmentDonut
          segments={[
            { key: "clear", label: "No condition", value: Math.max(0, 4 - gate.blocks.length - gate.warnings.length), tone: "good" },
            { key: "warn", label: "Warning", value: gate.warnings.length, tone: "warn" },
            { key: "block", label: "Block", value: gate.blocks.length, tone: "bad" },
          ]}
          centreValue={gate.blocks.length + gate.warnings.length} centreTotal={Math.max(4, gate.blocks.length + gate.warnings.length)}
          centreLabel="conditions raised"
          caption={gate.policy.note}
        />
        <div>
          <TileRow>
            <Tile icon={<ShieldAlert size={16} />} label="Hard blocks" value={gate.blocks.length}
              note={gate.blocks.length ? "Cannot be signed away — the evidence has to change" : "None raised"} tone={gate.blocks.length ? "bad" : "good"} />
            <Tile icon={<AlertTriangle size={16} />} label="Acknowledgeable warnings" value={gate.warnings.length}
              note={`${Object.values(state.acknowledged).filter(Boolean).length} acknowledged`} tone={gate.warnings.length ? "warn" : "good"} />
          </TileRow>
        </div>
      </div>

      {!gate.blocks.length && !gate.warnings.length && (
        <Notice kind="good" icon={<BadgeCheck size={16} />}>No blocks and no warnings. The accumulated evidence supports progressing to the animal cohort layer.</Notice>
      )}

      {gate.blocks.map((condition) => (
        <article className="condition block" key={condition.code}>
          <div className="condition-head"><ShieldAlert size={16} /><span className="sev block">BLOCK</span><b>{condition.title}</b></div>
          <p>{condition.detail}</p>
          {condition.endpoints?.length ? <div className="gate-endpoints">{condition.endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)}</div> : null}
          <div className="condition-foot">This cannot be signed away. The underlying evidence has to change.</div>
        </article>
      ))}

      {gate.warnings.map((condition) => (
        <article className={`condition warn ${state.acknowledged[condition.code] ? "acked" : ""}`} key={condition.code}>
          <div className="condition-head"><AlertTriangle size={16} /><span className="sev warn">WARN</span><b>{condition.title}</b></div>
          <p>{condition.detail}</p>
          {condition.endpoints?.length ? <div className="gate-endpoints">{condition.endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)}</div> : null}
          <label className="check gate-ack">
            <input type="checkbox" disabled={sealed} checked={Boolean(state.acknowledged[condition.code])}
              onChange={(event) => setState((current) => ({ ...current, acknowledged: { ...current.acknowledged, [condition.code]: event.target.checked } }))} />
            <span>Acknowledge — proceed despite this warning, on the record.</span>
          </label>
        </article>
      ))}

      {sealed ? (
        <div className="gate-sealed">
          <BadgeCheck size={24} style={{ color: "var(--good)", flex: "0 0 auto" }} />
          <div>
            <b>Stage gate sealed</b>
            <p>Signed by <strong>{state.signoff!.name}</strong> · {state.signoff!.role} · {state.signoff!.signed_at}</p>
            {state.signoff!.justification && <blockquote>{state.signoff!.justification}</blockquote>}
            <small>{state.signoff!.acknowledged_codes.length} warning{state.signoff!.acknowledged_codes.length === 1 ? "" : "s"} acknowledged. This signature records accepted residual risk; it alters no model output.</small>
          </div>
        </div>
      ) : (
        <div className="mt">
          <div className="sub-label"><PenLine size={13} /> Reviewer sign-off</div>
          <div className="field-row">
            <Field label="Name *"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Dr. Sarah Lin" disabled={gate.blocks.length > 0} /></Field>
            <Field label="Role *"><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Head of DMPK" disabled={gate.blocks.length > 0} /></Field>
          </div>
          <Field label="Justification" hint="recommended when warnings are acknowledged">
            <textarea value={justification} onChange={(event) => setJustification(event.target.value)}
              placeholder="Rationale for sign-off given the accumulated evidence…" disabled={gate.blocks.length > 0} />
          </Field>
          <ul className="checklist">
            <li className={gate.blocks.length ? "bad" : "good"}>{gate.blocks.length ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} Hard blocks: {gate.blocks.length ? `${gate.blocks.length} unresolved` : "none"}</li>
            <li className={allAcknowledged ? "good" : "warn"}><AlertTriangle size={14} /> Soft warnings: {Object.values(state.acknowledged).filter(Boolean).length}/{gate.warnings.length} acknowledged</li>
            <li className={name.trim() && role.trim() ? "good" : "warn"}><PenLine size={14} /> Sign-off: name and role required</li>
          </ul>
          <button className="btn primary" disabled={!canSign} onClick={() => setState((current) => ({
            ...current,
            signoff: {
              name: name.trim(), role: role.trim(), justification: justification.trim() || null,
              acknowledged_codes: (gate.warnings ?? []).filter((warning) => current.acknowledged[warning.code]).map((warning) => warning.code),
              signed_at: "2026-08-28 09:52",
            },
          }))}><PenLine size={15} /> Sign and seal the stage gate</button>
        </div>
      )}

      <div className="actions-row">
        <button className="btn" onClick={onBack}>Return to Confirmation</button>
        <button className="btn primary" onClick={onContinue} disabled={!sealed}>
          Continue to Animal Cohort <ArrowRight size={15} />
        </button>
        {!sealed && <span className="hint-muted" style={{ alignSelf: "center" }}>Seal the stage gate to carry the sealed dossier into the animal cohort layer.</span>}
      </div>
    </section>}
  </>;
}
