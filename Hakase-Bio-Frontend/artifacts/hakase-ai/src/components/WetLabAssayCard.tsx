import { useMemo } from "react";
import { FlaskConical, Beaker, Activity, AlertTriangle } from "lucide-react";
import { buildWetLabReport, type WetLabAssayReport } from "@/lib/wetLabAssay";

type Props = {
  smiles: string;
  ic50_nM: number;
  hillCoefficient: number;
  maxInhibition_pct: number;
  therapeuticArea?: string;
};

export function WetLabAssayCard({
  smiles,
  ic50_nM,
  hillCoefficient,
  maxInhibition_pct,
  therapeuticArea,
}: Props) {
  const report: WetLabAssayReport = useMemo(
    () =>
      buildWetLabReport({
        smiles,
        ic50_nM,
        hillCoefficient,
        maxInhibition_pct,
        therapeuticArea,
      }),
    [smiles, ic50_nM, hillCoefficient, maxInhibition_pct, therapeuticArea],
  );

  const { kit, controls, replicates, fit, fittedCurve, qualityVerdict } = report;

  return (
    <div className="space-y-4">
      {/* Anti-fabrication banner */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-[10px] text-amber-200/80 leading-relaxed">
          <span className="font-semibold text-amber-300">Model-derived wet-lab presentation.</span>{" "}
          Raw RLU and replicates are back-derived from the simulator's IC50 / Hill /
          max-inhibition for verification-readiness review. They are not measured values —
          they are the format the bench would produce if the prediction is correct.
        </div>
      </div>

      {/* Assay header */}
      <div className="bg-[#0d0f17] border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-violet-400" />
            <div>
              <div className="text-[12px] font-semibold text-white">{kit.name}</div>
              <div className="text-[10px] text-slate-500">{kit.vendor} · {kit.readout}</div>
            </div>
          </div>
          <span
            className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${
              qualityVerdict === "Excellent"
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                : qualityVerdict === "Acceptable"
                  ? "bg-yellow-500/10 text-yellow-300 border-yellow-500/30"
                  : "bg-red-500/10 text-red-300 border-red-500/30"
            }`}
            title="Z'-factor based assay quality verdict"
          >
            Z' = {controls.z_prime} · {qualityVerdict}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-[10px]">
          <Cell label="Incubation" value={`${kit.incubationMin} min`} />
          <Cell label="ATP" value={kit.atpConc_uM != null ? `${kit.atpConc_uM} µM` : "n/a"} />
          <Cell label="Replicates" value="n = 3" />
          <Cell label="Format" value="384-well" />
        </div>
        <div className="text-[10px] text-slate-500 leading-relaxed">{kit.notes}</div>
      </div>

      {/* Controls */}
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Beaker className="w-3.5 h-3.5 text-cyan-400" />
          <div className="text-[11px] font-semibold text-slate-300">Plate Controls</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Cell label="DMSO (0% inh.)" value={`${controls.dmso_mean.toLocaleString()} ± ${controls.dmso_sd.toLocaleString()} RLU`} />
          <Cell label={kit.positiveControl} value={`${controls.positive_mean.toLocaleString()} ± ${controls.positive_sd.toLocaleString()} RLU`} />
          <Cell label="Signal window" value={controls.signal_window.toLocaleString()} />
        </div>
      </div>

      {/* Raw replicates table */}
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <Activity className="w-3.5 h-3.5 text-violet-400" />
          <div className="text-[11px] font-semibold text-slate-300">Raw Replicate Data (8-point, 1:3 serial)</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-white/[0.03] text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">[Compound] (µM)</th>
                <th className="text-right px-2 py-2 font-medium">Rep 1</th>
                <th className="text-right px-2 py-2 font-medium">Rep 2</th>
                <th className="text-right px-2 py-2 font-medium">Rep 3</th>
                <th className="text-right px-2 py-2 font-medium">Mean RLU</th>
                <th className="text-right px-2 py-2 font-medium">SD</th>
                <th className="text-right px-2 py-2 font-medium">CV</th>
                <th className="text-right px-3 py-2 font-medium">% Inhibition</th>
              </tr>
            </thead>
            <tbody className="text-slate-300 font-mono">
              {replicates.map((r, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-1.5 text-violet-300">{r.concentration_uM.toFixed(4).replace(/\.?0+$/, "")}</td>
                  <td className="px-2 py-1.5 text-right">{r.raw_rlu[0].toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{r.raw_rlu[1].toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{r.raw_rlu[2].toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-white">{r.mean_rlu.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.sd_rlu.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.cv_pct}%</td>
                  <td className="px-3 py-1.5 text-right text-emerald-300">{r.normalized_pct}% ± {r.normalized_sd_pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4PL Fit Parameters */}
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-4">
        <div className="text-[11px] font-semibold text-slate-300 mb-3">4-Parameter Logistic (4PL) Fit</div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-[10px]">
          <Cell label="Bottom" value={`${fit.bottom}%`} />
          <Cell label="Top" value={`${fit.top}%`} />
          <Cell label="IC50" value={`${fit.ic50_uM} µM`} highlight />
          <Cell label="log(IC50)" value={fit.log_ic50.toString()} />
          <Cell label="Hill Slope" value={fit.hill_slope.toString()} />
          <Cell label="R²" value={fit.r_squared.toString()} />
        </div>
        <div className="text-[10px] text-slate-500 mt-3 font-mono leading-relaxed">
          y = {fit.bottom} + ({fit.top} − {fit.bottom}) / (1 + 10^(({fit.log_ic50} − log[X]) × {fit.hill_slope}))
        </div>
      </div>

      {/* Wet-lab style chart with error bars */}
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-4">
        <div className="text-[11px] font-semibold text-slate-300 mb-3">Dose-Response Plot (publication style)</div>
        <WetLabPlot replicates={replicates} fittedCurve={fittedCurve} ic50_uM={fit.ic50_uM} />
        <div className="text-[10px] text-slate-500 text-center mt-2 italic">
          Points: triplicate mean ± SD · Curve: 4PL fit · Dashed: IC50
        </div>
      </div>

      {/* Bench verification footer */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
        <FlaskConical className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
        <div className="text-[10px] text-cyan-100/80 leading-relaxed">
          <span className="font-semibold text-cyan-300">To verify at the bench:</span>{" "}
          Run the {kit.name} ({kit.vendor}) with this 8-point dilution and {kit.positiveControl} as positive control.
          Compare measured IC50 within 3-fold and Hill slope within ±0.3 of the predicted values above.
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white/[0.04] rounded-md px-2.5 py-1.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[11px] font-semibold mt-0.5 ${highlight ? "text-violet-300" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

type WetLabPlotProps = {
  replicates: Array<{ concentration_uM: number; normalized_pct: number; normalized_sd_pct: number }>;
  fittedCurve: Array<{ concentration_uM: number; response_pct: number }>;
  ic50_uM: number;
};

function WetLabPlot({ replicates, fittedCurve, ic50_uM }: WetLabPlotProps) {
  const W = 600, H = 280;
  const pad = { l: 56, r: 18, t: 14, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const xs = [...replicates.map((r) => r.concentration_uM), ...fittedCurve.map((p) => p.concentration_uM)];
  const minLog = Math.log10(Math.min(...xs)) - 0.1;
  const maxLog = Math.log10(Math.max(...xs)) + 0.1;
  const toX = (c: number) => pad.l + ((Math.log10(c) - minLog) / (maxLog - minLog)) * innerW;
  const toY = (p: number) => pad.t + innerH - (p / 100) * innerH;

  const linePath = fittedCurve
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.concentration_uM).toFixed(1)},${toY(p.response_pct).toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [0.001, 0.01, 0.1, 1, 10].filter((t) => Math.log10(t) >= minLog && Math.log10(t) <= maxLog);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
      {/* y grid + labels */}
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={pad.l} y1={toY(t)} x2={W - pad.r} y2={toY(t)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="2,3" />
          <text x={pad.l - 8} y={toY(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{t}%</text>
        </g>
      ))}
      {/* x ticks */}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={toX(t)} y1={H - pad.b} x2={toX(t)} y2={H - pad.b + 4} stroke="#475569" strokeWidth="1" />
          <text x={toX(t)} y={H - pad.b + 14} textAnchor="middle" fontSize="9" fill="#64748b">{t}</text>
        </g>
      ))}
      {/* axes */}
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#475569" strokeWidth="1" />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#475569" strokeWidth="1" />
      {/* y label */}
      <text x={14} y={pad.t + innerH / 2} fontSize="9" fill="#94a3b8" transform={`rotate(-90 14 ${pad.t + innerH / 2})`} textAnchor="middle">% Inhibition (mean ± SD)</text>
      {/* x label */}
      <text x={pad.l + innerW / 2} y={H - 6} fontSize="9" fill="#94a3b8" textAnchor="middle">[Compound] (µM, log scale)</text>

      {/* Fitted 4PL curve */}
      <path d={linePath} fill="none" stroke="#ef4444" strokeWidth="2" />

      {/* IC50 dashed line */}
      {Math.log10(ic50_uM) >= minLog && Math.log10(ic50_uM) <= maxLog && (
        <>
          <line x1={toX(ic50_uM)} y1={pad.t} x2={toX(ic50_uM)} y2={H - pad.b} stroke="#f59e0b" strokeDasharray="4,4" strokeWidth="1" />
          <text x={toX(ic50_uM) + 4} y={pad.t + 10} fontSize="9" fill="#f59e0b">IC50 = {ic50_uM} µM</text>
        </>
      )}

      {/* Data points with error bars */}
      {replicates.map((r, i) => {
        const cx = toX(r.concentration_uM);
        const cy = toY(r.normalized_pct);
        const eUp = toY(Math.min(100, r.normalized_pct + r.normalized_sd_pct));
        const eDown = toY(Math.max(0, r.normalized_pct - r.normalized_sd_pct));
        return (
          <g key={i}>
            <line x1={cx} y1={eUp} x2={cx} y2={eDown} stroke="#1f77b4" strokeWidth="1.4" />
            <line x1={cx - 4} y1={eUp} x2={cx + 4} y2={eUp} stroke="#1f77b4" strokeWidth="1.4" />
            <line x1={cx - 4} y1={eDown} x2={cx + 4} y2={eDown} stroke="#1f77b4" strokeWidth="1.4" />
            <circle cx={cx} cy={cy} r="3.5" fill="#1f77b4" stroke="#0d0f17" strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
}
