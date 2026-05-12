/**
 * Shared types for the compute service.
 *
 * The compute service is the boundary between Hakase BioTwin and any GPU /
 * CUDA-accelerated inference backend. Browser code never talks to CUDA
 * directly; it asks the compute service for a prediction, and the service
 * routes the request to the provider configured in app settings.
 *
 * Why a service abstraction rather than direct fetch:
 *   - CUDA cannot run in a browser; GPU inference must happen in a server
 *     process (NVIDIA NIM, Modal, Replicate, HF Inference, internal api-server).
 *   - The same call site has to work in three modes: cloud (CUDA), local
 *     (WebGPU via onnxruntime-web), and offline-cache for deterministic tests.
 *   - Provider failover and a circuit-breaker live here, not in component code.
 */

export type ProviderId =
  | "nvidia-nim"        // NVIDIA NIM (CUDA, hosted models)
  | "modal"             // Modal serverless GPU
  | "huggingface"       // HuggingFace Inference Endpoints
  | "replicate"         // Replicate serverless
  | "api-server"        // Internal Hakase api-server (our deployment)
  | "webgpu"            // Local browser WebGPU (onnxruntime-web)
  | "offline-cache";    // Replay cached outputs for testing

export type AcceleratorType = "cuda" | "rocm" | "webgpu" | "cpu";

export type Provider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly accelerator: AcceleratorType;
  readonly baseUrl: string;
  readonly auth: "bearer" | "api-key" | "none";
  /** Models this provider exposes. */
  readonly models: readonly string[];
  /** Median latency hint (ms) for the dashboard chip. */
  readonly latencyHintMs: number;
};

export type ComputeRequest = {
  /** Model identifier, namespaced by provider (e.g. "nvidia-nim/molmim-650m"). */
  readonly model: string;
  /** Payload schema is model-specific; opaque to the gateway. */
  readonly inputs: unknown;
  /** Per-request inference parameters (temperature, etc). */
  readonly parameters?: Record<string, unknown>;
  /** Hard timeout, ms. Defaults to 30 s. */
  readonly timeoutMs?: number;
  /** If set, prefer this provider over the configured default. */
  readonly preferProvider?: ProviderId;
  /** Idempotency key — allows the gateway to dedupe & cache. */
  readonly idempotencyKey?: string;
};

export type ComputeResponse<T = unknown> = {
  readonly model: string;
  readonly provider: ProviderId;
  readonly accelerator: AcceleratorType;
  /** Wall-clock latency, ms. */
  readonly latencyMs: number;
  /** Number of provider retries that happened to fulfil this call. */
  readonly retries: number;
  readonly output: T;
  /** Provider-reported usage (tokens, GPU-seconds, etc) when available. */
  readonly usage?: Record<string, number>;
};

export class ComputeError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ComputeError";
  }
}
