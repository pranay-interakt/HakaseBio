import { useState } from "react";
import { api } from "../api";
import { ErrorBox, Section } from "../components/common";
import type { Program } from "../types";

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

const show = (v: unknown) => (v === null || v === undefined ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

// What-if: edit the programme facts and see exactly which studies change, with the guideline basis.
export function WhatIf({ p }: { p: Program }) {
  const [text, setText] = useState(JSON.stringify(p.context, null, 2));
  const [res, setRes] = useState<{ changes: Change[]; summary: Record<string, number>; context_changes: Record<string, { before: unknown; after: unknown }> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function compare() {
    try {
      const next = JSON.parse(text) as Record<string, unknown>;
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(p.context[k])) changes[k] = v;
      setRes(await api.post(`/programs/${p.id}/what-if`, { changes }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof SyntaxError ? new Error(`Not valid JSON: ${e.message}`) : e);
    }
  }
  return (
    <Section title="What-if: how does the study set change?">
      <p className="muted small">
        Edit the programme facts below (nothing is saved) and compare. Every change comes from the cited rules: longer trials lengthen
        repeat-dose studies (ICH M3(R2) Table 1), new populations re-time reproductive studies, an advanced-cancer indication switches to ICH S9.
      </p>
      <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="primary" onClick={compare}>
        Compare with current programme
      </button>
      <ErrorBox error={err} />
      {res && (
        <>
          <p className="small">
            {res.changes.length === 0 ? "No change to the study set." : Object.entries(res.summary).map(([k, n]) => `${n} ${k}`).join(" · ")}
          </p>
          {res.changes.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Study</th>
                  <th>Change</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {res.changes.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name}</td>
                    <td>
                      <span className={`tag tag-${c.change === "added" ? "missing" : c.change === "removed" ? "not_required" : "in_progress"}`}>{c.change}</span>
                    </td>
                    <td className="small">{show(c.before)}</td>
                    <td className="small">{show(c.after)}</td>
                    <td className="small">
                      {c.section_after ?? c.section_before}
                      <div className="muted">{c.rationale}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}

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
    critical_path: { requirements: string[]; known_duration_days: number; unknown_durations_on_path: string[]; note: string };
  };
}

// Rehearsal: run every runnable study simulated with the parameters you state; nothing is persisted.
export function RehearsalView({ p }: { p: Program }) {
  const runnable = p.study_set.requirements.filter((r) => r.driver_id && r.status === "required");
  const skeleton: Record<string, unknown> = {};
  for (const r of runnable) skeleton[r.id] = { parameters: {}, simulation_parameters: null, seed: null, inputs: {} };
  const [text, setText] = useState(JSON.stringify(skeleton, null, 2));
  const [res, setRes] = useState<Rehearsal | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      setRes(await api.post<Rehearsal>(`/programs/${p.id}/rehearsal`, { plan: JSON.parse(text) }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof SyntaxError ? new Error(`Not valid JSON: ${e.message}`) : e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Programme rehearsal (SIMULATED, nothing saved)">
      <p className="muted small">
        Runs every runnable requirement through its driver with simulated data and reports what would block the real programme. Design
        parameters come from this plan or from studies already designed; simulation parameters and seeds must be stated here. Nothing is
        defaulted.
      </p>
      <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "Rehearsing…" : "Run rehearsal"}
      </button>
      <ErrorBox error={err} />
      {res && (
        <>
          <div className="stats">
            {Object.entries(res.summary.by_outcome).map(([k, n]) => (
              <div className="stat" key={k}>
                <div className="stat-v">{n}</div>
                <div className="stat-l">{k.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
          <p className="small">
            <strong>Critical path:</strong>{" "}
            {res.summary.critical_path.requirements.length === 0
              ? res.summary.critical_path.note
              : `${res.summary.critical_path.requirements.join(" → ")} · known duration ${res.summary.critical_path.known_duration_days} days`}
            {res.summary.critical_path.unknown_durations_on_path.length > 0 &&
              ` · unknown durations: ${res.summary.critical_path.unknown_durations_on_path.join(", ")}`}
          </p>
          {res.summary.unassigned_determinations.length > 0 && (
            <p className="small qc-warn">
              Nobody holds the role for: {res.summary.unassigned_determinations.map((d) => `${d.determination} (${d.role})`).join(", ")}
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Outcome</th>
                <th>Gaps</th>
              </tr>
            </thead>
            <tbody>
              {res.items.map((i) => (
                <tr key={i.requirement_id}>
                  <td>
                    {i.name}
                    {i.driver && <div className="muted small">{i.driver}</div>}
                  </td>
                  <td>
                    <span className="tag">{(i.outcome ?? "").replace(/_/g, " ")}</span>
                    {i.qc && <div className="small">QC {i.qc}</div>}
                    {i.detail && <div className="muted small">{i.detail}</div>}
                  </td>
                  <td className="small">
                    {i.missing_parameters && <div>parameters: {i.missing_parameters.join(", ")}</div>}
                    {i.missing_inputs && i.missing_inputs.length > 0 && <div>inputs: {i.missing_inputs.join(", ")}</div>}
                    {i.unavailable_results && i.unavailable_results.length > 0 && (
                      <div>{i.unavailable_results.length} result(s) unavailable</div>
                    )}
                    {i.determinations?.map((d) => (
                      <div key={d.label}>
                        {d.label}: {d.assigned_to.length ? d.assigned_to.join(", ") : <span className="qc-warn">no {d.role}</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
