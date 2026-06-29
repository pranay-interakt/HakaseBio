/**
 * usePersistedState — drop-in replacement for useState that mirrors to
 * localStorage under a namespaced key. Survives route changes (HakaseAI
 * unmounting when /lab ↔ /dashboard swap) and tab reloads.
 *
 * Notes:
 *   - Storage key is automatically namespaced with WORKSPACE_NS so we can
 *     wipe all workspace state with one `clearPersistedWorkspace()` call
 *     (called from useAuth.logout()).
 *   - Functions / class instances / RDKit Mol handles cannot be persisted;
 *     for those keep useState.
 *   - SSR-safe: returns the initial value when window is undefined.
 */
import { useEffect, useRef, useState } from "react";

export const WORKSPACE_NS = "hk.ws.v1.";

function readKey<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_NS + key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

function writeKey<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    if (value === undefined) {
      window.localStorage.removeItem(WORKSPACE_NS + key);
    } else {
      window.localStorage.setItem(WORKSPACE_NS + key, JSON.stringify(value));
    }
  } catch {
    /* quota / disabled — silently degrade to in-memory */
  }
}

export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const initRef = useRef(false);
  const [value, setValue] = useState<T>(() => {
    const initialResolved = typeof initial === "function" ? (initial as () => T)() : initial;
    return readKey<T>(key, initialResolved);
  });

  useEffect(() => {
    // Skip the very first commit — value is already from storage.
    if (!initRef.current) {
      initRef.current = true;
      return;
    }
    writeKey(key, value);
  }, [key, value]);

  // Cross-tab sync — listen for storage events on our namespaced key.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fullKey = WORKSPACE_NS + key;
    function onStorage(e: StorageEvent) {
      if (e.key !== fullKey) return;
      if (e.newValue === null) return;
      try {
        const next = JSON.parse(e.newValue) as T;
        setValue(next);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return [value, setValue];
}

/** Nuke every persisted workspace key. Call on logout. */
export function clearPersistedWorkspace(): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    const toDel: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(WORKSPACE_NS)) toDel.push(k);
    }
    for (const k of toDel) ls.removeItem(k);
  } catch {
    /* ignore */
  }
}
