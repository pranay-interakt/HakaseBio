/* ───────────────────────────────────────────────────────────────────────────
   Lab — experimental Hakase dashboard (route /lab).

   Distinct light UI; reuses ONLY the backend computation libraries so every
   number is produced by the real engine. Rich small-molecule input experience
   (live structure, auto target match, live ADMET-AI preview, simulation
   options, templates) → Layer 1 → Confirmation → IVIVE. No animal / FIH.
   ─────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlaskConical, Sparkles, Leaf, AlertTriangle, Info, CheckCircle2, Loader2,
  ArrowRight, ShieldCheck, Workflow, Beaker, Droplets, Activity, Target as TargetIcon,
  Microscope, ScrollText, Boxes, Database, Atom, Hexagon,
} from "lucide-react";

import "../lab/lab.css";
import {
  runSmallMoleculeL1, runPeptideL1, SM_SAMPLES, PEP_SAMPLES, SM_TEMPLATES, PEP_TEMPLATES,
  quickMolProps, get2dSvg, localTargetMatches, chemblTargetMatches, previewAdmet, molBlockFor3D, ensureChemistry,
  type SmallMoleculeL1Result, type PeptideL1Result, type ChemblMatch, type AdmetPreview,
} from "@/lab/pipeline";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import type { MolecularProperties } from "@/lib/chemistry";
import type { TargetSuggestion } from "@/lib/targetSuggestion";
import { ADMET_META, formatAdmetValue } from "@/lib/admetMeta";
import type { MlAdmetResult } from "@/lib/aiService";

import {
  type ConfirmationEvidenceBlock, type EvidencePointer, type ExVivoEntryMode,
  type FalsifierId, type FalsifierTrigger, type GatePolicySnapshot,
  type OverrideRecord, type PreConfirmationDirective, type Role,
} from "@workspace/preclinical-handoff";
import {
  buildConfirmationBlock, buildExVivoEvidence, buildInSilicoEvidenceFromL1,
  buildOverride, checkFalsifiers, defaultGatePolicy, emitDirective,
  evaluateInSilicoGate, freezeL1EvidencePointer, l1ConfidenceByClass,
  type ExVivoMeasurement,
} from "@/lib/confirmationEngine";

import {
  emptyIvieWetLabInputs, autoFillIvieEstimates, assessIvieTier, applyFuMicCorrection,
  validateIvieValue, humanFuPlasma, humanFuMic, humanBpRatio,
  IVIE_SPECIES, IVIE_SPECIES_LABEL,
  type IvieWetLabInputs, type IvieMeasurement, type IvieSpecies,
} from "@/lib/ivieInputs";
import { computeL2DoseProjection, type L2DoseProjection } from "@/lib/l2DoseProjection";

const LOGO = `${import.meta.env.BASE_URL}hakase-logo.png`;

// ── 3Dmol CDN loader (same pattern as the production viewers) ─────────────────
declare global { interface Window { $3Dmol?: any; } }
let _3DmolPromise: Promise<any> | null = null;
function load3Dmol(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.$3Dmol?.createViewer) return Promise.resolve(window.$3Dmol);
  if (_3DmolPromise) return _3DmolPromise;
  _3DmolPromise = new Promise<any>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://3dmol.org/build/3Dmol-min.js"; s.async = true;
    s.onload = () => (window.$3Dmol?.createViewer ? resolve(window.$3Dmol) : reject(new Error("3Dmol missing")));
    s.onerror = () => reject(new Error("Failed to load 3Dmol"));
    document.head.appendChild(s);
  });
  return _3DmolPromise;
}

type ViewStyle = "ball-stick" | "stick" | "sphere";
function Mol3DViewer({ molblock, style }: { molblock: string; style: ViewStyle }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let dead = false;
    load3Dmol().then(($3Dmol) => {
      if (dead || !ref.current) return;
      ref.current.innerHTML = "";
      const v = $3Dmol.createViewer(ref.current, { backgroundColor: "white" });
      viewerRef.current = v;
      v.addModel(molblock, "mol");
      applyStyle(v, style);
      v.zoomTo(); v.render(); v.zoom(1.1, 400);
    }).catch(() => !dead && setErr(true));
    return () => { dead = true; try { viewerRef.current?.clear?.(); } catch {} };
  }, [molblock]);
  useEffect(() => { const v = viewerRef.current; if (v) { applyStyle(v, style); v.render(); } }, [style]);
  function applyStyle(v: any, s: ViewStyle) {
    v.setStyle({}, s === "stick" ? { stick: { radius: 0.14, colorscheme: "Jmol" } }
      : s === "sphere" ? { sphere: { scale: 0.32, colorscheme: "Jmol" } }
      : { stick: { radius: 0.12, colorscheme: "Jmol" }, sphere: { scale: 0.26, colorscheme: "Jmol" } });
  }
  if (err) return <div className="lab-3d" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--faint)", fontSize: 12 }}>3D viewer unavailable offline</div>;
  return <div className="lab-3d" ref={ref} />;
}

// ── helpers ───────────────────────────────────────────────────────────────────
type Tone = "go" | "watch" | "nogo" | "known";
function verdictTone(v: string): Tone { return v === "GO" ? "go" : v === "WATCH" ? "watch" : v === "KNOWN-LIABILITY-NO-GO" ? "known" : "nogo"; }
const TONE_CLASS: Record<Tone, string> = { go: "v-go", watch: "v-watch", nogo: "v-nogo", known: "v-known" };
const TONE_COLOR: Record<Tone, string> = { go: "var(--go)", watch: "var(--watch)", nogo: "var(--nogo)", known: "var(--known)" };
const barColor = (s: number) => (s >= 70 ? "var(--go)" : s >= 40 ? "var(--watch)" : "var(--nogo)");
function fmt(v: number | null | undefined, dec = 2, unit = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(dec)}${unit ? " " + unit : ""}`;
}
const confColor = (label: string) =>
  label === "High" || label === "Experimental" ? { background: "var(--go-bg)", color: "#0e7a51" }
  : label === "Medium" ? { background: "var(--watch-bg)", color: "#946312" }
  : { background: "var(--surface-3)", color: "var(--muted)" };

function ProvPill({ p }: { p?: string }) { return p ? <span className={`lab-prov prov-${p}`}>{p}</span> : null; }
function Card({ title, note, icon, dot, id, children }: { title: string; note?: string; icon?: React.ReactNode; dot?: string; id?: string; children: React.ReactNode; }) {
  return (
    <section className="lab-card lab-fade" id={id}>
      <div className="lab-card-head">{dot && <span className="lab-dot" style={{ background: dot }} />}{icon}<h3 className="lab-card-title">{title}</h3></div>
      {note && <p className="lab-card-note">{note}</p>}
      {children}
    </section>
  );
}
function Row({ label, sub, value }: { label: string; sub?: string; value: React.ReactNode }) {
  return <div className="lab-row"><div className="lab-row-l"><span className="lab-row-label">{label}</span>{sub && <span className="lab-row-sub">{sub}</span>}</div><span className="lab-row-v">{value}</span></div>;
}
function VerdictHero({ verdict, score, confidence, headline, rationale, chips }: { verdict: string; score: number; confidence: string; headline: string; rationale: string; chips?: React.ReactNode; }) {
  const tone = verdictTone(verdict);
  return (
    <div className={`lab-verdict ${TONE_CLASS[tone]}`}>
      <span className={`lab-verdict-badge ${TONE_CLASS[tone]}`}>{verdict}</span>
      <div className="lab-verdict-meta">
        <span className="lab-verdict-headline">{headline}</span>
        <span className="lab-verdict-rationale">{rationale}</span>
        <div className="lab-chip-row" style={{ marginTop: 5 }}><span className="lab-chip">Confidence · {confidence}</span>{chips}</div>
      </div>
      <div className="lab-score-ring"><span className="lab-score-num" style={{ color: TONE_COLOR[tone] }}>{Math.round(score)}</span><span className="lab-score-cap">triage / 100</span></div>
    </div>
  );
}
function Dimensions({ dims }: { dims: Array<{ dimension: string; score: number; weight: number; provenance?: string; detail?: string }> }) {
  if (!dims?.length) return null;
  return <div>{dims.map((d, i) => (
    <div className="lab-dim" key={i}>
      <div className="lab-dim-top"><span className="lab-dim-name">{d.dimension} <ProvPill p={d.provenance} /></span><span className="lab-dim-val">{Math.round(d.score)} · w{(d.weight * 100).toFixed(0)}%</span></div>
      <div className="lab-bar"><div className="lab-bar-fill" style={{ width: `${Math.max(2, Math.min(100, d.score))}%`, background: barColor(d.score) }} /></div>
      {d.detail && <div className="lab-dim-detail">{d.detail}</div>}
    </div>
  ))}</div>;
}
function Flags({ flags }: { flags: Array<{ label: string; severity: string; rationale: string; value?: string; threshold?: string; source?: string; provenance?: string }> }) {
  if (!flags?.length) return <div className="lab-note-soft" style={{ display: "flex", gap: 8, alignItems: "center" }}><CheckCircle2 size={15} style={{ color: "var(--go)" }} /> No liability flags raised on this candidate.</div>;
  const cls = (s: string) => s === "critical" ? "lab-flag-crit" : s === "warn" ? "lab-flag-warn" : "lab-flag-info";
  const icon = (s: string) => s === "critical" ? <AlertTriangle size={16} style={{ color: "var(--nogo)" }} /> : s === "warn" ? <AlertTriangle size={16} style={{ color: "var(--watch)" }} /> : <Info size={16} style={{ color: "var(--info)" }} />;
  return <div>{flags.map((f, i) => (
    <div className={`lab-flag ${cls(f.severity)}`} key={i}><div style={{ paddingTop: 1 }}>{icon(f.severity)}</div>
      <div className="lab-flag-body"><span className="lab-flag-label">{f.label} <ProvPill p={f.provenance} /></span><span className="lab-flag-why">{f.rationale}</span>
        {(f.value || f.threshold) && <span className="lab-flag-meta">{f.value}{f.threshold ? `  ·  ${f.threshold}` : ""}{f.source ? `  ·  ${f.source}` : ""}</span>}</div></div>
  ))}</div>;
}
function Toggle({ name, sub, on, onChange }: { name: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="lab-toggle">
      <div className="lab-toggle-txt"><div className="lab-toggle-name">{name}</div><div className="lab-toggle-sub">{sub}</div></div>
      <div className={`lab-switch ${on ? "is-on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live preview rail (right side of the input card)
// ─────────────────────────────────────────────────────────────────────────────
function StructurePreview({ smiles, molProps }: { smiles: string; molProps: MolecularProperties | null }) {
  const [tab, setTab] = useState<"2d" | "3d">("2d");
  const [style3d, setStyle3d] = useState<ViewStyle>("ball-stick");
  const svg = useMemo(() => (molProps ? get2dSvg(smiles, 300, 210) : null), [smiles, molProps]);
  const mol3d = useMemo(() => (tab === "3d" && molProps ? molBlockFor3D(smiles) : null), [tab, smiles, molProps]);
  return (
    <div className="lab-subcard">
      <div className="lab-subcard-h"><Hexagon size={14} style={{ color: "var(--teal)" }} /> Structure
        <span className="lab-hint" style={{ marginLeft: "auto" }}>
          <span className="lab-3dtabs">
            <button className={tab === "2d" ? "is-active" : ""} onClick={() => setTab("2d")}>2D</button>
            <button className={tab === "3d" ? "is-active" : ""} onClick={() => setTab("3d")}>3D</button>
          </span>
        </span>
      </div>
      {!molProps ? (
        <div className="lab-struct" style={{ color: "var(--faint)", fontSize: 12 }}>Enter a valid SMILES to render the structure</div>
      ) : tab === "2d" ? (
        <div className="lab-struct" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
      ) : mol3d ? (
        <>
          <Mol3DViewer molblock={mol3d.molblock} style={style3d} />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
            <span className="lab-3dtabs">
              {(["ball-stick", "stick", "sphere"] as ViewStyle[]).map((s) => (
                <button key={s} className={style3d === s ? "is-active" : ""} onClick={() => setStyle3d(s)}>{s === "ball-stick" ? "Ball & stick" : s === "stick" ? "Stick" : "Sphere"}</button>
              ))}
            </span>
          </div>
        </>
      ) : <div className="lab-struct" style={{ color: "var(--faint)", fontSize: 12 }}>3D embedding could not be generated for this structure</div>}
    </div>
  );
}

function GlanceCard({ p }: { p: MolecularProperties }) {
  return (
    <div className="lab-subcard">
      <div className="lab-subcard-h"><Atom size={14} style={{ color: "var(--teal)" }} /> Molecule at a glance <span className="lab-hint">RDKit · live</span></div>
      <div className="lab-mini">
        <div><div className="k">MW</div><div className="v">{fmt(p.mw, 0)}</div></div>
        <div><div className="k">cLogP</div><div className="v">{fmt(p.logP, 2)}</div></div>
        <div><div className="k">TPSA</div><div className="v">{fmt(p.tpsa, 0)}</div></div>
        <div><div className="k">HBD / HBA</div><div className="v">{p.hbd}/{p.hba}</div></div>
        <div><div className="k">Rot. bonds</div><div className="v">{p.rotBonds}</div></div>
        <div><div className="k">Arom. rings</div><div className="v">{p.numAromaticRings}</div></div>
        <div><div className="k">Fsp³</div><div className="v">{fmt(p.fsp3, 2)}</div></div>
        <div><div className="k">QED</div><div className="v">{fmt(p.qed_approx, 2)}</div></div>
        <div><div className="k">Stereo</div><div className="v">{p.numStereoCenters}</div></div>
      </div>
    </div>
  );
}

function TargetMatchCard({ smiles, molProps, selectedUniprot, onUse }: {
  smiles: string; molProps: MolecularProperties | null; selectedUniprot: string;
  onUse: (s: TargetSuggestion) => void;
}) {
  const local = useMemo(() => (molProps ? localTargetMatches(smiles, molProps) : []), [smiles, molProps]);
  const [chembl, setChembl] = useState<ChemblMatch | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setChembl(null); }, [smiles]);
  const runChembl = async () => { setLoading(true); try { setChembl(await chemblTargetMatches(smiles, "")); } finally { setLoading(false); } };
  const list = chembl?.suggestions?.length ? chembl.suggestions : local;
  const measured = !!chembl?.suggestions?.length;
  return (
    <div className="lab-subcard">
      <div className="lab-subcard-h"><TargetIcon size={14} style={{ color: "var(--teal)" }} /> Auto target match
        <span className="lab-hint" style={{ marginLeft: "auto" }}>{measured ? `ChEMBL · ${chembl!.method}` : "structure-inferred"}</span>
      </div>
      {!molProps ? (
        <div style={{ color: "var(--faint)", fontSize: 12 }}>Enter a valid SMILES to predict likely targets.</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--faint)", fontSize: 12 }}>No target met the confidence floor.</div>
      ) : list.slice(0, 4).map((s) => (
        <div className={`lab-tgt ${selectedUniprot === s.uniprotId ? "is-sel" : ""}`} key={s.uniprotId + s.geneName}>
          <div className="lab-tgt-main">
            <div className="lab-tgt-gene">{s.geneName || s.uniprotId} <span className="lab-row-sub lab-mono">{s.uniprotId}</span></div>
            <div className="lab-tgt-sub">{s.fullName} · {s.area}{(s.pdbIds?.length ?? 0) > 0 ? ` · ${s.pdbCount ?? s.pdbIds!.length} PDB` : ""}</div>
          </div>
          <span className="lab-tgt-conf" style={confColor(s.confidenceLabel)}>{(s.confidence * 100).toFixed(0)}% · {s.confidenceLabel}</span>
          <button className="lab-tgt-use" onClick={() => onUse(s)}>{selectedUniprot === s.uniprotId ? "Selected" : "Use"}</button>
        </div>
      ))}
      <button className="lab-btn lab-btn-ghost lab-btn-sm" style={{ marginTop: 10 }} onClick={runChembl} disabled={!molProps || loading}>
        {loading ? <Loader2 size={13} className="lab-spin" /> : <Database size={13} />} {loading ? "Querying ChEMBL…" : "Run ChEMBL match"}
      </button>
    </div>
  );
}

function AdmetPreviewCard({ preview, loading }: { preview: AdmetPreview | null; loading: boolean }) {
  const num = (k: string) => {
    const v = preview?.admet?.endpoints?.[k];
    return typeof v === "number" ? v : null;
  };
  const cypMax = Math.max(...["CYP1A2_Veith", "CYP2C9_Veith", "CYP2C19_Veith", "CYP2D6_Veith", "CYP3A4_Veith"].map((k) => num(k) ?? 0));
  const tox = [["DILI", num("DILI")], ["hERG", num("hERG")], ["AMES", num("AMES")], ["ClinTox", num("ClinTox")]]
    .filter(([, v]) => v != null) as Array<[string, number]>;
  const worst = tox.sort((a, b) => b[1] - a[1])[0];
  const sol = preview?.solubility?.prediction;
  const has = preview?.admet?.ml_available || preview?.solubility?.ml_available;
  return (
    <div className="lab-subcard">
      <div className="lab-subcard-h"><Activity size={14} style={{ color: "var(--teal)" }} /> Live ADMET-AI preview
        <span className="lab-hint" style={{ marginLeft: "auto" }}>{loading ? "loading…" : has ? "ADMET-AI v2 · ML" : "endpoint offline"}</span>
      </div>
      {loading && !preview ? (
        <div style={{ color: "var(--faint)", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={13} className="lab-spin" /> Querying model endpoints…</div>
      ) : !has ? (
        <div style={{ color: "var(--faint)", fontSize: 12 }}>ML endpoints unreachable — full heuristic profile still computed on Run.</div>
      ) : (
        <div className="lab-rows">
          {sol?.logS_predicted != null && <Row label="Aqueous solubility" sub={sol.solubility_class ?? undefined} value={`${fmt(sol.logS_predicted, 2)} logS`} />}
          {num("BBB_Martins") != null && <Row label="BBB penetration" value={`${(num("BBB_Martins")! * 100).toFixed(0)}%`} />}
          {num("PPBR_AZ") != null && <Row label="Plasma protein bound" value={`${num("PPBR_AZ")!.toFixed(0)}%`} />}
          {Number.isFinite(cypMax) && cypMax > 0 && <Row label="CYP inhibition (max)" sub="across 5 isoforms" value={`${(cypMax * 100).toFixed(0)}%`} />}
          {worst && <Row label={`Top tox signal · ${worst[0]}`} value={<span style={{ color: worst[1] > 0.6 ? "var(--nogo)" : worst[1] > 0.4 ? "var(--watch)" : "var(--ink)" }}>{(worst[1] * 100).toFixed(0)}%</span>} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full ADMET-AI 5-axis endpoint panel
// ─────────────────────────────────────────────────────────────────────────────
const AXES: Array<{ key: keyof MlAdmetResult["structured"]; label: string }> = [
  { key: "absorption", label: "Absorption" }, { key: "distribution", label: "Distribution" },
  { key: "metabolism", label: "Metabolism" }, { key: "excretion", label: "Excretion" },
  { key: "toxicity", label: "Toxicity" },
];
function AdmetFullPanel({ admet }: { admet: MlAdmetResult }) {
  if (!admet.ml_available) return null;
  return (
    <Card title="ADMET-AI · full endpoint panel" icon={<Activity size={16} style={{ color: "var(--teal)" }} />}
      note={`${admet.model_info.engine ?? "ADMET-AI v2"} · ${admet.model_info.endpoint_count ?? ""} endpoints · benchmark reliability shown per row.`}>
      <div className="lab-grid lab-grid-2">
        {AXES.map(({ key, label }) => {
          const entries = Object.entries(admet.structured[key] ?? {});
          if (!entries.length) return null;
          return (
            <div className="lab-subcard" key={key as string}>
              <div className="lab-subcard-h"><span className="lab-dot" style={{ background: "var(--teal)" }} /> {label}</div>
              <div className="lab-rows">
                {entries.map(([id, ev]) => {
                  const meta = ADMET_META[id];
                  const rel = meta?.reliability;
                  const tone = rel === "high" ? "var(--go)" : rel === "moderate" ? "var(--watch)" : rel === "low" ? "var(--nogo)" : "var(--faint)";
                  return (
                    <Row key={id} label={(ev as any).label ?? meta?.name ?? id}
                      sub={meta?.unit || undefined}
                      value={<>{formatAdmetValue(id, (ev as any).value)} {rel && <span className="lab-dot" title={rel} style={{ background: tone, display: "inline-block" }} />}</>} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SolubilityCard({ s }: { s: SmallMoleculeL1Result["solubility"] }) {
  if (s.ruleLogS == null && s.mlLogS == null) return null;
  const cls = (logS: number) => logS > -2 ? "Highly soluble" : logS > -4 ? "Soluble" : logS > -6 ? "Slightly soluble" : "Insoluble";
  return (
    <Card title="Aqueous solubility" icon={<Droplets size={16} style={{ color: "var(--teal)" }} />}
      note="Rule-based ESOL (Delaney 2004) cross-checked against the ML random-forest model.">
      <div className="lab-grid lab-grid-2">
        <div className="lab-subcard">
          <div className="lab-subcard-h">Rule-based · ESOL <span className="lab-hint">Delaney 2004</span></div>
          <div className="lab-tile-v" style={{ fontSize: 26 }}>{s.ruleLogS != null ? s.ruleLogS.toFixed(2) : "—"}</div>
          <div className="lab-tile-sub">logS (mol/L) · {s.ruleLogS != null ? cls(s.ruleLogS) : "—"}</div>
        </div>
        <div className="lab-subcard">
          <div className="lab-subcard-h">ML · random forest <span className="lab-hint">{s.divergent ? "divergent" : "concordant"}</span></div>
          <div className="lab-tile-v" style={{ fontSize: 26, color: s.divergent ? "var(--watch)" : "var(--ink)" }}>{s.mlLogS != null ? s.mlLogS.toFixed(2) : "—"}</div>
          <div className="lab-tile-sub">logS (mol/L) · {s.mlClass ?? "—"}</div>
        </div>
      </div>
      {s.divergent && <div className="lab-note-soft" style={{ marginTop: 12 }}>Rule-based and ML estimates diverge by ≥ 1 log unit — measure kinetic solubility before committing to a formulation strategy.</div>}
    </Card>
  );
}

function ExternalDbCard({ ext, target }: { ext: SmallMoleculeL1Result["external"]; target: SmallMoleculeL1Result["target"] }) {
  const { bindingDB, chembl, string, kegg, reactome, openTargets } = ext;
  const any = bindingDB || chembl || string || kegg || reactome || openTargets;
  if (!any) return null;
  const live = (s?: { status?: string }) => s?.status === "live";
  return (
    <Card title="Target intelligence · external databases" icon={<Database size={16} style={{ color: "var(--teal)" }} />}
      note={`Live evidence for ${target?.geneName || target?.uniprotId || "the resolved target"} — BindingDB, ChEMBL, STRING, KEGG, Reactome, Open Targets.`}>
      <div className="lab-grid lab-grid-2">
        {chembl && (
          <div className="lab-subcard"><div className="lab-subcard-h"><Beaker size={13} style={{ color: "var(--teal)" }} /> ChEMBL bioactivity <span className="lab-hint">{chembl.status}</span></div>
            <div className="lab-rows">
              <Row label="Targets with activity" value={String(chembl.targetCount)} />
              {chembl.activities.slice(0, 4).map((a, i) => <Row key={i} label={a.targetName || a.targetChemblId} sub={a.activityType} value={fmt(a.value_nM, 1, "nM")} />)}
            </div>
          </div>
        )}
        {bindingDB && (
          <div className="lab-subcard"><div className="lab-subcard-h"><Atom size={13} style={{ color: "var(--teal)" }} /> BindingDB <span className="lab-hint">{bindingDB.status}</span></div>
            <div className="lab-rows">
              <Row label="Ligands on target" value={String(bindingDB.ligandCount)} />
              <Row label="Median Ki" value={fmt(bindingDB.medianKi_nM, 1, "nM")} />
              <Row label="Median IC50" value={fmt(bindingDB.medianIC50_nM, 1, "nM")} />
            </div>
          </div>
        )}
        {openTargets && (
          <div className="lab-subcard"><div className="lab-subcard-h"><TargetIcon size={13} style={{ color: "var(--teal)" }} /> Open Targets <span className="lab-hint">{openTargets.status}</span></div>
            <div className="lab-rows">
              <Row label="Approved drugs" value={String(openTargets.approvedDrugs)} />
              <Row label="SM tractability" value={fmt(openTargets.tractability?.smallMolecule, 0)} />
              {openTargets.topDiseases.slice(0, 3).map((d, i) => <Row key={i} label={d.diseaseName} sub={`${d.knownDrugs} drugs · ${d.clinicalTrials} trials`} value={`${(d.score * 100).toFixed(0)}%`} />)}
            </div>
          </div>
        )}
        {string && (
          <div className="lab-subcard"><div className="lab-subcard-h"><Workflow size={13} style={{ color: "var(--teal)" }} /> STRING interactome <span className="lab-hint">{string.status}</span></div>
            <div className="lab-rows">
              <Row label="Functional partners" value={String(string.functionalPartners)} />
              <Row label="Hub score" value={String(string.hubScore)} />
              {string.topPartners.slice(0, 3).map((p, i) => <Row key={i} label={p.gene} sub={p.type} value={String(p.score)} />)}
            </div>
          </div>
        )}
        {kegg && (
          <div className="lab-subcard"><div className="lab-subcard-h"><ScrollText size={13} style={{ color: "var(--teal)" }} /> KEGG <span className="lab-hint">{kegg.status}</span></div>
            <div className="lab-rows">
              <Row label="Pathways" value={String(kegg.pathways.length)} />
              <Row label="Linked diseases" value={String(kegg.diseases.length)} />
              <Row label="Linked drugs" value={String(kegg.drugs.length)} />
              {kegg.pathways.slice(0, 2).map((p, i) => <Row key={i} label={p.name} value="" />)}
            </div>
          </div>
        )}
        {reactome && (
          <div className="lab-subcard"><div className="lab-subcard-h"><Boxes size={13} style={{ color: "var(--teal)" }} /> Reactome <span className="lab-hint">{reactome.status}</span></div>
            <div className="lab-rows">
              <Row label="Pathways" value={String(reactome.totalPathways)} />
              <Row label="Complexes" value={String(reactome.complexCount)} />
              <Row label="Reactions" value={String(reactome.reactionCount)} />
            </div>
          </div>
        )}
      </div>
      {!live(bindingDB ?? undefined) && !live(string ?? undefined) && !live(kegg ?? undefined) && (
        <div className="lab-note-soft" style={{ marginTop: 12 }}>Some live databases were unreachable — only sources that returned within the time budget are shown.</div>
      )}
    </Card>
  );
}

function NoveltyCard({ n }: { n: NonNullable<SmallMoleculeL1Result["novelty"]> }) {
  const tone = n.isKnownDrug ? "var(--known)" : n.noveltyScore > 0.7 ? "var(--teal)" : "var(--watch)";
  return (
    <Card title="Novelty & evidence footprint" icon={<Sparkles size={16} style={{ color: "var(--teal)" }} />} dot={tone}
      note="Public-record consensus across PubChem, UniChem, SureChEMBL patents and the literature.">
      <div className="lab-verdict" style={{ marginBottom: 12 }}>
        <span className="lab-verdict-badge" style={{ background: "var(--surface-2)", color: tone, fontSize: 17 }}>{n.verdict}</span>
        <div className="lab-verdict-meta"><span className="lab-verdict-headline">{n.summary}</span></div>
        <div className="lab-score-ring"><span className="lab-score-num" style={{ color: tone }}>{Math.round(n.noveltyScore * 100)}</span><span className="lab-score-cap">novelty</span></div>
      </div>
      <div className="lab-chip-row">
        <span className="lab-chip">{n.isKnownDrug ? "Known drug" : "Not a known drug"}</span>
        <span className="lab-chip">{n.inPatents ? "In patents (SureChEMBL)" : "No patent hit"}</span>
        <span className="lab-chip">{n.hits.length} public reference{n.hits.length === 1 ? "" : "s"}</span>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small-molecule output (full)
// ─────────────────────────────────────────────────────────────────────────────
function SmallMoleculeResults({ r, showSafety }: { r: SmallMoleculeL1Result; showSafety: boolean }) {
  const { simResults: sim, inVitroResults: iv, scorecard: sc, target, binding, known, applicabilityDomain: ad, reactiveMets: rm, bsep } = r;
  const prov = sim.provenance ?? {}; const ivProv = iv.provenance ?? {}; const sa = sim.structuralAlerts;
  return (
    <div className="lab-fade">
      <VerdictHero verdict={sc.verdict} score={sc.score} confidence={sc.confidenceLabel} headline={sc.headline} rationale={sc.rationale}
        chips={<><span className={`lab-chip ${r.mlAvailable ? "is-teal" : ""}`}>{r.mlAvailable ? "ML-enhanced" : "Heuristic (ML offline)"}</span><span className="lab-chip">ML coverage · {Math.round((sc.mlCoverage ?? 0) * 100)}%</span></>} />
      <div className="lab-tiles" style={{ marginTop: 16 }}>
        <div className="lab-tile"><div className="lab-tile-k">Molecular weight</div><div className="lab-tile-v">{fmt(sim.lipinski.mw, 0)}</div><div className="lab-tile-sub">Da · {sim.lipinski.violations} Ro5 viol.</div></div>
        <div className="lab-tile"><div className="lab-tile-k">QED</div><div className="lab-tile-v">{fmt(sim.qed_approx, 2)}</div><div className="lab-tile-sub">drug-likeness</div></div>
        <div className="lab-tile"><div className="lab-tile-k">SA score</div><div className="lab-tile-v">{fmt(sim.saScore, 1)}</div><div className="lab-tile-sub">1 easy → 10 hard</div></div>
        <div className="lab-tile"><div className="lab-tile-k">In-vitro risk</div><div className="lab-tile-v" style={{ fontSize: 16 }}>{iv.overallRisk}</div><div className="lab-tile-sub">composite</div></div>
        {ad && <div className="lab-tile"><div className="lab-tile-k">Applicability</div><div className="lab-tile-v" style={{ fontSize: 15 }}>{ad.ad_label}</div><div className="lab-tile-sub">NN {fmt(ad.nn_similarity, 2)}</div></div>}
      </div>
      <div className="lab-grid lab-grid-2" style={{ marginTop: 16 }}>
        <Card title="Verdict dimensions" icon={<Activity size={16} style={{ color: "var(--teal)" }} />} note="Weighted MPO desirability per axis — geometric composite drives the score.">
          <Dimensions dims={sc.dimensions} />
        </Card>
        <Card title="Target & evidence" icon={<TargetIcon size={16} style={{ color: "var(--teal)" }} />} note={target?.measured ? "Measured ChEMBL target hit." : "Structure-inferred target — binding-dependent readouts stay null without one."}>
          {target ? (
            <div className="lab-rows">
              <Row label="UniProt" value={<span className="lab-mono">{target.uniprotId || "—"}</span>} />
              <Row label="Gene / name" sub={target.fullName} value={target.geneName || "—"} />
              <Row label="Class" value={target.targetClass || "—"} />
              <Row label="Therapeutic area" value={target.area || "unmapped"} />
              <Row label="Match" sub={`source · ${target.source}${target.measured ? " · measured" : ""}`} value={`${(target.confidence * 100).toFixed(0)}% · ${target.confidenceLabel}`} />
              {binding?.prediction && <Row label="Predicted Kd (ML)" sub={binding.prediction.affinity_class ?? undefined} value={fmt(binding.prediction.Kd_nM, 1, "nM")} />}
              {sim.binding && <Row label="On-target IC50" sub={sim.binding.targetName} value={fmt(sim.binding.primaryIC50, 1, "nM")} />}
            </div>
          ) : <div className="lab-note-soft">No measured or structurally-inferred target met the confidence floor.</div>}
        </Card>
      </div>
      <Card title="Layer-1 liability gate" icon={<ShieldCheck size={16} style={{ color: "var(--teal)" }} />} note="Hard vetoes, monitor-level warnings and informational notes from the calibrated scorecard.">
        <Flags flags={sc.flags} />
      </Card>
      <div className="lab-grid lab-grid-2">
        <Card title="ADMET profile" note="Directional ADMET axes (0–1, higher = better disposition).">
          <div className="lab-rows">
            <Row label="Absorption" value={<>{fmt(sim.admet.absorption)} <ProvPill p={prov.absorption} /></>} />
            <Row label="Distribution" value={<>{fmt(sim.admet.distribution)} <ProvPill p={prov.distribution} /></>} />
            <Row label="Metabolism" value={<>{fmt(sim.admet.metabolism)} <ProvPill p={prov.metabolism} /></>} />
            <Row label="Excretion" value={<>{fmt(sim.admet.excretion)} <ProvPill p={prov.excretion} /></>} />
            <Row label="Toxicity (safety)" value={<>{fmt(sim.admet.toxicity)} <ProvPill p={prov.toxicity} /></>} />
            <Row label="Overall" value={fmt(sim.admet.overall)} />
          </div>
        </Card>
        <Card title="Lipinski / drug-likeness" note="Rule-of-five compliance from RDKit descriptors.">
          <div className="lab-rows">
            <Row label="MW" value={`${fmt(sim.lipinski.mw, 1)} ${sim.lipinski.mwPass ? "✓" : "✗"}`} />
            <Row label="LogP" value={`${fmt(sim.lipinski.logP)} ${sim.lipinski.logPPass ? "✓" : "✗"}`} />
            <Row label="HBD / HBA" value={`${sim.lipinski.hbd} / ${sim.lipinski.hba}`} />
            <Row label="TPSA" value={fmt(sim.lipinski.tpsa, 1, "Å²")} />
            <Row label="Rotatable bonds" value={String(sim.lipinski.rotBonds)} />
            <Row label="Lead-like" value={sim.lipinski.leadLike ? "Yes" : "No"} />
          </div>
        </Card>
      </div>
      <div className="lab-grid lab-grid-2">
        <Card title="In-vitro readouts" icon={<Microscope size={16} style={{ color: "var(--teal)" }} />} note="Permeability, metabolic stability, protein binding & hERG.">
          <div className="lab-rows">
            <Row label="Caco-2 Papp" sub={iv.permeability.caco2Class + " permeability"} value={<>{fmt(iv.permeability.caco2Papp, 1, "×10⁻⁶")} <ProvPill p={ivProv.permeability} /></>} />
            <Row label="Efflux ratio" sub={iv.permeability.pgpSubstrate ? "P-gp substrate" : "not P-gp"} value={fmt(iv.permeability.effluxRatio, 1)} />
            <Row label="Microsomal CLint" value={<>{fmt(iv.metabolicStability.microsomalCLint, 1, "µL/min/mg")} <ProvPill p={ivProv.metabolicStability} /></>} />
            <Row label="t½ (in-vitro)" value={fmt(iv.metabolicStability.halfLifeMin, 0, "min")} />
            <Row label="Plasma fu" sub={iv.plasmaProteinBinding.bindingClass} value={<>{fmt(iv.plasmaProteinBinding.fuPercent, 1, "%")} <ProvPill p={ivProv.plasmaProteinBinding} /></>} />
            <Row label="hERG IC50" sub={iv.herg.riskCategory + " risk"} value={<>{fmt(iv.herg.ic50_uM, 1, "µM")} <ProvPill p={ivProv.herg} /></>} />
          </div>
        </Card>
        <Card title="CYP inhibition panel" note="Isoform IC50 estimates (higher = safer).">
          <div className="lab-rows">
            {(["CYP1A2", "CYP2C9", "CYP2C19", "CYP2D6", "CYP3A4"] as const).map((cyp) => {
              const c = (iv.metabolicStability.cypInhibition as any)[cyp];
              return c ? <Row key={cyp} label={cyp} sub={`${c.risk} risk`} value={fmt(c.ic50_uM, 1, "µM")} /> : null;
            })}
          </div>
        </Card>
      </div>
      {showSafety && (
        <div className="lab-grid lab-grid-2">
          <Card title="Mechanistic safety" icon={<AlertTriangle size={16} style={{ color: "var(--teal)" }} />} note="Reactive-metabolite alerts, BSEP / cholestasis and phospholipidosis risk.">
            <div className="lab-rows">
              {rm ? <><Row label="Reactive metabolites" sub={`${rm.alert_count} alerts · ${rm.critical_count} critical`} value={rm.rm_class} /><Row label="RM score" value={fmt(rm.rm_score, 0, "/100")} /></> : <Row label="Reactive metabolites" value="endpoint offline" />}
              {bsep ? <><Row label="BSEP inhibition" sub={bsep.bsep.ic50_estimate_uM ? `IC50 ${bsep.bsep.ic50_estimate_uM}` : undefined} value={bsep.bsep.risk_class} /><Row label="Phospholipidosis" sub={bsep.phospholipidosis.cad_positive ? "CAD-positive" : "CAD-negative"} value={bsep.phospholipidosis.risk_class} /></> : <Row label="BSEP / PLD" value="endpoint offline" />}
            </div>
          </Card>
          <Card title="Structural alerts" icon={<ScrollText size={16} style={{ color: "var(--teal)" }} />} note="PAINS / Brenk / BMS / NIH-MLSMR / Ames-ICH substructure scan (RDKit).">
            {sa?.scanRan ? (
              <div className="lab-rows">
                <Row label="Reject-tier hits" value={String(sa.rejectCount)} />
                <Row label="Warn-tier hits" value={String(sa.warnCount)} />
                <Row label="PAINS / Brenk" value={`${sa.painsCount} / ${sa.brenkCount}`} />
                <Row label="Ames genotox" value={String(sa.amesGenotoxCount)} />
                {sa.rejectNames.length > 0 && <Row label="Flagged motifs" value={<span style={{ whiteSpace: "normal", textAlign: "right" }}>{sa.rejectNames.slice(0, 3).join(", ")}</span>} />}
              </div>
            ) : <div className="lab-note-soft">Structural-alert scan unavailable (RDKit not ready at run time).</div>}
          </Card>
        </div>
      )}
      {r.rawAdmet?.ml_available && <AdmetFullPanel admet={r.rawAdmet} />}
      <SolubilityCard s={r.solubility} />
      <ExternalDbCard ext={r.external} target={target} />
      {r.novelty && <NoveltyCard n={r.novelty} />}

      {known?.matched && (
        <Card title="Known-drug match" dot="var(--known)" note="Lookup-first identity / analogue match — measured liabilities bypass ML thresholds.">
          <div className="lab-rows">
            <Row label="Matched drug" sub={known.match_type} value={known.matched_drug?.name ?? "—"} />
            <Row label="Status" value={known.matched_drug?.status ?? "—"} />
            <Row label="Tanimoto" value={fmt(known.tanimoto ?? null, 2)} />
            {known.matched_drug?.withdrawal_reason && <Row label="Withdrawal reason" value={<span style={{ whiteSpace: "normal", textAlign: "right" }}>{known.matched_drug.withdrawal_reason}</span>} />}
          </div>
        </Card>
      )}
      <Card title="AI/ML direction & scope" dot="var(--teal)" note="Engine recommendation for advancing this novel chemistry.">
        <div className="lab-note-soft">{sc.recommendation || sim.recommendation}</div>
        {sim.similarDrugs?.length > 0 && (
          <div className="lab-chip-row" style={{ marginTop: 12 }}><span className="lab-row-sub" style={{ alignSelf: "center" }}>Nearest known chemistry:</span>{sim.similarDrugs.slice(0, 6).map((d, i) => <span className="lab-chip" key={i}>{d}</span>)}</div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Peptide output
// ─────────────────────────────────────────────────────────────────────────────
function PeptideResults({ r }: { r: PeptideL1Result }) {
  const { result: p, scorecard: sc } = r; const pc = p.physicochemical;
  return (
    <div className="lab-fade">
      <VerdictHero verdict={sc.verdict} score={sc.score} confidence={sc.confidence} headline={sc.summary} rationale={sc.confidenceNote}
        chips={<span className={`lab-chip ${sc.mlDriven ? "is-teal" : ""}`}>{sc.mlDriven ? "ML-driven" : "Heuristic"}</span>} />
      <div className="lab-tiles" style={{ marginTop: 16 }}>
        <div className="lab-tile"><div className="lab-tile-k">Length</div><div className="lab-tile-v">{pc.sequence_length}</div><div className="lab-tile-sub">residues</div></div>
        <div className="lab-tile"><div className="lab-tile-k">MW</div><div className="lab-tile-v">{fmt(pc.molecular_weight_da, 0)}</div><div className="lab-tile-sub">Da</div></div>
        <div className="lab-tile"><div className="lab-tile-k">Net charge</div><div className="lab-tile-v">{fmt(pc.net_charge_pH7, 1)}</div><div className="lab-tile-sub">{pc.charge_class}</div></div>
        <div className="lab-tile"><div className="lab-tile-k">Aggregation</div><div className="lab-tile-v" style={{ fontSize: 16 }}>{p.aggregation.risk}</div><div className="lab-tile-sub">{p.aggregation.n_regions} regions</div></div>
      </div>
      <div className="lab-grid lab-grid-2" style={{ marginTop: 16 }}>
        <Card title="Verdict dimensions" icon={<Activity size={16} style={{ color: "var(--teal)" }} />} note="Per-axis scores; ML classifiers used when the endpoint is live.">
          <Dimensions dims={sc.dimensions.map((d) => ({ dimension: d.dimension, score: d.score ?? 0, weight: (d as any).weight ?? 0, provenance: d.provenance, detail: d.detail }))} />
          <div className="lab-chip-row" style={{ marginTop: 12 }}>
            {sc.mlSignal?.amp_prob != null && <span className="lab-chip">AMP {(sc.mlSignal.amp_prob * 100).toFixed(0)}%</span>}
            {sc.mlSignal?.hemolysis_prob != null && <span className="lab-chip">Hemolysis {(sc.mlSignal.hemolysis_prob * 100).toFixed(0)}%</span>}
            {sc.mlSignal?.cpp_prob != null && <span className="lab-chip">CPP {(sc.mlSignal.cpp_prob * 100).toFixed(0)}%</span>}
          </div>
        </Card>
        <Card title="Physicochemical profile" note="Sequence-derived descriptors.">
          <div className="lab-rows">
            <Row label="pI" value={fmt(pc.isoelectric_point, 2)} />
            <Row label="GRAVY" value={fmt(pc.gravy, 2)} />
            <Row label="Instability index" sub={pc.instability_class} value={fmt(pc.instability_index, 1)} />
            <Row label="Aliphatic index" value={fmt(pc.aliphatic_index, 1)} />
            <Row label="Hydrophobic moment" value={fmt(pc.hydrophobic_moment, 2)} />
            <Row label="Disulfide pairs" value={String(pc.n_disulfide_pairs)} />
          </div>
        </Card>
      </div>
      <Card title="Layer-1 liability gate" icon={<ShieldCheck size={16} style={{ color: "var(--teal)" }} />} note="Hemolysis, aggregation, immunogenicity, proteolysis & synthesis risks.">
        <Flags flags={sc.flags.map((f) => ({ label: f.label, severity: f.severity, rationale: (f as any).rationale ?? (f as any).detail ?? "", value: (f as any).value, source: (f as any).source, provenance: (f as any).provenance }))} />
      </Card>
      <div className="lab-grid lab-grid-2">
        <Card title="Stability & permeability" icon={<Microscope size={16} style={{ color: "var(--teal)" }} />} note="Proteolysis, half-life and membrane transit.">
          <div className="lab-rows">
            <Row label="Most labile protease" value={p.proteolytic_stability.most_labile_protease ?? "—"} />
            <Row label="Cleavage sites" value={String(p.proteolytic_stability.most_labile_n_sites)} />
            <Row label="Plasma t½" value={p.half_life.plasma_h ? `${p.half_life.plasma_h} h` : "—"} />
            <Row label="Dominant clearance" value={p.half_life.dominant_route} />
            <Row label="Permeability" sub={p.membrane_permeability.permeability_class} value={fmt(p.membrane_permeability.membrane_permeability_score, 2)} />
            <Row label="CPP signal" value={p.membrane_permeability.cpp_signal_detected ? "Detected" : "No"} />
          </div>
        </Card>
        <Card title="Developability" icon={<ScrollText size={16} style={{ color: "var(--teal)" }} />} note="Route, formulation flags and risks.">
          <div className="lab-rows">
            <Row label="Recommended route" value={p.developability.recommended_route} />
            <Row label="Oral potential" value={p.developability.oral_potential ? "Yes" : "No"} />
            <Row label="Solubility" value={p.solubility.solubility_class} />
            <Row label="Immunogenicity" sub={`${p.immunogenicity.candidate_epitope_windows} epitope windows`} value={p.immunogenicity.band} />
            <Row label="Synthesis" value={p.synthesis.difficulty_class} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_MEASUREMENTS: ExVivoMeasurement[] = [
  { assayId: "primary_hepatocyte_clearance", observedValue: null, unit: "mL/min/kg" },
  { assayId: "cyp3a4_inhibition_ic50", observedValue: null, unit: "µM" },
  { assayId: "bsep_inhibition", observedValue: null, unit: "µM" },
  { assayId: "herg_patch_clamp", observedValue: null, unit: "µM" },
  { assayId: "primary_cellular_dose_response", observedValue: null, unit: "fold" },
];
const ASSAY_LABEL: Record<string, string> = {
  primary_hepatocyte_clearance: "Primary hepatocyte clearance", cyp3a4_inhibition_ic50: "CYP3A4 inhibition IC50",
  bsep_inhibition: "BSEP inhibition IC50", herg_patch_clamp: "hERG patch-clamp IC50", primary_cellular_dose_response: "Cellular dose-response",
};
function ConfirmationSection({ compoundId, l1, inVitro }: { compoundId: string; l1: SimResults; inVitro: InVitroResults }) {
  const [policy] = useState<GatePolicySnapshot>(() => defaultGatePolicy());
  const [directive, setDirective] = useState<PreConfirmationDirective | null>(null);
  const [measurements, setMeasurements] = useState<ExVivoMeasurement[]>(DEFAULT_MEASUREMENTS);
  const [triggers, setTriggers] = useState<FalsifierTrigger[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [block, setBlock] = useState<ConfirmationEvidenceBlock | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ovr, setOvr] = useState({ falsifierId: "", reason: "", actor: "", role: "PreClinicalSafetyReviewer" as Role, authority: "AKTHealth-SOP-PCS-007#§3.4", fields: "primaryTargetIc50nM,hergIc50UM" });
  const l1Pointer: EvidencePointer = useMemo(() => freezeL1EvidencePointer(compoundId, new Date().toISOString()), [compoundId]);
  const inSilicoEvidence = useMemo(() => buildInSilicoEvidenceFromL1(l1Pointer, null, l1), [l1Pointer, l1]);
  const inSilicoGate = useMemo(() => evaluateInSilicoGate({ confidenceByClass: l1ConfidenceByClass(l1, null), policy }), [l1, policy]);
  const emit = () => {
    const findPred = (dom: string) => inSilicoEvidence.find((e) => e.predictionDomain === dom)?.predictedValue ?? null;
    setDirective(emitDirective({ compoundIdRaw: compoundId, l1Pointer, predictedClearanceMlMinKg: findPred("clearance_fractions"), predictedCyp3a4Ic50uM: findPred("cyp_transporter"), predictedHergIc50uM: inVitro?.herg?.ic50_uM ?? findPred("herg_pbpk"), doseRangeMgKg: { min: 0.01, max: 5 } }));
    setBlock(null);
  };
  const runFalsifiers = () => { if (!directive) return; setErr(null); setTriggers(checkFalsifiers(buildExVivoEvidence(measurements, directive.directiveId, l1Pointer), directive)); };
  const fileOverride = () => {
    if (!ovr.falsifierId) return setErr("Select a FalsifierId to accept.");
    if (ovr.reason.trim().length < 20) return setErr("Override reason must be ≥ 20 characters.");
    if (!ovr.actor.trim()) return setErr("Actor identity required.");
    try { const rec = buildOverride({ overrideKind: "exVivoGate", actor: ovr.actor, role: ovr.role, authorityCitationPolicy: ovr.authority, reason: ovr.reason, falsifierAccepted: ovr.falsifierId as FalsifierId, l1Pointer, l1FieldsCited: ovr.fields.split(",").map((s) => s.trim()).filter(Boolean) }); setOverrides((a) => [...a, rec]); setOvr((d) => ({ ...d, reason: "" })); setErr(null); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
  };
  const seal = () => {
    if (!directive) return setErr("Emit a directive before sealing.");
    setErr(null);
    try { const recs = buildExVivoEvidence(measurements, directive.directiveId, l1Pointer); const trg = checkFalsifiers(recs, directive); const entryMode: ExVivoEntryMode = { kind: "consumedDirective", directiveId: directive.directiveId }; setBlock(buildConfirmationBlock({ l1Pointer, inSilicoEvidence, inSilicoGateResult: inSilicoGate, exVivoEvidence: recs, exVivoEntryMode: entryMode, directive, triggers: trg, overrides, policy })); setTriggers(trg); }
    catch (e: any) { setErr(`Sealing failed: ${e?.message ?? e}`); }
  };
  const filled = measurements.filter((m) => m.observedValue != null).length;
  const accepted = new Set(overrides.map((o) => o.falsifierAccepted).filter(Boolean));
  const unhandled = triggers.filter((t) => !accepted.has(t.falsifierId));
  const sealTone: Tone | null = block?.gateStatus === "passed" ? "go" : block?.gateStatus === "overridden" ? "watch" : block?.gateStatus === "failed" ? "nogo" : null;
  return (
    <Card title="Confirmation layer" icon={<Workflow size={16} style={{ color: "var(--teal)" }} />} dot="var(--teal)" note={`In-silico → ex-vivo directive · falsifier check · authority-signed overrides · sealed evidence block. Policy ${policy.policyId}@${policy.policyVersion}.`}>
      <div className="lab-grid lab-grid-2">
        <div className="lab-note-soft"><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Workflow size={15} /> <strong>In-silico gate</strong></div>Status: <strong style={{ color: inSilicoGate.status === "passed" ? "var(--go)" : "var(--watch)" }}>{inSilicoGate.status}</strong>. {inSilicoGate.reason}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "center" }}>
          <button className="lab-btn lab-btn-primary" onClick={emit}><ArrowRight size={15} /> {directive ? "Re-emit directive" : "Emit pre-confirmation directive"}</button>
          {directive && <span className="lab-row-sub lab-mono">directive {String(directive.directiveId).slice(0, 30)}…</span>}
        </div>
      </div>
      {directive && (<>
        <div className="lab-section-head" style={{ margin: "22px 0 10px" }}><Beaker size={16} style={{ color: "var(--teal)" }} /><h4 className="lab-card-title" style={{ fontSize: 15 }}>Ex-vivo measurements</h4><span className="lab-row-sub">{filled}/{measurements.length} entered</span><div className="lab-section-line" /></div>
        <div className="lab-grid lab-grid-2">
          {measurements.map((m, i) => (
            <div className="lab-field" key={m.assayId}>
              <label className="lab-label">{ASSAY_LABEL[m.assayId] ?? m.assayId} <span className="lab-hint">({m.unit})</span></label>
              <input className="lab-input lab-mono" type="number" step="any" placeholder="enter measured value" value={m.observedValue ?? ""} onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); setMeasurements((arr) => arr.map((x, j) => j === i ? { ...x, observedValue: v } : x)); }} />
            </div>
          ))}
        </div>
        <button className="lab-btn lab-btn-ghost lab-btn-sm" style={{ marginTop: 12 }} onClick={runFalsifiers}><ShieldCheck size={14} /> Run falsifier check</button>
      </>)}
      {triggers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Flags flags={triggers.map((t) => ({ label: `Falsifier triggered · ${String(t.falsifierId)}`, severity: accepted.has(t.falsifierId) ? "info" : "critical", rationale: accepted.has(t.falsifierId) ? "Accepted via signed override." : "Ex-vivo measurement falsified the in-silico prediction. An authority-signed override is required to proceed.", value: `margin ${fmt((t as any).margin, 2)}` }))} />
          {unhandled.length > 0 && (
            <div className="lab-card" style={{ marginTop: 12, boxShadow: "none", background: "var(--surface-2)" }}>
              <div className="lab-grid lab-grid-2">
                <div className="lab-field"><label className="lab-label">FalsifierId to accept</label><select className="lab-select" value={ovr.falsifierId} onChange={(e) => setOvr({ ...ovr, falsifierId: e.target.value })}><option value="">— select —</option>{unhandled.map((t) => <option key={String(t.falsifierId)} value={String(t.falsifierId)}>{String(t.falsifierId)}</option>)}</select></div>
                <div className="lab-field"><label className="lab-label">Actor (name or email)</label><input className="lab-input" value={ovr.actor} onChange={(e) => setOvr({ ...ovr, actor: e.target.value })} placeholder="reviewer identity" /></div>
                <div className="lab-field" style={{ gridColumn: "1 / -1" }}><label className="lab-label">Justification (≥ 20 chars)</label><textarea className="lab-textarea" style={{ fontFamily: "inherit", minHeight: 56 }} value={ovr.reason} onChange={(e) => setOvr({ ...ovr, reason: e.target.value })} placeholder="Scientific rationale…" /></div>
              </div>
              <button className="lab-btn lab-btn-ghost lab-btn-sm" style={{ marginTop: 10 }} onClick={fileOverride}><ShieldCheck size={14} /> File signed override</button>
            </div>
          )}
        </div>
      )}
      {err && <div className="lab-error" style={{ marginTop: 14 }}>{err}</div>}
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="lab-btn lab-btn-primary" onClick={seal} disabled={!directive}><ShieldCheck size={15} /> Seal confirmation block</button>
        {sealTone && block && <span className={`lab-verdict-badge ${TONE_CLASS[sealTone]}`} style={{ fontSize: 15, padding: "7px 16px" }}>{block.gateStatus.toUpperCase()}</span>}
        {overrides.length > 0 && <span className="lab-chip">{overrides.length} override{overrides.length > 1 ? "s" : ""} on file</span>}
      </div>
      {block && <div className="lab-note-soft lab-mono" style={{ marginTop: 12, fontSize: 11 }}>block {String((block as any).blockId ?? "sealed")} · in-silico {inSilicoEvidence.length} records · ex-vivo {filled} measurements · triggers {triggers.length}</div>}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IVIVE
// ─────────────────────────────────────────────────────────────────────────────
const IVIE_KINDS: Array<{ kind: IvieMeasurement; label: string; unit: string }> = [
  { kind: "fuPlasma", label: "fu_p — fraction unbound in plasma", unit: "fraction 0–1" },
  { kind: "fuMic", label: "fu_mic — microsomal unbound fraction", unit: "fraction 0–1" },
  { kind: "bpRatio", label: "B/P — blood-to-plasma ratio", unit: "ratio" },
];
function IviveSection({ sim, iv }: { sim: SimResults; iv: InVitroResults }) {
  const [inputs, setInputs] = useState<IvieWetLabInputs>(() => emptyIvieWetLabInputs());
  const [projection, setProjection] = useState<L2DoseProjection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tier = useMemo(() => assessIvieTier(inputs), [inputs]);
  const setCell = (kind: IvieMeasurement, sp: IvieSpecies, raw: string) => {
    setInputs((prev) => { const next: IvieWetLabInputs = { ...prev, [kind]: { ...prev[kind] } } as IvieWetLabInputs; const value = raw === "" ? null : Number(raw); next[kind][sp] = { ...prev[kind][sp], value: Number.isFinite(value as number) ? value : null, provenance: "measured" }; return next; });
  };
  const autofill = () => setInputs((prev) => autoFillIvieEstimates(prev));
  const clearAll = () => { setInputs(emptyIvieWetLabInputs()); setProjection(null); setErr(null); };
  const project = () => {
    setErr(null);
    try { const fuMicHuman = humanFuMic(inputs) ?? undefined; const bpRatioHuman = humanBpRatio(inputs) ?? undefined; const fuHuman = humanFuPlasma(inputs) ?? undefined; setProjection(computeL2DoseProjection(sim, iv, { ...(fuMicHuman != null ? { fuMicHuman } : {}), ...(bpRatioHuman != null ? { bpRatioHuman } : {}), ...(fuHuman != null ? { fuOverride: fuHuman } : {}) })); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
  };
  const correctedClint = useMemo(() => { const fuMic = humanFuMic(inputs); if (fuMic == null) return null; try { return applyFuMicCorrection(iv.metabolicStability.microsomalCLint, fuMic); } catch { return null; } }, [inputs, iv]);
  const tierTone: Tone = tier.tier === "Premium" || tier.tier === "Standard" ? "go" : tier.tier === "Minimum" ? "watch" : "nogo";
  return (
    <Card title="IVIVE — in-vitro → in-vivo extrapolation" icon={<Droplets size={16} style={{ color: "var(--teal)" }} />} dot="var(--teal)" note="Well-stirred liver model with the Obach 1999 fu_mic correction and B/P plasma→blood conversion. Estimated cells are tagged and excluded from the cross-species rule.">
      <div className="lab-verdict" style={{ marginBottom: 16 }}>
        <span className={`lab-verdict-badge ${TONE_CLASS[tierTone]}`} style={{ fontSize: 18 }}>{tier.tier}</span>
        <div className="lab-verdict-meta"><span className="lab-verdict-headline">{tier.crossSpeciesRuleSatisfied ? "Cross-species defensibility satisfied (measured)" : tier.crossSpeciesRuleSatisfiedWithEstimates ? "Cross-species rule satisfied with estimates only" : "Cross-species rule not yet satisfied"}</span><span className="lab-verdict-rationale">{tier.missingForNextTier?.length ? `To advance: ${tier.missingForNextTier.join("; ")}` : "Tier ladder complete."}</span></div>
        <div className="lab-score-ring"><span className="lab-score-num" style={{ color: barColor(tier.completionFraction * 100) }}>{Math.round(tier.completionFraction * 100)}%</span><span className="lab-score-cap">matrix filled</span></div>
      </div>
      {IVIE_KINDS.map(({ kind, label, unit }) => (
        <div key={kind} style={{ marginBottom: 14 }}>
          <div className="lab-label" style={{ marginBottom: 6 }}>{label} <span className="lab-hint">({unit})</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="lab-matrix"><thead><tr><th>Species</th>{IVIE_SPECIES.map((sp) => <th key={sp}>{IVIE_SPECIES_LABEL[sp]}</th>)}</tr></thead>
              <tbody><tr><td>{unit}</td>{IVIE_SPECIES.map((sp) => { const cell = inputs[kind][sp]; const est = cell.provenance === "estimated"; const invalid = cell.value != null && !validateIvieValue(kind, cell.value).ok; return (<td key={sp} className={est ? "lab-cell-est" : ""}><input type="number" step="any" value={cell.value ?? ""} style={invalid ? { borderColor: "var(--nogo)" } : undefined} onChange={(e) => setCell(kind, sp, e.target.value)} /></td>); })}</tr></tbody>
            </table>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <button className="lab-btn lab-btn-primary" onClick={project}><Droplets size={15} /> Run IVIVE projection</button>
        <button className="lab-btn lab-btn-ghost lab-btn-sm" onClick={autofill}>Auto-fill literature estimates</button>
        <button className="lab-btn lab-btn-ghost lab-btn-sm" onClick={clearAll}>Clear</button>
      </div>
      {correctedClint != null && <div className="lab-note-soft" style={{ marginTop: 14 }}>Obach fu_mic correction (human): CLint {fmt(iv.metabolicStability.microsomalCLint, 0, "µL/min/mg")} ÷ fu_mic {fmt(humanFuMic(inputs), 2)} = <strong>{fmt(correctedClint, 0, "µL/min/mg")}</strong> corrected intrinsic clearance.</div>}
      {err && <div className="lab-error" style={{ marginTop: 14 }}>{err}</div>}
      {projection && (
        <div className="lab-grid lab-grid-2" style={{ marginTop: 16 }}>
          <Card title="Projected human PK" note="Well-stirred liver model output.">
            <div className="lab-rows">
              <Row label="Hepatic CL" value={fmt(projection.hepaticCL_mL_min_kg, 1, "mL/min/kg")} />
              <Row label="Volume of distribution" value={fmt(projection.Vd_L_per_kg, 2, "L/kg")} />
              <Row label="Oral F" value={fmt(projection.F_oral, 2)} />
              <Row label="Plasma fu" value={fmt(projection.fu_fraction, 3)} />
              <Row label="Predicted dose" value={fmt(projection.predictedDose_mg_per_day, 1, "mg/day")} />
              <Row label="Target Cmax,u" value={fmt(projection.targetCmaxUnbound_nM, 1, "nM")} />
            </div>
          </Card>
          <Card title="Therapeutic-index margins" note={`Verdict: ${projection.verdict} · ${projection.confidenceNote}`}>
            <div className="lab-rows">{projection.margins.map((m, i) => (<Row key={i} label={m.label} sub={`${m.numerator} ÷ ${m.denominator}`} value={<span style={{ color: m.tier === "SAFE" ? "var(--go)" : m.tier === "RISK" ? "var(--nogo)" : m.tier === "CAUTION" ? "var(--watch)" : "var(--faint)" }}>{m.ratio != null ? `${m.ratio.toFixed(1)}×` : "—"} · {m.tier}</span>} />))}</div>
          </Card>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
type Modality = "small_molecule" | "peptide";

export function Lab() {
  const [modality, setModality] = useState<Modality>("small_molecule");
  const [smiles, setSmiles] = useState("");
  const [molName, setMolName] = useState("");
  const [indication, setIndication] = useState("");
  const [uniprotOverride, setUniprotOverride] = useState("");
  const [areaOverride, setAreaOverride] = useState("");
  const [sequence, setSequence] = useState("");
  const [cyclic, setCyclic] = useState(false);
  const [ph, setPh] = useState("7.4");
  const [ionic, setIonic] = useState("150");
  const [bridges, setBridges] = useState("");

  // simulation options
  const [optAdmet, setOptAdmet] = useState(true);
  const [optBinding, setOptBinding] = useState(true);
  const [optTox, setOptTox] = useState(true);
  const [optFingerprint, setOptFingerprint] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [smResult, setSmResult] = useState<SmallMoleculeL1Result | null>(null);
  const [pepResult, setPepResult] = useState<PeptideL1Result | null>(null);

  // live preview
  const [rdkitReady, setRdkitReady] = useState(false);
  const [debSmiles, setDebSmiles] = useState("");
  const [admetPrev, setAdmetPrev] = useState<AdmetPreview | null>(null);
  const [admetPrevLoading, setAdmetPrevLoading] = useState(false);

  const sm = modality === "small_molecule";
  const hasResult = sm ? !!smResult : !!pepResult;

  useEffect(() => { ensureChemistry().then(() => setRdkitReady(true)).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => setDebSmiles(smiles.trim()), 450); return () => clearTimeout(t); }, [smiles]);

  const molProps = useMemo(() => (sm && rdkitReady && debSmiles ? quickMolProps(debSmiles) : null), [sm, rdkitReady, debSmiles]);

  useEffect(() => {
    if (!sm || !molProps || !debSmiles) { setAdmetPrev(null); return; }
    let dead = false; setAdmetPrevLoading(true); setAdmetPrev(null);
    previewAdmet(debSmiles).then((p) => { if (!dead) setAdmetPrev(p); }).finally(() => { if (!dead) setAdmetPrevLoading(false); });
    return () => { dead = true; };
  }, [sm, debSmiles, molProps]);

  const runSm = useCallback(async () => {
    setRunning(true); setError(null); setProgress(0); setSmResult(null);
    try { const r = await runSmallMoleculeL1({ smiles, molName, uniprotOverride, areaOverride, offTargetScreen: optBinding, onProgress: (f) => setProgress(Math.round(f * 100)) }); setSmResult(r); setProgress(100); }
    catch (e: any) { setError(e?.message ?? "Analysis failed."); }
    finally { setRunning(false); }
  }, [smiles, molName, uniprotOverride, areaOverride, optBinding]);

  const runPep = useCallback(async () => {
    setRunning(true); setError(null); setProgress(0); setPepResult(null);
    try { const r = await runPeptideL1({ sequence, cyclic, ph: Number(ph) || 7.4, ionicStrength: Number(ionic) || 150, disulfideBridges: bridges, onProgress: (f) => setProgress(Math.round(f * 100)) }); setPepResult(r); setProgress(100); }
    catch (e: any) { setError(e?.message ?? "Peptide analysis failed."); }
    finally { setRunning(false); }
  }, [sequence, cyclic, ph, ionic, bridges]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const useTarget = (s: TargetSuggestion) => { setUniprotOverride(s.uniprotId); setAreaOverride(s.area && ["Oncology","CNS","Cardiovascular","Metabolic","Rare Disease","Infectious Disease","Immunology"].includes(s.area) ? s.area : ""); };

  const summary = sm && smResult
    ? { name: smResult.simResults.molName, verdict: smResult.scorecard.verdict, score: smResult.scorecard.score, a: ["MW", fmt(smResult.simResults.lipinski.mw, 0)], b: ["Target", smResult.target?.geneName || smResult.target?.uniprotId || "—"], c: ["Area", smResult.target?.area || "—"] }
    : !sm && pepResult
    ? { name: "Peptide", verdict: pepResult.scorecard.verdict, score: pepResult.scorecard.score, a: ["Length", `${pepResult.result.physicochemical.sequence_length}`], b: ["MW", fmt(pepResult.result.physicochemical.molecular_weight_da, 0)], c: ["Charge", pepResult.result.physicochemical.charge_class] }
    : null;

  return (
    <div className="lab">
      <div className="lab-bar">
        <img src={LOGO} alt="HakaseAI" onError={(e) => { (e.currentTarget.style.display = "none"); }} />
        <span className="lab-bar-name">HakaseAI</span>
        <span className="lab-bar-pill">Lab · experimental</span>
        <span className="lab-bar-spacer" />
        <span className="lab-bar-meta">Live engine · L1 · Confirmation · IVIVE</span>
      </div>

      <div className="lab-body">
        <aside className="lab-aside">
          <div className="lab-aside-label">Workflow</div>
          <nav className="lab-nav">
            <a className="is-active" onClick={() => go("sec-input")}><span className="lab-nav-num">◆</span> Candidate</a>
            <a className={hasResult ? "" : "is-disabled"} onClick={() => go("sec-l1")}><span className="lab-nav-num">01</span> Layer 1 · triage</a>
            <a className={sm && smResult ? "" : "is-disabled"} onClick={() => go("sec-conf")}><span className="lab-nav-num">02</span> Confirmation</a>
            <a className={sm && smResult ? "" : "is-disabled"} onClick={() => go("sec-ivive")}><span className="lab-nav-num">03</span> IVIVE</a>
          </nav>

          <div className="lab-aside-label">Target templates</div>
          <div style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: 6 }}>
            {sm ? SM_TEMPLATES.map((t) => (
              <div className="lab-aside-card" key={t.molName} style={{ margin: 0, cursor: "pointer" }}
                onClick={() => { setSmiles(t.smiles); setMolName(t.molName); setUniprotOverride(t.uniprotId); setAreaOverride(""); setIndication(t.indicationCode); }}>
                <div className="v" style={{ fontSize: 12.5 }}>{t.name}</div>
                <div className="k" style={{ marginTop: 2 }}>{t.indication} · {t.uniprotId}</div>
              </div>
            )) : PEP_TEMPLATES.map((t) => (
              <div className="lab-aside-card" key={t.molName} style={{ margin: 0, cursor: "pointer" }}
                onClick={() => { setSequence(t.sequence); setMolName(t.molName); setCyclic(false); }}>
                <div className="v" style={{ fontSize: 12.5 }}>{t.name}</div>
                <div className="k" style={{ marginTop: 2 }}>{t.indication} · {t.uniprotId}</div>
              </div>
            ))}
          </div>

          <div className="lab-aside-label">Quick samples</div>
          <div className="lab-samples" style={{ padding: "0 4px" }}>
            {(sm ? SM_SAMPLES : PEP_SAMPLES).slice(0, 6).map((s) => (
              <button className="lab-sample" key={s.name} onClick={() => { if (sm) { setSmiles((s as any).smiles); setMolName(s.name); } else { setSequence((s as any).sequence); setCyclic(!!(s as any).cyclic); setMolName(s.name); } }}>{s.name}</button>
            ))}
          </div>

          {summary && (<>
            <div className="lab-aside-label">Current candidate</div>
            <div className="lab-aside-card">
              <div className="k">Name</div><div className="v" style={{ marginBottom: 8 }}>{summary.name}</div>
              <div className="lab-aside-row"><span style={{ color: "var(--faint)" }}>Verdict</span><span style={{ fontWeight: 700, color: TONE_COLOR[verdictTone(summary.verdict)] }}>{summary.verdict}</span></div>
              <div className="lab-aside-row"><span style={{ color: "var(--faint)" }}>Score</span><span style={{ fontWeight: 700 }}>{Math.round(summary.score)}</span></div>
              <div className="lab-aside-row"><span style={{ color: "var(--faint)" }}>{summary.a[0]}</span><span>{summary.a[1]}</span></div>
              <div className="lab-aside-row"><span style={{ color: "var(--faint)" }}>{summary.b[0]}</span><span>{summary.b[1]}</span></div>
              <div className="lab-aside-row"><span style={{ color: "var(--faint)" }}>{summary.c[0]}</span><span>{summary.c[1]}</span></div>
            </div>
          </>)}
        </aside>

        <main className="lab-main">
          <div className="lab-hero">
            <span className="lab-kicker">BioDigital Twin · experimental workspace</span>
            <h1 className="lab-title">Pre-clinical triage, in one calm view</h1>
            <p className="lab-sub">Run a novel compound through Layer&nbsp;1 ADMET & safety, the confirmation gate, and IVIVE — every value computed by the production Hakase engine, with full provenance.</p>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <div className="lab-seg">
              <button className={sm ? "is-active" : ""} onClick={() => setModality("small_molecule")}><FlaskConical size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Small molecule</button>
              <button className={!sm ? "is-active" : ""} onClick={() => setModality("peptide")}><Leaf size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Peptide</button>
            </div>
          </div>

          <div id="sec-input">
            <Card title={sm ? "Candidate" : "Peptide sequence"} icon={<FlaskConical size={16} style={{ color: "var(--teal)" }} />}
              note={sm ? "Paste a SMILES, pick a sample or load a target template. Structure, target match and ADMET preview update live."
                : "Enter a one-letter sequence or pick a sample. Conditions feed the predictor directly."}>
              {sm ? (
                <div className="lab-split">
                  {/* left — form */}
                  <div className="lab-grid">
                    <div className="lab-field"><label className="lab-label">SMILES</label><textarea className="lab-textarea" value={smiles} onChange={(e) => setSmiles(e.target.value)} placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" /></div>
                    <div className="lab-samples">{SM_SAMPLES.map((s) => <button className="lab-sample" key={s.name} onClick={() => { setSmiles(s.smiles); setMolName(s.name); }}>{s.name}</button>)}</div>
                    <div className="lab-grid lab-grid-2">
                      <div className="lab-field"><label className="lab-label">Molecule name <span className="lab-hint">optional</span></label><input className="lab-input" value={molName} onChange={(e) => setMolName(e.target.value)} placeholder="Unnamed" /></div>
                      <div className="lab-field"><label className="lab-label">Indication & disease <span className="lab-hint">optional</span></label><input className="lab-input" value={indication} onChange={(e) => setIndication(e.target.value)} placeholder="e.g. Breast Cancer (HR+/HER2-)" /></div>
                    </div>
                    <div className="lab-grid lab-grid-2">
                      <div className="lab-field"><label className="lab-label">UniProt <span className="lab-hint">auto/override</span></label><input className="lab-input lab-mono" value={uniprotOverride} onChange={(e) => setUniprotOverride(e.target.value)} placeholder="auto" /></div>
                      <div className="lab-field"><label className="lab-label">Therapeutic area <span className="lab-hint">optional</span></label><select className="lab-select" value={areaOverride} onChange={(e) => setAreaOverride(e.target.value)}><option value="">Auto</option>{["Oncology","CNS","Cardiovascular","Metabolic","Rare Disease","Infectious Disease","Immunology"].map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
                    </div>
                    <div className="lab-subcard">
                      <div className="lab-subcard-h"><Boxes size={14} style={{ color: "var(--teal)" }} /> Simulation options</div>
                      <Toggle name="ADMET profiling" sub="Directional ADMET-AI — supports in-vitro assays" on={optAdmet} onChange={setOptAdmet} />
                      <Toggle name="Binding & off-target screen" sub="ESM-2 / docking + validated off-target panel" on={optBinding} onChange={setOptBinding} />
                      <Toggle name="Toxicity signal detection" sub="Reactive metabolites · BSEP · structural alerts" on={optTox} onChange={setOptTox} />
                      <Toggle name="Behavioral fingerprinting" sub="Multi-tissue surveillance · adds context" on={optFingerprint} onChange={setOptFingerprint} />
                    </div>
                    <div><button className="lab-btn lab-btn-primary" onClick={runSm} disabled={running || !smiles.trim()}>{running ? <Loader2 size={15} className="lab-spin" /> : <Sparkles size={15} />}{running ? "Running engine…" : "Run Layer 1"}</button></div>
                  </div>
                  {/* right — live preview (fills the space) */}
                  <div className="lab-preview-col">
                    <StructurePreview smiles={debSmiles} molProps={molProps} />
                    {molProps && <GlanceCard p={molProps} />}
                    <TargetMatchCard smiles={debSmiles} molProps={molProps} selectedUniprot={uniprotOverride} onUse={useTarget} />
                    <AdmetPreviewCard preview={admetPrev} loading={admetPrevLoading} />
                  </div>
                </div>
              ) : (
                <div className="lab-grid">
                  <div className="lab-field"><label className="lab-label">Sequence</label><textarea className="lab-textarea" value={sequence} onChange={(e) => setSequence(e.target.value.toUpperCase())} placeholder="e.g. GIGKFLHSAKKFGKAFVGEIMNS" /></div>
                  <div className="lab-samples">{PEP_SAMPLES.map((s) => <button className="lab-sample" key={s.name} onClick={() => { setSequence(s.sequence); setCyclic(!!s.cyclic); setMolName(s.name); }}>{s.name}</button>)}</div>
                  <div className="lab-grid lab-grid-3">
                    <div className="lab-field"><label className="lab-label">pH</label><input className="lab-input lab-mono" value={ph} onChange={(e) => setPh(e.target.value)} /></div>
                    <div className="lab-field"><label className="lab-label">Ionic strength <span className="lab-hint">mM</span></label><input className="lab-input lab-mono" value={ionic} onChange={(e) => setIonic(e.target.value)} /></div>
                    <div className="lab-field"><label className="lab-label">Disulfide bridges <span className="lab-hint">optional</span></label><input className="lab-input lab-mono" value={bridges} onChange={(e) => setBridges(e.target.value)} placeholder="e.g. 3-15" /></div>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--ink-3)" }}><input type="checkbox" checked={cyclic} onChange={(e) => setCyclic(e.target.checked)} /> Head-to-tail cyclic</label>
                  <div><button className="lab-btn lab-btn-primary" onClick={runPep} disabled={running || sequence.trim().length < 2}>{running ? <Loader2 size={15} className="lab-spin" /> : <Sparkles size={15} />}{running ? "Running engine…" : "Run Layer 1"}</button></div>
                </div>
              )}
              {running && (<><div className="lab-progress"><div className="lab-progress-fill" style={{ width: `${progress}%` }} /></div><div className="lab-progress-label">{progress < 25 ? "Parsing structure & resolving target…" : progress < 80 ? "Querying ML endpoints (ADMET, hERG, DILI, binding) & ChEMBL…" : "Composing Layer-1 scorecard…"}</div></>)}
              {error && <div className="lab-error" style={{ marginTop: 14 }}>{error}</div>}
            </Card>
          </div>

          {hasResult && (<>
            <div className="lab-section-head" id="sec-l1"><span className="lab-section-num">01</span><h2 className="lab-section-title">Layer 1 · triage</h2><div className="lab-section-line" /></div>
            {sm && smResult && <SmallMoleculeResults r={smResult} showSafety={optTox} />}
            {!sm && pepResult && <PeptideResults r={pepResult} />}
          </>)}

          {sm && smResult && (<>
            <div className="lab-section-head" id="sec-conf"><span className="lab-section-num">02</span><h2 className="lab-section-title">Confirmation</h2><div className="lab-section-line" /></div>
            <ConfirmationSection compoundId={molName || smiles} l1={smResult.simResults} inVitro={smResult.inVitroResults} />
          </>)}
          {!sm && pepResult && (<>
            <div className="lab-section-head" id="sec-conf"><span className="lab-section-num">02</span><h2 className="lab-section-title">Confirmation</h2><div className="lab-section-line" /></div>
            <Card title="Confirmation layer" note=""><div className="lab-note-soft">The directive-bound confirmation gate (hepatocyte clearance, CYP/BSEP, hERG patch-clamp) is defined for small-molecule chemistry. For peptides the engine hard-gates this track off — clearance runs through plasma/renal proteolysis, not the CYP substrate matrix.</div></Card>
          </>)}

          {sm && smResult && (<>
            <div className="lab-section-head" id="sec-ivive"><span className="lab-section-num">03</span><h2 className="lab-section-title">IVIVE</h2><div className="lab-section-line" /></div>
            <IviveSection sim={smResult.simResults} iv={smResult.inVitroResults} />
          </>)}
          {!sm && pepResult && (<>
            <div className="lab-section-head" id="sec-ivive"><span className="lab-section-num">03</span><h2 className="lab-section-title">IVIVE</h2><div className="lab-section-line" /></div>
            <Card title="IVIVE" note=""><div className="lab-note-soft">The well-stirred hepatic IVIVE model does not apply to peptides — they clear by plasma/tissue proteases and (for small peptides) renal filtration rather than CYP-mediated hepatic metabolism.</div></Card>
          </>)}

          {!hasResult && !running && (
            <div className="lab-empty lab-card" style={{ marginTop: 6 }}><div className="lab-empty-emoji">🧪</div>Pick a template or sample, paste a {sm ? "SMILES" : "sequence"}, then run Layer 1 — triage, confirmation, and IVIVE fill in below.</div>
          )}

          <div className="lab-foot">Experimental view · shares the production Hakase engine, not the production UI.</div>
        </main>
      </div>
    </div>
  );
}

export default Lab;
