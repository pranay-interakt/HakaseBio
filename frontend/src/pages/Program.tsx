import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Citations, ErrorBox, Section, StateTag } from "../components/common";
import { QuantityView } from "../components/QuantityView";
import type { Compound, Program as ProgramT, Readiness, Requirement, Study } from "../types";

type Tab = "studyset" | "compounds" | "studies" | "readiness" | "module4";

const TIMING_ORDER = [
  "before_first_in_human",
  "before_multiple_dose_trials",
  "before_phase_2",
  "before_inclusion_of_wocbp",
  "before_phase_3",
  "marketing_application",
];

export function Program({ id, go }: { id: string; go: (hash: string) => void }) {
  const [p, setP] = useState<ProgramT | null>(null);
  const [tab, setTab] = useState<Tab>("studyset");
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => api.get<ProgramT>(`/programs/${id}`).then(setP).catch(setErr), [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (!p) return <ErrorBox error={err} />;
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Programmes</a> / {p.name}
      </div>
      <h2>{p.name}</h2>
      <div className="muted small">
        {String(p.context.modality)} · {String(p.context.indication)} · {String(p.context.route)} · trial{" "}
        {String(p.context.max_trial_duration_days)} d · intended use {String(p.context.intended_clinical_duration_days)} d
      </div>
      <div className="tabs">
        {(
          [
            ["studyset", `Study set (${p.study_set.summary.required} required)`],
            ["compounds", `Compounds (${p.compounds.length})`],
            ["studies", `Studies (${p.studies.length})`],
            ["readiness", "IND readiness"],
            ["module4", "Module 4"],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={err} />
      {tab === "studyset" && <StudySet p={p} go={go} onErr={setErr} />}
      {tab === "compounds" && <Compounds p={p} reload={load} onErr={setErr} />}
      {tab === "studies" && <Studies p={p} />}
      {tab === "readiness" && <ReadinessView id={id} />}
      {tab === "module4" && <Module4 id={id} />}
    </div>
  );
}

function StudySet({ p, go, onErr }: { p: ProgramT; go: (h: string) => void; onErr: (e: unknown) => void }) {
  const [compound, setCompound] = useState(p.compounds[0]?.id ?? "");
  const reqs = [...p.study_set.requirements].sort(
    (a, b) => TIMING_ORDER.indexOf(a.timing) - TIMING_ORDER.indexOf(b.timing),
  );
  async function start(r: Requirement) {
    try {
      const s = await api.post<Study>("/studies", {
        program_id: p.id,
        compound_id: compound,
        requirement_id: r.id,
      });
      go(`#/study/${s.id}`);
    } catch (e) {
      onErr(e);
    }
  }
  return (
    <>
      {p.study_set.notes.length > 0 && (
        <div className="note">
          {p.study_set.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}
      <Section
        title="Derived nonclinical study set"
        right={
          p.compounds.length > 0 ? (
            <label className="small">
              Compound{" "}
              <select value={compound} onChange={(e) => setCompound(e.target.value)}>
                {p.compounds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="muted small">register a compound to start studies</span>
          )
        }
      >
        <table>
          <thead>
            <tr>
              <th>Study</th>
              <th>Status</th>
              <th>Due</th>
              <th>GLP</th>
              <th>Basis</th>
              <th>CTD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.id} className={r.status === "not_required" ? "dim" : ""}>
                <td>
                  <strong>{r.name}</strong>
                  {r.species.length > 0 && <div className="muted small">species: {r.species.join(", ")}</div>}
                  {r.duration_weeks && <div className="muted small">{r.duration_weeks} weeks</div>}
                  <div className="muted small">{r.rationale}</div>
                </td>
                <td>
                  <span className={`tag tag-${r.status}`}>{r.status.replace("_", " ")}</span>
                  {r.pending_fact && <div className="small">pending: {r.pending_fact}</div>}
                </td>
                <td className="small">{r.timing.replace(/_/g, " ")}</td>
                <td>{r.glp ? "yes" : "no"}</td>
                <td className="small" title={r.citation.text}>
                  {r.section}
                </td>
                <td className="small">{r.ctd_section ?? "—"}</td>
                <td>
                  {r.driver_id && r.status !== "not_required" && compound && (
                    <button onClick={() => start(r)}>Start study</button>
                  )}
                  {!r.driver_id && r.status !== "not_required" && <span className="muted small">no driver</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Governing guidelines">
        <Citations list={p.study_set.governing_guidelines} />
      </Section>
    </>
  );
}

function Compounds({ p, reload, onErr }: { p: ProgramT; reload: () => void; onErr: (e: unknown) => void }) {
  const [name, setName] = useState("");
  const [smiles, setSmiles] = useState("");
  const [busy, setBusy] = useState("");
  async function add() {
    try {
      await api.post(`/programs/${p.id}/compounds`, { name, smiles });
      setName("");
      setSmiles("");
      reload();
    } catch (e) {
      onErr(e);
    }
  }
  async function enrich(c: Compound) {
    setBusy(c.id);
    try {
      await api.post(`/compounds/${c.id}/enrich`);
      reload();
    } catch (e) {
      onErr(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Section title="Register compound">
        <div className="grid2">
          <div className="field">
            <label className="field-label">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">SMILES</label>
            <input value={smiles} onChange={(e) => setSmiles(e.target.value)} />
          </div>
        </div>
        <button className="primary" onClick={add}>
          Register (RDKit profile)
        </button>
      </Section>
      {p.compounds.map((c) => (
        <Section
          key={c.id}
          title={c.name}
          right={
            <button onClick={() => enrich(c)} disabled={busy === c.id}>
              {busy === c.id ? "Querying…" : "Look up in PubChem / ChEMBL"}
            </button>
          }
        >
          <div className="small">
            <code>{c.profile.canonical_smiles}</code> · {c.profile.formula} · InChIKey <code>{c.inchikey}</code> · RDKit{" "}
            {c.profile.rdkit_version} · Lipinski {c.profile.lipinski_pass ? "pass" : "fail"} · Veber{" "}
            {c.profile.veber_pass ? "pass" : "fail"}
          </div>
          <table>
            <tbody>
              {Object.entries(c.profile.descriptors).map(([k, q]) => (
                <tr key={k}>
                  <td>{q.label ?? k}</td>
                  <td>
                    <QuantityView q={q} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.entries(c.external).map(([src, r]) => (
            <div key={src} className="external">
              <strong>{src}</strong>: <span className={`tag tag-${r.status}`}>{r.status}</span>{" "}
              {r.from_cache && <span className="muted small">(cached)</span>}{" "}
              <span className="muted small">
                {r.attribution} · {r.license} · retrieved {r.retrieved_at?.slice(0, 10)}
              </span>
              {r.error && <div className="muted small">{r.error}</div>}
              {r.records.slice(0, 1).map((rec, i) => (
                <div key={i} className="small">
                  {Object.entries(rec)
                    .filter(([, v]) => v !== null && typeof v !== "object")
                    .slice(0, 8)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(" · ")}
                </div>
              ))}
              {Object.keys(r.quantities).length > 0 && (
                <div className="qty-list">
                  {Object.values(r.quantities)
                    .slice(0, 30)
                    .map((q) => (
                      <div key={q.id}>
                        <QuantityView q={q} showLabel />
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}

function Studies({ p }: { p: ProgramT }) {
  return (
    <Section title="Studies">
      {p.studies.length === 0 && <p className="muted">No studies yet. Start one from the study set.</p>}
      <table>
        <tbody>
          {p.studies.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={`#/study/${s.id}`}>{s.title}</a>
              </td>
              <td>
                <StateTag state={s.state} simulated={s.simulated} />
              </td>
              <td className="small">{s.requirement_id}</td>
              <td className="small">{s.glp ? "GLP" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ReadinessView({ id }: { id: string }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [milestone, setMilestone] = useState("before_first_in_human");
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    api.get<Readiness>(`/programs/${id}/readiness?milestone=${milestone}`).then(setR).catch(setErr);
  }, [id, milestone]);
  if (!r) return <ErrorBox error={err} />;
  const s = r.summary;
  const due = r.items.filter((i) => i.due_for_milestone);
  return (
    <>
      <Section
        title="Readiness"
        right={
          <select value={milestone} onChange={(e) => setMilestone(e.target.value)}>
            {TIMING_ORDER.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        }
      >
        <div className="stats">
          <div className="stat">
            <div className="stat-v">
              {s.done} / {s.required_for_milestone}
            </div>
            <div className="stat-l">required studies done</div>
          </div>
          <div className="stat">
            <div className="stat-v">{s.percent_done ?? "—"}%</div>
            <div className="stat-l">complete</div>
          </div>
          <div className="stat">
            <div className="stat-v">{s.percent_runnable_in_hos ?? "—"}%</div>
            <div className="stat-l">runnable end-to-end in HOS</div>
          </div>
        </div>
        {s.conditional_pending_facts.length > 0 && (
          <p className="small">Pending facts: {s.conditional_pending_facts.join("; ")}</p>
        )}
        <table>
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Status</th>
              <th>Basis</th>
              <th>Studies</th>
            </tr>
          </thead>
          <tbody>
            {due.map((i) => (
              <tr key={i.requirement_id}>
                <td>
                  {i.name}
                  {!i.driver_available && i.status === "missing" && (
                    <div className="muted small">no installed driver: run outside HOS</div>
                  )}
                </td>
                <td>
                  <span className={`tag tag-${i.status}`}>{i.status.replace(/_/g, " ")}</span>
                  {i.pending_fact && <div className="small">pending: {i.pending_fact}</div>}
                </td>
                <td className="small">{i.section}</td>
                <td className="small">
                  {i.studies.map((st) => (
                    <div key={st.id}>
                      <a href={`#/study/${st.id}`}>{st.state}</a>
                      {st.simulated && <span className="badge badge-simulated"> SIMULATED</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.notes.map((n, i) => (
          <p key={i} className="muted small">
            {n}
          </p>
        ))}
      </Section>
    </>
  );
}

interface Module4Pkg {
  package_hash: string;
  bundle_sha256: string;
  included_studies: number;
  refused_studies: { study_id: string; reason: string }[];
  toc: { section: string; title: string; depth: number; reports: { study_id: string; title: string; report_hash: string; signatures: { role: string; signer: string }[] }[] }[];
  dose_projection: { projection: { derivation: string[] } } | null;
}

function Module4({ id }: { id: string }) {
  const [pkg, setPkg] = useState<Module4Pkg | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function assemble() {
    try {
      setPkg(await api.post<Module4Pkg>(`/programs/${id}/module4`));
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <Section
      title="CTD Module 4 (ICH M4S(R2))"
      right={
        <button className="primary" onClick={assemble}>
          Assemble from approved studies
        </button>
      }
    >
      <ErrorBox error={err} />
      {!pkg && <p className="muted">Only approved studies with admissible (non-simulated) data are included.</p>}
      {pkg && (
        <>
          <p className="small">
            {pkg.included_studies} report(s) · package <code>{pkg.package_hash.slice(0, 16)}</code>{" "}
            <button onClick={() => api.download(`/files/${pkg.bundle_sha256}`, "module4.zip")}>Download zip</button>
          </p>
          {pkg.refused_studies.length > 0 && (
            <div className="error">
              Refused: {pkg.refused_studies.map((r) => `${r.study_id} (${r.reason})`).join(", ")}
            </div>
          )}
          <ul className="toc">
            {pkg.toc.map((t) => (
              <li key={t.section} style={{ marginLeft: `${Math.max(t.depth - 1, 0) * 16}px` }}>
                <strong>{t.section}</strong> {t.title}
                {t.reports.map((r) => (
                  <div key={r.study_id} className="small">
                    ↳ <a href={`#/study/${r.study_id}`}>{r.title}</a> · {r.signatures.map((s) => `${s.role}: ${s.signer}`).join(", ")}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {pkg.dose_projection && (
            <>
              <h4>First-in-human dose projection (FDA 2005, from Study Director NOAELs)</h4>
              <ol className="small">
                {pkg.dose_projection.projection.derivation.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </Section>
  );
}
