/**
 * Chart primitives.
 *
 * Every component renders a series, a count or a fraction the caller has
 * already taken from an engine record. None derives a scientific quantity,
 * interpolates between points, or turns a set of statuses into a composite
 * score. Each chart restates its exact values in text beside the drawing, so
 * the figure is never the only record of them.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Tone } from "../lib/format";
import { t } from "../i18n";

export type Point = { label: string; value: number; detail?: string; tone?: Tone };

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude < 0.001 || magnitude >= 1e5) return value.toExponential(1);
  if (magnitude < 1) return Number(value.toFixed(3)).toString();
  if (magnitude < 100) return Number(value.toFixed(2)).toString();
  return Number(value.toFixed(0)).toString();
}

/**
 * Measures how far the browser has scaled the figure's viewBox and publishes it
 * as `--cscale`.
 *
 * SVG text is sized in viewBox units, so the same `font-size` rendered at 11
 * came out near 18px in a full-width chart and near 9px in a half-width one —
 * the axis labels were a different size in every panel, and unreadable in the
 * narrow ones. The stylesheet divides its intended pixel sizes by this ratio,
 * which lands every chart's type at the same size on screen.
 */
function useViewBoxScale() {
  const ref = useRef<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const measure = () => {
      const width = svg.getBoundingClientRect().width;
      const units = svg.viewBox.baseVal?.width;
      if (width > 0 && units > 0) setScale(Number((width / units).toFixed(3)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
    // Mount-only: the svg is rendered in the same commit as this frame, and the
    // observer covers every resize after that. Re-running per render would tear
    // down and rebuild the observer on every parent state change.
  }, []);
  return { ref, scale };
}

function ChartFrame({ title, subtitle, badge, children, footer }: {
  title: string; subtitle?: string; badge?: string; children: ReactNode; footer?: ReactNode;
}) {
  const { ref, scale } = useViewBoxScale();
  return <figure ref={ref as React.RefObject<HTMLElement>} className="chart"
    style={{ margin: 0, ["--cscale" as string]: scale }}>
    <figcaption className="chart-head">
      <div><b>{t(title)}</b>{subtitle && <span>{t(subtitle)}</span>}</div>
      {badge && <small>{t(badge)}</small>}
    </figcaption>
    {children}
    {footer && <p className="chart-foot">{footer}</p>}
  </figure>;
}

/* ── donuts ─────────────────────────────────────────────────────────────── */

export function MetricDonut({ value, total, label, caption, tone = "brand" }: {
  value: number; total: number; label: string; caption?: string; tone?: Tone | "brand";
}) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  const clamped = Math.max(0, Math.min(value, total));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return <div>
    <div className="donut">
      <div className="donut-ring">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle className="donut-track" cx="56" cy="56" r={radius} />
          <circle className={`donut-arc ${tone}`} cx="56" cy="56" r={radius} strokeDasharray={`${circumference * (clamped / total)} ${circumference}`} />
        </svg>
        <div className="donut-centre"><b>{clamped}<i>/{total}</i></b><small>{t(label)}</small></div>
      </div>
    </div>
    {caption && <p className="donut-caption">{t(caption)}</p>}
  </div>;
}

export type Segment = { key: string; label: string; value: number; tone?: Tone };

export function SegmentDonut({ segments, centreValue, centreTotal, centreLabel, caption }: {
  segments: Segment[]; centreValue: number; centreTotal: number; centreLabel: string; caption?: string;
}) {
  const present = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = present.reduce((sum, segment) => sum + segment.value, 0);
  if (!present.length || total <= 0 || !Number.isFinite(centreTotal) || centreTotal <= 0) return null;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const gap = present.length > 1 ? Math.min(3, circumference / (present.length * 9)) : 0;
  let consumed = 0;
  return <div>
    <div className="donut">
      <div className="donut-ring" role="img" aria-label={`${centreLabel}: ${centreValue} of ${centreTotal}. ${present.map((segment) => `${segment.value} ${segment.label}`).join(", ")}.`}>
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle className="donut-track" cx="56" cy="56" r={radius} />
          {present.map((segment) => {
            const arc = (segment.value / total) * circumference;
            const offset = -consumed;
            consumed += arc;
            return <circle key={segment.key} className={`donut-arc ${segment.tone ?? "neutral"}`} cx="56" cy="56" r={radius}
              strokeDasharray={`${Math.max(arc - gap, 0.5)} ${circumference}`} strokeDashoffset={offset} />;
          })}
        </svg>
        <div className="donut-centre"><b>{centreValue}<i>/{centreTotal}</i></b><small>{centreLabel}</small></div>
      </div>
      <ul className="donut-legend">
        {present.map((segment) => <li key={segment.key}>
          <i className={segment.tone ?? "neutral"} />
          <span>{t(segment.label)}</span>
          <b>{segment.value}</b>
          <em>{Math.round((segment.value / total) * 100)}%</em>
        </li>)}
      </ul>
    </div>
    {caption && <p className="donut-caption">{t(caption)}</p>}
  </div>;
}

/* ── bar chart ──────────────────────────────────────────────────────────── */

export function BarChart({ title, subtitle, points, valueLabel, axisLabel, reference, footnote, logScale }: {
  title: string; subtitle?: string; points: Point[]; valueLabel?: string; axisLabel?: string;
  reference?: { value: number; label: string }; footnote?: ReactNode; logScale?: boolean;
}) {
  const values = points.filter((point) => Number.isFinite(point.value));
  if (!values.length) return null;
  const width = 660, height = 250, left = 66, right = 22, top = 30, bottom = 58;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const transform = (value: number) => (logScale ? Math.log10(Math.max(value, 1e-6)) : value);
  const raw = values.map((point) => transform(point.value));
  const referenceValue = reference && Number.isFinite(reference.value) ? transform(reference.value) : null;
  const peak = Math.max(...raw, referenceValue ?? -Infinity);
  const floor = logScale ? Math.min(...raw, referenceValue ?? Infinity) : Math.min(0, ...raw);
  const span = peak - floor || Math.abs(peak) || 1;
  const maximum = peak + span * 0.16;
  const minimum = logScale ? floor - span * 0.08 : floor;
  const y = (value: number) => top + ((maximum - value) / (maximum - minimum || 1)) * plotHeight;
  const slot = plotWidth / values.length;
  const barWidth = Math.min(52, slot * 0.58);
  const centre = (index: number) => left + slot * index + slot / 2;
  const ticks = [minimum, minimum + (maximum - minimum) / 2, maximum];

  return <ChartFrame title={title} subtitle={subtitle} badge={valueLabel}
    footer={(reference || footnote) ? <>{reference && <span className="chart-key"><i />{reference.label}</span>}{footnote}</> : undefined}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${values.map((point) => `${point.label}: ${point.detail ?? point.value}`).join(". ")}`}>
      {ticks.map((tick, index) => <g key={index}>
        <line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
        <text className="chart-axis" x={left - 9} y={y(tick) + 4} textAnchor="end">{logScale ? fmt(10 ** tick) : fmt(tick)}</text>
      </g>)}
      {referenceValue !== null && referenceValue <= maximum && <line className="chart-ref" x1={left} x2={width - right} y1={y(referenceValue)} y2={y(referenceValue)} />}
      {values.map((point, index) => {
        const barTop = y(Math.max(transform(point.value), logScale ? minimum : 0));
        const barBase = y(logScale ? minimum : Math.min(transform(point.value), 0));
        return <g key={`${point.label}-${index}`}>
          <rect className={`bar ${point.tone ?? "neutral"}`} x={centre(index) - barWidth / 2} y={barTop}
            width={barWidth} height={Math.max(barBase - barTop, 2)} rx="5" />
          <text className="bar-value" x={centre(index)} y={barTop - 8} textAnchor="middle">{point.detail ?? fmt(point.value)}</text>
          <text className="chart-axis" x={centre(index)} y={height - bottom + 20} textAnchor="middle">{point.label}</text>
          <title>{`${point.label}: ${point.detail ?? point.value}`}</title>
        </g>;
      })}
      {axisLabel && <text className="chart-axis-title" x={left + plotWidth / 2} y={height - 10} textAnchor="middle">{axisLabel}</text>}
    </svg>
  </ChartFrame>;
}

/* ── ranked horizontal bars ─────────────────────────────────────────────── */

export function RankChart({ title, subtitle, points, valueLabel, domain, reference, footnote }: {
  title: string; subtitle?: string; points: Point[]; valueLabel?: string;
  domain?: [number, number]; reference?: { value: number; label: string }; footnote?: ReactNode;
}) {
  const values = points.filter((point) => Number.isFinite(point.value));
  if (!values.length) return null;
  const observedMax = Math.max(...values.map((point) => point.value), reference && Number.isFinite(reference.value) ? reference.value : 0);
  const observedMin = Math.min(0, ...values.map((point) => point.value));
  const [minimum, maximum] = domain ?? [observedMin, observedMax * 1.1 || 1];
  const width = (value: number) => `${Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum || 1))) * 100}%`;
  return <ChartFrame title={title} subtitle={subtitle} badge={valueLabel}
    footer={(reference || footnote) ? <>{reference && <span className="chart-key"><i />{reference.label}</span>}{footnote}</> : undefined}>
    <ol className="rank-rows">
      {values.map((point, index) => <li key={`${point.label}-${index}`}>
        <span className="rank-label" title={t(point.label)}>{t(point.label)}</span>
        <span className="rank-track">
          {reference && Number.isFinite(reference.value) && <i className="rank-ref" style={{ left: width(reference.value) }} title={reference.label} />}
          <i className={`rank-fill ${point.tone ?? "neutral"}`} style={{ width: width(point.value) }} />
        </span>
        <b className="rank-value">{point.detail ?? fmt(point.value)}</b>
      </li>)}
    </ol>
  </ChartFrame>;
}

/* ── line / area ────────────────────────────────────────────────────────── */

export function LineChart({ title, subtitle, points, valueLabel, footnote, logScale }: {
  title: string; subtitle?: string; points: Point[]; valueLabel?: string; footnote?: ReactNode; logScale?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const values = points.filter((point) => Number.isFinite(point.value));
  if (values.length < 2) return null;
  const width = 660, height = 230, left = 60, right = 24, top = 22, bottom = 48;
  const transform = (value: number) => (logScale ? Math.log10(Math.max(value, 1e-9)) : value);
  const raw = values.map((point) => transform(point.value));
  const rawMin = Math.min(...raw), rawMax = Math.max(...raw);
  const range = rawMax - rawMin || Math.abs(rawMax) || 1;
  const minimum = rawMin - range * 0.14, maximum = rawMax + range * 0.14;
  const x = (index: number) => left + (index / Math.max(values.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((maximum - value) / (maximum - minimum || 1)) * (height - top - bottom);
  const polyline = values.map((point, index) => `${x(index)},${y(transform(point.value))}`).join(" ");
  const area = `${left},${height - bottom} ${polyline} ${x(values.length - 1)},${height - bottom}`;
  const ticks = [minimum, (minimum + maximum) / 2, maximum];
  return <ChartFrame title={title} subtitle={subtitle} badge={valueLabel} footer={footnote}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${subtitle ?? ""}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick, index) => <g key={index}>
        <line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
        <text className="chart-axis" x={left - 8} y={y(tick) + 4} textAnchor="end">{logScale ? fmt(10 ** tick) : fmt(tick)}</text>
      </g>)}
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline className="line-path" points={polyline} />
      {values.map((point, index) => <g key={`${point.label}-${index}`}>
        <circle className="line-point" cx={x(index)} cy={y(transform(point.value))} r="4" />
        <text className="chart-axis" x={x(index)} y={height - 18} textAnchor="middle">{point.label}</text>
        <title>{`${point.label}: ${point.detail ?? point.value}`}</title>
      </g>)}
    </svg>
  </ChartFrame>;
}

/* ── concentration–time profile with a population band ──────────────────── */

export function ProfileChart({ title, subtitle, time, series, xLabel, yLabel, logScale, footnote }: {
  title: string; subtitle?: string; time: number[];
  series: Array<{ label: string; mean: number[]; p05?: number[]; p95?: number[]; colour?: string }>;
  xLabel: string; yLabel: string; logScale?: boolean; footnote?: ReactNode;
}) {
  const usable = series.filter((entry) => entry.mean?.length);
  if (!time?.length || !usable.length) return null;
  const width = 680, height = 292, left = 66, right = 22, top = 18, bottom = 52;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const transform = (value: number) => (logScale ? Math.log10(Math.max(value, 1e-7)) : value);
  const allValues = usable.flatMap((entry) => [...entry.mean, ...(entry.p95 ?? [])]).filter((value) => Number.isFinite(value) && (!logScale || value > 0));
  if (!allValues.length) return null;
  const yMaxRaw = Math.max(...allValues);
  const yMinRaw = logScale ? Math.max(Math.min(...allValues.filter((value) => value > 0)), yMaxRaw / 1e5) : 0;
  const yMax = transform(yMaxRaw) + (logScale ? 0.15 : (transform(yMaxRaw) - transform(yMinRaw)) * 0.12);
  const yMin = transform(yMinRaw);
  const xMin = time[0], xMax = time[time.length - 1];
  const gx = (value: number) => left + ((value - xMin) / (xMax - xMin || 1)) * plotWidth;
  const gy = (value: number) => top + plotHeight - ((transform(value) - yMin) / (yMax - yMin || 1)) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (index * (yMax - yMin)) / 4);
  const xTicks = Array.from({ length: 6 }, (_, index) => xMin + (index * (xMax - xMin)) / 5);
  const palette = ["var(--brand)", "#e0625c", "#0f9d8f", "#d97706", "#7c5cf0", "#0b7285", "#9c6ade"];

  return <ChartFrame title={title} subtitle={subtitle} badge={yLabel} footer={footnote}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {yTicks.map((tick, index) => <g key={`y${index}`}>
        <line className="chart-grid" x1={left} x2={width - right} y1={top + plotHeight - ((tick - yMin) / (yMax - yMin || 1)) * plotHeight} y2={top + plotHeight - ((tick - yMin) / (yMax - yMin || 1)) * plotHeight} />
        <text className="chart-axis" x={left - 8} y={top + plotHeight - ((tick - yMin) / (yMax - yMin || 1)) * plotHeight + 4} textAnchor="end">
          {logScale ? fmt(10 ** tick) : fmt(tick)}
        </text>
      </g>)}
      {xTicks.map((tick, index) => <text key={`x${index}`} className="chart-axis" x={gx(tick)} y={height - bottom + 18} textAnchor="middle">{fmt(tick)}</text>)}
      {usable.map((entry, entryIndex) => {
        const colour = entry.colour ?? palette[entryIndex % palette.length];
        const band = entry.p05 && entry.p95
          ? [...entry.p95.map((value, index) => `${gx(time[index])},${gy(value)}`), ...entry.p05.map((value, index) => `${gx(time[index])},${gy(value)}`).reverse()].join(" ")
          : null;
        return <g key={entry.label}>
          {band && <polygon points={band} fill={colour} opacity="0.13" />}
          <polyline points={entry.mean.map((value, index) => `${gx(time[index])},${gy(value)}`).join(" ")} fill="none" stroke={colour} strokeWidth="2.1" strokeLinejoin="round" />
        </g>;
      })}
      <text className="chart-axis-title" transform={`rotate(-90 16 ${top + plotHeight / 2})`} x="16" y={top + plotHeight / 2} textAnchor="middle">{yLabel}</text>
      <text className="chart-axis-title" x={left + plotWidth / 2} y={height - 8} textAnchor="middle">{xLabel}</text>
    </svg>
    <div className="chart-legend">
      {usable.map((entry, index) => <span key={entry.label}><i style={{ background: entry.colour ?? palette[index % palette.length] }} />{t(entry.label)}</span>)}
      {usable.some((entry) => entry.p05) && <span><i style={{ background: "var(--brand)", opacity: 0.22, height: 9, borderRadius: 3 }} />{t("90% population interval")}</span>}
    </div>
  </ChartFrame>;
}

/* ── scatter with error bars (FEP λ windows, calibration plots) ─────────── */

export function ErrorBarChart({ title, subtitle, points, xLabel, yLabel, footnote }: {
  title: string; subtitle?: string;
  points: Array<{ x: number; y: number; error: number }>;
  xLabel: string; yLabel: string; footnote?: ReactNode;
}) {
  if (points.length < 2) return null;
  const width = 660, height = 262, left = 66, right = 22, top = 20, bottom = 50;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const xMin = Math.min(...points.map((point) => point.x)), xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y - point.error));
  const yMax = Math.max(...points.map((point) => point.y + point.error));
  const pad = Math.max((yMax - yMin) * 0.14, 0.08);
  const gx = (value: number) => left + ((value - xMin) / (xMax - xMin || 1)) * plotWidth;
  const gy = (value: number) => top + plotHeight - ((value - (yMin - pad)) / ((yMax + pad) - (yMin - pad) || 1)) * plotHeight;
  const ticks = [yMin - pad, (yMin + yMax) / 2, yMax + pad];
  return <ChartFrame title={title} subtitle={subtitle} badge={yLabel} footer={footnote}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {ticks.map((tick, index) => <g key={index}>
        <line className="chart-grid" x1={left} x2={width - right} y1={gy(tick)} y2={gy(tick)} />
        <text className="chart-axis" x={left - 8} y={gy(tick) + 4} textAnchor="end">{fmt(tick)}</text>
      </g>)}
      <polyline points={points.map((point) => `${gx(point.x)},${gy(point.y)}`).join(" ")} className="line-path" />
      {points.map((point, index) => <g key={index}>
        <line x1={gx(point.x)} x2={gx(point.x)} y1={gy(point.y - point.error)} y2={gy(point.y + point.error)} stroke="var(--brand-600)" strokeWidth="1.4" />
        <line x1={gx(point.x) - 4} x2={gx(point.x) + 4} y1={gy(point.y - point.error)} y2={gy(point.y - point.error)} stroke="var(--brand-600)" strokeWidth="1.4" />
        <line x1={gx(point.x) - 4} x2={gx(point.x) + 4} y1={gy(point.y + point.error)} y2={gy(point.y + point.error)} stroke="var(--brand-600)" strokeWidth="1.4" />
        <circle cx={gx(point.x)} cy={gy(point.y)} r="4" className="line-point" />
        <text className="chart-axis" x={gx(point.x)} y={height - bottom + 18} textAnchor="middle">{fmt(point.x)}</text>
      </g>)}
      <text className="chart-axis-title" transform={`rotate(-90 16 ${top + plotHeight / 2})`} x="16" y={top + plotHeight / 2} textAnchor="middle">{yLabel}</text>
      <text className="chart-axis-title" x={left + plotWidth / 2} y={height - 8} textAnchor="middle">{xLabel}</text>
    </svg>
  </ChartFrame>;
}

/* ── heatmap ────────────────────────────────────────────────────────────── */

export function Heatmap({ title, subtitle, cells, columns, valueLabel, footnote }: {
  title: string; subtitle?: string;
  cells: Array<{ label: string; value: number; detail?: string }>;
  columns: number; valueLabel?: string; footnote?: ReactNode;
}) {
  const usable = cells.filter((cell) => Number.isFinite(cell.value));
  if (!usable.length) return null;
  const max = Math.max(...usable.map((cell) => cell.value)) || 1;
  const min = Math.min(...usable.map((cell) => cell.value));
  const shade = (value: number) => {
    const level = (value - min) / (max - min || 1);
    // A single-hue sequential ramp — light to the brand cyan, then to a warm
    // tone at the top so a high value reads as a high value without hue chaos.
    if (level < 0.5) {
      const k = level / 0.5;
      return `rgb(${Math.round(240 - 46 * k)}, ${Math.round(248 - 26 * k)}, ${Math.round(253 - 12 * k)})`;
    }
    const k = (level - 0.5) / 0.5;
    return `rgb(${Math.round(194 - 24 * k)}, ${Math.round(222 - 88 * k)}, ${Math.round(241 - 74 * k)})`;
  };
  return <ChartFrame title={title} subtitle={subtitle} badge={valueLabel} footer={footnote}>
    <div className="heatmap" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {usable.map((cell, index) => {
        const level = (cell.value - min) / (max - min || 1);
        return <div key={`${cell.label}-${index}`} className="heat-cell"
          style={{ background: shade(cell.value), color: level > 0.62 ? "#fff" : "var(--ink-2)" }}
          title={`${cell.label}: ${cell.detail ?? fmt(cell.value)}`}>
          <div style={{ fontSize: 10, opacity: .85, lineHeight: 1.25 }}>{cell.label}</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{cell.detail ?? fmt(cell.value)}</div>
        </div>;
      })}
    </div>
  </ChartFrame>;
}

/* ── radar ──────────────────────────────────────────────────────────────── */

export function RadarChart({ title, subtitle, axes, footnote }: {
  title: string; subtitle?: string;
  axes: Array<{ label: string; value: number; detail?: string }>;
  footnote?: ReactNode;
}) {
  const usable = axes.filter((axis) => Number.isFinite(axis.value));
  if (usable.length < 3) return null;
  const size = 300, centre = size / 2, radius = size / 2 - 54;
  const angle = (index: number) => (Math.PI * 2 * index) / usable.length - Math.PI / 2;
  const point = (index: number, fraction: number) => [
    centre + Math.cos(angle(index)) * radius * fraction,
    centre + Math.sin(angle(index)) * radius * fraction,
  ];
  const polygon = usable.map((axis, index) => point(index, Math.max(0.02, Math.min(1, axis.value))).join(",")).join(" ");
  return <ChartFrame title={title} subtitle={subtitle} badge="0 – 1 normalised" footer={footnote}>
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title} style={{ maxWidth: 340, margin: "0 auto" }}>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={usable.map((_, index) => point(index, ring).join(",")).join(" ")} fill="none" stroke="var(--line-2)" strokeWidth="1" />
      ))}
      {usable.map((_, index) => {
        const [x, y] = point(index, 1);
        return <line key={index} x1={centre} y1={centre} x2={x} y2={y} stroke="var(--line-2)" strokeWidth="1" />;
      })}
      <polygon points={polygon} fill="var(--brand)" fillOpacity="0.18" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
      {usable.map((axis, index) => {
        const [x, y] = point(index, Math.max(0.02, Math.min(1, axis.value)));
        return <circle key={`p${index}`} cx={x} cy={y} r="3.4" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2" />;
      })}
      {usable.map((axis, index) => {
        const [x, y] = point(index, 1.2);
        return <text key={`l${index}`} x={x} y={y} textAnchor={x > centre + 6 ? "start" : x < centre - 6 ? "end" : "middle"}
          dominantBaseline="middle" className="chart-axis" style={{ fontSize: 9.5 }}>
          <tspan>{axis.label}</tspan>
        </text>;
      })}
    </svg>
    <ol style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 12 }}>
      {usable.map((axis) => <li key={axis.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: "var(--muted)" }}>
        <span>{axis.label}</span><b style={{ color: "var(--ink)" }}>{axis.detail ?? fmt(axis.value)}</b>
      </li>)}
    </ol>
  </ChartFrame>;
}

/* ── sparkline ──────────────────────────────────────────────────────────── */

export function Sparkline({ values, width = 84, height = 24, tone: band = "brand" }: { values: number[]; width?: number; height?: number; tone?: Tone | "brand" }) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return null;
  const min = Math.min(...usable), max = Math.max(...usable);
  const range = max - min || 1;
  const points = usable.map((value, index) => `${(index / (usable.length - 1)) * width},${height - ((value - min) / range) * (height - 3) - 1.5}`).join(" ");
  const stroke = band === "good" ? "var(--good)" : band === "warn" ? "var(--warn)" : band === "bad" ? "var(--bad)" : "var(--brand)";
  return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
  </svg>;
}

/* ── stacked distribution bar ───────────────────────────────────────────── */

export function StackBar({ segments, height = 8 }: { segments: Array<{ value: number; tone: Tone }>; height?: number }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return null;
  return <div className="dist-bar" style={{ height }}>
    {segments.filter((segment) => segment.value > 0).map((segment, index) => (
      <i key={index} className={segment.tone} style={{ flexGrow: segment.value }} />
    ))}
  </div>;
}

/* ── normalised profile strip ───────────────────────────────────────────── */

/**
 * One row per property: the label, where the returned value sits inside its own
 * favourable range, the value with its unit, and the screening band the engine
 * assigned it.
 *
 * This replaces a radar over the same axes. A radar of eight heterogeneous
 * properties has to letterbox its axis labels to fit, and the reader cannot
 * recover a single number from the shape — so the figure ended up being both
 * unreadable and less informative than the list beside it. The band tone is the
 * engine's own `status` for that endpoint; nothing here re-grades a value.
 */
export function ProfileStrip({ title, subtitle, axes, footnote, badge = "0 – 1 normalised" }: {
  title: string; subtitle?: string;
  axes: Array<{ label: string; value: number; detail?: string; unit?: string; tone?: Tone; band?: string }>;
  footnote?: ReactNode; badge?: string;
}) {
  const usable = axes.filter((axis) => Number.isFinite(axis.value));
  if (!usable.length) return null;
  // The label column is sized to the longest property name so it never
  // truncates; the track absorbs whatever width is left.
  const columns = "minmax(134px, 0.9fr) minmax(76px, 1.9fr) minmax(98px, auto) minmax(80px, auto)";
  return <ChartFrame title={title} subtitle={subtitle} badge={badge} footer={footnote}>
    <div className="pstrip-scale" style={{ ["--pcols" as string]: columns }}>
      <span>{t("Property")}</span>
      <i><span>{t("less favourable")}</span><span>{t("more favourable")}</span></i>
      <span>{t("Returned value")}</span>
      <span>{t("Band")}</span>
    </div>
    <ol className="pstrip">
      {usable.map((axis) => {
        const fraction = Math.max(0, Math.min(1, axis.value));
        return <li key={axis.label} style={{ ["--pcols" as string]: columns }}>
          <span className="pstrip-label" title={t(axis.label)}>{t(axis.label)}</span>
          <span className="pstrip-track" role="img"
            aria-label={`${axis.label}: ${Math.round(fraction * 100)}% of its favourable range`}>
            <i className={`pstrip-fill ${axis.tone ?? "neutral"}`} style={{ width: `${fraction * 100}%` }} />
          </span>
          <b className="pstrip-value">{axis.detail ?? fmt(axis.value)}{axis.unit && <em>{axis.unit}</em>}</b>
          <span className={`pstrip-band ${axis.tone ?? "neutral"}`}><i />{axis.band ? t(axis.band) : "—"}</span>
        </li>;
      })}
    </ol>
  </ChartFrame>;
}
