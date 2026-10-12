import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ErrorBox, roleLabel, Section } from "../components/common";
import { cleanContext, ContextForm, type Ctx } from "../components/ContextForm";
import { fieldLabel, prune, SchemaFields } from "../components/SchemaForm";
import { Empty, Facts, Loading, Pill, toast } from "../components/ui";
import { humanize, sentence, statusLabel } from "../lib/format";
import type { Driver, Program } from "../types";

interface Change {
  requirement_id: string;
  name: string;
  change: string;
  before: unknown;
  after: unknown;
  section_before: string | null;
  section_after: string | null;
  rationale: string;
}

/** "endpoints.0.name" -> "Endpoints › #1 › Name" */
const paramLabel = (path: string) =>
  path
    .split(".")
    .map((x) => (/^\d+$/.test(x) ? `#${Number(x) + 1}` : fieldLabel(x)))
    .join(" › ");
const show = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : Array.isArray(v)
      ? v.join(", ")
      : typeof v === "string"
        ? humanize(v)
        : String(v);
// a lengthened or shortened study changes its duration, which the engine states in weeks
const withUnit = (change: string, v: unknown) =>
  (change === "lengthened" || change === "shortened") && typeof v === "number" ? `${v} weeks` : show(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---- what-if ----------------------------------------------------------------------------------

/** Change the programme facts, see exactly which studies change and why, then apply on record. */
export function WhatIf({ p, reload }: { p: Program; reload: () => void }) {
  // facts added by later releases are absent from older programmes: compare like with like
  const base = useMemo(() => cleanContext(p.context), [p.context]);
  const [ctx, setCtx] = useState<Ctx>(() => structuredClone(base));
  const [formKey, setFormKey] = useState(0);
  const reset = () => {
    setCtx(structuredClone(base));
    setFormKey((k) => k + 1);
  };
  const [res, setRes] = useState<{ changes: Change[]; summary: Record<string, number> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const changes = useMemo(() => {
    const next = cleanContext(ctx);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) if (!same(v, base[k])) out[k] = v;
    return out;
  }, [ctx, base]);
  const n = Object.keys(changes).length;

  // compare as the facts change (nothing is saved)
  useEffect(() => {
    if (n === 0) {
      setRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<{ changes: Change[]; summary: Record<string, number> }>(`/programs/${p.id}/what-if`, { changes })
        .then((r) => {
          setRes(r);
          setErr(null);
        })
        // clear the previous comparison: leaving it on screen would show the old result
        // against the newly typed facts, which is the one thing this screen must not do
        .catch((e) => {
          setRes(null);
          setErr(e);
        });
    }, 450);
    return () => window.clearTimeout(t);
  }, [changes, n, p.id]);

  async function apply() {
    setBusy(true);
    try {
      await api.patch(`/programs/${p.id}/context`, { changes, reason });
      toast("Programme facts changed; the study set is re-derived and the change recorded");
      setReason("");
      reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="What-if: change the programme facts"
        subtitle="Nothing is saved until you apply. Every change in the study set comes from the cited rules: longer trials lengthen repeat-dose studies (ICH M3(R2) Table 1), new populations re-time reproductive studies, an advanced-cancer indication switches to ICH S9."
        right={
          n > 0 && (
            <button onClick={reset} className="ghost">
              Reset to current
            </button>
          )
        }
      >
        <ContextForm key={`${JSON.stringify(base)}#${formKey}`} value={ctx} onChange={setCtx} compareTo={base} />
      </Section>
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      <Section
        title="Effect on the study set"
        subtitle={
          n === 0
            ? "Change a fact above to see its effect."
            : res
              ? res.changes.length === 0
                ? "No change to the study set."
                : Object.entries(res.summary)
                    .map(([k, c]) => `${c} ${k}`)
                    .join(" · ")
              : "Comparing…"
        }
      >
        {n === 0 && <Empty title="No facts changed" />}
        {res && res.changes.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study</th>
                  <th>Change</th>
                  <th>Before → after</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {res.changes.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name}</td>
                    <td className="nowrap">
                      <Pill tone={c.change === "added" ? "warn" : c.change === "removed" ? "neutral" : "accent"}>
                        {humanize(c.change)}
                      </Pill>
                    </td>
                    <td className="nowrap">
                      {withUnit(c.change, c.before)} <span className="muted">→</span> {withUnit(c.change, c.after)}
                    </td>
                    <td className="small">
                      {c.section_after ?? c.section_before}
                      <div className="muted">{c.rationale}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {n > 0 && (
          <div className="grid2" style={{ marginTop: 12, alignItems: "end" }}>
            <label className="field">
              <span className="field-label">Reason for the change *</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. phase 1 extended to 28 days"
              />
            </label>
            <div className="field">
              <button className="primary" disabled={!reason.trim() || busy} onClick={apply}>
                Apply {n} change{n === 1 ? "" : "s"} to the programme
              </button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ---- rehearsal --------------------------------------------------------------------------------

interface RehearsalItem {
  requirement_id: string;
  name: string;
  outcome?: string;
  detail?: string;
  driver?: string;
  qc?: string;
  missing_parameters?: string[];
  missing_inputs?: string[];
  duration_days?: number | null;
  determinations?: { label: string; role: string; assigned_to: string[] }[];
  unavailable_results?: { label: string; reason: string }[];
}

interface Rehearsal {
  items: RehearsalItem[];
  summary: {
    by_outcome: Record<string, number>;
    missing_drivers: string[];
    unassigned_determinations: { requirement_id: string; determination: string; role: string }[];
    critical_path: {
      requirements: string[];
      known_duration_days: number;
      unknown_durations_on_path: string[];
      note: string;
    };
  };
}

interface InputRow {
  name: string;
  value: string;
  unit: string;
  kind: string;
  source: string;
}

interface Entry {
  include: boolean;
  driverId: string;
  parameters: Record<string, unknown>;
  simulation: Record<string, unknown>;
  seed: string;
  inputs: InputRow[];
}

const OUTCOME_TONE: Record<string, string> = {
  rehearsed: "ok",
  needs_design_parameters: "warn",
  needs_simulation_parameters: "warn",
  needs_compound: "warn",
  no_driver: "neutral",
  no_simulator: "neutral",
  error: "bad",
};

const driverCache: Record<string, Promise<Driver>> = {};
function loadDriver(id: string): Promise<Driver> {
  // a rejected promise is not nullish, so caching one would poison this driver id for the
  // life of the page: every later attempt would re-resolve the same failure
  if (!(id in driverCache)) {
    driverCache[id] = api.get<Driver>(`/drivers/${id}`).catch((e) => {
      delete driverCache[id];
      throw e;
    });
  }
  return driverCache[id];
}

/** Run every runnable study with simulated data and the parameters stated here; nothing is saved. */
export function RehearsalView({ p }: { p: Program }) {
  const runnable = p.study_set.requirements.filter(
    (r) => r.status === "required" && (p.drivers?.[r.id] ?? []).length > 0,
  );
  const [plan, setPlan] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      runnable.map((r) => [
        r.id,
        {
          include: true,
          driverId: p.drivers[r.id][0].id,
          parameters: {},
          simulation: {},
          seed: "",
          inputs: [],
        } as Entry,
      ]),
    ),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [res, setRes] = useState<Rehearsal | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const outcome = Object.fromEntries((res?.items ?? []).map((i) => [i.requirement_id, i]));
  const upd = (rid: string, patch: Partial<Entry>) => setPlan((o) => ({ ...o, [rid]: { ...o[rid], ...patch } }));

  async function run() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const [rid, e] of Object.entries(plan)) {
        if (!e.include) continue;
        const sim = prune(e.simulation) as Record<string, unknown> | undefined;
        body[rid] = {
          driver_id: e.driverId,
          parameters: (prune(e.parameters) as Record<string, unknown> | undefined) ?? {},
          simulation_parameters: sim ?? null,
          seed: e.seed.trim() === "" ? null : Number(e.seed),
          inputs: Object.fromEntries(
            e.inputs
              .filter((i) => i.name.trim() && i.value.trim())
              .map((i) => [
                i.name.trim(),
                i.kind === "user_supplied"
                  ? { value: Number(i.value), unit: i.unit, kind: i.kind, note: i.source || null }
                  : { value: Number(i.value), unit: i.unit, kind: i.kind, source: i.source || null },
              ]),
          ),
        };
      }
      setRes(await api.post<Rehearsal>(`/programs/${p.id}/rehearsal`, { plan: body }));
      setErr(null);
      toast("Rehearsal finished");
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const chosen = runnable.filter((r) => plan[r.id]?.include).length;
  const setAll = (include: boolean) =>
    setPlan((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, include }])));
  return (
    <>
      <Section
        title="Programme rehearsal"
        subtitle="Runs each chosen study through its driver on SIMULATED data and reports what would block the real programme. Nothing is saved."
        right={
          <button className="primary" disabled={busy || chosen === 0} onClick={run}>
            {busy ? "Rehearsing…" : res ? "Run again" : "Run rehearsal"}
          </button>
        }
      >
        <ErrorBox error={err} onDismiss={() => setErr(null)} />
        {runnable.length === 0 ? (
          <Empty title="Nothing to rehearse">No required study has an installed driver.</Empty>
        ) : (
          <>
            <div className="list-toolbar">
              <span className="muted small">
                {chosen} of {runnable.length} studies chosen
              </span>
              <span className="row">
                <button className="ghost small" onClick={() => setAll(true)}>
                  Select all
                </button>
                <button className="ghost small" onClick={() => setAll(false)}>
                  Clear
                </button>
              </span>
            </div>
            <div className="item-list">
              {runnable.map((r) => {
                const e = plan[r.id];
                const o = outcome[r.id];
                const isOpen = open === r.id;
                const driverName = (p.drivers[r.id] ?? []).find((d) => d.id === e.driverId)?.name;
                return (
                  <div className={`item-row${isOpen ? " open" : ""}${e.include ? "" : " off"}`} key={r.id}>
                    <div className="item-head">
                      <input
                        type="checkbox"
                        aria-label={`Include ${r.name}`}
                        checked={e.include}
                        onChange={(ev) => upd(r.id, { include: ev.target.checked })}
                      />
                      <div className="item-main">
                        <div className="item-title">{r.name}</div>
                        {(o?.detail || driverName) && (
                          <div className="muted small">{sentence(o?.detail ?? driverName ?? "")}</div>
                        )}
                      </div>
                      {o?.outcome && <Pill tone={OUTCOME_TONE[o.outcome] ?? "neutral"}>{humanize(o.outcome)}</Pill>}
                      <button className="small" onClick={() => setOpen(isOpen ? null : r.id)}>
                        {isOpen ? "Done" : "Edit plan"}
                      </button>
                    </div>
                    {isOpen && (
                      <div className="item-body">
                        <RehearsalEntry p={p} rid={r.id} entry={e} item={o} onChange={(patch) => upd(r.id, patch)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <details className="more-options" style={{ marginTop: 12 }}>
              <summary>How the plan is filled</summary>
              <div className="muted small" style={{ padding: "8px 2px" }}>
                Design parameters come from this plan, the requirement, or studies already designed. The simulated truth
                and a seed must be stated for each study; nothing is defaulted. Results are labelled SIMULATED and are
                never evidence.
              </div>
            </details>
          </>
        )}
      </Section>
      {res && <RehearsalResult p={p} res={res} />}
    </>
  );
}

function RehearsalEntry({
  p,
  rid,
  entry,
  item,
  onChange,
}: {
  p: Program;
  rid: string;
  entry: Entry;
  item?: RehearsalItem;
  onChange: (patch: Partial<Entry>) => void;
}) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setDriver(null);
    loadDriver(entry.driverId).then(setDriver).catch(setErr);
  }, [entry.driverId]);
  const choices = p.drivers[rid] ?? [];
  const known = new Set(entry.inputs.map((i) => i.name));
  return (
    <div className="stack">
      {choices.length > 1 && (
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Driver</span>
          <select
            value={entry.driverId}
            onChange={(e) => onChange({ driverId: e.target.value, parameters: {}, simulation: {} })}
          >
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ErrorBox error={err} />
      {!driver && !err && <Loading label="Loading the driver's parameters…" />}
      {driver && (
        <>
          <div className="sf-group">
            <div className="sf-group-head">
              <span className="sf-group-title">Design parameters</span>
              <span className="muted small">Leave empty what the requirement or an existing design already sets</span>
            </div>
            {item?.missing_parameters && item.missing_parameters.length > 0 && (
              <div className="note small" style={{ marginBottom: 8 }}>
                Still missing or invalid: {item.missing_parameters.map(paramLabel).join(", ")}
              </div>
            )}
            <SchemaFields
              schema={driver.parameters_schema}
              value={entry.parameters}
              onChange={(v) => onChange({ parameters: v })}
            />
          </div>
          {driver.simulation_parameters_schema ? (
            <div className="sf-group">
              <div className="sf-group-head">
                <span className="sf-group-title">Simulated truth</span>
                <span className="muted small">The model the simulator draws from; labelled SIMULATED everywhere</span>
              </div>
              <SchemaFields
                schema={driver.simulation_parameters_schema}
                value={entry.simulation}
                onChange={(v) => onChange({ simulation: v })}
              />
              <label className="field" style={{ maxWidth: 200, marginTop: 10 }}>
                <span className="field-label">Seed *</span>
                <input inputMode="numeric" value={entry.seed} onChange={(e) => onChange({ seed: e.target.value })} />
              </label>
            </div>
          ) : (
            <div className="muted small">This driver has no simulator, so it cannot be rehearsed.</div>
          )}
          <div className="sf-group">
            <div className="sf-group-head">
              <span className="sf-group-title">Analysis inputs</span>
              <span className="muted small">Values the analysis needs that the study does not measure</span>
            </div>
            <InputRows rows={entry.inputs} onChange={(inputs) => onChange({ inputs })} />
            {(item?.missing_inputs ?? []).filter((n) => !known.has(n)).length > 0 && (
              <div className="row small" style={{ marginTop: 8 }}>
                Needed:
                {(item?.missing_inputs ?? [])
                  .filter((n) => !known.has(n))
                  .map((n) => (
                    <button
                      key={n}
                      className="small"
                      title={n}
                      onClick={() =>
                        onChange({
                          inputs: [...entry.inputs, { name: n, value: "", unit: "", kind: "literature", source: "" }],
                        })
                      }
                    >
                      + {humanize(n)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InputRows({ rows, onChange }: { rows: InputRow[]; onChange: (r: InputRow[]) => void }) {
  const set = (i: number, k: keyof InputRow, v: string) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <>
      {rows.length === 0 ? (
        <div className="muted small">None.</div>
      ) : (
        <div className="table-wrap">
          <table className="compact sf-table">
            <thead>
              <tr>
                <th>Input</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Provenance</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={r.value} onChange={(e) => set(i, "value", e.target.value)} />
                  </td>
                  <td>
                    <input value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} />
                  </td>
                  <td>
                    <select value={r.kind} onChange={(e) => set(i, "kind", e.target.value)}>
                      <option value="measured">Measured</option>
                      <option value="literature">Literature</option>
                      <option value="user_supplied">User supplied</option>
                    </select>
                  </td>
                  <td>
                    <input value={r.source} onChange={(e) => set(i, "source", e.target.value)} />
                  </td>
                  <td>
                    <button
                      className="icon-btn danger"
                      aria-label="Remove"
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        className="small"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...rows, { name: "", value: "", unit: "", kind: "literature", source: "" }])}
      >
        + Add input
      </button>
    </>
  );
}

/** A short list inline; a long one folds behind its count. */
function Brief({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  if (items.length <= 4)
    return (
      <div>
        {label}: {items.join(", ")}
      </div>
    );
  return (
    <details className="brief">
      <summary>
        {items.length} {label.toLowerCase()}
      </summary>
      <div>{items.join(", ")}</div>
    </details>
  );
}

function RehearsalResult({ p, res }: { p: Program; res: Rehearsal }) {
  const cp = res.summary.critical_path;
  const names = Object.fromEntries(p.study_set.requirements.map((r) => [r.id, r.name]));
  const reqName = (id: string) => names[id] ?? id;
  // "dose_range_finding@1.0.0" -> the installed driver's name and version
  const driverLabel = (rid: string, ref: string) => {
    const [id, version] = ref.split("@");
    const d = (p.drivers[rid] ?? []).find((x) => x.id === id);
    return d ? `${d.name}${version ? ` · v${version}` : ""}` : ref;
  };
  return (
    <Section
      title="Rehearsal result"
      subtitle="SIMULATED: shows what would block the real programme; nothing here is evidence."
    >
      <div className="stats">
        {Object.entries(res.summary.by_outcome).map(([k, n]) => (
          <div className="stat" key={k}>
            <div className="stat-v">{n}</div>
            <div className="stat-l">{humanize(k)}</div>
          </div>
        ))}
      </div>
      <Facts
        items={[
          [
            "Critical path",
            cp.requirements.length === 0
              ? cp.note
              : `${cp.requirements.map(reqName).join(" → ")} · ${cp.known_duration_days} days known`,
          ],
          ["Unknown durations on the path", cp.unknown_durations_on_path.map(reqName).join(", ") || "None"],
        ]}
      />
      {res.summary.unassigned_determinations.length > 0 && (
        <div className="note small qc-warn" style={{ marginTop: 8 }}>
          Nobody holds the role for:{" "}
          {res.summary.unassigned_determinations.map((d) => `${d.determination} (${roleLabel(d.role)})`).join(", ")}
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Outcome</th>
              <th>What is missing</th>
            </tr>
          </thead>
          <tbody>
            {res.items.map((i) => {
              const dets = i.determinations ?? [];
              const unassigned = dets.filter((d) => d.assigned_to.length === 0);
              const assignees = [...new Set(dets.flatMap((d) => d.assigned_to))];
              return (
                <tr key={i.requirement_id}>
                  <td>
                    {i.name}
                    {i.driver && <div className="muted small">{driverLabel(i.requirement_id, i.driver)}</div>}
                  </td>
                  <td className="nowrap">
                    <Pill tone={OUTCOME_TONE[i.outcome ?? ""] ?? "neutral"}>{humanize(i.outcome ?? "")}</Pill>
                    {i.qc && <div className="small">QC {statusLabel(i.qc)}</div>}
                    {i.duration_days !== undefined && i.duration_days !== null && (
                      <div className="small muted">{i.duration_days} days</div>
                    )}
                  </td>
                  <td className="small">
                    <Brief label="Design parameters" items={(i.missing_parameters ?? []).map(paramLabel)} />
                    <Brief label="Analysis inputs" items={(i.missing_inputs ?? []).map(humanize)} />
                    {i.unavailable_results && i.unavailable_results.length > 0 && (
                      <div>{i.unavailable_results.length} result(s) unavailable</div>
                    )}
                    {dets.length > 0 && unassigned.length === 0 && (
                      <div className="muted">
                        {dets.length} determination{dets.length === 1 ? "" : "s"} by {assignees.join(", ")}
                      </div>
                    )}
                    {unassigned.map((d) => (
                      <div key={d.label}>
                        {d.label}: <span className="qc-warn">no {roleLabel(d.role)}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
