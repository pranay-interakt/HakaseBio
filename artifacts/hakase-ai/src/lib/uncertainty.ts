/**
 * Numerical foundations for Layer 1.
 *
 * Provides:
 *   - FNV-1a 32-bit hashing for deterministic, engine-independent seeding
 *   - Mulberry32 PRNG (xorshift-mixed 32-bit state) — bit-identical across
 *     JS engines, unlike `Math.sin`-based pseudo-RNGs
 *   - Box-Muller Gaussian sampling
 *   - Heteroscedastic noise generation scaled to a response level
 *   - `Estimate<T>` type — every Layer 1 numeric prediction emits value +
 *     95% CI + applicability-domain status + source citation
 *   - Canonical-JSON serialization (sorted keys, deterministic numbers) for
 *     stable provenance hashing
 *   - SHA-256 (async, via SubtleCrypto) for the L1 `EvidencePointer`
 *   - Synchronous 32-bit canonical fingerprint for in-flight checks
 *
 * References:
 *   - Fowler, Noll & Vo, FNV hash, https://www.isthe.com/chongo/tech/comp/fnv/
 *   - T. Vigna / Mulberry32, public-domain test rig 2017
 *   - Box & Muller, Ann. Math. Statist. 29 (1958) 610–611
 */

// ────────────────────────────────────────────────────────────────────────────
// Hashing — FNV-1a 32-bit
// ────────────────────────────────────────────────────────────────────────────

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Compose a deterministic 32-bit seed from any number of string parts.
 * Order-sensitive; pipe-delimited so substrings cannot collide.
 */
export function composeSeed(...parts: string[]): number {
  return fnv1a32(parts.map(p => (p ?? "").toString()).join("|"));
}

// ────────────────────────────────────────────────────────────────────────────
// PRNG — Mulberry32
// ────────────────────────────────────────────────────────────────────────────

export interface Rng {
  /** Uniform [0, 1). */
  next(): number;
  /** Uniform [lo, hi). */
  uniform(lo: number, hi: number): number;
  /** Box-Muller standard normal (mean 0, sd 1). */
  gaussian(): number;
  /** Normal sample with given mean & sd. */
  normal(mean: number, sd: number): number;
  /** Log-normal sample on the natural scale (median = exp(mu)). */
  logNormal(mu: number, sigma: number): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = (): number => {
    let u1 = next();
    while (u1 === 0) u1 = next();
    const u2 = next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  return {
    next,
    uniform(lo, hi) { return lo + (hi - lo) * next(); },
    gaussian,
    normal(mean, sd) { return mean + sd * gaussian(); },
    logNormal(mu, sigma) { return Math.exp(mu + sigma * gaussian()); },
  };
}

/**
 * Heteroscedastic Gaussian noise on a 0..Emax response, used for dose-response
 * curve realism. σ grows mildly at the curve extremes (signal-dependent noise).
 *
 * Reference: standard assay noise model — see e.g. Sebaugh & McCray,
 * Pharmaceutical Statistics 2 (2003) 167–174.
 */
export function heteroscedasticNoise(
  rng: Rng,
  response: number,
  emax: number,
  sigmaFractionOfEmax = 0.04,
): number {
  const r = Math.max(0, Math.min(emax, response));
  const fractional = r / emax;
  // σ = σ_base * Emax * (1 + 0.5·(1 − 4·f·(1−f)))   →  +50% at extremes
  const extremity = 1 - 4 * fractional * (1 - fractional);
  const sd = sigmaFractionOfEmax * emax * (1 + 0.5 * extremity);
  return rng.normal(0, sd);
}

// ────────────────────────────────────────────────────────────────────────────
// Estimate<T> — uncertainty-aware numeric prediction
// ────────────────────────────────────────────────────────────────────────────

export type ApplicabilityDomain = "in_domain" | "near_boundary" | "out_of_domain";

export interface Estimate<T = number> {
  /** Point estimate (typically posterior median / regression mean). */
  value: T;
  /** 95% interval. For scalars this is [lo, hi]; downstream UIs can render it. */
  ci95?: T extends number ? [number, number] : never;
  /** Reported residual standard deviation on the prediction scale, if known. */
  sd?: number;
  /** Whether the input descriptors fall inside the model's training domain. */
  applicabilityDomain: ApplicabilityDomain;
  /** Bibliographic source for the model (mandatory — no hidden heuristics). */
  source: string;
  /** Model identifier and version (eg. "hou_caco2_2007@v1"). */
  modelVersion: string;
  /** Human-readable reasons for the AD classification. */
  domainNotes?: string[];
}

export interface DomainCheck {
  status: ApplicabilityDomain;
  notes: string[];
}

export interface DomainBound {
  name: string;
  value: number;
  in: [number, number];
  near?: [number, number];
}

/**
 * Coarse applicability-domain check based on per-descriptor box constraints.
 * `in` is the strict training-distribution interval; `near` (optional) widens
 * it for "near_boundary" classification. Outside `near` ⇒ out_of_domain.
 */
export function checkDomain(bounds: DomainBound[]): DomainCheck {
  const notes: string[] = [];
  let status: ApplicabilityDomain = "in_domain";
  for (const b of bounds) {
    const [lo, hi] = b.in;
    if (b.value < lo || b.value > hi) {
      const [nlo, nhi] = b.near ?? [lo, hi];
      if (b.value < nlo || b.value > nhi) {
        status = "out_of_domain";
        notes.push(`${b.name}=${fmt(b.value)} outside near-boundary [${fmt(nlo)}, ${fmt(nhi)}]`);
      } else {
        if (status === "in_domain") status = "near_boundary";
        notes.push(`${b.name}=${fmt(b.value)} outside training range [${fmt(lo)}, ${fmt(hi)}]`);
      }
    }
  }
  return { status, notes };
}

function fmt(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01)) return n.toExponential(2);
  return n.toFixed(2);
}

/**
 * Build a scalar Estimate from value + residual SD on the linear (or log)
 * scale. 95% CI is value ± 1.96·sd (assumes Gaussian residuals).
 *
 * If `transform = "log10"`, the CI is computed on log10-space then exponentiated.
 */
export function makeEstimate(opts: {
  value: number;
  sd: number;
  source: string;
  modelVersion: string;
  domain: DomainCheck;
  transform?: "identity" | "log10" | "ln";
  clampNonNegative?: boolean;
}): Estimate<number> {
  const { value, sd, source, modelVersion, domain, transform = "identity", clampNonNegative } = opts;
  let lo: number;
  let hi: number;
  if (transform === "log10") {
    const log10 = Math.log10(Math.max(Number.MIN_VALUE, value));
    lo = Math.pow(10, log10 - 1.96 * sd);
    hi = Math.pow(10, log10 + 1.96 * sd);
  } else if (transform === "ln") {
    const ln = Math.log(Math.max(Number.MIN_VALUE, value));
    lo = Math.exp(ln - 1.96 * sd);
    hi = Math.exp(ln + 1.96 * sd);
  } else {
    lo = value - 1.96 * sd;
    hi = value + 1.96 * sd;
  }
  if (clampNonNegative) {
    lo = Math.max(0, lo);
    hi = Math.max(lo, hi);
  }
  return {
    value,
    ci95: [lo, hi] as [number, number],
    sd,
    applicabilityDomain: domain.status,
    source,
    modelVersion,
    domainNotes: domain.notes.length ? domain.notes : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical JSON + content hashing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stable JSON serializer:
 *   - object keys sorted lexicographically at every depth
 *   - numbers serialized with `Number.prototype.toString` (engine-spec stable
 *     for finite IEEE 754 doubles)
 *   - undefined / functions / symbols / NaN / Infinity omitted (rejected)
 *   - arrays preserve order
 *
 * This is the canonical-form used to derive `EvidencePointer` hashes.
 */
export function canonicalJSON(value: unknown): string {
  return stringify(value);
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!isFinite(v)) throw new Error("canonicalJSON: non-finite number");
    // toString already returns shortest round-trippable form in V8/SpiderMonkey/JSC
    return v.toString();
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stringify).join(",") + "]";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined && typeof obj[k] !== "function" && typeof obj[k] !== "symbol")
      .sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stringify(obj[k])).join(",") + "}";
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
}

/**
 * Synchronous 64-bit-ish fingerprint (two FNV-1a passes with different seeds).
 * Use for fast in-flight identity checks; use `sha256Hex` for the canonical
 * cryptographic provenance pointer.
 */
export function fingerprint64(input: string): string {
  const h1 = fnv1a32(input);
  const h2 = fnv1a32("\x01" + input);
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** SHA-256 hex via SubtleCrypto (browser + Node 16+). Async. */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) {
    // Deterministic fallback for non-browser test contexts.
    return fingerprint64(input) + fingerprint64("\x02" + input);
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convenience: canonical-JSON → SHA-256. */
export async function contentHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJSON(value));
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregation helpers
// ────────────────────────────────────────────────────────────────────────────

/** Combine two log-scale estimates by inverse-variance weighting. */
export function combineLogEstimates(a: Estimate<number>, b: Estimate<number>): Estimate<number> {
  const sa = a.sd ?? 0.3;
  const sb = b.sd ?? 0.3;
  const wa = 1 / (sa * sa);
  const wb = 1 / (sb * sb);
  const la = Math.log10(Math.max(Number.MIN_VALUE, a.value));
  const lb = Math.log10(Math.max(Number.MIN_VALUE, b.value));
  const lc = (wa * la + wb * lb) / (wa + wb);
  const sc = Math.sqrt(1 / (wa + wb));
  const value = Math.pow(10, lc);
  const worse = (x: ApplicabilityDomain, y: ApplicabilityDomain): ApplicabilityDomain => {
    if (x === "out_of_domain" || y === "out_of_domain") return "out_of_domain";
    if (x === "near_boundary" || y === "near_boundary") return "near_boundary";
    return "in_domain";
  };
  return {
    value,
    ci95: [Math.pow(10, lc - 1.96 * sc), Math.pow(10, lc + 1.96 * sc)],
    sd: sc,
    applicabilityDomain: worse(a.applicabilityDomain, b.applicabilityDomain),
    source: `IVW(${a.source}; ${b.source})`,
    modelVersion: `ivw[${a.modelVersion}+${b.modelVersion}]`,
    domainNotes: [...(a.domainNotes ?? []), ...(b.domainNotes ?? [])],
  };
}
