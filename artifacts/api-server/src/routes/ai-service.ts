/**
 * AI service proxy.
 * All routes forward verbatim to the FastAPI service. We do NOT swallow errors:
 *   - upstream non-2xx → forwarded as-is (status + body)
 *   - upstream non-JSON → returned as text in an error envelope
 *   - network failure → 502 UPSTREAM_ERROR with the real cause
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler, UpstreamError } from "../lib/errors.js";

const router: IRouter = Router();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8090";
const UPSTREAM_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 60_000);

async function proxy(
  method: "GET" | "POST",
  upstreamPath: string,
  req: Request,
  res: Response,
  pathParams?: string[],
) {
  let url = `${AI_SERVICE_URL}${upstreamPath}`;
  for (const p of pathParams ?? []) {
    url += `/${encodeURIComponent(String(req.params[p] ?? ""))}`;
  }

  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  if (method === "POST") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(req.body ?? {});
  }

  let resp: globalThis.Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    throw UpstreamError(`AI service unreachable at ${AI_SERVICE_URL}: ${(e as Error).message}`);
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = await resp.json().catch(() => ({ error: "Malformed JSON from AI service" }));
    res.status(resp.status).json(data);
    return;
  }
  const text = await resp.text();
  res.status(resp.status).type(ct || "text/plain").send(text);
}

// ─── route table ────────────────────────────────────────────────────────────
const POSTS: Record<string, string> = {
  "/ai/admet": "/predict/admet",
  "/ai/properties": "/predict/properties",
  "/ai/binding": "/predict/binding",
  "/ai/protein": "/predict/protein",
  "/ai/full-pipeline": "/predict/full-pipeline",
  "/ai/admet-ml": "/predict/admet-ml",
  "/ai/cardiotox": "/predict/cardiotox",
  "/ai/dili-ml": "/predict/dili-ml",
  "/ai/protein-ml": "/predict/protein-ml",
  "/ai/solubility-ml": "/predict/solubility-ml",
  "/ai/binding-ml": "/predict/binding-ml",
  "/ai/reactive-metabolites": "/predict/reactive-metabolites",
  "/ai/bsep": "/predict/bsep",
  "/ai/cytotoxicity": "/predict/cytotoxicity",
  "/ai/ersilia": "/predict/ersilia",
  "/ai/applicability-domain": "/predict/applicability-domain",
  "/ai/known-drug": "/predict/known-drug",
  "/ai/peptide": "/predict/peptide",
  "/ai/antibody": "/predict/antibody",
  "/ai/dock": "/predict/dock",
  "/ai/fep": "/predict/fep",
  "/ai/celltype-aggregation": "/predict/celltype-aggregation",
  "/ai/patient-line": "/predict/patient-line",
  "/ai/pk/ivive": "/predict/pk/ivive",
  "/ai/cofold/validate": "/predict/cofold/validate",
  "/ai/cofold": "/predict/cofold",
};

const GETS: Record<string, string> = {
  "/ai/health": "/health",
  "/ai/ersilia/status": "/predict/ersilia/status",
  "/ai/fep/config": "/predict/fep/config",
  "/ai/models/status": "/models/status",
  "/ai/cofold/config": "/predict/cofold/config",
};

for (const [from, to] of Object.entries(POSTS)) {
  router.post(from, asyncHandler((req, res) => proxy("POST", to, req, res)));
}
for (const [from, to] of Object.entries(GETS)) {
  router.get(from, asyncHandler((req, res) => proxy("GET", to, req, res)));
}

// Routes with path params
router.get(
  "/ai/dock/status/:jobId",
  asyncHandler((req, res) => proxy("GET", "/predict/dock/status", req, res, ["jobId"])),
);
router.get(
  "/ai/fep/status/:jobId",
  asyncHandler((req, res) => proxy("GET", "/predict/fep/status", req, res, ["jobId"])),
);
router.get(
  "/ai/cofold/status/:jobId",
  asyncHandler((req, res) => proxy("GET", "/predict/cofold/status", req, res, ["jobId"])),
);
router.post(
  "/ai/models/warmup",
  asyncHandler((req, res) => proxy("POST", "/models/warmup", req, res)),
);

export default router;
