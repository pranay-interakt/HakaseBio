/**
 * Layer 1 — In Vitro screen.
 *
 * The setup rail collects the structure, the protein target, the clinical route,
 * the therapeutic area and the model groups to run. The result column renders
 * the complete Layer-1 record: the stage-gate verdict and its evidence-graded
 * checks, the structure and its descriptors, the indication and route reading
 * contexts, the full ADMET panel, the extended assay bench, target and
 * selectivity evidence, docking, safety and structural review, regulatory
 * precedent, external database evidence and the handoff.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowRight, Atom, BadgeCheck, Beaker, BookOpen, Box, BrainCircuit, Check,
  ChevronDown, CircleHelp, Cloud, Compass, Database, Download, Droplets, FlaskConical, HeartPulse,
  Info, Layers, LoaderCircle, Network, Play, Plus, Ruler, RotateCcw, ScanSearch, ShieldCheck, SlidersHorizontal,
  Sparkles, Target, TestTube2, Workflow, Zap,
} from "lucide-react";
import { BENCH_ASSAYS, BENCH_DEFAULT_SELECTION, BENCH_GROUPS, CLINICAL_ROUTES, THERAPEUTIC_AREAS } from "../lib/catalogs";
import { ADMET_READING_GUIDE, ADMET_SECTIONS } from "../lib/admetRegistry";
import { num, pct, text, titleCase, tone, statusWord, round } from "../lib/format";
import { downloadExhaustivePdf } from "../lib/pdfReport";
import type { CompoundProfile, EndpointValue } from "../engine/profile";
import { benchResult, dockingResult, predictTargets, type L1Record, type TargetHit } from "../engine/l1";
import { buildProfile } from "../engine/profile";
import { MoleculeView } from "../components/Molecule";
import { StructureWorkbench } from "../components/StructureWorkbench";
import { AutopilotPanel } from "../components/AutopilotPanel";
import { CombinationPanel } from "../components/CombinationPanel";
import { PeptidePanel } from "../components/PeptidePanel";
import { MECHANISM_LABEL, ROLE_LABEL, type Component, type MechanismHypothesis } from "../lib/combination";
import { t } from "../i18n";
import { BarChart, Heatmap, MetricDonut, ProfileStrip, RankChart, SegmentDonut, StackBar } from "../components/charts";
import { ExternalEvidencePanel, FdaPsgPanel } from "../components/ExternalPanel";
import {
  Anchors, Card, DataTable, DlGrid, DossierFlow, Field, Notice, PresentationGroups, RunProgress,
  SectionHeader, StatusPill, Tile, TileRow, Unavailable,
} from "../components/ui";

export type SimulationOptions = {
  admet_profiling: boolean;
  binding_simulation: boolean;
  toxicity_signal_detection: boolean;
  behavioral_fingerprinting: boolean;
  confidence_threshold: number;
};

export type L1State = {
  /** Which modality is being screened. A peptide is submitted as a sequence,
      not a structure, and the two are not interchangeable. */
  modality: "small_molecule" | "peptide";
  /** One-letter amino-acid sequence, used only when modality is "peptide". */
  sequence: string;
  smiles: string;
  /** Additional components. Empty for a single agent, which is the N = 1 case
      of the same contract rather than a separate path. */
  partners: Component[];
  /** Declared, never inferred — it selects the null model and is quoted
      wherever a combined effect is reported. */
  mechanism: MechanismHypothesis;
  areaCode: string;
  routeCode: string;
  targets: TargetHit[];
  selectedTargetId: string | null;
  targetProtein: string;
  uniprotId: string;
  pdbId: string;
  simulationOptions: SimulationOptions;
  record: L1Record | null;
  profile: CompoundProfile | null;
  override: { decision: string; rationale: string; reviewer: string; recordedAt: string } | null;
};

const PEPTIDE_PRESETS = [
  { name: "Melittin", sequence: "GIGAVLKVLTTGLPALISWIKRKRQQ", note: "Bee-venom lytic peptide · strongly cationic" },
  { name: "Oxytocin", sequence: "CYIQNCPLG", note: "Nonapeptide hormone · disulfide-bridged in nature" },
  { name: "Bradykinin", sequence: "RPPGFSPFR", note: "Nonapeptide · vasoactive" },
  { name: "Glucagon", sequence: "HSQGTFTSDYSKYLDSRRAQDFVQWLMNT", note: "29-residue hormone" },
  { name: "Magainin 2", sequence: "GIGKFLHSAKKFGKAFVGEIMNS", note: "Antimicrobial · the service's own example" },
] as const;

const PRESETS = [
  { name: "Imatinib", smiles: "Cc1ccc(cc1Nc1nccc(n1)-c1cccnc1)NC(=O)c1ccc(CN2CCN(C)CC2)cc1", note: "BCR-ABL kinase inhibitor · oncology" },
  { name: "Celecoxib", smiles: "Cc1ccc(cc1)-c1cc(nn1-c1ccc(cc1)S(N)(=O)=O)C(F)(F)F", note: "COX-2 inhibitor · boxed warning precedent" },
  { name: "Atorvastatin", smiles: "CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CCC(O)CC(O)CC(=O)O", note: "HMG-CoA reductase · high protein binding" },
  { name: "Gefitinib", smiles: "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1", note: "EGFR inhibitor · CNS-restricted" },
  { name: "Sildenafil", smiles: "CCCc1nn(C)c2c1nc([nH]c2=O)-c1cc(ccc1OCC)S(=O)(=O)N1CCN(C)CC1", note: "PDE5 inhibitor · cardiovascular" },
  { name: "Nitrofurantoin", smiles: "O=C1CN(N=Cc2ccc(o2)[N+](=O)[O-])C(=O)N1", note: "Nitroaromatic · triggers a genotoxicity flag" },
  { name: "Quercetin", smiles: "O=c1c(O)c(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12", note: "Catechol + flavone · triggers PAINS" },
  { name: "Aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O", note: "Small acidic · clean structural screen" },
];

const SECTION_ICON: Record<string, React.ReactNode> = {
  Absorption: <Droplets size={15} />,
  Distribution: <Network size={15} />,
  Metabolism: <Zap size={15} />,
  Excretion: <FlaskConical size={15} />,
  Toxicity: <HeartPulse size={15} />,
  Physchem: <Atom size={15} />,
};

/**
 * One row of the developability strip.
 *
 * `normalise` maps the endpoint's own canonical value onto 0–1 so eight
 * different units can share one axis; it is a display transform and nothing
 * downstream reads it. The band and its tone come straight off the endpoint —
 * the strip never grades a value the engine did not already grade.
 */
function profileAxis(label: string, endpoint: EndpointValue, normalise: (value: number) => number, unit = "", prefix = "") {
  return {
    label,
    value: Math.max(0, Math.min(1, normalise(endpoint.canonicalValue))),
    detail: `${prefix}${num(endpoint.canonicalValue)}`,
    unit,
    tone: endpoint.ungradedReasonCode ? ("neutral" as const) : endpoint.status,
    band: endpoint.ungradedReasonCode ? "Informational" : endpoint.statusLabel,
  };
}

function checkIcon(name: string) {
  const value = name.toLowerCase();
  if (value.includes("physico") || value.includes("lipin")) return <Atom size={16} />;
  if (value.includes("herg") || value.includes("cardio")) return <HeartPulse size={16} />;
  if (value.includes("perme") || value.includes("solub") || value.includes("caco") || value.includes("bioavail")) return <Droplets size={16} />;
  if (value.includes("dili") || value.includes("liver")) return <AlertTriangle size={16} />;
  if (value.includes("ames") || value.includes("muta")) return <ScanSearch size={16} />;
  if (value.includes("pains") || value.includes("brenk")) return <ScanSearch size={16} />;
  if (value.includes("metabol")) return <Zap size={16} />;
  if (value.includes("domain") || value.includes("applic")) return <Network size={16} />;
  return <ShieldCheck size={16} />;
}

/* ── endpoint row ────────────────────────────────────────────────────────── */

function EndpointRow({ endpoint }: { endpoint: EndpointValue }) {
  const [open, setOpen] = useState(false);
  const informational = Boolean(endpoint.ungradedReasonCode);
  const t = informational ? "neutral" : endpoint.status;
  const isProbability = endpoint.spec.task === "binary_classification";
  const shown = isProbability
    ? `${(endpoint.canonicalValue * 100).toFixed(1)}%`
    : `${num(endpoint.canonicalValue)}${endpoint.canonicalUnit && endpoint.canonicalUnit !== "count" ? ` ${endpoint.canonicalUnit}` : ""}`;
  const native = endpoint.spec.convert ? `${num(endpoint.modelValue)} ${endpoint.modelUnit}` : isProbability ? `p = ${num(endpoint.canonicalValue)}` : null;
  const interval = endpoint.conformalInterval;
  const meta = [
    "Local structure-directed demo heuristic",
    "Public reference context; no trained model benchmark is included",
    `${num(endpoint.approvedDrugPercentile.value, 1)}th pct vs approved`,
    endpoint.spec.modelSpeciesBasis,
    endpoint.spec.datasetSize > 0 ? `n = ${endpoint.spec.datasetSize.toLocaleString()}` : null,
  ].filter(Boolean) as string[];

  return <article className={`ep ${open ? "open" : ""} ${informational ? "informational" : ""}`}>
    <button className="ep-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="ep-title">
        <strong>{endpoint.title}</strong>
        <code>{endpoint.endpoint}</code>
      </span>
      <span className="ep-right">
        <span className="ep-metric">
          <b>{shown}</b>
          {interval && <small>{Math.round(interval.confidenceLevel * 100)}% PI [{num(interval.low)}, {num(interval.high)}]</small>}
          {native && <small>{native}</small>}
        </span>
        <span className={`ep-status ${t}`}><i />{informational ? "Informational" : endpoint.statusLabel}</span>
      </span>
      <ChevronDown className="ep-chev" size={15} />
    </button>

    {!informational && endpoint.bands && <div className="ep-scale">
      <div className="ep-scale-bar">
        <span className={`good ${t === "good" ? "on" : ""}`} />
        <span className={`warn ${t === "warn" ? "on" : ""}`} />
        <span className={`bad ${t === "bad" ? "on" : ""}`} />
      </div>
      <div className="ep-scale-tags">
        <span className={t === "good" ? "on" : ""}>Favourable {endpoint.bands.favourable}</span>
        <span className={t === "warn" ? "on" : ""}>Review {endpoint.bands.review}</span>
        <span className={t === "bad" ? "on" : ""}>Concern {endpoint.bands.concern}</span>
      </div>
    </div>}

    <div className="ep-meta">
      {meta.map((part, index) => <span key={index}>{part}</span>)}
      <span className={endpoint.applicabilityDomain.inDomain ? "ad-ok" : "ad-warn"}>
        {endpoint.applicabilityDomain.inDomain ? "In domain" : "Outside applicability domain"} · T {num(endpoint.applicabilityDomain.nearestTanimoto)}
      </span>
    </div>

    {open && <div className="ep-more">
      {informational && <p className="hint-muted">No validated decision threshold — {endpoint.ungradedReasonCode?.replaceAll("_", " ")}. Read as context, not as a pass or fail call.</p>}
      <p>{endpoint.interpretation.scientistMeaning}</p>
      <p className="predicts"><b>Predicts</b> {endpoint.spec.predicts}</p>
      <DlGrid entries={[
        ["Screening engine", "Local structure-directed demo heuristic"],
        ["Benchmark status", "No trained endpoint model or held-out benchmark is bundled with this demo."],
        ["Reference context", endpoint.spec.modelSpeciesBasis],
        ["Native unit", endpoint.modelUnit],
        ["Unit provenance", endpoint.spec.unitsSource],
        ["Assessed unit", endpoint.canonicalUnit],
        ["Approved-drug percentile", `${num(endpoint.approvedDrugPercentile.value, 1)}th`],
        ["Reference population", endpoint.approvedDrugPercentile.referencePopulation],
        ["Percentile meaning", endpoint.approvedDrugPercentile.meaning],
        ...(interval ? [
          ["Conformal interval", `[${num(interval.low)}, ${num(interval.high)}] at ${Math.round(interval.confidenceLevel * 100)}%`] as [string, unknown],
          ["Realised coverage", pct(interval.realisedCoverage, 1)] as [string, unknown],
        ] : []),
        ["Applicability domain", endpoint.applicabilityDomain.note],
        ["Screening band context", endpoint.bands?.context ?? "No band is defined for this endpoint."],
        ["Background reference", endpoint.spec.referenceUrl],
        ...(endpoint.spec.notes ?? []).map((note, index) => [`Note ${index + 1}`, note] as [string, unknown]),
      ]} />
      <div className="ep-follow">
        <b>{endpoint.interpretation.developmentImplication}</b>
        <span>{endpoint.interpretation.recommendedFollowUp}</span>
      </div>
    </div>}
  </article>;
}

/* ── assay bench ─────────────────────────────────────────────────────────── */

function AssayBench({ profile }: { profile: CompoundProfile }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(BENCH_DEFAULT_SELECTION));
  const [openGroup, setOpenGroup] = useState<string | null>("permeability");
  const [run, setRun] = useState<Record<string, ReturnType<typeof benchResult>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRun(null); }, [profile.smiles]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function runBench() {
    if (!selected.size) return;
    setBusy(true);
    window.setTimeout(() => {
      const results: Record<string, ReturnType<typeof benchResult>> = {};
      selected.forEach((id) => { results[id] = benchResult(profile, id); });
      setRun(results);
      setBusy(false);
    }, 700);
  }

  const summary = run
    ? {
      available: Object.values(run).filter((entry) => entry.status === "available").length,
      unavailable: Object.values(run).filter((entry) => entry.status === "unavailable").length,
    }
    : null;

  return <section className="panel">
    <SectionHeader
      icon={<Beaker size={18} />} eyebrow={t("EXTENDED IN VITRO")} title={t("Assay bench")} accent="l1"
      description={t("The compact Layer-1 contract runs a fixed model set. The bench exposes the focused predictors behind it — permeability and transport, disposition second opinions, metabolism, toxicology and identity context.")}
      actions={<>
        {summary && <span className="bench-summary">
          <em className="good">{summary.available} returned</em>
          {summary.unavailable > 0 && <em className="warn">{summary.unavailable} unavailable</em>}
        </span>}
        <button className="btn" onClick={runBench} disabled={busy || !selected.size}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Run {selected.size} assay{selected.size === 1 ? "" : "s"}
        </button>
      </>}
    />
    <div className="bench-toolbar">
      <button className="text-action" onClick={() => setSelected(new Set(BENCH_ASSAYS.map((assay) => assay.id)))}><Check size={13} /> Select all {BENCH_ASSAYS.length}</button>
      <button className="text-action" onClick={() => setSelected(new Set(BENCH_DEFAULT_SELECTION))}><RotateCcw size={13} /> Reset to recommended</button>
      <button className="text-action" onClick={() => setSelected(new Set())}>Clear</button>
    </div>
    {BENCH_GROUPS.map((group) => {
      const assays = BENCH_ASSAYS.filter((assay) => assay.group === group.id);
      const open = openGroup === group.id;
      const chosen = assays.filter((assay) => selected.has(assay.id)).length;
      const returned = assays.filter((assay) => run?.[assay.id]?.status === "available").length;
      return <article className="bench-group" key={group.id}>
        <button className="bench-group-head" onClick={() => setOpenGroup(open ? null : group.id)}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FlaskConical size={15} style={{ color: "var(--brand-700)" }} />
            <span><b>{group.name}</b><small>{group.description}</small></span>
          </span>
          <span className="bench-group-meta">
            {run && <em className="returned">{returned}/{assays.length} returned</em>}
            <em>{chosen} selected</em>
            <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s", color: "var(--faint)" }} />
          </span>
        </button>
        {open && <div className="bench-body">
          <button className="text-action" style={{ marginBottom: 8 }} onClick={() => {
            const ids = assays.map((assay) => assay.id);
            const allOn = ids.every((id) => selected.has(id));
            setSelected((current) => {
              const next = new Set(current);
              ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
              return next;
            });
          }}>{assays.every((assay) => selected.has(assay.id)) ? "Deselect group" : "Select whole group"}</button>
          {assays.map((assay) => {
            const result = run?.[assay.id];
            return <div className={`bench-assay ${selected.has(assay.id) ? "chosen" : ""}`} key={assay.id}>
              <label className="bench-assay-head">
                <input type="checkbox" checked={selected.has(assay.id)} onChange={() => toggle(assay.id)} />
                <span>
                  <b>{assay.name}{assay.remote && <Cloud size={12} aria-label="external provider" />}</b>
                  <small>{assay.engine}</small>
                  <small className="desc">{assay.description}</small>
                </span>
                {result && <StatusPill status={result.status === "available" ? "pass" : "caution"} label={result.status === "available" ? "Returned" : "Unavailable"} />}
              </label>
              {result?.status === "available" && <div style={{ marginTop: 11 }}><PresentationGroups groups={result.presentation.groups} /></div>}
              {result && result.status !== "available" && <p className="hint"><CircleHelp size={13} /> {result.reason}</p>}
            </div>;
          })}
        </div>}
      </article>;
    })}
    <p className="limitation"><CircleHelp size={13} /> Remote providers are external services. An unreachable provider is reported as unavailable and no value is substituted for it.</p>
  </section>;
}

/* ── main workspace ──────────────────────────────────────────────────────── */

type Props = {
  state: L1State;
  setState: (updater: (current: L1State) => L1State) => void;
  railHost: HTMLElement | null;
  onRun: (overrideSmiles?: string) => void;
  running: boolean;
  onContinue: () => void;
};

export function L1InVitro({ state, setState, railHost, onRun, running, onContinue }: Props) {
  const { record, profile } = state;
  const [activeSection, setActiveSection] = useState<string>("Absorption");
  const [dockPdb, setDockPdb] = useState("");
  const [dockJob, setDockJob] = useState<ReturnType<typeof dockingResult> | null>(null);
  const [dockBusy, setDockBusy] = useState(false);
  const [overrideDecision, setOverrideDecision] = useState("WATCH");
  const [overrideReason, setOverrideReason] = useState("");
  const [targetBusy, setTargetBusy] = useState(false);

  useEffect(() => { if (record) setDockPdb(record.target_resolution.pdb_id ?? ""); }, [record?.analysis_id]);

  const selectedTarget = state.targets.find((target) => target.targetChemblId === state.selectedTargetId) ?? null;

  function predict() {
    setTargetBusy(true);
    window.setTimeout(() => {
      const { targets } = predictTargets(
        // Target prediction only needs the structure key; build a light profile shim.
        { smiles: state.smiles, affinity: { kdNm: 50 } } as any,
      );
      setState((current) => ({
        ...current,
        targets,
        selectedTargetId: targets[0]?.targetChemblId ?? null,
        targetProtein: targets[0]?.targetName ?? "",
        uniprotId: targets[0]?.uniprotId ?? "",
        pdbId: targets[0]?.pdbIds[0] ?? "",
      }));
      setTargetBusy(false);
    }, 620);
  }

  /* ── rail ─────────────────────────────────────────────────────────────── */
  const rail = railHost && createPortal(<>
    <div className="rail-scroll">
      <div className="rail-head">
        <div><span>{t("Setup")}</span><b>{t("Layer 1 screening")}</b></div>
        <small><Workflow size={13} /> {t("{n} steps", { n: 4 })}</small>
      </div>

      <section className="card-input">
        <span style={{ fontSize: 11.5, fontWeight: 620, color: "var(--ink-2)" }}>{t("Modality")}</span>
        <div className="modality-pick">
          {([
            ["small_molecule", t("Small molecule"), <Atom size={15} key="a" />],
            ["peptide", t("Peptide"), <Ruler size={15} key="p" />],
          ] as const).map(([key, label, icon]) => (
            <button key={key} className={state.modality === key ? "active" : ""}
              onClick={() => setState((current) => ({ ...current, modality: key as L1State["modality"] }))}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="pill">{t("Antibody · soon")}</span>
          <span className="pill">{t("ADC · soon")}</span>
        </div>

        {/* A combination is the same modality with more than one component, not
            a different one — which is why this sits inside the modality card
            rather than beside it. It is offered only where the modality
            supports it: the service marks `supports_combination` true for a
            small molecule and false for a peptide, and a co-formulated peptide
            is a different problem from a small-molecule combination. */}
        {state.modality === "small_molecule" && <>
        <div className="sub-label" style={{ margin: "4px 0 0" }}>{t("Components")}</div>
        <p className="input-helper">{t("A single agent is one component. Add a second to screen a combination; each component is screened on its own terms and the pair is analysed for overlapping liability.")}</p>
        {state.partners.map((partner, index) => (
          <div className="card-input" key={partner.id} style={{ padding: 11, gap: 8 }}>
            <div className="row between">
              <b style={{ fontSize: 12 }}>{t("Component {n}", { n: index + 2 })}</b>
              <button className="text-action" onClick={() => setState((current) => ({
                ...current, partners: current.partners.filter((entry) => entry.id !== partner.id),
              }))}>{t("Remove")}</button>
            </div>
            <Field label={t("SMILES string")}>
              <textarea value={partner.smiles} spellCheck={false} style={{ minHeight: 56 }}
                onChange={(event) => setState((current) => ({
                  ...current,
                  partners: current.partners.map((entry) => entry.id === partner.id ? { ...entry, smiles: event.target.value } : entry),
                }))} />
            </Field>
            <div className="field-row">
              <Field label={t("Role")}>
                <select value={partner.role} onChange={(event) => setState((current) => ({
                  ...current,
                  partners: current.partners.map((entry) => entry.id === partner.id ? { ...entry, role: event.target.value as Component["role"] } : entry),
                }))}>
                  {(Object.keys(ROLE_LABEL) as Array<keyof typeof ROLE_LABEL>).map((role) => (
                    <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("Molar parts")}>
                <input type="number" min="0" step="0.1" value={partner.fraction}
                  onChange={(event) => setState((current) => ({
                    ...current,
                    partners: current.partners.map((entry) => entry.id === partner.id ? { ...entry, fraction: Number(event.target.value) } : entry),
                  }))} />
              </Field>
            </div>
          </div>
        ))}
        <button className="btn full" disabled={state.partners.length >= 2}
          onClick={() => setState((current) => ({
            ...current,
            partners: [...current.partners, {
              id: `cmp-${current.partners.length + 2}-${Date.now()}`,
              label: `Component ${current.partners.length + 2}`,
              smiles: "", role: "co_active", fraction: 1,
            }],
          }))}>
          <Plus size={14} /> {t("Add a component")}
        </button>

        {state.partners.length > 0 && <Field label={t("Mechanism hypothesis")} hint={t("declared, not inferred")}>
          <select value={state.mechanism} onChange={(event) => setState((current) => ({
            ...current, mechanism: event.target.value as MechanismHypothesis,
          }))}>
            {(Object.keys(MECHANISM_LABEL) as MechanismHypothesis[]).map((key) => (
              <option key={key} value={key}>{t(MECHANISM_LABEL[key])}</option>
            ))}
          </select>
        </Field>}
        </>}
      </section>

      {state.modality === "peptide" && <section className="card-input">
        <div className="step-title"><span>01</span><div><b>{t("Sequence input")}</b><small>{t("One-letter amino-acid sequence. Ambiguous residues are rejected rather than guessed.")}</small></div></div>
        <Field label={t("Amino-acid sequence")}>
          <textarea value={state.sequence} spellCheck={false}
            placeholder="GIGAVLKVLTTGLPALISWIKRKRQQ"
            onChange={(event) => setState((current) => ({ ...current, sequence: event.target.value }))} />
        </Field>
        <div className="row" style={{ gap: 6 }}>
          {PEPTIDE_PRESETS.map((preset) => (
            <button key={preset.name} className="pill" title={preset.note} style={{ cursor: "pointer" }}
              onClick={() => setState((current) => ({ ...current, sequence: preset.sequence }))}>
              {preset.name}
            </button>
          ))}
        </div>
        <p className="input-helper">{t("The small-molecule cascade does not run for a peptide. Its endpoints are trained on small-molecule chemistry and a peptide falls outside their applicability domain.")}</p>
      </section>}

      {state.modality === "small_molecule" && <section className="card-input">
        <div className="step-title"><span>01</span><div><b>{t("Structure input")}</b><small>{t("The molecule to evaluate. It is standardised and the parent species is selected before anything reads it.")}</small></div></div>
        <Field label={t("SMILES string")}>
          <textarea value={state.smiles} spellCheck={false}
            onChange={(event) => setState((current) => ({ ...current, smiles: event.target.value, targets: [], selectedTargetId: null }))} />
        </Field>
        <div className="row" style={{ gap: 6 }}>
          {PRESETS.map((preset) => (
            <button key={preset.name} className="pill" title={preset.note} style={{ cursor: "pointer" }}
              onClick={() => setState((current) => ({ ...current, smiles: preset.smiles, targets: [], selectedTargetId: null }))}>
              {preset.name}
            </button>
          ))}
        </div>
        <p className="input-helper">{t("Validation, standardisation and salt stripping run when the screen runs. Structures between roughly 100 and 1500 Da are in scope.")}</p>
      </section>}

      <section className="card-input">
        <div className="step-title"><span>02</span><div><b>{t("Protein target")}</b><small>{t("Resolve a biological target and its linked identifiers. Candidate targets carry measured activity, confidence and organism context.")}</small></div></div>
        <button className="btn full" onClick={predict} disabled={targetBusy || !state.smiles.trim()}>
          {targetBusy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} {t("Predict protein target")}
        </button>
        {state.targets.length > 0 && <div className="target-list">
          {state.targets.map((target, index) => {
            const evidenceLabel = target.source === "exact" ? "Exact identity" : target.source === "similarity" ? "Analogue inference" : "Model prediction";
            return <button key={target.targetChemblId}
              className={`target-option ${state.selectedTargetId === target.targetChemblId ? "selected" : ""}`}
              onClick={() => setState((current) => ({
                ...current, selectedTargetId: target.targetChemblId, targetProtein: target.targetName,
                uniprotId: target.uniprotId, pdbId: target.pdbIds[0] ?? "",
              }))}>
              <span className="target-rank">{target.rank}</span>
              <span className="target-body">
                <span className="name"><b>{target.targetName}</b><em className={`evidence-badge ${target.source}`}>{evidenceLabel}</em></span>
                <small>{target.geneName} · UniProt {target.uniprotId} · {target.organism}</small>
                <small>{target.bestActivityType} {num(target.bestValue_nM)} nM · pChEMBL {target.pChembl} · {titleCase(target.confidence)} confidence{target.bestSimilarity ? ` · ${target.bestSimilarity}% similarity` : ""}</small>
                <span className="target-summary">{target.evidenceSummary}</span>
              </span>
              {state.selectedTargetId === target.targetChemblId && <Check size={14} style={{ color: "var(--brand)", flex: "0 0 auto" }} />}
            </button>;
          })}
        </div>}
        <Field label={t("Target protein")}><input value={state.targetProtein} onChange={(event) => setState((current) => ({ ...current, targetProtein: event.target.value }))} placeholder="Resolved protein target" /></Field>
        <div className="field-row">
          <Field label={t("UniProt ID")}><input value={state.uniprotId} onChange={(event) => setState((current) => ({ ...current, uniprotId: event.target.value.toUpperCase() }))} placeholder="Accession" /></Field>
          <Field label={t("PDB ID")}><input value={state.pdbId} maxLength={4} onChange={(event) => setState((current) => ({ ...current, pdbId: event.target.value.toUpperCase() }))} placeholder="Structure" /></Field>
        </div>
        {selectedTarget && <div className="notice good" style={{ marginBottom: 0 }}>
          <BadgeCheck size={15} />
          <span><b>Target resolved</b><br />Confidence {titleCase(selectedTarget.confidence)} · {selectedTarget.pdbCount} linked PDB structure{selectedTarget.pdbCount === 1 ? "" : "s"} · {selectedTarget.quality.payload.nMeasurements} measurements across {selectedTarget.quality.payload.distinctCompounds} compounds</span>
        </div>}
      </section>

      <section className="card-input">
        <Field label={t("Intended clinical route")} hint={t("enables route-aware ADME triage")}>
          <select value={state.routeCode} onChange={(event) => setState((current) => ({ ...current, routeCode: event.target.value }))}>
            <option value="">{t("Select intended route")}</option>
            {CLINICAL_ROUTES.map((route) => <option key={route.code} value={route.code}>{t(route.label)}</option>)}
          </select>
        </Field>
        <p className="input-helper">{t("The route alters no ADMET prediction. It decides whether the oral endpoints may influence the gate, and records the route-specific evidence still to be collected.")}</p>
      </section>

      <section className="card-input">
        <Field label={t("Therapeutic area")} hint={t("selects the endpoint panel")}>
          <select value={state.areaCode} onChange={(event) => setState((current) => ({ ...current, areaCode: event.target.value }))}>
            <option value="">{t("No therapeutic area selected")}</option>
            {THERAPEUTIC_AREAS.map((area) => <option key={area.code} value={area.code}>{t(area.label)}</option>)}
          </select>
        </Field>
        {(() => {
          const area = THERAPEUTIC_AREAS.find((entry) => entry.code === state.areaCode);
          return area ? <p className="input-helper">{area.summary}</p> : null;
        })()}
      </section>

      <section className="card-input">
        <div className="step-title"><span>03</span><div><b>{t("Simulation options")}</b><small>{t("Which model groups to include in this run.")}</small></div></div>
        {([
          ["admet_profiling", "ADMET profiling", "Structure-directed demo screen — 45 endpoint views"],
          ["binding_simulation", "Binding simulation", "Local affinity read-across, requires a resolved UniProt target"],
          ["toxicity_signal_detection", "Toxicity signal detection", "Local cardiac, liver and mutagenicity screening heuristics"],
          ["behavioral_fingerprinting", "Behavioural fingerprinting", "Drug2cell over Tabula Sapiens, requires a gene symbol"],
        ] as const).map(([key, label, detail]) => (
          <label className="toggle" key={key}>
            <span><b>{t(label)}</b><small>{t(detail)}</small></span>
            <input type="checkbox" checked={state.simulationOptions[key]}
              onChange={(event) => setState((current) => ({ ...current, simulationOptions: { ...current.simulationOptions, [key]: event.target.checked } }))} />
          </label>
        ))}
        <div className="slider">
          <span style={{ fontSize: 11.5, fontWeight: 620 }}>{t("Reviewer confidence annotation: {v}", { v: state.simulationOptions.confidence_threshold.toFixed(2) })}</span>
          <span className="pill">{t("Recorded, not applied")}</span>
          <input type="range" min="0.5" max="0.95" step="0.05" value={state.simulationOptions.confidence_threshold}
            onChange={(event) => setState((current) => ({ ...current, simulationOptions: { ...current.simulationOptions, confidence_threshold: Number(event.target.value) } }))} />
          <div className="ends"><span>{t("0.50 Low")}</span><span>{t("0.95 High")}</span></div>
          <p className="input-helper">{t("Stored with the run for audit. It changes no calibrated model threshold and filters no result.")}</p>
        </div>
      </section>
    </div>
    <div className="rail-foot">
      <button className="btn primary full lg" onClick={() => onRun()} disabled={running || !state.smiles.trim()}>
        {running ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
        {running ? t("Running Layer 1…") : t("Run in vitro simulation")}
      </button>
      <small className="row" style={{ justifyContent: "center", marginTop: 9, fontSize: 11, color: "var(--muted)" }}>
        <Workflow size={13} /> {t("45 ADMET endpoints · 3 safety models · 2 structural screens")}
      </small>
    </div>
  </>, railHost);

  if (running) {
    return <>{rail}<RunProgress
      title={t("Running the Layer 1 in-vitro screen")}
      typicalSeconds={9}
      steps={[
        "Standardising the structure and selecting the parent species",
        "RDKit descriptors and conformer embedding",
        "Structure-directed ADMET demo screen (45 endpoint views)",
        "Local cardiac, liver and mutagenicity screening heuristics",
        "PAINS / Brenk / NIH structural alert screen",
        "Applicability domain against the training chemistry",
        "PubChem structural precedent and OpenFDA regulatory lookup",
        "Stage-gate evaluation and dossier assembly",
      ]}
    /></>;
  }

  if (state.modality === "peptide") {
    return <>
      {rail}
      <PeptidePanel sequence={state.sequence} />
    </>;
  }

  if (!record || !profile) {
    return <>{rail}
      <div className="panel empty">
        <div className="orb"><Beaker size={28} /></div>
        <h2>{t("Ready when you are")}</h2>
        <p>{t("Configure the small-molecule inputs on the left, then run the in vitro simulation. The complete Layer 1 read will appear here.")}</p>
        <div className="empty-list">
          {[
            { icon: <Box size={15} />, label: "2D structure & descriptors" },
            { icon: <BrainCircuit size={15} />, label: "45 ADMET endpoints" },
            { icon: <Beaker size={15} />, label: "20-assay extended bench" },
            { icon: <Target size={15} />, label: "Target & selectivity evidence" },
            { icon: <AlertTriangle size={15} />, label: "Safety & structural review" },
            { icon: <ShieldCheck size={15} />, label: "Regulatory precedent" },
            { icon: <Database size={15} />, label: "External database evidence" },
            { icon: <FlaskConical size={15} />, label: "Molecular docking" },
          ].map((item) => <div key={item.label}>{item.icon}<span>{t(item.label)}</span></div>)}
        </div>
      </div>
    </>;
  }

  const verdict = record.verdict;
  const checks = verdict.checks;
  const tally = { good: 0, warn: 0, bad: 0 };
  for (const check of checks) tally[check.status] += 1;
  const cleared = tally.good;
  const sections = ADMET_SECTIONS.map((section) => [section, record.admet_ai_sections[section] ?? {}] as const);
  const activeEndpoints = Object.values(record.admet_ai_sections[activeSection] ?? {});
  const gradedTotal = Object.values(record.admet_ai_sections).flatMap((group) => Object.values(group));
  const graded = gradedTotal.filter((endpoint) => !endpoint.ungradedReasonCode).length;
  const reliability = record.assay_reliability;
  const applicability = record.tanimoto_applicability;
  const overviewChecks = checks.filter((check) => /herg|dili|ames|pains|domain/i.test(check.name));
  const gateNeedsReview = verdict.verdict !== "GO";
  const canContinue = !gateNeedsReview || Boolean(state.override);
  const selectivity = record.selectivity_evidence as any;

  const percentilePoints = activeEndpoints.map((endpoint) => ({
    label: endpoint.title,
    value: endpoint.approvedDrugPercentile.value,
    detail: `${num(endpoint.approvedDrugPercentile.value, 1)}th`,
    tone: endpoint.ungradedReasonCode ? ("neutral" as const) : endpoint.status,
  })).sort((a, b) => b.value - a.value);

  function report() {
    if (!record) return;
    const { record: _record, profile: _profile, ...inputs } = state;
    downloadExhaustivePdf({
      filename: `hakase-layer-1-${record.analysis_id}.pdf`,
      title: "Hakase Layer 1 - complete wet-lab review report",
      subtitle: `${verdict.verdict} - ${verdict.headline}`,
      findings: [
        { label: "Stage-gate verdict", value: verdict.verdict },
        { label: "Decision headline", value: verdict.headline },
        { label: "Analysis ID", value: record.analysis_id },
        { label: "Molecular formula", value: record.molecular_formula },
        { label: "ADMET endpoints assessed", value: record.admet_endpoint_count },
        { label: "Major risks", value: verdict.major_risks.length ? verdict.major_risks.join("; ") : "None recorded" },
        { label: "Evidence gaps", value: verdict.missing_evidence.length ? verdict.missing_evidence.join("; ") : "None recorded" },
      ],
      sources: [
        { title: "Layer 1 inputs and screen configuration", value: inputs },
        { title: "Structure-derived chemistry profile", value: profile },
        { title: "Complete Layer 1 simulation record", value: record },
      ],
    });
  }

  return <>
    {rail}

    {/* ── verdict ─────────────────────────────────────────────────────── */}
    <section className={`verdict ${verdict.verdict.toLowerCase().replace("-", "")}`}>
      <div className="verdict-copy">
        <div className="verdict-eyebrow">Layer 1 · in vitro review</div>
        <div className="verdict-title"><i />{verdict.verdict}</div>
        <h2>{verdict.headline}</h2>
        <p>{verdict.rationale}</p>
        <div className="verdict-foot"><BadgeCheck size={14} /> Analysis {record.analysis_id} · {record.admet_endpoint_count} endpoints returned · {num(record.provenance.inference_time_ms / 1000, 1)}s</div>
      </div>
      <MetricDonut value={cleared} total={checks.length} label="checks clear"
        tone={verdict.verdict === "GO" ? "good" : verdict.verdict === "WATCH" ? "warn" : "bad"} />
    </section>

    <AutopilotPanel profile={profile} record={record} projectName={record.analysis_id} />

    {/* ── at a glance ─────────────────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<Layers size={18} />} eyebrow={t("SCREENING AT A GLANCE")} title={t("What this screen returned")} accent="l1"
        description={t("Counts taken directly from the returned record. No composite score is computed — averaging a permeability against a genotoxicity flag has no scientific meaning.")} />
      <div className="glance-grid">
        <figure className="chart" style={{ margin: 0 }}>
          <figcaption className="chart-head">
            <div><b>{t("Gate check outcome")}</b><span>{t("Every check the Layer 1 gate read, by the band it landed in.")}</span></div>
          </figcaption>
          <SegmentDonut
            segments={[
              { key: "good", label: "Clear", value: tally.good, tone: "good" },
              { key: "warn", label: "Review", value: tally.warn, tone: "warn" },
              { key: "bad", label: "Flag", value: tally.bad, tone: "bad" },
            ]}
            centreValue={cleared} centreTotal={checks.length} centreLabel="checks clear"
            caption="Arc lengths are counts, not weights — one flagged gate-driving check can set the verdict on its own."
          />
        </figure>
        <ProfileStrip
          title={t("Developability profile")}
          subtitle={t("Where each returned value sits inside its own favourable range. Read the band, not the bar — the bars are normalised only so eight different units can share one axis.")}
          axes={[
            profileAxis("Permeability", record.admet_ai_sections.Absorption.Caco2_Wang, (v) => v / 12, "×10⁻⁶ cm/s"),
            profileAxis("Aqueous solubility", record.admet_ai_sections.Absorption.Solubility_AqSolDB, (v) => (v + 7) / 5, "log mol/L", "logS "),
            profileAxis("Metabolic stability", record.admet_ai_sections.Excretion.Clearance_Hepatocyte_AZ, (v) => 1 - v / 60, "µL/min/10⁶"),
            profileAxis("hERG safety", record.admet_ai_sections.Toxicity.hERG, (v) => 1 - v, "", "p "),
            profileAxis("Hepatic safety", record.admet_ai_sections.Toxicity.DILI, (v) => 1 - v, "", "p "),
            profileAxis("Genotoxicity", record.admet_ai_sections.Toxicity.AMES, (v) => 1 - v, "", "p "),
            { label: "Drug-likeness", value: record.rdkit_feasibility.qed, detail: `QED ${num(record.rdkit_feasibility.qed)}`, tone: "neutral", band: "Descriptor" },
            {
              label: "Model applicability", value: Math.min(1, applicability.nearest_tanimoto / 0.6),
              detail: `T ${num(applicability.nearest_tanimoto)}`,
              tone: applicability.domain === "in_domain" ? "good" : applicability.domain === "borderline" ? "warn" : "bad",
              band: titleCase(applicability.domain),
            },
          ]}
          footnote="Bands are the engine's own screening call for that endpoint; the bars are normalised for comparison only. The authoritative value, its interval and its reference range are in the ADMET panel below."
        />
      </div>
      <TileRow>
        <Tile icon={<BrainCircuit size={16} />} label="ADMET endpoints graded" value={graded} unit={`/${gradedTotal.length}`}
          note={`${sections.length} property families returned · ungraded endpoints have no validated cutoff`} tone="brand" />
        <Tile icon={<HeartPulse size={16} />} label="Safety endpoints returned" value={Object.keys(record.safety_assessments).length}
          note={t("Screening predictions — they do not establish clinical safety")} />
        <Tile icon={<ScanSearch size={16} />} label="Structural alerts" value={reliability.pains.count + reliability.brenk.count}
          note={`${reliability.pains.count} PAINS · ${reliability.brenk.count} Brenk · ${reliability.display_summary}`}
          tone={reliability.pains.count + reliability.brenk.count > 0 ? "warn" : "good"} />
        <Tile icon={<Network size={16} />} label="Nearest training analogue" value={num(applicability.nearest_tanimoto)} unit="T"
          note={`${titleCase(applicability.domain)} · nearest reference ${applicability.nearest_reference}`}
          tone={applicability.domain === "in_domain" ? "good" : applicability.domain === "borderline" ? "warn" : "bad"} />
      </TileRow>
    </section>

    {/* ── check strip ─────────────────────────────────────────────────── */}
    <section className="check-strip">
      {overviewChecks.map((check) => (
        <article className="check-card" key={check.name}>
          <div className="top">
            <span className="ic">{checkIcon(check.name)}</span>
            <small>{check.name}</small>
          </div>
          <b>{check.value}</b>
          <div className="foot">
            <span className="src" title={check.source}>{check.source}</span>
            <span className={`pill ${check.status}`}><span className={`dot ${check.status}`} />{statusWord(check.status)}</span>
          </div>
          {check.applicability_domain === "out_of_domain" && (
            <em className="extrapolated" title={check.domain_caveat}>
              <AlertTriangle size={11} /> outside model domain · T {num(check.nearest_tanimoto)}
            </em>
          )}
        </article>
      ))}
    </section>

    {/* ── run configuration ─────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<SlidersHorizontal size={18} />} eyebrow={t("RUN CONFIGURATION")} title={t("Selected analyses")} accent="l1"
        description={t("What this run was asked to include, recorded with the result.")} />
      <div className="dl-grid">
        {([
          ["ADMET profiling", record.simulation_configuration.admet_profiling ? "Requested — structure-directed demo screen" : "Not requested"],
          ["Binding simulation", record.simulation_configuration.binding_simulation ? "Requested — local affinity read-across" : "Not requested"],
          ["Toxicity signal detection", record.simulation_configuration.toxicity_signal_detection ? "Requested — local cardiac, liver and mutagenicity heuristics" : "Not requested"],
          ["Behavioural fingerprinting", record.simulation_configuration.behavioral_fingerprinting ? "Requested — Drug2cell / Tabula Sapiens" : "Not requested"],
          ["Reviewer confidence annotation", `${record.simulation_configuration.confidence_threshold.toFixed(2)} — ${record.simulation_configuration.confidence_threshold_note}`],
        ] as Array<[string, unknown]>).map(([label, value], index) => {
          const rendered = text(value);
          return <div key={index} className={rendered.length > 88 ? "narrative" : undefined}><dt>{label}</dt><dd>{rendered}</dd></div>;
        })}
      </div>
      {(() => {
        const binding = record.optional_model_runs.binding_simulation as any;
        const behavioural = record.optional_model_runs.behavioral_fingerprinting as any;
        return <>
          {binding.status === "available" && <div className="mt"><div className="sub-label">BindingML result</div>
            <DlGrid entries={[
              ["Predicted pKd", binding.result.prediction.pKd_predicted],
              ["Predicted Kd", `${num(binding.result.prediction.Kd_nM)} nM`],
              ["Affinity class", titleCase(binding.result.prediction.affinity_class)],
              ["Model", binding.result.prediction.model],
              ["Target", binding.result.prediction.uniprot_id],
            ]} /></div>}
          {binding.status !== "available" && <p className="hint"><CircleHelp size={13} /> BindingML: {binding.reason}</p>}
          {behavioural.status === "available" && <div className="mt"><div className="sub-label">Behavioural fingerprint</div>
            <DlGrid entries={[
              ["Top cell types", behavioural.result.prediction.top_cell_types.join(", ")],
              ["Dataset", behavioural.result.prediction.dataset],
              ["Gene symbol", behavioural.result.prediction.gene_symbol],
            ]} /></div>}
          {behavioural.status !== "available" && <p className="hint"><CircleHelp size={13} /> Behavioural fingerprinting: {behavioural.reason}</p>}
        </>;
      })()}
    </section>

    {/* ── structure ─────────────────────────────────────────────── */}
    <div className="grid-2">
      <section className="panel">
        <SectionHeader icon={<Box size={18} />} eyebrow={t("STRUCTURE RESULT")} title={t("Molecular structure")} accent="l1"
          description={profile.rdkit ? t("RDKit generated this browser-local depiction from the submitted molecular graph.") : t("Depiction generated from the parsed molecular graph.")} />
        <MoleculeView molecule={profile.molecule} rdkitSvg={profile.rdkit?.svg} />
        <div className="smiles-row"><span>Canonical SMILES</span><code>{record.canonical_smiles}</code></div>
        <DlGrid entries={[
          ["Molecular formula", record.molecular_formula],
          ["InChIKey", record.inchikey],
          ["Heavy atoms", record.three_dimensional_structure.atom_count],
          ["Bonds", record.three_dimensional_structure.bond_count],
          ["Rings", record.three_dimensional_structure.ring_count],
          ["Conformer", record.three_dimensional_structure.source],
          ["Standardisation", record.structure_preparation.note],
          ...(record.structure_preparation.stripped_fragments.length
            ? [["Stripped fragments", record.structure_preparation.stripped_fragments.join(", ")] as [string, unknown]]
            : []),
        ]} />
      </section>

      <section className="panel">
        <SectionHeader icon={<Atom size={18} />} eyebrow={t("PHYSICOCHEMISTRY")} title={t("Molecule at a glance")} accent="l1"
          description={profile.rdkit
            ? t("Core descriptors and this depiction were calculated by RDKit in this browser. QED and CNS MPO-style score remain local compatibility readouts.")
            : t("RDKit was unavailable for this run, so the demo's local fallback descriptors are shown.")} />
        <div className="prop-grid">
          {([
            ["Molecular weight", record.rdkit_feasibility.molecular_weight_da, "Da"],
            ["Exact mass", record.rdkit_feasibility.exact_molecular_weight_da, "Da"],
            ["cLogP", record.rdkit_feasibility.logp, ""],
            ["TPSA", record.rdkit_feasibility.tpsa_a2, "Å²"],
            ["H-bond donors", record.rdkit_feasibility.h_bond_donors, ""],
            ["H-bond acceptors", record.rdkit_feasibility.h_bond_acceptors, ""],
            ["Rotatable bonds", record.rdkit_feasibility.rotatable_bonds, ""],
            ["Rings", record.rdkit_feasibility.ring_count, ""],
            ["Aromatic rings", record.rdkit_feasibility.aromatic_ring_count, ""],
            ["Aliphatic rings", record.rdkit_feasibility.aliphatic_ring_count, ""],
            ["Fraction Csp³", record.rdkit_feasibility.fraction_csp3, ""],
            ["Heavy atoms", record.rdkit_feasibility.heavy_atom_count, ""],
            ["Heteroatoms", record.rdkit_feasibility.hetero_atom_count, ""],
            ["Formal charge", record.rdkit_feasibility.formal_charge, ""],
            ["QED", record.rdkit_feasibility.qed, ""],
            ["Molar refractivity", record.rdkit_feasibility.molar_refractivity, ""],
            ["Stereocentres", record.rdkit_feasibility.stereo_centers, ""],
            ["N + O count", record.rdkit_feasibility.n_o_count, ""],
            ["Halogens", record.rdkit_feasibility.halogen_count, ""],
            ["CNS MPO-style score", record.rdkit_feasibility.bbb_score, "/5"],
          ] as Array<[string, number, string]>).map(([label, value, unit]) => (
            <div key={label}><span>{label}</span><b>{num(value)}{unit && <small>{unit}</small>}</b></div>
          ))}
        </div>
        <div className="sub-label">Rule-based feasibility filters</div>
        <div className="dl-grid">
          <div><dt>Lipinski rule of five</dt><dd>{record.rdkit_feasibility.lipinski_rule_of_five_pass ? "Pass" : `${record.rdkit_feasibility.lipinski_violations} violation(s)`}</dd></div>
          <div><dt>Veber</dt><dd>{record.rdkit_feasibility.veber_pass ? "Pass" : "Fail"}</dd></div>
          <div><dt>Ghose</dt><dd>{record.rdkit_feasibility.ghose_pass ? "Pass" : "Outside range"}</dd></div>
          <div><dt>Egan</dt><dd>{record.rdkit_feasibility.egan_pass ? "Pass" : "Outside range"}</dd></div>
          <div><dt>Muegge</dt><dd>{record.rdkit_feasibility.muegge_pass ? "Pass" : "Outside range"}</dd></div>
          {record.rdkit_feasibility.lipinski_failure_reasons.length > 0 && (
            <div className="narrative"><dt>Lipinski failures</dt><dd>{record.rdkit_feasibility.lipinski_failure_reasons.join("; ")}</dd></div>
          )}
          {record.rdkit_feasibility.veber_failure_reasons.length > 0 && (
            <div className="narrative"><dt>Veber failures</dt><dd>{record.rdkit_feasibility.veber_failure_reasons.join("; ")}</dd></div>
          )}
        </div>
      </section>
    </div>

    {/* ── combination ───────────────────────────────────────────────
        Above the workbench: which components are in the product is a fact about
        the programme, and the workbench edits only the primary one. */}
    {state.partners.length > 0 && (() => {
      const components = [
        { id: "primary", label: t("Component 1"), smiles: record.canonical_smiles, role: "active" as const, fraction: 1 },
        ...state.partners.map((partner, index) => ({ ...partner, label: t("Component {n}", { n: index + 2 }) })),
      ];
      const profiles = components.map((component) => buildProfile(component.smiles));
      if (profiles.some((entry) => !entry.molecule.valid)) {
        return <Notice kind="warn" icon={<AlertTriangle size={16} />}>
          {t("A component could not be parsed, so the combination was not analysed. Fix its structure in the rail.")}
        </Notice>;
      }
      return <CombinationPanel components={components} profiles={profiles} mechanism={state.mechanism} />;
    })()}

    {/* ── structure workbench ───────────────────────────────────────
        Directly after the structure it edits, and before the ADMET panel whose
        endpoints it moves. */}
    <StructureWorkbench
      baselineSmiles={record.canonical_smiles}
      onApply={(smiles) => onRun(smiles)}
    />

    {/* ── indication and route context ──────────────────────────── */}
    <IndicationContextPanel context={record.indication_context} />
    <RouteContextPanel context={record.route_context} />

    {/* ── ADMET ─────────────────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<BrainCircuit size={18} />} eyebrow={t("ADMET PROPERTIES")} title={t("ADMET profile")} accent="l1"
        description={`${gradedTotal.length} endpoints returned across ${sections.length} property families, each with its unit provenance, screening band, conformal interval, approved-drug percentile and applicability domain.`} />

      <aside className="guide">
        <div className="guide-intro">
          <CircleHelp size={18} />
          <span><b>{ADMET_READING_GUIDE.title}</b><p>{ADMET_READING_GUIDE.summary}</p></span>
        </div>
        <div className="guide-legend">
          {ADMET_READING_GUIDE.statuses.map((status) => (
            <div key={status.key} className={status.key}>
              <i /><span><b>{status.label}</b><small>{status.meaning}</small></span>
            </div>
          ))}
        </div>
        <details className="guide-more">
          <summary>What the scores and model metrics mean <ChevronDown size={13} /></summary>
          <div>
            {ADMET_READING_GUIDE.principles.map((principle) => (
              <p key={principle.label}><b>{principle.label}</b>{principle.meaning}</p>
            ))}
            <p className="hint-muted">{ADMET_READING_GUIDE.scope_note}</p>
          </div>
        </details>
      </aside>

      <div className="sub-label">Assessment distribution by family</div>
      <div className="dist-grid">
        {sections.map(([section, endpoints]) => {
          const counts = { good: 0, warn: 0, bad: 0 };
          let gradedCount = 0;
          Object.values(endpoints).forEach((endpoint) => {
            if (endpoint.ungradedReasonCode) return;
            counts[endpoint.status as "good" | "warn" | "bad"] += 1;
            gradedCount += 1;
          });
          if (!gradedCount) return null;
          return <article key={section} className={section === activeSection ? "active" : ""}>
            <div className="dist-label"><b>{section}</b><span>{gradedCount} graded</span></div>
            <StackBar segments={[{ value: counts.good, tone: "good" }, { value: counts.warn, tone: "warn" }, { value: counts.bad, tone: "bad" }]} />
            <div className="dist-counts">
              <span className="good">{counts.good} clear</span>
              <span className="warn">{counts.warn} review</span>
              <span className="bad">{counts.bad} flag</span>
            </div>
          </article>;
        })}
      </div>

      <nav className="tabs mt" role="tablist">
        {sections.map(([section, endpoints]) => (
          <button key={section} role="tab" aria-selected={activeSection === section}
            className={activeSection === section ? "active" : ""} onClick={() => setActiveSection(section)}>
            {SECTION_ICON[section] ?? <TestTube2 size={15} />}
            <span>{section}</span>
            <em>{Object.keys(endpoints).length}</em>
          </button>
        ))}
      </nav>

      <div className="ep-list">
        {activeEndpoints.map((endpoint) => <EndpointRow key={endpoint.endpoint} endpoint={endpoint} />)}
      </div>

      <div className="mt">
        <RankChart
          title={t("Position against approved drugs")}
          subtitle={`${activeSection} endpoints ranked by percentile in the ADMET-AI bundled DrugBank approved set`}
          points={percentilePoints} valueLabel="percentile" domain={[0, 100]}
          reference={{ value: 50, label: "50th percentile of the reference set" }}
          footnote="Direction is endpoint-dependent: a high percentile is a position in the population, not a favourable result. The screening call beside each endpoint is the assessment."
        />
      </div>

      {activeSection === "Toxicity" && (
        <div className="mt">
          <Heatmap
            title={t("Tox21 assay panel")}
            subtitle={t("Nuclear-receptor and stress-response activity probabilities. Pathway perturbation at screening concentrations, not an apical toxicity outcome.")}
            columns={6} valueLabel="P(active)"
            cells={activeEndpoints
              .filter((endpoint) => endpoint.endpoint.startsWith("NR-") || endpoint.endpoint.startsWith("SR-"))
              .map((endpoint) => ({ label: endpoint.endpoint, value: endpoint.canonicalValue, detail: num(endpoint.canonicalValue, 2) }))}
            footnote="A Tox21 hit is only interpretable against an exposure margin. The animal layer joins these onto simulated tissue exposure before calling an organ."
          />
        </div>
      )}
    </section>

    {/* ── assay bench ───────────────────────────────────────────── */}
    <AssayBench profile={profile} />

    {/* ── target evidence ───────────────────────────────────────── */}
    <TargetEvidencePanel record={record} selectivity={selectivity} />

    {/* ── docking ───────────────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<FlaskConical size={18} />} eyebrow={t("OPTIONAL ANALYSIS")} title={t("Molecular docking")} accent="l1"
        description={t("A separate computational run against a validated receptor structure. It is not part of the standard screen and is never included in a batch.")} />
      <div className="row" style={{ alignItems: "flex-end", marginBottom: 14 }}>
        <div style={{ width: 190 }}>
          <Field label="Receptor PDB ID">
            <input value={dockPdb} maxLength={4} onChange={(event) => setDockPdb(event.target.value.toUpperCase())} placeholder="Validated structure" />
          </Field>
        </div>
        <button className="btn" disabled={!dockPdb.trim() || dockBusy || record.target_resolution.status !== "resolved"}
          onClick={() => {
            setDockBusy(true);
            window.setTimeout(() => { setDockJob(dockingResult(profile, dockPdb.trim())); setDockBusy(false); }, 1400);
          }}>
          {dockBusy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} {dockBusy ? "Docking…" : "Run docking"}
        </button>
        {record.target_resolution.status === "resolved" && (state.targets.find((target) => target.targetChemblId === state.selectedTargetId)?.pdbIds ?? []).length > 0 && (
          <div className="row" style={{ gap: 5 }}>
            <span className="tiny muted">Linked structures:</span>
            {(state.targets.find((target) => target.targetChemblId === state.selectedTargetId)?.pdbIds ?? []).map((pdb) => (
              <button key={pdb} className="pill" style={{ cursor: "pointer" }} onClick={() => setDockPdb(pdb)}>{pdb}</button>
            ))}
          </div>
        )}
      </div>
      {record.target_resolution.status !== "resolved" && (
        <Notice kind="plain" icon={<CircleHelp size={15} />}>Resolve and validate a protein target before submitting a receptor-specific docking job.</Notice>
      )}
      {dockJob && <>
        <Anchors entries={[
          ["Best binding score", `${num(dockJob.result.poses[0].affinity_kcal_mol)} kcal/mol`],
          ["Receptor", dockJob.result.pdb_id],
          ["Engine", dockJob.result.vina_version],
          ["Runtime", `${num(dockJob.result.runtime_seconds)} s`],
        ]} />
        <DataTable
          columns={[
            { key: "m", header: "Mode", render: (row: any) => row.mode },
            { key: "a", header: "Affinity (kcal/mol)", align: "right", render: (row: any) => num(row.affinity_kcal_mol) },
            { key: "l", header: "RMSD lower bound", align: "right", render: (row: any) => num(row.rmsd_lb) },
            { key: "u", header: "RMSD upper bound", align: "right", render: (row: any) => num(row.rmsd_ub) },
          ]}
          rows={dockJob.result.poses}
        />
        <div className="mt">
          <DlGrid entries={[
            ["Box selection method", dockJob.result.box.method],
            ["Source residue", dockJob.result.box.source_residue],
            ["Box centre (x, y, z)", dockJob.result.box.centre.join(", ")],
            ["Box size", `${dockJob.result.box.size_angstrom.join(" × ")} Å`],
            ["Exhaustiveness", dockJob.result.exhaustiveness],
            ["Modes requested", dockJob.result.num_modes],
          ]} />
        </div>
        {dockJob.result.warnings.map((warning, index) => (
          <p className="limitation" key={index}><CircleHelp size={13} /> {warning}</p>
        ))}
      </>}
    </section>

    {/* ── safety review ─────────────────────────────────────────── */}
    <SafetyPanel record={record} profile={profile} />

    {/* ── regulatory ────────────────────────────────────────────── */}
    <RegulatoryPanel outlook={record.regulatory_outlook} />

    {/* ── external evidence ─────────────────────────────────────── */}
    <ExternalEvidencePanel panel="target" identifiers={{
      gene_symbol: record.target_resolution.gene_symbol ?? null,
      uniprot_id: record.target_resolution.uniprot_id ?? null,
    }} />
    <FdaPsgPanel drugName={record.regulatory_outlook.identity_name ?? null} />

    {/* ── stage gate ────────────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<ShieldCheck size={18} />} eyebrow={t("FINAL REVIEW")} title={t("Stage-gate review")} accent="l1"
        description={t("The recommendation, the evidence that produced it, and the policy that governs which checks were allowed to influence it.")} />
      <div className={`gate-banner ${verdict.verdict === "GO" ? "go" : verdict.verdict === "WATCH" ? "cond" : "nogo"}`}>
        <span className="badge">{verdict.verdict}</span>
        <div><b>{verdict.recommendation}</b><p>{verdict.rationale}</p></div>
      </div>

      <div className="sub-label">Gate checks, with the role each was allowed to play</div>
      <DataTable
        columns={[
          { key: "n", header: "Check", render: (row: any) => <><b>{row.name}</b><small>{row.source}</small></> },
          { key: "v", header: "Value", render: (row: any) => row.value },
          { key: "s", header: "Call", render: (row: any) => <span className={`pill ${row.status}`}><span className={`dot ${row.status}`} />{statusWord(row.status)}</span> },
          { key: "r", header: "Decision role", render: (row: any) => titleCase(row.decision_role) },
          { key: "e", header: "Evidence type", render: (row: any) => titleCase(row.evidence_type) },
          { key: "d", header: "Applicability", render: (row: any) => row.applicability_domain ? <>{titleCase(row.applicability_domain)}{row.nearest_tanimoto != null && <small>T {num(row.nearest_tanimoto)}</small>}</> : "—" },
        ]}
        rows={checks}
      />

      <div className="sub-label">Gate policy</div>
      {/* The policy keys are the record's own field names; they are titled
          for display only, and the value beside each is untouched. */}
      <DlGrid entries={Object.entries(verdict.policy).map(([key, value]) => [titleCase(key), value]) as Array<[string, unknown]>} />

      <div className="grid-2 mt">
        <Card icon={<AlertTriangle size={16} />} title={t("Major risks")}>
          <ul className="rail-tags">{verdict.major_risks.map((risk, index) => <li key={index}><AlertTriangle size={12} />{risk}</li>)}</ul>
        </Card>
        <Card icon={<CircleHelp size={16} />} title={t("Missing evidence")}>
          <ul className="rail-tags">{verdict.missing_evidence.map((gap, index) => <li key={index} className="muted"><CircleHelp size={12} />{gap}</li>)}</ul>
        </Card>
      </div>

      <Card icon={<TestTube2 size={16} />} title={t("Recommended next experiments")} subtitle={t("Ordered by how much each would reduce the uncertainty that is currently driving this verdict.")}>
        <ol className="rail-list">
          {verdict.recommended_next_experiments.map((item, index) => (
            <li key={index}><span className="n">{index + 1}</span><span>{item}</span></li>
          ))}
        </ol>
      </Card>

      {gateNeedsReview && (
        <div className="notice warn">
          <AlertTriangle size={16} />
          <span style={{ flex: 1 }}>
            <b>Manual review required before Confirmation</b>
            <p style={{ marginTop: 4 }}>A recorded review is stored alongside the original verdict. It never replaces it, and it cannot close an evidence gap.</p>
            {state.override
              ? <p style={{ marginTop: 10 }}><Check size={14} /> Review recorded: <b>{state.override.decision}</b> — {state.override.rationale} <span className="tiny muted">({state.override.reviewer}, {state.override.recordedAt})</span></p>
              : <div style={{ marginTop: 12 }}>
                <div className="row" style={{ marginBottom: 9 }}>
                  {["GO", "WATCH", "NO-GO"].map((decision) => (
                    <button key={decision} className={`btn sm ${overrideDecision === decision ? "primary" : ""}`} onClick={() => setOverrideDecision(decision)}>{decision}</button>
                  ))}
                </div>
                <Field label="Rationale and planned orthogonal confirmation">
                  <textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="State how each flagged check will be resolved experimentally…" />
                </Field>
                <button className="btn mt" disabled={!overrideReason.trim()} onClick={() => setState((current) => ({
                  ...current,
                  override: { decision: overrideDecision, rationale: overrideReason.trim(), reviewer: "Workspace reviewer", recordedAt: "2026-08-28 09:41" },
                }))}><ShieldCheck size={15} /> Record manual review</button>
              </div>}
          </span>
        </div>
      )}
    </section>

    <DossierFlow dossier={record.study_dossier} />

    {/* ── what to do next ───────────────────────────────────────────
        These read as a pair — the experiments that would close the gaps,
        and the gaps themselves — so they sit side by side at full width
        immediately before the handoff that acts on them. */}
    <div className="grid-2">
      <section className="panel">
        <SectionHeader icon={<TestTube2 size={18} />} eyebrow={t("WHAT WOULD RESOLVE THIS")} title={t("Recommended next experiments")} accent="l1"
          description={t("Ordered by how much each would reduce the uncertainty driving this verdict.")} />
        <ol className="rail-list">
          {verdict.recommended_next_experiments.map((item, index) => (
            <li key={index}><span className="n">{index + 1}</span><span>{item}</span></li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <SectionHeader icon={<AlertTriangle size={18} />} eyebrow={t("OPEN ITEMS")} title={t("Watch-outs")} accent="l1"
          description={t("Risks the screen raised, and evidence it could not supply.")} />
        <ul className="rail-tags">
          {verdict.major_risks.map((risk, index) => <li key={`r${index}`}><AlertTriangle size={13} />{risk}</li>)}
          {verdict.missing_evidence.map((gap, index) => <li key={`m${index}`} className="muted"><CircleHelp size={13} />{gap}</li>)}
        </ul>
      </section>
    </div>

    {/* ── handoff ───────────────────────────────────────────────── */}
    <section className="panel">
      <SectionHeader icon={<BookOpen size={18} />} eyebrow={t("HANDOFF")} title={t("Wet-lab review report")} accent="l1"
        description={t("Downloads a complete PDF: every Layer 1 input, chemistry descriptor, simulation result, regulatory finding and recorded review is listed with its field path.")} />
      <div className="row">
        <button className="btn lg" onClick={report}><Download size={16} /> Download complete PDF</button>
        <button className="btn primary lg" onClick={onContinue} disabled={!canContinue}>
          {gateNeedsReview && !state.override ? "Record review to continue" : "Continue to Confirmation"} <ArrowRight size={16} />
        </button>
      </div>
      <div className="run-provenance">
        <div className="prov-engines">
          {record.provenance.engines.map((engine) => <span key={engine}>{engine}</span>)}
        </div>
        <p className="tiny muted">
          Computed {record.provenance.computed_at} · {num(record.provenance.inference_time_ms / 1000, 1)}s ·
          schema {record.provenance.schema_version} · excluded from this run: {record.provenance.excluded.join(", ")}
        </p>
      </div>
    </section>
  </>;
}

/* ── sub-panels ──────────────────────────────────────────────────────────── */

function IndicationContextPanel({ context }: { context: any }) {
  if (!context) return null;
  if (!context.available) {
    return <section className="panel">
      <SectionHeader icon={<Compass size={18} />} eyebrow={t("INDICATION CONTEXT")} title={t("No therapeutic area stated")} accent="l1" />
      <p className="hint-muted">{context.reason}</p>
    </section>;
  }
  return <section className="panel">
    <SectionHeader icon={<Compass size={18} />} eyebrow={t("INDICATION CONTEXT")} title={`Reading this screen for ${context.stated_area}`} accent="l1"
      description={context.profile ? `${context.profile} profile · MedDRA SOC ${context.meddra_soc} · ICD-11 ${context.icd11}` : undefined} />
    <Notice kind="info" icon={<Info size={15} />}>{context.predictions_note}</Notice>
    <DlGrid entries={[
      ["Severity", titleCase(context.severity)],
      ["Unmet need", titleCase(context.unmet_need)],
      ["Directional profile", context.profile ?? "No directional profile matched"],
      ["Risk tolerance", context.risk_tolerance],
      ["Profile note", context.profile_note],
      ["Decision-critical endpoints", context.decision_critical_endpoints.join(" · ")],
    ]} />
    {[
      ["Endpoints this indication reads differently", context.directional_endpoints, (entry: any) => entry.favourable_direction === "high" ? "higher is favourable" : "lower is favourable"],
      ["Endpoints read to a narrower window", context.windowed_endpoints, () => "narrower window"],
      ["Endpoints that may be the mechanism, not a hazard", context.mechanism_candidates, () => "check intent"],
      ["Endpoints carrying less regulatory weight here", context.deprioritised_endpoints, () => "reduced weight"],
    ].map(([title, entries, badge]: any) => (entries?.length ? (
      <div key={title}>
        <div className="sub-label">{title}</div>
        <DataTable
          columns={[
            { key: "e", header: "Endpoint", render: (row: any) => <code>{row.endpoint}</code> },
            { key: "d", header: "Reading", render: (row: any) => <StatusPill status="caution" label={badge(row)} /> },
            { key: "n", header: "Why", render: (row: any) => row.note },
          ]}
          rows={entries}
        />
      </div>
    ) : null))}
  </section>;
}

function RouteContextPanel({ context }: { context: any }) {
  if (!context) return null;
  return <section className="panel">
    <SectionHeader icon={<Workflow size={18} />} eyebrow={t("ROUTE CONTEXT")} accent="l1"
      title={context.available ? `Reading this screen for the ${context.label.toLowerCase()} route` : "Clinical route not selected"}
      description={t("Interpretation only — raw model values are unchanged.")} />
    <Notice kind="info" icon={<Info size={15} />}>{context.prediction_note}</Notice>
    <DlGrid entries={[
      ["Gate treatment", context.gate_note],
      ["Oral ADME endpoints", context.oral_endpoints_decisive ? "Decision-relevant" : "Reported as context"],
      ["Route selection", context.available ? "Declared" : "Required before progression"],
    ]} />
    <div className="sub-label">Route-specific evidence to collect</div>
    <ul className="rail-tags">
      {context.required_evidence.map((item: string, index: number) => <li key={index}><Check size={12} style={{ color: "var(--good)" }} />{item}</li>)}
    </ul>
  </section>;
}

function TargetEvidencePanel({ record, selectivity }: { record: L1Record; selectivity: any }) {
  const resolution = record.target_resolution;
  return <section className="panel">
    <SectionHeader icon={<Target size={18} />} eyebrow={t("TARGET EVIDENCE")} title={t("Target resolution, off-target and selectivity")} accent="l1"
      description={t("Measured activity from structurally related compounds, grouped by activity type. A cross-type median is never computed.")} />

    <div className="sub-label">Resolved target</div>
    <DlGrid entries={[
      ["Status", titleCase(resolution.status)],
      ["Target protein", resolution.target_protein],
      ["Gene symbol", resolution.gene_symbol],
      ["UniProt accession", resolution.uniprot_id],
      ["PDB structure", resolution.pdb_id],
      ["Organism", resolution.organism],
      ["Confidence", titleCase(resolution.confidence)],
      ["Evidence type", titleCase(resolution.evidence_type)],
      ["Sequence length", (resolution as any).sequence_length],
    ]} />
    {resolution.provenance.length > 0 && <>
      <div className="sub-label">Resolution provenance</div>
      <ul className="rail-tags">{resolution.provenance.map((item, index) => <li key={index}><Check size={12} style={{ color: "var(--good)" }} />{item}</li>)}</ul>
    </>}
    {resolution.limitations.length > 0 && <>
      <div className="sub-label">Limitations</div>
      <ul className="rail-tags">{resolution.limitations.map((item, index) => <li key={index}><AlertTriangle size={12} />{item}</li>)}</ul>
    </>}

    {record.target_evidence && <>
      <div className="sub-label">Retrieval quality for the selected target</div>
      <DlGrid entries={[
        ["ChEMBL target", record.target_evidence.targetChemblId],
        ["Evidence tier", record.target_evidence.quality.tier],
        ["Confidence score", record.target_evidence.confidenceScore],
        ["Method", record.target_evidence.method],
        ["Provenance", record.target_evidence.quality.provenance],
        ["Measurements", record.target_evidence.quality.payload.nMeasurements],
        ["Distinct compounds", record.target_evidence.quality.payload.distinctCompounds],
        ["Potency range", `${num(record.target_evidence.quality.payload.range_nM[0])} – ${num(record.target_evidence.quality.payload.range_nM[1])} nM`],
        ["Geometric mean", `${num(record.target_evidence.quality.payload.geometricMean_nM)} nM`],
        ["Species", record.target_evidence.quality.payload.species.join(", ")],
        ["Assay types", Object.entries(record.target_evidence.quality.payload.assayTypes).map(([type, count]) => `${type} (${count})`).join(", ")],
        ["Assay formats", Object.entries(record.target_evidence.quality.payload.assayFormats).map(([format, count]) => `${format} (${count})`).join(", ")],
        ["Linked PDB structures", record.target_evidence.pdbIds.join(", ")],
      ]} />
    </>}

    {selectivity?.status === "completed" ? <>
      {(() => {
        const groups = [...(selectivity.primary_target_evidence ?? []), ...(selectivity.off_targets ?? [])].flatMap((entry: any) => entry.potency_groups);
        const estimated = groups.filter((group: any) => group.potency_estimate);
        const measurements = groups.reduce((total: number, group: any) => total + group.supporting_measurement_count, 0);
        const compounds = groups.reduce((total: number, group: any) => total + group.independent_compound_count, 0);
        return <div className="grid-2 mt">
          <MetricDonut value={estimated.length} total={groups.length} label="potency groups"
            caption={t("{met} of {total} returned potency groups meet the independent-analogue requirement of at least three compounds.",
              { met: estimated.length, total: groups.length })} />
          <div>
            <TileRow>
              <Tile label="Primary target groups" value={(selectivity.primary_target_evidence ?? []).length} note={t("Activity types retained separately")} />
              <Tile label="Eligible off-targets" value={(selectivity.off_targets ?? []).length} note={`${selectivity.insufficient_off_target_target_count} excluded for insufficient analogues`} />
              <Tile label="Supporting measurements" value={measurements} note={t("Across all retained groups")} />
              <Tile label="Independent analogues" value={compounds} note={t("Distinct compounds, not measurements")} />
            </TileRow>
          </div>
        </div>;
      })()}

      {(selectivity.primary_target_evidence ?? []).map((entry: any) => (
        <div key={entry.target_chembl_id}>
          <div className="sub-label">Primary target — {entry.target_name}</div>
          <DataTable
            columns={[
              { key: "t", header: "Activity type", render: (row: any) => <b>{row.activity_type}</b> },
              { key: "e", header: "Read-across estimate", render: (row: any) => row.potency_estimate ? row.potency_estimate.display : <span className="pill warn">Insufficient evidence</span> },
              { key: "c", header: "Independent compounds", align: "right", render: (row: any) => row.independent_compound_count },
              { key: "m", header: "Measurements", align: "right", render: (row: any) => row.supporting_measurement_count },
              { key: "o", header: "Organisms", render: (row: any) => row.organisms.join(", ") },
              { key: "u", header: "Reported units", render: (row: any) => row.reported_units.join(", ") },
              { key: "r", header: "Reason", render: (row: any) => row.insufficient_reason ?? "—" },
            ]}
            rows={entry.potency_groups}
          />
          <div className="sub-label">Assay context</div>
          <ul className="rail-tags">
            {entry.potency_groups.flatMap((group: any) => group.assay_contexts).map((context: string, index: number) => (
              <li key={index} className="muted"><Info size={12} />{context}</li>
            ))}
          </ul>
        </div>
      ))}

      {(selectivity.off_targets ?? []).length > 0 ? <>
        <div className="sub-label">Off-target evidence</div>
        <DataTable
          columns={[
            { key: "n", header: "Target", render: (row: any) => <><b>{row.target_name}</b><small>{row.target_chembl_id}</small></> },
            { key: "t", header: "Activity type", render: (row: any) => row.potency_groups[0]?.activity_type },
            { key: "e", header: "Read-across median", render: (row: any) => row.potency_groups[0]?.potency_estimate?.display ?? "insufficient" },
            { key: "c", header: "Compounds", align: "right", render: (row: any) => row.potency_groups[0]?.independent_compound_count },
            { key: "m", header: "Measurements", align: "right", render: (row: any) => row.potency_groups[0]?.supporting_measurement_count },
          ]}
          rows={selectivity.off_targets}
        />
      </> : <Notice kind="plain" icon={<CircleHelp size={15} />}>
        No eligible off-target record was returned in this retrieval. That does not demonstrate that the molecule is selective.
      </Notice>}

      {selectivity.insufficient_off_target_target_count > 0 && (
        <p className="hint-muted mt">{selectivity.insufficient_off_target_target_count} other retrieved target(s) did not meet the independent-analogue threshold, so no off-target potency estimate is shown for them.</p>
      )}
      <div className="sub-label">Method and limitations</div>
      <p className="hint-muted">{selectivity.method}</p>
      <ul className="rail-tags mt">{selectivity.limitations.map((item: string, index: number) => <li key={index} className="muted"><Info size={12} />{item}</li>)}</ul>
    </> : <Notice kind="plain" icon={<CircleHelp size={15} />}>{selectivity?.reason ?? "No selectivity evidence was retrieved."}</Notice>}
  </section>;
}

function SafetyPanel({ record, profile }: { record: L1Record; profile: CompoundProfile }) {
  const safety = record.safety_assessments;
  const reliability = record.assay_reliability;
  const feasibility = record.synthetic_feasibility as any;
  const applicability = record.tanimoto_applicability;

  return <section className="panel">
    <SectionHeader icon={<AlertTriangle size={18} />} eyebrow={t("SAFETY REVIEW")} title={t("Safety, applicability and structural review")} accent="l1"
      description={t("Dedicated safety models, the applicability domain that decides whether they may speak about this chemistry, and the structural-alert screen.")} />

    <div className="grid-2">
      {Object.values(safety).map((entry: any) => {
        const t = entry.risk_class === "Low" ? "good" : entry.risk_class === "Moderate" ? "warn" : "bad";
        return <Card key={entry.endpoint} icon={<HeartPulse size={16} />} title={entry.endpoint}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 26, letterSpacing: "-.03em" }}>{(entry.model_value * 100).toFixed(1)}%</b>
            <span className={`pill ${t}`}><span className={`dot ${t}`} />{entry.status_label}</span>
          </div>
          <DlGrid entries={[
            ["Model", entry.source],
            ["Unit", entry.unit],
            ["Risk class", entry.risk_class],
            ...(entry.ic50_band ? [["Estimated IC50 band", entry.ic50_band] as [string, unknown]] : []),
            ...(entry.conformal_decision ? [["Conformal decision", entry.conformal_decision] as [string, unknown]] : []),
            ["Applicability domain", `${titleCase(entry.applicability.domain)} · T ${num(entry.applicability.nearest_tanimoto)}`],
            ["Basis", entry.basis],
          ]} />
        </Card>;
      })}
    </div>

    <Card icon={<Network size={16} />} title={t("Model applicability domain")}
      subtitle={t("Whether each model's training chemistry contains anything close to the submitted structure. Outside the domain, a value is an extrapolation and is labelled as one.")}
      note={applicability.interpretation}>
      <Anchors entries={[
        ["Overall domain", titleCase(applicability.domain)],
        ["Nearest training analogue", `T ${num(applicability.nearest_tanimoto)}`],
        ["Nearest reference compound", applicability.nearest_reference],
        ["Similarity threshold", num(applicability.threshold)],
      ]} />
      <DataTable
        columns={[
          { key: "m", header: "Model", render: (row: any) => <b>{row[0]}</b> },
          { key: "d", header: "Domain", render: (row: any) => <StatusPill status={row[1].domain === "in_domain" ? "pass" : row[1].domain === "borderline" ? "caution" : "fail"} label={titleCase(row[1].domain)} /> },
          { key: "t", header: "Nearest Tanimoto", align: "right", render: (row: any) => num(row[1].nearest_tanimoto) },
          { key: "n", header: "Basis", render: (row: any) => row[1].note },
        ]}
        rows={Object.entries(applicability.model_domains)}
      />
      <p className="hint-muted mt">Reference panel: {applicability.reference_set} ({applicability.n_reference_compounds} approved compounds).</p>
    </Card>

    <Card icon={<ScanSearch size={16} />} title={t("Structural alerts")} subtitle={t("PAINS, Brenk and NIH substructure screen.")} note={reliability.display_rule}>
      <Anchors entries={[
        ["Summary", reliability.display_summary],
        ["Alert level", titleCase(reliability.overall_alert_level)],
        ["PAINS matches", reliability.pains.count],
        ["Brenk matches", reliability.brenk.count],
      ]} />
      <p className="hint-muted mb">{reliability.interpretation}</p>
      {reliability.pains.count + reliability.brenk.count > 0 ? (
        <DataTable
          columns={[
            { key: "s", header: "Alert set", render: (row: any) => <StatusPill status={row.set === "PAINS" ? "fail" : "caution"} label={row.set} /> },
            { key: "n", header: "Substructure", render: (row: any) => <b>{row.name}</b> },
            { key: "d", header: "Why it matters", render: (row: any) => row.description },
            { key: "v", header: "Severity", render: (row: any) => titleCase(row.severity) },
          ]}
          rows={[...reliability.pains.alerts.map((alert: any) => ({ ...alert, set: "PAINS" })), ...reliability.brenk.alerts.map((alert: any) => ({ ...alert, set: "Brenk" }))]}
        />
      ) : <Notice kind="good" icon={<Check size={15} />}>No pan-assay-interference or reactive-functionality substructure was matched. A clean screen does not demonstrate that an assay readout is reliable.</Notice>}
      {reliability.recommended_controls.length > 0 && <>
        <div className="sub-label">Recommended controls</div>
        <ul className="rail-tags">{reliability.recommended_controls.map((control: string, index: number) => <li key={index}><Check size={12} style={{ color: "var(--good)" }} />{control}</li>)}</ul>
      </>}
      <p className="hint-muted mt">{reliability.display_recommendation}</p>
    </Card>

    <Card icon={<FlaskConical size={16} />} title={t("Synthetic feasibility")}
      subtitle={t("Offline synthetic-accessibility and natural-product-likeness scores for novel-molecule triage.")}
      note={feasibility.method_note}>
      {feasibility.available ? <>
        <Anchors entries={[
          ["Synthetic accessibility", `${num(feasibility.synthetic_accessibility.sa_score)} · ${titleCase(feasibility.synthetic_accessibility.sa_class)}`],
          ["Scale", feasibility.synthetic_accessibility.scale],
          ["Natural-product likeness", num(feasibility.natural_product_likeness.np_score)],
          ["NP class", titleCase(feasibility.natural_product_likeness.np_class)],
        ]} />
        <p className="hint-muted">{feasibility.synthetic_accessibility.interpretation}</p>
        <p className="hint-muted mt">{feasibility.natural_product_likeness.interpretation}</p>
      </> : <p className="hint-muted">{feasibility.error_reason}</p>}
    </Card>
  </section>;
}

function RegulatoryPanel({ outlook }: { outlook: any }) {
  const analogues = outlook.structural_analogs ?? [];
  return <section className="panel">
    <SectionHeader icon={<ShieldCheck size={18} />} eyebrow={t("REGULATORY REVIEW")} title={t("Regulatory precedent outlook")} accent="l1"
      description={t("Exact identity first, then PubChem structural neighbours checked against public OpenFDA records with the similarity recomputed locally before it is reported.")} />
    <div className={`notice ${outlook.exact_structure_match ? "good" : outlook.status === "not_found" ? "warn" : "info"}`}>
      {outlook.exact_structure_match ? <BadgeCheck size={16} /> : <ScanSearch size={16} />}
      <span>
        <b>{outlook.exact_structure_match
          ? "Exact FDA precedent found"
          : analogues.length
            ? `${analogues.length} FDA-linked structural precedent${analogues.length === 1 ? "" : "s"} found`
            : "Novel identity — no retrieved FDA precedent"}</b>
        <p style={{ marginTop: 4 }}>{outlook.reason}</p>
      </span>
    </div>

    <DlGrid entries={[
      ["Outlook class", titleCase(outlook.outlook_class)],
      ["Identity", outlook.identity_name ?? "No exact identity resolved"],
      ["InChIKey", outlook.inchikey],
      ["Drugs@FDA applications", (outlook.drugsfda_applications ?? []).length],
      ["Drug labels", (outlook.drug_labels ?? []).length],
      ["Structural precedents", analogues.length],
      ["Sources queried", (outlook.sources ?? []).join(", ")],
    ]} />

    {(outlook.drugsfda_applications ?? []).length > 0 && <>
      <div className="sub-label">Drugs@FDA applications</div>
      <DataTable
        columns={[
          { key: "a", header: "Application", render: (row: any) => <b>{row.application_number}</b> },
          { key: "s", header: "Sponsor", render: (row: any) => row.sponsor },
          { key: "st", header: "Status", render: (row: any) => row.submission_status },
          { key: "y", header: "Approval year", align: "right", render: (row: any) => row.approval_year },
        ]}
        rows={outlook.drugsfda_applications}
      />
    </>}

    {analogues.length > 0 && <>
      <div className="sub-label">Closest FDA-linked structures</div>
      <div className="mb">
        <RankChart
          title={t("Structural similarity to FDA-linked compounds")}
          subtitle={t("Morgan fingerprint similarity, recomputed locally against the retrieved structure")}
          points={analogues.map((analogue: any) => ({
            label: analogue.name, value: analogue.similarity_percent,
            detail: `${analogue.similarity_percent}%`,
            tone: analogue.boxed_warning_present ? ("warn" as const) : ("neutral" as const),
          }))}
          valueLabel="% similarity" domain={[0, 100]}
          footnote="Similarity is context, not interchangeability. A close structural neighbour with a boxed warning is a prompt to screen for that class liability explicitly."
        />
      </div>
      <DataTable
        columns={[
          { key: "n", header: "Compound", render: (row: any) => <><b>{row.name}</b><small>{row.inchikey}</small></> },
          { key: "s", header: "Similarity", align: "right", render: (row: any) => `${row.similarity_percent}%` },
          { key: "e", header: "Evidence", render: (row: any) => row.evidence_kind },
          { key: "a", header: "Applications", align: "right", render: (row: any) => row.application_count },
          { key: "l", header: "Labels", align: "right", render: (row: any) => row.label_count },
          { key: "b", header: "Brands", render: (row: any) => row.brands.join(", ") },
          { key: "r", header: "Routes", render: (row: any) => row.routes.join(", ") },
          { key: "w", header: "Boxed warning", render: (row: any) => row.boxed_warning_present ? <StatusPill status="fail" label="Boxed warning" /> : "—" },
        ]}
        rows={analogues}
      />
    </>}

    <div className="sub-label">Evidence-led direction</div>
    <ol className="rail-list">
      {(outlook.directions ?? []).map((direction: any) => (
        <li key={direction.priority}>
          <span className="n">{direction.priority}</span>
          <span><b style={{ display: "block", marginBottom: 3 }}>{direction.action}</b>{direction.rationale}</span>
        </li>
      ))}
    </ol>
    <p className="limitation"><Database size={13} /> {outlook.limitation}</p>
  </section>;
}
