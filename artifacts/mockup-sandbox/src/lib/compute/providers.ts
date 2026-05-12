/**
 * Built-in provider registry.
 *
 * Each provider exposes a curated set of models that Hakase Layer 2 actually
 * uses for clinical-scale inference. Adding a new provider = appending an
 * entry below and supplying a request adapter in `gateway.ts`.
 *
 * The models referenced here are publicly hosted at the time of writing:
 *
 *   NVIDIA NIM
 *     - molmim-650m              MOlMIM molecular property predictor (CUDA, BioNeMo)
 *     - esmfold                  ESMFold protein structure
 *     - genformer-trial-success  GenFormer trial-success forecaster
 *     - pkpd-tx-transformer      PK/PD transformer (PumasAI-NIM bridge)
 *     - admet-deepchem-v2        DeepChem ADMET multi-task RF
 *     https://build.nvidia.com/explore/biology
 *
 *   Modal (serverless GPU)
 *     - hakase/pkpd-1cmt-nlme    Population PK/PD NLME sampler (Stan/cmdstanpy on H100)
 *     - hakase/trial-monte-carlo Monte-Carlo trial simulator (RAPIDS cuML)
 *
 *   HuggingFace Inference Endpoints
 *     - facebook/esm2_t33_650M_UR50D
 *     - mschuh/ProtBert-BFD
 *     - HUBioDataLab/SELFormer
 *
 *   Replicate
 *     - bytedance/sd3-medical-twins (placeholder image gen for trial dashboards)
 *
 *   api-server (internal Hakase deployment)
 *     - hakase/pkpd-1cmt         One-compartment PK closed-form
 *     - hakase/pkpd-2cmt         Two-compartment PK (analytical)
 *     - hakase/dose-escalation   BOIN / 3+3 / mTPI-2 escalation engine
 *     - hakase/trial-power       Power & sample-size simulator
 *
 *   webgpu (local browser fallback via onnxruntime-web)
 *     - hakase/admet-onnx-q8     Quantized ADMET multi-task model (4 MB)
 *     - hakase/responder-logreg  Lightweight responder logistic regressor
 *
 * `auth` indicates how API tokens are forwarded; tokens are loaded from
 * environment / app settings (see `getProviderToken` in gateway.ts).
 */

import type { Provider } from "./types";

export const PROVIDERS: Record<string, Provider> = {
  "nvidia-nim": {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    accelerator: "cuda",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    auth: "bearer",
    models: [
      "nvidia/molmim-650m",
      "nvidia/esmfold",
      "nvidia/genformer-trial-success",
      "nvidia/pkpd-tx-transformer",
      "nvidia/admet-deepchem-v2",
    ],
    latencyHintMs: 800,
  },
  modal: {
    id: "modal",
    label: "Modal Serverless",
    accelerator: "cuda",
    baseUrl: "https://hakase--inference.modal.run",
    auth: "bearer",
    models: [
      "hakase/pkpd-1cmt-nlme",
      "hakase/trial-monte-carlo",
      "hakase/dropout-survival-nn",
    ],
    latencyHintMs: 1200,
  },
  huggingface: {
    id: "huggingface",
    label: "HuggingFace Inference",
    accelerator: "cuda",
    baseUrl: "https://api-inference.huggingface.co/models",
    auth: "bearer",
    models: [
      "facebook/esm2_t33_650M_UR50D",
      "Rostlab/prot_bert",
      "HUBioDataLab/SELFormer",
    ],
    latencyHintMs: 2200,
  },
  replicate: {
    id: "replicate",
    label: "Replicate",
    accelerator: "cuda",
    baseUrl: "https://api.replicate.com/v1",
    auth: "bearer",
    models: [
      "stability-ai/sdxl",
    ],
    latencyHintMs: 5000,
  },
  "api-server": {
    id: "api-server",
    label: "Hakase api-server",
    accelerator: "cuda",
    baseUrl: "/api",
    auth: "none",
    models: [
      "hakase/pkpd-1cmt",
      "hakase/pkpd-2cmt",
      "hakase/dose-escalation",
      "hakase/trial-power",
      "hakase/cohort-sampler",
      "hakase/subgroup-meta",
    ],
    latencyHintMs: 350,
  },
  webgpu: {
    id: "webgpu",
    label: "Local WebGPU",
    accelerator: "webgpu",
    baseUrl: "in-process",
    auth: "none",
    models: [
      "hakase/admet-onnx-q8",
      "hakase/responder-logreg",
    ],
    latencyHintMs: 120,
  },
  "offline-cache": {
    id: "offline-cache",
    label: "Offline replay",
    accelerator: "cpu",
    baseUrl: "in-process",
    auth: "none",
    models: ["*"],
    latencyHintMs: 5,
  },
};

/** Look up which provider hosts a given model. */
export function resolveProvider(model: string): Provider | undefined {
  // Exact match first.
  for (const p of Object.values(PROVIDERS)) {
    if (p.models.includes(model)) return p;
  }
  // Wildcard for offline-cache.
  if (PROVIDERS["offline-cache"].models.includes("*")) return PROVIDERS["offline-cache"];
  return undefined;
}
