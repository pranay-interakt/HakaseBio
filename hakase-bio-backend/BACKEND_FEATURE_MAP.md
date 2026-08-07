# Hakase Bio Backend — Feature Map and Editing Guide

This is the practical map of the backend used by the small-molecule In Vitro and Confirmation workspaces. It is written for making safe changes: begin with the feature you want to change, follow the request path, and edit the owning module rather than adding science to a UI or proxy layer.

## 1. The important rule

The repository has two code tiers:

```text
platform/    Shared infrastructure and scientific substrates. It must not import a modality.
modalities/  Therapeutic verticals. Each owns its own routes, scientific engine, contract, validation and workers.
```

The small-molecule vertical is at `modalities/small-molecule/`. Its primary rule is:

```text
React display → Express gateway → FastAPI service → hakase_smallmol engine → response contract
```

The frontend must not calculate scientific values, create a stage decision, manufacture a fallback, or reinterpret model output. It sends inputs and renders returned values/statuses only.

The architectural rationale and the enforced import boundary are in [ARCHITECTURE.md](ARCHITECTURE.md). The boundary check is `scripts/check_boundaries.py`.

## 2. Start here: request flow and process ownership

| Concern | Owns it | Primary file | What to edit there |
|---|---|---|---|
| Browser API call | Standalone React workspace | `../hakase-invitro-workspace/src/App.tsx` and `src/ConfirmationWorkspace.tsx` | Request body, loading/error state, presentation only |
| Public `/api/ai/*` route declaration | Small-molecule gateway | `modalities/small-molecule/gateway/src/index.ts` | Add/remove the public-to-upstream route mapping |
| HTTP proxy, timeout, upstream error handling | Platform gateway | `platform/gateway/src/modality-mount.ts` | Shared transport only; do not place scientific logic here |
| Express app and mounted modality routes | Platform gateway | `platform/gateway/src/app.ts`, `platform/gateway/src/index.ts` | Server composition, middleware, route registration |
| Python app/router mounting and model warmup | FastAPI service | `service/src/hakase_service/main.py` | Process startup, route mount, warmup/health behaviour |
| Input schema and endpoint handler | Small-molecule engine | `modalities/small-molecule/engine/src/hakase_smallmol/router.py` | Pydantic request model and endpoint-to-function wiring |
| Layer 1 scientific orchestration | Small-molecule engine | `.../hakase_smallmol/l1/pipeline.py` | Layer 1 output schema and orchestration |
| Confirmation orchestration/presentation contract | Small-molecule engine | `.../hakase_smallmol/l2/pipeline.py` | Supported stages, server-side result selection/labels |
| Actual model/data integration | Owning engine module | `admet/`, `binding/`, `safety/`, `pk_ivive/`, etc. | Scientific implementation only |

### Ports and timeout

The Express gateway uses `AI_SERVICE_URL` (default `http://localhost:8090`) in `platform/gateway/src/modality-mount.ts`. Its default upstream timeout is `AI_SERVICE_TIMEOUT_MS`, falling back to 60 seconds. The development gateway exposed to the workspace is normally port 3000; the frontend development server is normally port 4176.

Long-running docking/FEP jobs deliberately do **not** share the ordinary synchronous route timeout. Their submit/status endpoints are separate and the frontend polls the returned job status.

## 3. Small-molecule directory map

```text
modalities/small-molecule/
├── engine/src/hakase_smallmol/
│   ├── router.py                  FastAPI endpoint definitions and request schemas
│   ├── l1/pipeline.py             Layer 1 orchestration, output contract and report
│   ├── l2/pipeline.py             Layer 2/Confirmation contract and stage dispatcher
│   ├── admet/                     ADMET and individual ADME model adapters
│   ├── binding/                   Binding affinity and DTA adapters
│   ├── safety/                    Safety triage, alerts, assay reliability and Tox21
│   ├── cardiotox/                 Local hERG/cardiotoxicity model
│   ├── dili/                      Local DILI model
│   ├── pk_ivive/                  Human PK/IVIVE and animal simulation functions
│   ├── vendor/hakase_admet/       Vendored ADMET model implementation and weights metadata
│   ├── drug_lookup.py             Exact identity/regulatory lookup helpers
│   ├── drug_target.py             Binding helper
│   ├── molecular_properties.py    Molecular-property endpoint
│   ├── fep_runpod.py              RunPod free-energy dispatch integration
│   └── tests/                     Unit tests for engine components
├── gateway/src/index.ts           Declarative public route surface
├── workers/fep-ties/              GPU worker assets for docking/TIES FEP
├── validation/                    Repeatable validation harnesses and held-out datasets
│   ├── datasets/                  Frozen benchmark/reference data
│   ├── tests/                     Validation-harness tests
│   ├── snapshots/                 Versioned expected validation results
│   └── reports/                   Generated validation reports
└── README.md                      Vertical-level notes and validation cautions
```

## 4. Layer 1 In Vitro — exact flow

### Entry point

`POST /api/ai/l1` is declared in `modalities/small-molecule/gateway/src/index.ts`. It is proxied to `POST /predict/l1`, implemented by `api_predict_l1` in `modalities/small-molecule/engine/src/hakase_smallmol/router.py`.

The request model is `L1PipelineRequest` in that router. It accepts:

- `smiles` (required)
- `target_protein`, `uniprot_id`, `pdb_id` (optional resolved or user-overridden target fields)
- `target_resolution` (provenance/confidence returned during target resolution)
- `therapeutic_area` (optional user context)

The handler calls `run_l1_pipeline()` in `l1/pipeline.py`.

### `run_l1_pipeline()` — where each visible Layer 1 section comes from

| UI/result area | Function or source | File to change |
|---|---|---|
| SMILES validation/canonical form | `_rdkit_readout()` | `l1/pipeline.py` |
| RDKit descriptors and conformer payload | `_rdkit_readout()` and `hakase_chemistry` descriptors | `l1/pipeline.py`; `platform/chemistry/src/hakase_chemistry/` |
| Physicochemical feasibility display | `_rdkit_assessments()` | `l1/pipeline.py` |
| ADMET endpoint map | `predict_admet_ml()` | `admet/admet_ml.py` |
| ADMET category grouping/labels | `_admet_assessments()` and `_admet_sections()` | `l1/pipeline.py` |
| hERG local screening | `predict_cardiotox()` | `cardiotox/cardiotox.py` |
| DILI local screening | `predict_dili_ml()` | `dili/dili_ml.py` |
| Safety-card wording and evidence envelope | `_safety_readouts()` / `safety_assessments` | `l1/pipeline.py` |
| Structural alerts and assay review | `assess_assay_reliability()` | `safety/assay_reliability.py` |
| Applicability domain | `_tanimoto_applicability()` | `l1/pipeline.py` |
| Regulatory outlook | `_regulatory_outlook()` → `drug_lookup.py` | `l1/pipeline.py`, `drug_lookup.py` |
| Final Layer 1 recommendation | `_stage_gate()` | `l1/pipeline.py` |
| Stored analysis record | `_ANALYSIS_STORE` write inside `run_l1_pipeline()` | `l1/pipeline.py` |
| Wet-lab report | `generate_l1_wetlab_report()` | `l1/pipeline.py` |
| Recorded manual review/override | `record_l1_override()` | `l1/pipeline.py` |

### Layer 1 response shape

The handler returns `analysis.data` containing `canonical_smiles`, `verdict`, `rdkit_feasibility`, `rdkit_assessments`, `tanimoto_applicability`, `safety`, `safety_assessments`, `assay_reliability`, `admet_ai_endpoints`, `admet_ai_sections`, `three_dimensional_structure`, `regulatory_outlook`, and `target_resolution`.

The analysis ID is an in-memory key owned by `l1/pipeline.py`. The record must be present for confirmation to load it. For production persistence/restarts, replace this store behind the same `get_l1_analysis()` / `record_l1_override()` interface; do not have the UI recreate prior science.

### Layer 1 manual review

`POST /api/ai/l1/overrides` → `api_record_l1_override()` → `record_l1_override()`.

This is where a reviewer decision and rationale are recorded. It deliberately does **not** replace the original model verdict. When changing review policy, edit validation and audit metadata here rather than altering the frontend button behaviour.

### Layer 1 report

`POST /api/ai/l1/report` → `api_generate_l1_wetlab_report()` → `generate_l1_wetlab_report()`.

This function builds the exported Markdown report from the stored analysis and manual review. If a new report section is required, add it here after the corresponding model/data output has been added to `analysis_data`.

## 5. Target protein resolution and selectivity evidence

Target protein selection is deliberately separate from organism metadata. The visible editable fields are target protein, UniProt ID and PDB ID. A user override has priority after validation; it is not silently replaced.

### Resolver and database endpoints

The browser calls datasource APIs through the gateway. The important functions/routes live in:

| Need | Endpoint | File and route |
|---|---|---|
| Resolve protein text/UniProt | `GET /chembl/resolve-protein` | `platform/datasources/src/chembl.ts` |
| Find possible target records | `GET /chembl/target-search` | `platform/datasources/src/chembl.ts` |
| Validate/find UniProt entry | `GET /uniprot/entry/:accession`, `/uniprot/search` | `platform/datasources/src/uniprot.ts` |
| Find PDB entries for a protein | `GET /pdb/by-uniprot` | `platform/datasources/src/chembl.ts` |
| Validate a PDB record | `GET /rcsb/entry/:pdbId` | `platform/datasources/src/rcsb-pdb.ts` |
| Target/compound bioactivity evidence | `GET /chembl/activities`, `/chembl/target` | `platform/datasources/src/chembl.ts` |
| Read-across selectivity evidence | `GET /chembl/selectivity-evidence` | `platform/datasources/src/chembl.ts` |

### Scientific rules implemented in `chembl.ts`

`/chembl/selectivity-evidence` is the source of the Off-Target, Selectivity and Potency Evidence UI. It:

1. accepts only suitable activity records (`IC50`, `EC50`, `Ki`, `Kd`) with an exact relation;
2. keeps activity types in separate groups, never computing a cross-type median;
3. normalizes values to nM server-side while retaining reported units/context;
4. rejects explicitly low-confidence, non-binding/ADMET, and obvious broad chemistry assay records;
5. requires at least three independent analogue compounds for a potency estimate;
6. returns `potency_estimate: null` and an insufficient-evidence reason otherwise;
7. exposes organism, assay context, measurement count, compound count and provenance;
8. excludes off-target cards that do not meet the estimate threshold, while preserving the honest “no eligible off-target records” limitation.

If you change analogue eligibility or units, edit this endpoint—not `App.tsx`. Its main route begins at the `/chembl/selectivity-evidence` handler in `platform/datasources/src/chembl.ts`.

## 6. Confirmation (Layer 2) — exact flow

### Contract and stage roster

`l2/pipeline.py` owns the Confirmation stage list in the `STAGES` constant:

| Stage | Name | Mode | Execution location |
|---:|---|---|---|
| 0 | Ingest Layer 1 outputs | contract | `l2_input_contract()` |
| 1 | Target druggability | synchronous model | `predict_protein_ml()` |
| 2 | Molecular docking | asynchronous explicit job | `/predict/dock` + status route |
| 3 | Binding + ADMET cross-check | synchronous models | `predict_binding_ml()` + `predict_admet_ml()` |
| 4 | Safety + selectivity cross-check | synchronous models | `predict_safety_triage()` + `predict_tox21_panel()` |
| 5 | Free-energy refinement | asynchronous explicit job | `/predict/fep` + status route |
| 6 | IVIVE PK projection | synchronous model | `predict_pk_ivive()` |
| 7 | QSP / PD coupling | not configured | no result is invented |
| 8 | Therapeutic-index ranking | not configured | no result is invented |
| 9 | Confirmation block | not configured | no result is invented |

`l2_input_contract(analysis_id)` is the one source of truth for the Layer 1 → Layer 2 handoff. It obtains the stored L1 analysis with `get_l1_analysis()` and copies the relevant resolved target, descriptors, verdict, review, ADMET, safety and regulatory information.

### Confirmation APIs

| UI action | Public API | Engine handler | Owning function |
|---|---|---|---|
| Load handoff + stage readiness | `POST /api/ai/l2/contract` | `api_l2_contract` | `l2_input_contract()` |
| Run one synchronous stage | `POST /api/ai/l2/stage` | `api_run_l2_stage` | `run_l2_stage()` |
| Run all configured synchronous stages | `POST /api/ai/l2/run-configured` | `api_run_configured_l2_stages` | `run_configured_l2_stages()` |
| Run virtual-tissue sub-track | `POST /api/ai/l2/virtual-tissue/run-configured` | `api_run_configured_virtual_tissue` | kernel translational functions |
| Submit docking | `POST /api/ai/dock` | `api_dock_submit` | `hakase_structure.docking` integration |
| Read docking config/status | `GET /api/ai/dock/config`, `/status/:jobId` | `api_dock_config`, `api_dock_status` | router + worker status |
| Submit free-energy job | `POST /api/ai/fep` | `api_fep_submit` | `fep_runpod.py` |
| Read free-energy config/status | `GET /api/ai/fep/config`, `/status/:jobId` | `api_fep_config`, `api_fep_status` | router + `fep_runpod.py` |

### Why a result may be unavailable

`_availability()` and `_result_status()` in `l2/pipeline.py` inspect model availability envelopes. A missing model, missing target, fallback, or insufficient input produces `unavailable`/`partial` with a reason. The UI should only present that status; it must not convert it to a score or an optimistic result.

### Presentation contract

`_presentation_for_stage()` in `l2/pipeline.py` selects labels and already-computed values for display. It performs no calculation. If you want a confirmed model output to appear in the Confirmation UI, add a server-side presentation field here after confirming the value exists in the relevant stage result. The React component `../hakase-invitro-workspace/src/ConfirmationWorkspace.tsx` only renders `presentation.groups`.

## 7. Model and science ownership map

| Scientific capability | Main function/module | Comments for edits |
|---|---|---|
| ADMET endpoint ensemble | `admet/admet_ml.py::predict_admet_ml` | Uses the vendored engine under `vendor/hakase_admet/`; preserve its weight/resource layout |
| ADMET metadata/units | `vendor/hakase_admet/admet_info.py` and `constants.py` | Change model metadata with care; output is consumed downstream |
| Individual solubility, Caco-2, VDss, half-life | `admet/solubility_ml.py`, `caco2_ml.py`, `vdss_ml.py`, `half_life_ml.py` | Each offers a narrower endpoint/adapter |
| CYP/BBB/BSEP/P-gp/PAMPA extras | `admet/cyp_inhibition_ml.py`, `bbb_ml.py`, `bsep.py`, `admetlab.py` | Third-party adapters must report unavailable on failure, never fabricate output |
| Binding affinity | `binding/binding_ml.py` | Used directly by Layer 2 Stage 3 |
| Drug-target affinity route | `binding/binding_dta_adapter.py` | `POST /predict/dta`; use for DTA-specific workflows |
| Protein druggability | `hakase_structure.protein_ml` (platform structure package) | Used by Layer 2 Stage 1 |
| hERG/cardiotoxicity | `cardiotox/cardiotox.py::predict_cardiotox` | Returns model information; not clinical safety |
| DILI | `dili/dili_ml.py::predict_dili_ml` | Screening result; keep validated thresholds explicit |
| Safety triage | `safety/safety_triage.py::predict_safety_triage` | Consolidated safety logic for Layer 2 Stage 4 |
| Tox21 panel | `safety/tox21_ml.py::predict_tox21_panel` | Layer 2 Stage 4 companion panel |
| Ames | `safety/ames_ml.py::predict_ames_ml` | Independent endpoint |
| Structural alerts | `safety/assay_reliability.py::assess_assay_reliability` | PAINS/Brenk and warning recommendations; do not treat as measured interference |
| Reactive metabolites | `safety/reactive_metabolites.py` | Endpoint route `/predict/reactive-metabolites` |
| Full in-vitro panel | `safety/invitro_panel.py::predict_invitro_panel` | Broader model stack, separate from focused L1 |
| IVIVE PK | `pk_ivive/pk_ivive.py::predict_pk_ivive` | Layer 2 Stage 6; input provenance lives in its returned `inputs` |
| Human disposition assembly | `pk_ivive/disposition.py` | Reusable PK composition logic |
| pKa/logP/Kp/measurement anchors | `pk_ivive/pka.py`, `logp_resolver.py`, `kp.py`, `measured_reference.py`, `pkdb_anchor.py` | Change one module at a time and rerun their tests |
| Animal cohort simulation | `pk_ivive/animal_sim.py::run_animal_cohort_simulation` | Mounted through the service composition root |
| Cell-type aggregation | `platform/kernel/src/hakase_kernel/translational/celltype_aggregation.py` | Virtual-tissue sub-track |
| Patient-line projection | `platform/kernel/src/hakase_kernel/translational/patient_line.py` | Virtual-tissue sub-track; inputs must stay server-provided |
| Docking | `platform/structure` docking package + `router.py::api_dock_submit` | Explicit asynchronous job; do not add to “run all” |
| Free-energy refinement | `fep_runpod.py` + `workers/fep-ties/` | Explicit cost/compute-controlled asynchronous job |

## 8. Complete small-molecule prediction API locator

All endpoint handlers are in `modalities/small-molecule/engine/src/hakase_smallmol/router.py`; all public mappings are in `modalities/small-molecule/gateway/src/index.ts`.

| Engine path | Handler | Feature |
|---|---|---|
| `/predict/l1` | `api_predict_l1` | Focused Layer 1 screen |
| `/predict/l1/overrides` | `api_record_l1_override` | Reviewer override record |
| `/predict/l1/report` | `api_generate_l1_wetlab_report` | Wet-lab report export |
| `/predict/l2/contract` | `api_l2_contract` | Confirmation handoff/availability |
| `/predict/l2/stage` | `api_run_l2_stage` | One Confirmation stage |
| `/predict/l2/run-configured` | `api_run_configured_l2_stages` | Synchronous Confirmation batch |
| `/predict/l2/virtual-tissue/run-configured` | `api_run_configured_virtual_tissue` | Virtual-tissue batch |
| `/predict/admet`, `/predict/admet-ml`, `/predict/admet-ml/batch` | `api_predict_admet*` | ADMET result endpoints |
| `/predict/properties` | `api_predict_properties` | Molecular property endpoint |
| `/predict/binding`, `/predict/binding-ml`, `/predict/dta` | `api_predict_binding*`, `api_predict_dta` | Binding and DTA |
| `/predict/protein-ml` | `api_predict_protein_ml` | Protein druggability |
| `/predict/cardiotox`, `/predict/dili-ml`, `/predict/safety-triage` | matching handlers | Safety models/triage |
| `/predict/tox21`, `/predict/tox21/assay`, `/predict/ames-ml` | matching handlers | Toxicology endpoints |
| `/predict/assay-reliability`, `/predict/reactive-metabolites` | matching handlers | Structural alerts/reliability and metabolite alerts |
| `/predict/invitro-panel` | `api_predict_invitro_panel` | Broad in-vitro panel |
| `/predict/pk/ivive`, `/predict/pk-anchor` | matching handlers | IVIVE and reference anchor |
| `/predict/celltype-aggregation`, `/predict/patient-line` | matching handlers | Translational/virtual-tissue projections |
| `/predict/solubility-ml`, `/predict/caco2-ml`, `/predict/vdss-ml`, `/predict/half-life-ml` | matching handlers | Focused ADME predictions |
| `/predict/cytotoxicity`, `/predict/ersilia`, `/predict/ersilia/status` | matching handlers | Optional external-model integration/status |
| `/predict/pgp-substrate`, `/predict/bsep-inhibition`, `/predict/pampa`, `/predict/phospholipidosis` | matching handlers | Supplementary ADME/safety assays |
| `/predict/applicability-domain` | `api_predict_applicability_domain` | Domain assessment |
| `/predict/known-drug`, `/predict/known-drug/status` | matching handlers | Known-drug lookup |
| `/predict/dock`, `/predict/dock/config`, `/predict/dock/status/{job_id}` | matching handlers | Asynchronous docking |
| `/predict/fep`, `/predict/fep/config`, `/predict/fep/status/{job_id}` | matching handlers | Asynchronous free-energy refinement |
| `/predict/full-pipeline` | `api_full_pipeline` | Legacy/full composed pipeline; do not duplicate its functions in a new UI |

## 9. Public scientific data-service map

These are Express datasource proxies in `platform/datasources/src/`. They are deliberately separate from model code so a data source can be reused by other modalities.

| File | External data capability | Important routes |
|---|---|---|
| `chembl.ts` | Compounds, bioactivity, target resolution, read-across selectivity, PDB by UniProt | `/chembl/compound`, `/activities`, `/target`, `/resolve-protein`, `/target-search`, `/selectivity-evidence`, `/similar-targets`, `/pdb/by-uniprot` |
| `uniprot.ts` | Canonical protein entry, sequence, search | `/uniprot/entry/:accession`, `/sequence/:accession`, `/search` |
| `rcsb-pdb.ts` | Experimental structure metadata/search/ligands | `/rcsb/entry/:pdbId`, `/search`, `/ligands/:pdbId` |
| `pubchem.ts` | Compound identity, assays, similarity | `/pubchem/compound/*`, `/pubchem/similar` |
| `bindingdb.ts` | Binding measurement lookup | `/bindingdb` |
| `opentargets.ts` | Target-disease and target-drug evidence | `/opentargets/*` |
| `fda-psg.ts` | Product-specific guidance / bioequivalence intelligence | `/fda-psg/*` |
| `ccte.ts` | CompTox chemistry and hazards | `/ccte/*` |
| `alphafold-db.ts` | Predicted structure availability | `/alphafold/*` |

Datasource registration is in `platform/datasources/src/index.ts`. If adding a new provider, make a focused router in that folder, mount it in `index.ts`, document availability/failure semantics, and do not return guessed evidence when the provider cannot be reached.

## 10. Where result layout comes from (so it is not mistaken for model logic)

The Confirmation UI is intentionally display-only:

- `../hakase-invitro-workspace/src/ConfirmationWorkspace.tsx` loads an L2 contract, starts a requested server stage, and renders `presentation.groups`.
- `ServerOutcome` renders fields supplied by `l2/pipeline.py::_presentation_for_stage()`.
- `../hakase-invitro-workspace/src/styles.css` controls readable stage layout; it must never decide the meaning of a value.
- The source model/result is always retained in the server response; adding an output field should start in the engine/presentation contract, not React.

## 11. Validation, tests and safe change workflow

### Tests and artefacts

| What changed | Run/check |
|---|---|
| TypeScript datasource/gateway code | `pnpm typecheck` in the affected package |
| Standalone React UI | `pnpm run build` in `../hakase-invitro-workspace` |
| Small-molecule engine component | Matching `modalities/small-molecule/engine/src/hakase_smallmol/tests/test_*.py` |
| Endpoint validation harness | `modalities/small-molecule/validation/run_validation.py` |
| Endpoint holdout checks | `validation/endpoint_validation.py`, `validation/holdout.py` |
| PK/IVIVE validation | `validation/run_pbpk_validation.py`, `validation/pbpk_metrics.py` |
| Regression review | Compare `validation/snapshots/` and reports before/after |
| Boundary protection | `scripts/check_boundaries.py` |

### Recommended edit sequence

1. Find the row in this document for the desired result.
2. Modify the owning scientific function or datasource route.
3. Preserve explicit unavailable/insufficient-input states.
4. Update `l1/pipeline.py` or `l2/pipeline.py` only if the composed response needs the new result.
5. Update a presentation contract only after the server result exists.
6. Update React only to render an already-returned field.
7. Run the narrow test and then the relevant build/typecheck.
8. For any model or threshold change, run the validation harness and review snapshot drift before merging.

## 12. Common troubleshooting

| Symptom | First places to inspect |
|---|---|
| Layer 1 slow on the first request | `service/src/hakase_service/main.py` warmup block, service logs, model weight availability; cold model loading is the usual cause |
| Gateway request times out | `platform/gateway/src/modality-mount.ts`, `AI_SERVICE_TIMEOUT_MS`, engine/service logs |
| Confirmation says target required | Stored L1 `requested.uniprot_id`; target-resolution/validation path; `l2/pipeline.py::_status_for()` |
| Docking/refinement does not run from “run all” | Expected: stages 2/5 require explicit dispatch and separate inputs/cost control |
| Model unavailable | Adapter’s `is_ready`/availability envelope and its dependency/weights; do not replace it with a synthetic result |
| Result exists but does not show in Confirmation | `l2/pipeline.py::_presentation_for_stage()` then `ConfirmationWorkspace.tsx::ServerOutcome` |
| Selectivity evidence looks implausible | `platform/datasources/src/chembl.ts` `/chembl/selectivity-evidence`, assay filters, count/unit fields |
| Regulatory outlook is empty | `l1/pipeline.py::_regulatory_outlook()` and `drug_lookup.py`; an exact-identity miss is an honest result, not an error to mask |
| Manual gate review did not alter the original verdict | Expected: override is recorded separately in `record_l1_override()` |

## 13. Things that are intentionally unavailable today

Stages 7–9 of Confirmation remain deliberately `not_configured`; they must not present any estimated output until a real server-side implementation, input contract, tests and presentation contract are provided. Docking and free-energy refinement are separate jobs by design because they need structure/ligand inputs and potentially expensive compute. Third-party datasource/model outages must remain visible as unavailable/partial states.
