import type { ModalityRouteSpec } from "@platform/contract";

/**
 * Gateway surface for this modality.
 *
 * A modality declares *data*, not an Express router — that keeps the dependency
 * arrow pointing one way (gateway -> modality) with no cycle.
 *
 * Prefer `wildcards` over `posts`/`gets`: one mount forwards every sub-path
 * under the prefix, so the gateway can never drift out of sync with the Python
 * router. Use the explicit tables only when paths must be remapped.
 */
export const modalityRoutes: ModalityRouteSpec = {
  id: "MODALITY",

  wildcards: [
    {
      mountAt: ["/ai/v1/MODALITY"],
      upstreamPrefix: "/v1/MODALITY",
      // Optional per-path overrides for long-running work:
      // timeouts: { "/v1/MODALITY/analyze": 180_000 },
    },
  ],
};

export default modalityRoutes;
