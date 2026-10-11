import { useState } from "react";
import { api } from "../api";
import type { Principal, Study, StudySummary } from "../types";
import { roleLabel, Section } from "./common";
import { QuantityView } from "./QuantityView";

type Run = <T>(fn: () => Promise<T>) => Promise<void>;

const MEANINGS = ["approval", "qa_compliance_statement", "review"];

// Workspace for an imported study: report, transcribed values with page references,
// agent proposals awaiting human confirmation, signatures and completion.
export function ImportWorkspace({ s, me, siblings, busy, run }: { s: Study; me: Principal; siblings: StudySummary[]; busy: boolean; run: Run }) {
  const rec = s.import_record!;
  const info = s.import!;
  const draft = s.state === "import_draft";
  const [form, setForm] = useState({ key: info.fields[0]?.key ?? "", label: "", value: "", unit: info.fields[0]?.unit ?? "", category: "", page: "", table: "", species: "", sex: "", kind: "measured", citation_text: "" });
  const field = info.fields.find((f) => f.key === form.key);
  const categorical = field ? field.value_type === "categorical" : form.category !== "" && form.value === "";
  const set = (k: string, v: string) => setForm((o) => ({ ...o, [k]: v }));
  const [ds, setDs] = useState<File | null>(null);
  const [dsDesc, setDsDesc] = useState("");
  const [role, setRole] = useState(me.roles[0] ?? "");
  const [meaning, setMeaning] = useState("approval");
  const [statement, setStatement] = useState("");
  const [pw, setPw] = useState("");
  const [cpw, setCpw] = useState("");
  const [by, setBy] = useState("");
  const [reason, setReason] = useState("");

  function addValue() {
    const body: Record<string, unknown> = { key: form.key, page: form.page, table: form.table || null, species: form.species || null, sex: form.sex || null, label: form.label || null, kind: form.kind };
    if (categorical) body.category = form.category;
    else {
      body.value = form.value === "" ? null : Number(form.value);
      body.unit = form.unit || null;
    }
    if (form.kind === "literature") body.citation_text = form.citation_text;
    run(() => api.post(`/studies/${s.id}/import/values`, body));
  }

  const replacements = siblings.filter((x) => x.id !== s.id && x.origin === "driver" && x.state === "approved" && x.requirement_id === s.requirement_id);

  return (
    <>
      <Section title="Imported report" right={<button onClick={() => api.download(`/studies/${s.id}/import/report`, rec.report.filename)}>Download report</button>}>
        <div className="small">
          <strong>{rec.report.title}</strong> · {rec.report.laboratory} · {rec.report.report_date}
          {rec.report.lab_study_number && <> · lab study {rec.report.lab_study_number}</>} · {s.glp ? "GLP" : "non-GLP"} · CTD {rec.ctd_section}
        </div>
        <div className="small muted">
          {rec.report.filename} · SHA-256 <code>{rec.report.sha256.slice(0, 16)}</code> · requirement {rec.requirement.name} ({rec.requirement.section})
        </div>
        {rec.superseded_by && (
          <div className="note small">
            Superseded by driver-run study <a href={`#/study/${rec.superseded_by.study_id}`}>{rec.superseded_by.study_id}</a>: {rec.superseded_by.reason}
          </div>
        )}
        {rec.datasets.length > 0 && (
          <ul className="small">
            {rec.datasets.map((d) => (
              <li key={d.sha256}>
                {d.filename} — {d.description} <code>{d.sha256.slice(0, 12)}</code>
              </li>
            ))}
          </ul>
        )}
        {draft && (
          <div className="upload">
            <input type="file" onChange={(e) => setDs(e.target.files?.[0] ?? null)} />
            <input placeholder="dataset description" value={dsDesc} onChange={(e) => setDsDesc(e.target.value)} />
            <button disabled={busy || !ds} onClick={() => ds && run(() => api.upload(`/studies/${s.id}/import/datasets?filename=${encodeURIComponent(ds.name)}&description=${encodeURIComponent(dsDesc)}`, ds))}>
              Attach dataset
            </button>
          </div>
        )}
      </Section>

      <Section title="Transcribed results (attested from report, not recomputed)">
        {info.missing.length > 0 && <p className="small qc-warn">Still to transcribe: {info.missing.join(", ")}</p>}
        <table>
          <thead>
            <tr>
              <th>Result</th>
              <th>Species / sex</th>
              <th>Value</th>
              <th>Where in report</th>
              <th>Entered by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rec.values.map((v) => (
              <tr key={v.id} className={v.withdrawn ? "dim" : ""}>
                <td>
                  {v.label}
                  {v.origin.startsWith("proposal:") && <div className="muted small">confirmed agent proposal</div>}
                  {v.withdrawn && <div className="small qc-fail">withdrawn: {v.withdrawn.reason}</div>}
                </td>
                <td className="small">
                  {v.species ?? ""} {v.sex ?? ""}
                </td>
                <td>{v.quantity ? <QuantityView q={v.quantity} /> : <span className="tag">{v.category}</span>}</td>
                <td className="small">
                  p. {v.page}
                  {v.table && `, table ${v.table}`}
                </td>
                <td className="small">{v.entered_by_name}</td>
                <td>
                  {draft && !v.withdrawn && (
                    <button
                      onClick={() => {
                        const r = window.prompt("Reason for withdrawing this value");
                        if (r) run(() => api.post(`/studies/${s.id}/import/values/${v.id}/withdraw`, { reason: r }));
                      }}
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft && me.kind === "human" && (
          <div className="card">
            <h4>Transcribe a result</h4>
            <div className="grid2">
              <div className="field">
                <label className="field-label">Result *</label>
                <select value={field ? form.key : "__other"} onChange={(e) => {
                  const f = info.fields.find((x) => x.key === e.target.value);
                  setForm((o) => ({ ...o, key: f ? f.key : "", unit: f?.unit ?? "", category: "" }));
                }}>
                  {info.fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                  <option value="__other">other result…</option>
                </select>
              </div>
              {!field && (
                <>
                  <div className="field">
                    <label className="field-label">Key (identifier) *</label>
                    <input value={form.key} onChange={(e) => set("key", e.target.value)} placeholder="e.g. fu_plasma_human" />
                  </div>
                  <div className="field">
                    <label className="field-label">Label *</label>
                    <input value={form.label} onChange={(e) => set("label", e.target.value)} />
                  </div>
                </>
              )}
              {categorical ? (
                <div className="field">
                  <label className="field-label">Category *</label>
                  {field?.choices.length ? (
                    <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                      <option value="">—</option>
                      {field.choices.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={form.category} onChange={(e) => set("category", e.target.value)} />
                  )}
                </div>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label">Value as reported *</label>
                    <input type="number" step="any" value={form.value} onChange={(e) => set("value", e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Unit as reported *</label>
                    <input value={form.unit} onChange={(e) => set("unit", e.target.value)} />
                  </div>
                </>
              )}
              <div className="field">
                <label className="field-label">Report page *</label>
                <input value={form.page} onChange={(e) => set("page", e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Table</label>
                <input value={form.table} onChange={(e) => set("table", e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Species{field?.needs_species ? " *" : ""}</label>
                <input value={form.species} onChange={(e) => set("species", e.target.value)} placeholder="e.g. rat" />
              </div>
              <div className="field">
                <label className="field-label">Sex</label>
                <select value={form.sex} onChange={(e) => set("sex", e.target.value)}>
                  <option value="">—</option>
                  <option>M</option>
                  <option>F</option>
                  <option>combined</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Source</label>
                <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                  <option value="measured">study report (measured)</option>
                  <option value="literature">published work (literature)</option>
                </select>
              </div>
              {form.kind === "literature" && (
                <div className="field">
                  <label className="field-label">Full citation *</label>
                  <input value={form.citation_text} onChange={(e) => set("citation_text", e.target.value)} />
                </div>
              )}
            </div>
            {field?.note && <p className="muted small">{field.note}</p>}
            <button className="primary" disabled={busy} onClick={addValue}>
              Add transcribed value
            </button>
          </div>
        )}
      </Section>

      {rec.proposals.length > 0 && (
        <Section title="Values proposed by an agent (not values until a person confirms them)">
          <table>
            <tbody>
              {rec.proposals.map((pr) => (
                <tr key={pr.id} className={pr.status !== "proposed" ? "dim" : ""}>
                  <td>
                    {pr.label ?? pr.key}: {pr.value !== null ? `${pr.value} ${pr.unit ?? ""}` : pr.category} {pr.species ?? ""}
                    {pr.excerpt && <div className="muted small">“{pr.excerpt}”</div>}
                  </td>
                  <td className="small">p. {pr.page}</td>
                  <td className="small">{pr.proposed_by} ({pr.proposed_by_kind})</td>
                  <td>
                    <span className="tag">{pr.status}</span>
                  </td>
                  <td>
                    {draft && pr.status === "proposed" && me.kind === "human" && (
                      <div className="row">
                        <button onClick={() => run(() => api.post(`/studies/${s.id}/import/proposals/${pr.id}/confirm`, {}))}>Confirm</button>
                        <button
                          onClick={() => {
                            const r = window.prompt("Reason for rejecting");
                            if (r) run(() => api.post(`/studies/${s.id}/import/proposals/${pr.id}/reject`, { reason: r }));
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Attestation">
        <p className="small muted">{info.attestation_sentence.replace("{filename}", rec.report.filename).replace("{sha}", rec.report.sha256.slice(0, 16) + "…")}</p>
        <ul className="small">
          {s.signatures.filter((g) => g.subject_hash === info.import_hash).map((g, i) => (
            <li key={i}>
              {g.signer_name} — {roleLabel(g.role)} ({g.meaning.replace(/_/g, " ")}), {g.signed_at.slice(0, 19)}Z
            </li>
          ))}
        </ul>
        {draft && info.signatures_missing.length > 0 && <p className="small">Signatures still required: {info.signatures_missing.join("; ")}</p>}
        {draft && me.kind === "human" && (
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
              <input placeholder="additional statement" value={statement} onChange={(e) => setStatement(e.target.value)} />
              <input type="password" placeholder="password (re-authentication) *" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <button disabled={busy || info.missing.length > 0} onClick={() => run(() => api.post(`/studies/${s.id}/import/sign`, { role, meaning, statement, password: pw }))}>
              Sign import
            </button>
            {info.signatures_missing.length === 0 && info.missing.length === 0 && (
              <div className="row">
                <input type="password" placeholder="password *" value={cpw} onChange={(e) => setCpw(e.target.value)} />
                <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/studies/${s.id}/import/complete`, { password: cpw }))}>
                  Complete import
                </button>
              </div>
            )}
          </>
        )}
        {s.state === "imported" && replacements.length > 0 && (
          <div className="card">
            <h4>Supersede with a driver-run study</h4>
            <div className="grid2">
              <select value={by} onChange={(e) => setBy(e.target.value)}>
                <option value="">—</option>
                {replacements.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
              <input placeholder="reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button disabled={busy || !by} onClick={() => run(() => api.post(`/studies/${s.id}/import/supersede`, { by_study_id: by, reason }))}>
              Supersede import
            </button>
          </div>
        )}
      </Section>
    </>
  );
}
