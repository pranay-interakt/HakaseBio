import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  Citations,
  DataTable,
  ErrorBox,
  Lifecycle,
  Markdown,
  Section,
  StateTag,
} from "../components/common";
import { ImportWorkspace } from "../components/ImportWorkspace";
import { QuantityView } from "../components/QuantityView";
import { SchemaForm } from "../components/SchemaForm";
import type { Citation, Driver, LedgerEntry, Principal, Study as StudyT, StudySummary } from "../types";

const DESIGNABLE = ["proposed", "designed", "planned", "dispatched"];
const RECEIVABLE = ["dispatched", "data_received", "analyzed"];

export function Study({ id, me }: { id: string; me: Principal }) {
  const [s, setS] = useState<StudyT | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [siblings, setSiblings] = useState<StudySummary[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const st = await api.get<StudyT>(`/studies/${id}`);
      setS(st);
      if (st.origin === "import") setSiblings(await api.get<StudySummary[]>(`/studies?program_id=${st.program_id}`));
      else setDriver(await api.get<Driver>(`/drivers/${st.driver_id}`));
    } catch (e) {
      setErr(e);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setErr(null);
    try {
      const out = await fn();
      if (out && typeof out === "object" && "state" in (out as object)) setS(out as unknown as StudyT);
      else await load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (s && s.origin === "import") {
    return (
      <div className="page">
        <div className="crumbs">
          <a href="#/">Programmes</a> / <a href={`#/program/${s.program_id}`}>programme</a> / imported study
        </div>
        <h2>{s.title}</h2>
        <div className="row">
          <StateTag state={s.state} />
          <span className="muted small">
            imported study · requirement <code>{s.requirement_id}</code> · {s.glp ? "GLP" : "non-GLP"}
          </span>
        </div>
        <Lifecycle state={s.state} />
        <ErrorBox error={err} />
        <ImportWorkspace s={s} me={me} siblings={siblings} busy={busy} run={run} />
        <AuditTrail id={id} key={s.state + s.updated_at} />
        {s.state === "import_draft" && <CancelSection id={id} run={run} />}
      </div>
    );
  }
  if (!s || !driver) return <ErrorBox error={err} />;
  const amending = s.state !== "proposed";
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Programmes</a> / <a href={`#/program/${s.program_id}`}>programme</a> / study
      </div>
      <h2>{s.title}</h2>
      <div className="row">
        <StateTag state={s.state} simulated={s.simulated} />
        <span className="muted small">
          driver <code>{driver.id}@{s.driver_version}</code> · CTD {driver.ctd_section} · {s.glp ? "GLP" : "non-GLP"}
          {s.requirement_id && <> · requirement <code>{s.requirement_id}</code></>}
        </span>
      </div>
      <Lifecycle state={s.state} />
      {s.simulated && (
        <div className="banner-sim">
          This study contains SIMULATED data. It can be analysed and reported for demonstration but can never be
          approved or included in an IND.
        </div>
      )}
      {s.hypothesis && <p className="small">Hypothesis: {s.hypothesis}</p>}
      <ErrorBox error={err} />

      {DESIGNABLE.includes(s.state) && (
        <DesignSection s={s} driver={driver} amending={amending} busy={busy} run={run} />
      )}
      {s.protocol && <ProtocolView protocol={s.protocol} hash={s.protocol_hash} version={s.protocol_version} />}
      {s.state === "designed" && (
        <Section title="Plan">
          <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${id}/plan`))}>
            Plan study
          </button>
        </Section>
      )}
      {s.plan && <PlanView plan={s.plan} />}
      {s.state === "planned" && <DispatchSection s={s} driver={driver} busy={busy} run={run} />}
      {s.execution && <ExecutionView s={s} busy={busy} run={run} />}
      {s.expected_inputs && Object.keys(s.expected_inputs).length > 0 &&
        !["reported", "approved", "cancelled", "failed"].includes(s.state) && (
          <InputsSection s={s} busy={busy} run={run} />
        )}
      {(s.state === "data_received" || s.state === "analyzed" || s.state === "reported") && (
        <AnalyzeSection s={s} busy={busy} run={run} />
      )}
      {s.results && <ResultsView s={s} />}
      {s.expert_determinations && s.expert_determinations.length > 0 && s.results && (
        <DeterminationsSection s={s} me={me} busy={busy} run={run} />
      )}
      {s.state === "analyzed" && (
        <Section title="Report">
          <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${id}/report`))}>
            Generate report
          </button>
        </Section>
      )}
      {s.report && <ReportSection s={s} me={me} busy={busy} run={run} />}
      <AuditTrail id={id} key={s.state + s.updated_at} />
      {!["approved", "cancelled", "failed"].includes(s.state) && <CancelSection id={id} run={run} />}
    </div>
  );
}

type Run = <T>(fn: () => Promise<T>) => Promise<void>;

function DesignSection({ s, driver, amending, busy, run }: { s: StudyT; driver: Driver; amending: boolean; busy: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  return (
    <Section title={amending ? "Amend design" : "Design"}>
      <p className="muted small">
        Parameters come from the driver's schema. Scientific design values and acceptance criteria have no defaults:
        state them and their basis. Pre-filled values come from the regulatory requirement.
      </p>
      {amending && (
        <div className="field">
          <label className="field-label">Reason for amendment *</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <SchemaForm
        key={s.protocol_hash ?? "new"}
        schema={driver.parameters_schema}
        initial={s.parameters}
        busy={busy}
        submitLabel={amending ? "Amend protocol" : "Design protocol"}
        onSubmit={(parameters) =>
          run(() => api.post(`/studies/${s.id}/design`, { parameters, reason: amending ? reason : null }))
        }
      />
    </Section>
  );
}

function ProtocolView({ protocol, hash, version }: { protocol: Record<string, unknown>; hash: string | null; version: number }) {
  const [open, setOpen] = useState(false);
  const p = protocol as {
    title: string;
    objective: string;
    design: Record<string, unknown>;
    steps: { number: number; title: string; instruction: string }[];
    acceptance_criteria: { code: string; description: string; basis: string }[];
    references: Citation[];
    regulatory_basis: string[];
  };
  return (
    <Section
      title={`Protocol v${version}`}
      right={
        <button onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} protocol</button>
      }
    >
      <div className="small">
        <strong>{p.title}</strong> · hash <code>{hash?.slice(0, 16)}</code>
      </div>
      {open && (
        <div>
          <p>{p.objective}</p>
          <table>
            <tbody>
              {Object.entries(p.design).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="small">{typeof v === "object" ? <pre>{JSON.stringify(v, null, 2)}</pre> : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Procedure</h4>
          <ol>
            {p.steps.map((st) => (
              <li key={st.number}>
                <strong>{st.title}.</strong> {st.instruction}
              </li>
            ))}
          </ol>
          <h4>Acceptance criteria</h4>
          <ul>
            {p.acceptance_criteria.map((a) => (
              <li key={a.code}>
                {a.description} <span className="muted small">(basis: {a.basis})</span>
              </li>
            ))}
          </ul>
          <h4>Regulatory basis</h4>
          <ul className="small">
            {p.regulatory_basis.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Citations list={p.references} />
        </div>
      )}
    </Section>
  );
}

function PlanView({ plan }: { plan: Record<string, unknown> }) {
  return (
    <Section title="Plan">
      <div className="small">
        Duration: {plan.execution_duration_days === null ? "set by the laboratory" : `${plan.execution_duration_days} days`}{" "}
        ({String(plan.duration_basis)}) · {String(plan.sample_count)} samples/animals ({String(plan.sample_count_basis)})
      </div>
      <div className="small muted">Cost: {String(plan.cost_note)}</div>
      <div className="small">Dependencies: {(plan.dependencies as string[]).join("; ")}</div>
    </Section>
  );
}

function DispatchSection({ s, driver, busy, run }: { s: StudyT; driver: Driver; busy: boolean; run: Run }) {
  const [kind, setKind] = useState("external_lab");
  const [lab, setLab] = useState("");
  const [contact, setContact] = useState("");
  const [quote, setQuote] = useState("");
  const [glp, setGlp] = useState(false);
  const [scientist, setScientist] = useState("");
  const [simJson, setSimJson] = useState("");
  const [seed, setSeed] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function dispatch() {
    let target: Record<string, unknown>;
    if (kind === "external_lab") target = { kind, laboratory: lab, contact: contact || null, quote_reference: quote || null, glp_certified: glp };
    else if (kind === "in_house") target = { kind, laboratory: lab, responsible_scientist: scientist };
    else {
      try {
        target = { kind, simulation_parameters: JSON.parse(simJson), seed: Number(seed) };
      } catch (e) {
        setErr(`Simulation parameters are not valid JSON: ${(e as Error).message}`);
        return;
      }
    }
    setErr(null);
    run(() => api.post(`/studies/${s.id}/dispatch`, { target }));
  }
  return (
    <Section title="Dispatch">
      <div className="checks">
        {["external_lab", "in_house", ...(driver.can_simulate ? ["simulation"] : [])].map((k) => (
          <label key={k}>
            <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {k.replace("_", " ")}
          </label>
        ))}
      </div>
      {kind !== "simulation" && (
        <div className="grid2">
          <div className="field">
            <label className="field-label">Laboratory *</label>
            <input value={lab} onChange={(e) => setLab(e.target.value)} />
          </div>
          {kind === "external_lab" ? (
            <>
              <div className="field">
                <label className="field-label">Contact</label>
                <input value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Laboratory quote reference</label>
                <input value={quote} onChange={(e) => setQuote(e.target.value)} />
              </div>
              <label className="small">
                <input type="checkbox" checked={glp} onChange={(e) => setGlp(e.target.checked)} /> GLP-certified facility
              </label>
            </>
          ) : (
            <div className="field">
              <label className="field-label">Responsible scientist *</label>
              <input value={scientist} onChange={(e) => setScientist(e.target.value)} />
            </div>
          )}
        </div>
      )}
      {kind === "simulation" && (
        <>
          <div className="banner-sim">
            Simulation generates data from a model you state. It is labelled SIMULATED everywhere and can never be
            approved or used as evidence.
          </div>
          <div className="field">
            <label className="field-label">Generator parameters (JSON per the driver schema) *</label>
            <textarea rows={6} value={simJson} onChange={(e) => setSimJson(e.target.value)} />
            <pre className="small muted">{JSON.stringify(driver.simulation_parameters_schema?.properties ?? {}, null, 1).slice(0, 800)}</pre>
          </div>
          <div className="field">
            <label className="field-label">Seed *</label>
            <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
        </>
      )}
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={busy} onClick={dispatch}>
        Dispatch
      </button>
    </Section>
  );
}

function ExecutionView({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const ex = s.execution as { target: Record<string, unknown>; target_kind: string; bundle_sha256: string; dispatched_at: string; notes: string[] };
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const replacing = s.state !== "dispatched";
  return (
    <Section title="Execution">
      <div className="small">
        {ex.target_kind.replace("_", " ")}: {String(ex.target.laboratory ?? "simulation")} · dispatched{" "}
        {ex.dispatched_at.slice(0, 19)}Z · bundle <code>{ex.bundle_sha256.slice(0, 16)}</code>
      </div>
      {ex.notes.map((n) => (
        <div key={n} className="muted small">
          {n}
        </div>
      ))}
      <div className="row">
        <button onClick={() => api.download(`/studies/${s.id}/bundle`, `${s.id}_dispatch.zip`)}>Download dispatch bundle</button>
        <button onClick={() => api.download(`/studies/${s.id}/template`, `${s.id}_template.csv`)}>Download data template</button>
      </div>
      {RECEIVABLE.includes(s.state) && (
        <div className="upload">
          {ex.target_kind === "simulation" ? (
            <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${s.id}/data/simulated`, { reason: replacing ? reason : null }))}>
              Load simulated data
            </button>
          ) : (
            <>
              <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button
                className="primary"
                disabled={busy || !file}
                onClick={() =>
                  file &&
                  run(() =>
                    api.upload(
                      `/studies/${s.id}/data?filename=${encodeURIComponent(file.name)}${replacing ? `&reason=${encodeURIComponent(reason)}` : ""}`,
                      file,
                    ),
                  )
                }
              >
                Upload returned data
              </button>
            </>
          )}
          {replacing && (
            <input placeholder="reason for replacing data *" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </div>
      )}
      {s.raw_files.length > 0 && (
        <table>
          <tbody>
            {s.raw_files.map((f) => (
              <tr key={f.sha256 + f.received_at}>
                <td>{f.filename}</td>
                <td>
                  <span className={`badge badge-${f.origin}`}>{f.origin}</span>
                </td>
                <td className="small">
                  <code>{f.sha256.slice(0, 16)}</code>
                </td>
                <td className="small">{f.received_at.slice(0, 19)}Z</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function InputsSection({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const names = Object.keys(s.expected_inputs ?? {});
  const [vals, setVals] = useState<Record<string, Record<string, string>>>(() => {
    const o: Record<string, Record<string, string>> = {};
    for (const n of names) {
      const cur = s.analysis_inputs[n] ?? {};
      o[n] = {
        value: cur.value === undefined ? "" : String(cur.value),
        unit: String(cur.unit ?? s.expected_inputs![n]),
        kind: String(cur.kind ?? "measured"),
        source: String(cur.source ?? ""),
      };
    }
    return o;
  });
  function save() {
    const inputs: Record<string, Record<string, unknown>> = {};
    for (const n of names) {
      const v = vals[n];
      if (v.value.trim() === "") continue;
      inputs[n] = { value: Number(v.value), unit: v.unit, kind: v.kind, source: v.source || null };
    }
    run(() => api.put(`/studies/${s.id}/inputs`, { inputs }));
  }
  const upd = (n: string, k: string, v: string) => setVals((o) => ({ ...o, [n]: { ...o[n], [k]: v } }));
  return (
    <Section title="Analysis inputs from outside this study">
      <p className="muted small">
        Values the analysis needs that this study does not measure. Each is recorded with its provenance: measured
        (name the study/assay), literature (name the source) or user-supplied. Missing inputs make the dependent
        results unavailable, never assumed.
      </p>
      <table>
        <thead>
          <tr>
            <th>Input</th>
            <th>Value</th>
            <th>Unit</th>
            <th>Kind</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td>
                <code>{n}</code>
              </td>
              <td>
                <input type="number" step="any" value={vals[n].value} onChange={(e) => upd(n, "value", e.target.value)} />
              </td>
              <td>
                <input value={vals[n].unit} onChange={(e) => upd(n, "unit", e.target.value)} />
              </td>
              <td>
                <select value={vals[n].kind} onChange={(e) => upd(n, "kind", e.target.value)}>
                  <option>measured</option>
                  <option>literature</option>
                  <option>user_supplied</option>
                </select>
              </td>
              <td>
                <input value={vals[n].source} onChange={(e) => upd(n, "source", e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={busy} onClick={save}>
        Save inputs
      </button>
    </Section>
  );
}

function AnalyzeSection({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  const re = s.state !== "data_received";
  return (
    <Section title={re ? "Re-analyse" : "Analyse"}>
      {re && <input placeholder="reason for re-analysis *" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${s.id}/analyze`, { reason: re ? reason : null }))}>
        {re ? "Re-analyse" : "Run analysis"}
      </button>
    </Section>
  );
}

function ResultsView({ s }: { s: StudyT }) {
  const r = s.results!;
  const interp = s.interpretation;
  const qcClass = r.qc.status === "fail" ? "tag-fail" : r.qc.status === "warn" ? "tag-warn" : "tag-pass";
  return (
    <>
      <Section title="Results" right={<span className={`tag ${qcClass}`}>QC {r.qc.status}</span>}>
        {!r.evidence_admissible && <div className="banner-sim">Not admissible as evidence (simulated data).</div>}
        {r.qc.findings.length > 0 && (
          <ul className="small">
            {r.qc.findings.map((f, i) => (
              <li key={i} className={`qc-${f.status}`}>
                [{f.status}] {f.message}
              </li>
            ))}
          </ul>
        )}
        {r.tables.map((t) => (
          <DataTable key={t.title} t={t} />
        ))}
        {r.notes.length > 0 && <div className="muted small">{r.notes.join(" · ")}</div>}
        <div className="small muted">
          analysis hash <code>{r.analysis_hash.slice(0, 16)}</code>
        </div>
      </Section>
      {interp && (
        <Section title="Interpretation (cited rules only)">
          {interp.statements.map((st, i) => (
            <div key={i} className={`statement sev-${st.severity}`}>
              <div>{st.statement}</div>
              <div className="muted small">
                Basis: {st.basis} · {st.citations.map((c) => c.key).join(", ")}
              </div>
            </div>
          ))}
          {interp.requires_expert_judgement.length > 0 && (
            <>
              <h4>Requires expert judgement (not decided by the system)</h4>
              <ul>
                {interp.requires_expert_judgement.map((j) => (
                  <li key={j}>{j}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </>
  );
}

function DeterminationsSection({ s, me, busy, run }: { s: StudyT; me: Principal; busy: boolean; run: Run }) {
  const specs = s.expert_determinations ?? [];
  const current = s.determinations.filter((d) => s.results && d.analysis_hash === s.results.analysis_hash);
  const [form, setForm] = useState<Record<string, { value: string; notEstablished: boolean; rationale: string; password: string; reason: string }>>({});
  const f = (k: string) => form[k] ?? { value: "", notEstablished: false, rationale: "", password: "", reason: "" };
  const upd = (k: string, patch: Partial<ReturnType<typeof f>>) => setForm((o) => ({ ...o, [k]: { ...f(k), ...patch } }));
  return (
    <Section title="Expert determinations (signed by the accountable human)">
      {specs.map((d) => {
        const rec = current.find((x) => x.key === d.key);
        const canSign = me.kind === "human" && me.roles.includes(d.role);
        return (
          <div key={d.key} className="determination">
            <div>
              <strong>{d.label}</strong> {d.required_for_approval && <span className="tag tag-required">required</span>}{" "}
              <span className="muted small">role: {d.role}</span>
            </div>
            <div className="muted small">{d.guidance}</div>
            {rec && (
              <div className="signed">
                <QuantityView q={rec.quantity} /> — {rec.signer_name} ({rec.role}), {rec.signed_at.slice(0, 19)}Z. Rationale:{" "}
                {rec.rationale}
              </div>
            )}
            {s.state === "analyzed" && canSign && (
              <div className="grid2">
                <label className="small">
                  <input type="checkbox" checked={f(d.key).notEstablished} onChange={(e) => upd(d.key, { notEstablished: e.target.checked })} /> not
                  established
                </label>
                {!f(d.key).notEstablished && (
                  <input type="number" step="any" placeholder={`value (${d.unit ?? ""})`} value={f(d.key).value} onChange={(e) => upd(d.key, { value: e.target.value })} />
                )}
                <textarea placeholder="rationale *" value={f(d.key).rationale} onChange={(e) => upd(d.key, { rationale: e.target.value })} />
                {rec && <input placeholder="reason for revision *" value={f(d.key).reason} onChange={(e) => upd(d.key, { reason: e.target.value })} />}
                <input type="password" placeholder="password (re-authentication) *" value={f(d.key).password} onChange={(e) => upd(d.key, { password: e.target.value })} />
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api.post(`/studies/${s.id}/determinations`, {
                        key: d.key,
                        value: f(d.key).notEstablished ? null : Number(f(d.key).value),
                        unit: d.unit,
                        rationale: f(d.key).rationale,
                        password: f(d.key).password,
                        reason: f(d.key).reason || null,
                      }),
                    )
                  }
                >
                  Sign determination
                </button>
              </div>
            )}
            {s.state === "analyzed" && !canSign && !rec && (
              <div className="muted small">Awaiting a {d.role.replace("_", " ")}.</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

const MEANINGS = ["approval", "review", "authorship", "responsibility", "qa_compliance_statement"];

function ReportSection({ s, me, busy, run }: { s: StudyT; me: Principal; busy: boolean; run: Run }) {
  const [role, setRole] = useState(me.roles[0] ?? "");
  const [meaning, setMeaning] = useState("approval");
  const [statement, setStatement] = useState("");
  const [pw, setPw] = useState("");
  const [apw, setApw] = useState("");
  const current = s.signatures.filter((g) => g.subject_hash === s.report_hash);
  return (
    <Section
      title="Report"
      right={
        <button onClick={() => api.download(`/studies/${s.id}/report.md`, `${s.id}_report.md`)}>Download</button>
      }
    >
      <div className="report-box">
        <Markdown text={s.report!.markdown} />
      </div>
      <h4>Signatures on this report</h4>
      {current.length === 0 && <p className="muted small">None.</p>}
      <ul>
        {current.map((g, i) => (
          <li key={i}>
            {g.signer_name} — {g.role} ({g.meaning}), {g.signed_at.slice(0, 19)}Z: “{g.statement}”
          </li>
        ))}
      </ul>
      {s.state === "reported" && me.kind === "human" && (
        <>
          <div className="grid2">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {me.roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <select value={meaning} onChange={(e) => setMeaning(e.target.value)}>
              {MEANINGS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input placeholder="statement of meaning *" value={statement} onChange={(e) => setStatement(e.target.value)} />
            <input type="password" placeholder="password (re-authentication) *" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <button disabled={busy} onClick={() => run(() => api.post(`/studies/${s.id}/sign`, { role, meaning, statement, password: pw }))}>
            Sign report
          </button>
          <h4>Approve</h4>
          {s.approval_missing && s.approval_missing.length > 0 ? (
            <p className="small">Still required: {s.approval_missing.join(", ")}</p>
          ) : (
            <div className="row">
              <input type="password" placeholder="password *" value={apw} onChange={(e) => setApw(e.target.value)} />
              <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${s.id}/approve`, { password: apw }))}>
                Approve study
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function AuditTrail({ id }: { id: string }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) api.get<LedgerEntry[]>(`/ledger/${id}`).then(setEntries).catch(() => setEntries([]));
  }, [id, open]);
  return (
    <Section title="Audit trail" right={<button onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>}>
      {open && (
        <table>
          <tbody>
            {entries.map((e) => (
              <tr key={e.seq}>
                <td className="small">#{e.seq}</td>
                <td className="small">{e.recorded_at.slice(0, 19)}Z</td>
                <td>{e.action}</td>
                <td className="small">
                  {e.actor_id} ({e.actor_kind})
                </td>
                <td className="small">{e.reason ?? ""}</td>
                <td className="small">
                  <code>{e.entry_hash.slice(0, 12)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function CancelSection({ id, run }: { id: string; run: Run }) {
  const [reason, setReason] = useState("");
  return (
    <details className="card">
      <summary>Cancel study</summary>
      <input placeholder="reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button onClick={() => run(() => api.post(`/studies/${id}/cancel`, { reason }))}>Cancel study</button>
    </details>
  );
}
