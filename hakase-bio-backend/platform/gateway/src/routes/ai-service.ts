/**
 * AI service proxy.
 *
 * This file no longer contains a route table. Each modality declares the paths
 * it owns (see `modalities/<name>/gateway/src/index.ts`) and they are mounted
 * generically here, so adding a modality requires no change to the gateway.
 *
 * Platform-level endpoints — health, model status, and the shared structure
 * services that serve more than one modality — are declared below, because no
 * single modality owns them.
 */
import { Router, type IRouter } from "express";
import type { ModalityRouteSpec } from "@platform/contract";

import antibodyRoutes from "@modality/antibody-gateway";
import peptideRoutes from "@modality/peptide-gateway";
import smallMoleculeRoutes from "@modality/small-molecule-gateway";

import { mountModality } from "../modality-mount.js";

const router: IRouter = Router();

/**
 * Endpoints owned by the platform rather than by a modality.
 *
 * Protein and co-folding live here because co-folding serves peptide *and*
 * antibody — it is a shared structure service, so no modality can own it.
 */
const platformRoutes: ModalityRouteSpec = {
  id: "platform",

  posts: {
    "/ai/protein": "/predict/protein",
    "/ai/protein-ml": "/predict/protein-ml",
    "/ai/cofold": "/predict/cofold",
    "/ai/cofold/validate": "/predict/cofold/validate",
    "/ai/celltype-aggregation": "/predict/celltype-aggregation",
    "/ai/patient-line": "/predict/patient-line",
    "/ai/models/warmup": "/models/warmup",
  },

  gets: {
    "/ai/health": "/health",
    "/ai/models/status": "/models/status",
    "/ai/cofold/config": "/predict/cofold/config",
    "/ai/registry": "/registry/open-source",
  },

  paramGets: [
    { from: "/ai/cofold/status/:jobId", to: "/predict/cofold/status", params: ["jobId"] },
  ],
};

const SPECS: ModalityRouteSpec[] = [
  platformRoutes,
  smallMoleculeRoutes,
  peptideRoutes,
  antibodyRoutes,
];

/**
 * Wildcard mounts, exposed so `app.ts` can additionally serve them at the
 * server root. Some clients call a modality directly (e.g. `/v3/peptide/*`)
 * rather than under `/api`, so these prefixes are mounted in both places.
 */
export const rootMounts: Array<{ prefix: string; router: IRouter }> = [];

for (const spec of SPECS) {
  for (const mount of mountModality(router, spec)) {
    router.use(mount.prefix, mount.router);
    rootMounts.push(mount);
  }
}

export default router;
