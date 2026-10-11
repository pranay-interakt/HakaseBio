// CTD Module 2.4 and 2.6 (ICH M4S(R2)): the nonclinical overview and summaries, drafted from
// the programme's approved and imported studies. Every number links to its source; the author
// writes the interpretation; a named person signs a fixed version (docs/14 P6).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { ErrorBox, roleLabel, Section } from "../components/common";
import { QuantityView } from "../components/QuantityView";
import { Empty, Loading, Pill, toast } from "../components/ui";
import { fmtDate, fmtDateTime, meaningLabel, shortHash } from "../lib/format";
import { href } from "../lib/router";
import type { Principal, Quantity } from "../types";

interface Determination {
  key: string;
  label: string;
  quantity: Quantity | null;
  category: string | null;
  signer: string;
  role: string;
  signed_at: string;
}
type Cell =
  | string
  | number
  | null
  | { study: string; text: string }
  | { quantity: Quantity; source: { study_id: string; key: string } }
  | { determination: Determination; source: { study_id: string; key: string } }
  | { imported: { quantity: Quantity | null; category: string | null }; source: { study_id: string; page: string; table: string | null } }
  | { cells: Cell[] }
  | { findings: { determinations: Cell[]; statements: { text: string; basis: string; severity: string }[] }; source: { study_id: string } };

interface SummaryTable {
  number: string;
  title: string;
  columns: string[];
  rows: Cell[][];
  notes: string[];
  source: string | null;
}
interface SectionDoc {
  id: string;
  title: string;
  author_required: boolean;
  author_text: string;
  drafted: { segments: Cell[]; sources: string[] }[];
}
interface Doc {
  version: number;
  status: "draft" | "signed";
  content_hash: string;
  created_by: string;
  created_at: string;
  reason: string | null;
  signatures: { signer_name: string; role: string; meaning: string; statement: string; signed_at: string }[];
  missing_author_sections: string[];
  content: {
    standard: string;
    test_article: string[];
    studies: { study_id: string; title: string; number: string; section: string; glp: boolean; imported: boolean }[];
    excluded: { study_id: string; title: string; reason: string }[];
    tables: SummaryTable[];
    sections: SectionDoc[];
  };
}
interface Listing {
  versions: { version: number; status: string; created_by: string; created_at: string; reason: string | null }[];
  latest: Doc | null;
}

const PARTS: { id: string; label: string; sections?: (id: string) => boolean; tables?: string }[] = [
  { id: "2.4", label: "2.4 Nonclinical overview", sections: (s) => s.startsWith("2.4.") },
  { id: "2.6.1", label: "2.6.1 Introduction", sections: (s) => s === "2.6.1" },
  { id: "2.6.2", label: "2.6.2 Pharmacology written summary", sections: (s) => s.startsWith("2.6.2.") },
  { id: "2.6.3", label: "2.6.3 Pharmacology tabulated summary", tables: "2.6.3." },
  { id: "2.6.4", label: "2.6.4 Pharmacokinetics written summary", sections: (s) => s.startsWith("2.6.4.") },
  { id: "2.6.5", label: "2.6.5 Pharmacokinetics tabulated summary", tables: "2.6.5." },
  { id: "2.6.6", label: "2.6.6 Toxicology written summary", sections: (s) => s.startsWith("2.6.6.") },
  { id: "2.6.7", label: "2.6.7 Toxicology tabulated summary", tables: "2.6.7." },
];

function StudyLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <a href={href.study(id)} title="Open the source study">
      {children}
    </a>
  );
}

/** One cell of a table or drafted paragraph; every value names where it came from. */
function CellView({ c }: { c: Cell }) {
  if (c === null || c === undefined || c === "") return <span className="muted">—</span>;
  if (typeof c === "string" || typeof c === "number") return <>{c}</>;
  if ("study" in c) return <StudyLink id={c.study}>{c.text}</StudyLink>;
  if ("cells" in c)
    return (
      <>
        {c.cells.map((x, i) => (
          <div key={i}>
            <CellView c={x} />
          </div>
        ))}
      </>
    );
  if ("findings" in c) {
    const f = c.findings;
    if (f.determinations.length === 0 && f.statements.length === 0) return <span className="muted">none noted</span>;
    return (
      <ul className="list small" style={{ margin: 0 }}>
        {f.determinations.map((d, i) => (
          <li key={`d${i}`}>
            <CellView c={d} />
          </li>
        ))}
        {f.statements.map((s, i) => (
          <li key={`s${i}`} className={s.severity === "concern" ? "qc-fail" : "qc-warn"}>
            {s.text}
          </li>
        ))}
      </ul>
    );
  }
  if ("determination" in c) {
    const d = c.determination;
    return (
      <span>
        {d.quantity ? <QuantityView q={d.quantity} /> : <span className="tag">{d.category}</span>}{" "}
        <span className="muted small">
          signed by {d.signer} ({roleLabel(d.role)}) · <StudyLink id={c.source.study_id}>source</StudyLink>
        </span>
      </span>
    );
  }
  if ("imported" in c) {
    const i = c.imported;
    return (
      <span>
        {i.quantity ? <QuantityView q={i.quantity} /> : <span className="tag">{i.category}</span>}{" "}
        <span className="muted small">
          <StudyLink id={c.source.study_id}>report p. {c.source.page}</StudyLink>
        </span>
      </span>
    );
  }
  if ("quantity" in c)
    return (
      <span>
        <QuantityView q={c.quantity} />{" "}
        <StudyLink id={c.source.study_id}>
          <span className="small" aria-label="source study">
            ↗
          </span>
        </StudyLink>
      </span>
    );
  return null;
}

function TableView({ t }: { t: SummaryTable }) {
  return (
    <div className="table-block" id={`t-${t.number}`}>
      <div className="table-title">
        Table {t.number} · {t.title}
        {t.source && (
          <span className="muted small">
            {" "}
            · from <StudyLink id={t.source}>{t.source}</StudyLink>
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              {t.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    <CellView c={c} />
                  </td>
                ))}
              </tr>
            ))}
            {t.rows.length === 0 && (
              <tr>
                <td colSpan={t.columns.length} className="muted">
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {t.notes.map((n, i) => (
        <div key={i} className="muted small">
          {n}
        </div>
      ))}
    </div>
  );
}

function SectionView({ s, editable, onSave }: { s: SectionDoc; editable: boolean; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(s.author_text ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(s.author_text ?? ""), [s.author_text]);
  const dirty = text !== (s.author_text ?? "");
  const number = s.id.startsWith("2.4.") ? "" : `${s.id} `;
  return (
    <div className="m2-section" id={`s-${s.id}`}>
      <h4>
        {number}
        {s.title}{" "}
        {s.author_required && !(s.author_text ?? "").trim() && <Pill tone="warn">author&apos;s text needed</Pill>}
      </h4>
      {s.drafted.map((p, i) => (
        <p key={i} className="drafted">
          {p.segments.map((seg, j) => (
            <CellView key={j} c={seg} />
          ))}
        </p>
      ))}
      {editable ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea
            className="prose"
            rows={s.author_required ? 4 : 2}
            placeholder={s.author_required ? "The author's assessment for this section *" : "Optional author's text"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {dirty && (
            <div>
              <button
                className="small primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSave(text);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save as a new version
              </button>
            </div>
          )}
        </div>
      ) : (
        s.author_text && <div className="author-text">{s.author_text}</div>
      )}
    </div>
  );
}

export function ProgramSummaries({ programId, me }: { programId: string; me: Principal }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState("2.4");
  const base = `/programs/${programId}/summaries`;
  const load = useCallback(async () => {
    const l = await api.get<Listing>(base);
    setListing(l);
    setDoc(l.latest);
  }, [base]);
  useEffect(() => {
    load().catch(setErr);
  }, [load]);

  const latest = listing?.versions[listing.versions.length - 1]?.version;
  const editable = !!doc && doc.status === "draft" && doc.version === latest;

  async function draft() {
    setBusy(true);
    setErr(null);
    try {
      const d = await api.post<Doc>(base, {});
      toast(`Version ${d.version} drafted from the current studies`);
      await load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveSection(sid: string, text: string) {
    if (!doc) return;
    try {
      const d = await api.put<Doc>(`${base}/${doc.version}/sections/${sid}`, { text });
      toast(`Saved as version ${d.version}`);
      const l = await api.get<Listing>(base);
      setListing(l);
      setDoc(d);
    } catch (e) {
      setErr(e);
    }
  }
  async function openVersion(v: number) {
    try {
      setDoc(await api.get<Doc>(`${base}/${v}`));
    } catch (e) {
      setErr(e);
    }
  }

  const shown = useMemo(() => {
    if (!doc) return null;
    const p = PARTS.find((x) => x.id === part)!;
    return {
      sections: p.sections ? doc.content.sections.filter((s) => p.sections!(s.id)) : [],
      tables: p.tables ? doc.content.tables.filter((t) => t.number.startsWith(p.tables!)) : [],
      isTables: !!p.tables,
    };
  }, [doc, part]);

  if (!listing) return err ? <ErrorBox error={err} /> : <Loading />;
  return (
    <>
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      <Section
        title="Module 2: nonclinical overview and summaries"
        subtitle="ICH M4S(R2) sections 2.4 and 2.6, drafted from approved studies and completed imports. The system drafts factual, sourced sentences and the tabulated summaries; interpretation and conclusions are the author's; a named person signs a fixed version."
        right={
          <button className="primary" disabled={busy} onClick={draft}>
            {busy ? "Drafting…" : doc ? "Draft a new version from current studies" : "Draft from current studies"}
          </button>
        }
      >
        {!doc ? (
          <Empty title="No draft yet">Drafting reads every approved study and completed import of this programme.</Empty>
        ) : (
          <div className="stack">
            <div className="row">
              <label className="row small">
                Version
                <select style={{ width: "auto" }} value={doc.version} onChange={(e) => openVersion(Number(e.target.value))}>
                  {[...listing.versions].reverse().map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} · {v.status} · {fmtDate(v.created_at)}
                    </option>
                  ))}
                </select>
              </label>
              <Pill tone={doc.status === "signed" ? "ok" : "accent"}>{doc.status === "signed" ? "Signed" : "Draft"}</Pill>
              {doc.version !== latest && <Pill tone="neutral">earlier version</Pill>}
              <span className="muted small">
                by {doc.created_by}, {fmtDateTime(doc.created_at)} · fingerprint <span className="mono">{shortHash(doc.content_hash, 12)}</span>
              </span>
              <span className="spacer" />
              <button className="small" onClick={() => api.download(`${base}/${doc.version}/markdown`, `module2_nonclinical_v${doc.version}.md`).catch(setErr)}>
                Download Markdown
              </button>
            </div>
            <div className="small">
              Test article: <strong>{doc.content.test_article.join(", ") || "—"}</strong> · built from {doc.content.studies.length} stud
              {doc.content.studies.length === 1 ? "y" : "ies"}:{" "}
              {doc.content.studies.map((s, i) => (
                <span key={s.study_id}>
                  {i > 0 && ", "}
                  <StudyLink id={s.study_id}>{s.title}</StudyLink>
                  {s.imported && " (imported)"}
                </span>
              ))}
            </div>
            {doc.content.excluded.length > 0 && (
              <details className="small">
                <summary className="muted">{doc.content.excluded.length} studies not used</summary>
                <ul className="list">
                  {doc.content.excluded.map((e) => (
                    <li key={e.study_id}>
                      <StudyLink id={e.study_id}>{e.title}</StudyLink>: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>
      {doc && shown && (
        <div className="with-toc m2-layout">
          <Section title={PARTS.find((p) => p.id === part)!.label}>
            {shown.isTables ? (
              shown.tables.length === 0 ? (
                <Empty title="No tables in this part">No included study belongs here.</Empty>
              ) : (
                shown.tables.map((t, i) => <TableView key={`${t.number}-${i}`} t={t} />)
              )
            ) : (
              shown.sections.map((s) => (
                <SectionView key={`${doc.version}-${s.id}`} s={s} editable={editable} onSave={(t) => saveSection(s.id, t)} />
              ))
            )}
          </Section>
          <nav className="page-toc" aria-label="Module 2 parts">
            <div className="page-toc-title">Module 2</div>
            {PARTS.map((p) => (
              <button key={p.id} className={p.id === part ? "active" : ""} onClick={() => setPart(p.id)}>
                {p.label}
              </button>
            ))}
          </nav>
        </div>
      )}
      {doc && <SignPanel doc={doc} me={me} base={base} latest={latest} onSigned={load} onErr={setErr} />}
    </>
  );
}

const SIGNING = ["responsible_scientist", "program_lead"];

function SignPanel({
  doc,
  me,
  base,
  latest,
  onSigned,
  onErr,
}: {
  doc: Doc;
  me: Principal;
  base: string;
  latest: number | undefined;
  onSigned: () => Promise<void>;
  onErr: (e: unknown) => void;
}) {
  const roles = me.roles.filter((r) => SIGNING.includes(r));
  const [role, setRole] = useState(roles[0] ?? "");
  const [meaning, setMeaning] = useState("authorship");
  const [statement, setStatement] = useState("");
  const [pw, setPw] = useState("");
  if (doc.status === "signed")
    return (
      <Section title="Signature">
        {doc.signatures.map((s, i) => (
          <div key={i} className="signed small">
            <strong>{s.signer_name}</strong> — {roleLabel(s.role)} ({meaningLabel(s.meaning).toLowerCase()}), {fmtDateTime(s.signed_at)}: “{s.statement}”
          </div>
        ))}
        <p className="muted small">A signed version is never edited. Drafting again starts a new version that keeps the author&apos;s text.</p>
      </Section>
    );
  if (doc.version !== latest) return null;
  return (
    <Section title="Sign this version" subtitle="Signed by a Responsible Scientist or Programme Lead; the signature fixes this version.">
      {doc.missing_author_sections.length > 0 && (
        <div className="note small">Before signing, the author&apos;s text is needed in: {doc.missing_author_sections.join("; ")}.</div>
      )}
      {me.kind !== "human" || roles.length === 0 ? (
        <p className="muted small">You do not hold a role that signs the summaries.</p>
      ) : (
        <>
          <div className="grid2" style={{ marginTop: 8 }}>
            <label className="field">
              <span className="field-label">Signing as *</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Meaning *</span>
              <select value={meaning} onChange={(e) => setMeaning(e.target.value)}>
                {["authorship", "approval", "review"].map((m) => (
                  <option key={m} value={m}>
                    {meaningLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Statement *</span>
              <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="I am the author of these summaries." />
            </label>
            <label className="field">
              <span className="field-label">Your password *</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            </label>
          </div>
          <div className="row-end">
            <button
              className="primary"
              disabled={!statement.trim() || !pw || doc.missing_author_sections.length > 0}
              onClick={async () => {
                try {
                  await api.post(`${base}/${doc.version}/sign`, { role, meaning, statement, password: pw });
                  setPw("");
                  toast(`Version ${doc.version} signed`);
                  await onSigned();
                } catch (e) {
                  onErr(e);
                }
              }}
            >
              Sign version {doc.version}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
