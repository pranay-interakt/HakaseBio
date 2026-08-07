# Physicochemical Service — Implementation Roadmap

Source spec: `Docs/02-Scientific Services/07_Physicochemical_Service_Specification.md`
Reference evidence schema (typed, not yet in backend): `Docs/Evidence Object Schemas/physicochemical.py`

This roadmap extends the **existing** V3 vertical in place. It does not relocate or
replace the current service. All work follows the existing
`ScientificService → engine → EvidenceObject` architecture.

---

## Architecture map

| Concern | Location |
|---|---|
| Backend framework | `apps/ai-service/main.py` (FastAPI, :8090) + `apps/api-server` (Node/Express proxy) |
| Service layer | `hakase_peptide/services/` (contract: `services/base.py`) |
| Physicochemical service | `hakase_peptide/services/physicochemical.py` (exists) |
| Descriptor engine | `models/peptide_properties.py` (`predict_peptide_properties`) bridged via `services/compute.py` |
| Embeddings | `hakase_peptide/embeddings/{base,descriptors,esm2_nvidia,resolve}.py` (built, **not wired into physicochemical evidence**) |
| Evidence objects | `hakase_peptide/domain/evidence.py` (generic dataclass) + `domain/platform_evidence.py`. Typed §14 schema exists only in `Docs/Evidence Object Schemas/physicochemical.py`. |
| Decision variables (downstream consumers) | `hakase_peptide/decision/variables.py` — paths `physicochemical.net_charge_pH7`, `.instability_index`, `.hydrophobic_moment` MUST keep resolving. |
| Orchestration | `hakase_peptide/infrastructure/orchestrator.py` + `pipeline.py` (`analyze_peptide`) |
| API | `hakase_peptide/api/router.py` (`/v3/peptide/*`); Node proxy `api-server/src/routes/ai-service.ts` |
| Persistence | V3 evidence is NOT persisted; `infrastructure/evidence_bus.py` is in-memory. DB schema (Node) is `lib/db/src/schema/`. |

**Guiding constraint (repo ethos):** never emit a fabricated value. When something
cannot be computed, use the sanctioned `unavailable` path with a reason code
(`domain/evidence.py: unavailable_evidence`, per-field `confidence: unavailable`).

---

## Audit (what exists vs. what's missing)

Spec-complete today (§6): isoelectric point/net charge, GRAVY, instability index,
aliphatic index, aromaticity, Boman index.

Gaps:
- §6.3 windowed hydrophobicity profile — **missing**
- §6.5 charge distribution (positional variance) — **missing** (existing `_charge_profile` is by-pH, different)
- §6.4 hydrophobic moment — helix-only; no β-strand periodicity, `assumed_periodicity` not recorded
- §6.10 compositional statistics block — computed internally, not surfaced
- §6.1 MW — no modification mass increments
- §6.11 embeddings — providers exist but **not wired**; per-residue matrix discarded; no `storage_uri`
- §5.1/§6/§9 modification & non-canonical residue handling (RDKit) — **absent**; non-standard residues rejected
- §14 typed evidence payload — generic dict, not the typed schema
- §10 per-descriptor confidence tiers — single blended `1.0` (violates §10.3)
- §10.2 embedding OOD/length confidence — absent
- §14 provenance (model id/version, reference parameter sets) — partial

---

## Milestones

Each is independently shippable. Recommended grouping into chats: A = {M1,M2,M3,M6-det}, B = {M4,M5,M6-emb}, C = {M7}, D = {M8}.

### M1 — Complete deterministic descriptors in the engine
- Modify: `models/peptide_properties.py`
- Add: windowed hydrophobicity `H_window(k)` (configurable width), positional charge
  distribution/variance, β-strand μH option, surface compositional-statistics block.
- New keys in `predict_peptide_properties` return dict; signature unchanged.
- Tests: golden values on magainin/melittin; μH at 100° vs 160°.
- Evidence fields: `descriptors.hydrophobicity_profile{windowed_values, window_size}`,
  `descriptors.charge_distribution.profile`, `descriptors.compositional_statistics{...}`,
  `descriptors.hydrophobic_moment.assumed_periodicity`.

### M2 — Typed Physicochemical Evidence payload
- Modify: `services/physicochemical.py`, `domain/evidence.py`
- New: `hakase_peptide/domain/schemas/physicochemical.py` (port/adapt the Docs Pydantic model)
- Payload conforms to §14. Keep `decision/variables.py` paths resolving.
- Tests: schema-validation; decision-variable contract test.
- Evidence fields: full `descriptors` block, `peptide_object_reference`, `validation_status`.

### M3 — Per-descriptor confidence tiers
- Modify: `services/physicochemical.py`, evidence schema
- Per-field `exact/reduced/unavailable`; `confidence_summary{deterministic_tier, embedding_tier, aggregate_note}`. Never collapse the breakdown (§10.3).
- Tests: edge peptide → `reduced/unavailable` on affected fields only.

### M4 — Wire embeddings into physicochemical evidence
- Modify: `services/physicochemical.py`, `embeddings/base.py`, `embeddings/esm2_nvidia.py`
- New: `hakase_peptide/embeddings/storage.py` (`storage_uri` writer; local-fs fallback)
- Retain pooled + per-residue; store large assets by reference; embedding-unavailable → object still published with embedding marked `unavailable` (§12).
- Evidence fields: `embeddings.pooled_vector{dimension, storage_uri}`, `embeddings.per_residue_matrix{...}`.

### M5 — Embedding confidence & OOD flags
- Modify: `services/physicochemical.py`, `embeddings/`
- Length-appropriateness + compositional OOD → `embedding_tier`, `applicability_domain.extrapolation_flag` (§10.2).

### M6 — Provenance & reference parameter sets
- Modify: `services/physicochemical.py`, `infrastructure/model_registry.py`, `infrastructure/resource_manager.py`
- Deterministic half (scale/pKa/mass-table versions, UniProt cross-ref) belongs with Chat A; embedding model id/version belongs with Chat B.
- Evidence fields: `provenance.reference_parameter_sets`, `provenance.model_identifier_and_version`.

### M7 — Modification & non-canonical residue handling (largest, isolated)
- Modify: `domain/peptide.py`, `models/peptide_properties.py`
- New: `hakase_peptide/domain/modifications.py`, `models/cheminformatics.py` (RDKit; ChEMBL/PubChem via ResourceManager)
- Terminal caps, cyclization graph, D-AA, PEG, lipidation; MW increments; conflicting-modification rejection at Stage 1; unknown residue → affected descriptor `unavailable`, others intact.

### M8 — API surface, persistence & full-pipeline tests
- Modify: `hakase_peptide/api/router.py` (`POST /v3/peptide/physicochemical`), `api-server/src/routes/ai-service.ts`, optionally `lib/db/src/schema/`
- New: `hakase_peptide/tests/test_physicochemical.py`
- Thin `analyze_physicochemical(...)` helper in `pipeline.py`; numpy JSON-sanitization for embeddings.

---

## Sequencing

- A, B, C are largely independent → can run in parallel (separate chats/branches).
- D runs last (exposes/tests the whole object; wants A & B landed, C landed or explicitly deferred).
- Two decisions to make before starting:
  1. Reconcile dataclass `EvidenceObject` with the typed Docs schema, or keep generic payload + validate against schema (affects M2 blast radius).
  2. Object-storage backend for embedding `storage_uri` (M4) — none exists in V3 today.

## Decisions (locked)

- **Embedding storage (M4):** default `<tempdir>/hakase-embeddings/`, overridable via
  `EMBEDDING_STORAGE_DIR` wired through `PlatformConfig` in `config.py` (not ad hoc
  `os.environ`). NOT repo-relative. Write local files as `file://` URIs so the field
  upgrades cleanly to `s3://` later. Rationale: dev/local fallback only; embeddings are
  deterministic/recomputable so ephemerality is fine; avoids committing large binaries.

- **`validation_status` completeness (M2 defines field, M4 sets value):** reserve
  `"complete"` for a real learned PLM embedding (ESM2) that produces BOTH pooled vector
  and per-residue matrix. Descriptor-only surrogate path →
  `validation_status = "partially_complete"`, `confidence_summary.embedding_tier = reduced`,
  `per_residue_matrix` marked `unavailable`, `aggregate_note` explaining the surrogate.
  Consequence (accepted): the default no-key posture yields `partially_complete` on every
  run — an honest completeness signal, not a failure; the Decision Layer must treat it as
  "deterministic descriptors present & exact, PLM embedding absent."

- **Naming collision (A & B):** the §14 `validation_status {complete|partially_complete|failed}`
  completeness axis is DIFFERENT from the existing `ValidationStatus` enum in
  `domain/evidence.py` (`internally_validated`, ...). Do not overwrite the enum — add the
  §14 completeness field separately.
