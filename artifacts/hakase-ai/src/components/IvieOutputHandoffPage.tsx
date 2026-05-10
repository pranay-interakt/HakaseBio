/**
 * IVIVE Output → Animal Cohort Handoff Page
 *
 * Full-screen gate that intercepts the L2 → L3 transition. Surfaces every
 * piece of evidence the IVIVE block produced, lists hard/soft alerts, and
 * requires explicit client sign-off (with per-alert acknowledgment) before
 * the user is allowed to proceed to L3 Animal Cohort.
 *
 * Anti-fabrication policy:
 *   - Empty IVIVE cells render `—`, never zero/synthetic.
 *   - Hard blocks cannot be acknowledged away — only soft warnings can.
 *   - Sign-off is recorded with name + role + timestamp + acknowledged
 *     alert IDs (kept in component state; consumed by L3 panel via prop).
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, ArrowLeft, AlertTriangle, ShieldCheck, ShieldAlert,
  Beaker, Microscope, FlaskConical, FileCheck2, FileWarning, UserCheck,
  CheckCircle2, XCircle, Info,
} from "lucide-react";
import {
  IVIE_PRECLINICAL_SPECIES, assessIvieTier,
  type IvieWetLabInputs, type IvieTier,
} from "@/lib/ivieInputs";
import { IvieInputsPanel } from "@/components/IvieInputsPanel";
import type { ConfirmationEvidenceBlock } from "@workspace/preclinical-handoff";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IvieHandoffSignOff {
  enteredBy: string;
  role: string;
  justification: string;
  acknowledgedAlerts: string[];
  signedAt: string; // ISO
}

interface SimResultsLike {
  molName?: string;
  goNogo?: "GO" | "NO-GO" | string;
}

interface SafetyFlagLike {
  id?: string;
  message?: string;
  severity?: string;
  reviewRequired?: boolean;
}

interface Props {
  ivieInputs: IvieWetLabInputs;
  /** Editable on this page — wet-lab substrate is now captured at the
   *  L2 → L3 handoff (was previously inside the L2 Confirmation page). */
  onIvieInputsChange: (next: IvieWetLabInputs) => void;
  simResults: SimResultsLike | null;
  confirmationBlock: ConfirmationEvidenceBlock | null;
  safetyFlags: SafetyFlagLike[];
  /** Returns to the L2 Confirmation tab. */
  onBack: () => void;
  /** Proceed to L3 Animal Cohort with the captured sign-off. */
  onProceed: (signOff: IvieHandoffSignOff) => void;
}

type AlertLevel = "block" | "warn" | "info";
interface GateAlert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
}

// ─── Alert assembly ──────────────────────────────────────────────────────────

function buildAlerts(
  ivieInputs: IvieWetLabInputs,
  simResults: SimResultsLike | null,
  confirmationBlock: ConfirmationEvidenceBlock | null,
  safetyFlags: SafetyFlagLike[],
): GateAlert[] {
  const alerts: GateAlert[] = [];
  const tierA = assessIvieTier(ivieInputs);

  // Hard blocks
  if (!simResults) {
    alerts.push({
      id: "no-l1",
      level: "block",
      title: "L1 In-Vitro has not been run",
      detail: "Run the Layer 1 simulation before initiating Animal Cohort study design.",
    });
  } else if (simResults.goNogo === "NO-GO") {
    alerts.push({
      id: "l1-nogo",
      level: "block",
      title: "L1 verdict is NO-GO",
      detail: "The L1 stage-gate failed. Resolve the blocking signals or record an explicit override before progressing.",
    });
  }
  if (tierA.tier === "Insufficient") {
    alerts.push({
      id: "ivie-insufficient",
      level: "block",
      title: "IVIVE inputs are below Minimum tier",
      detail: "Provide at least fu_p (human) so the well-stirred liver model has the bare-minimum substrate.",
    });
  }

  // Soft warnings (acknowledgeable)
  if (!confirmationBlock) {
    alerts.push({
      id: "l2-unsealed",
      level: "warn",
      title: "L2 Confirmation block is not sealed",
      detail: "Animal Cohort will run without a sealed in-silico↔ex-vivo reconciliation. Override should cite the rationale.",
    });
  } else if (confirmationBlock.gateStatus === "failed") {
    alerts.push({
      id: "l2-failed",
      level: "warn",
      title: "L2 Confirmation gate failed",
      detail: "The reconciliation gate did not pass. Proceeding requires acknowledging that L3 will inherit unresolved divergences.",
    });
  } else if (confirmationBlock.gateStatus === "overridden") {
    alerts.push({
      id: "l2-overridden",
      level: "info",
      title: "L2 Confirmation gate was overridden",
      detail: `${confirmationBlock.overrides?.length ?? 0} override(s) recorded. L3 will cite this Confirmation block.`,
    });
  }
  if (!tierA.crossSpeciesRuleSatisfied && tierA.tier !== "Insufficient") {
    alerts.push({
      id: "ivie-cross-species",
      level: "warn",
      title: "Cross-species rule unmet",
      detail: "fu_p AND B/P each need human + ≥1 preclinical species. Without it the species translation in L3 is a best guess, not an evidence-based design.",
    });
  }
  if (tierA.tier === "Minimum") {
    alerts.push({
      id: "ivie-minimum",
      level: "warn",
      title: "IVIVE tier is Minimum",
      detail: "Standard tier (mouse + rat fu_p, B/P human + ≥1 preclinical) is the recommended substrate for L3 design defensibility.",
    });
  }
  if (tierA.tier !== "Premium") {
    alerts.push({
      id: "ivie-no-fumic",
      level: "info",
      title: "fu_mic correction not available",
      detail: "Premium tier (fu_mic human + ≥1 preclinical) applies the Obach 1999 microsomal-binding correction. Without it, hepatic CL projections may diverge from observed.",
    });
  }
  const reviewFlags = safetyFlags.filter(f => f?.reviewRequired);
  if (reviewFlags.length > 0) {
    alerts.push({
      id: "safety-review",
      level: "warn",
      title: `${reviewFlags.length} safety flag(s) marked for review`,
      detail: "Active flags cascade into L3. Acknowledge that you accept the residual safety burden.",
    });
  }

  return alerts;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TIER_TINT: Record<IvieTier, string> = {
  Insufficient: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  Minimum:      "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Standard:     "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  Premium:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
};

const ALERT_TINT: Record<AlertLevel, { ring: string; chip: string; icon: ReactNode; label: string }> = {
  block: {
    ring: "border-rose-500/40 bg-rose-500/8",
    chip: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    icon: <XCircle className="w-4 h-4 text-rose-400" />,
    label: "BLOCK",
  },
  warn: {
    ring: "border-amber-500/40 bg-amber-500/8",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    label: "WARN",
  },
  info: {
    ring: "border-sky-500/40 bg-sky-500/8",
    chip: "bg-sky-500/15 text-sky-300 border-sky-500/40",
    icon: <Info className="w-4 h-4 text-sky-400" />,
    label: "INFO",
  },
};

function fmtCell(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "—";
}

export function IvieOutputHandoffPage({
  ivieInputs, onIvieInputsChange, simResults, confirmationBlock, safetyFlags, onBack, onProceed,
}: Props) {
  const tierA = useMemo(() => assessIvieTier(ivieInputs), [ivieInputs]);
  const alerts = useMemo(
    () => buildAlerts(ivieInputs, simResults, confirmationBlock, safetyFlags),
    [ivieInputs, simResults, confirmationBlock, safetyFlags],
  );
  const blocks = alerts.filter(a => a.level === "block");
  const warns  = alerts.filter(a => a.level === "warn");

  // Sign-off form state
  const [enteredBy, setEnteredBy]         = useState("");
  const [role, setRole]                   = useState("");
  const [justification, setJustification] = useState("");
  const [acked, setAcked]                 = useState<Record<string, boolean>>({});
  const allWarnsAcked = warns.every(w => acked[w.id]);
  const signOffComplete = enteredBy.trim().length > 0 && role.trim().length > 0;
  const canProceed = blocks.length === 0 && allWarnsAcked && signOffComplete;

  const handleProceed = () => {
    if (!canProceed) return;
    onProceed({
      enteredBy: enteredBy.trim(),
      role: role.trim(),
      justification: justification.trim(),
      acknowledgedAlerts: Object.entries(acked).filter(([, v]) => v).map(([k]) => k),
      signedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950">
      {/* Header — cyan→amber gradient signaling the L2→L3 transition */}
      <div
        className="border-b border-white/10 px-8 py-6"
        style={{
          background:
            "linear-gradient(90deg, rgba(8,145,178,0.18) 0%, rgba(8,145,178,0.10) 50%, rgba(245,158,11,0.18) 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileCheck2 className="w-5 h-5 text-cyan-300" />
              <h1 className="text-[18px] font-semibold text-white tracking-tight">
                IVIVE Output → Animal Cohort Handoff
              </h1>
            </div>
            <p className="text-[12px] text-slate-300/80 max-w-[820px]">
              Final review before initiating L3 Animal Cohort study design. All evidence
              produced by L1 In-Vitro and L2 Confirmation is summarised below alongside
              the IVIVE wet-lab substrate. Hard blocks must be cleared upstream; soft
              warnings require explicit client acknowledgment.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${TIER_TINT[tierA.tier]}`}>
              IVIVE · {tierA.tier}
            </span>
            {blocks.length === 0 ? (
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/40 flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" /> No hard blocks
              </span>
            ) : (
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border bg-rose-500/15 text-rose-300 border-rose-500/40 flex items-center gap-1.5">
                <ShieldAlert className="w-3 h-3" /> {blocks.length} hard block{blocks.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 grid grid-cols-12 gap-6">

        {/* ── L1 + L2 Evidence summary ───────────────────────────────── */}
        <section className="col-span-12 lg:col-span-7 space-y-4">

          {/* L1 In-Vitro */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Beaker className="w-4 h-4 text-violet-300" />
                <h3 className="text-[13px] font-semibold text-white">L1 — In-Vitro</h3>
              </div>
              {simResults?.goNogo && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  simResults.goNogo === "GO"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : "bg-rose-500/15 text-rose-300 border-rose-500/40"
                }`}>
                  {simResults.goNogo}
                </span>
              )}
            </div>
            <div className="text-[12px] text-slate-300">
              {simResults
                ? <>Compound <span className="font-mono text-violet-200">{simResults.molName ?? "—"}</span> completed L1.</>
                : <span className="text-slate-500">L1 has not been run.</span>}
            </div>
          </div>

          {/* L2 Confirmation */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-cyan-300" />
                <h3 className="text-[13px] font-semibold text-white">L2 — Confirmation (In-Silico ↔ Ex-Vivo)</h3>
              </div>
              {confirmationBlock ? (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  confirmationBlock.gateStatus === "passed"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : confirmationBlock.gateStatus === "overridden"
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                      : "bg-rose-500/15 text-rose-300 border-rose-500/40"
                }`}>
                  {confirmationBlock.gateStatus.toUpperCase()}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-500/15 text-slate-400 border-slate-500/40">
                  UNSEALED
                </span>
              )}
            </div>
            <div className="text-[12px] text-slate-300 grid grid-cols-2 gap-x-6 gap-y-1">
              <div>
                <span className="text-slate-500">Sealed at: </span>
                <span className="font-mono">{confirmationBlock?.emittedAt ?? "—"}</span>
              </div>
              <div>
                <span className="text-slate-500">Engine: </span>
                <span className="font-mono">{confirmationBlock?.emitterEngine ?? "—"}</span>
              </div>
              <div>
                <span className="text-slate-500">Overrides: </span>
                <span className="font-mono">{confirmationBlock?.overrides?.length ?? 0}</span>
              </div>
              <div>
                <span className="text-slate-500">Ex-Vivo mode: </span>
                <span className="font-mono">{confirmationBlock?.exVivoEntryMode ? String(confirmationBlock.exVivoEntryMode) : "—"}</span>
              </div>
            </div>
          </div>

          {/* IVIVE wet-lab substrate — editable here (moved out of L2 Confirmation
              so the substrate is captured at the L2 → L3 handoff). Status chip
              above the panel reflects current cross-species rule + completion. */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <Microscope className="w-4 h-4 text-cyan-300" />
                <h3 className="text-[13px] font-semibold text-white">IVIVE Wet-Lab Substrate</h3>
                <span className="text-[10.5px] text-slate-500">— enter what your CRO returned</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  tierA.crossSpeciesRuleSatisfied
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                }`}>
                  Cross-species rule: {tierA.crossSpeciesRuleSatisfied ? "MET" : "UNMET"}
                </span>
                <span className="text-[10px] text-slate-500">
                  {(tierA.completionFraction * 100).toFixed(0)}% complete
                </span>
              </div>
            </div>
            <IvieInputsPanel
              value={ivieInputs}
              onChange={onIvieInputsChange}
              defaultExpanded
            />
            <p className="text-[10.5px] text-slate-500 mt-1.5 px-1 leading-relaxed">
              Empty cells render <span className="font-mono">—</span>; the engine ignores them and uses L1 fallback. No synthetic defaults injected at any stage. Re-run L2 In-Silico after editing here to apply the new substrate to dose projection.
            </p>
          </div>

          {/* Active safety flags (cascade preview into L3) */}
          {safetyFlags.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-300" />
                <h3 className="text-[13px] font-semibold text-white">Safety Flags Cascading into L3</h3>
                <span className="ml-auto text-[10px] text-slate-500">
                  {safetyFlags.filter(f => f.reviewRequired).length} require review
                </span>
              </div>
              <ul className="space-y-1.5">
                {safetyFlags.slice(0, 6).map((f, i) => (
                  <li key={f.id ?? i} className="text-[11.5px] text-slate-300 flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span>
                    <span className="flex-1">
                      {f.message ?? f.id ?? "Flag"}
                      {f.severity && (
                        <span className="ml-2 text-[10px] text-amber-300/80 font-mono">
                          [{f.severity}]
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {safetyFlags.length > 6 && (
                  <li className="text-[10.5px] text-slate-500 italic">
                    + {safetyFlags.length - 6} additional flag(s) carried into L3
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>

        {/* ── Alerts + Sign-off ──────────────────────────────────────── */}
        <section className="col-span-12 lg:col-span-5 space-y-4">

          {/* Alerts list */}
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-slate-300" />
                <h3 className="text-[13px] font-semibold text-white">Gate Alerts</h3>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                  {blocks.length} block
                </span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {warns.length} warn
                </span>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-[12px] text-emerald-300 py-3">
                <CheckCircle2 className="w-4 h-4" />
                All gate checks passed. Ready to proceed.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {alerts.map(a => {
                  const t = ALERT_TINT[a.level];
                  const acknowledgable = a.level === "warn";
                  return (
                    <li key={a.id} className={`rounded-lg border ${t.ring} p-3`}>
                      <div className="flex items-start gap-2">
                        {t.icon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${t.chip}`}>
                              {t.label}
                            </span>
                            <span className="text-[12px] font-semibold text-white">{a.title}</span>
                          </div>
                          <p className="text-[11px] text-slate-300/90 leading-relaxed">{a.detail}</p>
                          {acknowledgable && (
                            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                className="accent-amber-500"
                                checked={!!acked[a.id]}
                                onChange={(e) => setAcked(prev => ({ ...prev, [a.id]: e.target.checked }))}
                              />
                              Acknowledge — proceed despite this warning.
                            </label>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Sign-off */}
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserCheck className="w-4 h-4 text-slate-300" />
              <h3 className="text-[13px] font-semibold text-white">Client Sign-Off</h3>
            </div>
            <div className="space-y-2.5">
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">Name *</label>
                <input
                  type="text" value={enteredBy}
                  onChange={(e) => setEnteredBy(e.target.value)}
                  placeholder="e.g. Dr. Sarah Lin"
                  className="w-full px-3 py-1.5 text-[12px] rounded-md bg-slate-950 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">Role *</label>
                <input
                  type="text" value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Head of DMPK / Sponsor PI"
                  className="w-full px-3 py-1.5 text-[12px] rounded-md bg-slate-950 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">
                  Justification <span className="text-slate-600">(optional, recommended when warnings are acknowledged)</span>
                </label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  placeholder="Rationale for proceeding to L3 given the above evidence..."
                  className="w-full px-3 py-2 text-[12px] rounded-md bg-slate-950 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none"
                />
              </div>
            </div>

            {/* Gate state explanation */}
            <div className="mt-3 pt-3 border-t border-white/5 space-y-1 text-[10.5px]">
              <div className="flex items-center gap-2">
                {blocks.length === 0
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                <span className={blocks.length === 0 ? "text-emerald-300" : "text-rose-300"}>
                  Hard blocks: {blocks.length === 0 ? "none" : `${blocks.length} unresolved`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {allWarnsAcked
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                <span className={allWarnsAcked ? "text-emerald-300" : "text-amber-300"}>
                  Soft warnings: {warns.length === 0
                    ? "none"
                    : `${warns.filter(w => acked[w.id]).length}/${warns.length} acknowledged`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {signOffComplete
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <Info className="w-3.5 h-3.5 text-slate-500" />}
                <span className={signOffComplete ? "text-emerald-300" : "text-slate-400"}>
                  Sign-off: {signOffComplete ? "complete" : "name + role required"}
                </span>
              </div>
            </div>
          </div>

        </section>
      </div>

      {/* ── Sticky action bar ──────────────────────────────────────── */}
      <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/95 backdrop-blur px-8 py-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/15 text-slate-300 hover:bg-white/5 text-[12px] font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to L2 Confirmation
        </button>
        <div className="flex items-center gap-3">
          {!canProceed && (
            <span className="text-[10.5px] text-slate-500">
              {blocks.length > 0
                ? "Resolve hard blocks upstream to enable progression."
                : !allWarnsAcked
                  ? "Acknowledge every warning to enable progression."
                  : "Complete sign-off (name + role) to enable progression."}
            </span>
          )}
          <button
            type="button"
            onClick={handleProceed}
            disabled={!canProceed}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
              canProceed
                ? "bg-amber-600 hover:bg-amber-500 text-white"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            Proceed to L3 Animal Cohort
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export so the unused IVIE_PRECLINICAL_SPECIES import is referenced (kept
// for callers wiring custom rule readouts later).
export const IVIE_HANDOFF_PRECLINICAL_SPECIES = IVIE_PRECLINICAL_SPECIES;
