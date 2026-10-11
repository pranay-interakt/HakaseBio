import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type ReactNode } from "react";
import { ApiError } from "../api";
import { isQuantity, type Table } from "../types";
import { CitationLine, QuantityView } from "./QuantityView";
import logoOnDark from "../assets/hakase-logo-on-dark.png";
import logoOnLight from "../assets/hakase-logo-on-light.png";

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="error">
      <strong>{e.status ? `Error ${e.status}: ` : "Error: "}</strong>
      {e.message ?? String(error)}
      {e.errors && e.errors.length > 0 && (
        <ul>
          {e.errors.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Cell({ v }: { v: unknown }) {
  if (isQuantity(v)) return <QuantityView q={v} />;
  if (v === null || v === undefined) return <span className="muted">—</span>;
  return <>{String(v)}</>;
}

export function DataTable({ t }: { t: Table }) {
  return (
    <div className="table-wrap">
      <div className="table-title">{t.title}</div>
      <table>
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <Cell v={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.note && <div className="muted small">{t.note}</div>}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Citations({ list }: { list: { key: string; text: string; doi?: string | null; url?: string | null }[] }) {
  return (
    <ul className="cites">
      {list.map((c) => (
        <CitationLine key={c.key} c={c} />
      ))}
    </ul>
  );
}

export const LIFECYCLE = [
  "proposed",
  "designed",
  "planned",
  "dispatched",
  "data_received",
  "analyzed",
  "reported",
  "approved",
];

export const IMPORT_LIFECYCLE = ["import_draft", "imported"];

export function Lifecycle({ state }: { state: string }) {
  if (IMPORT_LIFECYCLE.includes(state) || state === "superseded") {
    const i = IMPORT_LIFECYCLE.indexOf(state);
    return (
      <ol className="lifecycle">
        {IMPORT_LIFECYCLE.map((x, j) => (
          <li key={x} className={state === "superseded" || j < i ? "done" : j === i ? "current" : ""}>
            {x.replace("_", " ")}
          </li>
        ))}
        {state === "superseded" && <li className="current">superseded</li>}
      </ol>
    );
  }
  const idx = LIFECYCLE.indexOf(state);
  return (
    <ol className="lifecycle">
      {LIFECYCLE.map((s, i) => (
        <li key={s} className={i < idx ? "done" : i === idx ? "current" : ""}>
          {s.replace("_", " ")}
        </li>
      ))}
      {(state === "cancelled" || state === "failed") && <li className="current bad">{state}</li>}
    </ol>
  );
}

export function StateTag({ state, simulated }: { state: string; simulated?: boolean }) {
  return (
    <span className={`tag tag-${state}`}>
      {state.replace("_", " ")}
      {simulated && <span className="badge badge-simulated"> SIMULATED</span>}
    </span>
  );
}

/** The Hakase AI logo; the variant follows the colour scheme (styles.css .logo-*). */
export function Logo({ height }: { height: number }) {
  return (
    <span className="logo" style={{ height }}>
      <img className="logo-on-light" src={logoOnLight} alt="Hakase AI" style={{ height }} />
      <img className="logo-on-dark" src={logoOnDark} alt="Hakase AI" style={{ height }} />
    </span>
  );
}

const ROLE_LABELS: Record<string, string> = {
  study_director: "Study Director",
  quality_assurance: "Quality Assurance",
  attending_veterinarian: "Attending Veterinarian",
  qualified_person: "Qualified Person",
  responsible_scientist: "Responsible Scientist",
  scientist: "Scientist",
  program_lead: "Programme Lead",
  admin: "Administrator",
};

/** A role as people read it (study_director -> Study Director). */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}
