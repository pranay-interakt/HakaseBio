import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Beaker, Database, FlaskConical, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { StageGatePanel, type Gate } from "./StageGatePanel";

const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";

/* The disposition inputs `pk_ivive` accepts as measured overrides, in the
   order a DMPK reader expects them. `fu_plasma` leads because it is the one
   that most often blocks a run: it multiplies intrinsic clearance in the
   well-stirred model, so a zero makes clearance zero and exposure infinite. */
const MEASURED_INPUTS = [
  { key: "fu_plasma", label: "Fraction unbound in plasma (fu)", unit: "fraction 0–1", hint: "e.g. 0.0002 for a ~99.98% albumin-bound compound" },
  { key: "clint_hep_ul_min_1e6", label: "Hepatocyte intrinsic clearance", unit: "µL/min/10⁶ cells", hint: "Measured in the study species" },
  { key: "vdss_l_per_kg", label: "Steady-state volume of distribution", unit: "L/kg", hint: "" },
  { key: "half_life_obach_h", label: "Terminal half-life", unit: "h", hint: "" },
  { key: "blood_plasma_ratio", label: "Blood:plasma ratio", unit: "ratio", hint: "Defaults to 1.0 when not supplied" },
] as const;
type MeasuredKey = (typeof MEASURED_INPUTS)[number]["key"];

/** Species/strain rows the kernel physiology store actually holds. */
type SpeciesStrain = { id: string; label: string; reference_body_weight_kg: number };
type SpeciesRow = {
  id: string;
  label: string;
  default_strain: string;
  reference_body_weight_kg: number;
  strains: SpeciesStrain[];
};

type Field = { label?: unknown; value?: unknown };
type Group = { title?: unknown; fields?: Field[] };
type Exposure = {
  available?: boolean;
  reason?: string;
  remediation?: string;
  presentation?: { groups?: Group[] };
  curves?: {
    plasma?: {
      mean: number[];
      p05: number[];
      p95: number[];
    };
  };
  time?: number[];
};
type Props = {
  analysisId: string;
  onBack: () => void;
  onContinueAnimal: (context: { gate: Gate; species: string; strain: string; overrides: Record<string, number> }) => void;
};

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "Not returned";
}

function renderProvenanceBadge(prov: string) {
  if (!prov) return null;
  const lower = prov.toLowerCase();
  let toneClass = "badge-neutral";
  let displayLabel = prov;

  if (lower.includes("measured") || lower.includes("curated") || lower.includes("reference")) {
    toneClass = "badge-measured";
    displayLabel = "Measured";
  } else if (lower.includes("ml") || lower.includes("predict")) {
    toneClass = "badge-ml";
    displayLabel = "ML Predictor";
  } else if (lower.includes("assume") || lower.includes("default")) {
    toneClass = "badge-assumed";
    displayLabel = "Assumed";
  }

  return (
    <span className={`prov-badge ${toneClass}`} title={prov}>
      {displayLabel}
    </span>
  );
}

function PlasmaChart({ time, curve }: { time: number[]; curve: { mean: number[]; p05: number[]; p95: number[] } }) {
  if (!time || !curve || !time.length || !curve.mean.length) return null;

  const width = 600;
  const height = 280;
  const paddingLeft = 65;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const xMin = time[0];
  const xMax = time[time.length - 1];

  const yMin = 0;
  const yMax = Math.max(...curve.p95) * 1.15 || 1;

  const getX = (t: number) => paddingLeft + ((t - xMin) / (xMax - xMin)) * chartWidth;
  const getY = (c: number) => paddingTop + chartHeight - ((c - yMin) / (yMax - yMin)) * chartHeight;

  const meanPoints = curve.mean.map((c, i) => `${getX(time[i])},${getY(c)}`).join(" ");
  const p95Points = curve.p95.map((c, i) => `${getX(time[i])},${getY(c)}`);
  const p05Points = curve.p05.map((c, i) => `${getX(time[i])},${getY(c)}`).reverse();
  const ribbonPoints = [...p95Points, ...p05Points].join(" ");

  const yTicks = 5;
  const xTicks = 6;

  const yGrid = Array.from({ length: yTicks }).map((_, i) => {
    const val = yMin + (i * (yMax - yMin)) / (yTicks - 1);
    const y = getY(val);
    return { val, y };
  });

  const xGrid = Array.from({ length: xTicks }).map((_, i) => {
    const val = xMin + (i * (xMax - xMin)) / (xTicks - 1);
    const x = getX(val);
    return { val, x };
  });

  return (
    <div className="plasma-chart-container">
      <div className="chart-header">
        <h4>Plasma Concentration-Time Profile</h4>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-line mean"></span>Mean Cohort</span>
          <span className="legend-item"><span className="legend-area ribbon"></span>90% population interval</span>
        </div>
      </div>
      <div className="chart-svg-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
          {yGrid.map((tick, i) => (
            <g key={`y-${i}`}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={width - paddingRight}
                y2={tick.y}
                className="chart-gridline"
              />
              <text
                x={paddingLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="chart-axis-label"
              >
                {tick.val.toFixed(tick.val < 0.1 ? 4 : tick.val < 1 ? 3 : 1)}
              </text>
            </g>
          ))}

          {xGrid.map((tick, i) => (
            <g key={`x-${i}`}>
              <line
                x1={tick.x}
                y1={paddingTop}
                x2={tick.x}
                y2={height - paddingBottom}
                className="chart-gridline"
              />
              <text
                x={tick.x}
                y={height - paddingBottom + 16}
                textAnchor="middle"
                className="chart-axis-label"
              >
                {tick.val.toFixed(0)}
              </text>
            </g>
          ))}

          <text
            transform={`rotate(-90 ${18} ${paddingTop + chartHeight / 2})`}
            x={18}
            y={paddingTop + chartHeight / 2}
            textAnchor="middle"
            className="chart-title"
          >
            Concentration (mg/L)
          </text>

          <text
            x={paddingLeft + chartWidth / 2}
            y={height - 8}
            textAnchor="middle"
            className="chart-title"
          >
            Time (min)
          </text>

          <polygon points={ribbonPoints} className="chart-ribbon" />
          <polyline points={meanPoints} className="chart-line-mean" />
        </svg>
      </div>
    </div>
  );
}

export function IviveWorkspace({ analysisId, onBack, onContinueAnimal }: Props) {
  const [gate, setGate] = useState<Gate | null>(null);
  const [species, setSpecies] = useState("rat");
  const [strain, setStrain] = useState("sprague_dawley");
  const [bodyWeight, setBodyWeight] = useState("0.3");
  const [route, setRoute] = useState("IV");
  const [dose, setDose] = useState("1");
  const [duration, setDuration] = useState("1440");
  const [infusionDuration, setInfusionDuration] = useState("");
  const [formulation, setFormulation] = useState("solution");
  const [cohortSize, setCohortSize] = useState("50");
  const [busy, setBusy] = useState(false);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insufficientInput, setInsufficientInput] = useState<{ missing: string[]; remediation?: string; reason?: string } | null>(null);
  /* The species roster comes from the kernel physiology store rather than a
     hard-coded list, so the picker can never offer a species the PBPK layer has
     no calibrated organ set for. */
  const [speciesCatalog, setSpeciesCatalog] = useState<SpeciesRow[] | null>(null);
  const [anchor, setAnchor] = useState<Record<string, unknown> | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);
  /* Measured disposition inputs. The backend's precedence is
     override > curated reference > ML, so anything entered here replaces the
     predicted value and is stamped "measured (user-supplied)" in the result's
     provenance. This is the documented escape hatch for a compound the ML
     cannot resolve — most often an extreme protein binder whose predicted fu
     clamps to zero and blocks the clearance calculation entirely. */
  const [measured, setMeasured] = useState<Record<MeasuredKey, string>>({
    fu_plasma: "",
    clint_hep_ul_min_1e6: "",
    vdss_l_per_kg: "",
    half_life_obach_h: "",
    blood_plasma_ratio: "",
  });
  const [measuredOpen, setMeasuredOpen] = useState(false);

  /** Only well-formed positive numbers are sent; a blank field is simply absent. */
  const overrides = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(measured)) {
      const value = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  }, [measured]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_ROOT}/api/ai/pbpk/species`, { signal: AbortSignal.timeout(15_000) })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.species)) return;
        setSpeciesCatalog(data.species as SpeciesRow[]);
      })
      .catch(() => { /* The picker keeps the current selection; nothing is invented. */ });
    return () => { cancelled = true; };
  }, []);

  function selectSpecies(next: string) {
    setSpecies(next);
    const row = speciesCatalog?.find((item) => item.id === next);
    if (!row) return;
    setStrain(row.default_strain);
    setBodyWeight(String(row.reference_body_weight_kg));
  }

  /**
   * Compare the projection against observed clinical pharmacokinetics from
   * PK-DB. This is the one check that grades the projection against real human
   * data rather than against itself.
   */
  async function loadAnchor() {
    setAnchorBusy(true);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/pk-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the analysis id is sent. The server resolves the identity from
        // the Layer 1 regulatory record it already holds.
        body: JSON.stringify({ analysis_id: analysisId }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => ({}));
      setAnchor(response.ok ? payload : { status: "unavailable", reason: typeof payload.detail === "string" ? payload.detail : "The observed-PK lookup did not return." });
    } catch {
      setAnchor({ status: "unavailable", reason: "The observed-PK lookup could not be reached." });
    } finally { setAnchorBusy(false); }
  }

  async function runExposure() {
    setBusy(true); setError(null); setExposure(null); setInsufficientInput(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/pbpk/exposure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          animal: { species, strain: strain || null, body_weight: Number(bodyWeight) },
          study: {
            route,
            dose: Number(dose),
            duration: Number(duration),
            infusion_duration: infusionDuration ? Number(infusionDuration) : null,
          },
          formulation: formulation.trim(),
          cohort_size: Number(cohortSize),
          ...(Object.keys(overrides).length ? { overrides } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload?.source === "insufficient-input" || payload?.detail?.source === "insufficient-input") {
          const data = payload?.source === "insufficient-input" ? payload : payload.detail;
          setInsufficientInput({
            missing: Array.isArray(data.missing) ? data.missing : [],
            remediation: typeof data.remediation === "string" ? data.remediation : undefined,
            reason: typeof data.reason === "string" ? data.reason : undefined,
          });
          return;
        }
        const detail = payload?.detail;
        const message = typeof detail === "string"
          ? detail
          : typeof detail?.message === "string"
            ? detail.message
            : typeof detail?.reason === "string"
              ? detail.reason
              : "The exposure projection could not be completed.";
        throw new Error(message);
      }

      if (payload && payload.available === false) {
        setInsufficientInput({
          missing: Array.isArray(payload.missing) ? payload.missing : [],
          remediation: typeof payload.remediation === "string" ? payload.remediation : undefined,
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
        });
      } else {
        setExposure(payload as Exposure);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The exposure projection could not be completed.");
    } finally { setBusy(false); }
  }

  const groups = exposure?.presentation?.groups ?? [];
  const validInputs = Number(bodyWeight) > 0 && Number(dose) > 0 && Number(duration) > 0 && Number(cohortSize) >= 2 && Boolean(formulation.trim());

  // Collect all provenances mapping from the presentation to display them as inline badges next to the fields
  const provenanceMap: Record<string, string> = {};
  groups.forEach(g => {
    (g.fields ?? []).forEach(f => {
      const lbl = String(f.label).toLowerCase();
      if (lbl.endsWith(" provenance") || lbl.endsWith("-clearance provenance") || lbl.endsWith("-fraction provenance")) {
        const baseKey = lbl.replace(" provenance", "").replace("-clearance", "").replace("-fraction", "").trim();
        provenanceMap[baseKey] = String(f.value);
      }
    });
  });

  return <section className="ivive-workspace">
    <header className="ivive-banner">
      <div><p>Layer 3 · IVIVE</p><h1>Species-aware exposure projection</h1><span>Translate completed in vitro evidence into a whole-body concentration–time projection for the selected study context.</span></div>
      <div className="ivive-banner-mark"><Beaker size={27} /><span>Exposure workflow</span></div>
    </header>

    <div className="ivive-layout">
      <aside className="ivive-controls">
        <div className="ivive-control-heading"><Beaker size={19} /><div><b>Study setup</b><span>Define the animal and study context for the exposure projection.</span></div></div>
        <label>Species<select value={species} onChange={(event) => selectSpecies(event.target.value)}>
          {(speciesCatalog ?? [{ id: species, label: species, default_strain: strain, reference_body_weight_kg: Number(bodyWeight), strains: [] }]).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <label>Strain or reference row<select value={strain} onChange={(event) => {
          const next = event.target.value;
          setStrain(next);
          const row = speciesCatalog?.find((item) => item.id === species)?.strains.find((item) => item.id === next);
          if (row) setBodyWeight(String(row.reference_body_weight_kg));
        }}>
          {(speciesCatalog?.find((row) => row.id === species)?.strains ?? [{ id: strain, label: strain, reference_body_weight_kg: Number(bodyWeight) }]).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <label>Body weight (kg)<input type="number" min="0.001" step="0.001" value={bodyWeight} onChange={(event) => setBodyWeight(event.target.value)} /></label>
        <label>Administration route<select value={route} onChange={(event) => setRoute(event.target.value)}><option value="IV">Intravenous bolus</option><option value="ORAL">Oral</option><option value="SC">Subcutaneous</option></select></label>
        <label>Study dose (mg)<input type="number" min="0.001" step="0.1" value={dose} onChange={(event) => setDose(event.target.value)} /></label>
        <label>Simulation window (min)<input type="number" min="1" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        {route === "IV" && <label>Infusion duration (min, optional)<input type="number" min="0.001" step="0.1" value={infusionDuration} onChange={(event) => setInfusionDuration(event.target.value)} placeholder="Leave blank for bolus" /></label>}
        <label>Formulation<input value={formulation} onChange={(event) => setFormulation(event.target.value)} placeholder="e.g. solution" /></label>
        <label>Virtual cohort size<input type="number" min="2" step="1" value={cohortSize} onChange={(event) => setCohortSize(event.target.value)} /></label>
        {/* Measured disposition inputs. Open by default once the run has been
            refused for a missing input, so the fix is where the reader is
            already looking. */}
        <details className="measured-inputs" open={measuredOpen || Boolean(insufficientInput)}>
          <summary onClick={(event) => { event.preventDefault(); setMeasuredOpen((open) => !open); }}>
            <FlaskConical size={14} />
            Measured inputs
            {Object.keys(overrides).length > 0 && <em>{Object.keys(overrides).length} in force</em>}
          </summary>
          <p className="measured-note">
            A value entered here <strong>replaces the model prediction</strong> and is carried through
            the animal study and the first-in-human projection, stamped <em>measured (user-supplied)</em>.
            Leave a field blank to keep the predicted value.
          </p>
          {MEASURED_INPUTS.map((input) => (
            <label key={input.key}>
              {input.label} <small>{input.unit}</small>
              <input
                type="number" min="0" step="any" inputMode="decimal"
                value={measured[input.key]}
                placeholder={input.hint || "Predicted"}
                onChange={(event) => setMeasured((current) => ({ ...current, [input.key]: event.target.value }))}
              />
            </label>
          ))}
          {Object.keys(overrides).length > 0 && (
            <button className="text-action" onClick={() => setMeasured({ fu_plasma: "", clint_hep_ul_min_1e6: "", vdss_l_per_kg: "", half_life_obach_h: "", blood_plasma_ratio: "" })}>
              Clear measured inputs
            </button>
          )}
        </details>

        <div className="ivive-note"><ShieldCheck size={16} /><span>Results include returned uncertainty and provenance. They are screening projections, not a dosing recommendation or a substitute for experimental pharmacokinetics.</span></div>
        <button className="primary-run ivive-run" onClick={runExposure} disabled={busy || !validInputs}>{busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />} {busy ? "Running exposure projection…" : "Run exposure projection"}</button>
      </aside>

      <main className="ivive-main">
        {error && <div className="ivive-error"><AlertTriangle size={18} /><span>{error}</span></div>}
        {!exposure && !busy && !insufficientInput && <div className="ivive-empty"><Beaker size={32} /><b>Ready for the exposure projection</b><span>Choose a study context and run the completed Layer 1 analysis through the IVIVE and PBPK workflow.</span></div>}
        {busy && <div className="ivive-empty"><LoaderCircle size={30} className="spin" /><b>Preparing the exposure projection</b><span>Using the completed Layer 1 evidence and selected study context.</span></div>}

        {insufficientInput && (
          <div className="ivive-empty unavailable">
            <AlertTriangle size={30} />
            <b>Exposure projection unavailable</b>
            <span>{insufficientInput.reason ?? "Required evidence was not returned."}</span>
            {insufficientInput.missing.length > 0 && (
              <div className="missing-list-container">
                <strong>Missing parameters:</strong>
                <ul className="missing-params-ul">
                  {insufficientInput.missing.map((item) => (
                    <li key={item}><code>{item}</code></li>
                  ))}
                </ul>
              </div>
            )}
            {insufficientInput.remediation && (
              <div className="remediation-container">
                <strong>Remediation:</strong> {insufficientInput.remediation}
              </div>
            )}
            {/* The blocked input is supplyable from the rail, so say so and put
                the reader in front of the field rather than leaving a dead end. */}
            {insufficientInput.missing.some((item) => MEASURED_INPUTS.some((input) => item.startsWith(input.key))) && (
              <button
                className="secondary-button"
                onClick={() => {
                  setMeasuredOpen(true);
                  const first = MEASURED_INPUTS.find((input) => insufficientInput.missing.some((item) => item.startsWith(input.key)));
                  window.setTimeout(() => {
                    const rail = document.querySelector(".measured-inputs");
                    rail?.scrollIntoView({ behavior: "smooth", block: "center" });
                    if (first) {
                      const index = MEASURED_INPUTS.findIndex((input) => input.key === first.key);
                      (rail?.querySelectorAll("input")[index] as HTMLInputElement | undefined)?.focus();
                    }
                  }, 60);
                }}
              >
                <FlaskConical size={15} /> Enter a measured value
              </button>
            )}
          </div>
        )}

        {exposure?.available && (
          <section className="ivive-results">
            <div className="ivive-results-heading">
              <Beaker size={21} />
              <div>
                <h2>Exposure results</h2>
                <p>Projected measures with provenance, uncertainty, and limitations.</p>
              </div>
            </div>

            {/* Render Concentration-Time SVG Chart */}
            {exposure.curves?.plasma && exposure.time && (
              <PlasmaChart time={exposure.time} curve={exposure.curves.plasma} />
            )}

            <div className="ivive-result-stack">
              {groups.map((group, groupIndex) => {
                const visibleFields = (group.fields ?? [])
                  .filter((field) => field.value !== null && field.value !== undefined && field.value !== "")
                  // Hide raw provenance fields since we render them as badges next to values
                  .filter((field) => !String(field.label).toLowerCase().endsWith("provenance"));

                if (visibleFields.length === 0) return null;

                return (
                  <article key={`${text(group.title)}-${groupIndex}`}>
                    <h3>{text(group.title)}</h3>
                    <dl>
                      {visibleFields.map((field, fieldIndex) => {
                        const label = text(field.label);
                        const value = text(field.value);
                        const labelLower = label.toLowerCase();

                        // Map matching provenance to render as a badge next to the value
                        let matchingProv = "";
                        if (labelLower.includes("clearance") && !labelLower.includes("renal") && !labelLower.includes("total")) {
                          matchingProv = provenanceMap["intrinsic"] || provenanceMap["hepatic intrinsic clearance"] || "";
                        } else if (labelLower.includes("unbound plasma fraction") || labelLower.includes("fraction unbound")) {
                          matchingProv = provenanceMap["unbound"] || provenanceMap["unbound plasma fraction"] || "";
                        } else if (labelLower.includes("distribution volume") || labelLower.includes("vdss")) {
                          matchingProv = provenanceMap["distribution-volume"] || provenanceMap["vdss"] || "";
                        }

                        const narrative = /limitation|note|applicability/i.test(label) || value.length > 160;

                        return (
                          <div className={narrative ? "ivive-field narrative" : "ivive-field"} key={`${label}-${fieldIndex}`}>
                            <dt>
                              {label}
                              {matchingProv && renderProvenanceBadge(matchingProv)}
                            </dt>
                            <dd>{value}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* Observed clinical pharmacokinetics from PK-DB. This is the only
            check that grades the projection against real human measurements
            rather than against its own internal consistency. A miss is reported
            as a miss; no surrogate value is generated. */}
        {exposure?.available && (
          <section className="ivive-anchor">
            <div className="ivive-anchor-head">
              <Database size={19} />
              <div>
                <h3>Observed pharmacokinetic anchor</h3>
                <p>Compare this projection against measured clinical pharmacokinetics recorded in PK-DB.</p>
              </div>
              <button className="secondary-button" onClick={loadAnchor} disabled={anchorBusy}>
                {anchorBusy ? <LoaderCircle size={15} className="spin" /> : <Database size={15} />}
                {anchor ? "Re-check" : "Look up observed PK"}
              </button>
            </div>
            {anchor && <div className="ivive-anchor-body">
              {Array.isArray((anchor as { comparisons?: unknown }).comparisons) && ((anchor as { comparisons: unknown[] }).comparisons).length
                ? <dl>{((anchor as { comparisons: Array<Record<string, unknown>> }).comparisons).map((row, index) => (
                    <div className="ivive-field" key={`${text(row.parameter)}-${index}`}>
                      <dt>{text(row.parameter)}</dt>
                      <dd>Observed {text(row.observed)} · projected {text(row.projected)}{row.fold_error ? ` · ${text(row.fold_error)}-fold` : ""}</dd>
                    </div>
                  ))}</dl>
                : <p className="ivive-anchor-note">{text((anchor as { reason?: unknown }).reason) || "No observed pharmacokinetic record matched this structure. The projection stands unanchored."}</p>}
            </div>}
          </section>
        )}

        {exposure?.available && (
          <StageGatePanel
            analysisId={analysisId}
            species={species}
            onCleared={setGate}
            onContinue={() => { if (gate) onContinueAnimal({ gate, species, strain, overrides }); }}
          />
        )}

        <button className="return-l1" onClick={onBack}><ArrowLeft size={16} /> Return to in vitro results</button>
      </main>
    </div>
  </section>;
}
