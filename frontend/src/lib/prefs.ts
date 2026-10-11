// Per-browser display preferences (theme, density). Kept in localStorage purely as a viewer
// convenience: nothing here affects records, and the app works when storage is unavailable.
import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export interface Prefs {
  theme: Theme;
  density: Density;
}

const KEY = "hos.prefs";
const EVENT = "hos:prefs";
const DEFAULTS: Prefs = { theme: "system", density: "comfortable" };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
      density: p.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULTS;
  }
}

/** Put the preferences on <html> (data-theme, data-density); styles.css reads them. */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  if (p.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p.theme);
  root.setAttribute("data-density", p.density);
}

export function savePrefs(next: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  applyPrefs(next);
  window.dispatchEvent(new CustomEvent<Prefs>(EVENT, { detail: next }));
}

/** The current preferences, kept in step across components (top bar, settings page). */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => {
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [prefs, (patch) => savePrefs({ ...prefs, ...patch })];
}

/** The theme actually showing: the system's when the choice is "system". */
export function effectiveTheme(t: Theme): "light" | "dark" {
  if (t !== "system") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
