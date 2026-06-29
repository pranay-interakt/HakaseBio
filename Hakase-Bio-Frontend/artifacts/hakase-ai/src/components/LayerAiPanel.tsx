import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles, RefreshCw, AlertTriangle, Shield, CheckCircle2,
  ChevronUp, ChevronDown, Eye, Target, Activity
} from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import type { CohortResults } from "@/lib/cohortSim";
import type { TrialResults } from "@/lib/trialSim";
import type { SafetyFlag } from "@/lib/safetyFlags";

export const LAYER_AI_LABELS: Record<number, { title: string; subtitle: string; accent: string; border: string; badge: string; btn: string }> = {
  1: { title: "In Vitro AI Analysis", subtitle: "Assay data · Permeability · Clearance · Safety", accent: "text-violet-400", border: "border-violet-500/20", badge: "bg-violet-500/10 text-violet-400", btn: "bg-violet-600 hover:bg-violet-500" },
  2: { title: "Clinical PK/PD AI Analysis", subtitle: "PBPK · Cohort response · Adverse events · Dosing", accent: "text-blue-400", border: "border-blue-500/20", badge: "bg-blue-500/10 text-blue-400", btn: "bg-blue-600 hover:bg-blue-500" },
  3: { title: "Trial & Regulatory AI Analysis", subtitle: "Trial design · Power · Regulatory pathway · GO/NO-GO", accent: "text-emerald-400", border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400", btn: "bg-emerald-600 hover:bg-emerald-500" },
};

// Rich text renderer: highlights numbers/units inline
const NUM_RE = /(\d[\d,]*\.?\d*\s*(?:%|ng\/mL|Da|h\b|nM|μM|µM|mL|L\/h|L\/kg|mg\/kg|mg\/mL|ng·h\/mL|nmol|μmol|fold|×|x\b|ki|Ki|IC50|EC50|AUC|Cmax|Tmax|t½|kDa|kcal\/mol|kcal|cal|eV)|n\s*=\s*\d+|HR\s*[=:]\s*[\d.]+|CI\s*[\d.,–\s%()]+|p\s*[<>=]\s*[\d.]+|HBD\s*\d+|HBA\s*\d+|[\d]+\.[\d]+)/g;

export function RichText({ text, accent }: { text: string; accent: string }) {
  const tokens: Array<{ t: string; hi: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: text.slice(last, m.index), hi: false });
    tokens.push({ t: m[0], hi: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ t: text.slice(last), hi: false });
  return (
    <>
      {tokens.map((tok, i) =>
        tok.hi
          ? <span key={i} className={`font-mono font-semibold tabular-nums ${accent}`}>{tok.t}</span>
          : <span key={i}>{tok.t}</span>
      )}
    </>
  );
}

// Split prose at sentence boundaries so each sentence breathes
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
}

export const LAYER_AI_KEY_LABELS: Record<string, string> = {
  // Small molecule (molecular focus)
  molecularOverview:            "In Vitro Overview",
  safetyNarrative:              "Safety Assessment",
  targetEngagement:             "Target Engagement",
  structuralAlerts:             "Structural Alerts",
  competitiveContext:           "Competitive Context",
  // Peptide focus
  peptideOverview:              "Peptide Overview",
  physicochemicalProfile:       "Physicochemical Profile",
  stabilityNarrative:           "Proteolytic & Serum Stability",
  permeabilityAndActivity:      "Permeability & Receptor Binding",
  synthesisAndDevelopability:   "Synthesizability & Developability",
  // Antibody focus
  antibodyOverview:             "Antibody Overview",
  chainAndCdrProfile:           "Chain & CDR Profile",
  developabilityAssessment:     "Developability Assessment",
  stabilityAndBinding:          "Conformational Stability & Binding",
  // Common / Layer 2 / Layer 3
  regulatoryPathway:            "Regulatory Submission & Safety Pathway",
  riskMitigations:              "Engineering Risk Mitigations",
  nextSteps:                    "Recommended Next Steps",
  pkAnalysis:                   "PK Analysis",
  cohortInsights:               "Cohort Insights",
  adverseEventInterpretation:   "Adverse Event Signals",
  dosingRecommendation:         "Dosing Recommendation",
  drugInteractionRisk:          "Drug Interaction Risk",
  trialDesignRationale:         "Trial Design Rationale",
  powerAnalysis:                "Power Analysis",
  goNogoRationale:              "GO/NO-GO Rationale",
  costBenefitAssessment:        "Cost-Benefit Assessment",
};

export interface LayerAiPanelProps {
  layer: 1 | 2 | 3;
  report: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  stream: string;
  onRun: () => void;
  simResults?: SimResults | null;
  inVitroResults?: InVitroResults | null;
  cohortResults?: CohortResults | null;
  trialResults?: TrialResults | null;
  safetyFlags?: SafetyFlag[];
  onAcknowledgeFlags?: () => void;
  flagsAcknowledged?: boolean;
  targetName?: string;
  targetConfidence?: number;
  targetArea?: string;
}

function AiMiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const barColor = color === "violet" ? "bg-violet-500" : color === "blue" ? "bg-blue-500" : color === "emerald" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : color === "red" ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-slate-300 font-semibold tabular-nums">{value.toFixed(value < 10 ? 1 : 0)}{max === 1 ? "%" : ""}</span>
      </div>
      <div className="w-full bg-white/5 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AiSafetyGate({ flags, acknowledged, onAcknowledge, accent }: { flags: SafetyFlag[]; acknowledged: boolean; onAcknowledge: () => void; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const critical = flags.filter(f => f.severity === "critical");
  const major = flags.filter(f => f.severity === "major");
  const warning = flags.filter(f => f.severity === "warning");
  const reviewRequired = flags.some(f => f.reviewRequired && !f.acknowledged);

  if (flags.length === 0) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[10px] text-emerald-300 font-medium">No safety flags — clear to proceed</span>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${critical.length > 0 ? "border-red-500/25 bg-red-500/5" : major.length > 0 ? "border-amber-500/25 bg-amber-500/5" : "border-yellow-500/25 bg-yellow-500/5"}`}>
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/3 transition-colors">
        <Shield className={`w-3.5 h-3.5 shrink-0 ${critical.length > 0 ? "text-red-400" : "text-amber-400"}`} />
        <div className="flex-1">
          <span className={`text-[10px] font-semibold ${critical.length > 0 ? "text-red-300" : "text-amber-300"}`}>
            {flags.length} Safety Flag{flags.length > 1 ? "s" : ""} Detected
          </span>
          <div className="flex gap-2 mt-0.5">
            {critical.length > 0 && <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold">{critical.length} Critical</span>}
            {major.length > 0 && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold">{major.length} Major</span>}
            {warning.length > 0 && <span className="text-[8px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-semibold">{warning.length} Warning</span>}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/5 pt-2">
          {flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5 bg-white/3 rounded-lg px-3 py-2">
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${f.severity === "critical" ? "bg-red-400" : f.severity === "major" ? "bg-amber-400" : "bg-yellow-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-white">{f.label}</span>
                  <span className={`text-[8px] uppercase font-bold px-1.5 py-0.5 rounded ${f.severity === "critical" ? "bg-red-500/20 text-red-400" : f.severity === "major" ? "bg-amber-500/20 text-amber-400" : "bg-yellow-500/20 text-yellow-400"}`}>{f.severity}</span>
                  {f.ichReference && <span className="text-[8px] text-slate-600 font-mono">{f.ichReference}</span>}
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">{f.detail}</p>
                {f.value && <span className={`text-[9px] font-semibold mt-0.5 inline-block ${accent}`}>{f.value}</span>}
              </div>
            </div>
          ))}
          {reviewRequired && !acknowledged && onAcknowledge && (
            <button
              onClick={onAcknowledge}
              className="w-full text-[10px] bg-red-500/15 hover:bg-red-500/25 text-red-300 px-3 py-2 rounded-lg font-medium transition-colors border border-red-500/30 hover:border-red-500/50 flex items-center justify-center gap-2"
            >
              <Eye className="w-3 h-3" /> I have reviewed all safety findings
            </button>
          )}
          {acknowledged && (
            <div className="flex items-center gap-2 bg-emerald-500/8 rounded-lg px-3 py-2 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[9px] text-emerald-300 font-medium">All safety flags reviewed and acknowledged</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function L1AiPreSummary({ sim, iv, targetName, targetConfidence, targetArea }: { sim: SimResults | null; iv: InVitroResults | null; targetName?: string; targetConfidence?: number; targetArea?: string }) {
  if (!sim && !iv) return null;
  const admet = sim?.admet;
  const axes = [
    { l: "Absorption",   v: admet?.absorption ?? 0 },
    { l: "Distribution", v: admet?.distribution ?? 0 },
    { l: "Metabolism",   v: admet?.metabolism ?? 0 },
    { l: "Excretion",    v: admet?.excretion ?? 0 },
    { l: "Tox (inv.)",   v: admet ? 1 - admet.toxicity : 0 },
  ];
  const cx = 60, cy = 55, r = 40;
  const toP = (angle: number, dist: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };
  const angles = axes.map((_, i) => (i * 360) / axes.length);
  const radarPts = axes.map((a, i) => toP(angles[i], r * a.v));
  const radarPath = radarPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + "Z";

  return (
    <div className="space-y-3">
      {targetName && (
        <div className="bg-violet-500/5 border border-violet-500/15 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">Target Auto-Match</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-bold text-white">{targetName}</div>
              <div className="text-[9px] text-slate-500">{(targetArea && targetArea.trim()) || "— Not predicted —"}</div>
            </div>
            <div className="text-right">
              <div className={`text-[14px] font-bold tabular-nums ${(targetConfidence ?? 0) >= 0.65 ? "text-emerald-400" : (targetConfidence ?? 0) >= 0.35 ? "text-amber-400" : "text-red-400"}`}>
                {((targetConfidence ?? 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-slate-600 uppercase">Confidence</div>
            </div>
          </div>
          <div className="mt-2 text-[9px] text-slate-500 leading-relaxed">
            Matched via pharmacophore profiling (SMARTS patterns) + molecular descriptor scoring against 29-target catalog.
            {(targetConfidence ?? 0) >= 0.65 ? " Multi-feature match across scaffold, MW, LogP, and functional groups." : (targetConfidence ?? 0) >= 0.35 ? " Partial feature match — verify binding mode." : " Weak resemblance — experimental validation strongly recommended."}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">ADMET Radar</div>
          <div className="flex items-center gap-2">
            <svg width="120" height="110" className="shrink-0">
              {[0.33, 0.66, 1].map(f => (
                <polygon key={f} points={angles.map(a => { const p = toP(a, r * f); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
              ))}
              {axes.map((a, i) => {
                const p = toP(angles[i], r + 10);
                return <text key={i} x={p.x} y={p.y} fill="#64748b" fontSize="6" textAnchor="middle" dominantBaseline="middle">{a.l}</text>;
              })}
              <polygon points={radarPath.replace("Z", "").replace("M", "").replace(/L/g, " ")} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth="1.5" />
              {radarPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="#8b5cf6" />)}
            </svg>
            <div className="space-y-1 flex-1">
              {axes.map(a => (
                <div key={a.l} className="flex justify-between text-[8px]">
                  <span className="text-slate-600">{a.l}</span>
                  <span className={`font-semibold tabular-nums ${a.v >= 0.7 ? "text-emerald-400" : a.v >= 0.4 ? "text-amber-400" : "text-red-400"}`}>{(a.v * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Key Metrics</div>
          {iv && (
            <>
              {iv.doseResponse.ic50_nM != null
                ? <AiMiniBar label="IC50" value={iv.doseResponse.ic50_nM} max={1000} color={iv.doseResponse.ic50_nM < 100 ? "emerald" : iv.doseResponse.ic50_nM < 500 ? "amber" : "red"} />
                : <div className="text-[9px] text-slate-500">IC50 — no validated target</div>}
              <AiMiniBar label="Caco-2 Papp" value={iv.permeability.caco2Papp} max={60} color={iv.permeability.caco2Class === "High" ? "emerald" : iv.permeability.caco2Class === "Moderate" ? "amber" : "red"} />
              <AiMiniBar label="hERG IC50" value={iv.herg.ic50_uM} max={100} color={iv.herg.riskCategory === "Low" ? "emerald" : iv.herg.riskCategory === "Moderate" ? "amber" : "red"} />
            </>
          )}
          {!iv && sim && (
            <>
              <AiMiniBar label="Absorption" value={(sim.admet.absorption) * 100} max={100} color={sim.admet.absorption >= 0.7 ? "emerald" : "amber"} />
              <AiMiniBar label="QED (approx)" value={sim.qed_approx * 100} max={100} color={sim.qed_approx > 0.5 ? "emerald" : "amber"} />
              <AiMiniBar label="Toxicity Risk" value={sim.admet.toxicity * 100} max={100} color={sim.admet.toxicity < 0.3 ? "emerald" : sim.admet.toxicity < 0.6 ? "amber" : "red"} />
            </>
          )}
        </div>
      </div>
      {sim && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: "Go/No-Go", v: sim.goNogo, good: sim.goNogo === "GO", known: sim.goNogo === "KNOWN-LIABILITY-NO-GO" },
            { l: "Lipinski", v: `${sim.lipinski.violations}/4 viol.`, good: sim.lipinski.violations <= 1, known: false },
            { l: "QED~", v: sim.qed_approx.toFixed(2), good: sim.qed_approx > 0.5, known: false },
            { l: "SA Score", v: sim.saScore.toFixed(1), good: sim.saScore <= 4, known: false },
          ].map(m => {
            // Tri-state color:
            //  - "good"  → emerald  (GO / WATCH-clean)
            //  - "known" → rose+amber  (KNOWN-LIABILITY-NO-GO — published clinical liability, NOT a model rejection)
            //  - else    → red     (novel-compound NO-GO from the model stack)
            const tone = m.good
              ? { border: "border-emerald-500/15", bg: "bg-emerald-500/5", text: "text-emerald-400" }
              : m.known
                ? { border: "border-rose-500/30", bg: "bg-rose-500/8", text: "text-rose-300" }
                : { border: "border-red-500/15", bg: "bg-red-500/5", text: "text-red-400" };
            return (
              <div
                key={m.l}
                className={`rounded-lg px-2.5 py-2 text-center border ${tone.border} ${tone.bg}`}
                title={m.known ? "Published clinical liability — matched a known drug. Distinct from a novel-compound NO-GO." : undefined}
              >
                <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
                <div className={`text-[12px] font-bold mt-0.5 ${tone.text}`}>
                  {m.known ? "KNOWN-NO-GO" : m.v}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function L2AiPreSummary({ cr }: { cr: CohortResults | null }) {
  if (!cr) return null;
  const cmaxNg = cr.cmax * 1000;
  const pts = cr.pkCurve;
  const maxC = Math.max(...pts.map(p => p.conc), 0.001);
  const maxT = pts[pts.length - 1]?.time ?? 48;
  const W = 200, H = 70, pL = 5, pB = 5;
  const tx = (t: number) => pL + (t / maxT) * (W - pL);
  const ty = (c: number) => H - pB - (c / maxC) * (H - pB - 5);
  const curvePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${tx(p.time).toFixed(1)},${ty(p.conc).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">PK Curve Preview</div>
          <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
            <path d={curvePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
            <line x1={pL} y1={H - pB} x2={W} y2={H - pB} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          </svg>
          <div className="flex justify-between mt-1.5 text-[8px] text-slate-600">
            <span>0h</span>
            <span>{maxT.toFixed(0)}h</span>
          </div>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Clinical PK</div>
          <AiMiniBar label="Cmax" value={cmaxNg} max={5000} color="blue" />
          <AiMiniBar label="t½" value={cr.halfLifeHr} max={48} color="blue" />
          <AiMiniBar label="Responder %" value={cr.responderRate * 100} max={100} color={cr.responderRate >= 0.5 ? "emerald" : "amber"} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "Cmax", v: `${cmaxNg.toFixed(0)} ng/mL`, good: true },
          { l: "AUC₀₋₄₈", v: `${cr.auc.toFixed(1)} µg·h/mL`, good: true },
          { l: "Responders", v: `${(cr.responderRate * 100).toFixed(1)}%`, good: cr.responderRate >= 0.4 },
          { l: "Grade≥3 AEs", v: `${(cr.grade3AERate * 100).toFixed(1)}%`, good: cr.grade3AERate < 0.15 },
        ].map(m => (
          <div key={m.l} className={`rounded-lg px-2 py-2 text-center border ${m.good ? "border-blue-500/15 bg-blue-500/5" : "border-amber-500/15 bg-amber-500/5"}`}>
            <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
            <div className={`text-[11px] font-bold mt-0.5 ${m.good ? "text-blue-300" : "text-amber-300"}`}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function L3AiPreSummary({ tr }: { tr: TrialResults | null }) {
  if (!tr) return null;
  const prob = tr.successProbability * 100;
  const probColor = prob >= 70 ? "#22c55e" : prob >= 50 ? "#eab308" : "#ef4444";
  const cx2 = 55, cy2 = 50, rr = 38;
  const circ = 2 * Math.PI * rr;
  const trackLen = circ * 0.75;
  const fillLen = (prob / 100) * trackLen;
  const rot = `rotate(135 ${cx2} ${cy2})`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 flex flex-col items-center">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Success Probability</div>
          <svg width="110" height="75" viewBox="0 0 110 75">
            <circle cx={cx2} cy={cy2} r={rr} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" strokeLinecap="butt" strokeDasharray={`${trackLen} ${circ - trackLen}`} transform={rot} />
            <circle cx={cx2} cy={cy2} r={rr} fill="none" stroke={probColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${fillLen} ${circ - fillLen}`} transform={rot} />
            <text x={cx2} y={cy2 + 2} fill={probColor} fontSize="14" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{prob.toFixed(0)}%</text>
          </svg>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Trial Metrics</div>
          <AiMiniBar label="Power" value={tr.power * 100} max={100} color={tr.power >= 0.8 ? "emerald" : "amber"} />
          <AiMiniBar label="p-Value" value={Math.max(0.001, tr.pValue) * 1000} max={50} color={tr.pValue < 0.05 ? "emerald" : "red"} />
          <AiMiniBar label="Success" value={prob} max={100} color={prob >= 70 ? "emerald" : prob >= 50 ? "amber" : "red"} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "Sample", v: String(tr.sampleSize), good: true },
          { l: "Duration", v: `${tr.estimatedDuration}mo`, good: tr.estimatedDuration <= 36 },
          { l: "GO/NO-GO", v: tr.goNogo, good: tr.goNogo === "GO" },
          { l: "p-Value", v: tr.pValue.toFixed(3), good: tr.pValue < 0.05 },
        ].map(m => (
          <div key={m.l} className={`rounded-lg px-2 py-2 text-center border ${m.good ? "border-emerald-500/15 bg-emerald-500/5" : "border-red-500/15 bg-red-500/5"}`}>
            <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
            <div className={`text-[11px] font-bold mt-0.5 ${m.good ? "text-emerald-300" : "text-red-300"}`}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LayerAiPanel(props: LayerAiPanelProps) {
  const {
    layer, report, loading, error, stream, onRun,
    simResults: sim, inVitroResults: iv, cohortResults: cr, trialResults: tr,
    safetyFlags: flags, onAcknowledgeFlags, flagsAcknowledged,
    targetName, targetConfidence, targetArea,
  } = props;
  const cfg = LAYER_AI_LABELS[layer];
  const layerFlags = flags?.filter(f => f.originLayer <= layer) ?? [];

  return (
    <div className={`border ${cfg.border} rounded-2xl overflow-hidden bg-white/[0.015] shadow-[0_10px_34px_-16px_rgba(0,0,0,0.8)]`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <span className="hk-icon-tile"><Sparkles className={`w-3.5 h-3.5 ${cfg.accent}`} /></span>
          <span className="hk-display text-[16px] text-white">{cfg.title}</span>
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border border-white/10 ${cfg.badge}`}>Hakase AI v2</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
            Analyzing…
          </div>
        ) : report ? (
          <button onClick={onRun} className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md font-medium text-white transition-colors ${cfg.btn}`}>
            <RefreshCw className="w-3 h-3" /> Re-run
          </button>
        ) : (
          <button onClick={onRun} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md font-semibold text-white transition-colors ${cfg.btn}`}>
            <Sparkles className="w-3 h-3" /> Run AI Analysis
          </button>
        )}
      </div>

      {!loading && !report && !error && (
        <div className="px-4 py-4 space-y-4">
          {layer === 1 && <L1AiPreSummary sim={sim ?? null} iv={iv ?? null} targetName={targetName} targetConfidence={targetConfidence} targetArea={targetArea} />}
          {layer === 2 && <L2AiPreSummary cr={cr ?? null} />}
          {layer === 3 && <L3AiPreSummary tr={tr ?? null} />}

          {onAcknowledgeFlags && (
            <AiSafetyGate flags={layerFlags} acknowledged={flagsAcknowledged ?? false} onAcknowledge={onAcknowledgeFlags} accent={cfg.accent} />
          )}

          {(sim || cr || tr) && (
            <div className="text-center pt-2 pb-1">
              <p className="text-[11px] text-slate-500 max-w-[380px] mx-auto">
                The data above summarizes this layer's simulation outputs.
                Click <span className={`${cfg.accent} font-medium`}>Run AI Analysis</span> for a Claude-powered deep interpretation covering
                {layer === 1 ? " ADMET profiling, binding assessment, structural alerts, and competitive context." : ""}
                {layer === 2 ? " PBPK modeling, cohort PK/PD, adverse events, and dosing recommendations." : ""}
                {layer === 3 ? " trial design rationale, power analysis, regulatory pathway, and cost-benefit assessment." : ""}
              </p>
            </div>
          )}

          {!sim && !cr && !tr && (
            <div className="text-center py-3">
              <div className={`w-10 h-10 rounded-full ${cfg.badge} flex items-center justify-center mx-auto mb-3`}>
                <Sparkles className={`w-5 h-5 ${cfg.accent}`} />
              </div>
              <p className="text-[12px] text-slate-400 font-medium mb-1">{cfg.subtitle}</p>
              <p className="text-[11px] text-slate-600 max-w-[320px] mx-auto">
                Click <span className={`${cfg.accent} font-medium`}>Run AI Analysis</span> to get a Claude-powered deep dive on this simulation layer's results.
              </p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="px-4 py-5">
          <div className="text-[10px] text-slate-500 mb-2 font-medium">Streaming biomedical analysis…</div>
          <pre className={`text-[10px] ${cfg.accent} leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto`}>
            {stream || "Connecting…"}
          </pre>
        </div>
      )}

      {error && (
        <div className="px-4 py-3">
          <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
        </div>
      )}

      {report && !loading && (
        <div className="divide-y divide-white/[0.04]">
          {onAcknowledgeFlags && (
            <div className="px-4 py-3">
              <AiSafetyGate flags={layerFlags} acknowledged={flagsAcknowledged ?? false} onAcknowledge={onAcknowledgeFlags} accent={cfg.accent} />
            </div>
          )}
          {Object.entries(report).map(([key, val]) => {
            if (!val || (Array.isArray(val) && val.length === 0)) return null;
            const label = LAYER_AI_KEY_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim();
            const isArr = Array.isArray(val);
            const text = String(val);
            const sentences = isArr ? [] : splitSentences(text);
            return (
              <div key={key} className="px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-[3px] h-4 rounded-full ${cfg.btn}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${cfg.accent}`}>{label}</span>
                </div>
                {isArr ? (
                  <ul className="space-y-2">
                    {(val as string[]).map((item, i) => (
                      <li key={i} className="flex items-start gap-3 pl-1">
                        <span className={`mt-[5px] w-1 h-1 rounded-full flex-shrink-0 ${cfg.btn}`} />
                        <span className="text-[12px] text-slate-300 leading-[1.7]">
                          <RichText text={item} accent={cfg.accent} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-2 pl-[18px]">
                    {sentences.map((s, i) => (
                      <p key={i} className="text-[12px] text-slate-300 leading-[1.75]">
                        <RichText text={s} accent={cfg.accent} />
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
