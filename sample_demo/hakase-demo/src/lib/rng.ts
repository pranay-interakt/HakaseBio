/**
 * Deterministic pseudo-randomness.
 *
 * In the real platform every number is a model output. In this demonstration
 * build the numbers are generated here — but they are generated *deterministically
 * from the structure*, so the same molecule always produces the same profile and
 * two different molecules produce genuinely different ones. That is what makes
 * the demo behave like an instrument rather than a slideshow.
 */

/** FNV-1a 32-bit string hash. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32 — small, fast, well-distributed. */
export function makeRng(seed: number | string) {
  let state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

/** A stable 0–1 value for one (structure, channel) pair. */
export function unit(seedKey: string): number {
  return makeRng(seedKey)();
}

/** A stable value in [low, high] for one (structure, channel) pair. */
export function span(seedKey: string, low: number, high: number): number {
  return low + unit(seedKey) * (high - low);
}

/** A stable log-uniform value — the right shape for potencies and clearances. */
export function logSpan(seedKey: string, low: number, high: number): number {
  const value = Math.exp(Math.log(low) + unit(seedKey) * (Math.log(high) - Math.log(low)));
  return value;
}

/** A stable pick from a list. */
export function pick<T>(seedKey: string, options: readonly T[]): T {
  return options[Math.floor(unit(seedKey) * options.length) % options.length];
}

/** A stable boolean with the given probability of being true. */
export function chance(seedKey: string, probability: number): boolean {
  return unit(seedKey) < probability;
}

/** Approximate standard normal via the Box–Muller transform, seeded. */
export function normal(seedKey: string, mean = 0, sd = 1): number {
  const u1 = Math.max(unit(`${seedKey}::u1`), 1e-9);
  const u2 = unit(`${seedKey}::u2`);
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal population sample — used for the virtual cohort spread. */
export function logNormalSample(rng: Rng, median: number, cv: number): number {
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
}

export function quantile(sorted: number[], probability: number): number {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function summarise(values: number[]): { median: number; p05: number; p95: number; mean: number; cv: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / (values.length || 1);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  return {
    median: quantile(sorted, 0.5),
    p05: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
    mean,
    cv: mean ? Math.sqrt(variance) / mean : 0,
  };
}
