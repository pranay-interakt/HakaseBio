/**
 * OrganRiskBodyMap — the Layer-3 target-organ map.
 *
 * A non-anatomical organ grid. Every scientific determination on it —
 * which organs are of concern, the hazard band, whether the organ is
 * meaningfully exposed, and the wording of each call — is computed by
 * `l3/organ_risk_engine.py` and arrives in the study record's `organ_risk`
 * block. This component chooses layout and colours; it never decides risk.
 *
 * Honesty contract, inherited from the backend block:
 *   • An organ with no hazard signal is drawn neutral and labelled "no hazard
 *     signal" — that is the absence of a flagged model output, NOT a
 *     demonstration of organ safety.
 *   • An organ the PBPK model has no compartment for carries no exposure value
 *     and is labelled unresolved rather than shaded as safe.
 *   • Domains that name no target organ (genotoxicity, carcinogenicity) are
 *     systemic and are listed beside the figure so nothing is silently dropped.
 */
import { useState } from "react";
import { Info, ShieldAlert } from "lucide-react";
import { num, pct, StatusPill } from "./ui";

export type OrganRow = {
  organ: string;
  label: string;
  hazard_level?: string;
  hazard_probability?: number | null;
  driving_domain?: string | null;
  driving_endpoint?: string | null;
  call: string;
  call_label: string;
  call_basis: string;
  n_domains?: number;
  n_flagged_domains?: number;
  domains?: Array<{ id?: string; name?: string; guideline?: string; hazard_level?: string; probability?: number | null; mechanism?: string }>;
  exposure?: {
    available?: boolean;
    arm?: string | null;
    tissue_plasma_auc_ratio?: number | null;
    consensus_tissue_plasma_ratio?: number | null;
    c_max_mg_per_l?: number | null;
    auc_mg_h_per_l?: number | null;
    partitioning?: string | null;
    meaningfully_exposed?: boolean | null;
    threshold?: number;
  };
  safety_pharmacology?: { system?: string; assessment?: string; rationale?: string } | null;
};

export type OrganRisk = {
  available?: boolean;
  reason?: string;
  organs?: OrganRow[];
  systemic_domains?: Array<{ id?: string; name?: string; guideline?: string; hazard_level?: string; probability?: number | null; mechanism?: string }>;
  summary?: {
    target_organs_of_concern?: string[];
    flagged_but_unexposed?: string[];
    highest_exposure_organ?: string | null;
    n_organs_mapped?: number;
    n_concern?: number;
    n_systemic_domains_without_organ?: number;
  };
  exposure_threshold?: number;
  legend?: Array<{ call: string; label: string }>;
  limitations?: string;
};

/* Sequential ramp for a flagged organ, keyed to the hazard band. Neutral grey
   means "no ranked hazard signal", which is a distinct state from "safe". */
const FILL: Record<string, string> = {
  target_organ_of_concern: "#c0392b",
  flagged_but_unexposed: "#e59a3c",
  flagged_exposure_unknown: "#e0c14a",
  exposed_no_signal: "#8fc9dd",
  no_signal: "#dfe6ef",
  not_predicted: "#eef2f7",
};

export function OrganRiskBodyMap({ risk }: { risk: OrganRisk }) {
  const organs = risk.organs ?? [];
  const concernFirst = [...organs].sort((a, b) => {
    const rank = (o: OrganRow) => (o.call === "target_organ_of_concern" ? 0 : o.call.startsWith("flagged") ? 1 : 2);
    return rank(a) - rank(b);
  });
  const [selected, setSelected] = useState<string>(concernFirst[0]?.organ ?? "");
  const active = organs.find((o) => o.organ === selected) ?? concernFirst[0];

  return <div className="organ-map">
    <div className="organ-map-figure">
      <div className="organ-grid" role="list" aria-label="Organs shaded by the animal study's target-organ determination">
        {organs.map((organ) => {
          const isSelected = organ.organ === selected;
          const interactive = organ.call !== "not_predicted";
          const ratio = organ.exposure?.tissue_plasma_auc_ratio;
          return <button
            key={organ.organ}
            type="button"
            role="listitem"
            className={`organ-tile ${isSelected ? "selected" : ""}`}
            style={{ ["--tile" as string]: FILL[organ.call] ?? FILL.no_signal }}
            data-muted={!interactive}
            aria-pressed={isSelected}
            title={`${organ.label} — ${organ.call_label}`}
            onClick={() => setSelected(organ.organ)}
          >
            <span className="organ-tile-swatch" aria-hidden />
            <span className="organ-tile-name">{organ.label}</span>
            <span className="organ-tile-ratio">{ratio != null ? `${num(ratio)}×` : "—"}</span>
          </button>;
        })}
      </div>
      <div className="organ-map-legend">
        {(risk.legend ?? []).map((entry) => (
          <span key={entry.call}><i style={{ background: FILL[entry.call] ?? FILL.no_signal }} />{entry.label}</span>
        ))}
      </div>
    </div>

    <div className="organ-map-detail">
      <div className="organ-map-chips">
        {concernFirst.map((organ) => (
          <button
            key={organ.organ}
            className={`organ-chip ${organ.organ === selected ? "selected" : ""}`}
            onClick={() => setSelected(organ.organ)}
          >
            <i style={{ background: FILL[organ.call] ?? FILL.no_signal }} />
            {organ.label}
          </button>
        ))}
      </div>

      {active && <div className="organ-detail-card">
        <div className="organ-detail-head">
          <div><b>{active.label}</b><span>{active.call_label}</span></div>
          <StatusPill status={active.hazard_level} />
        </div>
        <p className="organ-detail-basis">{active.call_basis}</p>

        <dl className="organ-detail-metrics">
          <div><dt>Tissue:plasma AUC</dt><dd>{num(active.exposure?.tissue_plasma_auc_ratio)}</dd></div>
          <div><dt>Cross-arm mean</dt><dd>{num(active.exposure?.consensus_tissue_plasma_ratio)}</dd></div>
          <div><dt>Tissue Cmax</dt><dd>{num(active.exposure?.c_max_mg_per_l)} mg/L</dd></div>
          <div><dt>Tissue AUC</dt><dd>{num(active.exposure?.auc_mg_h_per_l)} mg·h/L</dd></div>
        </dl>
        {active.exposure?.arm && <p className="organ-detail-arm">
          Exposure read at the <strong>{active.exposure.arm}</strong> dose group; the exposure threshold for
          "meaningfully exposed" is {num(active.exposure.threshold)}× plasma.
        </p>}

        {(active.domains?.length ?? 0) > 0 ? <>
          <div className="organ-detail-label">Toxicology domains scoring this organ</div>
          <div className="organ-domain-list">
            {(active.domains ?? []).map((domain, index) => (
              <div key={domain.id ?? index} className="organ-domain">
                <div><b>{domain.name}</b><small>{domain.guideline}</small></div>
                <div className="organ-domain-right">
                  <StatusPill status={domain.hazard_level} />
                  <span>{domain.probability != null ? num(domain.probability, 2) : "—"}</span>
                </div>
                {domain.mechanism && <p>{domain.mechanism}</p>}
              </div>
            ))}
          </div>
        </> : <p className="l3-hint-muted">No toxicology domain in the panel scores this organ.</p>}

        {active.safety_pharmacology && <div className="organ-sp">
          <ShieldAlert size={14} />
          <div>
            <b>{active.safety_pharmacology.system} — {active.safety_pharmacology.assessment}</b>
            <span>{active.safety_pharmacology.rationale}</span>
          </div>
        </div>}
      </div>}

      {(risk.systemic_domains?.length ?? 0) > 0 && <div className="organ-systemic">
        <div className="organ-detail-label"><Info size={13} /> Systemic domains with no single target organ</div>
        <div className="organ-systemic-list">
          {(risk.systemic_domains ?? []).map((domain, index) => (
            <span key={domain.id ?? index}>
              <StatusPill status={domain.hazard_level} />
              {domain.name}{domain.probability != null ? ` · ${num(domain.probability, 2)}` : ""}
            </span>
          ))}
        </div>
      </div>}
    </div>
  </div>;
}

export function OrganRiskSummary({ risk }: { risk: OrganRisk }) {
  const summary = risk.summary ?? {};
  return <div className="l3-safety-anchors">
    <div><b>Target organs of concern</b><span>{summary.target_organs_of_concern?.length ? summary.target_organs_of_concern.join(", ") : "None"}</span></div>
    <div><b>Flagged, limited exposure</b><span>{summary.flagged_but_unexposed?.length ? summary.flagged_but_unexposed.join(", ") : "None"}</span></div>
    <div><b>Highest-exposure organ</b><span>{summary.highest_exposure_organ ?? "not resolved"}</span></div>
  </div>;
}

export { pct };
