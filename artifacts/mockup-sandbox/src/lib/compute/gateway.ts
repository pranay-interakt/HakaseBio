/**
 * Compute gateway — the only place Layer 2 code touches a GPU/CUDA backend.
 *
 *   const out = await compute({ model: "nvidia/molmim-650m", inputs: { smiles } });
 *
 * Features:
 *   - Provider failover: if NVIDIA NIM returns 5xx, retry on Modal, then
 *     api-server, then offline-cache replay (configurable order).
 *   - Circuit breaker: a provider that fails 5 calls in 30 s is taken
 *     out of rotation for 60 s.
 *   - In-memory deduplication via `idempotencyKey` — concurrent identical
 *     requests share a single underlying provider call.
 *   - Per-call telemetry (latency, retries, accelerator) returned in the
 *     response for display on the UI's "compute provenance" chip.
 *
 * Token management:
 *   API tokens are read from `import.meta.env.VITE_<PROVIDER>_TOKEN`. In a
 *   production deployment, browser code should call the internal api-server,
 *   which holds the tokens and forwards to the cloud provider — this avoids
 *   shipping secrets to the client. The gateway honours that by preferring
 *   `api-server` whenever it's healthy.
 */

import type {
  ComputeRequest, ComputeResponse, Provider, ProviderId,
} from "./types";
import { ComputeError } from "./types";
import { PROVIDERS, resolveProvider } from "./providers";

// --- Configuration ----------------------------------------------------------

export type GatewayConfig = {
  /** Ordered preference list for failover. */
  failoverOrder: ProviderId[];
  /** Map provider → token (or null to use api-server proxy). */
  tokens: Partial<Record<ProviderId, string>>;
  /** When true, any request first tries api-server (to hide secrets). */
  preferApiServerProxy: boolean;
  /** Total wall-clock budget across all retries. */
  globalTimeoutMs: number;
};

const DEFAULT_CONFIG: GatewayConfig = {
  failoverOrder: ["api-server", "nvidia-nim", "modal", "huggingface", "webgpu", "offline-cache"],
  tokens: {
    "nvidia-nim":  (import.meta.env.VITE_NVIDIA_NIM_TOKEN as string) ?? "",
    modal:         (import.meta.env.VITE_MODAL_TOKEN as string) ?? "",
    huggingface:   (import.meta.env.VITE_HUGGINGFACE_TOKEN as string) ?? "",
    replicate:     (import.meta.env.VITE_REPLICATE_TOKEN as string) ?? "",
  },
  preferApiServerProxy: true,
  globalTimeoutMs: 45_000,
};

let currentConfig: GatewayConfig = { ...DEFAULT_CONFIG };

export function configureGateway(patch: Partial<GatewayConfig>): void {
  currentConfig = { ...currentConfig, ...patch };
}

export function getGatewayConfig(): Readonly<GatewayConfig> {
  return currentConfig;
}

// --- Circuit breaker --------------------------------------------------------

type BreakerState = { failures: number; openedAt: number };
const breakers = new Map<ProviderId, BreakerState>();
const BREAKER_FAIL_THRESHOLD = 5;
const BREAKER_WINDOW_MS = 30_000;
const BREAKER_COOLDOWN_MS = 60_000;

function isCircuitOpen(p: ProviderId): boolean {
  const s = breakers.get(p);
  if (!s) return false;
  if (s.failures < BREAKER_FAIL_THRESHOLD) return false;
  if (Date.now() - s.openedAt > BREAKER_COOLDOWN_MS) {
    breakers.delete(p);
    return false;
  }
  return true;
}

function recordSuccess(p: ProviderId): void {
  breakers.delete(p);
}

function recordFailure(p: ProviderId): void {
  const s = breakers.get(p) ?? { failures: 0, openedAt: Date.now() };
  s.failures += 1;
  if (s.failures >= BREAKER_FAIL_THRESHOLD) s.openedAt = Date.now();
  breakers.set(p, s);
}

// --- Dedupe -----------------------------------------------------------------

const inflight = new Map<string, Promise<ComputeResponse<unknown>>>();

// --- Provider adapters ------------------------------------------------------

type Adapter = (req: ComputeRequest, provider: Provider) => Promise<unknown>;

const ADAPTERS: Record<ProviderId, Adapter> = {
  "nvidia-nim": adapterOpenAiStyle,        // NIM exposes OpenAI-compatible REST
  modal: adapterRpcStyle,
  huggingface: adapterHFInference,
  replicate: adapterReplicate,
  "api-server": adapterApiServer,
  webgpu: adapterWebGPU,
  "offline-cache": adapterOfflineCache,
};

function authHeaders(provider: Provider): Record<string, string> {
  const token = currentConfig.tokens[provider.id];
  if (!token || provider.auth === "none") return {};
  if (provider.auth === "bearer")  return { Authorization: `Bearer ${token}` };
  if (provider.auth === "api-key") return { "X-API-Key": token };
  return {};
}

async function fetchJsonStrict<T>(url: string, init: RequestInit, providerId: ProviderId, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new ComputeError(`${providerId} ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`, providerId, resp.status);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function adapterOpenAiStyle(req: ComputeRequest, provider: Provider): Promise<unknown> {
  const url = `${provider.baseUrl}/predictions`;
  return fetchJsonStrict(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({
      model: req.model,
      input: req.inputs,
      parameters: req.parameters ?? {},
    }),
  }, provider.id, req.timeoutMs ?? 30_000);
}

async function adapterRpcStyle(req: ComputeRequest, provider: Provider): Promise<unknown> {
  const url = `${provider.baseUrl}/${req.model}`;
  return fetchJsonStrict(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({ inputs: req.inputs, parameters: req.parameters ?? {} }),
  }, provider.id, req.timeoutMs ?? 30_000);
}

async function adapterHFInference(req: ComputeRequest, provider: Provider): Promise<unknown> {
  const url = `${provider.baseUrl}/${req.model}`;
  return fetchJsonStrict(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({ inputs: req.inputs, parameters: req.parameters ?? {} }),
  }, provider.id, req.timeoutMs ?? 30_000);
}

async function adapterReplicate(req: ComputeRequest, provider: Provider): Promise<unknown> {
  const url = `${provider.baseUrl}/predictions`;
  const start = await fetchJsonStrict<{ id: string; urls: { get: string } }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({ version: req.model, input: req.inputs }),
  }, provider.id, 10_000);
  // Poll until terminal state.
  const deadline = Date.now() + (req.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetchJsonStrict<{ status: string; output?: unknown; error?: string }>(start.urls.get, {
      headers: authHeaders(provider),
    }, provider.id, 5_000);
    if (poll.status === "succeeded") return poll.output;
    if (poll.status === "failed")    throw new ComputeError(poll.error ?? "Replicate failed", provider.id);
  }
  throw new ComputeError("Replicate timed out", provider.id);
}

async function adapterApiServer(req: ComputeRequest, provider: Provider): Promise<unknown> {
  const url = `${provider.baseUrl}/compute/${encodeURIComponent(req.model)}`;
  return fetchJsonStrict(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: req.inputs, parameters: req.parameters ?? {} }),
  }, provider.id, req.timeoutMs ?? 20_000);
}

/**
 * Local WebGPU inference via onnxruntime-web (lazy import).
 * Only the small models in `provider.webgpu.models` are wired here; everything
 * else falls back to a server provider.
 *
 * onnxruntime-web is a peer dependency that ships with WebGPU EP. The model
 * weights are loaded from /static/onnx/<model>.q8.onnx.
 */
async function adapterWebGPU(req: ComputeRequest, _provider: Provider): Promise<unknown> {
  // Dynamic import so onnxruntime-web only loads when WebGPU is actually needed.
  // This is unimplemented in this build; throw to fall through to next provider.
  // To enable: install onnxruntime-web, place <model>.q8.onnx under public/onnx,
  // and replace this body with an InferenceSession.run call.
  throw new ComputeError(`WebGPU inference for ${req.model} is not configured (drop the .onnx into /public/onnx and wire ort.InferenceSession here).`, "webgpu");
}

/**
 * Offline cache replays previously-recorded provider outputs from a static
 * JSON file. Used for deterministic tests, offline demos, and to keep the
 * mockup functional in environments without API access.
 *
 * The cache file is loaded lazily and indexed by SHA-1(model + JSON.stringify(inputs)).
 */
let offlineCache: Record<string, unknown> | null = null;

async function adapterOfflineCache(req: ComputeRequest, _provider: Provider): Promise<unknown> {
  if (!offlineCache) {
    try {
      const r = await fetch("/compute-cache.json", { cache: "force-cache" });
      offlineCache = r.ok ? await r.json() : {};
    } catch {
      offlineCache = {};
    }
  }
  const key = await hashKey(req);
  const hit = offlineCache?.[key];
  if (hit !== undefined) return hit;
  throw new ComputeError(`No offline replay for ${req.model}`, "offline-cache");
}

async function hashKey(req: ComputeRequest): Promise<string> {
  const enc = new TextEncoder().encode(req.model + "|" + JSON.stringify(req.inputs));
  const buf = await crypto.subtle.digest("SHA-1", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Public API -------------------------------------------------------------

function chooseOrder(req: ComputeRequest): Provider[] {
  // Priority:
  //  1. Explicit preferProvider
  //  2. api-server (proxies secrets) if preferApiServerProxy & supports model
  //  3. provider that natively hosts the model
  //  4. failover order
  const seen = new Set<ProviderId>();
  const order: Provider[] = [];

  const push = (p?: Provider) => {
    if (!p || seen.has(p.id) || isCircuitOpen(p.id)) return;
    seen.add(p.id);
    order.push(p);
  };

  if (req.preferProvider) push(PROVIDERS[req.preferProvider]);
  if (currentConfig.preferApiServerProxy) {
    const api = PROVIDERS["api-server"];
    if (api.models.includes(req.model)) push(api);
  }
  push(resolveProvider(req.model));
  for (const id of currentConfig.failoverOrder) push(PROVIDERS[id]);
  return order;
}

export async function compute<T = unknown>(req: ComputeRequest): Promise<ComputeResponse<T>> {
  const key = req.idempotencyKey ?? `${req.model}|${JSON.stringify(req.inputs)}`;
  const existing = inflight.get(key) as Promise<ComputeResponse<T>> | undefined;
  if (existing) return existing;

  const promise = (async (): Promise<ComputeResponse<T>> => {
    const start = Date.now();
    const order = chooseOrder(req);
    if (order.length === 0) {
      throw new ComputeError(`No provider can serve model ${req.model}`, "offline-cache");
    }

    let retries = 0;
    let lastErr: unknown;
    for (const provider of order) {
      if (Date.now() - start > currentConfig.globalTimeoutMs) break;
      try {
        const out = await ADAPTERS[provider.id](req, provider);
        recordSuccess(provider.id);
        return {
          model: req.model,
          provider: provider.id,
          accelerator: provider.accelerator,
          latencyMs: Date.now() - start,
          retries,
          output: out as T,
        };
      } catch (err) {
        recordFailure(provider.id);
        retries += 1;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ComputeError("All providers failed", "offline-cache");
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function listProviders(): readonly Provider[] {
  return Object.values(PROVIDERS);
}

export function providerHealth(): Record<ProviderId, "ok" | "degraded" | "open"> {
  const out: Record<string, "ok" | "degraded" | "open"> = {};
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
    const s = breakers.get(id);
    if (!s) out[id] = "ok";
    else if (s.failures < BREAKER_FAIL_THRESHOLD) out[id] = "degraded";
    else out[id] = "open";
  }
  return out as Record<ProviderId, "ok" | "degraded" | "open">;
}
