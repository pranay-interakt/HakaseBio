// Shared building blocks for every page: navigation, headers, tabs, feedback, and readable views
// of structured values (no raw JSON on screen).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { humanize } from "../lib/format";
import { isQuantity } from "../types";
import { QuantityView } from "./QuantityView";

// ---------------------------------------------------------------------------------------------
// breadcrumbs: pages declare where they are; the top bar shows it

export interface Crumb {
  label: string;
  href?: string;
}

interface CrumbState {
  hash: string;
  crumbs: Crumb[];
}

const CrumbContext = createContext<(s: CrumbState) => void>(() => undefined);

export function CrumbProvider({ set, children }: { set: (s: CrumbState) => void; children: ReactNode }) {
  return <CrumbContext.Provider value={set}>{children}</CrumbContext.Provider>;
}

/** Declare this page's place in the hierarchy (shown in the top bar). */
export function useBreadcrumbs(crumbs: Crumb[]): void {
  const set = useContext(CrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set({ hash: window.location.hash || "#/", crumbs: JSON.parse(key) as Crumb[] });
  }, [key, set]);
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="crumb">
          {i > 0 && <span className="crumb-sep" aria-hidden>›</span>}
          {c.href && i < crumbs.length - 1 ? (
            <a href={c.href}>{c.label}</a>
          ) : (
            <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function NavArrows({ canBack, canForward }: { canBack: boolean; canForward: boolean }) {
  return (
    <span className="nav-arrows">
      <button className="icon-btn" disabled={!canBack} onClick={() => window.history.back()} title="Back (Alt+←)" aria-label="Back">
        ←
      </button>
      <button className="icon-btn" disabled={!canForward} onClick={() => window.history.forward()} title="Forward (Alt+→)" aria-label="Forward">
        →
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// page structure

export function PageHeader({
  title,
  eyebrow,
  meta,
  actions,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
      {children && <div className="page-header-extra">{children}</div>}
    </header>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

/** Tabs are links, so each tab has its own URL and back/forward moves between tabs. */
export function Tabs({ items, active, hrefFor }: { items: TabItem[]; active: string; hrefFor: (id: string) => string }) {
  return (
    <nav className="tabs" role="tablist">
      {items.map((t) => (
        <a key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? "tab active" : "tab"} href={hrefFor(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </a>
      ))}
    </nav>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** A two-column list of labelled facts. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v], i) => (
        <div key={i} className="fact">
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A card section that can be collapsed; the open state is remembered per title. */
export function Collapsible({
  id,
  title,
  right,
  defaultOpen = true,
  children,
}: {
  id?: string;
  title: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`card collapsible ${open ? "open" : ""}`} id={id}>
      <div className="card-head">
        <button className="collapse-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <h3>{title}</h3>
        </button>
        {right}
      </div>
      {open && <div className="card-body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// readable structured values

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function Scalar({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (typeof v === "boolean") return <>{v ? "Yes" : "No"}</>;
  if (isQuantity(v)) return <QuantityView q={v} />;
  return <>{String(v)}</>;
}

/** Any JSON-like value as tables and lists, never as JSON text. */
export function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isQuantity(value)) return <QuantityView q={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">none</span>;
    if (value.every((x) => !isPlainObject(x) && !Array.isArray(x)))
      return <>{value.map((x) => (x === null ? "—" : String(x))).join(", ")}</>;
    if (value.every(isPlainObject)) {
      const cols = Array.from(new Set(value.flatMap((x) => Object.keys(x as object))));
      return (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{humanize(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>
                      <ValueView value={(row as Record<string, unknown>)[c]} depth={depth + 1} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <ul className="list">
        {value.map((x, i) => (
          <li key={i}>
            <ValueView value={x} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="muted">none</span>;
    return (
      <dl className={depth === 0 ? "facts" : "facts nested"}>
        {entries.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{humanize(k)}</dt>
            <dd>
              <ValueView value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Scalar v={value} />;
}

// ---------------------------------------------------------------------------------------------
// toasts: short confirmations of what just happened

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "bad" | "info";
}
const TOAST_EVENT = "hos:toast";
let nextToast = 1;

export function toast(text: string, tone: Toast["tone"] = "ok"): void {
  window.dispatchEvent(new CustomEvent<Toast>(TOAST_EVENT, { detail: { id: nextToast++, text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((xs) => [...xs, t]);
      timers.current.push(window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4000));
    };
    window.addEventListener(TOAST_EVENT, on);
    const pending = timers.current;
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      pending.forEach((h) => window.clearTimeout(h));
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// user menu

export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="menu-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
