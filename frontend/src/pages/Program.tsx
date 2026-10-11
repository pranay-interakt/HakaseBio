import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Citations, ErrorBox, Section, StateTag } from "../components/common";
import { QuantityView } from "../components/QuantityView";
import { SequenceEntityView, SequenceRegistration } from "../components/SequenceEntity";
import { RehearsalView, WhatIf } from "./ProgramPlanning";
import type {
  Compound,
  Principal,
  Program as ProgramT,
  ProgramDetermination,
  Readiness,
  Requirement,
  Study,
} from "../types";

type Tab = "studyset" | "compounds" | "studies" | "readiness" | "module4" | "whatif" | "rehearsal";

const TIMING_ORDER = [
  "before_first_in_human",
  "before_multiple_dose_trials",
  "before_phase_2",
  "before_inclusion_of_wocbp",
  "before_phase_3",
  "marketing_application",
];

export function Program({ id, go, me }: { id: string; go: (hash: string) => void; me: Principal }) {
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
            ["whatif", "What-if"],
            ["rehearsal", "Rehearsal"],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={err} />
      {tab === "studyset" && p.context.modality === "peptide" && (
        <PeptideRouting p={p} me={me} reload={load} onErr={setErr} />
      )}
      {tab === "studyset" && <StudySet p={p} go={go} onErr={setErr} />}
      {tab === "compounds" && <Compounds p={p} reload={load} onErr={setErr} />}
      {tab === "studies" && <Studies p={p} />}
      {tab === "readiness" && <ReadinessView id={id} />}
      {tab === "module4" && <Module4 id={id} />}
      {tab === "whatif" && <WhatIf p={p} />}
      {tab === "rehearsal" && <RehearsalView p={p} />}
    </div>
  );
}

const ORIGINS: [string, string][] = [
  ["", "unknown"],
  ["chemical_synthesis", "chemical synthesis"],
  ["recombinant", "recombinant expression"],
];

/** Peptide facts and their consequences: US classification (21 CFR 600.3(h)(6)) and ICH routing
 * by origin (S6(R1) section 1.3), with the responsible scientist's signed S6(R1) determination. */
function PeptideRouting({ p, me, reload, onErr }: {
  p: ProgramT; me: Principal; reload: () => void; onErr: (e: unknown) => void;
}) {
  const ctx = p.context as {
    peptide_origin?: string | null;
    amino_acid_chains?: number[];
    chains_naturally_associated?: boolean | null;
    s6_determination?: ProgramDetermination | null;
  };
  const cls = p.study_set.classification;
  const [origin, setOrigin] = useState(ctx.peptide_origin ?? "");
  const [chains, setChains] = useState((ctx.amino_acid_chains ?? []).join(", "));
  const [assoc, setAssoc] = useState(
    ctx.chains_naturally_associated === null || ctx.chains_naturally_associated === undefined
      ? ""
      : String(ctx.chains_naturally_associated),
  );
  const [reason, setReason] = useState("");
  const [applies, setApplies] = useState("");
  const [rationale, setRationale] = useState("");
  const [pw, setPw] = useState("");
  const det = ctx.s6_determination;
  const parsed = chains.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  async function save() {
    try {
      await api.patch(`/programs/${p.id}/context`, {
        changes: {
          peptide_origin: origin || null,
          amino_acid_chains: parsed,
          chains_naturally_associated: assoc === "" ? null : assoc === "true",
        },
        reason,
      });
      setReason("");
      reload();
    } catch (e) {
      onErr(e);
    }
  }
  async function sign() {
    try {
      await api.post(`/programs/${p.id}/determinations`, {
        key: "s6_principles_apply",
        applies: applies === "true",
        rationale,
        password: pw,
      });
      setPw("");
      reload();
    } catch (e) {
      onErr(e);
    }
  }
  return (
    <Section title="Peptide classification and guideline routing">
      {cls && (
        <div className="small">
          <span className={`tag tag-${cls.outcome === "pending" ? "conditional" : "done"}`}>
            {cls.outcome === "protein" ? "US: protein (biological product)" : cls.outcome === "not_protein" ? "US: not a protein" : "US classification pending"}
          </span>{" "}
          {cls.statement}
          <Citations list={cls.citations} />
        </div>
      )}
      <h4>ICH S6(R1) applicability</h4>
      <div className="small">
        {ctx.peptide_origin === "recombinant" && "Recombinant expression: within ICH S6(R1) (section 1.3); the S6(R1) study set applies."}
        {!ctx.peptide_origin && "Origin unknown: the governing guideline depends on it, so required studies are conditional."}
        {ctx.peptide_origin === "chemical_synthesis" &&
          (det ? (
            <>
              Signed by {det.signature.signer_name} ({det.signature.role}) on {det.signature.signed_at.slice(0, 10)}: S6(R1)
              principles <strong>{det.applies ? "apply" : "do not apply"}</strong>. “{det.rationale}”
            </>
          ) : (
            <>
              Chemically synthesised: ICH M3(R2) governs, and S6(R1) principles &ldquo;may also be applicable&rdquo; (S6(R1)
              section 1.3). The species-relevance and anti-drug-antibody items stay conditional until the responsible
              scientist signs whether they apply.
            </>
          ))}
      </div>
      {ctx.peptide_origin === "chemical_synthesis" && !det && me.kind === "human" && me.roles.includes("responsible_scientist") && (
        <div className="grid2">
          <select value={applies} onChange={(e) => setApplies(e.target.value)}>
            <option value="">S6(R1) principles…</option>
            <option value="true">apply</option>
            <option value="false">do not apply</option>
          </select>
          <input placeholder="rationale (the evidence for the judgement) *" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <input type="password" placeholder="password (re-authentication) *" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button disabled={!applies || !rationale.trim() || !pw} onClick={sign}>
            Sign determination
          </button>
        </div>
      )}
      <details>
        <summary className="small">Update peptide facts</summary>
        <div className="grid2">
          <label className="field">
            <span className="field-label">Manufacturing origin (ICH S6(R1) 1.3)</span>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {ORIGINS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Amino acids per chain (21 CFR 600.3(h)(6))</span>
            <input placeholder="e.g. 31, or 21, 30" value={chains} onChange={(e) => setChains(e.target.value)} />
          </label>
          {parsed.length > 1 && (
            <label className="field">
              <span className="field-label">Chains associated as they occur in nature</span>
              <select value={assoc} onChange={(e) => setAssoc(e.target.value)}>
                <option value="">unknown</option>
                <option value="true">yes</option>
                <option value="false">no</option>
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Reason for the change *</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <button disabled={!reason.trim()} onClick={save}>
          Save peptide facts
        </button>
      </details>
    </Section>
  );
}

function StudySet({ p, go, onErr }: { p: ProgramT; go: (h: string) => void; onErr: (e: unknown) => void }) {
  const [compound, setCompound] = useState(p.compounds[0]?.id ?? "");
  const reqs = [...p.study_set.requirements].sort(
    (a, b) => TIMING_ORDER.indexOf(a.timing) - TIMING_ORDER.indexOf(b.timing),
  );
  async function start(r: Requirement, driverId: string) {
    try {
      const s = await api.post<Study>("/studies", {
        program_id: p.id,
        compound_id: compound,
        requirement_id: r.id,
        driver_id: driverId,
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
                  {r.status !== "not_required" &&
                    compound &&
                    (p.drivers?.[r.id] ?? []).map((d) => (
                      <button key={d.id} onClick={() => start(r, d.id)} title={d.name}>
                        Start study{(p.drivers[r.id] ?? []).length > 1 || d.components.length > 0
                          ? `: ${d.components.length ? d.components.join(", ") : d.name}`
                          : ""}
                      </button>
                    ))}
                  {r.components.length > 0 && <div className="muted small">parts: {r.components.join(", ")}</div>}
                  {(p.drivers?.[r.id] ?? []).length === 0 && r.status !== "not_required" && (
                    <div className="muted small">no driver</div>
                  )}
                  {r.status !== "not_required" && compound && (
                    <button onClick={() => go(`#/import/${p.id}/${r.id}`)}>Import report</button>
                  )}
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
  const aminoAcid = ["peptide", "monoclonal_antibody", "recombinant_protein"].includes(String(p.context.modality));
  return (
    <>
      {aminoAcid && <SequenceRegistration p={p} reload={reload} onErr={onErr} />}
      <Section title={aminoAcid ? "Register by structure (SMILES)" : "Register compound"}>
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
      {p.compounds.map((c) => c.kind === "sequence" && c.entity ? (
        <SequenceEntityView key={c.id} c={c} p={p} reload={reload} onErr={onErr} />
      ) : (
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
            <div className="stat-v">{s.imported}</div>
            <div className="stat-l">imported from reports</div>
          </div>
          <div className="stat">
            <div className="stat-v">{s.percent_covered ?? "—"}%</div>
            <div className="stat-l">covered (done + imported)</div>
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
                  {i.components && (
                    <div className="small">
                      {i.components.done.length > 0 && <div>done: {i.components.done.join(", ")}</div>}
                      {i.components.imported.length > 0 && <div>imported: {i.components.imported.join(", ")}</div>}
                      {i.components.missing.length > 0 && <div>missing: {i.components.missing.join(", ")}</div>}
                    </div>
                  )}
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

interface VerifyResult {
  passed: boolean;
  counts: { pass: number; warn: number; fail: number };
  checks: { subject: string; check: string; status: string; detail: string }[];
}

function Module4({ id }: { id: string }) {
  const [pkg, setPkg] = useState<Module4Pkg | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
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
            <button onClick={() => api.download(`/files/${pkg.bundle_sha256}`, "module4.zip")}>Download zip</button>{" "}
            <button onClick={() => api.get<VerifyResult>(`/files/${pkg.bundle_sha256}/verify`).then(setVerify).catch(setErr)}>
              Verify bundle (recompute every figure)
            </button>
          </p>
          <p className="muted small">
            Anyone can verify this export offline with <code>hos-verify module4.zip</code>: it re-runs every driver from the raw
            files and checks every hash, signature and the ledger chain.
          </p>
          {verify && (
            <div className={verify.passed ? "note" : "error"}>
              <strong>{verify.passed ? "VERIFIED" : "VERIFICATION FAILED"}</strong> — {verify.counts.pass} passed,{" "}
              {verify.counts.warn} warnings, {verify.counts.fail} failed
              <ul className="small">
                {verify.checks.map((c, i) => (
                  <li key={i} className={c.status === "fail" ? "qc-fail" : c.status === "warn" ? "qc-warn" : ""}>
                    [{c.status}] {c.subject}: {c.check}
                    {c.detail && ` — ${c.detail}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
