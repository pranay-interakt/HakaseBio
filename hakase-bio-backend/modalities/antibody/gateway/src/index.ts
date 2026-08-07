import type { ModalityRouteSpec } from "@platform/contract";

/**
 * Antibody gateway surface.
 *
 * NOTE: `/api/ai/antibody-ml` is a legacy path — it is the only endpoint whose
 * `/api/ai/` prefix is baked into the Python service rather than applied by the
 * gateway, and the frontend currently calls it directly. It is declared here so
 * the surface is at least owned and visible; normalising it to the `/ai/*`
 * convention requires a coordinated frontend change.
 */
export const antibodyRoutes: ModalityRouteSpec = {
  id: "antibody",

  posts: {
    "/ai/antibody": "/predict/antibody",
    "/ai/antibody-ml": "/api/ai/antibody-ml",
  },
};

export default antibodyRoutes;
