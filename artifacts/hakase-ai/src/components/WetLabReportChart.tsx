type ChartPayload = {
  ic50_uM: number;
  hill: number;
  top: number;
  bottom: number;
  r_squared: number;
  replicates: Array<{ concentration_uM: number; normalized_pct: number; normalized_sd_pct: number }>;
  fittedCurve: Array<{ concentration_uM: number; response_pct: number }>;
};

type Props = { payload: ChartPayload };

export function WetLabReportChart({ payload }: Props) {
  const { replicates, fittedCurve, ic50_uM, hill, top, bottom, r_squared } = payload;
  const W = 760;
  const H = 360;
  const pad = { l: 64, r: 24, t: 18, b: 48 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const xs = [
    ...replicates.map((r) => r.concentration_uM),
    ...fittedCurve.map((p) => p.concentration_uM),
  ].filter((v) => v > 0);
  const minLog = Math.log10(Math.min(...xs)) - 0.1;
  const maxLog = Math.log10(Math.max(...xs)) + 0.1;
  const toX = (c: number) => pad.l + ((Math.log10(c) - minLog) / (maxLog - minLog)) * innerW;
  const toY = (p: number) => pad.t + innerH - (p / 100) * innerH;

  const linePath = fittedCurve
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.concentration_uM).toFixed(1)},${toY(p.response_pct).toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [0.001, 0.01, 0.1, 1, 10, 100].filter(
    (t) => Math.log10(t) >= minLog && Math.log10(t) <= maxLog,
  );

  return (
    <figure className="wet-lab-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dose-response curve">
        <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
        {/* y grid + labels */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} y1={toY(t)} x2={W - pad.r} y2={toY(t)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
            <text x={pad.l - 10} y={toY(t) + 4} textAnchor="end" fontSize="11" fill="#475569">{t}%</text>
          </g>
        ))}
        {/* x ticks + labels */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={toX(t)} y1={H - pad.b} x2={toX(t)} y2={H - pad.b + 5} stroke="#475569" strokeWidth="1" />
            <text x={toX(t)} y={H - pad.b + 18} textAnchor="middle" fontSize="11" fill="#475569">{t}</text>
          </g>
        ))}
        {/* axes */}
        <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#0f172a" strokeWidth="1.2" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#0f172a" strokeWidth="1.2" />
        {/* axis labels */}
        <text
          x={18}
          y={pad.t + innerH / 2}
          fontSize="11"
          fill="#0f172a"
          fontWeight="600"
          transform={`rotate(-90 18 ${pad.t + innerH / 2})`}
          textAnchor="middle"
        >
          % Inhibition (mean ± SD, n=3)
        </text>
        <text
          x={pad.l + innerW / 2}
          y={H - 10}
          fontSize="11"
          fill="#0f172a"
          fontWeight="600"
          textAnchor="middle"
        >
          [Compound] (µM, log₁₀ scale)
        </text>

        {/* Fitted 4PL curve */}
        <path d={linePath} fill="none" stroke="#dc2626" strokeWidth="2.2" />

        {/* IC50 marker */}
        {Math.log10(ic50_uM) >= minLog && Math.log10(ic50_uM) <= maxLog && (
          <g>
            <line x1={toX(ic50_uM)} y1={pad.t} x2={toX(ic50_uM)} y2={H - pad.b} stroke="#d97706" strokeDasharray="5,4" strokeWidth="1.2" />
            <text x={toX(ic50_uM) + 5} y={pad.t + 12} fontSize="11" fill="#b45309" fontWeight="600">
              IC₅₀ = {ic50_uM.toFixed(3)} µM
            </text>
          </g>
        )}

        {/* Data points + error bars */}
        {replicates.map((r, i) => {
          const cx = toX(r.concentration_uM);
          const cy = toY(r.normalized_pct);
          const eUp = toY(Math.min(100, r.normalized_pct + r.normalized_sd_pct));
          const eDown = toY(Math.max(0, r.normalized_pct - r.normalized_sd_pct));
          return (
            <g key={i}>
              <line x1={cx} y1={eUp} x2={cx} y2={eDown} stroke="#1d4ed8" strokeWidth="1.5" />
              <line x1={cx - 5} y1={eUp} x2={cx + 5} y2={eUp} stroke="#1d4ed8" strokeWidth="1.5" />
              <line x1={cx - 5} y1={eDown} x2={cx + 5} y2={eDown} stroke="#1d4ed8" strokeWidth="1.5" />
              <circle cx={cx} cy={cy} r="4.5" fill="#1d4ed8" stroke="#ffffff" strokeWidth="1.4" />
            </g>
          );
        })}

        {/* Fit summary box */}
        <g>
          <rect x={W - pad.r - 168} y={pad.t + 6} width={160} height={62} fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" rx={4} />
          <text x={W - pad.r - 160} y={pad.t + 22} fontSize="10" fill="#0f172a" fontWeight="700">4-Parameter Logistic Fit</text>
          <text x={W - pad.r - 160} y={pad.t + 36} fontSize="10" fill="#334155">Top = {top.toFixed(1)}%  ·  Bottom = {bottom.toFixed(1)}%</text>
          <text x={W - pad.r - 160} y={pad.t + 50} fontSize="10" fill="#334155">Hill h = {hill.toFixed(2)}</text>
          <text x={W - pad.r - 160} y={pad.t + 62} fontSize="10" fill="#334155">R² = {r_squared.toFixed(4)}</text>
        </g>
      </svg>
      <figcaption>
        Figure 6.3 — 4PL dose–response fit (red curve) over triplicate normalized inhibition points
        (blue, error bars = SD). Dashed orange = IC₅₀.
      </figcaption>
    </figure>
  );
}
