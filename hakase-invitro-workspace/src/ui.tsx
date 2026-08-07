/**
 * Shared display primitives for the layer workspaces.
 *
 * Every helper here is presentation only. Nothing formats a value it was not
 * given, and nothing substitutes a placeholder number for a missing one — an
 * absent value renders as an em dash and an absent *block* renders as the
 * backend's stated reason, never as a blank or a zero.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CircleHelp, LoaderCircle } from "lucide-react";

export const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";

/** Format a number for display; anything non-numeric becomes an em dash. */
export function num(value: unknown, digits = 3): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e5)) return value.toExponential(2);
  return Number(value.toFixed(digits)).toString();
}

/** Format a 0–1 fraction as a percentage, or an em dash. */
export function pct(value: unknown, digits = 0): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Render any scalar the backend returned; objects are never stringified blind. */
export function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return num(value);
  if (Array.isArray(value)) return value.length ? value.map((v) => text(v)).join(", ") : "—";
  if (typeof value === "object") return "—";
  return String(value);
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Hazard / status band → the shared pill class set. */
export function bandClass(band?: string | null): string {
  const value = (band ?? "").toLowerCase();
  if (["pass", "low", "live", "go", "ready", "comfortable", "low_concern", "favorable", "computed", "conformant"].includes(value)) return "l3-pill-pass";
  if (["fail", "high", "no-go", "not-ready", "not-fileable", "exceeded", "concern", "unfavorable"].includes(value)) return "l3-pill-fail";
  if (["caution", "moderate", "conditional", "monitor", "narrow", "modest", "borderline", "advised", "partially_computed", "watch"].includes(value)) return "l3-pill-caution";
  return "l3-pill-unknown";
}

export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  return <span className={`l3-pill ${bandClass(status)}`}>{label ?? (status ? titleCase(status) : "unknown")}</span>;
}

/** A titled result card. `note` renders the block's own limitations verbatim. */
export function Card({ icon, title, subtitle, note, children, actions }: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  note?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <article className="l3-card">
    <h3>{icon}{title}{actions && <span className="l3-card-actions">{actions}</span>}</h3>
    {subtitle && <p className="l3-card-sub">{subtitle}</p>}
    {children}
    {note && <p className="l3-limitation"><CircleHelp size={13} /> {note}</p>}
  </article>;
}

/**
 * The standard "this block was not produced" state. It shows the backend's own
 * reason rather than inventing an explanation, because the reason is the
 * scientific content when a block is absent.
 */
export function Unavailable({ title, reason, remediation }: { title: string; reason?: string | null; remediation?: string | null }) {
  return <article className="l3-card l3-card-unavailable">
    <h3><AlertTriangle size={16} /> {title}</h3>
    <p>{reason ?? "This block was not produced by the backend and no reason was returned."}</p>
    {remediation && <p className="l3-remediation"><b>To enable it:</b> {remediation}</p>}
  </article>;
}

export type Field = { label?: unknown; value?: unknown };
export type Group = { title?: unknown; fields?: Field[] };

/**
 * Render the server-owned `presentation.groups` contract. Which fields exist
 * and what they are called is decided by the backend; this only lays them out.
 */
export function PresentationGroups({ groups }: { groups?: Group[] }) {
  const visible = (groups ?? []).filter((group) => (group.fields ?? []).length > 0);
  if (!visible.length) return null;
  return <div className="pres-stack">
    {visible.map((group, groupIndex) => (
      <article key={`${text(group.title)}-${groupIndex}`} className="pres-group">
        <h4>{text(group.title)}</h4>
        <dl>
          {(group.fields ?? []).map((field, fieldIndex) => {
            const label = text(field.label);
            const value = text(field.value);
            const narrative = value.length > 110;
            return <div key={`${label}-${fieldIndex}`} className={narrative ? "pres-field narrative" : "pres-field"}>
              <dt>{label}</dt><dd>{value}</dd>
            </div>;
          })}
        </dl>
      </article>
    ))}
  </div>;
}

/** A simple data table. Columns are supplied by the caller, values by the backend. */
export function DataTable<T>({ columns, rows, empty }: {
  columns: Array<{ key: string; header: string; render: (row: T) => ReactNode; align?: "left" | "right" }>;
  rows: T[];
  empty?: string;
}) {
  if (!rows.length) return <p className="l3-hint-muted">{empty ?? "No rows were returned."}</p>;
  return <div className="l3-table-scroll">
    <table className="l3-table">
      <thead><tr>{columns.map((c) => <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={index}>
          {columns.map((c) => <td key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>{c.render(row)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

/**
 * Elapsed-time run indicator for the long synchronous layer jobs.
 *
 * The Layer 3 and Layer 4 endpoints are single synchronous calls, so there is
 * no server-side progress to report. Rather than fake a percentage, this shows
 * the real elapsed time alongside the ordered list of work the server performs,
 * and marks the current step as an *expectation* — it is derived from the
 * elapsed clock, not from a server signal. Saying so is the point: an invented
 * progress bar would be the same class of error this platform avoids in its
 * science.
 */
export function RunProgress({ steps, typicalSeconds, title }: {
  steps: string[];
  typicalSeconds: number;
  title: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const perStep = typicalSeconds / Math.max(steps.length, 1);
  const expected = Math.min(Math.floor(elapsed / perStep), steps.length - 1);
  const overdue = elapsed > typicalSeconds;

  return <div className="run-progress">
    <div className="run-progress-head">
      <LoaderCircle size={20} className="spin" />
      <div>
        <b>{title}</b>
        <span>{elapsed}s elapsed{overdue ? " · longer than usual, still running" : ` · usually about ${typicalSeconds}s`}</span>
      </div>
    </div>
    <ol className="run-progress-steps">
      {steps.map((step, index) => <li
        key={step}
        className={index < expected ? "past" : index === expected ? "current" : "future"}
      >{step}</li>)}
    </ol>
    <small className="run-progress-note">
      Steps are the server's fixed order of work. The highlighted step is estimated from elapsed time, not reported by the server.
    </small>
  </div>;
}

/** Download a backend-generated Markdown document without re-deriving anything. */
export function downloadMarkdown(markdown: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
