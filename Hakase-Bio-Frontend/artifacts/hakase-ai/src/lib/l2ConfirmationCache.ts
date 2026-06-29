import type { ConfirmationEvidenceBlock } from "@workspace/preclinical-handoff";
import type { L2DoseProjection } from "./l2DoseProjection";

const STORAGE_KEY = "hakase.l2confirmation.cache.v1";
const MAX_ENTRIES = 24;

interface CacheEntry {
  block: ConfirmationEvidenceBlock | null;
  projection: L2DoseProjection | null;
  ts: number;
}

type CacheMap = Record<string, CacheEntry>;

function readAll(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed as CacheMap : {};
  } catch {
    return {};
  }
}

function writeAll(map: CacheMap): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (b[1].ts ?? 0) - (a[1].ts ?? 0));
      const trimmed: CacheMap = {};
      for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
      map = trimmed;
    }
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — silent */
  }
}

export function makeL2CacheKey(smiles: string, uniprotId: string): string | null {
  const s = (smiles ?? "").trim();
  const u = (uniprotId ?? "").trim().toUpperCase();
  if (!s || !u) return null;
  return `${s}::${u}`;
}

export function loadCachedL2(key: string): CacheEntry | null {
  return readAll()[key] ?? null;
}

export function saveCachedL2(
  key: string,
  block: ConfirmationEvidenceBlock | null,
  projection: L2DoseProjection | null,
): void {
  if (!block && !projection) return;
  const map = readAll();
  map[key] = { block, projection, ts: Date.now() };
  writeAll(map);
}

export function clearAllCachedL2(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage?.removeItem(STORAGE_KEY); } catch { /* silent */ }
}
