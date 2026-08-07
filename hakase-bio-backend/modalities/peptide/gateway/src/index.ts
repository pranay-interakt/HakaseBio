import type { ModalityRouteSpec } from "@platform/contract";

/**
 * Peptide gateway surface.
 *
 * Peptide is served entirely by a wildcard mount: the Python side owns a
 * prefixed APIRouter (`/v3/peptide/*`), so the gateway forwards whatever it
 * exposes without a per-endpoint table to keep in sync. This is the pattern new
 * modalities should copy.
 */
export const peptideRoutes: ModalityRouteSpec = {
  id: "peptide",

  wildcards: [
    {
      mountAt: ["/ai/v3/peptide", "/v3/peptide"],
      upstreamPrefix: "/v3/peptide",
      timeouts: {
        // A full analysis runs the whole evidence pipeline; it needs far longer
        // than the default upstream timeout.
        "/v3/peptide/analyze": Number(
          process.env.AI_SERVICE_PEPTIDE_V3_ANALYZE_TIMEOUT_MS ?? 180_000,
        ),
      },
    },
  ],
};

export default peptideRoutes;
