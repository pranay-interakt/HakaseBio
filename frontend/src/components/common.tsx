import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type ReactNode } from "react";
import { ApiError } from "../api";
import { stateLabel } from "../lib/format";
import { isQuantity, type Table } from "../types";
import { CitationLine, ProvenanceLegend, QuantityView } from "./QuantityView";
import logoOnDark from "../assets/hakase-logo-on-dark.png";
import logoOnLight from "../assets/hakase-logo-on-light.png";

const ERROR_TITLES: Record<number, string> = {
  400: "That could not be done",
  401: "Please sign in again",
  403: "Not allowed",
  404: "Not found",
  409: "Not possible at this stage",
  413: "Too large",
  422: "Please check the form",
  429: "Too many attempts",
  500: "Something went wrong",
  503: "The system is busy",
};

export function ErrorBox({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="error" role="alert">
      <div className="error-head">
        <strong>{(e.status && ERROR_TITLES[e.status]) ?? "Error"}</strong>
        {onDismiss && (
          <button className="icon-btn small" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </div>
      <div>{e.message ?? String(error)}</div>
      {e.errors && e.errors.length > 0 && (
        <ul>
          {e.errors.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {e.requestId && <div className="muted small">Reference {e.requestId}</div>}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Cell({ v }: { v: unknown }) {
  if (isQuantity(v)) return <QuantityView q={v} compact />;
  if (v === null || v === undefined) return <span className="muted">—</span>;
  return <>{String(v)}</>;
}

const numeric = (v: unknown) => isQuantity(v) || typeof v === "number";

export function DataTable({ t }: { t: Table }) {
  const numCols = t.columns.map((_, j) => t.rows.length > 0 && t.rows.every((r) => r[j] === null || numeric(r[j])));
  return (
    <div className="table-block">
      <div className="table-title">{t.title}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {t.columns.map((c, j) => (
                <th key={c} className={numCols[j] ? "num" : undefined}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={numCols[j] ? "num" : undefined}>
                    <Cell v={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.note && <div className="muted small">{t.note}</div>}
      {t.rows.some((r) => r.some(isQuantity)) && <ProvenanceLegend />}
    </div>
  );
}

export function Section({
  title,
  children,
  right,
  id,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  id?: string;
  subtitle?: ReactNode;
}) {
  return (
    <section className="card" id={id}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
        {right && <div className="card-actions">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Citations({
  list,
}: {
  list: { key: string; text: string; doi?: string | null; url?: string | null }[];
}) {
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
  const steps = IMPORT_LIFECYCLE.includes(state) || state === "superseded" ? IMPORT_LIFECYCLE : LIFECYCLE;
  const idx = steps.indexOf(state);
  const ended = state === "cancelled" || state === "failed" || state === "superseded";
  return (
    <ol className="stepper" aria-label="Study progress">
      {steps.map((s, i) => (
        <li key={s} className={ended || i < idx ? "done" : i === idx ? "current" : ""}>
          <span className="step-dot" aria-hidden>
            {ended || i < idx ? "✓" : i + 1}
          </span>
          <span className="step-label">{stateLabel(s)}</span>
        </li>
      ))}
      {ended && (
        <li className={state === "superseded" ? "current" : "current bad"}>
          <span className="step-dot" aria-hidden>
            {state === "superseded" ? "↺" : "×"}
          </span>
          <span className="step-label">{stateLabel(state)}</span>
        </li>
      )}
    </ol>
  );
}

const STATE_TONE: Record<string, string> = {
  approved: "ok",
  imported: "info",
  reported: "accent",
  analyzed: "accent",
  cancelled: "bad",
  failed: "bad",
  superseded: "neutral",
};

export function StateTag({ state, simulated }: { state: string; simulated?: boolean }) {
  return (
    <span
      className={`pill pill-${STATE_TONE[state] ?? "neutral"}${simulated ? " has-sim" : ""}`}
      title={simulated ? "Contains simulated data: never approved or used as evidence" : undefined}
    >
      {stateLabel(state)}
      {simulated && <span className="sim-mark">SIM</span>}
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
