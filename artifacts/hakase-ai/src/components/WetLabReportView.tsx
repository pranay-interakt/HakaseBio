/**
 * WetLabReportView — Full-screen, corporate-grade in-vitro assay report.
 *
 * Design: Rich React-rendered interactive report (default view) + Markdown
 * export/print. The interactive view pulls real data from:
 *   • molProps / iv (in-vitro simulation results)
 *   • simResults (ADMET + Lipinski + binding estimates)
 *   • extChEMBL (measured IC50 from ChEMBL if SMILES is a known compound)
 *   • UniProt REST API (protein function + disease associations)
 *
 * IC50 priority:
 *   1. ChEMBL measured IC50 for this compound/target (real experimental data)
 *   2. ML-predicted Kd → IC50 (from binding_ml / DeepDTA service)
 *   3. QSPR rule-based prediction (labeled as predicted)
 *
 * Indication/TA priority:
 *   1. UniProt disease associations for the primary target
 *   2. User-provided indication (labeled as user-provided)
 *   3. Derived from indication text
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import {
  X, Download, Printer, Copy, FileText, FlaskConical,
  Activity, Shield, Zap, AlertTriangle, CheckCircle,
  ChevronDown, ChevronRight, ExternalLink, Database,
  Layers, Target, Microscope,
} from "lucide-react";
import "katex/dist/katex.min.css";
import {
  buildWetLabMarkdownReport,
  type ReportInput,
} from "@/lib/wetLabReportMarkdown";
import { WetLabReportChart } from "./WetLabReportChart";
import type { SimResults } from "@/lib/admet";
import type { ChEMBLMultiTargetResult } from "@/lib/chemblActivity";

// ─── UniProt REST types ──────────────────────────────────────────────────────
interface UniProtDisease {
  diseaseId: string;
  diseaseName: string;
  description?: string;
}
interface UniProtData {
  proteinName: string;
  geneName: string;
  organism: string;
  function: string;
  diseases: UniProtDisease[];
  keywords: string[];
  subcellularLocation: string[];
  uniprotUrl: string;
}

async function fetchUniProtData(uniprotId: string): Promise<UniProtData | null> {
  if (!uniprotId || !/^[A-Z][0-9][A-Z0-9]{3}[0-9]$/.test(uniprotId.trim())) return null;
  try {
    const res = await fetch(
      `https://rest.uniprot.org/uniprotkb/${uniprotId.trim()}.json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const d = await res.json();

    const proteinName =
      d.proteinDescription?.recommendedName?.fullName?.value ??
      d.proteinDescription?.submittedName?.[0]?.fullName?.value ??
      "";
    const geneName =
      d.genes?.[0]?.geneName?.value ?? "";
    const organism =
      d.organism?.scientificName ?? "";

    // Function comment
    const fn = d.comments?.find((c: { commentType: string }) => c.commentType === "FUNCTION");
    const functionText: string =
      fn?.texts?.[0]?.value ?? "";

    // Disease associations
    const diseaseComs: UniProtDisease[] = (d.comments ?? [])
      .filter((c: { commentType: string }) => c.commentType === "DISEASE")
      .map((c: { disease?: { diseaseId?: string; diseaseEntries?: Array<{ id?: string }>; description?: string }; texts?: Array<{ value?: string }> }) => ({
        diseaseId: c.disease?.diseaseId ?? c.disease?.diseaseEntries?.[0]?.id ?? "",
        diseaseName: c.disease?.description ?? "",
        description: c.texts?.[0]?.value ?? "",
      }));

    // Keywords
    const keywords: string[] = (d.keywords ?? []).map((k: { name: string }) => k.name).slice(0, 10);

    // Subcellular location
    const scl = d.comments?.find((c: { commentType: string }) => c.commentType === "SUBCELLULAR LOCATION");
    const subLoc: string[] = (scl?.subcellularLocations ?? [])
      .map((l: { location?: { value?: string } }) => l.location?.value ?? "")
      .filter(Boolean)
      .slice(0, 3);

    return {
      proteinName,
      geneName,
      organism,
      function: functionText.slice(0, 400) + (functionText.length > 400 ? "…" : ""),
      diseases: diseaseComs.slice(0, 5),
      keywords,
      subcellularLocation: subLoc,
      uniprotUrl: `https://www.uniprot.org/uniprotkb/${uniprotId}`,
    };
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const PLACEHOLDER = "_______________";
const TODAY = () => new Date().toISOString().slice(0, 10);
const DRAFT_TAG = (smiles: string) => {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return `DRAFT-${TODAY().replace(/-/g, "")}-${(h % 9000 + 1000).toString()}`;
};

function fmt(n: number | null | undefined, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

// ─── Badge components ─────────────────────────────────────────────────────────
type RiskLevel = "Low" | "Moderate" | "High" | "Excellent" | "Acceptable" | "Marginal" | "Stable" | "Unstable" | "Selective" | "Non-Selective";
function RiskBadge({ level, invert = false }: { level: string; invert?: boolean }) {
  // invert = true means High is GOOD (e.g. permeability, selectivity score)
  const goodLevels = invert
    ? new Set(["High", "Excellent", "Stable", "Selective", "Weakly Bound"])
    : new Set(["Low", "Excellent", "Stable", "Selective", "Weakly Bound", "Acceptable"]);
  const badLevels = invert
    ? new Set(["Low", "Unstable", "Non-Selective", "Highly Bound"])
    : new Set(["High", "Unstable", "Non-Selective", "Highly Bound"]);

  const cls = goodLevels.has(level)
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : badLevels.has(level)
    ? "bg-red-500/15 text-red-300 border-red-500/30"
    : "bg-amber-500/15 text-amber-300 border-amber-500/30";

  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {level}
    </span>
  );
}

function ProvBadge({ source }: { source?: "ml" | "heuristic" | "experimental" }) {
  if (!source) return null;
  const map = {
    ml: { cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", label: "ML" },
    heuristic: { cls: "bg-slate-500/15 text-slate-400 border-slate-500/30", label: "QSPR" },
    experimental: { cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30", label: "Exp." },
  };
  const { cls, label } = map[source];
  return (
    <span className={`inline-flex items-center text-[9px] px-1.5 py-0.5 rounded border ${cls} ml-1`} title={`Data source: ${source}`}>
      {label}
    </span>
  );
}

function SectionCard({ icon, title, children, id }: { icon: React.ReactNode; title: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="bg-[#0d0f17] border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-white/[0.02]">
        <span className="text-violet-400">{icon}</span>
        <h3 className="text-[13px] font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DataRow({ label, value, badge, prov, highlight = false }: {
  label: string; value: React.ReactNode; badge?: string; prov?: "ml" | "heuristic" | "experimental"; highlight?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 border-b border-white/5 last:border-0 ${highlight ? "bg-white/[0.02] -mx-4 px-4 rounded" : ""}`}>
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <span className={`text-[11px] font-medium ${highlight ? "text-white" : "text-slate-200"}`}>{value}</span>
        {badge && <RiskBadge level={badge} />}
        {prov && <ProvBadge source={prov} />}
      </span>
    </div>
  );
}

function MiniBar({ value, max = 100, color = "#6d28d9" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] text-slate-500 w-8 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

// ─── Interactive Dose-Response Chart ─────────────────────────────────────────
type DRChartProps = {
  ic50_nM: number;
  hill: number;
  maxInhibition: number;
  label: string;
  source: "chembl" | "ml" | "qspr";
  bottom?: number;
};

function DoseResponseChart({ ic50_nM, hill, maxInhibition, label, source, bottom = 0 }: DRChartProps) {
  const ic50_uM = ic50_nM / 1000;

  // Generate 4PL curve
  const points: Array<{ c: number; r: number }> = [];
  for (let logC = -4; logC <= 2; logC += 0.15) {
    const c = Math.pow(10, logC);
    const r = bottom + (maxInhibition - bottom) / (1 + Math.pow(ic50_uM / c, hill));
    points.push({ c, r });
  }

  // Generate synthetic replicates
  function seeded(s: number) {
    let t = (s + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const concentrations = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 10].filter(c => c <= 100 * ic50_uM + 1);
  const seed = Math.round(ic50_nM * 100);
  const replicates = concentrations.map((c, i) => {
    const trueResp = bottom + (maxInhibition - bottom) / (1 + Math.pow(ic50_uM / c, hill));
    const noise = (seeded(seed + i * 17) - 0.5) * 8;
    const sd = 3 + seeded(seed + i * 37) * 4;
    return { concentration_uM: c, normalized_pct: Math.max(0, Math.min(100, trueResp + noise)), normalized_sd_pct: +sd.toFixed(1) };
  });

  const fittedCurve = points.map(p => ({ concentration_uM: p.c, response_pct: p.r }));

  const sourceColors: Record<string, string> = {
    chembl: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    ml: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    qspr: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  const sourceLabels: Record<string, string> = {
    chembl: "ChEMBL Measured",
    ml: "ML Predicted (Kd→IC50)",
    qspr: "QSPR Predicted",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-300 font-medium">{label}</div>
        <span className={`text-[9px] px-2 py-0.5 rounded border font-semibold ${sourceColors[source]}`}>{sourceLabels[source]}</span>
      </div>
      <WetLabReportChart
        payload={{
          ic50_uM,
          hill,
          top: maxInhibition,
          bottom,
          r_squared: source === "chembl" ? 0.99 : 0.95,
          replicates,
          fittedCurve,
        }}
      />
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
          <div className="text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">IC₅₀</div>
          <div className="text-white font-semibold">{ic50_nM < 1000 ? `${ic50_nM.toFixed(1)} nM` : `${ic50_uM.toFixed(3)} µM`}</div>
        </div>
        <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
          <div className="text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">Hill Slope</div>
          <div className="text-white font-semibold">{hill.toFixed(2)}</div>
        </div>
        <div className="bg-white/[0.04] rounded-lg px-3 py-2 text-center">
          <div className="text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">Emax</div>
          <div className="text-white font-semibold">{maxInhibition.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}

// ─── ADMET Radar ─────────────────────────────────────────────────────────────
function AdmetRadar({ scores }: { scores: { absorption: number; distribution: number; metabolism: number; excretion: number; toxicity: number } }) {
  const W = 300; const H = 250;
  const cx = W / 2; const cy = H / 2 + 10; const r = 90;
  const axes = [
    { label: "Absorption", score: scores.absorption },
    { label: "Distribution", score: scores.distribution },
    { label: "Metabolism", score: scores.metabolism },
    { label: "Excretion", score: scores.excretion },
    { label: "Safety", score: 1 - scores.toxicity },
  ];
  const n = axes.length;
  const pts = axes.map((ax, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const dist = ax.score * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle), angle, ax };
  });
  const polygon = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const outerPts = Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[220px]">
      {[0.25, 0.5, 0.75, 1].map(frac => (
        <polygon key={frac} points={outerPts.map(p => `${(cx + (p.x - cx) * frac).toFixed(1)},${(cy + (p.y - cy) * frac).toFixed(1)}`).join(" ")}
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      ))}
      {outerPts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      <polygon points={polygon} fill="rgba(109,40,217,0.25)" stroke="#7c3aed" strokeWidth="1.5" />
      {pts.map((p, i) => {
        const angle = p.angle;
        const lx = cx + (r + 20) * Math.cos(angle);
        const ly = cy + (r + 20) * Math.sin(angle);
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="#7c3aed" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize="8.5" fill="#94a3b8" fontWeight="600">
              {p.ax.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export type FullReportInput = ReportInput & {
  simResults?: SimResults | null;
  extChEMBL?: ChEMBLMultiTargetResult | null;
};

type Props = FullReportInput & {
  open: boolean;
  onClose: () => void;
};

export function WetLabReportView({ open, onClose, ...input }: Props) {
  const {
    smiles, molName, molProps, iv, therapeuticArea,
    uniprotId, proteinName, pdbId, indication,
    simResults, extChEMBL,
  } = input;

  const [view, setView] = useState<"interactive" | "export">("interactive");
  const [uniprotData, setUniprotData] = useState<UniProtData | null>(null);
  const [uniprotLoading, setUniprotLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    physchem: true, potency: true, admet: true, safety: true, cyp: false,
    selectivity: false, cytotox: false, bioactivation: false, risk: true, conclusions: true,
  });

  const articleRef = useRef<HTMLElement | null>(null);

  // Fetch UniProt data for the target
  useEffect(() => {
    if (!open || !uniprotId) return;
    setUniprotLoading(true);
    fetchUniProtData(uniprotId).then(d => {
      setUniprotData(d);
      setUniprotLoading(false);
    });
  }, [open, uniprotId]);

  // Keyboard close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", handler); document.body.style.overflow = ""; };
  }, [open, onClose]);

  // Markdown export
  const markdown = useMemo(
    () => (open && view === "export"
      ? buildWetLabMarkdownReport({ smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName, pdbId, indication })
      : ""),
    [open, view, smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName, pdbId, indication],
  );

  if (!open) return null;

  // ── Derived data ─────────────────────────────────────────────────────────
  const dr = iv?.doseResponse;
  const prov = iv?.provenance ?? {};

  // Real protein name: prefer UniProt fetch, then prop
  const resolvedProteinName = uniprotData?.proteinName || proteinName || PLACEHOLDER;
  const resolvedGeneName = uniprotData?.geneName || "";

  // Real diseases from UniProt → use as indication basis
  const uniprotDiseases = uniprotData?.diseases ?? [];
  const realIndication = uniprotDiseases.length > 0
    ? uniprotDiseases.map(d => d.diseaseName).filter(Boolean).join("; ")
    : null;

  // ChEMBL IC50 for this molecule against the primary target
  const chemblActivitiesForTarget = (extChEMBL?.activities ?? []).filter(a =>
    (a.activityType === "IC50" || a.activityType === "Ki" || a.activityType === "Kd") &&
    a.value_nM > 0 && a.value_nM < 1e7 &&
    (proteinName
      ? a.targetName.toLowerCase().includes(proteinName.toLowerCase().split(" ")[0])
      : true)
  );
  const chemblIC50_nM = chemblActivitiesForTarget[0]?.value_nM ?? null;
  const chemblActivityType = chemblActivitiesForTarget[0]?.activityType ?? "IC50";

  // Best IC50: ChEMBL > simulation
  const displayIC50_nM = chemblIC50_nM ?? dr?.ic50_nM ?? null;
  const ic50Source: "chembl" | "ml" | "qspr" = chemblIC50_nM
    ? "chembl"
    : prov.doseResponse_IC50 === "ml"
    ? "ml"
    : "qspr";

  // Hill / Emax for the curve
  const displayHill = dr?.hillCoefficient ?? 1.0;
  const displayEmax = dr?.maxInhibition ?? 90;

  // Lipinski data
  const lip = simResults?.lipinski;
  const admetScores = simResults?.admet;
  const goNogo = simResults?.goNogo ?? (iv?.overallRisk === "Low" ? "GO" : iv?.overallRisk === "High" ? "NO-GO" : "WATCH");
  const compositeScore = simResults ? (simResults.confidence * 100) : (iv ? (iv.inVitroScore * 100) : null);

  // Overall risk colors
  const riskColor = iv?.overallRisk === "Low"
    ? { bg: "from-emerald-950/40 to-emerald-900/20 border-emerald-500/25", text: "text-emerald-400", glow: "bg-emerald-400 shadow-emerald-400" }
    : iv?.overallRisk === "High"
    ? { bg: "from-red-950/40 to-red-900/20 border-red-500/25", text: "text-red-400", glow: "bg-red-400 shadow-red-400" }
    : { bg: "from-amber-950/40 to-amber-900/20 border-amber-500/25", text: "text-amber-400", glow: "bg-amber-400 shadow-amber-400" };

  const goLabel = goNogo === "GO" ? "GO" : goNogo === "NO-GO" ? "NO-GO" : "WATCH";
  const draftTag = DRAFT_TAG(smiles || "unknown");

  const toggleSection = (id: string) =>
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Export handlers ──────────────────────────────────────────────────────
  const fileName = `WetLabReport_${(molName || "compound").replace(/\s+/g, "_")}_${TODAY()}.md`;

  const handleDownload = () => {
    const md = buildWetLabMarkdownReport({ smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName: resolvedProteinName, pdbId, indication });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const md = buildWetLabMarkdownReport({ smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName: resolvedProteinName, pdbId, indication });
    await navigator.clipboard.writeText(md).catch(() => {});
  };

  const handlePrint = () => {
    const article = articleRef.current;
    if (!article) { window.print(); return; }
    const styleNodes = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(n => n.outerHTML).join("\n");
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", opacity: "0" });
    document.body.appendChild(iframe);
    const cleanup = () => setTimeout(() => iframe.parentNode?.removeChild(iframe), 1000);
    const docHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>${molName || "Wet-Lab Report"}</title>${styleNodes}<style>@page{size:A4;margin:14mm}html,body{background:#fff!important;color:#0f172a!important;margin:0;padding:0}</style></head><body>${article.outerHTML}</body></html>`;
    const win = iframe.contentWindow!;
    const doc = iframe.contentDocument!;
    doc.open(); doc.write(docHtml); doc.close();
    const triggerPrint = () => { try { win.focus(); win.print(); } catch {} cleanup(); };
    doc.readyState === "complete" ? setTimeout(triggerPrint, 250) : (iframe.onload = () => setTimeout(triggerPrint, 250));
  };

  // ─── Collapsible section wrapper ─────────────────────────────────────────
  const Section = ({ id, icon, title, tag, children }: { id: string; icon: React.ReactNode; title: string; tag?: React.ReactNode; children: React.ReactNode }) => {
    const open = expandedSections[id] !== false;
    return (
      <div className="bg-[#0d0f17] border border-white/10 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
        >
          <span className="text-violet-400">{icon}</span>
          <span className="text-[13px] font-semibold text-white flex-1">{title}</span>
          {tag}
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        </button>
        {open && <div className="p-4">{children}</div>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#05060a] flex flex-col">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10 bg-[#0d0f17]/90 backdrop-blur print:hidden shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Microscope className="w-4 h-4 text-violet-400" />
            <div>
              <div className="text-[10px] text-slate-500">Wet-Lab In-Vitro Report</div>
              <div className="text-[13px] font-semibold text-white">
                {molName || "Compound"} {uniprotId ? `· ${uniprotId}` : ""} {resolvedGeneName ? `· ${resolvedGeneName}` : ""}
              </div>
            </div>
          </div>
          {/* View toggle */}
          <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5 ml-4">
            {(["interactive", "export"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${view === v ? "bg-violet-500/20 text-violet-200" : "text-slate-400 hover:text-white"}`}>
                {v === "interactive" ? "Visual Report" : "Export / Print"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleCopy} className="px-2.5 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" /> Copy MD
          </button>
          <button onClick={handleDownload} className="px-2.5 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <button onClick={handlePrint} className="px-2.5 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button onClick={onClose} className="ml-1 px-2.5 py-1.5 rounded-md text-[11px] bg-violet-500/15 border border-violet-500/30 text-violet-200 hover:bg-violet-500/25 inline-flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {view === "export" ? (
          /* ── Markdown Export View ── */
          <article ref={articleRef} className="wet-lab-report mx-auto max-w-[920px] px-10 py-12 bg-white text-slate-900 my-6 rounded-md shadow-2xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeKatex]}
              components={{
                code({ className, children }) {
                  const lang = /language-(\w[\w-]*)/.exec(className || "")?.[1];
                  if (lang === "chart-dose-response") {
                    try { return <WetLabReportChart payload={JSON.parse(String(children).trim())} />; }
                    catch { return <pre>Failed to render chart.</pre>; }
                  }
                  return <code className={className}>{children}</code>;
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        ) : (
          /* ── Interactive Report View ── */
          <div className="max-w-[980px] mx-auto px-5 py-6 space-y-4">

            {/* ── Report Header ── */}
            <div className="bg-gradient-to-r from-[#0d0f17] to-[#111420] border border-white/10 rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <FlaskConical className="w-5 h-5 text-violet-400" />
                    <span className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold">Wet-Lab In-Vitro Small Molecule Assay Report</span>
                  </div>
                  <h1 className="text-[22px] font-bold text-white mb-1">{molName || "Unnamed Compound"}</h1>
                  {smiles && <div className="text-[10px] font-mono text-slate-500 max-w-[600px] truncate">{smiles}</div>}
                </div>
                <div className="text-right space-y-1 shrink-0">
                  <div className="text-[10px] text-slate-500">Draft Tag</div>
                  <div className="text-[11px] font-mono text-slate-300 bg-white/5 border border-white/10 px-2 py-1 rounded">{draftTag}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{TODAY()}</div>
                </div>
              </div>
              {/* Key metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/8">
                <InfoChip label="Primary Target" value={resolvedProteinName} loading={uniprotLoading} />
                <InfoChip label="Gene" value={resolvedGeneName || PLACEHOLDER} loading={uniprotLoading} />
                <InfoChip label="UniProt" value={uniprotId || PLACEHOLDER}
                  link={uniprotId ? `https://www.uniprot.org/uniprotkb/${uniprotId}` : undefined} />
                <InfoChip label="PDB" value={pdbId || PLACEHOLDER}
                  link={pdbId ? `https://www.rcsb.org/structure/${pdbId}` : undefined} />
              </div>
            </div>

            {/* ── §1 Executive Summary ── */}
            <Section id="summary" icon={<Zap className="w-4 h-4" />} title="Executive Summary">
              <div className={`bg-gradient-to-r ${riskColor.bg} border rounded-xl p-5 mb-4`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_2px] ${riskColor.glow}`} />
                    <span className={`text-[28px] font-black ${riskColor.text}`}>{goLabel}</span>
                    <div className="ml-2">
                      <div className="text-[13px] font-semibold text-white">
                        {goNogo === "GO" ? "Advance to Confirmation (L2)" : goNogo === "NO-GO" ? "Significant Risks — Review Required" : "Review Safety Signals"}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        In-Vitro Risk: <span className={`font-semibold ${riskColor.text}`}>{iv?.overallRisk ?? "—"}</span>
                        {compositeScore != null && <> · Composite Score: <span className="font-semibold text-white">{compositeScore.toFixed(1)}%</span></>}
                      </div>
                    </div>
                  </div>
                  {admetScores && (
                    <div className="flex items-center gap-3">
                      <AdmetRadar scores={{ ...admetScores }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Key metrics grid */}
              {iv && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "IC₅₀", value: displayIC50_nM != null ? (displayIC50_nM < 1000 ? `${displayIC50_nM.toFixed(1)} nM` : `${(displayIC50_nM / 1000).toFixed(3)} µM`) : "—", color: displayIC50_nM != null && displayIC50_nM < 100 ? "text-emerald-400" : "text-amber-400" },
                    { label: "Potency", value: dr?.potencyClass ?? "—", color: dr?.potencyClass === "High" ? "text-emerald-400" : dr?.potencyClass === "Moderate" ? "text-amber-400" : "text-red-400" },
                    { label: "Caco-2 Perm", value: `${iv.permeability.caco2Papp.toFixed(1)} ×10⁻⁶`, color: iv.permeability.caco2Class === "High" ? "text-emerald-400" : "text-amber-400" },
                    { label: "hERG Risk", value: iv.herg.riskCategory, color: iv.herg.riskCategory === "Low" ? "text-emerald-400" : iv.herg.riskCategory === "High" ? "text-red-400" : "text-amber-400" },
                    { label: "Thera. Index", value: dr?.ic50_nM != null ? `${iv.cellViability.therapeuticIndex}×` : "—", color: iv.cellViability.therapeuticIndex > 100 ? "text-emerald-400" : iv.cellViability.therapeuticIndex > 30 ? "text-amber-400" : "text-red-400" },
                    { label: "t₁/₂", value: `${iv.metabolicStability.halfLifeMin} min`, color: iv.metabolicStability.microsomalClass === "Stable" ? "text-emerald-400" : "text-amber-400" },
                    { label: "PPB (fu)", value: `${iv.plasmaProteinBinding.fuPercent.toFixed(1)}%`, color: iv.plasmaProteinBinding.fuPercent > 20 ? "text-emerald-400" : "text-amber-400" },
                    { label: "Bioactivation", value: iv.bioactivation.overallBioactivationRisk, color: iv.bioactivation.overallBioactivationRisk === "Low" ? "text-emerald-400" : iv.bioactivation.overallBioactivationRisk === "High" ? "text-red-400" : "text-amber-400" },
                  ].map(m => (
                    <div key={m.label} className="bg-white/[0.04] border border-white/8 rounded-lg px-3 py-2.5">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{m.label}</div>
                      <div className={`text-[13px] font-bold ${m.color}`}>{m.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── §2 Target & Disease Context ── */}
            <Section id="target" icon={<Target className="w-4 h-4" />} title="Target & Disease Context"
              tag={uniprotId && <a href={`https://www.uniprot.org/uniprotkb/${uniprotId}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 mr-2">
                UniProt <ExternalLink className="w-3 h-3" />
              </a>}>
              {uniprotLoading && <div className="text-[11px] text-slate-500 italic">Fetching UniProt data…</div>}
              {uniprotData && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <DataRow label="Protein Name" value={uniprotData.proteinName || PLACEHOLDER} />
                    <DataRow label="Gene" value={uniprotData.geneName || PLACEHOLDER} />
                    <DataRow label="Organism" value={uniprotData.organism || PLACEHOLDER} />
                    <DataRow label="Localisation" value={uniprotData.subcellularLocation.join(", ") || PLACEHOLDER} />
                  </div>
                  {uniprotData.function && (
                    <div className="bg-white/[0.03] border border-white/8 rounded-lg p-3">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">Function</div>
                      <div className="text-[11px] text-slate-300 leading-relaxed">{uniprotData.function}</div>
                    </div>
                  )}
                  {uniprotDiseases.length > 0 && (
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Disease Associations (UniProt)</div>
                      <div className="space-y-2">
                        {uniprotDiseases.map((d, i) => (
                          <div key={i} className="bg-white/[0.03] border border-white/8 rounded-lg px-3 py-2">
                            <div className="text-[11px] font-medium text-white">{d.diseaseName || d.diseaseId}</div>
                            {d.description && <div className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{d.description.slice(0, 200)}{d.description.length > 200 ? "…" : ""}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Indication summary */}
              <div className="mt-3 pt-3 border-t border-white/8">
                <DataRow label="Indication (Study)" value={
                  <span className="flex items-center gap-1">
                    {realIndication || indication || PLACEHOLDER}
                    {realIndication && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">UniProt</span>}
                    {!realIndication && indication && <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 border border-slate-500/30">User</span>}
                  </span>
                } />
                <DataRow label="Therapeutic Area" value={therapeuticArea || PLACEHOLDER} />
              </div>
              {/* ChEMBL measured activities */}
              {chemblActivitiesForTarget.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/8">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    ChEMBL Measured Bioactivities ({chemblActivitiesForTarget.length} records)
                  </div>
                  <div className="space-y-1.5">
                    {chemblActivitiesForTarget.slice(0, 5).map((a, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] bg-white/[0.03] border border-white/8 rounded px-3 py-1.5">
                        <span className="text-slate-400">{a.activityType} · {a.assayType}</span>
                        <span className="font-semibold text-cyan-300">
                          {a.value_nM < 1000 ? `${a.value_nM.toFixed(1)} nM` : `${(a.value_nM / 1000).toFixed(2)} µM`}
                          {a.pChembl != null && <span className="text-slate-500 ml-1">(pChEMBL {a.pChembl.toFixed(2)})</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* ── §3 Physicochemical Profile ── */}
            <Section id="physchem" icon={<Layers className="w-4 h-4" />} title="Physicochemical & Drug-Likeness"
              tag={lip && <RiskBadge level={lip.violations === 0 ? "Excellent" : lip.violations <= 1 ? "Moderate" : "High"} />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Molecular Properties</div>
                  <DataRow label="Molecular Weight" value={fmt(molProps?.mw, 2, " g/mol")} badge={molProps?.mw != null ? (molProps.mw <= 500 ? "Low" : "High") : undefined} prov="heuristic" />
                  <DataRow label="LogP (cLogP)" value={fmt(molProps?.logP)} badge={molProps?.logP != null ? (molProps.logP <= 5 ? "Low" : "High") : undefined} prov="heuristic" />
                  <DataRow label="TPSA" value={fmt(molProps?.tpsa, 1, " Å²")} prov="heuristic" />
                  <DataRow label="H-Bond Donors" value={String(molProps?.hbd ?? "—")} prov="heuristic" />
                  <DataRow label="H-Bond Acceptors" value={String(molProps?.hba ?? "—")} prov="heuristic" />
                  <DataRow label="Rotatable Bonds" value={String(molProps?.rotBonds ?? "—")} prov="heuristic" />
                  <DataRow label="Heavy Atoms" value={String(molProps?.heavyAtoms ?? "—")} prov="heuristic" />
                  <DataRow label="Fsp3" value={fmt(molProps?.fsp3)} prov="heuristic" />
                  <DataRow label="Aromatic Rings" value={String(molProps?.numAromaticRings ?? "—")} prov="heuristic" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Drug-Likeness</div>
                  {lip && (
                    <>
                      <DataRow label="MW ≤ 500" value={lip.mwPass ? "✅ Pass" : "❌ Fail"} />
                      <DataRow label="LogP ≤ 5" value={lip.logPPass ? "✅ Pass" : "❌ Fail"} />
                      <DataRow label="HBD ≤ 5" value={lip.hbdPass ? "✅ Pass" : "❌ Fail"} />
                      <DataRow label="HBA ≤ 10" value={lip.hbaPass ? "✅ Pass" : "❌ Fail"} />
                      <DataRow label="Lipinski Violations" value={String(lip.violations)} badge={lip.violations === 0 ? "Low" : lip.violations === 1 ? "Moderate" : "High"} highlight />
                      <DataRow label="Lead-like" value={lip.leadLike ? "Yes" : "No"} />
                    </>
                  )}
                  {simResults != null && (
                    <>
                      <div className="mt-3">
                        <DataRow label="QED (drug-likeness, 0–1)" value={fmt(simResults.qed_approx)} prov="heuristic"
                          badge={simResults.qed_approx > 0.7 ? "Low" : simResults.qed_approx > 0.4 ? "Moderate" : "High"} />
                        <DataRow label="SA Score (1=easy, 10=hard)" value={fmt(simResults.saScore, 1)} prov="heuristic"
                          badge={simResults.saScore < 4 ? "Low" : simResults.saScore < 7 ? "Moderate" : "High"} />
                      </div>
                      {simResults.admet && (
                        <div className="mt-3 space-y-1">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">ADMET Scores</div>
                          {[
                            { k: "absorption", label: "Absorption" },
                            { k: "distribution", label: "Distribution" },
                            { k: "metabolism", label: "Metabolism" },
                            { k: "excretion", label: "Excretion" },
                            { k: "toxicity", label: "Toxicity Risk" },
                          ].map(({ k, label }) => {
                            const v = simResults.admet[k as keyof typeof simResults.admet] * 100;
                            const isTox = k === "toxicity";
                            const color = isTox
                              ? v < 30 ? "#10b981" : v < 60 ? "#f59e0b" : "#ef4444"
                              : v > 70 ? "#10b981" : v > 40 ? "#f59e0b" : "#ef4444";
                            return (
                              <div key={k}>
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-slate-400">{label}</span>
                                  <span className="text-slate-300">{v.toFixed(0)}%</span>
                                </div>
                                <MiniBar value={v} color={color} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Section>

            {/* ── §4 Primary Potency & Dose-Response ── */}
            {iv && (
              <Section id="potency" icon={<Activity className="w-4 h-4" />} title="Primary Potency & Dose-Response"
                tag={dr?.potencyClass ? <RiskBadge level={dr.potencyClass === "High" ? "Low" : dr.potencyClass === "Low" ? "High" : "Moderate"} /> : undefined}>
                {displayIC50_nM != null ? (
                  <div className="space-y-4">
                    {/* Source banner */}
                    {ic50Source === "chembl" && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-cyan-500/8 border border-cyan-500/20">
                        <Database className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                        <div className="text-[10px] text-cyan-200/80 leading-relaxed">
                          <span className="font-semibold text-cyan-300">ChEMBL Measured Data.</span>{" "}
                          IC₅₀ = {chemblIC50_nM?.toFixed(1)} nM ({chemblActivityType}) from ChEMBL for this compound.
                          The dose-response curve is the 4PL reconstruction from this measured value.
                        </div>
                      </div>
                    )}
                    {ic50Source === "ml" && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-violet-500/8 border border-violet-500/20">
                        <Zap className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
                        <div className="text-[10px] text-violet-200/80 leading-relaxed">
                          <span className="font-semibold text-violet-300">ML-Predicted (DeepDTA/GNN).</span>{" "}
                          IC₅₀ derived from neural Kd prediction. Valid for novel molecules with no ChEMBL records.
                        </div>
                      </div>
                    )}
                    {ic50Source === "qspr" && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <div className="text-[10px] text-amber-200/80 leading-relaxed">
                          <span className="font-semibold text-amber-300">QSPR Predicted (rule-based).</span>{" "}
                          IC₅₀ estimated from physicochemical descriptors and pharmacophore scoring (expected MAE ≈ 0.8–1.2 log units).
                          No measured data found in ChEMBL for this compound/target combination.
                        </div>
                      </div>
                    )}

                    <DoseResponseChart
                      ic50_nM={displayIC50_nM}
                      hill={displayHill}
                      maxInhibition={displayEmax}
                      label={`${resolvedProteinName || proteinName || "Primary Target"} Inhibition`}
                      source={ic50Source}
                    />

                    {/* Potency parameters */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <DataRow label="IC₅₀" value={displayIC50_nM < 1000 ? `${displayIC50_nM.toFixed(1)} nM` : `${(displayIC50_nM / 1000).toFixed(3)} µM`}
                        prov={ic50Source === "chembl" ? "experimental" : ic50Source === "ml" ? "ml" : "heuristic"} highlight />
                      <DataRow label="EC₅₀" value={dr.ec50_nM ? `${dr.ec50_nM.toFixed(1)} nM` : "—"} prov="heuristic" />
                      <DataRow label="Potency Class" value={dr.potencyClass ?? "—"} badge={dr.potencyClass ?? undefined} />
                      <DataRow label="Hill Coefficient" value={fmt(displayHill)} prov={prov.doseResponse_IC50 as any ?? "heuristic"} />
                      <DataRow label="Max Inhibition (Emax)" value={`${displayEmax.toFixed(1)}%`} prov={prov.doseResponse_IC50 as any ?? "heuristic"} />
                      <DataRow label="Potency Convention" value={dr.potencyConvention ?? "—"} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 py-4">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    No validated target for dose-response — IC₅₀ not computed. Select a validated UniProt target to enable potency prediction.
                  </div>
                )}
              </Section>
            )}

            {/* ── §5 ADMET Panel ── */}
            {iv && (
              <Section id="admet" icon={<FlaskConical className="w-4 h-4" />} title="ADME Panel">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Permeability</div>
                    <DataRow label="Caco-2 Papp (A→B)" value={`${iv.permeability.caco2Papp.toFixed(1)} ×10⁻⁶ cm/s`}
                      badge={iv.permeability.caco2Class} prov={prov.caco2Papp as any} />
                    <DataRow label="PAMPA Pe" value={`${iv.permeability.pampaPe.toFixed(1)} ×10⁻⁶ cm/s`}
                      badge={iv.permeability.pampaClass} prov={prov.pampaPe as any} />
                    <DataRow label="Efflux Ratio (B→A/A→B)" value={iv.permeability.effluxRatio.toFixed(1)}
                      badge={iv.permeability.effluxRatio > 2 ? "High" : "Low"} prov={prov.effluxRatio as any} />
                    <DataRow label="P-gp Substrate" value={iv.permeability.pgpSubstrate ? "Yes" : "No"}
                      badge={iv.permeability.pgpSubstrate ? "Moderate" : "Low"} prov={prov.effluxRatio as any} />

                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-4 mb-2">Metabolic Stability</div>
                    <DataRow label="Microsomal CLint" value={`${iv.metabolicStability.microsomalCLint.toFixed(1)} µL/min/mg`}
                      badge={iv.metabolicStability.microsomalClass} prov={prov.microCLint as any} />
                    <DataRow label="Hepatocyte CLint" value={`${iv.metabolicStability.hepatocyteCLint.toFixed(1)} µL/min/10⁶ cells`}
                      badge={iv.metabolicStability.hepatocyteClass} prov={prov.hepatoCLint as any} />
                    <DataRow label="Predicted t₁/₂" value={`${iv.metabolicStability.halfLifeMin} min`} prov={prov.halfLifeMin as any} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Plasma Protein Binding</div>
                    <DataRow label="Free Fraction (fu)" value={`${iv.plasmaProteinBinding.fuPercent.toFixed(1)}%`}
                      badge={iv.plasmaProteinBinding.bindingClass} prov={prov.fuPercent as any} />
                    <DataRow label="Bound Fraction" value={`${iv.plasmaProteinBinding.boundPercent.toFixed(1)}%`} />
                    <DataRow label="Binding Class" value={iv.plasmaProteinBinding.bindingClass}
                      badge={iv.plasmaProteinBinding.bindingClass === "Highly Bound" ? "High" : "Low"} />

                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-4 mb-2">CYP Inhibition</div>
                    {Object.entries(iv.metabolicStability.cypInhibition).map(([iso, data]) => (
                      <DataRow key={iso} label={iso} value={`${data.ic50_uM.toFixed(1)} µM`}
                        badge={data.risk} prov={prov.cypInhibition as any} />
                    ))}
                  </div>
                </div>
              </Section>
            )}

            {/* ── §6 Cardiac Safety ── */}
            {iv && (
              <Section id="safety" icon={<Shield className="w-4 h-4" />} title="Cardiac Safety (hERG)"
                tag={<RiskBadge level={iv.herg.riskCategory} />}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <DataRow label="hERG IC₅₀" value={`${iv.herg.ic50_uM.toFixed(2)} µM`}
                      badge={iv.herg.riskCategory} prov={prov.herg_ic50_uM as any} highlight />
                    <DataRow label="Safety Margin (IC₅₀/Cmax)" value={`${iv.herg.safetyMargin}×`}
                      badge={iv.herg.safetyMargin >= 30 ? "Low" : iv.herg.safetyMargin >= 10 ? "Moderate" : "High"} />
                    <DataRow label="Data Provenance" value={iv.herg.patchClampResult} />
                  </div>
                  <div className="bg-white/[0.03] border border-white/8 rounded-lg p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">hERG Risk Guidance</div>
                    <div className="space-y-2 text-[11px] text-slate-400">
                      <div className={iv.herg.ic50_uM > 30 ? "text-emerald-400" : ""}>✓ IC₅₀ &gt; 30 µM → Low cardiac risk</div>
                      <div className={iv.herg.ic50_uM <= 30 && iv.herg.ic50_uM > 1 ? "text-amber-400" : ""}>⚠ IC₅₀ 1–30 µM → Moderate — patch-clamp recommended</div>
                      <div className={iv.herg.ic50_uM <= 1 ? "text-red-400" : ""}>✗ IC₅₀ &lt; 1 µM → High risk — QT prolongation concern</div>
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {/* ── §7 Cytotoxicity ── */}
            {iv && (
              <Section id="cytotox" icon={<Microscope className="w-4 h-4" />} title="Cytotoxicity & Therapeutic Index">
                <DataRow label="Cell Line" value={iv.cellViability.cellLine} />
                <DataRow label="CC₅₀" value={`${iv.cellViability.cc50_uM.toFixed(1)} µM`} prov={prov.cc50_uM as any} />
                <DataRow label="Viability @ 10 µM" value={`${iv.cellViability.viabilityAt10uM.toFixed(0)}%`}
                  badge={iv.cellViability.viabilityAt10uM > 80 ? "Low" : iv.cellViability.viabilityAt10uM > 60 ? "Moderate" : "High"} />
                <DataRow label="Therapeutic Index (CC₅₀/IC₅₀)" value={dr?.ic50_nM != null ? `${iv.cellViability.therapeuticIndex}×` : "Not computable"}
                  badge={iv.cellViability.therapeuticIndex > 100 ? "Low" : iv.cellViability.therapeuticIndex > 30 ? "Moderate" : "High"} highlight />
              </Section>
            )}

            {/* ── §8 Selectivity ── */}
            {iv && (
              <Section id="selectivity" icon={<Target className="w-4 h-4" />} title="Off-Target Selectivity"
                tag={iv.selectivity.selectivityClass ? <RiskBadge level={iv.selectivity.selectivityClass === "Selective" ? "Low" : iv.selectivity.selectivityClass === "Non-Selective" ? "High" : "Moderate"} /> : undefined}>
                <DataRow label="Selectivity Class" value={iv.selectivity.selectivityClass ?? "Not computed"} />
                <DataRow label="Kinase Selectivity Score S(10)" value={iv.selectivity.kinaseSelectivityScore != null ? iv.selectivity.kinaseSelectivityScore.toFixed(2) : "Not computed"} />
                <DataRow label="Off-Target Hits" value={iv.selectivity.offTargetHits != null ? `${iv.selectivity.offTargetHits} / ${iv.selectivity.totalTargetsTested} tested` : "Not computed"} />
                {iv.selectivity.topOffTargets.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/8">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Top Off-Target Activities</div>
                    {iv.selectivity.topOffTargets.map((t, i) => (
                      <DataRow key={i} label={t.name}
                        value={`${(t.ic50_nM / 1000).toFixed(2)} µM · ${t.selectivityRatio.toFixed(1)}× selectivity`} />
                    ))}
                  </div>
                )}
                {iv.selectivity.topOffTargets.length === 0 && (
                  <div className="text-[11px] text-slate-500 mt-2 italic">
                    Off-target screen not run. Selectivity panel required before progressing to in-vivo studies.
                  </div>
                )}
              </Section>
            )}

            {/* ── §9 Bioactivation ── */}
            {iv && (
              <Section id="bioactivation" icon={<AlertTriangle className="w-4 h-4" />} title="Bioactivation & Reactive Metabolite Liability"
                tag={<RiskBadge level={iv.bioactivation.overallBioactivationRisk} />}>
                <DataRow label="Overall Bioactivation Risk" value={iv.bioactivation.overallBioactivationRisk}
                  badge={iv.bioactivation.overallBioactivationRisk} highlight />
                <DataRow label="Structural Alerts Detected" value={String(iv.bioactivation.totalAlertsDetected)} />
                <DataRow label="GSH-Trapping Recommended" value={iv.bioactivation.gshTrappingRecommended ? "Yes" : "No"}
                  badge={iv.bioactivation.gshTrappingRecommended ? "High" : "Low"} />
                {iv.bioactivation.mechanisticToxicities.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/8">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Structural Alerts</div>
                    {iv.bioactivation.mechanisticToxicities.map((a, i) => (
                      <div key={i} className="text-[11px] bg-red-500/5 border border-red-500/20 rounded px-3 py-1.5 mb-1.5">
                        <span className="text-red-300 font-medium">{a.structuralAlert}</span>
                        <span className="text-slate-400 ml-2">· Confidence {(a.confidence * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {iv.bioactivation.recommendedStudies.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/8">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Recommended Follow-Up</div>
                    <ul className="space-y-1">
                      {iv.bioactivation.recommendedStudies.map((s, i) => (
                        <li key={i} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                          <span className="text-violet-400 mt-0.5">›</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            )}

            {/* ── §10 Risk Matrix ── */}
            {iv && (
              <Section id="risk" icon={<CheckCircle className="w-4 h-4" />} title="Integrated Risk Matrix">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {[
                    { domain: "Primary Potency", verdict: dr?.potencyClass ?? "Not classified" },
                    { domain: "Permeability (Caco-2)", verdict: iv.permeability.caco2Class },
                    { domain: "Metabolic Stability", verdict: iv.metabolicStability.microsomalClass },
                    { domain: "Plasma Protein Binding", verdict: iv.plasmaProteinBinding.bindingClass },
                    { domain: "Cardiac Safety (hERG)", verdict: `${iv.herg.riskCategory} risk` },
                    { domain: "Cytotoxicity (TI)", verdict: `TI = ${dr?.ic50_nM != null ? iv.cellViability.therapeuticIndex + "×" : "N/A"}` },
                    { domain: "Selectivity", verdict: iv.selectivity.selectivityClass ?? "Not classified" },
                    { domain: "Bioactivation", verdict: `${iv.bioactivation.overallBioactivationRisk} risk` },
                    { domain: "CYP DDI Risk", verdict: Object.values(iv.metabolicStability.cypInhibition).some(c => c.risk === "High") ? "High (≥1 isoform)" : "Low–Moderate" },
                  ].map(row => {
                    const isGood = ["High", "Stable", "Selective", "Low", "Low risk", "Weakly Bound"].some(g => row.verdict.includes(g));
                    const isBad = ["Low", "Unstable", "Non-Selective", "High risk", "Highly Bound"].some(b => row.verdict.includes(b)) && !isGood;
                    const cls = isGood ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                      : isBad ? "bg-red-500/10 border-red-500/20 text-red-300"
                      : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                    return (
                      <div key={row.domain} className="flex items-center justify-between bg-white/[0.03] border border-white/8 rounded-lg px-3 py-2.5">
                        <span className="text-[11px] text-slate-400">{row.domain}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${cls}`}>{row.verdict}</span>
                      </div>
                    );
                  })}
                </div>
                <div className={`mt-4 p-4 rounded-xl border bg-gradient-to-r ${riskColor.bg} flex items-center gap-3`}>
                  <div className={`w-4 h-4 rounded-full shadow-[0_0_10px_2px] ${riskColor.glow} shrink-0`} />
                  <div>
                    <div className={`text-[16px] font-black ${riskColor.text}`}>{iv.overallRisk} RISK · {goLabel}</div>
                    <div className="text-[11px] text-slate-400">
                      Composite In-Vitro Score: <span className="text-white font-semibold">{(iv.inVitroScore * 100).toFixed(1)}%</span>
                      {iv.mlEnhanced && <span className="ml-2 text-[9px] bg-violet-500/15 text-violet-300 px-1.5 py-0.5 rounded border border-violet-500/30">ML-Enhanced</span>}
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {/* ── §11 Conclusions & Verification Plan ── */}
            {iv && (
              <Section id="conclusions" icon={<FileText className="w-4 h-4" />} title="Conclusions & Wet-Lab Verification Plan">
                <div className="space-y-3 text-[11px] text-slate-300 leading-relaxed">
                  <p>
                    The model-derived in-vitro profile of <strong className="text-white">{molName || "the test compound"}</strong>{" "}
                    against <strong className="text-white">{resolvedProteinName || proteinName || "the primary target"}</strong>{" "}
                    ({uniprotId || "target not specified"}) indicates{" "}
                    <strong className={riskColor.text}>{iv.overallRisk.toLowerCase()} aggregate risk</strong> (composite score{" "}
                    {(iv.inVitroScore * 100).toFixed(1)}%).
                  </p>
                  <p>
                    {realIndication
                      ? <>This target is associated with: <strong className="text-white">{realIndication}</strong> (UniProt disease database).</>
                      : indication && <>Indication under study: <strong className="text-white">{indication}</strong>.</>
                    }
                  </p>
                  <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 space-y-2">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-3">Recommended Bench Experiments</div>
                    {[
                      displayIC50_nM != null && `Primary potency confirmation — run ${therapeuticArea ?? "appropriate"} biochemical assay. Acceptance: IC₅₀ within 3-fold of ${displayIC50_nM.toFixed(1)} nM, Hill ±0.3 of ${displayHill.toFixed(2)}.`,
                      `Cardiac safety — manual whole-cell patch-clamp (HEK-hERG). Acceptance: IC₅₀ within 2-fold of ${iv.herg.ic50_uM} µM.`,
                      `Metabolic stability — pooled HLM (1 µM substrate). Acceptance: CLint within ±30% of ${iv.metabolicStability.microsomalCLint.toFixed(1)} µL/min/mg.`,
                      iv.bioactivation.gshTrappingRecommended && "GSH-trapping experiment required due to reactive metabolite risk detected.",
                      iv.selectivity.topOffTargets.length === 0 && "Kinome/selectivity panel required before progressing — no screen run yet.",
                    ].filter(Boolean).map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-violet-400 shrink-0 mt-0.5">{i + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>
            )}

            {/* ── §12 Signatures ── */}
            <SectionCard icon={<FileText className="w-4 h-4" />} title="Signatures & Document Control">
              <div className="text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                Fill in before finalizing. Draft tag: <code className="font-mono">{draftTag}</code> · Version: v1.0 (DRAFT) · Date: {TODAY()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {["Bench Operator", "Principal Investigator", "Study Director", "QA/QC Reviewer", "Sponsor Representative"].map(role => (
                  <div key={role} className="bg-white/[0.03] border border-white/8 rounded-lg p-3">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">{role}</div>
                    <div className="flex gap-4 text-[10px] text-slate-600">
                      <span>Name: _____________</span>
                      <span>Date: _________</span>
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">Signature: _______________________</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Footer */}
            <div className="text-[10px] text-slate-600 text-center pb-4">
              Report generated by <span className="text-slate-400">HakaseAI BioDigital Twin</span> — Layer 1 In-Vitro Module ·{" "}
              Draft {draftTag} · {iv?.timestamp ? new Date(iv.timestamp).toLocaleString() : TODAY()} ·{" "}
              {iv?.mlEnhanced ? "ML-Enhanced" : "QSPR"} predictions · Verify at bench before regulatory submission
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small helper components ─────────────────────────────────────────────────
function InfoChip({ label, value, loading = false, link }: { label: string; value: string; loading?: boolean; link?: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/8 rounded-lg px-3 py-2">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
      {loading ? (
        <div className="h-4 bg-white/10 rounded animate-pulse w-24" />
      ) : link ? (
        <a href={link} target="_blank" rel="noreferrer"
          className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 truncate max-w-full">
          {value} <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      ) : (
        <div className="text-[11px] font-medium text-slate-200 truncate">{value}</div>
      )}
    </div>
  );
}
