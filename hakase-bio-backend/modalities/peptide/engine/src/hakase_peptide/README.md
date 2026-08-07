# HakaseAI Peptide Discovery Platform — V3

A ground-up, layered, evidence-driven rebuild of the peptide vertical, following
the Architecture Specification set (docs 01–06). It reorganizes the platform's
existing **real** science — deterministic biochemistry (`models/peptide_properties.py`)
and trained GradientBoosting classifiers (`models/peptide_esm_ml.py`) — into the
V3 architecture, and moves structure prediction off mandatory GPU.

## What changed vs. the previous design

| Concern | Before | V3 (this package) |
| --- | --- | --- |
| Structure engine | Boltz-2 on GPU (RunPod/AWS/Azure), always | **ESMFold via API, GPU-free, by default** |
| Boltz-2 | The only structural path | Optional **conformation layer** (complexes/affinity/ensembles) |
| Communication | Direct model outputs | Immutable **Evidence Objects** on an Evidence Bus |
| Decisions | Embedded in workflow | Centralized, **policy-based Decision Engine** |
| Representation | Handcrafted features only | Descriptors by default; **NVIDIA ESM2-650M** optional |

Runs with **no API key and no GPU**. NVIDIA and Boltz-2 are opt-in upgrades.

## Layers

```
Layer 1  Infrastructure   hakase_peptide/infrastructure  (orchestrator, model registry,
                                                          evidence bus, audit, resources, faults)
Layer 2  Scientific        hakase_peptide/services        (physicochemical, structural,
                                                          functional, developability, safety)
Layer 3  Decision          hakase_peptide/decision        (policies, variables, scoring, engine, record)
Layer 4  Presentation      hakase_peptide/api             (FastAPI router at /v3/peptide)
```

Structure back end lives in `hakase_peptide/structure` (ESMFold providers +
optional Boltz-2 conformation layer); embeddings in `hakase_peptide/embeddings`.

## Providers (all env-configurable, see `.env.example`)

- **Structure (default):** ESMFold via the ESM Atlas public API — no key, no GPU,
  real coordinates + per-residue pLDDT. `STRUCTURE_PROVIDER=nvidia_esmfold` switches
  to the NVIDIA NIM ESMFold endpoint when `NVIDIA_API_KEY` is set.
- **Embeddings (default):** deterministic biochemical descriptors — no key.
  `EMBEDDING_PROVIDER=nvidia_esm2` switches to NVIDIA NIM ESM2-650M when keyed.
- **Conformation layer (optional):** Boltz-2 via the existing `models/cofolding.py`
  GPU pipeline. Enable with `ENABLE_CONFORMATION_LAYER=1` + a `GPU_PROVIDER`.

## HTTP API (mounted under `/v3/peptide`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Platform + provider status |
| GET | `/policies` | List decision policies (weights, thresholds, owners) |
| GET | `/models` | Model registry (versions, licenses, references) |
| POST | `/analyze` | **Full pipeline**: evidence for all 5 domains + GO/Conditional/NO-GO |
| POST | `/structure` | Single-chain ESMFold structure + geometry |
| GET | `/conformation/availability` | Whether the Boltz-2 layer is enabled |
| POST | `/conformation/submit` | Submit a Boltz-2 complex/affinity job (async) |
| GET | `/conformation/status/{job_id}` | Poll a conformation job |
| GET | `/audit/{execution_id}` | Full audit trail for a run |

### `/analyze` example

```bash
curl -X POST localhost:8000/v3/peptide/analyze -H 'Content-Type: application/json' -d '{
  "sequence": "GIGAVLKVLTTGLPALISWIKRKRQQ",
  "modality": "antimicrobial"
}'
```

Returns the input, the aggregated Platform Evidence Object (five immutable
Evidence Objects with confidence / uncertainty / applicability / provenance), and
a Decision Record with the platform score, hard-constraint evaluations,
cross-domain consistency conflicts, an experimental-recommendation list, and a
backward evidence trace.

## Honesty policy (enforced, not aspirational)

- No fabricated numbers, no silent fallbacks, no hard-coded results.
- A predictor that cannot run publishes a structured `unavailable` Evidence
  Object with a machine-readable `reason_code`; the Decision Engine treats it as
  missing (reducing completeness), never as a value.
- Every score, weight and threshold in the Decision layer is inspectable and
  each carries a literature reference. Evidence Objects are immutable.

## Tests

```bash
cd apps/ai-service
python -m pytest hakase_peptide/tests -q            # offline unit tests
HAKASE_RUN_LIVE=1 python -m pytest hakase_peptide/tests -q   # + live ESMFold API
```

## Architecture Repository Schema Alignment

This package is designed in accordance with the specifications in [hakaseai-architecture](file:///Users/pranaydinavahi/Downloads/Hakase-BioTwin-dev/hakaseai-architecture-temp). Note the following differences between this runtime implementation and the draft Pydantic schemas in the architecture repository's `Docs/Evidence Object Schemas`:

1. **Serialization Layer vs. Domain Models**:
   - The architecture repository defines specific, nested Pydantic models (e.g. `PhysicochemicalEvidence` with subclasses like `Descriptors`).
   - This implementation uses lightweight, frozen Python `@dataclass` classes (in `domain/`) with flat dictionary payloads (`scientific_payload`). This allows the scientific services to remain flexible as the underlying descriptors evolve.
2. **Variable Paths**:
   - Because our payloads are flat dictionaries, the dotted paths in `decision/variables.py` extract values directly (e.g., `physicochemical.instability_index`).
   - If migrating to the nested Pydantic schemas, these paths would need to be updated to match the nested structure (e.g., `descriptors.instability_index.value`).
3. **Identifiers**:
   - We use name-spaced string IDs (e.g., `evidence_<uuid4>`) for `evidence_id`, `subject_id`, and `execution_id` to prevent cross-resource collisions, whereas the draft schemas define them as plain `uuid.UUID` objects.
