# Physicochemical Service — M8 Implementation Notes

**Scope.** Record of the changes implementing roadmap milestone **M8**
(API surface, persistence & full-pipeline tests) from
[`physicochemical-implementation-roadmap.md`](./physicochemical-implementation-roadmap.md).
This is "Chat D" — it runs last and **exposes/tests the whole object** assembled
by Chats A/B/C. It follows the roadmap constraint verbatim: **expose the object
built by A/B/C — add no new science.**

Prerequisite milestones at time of writing:
- **A** ([`physicochemical-M1-M2-M3-M6det-implementation.md`](./physicochemical-M1-M2-M3-M6det-implementation.md)) — merged.
- **B** ([`physicochemical-M4-M5-M6emb-implementation.md`](./physicochemical-M4-M5-M6emb-implementation.md)) — merged.
- **C / M7** ([`physicochemical-M7-implementation.md`](./physicochemical-M7-implementation.md)) — **merged** (verified: `domain/modifications.py`, `models/cheminformatics.py`, and `test_physicochemical_modifications.py` present and wired into the descriptor path). M8 therefore exposes the modification-aware object.

---

## 1. Summary

Before this work the §14 Physicochemical Evidence Object could only be reached
through the **full** `POST /v3/peptide/analyze` pipeline — which runs all five
Scientific Services and the Decision Layer. There was no way to ask for the
deterministic physicochemical object on its own, and no test asserting that the
A/B/C object survives HTTP serialization and still resolves the downstream
decision variables.

M8 adds a **dedicated, decision-free endpoint** and its thin pipeline helper,
proxies it through the Node API server, and adds a focused test module. No
scientific logic is added — the endpoint returns exactly the Evidence Object the
`PhysicochemicalService` already builds.

| Concern | What shipped |
|---|---|
| **Dedicated entry point** | `pipeline.analyze_physicochemical(...)` runs **only** the Physicochemical Service (via a cached single-service orchestrator) and returns its one Evidence Object — no target, no policy, no Decision Record. |
| **HTTP surface** | `POST /v3/peptide/physicochemical` in `api/router.py`, with the same `422 / 503 / 500` error mapping as the sibling endpoints. |
| **numpy JSON-sanitization** | The router's numpy-safe `_sanitize` is extracted to a FastAPI-free `hakase_peptide/jsonsafe.py::sanitize` and reused, so embedding/engine numpy scalars serialize cleanly (and the sanitizer is unit-testable without a web server). |
| **Node proxy** | One passthrough row in `apps/api-server/src/routes/ai-service.ts`. |
| **Tests** | `tests/test_physicochemical.py` — endpoint contract, full-pipeline decision-variable extraction, and numpy-sanitization of an embeddings block. |
| **Persistence** | **Deliberately not added** — see §6. |

---

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `hakase_peptide/jsonsafe.py` | **new** | `sanitize()` — recursive numpy → JSON-native conversion (`np.bool_/integer/floating/ndarray`). Extracted verbatim from `router._sanitize` (pure move) so it is importable **without** FastAPI. Top-level because `api/__init__.py` eagerly imports the FastAPI router. |
| `hakase_peptide/pipeline.py` | modified | Add `analyze_physicochemical(...)` + a lazily-cached `_phys_orchestrator()` (`WorkflowOrchestrator([PhysicochemicalService()])`). Import `EvidenceType` + `PhysicochemicalService`. |
| `hakase_peptide/api/router.py` | modified | Add `PhysicochemicalRequest` + `POST /v3/peptide/physicochemical`; replace the local `_sanitize` with `from ..jsonsafe import sanitize as _sanitize` (behavior unchanged for every existing endpoint). |
| `apps/api-server/src/routes/ai-service.ts` | modified | Add `"/ai/v3/peptide/physicochemical": "/v3/peptide/physicochemical"` to the `POSTS` proxy table. |
| `hakase_peptide/tests/test_physicochemical.py` | **new** | Endpoint contract, decision-variable extraction, numpy-sanitization (see §5). |

**Explicitly untouched** (no-new-science guarantee): `services/physicochemical.py`,
`domain/schemas/physicochemical.py`, `models/peptide_properties.py`, and everything
under `embeddings/` — M8 consumes their output, it does not change it.

---

## 3. The thin helper (`pipeline.analyze_physicochemical`)

```python
analyze_physicochemical(
    *, sequence, cyclic=False, ph=7.4, ionic_strength_mM=150.0,
    disulfide_bridges=None, modifications=None,
) -> dict
```

It builds the `Peptide` (Stage 1 validation, incl. M7 modification
canonicalization/conflict rejection), runs a **single-service** orchestrator, and
returns:

```json
{ "input": <peptide.to_dict()>, "execution_id": "...",
  "evidence": <EvidenceObject.to_dict()>, "diagnostics": {...} }
```

**Why the orchestrator, not the service bare.** Routing the single service
through `WorkflowOrchestrator([PhysicochemicalService()])` reuses the platform's
never-fabricate failure isolation: a raised service error becomes a sanctioned
`unavailable` Evidence Object plus an audit record, exactly as in
`analyze_peptide` — rather than a 500 with a partial object. The orchestrator is
cached in a module-level singleton (`_PHYS_ORCHESTRATOR`), mirroring the existing
`_orchestrator()`.

**Decision-free by design.** This entry point intentionally does **not** assemble
`PlatformEvidence`, resolve a policy, or produce a Decision Record — those belong
to `analyze_peptide`. The response has no `platform_evidence` / `decision` keys.

---

## 4. HTTP surface & numpy sanitization

### 4.1 Endpoint

`POST /v3/peptide/physicochemical` (`PhysicochemicalRequest`: `sequence`,
`cyclic`, `ph`, `ionic_strength_mM`, `disulfide_bridges`, `modifications`) →
`sanitize(analyze_physicochemical(...))`. Error mapping matches the sibling
endpoints: `PeptideValidationError → 422`, `ServiceFailure → 503` (structured
`{reason_code, message}`), any other exception → `500`.

### 4.2 Node proxy

`apps/api-server/src/routes/ai-service.ts` forwards verbatim; the added row
exposes the route to the frontend as `POST /ai/v3/peptide/physicochemical`.

### 4.3 numpy sanitization (roadmap M8: "numpy JSON-sanitization for embeddings")

`hakase_peptide/jsonsafe.py::sanitize` recursively converts numpy scalars/arrays
to native Python so the payload round-trips through `json.dumps` / FastAPI's
encoder. On the **default key-free path the payload is already JSON-clean** —
embeddings are stored **by reference** (`storage_uri`), so only `dimension` (a
plain `int`) reaches the payload. The sanitizer is therefore **defensive**: it
guarantees correctness on the paths that *can* introduce numpy (a real/mock ESM2
PLM embedding, or raw engine scalars), which is exactly what the sanitization
test exercises directly.

Extracting `_sanitize` out of `router.py` (which imports FastAPI) into a
standalone module is what makes it unit-testable in the sanctioned deps-minimal
env. The move is byte-equivalent logic; every existing endpoint's serialization
is unchanged.

---

## 5. Testing

**Environment.** Same as Chats A/B/C — build a venv (`python3.14 -m venv`;
`pip install pytest pydantic numpy requests`). See
[`hakase-ai-service-test-env`](./physicochemical-implementation-roadmap.md).
**FastAPI is *not* among these deps**, so the endpoint's HTTP-level test
(`TestClient`) is guarded by `pytest.importorskip("fastapi")` /
`importorskip("httpx")` and **skips cleanly** in this env while running wherever
FastAPI is installed (e.g. CI / the running service).

```bash
cd hakase-bio-backend/apps/ai-service
./<venv>/bin/python -m pytest hakase_peptide/tests/test_physicochemical.py -q
```

### 5.1 Coverage (`test_physicochemical.py`)

**Endpoint contract**
- `test_helper_returns_single_physicochemical_evidence_object` — shape
  (`input`/`execution_id`/`evidence`); `evidence_type == "physicochemical"`,
  `validation_status != "unavailable"`; all twelve §6 descriptor groups + the §14
  blocks (`peptide_object_reference`, `descriptors`, `embeddings`, `provenance`,
  `confidence_summary`, `validation_status`) + the legacy flat `physicochemical`
  block; **no** `decision` / `platform_evidence` keys.
- `test_helper_honours_modifications_and_environment` — a C-terminal amide
  (`{"c_terminus": "amide"}`, M7) flows through and shifts `subject_id`.
- `test_helper_rejects_invalid_sequence` — a bad sequence raises
  `PeptideValidationError` (→ 422 at the endpoint).
- `test_endpoint_route_contract` — **FastAPI-guarded**: real `TestClient`
  `POST` returns `200` + the expected shape, and a malformed sequence returns
  `422`.

**Full-pipeline decision-variable extraction**
- `test_decision_variables_extract_from_exposed_object` — assemble a
  `PlatformEvidence` from the exposed object and confirm `extract_variables`
  resolves `net_charge_pH7`, `instability_index`, `hydrophobic_moment` via the
  documented `physicochemical.*` paths, each `present` with `normalized ∈ [0,1]`.
  (Deterministic/offline; the network-bound structural + ML services are covered
  end-to-end by the gated `test_live_pipeline`.)

**numpy JSON-sanitization of embeddings**
- `test_sanitize_converts_numpy_embedding_block` — an embeddings block carrying
  `np.int64/int32`, `np.float32`, `np.ndarray`, `np.bool_` is **not**
  `json.dumps`-able as-is, but is after `sanitize()`, with native-typed values.
- `test_helper_output_round_trips_through_sanitize` — the exact endpoint
  composition (`helper → sanitize → json.dumps → json.loads`) round-trips and
  preserves the pooled-vector `storage_uri`.

### 5.2 Result

- `hakase_peptide/tests`: **49 passed, 3 skipped** (the new module contributes 6
  passed + 1 skipped — the FastAPI `TestClient` test — and was separately
  verified **passing** in a FastAPI-equipped venv).
- Broader `apps/ai-service/tests`: **17 passed, 2 failed**. The two failures
  (`test_verdict_consolidation.py::test_threshold_fallback_is_honest`,
  `::test_status_declares_no_disk_state`) are the **pre-existing, unrelated**
  `models/live_calibration.py` failures documented in the test-env notes —
  untouched by this work.

---

## 6. Persistence decision (roadmap M8: "optionally `lib/db/src/schema/`")

**Not implemented — intentionally.** The roadmap's locked ethos is that V3
evidence is deliberately **not** persisted (`infrastructure/evidence_bus.py` is
in-memory), and a new Drizzle evidence table (`lib/db/src/schema/`) would be
net-new surface with **no consumer wired to read it**. M8 ships the endpoint +
helper + proxy + tests without a schema change. Adding an evidence table remains
a clean future increment if/when a reader exists.

---

## 7. Backwards-compatibility checklist

- ✅ `analyze_physicochemical` is **additive** — a new function; `analyze_peptide`
  and every existing endpoint are unchanged.
- ✅ `_sanitize` behavior is **identical** for every existing endpoint (pure
  extraction to `jsonsafe.sanitize`; the ndarray branch now recurses, which only
  affects nested-numpy arrays that previously would not have serialized anyway).
- ✅ `jsonsafe.py` is top-level and imports only numpy — importable **without**
  FastAPI, so the test suite runs in the deps-minimal env.
- ✅ Node proxy change is a single passthrough row; no behavior change to existing
  routes.
- ✅ No new science, no new required env, no persistence side effects.
- ✅ No fabricated values: a service failure surfaces as a sanctioned
  `unavailable` Evidence Object (via the orchestrator) or a structured `503`.
