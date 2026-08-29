/**
 * Decision-oriented follow-up tools for Layer 1.
 *
 * They make the simulation useful as a planning surface without pretending a
 * prediction is a measurement. Counterfactuals are derived from the current
 * record; programme memory is a browser-local, append-only comparison ledger.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BrainCircuit, Database, FlaskConical, Plus, ShieldCheck } from "lucide-react";
import type { EndpointValue, CompoundProfile } from "../engine/profile";
import type { L1Record } from "../engine/l1";
import { num } from "../lib/format";
import { t } from "../i18n";

type MemoryEntry = {
  id: string;
  recordedAt: string;
  project: string;
  endpoint: string;
  endpointTitle: string;
  predicted: number;
  observed: number;
  unit: string;
  note: string;
};

const MEMORY_KEY = "hakase.programme-memory.v1";
const FALLBACK_ENDPOINTS = ["hERG", "DILI", "AMES", "Caco2_Wang", "Solubility_AqSolDB", "Clearance_Hepatocyte_AZ"];

function loadMemory(): MemoryEntry[] {
  try {
    const stored = localStorage.getItem(MEMORY_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function rankedEndpoints(profile: CompoundProfile): EndpointValue[] {
  return FALLBACK_ENDPOINTS
    .map((key) => profile.endpoints[key])
    .filter((entry): entry is EndpointValue => Boolean(entry))
    .sort((a, b) => {
      const rank = (value: EndpointValue) => value.status === "bad" ? 0 : value.status === "warn" ? 1 : 2;
      return rank(a) - rank(b);
    });
}

function studyFor(endpoint: EndpointValue) {
  const specific: Record<string, { study: string; negative: string; positive: string; dose: string }> = {
    hERG: {
      study: "Automated hERG patch-clamp concentration–response",
      negative: "Remove the cardiac block from the immediate stage gate; retain exposure-margin confirmation in the next safety package.",
      positive: "Hold escalation and open an ion-channel selectivity design cycle before committing a repeat-dose study.",
      dose: "Cap the first exposure target at the provisional ECG-margin scenario until an IC50 is measured.",
    },
    DILI: {
      study: "Primary human hepatocyte viability + bile-acid transporter panel",
      negative: "Move hepatic risk from a blocker to monitored evidence and prioritise the absorption/clearance experiment.",
      positive: "Require metabolite profiling and a mechanistic liver-risk review before animal dose selection.",
      dose: "Use the conservative liver-exposure scenario for starting-dose planning while the signal is unresolved.",
    },
    AMES: {
      study: "Ames fluctuation assay with and without metabolic activation",
      negative: "Clear the genotoxicity screen for the current analogue and proceed to the next orthogonal assay.",
      positive: "Stop the series at the structural-design gate and assess a non-mutagenic scaffold replacement.",
      dose: "Do not advance to dose-setting from a positive bacterial mutagenicity result.",
    },
    Caco2_Wang: {
      study: "Caco-2 bidirectional permeability with mass-balance recovery",
      negative: "Treat low permeability as the current development constraint; investigate formulation or scaffold polarity changes.",
      positive: "Release oral absorption from the immediate gate and measure intrinsic clearance next.",
      dose: "Keep oral exposure projections conservative until permeability and solubility agree.",
    },
    Solubility_AqSolDB: {
      study: "Kinetic and thermodynamic aqueous solubility across the intended pH range",
      negative: "Open a formulation/solid-state workstream before interpreting oral exposure simulations.",
      positive: "Use the measured solubility in the next PBPK update; do not infer it from cLogP alone.",
      dose: "Do not increase dose to compensate for an unconfirmed dissolution limitation.",
    },
    Clearance_Hepatocyte_AZ: {
      study: "Human hepatocyte intrinsic-clearance experiment with metabolite identification",
      negative: "Prioritise clearance mitigation and defer confidence in once-daily exposure claims.",
      positive: "Use measured clearance as an immutable override in the IVIVE layer and re-evaluate the exposure window.",
      dose: "Base the first PK exposure scenario on the measured clearance, not the screening estimate.",
    },
  };
  return specific[endpoint.endpoint] ?? {
    study: `Orthogonal assay for ${endpoint.title}`,
    negative: "Keep this endpoint open and select the next highest-value uncertainty.",
    positive: "Record the evidence and re-review the stage gate before downstream studies.",
    dose: "Do not promote an unmeasured screening value into a dose-setting input.",
  };
}

export function AutopilotPanel({ profile, record, projectName }: {
  profile: CompoundProfile;
  record: L1Record;
  projectName: string;
}) {
  const priorities = useMemo(() => rankedEndpoints(profile).slice(0, 3), [profile]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [endpointKey, setEndpointKey] = useState("");
  const [observed, setObserved] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const entries = loadMemory();
    setMemory(entries);
    setEndpointKey((current) => current || priorities[0]?.endpoint || "");
  }, [priorities]);

  const selected = priorities.find((entry) => entry.endpoint === endpointKey) ?? priorities[0];
  const comparable = selected ? memory.filter((entry) => entry.endpoint === selected.endpoint) : [];
  const medianResidual = comparable.length
    ? [...comparable].map((entry) => entry.observed - entry.predicted).sort((a, b) => a - b)[Math.floor(comparable.length / 2)]
    : null;

  function recordObservation() {
    if (!selected) return;
    const numeric = Number(observed);
    if (!Number.isFinite(numeric)) return;
    const entry: MemoryEntry = {
      id: crypto.randomUUID(), recordedAt: new Date().toISOString(), project: projectName,
      endpoint: selected.endpoint, endpointTitle: selected.title,
      predicted: selected.canonicalValue, observed: numeric, unit: selected.canonicalUnit, note: note.trim(),
    };
    const next = [entry, ...memory].slice(0, 100);
    localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
    setMemory(next); setObserved(""); setNote("");
  }

  return <section className="panel autopilot-panel">
    <div className="autopilot-head">
      <div className="section-icon l1"><BrainCircuit size={18} /></div>
      <div><span className="eyebrow">{t("DEVELOPMENT AUTOPILOT")}</span><h2>{t(record.verdict.verdict === "NO-GO" ? "Turn a NO-GO into the next best evidence" : "Turn a WATCH into the next best evidence")}</h2>
        <p>{t("This planner does not alter the screen. It states the next experiment, then makes the decision and dose consequence explicit for either result.")}</p></div>
    </div>

    <div className="counterfactual-grid">
      {priorities.map((endpoint, index) => {
        const study = studyFor(endpoint);
        return <article className="counterfactual-card" key={endpoint.endpoint}>
          <div className="counterfactual-top"><span>0{index + 1}</span><b>{t(endpoint.title)}</b><em className={endpoint.status}>{t(endpoint.statusLabel)}</em></div>
          <div className="counterfactual-value">{num(endpoint.canonicalValue, 3)} <small>{endpoint.canonicalUnit}</small></div>
          <p className="counterfactual-study"><FlaskConical size={14} /> {t(study.study)}</p>
          <div className="counterfactual-outcome"><span className="good">{t("If reassuring")}</span><p>{t(study.negative)}</p></div>
          <div className="counterfactual-outcome"><span className="bad">{t("If concerning")}</span><p>{t(study.positive)}</p></div>
          <div className="counterfactual-dose"><ArrowRight size={13} /> <span>{t(study.dose)}</span></div>
        </article>;
      })}
    </div>

    <div className="programme-memory">
      <div className="memory-title"><Database size={17} /><div><b>{t("Programme memory")}</b><p>{t("Append a harmonised observed result to compare it with this screen. Stored only in this browser; original predictions and records stay immutable.")}</p></div></div>
      <div className="memory-form">
        <label><span>{t("Follow-up endpoint")}</span><select value={endpointKey} onChange={(event) => setEndpointKey(event.target.value)}>
          {priorities.map((endpoint) => <option key={endpoint.endpoint} value={endpoint.endpoint}>{endpoint.title}</option>)}
        </select></label>
        <label><span>{t("Observed result")}{selected?.canonicalUnit ? ` (${selected.canonicalUnit})` : ""}</span><input inputMode="decimal" value={observed} onChange={(event) => setObserved(event.target.value)} placeholder={selected ? String(selected.canonicalValue) : ""} /></label>
        <label className="memory-note"><span>{t("Evidence note")}</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("Assay, protocol, or data source")} /></label>
        <button className="btn primary" disabled={!selected || !observed.trim()} onClick={recordObservation}><Plus size={14} /> {t("Append evidence")}</button>
      </div>
      <div className="memory-readout">
        <ShieldCheck size={15} /><span>{comparable.length
          ? t("{count} comparable observation(s); median observed − predicted residual: {residual} {unit}.", { count: comparable.length, residual: num(medianResidual ?? 0, 3), unit: selected?.canonicalUnit ?? "" })
          : t("No comparable observed result has been recorded yet.")}</span>
      </div>
      {memory.length > 0 && <div className="memory-log">
        {memory.slice(0, 4).map((entry) => <div key={entry.id}><span>{entry.project}</span><b>{entry.endpointTitle}</b><code>{num(entry.observed, 3)} vs {num(entry.predicted, 3)} {entry.unit}</code></div>)}
      </div>}
    </div>

    <p className="limitation"><ShieldCheck size={13} /> {t("The counterfactuals are decision-planning aids. They are not clinical advice, and programme memory never recalibrates or overwrites a recorded prediction.")}</p>
  </section>;
}
