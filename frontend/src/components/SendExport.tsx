// SEND export (SENDIG v3.1.1) for a repeat-dose toxicity study. The form only gathers what the
// study record does not hold; the backend builds the datasets, runs every check and refuses the
// package while any check fails. Nothing here is pre-filled with a guessed value: the form
// starts empty, or from the spec of this study's previous export.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { fmtDateTime } from "../lib/format";
import type {
  SendAnimal,
  SendContext,
  SendEndpointMap,
  SendExportRecord,
  SendFacts,
  SendSpec,
  SendSubject,
  SendTerms,
} from "../types";
import { ErrorBox, Section } from "./common";

type Tab = "facts" | "subjects" | "endpoints" | "tk" | "ts";
const NULL_FLAVORS = [
  "NI",
  "INV",
  "OTH",
  "UNK",
  "ASKU",
  "NAV",
  "NASK",
  "MSK",
  "NA",
  "NP",
];

const EMPTY_FACTS: SendFacts = {
  studyid: "",
  test_facility_study_id: "",
  study_title: "",
  sponsor: "",
  test_facility: "",
  test_facility_location: "",
  test_facility_country: "",
  study_type: "",
  study_category: "",
  design: "",
  report_status: "",
  glp_type: null,
  species: "",
  strain: "",
  age: null,
  age_text: null,
  age_unit: "",
  route: "",
  dose_form: "",
  dosing_frequency: "",
  test_article: "",
  vehicle: "",
  test_article_lot: "",
  dosing_start: "",
  dosing_end: "",
  experimental_start: "",
  experimental_end: "",
  dosing_duration: "",
  terminal_sacrifice: "",
  recovery_sacrifice: null,
  values: {},
  null_values: {},
};

function blankAnimal(subject_id: string): SendAnimal {
  return {
    subject_id,
    first_dose_date: "",
    last_dose_date: "",
    end_date: "",
    disposition: "",
    disposition_term: "",
    disposition_date: "",
    disposition_nominal_day: null,
    unscheduled: false,
  };
}

/** Keep the user's earlier entries for subjects still in the record; add the others blank. */
function animalsFor(
  subjects: SendSubject[],
  previous: SendAnimal[] | undefined,
): SendAnimal[] {
  const prev = new Map((previous ?? []).map((a) => [a.subject_id, a]));
  return subjects.map(
    (s) => prev.get(s.subject_id) ?? blankAnimal(s.subject_id),
  );
}

function initialSpec(ctx: SendContext): SendSpec {
  const last = [...ctx.exports].reverse().find((e) => e.spec)?.spec;
  const endpoints: Record<string, SendEndpointMap> = {};
  for (const e of ctx.endpoints) {
    endpoints[e.name] = last?.endpoints[e.name] ?? {
      domain: "",
      testcd: "",
      test: "",
      unit: e.unit,
      category: null,
      specimen: null,
    };
  }
  const tp = (prev: Record<string, number> | undefined) =>
    Object.fromEntries(
      ctx.timepoints.filter((t) => prev && t in prev).map((t) => [t, prev![t]]),
    );
  const tk =
    last?.pk && ctx.tk_studies.find((t) => t.id === last.pk!.tk_study_id);
  return {
    facts: last?.facts ?? EMPTY_FACTS,
    animals: animalsFor(ctx.subjects, last?.animals),
    endpoints,
    timepoints: tp(last?.timepoints),
    recovery_timepoints: tp(last?.recovery_timepoints),
    baseline_timepoint: last?.baseline_timepoint ?? null,
    pk:
      tk && last?.pk
        ? { ...last.pk, animals: animalsFor(tk.subjects, last.pk.animals) }
        : null,
  };
}

/** The JSON the API validates: empty optional strings become null, nominal days integers. */
function payload(spec: SendSpec): unknown {
  const opt = (v: string | null) => (v === null || v.trim() === "" ? null : v);
  return {
    ...spec,
    facts: {
      ...spec.facts,
      glp_type: opt(spec.facts.glp_type),
      age_text: opt(spec.facts.age_text),
      recovery_sacrifice: opt(spec.facts.recovery_sacrifice),
      values: Object.fromEntries(
        Object.entries(spec.facts.values).filter(([, v]) => v.trim() !== ""),
      ),
    },
    endpoints: Object.fromEntries(
      Object.entries(spec.endpoints).map(([k, e]) => [
        k,
        { ...e, category: opt(e.category), specimen: opt(e.specimen) },
      ]),
    ),
  };
}

export function SendExport({ studyId }: { studyId: string }) {
  const [ctx, setCtx] = useState<SendContext | null>(null);
  const [terms, setTerms] = useState<SendTerms | null>(null);
  const [spec, setSpec] = useState<SendSpec | null>(null);
  const [tab, setTab] = useState<Tab>("facts");
  const [result, setResult] = useState<SendExportRecord | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const c = await api.get<SendContext>(`/studies/${studyId}/send-export`);
      setCtx(c);
      setSpec((s) => s ?? initialSpec(c));
    } catch (e) {
      setErr(e);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyId]);
  useEffect(() => {
    if (open && !terms)
      api.get<SendTerms>("/send/terms").then(setTerms).catch(setErr);
  }, [open, terms]);

  async function exportNow() {
    if (!spec) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await api.post<SendExportRecord>(
          `/studies/${studyId}/send-export`,
          payload(spec),
        ),
      );
      await load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (!ctx) return err ? <ErrorBox error={err} /> : null;
  const download = (sha: string) =>
    api.download(`/files/${sha}`, `${spec?.facts.studyid || studyId}_send.zip`);
  return (
    <Section
      title={`SEND export · SENDIG ${ctx.standards.SENDIG} · CT ${ctx.standards["SEND CT"]}`}
      right={
        <button onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Prepare export"}
        </button>
      }
    >
      <div className="small">
        Study start (STSTDTC):{" "}
        {ctx.study_start ? (
          <>
            <strong>{ctx.study_start}</strong>, the Study Director&apos;s
            protocol signature ({ctx.study_director})
          </>
        ) : (
          <span className="qc-fail">
            no Study Director protocol signature yet. FDA defines the study
            start date as that signature (TCG 4.1.3), so the export is refused
            until it is recorded.
          </span>
        )}
      </div>
      {ctx.simulated && (
        <div className="banner-sim">
          This study holds simulated data. SEND datasets are never made from it.
        </div>
      )}
      {ctx.exports.length > 0 && (
        <ExportHistory exports={ctx.exports} download={download} />
      )}
      <ErrorBox error={err} />
      {open && spec && !ctx.simulated && (
        <>
          <div className="tabs">
            {(
              [
                ["facts", "Trial summary"],
                ["subjects", `Subjects (${spec.animals.length})`],
                ["endpoints", "Endpoints & timepoints"],
                ["tk", "Toxicokinetics"],
                ["ts", "Other TS parameters"],
              ] as [Tab, string][]
            ).map(([t, l]) => (
              <button
                key={t}
                className={tab === t ? "tab active" : "tab"}
                onClick={() => setTab(t)}
              >
                {l}
              </button>
            ))}
          </div>
          {terms && <TermLists terms={terms} />}
          {tab === "facts" && (
            <FactsForm
              f={spec.facts}
              glp={ctx.glp}
              recovery={ctx.recovery}
              terms={terms}
              set={(facts) => setSpec({ ...spec, facts })}
            />
          )}
          {tab === "subjects" && (
            <AnimalsForm
              subjects={ctx.subjects}
              animals={spec.animals}
              terms={terms}
              set={(animals) => setSpec({ ...spec, animals })}
            />
          )}
          {tab === "endpoints" && (
            <EndpointsForm ctx={ctx} spec={spec} terms={terms} set={setSpec} />
          )}
          {tab === "tk" && (
            <TkForm ctx={ctx} spec={spec} terms={terms} set={setSpec} />
          )}
          {tab === "ts" && (
            <TsForm
              ctx={ctx}
              f={spec.facts}
              set={(facts) => setSpec({ ...spec, facts })}
            />
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={exportNow}>
              {busy ? "Building…" : "Build and check SEND package"}
            </button>
            <SpecFile spec={spec} setSpec={setSpec} ctx={ctx} />
          </div>
        </>
      )}
      {result && <ExportResult r={result} download={download} />}
    </Section>
  );
}

function ExportHistory({
  exports,
  download,
}: {
  exports: SendExportRecord[];
  download: (sha: string) => void;
}) {
  return (
    <table className="small">
      <thead>
        <tr>
          <th>Export</th>
          <th>When</th>
          <th>By</th>
          <th>Outcome</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {[...exports].reverse().map((e) => (
          <tr key={e.version}>
            <td>v{e.version}</td>
            <td>{fmtDateTime(e.created_at)}</td>
            <td>{e.created_by}</td>
            <td>
              {e.ok ? (
                <span className="tag tag-pass">package built</span>
              ) : (
                <span className="tag tag-fail">
                  refused ({e.errors.length} errors)
                </span>
              )}
            </td>
            <td>
              {e.package_sha256 && (
                <button onClick={() => download(e.package_sha256!)}>
                  Download
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExportResult({
  r,
  download,
}: {
  r: SendExportRecord;
  download: (sha: string) => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <h4>
        {r.ok ? (
          <span className="tag tag-pass">
            Package built: every check passed
          </span>
        ) : (
          <span className="tag tag-fail">Export refused</span>
        )}{" "}
        {r.package_sha256 && (
          <button onClick={() => download(r.package_sha256!)}>
            Download package
          </button>
        )}
      </h4>
      {r.package_sha256 && (
        <div className="small muted">
          sha256 <code>{r.package_sha256}</code>
        </div>
      )}
      {r.errors.length > 0 && (
        <div className="error">
          <strong>Errors</strong>
          <ul>
            {r.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {r.warnings.length > 0 && (
        <div className="note small">
          <strong>Warnings</strong> (describe these in the nSDRG)
          <ul>
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {r.checks.length > 0 && (
        <table className="small">
          <thead>
            <tr>
              <th>Check</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.checks.map((c, i) => (
              <tr key={i}>
                <td>
                  {c.rule}
                  {c.detail && <div className="muted">{c.detail}</div>}
                </td>
                <td className="muted">{c.source}</td>
                <td>
                  <span className={`tag tag-${c.passed ? "pass" : "fail"}`}>
                    {c.passed ? "pass" : "fail"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.manifest.records && (
        <div className="small muted">
          Records:{" "}
          {Object.entries(r.manifest.records)
            .map(([d, n]) => `${d} ${n}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

/** One <datalist> per CT-bound field, so inputs suggest SEND terms while typing. */
function TermLists({ terms }: { terms: SendTerms }) {
  return (
    <>
      {Object.entries(terms.fields).map(([f, cl]) => (
        <datalist key={f} id={`ct-${f}`}>
          {cl.terms.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ))}
      {Object.entries(terms.tests).map(([d, pairs]) => (
        <datalist key={d} id={`ct-testcd-${d}`}>
          {pairs.map(([cd, name]) => (
            <option key={cd} value={cd}>
              {name}
            </option>
          ))}
        </datalist>
      ))}
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/** A CT-bound input: a free entry with suggestions on extensible lists, a fixed choice otherwise. */
function Term({
  field,
  value,
  onChange,
  terms,
}: {
  field: string;
  value: string;
  onChange: (v: string) => void;
  terms: SendTerms | null;
}) {
  const cl = terms?.fields[field];
  if (cl && !cl.extensible) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {cl.terms.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      list={`ct-${field}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FactsForm({
  f,
  glp,
  recovery,
  terms,
  set,
}: {
  f: SendFacts;
  glp: boolean;
  recovery: boolean;
  terms: SendTerms | null;
  set: (f: SendFacts) => void;
}) {
  const text = (k: keyof SendFacts, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        value={(f[k] as string | null) ?? ""}
        onChange={(e) => set({ ...f, [k]: e.target.value })}
      />
    </Field>
  );
  const term = (k: keyof SendFacts, label: string, field: string = k) => (
    <Field
      label={label}
      hint={
        terms?.fields[field]
          ? `${terms.fields[field].name} (${terms.fields[field].code})`
          : undefined
      }
    >
      <Term
        field={field}
        value={(f[k] as string | null) ?? ""}
        terms={terms}
        onChange={(v) => set({ ...f, [k]: v })}
      />
    </Field>
  );
  const date = (k: keyof SendFacts, label: string) => (
    <Field label={label}>
      <input
        type="date"
        value={(f[k] as string) ?? ""}
        onChange={(e) => set({ ...f, [k]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="grid2">
      {text(
        "studyid",
        "Sponsor study ID (STUDYID)",
        "letters, digits, - and _; the eCTD study id",
      )}
      {text("test_facility_study_id", "Test facility study ID (SPREFID)")}
      {text("study_title", "Study title (STITLE)")}
      {text("sponsor", "Sponsor (SSPONSOR)")}
      {text("test_facility", "Test facility (TSTFNAM)")}
      {text("test_facility_location", "Test facility location (TSTFLOC)")}
      {term("test_facility_country", "Test facility country (TFCNTRY)")}
      {term("study_type", "Study type (SSTYP)")}
      {term("study_category", "Study category (STCAT)")}
      {term("design", "Study design (SDESIGN)")}
      {term("report_status", "Report status (STRPSTAT)")}
      {glp && term("glp_type", "GLP type (GLPTYP)")}
      {term("species", "Species")}
      {term("strain", "Strain")}
      <Field
        label="Age at start of dosing (AGE)"
        hint="a number; or give a range in AGETXT instead"
      >
        <input
          type="number"
          min="0"
          step="any"
          value={f.age ?? ""}
          onChange={(e) =>
            set({
              ...f,
              age: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
      </Field>
      {text(
        "age_text",
        "Age range (AGETXT)",
        "e.g. 6-8; only when AGE is not given",
      )}
      {term("age_unit", "Age unit (AGEU)")}
      {term("route", "Route (ROUTE / EXROUTE)")}
      {term("dose_form", "Dose form (EXDOSFRM)")}
      {term("dosing_frequency", "Dosing frequency (PDOSFRQ / EXDOSFRQ)")}
      {text("test_article", "Test article (TRT)")}
      {text("vehicle", "Vehicle (TRTV)")}
      {text("test_article_lot", "Test article lot (EXLOT)")}
      {date("dosing_start", "Dosing start (DOSSTDTC)")}
      {date("dosing_end", "Dosing end (DOSENDTC)")}
      {date("experimental_start", "Experimental start (EXPSTDTC)")}
      {date("experimental_end", "Experimental end (EXPENDTC)")}
      {text(
        "dosing_duration",
        "Dosing duration (DOSDUR)",
        "ISO 8601 duration, e.g. P28D; excludes recovery",
      )}
      {text(
        "terminal_sacrifice",
        "Time to terminal sacrifice (TRMSAC)",
        "ISO 8601 duration",
      )}
      {recovery &&
        text(
          "recovery_sacrifice",
          "Time to recovery sacrifice (RECSAC)",
          "ISO 8601 duration",
        )}
    </div>
  );
}

const ANIMAL_FIELDS: [keyof SendAnimal, string, string][] = [
  ["first_dose_date", "First dose", "date"],
  ["last_dose_date", "Last dose", "date"],
  ["end_date", "Reference end (RFENDTC)", "date"],
  ["disposition", "Disposition (DSDECOD)", "term"],
  ["disposition_term", "As recorded (DSTERM)", "text"],
  ["disposition_date", "Disposition date", "date"],
  ["disposition_nominal_day", "Nominal day", "number"],
];

function AnimalInput({
  a,
  k,
  kind,
  terms,
  set,
}: {
  a: SendAnimal;
  k: keyof SendAnimal;
  kind: string;
  terms: SendTerms | null;
  set: (a: SendAnimal) => void;
}) {
  if (kind === "term")
    return (
      <Term
        field="disposition"
        value={a.disposition}
        terms={terms}
        onChange={(v) => set({ ...a, disposition: v })}
      />
    );
  if (kind === "number")
    return (
      <input
        type="number"
        step="1"
        value={a.disposition_nominal_day ?? ""}
        onChange={(e) =>
          set({
            ...a,
            disposition_nominal_day:
              e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
    );
  return (
    <input
      type={kind}
      value={String(a[k] ?? "")}
      onChange={(e) => set({ ...a, [k]: e.target.value })}
    />
  );
}

/** Per-subject dates and dispositions, with a fill that copies the entered values to a group. */
function AnimalsForm({
  subjects,
  animals,
  terms,
  set,
}: {
  subjects: SendSubject[];
  animals: SendAnimal[];
  terms: SendTerms | null;
  set: (a: SendAnimal[]) => void;
}) {
  const phases = useMemo(
    () => [...new Set(subjects.map((s) => s.phase))],
    [subjects],
  );
  const [phase, setPhase] = useState(phases[0] ?? "");
  const [fill, setFill] = useState<SendAnimal>(blankAnimal("*"));
  const phaseOf = new Map(subjects.map((s) => [s.subject_id, s]));
  const members = animals.filter(
    (a) => phaseOf.get(a.subject_id)?.phase === phase,
  );
  const apply = () =>
    set(
      animals.map((a) =>
        phaseOf.get(a.subject_id)?.phase === phase
          ? { ...fill, subject_id: a.subject_id }
          : a,
      ),
    );
  return (
    <div>
      <div className="note small">
        Fill a group: enter the values once, then apply them to every animal of
        the chosen phase. Edit single animals below (unscheduled deaths, early
        removals).
      </div>
      <div className="row" style={{ margin: "6px 0" }}>
        <select
          style={{ width: "auto" }}
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
        >
          {phases.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button onClick={apply} disabled={members.length === 0}>
          Apply to {members.length} {phase} animals
        </button>
      </div>
      <div className="grid2">
        {ANIMAL_FIELDS.map(([k, l, kind]) => (
          <Field key={k} label={l}>
            <AnimalInput
              a={fill}
              k={k}
              kind={kind}
              terms={terms}
              set={setFill}
            />
          </Field>
        ))}
      </div>
      <AnimalTable
        animals={animals}
        subjects={phaseOf}
        terms={terms}
        set={set}
      />
    </div>
  );
}

function AnimalTable({
  animals,
  subjects,
  terms,
  set,
}: {
  animals: SendAnimal[];
  subjects: Map<string, SendSubject>;
  terms: SendTerms | null;
  set: (a: SendAnimal[]) => void;
}) {
  const put = (i: number, a: SendAnimal) =>
    set(animals.map((x, j) => (j === i ? a : x)));
  return (
    <div className="table-wrap">
      <table className="small send-animals">
        <thead>
          <tr>
            <th>Subject</th>
            {ANIMAL_FIELDS.map(([k, l]) => (
              <th key={k}>{l}</th>
            ))}
            <th>Unscheduled</th>
          </tr>
        </thead>
        <tbody>
          {animals.map((a, i) => {
            const s = subjects.get(a.subject_id);
            return (
              <tr key={a.subject_id}>
                <td>
                  {a.subject_id}
                  <div className="muted">
                    {s?.sex} · {s?.dose ?? "–"} · {s?.phase}
                  </div>
                </td>
                {ANIMAL_FIELDS.map(([k, , kind]) => (
                  <td key={k}>
                    <AnimalInput
                      a={a}
                      k={k}
                      kind={kind}
                      terms={terms}
                      set={(x) => put(i, x)}
                    />
                  </td>
                ))}
                <td>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={a.unscheduled}
                    onChange={(e) =>
                      put(i, { ...a, unscheduled: e.target.checked })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EndpointsForm({
  ctx,
  spec,
  terms,
  set,
}: {
  ctx: SendContext;
  spec: SendSpec;
  terms: SendTerms | null;
  set: (s: SendSpec) => void;
}) {
  const put = (name: string, e: SendEndpointMap) =>
    set({ ...spec, endpoints: { ...spec.endpoints, [name]: e } });
  const testName = (domain: string, cd: string) =>
    terms?.tests[domain]?.find(([c]) => c === cd)?.[1];
  const day = (
    which: "timepoints" | "recovery_timepoints",
    t: string,
    v: string,
  ) => {
    const next = { ...spec[which] };
    if (v === "") delete next[t];
    else next[t] = Number(v);
    set({ ...spec, [which]: next });
  };
  return (
    <div>
      <h4>Endpoints → SEND findings</h4>
      <table className="small send-endpoints">
        <thead>
          <tr>
            <th>Endpoint (protocol unit)</th>
            <th>Domain</th>
            <th>--TESTCD</th>
            <th>--TEST</th>
            <th>Unit term</th>
            <th>LB category</th>
            <th>Specimen</th>
          </tr>
        </thead>
        <tbody>
          {ctx.endpoints.map((ep) => {
            const e = spec.endpoints[ep.name];
            return (
              <tr key={ep.name}>
                <td>
                  {ep.name} <span className="muted">({ep.unit})</span>
                </td>
                <td>
                  <select
                    value={e.domain}
                    onChange={(x) =>
                      put(ep.name, {
                        ...e,
                        domain: x.target.value as SendEndpointMap["domain"],
                      })
                    }
                  >
                    <option value="">—</option>
                    <option value="BW">BW body weight</option>
                    <option value="FW">FW food/water</option>
                    <option value="LB">LB laboratory</option>
                    <option value="OM">OM organ measurement</option>
                  </select>
                </td>
                <td>
                  <input
                    list={e.domain ? `ct-testcd-${e.domain}` : undefined}
                    value={e.testcd}
                    onChange={(x) => {
                      const cd = x.target.value.toUpperCase();
                      const paired = testName(e.domain, cd);
                      put(ep.name, {
                        ...e,
                        testcd: cd,
                        test: paired ?? e.test,
                      });
                    }}
                  />
                </td>
                <td>
                  <input
                    value={e.test}
                    onChange={(x) =>
                      put(ep.name, { ...e, test: x.target.value })
                    }
                  />
                </td>
                <td>
                  <Term
                    field="unit"
                    value={e.unit}
                    terms={terms}
                    onChange={(v) => put(ep.name, { ...e, unit: v })}
                  />
                </td>
                <td>
                  {e.domain === "LB" && (
                    <Term
                      field="lb_category"
                      value={e.category ?? ""}
                      terms={terms}
                      onChange={(v) => put(ep.name, { ...e, category: v })}
                    />
                  )}
                </td>
                <td>
                  {(e.domain === "LB" || e.domain === "OM") && (
                    <Term
                      field="specimen"
                      value={e.specimen ?? ""}
                      terms={terms}
                      onChange={(v) => put(ep.name, { ...e, specimen: v })}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        The unit term must be the protocol unit: results are exported as
        collected and the export is refused if they differ. A known --TESTCD
        fills its SEND CT --TEST name.
      </p>
      <h4>Timepoints → nominal study day</h4>
      <table className="small">
        <thead>
          <tr>
            <th>Protocol timepoint</th>
            <th>Dosing phase day</th>
            {ctx.recovery && <th>Recovery phase day</th>}
            <th>Baseline</th>
          </tr>
        </thead>
        <tbody>
          {ctx.timepoints.map((t) => (
            <tr key={t}>
              <td>{t}</td>
              <td>
                <input
                  type="number"
                  step="1"
                  value={spec.timepoints[t] ?? ""}
                  onChange={(e) => day("timepoints", t, e.target.value)}
                />
              </td>
              {ctx.recovery && (
                <td>
                  <input
                    type="number"
                    step="1"
                    value={spec.recovery_timepoints[t] ?? ""}
                    onChange={(e) =>
                      day("recovery_timepoints", t, e.target.value)
                    }
                  />
                </td>
              )}
              <td>
                <input
                  type="radio"
                  style={{ width: "auto" }}
                  name="baseline"
                  checked={spec.baseline_timepoint === t}
                  onChange={() => set({ ...spec, baseline_timepoint: t })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {spec.baseline_timepoint && (
        <button onClick={() => set({ ...spec, baseline_timepoint: null })}>
          Clear baseline
        </button>
      )}
    </div>
  );
}

function TkForm({
  ctx,
  spec,
  terms,
  set,
}: {
  ctx: SendContext;
  spec: SendSpec;
  terms: SendTerms | null;
  set: (s: SendSpec) => void;
}) {
  const usable = ctx.tk_studies.filter((t) => t.analysed && !t.simulated);
  const pk = spec.pk;
  const choose = (id: string) => {
    const t = ctx.tk_studies.find((x) => x.id === id);
    set({
      ...spec,
      pk: t
        ? {
            tk_study_id: t.id,
            analyte_testcd: pk?.analyte_testcd ?? "",
            analyte_test: pk?.analyte_test ?? "",
            specimen: pk?.specimen ?? "",
            concentration_unit: pk?.concentration_unit ?? "",
            auc_unit: pk?.auc_unit ?? "",
            time_unit: pk?.time_unit ?? "",
            animals: animalsFor(t.subjects, pk?.animals),
          }
        : null,
    });
  };
  const tk = pk && ctx.tk_studies.find((t) => t.id === pk.tk_study_id);
  return (
    <div>
      <Field
        label="Toxicokinetic study (PC, PP)"
        hint="same programme and compound, analysed, with laboratory data"
      >
        <select
          value={pk?.tk_study_id ?? ""}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">none: export without PC/PP</option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.state})
            </option>
          ))}
        </select>
      </Field>
      {ctx.tk_studies.length > usable.length && (
        <p className="muted small">
          {ctx.tk_studies.length - usable.length} toxicokinetic stud
          {ctx.tk_studies.length - usable.length === 1 ? "y is" : "ies are"} not
          analysed or hold simulated data, and cannot be exported.
        </p>
      )}
      {pk && tk && (
        <>
          <div className="grid2">
            <Field
              label="Analyte code (PCTESTCD)"
              hint="at most 8 characters, starting with a letter"
            >
              <input
                value={pk.analyte_testcd}
                onChange={(e) =>
                  set({
                    ...spec,
                    pk: { ...pk, analyte_testcd: e.target.value.toUpperCase() },
                  })
                }
              />
            </Field>
            <Field label="Analyte name (PCTEST)">
              <input
                value={pk.analyte_test}
                onChange={(e) =>
                  set({ ...spec, pk: { ...pk, analyte_test: e.target.value } })
                }
              />
            </Field>
            <Field label="Specimen (PCSPEC)">
              <Term
                field="specimen"
                value={pk.specimen}
                terms={terms}
                onChange={(v) => set({ ...spec, pk: { ...pk, specimen: v } })}
              />
            </Field>
            {(
              [
                ["concentration_unit", "Concentration unit"],
                ["auc_unit", "AUC unit"],
                ["time_unit", "Time unit"],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={`${l} (PK units)`}>
                <Term
                  field="pk_unit"
                  value={pk[k]}
                  terms={terms}
                  onChange={(v) => set({ ...spec, pk: { ...pk, [k]: v } })}
                />
              </Field>
            ))}
          </div>
          <h4>Toxicokinetic animals</h4>
          <AnimalsForm
            subjects={tk.subjects}
            animals={pk.animals}
            terms={terms}
            set={(animals) => set({ ...spec, pk: { ...pk, animals } })}
          />
        </>
      )}
    </div>
  );
}

function TsForm({
  ctx,
  f,
  set,
}: {
  ctx: SendContext;
  f: SendFacts;
  set: (f: SendFacts) => void;
}) {
  const desired = new Set(ctx.ts_fda_desired);
  const put = (code: string, v: string) => {
    const nv = { ...f.null_values };
    delete nv[code];
    set({ ...f, values: { ...f.values, [code]: v }, null_values: nv });
  };
  const putNull = (code: string, flavor: string, reason: string) => {
    const vals = { ...f.values };
    delete vals[code];
    const nv = { ...f.null_values };
    if (flavor) nv[code] = { flavor, reason };
    else delete nv[code];
    set({ ...f, values: vals, null_values: nv });
  };
  return (
    <div>
      <p className="small muted">
        Trial Summary parameters Hakase cannot take from the record. FDA-desired
        parameters (TCG v6.3 Appendix C) need a value, or a null flavor with a
        reason; the reason goes into the nSDRG draft.
      </p>
      <table className="small">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value (TSVAL)</th>
            <th>or null flavor (TSVALNF)</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {ctx.ts_to_enter.map((code) => {
            const nv = f.null_values[code];
            return (
              <tr key={code}>
                <td>
                  <code>{code}</code>{" "}
                  {desired.has(code) ? (
                    <span className="req">FDA desired</span>
                  ) : (
                    <span className="muted">conditional</span>
                  )}
                </td>
                <td>
                  <input
                    value={f.values[code] ?? ""}
                    onChange={(e) => put(code, e.target.value)}
                  />
                </td>
                <td>
                  <select
                    value={nv?.flavor ?? ""}
                    onChange={(e) =>
                      putNull(code, e.target.value, nv?.reason ?? "")
                    }
                  >
                    <option value="">—</option>
                    {NULL_FLAVORS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {nv && (
                    <input
                      value={nv.reason}
                      onChange={(e) => putNull(code, nv.flavor, e.target.value)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Save the entered spec to a file, or load one saved earlier (same study's subjects only). */
function SpecFile({
  spec,
  setSpec,
  ctx,
}: {
  spec: SendSpec;
  setSpec: (s: SendSpec) => void;
  ctx: SendContext;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(spec, null, 1)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ctx.study_id}_send_spec.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const s = JSON.parse(await file.text()) as SendSpec;
      const ids = new Set(ctx.subjects.map((x) => x.subject_id));
      const foreign = (s.animals ?? []).filter(
        (a) => !ids.has(a.subject_id),
      ).length;
      setSpec({
        ...s,
        animals: animalsFor(ctx.subjects, s.animals),
        recovery_timepoints: s.recovery_timepoints ?? {},
      });
      setMsg(
        foreign
          ? `${foreign} subjects in the file are not in this study and were left out`
          : "loaded",
      );
    } catch {
      setMsg("not a SEND export spec file");
    }
  };
  return (
    <>
      <button onClick={save}>Save spec (JSON)</button>
      <label className="upload small">
        Load spec{" "}
        <input
          type="file"
          accept="application/json"
          onChange={(e) => load(e.target.files?.[0])}
        />
      </label>
      {msg && <span className="small muted">{msg}</span>}
    </>
  );
}
