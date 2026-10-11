import { useState } from "react";
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
  return u === "dimensionless" ? "" : ` ${u.replace(/\*\*/g, "^")}`;
}

export function CitationLine({ c }: { c: Citation }) {
  const href = c.doi ? `https://doi.org/${c.doi}` : c.url ?? undefined;
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
  const tainted = q.qc_flags.includes("derived_from_simulated_data");
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
          <strong>Method:</strong> <code>{p.method.id}@{p.method.version}</code> {p.method.name}
          {p.method.assumptions.length > 0 && (
            <div className="muted">Assumptions: {p.method.assumptions.join("; ")}</div>
          )}
          {p.method.limits.length > 0 && <div className="muted">Limits: {p.method.limits.join("; ")}</div>}
        </div>
      )}
      {p.source_name && (
        <div>
          <strong>Source:</strong> {p.source_name}
          {p.source_record_id && <> · record <code>{p.source_record_id}</code></>}
          {p.source_url && (
            <>
              {" "}
              ·{" "}
              <a href={p.source_url} target="_blank" rel="noreferrer">
                link
              </a>
            </>
          )}
          {p.retrieved_at && <> · retrieved {p.retrieved_at.slice(0, 19)}Z</>}
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
          <strong>Inputs:</strong> {p.input_ids.map((i) => <code key={i}>{i} </code>)}
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
      {q.qc_flags.length > 0 && (
        <div>
          <strong>QC flags:</strong> {q.qc_flags.map((f) => <span key={f} className="flag">{f}</span>)}
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
        id <code>{q.id}</code> · recorded {p.recorded_at.slice(0, 19)}Z
      </div>
    </div>
  );
}

export function QuantityView({ q, showLabel = false }: { q: Quantity; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const u = q.uncertainty;
  return (
    <span className="qty">
      <button className="qty-btn" onClick={() => setOpen(!open)} title="Show derivation">
        {showLabel && q.label && <span className="muted">{q.label}: </span>}
        {q.available ? (
          <span className="qty-val">
            {fmt(q.value)}
            {unitText(q.unit)}
            {u && u.kind === "ci95" && u.lower !== null && (
              <span className="muted">
                {" "}
                (95% CI {fmt(u.lower)}–{fmt(u.upper)})
              </span>
            )}
            {u && u.kind === "sd" && u.sd !== null && <span className="muted"> ± {fmt(u.sd)} SD</span>}
          </span>
        ) : (
          <span className="unavail">unavailable</span>
        )}{" "}
        <ProvenanceBadge q={q} />
        {q.qc_flags.filter((f) => f !== "derived_from_simulated_data").length > 0 && (
          <span className="flag-dot" title={q.qc_flags.join(", ")}>
            ⚑
          </span>
        )}
      </button>
      {open && <Derivation q={q} />}
    </span>
  );
}
