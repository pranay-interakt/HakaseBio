import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Citations, ErrorBox, roleLabel, Section, StateTag } from "../components/common";
import { QuantityView } from "../components/QuantityView";
import { SequenceEntityView, SequenceRegistration } from "../components/SequenceEntity";
import { Empty, Facts, Loading, PageHeader, Pill, Tabs, toast, useBreadcrumbs, ValueView } from "../components/ui";
import {
  fmtAgo,
  fmtDate,
  fmtDateTime,
  humanize,
  indicationLabel,
  modalityLabel,
  populationLabel,
  routeLabel,
  statusLabel,
  TIMING_ORDER,
  timingLabel,
} from "../lib/format";
import { go, href } from "../lib/router";
import type {
  Compound,
  Principal,
  Program as ProgramT,
  ProgramDetermination,
  Readiness,
  Requirement,
  Study,
  StudySummary,
} from "../types";
import { RehearsalView, WhatIf } from "./ProgramPlanning";
import { ProgramSummaries } from "./ProgramSummaries";

const TABS = ["overview", "studyset", "compounds", "studies", "readiness", "module2", "module4", "whatif", "rehearsal", "access"] as const;
type Tab = (typeof TABS)[number];
const ACTIVE = ["proposed", "designed", "planned", "dispatched", "data_received", "analyzed", "reported", "import_draft"];

export function Program({ id, tab, me }: { id: string; tab: string | null; me: Principal }) {
  const [p, setP] = useState<ProgramT | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const active: Tab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "overview";
  const load = useCallback(() => api.get<ProgramT>(`/programs/${id}`).then(setP).catch(setErr), [id]);
  useEffect(() => {
    load();
  }, [load]);
  const tabLabel: Record<Tab, string> = {
    overview: "Overview",
    studyset: "Study set",
    compounds: "Compounds",
    studies: "Studies",
    readiness: "IND readiness",
    module2: "Module 2",
    module4: "Module 4",
    whatif: "What-if",
    rehearsal: "Rehearsal",
    access: "Access",
  };
  useBreadcrumbs([
    { label: "Programmes", href: href.programs() },
    { label: p?.name ?? "Programme", href: href.program(id) },
    ...(active !== "overview" ? [{ label: tabLabel[active] }] : []),
  ]);
  if (!p) return err ? <ErrorBox error={err} /> : <Loading />;
  const ctx = p.context;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Programme"
        title={p.name}
        meta={
          <>
            <span>{modalityLabel(String(ctx.modality))}</span>
            <span>{indicationLabel(String(ctx.indication))}</span>
            <span>{routeLabel(String(ctx.route))}</span>
            <span>trial dosing {String(ctx.max_trial_duration_days)} d</span>
            {p.sponsor && <span>sponsor {p.sponsor}</span>}
          </>
        }
      />
      <Tabs
        active={active}
        hrefFor={(t) => href.program(id, t === "overview" ? undefined : t)}
        items={[
          { id: "overview", label: "Overview" },
          { id: "studyset", label: "Study set", count: p.study_set.summary.required },
          { id: "compounds", label: "Compounds", count: p.compounds.length },
          { id: "studies", label: "Studies", count: p.studies.length },
          { id: "readiness", label: "IND readiness" },
          { id: "module2", label: "Module 2" },
          { id: "module4", label: "Module 4" },
          { id: "whatif", label: "What-if" },
          { id: "rehearsal", label: "Rehearsal" },
          { id: "access", label: "Access" },
        ]}
      />
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      {active === "overview" && <Overview p={p} />}
      {active === "studyset" && ctx.modality === "peptide" && <PeptideRouting p={p} me={me} reload={load} onErr={setErr} />}
      {active === "studyset" && <StudySet p={p} onErr={setErr} />}
      {active === "compounds" && <Compounds p={p} reload={load} onErr={setErr} />}
      {active === "studies" && <Studies p={p} />}
      {active === "readiness" && <ReadinessView id={id} />}
      {active === "module2" && <ProgramSummaries programId={id} me={me} />}
      {active === "module4" && <Module4 id={id} />}
      {active === "whatif" && <WhatIf p={p} reload={load} />}
      {active === "rehearsal" && <RehearsalView p={p} />}
      {active === "access" && <ProgramAccess id={id} me={me} onErr={setErr} />}
    </div>
  );
}

// ---- overview -------------------------------------------------------------------------------

function Overview({ p }: { p: ProgramT }) {
  const [r, setR] = useState<Readiness | null>(null);
  useEffect(() => {
    api.get<Readiness>(`/programs/${p.id}/readiness?milestone=before_first_in_human`).then(setR).catch(() => setR(null));
  }, [p.id]);
  const ctx = p.context;
  const names = requirementNames(p);
  const active = p.studies.filter((s) => ACTIVE.includes(s.state)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const missing = (r?.items ?? []).filter((i) => i.due_for_milestone && i.status === "missing");
  const s = r?.summary;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-v">{s ? `${s.covered} / ${s.required_for_milestone}` : "…"}</div>
          <div className="stat-l">required before first-in-human, covered</div>
          {s && s.required_for_milestone > 0 && (
            <div className="bar">
              <span style={{ width: `${Math.round((100 * s.covered) / s.required_for_milestone)}%` }} />
            </div>
          )}
        </div>
        <div className="stat">
          <div className="stat-v">{active.length}</div>
          <div className="stat-l">studies in progress</div>
        </div>
        <div className="stat">
          <div className="stat-v">{p.studies.filter((x) => x.state === "approved" || x.state === "imported").length}</div>
          <div className="stat-l">approved or imported</div>
        </div>
        <div className="stat">
          <div className="stat-v">{p.compounds.length}</div>
          <div className="stat-l">compounds</div>
        </div>
      </div>
      <Section title="Programme facts" right={<a href={href.program(p.id, "whatif")}>Change facts…</a>}>
        <Facts
          items={[
            ["Modality", modalityLabel(String(ctx.modality))],
            ["Indication", indicationLabel(String(ctx.indication))],
            ["Clinical route", routeLabel(String(ctx.route))],
            ["Longest trial dosing", `${String(ctx.max_trial_duration_days)} days`],
            ["Intended treatment", `${String(ctx.intended_clinical_duration_days)} days`],
            ["Populations", ((ctx.populations as string[] | undefined) ?? []).map(populationLabel).join(", ")],
            ["Supports marketing", ctx.supports_marketing ? "Yes" : "No"],
            ["Sponsor", p.sponsor],
          ]}
        />
      </Section>
      <Section title="Due before first-in-human, not started" right={<a href={href.program(p.id, "studyset")}>Open study set</a>}>
        {r === null ? (
          <Loading />
        ) : missing.length === 0 ? (
          <Empty title="Nothing outstanding">Every requirement due before first-in-human has a study or an imported report.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Basis</th>
                  <th>GLP</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((i) => (
                  <tr key={i.requirement_id}>
                    <td>
                      {i.name}
                      {!i.driver_available && <div className="muted small">no installed driver: import the report</div>}
                    </td>
                    <td className="small">{i.section}</td>
                    <td>{i.glp ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Studies in progress" right={<a href={href.program(p.id, "studies")}>All studies</a>}>
        {active.length === 0 ? (
          <Empty title="No study in progress">Start one from the study set.</Empty>
        ) : (
          <StudyTable studies={active} names={names} compounds={p.compounds} />
        )}
      </Section>
    </>
  );
}

function requirementNames(p: ProgramT): Record<string, string> {
  return Object.fromEntries(p.study_set.requirements.map((r) => [r.id, r.name]));
}

function StudyTable({ studies, names, compounds }: { studies: StudySummary[]; names: Record<string, string>; compounds: Compound[] }) {
  const cname = Object.fromEntries(compounds.map((c) => [c.id, c.name]));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Study</th>
            <th>Requirement</th>
            <th>Compound</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {studies.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => go(href.study(s.id))}>
              <td>
                <a href={href.study(s.id)} onClick={(e) => e.stopPropagation()}>
                  {s.title}
                </a>
                <div className="muted small">
                  {s.origin === "import" ? "imported report" : "run in Hakase"}
                  {s.glp && " · GLP"}
                </div>
              </td>
              <td className="small">{(s.requirement_id && names[s.requirement_id]) ?? "—"}</td>
              <td className="small">{cname[s.compound_id] ?? "—"}</td>
              <td>
                <StateTag state={s.state} simulated={s.simulated} />
              </td>
              <td className="muted small" title={fmtDateTime(s.updated_at)}>
                {fmtAgo(s.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- peptide routing ------------------------------------------------------------------------

/** Peptide facts and their consequences: US classification (21 CFR 600.3(h)(6)) and ICH routing
 * by origin (S6(R1) section 1.3), with the responsible scientist's signed S6(R1) determination. */
function PeptideRouting({ p, me, reload, onErr }: { p: ProgramT; me: Principal; reload: () => void; onErr: (e: unknown) => void }) {
  const ctx = p.context as {
    peptide_origin?: string | null;
    amino_acid_chains?: number[];
    chains_naturally_associated?: boolean | null;
    s6_determination?: ProgramDetermination | null;
  };
  const cls = p.study_set.classification;
  const [applies, setApplies] = useState("");
  const [rationale, setRationale] = useState("");
  const [pw, setPw] = useState("");
  const det = ctx.s6_determination;
  async function sign() {
    try {
      await api.post(`/programs/${p.id}/determinations`, { key: "s6_principles_apply", applies: applies === "true", rationale, password: pw });
      setPw("");
      toast("Determination signed and recorded");
      reload();
    } catch (e) {
      onErr(e);
    }
  }
  return (
    <Section
      title="Peptide classification and guideline routing"
      right={<a href={href.program(p.id, "whatif")}>Change peptide facts…</a>}
    >
      <Facts
        items={[
          ["Manufacturing origin", ctx.peptide_origin ? humanize(ctx.peptide_origin) : "Unknown"],
          ["Amino acids per chain", (ctx.amino_acid_chains ?? []).join(", ") || "Unknown"],
          [
            "US classification",
            cls ? (
              <Pill tone={cls.outcome === "pending" ? "warn" : "ok"}>
                {cls.outcome === "protein" ? "Protein (biological product)" : cls.outcome === "not_protein" ? "Not a protein" : "Pending"}
              </Pill>
            ) : (
              "—"
            ),
          ],
        ]}
      />
      {cls && (
        <div className="small" style={{ marginTop: 8 }}>
          {cls.statement}
          <Citations list={cls.citations} />
        </div>
      )}
      <h4>ICH S6(R1) applicability</h4>
      <div className="small">
        {ctx.peptide_origin === "recombinant" && "Recombinant expression: within ICH S6(R1) (section 1.3); the S6(R1) study set applies."}
        {!ctx.peptide_origin && "Origin unknown: the governing guideline depends on it, so the affected studies are conditional."}
        {ctx.peptide_origin === "chemical_synthesis" &&
          (det ? (
            <div className="signed">
              Signed by {det.signature.signer_name} ({roleLabel(det.signature.role)}) on {fmtDate(det.signature.signed_at)}: S6(R1)
              principles <strong>{det.applies ? "apply" : "do not apply"}</strong>. “{det.rationale}”
            </div>
          ) : (
            <>
              Chemically synthesised: ICH M3(R2) governs, and S6(R1) principles “may also be applicable” (S6(R1) section 1.3). The
              species-relevance and anti-drug-antibody items stay conditional until the responsible scientist signs whether they apply.
            </>
          ))}
      </div>
      {ctx.peptide_origin === "chemical_synthesis" && !det && me.kind === "human" && me.roles.includes("responsible_scientist") && (
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <span className="field-label">S6(R1) principles *</span>
            <select value={applies} onChange={(e) => setApplies(e.target.value)}>
              <option value="">Choose…</option>
              <option value="true">Apply</option>
              <option value="false">Do not apply</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Rationale (the evidence for the judgement) *</span>
            <input value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Your password (re-authentication) *</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="primary" disabled={!applies || !rationale.trim() || !pw} onClick={sign}>
              Sign determination
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---- study set ------------------------------------------------------------------------------

function StudySet({ p, onErr }: { p: ProgramT; onErr: (e: unknown) => void }) {
  const [compound, setCompound] = useState(p.compounds[0]?.id ?? "");
  const [showNotRequired, setShowNotRequired] = useState(false);
  const studiesFor = useMemo(() => {
    const m: Record<string, StudySummary[]> = {};
    for (const s of p.studies) if (s.requirement_id) (m[s.requirement_id] ??= []).push(s);
    return m;
  }, [p.studies]);
  const groups = TIMING_ORDER.map((t) => ({
    timing: t,
    reqs: p.study_set.requirements.filter((r) => r.timing === t && (showNotRequired || r.status !== "not_required")),
  })).filter((g) => g.reqs.length > 0);
  async function start(r: Requirement, driverId: string) {
    try {
      const s = await api.post<Study>("/studies", { program_id: p.id, compound_id: compound, requirement_id: r.id, driver_id: driverId });
      toast("Study created");
      go(href.study(s.id));
    } catch (e) {
      onErr(e);
    }
  }
  const sum = p.study_set.summary;
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
        subtitle={`${sum.required} required · ${sum.conditional} conditional · ${sum.not_required} not required`}
        right={
          <>
            <label className="checks small" style={{ margin: 0 }}>
              <span>
                <input type="checkbox" checked={showNotRequired} onChange={(e) => setShowNotRequired(e.target.checked)} /> Show not required
              </span>
            </label>
            {p.compounds.length > 0 ? (
              <label className="row small">
                Start studies for
                <select style={{ width: "auto" }} value={compound} onChange={(e) => setCompound(e.target.value)}>
                  {p.compounds.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <a href={href.program(p.id, "compounds")}>Register a compound to start studies</a>
            )}
          </>
        }
      >
        {groups.map((g) => (
          <div key={g.timing} className="table-block">
            <div className="table-title">{timingLabel(g.timing)}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "38%" }}>Study</th>
                    <th>Status</th>
                    <th>GLP</th>
                    <th>Basis</th>
                    <th>Studies</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.reqs.map((r) => {
                    const drivers = p.drivers?.[r.id] ?? [];
                    const existing = studiesFor[r.id] ?? [];
                    return (
                      <tr key={r.id} className={r.status === "not_required" ? "dim" : ""}>
                        <td>
                          <strong>{r.name}</strong>
                          <div className="muted small">
                            {[r.species.length > 0 && r.species.join(", "), r.duration_weeks && `${r.duration_weeks} weeks`, r.components.length > 0 && `parts: ${r.components.join(", ")}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          <details className="small">
                            <summary className="muted">Why</summary>
                            {r.rationale}
                          </details>
                        </td>
                        <td>
                          <span className={`tag tag-${r.status}`}>{statusLabel(r.status)}</span>
                          {r.pending_fact && <div className="small muted">pending: {r.pending_fact}</div>}
                        </td>
                        <td>{r.glp ? "Yes" : "No"}</td>
                        <td className="small" title={r.citation.text}>
                          {r.section}
                          {r.ctd_section && <div className="muted">CTD {r.ctd_section}</div>}
                        </td>
                        <td className="small">
                          {existing.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            existing.map((s) => (
                              <div key={s.id}>
                                <a href={href.study(s.id)}>
                                  <StateTag state={s.state} simulated={s.simulated} />
                                </a>
                              </div>
                            ))
                          )}
                        </td>
                        <td>
                          {r.status !== "not_required" && compound && (
                            <div className="stack" style={{ gap: 4, alignItems: "flex-start" }}>
                              {drivers.map((d) => (
                                <button key={d.id} className="small" onClick={() => start(r, d.id)} title={d.name}>
                                  Start study
                                  {drivers.length > 1 || d.components.length > 0
                                    ? `: ${d.components.length ? d.components.join(", ") : d.name}`
                                    : ""}
                                </button>
                              ))}
                              <a className="small" href={href.importReport(p.id, r.id)}>
                                Import a report
                              </a>
                              {drivers.length === 0 && <span className="muted small">no driver installed</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Governing guidelines">
        <Citations list={p.study_set.governing_guidelines} />
      </Section>
    </>
  );
}

// ---- compounds ------------------------------------------------------------------------------

function Compounds({ p, reload, onErr }: { p: ProgramT; reload: () => void; onErr: (e: unknown) => void }) {
  const [name, setName] = useState("");
  const [smiles, setSmiles] = useState("");
  const [busy, setBusy] = useState("");
  async function add() {
    try {
      await api.post(`/programs/${p.id}/compounds`, { name, smiles });
      toast(`${name} registered; RDKit profile computed`);
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
      toast("PubChem and ChEMBL queried");
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
      {p.compounds.map((c) =>
        c.kind === "sequence" && c.entity ? (
          <SequenceEntityView key={c.id} c={c} p={p} reload={reload} onErr={onErr} />
        ) : (
          <Section
            key={c.id}
            title={c.name}
            subtitle={
              <>
                {c.profile.formula} · <span className="mono">{c.profile.canonical_smiles}</span>
              </>
            }
            right={
              <button onClick={() => enrich(c)} disabled={busy === c.id}>
                {busy === c.id ? "Querying…" : "Look up in PubChem / ChEMBL"}
              </button>
            }
          >
            <Facts
              items={[
                ["InChIKey", <span className="mono">{c.inchikey}</span>],
                ["Lipinski rule of five", <Pill tone={c.profile.lipinski_pass ? "ok" : "warn"}>{c.profile.lipinski_pass ? "Pass" : "Fail"}</Pill>],
                ["Veber rules", <Pill tone={c.profile.veber_pass ? "ok" : "warn"}>{c.profile.veber_pass ? "Pass" : "Fail"}</Pill>],
                ["Computed with", `RDKit ${c.profile.rdkit_version}`],
              ]}
            />
            <h4>Descriptors</h4>
            <div className="table-wrap">
              <table className="compact">
                <tbody>
                  {Object.entries(c.profile.descriptors).map(([k, q]) => (
                    <tr key={k}>
                      <td style={{ width: "40%" }}>{q.label ?? humanize(k)}</td>
                      <td>
                        <QuantityView q={q} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.entries(c.external).map(([src, r]) => (
              <div key={src} className="external">
                <div className="row">
                  <strong>{src === "pubchem" ? "PubChem" : src === "chembl" ? "ChEMBL" : humanize(src)}</strong>
                  <span className={`tag tag-${r.status}`}>{statusLabel(r.status)}</span>
                  {r.from_cache && <span className="muted small">cached</span>}
                  <span className="muted small">
                    {[r.attribution, r.license, r.retrieved_at && `retrieved ${fmtDate(r.retrieved_at)}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {r.error && <div className="muted small">{r.error}</div>}
                {r.records.slice(0, 1).map((rec, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <ValueView
                      value={Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null && typeof v !== "object").slice(0, 12))}
                    />
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
        ),
      )}
      {p.compounds.length === 0 && <Empty title="No compounds yet">Register the test article to start studies.</Empty>}
      {aminoAcid && <SequenceRegistration p={p} reload={reload} onErr={onErr} />}
      <Section title={aminoAcid ? "Register by structure (SMILES)" : "Register a compound"} subtitle="The structure is profiled with RDKit; every descriptor carries its method and citation.">
        <div className="grid2">
          <label className="field">
            <span className="field-label">Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">SMILES *</span>
            <input value={smiles} onChange={(e) => setSmiles(e.target.value)} className="mono" />
          </label>
        </div>
        <div className="row-end">
          <button className="primary" disabled={!name.trim() || !smiles.trim()} onClick={add}>
            Register compound
          </button>
        </div>
      </Section>
    </>
  );
}

// ---- studies --------------------------------------------------------------------------------

function Studies({ p }: { p: ProgramT }) {
  const [filter, setFilter] = useState("all");
  const names = requirementNames(p);
  const rows = p.studies
    .filter((s) =>
      filter === "all" ? true : filter === "active" ? ACTIVE.includes(s.state) : filter === "done" ? ["approved", "imported"].includes(s.state) : ["cancelled", "failed", "superseded"].includes(s.state),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <Section
      title="Studies"
      right={
        <select style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter studies">
          <option value="all">All studies</option>
          <option value="active">In progress</option>
          <option value="done">Approved or imported</option>
          <option value="ended">Cancelled or superseded</option>
        </select>
      }
    >
      {p.studies.length === 0 ? (
        <Empty title="No studies yet">
          Start one from the <a href={href.program(p.id, "studyset")}>study set</a>.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty title="No study matches this filter" />
      ) : (
        <StudyTable studies={rows} names={names} compounds={p.compounds} />
      )}
    </Section>
  );
}

// ---- readiness ------------------------------------------------------------------------------

function ReadinessView({ id }: { id: string }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [milestone, setMilestone] = useState("before_first_in_human");
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setR(null);
    api.get<Readiness>(`/programs/${id}/readiness?milestone=${milestone}`).then(setR).catch(setErr);
  }, [id, milestone]);
  const picker = (
    <label className="row small">
      Milestone
      <select style={{ width: "auto" }} value={milestone} onChange={(e) => setMilestone(e.target.value)}>
        {TIMING_ORDER.map((t) => (
          <option key={t} value={t}>
            {timingLabel(t)}
          </option>
        ))}
      </select>
    </label>
  );
  if (!r)
    return (
      <Section title="IND readiness" right={picker}>
        {err ? <ErrorBox error={err} /> : <Loading />}
      </Section>
    );
  const s = r.summary;
  const due = r.items.filter((i) => i.due_for_milestone);
  return (
    <Section title="IND readiness" right={picker}>
      <div className="stats">
        <div className="stat">
          <div className="stat-v">
            {s.done} / {s.required_for_milestone}
          </div>
          <div className="stat-l">required studies done in Hakase</div>
        </div>
        <div className="stat">
          <div className="stat-v">{s.imported}</div>
          <div className="stat-l">covered by imported reports</div>
        </div>
        <div className="stat">
          <div className="stat-v">{s.percent_covered ?? "—"}%</div>
          <div className="stat-l">covered (done + imported)</div>
          {s.percent_covered !== null && (
            <div className="bar">
              <span style={{ width: `${s.percent_covered}%` }} />
            </div>
          )}
        </div>
        <div className="stat">
          <div className="stat-v">{s.percent_runnable_in_hos ?? "—"}%</div>
          <div className="stat-l">runnable end-to-end in Hakase</div>
        </div>
      </div>
      {s.conditional_pending_facts.length > 0 && (
        <div className="note small">Facts still to establish: {s.conditional_pending_facts.join("; ")}</div>
      )}
      <div className="table-wrap" style={{ marginTop: 10 }}>
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
                  {!i.driver_available && i.status === "missing" && <div className="muted small">no installed driver: import the report</div>}
                </td>
                <td>
                  <span className={`tag tag-${i.status}`}>{statusLabel(i.status)}</span>
                  {i.components && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {i.components.done.length > 0 && <div>done: {i.components.done.join(", ")}</div>}
                      {i.components.imported.length > 0 && <div>imported: {i.components.imported.join(", ")}</div>}
                      {i.components.missing.length > 0 && <div className="qc-fail">missing: {i.components.missing.join(", ")}</div>}
                    </div>
                  )}
                  {i.pending_fact && <div className="small muted">pending: {i.pending_fact}</div>}
                </td>
                <td className="small">{i.section}</td>
                <td className="small">
                  {i.studies.length === 0 && <span className="muted">—</span>}
                  {i.studies.map((st) => (
                    <div key={st.id}>
                      <a href={href.study(st.id)}>
                        <StateTag state={st.state} simulated={st.simulated} />
                      </a>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.notes.map((n, i) => (
        <p key={i} className="muted small">
          {n}
        </p>
      ))}
    </Section>
  );
}

// ---- module 4 -------------------------------------------------------------------------------

interface Module4Pkg {
  package_hash: string;
  bundle_sha256: string;
  included_studies: number;
  refused_studies: { study_id: string; reason: string }[];
  toc: {
    section: string;
    title: string;
    depth: number;
    reports: { study_id: string; title: string; report_hash: string; signatures: { role: string; signer: string }[] }[];
  }[];
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
  const [busy, setBusy] = useState(false);
  async function assemble() {
    setBusy(true);
    setVerify(null);
    try {
      setPkg(await api.post<Module4Pkg>(`/programs/${id}/module4`));
      toast("Module 4 assembled");
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Section
        title="CTD Module 4 (ICH M4S(R2))"
        subtitle="Only approved studies with admissible (non-simulated) data are included."
        right={
          <button className="primary" onClick={assemble} disabled={busy}>
            {busy ? "Assembling…" : "Assemble from approved studies"}
          </button>
        }
      >
        <ErrorBox error={err} onDismiss={() => setErr(null)} />
        {!pkg && <Empty title="Not assembled yet">Assembling builds the Module 4 tree, a verification bundle and the FIH dose projection.</Empty>}
        {pkg && (
          <>
            <Facts
              items={[
                ["Reports included", pkg.included_studies],
                ["Package", <span className="mono">{pkg.package_hash.slice(0, 16)}</span>],
                [
                  "Bundle",
                  <span className="row">
                    <button className="small" onClick={() => api.download(`/files/${pkg.bundle_sha256}`, "module4.zip")}>
                      Download zip
                    </button>
                    <button className="small" onClick={() => api.get<VerifyResult>(`/files/${pkg.bundle_sha256}/verify`).then(setVerify).catch(setErr)}>
                      Verify (recompute every figure)
                    </button>
                  </span>,
                ],
              ]}
            />
            <p className="muted small">
              Anyone can verify this export offline with <code>hos-verify module4.zip</code>: it re-runs every driver from the raw files and
              checks every hash, signature and the audit-trail chain.
            </p>
            {pkg.refused_studies.length > 0 && (
              <div className="error">
                <strong>Not included</strong>
                <ul>
                  {pkg.refused_studies.map((r) => (
                    <li key={r.study_id}>
                      <a href={href.study(r.study_id)}>{r.study_id}</a>: {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>
      {verify && (
        <Section
          title="Verification"
          right={<Pill tone={verify.passed ? "ok" : "bad"}>{verify.passed ? "Verified" : "Verification failed"}</Pill>}
          subtitle={`${verify.counts.pass} passed · ${verify.counts.warn} warnings · ${verify.counts.fail} failed`}
        >
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Subject</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {verify.checks.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`tag tag-${c.status}`}>{statusLabel(c.status)}</span>
                    </td>
                    <td>{c.subject}</td>
                    <td>
                      {c.check}
                      {c.detail && <div className="muted">{c.detail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {pkg && (
        <Section title="Contents">
          <ul className="toc">
            {pkg.toc.map((t) => (
              <li key={t.section} style={{ marginLeft: `${Math.max(t.depth - 1, 0) * 18}px`, padding: "3px 0" }}>
                <strong>{t.section}</strong> {t.title}
                {t.reports.map((r) => (
                  <div key={r.study_id} className="small" style={{ marginLeft: 18 }}>
                    ↳ <a href={href.study(r.study_id)}>{r.title}</a>{" "}
                    <span className="muted">· {r.signatures.map((s) => `${roleLabel(s.role)}: ${s.signer}`).join(", ")}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {pkg?.dose_projection && (
        <Section title="First-in-human dose projection" subtitle="FDA 2005 guidance, from the Study Director's NOAELs">
          <ol className="small">
            {pkg.dose_projection.projection.derivation.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}

// ---- access ---------------------------------------------------------------------------------

interface Members {
  organisation: string | null;
  members: { principal_id: string; name: string; organisation: string | null; added_by: string; added_at: string }[];
}

/** Who can see this programme: its organisation, plus guests (e.g. a CRO) added on the record. */
function ProgramAccess({ id, me, onErr }: { id: string; me: Principal; onErr: (e: unknown) => void }) {
  const [m, setM] = useState<Members | null>(null);
  const [pid, setPid] = useState("");
  const [reason, setReason] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const load = useCallback(() => api.get<Members>(`/programs/${id}/members`).then(setM).catch(onErr), [id, onErr]);
  useEffect(() => {
    load();
  }, [load]);
  if (!m) return <Loading />;
  const owner = me.kind === "human" && (me.organisation ?? null) === m.organisation;
  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setPid("");
      setReason("");
      setRemoveReason("");
      toast(done);
      load();
    } catch (e) {
      onErr(e);
    }
  }
  return (
    <Section
      title="Access"
      subtitle={
        <>
          Everyone in <strong>{m.organisation ?? "the default organisation"}</strong> can see this programme. People from other
          organisations see it only when added here; each change is recorded with its reason.
        </>
      }
    >
      {m.members.length === 0 ? (
        <Empty title="No guests" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Guest</th>
                <th>Organisation</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.members.map((g) => (
                <tr key={g.principal_id}>
                  <td>
                    {g.name} <span className="muted">({g.principal_id})</span>
                  </td>
                  <td>{g.organisation ?? "default"}</td>
                  <td className="small">
                    {fmtDate(g.added_at)} by {g.added_by}
                  </td>
                  <td>
                    {owner && (
                      <button
                        className="small danger"
                        disabled={!removeReason.trim()}
                        title={removeReason.trim() ? "" : "Enter a reason below first"}
                        onClick={() => act(() => api.post(`/programs/${id}/members/${g.principal_id}/remove`, { reason: removeReason }), `${g.name} removed`)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {owner && m.members.length > 0 && (
        <label className="field" style={{ marginTop: 8 }}>
          <span className="field-label">Reason for removing a guest</span>
          <input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />
        </label>
      )}
      {owner && (
        <>
          <h4>Give someone from another organisation access</h4>
          <div className="grid3">
            <label className="field">
              <span className="field-label">User id *</span>
              <input value={pid} onChange={(e) => setPid(e.target.value)} />
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span className="field-label">Reason *</span>
              <input placeholder="e.g. CRO running the Ames study" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          <div className="row-end">
            <button
              className="primary"
              disabled={!pid.trim() || !reason.trim()}
              onClick={() => act(() => api.post(`/programs/${id}/members`, { principal_id: pid, reason }), `Access given to ${pid}`)}
            >
              Give access
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
