/**
 * Shared display primitives.
 *
 * Presentation only. Nothing here formats a value it was not given, and an
 * absent block renders the engine's stated reason rather than a blank.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CircleHelp, Layers, LoaderCircle } from "lucide-react";
import { num, text, titleCase, tone, type Tone } from "../lib/format";
import { t } from "../i18n";

export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  const band = tone(status);
  return <span className={`pill ${band}`}>{label ?? (status ? t(titleCase(String(status))) : t("unknown"))}</span>;
}

export function Card({ icon, title, subtitle, note, children, actions, accent }: {
  icon?: ReactNode; title: string; subtitle?: string; note?: string | null;
  actions?: ReactNode; children: ReactNode; accent?: "l1" | "l2" | "l3" | "l4";
}) {
  const style = accent ? ({ ["--brand-700" as string]: `var(--${accent})` }) : undefined;
  return <article className="l3-card" style={style as React.CSSProperties}>
    <h3>{icon}{title}{actions && <span className="card-actions">{actions}</span>}</h3>
    {subtitle && <p className="card-sub">{subtitle}</p>}
    {children}
    {note && <p className="limitation"><CircleHelp size={13} /> {note}</p>}
  </article>;
}

export function SectionHeader({ icon, eyebrow, title, description, actions, accent }: {
  icon: ReactNode; eyebrow?: string; title: string; description?: string; actions?: ReactNode;
  accent?: "l1" | "l2" | "l3" | "l4";
}) {
  const style = accent
    ? ({
      ["--accent-soft" as string]: `var(--${accent}-soft)`,
      ["--accent-line" as string]: `var(--${accent}-line)`,
      ["--accent-ink" as string]: `var(--${accent})`,
    })
    : undefined;
  return <div className="section-header" style={style as React.CSSProperties}>
    <div className="icon">{icon}</div>
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {description && <span className="desc">{description}</span>}
    </div>
    {actions && <div className="actions">{actions}</div>}
  </div>;
}

export function Unavailable({ title, reason, remediation }: { title: string; reason?: string | null; remediation?: string | null }) {
  return <article className="l3-card card-unavailable">
    <h3><AlertTriangle size={16} /> {title}</h3>
    <p>{reason ?? t("This result is not available.")}</p>
    {remediation && <p className="remediation"><b>{t("To enable it:")}</b> {remediation}</p>}
  </article>;
}

export type Field = { label?: unknown; value?: unknown };
export type Group = { title?: unknown; fields?: Field[] };

export function PresentationGroups({ groups }: { groups?: Group[] }) {
  const visible = (groups ?? []).filter((group) => (group.fields ?? []).length > 0);
  if (!visible.length) return null;
  return <div className="pres-stack">
    {visible.map((group, groupIndex) => (
      <article key={`${text(group.title)}-${groupIndex}`} className="pres-group">
        <h4>{text(group.title)}</h4>
        <div className="dl-grid">
          {(group.fields ?? [])
            .filter((field) => field.value !== null && field.value !== undefined && field.value !== "")
            .map((field, fieldIndex) => {
              const label = text(field.label);
              const value = text(field.value);
              const narrative = /limitation|note|rationale|reason|interpretation|basis|summary|scope|caveat/i.test(label) || value.length > 88;
              return <div key={`${label}-${fieldIndex}`} className={narrative ? "narrative" : undefined}>
                <dt>{label}</dt><dd>{value}</dd>
              </div>;
            })}
        </div>
      </article>
    ))}
  </div>;
}

export function DataTable<T>({ columns, rows, empty }: {
  columns: Array<{ key: string; header: string; render: (row: T, index: number) => ReactNode; align?: "left" | "right" }>;
  rows: T[]; empty?: string;
}) {
  if (!rows.length) return <p className="hint-muted">{empty ?? t("No rows were returned.")}</p>;
  return <div className="table-scroll">
    <table className="data">
      <thead><tr>{columns.map((column) => <th key={column.key} style={column.align === "right" ? { textAlign: "right" } : undefined}>{column.header}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={index}>
          {columns.map((column) => <td key={column.key} style={column.align === "right" ? { textAlign: "right" } : undefined}>{column.render(row, index)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export function DlGrid({ entries }: { entries: Array<[string, unknown]> }) {
  return <div className="dl-grid">
    {entries.map(([label, value], index) => {
      const rendered = text(value);
      const narrative = rendered.length > 88;
      return <div key={`${label}-${index}`} className={narrative ? "narrative" : undefined}>
        <dt>{label}</dt><dd>{rendered}</dd>
      </div>;
    })}
  </div>;
}

export function Anchors({ entries }: { entries: Array<[string, ReactNode]> }) {
  return <div className="anchors">
    {entries.map(([label, value], index) => <div key={index}><b>{label}</b><span>{value}</span></div>)}
  </div>;
}

export function Notice({ kind = "info", icon, children }: { kind?: "info" | "warn" | "error" | "good" | "plain"; icon?: ReactNode; children: ReactNode }) {
  return <div className={`notice ${kind === "plain" ? "" : kind}`}>{icon}<span>{children}</span></div>;
}

export function DossierFlow({ dossier }: { dossier?: { available?: boolean; reason?: string; sections?: Array<Record<string, any>> } }) {
  if (!dossier) return null;
  if (dossier.available === false) return <Unavailable title={t("Study workflow")} reason={dossier.reason} />;
  return <Card icon={<Layers size={16} />} title={t("Study workflow")} subtitle={t("The order a reviewer reads this layer, and which block produces each part. It is an index over the record; it derives nothing.")}>
    <div className="dossier">
      {(dossier.sections ?? []).map((section) => (
        <section key={String(section.id ?? section.sequence)} className={`dossier-section ${section.status ?? ""}`}>
          <div className="dossier-head">
            <span className="dossier-seq">{section.sequence ?? "—"}</span>
            <div><b>{t(text(section.title))}</b><span>{t(text(section.purpose))}</span></div>
            <StatusPill status={section.status} />
          </div>
        </section>
      ))}
    </div>
  </Card>;
}

/**
 * Elapsed-time run indicator. There is no server-side progress to report, so
 * rather than fake a percentage this shows the real elapsed time beside the
 * ordered list of work, and marks the current step as an expectation derived
 * from the clock rather than from a signal.
 */
export function RunProgress({ steps, typicalSeconds, title }: { steps: string[]; typicalSeconds: number; title: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, []);
  const perStep = typicalSeconds / Math.max(steps.length, 1);
  const expected = Math.min(Math.floor(elapsed / perStep), steps.length - 1);
  const overdue = elapsed > typicalSeconds;
  return <div className="progress">
    <div className="progress-head">
      <LoaderCircle size={22} className="spin" style={{ color: "var(--brand)" }} />
      <div><b>{t(title)}</b><span>{t("{n}s elapsed", { n: elapsed })}{overdue ? t(" · longer than usual, still running") : t(" · usually about {n}s", { n: typicalSeconds })}</span></div>
    </div>
    <ol className="progress-steps">
      {steps.map((step, index) => <li key={step} className={index < expected ? "past" : index === expected ? "current" : "future"}>{t(step)}</li>)}
    </ol>
    <p className="progress-note">{t("Steps are the engine's fixed order of work. The highlighted step is estimated from elapsed time; it is not reported by the engine.")}</p>
  </div>;
}

export function Tile({ icon, label, value, unit, note, tone: band = "neutral" }: {
  icon?: ReactNode; label: string; value: ReactNode; unit?: string; note?: string; tone?: Tone | "brand";
}) {
  return <article className={`tile ${band}`}>
    {icon && <span className="tile-icon">{icon}</span>}
    <span className="tile-label">{label}</span>
    <b className="tile-value">{value}{unit && <em>{unit}</em>}</b>
    {note && <small className="tile-note">{note}</small>}
  </article>;
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div className="tile-row">{children}</div>;
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

export function downloadText(content: string, filename: string, type = "text/markdown") {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export { num, text, titleCase, tone };
