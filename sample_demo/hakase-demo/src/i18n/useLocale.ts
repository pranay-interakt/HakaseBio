/** Re-renders the tree when the active locale changes. */
import { useEffect, useReducer } from "react";
import { getLocale, setLocale, subscribeLocale, type Locale } from "./index";

export function useLocale() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeLocale(bump), []);
  return { locale: getLocale(), setLocale: (next: Locale) => setLocale(next) };
}
