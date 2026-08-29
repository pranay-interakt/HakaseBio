/**
 * Localisation core.
 *
 * Messages are keyed by their English source text, so a call site reads as the
 * sentence it renders and an untranslated string falls through to English
 * rather than to a missing-key placeholder. `scripts/i18n-audit.mjs` reports
 * what has fallen through, which is how coverage is measured rather than
 * asserted.
 *
 * The engines call `t()` at the moment they compose a sentence, because most
 * of their prose is interpolated and cannot be looked up after the fact. That
 * makes a record locale-bound at the moment it is built, so switching locale
 * re-runs the screen — see `App.tsx`.
 */
import { JA } from "./ja";

export type Locale = "en" | "ja";

export const LOCALES: Array<{ code: Locale; label: string; short: string }> = [
  { code: "en", label: "English", short: "EN" },
  { code: "ja", label: "日本語", short: "日本語" },
];

const STORAGE_KEY = "hakase.locale";

function initial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch { /* private mode — fall back to English */ }
  return "en";
}

let current: Locale = initial();
const listeners = new Set<() => void>();

export function getLocale(): Locale { return current; }

export function setLocale(next: Locale) {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

export function subscribeLocale(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Translate `source`, substituting `{name}` placeholders from `params`.
 *
 * Placeholders are substituted after lookup so a translation may reorder them,
 * which Japanese frequently needs — the value and its unit rarely sit where
 * English puts them.
 */
/**
 * Every source string that reached `t()` with no translation in the active
 * locale, in render order.
 *
 * Much of the app's prose arrives as data — endpoint titles, engine rationales,
 * catalogue labels — so it is passed as `t(record.field)` and a source scan
 * cannot see it. Recording misses as they render is what makes coverage
 * measurable across the whole app rather than only across its literals.
 * Read it from the console as `__i18nMisses()`.
 */
const misses = new Set<string>();

if (typeof window !== "undefined") {
  (window as unknown as { __i18nMisses: () => string[] }).__i18nMisses = () => [...misses];
}

/* Already-translated text passed back through `t()` — a value wrapped at the
   call site and again inside a shared component — returns unchanged instead of
   being reported as a miss. Files are converted one at a time, so a string
   crossing two converted layers is normal rather than a fault. */
const TRANSLATED = new Set(Object.values(JA));

export function t(source: string, params?: Record<string, string | number>): string {
  if (current === "ja" && TRANSLATED.has(source)) {
    let passthrough = source;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        passthrough = passthrough.split(`{${key}}`).join(String(value));
      }
    }
    return passthrough;
  }
  if (current === "ja" && !(source in JA) && source.trim()) misses.add(source);
  let out = current === "ja" ? (JA[source] ?? source) : source;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
}

/** True when a source string has no translation in the active locale. */
export function isUntranslated(source: string): boolean {
  return current === "ja" && !(source in JA);
}
