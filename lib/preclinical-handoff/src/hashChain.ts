/**
 * Evidence Hash Chain — tamper-evident provenance across the four pre-clinical
 * gates (L1 In-Vitro → L2 Confirmation → IVIVE → L3 Animal Cohort → L4 FIH
 * Readiness).
 *
 * The chain is the cryptographic backbone of the marketing claim that the
 * sealed `PreClinicalPackage v2.0.0` is tamper-evident. Each stage's hash
 * folds the previous stage's hash into its own input, so any post-hoc edit
 * to an upstream block invalidates every downstream hash.
 *
 * Construction (genesis is L1):
 *   l1Hash    = sha256(""          ‖ "\n" ‖ canonicalJSON({simResults, inVitroResults}))
 *   l2Hash    = sha256(l1Hash      ‖ "\n" ‖ canonicalJSON(confirmationBlock))
 *   iviveHash = sha256(l2Hash      ‖ "\n" ‖ canonicalJSON(iviveHandoffSignOff))
 *   l3Hash    = sha256(iviveHash   ‖ "\n" ‖ canonicalJSON(animalCohortResults))
 *   l4Hash    = sha256(l3Hash      ‖ "\n" ‖ canonicalJSON(preClinicalPackage))
 *
 * STRICT POLICY (mirrors the rest of @workspace/preclinical-handoff):
 *   1. canonicalJSON sorts object keys recursively, refuses non-finite numbers,
 *      and preserves null. Two semantically equivalent payloads that differ
 *      only in key ordering MUST hash identically.
 *   2. The "sha256:" prefix is required on every emitted hash so that a
 *      regulator looking at a string field can immediately identify it.
 *   3. Stages with no payload yet are `null` — never a placeholder hash.
 *      A null upstream means downstream cannot have a hash either.
 *   4. The verifier is async (Web Crypto); offline verification is supported
 *      by re-deriving each stage from its canonical payload + prior hash.
 */

export const HASH_CHAIN_SCHEMA_VERSION = "1.0.0" as const;
export const HASH_CHAIN_PREFIX = "sha256:" as const;

export type ChainHash = `sha256:${string}` & { readonly __brand: "ChainHash" };

export type ChainStage = "L1" | "L2" | "IVIVE" | "L3" | "L4";

export interface EvidenceChain {
  schemaVersion: typeof HASH_CHAIN_SCHEMA_VERSION;
  l1: ChainHash | null;
  l2: ChainHash | null;
  ivive: ChainHash | null;
  l3: ChainHash | null;
  l4: ChainHash | null;
}

export const EMPTY_EVIDENCE_CHAIN: EvidenceChain = {
  schemaVersion: HASH_CHAIN_SCHEMA_VERSION,
  l1: null,
  l2: null,
  ivive: null,
  l3: null,
  l4: null,
};

// ── Canonical JSON ──────────────────────────────────────────────────────────

/**
 * `undefined` handling: top-level and array `undefined` throw (these are
 * positions where `JSON.stringify` produces invalid output — `undefined` and
 * a hole in an array become `null`, masking the gap). Object-property
 * `undefined` is DROPPED, matching standard JSON semantics: `undefined` is
 * not a JSON value, so a key with value `undefined` is omitted by
 * `JSON.stringify` and is not part of the data being committed to the chain.
 * This is consistent with RFC 8785 (canonical JSON) which only canonicalises
 * valid JSON values.
 *
 * Anti-fabrication note: every nullable field in the v2.0.0 schema is typed
 * `T | null`, never `T | undefined`. Producers that follow the schema will
 * never emit `undefined` for a chain-relevant field, so the drop semantics
 * cannot collapse two distinct sealed states into one canonical payload.
 */
function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "undefined") {
    throw new Error("canonicalJSON: undefined is not a JSON value (only allowed as a dropped object property)");
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (typeof v === "undefined") {
        throw new Error(`canonicalJSON: undefined at array index ${i} would silently become null`);
      }
      return canonicalize(v);
    });
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (typeof v === "undefined") continue; // RFC 8785 — see header note above
      out[k] = canonicalize(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`canonicalJSON: non-finite number ${String(value)}`);
  }
  if (typeof value === "bigint") {
    throw new Error("canonicalJSON: bigint is not encodable");
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error(`canonicalJSON: ${typeof value} is not encodable`);
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

// ── SHA-256 over Web Crypto ─────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("sha256Hex: Web Crypto SubtleCrypto is not available");
  }
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// ── Chain helpers ───────────────────────────────────────────────────────────

/**
 * Compute the next hash in the chain from a parent hash and an arbitrary
 * payload. `null` parent is the genesis case (used for L1).
 */
export async function chainHash(
  parent: ChainHash | null,
  payload: unknown,
): Promise<ChainHash> {
  const parentStr = parent ?? "";
  const body = canonicalJSON(payload);
  const hex = await sha256Hex(`${parentStr}\n${body}`);
  return `${HASH_CHAIN_PREFIX}${hex}` as ChainHash;
}

/** Short 8-char form (excludes the "sha256:" prefix), suitable for UI badges. */
export function shortHash(h: ChainHash | null | undefined): string {
  if (!h) return "—";
  return h.slice(HASH_CHAIN_PREFIX.length, HASH_CHAIN_PREFIX.length + 8);
}

export interface ChainVerifyResult {
  ok: boolean;
  brokenAt: ChainStage | null;
  reason: string | null;
}

/**
 * Re-derive each stage hash from the supplied payloads and confirm it matches
 * the stored hash on the chain.
 *
 * Modes:
 * - **Strict** (every payload supplied): every stage hash is re-derived and
 *   compared against `chain[*]`. Any mismatch — including null-vs-non-null
 *   shape mismatches — fails the verification.
 * - **Partial** (some payloads omitted, i.e. `undefined`): omitted stages
 *   are NOT re-derived; the stored chain hash for that stage is trusted as
 *   the parent for the next supplied stage. This mode is meant for
 *   downstream consumers who only hold the tail of the chain (e.g. a CRO
 *   that received the L3 + L4 bundle but no upstream payloads). It does NOT
 *   verify any structural invariant for skipped stages — callers must treat
 *   skipped stages as an explicit trust anchor on the producer.
 *
 * In both modes, supplying a payload for a stage whose stored hash is null
 * is a verification failure (the producer claimed nothing was sealed but
 * the verifier was given something to hash).
 */
export async function verifyChain(
  chain: EvidenceChain,
  payloads: {
    l1?: unknown;
    l2?: unknown;
    ivive?: unknown;
    l3?: unknown;
    l4?: unknown;
  },
): Promise<ChainVerifyResult> {
  const stages: ChainStage[] = ["L1", "L2", "IVIVE", "L3", "L4"];
  const payloadKeys: Array<keyof typeof payloads> = [
    "l1",
    "l2",
    "ivive",
    "l3",
    "l4",
  ];
  const chainKeys: Array<"l1" | "l2" | "ivive" | "l3" | "l4"> = [
    "l1",
    "l2",
    "ivive",
    "l3",
    "l4",
  ];
  let parent: ChainHash | null = null;
  for (let i = 0; i < stages.length; i++) {
    const stored = chain[chainKeys[i]];
    const payload = payloads[payloadKeys[i]];
    if (typeof payload === "undefined") {
      parent = stored;
      continue;
    }
    if (stored === null) {
      return {
        ok: false,
        brokenAt: stages[i],
        reason: `payload supplied for ${stages[i]} but chain hash is null`,
      };
    }
    const expected = await chainHash(parent, payload);
    if (stored !== expected) {
      return {
        ok: false,
        brokenAt: stages[i],
        reason: `expected ${expected}, got ${stored}`,
      };
    }
    parent = stored;
  }
  return { ok: true, brokenAt: null, reason: null };
}
