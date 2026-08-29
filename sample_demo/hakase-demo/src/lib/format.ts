import { t as translate } from "../i18n";
/**
 * Display formatting primitives.
 *
 * Mirrors the production workspace contract: an absent value renders as an em
 * dash and is never replaced by a zero, because "not produced" and "produced as
 * zero" are different scientific statements.
 */

export function num(value: unknown, digits = 3): string {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "—";
  if (value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e5)) return value.toExponential(2);
  return Number(value.toFixed(digits)).toString();
}

export function pct(value: unknown, digits = 0): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return num(value);
  if (Array.isArray(value)) return value.length ? value.map((v) => text(v)).join(", ") : "—";
  if (typeof value === "object") return "—";
  return String(value);
}

export function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function sentence(value: string): string {
  const cleaned = value.replaceAll("_", " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Backend status vocabulary → the shared four-step tone ramp. */
export type Tone = "good" | "warn" | "bad" | "neutral";

const GOOD = new Set([
  "good", "pass", "go", "ready", "low", "live", "available", "in_domain", "conformant", "mild",
  "clear", "adequate", "computed", "favourable", "favorable", "comfortable", "low_concern",
  "resolved", "linear", "acceptable", "strong", "met", "complete",
]);
const BAD = new Set([
  "bad", "fail", "no-go", "not-ready", "not-fileable", "poor", "high", "severe", "exceeded",
  "concern", "unfavourable", "unfavorable", "out_of_domain", "block", "blocked", "critical",
  "error", "unreachable", "not_met",
]);
const WARN = new Set([
  "warn", "warning", "caution", "moderate", "conditional", "watch", "borderline", "narrow",
  "partial", "needs_input", "advised", "monitor", "review", "modest", "unavailable",
  "requires_wet_lab", "partially_computed", "not_predicted", "model_required", "identity_required",
  "undetermined", "non-linear", "gap", "insufficient", "weak",
]);

export function tone(status?: string | null): Tone {
  const value = String(status ?? "").toLowerCase().trim();
  if (GOOD.has(value)) return "good";
  if (BAD.has(value)) return "bad";
  if (WARN.has(value)) return "warn";
  return "neutral";
}

export function statusWord(band: Tone): string {
  return translate(band === "good" ? "Clear" : band === "bad" ? "Flag" : band === "warn" ? "Review" : "Reported");
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A stable, locale-free short timestamp for the demo record headers. */
export function stamp(offsetMinutes = 0): string {
  const base = new Date(Date.UTC(2026, 7, 28, 9, 14, 0) - offsetMinutes * 60_000);
  return base.toISOString();
}

export function humanTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
