# HakaseAI Evidence Object Schemas

Formalized Pydantic (v2) models + JSON Schema exports for the six Evidence
Objects described across the HakaseAI specification set:

- `physicochemical.py` — Physicochemical Service Spec (07), §14
- `structural.py` — Structural Biology Service Spec (08), §14
- `functional.py` — Functional Analysis Service Spec (09), §14
- `developability.py` — Developability Service Spec (10), §14
- `safety.py` — Safety Service Spec (11), §14
- `platform_evidence.py` — Platform Evidence Object, Evidence Framework (04) §3

`common.py` holds the shared envelope (header, confidence, uncertainty,
applicability domain, validation status, provenance, metadata) mandated by
the Evidence Framework Specification (04), §3–§11.

## Status: draft, not yet reviewed

These schemas are a first-pass **translation of prose/diagram specs into a
concrete, importable contract**. They close the "no formal schemas" gap
identified across the spec set, but they contain real judgment calls the
source documents left open. **Every file has an inline docstring flagging
its assumptions** — read those before treating any field as final. The
short version of what needs a scientific/engineering sign-off:

1. How per-field confidence (`{value, confidence}`) numerically maps to
   the platform-wide `[0,1]` confidence score (`common.py`).
2. The actual aggregation formula for `PlatformEvidenceObject.aggregated_confidence`
   / `aggregated_uncertainty` — none is specified anywhere in docs 02–05
   (`platform_evidence.py`).
3. The conflict-detection rule that populates `conflict_summary` — the
   *categories* of conflict are described in Decision & Reasoning Framework
   §6, but no machine-checkable rule exists yet.
4. Where numeric ranges/units weren't stated in the source docs (e.g. pLDDT
   scale 0–100 vs 0–1), a note is left in the field's `description=`.

Treat this package as the starting draft for Step 1 of closing your
implementation gaps — not as ground truth to build against unreviewed.

## Usage

```bash
pip install pydantic
python -m hakase_evidence_schemas.example_usage        # smoke test
python -m hakase_evidence_schemas.export_json_schema ./schemas
```

The JSON Schema files this produces are what you'd feed into:
- FastAPI request/response models (import the Pydantic classes directly),
- Evidence Bus publish-time validation (Evidence Framework §15),
- OpenAPI component schemas for docs 13 (REST API Spec).

## What's intentionally NOT here

- Database migrations (SQLAlchemy models / Alembic) — these Pydantic models
  are the *evidence* schema, not the *storage* schema. Evidence payloads
  live in Object Storage per Database Design Spec §6–7; only IDs/metadata
  belong in PostgreSQL. Building the SQLAlchemy layer is a good Step 2.
- The Decision Engine scoring logic itself (weights, thresholds) — that's
  a scientific-policy decision, not a schema decision, and shouldn't be
  drafted by an AI without your review of the actual weighting rationale.
- CLI/tool adapter code (Boltz-2, FoldX, NetMHCpan invocation) — these
  schemas define what comes *out* of those tools once mapped to Evidence
  Object fields, not how to invoke the tools themselves.

## Network note

This package's syntax was verified (`python -m py_compile`) in a sandboxed
environment without internet access, so `pydantic` could not be installed
to run a full import/validation smoke test here. Run
`python -m hakase_evidence_schemas.example_usage` yourself after
`pip install pydantic` to confirm end-to-end before relying on it.
