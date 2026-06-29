import { useState, useMemo } from "react";
import {
  Microscope, ArrowRight, Database, Shield, Sparkles, AlertCircle, AlertTriangle,
  CircleDot, Play, Activity, Loader2, Copy, Check, Sliders, ChevronDown, ChevronRight,
  FlaskConical, ServerCrash, FileText, Atom, Beaker, UserPen, Trash2, Pencil,
} from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import { deriveBiomarkers } from "@/lib/biomarkerProxy";
import { projectPermeability } from "@/lib/permeabilityProjection";
import type { L2InputParams } from "@/lib/l2DoseProjection";
import {
  computeTissueSelectivityMatrix,
  type TissueSelectivityMatrix,
  type TissueSelectivityRow,
} from "@/lib/tissueSelectivity";
import {
  predictTransporterFlags,
  TRANSPORTER_LABELS,
  type TransporterFlagsResult,
  type TransporterChannel,
} from "@/lib/transporterFlags";
import {
  predictDiliMl, predictCellTypeAggregation, predictProtein, predictPatientLine,
  type DiliMlResult, type PatientLinePrediction, type PatientLineModelInfo,
} from "@/lib/aiService";

interface Layer3ExVivoScaffoldProps {
  layer2Ready: boolean;
  simResults: SimResults | null;
  inVitroResults: InVitroResults | null;
  onContinue: () => void;
}

/* ─── Stage definitions (per Spec v1.1 §3 + §10 + Appendix B) ─────────────── */

type WiredKind = "in-house" | "ml-service" | "external-data";

type StageStatus = "ready" | "running" | "complete" | "error" | "out-of-scope-yet";

type StageDef = {
  n: number;
  name: string;
  detail: string;
  wired: WiredKind;
  engines: { name: string; note: string }[];
  /** Optional reason copy rendered above any manual-entry path; kept optional for future pending stages. */
  pendingReason?: string;
  /** True for stages whose schema also accepts a Manual Entry path (currently 2, 3, 4, 5). Stage 6 is pure orchestration. */
  acceptsManualEntry: boolean;
  /**
   * "data-unavailable" — endpoint exists but required data artifact (Parquet/snapshot) is not yet provisioned.
   *                      Stage is rendered dimmed with a DATA UNAVAILABLE badge.
   * "roadmap"          — stage logic exists but depends on manual entry only; no automated inference yet.
   *                      Stage is rendered with a ROADMAP badge.
   * undefined          — fully operational (S1, S2).
   */
  readinessFlag?: "data-unavailable" | "roadmap";
};

const L3_STAGES: StageDef[] = [
  {
    n: 1, name: "Tissue selectivity + transporter flags", wired: "in-house",
    detail: "Per-tissue exposure margin (54 GTEx organs) using L1 IC50 ÷ predicted Cu (fu × L2 PBPK Cmax) weighted by GTEx target expression. 9-channel transporter substrate / inhibitor QSAR on L1 ADMET descriptors.",
    engines: [
      { name: "lib/tissueSelectivity.ts (in-house)", note: "54-row matrix; PBPK-compartment map for liver/kidney/brain/heart/adipose/gut/muscle/lung" },
      { name: "GTEx Portal v2 REST",                  note: "v8 dataset (v10 not yet at medianGeneExpression endpoint)" },
      { name: "lib/transporterFlags.ts (QSAR)",       note: "BSEP, OAT1/3, OCT2, OATP1B1/3, P-gp, BCRP, MRP2 — Polli/Morgan/Karlgren/Truong/Wittwer/Matsson/El-Sheikh" },
    ],
    acceptsManualEntry: false,
  },
  {
    n: 2, name: "DILI risk classifier (binary) + manual severity", wired: "ml-service",
    detail: "Random Forest on Morgan FP (1024-bit, r=2) + 6 RDKit descriptors, trained on TDC DILI (Xu 2015, n=475, 5-fold CV ROC-AUC ≈ 0.88). ML predicts a binary DILI-risk probability + qualitative class (Low/Moderate/High). The 5-class severity + 4 mechanism flags (mitochondrial / BSEP / ROS / immune) used in the Stage 2 schema are NOT predicted by the binary model — those still require Manual Entry (FDA label or DILIrank lookup). Stage 5 biomarker derivation is gated on Manual Entry being filled (it needs the mechanism flags).",
    engines: [
      { name: "ai-service /predict/dili-ml", note: "Random Forest, sklearn, ~57ms inference, prewarmed at boot" },
      { name: "TDC DILI (Xu et al. 2015)",    note: "475 cmpds curated from FDA label hepatotoxicity sections, CC-BY 4.0" },
      { name: "Manual entry (this build)",    note: "user-asserted DILIrank class + mechanism flags + citation (drives Stage 5)" },
    ],
    acceptsManualEntry: true,
  },
  {
    n: 3, name: "Cell-type aggregation (Drug2cell + Tabula Sapiens)", wired: "ml-service",
    detail: "Drug2cell-pattern scoring over Tabula Sapiens v2 (~480 cell types × 28 organs): score(cell_type, tissue) = Σᵢ wᵢ · mean_log1p_expression(geneᵢ, cell_type, tissue), where wᵢ is the min-max normalized pKi of target_i (or uniform 1.0 when pKi absent). Atlas Parquet preprocessed off-platform via colab_notebooks/prepare_tabula_sapiens.ipynb and loaded by the ai-service on first request — endpoint returns explicit `data-not-provisioned` until the artifact ships. Manual entry remains available for literature-curated IC50 with cited CVCL accession.",
    engines: [
      { name: "ai-service /predict/celltype-aggregation", note: "Drug2cell-pattern weighted aggregation; HTTP 503 + data-not-provisioned when atlas Parquet absent — NO synthetic fallback" },
      { name: "Tabula Sapiens v2 (CELLxGENE Census)",     note: "Aggregated off-platform in Colab → tabula_sapiens_aggregated.parquet (mean log1p expression per cell_type × tissue × gene); pinned by Census SHA" },
      { name: "Manual entry (literature-curated)",        note: "Cellosaurus CVCL accession + published IC50 + citation — Zero-Lab override path, no CRO dependency" },
    ],
    acceptsManualEntry: true,
    readinessFlag: "data-unavailable",
  },
  {
    n: 4, name: "Patient-line projection (oncology only)", wired: "ml-service",
    detail: "Per-cell-line projection of the L1 IC50 across the DepMap PRISM 24Q2 oncology panel, conditioned on per-cell-line target essentiality (Chronos CRISPR) + expression (CCLE log2 TPM). Deterministic in-house formula — predicted_IC50_uM(cell) = L1_IC50_uM × 2^(α · chronos), with `expression < 1.0 log2(TPM+1)` cell lines marked resistant_no_target. NOT a trained Chemprop GBM (the v2 spec pass downgraded that earlier overclaim). Snapshot Parquet preprocessed off-platform via colab_notebooks/prepare_depmap_prism.ipynb and loaded by the ai-service on first request — endpoint returns explicit `data-not-provisioned` until the artifact ships. Manual entry remains available for literature-curated DepMap PRISM IC50 rows (with citation) or to mark a non-oncology compound as not_applicable.",
    engines: [
      { name: "ai-service /predict/patient-line", note: "in-house deterministic projection; HTTP 503 + data-not-provisioned when snapshot Parquet absent — NO synthetic fallback" },
      { name: "DepMap PRISM 24Q2 (Broad)",        note: "Preprocessed off-platform → depmap_prism_aggregated.parquet (per-cell-line target essentiality + expression for the prepared target set); pinned by release tag" },
      { name: "HCMI (NCI / ATCC)",                note: "~700 next-gen cancer models with paired matched-normal genomics — reference catalogue for downstream T2 wet-anchor selection" },
      { name: "Manual entry (this build)",        note: "DepMap accession + literature-curated IC50 rows + citation, OR explicit non-oncology not_applicable" },
    ],
    acceptsManualEntry: true,
    readinessFlag: "data-unavailable",
  },
  {
    n: 5, name: "DILI biomarker proxy + permeability", wired: "in-house",
    detail: "Deterministic mapping from Stage 2 mechanism flags to expected biomarker pattern (mito → GLDH; cholestatic → ALP/bilirubin; hepatocellular → ALT, miR-122; immune → eosinophilia priors). Permeability auto-pulled from L1 Caco-2. Manual override for brain Kp,uu when MDR1-MDCK or PET data is available.",
    engines: [
      { name: "lib/biomarkerProxy.ts",         note: "in-house rule table per spec §3.6 — Antoine 2013 / DILIN / Wang 2009 / Andrade 2019" },
      { name: "lib/permeabilityProjection.ts", note: "L1 Caco-2 surfacing; brain Kp,uu opt-in override (MDR1-MDCK or PET) — no imputed CNS values" },
    ],
    pendingReason: "Auto-runs deterministically once Stage 2 Manual Entry is filled (mechanism flags required). Optional brain Kp,uu override available.",
    acceptsManualEntry: true,
    readinessFlag: "roadmap",
  },
  {
    n: 6, name: "Cascade integration + L2 Ex-Vivo → L3 envelope", wired: "in-house",
    detail: "Pure orchestration over Stages 1–5. Builds the per-readout tier envelope (tier ∈ {t0, t-user, pending, n/a}; cascadeKind ∈ {pass, fail, prediction_only, not_applicable}) consumed by L3 Animal Cohort's Amber Curator. Auto-runs whenever any Stage 1–5 result exists — no data entry, no manual form.",
    engines: [
      { name: "Stage6PerReadout assembly (this file)", note: "inline orchestration — emits Stage6PerReadout[] with per-stage {tier, cascadeKind}; mixed-tier envelopes are normal" },
      { name: "lib/cascadeFlagState.ts → canSignLoadBearing", note: "Amber Curator predicate consumed downstream by L3 — requires cascadeKind:'pass'; t-user / t0 surrogate map to prediction_only" },
    ],
    acceptsManualEntry: false,
    readinessFlag: "roadmap",
  },
];

/* ─── L3 input parameter shape ────────────────────────────────────────────── */

interface L3InputParams {
  l2: L2InputParams;
  ic50_nM_override?: number;
  transporterConfidenceFloor: number;
}

const L3_DEFAULT_PARAMS: L3InputParams = {
  l2: { targetOccupancy: 0.75, bodyWeightKg: 70, route: "oral", dosesPerDay: 1 },
  transporterConfidenceFloor: 0,
};

/* ─── Manual-entry result shapes (each carries source = "user-provided") ──── */

const DILI_SEVERITY_OPTIONS = [
  { value: "none",         label: "None — no DILI signal" },
  { value: "mild",         label: "Mild — vMost-DILI-Concern absent" },
  { value: "moderate",     label: "Moderate — vLess-DILI-Concern" },
  { value: "severe",       label: "Severe — vMost-DILI-Concern" },
  { value: "most-concern", label: "Most-Concern — boxed warning / withdrawn" },
] as const;

type DiliSeverity = typeof DILI_SEVERITY_OPTIONS[number]["value"];

interface Stage2ManualResult {
  kind: "manual";
  source: "user-provided";
  severity: DiliSeverity;
  mechanisms: { mitochondrial: boolean; bsep: boolean; ros: boolean; immune: boolean };
  citation: string;
  enteredAt: string;
}

interface Stage2MlResult {
  kind: "ml";
  source: "ml";
  prediction: DiliMlResult["prediction"];
  modelInfo: DiliMlResult["model_info"];
  enteredAt: string;
}

type Stage2Result = Stage2ManualResult | Stage2MlResult;

interface Stage3ManualResult {
  kind: "manual";
  source: "user-provided";
  organoidCvcl: string;
  measuredIc50_uM: number;
  assayFormat: string;
  citation: string;
  enteredAt: string;
}

interface Stage3MlResult {
  kind: "ml";
  source: "ml";
  prediction: import("../lib/aiService").CellTypeAggregationPrediction;
  modelInfo: import("../lib/aiService").CellTypeAggregationModelInfo;
  enteredAt: string;
}

type Stage3Result = Stage3MlResult | Stage3ManualResult;

interface Stage4ManualRow { depmapId: string; ic50_uM: number; citation: string; }

interface Stage4ManualResult {
  kind: "manual";
  source: "user-provided";
  mode: "oncology-rows" | "non-oncology-na";
  rows: Stage4ManualRow[];
  enteredAt: string;
}

interface Stage4MlResult {
  kind: "ml";
  source: "ml";
  prediction: PatientLinePrediction;
  modelInfo: PatientLineModelInfo;
  enteredAt: string;
}

type Stage4Result = Stage4ManualResult | Stage4MlResult;

interface Stage5BiomarkerEntry { name: string; rationale: string; }

interface Stage5Result {
  /** "derived-from-stage-2" = deterministic mapping; "user-provided" = override or solo entry. */
  source: "derived-from-stage-2" | "user-provided";
  biomarkers: Stage5BiomarkerEntry[];
  brainKpUu_override?: number;
  caco2Papp_x10minus6: number;
  enteredAt: string;
}

type ReadoutTier = "t0" | "t-user" | "pending" | "n/a";

interface Stage6PerReadout {
  stage: number;
  name: string;
  tier: ReadoutTier;
  cascadeKind: "pass" | "fail" | "prediction_only" | "not_applicable";
}

type EnvelopeKind = "mixed" | "all-pending" | "all-t-user" | "all-t0";

interface Stage6Result {
  source: "orchestration";
  perReadoutTiers: Stage6PerReadout[];
  envelopeKind: EnvelopeKind;
  loadBearingCount: number;
  enteredAt: string;
}

/* ─── Reference content (preserved verbatim from prior scaffold) ─────────── */

// Zero-Lab pivot (May 13, 2026): L3 ex-vivo modalities are now the
// computational data substrates that compose the virtual tissue model — NOT
// physical wet-lab modalities. Chip-vendor adapters (Emulate / CN Bio /
// Mimetas) and organoid biobanks (HCMI / HUB / ATCC) have been removed from
// the customer-facing reference card; the customer pipeline does not depend
// on any wet-lab data ingestion.
const L3_MODALITIES = [
  {
    name: "Tissue-expression baseline (GTEx Portal v2)",
    summary: "54-organ median TPM expression matrix — per-tissue exposure margins computed from L1 IC50 ÷ predicted Cu, weighted by GTEx target expression.",
    sources: [
      { name: "GTEx Portal v2 REST",     note: "v8 dataset (v10 not yet at medianGeneExpression endpoint) — pinned, license CC-BY" },
      { name: "lib/gtexClient.ts",       note: "UBERON ↔ 2-compartment-PBPK mapping; returns null for tissues without a compartment" },
    ],
  },
  {
    name: "Cell-type atlas (Tabula Sapiens v2)",
    summary: "~480 cell types × 28 organs — Drug2cell-pattern scoring against frozen mean-log1p expression per (cell_type, tissue, gene).",
    sources: [
      { name: "Tabula Sapiens v2 (CELLxGENE Census)", note: "Aggregated off-platform → tabula_sapiens_aggregated.parquet; pinned by Census SHA" },
      { name: "ai-service /predict/celltype-aggregation", note: "Drug2cell-pattern weighted aggregation; HTTP 503 + data-not-provisioned when atlas Parquet absent — NO synthetic fallback" },
    ],
  },
  {
    name: "Patient-line projection (DepMap PRISM 24Q2)",
    summary: "Per-cell-line oncology projection conditioned on Chronos CRISPR essentiality + CCLE log2 TPM expression — deterministic in-house projection of the L1 IC50 across the panel.",
    sources: [
      { name: "DepMap PRISM 24Q2 (Broad)", note: "Preprocessed off-platform → depmap_prism_aggregated.parquet; pinned by release tag" },
      { name: "ai-service /predict/patient-line", note: "in-house deterministic projection; HTTP 503 + data-not-provisioned when snapshot Parquet absent — NO synthetic fallback" },
    ],
  },
  {
    name: "Literature-curated override (manual-entry path)",
    summary: "Optional Zero-Lab override: paste a published IC50 with a Cellosaurus CVCL accession + citation. Promotes the row tier to 'literature-curated' (t-user) in the cascade gate.",
    sources: [
      { name: "Cellosaurus", note: "~5K entries, CC-BY 4.0 — every override row carries a CVCL accession + cite" },
    ],
  },
] as const;

/* ─── Visual helpers (mirror L2 scaffold pattern, teal accent) ───────────── */

function wiredBadge(w: WiredKind): { text: string; cls: string } {
  switch (w) {
    case "in-house":
      return { text: "in-house", cls: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" };
    case "ml-service":
      return { text: "ai-service", cls: "border-violet-500/30 bg-violet-500/8 text-violet-300" };
    case "external-data":
      return { text: "external data", cls: "border-cyan-500/30 bg-cyan-500/8 text-cyan-300" };
  }
}

function statusBadgeClass(s: StageStatus): string {
  switch (s) {
    case "complete": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "running":  return "border-violet-500/40 bg-violet-500/10 text-violet-300";
    case "error":    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "out-of-scope-yet": return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "ready":    return "border-white/10 bg-white/[0.02] text-slate-400";
  }
}

function tierBadgeClass(t: ReadoutTier): string {
  switch (t) {
    case "t0":      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "t-user":  return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
    case "pending": return "border-slate-500/30 bg-slate-500/10 text-slate-400";
    case "n/a":     return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
}

function L1OutputRow({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5">
      <div className="flex flex-col">
        <span className="text-[11px] text-slate-300">{label}</span>
        {source && <span className="text-[9px] text-slate-600 uppercase tracking-wider">{source}</span>}
      </div>
      <span className={value === "—" ? "text-slate-600 text-[11px] font-mono" : "text-teal-300 text-[11px] font-mono"}>{value}</span>
    </div>
  );
}

function ReadinessBadge({ flag }: { flag: StageDef["readinessFlag"] }) {
  if (!flag) return null;
  const isUnavailable = flag === "data-unavailable";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border ${
      isUnavailable
        ? "bg-rose-500/12 text-rose-400 border-rose-500/30"
        : "bg-amber-500/12 text-amber-400 border-amber-500/30"
    }`}>
      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
      {isUnavailable ? "Data unavailable" : "Roadmap"}
    </span>
  );
}

function StageCard({
  stage, status, busy, hasResult, onRun, runDisabled, runDisabledReason, errorReason, children,
}: {
  stage: StageDef;
  status: StageStatus;
  busy: boolean;
  hasResult: boolean;
  onRun: () => void;
  runDisabled: boolean;
  runDisabledReason?: string;
  errorReason?: string;
  children?: React.ReactNode;
}) {
  const wb = wiredBadge(stage.wired);
  const canAutoRun = stage.wired === "in-house" || stage.wired === "ml-service";
  const dimmed = stage.readinessFlag != null;
  return (
    <div className={`rounded-lg border p-3 ${dimmed ? "border-white/5 bg-white/[0.01] opacity-75" : "border-white/8 bg-white/[0.02]"}`}>
      {stage.readinessFlag === "data-unavailable" && (
        <div className="flex items-center gap-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 mb-2.5">
          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
          <p className="text-[10px] text-rose-300/80 leading-snug">
            Required data artifact (Parquet) is not yet provisioned. This stage will show real results once the data pipeline is deployed. Manual entry is available in the interim.
          </p>
        </div>
      )}
      {stage.readinessFlag === "roadmap" && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 mb-2.5">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-300/80 leading-snug">
            Automated inference not yet implemented. Manual entry only — enter literature-curated values to populate this stage.
          </p>
        </div>
      )}
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`w-6 h-6 rounded-md border text-[11px] font-semibold flex items-center justify-center shrink-0 ${dimmed ? "bg-slate-500/10 border-slate-500/25 text-slate-400" : "bg-teal-500/10 border-teal-500/25 text-teal-300"}`}>
          {stage.n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-semibold text-white">Stage {stage.n} — {stage.name}</div>
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${wb.cls}`}>{wb.text}</span>
            <ReadinessBadge flag={stage.readinessFlag} />
            {hasResult && (
              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadgeClass(status)}`}>{status}</span>
            )}
          </div>
          <details className="mt-0.5 group">
            <summary className="cursor-pointer list-none text-[10px] text-slate-500 hover:text-slate-300 select-none inline-flex items-center gap-1">
              <span className="text-slate-600 group-open:rotate-90 transition-transform inline-block w-2">▸</span>
              <span>What this stage does &amp; toolchain</span>
            </summary>
            <div className="text-[10px] text-slate-500 leading-relaxed mt-1.5">{stage.detail}</div>
            <div className="space-y-1 mt-1.5">
              {stage.engines.map(e => (
                <div key={e.name} className="flex items-baseline gap-2 text-[10px]">
                  <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
                  <span className="text-slate-300 font-medium">{e.name}</span>
                  {e.note && <span className="text-slate-500">— {e.note}</span>}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      {canAutoRun && (
        <div className="pl-8 mt-2.5 flex items-center gap-2">
          <button
            type="button"
            disabled={runDisabled || busy}
            onClick={onRun}
            title={runDisabled ? runDisabledReason : `Run Stage ${stage.n}`}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
              !runDisabled && !busy
                ? "bg-teal-600/30 hover:bg-teal-500/40 text-teal-200 border border-teal-500/40 cursor-pointer"
                : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
            }`}
          >
            {busy
              ? <><Loader2 className="w-3 h-3 animate-spin" />Running…</>
              : <><Play className="w-3 h-3" />Run stage</>}
          </button>
          {runDisabled && runDisabledReason && (
            <span className="text-[9px] text-slate-500 italic">{runDisabledReason}</span>
          )}
          {!runDisabled && status === "error" && errorReason && (
            <span className="text-[9px] text-rose-300 italic leading-snug" title={errorReason}>
              {errorReason.length > 140 ? errorReason.slice(0, 140) + "…" : errorReason}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function ResultShell({ stage, name, icon: Icon, status, reason, children }: {
  stage: number; name: string; icon: any;
  status: StageStatus; reason?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-teal-300" />
        <h3 className="text-[13px] font-semibold text-white">Stage {stage} — {name}</h3>
        <span className={`ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${statusBadgeClass(status)}`}>{status}</span>
      </div>
      {reason && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/8 p-2.5 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-teal-200 leading-relaxed">{reason}</span>
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── L3 input parameters card (mirrors L2) ──────────────────────────────── */

function L3InputParamsCard({
  params, setParams, simResults,
}: { params: L3InputParams; setParams: (p: L3InputParams) => void; simResults: SimResults | null }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const occ = params.l2.targetOccupancy ?? 0.75;
  const bw  = params.l2.bodyWeightKg ?? 70;
  const route = params.l2.route ?? "oral";
  const dpd = params.l2.dosesPerDay ?? 1;
  const tcf = params.transporterConfidenceFloor;
  const ic50_nM = simResults?.binding?.primaryIC50;
  return (
    <section className="rounded-xl border border-teal-500/25 bg-teal-500/[0.04] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sliders className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-widest">L2 Virtual-Tissue Input Parameters</span>
        <span className="ml-auto text-[9px] text-slate-500 italic">applied to Stage 1 (L2 chain auto-rerun)</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300">Target receptor occupancy (drives L2 dose → tissue Cu)</span>
          <span className="text-teal-300 font-mono">{(occ * 100).toFixed(0)}% (Cmax,u = {(occ / Math.max(1e-3, 1 - occ)).toFixed(2)}× Ki)</span>
        </div>
        <input
          type="range" min={0.5} max={0.95} step={0.05} value={occ}
          onChange={e => setParams({ ...params, l2: { ...params.l2, targetOccupancy: parseFloat(e.target.value) } })}
          className="w-full accent-teal-400"
        />
        <div className="flex justify-between text-[9px] text-slate-600">
          <span>50% (1×Ki)</span><span>75% (3×Ki)</span><span>95% (19×Ki)</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Body weight (kg)</span>
          <input
            type="number" min={1} max={250} step={1} value={bw}
            onChange={e => setParams({ ...params, l2: { ...params.l2, bodyWeightKg: parseFloat(e.target.value) } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-teal-200 font-mono focus:outline-none focus:border-teal-500/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Route</span>
          <select
            value={route}
            onChange={e => setParams({ ...params, l2: { ...params.l2, route: e.target.value as "oral" | "iv" } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-teal-200 focus:outline-none focus:border-teal-500/50"
          >
            <option value="oral">Oral (PO)</option>
            <option value="iv">IV (F=1)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Dosing freq.</span>
          <select
            value={dpd}
            onChange={e => setParams({ ...params, l2: { ...params.l2, dosesPerDay: parseInt(e.target.value, 10) } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-teal-200 focus:outline-none focus:border-teal-500/50"
          >
            <option value={1}>QD (1×)</option>
            <option value={2}>BID (2×)</option>
            <option value={3}>TID (3×)</option>
            <option value={4}>QID (4×)</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Transporter conf. floor</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={0.9} step={0.05} value={tcf}
              onChange={e => setParams({ ...params, transporterConfidenceFloor: parseFloat(e.target.value) })}
              className="flex-1 accent-teal-400"
            />
            <span className="text-teal-300 font-mono text-[11px] w-10 text-right">{tcf.toFixed(2)}</span>
          </div>
          <span className="text-[9px] text-slate-600 italic">flags below this confidence are suppressed (still computed)</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">GTEx dataset</span>
          <input
            type="text" value="gtex_v8 (v10 not yet on REST endpoint)" readOnly
            className="bg-white/[0.02] border border-white/10 rounded-md px-2 py-1 text-[11px] text-slate-400 font-mono italic cursor-not-allowed"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="text-[10px] text-slate-400 hover:text-slate-300 flex items-center gap-1"
      >
        {advancedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced overrides (bypass L1 / L2 — clear to revert)
      </button>
      {advancedOpen && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">IC50 (nM) — bypass L1</span>
            <input
              type="number" min={0} step="any"
              value={params.ic50_nM_override ?? ""}
              placeholder={ic50_nM ? `L1: ${ic50_nM.toFixed(1)} nM` : "use L1 IC50"}
              onChange={e => {
                const v = e.target.value;
                setParams({ ...params, ic50_nM_override: v === "" ? undefined : parseFloat(v) });
              }}
              className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-teal-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-teal-500/50"
            />
          </label>
          {[
            { k: "fuOverride" as const, label: "fu (0–1)",         hint: "L1 plasma protein binding" },
            { k: "VdOverride" as const, label: "Vd (L/kg)",        hint: "logP-binned proxy" },
            { k: "FOverride"  as const, label: "F oral (0–1)",     hint: "Caco-2 → F bins (Yee 1997)" },
            { k: "CLOverride" as const, label: "CL (mL/min/kg)",   hint: "well-stirred liver model" },
          ].map(({ k, label, hint }) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{label} (L2)</span>
              <input
                type="number" min={0} step="any"
                value={params.l2[k] ?? ""}
                placeholder={`use ${hint}`}
                onChange={e => {
                  const v = e.target.value;
                  setParams({ ...params, l2: { ...params.l2, [k]: v === "" ? undefined : parseFloat(v) } });
                }}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-teal-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-teal-500/50"
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Per-stage "what does the ML radio mean here?" labels ────────────────── */

function mlLabelForStage(n: number): string {
  switch (n) {
    case 2: return "ML model · ai-service (DILI binary classifier)";
    case 3: return "ML model · ai-service (Drug2cell + Tabula Sapiens)";
    case 4: return "ML model · ai-service (DepMap PRISM 24Q2 patient-line projection)";
    case 5: return "Auto-derive · in-house rule table (needs Stage 2 mechanisms)";
    default: return "ML model";
  }
}

/* ─── Manual-entry form components ────────────────────────────────────────── */

function ManualToggle({
  enabled, setEnabled, hasResult, onClear, mlLabel = "ML model (not yet wired)",
}: { enabled: boolean; setEnabled: (v: boolean) => void; hasResult: boolean; onClear: () => void; mlLabel?: string; }) {
  return (
    <div className="pl-8 mt-2.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-slate-500 uppercase tracking-wider">Source:</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={!enabled} onChange={() => setEnabled(false)} className="accent-teal-400" />
          <span className={!enabled ? "text-teal-300" : "text-slate-500"}>{mlLabel}</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={enabled} onChange={() => setEnabled(true)} className="accent-teal-400" />
          <span className={enabled ? "text-teal-300" : "text-slate-500"}>Manual entry</span>
        </label>
      </div>
      {hasResult && (
        <button
          type="button" onClick={onClear}
          className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-rose-500/30 bg-rose-500/8 text-rose-300/80 hover:bg-rose-500/15 flex items-center gap-1"
        >
          <Trash2 className="w-2.5 h-2.5" /> Clear
        </button>
      )}
    </div>
  );
}

function Stage2ManualForm({ onSave }: { onSave: (r: Stage2ManualResult) => void }) {
  const [severity, setSeverity] = useState<DiliSeverity>("moderate");
  const [mech, setMech] = useState({ mitochondrial: false, bsep: false, ros: false, immune: false });
  const [citation, setCitation] = useState("");
  const valid = citation.trim().length >= 3;
  return (
    <div className="pl-8 mt-2.5 space-y-2 rounded-md border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <UserPen className="w-3 h-3" /> Manual entry · tagged source: user-provided
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">DILI severity (FDA / DILIrank class)</span>
        <select
          value={severity} onChange={e => setSeverity(e.target.value as DiliSeverity)}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-500/50"
        >
          {DILI_SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        {([
          ["mitochondrial", "Mitochondrial damage"],
          ["bsep", "BSEP inhibition / cholestatic"],
          ["ros", "ROS / oxidative stress"],
          ["immune", "Immune-mediated"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
            <input
              type="checkbox" checked={mech[k]}
              onChange={e => setMech({ ...mech, [k]: e.target.checked })}
              className="accent-cyan-400"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Citation (FDA label / DOI / PMID)</span>
        <input
          type="text" value={citation} onChange={e => setCitation(e.target.value)}
          placeholder="e.g. NDA 21-879 prescribing info §5.2; or PMID:31784823"
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-cyan-500/50"
        />
      </label>
      <button
        type="button" disabled={!valid}
        onClick={() => onSave({ kind: "manual", source: "user-provided", severity, mechanisms: mech, citation: citation.trim(), enteredAt: new Date().toISOString() })}
        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
          valid
            ? "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 cursor-pointer"
            : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
        }`}
        title={valid ? "Save user-provided DILI assessment" : "Enter a citation (≥3 chars) before saving"}
      >
        <Check className="w-3 h-3" /> Save manual entry
      </button>
    </div>
  );
}

function Stage3ManualForm({ onSave }: { onSave: (r: Stage3ManualResult) => void }) {
  const [cvcl, setCvcl] = useState("");
  const [ic50, setIc50] = useState<string>("");
  const [assay, setAssay] = useState("Literature-curated IC50 (publication assay format)");
  const [citation, setCitation] = useState("");
  const ic50num = parseFloat(ic50);
  const valid = cvcl.match(/^CVCL_[A-Z0-9]{4}$/i) !== null && isFinite(ic50num) && ic50num > 0 && citation.trim().length >= 3;
  return (
    <div className="pl-8 mt-2.5 space-y-2 rounded-md border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <UserPen className="w-3 h-3" /> Manual entry · literature-curated path
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Cellosaurus CVCL</span>
          <input
            type="text" value={cvcl} onChange={e => setCvcl(e.target.value.trim())}
            placeholder="CVCL_xxxx"
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Published IC50 (µM)</span>
          <input
            type="number" min={0} step="any" value={ic50} onChange={e => setIc50(e.target.value)}
            placeholder="e.g. 0.42"
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Assay format</span>
        <input
          type="text" value={assay} onChange={e => setAssay(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Citation (DOI / PMID)</span>
        <input
          type="text" value={citation} onChange={e => setCitation(e.target.value)}
          placeholder="e.g. Charles River report CR-2025-0421; or PMID:33175020"
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
        />
      </label>
      <button
        type="button" disabled={!valid}
        onClick={() => onSave({
          kind: "manual", source: "user-provided", organoidCvcl: cvcl.toUpperCase(), measuredIc50_uM: ic50num,
          assayFormat: assay.trim(), citation: citation.trim(), enteredAt: new Date().toISOString(),
        })}
        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
          valid
            ? "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 cursor-pointer"
            : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
        }`}
        title={valid ? "Save literature-curated entry" : "Need valid CVCL_ accession, positive IC50, and citation"}
      >
        <Check className="w-3 h-3" /> Save literature-curated entry
      </button>
    </div>
  );
}

function Stage4ManualForm({ onSave }: { onSave: (r: Stage4ManualResult) => void }) {
  const [mode, setMode] = useState<"oncology-rows" | "non-oncology-na">("oncology-rows");
  const [rows, setRows] = useState<Stage4ManualRow[]>([{ depmapId: "", ic50_uM: NaN, citation: "" }]);
  const validRows = rows.filter(r => /^ACH-\d{6}$/i.test(r.depmapId) && isFinite(r.ic50_uM) && r.ic50_uM > 0 && r.citation.trim().length >= 3);
  const valid = mode === "non-oncology-na" || validRows.length > 0;
  return (
    <div className="pl-8 mt-2.5 space-y-2 rounded-md border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <UserPen className="w-3 h-3" /> Manual entry · DepMap PRISM rows or non-oncology N/A
      </div>
      <div className="flex items-center gap-3 text-[10px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === "oncology-rows"} onChange={() => setMode("oncology-rows")} className="accent-cyan-400" />
          <span className={mode === "oncology-rows" ? "text-cyan-300" : "text-slate-500"}>Oncology — paste cell-line IC50 rows</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === "non-oncology-na"} onChange={() => setMode("non-oncology-na")} className="accent-cyan-400" />
          <span className={mode === "non-oncology-na" ? "text-cyan-300" : "text-slate-500"}>Non-oncology — mark not_applicable</span>
        </label>
      </div>
      {mode === "oncology-rows" && (
        <>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[110px_80px_1fr_24px] gap-1.5 items-center">
                <input
                  type="text" value={r.depmapId} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, depmapId: e.target.value.trim() } : x))}
                  placeholder="ACH-000001"
                  className="bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
                <input
                  type="number" min={0} step="any" value={isFinite(r.ic50_uM) ? r.ic50_uM : ""}
                  onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, ic50_uM: parseFloat(e.target.value) } : x))}
                  placeholder="µM"
                  className="bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
                <input
                  type="text" value={r.citation} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, citation: e.target.value } : x))}
                  placeholder="DepMap PRISM 24Q2 / DOI / PMID"
                  className="bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="text-rose-400/70 hover:text-rose-300"
                  title="Remove row"
                ><Trash2 className="w-3 h-3 mx-auto" /></button>
              </div>
            ))}
          </div>
          <button
            type="button" onClick={() => setRows([...rows, { depmapId: "", ic50_uM: NaN, citation: "" }])}
            className="text-[10px] text-cyan-300/70 hover:text-cyan-200 flex items-center gap-1"
          >+ Add cell-line row</button>
          <div className="text-[9px] text-slate-500">{validRows.length} of {rows.length} rows valid (need ACH-NNNNNN + positive IC50 + citation).</div>
        </>
      )}
      {mode === "non-oncology-na" && (
        <div className="text-[10px] text-teal-200/80 italic leading-relaxed">
          Non-oncology compound — patient-line projection is out of domain by design (HCMI + DepMap PRISM are oncology-only).
          This readout will be marked <span className="font-mono">kind: "not_applicable"</span> in the cascade envelope.
        </div>
      )}
      <button
        type="button" disabled={!valid}
        onClick={() => onSave({
          kind: "manual",
          source: "user-provided", mode,
          rows: mode === "oncology-rows" ? validRows.map(r => ({ ...r, depmapId: r.depmapId.toUpperCase() })) : [],
          enteredAt: new Date().toISOString(),
        })}
        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
          valid
            ? "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 cursor-pointer"
            : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
        }`}
      >
        <Check className="w-3 h-3" /> Save{mode === "non-oncology-na" ? " not_applicable" : ` ${validRows.length} row${validRows.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

function Stage5OverrideForm({ onSave, currentBrainKpUu }: { onSave: (brainKpUu: number | undefined) => void; currentBrainKpUu?: number }) {
  const [val, setVal] = useState<string>(currentBrainKpUu !== undefined ? String(currentBrainKpUu) : "");
  const num = parseFloat(val);
  const valid = val === "" || (isFinite(num) && num >= 0);
  return (
    <div className="pl-8 mt-2.5 space-y-2 rounded-md border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <UserPen className="w-3 h-3" /> Optional override · brain Kp,uu (literature-curated)
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Brain Kp,uu (unitless, MDR1-MDCK ER or PET)</span>
        <input
          type="number" min={0} step="any" value={val} onChange={e => setVal(e.target.value)}
          placeholder="leave blank to mark as not-cited"
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
        />
      </label>
      <button
        type="button" disabled={!valid}
        onClick={() => onSave(val === "" ? undefined : num)}
        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
          valid ? "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 cursor-pointer"
                : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
        }`}
      >
        <Check className="w-3 h-3" /> Save override
      </button>
    </div>
  );
}

/* ─── Stage-1 result rendering helpers (unchanged) ───────────────────────── */

function ConfidencePill({ c }: { c: "high" | "medium" | "low" }) {
  const styles = c === "high"
    ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
    : c === "medium"
    ? "border-amber-500/30 bg-amber-500/8 text-amber-300"
    : "border-rose-500/30 bg-rose-500/8 text-rose-300";
  return <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${styles}`}>{c}</span>;
}

function MarginCell({ ratio }: { ratio: number }) {
  const isSafe = ratio >= 30;
  const isCaution = ratio >= 10 && ratio < 30;
  const cls = isSafe ? "text-emerald-300" : isCaution ? "text-amber-300" : "text-rose-300";
  return <span className={`font-mono ${cls}`}>{ratio < 0.01 ? ratio.toExponential(1) : ratio.toFixed(2)}×</span>;
}

function CascadeBlock({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const s = matrix.cascadeState;
  if (s.kind !== "prediction_only") return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <div className="text-[11px] font-semibold text-amber-300">Cascade flag · prediction_only</div>
      </div>
      <p className="text-[10px] text-slate-300 leading-relaxed">{s.uiBanner}</p>
      <div className="text-[10px] text-slate-400 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <div><span className="text-slate-500">Method:</span> {s.method}</div>
        <div><span className="text-slate-500">Applicability:</span> {s.applicabilityDomain.inDomain ? "in domain" : "out of domain"} (score {s.applicabilityDomain.score.toFixed(2)})</div>
        <div className="col-span-2">
          <span className="text-slate-500">Fold-error band:</span>{" "}
          {s.foldError.cohortN > 0
            ? `median ${s.foldError.median.toFixed(2)}× / p90 ${s.foldError.p90.toFixed(2)}× (n=${s.foldError.cohortN})`
            : "not yet calibrated (literature pair set pending — ≥30 cited pairs)"}
        </div>
      </div>
    </div>
  );
}

function TissueMatrixBlock({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const [showAll, setShowAll] = useState(false);
  const sortedRows = [...matrix.rows].sort((a, b) => b.onTargetScore - a.onTargetScore);
  const visible = showAll ? sortedRows : sortedRows.slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-slate-400 leading-relaxed space-y-1">
        <div>
          <span className="text-slate-500">Provenance:</span>{" "}
          gene <span className="text-teal-300">{matrix.geneSymbol}</span> ·{" "}
          dataset <span className="text-teal-300">{matrix.gtexDatasetId}</span> ·{" "}
          IC50 <span className="text-teal-300">{matrix.ic50_uM.toFixed(4)} µM</span> ·{" "}
          Cu_plasma <span className="text-teal-300">{matrix.Cu_plasma_uM.toFixed(4)} µM</span> ·{" "}
          Cmax_total <span className="text-teal-300">{matrix.cmax_total_uM.toFixed(3)} µM</span>
        </div>
        <div className="text-amber-300/90">
          ⚠ Cu_tissue ≈ Cu_plasma assumed (Rowland-Tözer steady-state). Per-organ PBPK
          compartments not yet wired — confidence column reflects this.
        </div>
      </div>
      <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
        <div className="grid grid-cols-[1fr_70px_70px_70px_70px_56px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
          <div>Tissue</div>
          <div className="text-right">TPM</div>
          <div className="text-right">Cu (µM)</div>
          <div className="text-right">Margin</div>
          <div className="text-right">On-target</div>
          <div className="text-center">Conf</div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {visible.map(r => (
            <div
              key={r.tissueId}
              className="grid grid-cols-[1fr_70px_70px_70px_70px_56px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]"
              title={r.rationale}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-200 truncate">{r.tissueName}</span>
                {r.pbpkCompartment && (
                  <span className="text-[8px] uppercase text-emerald-400/70 shrink-0">PBPK</span>
                )}
              </div>
              <div className="text-right font-mono text-slate-300">{r.targetExpressionTpm.toFixed(2)}</div>
              <div className="text-right font-mono text-slate-400">{r.predictedCu_uM.toExponential(1)}</div>
              <div className="text-right"><MarginCell ratio={r.marginRatio} /></div>
              <div className="text-right font-mono text-teal-300">{r.onTargetScore.toFixed(3)}</div>
              <div className="flex justify-center"><ConfidencePill c={r.confidence} /></div>
            </div>
          ))}
        </div>
      </div>
      {sortedRows.length > 12 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="w-full text-center text-[10px] text-slate-400 hover:text-teal-300 py-1"
        >
          {showAll ? "Collapse" : `Show all ${sortedRows.length} tissues`}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md border border-teal-500/20 bg-teal-500/5 p-2">
          <div className="text-teal-300 uppercase tracking-wider font-semibold mb-1">Top on-target tissues</div>
          {matrix.topOnTargetTissues.map((r: TissueSelectivityRow) => (
            <div key={r.tissueId} className="flex justify-between text-slate-300">
              <span>{r.tissueName}</span>
              <span className="font-mono">{r.onTargetScore.toFixed(3)}</span>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2">
          <div className="text-rose-300 uppercase tracking-wider font-semibold mb-1">Tightest safety margins</div>
          {matrix.highestRiskMarginTissues.map((r: TissueSelectivityRow) => (
            <div key={r.tissueId} className="flex justify-between text-slate-300">
              <span>{r.tissueName}</span>
              <span className="font-mono"><MarginCell ratio={r.marginRatio} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TransporterFlagsBlock({ flags, floor }: { flags: TransporterFlagsResult; floor: number }) {
  const channels = Object.keys(TRANSPORTER_LABELS) as TransporterChannel[];
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400">
        QSAR · {flags.qsarVersion} · descriptors MW {flags.inputs.mw.toFixed(1)} ·
        logP {flags.inputs.logP.toFixed(2)} · TPSA {flags.inputs.tpsa.toFixed(1)} ·
        HBD {flags.inputs.hbd} · HBA {flags.inputs.hba}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {channels.map(ch => {
          const f = flags[ch];
          const meta = TRANSPORTER_LABELS[ch];
          const suppressed = f.confidence < floor;
          return (
            <div
              key={ch}
              className={`rounded-md border p-2 ${suppressed ? "border-white/5 bg-white/[0.01] opacity-50" : "border-white/8 bg-black/30"}`}
              title={f.rationale}
            >
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="text-[11px] font-semibold text-white">{meta.label}</div>
                  <div className="text-[9px] text-slate-500">{meta.site}</div>
                </div>
                <div className="flex gap-1.5">
                  {suppressed
                    ? <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-slate-500">below conf. floor</span>
                    : <>
                        {f.substrate && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-teal-500/40 bg-teal-500/10 text-teal-300">substrate</span>
                        )}
                        {f.inhibitor && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-300">inhibitor</span>
                        )}
                        {!f.substrate && !f.inhibitor && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-slate-500">no flag</span>
                        )}
                      </>}
                  <span className="text-[9px] font-mono text-slate-400">conf {f.confidence.toFixed(2)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Stage 5 deterministic mapping (per Spec v1.1 §3.6) ──────────────────── */

function deriveStage5FromStage2(
  s2: Stage2ManualResult,
  l1: InVitroResults,
  brainKpUu_override?: number,
): Stage5Result {
  const biomarkers = deriveBiomarkers(s2.mechanisms);
  const perm = projectPermeability(l1, brainKpUu_override);
  return {
    source: brainKpUu_override !== undefined ? "user-provided" : "derived-from-stage-2",
    biomarkers,
    brainKpUu_override: perm.brainKpUu_override,
    caco2Papp_x10minus6: perm.caco2Papp_x10minus6,
    enteredAt: new Date().toISOString(),
  };
}

/* ─── Main scaffold ────────────────────────────────────────────────────────── */

interface Stage1Result {
  matrix: TissueSelectivityMatrix;
  transporters: TransporterFlagsResult;
}

type StageResultBlock<V> =
  | { status: "running" }
  | { status: "complete"; result: V }
  | { status: "error"; reason: string }
  | { status: "out-of-scope-yet"; reason: string };

interface PipelineResults {
  s1?: StageResultBlock<Stage1Result>;
  s2?: StageResultBlock<Stage2Result>;
  s3?: StageResultBlock<Stage3Result>;
  s4?: StageResultBlock<Stage4Result>;
  s5?: StageResultBlock<Stage5Result>;
  s6?: StageResultBlock<Stage6Result>;
}

function buildStage6Envelope(results: PipelineResults): Stage6Result {
  const tiers: Stage6PerReadout[] = [];

  if (results.s1?.status === "complete") {
    tiers.push({ stage: 1, name: "Tissue selectivity + transporter flags", tier: "t0", cascadeKind: results.s1.result.matrix.cascadeState.kind });
  } else {
    tiers.push({ stage: 1, name: "Tissue selectivity + transporter flags", tier: "pending", cascadeKind: "not_applicable" });
  }

  // Stage 2: ML → t0 (in-silico surrogate); Manual → t-user (user literature-curated path).
  // If both saved (user ran ML then also filled manual), manual wins for tier
  // because severity + mechanism are the load-bearing assertions.
  const def2 = L3_STAGES.find(s => s.n === 2)!;
  const s2 = results.s2;
  if (s2?.status === "complete") {
    const tier: ReadoutTier = s2.result.kind === "manual" ? "t-user" : "t0";
    tiers.push({ stage: 2, name: def2.name, tier, cascadeKind: "prediction_only" });
  } else {
    tiers.push({ stage: 2, name: def2.name, tier: "pending", cascadeKind: "not_applicable" });
  }

  // Stage 3: ML (Drug2cell + Tabula Sapiens) → t0; Manual literature-curated IC50 → t-user.
  // If both saved, manual wins for tier (literature-curated > predicted).
  const def3 = L3_STAGES.find(s => s.n === 3)!;
  const s3 = results.s3;
  if (s3?.status === "complete") {
    const tier: ReadoutTier = s3.result.kind === "manual" ? "t-user" : "t0";
    tiers.push({ stage: 3, name: def3.name, tier, cascadeKind: "prediction_only" });
  } else {
    tiers.push({ stage: 3, name: def3.name, tier: "pending", cascadeKind: "not_applicable" });
  }

  // Stage 4: ML projection → t0; Manual oncology rows → t-user; Manual non-oncology N/A → n/a.
  const s4 = results.s4;
  const def4 = L3_STAGES.find(s => s.n === 4)!;
  if (s4?.status === "complete") {
    if (s4.result.kind === "ml") {
      tiers.push({ stage: 4, name: def4.name, tier: "t0", cascadeKind: "prediction_only" });
    } else if (s4.result.mode === "non-oncology-na") {
      tiers.push({ stage: 4, name: def4.name, tier: "n/a", cascadeKind: "not_applicable" });
    } else {
      tiers.push({ stage: 4, name: def4.name, tier: "t-user", cascadeKind: "prediction_only" });
    }
  } else {
    tiers.push({ stage: 4, name: def4.name, tier: "pending", cascadeKind: "not_applicable" });
  }

  // Stage 5
  const def5 = L3_STAGES.find(s => s.n === 5)!;
  if (results.s5?.status === "complete") {
    const tier: ReadoutTier = results.s5.result.source === "derived-from-stage-2" ? "t0" : "t-user";
    tiers.push({ stage: 5, name: def5.name, tier, cascadeKind: "prediction_only" });
  } else {
    tiers.push({ stage: 5, name: def5.name, tier: "pending", cascadeKind: "not_applicable" });
  }

  const completed = tiers.filter(t => t.tier !== "pending");
  let envelopeKind: EnvelopeKind;
  if (completed.length === 0) envelopeKind = "all-pending";
  else if (completed.every(t => t.tier === "t-user" || t.tier === "n/a")) envelopeKind = "all-t-user";
  else if (completed.every(t => t.tier === "t0" || t.tier === "n/a")) envelopeKind = "all-t0";
  else envelopeKind = "mixed";

  return {
    source: "orchestration",
    perReadoutTiers: tiers,
    envelopeKind,
    loadBearingCount: 0, // none — every L3 readout is prediction_only or not_applicable; canSignLoadBearing only accepts kind:"pass"
    enteredAt: new Date().toISOString(),
  };
}

export function Layer3ExVivoScaffold({
  layer2Ready,
  simResults,
  inVitroResults,
  onContinue,
}: Layer3ExVivoScaffoldProps) {
  const hasL1 = !!simResults && !!inVitroResults;
  const [params, setParams] = useState<L3InputParams>(L3_DEFAULT_PARAMS);
  const [results, setResults] = useState<PipelineResults>({});
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualMode, setManualMode] = useState<{ s2: boolean; s3: boolean; s4: boolean; s5: boolean }>({
    s2: false, s3: false, s4: false, s5: false,
  });

  const wiredCount = useMemo(() => L3_STAGES.filter(s => s.wired === "in-house" || s.wired === "ml-service").length, []);
  const acceptsManualCount = useMemo(() => L3_STAGES.filter(s => s.acceptsManualEntry).length, []);

  const setOne = <K extends keyof PipelineResults>(key: K, value: PipelineResults[K]) => {
    setResults(prev => ({ ...prev, [key]: value }));
  };

  const runStage1 = async () => {
    if (!simResults || !inVitroResults) return;
    setBusyStage(1);
    setOne("s1", { status: "running" });
    try {
      const transporters = predictTransporterFlags(simResults.lipinski);
      // Override flow: only allowed when the base simResults already has a
      // BindingEstimate (override mutates one field, not constructs ex
      // nihilo). When binding is null, the override path is unreachable —
      // the runStage1 button should be disabled upstream by the
      // `simResults.binding == null` branch in the dose-validation effect.
      const simForRun = params.ic50_nM_override !== undefined && isFinite(params.ic50_nM_override) && params.ic50_nM_override > 0 && simResults.binding
        ? { ...simResults, binding: { ...simResults.binding, primaryIC50: params.ic50_nM_override } satisfies SimResults["binding"] }
        : simResults;
      const matrix = await computeTissueSelectivityMatrix({
        sim: simForRun, iv: inVitroResults, l2Params: params.l2,
      });
      setOne("s1", { status: "complete", result: { matrix, transporters } });
    } catch (err: any) {
      setOne("s1", { status: "error", reason: err?.message ?? String(err) });
    } finally {
      setBusyStage(null);
    }
  };

  const runStage5 = () => {
    const s2 = results.s2;
    if (!s2 || s2.status !== "complete" || s2.result.kind !== "manual" || !inVitroResults) {
      setOne("s5", { status: "error", reason: "Stage 5 needs Stage 2 Manual Entry (mechanism flags) — DILI-ML alone does not predict mechanisms." });
      return;
    }
    setOne("s5", { status: "complete", result: deriveStage5FromStage2(s2.result, inVitroResults) });
  };

  const runStage2Ml = async () => {
    if (!simResults?.smiles) return;
    setBusyStage(2);
    setOne("s2", { status: "running" });
    try {
      const r = await predictDiliMl(simResults.smiles);
      if (r.source !== "ml" || !r.ml_available) {
        setOne("s2", { status: "error", reason: r.error ?? "DILI-ML unavailable" });
        return;
      }
      setOne("s2", {
        status: "complete",
        result: {
          kind: "ml",
          source: "ml",
          prediction: r.prediction,
          modelInfo: r.model_info,
          enteredAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      setOne("s2", { status: "error", reason: err?.message ?? String(err) });
    } finally {
      setBusyStage(null);
    }
  };

  const runStage6 = () => {
    setOne("s6", { status: "complete", result: buildStage6Envelope(results) });
  };

  const runStage4Ml = async () => {
    if (!simResults?.uniprotId) {
      setOne("s4", { status: "error", reason: "Stage 4 ML needs an L1 UniProt target — no gene to project against the DepMap PRISM 24Q2 oncology panel." });
      return;
    }
    if (!simResults.binding?.primaryIC50 || !isFinite(simResults.binding.primaryIC50) || simResults.binding.primaryIC50 <= 0) {
      setOne("s4", { status: "error", reason: "Stage 4 ML needs a positive L1 IC50 (nM) — projection conditions on the surrogate IC50." });
      return;
    }
    setBusyStage(4);
    setOne("s4", { status: "running" });
    try {
      // Resolve HUGO gene symbol from UniProt — refuses to silently substitute the accession.
      const protein = await predictProtein(simResults.uniprotId);
      const geneSymbol = (protein?.gene_name ?? "").toString().trim().toUpperCase();
      if (!geneSymbol) {
        setOne("s4", { status: "error", reason: `Stage 4 ML needs a HUGO gene symbol; UniProt ${simResults.uniprotId} returned no gene_name.` });
        return;
      }
      // Caller asserts oncology=true via the ML toggle; non-oncology compounds use Manual Entry's not_applicable mode.
      const r = await predictPatientLine(geneSymbol, simResults.binding.primaryIC50, true);
      if (r.source === "data-not-provisioned") {
        setOne("s4", { status: "error", reason: r.error + (r.remediation ? ` — ${r.remediation}` : "") });
        return;
      }
      if (r.source === "out-of-domain") {
        const oodGenes = r.targets_out_of_domain && r.targets_out_of_domain.length > 0
          ? ` (out-of-domain: ${r.targets_out_of_domain.join(", ")})`
          : "";
        setOne("s4", { status: "error", reason: `${r.error}${oodGenes}` });
        return;
      }
      if (r.source === "input-error") {
        setOne("s4", { status: "error", reason: r.error });
        return;
      }
      setOne("s4", {
        status: "complete",
        result: {
          kind: "ml",
          source: "ml",
          prediction: r.prediction,
          modelInfo: r.model_info,
          enteredAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      setOne("s4", { status: "error", reason: err?.message ?? String(err) });
    } finally {
      setBusyStage(null);
    }
  };

  const runStage3Ml = async () => {
    if (!simResults?.uniprotId) {
      setOne("s3", { status: "error", reason: "Stage 3 ML needs an L1 UniProt target — no gene to score against the Tabula Sapiens v2 atlas." });
      return;
    }
    setBusyStage(3);
    setOne("s3", { status: "running" });
    try {
      // Resolve the HUGO gene symbol from UniProt via the existing protein endpoint
      // — refuses to silently substitute the UniProt accession as a gene symbol.
      const protein = await predictProtein(simResults.uniprotId);
      const geneSymbol = (protein?.gene_name ?? "").toString().trim().toUpperCase();
      if (!geneSymbol) {
        setOne("s3", { status: "error", reason: `Stage 3 ML needs a HUGO gene symbol; UniProt ${simResults.uniprotId} returned no gene_name.` });
        return;
      }
      const targets = [{ gene_symbol: geneSymbol }];
      const r = await predictCellTypeAggregation(targets, 25);
      if (r.source === "data-not-provisioned") {
        setOne("s3", { status: "error", reason: r.error + (r.remediation ? ` — ${r.remediation}` : "") });
        return;
      }
      if (r.source === "out-of-domain") {
        setOne("s3", { status: "error", reason: `${r.error} (out-of-domain genes: ${r.targets_out_of_domain.join(", ")})` });
        return;
      }
      if (r.source === "input-error") {
        setOne("s3", { status: "error", reason: r.error });
        return;
      }
      setOne("s3", {
        status: "complete",
        result: {
          kind: "ml",
          source: "ml",
          prediction: r.prediction,
          modelInfo: r.model_info,
          enteredAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      setOne("s3", { status: "error", reason: err?.message ?? String(err) });
    } finally {
      setBusyStage(null);
    }
  };

  const runStageHandler = async (n: number) => {
    if (n === 1) return runStage1();
    if (n === 2) return runStage2Ml();
    if (n === 3) return runStage3Ml();
    if (n === 4) return runStage4Ml();
    if (n === 5) return runStage5();
    if (n === 6) return runStage6();
  };

  const runFull = async () => {
    if (!simResults || !inVitroResults) return;
    setPipelineRunning(true);
    try {
      await runStage1();
      await runStage2Ml();
      // Stage 3 + Stage 4 ML both auto-run when an L1 UniProt is present; they each
      // gracefully surface a `data-not-provisioned` error block when their respective
      // off-platform Parquet snapshot isn't loaded yet — never a synthetic fallback.
      if (simResults?.uniprotId) {
        await runStage3Ml();
        await runStage4Ml();
      }
      // Stage 5 only auto-derives if Stage 2 manual entry already exists
      // (ML-only S2 does NOT carry mechanism flags — Manual Entry is required).
      const s2Now = results.s2;
      if (s2Now?.status === "complete" && s2Now.result.kind === "manual" && inVitroResults) {
        setOne("s5", { status: "complete", result: deriveStage5FromStage2(s2Now.result, inVitroResults) });
      }
      // Stage 6 always orchestrates over current state (mixed-tier envelope)
      setResults(prev => ({ ...prev, s6: { status: "complete", result: buildStage6Envelope(prev) } }));
    } finally {
      setPipelineRunning(false);
    }
  };

  const copyHandoff = async () => {
    const handoff = {
      schema_version: "L3-T0-v2-with-manual",
      tier: "mixed",
      compound: { name: simResults?.molName, smiles: simResults?.smiles, uniprot: simResults?.uniprotId },
      l3_input_params: params,
      stages: {
        s1: results.s1?.status === "complete" ? {
          status: "complete", source: "in-house-ml",
          tissue_selectivity: results.s1.result.matrix,
          transporter_flags: results.s1.result.transporters,
        } : { status: results.s1?.status ?? "pending" },
        s2: results.s2?.status === "complete" ? { status: "complete", ...results.s2.result } : { status: results.s2?.status ?? "pending" },
        s3: results.s3?.status === "complete" ? { status: "complete", ...results.s3.result } : { status: results.s3?.status ?? "pending" },
        s4: results.s4?.status === "complete" ? { status: "complete", ...results.s4.result } : { status: results.s4?.status ?? "pending" },
        s5: results.s5?.status === "complete" ? { status: "complete", ...results.s5.result } : { status: results.s5?.status ?? "pending" },
        s6: results.s6?.status === "complete" ? { status: "complete", ...results.s6.result } : { status: results.s6?.status ?? "pending" },
      },
      provenance: {
        s1: results.s1?.status === "complete" ? "in-house-ml" : "pending",
        s2: results.s2?.status === "complete" ? (results.s2.result.kind === "ml" ? "ml-binary-classifier" : "user-provided") : "pending",
        s3: results.s3?.status === "complete" ? (results.s3.result.kind === "ml" ? "ml-celltype-aggregation" : "user-provided") : "pending",
        s4: results.s4?.status === "complete"
          ? (results.s4.result.kind === "ml"
              ? "ml-patient-line-projection"
              : (results.s4.result.mode === "non-oncology-na" ? "not-applicable" : "user-provided"))
          : "pending",
        s5: results.s5?.status === "complete" ? results.s5.result.source : "pending",
        s6: results.s6?.status === "complete" ? "orchestration" : "pending",
      },
      generated_at: new Date().toISOString(),
    };
    await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── Per-stage manual-form children for StageCard ──────────────────────────
  const renderManualChildren = (n: 2 | 3 | 4 | 5): React.ReactNode | null => {
    const key = (`s${n}` as "s2" | "s3" | "s4" | "s5");
    const r = results[key];
    const enabled = manualMode[key];
    const setEnabled = (v: boolean) => setManualMode({ ...manualMode, [key]: v });
    const onClear = () => setOne(key, undefined);
    const hasResult = !!r && r.status === "complete";

    if (hasResult) {
      // Already saved — show summary + clear/edit
      return (
        <div className="pl-8 mt-2.5 space-y-1.5">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/8 p-2 text-[10px] text-emerald-200">
            <div className="flex items-center gap-1.5">
              <Check className="w-3 h-3" />
              <span className="font-semibold">Saved · source: {(r as any).result.source ?? "user-provided"}</span>
            </div>
            <div className="mt-1 text-slate-300 leading-relaxed">
              {n === 2 && (() => {
                const v = (r as StageResultBlock<Stage2Result> & { status: "complete" }).result;
                if (v.kind === "ml") {
                  const p = v.prediction;
                  return <>DILI-ML prob = <span className="text-violet-300 font-mono">{p.dili_probability != null ? p.dili_probability.toFixed(3) : "—"}</span> · class <span className="text-violet-300">{p.risk_class ?? "—"}</span> · severity hint <span className="text-slate-400 italic">{p.severity_hint ?? "—"}</span> <span className="text-teal-400/70">(mechanisms not predicted — fill Manual Entry to unlock Stage 5)</span></>;
                }
                return <>severity = <span className="text-cyan-300">{v.severity}</span>; mechanisms: {Object.entries(v.mechanisms).filter(([_, on]) => on).map(([k]) => k).join(", ") || "none"}; cite: <span className="text-slate-400 italic">{v.citation}</span></>;
              })()}
              {n === 3 && (() => {
                const v = (r as StageResultBlock<Stage3Result> & { status: "complete" }).result;
                if (v.kind === "ml") {
                  const top = v.prediction.top_cell_types[0];
                  return <>top cell-type <span className="text-violet-300">{top?.cell_type ?? "—"}</span> · organ <span className="text-violet-300">{top?.organ ?? "—"}</span> · score <span className="text-violet-300 font-mono">{top ? top.score.toFixed(3) : "—"}</span> <span className="text-slate-400 italic">(Drug2cell + {v.modelInfo.atlas.name})</span></>;
                }
                return <>{v.organoidCvcl} · IC50 {v.measuredIc50_uM.toFixed(3)} µM · {v.assayFormat} · cite: <span className="text-slate-400 italic">{v.citation}</span></>;
              })()}
              {n === 4 && (() => {
                const v = (r as StageResultBlock<Stage4Result> & { status: "complete" }).result;
                if (v.kind === "ml") {
                  const top = v.prediction.top_sensitive_lines[0];
                  const med = v.prediction.distribution.median_uM;
                  return <>panel n=<span className="text-violet-300 font-mono">{v.prediction.n_cell_lines_total}</span> · median IC50 <span className="text-violet-300 font-mono">{med != null ? med.toFixed(3) : "—"}</span> µM · top {top?.cell_line_name ?? "—"} <span className="text-slate-400 italic">(DepMap PRISM 24Q2)</span></>;
                }
                return v.mode === "non-oncology-na"
                  ? <>marked <span className="font-mono text-teal-300">not_applicable</span> · non-oncology compound</>
                  : <>{v.rows.length} cell-line{v.rows.length === 1 ? "" : "s"} (DepMap PRISM rows)</>;
              })()}
              {n === 5 && (() => {
                const v = (r as StageResultBlock<Stage5Result> & { status: "complete" }).result;
                return <>{v.biomarkers.length} biomarker{v.biomarkers.length === 1 ? "" : "s"}; Caco-2 {v.caco2Papp_x10minus6.toFixed(1)}×10⁻⁶ cm/s{v.brainKpUu_override !== undefined ? `; brain Kp,uu = ${v.brainKpUu_override.toFixed(2)}` : ""}</>;
              })()}
            </div>
          </div>
          <ManualToggle enabled={enabled} setEnabled={setEnabled} hasResult onClear={onClear} mlLabel={mlLabelForStage(n)} />
        </div>
      );
    }

    return (
      <>
        <ManualToggle enabled={enabled} setEnabled={setEnabled} hasResult={false} onClear={onClear} mlLabel={mlLabelForStage(n)} />
        {enabled && n === 2 && <Stage2ManualForm onSave={r => setOne("s2", { status: "complete", result: r })} />}
        {enabled && n === 3 && <Stage3ManualForm onSave={r => setOne("s3", { status: "complete", result: r })} />}
        {enabled && n === 4 && <Stage4ManualForm onSave={r => setOne("s4", { status: "complete", result: r })} />}
        {enabled && n === 5 && (
          <Stage5OverrideForm
            onSave={brain => {
              const s2 = results.s2;
              if (!s2 || s2.status !== "complete" || !inVitroResults) {
                setOne("s5", { status: "error", reason: "Manual brain Kp,uu override needs Stage 2 to be filled first." });
                return;
              }
              if (s2.result.kind !== "manual") {
                setOne("s5", { status: "error", reason: "Stage 5 brain-Kp,uu override needs Stage 2 Manual Entry (mechanism flags) — ML alone is insufficient." });
                return;
              }
              setOne("s5", { status: "complete", result: deriveStage5FromStage2(s2.result, inVitroResults, brain) });
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ──────────────────────────────────────── */}
      <div className="w-[480px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-4 h-4 text-teal-400" />
            <h2 className="text-[15px] font-semibold text-white">L2 · Ex-Vivo sub-track</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {wiredCount}/6 wired · {acceptsManualCount} manual
            </span>
          </div>
          <p className="text-[12px] text-slate-500">
            T0 in-silico surrogate · Stages 1, 5, 6 in-house · Stages 2, 3, 4 ai-service (DILI-ML · Drug2cell + Tabula Sapiens · DepMap PRISM 24Q2 patient-line) · Manual Entry available for Stages 2–5 per Spec v1.1 Appendix B
          </p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Prerequisite/status banner removed per user request (May 2026).
              The per-stage Run buttons + lock icons already convey readiness;
              the long descriptive paragraph was redundant with the section
              header above. State (`hasL1`, `layer2Ready`) is still consumed
              elsewhere in this scaffold to gate Run buttons. */}

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L1 Inputs</span>
              <span className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${hasL1 ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-400/80" : "border-teal-500/30 bg-teal-500/8 text-teal-400/80"}`}>
                {hasL1 ? "Live" : "Pending"}
              </span>
            </div>
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <L1OutputRow label="Compound"            source="L1 / chemistry.ts (RDKit)" value={simResults ? simResults.molName : "—"} />
              <L1OutputRow label="UniProt target"      source="L1 / UniProt KB API"        value={simResults ? simResults.uniprotId : "—"} />
              <L1OutputRow label="Target gene (display)" source="L1 binding"               value={simResults?.binding ? simResults.binding.targetName : "—"} />
              <L1OutputRow label="L1 IC50 (nM)"        source="L1 binding · primary"        value={simResults?.binding ? simResults.binding.primaryIC50.toFixed(1) : "—"} />
              <L1OutputRow label="Plasma fu (%)"       source="L1 PPB sim"                  value={inVitroResults ? inVitroResults.plasmaProteinBinding.fuPercent.toFixed(2) : "—"} />
              <L1OutputRow label="Caco-2 Papp (×10⁻⁶)" source="L1 permeability sim"         value={inVitroResults ? inVitroResults.permeability.caco2Papp.toFixed(1) : "—"} />
              <L1OutputRow label="MW · LogP · TPSA"    source="RDKit descriptors"           value={simResults ? `${simResults.lipinski.mw.toFixed(0)} · ${simResults.lipinski.logP.toFixed(2)} · ${simResults.lipinski.tpsa.toFixed(0)}` : "—"} />
              <L1OutputRow label="L1 Go / No-Go"       source="L1 cascade gate"             value={simResults ? simResults.goNogo : "—"} />
            </div>
          </section>

          <L3InputParamsCard params={params} setParams={setParams} simResults={simResults} />

          <section>
            <div className="flex items-center gap-2 mb-2">
              <Atom className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L2 Ex-Vivo Pipeline (Spec v1.1 §3 + §10)</span>
            </div>
            {/* Pipeline readiness banner */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 mb-3">
              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-300/80 leading-snug">
                <span className="font-semibold text-amber-300">S1–S2 are fully operational</span> (real data pipelines, no synthetic fallback).{" "}
                <span className="font-semibold text-rose-300">S3–S4</span> require external data artifacts (Parquet) to be provisioned before automated inference is available — manual entry works now.{" "}
                <span className="font-semibold text-amber-300">S5–S6</span> are roadmap stages; S5 auto-runs once S2 manual entry is complete, S6 is pure orchestration.
              </p>
            </div>
            <div className="space-y-2">
              {L3_STAGES.map(s => {
                const key = (`s${s.n}`) as keyof PipelineResults;
                const r = results[key];
                const status: StageStatus = r ? (r.status as StageStatus) : "ready";
                const runDisabled =
                  !hasL1 || pipelineRunning ||
                  (s.n === 5 && !(results.s2?.status === "complete" && results.s2.result.kind === "manual"));
                const runDisabledReason =
                  !hasL1 ? "awaiting L1"
                  : (s.n === 5 && !(results.s2?.status === "complete" && results.s2.result.kind === "manual")) ? "needs Stage 2 Manual Entry (mechanism flags)"
                  : undefined;
                return (
                  <StageCard
                    key={s.n} stage={s} status={status}
                    busy={busyStage === s.n} hasResult={!!r}
                    onRun={() => runStageHandler(s.n)}
                    runDisabled={runDisabled}
                    runDisabledReason={runDisabledReason}
                    errorReason={status === "error" ? (r as any)?.reason : undefined}
                  >
                    {(s.n === 2 || s.n === 3 || s.n === 4 || s.n === 5) && renderManualChildren(s.n as 2 | 3 | 4 | 5)}
                  </StageCard>
                );
              })}
            </div>
          </section>

          <button
            type="button"
            disabled={!hasL1 || pipelineRunning}
            onClick={runFull}
            className={`w-full font-semibold h-11 rounded-lg gap-2 text-[13px] flex items-center justify-center transition-colors ${
              hasL1 && !pipelineRunning
                ? "bg-teal-600 hover:bg-teal-500 text-white cursor-pointer"
                : "bg-slate-700/40 border border-slate-600/40 text-slate-500 cursor-not-allowed"
            }`}
            title={hasL1 ? "Run Stage 1, derive Stage 5 from Stage 2 if present, and orchestrate Stage 6" : "Awaiting L1 In Vitro completion"}
          >
            {pipelineRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" />Running pipeline…</>
              : <><Play className="w-4 h-4" />Run L2 Virtual-Tissue Pipeline (S1 → S2/S3/S4 ai-service → S5 derived → S6 envelope)</>}
          </button>

          {(results.s1?.status === "complete" || results.s2?.status === "complete" || results.s6?.status === "complete") && (
            <button
              type="button"
              onClick={copyHandoff}
              className="w-full h-9 rounded-lg gap-2 text-[12px] flex items-center justify-center border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/15 text-teal-300"
            >
              {copied ? <><Check className="w-4 h-4" /> Copied L2 Virtual-Tissue handoff JSON</> : <><Copy className="w-4 h-4" /> Copy L2 Virtual-Tissue handoff JSON (with provenance)</>}
            </button>
          )}

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Microscope className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Virtual-Tissue Substrates (Zero-Lab — computational only)</span>
            </div>
            <div className="space-y-2">
              {L3_MODALITIES.map(m => (
                <div key={m.name} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-start gap-2 mb-1.5">
                    <Microscope className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-[12px] font-semibold text-white">{m.name}</div>
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-teal-500/30 bg-teal-500/8 text-teal-300/80">computational</span>
                      </div>
                      <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{m.summary}</div>
                    </div>
                  </div>
                  <div className="pl-5 space-y-1 mt-2">
                    {m.sources.map(s => (
                      <div key={s.name} className="flex items-baseline gap-2 text-[10px]">
                        <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
                        <span className="text-slate-300 font-medium">{s.name}</span>
                        <span className="text-slate-500">— {s.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>

      {/* ── RIGHT OUTPUT / DOCUMENTATION PANE ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-5">

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center shrink-0">
              <Microscope className="w-5 h-5 text-teal-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[18px] font-semibold text-white">L2 Virtual-Tissue · T0 In-Silico Projection</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Heuristic + ML projections of tissue response from L1 + L2 + public atlases (GTEx + Tabula Sapiens v2).
                Stages 1, 5, 6 in-house · Stages 2, 3, 4 ai-service (DILI-ML · Drug2cell + Tabula Sapiens · DepMap PRISM 24Q2). Stages 2–5 also accept Manual Entry tagged source: user-provided
                (cascade flag: prediction_only, literature-curated anchor required for IND-supporting claims).
              </p>
            </div>
          </div>

          {/* Idle */}
          {!results.s1 && !results.s2 && !results.s3 && !results.s4 && !results.s5 && !results.s6 && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center">
              <Microscope className="w-10 h-10 text-teal-400/50 mx-auto mb-3" />
              <p className="text-[13px] text-slate-300 mb-1">Ready to run L2 Ex-Vivo pipeline</p>
              <p className="text-[11px] text-slate-500">
                Run Stages 1–5 individually (Stage 1 in-house, Stages 2/3/4 ai-service, Stage 5 auto-derived) or click <span className="text-teal-300 font-semibold">Run L2 Virtual-Tissue Pipeline</span> to chain them and emit the Stage 6 envelope. Manual Entry on Stages 2–5 overrides any ML output. Non-oncology compounds: use Stage 4 Manual Entry's not_applicable mode.
              </p>
            </div>
          )}

          {/* Stage 1 — Running / Error / Complete */}
          {results.s1?.status === "running" && (
            <ResultShell stage={1} name="Tissue selectivity + transporter flags" icon={FlaskConical} status="running">
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                Computing L2 dose projection + PBPK + GTEx fetch…
              </div>
            </ResultShell>
          )}
          {results.s1?.status === "error" && (
            <ResultShell stage={1} name="Tissue selectivity + transporter flags" icon={AlertTriangle} status="error" reason={results.s1.reason}>
              <p className="text-[10px] text-rose-200/60">No silent fallback per honesty policy — failure is surfaced and Stage 1 cards are not rendered.</p>
            </ResultShell>
          )}
          {results.s1?.status === "complete" && (
            <>
              <ResultShell stage={1} name="Tissue selectivity (54 GTEx tissues)" icon={FlaskConical} status="complete">
                <CascadeBlock matrix={results.s1.result.matrix} />
                <TissueMatrixBlock matrix={results.s1.result.matrix} />
              </ResultShell>
              <ResultShell stage={1} name="Transporter substrate / inhibitor flags (9 channels)" icon={Activity} status="complete">
                <TransporterFlagsBlock flags={results.s1.result.transporters} floor={params.transporterConfidenceFloor} />
              </ResultShell>
            </>
          )}

          {/* Stage 2 result */}
          {results.s2?.status === "complete" && (() => {
            const v = results.s2.result;
            if (v.kind === "ml") {
              const p = v.prediction;
              const probStr = p.dili_probability != null ? p.dili_probability.toFixed(3) : "—";
              const auc = v.modelInfo.performance?.cv_roc_auc_mean;
              const aucStr = auc != null ? auc.toFixed(3) : "—";
              return (
                <ResultShell stage={2} name="DILI risk (ML — binary classifier)" icon={Beaker} status="complete">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <div className="text-slate-500">DILI-positive prob.</div>
                    <div className="text-violet-300 font-mono text-right">{probStr}</div>
                    <div className="text-slate-500">Risk class</div>
                    <div className="text-violet-300 font-mono text-right">{p.risk_class ?? "—"}</div>
                    <div className="text-slate-500">Severity hint (heuristic)</div>
                    <div className="text-slate-300 italic text-right">{p.severity_hint ?? "—"}</div>
                    <div className="text-slate-500">Engine</div>
                    <div className="text-violet-300 font-mono text-right text-[10px]">DILI-ML v1 · RF</div>
                    <div className="text-slate-500">Training (TDC DILI)</div>
                    <div className="text-slate-300 font-mono text-right text-[10px]">n={v.modelInfo.training?.n_train ?? "—"} · CV AUC {aucStr}</div>
                    <div className="text-slate-500">Source</div>
                    <div className="text-violet-300 font-mono text-right">ml</div>
                  </div>
                  <div className="text-[10px] text-teal-300/80 italic">
                    Binary classifier only — 5-class severity + mechanism flags (mito / BSEP / ROS / immune)
                    are NOT predicted. Stage 5 biomarker derivation requires Manual Entry to be filled.
                  </div>
                </ResultShell>
              );
            }
            return (
              <ResultShell stage={2} name="DILI severity + mechanism (user-provided)" icon={Beaker} status="complete">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-slate-500">Severity</div>
                  <div className="text-cyan-300 font-mono text-right">{v.severity}</div>
                  <div className="text-slate-500">Mechanisms</div>
                  <div className="text-cyan-300 font-mono text-right">{Object.entries(v.mechanisms).filter(([_, on]) => on).map(([k]) => k).join(", ") || "none"}</div>
                  <div className="text-slate-500">Citation</div>
                  <div className="text-slate-300 italic text-right">{v.citation}</div>
                  <div className="text-slate-500">Source</div>
                  <div className="text-cyan-300 font-mono text-right">user-provided</div>
                </div>
                <div className="text-[10px] text-amber-300/80 italic">Cascade flag: prediction_only · literature-curated anchor (cited CVCL + IC50) required for IND-supporting claims.</div>
              </ResultShell>
            );
          })()}

          {/* Stage 3 result — ML (Drug2cell + Tabula Sapiens v2) or Manual literature-curated IC50 */}
          {results.s3?.status === "complete" && (() => {
            const v = results.s3.result;
            if (v.kind === "ml") {
              const top = v.prediction.top_cell_types.slice(0, 5);
              const organs = v.prediction.per_organ.slice(0, 5);
              return (
                <ResultShell stage={3} name="Cell-type aggregation (Drug2cell + Tabula Sapiens v2)" icon={Atom} status="complete">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                    <div className="text-slate-500">Atlas</div>
                    <div className="text-violet-300 font-mono text-right">{v.modelInfo.atlas.name}</div>
                    <div className="text-slate-500">Targets in domain</div>
                    <div className="text-violet-300 font-mono text-right">{v.prediction.targets_in_domain.join(", ") || "—"}</div>
                    {v.prediction.targets_out_of_domain.length > 0 && (
                      <>
                        <div className="text-slate-500">Out of atlas</div>
                        <div className="text-amber-300 font-mono text-right">{v.prediction.targets_out_of_domain.join(", ")}</div>
                      </>
                    )}
                    <div className="text-slate-500">Weighting</div>
                    <div className="text-slate-300 text-right">{v.prediction.weighting_mode}</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden mb-2">
                    <div className="grid grid-cols-[1fr_120px_70px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                      <div>Top cell type · tissue</div><div>Organ</div><div className="text-right">Score</div>
                    </div>
                    {top.map(r => (
                      <div key={`${r.cell_type}|${r.tissue}`} className="grid grid-cols-[1fr_120px_70px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                        <div className="text-violet-200 truncate" title={`${r.cell_type} · ${r.tissue}`}>{r.cell_type} <span className="text-slate-500">· {r.tissue}</span></div>
                        <div className="text-slate-300 truncate">{r.organ}</div>
                        <div className="text-right font-mono text-violet-300">{r.score.toFixed(3)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
                    <div className="grid grid-cols-[1fr_70px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                      <div>Top organs</div><div className="text-right">Org. score</div>
                    </div>
                    {organs.map(r => (
                      <div key={r.organ} className="grid grid-cols-[1fr_70px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                        <div className="text-violet-200">{r.organ} <span className="text-slate-500">· {r.n_cell_types} types</span></div>
                        <div className="text-right font-mono text-violet-300">{r.organ_score.toFixed(3)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-teal-300/80 italic mt-2">Cascade flag: prediction_only · expression × affinity score, NOT a literature-curated IC50. Cite a published IC50 (CVCL + DOI/PMID) to anchor IND-supporting claims.</div>
                </ResultShell>
              );
            }
            return (
              <ResultShell stage={3} name="Cell-type / literature-curated IC50 (user-provided)" icon={Atom} status="complete">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-slate-500">Cell line (CVCL)</div>
                  <div className="text-cyan-300 font-mono text-right">{v.organoidCvcl}</div>
                  <div className="text-slate-500">Published IC50</div>
                  <div className="text-cyan-300 font-mono text-right">{v.measuredIc50_uM.toFixed(3)} µM</div>
                  <div className="text-slate-500">Assay format</div>
                  <div className="text-slate-300 text-right">{v.assayFormat}</div>
                  <div className="text-slate-500">Citation</div>
                  <div className="text-slate-300 italic text-right">{v.citation}</div>
                </div>
              </ResultShell>
            );
          })()}

          {/* Stage 4 result — ML (DepMap PRISM 24Q2 projection) or Manual oncology rows / non-oncology N/A */}
          {results.s4?.status === "complete" && (() => {
            const v = results.s4.result;
            if (v.kind === "ml") {
              const p = v.prediction;
              const top = p.top_sensitive_lines.slice(0, 8);
              const lineages = p.per_lineage.slice(0, 6);
              const dist = p.distribution;
              return (
                <ResultShell stage={4} name="Patient-line projection (DepMap PRISM 24Q2)" icon={FlaskConical} status="complete">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                    <div className="text-slate-500">Snapshot</div>
                    <div className="text-violet-300 font-mono text-right">{v.modelInfo.snapshot.name}{v.modelInfo.snapshot.release ? ` ${v.modelInfo.snapshot.release}` : ""}</div>
                    <div className="text-slate-500">Query gene · L1 IC50</div>
                    <div className="text-violet-300 font-mono text-right">{p.query_gene_symbol} · {p.l1_ic50_nM.toFixed(1)} nM</div>
                    <div className="text-slate-500">Panel size</div>
                    <div className="text-violet-300 font-mono text-right">n = {p.n_cell_lines_total} · {p.n_resistant_no_target} resistant_no_target</div>
                    <div className="text-slate-500">Predicted IC50 distribution</div>
                    <div className="text-violet-300 font-mono text-right">
                      median {dist.median_uM != null ? dist.median_uM.toFixed(3) : "—"} µM · p10 {dist.p10_uM != null ? dist.p10_uM.toFixed(3) : "—"} · p90 {dist.p90_uM != null ? dist.p90_uM.toFixed(3) : "—"}
                    </div>
                    <div className="text-slate-500">Alpha · weighting</div>
                    <div className="text-slate-300 text-right">α = {p.alpha.toFixed(2)} · 2^(α · chronos)</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden mb-2">
                    <div className="grid grid-cols-[100px_1fr_70px_60px_60px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                      <div>DepMap ID</div><div>Cell line · disease</div><div className="text-right">Pred IC50</div><div className="text-right">Chronos</div><div className="text-right">log2 TPM</div>
                    </div>
                    {top.map(r => (
                      <div key={r.depmap_id} className="grid grid-cols-[100px_1fr_70px_60px_60px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                        <div className="font-mono text-violet-300">{r.depmap_id}</div>
                        <div className="text-violet-200 truncate" title={`${r.cell_line_name} · ${r.primary_disease}`}>
                          {r.cell_line_name} <span className="text-slate-500">· {r.primary_disease}</span>
                        </div>
                        <div className="text-right font-mono text-violet-300">{r.predicted_IC50_uM != null ? r.predicted_IC50_uM.toFixed(3) : "—"}</div>
                        <div className="text-right font-mono text-slate-300">{r.essentiality_chronos.toFixed(2)}</div>
                        <div className="text-right font-mono text-slate-300">{r.expression_log2_tpm.toFixed(1)}</div>
                      </div>
                    ))}
                  </div>
                  {lineages.length > 0 && (
                    <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
                      <div className="grid grid-cols-[1fr_70px_60px_60px_60px_60px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                        <div>Lineage</div><div className="text-right">Median</div><div className="text-right">HiSens</div><div className="text-right">Sens</div><div className="text-right">Near</div><div className="text-right">Resist</div>
                      </div>
                      {lineages.map(L => (
                        <div key={L.lineage} className="grid grid-cols-[1fr_70px_60px_60px_60px_60px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                          <div className="text-violet-200">{L.lineage} <span className="text-slate-500">· n={L.n_cell_lines}</span></div>
                          <div className="text-right font-mono text-violet-300">{L.median_predicted_IC50_uM.toFixed(3)}</div>
                          <div className="text-right font-mono text-emerald-300">{L.n_highly_sensitive}</div>
                          <div className="text-right font-mono text-emerald-300/80">{L.n_sensitive}</div>
                          <div className="text-right font-mono text-slate-300">{L.n_near_baseline}</div>
                          <div className="text-right font-mono text-rose-300">{L.n_resistant}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-teal-300/80 italic mt-2">
                    Cascade flag: prediction_only · in-house projection of L1 IC50 conditioned on per-cell-line essentiality + expression, NOT a measured PRISM IC50 for this compound.
                    Wet PRISM measurement (T2/T3) required for IND-supporting claims.
                  </div>
                </ResultShell>
              );
            }
            return (
              <ResultShell stage={4} name="Patient-line projection (user-provided)" icon={FlaskConical} status="complete">
                {v.mode === "non-oncology-na" ? (
                  <div className="text-[11px] text-teal-200">
                    Marked <span className="font-mono">kind: "not_applicable"</span> — non-oncology compound, patient-line projection out of domain by design.
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
                    <div className="grid grid-cols-[120px_90px_1fr] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                      <div>DepMap ID</div><div className="text-right">IC50 (µM)</div><div>Citation</div>
                    </div>
                    {v.rows.map(r => (
                      <div key={r.depmapId} className="grid grid-cols-[120px_90px_1fr] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                        <div className="font-mono text-cyan-300">{r.depmapId}</div>
                        <div className="text-right font-mono text-cyan-200">{r.ic50_uM.toFixed(3)}</div>
                        <div className="text-slate-400 italic truncate">{r.citation}</div>
                      </div>
                    ))}
                  </div>
                )}
              </ResultShell>
            );
          })()}

          {/* Stage 5 result */}
          {results.s5?.status === "complete" && (() => {
            const v = results.s5.result;
            return (
              <ResultShell stage={5} name="DILI biomarker proxy + permeability" icon={Activity} status="complete">
                <div className="text-[10px] text-slate-400">Source: {v.source} · derived deterministically per Spec v1.1 §3.6</div>
                <div className="space-y-1.5">
                  {v.biomarkers.map(b => (
                    <div key={b.name} className="rounded-md border border-white/8 bg-black/30 p-2">
                      <div className="text-[11px] font-semibold text-white">{b.name}</div>
                      <div className="text-[10px] text-slate-400 italic">{b.rationale}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-white/5">
                  <div className="text-slate-500">Caco-2 Papp (L1)</div>
                  <div className="text-cyan-300 font-mono text-right">{v.caco2Papp_x10minus6.toFixed(1)} ×10⁻⁶ cm/s</div>
                  <div className="text-slate-500">Brain Kp,uu</div>
                  <div className="text-cyan-300 font-mono text-right">{v.brainKpUu_override !== undefined ? v.brainKpUu_override.toFixed(2) : "unmeasured (user override available)"}</div>
                </div>
              </ResultShell>
            );
          })()}

          {/* Stage 6 envelope */}
          {results.s6?.status === "complete" && (() => {
            const v = results.s6.result;
            return (
              <ResultShell stage={6} name="Cascade integration + L2 Ex-Vivo → L3 envelope" icon={Shield} status="complete">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-slate-500">Envelope kind</div>
                  <div className="text-cyan-300 font-mono text-right">{v.envelopeKind}</div>
                  <div className="text-slate-500">Load-bearing readouts</div>
                  <div className="text-cyan-300 font-mono text-right">{v.loadBearingCount} (canSignLoadBearing requires kind:"pass" — none of L2 Ex-Vivo qualifies)</div>
                </div>
                <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
                  <div className="grid grid-cols-[40px_1fr_70px_110px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
                    <div>S</div><div>Readout</div><div className="text-center">Tier</div><div>Cascade</div>
                  </div>
                  {v.perReadoutTiers.map(t => (
                    <div key={t.stage} className="grid grid-cols-[40px_1fr_70px_110px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0">
                      <div className="font-mono text-teal-300">{t.stage}</div>
                      <div className="text-slate-200 truncate">{t.name}</div>
                      <div className="flex justify-center">
                        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border font-semibold ${tierBadgeClass(t.tier)}`}>{t.tier}</span>
                      </div>
                      <div className="font-mono text-slate-400">{t.cascadeKind}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-teal-300/80 italic leading-relaxed">
                  Mixed-tier envelopes are normal per Spec v1.1 §2.3. L3 Amber Curator's <span className="font-mono">canSignLoadBearing</span> compile-time gate refuses to sign load-bearing claims based on prediction_only / user-provided readouts.
                </div>
              </ResultShell>
            );
          })()}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-emerald-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 Ex-Vivo → L3 Envelope (per-readout tier)</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Each readout carries its own tier badge (<span className="font-mono">t0</span> in-house ML, <span className="font-mono">t-user</span> manual entry,
              <span className="font-mono"> n/a</span> not_applicable, <span className="font-mono">pending</span> not yet filled). Mixed-tier envelopes are normal.
              Amber Curator at L3 refuses to sign load-bearing claims unless a readout is <span className="font-mono">kind: "pass"</span> — user-provided values always
              map to <span className="font-mono">prediction_only</span>, never to <span className="font-mono">pass</span>.
            </p>
          </div>

          <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-3 flex items-start gap-2.5">
            <FileText className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-300 leading-relaxed">
              <span className="font-semibold text-teal-300">Build status:</span> Stages 1, 5 in-house (tissue selectivity + biomarker rule table); Stage 6 auto-orchestrates the per-readout envelope.
              Stage 2 ai-service (DILI binary classifier). Stage 3 ai-service (Drug2cell + Tabula Sapiens v2; atlas Parquet required). Stage 4 ai-service (DepMap PRISM 24Q2 patient-line projection; snapshot Parquet required, oncology-only — non-oncology compounds use Manual Entry's not_applicable mode).
              Manual Entry remains available for Stages 2–5. Premium tier (DrugBank integration) will additionally back Stages 2 + 4 + 5 with API-served structured pharmacology / ADRs / DDIs.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[12px] font-semibold transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Continue to L3 Animal Cohort
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
