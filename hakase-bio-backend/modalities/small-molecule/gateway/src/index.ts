import type { ModalityRouteSpec } from "@platform/contract";

/**
 * Small-molecule gateway surface.
 *
 * Every path here is owned by this modality. Adding an endpoint means editing
 * this file and the Python router in `../engine/src/hakase_smallmol/router.py`
 * — never the gateway.
 */
export const smallMoleculeRoutes: ModalityRouteSpec = {
  id: "small-molecule",

  posts: {
    // Single server-owned Layer-1 response for the display-only workspace.
    "/ai/l1": "/predict/l1",
    "/ai/l1/overrides": "/predict/l1/overrides",
    "/ai/l1/report": "/predict/l1/report",
    "/ai/assay-reliability": "/predict/assay-reliability",
    // Extended in-vitro bench — one server-orchestrated run across the focused
    // predictors that the compact Layer-1 contract does not include. Adding a
    // bench assay means editing `engine/src/hakase_smallmol/l1/assay_bench.py`,
    // never adding a fetch in the workspace.
    "/ai/l1/assay-bench/run": "/predict/l1/assay-bench/run",
    "/ai/l2/contract": "/predict/l2/contract",
    "/ai/l2/stage": "/predict/l2/stage",
    "/ai/l2/run-configured": "/predict/l2/run-configured",
    "/ai/l2/virtual-tissue/run-configured": "/predict/l2/virtual-tissue/run-configured",
    // Layer 3 — Virtual Preclinical Study Engine (Animal Cohort). All compute is
    // server-side; the workspace only renders the returned study record.
    "/ai/l3/contract": "/predict/l3/contract",
    "/ai/l3/design": "/predict/l3/design",
    "/ai/l3/run": "/predict/l3/run",
    "/ai/l3/gate": "/predict/l3/gate",
    "/ai/l3/signoff": "/predict/l3/signoff",
    // Layer 4 — First-in-Human Translation Engine. Same posture as Layer 3:
    // the projection is computed server-side and the workspace renders it.
    "/ai/l4/contract": "/predict/l4/contract",
    "/ai/l4/run": "/predict/l4/run",
    // Public-database evidence, assembled on the server so the browser makes
    // one call instead of nine cross-origin ones.
    "/ai/external/panel": "/predict/external/panel",
    // Full backend-owned in-vitro assay readout panel. This remains separate
    // from the compact Layer-1 contract because it runs a broader model stack.
    "/ai/invitro-panel": "/predict/invitro-panel",
    "/ai/admet": "/predict/admet",
    "/ai/properties": "/predict/properties",
    "/ai/binding": "/predict/binding",
    /**
     * @deprecated Legacy composed pipeline. It runs Layer-1-tier models only —
     * it does not touch Confirmation, IVIVE, Layer 3 or Layer 4 — so its name
     * overstates what it does. Kept for existing API consumers; the workspace
     * deliberately has no surface for it. Use `/ai/l1` or the assay bench.
     */
    "/ai/full-pipeline": "/predict/full-pipeline",
    "/ai/admet-ml": "/predict/admet-ml",
    "/ai/admet-ml/batch": "/predict/admet-ml/batch",
    "/ai/safety-triage": "/predict/safety-triage",
    "/ai/vdss-ml": "/predict/vdss-ml",
    "/ai/half-life-ml": "/predict/half-life-ml",
    "/ai/tox21/assay": "/predict/tox21/assay",
    "/ai/explain": "/predict/explain",
    // Observed clinical pharmacokinetics from PK-DB, used to anchor a
    // projection against real human data rather than only against itself.
    "/ai/pk-anchor": "/predict/pk-anchor",
    "/ai/cardiotox": "/predict/cardiotox",
    "/ai/dili-ml": "/predict/dili-ml",
    "/ai/solubility-ml": "/predict/solubility-ml",
    "/ai/binding-ml": "/predict/binding-ml",
    "/ai/protein-ml": "/predict/protein-ml",
    "/ai/dta": "/predict/dta",
    "/ai/tox21": "/predict/tox21",
    "/ai/celltype-aggregation": "/predict/celltype-aggregation",
    "/ai/patient-line": "/predict/patient-line",
    "/ai/reactive-metabolites": "/predict/reactive-metabolites",
    "/ai/bsep": "/predict/bsep",
    "/ai/cytotoxicity": "/predict/cytotoxicity",
    "/ai/ersilia": "/predict/ersilia",
    // ADMETlab 3.0 permeability / safety endpoints.
    "/ai/pgp-substrate": "/predict/pgp-substrate",
    "/ai/bsep-inhibition": "/predict/bsep-inhibition",
    "/ai/pampa": "/predict/pampa",
    "/ai/phospholipidosis": "/predict/phospholipidosis",
    "/ai/applicability-domain": "/predict/applicability-domain",
    // TDC single-endpoint second-opinion models for novel-compound safety.
    "/ai/ames-ml": "/predict/ames-ml",
    "/ai/cyp-inhibition-ml": "/predict/cyp-inhibition-ml",
    "/ai/bbb-ml": "/predict/bbb-ml",
    "/ai/caco2-ml": "/predict/caco2-ml",
    "/ai/known-drug": "/predict/known-drug",
    "/ai/dock": "/predict/dock",
    "/ai/fep": "/predict/fep",
    "/ai/pk/ivive": "/predict/pk/ivive",
    // The species-aware exposure workflow is owned by the small-molecule
    // service and consumes the completed Layer 1 analysis record server-side.
    "/ai/pbpk/exposure": "/predict/pbpk/exposure",
    // Multi-species popPK cohort simulation (scipy ODE + live physiology).
    "/ai/pbpk/animal-cohort": "/predict/animal-cohort",
  },

  gets: {
    "/ai/ersilia/status": "/predict/ersilia/status",
    "/ai/dock/config": "/predict/dock/config",
    "/ai/fep/config": "/predict/fep/config",
    "/ai/l1/assay-bench/catalog": "/predict/l1/assay-bench/catalog",
    // Calibrated species/strain rows, so the workspace picker cannot offer a
    // species the PBPK physiology store has no reference organ set for.
    "/ai/pbpk/species": "/predict/pbpk/species",
    "/ai/known-drug/status": "/predict/known-drug/status",
    "/ai/dta/status": "/predict/dta/status",
  },

  paramGets: [
    { from: "/ai/dock/status/:jobId", to: "/predict/dock/status", params: ["jobId"] },
    { from: "/ai/fep/status/:jobId", to: "/predict/fep/status", params: ["jobId"] },
    { from: "/ai/l3/report/:studyId", to: "/predict/l3/report", params: ["studyId"] },
    { from: "/ai/l4/report/:projectionId", to: "/predict/l4/report", params: ["projectionId"] },
  ],
};

export default smallMoleculeRoutes;
