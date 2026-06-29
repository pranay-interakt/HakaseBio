/**
 * IVIVE Substrate Inputs Panel
 *
 * P0 input substrate for the IVIVE Calibration engine. Captures three
 * cross-species measurements (fu_p, fu_mic, B/P) the biotech brings from
 * their CRO. Per anti-fabrication policy: missing cells render `—`, never a
 * synthetic default.
 *
 * Designed for the small-biotech reality:
 *   - Cheap to enter what they have (per-cell input).
 *   - Visible what's missing (tier badge + cross-species banner).
 *   - Provenance per cell (assay method + notes), not a single bag for the
 *     whole panel.
 *   - Persists locally so the form survives reloads.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Beaker, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Info, Save, RefreshCw, Wand2,
} from "lucide-react";

import {
  IVIE_SPECIES, IVIE_PRECLINICAL_SPECIES, IVIE_SPECIES_LABEL,
  IVIE_MEASUREMENT_LABEL, IVIE_MEASUREMENT_UNIT, IVIE_MEASUREMENT_HELP,
  emptyIvieWetLabInputs, validateIvieValue, assessIvieTier,
  autoFillIvieEstimates, hasEstimatedCells,
  saveIvieWetLabInputs, loadIvieWetLabInputs,
  type IvieWetLabInputs, type IvieSpecies, type IvieMeasurement, type IvieTier,
} from "@/lib/ivieInputs";

const TIER_STYLE: Record<IvieTier, { label: string; cls: string; helpFor: "Minimum" | "Standard" | "Premium" | null }> = {
  Insufficient: { label: "INSUFFICIENT", cls: "bg-rose-500/15 text-rose-300 border-rose-500/40", helpFor: "Minimum" },
  Minimum:      { label: "MINIMUM",      cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", helpFor: "Standard" },
  Standard:     { label: "STANDARD",     cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40", helpFor: "Premium" },
  Premium:      { label: "PREMIUM",      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", helpFor: null },
};

interface CellEditState { error: string | null; }

interface Props {
  value: IvieWetLabInputs;
  onChange: (next: IvieWetLabInputs) => void;
  /** When true, render only a compact summary (used inside the L3 panel). */
  compact?: boolean;
  /** Default expanded state (only relevant when not compact). */
  defaultExpanded?: boolean;
}

export function IvieInputsPanel({ value, onChange, compact = false, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeMeasurement, setActiveMeasurement] = useState<IvieMeasurement>("fuPlasma");
  const [cellErrors, setCellErrors] = useState<Record<string, CellEditState>>({});
  const [savedFlash, setSavedFlash] = useState(false);

  const assessment = useMemo(() => assessIvieTier(value), [value]);

  function update(measurement: IvieMeasurement, sp: IvieSpecies, patch: Partial<IvieWetLabInputs[IvieMeasurement][IvieSpecies]>) {
    const next: IvieWetLabInputs = {
      ...value,
      [measurement]: { ...value[measurement], [sp]: { ...value[measurement][sp], ...patch } },
      enteredAt: new Date().toISOString(),
    };
    onChange(next);
  }

  function handleValueInput(measurement: IvieMeasurement, sp: IvieSpecies, raw: string) {
    const cellKey = `${measurement}:${sp}`;
    if (raw.trim() === "") {
      // Clearing a cell also clears any provenance — back to a true empty.
      update(measurement, sp, { value: null, provenance: "measured", estimateSource: undefined });
      setCellErrors((e) => ({ ...e, [cellKey]: { error: null } }));
      return;
    }
    const num = Number(raw);
    if (!isFinite(num)) {
      setCellErrors((e) => ({ ...e, [cellKey]: { error: "not a number" } }));
      return;
    }
    const v = validateIvieValue(measurement, num);
    if (!v.ok) {
      setCellErrors((e) => ({ ...e, [cellKey]: { error: v.reason ?? "invalid" } }));
      // Still write null so the panel stays honest about not having a value
      update(measurement, sp, { value: null, provenance: "measured", estimateSource: undefined });
      return;
    }
    setCellErrors((e) => ({ ...e, [cellKey]: { error: null } }));
    // Any user-typed value flips the cell back to "measured" — even if the
    // panel had previously auto-populated it. This is how an estimate is
    // upgraded once real CRO data arrives.
    update(measurement, sp, { value: num, provenance: "measured", estimateSource: undefined });
  }

  function handleAutoFill() {
    onChange(autoFillIvieEstimates(value));
  }

  function handleSave() {
    saveIvieWetLabInputs(value);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function handleReset() {
    if (typeof window !== "undefined" && !window.confirm("Clear all IVIVE substrate inputs? This cannot be undone.")) return;
    onChange(emptyIvieWetLabInputs());
  }

  const tierStyle = TIER_STYLE[assessment.tier];

  // ─── Compact summary (for embedding inside other panels) ───────────────────
  if (compact) {
    return (
      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-2 flex items-center gap-3">
        <Beaker className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-300">IVIVE substrate inputs</span>
        <span className="text-[10px] text-slate-500">
          {Math.round(assessment.completionFraction * 100)}% complete · {assessment.crossSpeciesRuleSatisfied ? "cross-species rule satisfied" : "cross-species rule not satisfied"}
        </span>
      </div>
    );
  }

  // ─── Full panel ────────────────────────────────────────────────────────────
  return (
    <section className="border-b border-white/8 bg-cyan-950/[0.06]">
      {/* Header strip */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
        data-testid="ivie-inputs-toggle"
      >
        <div className="w-7 h-7 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <Beaker className="w-3.5 h-3.5 text-cyan-300" />
        </div>
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-widest">IVIVE Substrate Inputs</span>
            {assessment.crossSpeciesRuleSatisfied ? (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                <CheckCircle2 className="w-2.5 h-2.5" /> cross-species rule
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                <AlertTriangle className="w-2.5 h-2.5" /> cross-species rule unmet
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
            fu_p · fu_mic · B/P across human + 4 preclinical species — defensibility substrate for IVIVE calibration
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-slate-500">{Math.round(assessment.completionFraction * 100)}% complete</span>
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3">
          {/* Cross-species banner */}
          {!assessment.crossSpeciesRuleSatisfied && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-[11px] text-amber-200/90 leading-snug">
                <span className="font-semibold">Cross-species rule unmet.</span>{" "}
                IVIVE can predict human PK from human-only data, but cannot calibrate the species translation.
                L3 study design will be flagged "best guess" until you supply at least one preclinical-species value
                for fu_p AND B/P.
              </div>
            </div>
          )}


          {/* Measurement tabs */}
          <div className="flex items-center gap-1 border-b border-white/8">
            {(Object.keys(IVIE_MEASUREMENT_LABEL) as IvieMeasurement[]).map((m) => (
              <button
                key={m}
                onClick={() => setActiveMeasurement(m)}
                data-testid={`ivie-measurement-${m}`}
                className={`px-3 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
                  activeMeasurement === m
                    ? "border-cyan-400 text-cyan-200"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {IVIE_MEASUREMENT_LABEL[m]}
              </button>
            ))}
          </div>

          {/* Help line */}
          <div className="text-[10px] text-slate-500 italic">
            {IVIE_MEASUREMENT_HELP[activeMeasurement]} · Unit: {IVIE_MEASUREMENT_UNIT[activeMeasurement]}
          </div>

          {/* Per-species cells */}
          <div className="rounded-md border border-white/8 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-white/[0.03] text-slate-400">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold w-[140px]">Species</th>
                  <th className="text-left px-3 py-1.5 font-semibold w-[100px]">Value</th>
                  <th className="text-left px-3 py-1.5 font-semibold">Assay method</th>
                  <th className="text-left px-3 py-1.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {IVIE_SPECIES.map((sp, idx) => {
                  const cell = value[activeMeasurement][sp];
                  const cellKey = `${activeMeasurement}:${sp}`;
                  const err = cellErrors[cellKey]?.error;
                  const isHuman = sp === "human";
                  const isPre = IVIE_PRECLINICAL_SPECIES.includes(sp);
                  const isEstimated = cell.value !== null && cell.provenance === "estimated";
                  return (
                    <tr key={sp} className={`border-t border-white/5 ${idx % 2 === 0 ? "bg-white/[0.01]" : ""}`}>
                      <td className="px-3 py-1.5">
                        <span className="text-slate-200">{IVIE_SPECIES_LABEL[sp]}</span>
                        {isHuman && <span className="ml-1 text-[9px] uppercase text-amber-400 font-semibold">required</span>}
                        {isPre   && <span className="ml-1 text-[9px] uppercase text-slate-500">preclinical</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            // key forces React to remount the input when the
                            // cell value changes externally (e.g. via Auto-fill),
                            // so `defaultValue` reflects the new value instead
                            // of the stale uncontrolled value.
                            key={`${cell.value ?? "_"}:${cell.provenance ?? "measured"}`}
                            type="number"
                            step="0.001"
                            min={0}
                            inputMode="decimal"
                            defaultValue={cell.value === null ? "" : String(cell.value)}
                            placeholder="—"
                            onBlur={(e) => handleValueInput(activeMeasurement, sp, e.target.value)}
                            data-testid={`ivie-value-${activeMeasurement}-${sp}`}
                            className={`flex-1 bg-slate-900/50 border rounded px-2 py-1 text-[11px] focus:outline-none focus:border-cyan-400 ${
                              err ? "border-rose-500/60"
                              : isEstimated ? "border-orange-500/40 text-orange-200"
                              : "border-white/10 text-slate-100"
                            }`}
                          />
                          {isEstimated && (
                            <span
                              title="Lombardo / Smith CLASS-MEDIAN anchor — replace with a LITERATURE (DOI/PMID for this compound or Tanimoto ≥ 0.4 congener) or IN-HOUSE (assay method + lab + date) value to satisfy the cross-species rule."
                              className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded border border-orange-500/40 bg-orange-500/10 text-orange-300 font-bold"
                            >
                              AUTO
                            </span>
                          )}
                        </div>
                        {err && <div className="text-[9px] text-rose-400 mt-0.5">{err}</div>}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          defaultValue={cell.assayMethod}
                          placeholder="e.g. equilibrium dialysis, 37°C, 4h"
                          onBlur={(e) => update(activeMeasurement, sp, { assayMethod: e.target.value })}
                          data-testid={`ivie-method-${activeMeasurement}-${sp}`}
                          className="w-full bg-slate-900/50 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          defaultValue={cell.notes}
                          placeholder="lot, source, deviations"
                          onBlur={(e) => update(activeMeasurement, sp, { notes: e.target.value })}
                          data-testid={`ivie-notes-${activeMeasurement}-${sp}`}
                          className="w-full bg-slate-900/50 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-cyan-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Class-median fallback notice — only when at least one cell is currently a class-median anchor. */}
          {hasEstimatedCells(value) && (
            <div className="rounded-md border border-orange-500/30 bg-orange-500/[0.06] px-3 py-2 flex items-start gap-2">
              <Wand2 className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-[11px] text-orange-200/95 leading-snug">
                <span className="font-semibold">Class-median substrate active.</span>{" "}
                One or more cells use Lombardo / Smith drug-class anchors (orange "AUTO" pill — legacy badge; per-cell badge split is a planned schema follow-up). The
                cross-species rule still reads as <span className="font-semibold">UNMET</span> —
                only LITERATURE or IN-HOUSE cells satisfy the rule. Type any cell to upgrade it to
                a literature or in-house value, or proceed via the L2 → L3 handoff which will
                require an explicit class-median sign-off.
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center gap-3 pt-1">
            <input
              type="text"
              defaultValue={value.enteredBy}
              placeholder="Entered by (name / role)"
              onBlur={(e) => onChange({ ...value, enteredBy: e.target.value })}
              data-testid="ivie-entered-by"
              className="flex-1 bg-slate-900/50 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400"
            />
            <button
              onClick={handleAutoFill}
              data-testid="ivie-auto-fill"
              title="Fill empty cells with Lombardo / Smith CLASS-MEDIAN anchors (tagged AUTO; never overwrites LITERATURE or IN-HOUSE values)"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-100 text-[11px] font-semibold transition-colors"
            >
              <Wand2 className="w-3 h-3" /> Auto-fill empty cells
            </button>
            <button
              onClick={handleSave}
              data-testid="ivie-save"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-100 text-[11px] font-semibold transition-colors"
            >
              <Save className="w-3 h-3" /> {savedFlash ? "Saved" : "Save"}
            </button>
            <button
              onClick={handleReset}
              data-testid="ivie-reset"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-200 text-[11px] font-semibold transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Clear all
            </button>
          </div>
          {value.enteredAt && (
            <div className="text-[10px] text-slate-500">
              Last edited {new Date(value.enteredAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Boot helper — restores any persisted inputs on first mount, falls back to
 * an empty matrix. Use as the initializer in `useState`.
 */
export function bootstrapIvieInputs(): IvieWetLabInputs {
  return loadIvieWetLabInputs() ?? emptyIvieWetLabInputs();
}

/**
 * Side-effect hook — auto-persists whenever the inputs change. Mount once at
 * the page root after `useState`.
 */
export function useIvieInputsAutosave(inputs: IvieWetLabInputs) {
  useEffect(() => {
    saveIvieWetLabInputs(inputs);
  }, [inputs]);
}
