import { useEffect, useState } from "react";
import { fmtDateTime } from "../lib/format";
import type { Citation, ProvenanceKind, Quantity } from "../types";

const KIND_LABEL: Record<ProvenanceKind, string> = {
  measured: "measured",
  literature: "literature",
  computed: "computed",
  predicted: "predicted",
  guideline: "guideline",
  user_supplied: "user supplied",
  simulated: "SIMULATED",
  unavailable: "unavailable",
};

// Display formatting only (significant figures); no arithmetic on scientific values.
export function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3);
  return Number(v.toPrecision(4)).toString();
}

function unitText(u: string): string {
  if (u === "dimensionless") return "";
  if (u === "percent") return " %";
  const shown = u
    .replace(/\bpercent\b/g, "%")
    .replace(/angstrom/g, "Å")
    .replace(/\*\*2\b/g, "²")
    .replace(/\*\*3\b/g, "³")
    .replace(/\*\*/g, "^");
  return ` ${shown}`;
}

export function CitationLine({ c }: { c: Citation }) {
  const href = c.doi ? `https://doi.org/${c.doi}` : (c.url ?? undefined);
  return (
    <li>
      <code>{c.key}</code> {c.text}{" "}
      {href && (
        <a href={href} target="_blank" rel="noreferrer">
          {c.doi ? `doi:${c.doi}` : "source"}
        </a>
      )}
    </li>
  );
}

export function ProvenanceBadge({ q }: { q: Quantity }) {
  const kind = q.provenance.kind;
  const tainted = (q.qc_flags ?? []).includes("derived_from_simulated_data");
  return (
    <span className={`badge badge-${tainted ? "simulated" : kind}`} title={q.provenance.notes ?? ""}>
      {tainted && kind !== "simulated" ? `${KIND_LABEL[kind]} · from SIMULATED` : KIND_LABEL[kind]}
    </span>
  );
}

export function Derivation({ q }: { q: Quantity }) {
  const p = q.provenance;
  return (
    <div className="derivation">
      {p.reason && (
        <p>
          <strong>Reason unavailable:</strong> {p.reason}
        </p>
      )}
      {p.method && (
        <div>
          <strong>Method:</strong>{" "}
          <code>
            {p.method.id}@{p.method.version}
          </code>{" "}
          {p.method.name}
          {p.method.assumptions.length > 0 && (
            <div className="muted">Assumptions: {p.method.assumptions.join("; ")}</div>
          )}
          {p.method.limits.length > 0 && <div className="muted">Limits: {p.method.limits.join("; ")}</div>}
        </div>
      )}
      {p.source_name && (
        <div>
          <strong>Source:</strong> {p.source_name}
          {p.source_record_id && (
            <>
              {" "}
              · record <code>{p.source_record_id}</code>
            </>
          )}
          {p.source_url && (
            <>
              {" "}
              ·{" "}
              <a href={p.source_url} target="_blank" rel="noreferrer">
                link
              </a>
            </>
          )}
          {p.retrieved_at && <> · retrieved {fmtDateTime(p.retrieved_at)}</>}
        </div>
      )}
      {p.actor && (
        <div>
          <strong>Actor:</strong> {p.actor}
        </div>
      )}
      {p.applicability && (
        <div>
          <strong>Applicability domain:</strong>{" "}
          {p.applicability.in_domain ? "inside" : `OUTSIDE — ${p.applicability.reason}`}
        </div>
      )}
      {p.parameter_set_version && (
        <div>
          <strong>Reference parameters:</strong> registry {p.parameter_set_version}
        </div>
      )}
      {Object.keys(p.software).length > 0 && (
        <div>
          <strong>Software:</strong>{" "}
          {Object.entries(p.software)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
        </div>
      )}
      {p.input_ids.length > 0 && (
        <div>
          <strong>Inputs:</strong>{" "}
          {p.input_ids.map((i) => (
            <code key={i}>{i} </code>
          ))}
        </div>
      )}
      {q.uncertainty && (
        <div>
          <strong>Uncertainty:</strong> {q.uncertainty.kind}
          {q.uncertainty.lower !== null && ` ${fmt(q.uncertainty.lower)}–${fmt(q.uncertainty.upper)}`}
          {q.uncertainty.sd !== null && ` SD ${fmt(q.uncertainty.sd)}`}
          {q.uncertainty.n !== null && ` n=${q.uncertainty.n}`}
        </div>
      )}
      {(q.qc_flags ?? []).length > 0 && (
        <div>
          <strong>QC flags:</strong>{" "}
          {(q.qc_flags ?? []).map((f) => (
            <span key={f} className="flag">
              {f}
            </span>
          ))}
        </div>
      )}
      {p.notes && <div className="muted">{p.notes}</div>}
      {p.citations.length > 0 && (
        <>
          <strong>Citations</strong>
          <ul className="cites">
            {p.citations.map((c) => (
              <CitationLine key={c.key} c={c} />
            ))}
          </ul>
        </>
      )}
      <div className="muted">
        id <code>{q.id}</code> · recorded {fmtDateTime(p.recorded_at)}
      </div>
    </div>
  );
}

const SHORT: Record<ProvenanceKind, string> = {
  measured: "M",
  literature: "L",
  computed: "C",
  predicted: "P",
  guideline: "G",
  user_supplied: "U",
  simulated: "SIM",
  unavailable: "—",
};

const DERIVATION_EVENT = "hos:derivation";

/** Show a value's derivation in the side panel (DerivationDrawer). */
export function openDerivation(q: Quantity): void {
  window.dispatchEvent(new CustomEvent<Quantity>(DERIVATION_EVENT, { detail: q }));
}

function ValueText({ q }: { q: Quantity }) {
  const u = q.uncertainty;
  if (!q.available) return <span className="unavail">unavailable</span>;
  return (
    <span className="qty-val">
      {fmt(q.value)}
      {unitText(q.unit)}
      {u && /^ci\d+$/.test(u.kind) && u.lower !== null && (
        <span className="muted">
          {" "}
          ({u.kind.slice(2)}% CI {fmt(u.lower)}–{fmt(u.upper)})
        </span>
      )}
      {u && u.kind === "range" && u.lower !== null && (
        <span className="muted">
          {" "}
          (range {fmt(u.lower)}–{fmt(u.upper)})
        </span>
      )}
      {u && u.kind === "sd" && u.sd !== null && <span className="muted"> ± {fmt(u.sd)} SD</span>}
    </span>
  );
}

/** A value with its provenance. ``compact`` (for tables) shows a one-letter provenance chip,
 * explained by ProvenanceLegend; a click opens the full derivation either way. */
export function QuantityView({
  q,
  showLabel = false,
  compact = false,
}: {
  q: Quantity;
  showLabel?: boolean;
  compact?: boolean;
}) {
  // Records are append-only, so a value stored by an earlier version of the system keeps
  // the shape it had then. Render what such a value does carry rather than failing — a
  // thrown error here blanks the whole page.
  if (!q || typeof q !== "object" || !q.provenance) {
    return <span className="muted">{q === null || q === undefined ? "—" : String(q)}</span>;
  }
  const flags = q.qc_flags ?? [];
  const tainted = flags.includes("derived_from_simulated_data");
  const kind = q.provenance.kind;
  const flagged = flags.filter((f) => f !== "derived_from_simulated_data").length > 0;
  return (
    <button
      className={`qty qty-btn${compact ? " compact" : ""}`}
      onClick={() => openDerivation(q)}
      title="Show how this value was obtained"
    >
      {showLabel && q.label && <span className="muted">{q.label}: </span>}
      <ValueText q={q} />
      {compact ? (
        q.available && (
          <span
            className={`chip chip-${tainted ? "simulated" : kind}`}
            title={tainted ? `${KIND_LABEL[kind]}, from SIMULATED data` : KIND_LABEL[kind]}
          >
            {tainted ? "SIM" : SHORT[kind]}
          </span>
        )
      ) : (
        <>
          {" "}
          <ProvenanceBadge q={q} />
        </>
      )}
      {flagged && (
        <span className="flag-dot" title={flags.join(", ")}>
          ⚑
        </span>
      )}
    </button>
  );
}

/** What the compact provenance chips mean; shown under tables that use them. */
export function ProvenanceLegend() {
  return (
    <div className="legend">
      {(["measured", "computed", "literature", "predicted", "guideline", "user_supplied"] as ProvenanceKind[]).map(
        (k) => (
          <span key={k}>
            <span className={`chip chip-${k}`}>{SHORT[k]}</span> {KIND_LABEL[k]}
          </span>
        ),
      )}
      <span>
        <span className="chip chip-simulated">SIM</span> simulated
      </span>
      <span className="muted">· click a value for its derivation</span>
    </div>
  );
}

/** The side panel that shows a value's derivation; mounted once in the app. */
export function DerivationDrawer() {
  const [q, setQ] = useState<Quantity | null>(null);
  useEffect(() => {
    const on = (e: Event) => setQ((e as CustomEvent<Quantity>).detail);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setQ(null);
    const away = () => setQ(null);
    window.addEventListener(DERIVATION_EVENT, on);
    window.addEventListener("keydown", esc);
    window.addEventListener("hashchange", away);
    return () => {
      window.removeEventListener(DERIVATION_EVENT, on);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("hashchange", away);
    };
  }, []);
  if (!q) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={() => setQ(null)} />
      <aside className="drawer" role="dialog" aria-label="Derivation">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">How this value was obtained</div>
            <h3>{q.label ?? "Value"}</h3>
          </div>
          <button className="icon-btn" onClick={() => setQ(null)} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer-value">
          <ValueText q={q} /> <ProvenanceBadge q={q} />
        </div>
        <Derivation q={q} />
      </aside>
    </>
  );
}
