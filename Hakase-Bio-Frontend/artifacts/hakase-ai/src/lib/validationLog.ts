/**
 * Continuous-validation feedback client (Phase 5).
 * ─────────────────────────────────────────────────────────────────────────
 * Thin, fail-soft client for the api-server's /validation/feedback endpoint.
 * When a reviewer judges that the engine got a verdict wrong (e.g. a safe
 * antioxidant flagged NO-GO), this records the correction to the append-only
 * server log so the scoring thresholds + calibration layer can be re-checked
 * against a growing real regression set — the credibility-evidence trail the
 * FDA 2025 AI framework expects for a model's context of use.
 *
 * Never throws — logging feedback must never break the UI.
 */
import { API_ROOT } from "./apiBase";

export type ReviewVerdict = "GO" | "WATCH" | "NO-GO" | "KNOWN-LIABILITY-NO-GO" | "REVIEW";

export interface ValidationFeedback {
  smiles: string;
  predictedVerdict: string;
  predictedClass?: string;       // "standard" | "review-escalate"
  correctedVerdict: ReviewVerdict | string;
  endpoint?: string;             // liability that drove the disagreement
  note?: string;
  reviewer?: string;
}

export interface ValidationSummary {
  count: number;
  agreementRate: number | null;
  byEndpoint?: Record<string, { total: number; disagreements: number }>;
  recent: Array<ValidationFeedback & { ts: string }>;
  note?: string;
}

/** Record a reviewer correction. Returns true on success, false on any failure. */
export async function logVerdictFeedback(fb: ValidationFeedback): Promise<boolean> {
  try {
    const res = await fetch(`${API_ROOT}/api/validation/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fb),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch the validation log summary (agreement rate + per-endpoint tally). */
export async function fetchValidationSummary(limit = 100): Promise<ValidationSummary | null> {
  try {
    const res = await fetch(`${API_ROOT}/api/validation/feedback?limit=${limit}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ValidationSummary;
  } catch {
    return null;
  }
}
