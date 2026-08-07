# Session Changes — 2026-07-20

A running log of what changed in this working session, for the next reader. Deep
per-milestone reasoning lives in the milestone docs; this is the higher-level
"what happened and why" summary.

Related docs (same folder):
[roadmap](./physicochemical-implementation-roadmap.md) ·
[M1–M3 + M6-det](./physicochemical-M1-M2-M3-M6det-implementation.md) ·
[M4/M5/M6-emb](./physicochemical-M4-M5-M6emb-implementation.md) ·
[M7](./physicochemical-M7-implementation.md) ·
[M8](./physicochemical-M8-implementation.md)

---

## 1. Physicochemical embeddings — M4 / M5 / M6-embedding (implemented)

Wired the existing embedding providers (`hakase_peptide/embeddings/`) into the
Physicochemical evidence. Full detail in
[physicochemical-M4-M5-M6emb-implementation.md](./physicochemical-M4-M5-M6emb-implementation.md).
Headline:

- **M4 — wire embeddings, store by reference.** New `embeddings/storage.py`
  (`EmbeddingStore` + `LocalFilesystemStore`, `file://` URIs, config-driven write
  dir defaulting to `<tempdir>/hakase-embeddings/`). `NvidiaESM2Provider` now
  retains the per-residue matrix instead of discarding it. The service generates,
  stores-by-reference, and confidence-annotates the pooled + per-residue vectors.
- **M5 — embedding confidence & OOD.** New `embeddings/applicability.py`
  (length + compositional out-of-domain, §10.2) feeds
  `confidence_summary.embedding_tier` and `applicability_domain.extrapolation_flag`.
- **M6 (embedding half) — provenance.** `embedding_model_identifier_and_version`
  records the model that actually ran; `None` when the embedding is unavailable.
- **Honesty (§12).** Any embedding failure still publishes the evidence with the
  embedding field explicitly `unavailable` — never a fabricated vector.

### Files touched
- Modified: `config.py`, `embeddings/base.py`, `embeddings/descriptors.py`,
  `embeddings/esm2_nvidia.py`, `embeddings/__init__.py`, `services/physicochemical.py`.
- New: `embeddings/storage.py`, `embeddings/applicability.py`,
  `tests/test_physicochemical_embeddings.py`.
- Updated two Chat-A assertions in `tests/test_physicochemical_evidence.py` (the
  default path is now a stored descriptor surrogate, not `unavailable`).

### Tests
`hakase_peptide/tests`: **31 passed, 2 skipped**. The two pre-existing failures in
`tests/test_verdict_consolidation.py` (exercise `models/live_calibration.py`) are
unrelated and untouched.

---

## 2. Roadmap decisions recorded

The roadmap's **Decisions (locked)** section is the source of truth for the M4/M5
forks: local-fs storage default under `<tempdir>/hakase-embeddings/` wired through
`PlatformConfig`; `validation_status = "complete"` reserved for a real learned PLM
embedding (ESM2) that yields both pooled + per-residue, with the key-free
descriptor path staying `partially_complete` / `embedding_tier: reduced`; and the
§14 `validation_status` completeness field kept distinct from the
`domain/evidence.py` `ValidationStatus` enum. The implementation follows these
verbatim.

---

## 3. Considered: relocating `hakase_peptide` to the backend root (declined)

Investigated moving `hakase_peptide/` from `apps/ai-service/` to the backend root.
Declined after mapping the dependencies: `hakase_peptide` imports `models.*`
(`peptide_properties`, `peptide_esm_ml`, `cofolding`), a sibling package that stays
under `apps/ai-service/`, and it is loaded by `apps/ai-service/main.py` with
`apps/ai-service` on `sys.path` (deploy sets cwd there via `ecosystem.config.js`).
Relocating only the folder would not decouple anything — it would add a `sys.path`
shim and churn the launch/deploy config (`main.py`, pytest, `ecosystem.config.js`,
`Dockerfile`, CI) for a cosmetic change. Left in place. A genuine extraction would
first require decoupling `hakase_peptide` from `models/`.

---

## 4. Physicochemical API surface & full-pipeline tests — M8 (implemented)

Exposed the §14 Physicochemical Evidence Object (assembled by Chats A/B/C) on its
own dedicated endpoint, and added the tests that prove the whole object survives
serialization and still drives the Decision Layer. **No new science** — M8
consumes the A/B/C output unchanged. Full detail in
[physicochemical-M8-implementation.md](./physicochemical-M8-implementation.md).
Headline:

- **Thin helper.** `pipeline.analyze_physicochemical(...)` runs **only** the
  Physicochemical Service via a cached single-service orchestrator (reusing the
  never-fabricate failure isolation) and returns its one Evidence Object — no
  target, policy, or Decision Record.
- **Endpoint.** `POST /v3/peptide/physicochemical` in `api/router.py`, same
  `422 / 503 / 500` mapping as the siblings; proxied by one passthrough row in
  the Node `api-server/src/routes/ai-service.ts`.
- **numpy sanitization.** The router's numpy-safe `_sanitize` was extracted to a
  FastAPI-free `hakase_peptide/jsonsafe.py::sanitize` (so it is unit-testable in
  the deps-minimal env) and reused unchanged by every endpoint.
- **C / M7 confirmed merged** — the endpoint returns the modification-aware
  object; a C-terminal-amide test exercises it through the helper.
- **Persistence declined** — no `lib/db/src/schema/` table (V3 evidence stays
  in-memory per the roadmap ethos; no reader exists for a new table).

### Files touched
- New: `jsonsafe.py`, `tests/test_physicochemical.py`,
  `docs/physicochemical-M8-implementation.md`.
- Modified: `pipeline.py`, `api/router.py`,
  `apps/api-server/src/routes/ai-service.ts`.

### Tests
`hakase_peptide/tests`: **49 passed, 3 skipped** (new module: 6 passed + 1
FastAPI-guarded skip, separately verified passing with FastAPI installed). The
two `test_verdict_consolidation.py` failures are the pre-existing, unrelated
`live_calibration.py` ones.

---

## 5. Docs reorganization (earlier step)

Moved the peptide-specific docs out of the backend-level `docs/` into a package-local
`hakase_peptide/docs/` folder:

- `physicochemical-implementation-roadmap.md`
- `physicochemical-M1-M2-M3-M6det-implementation.md`
- `physicochemical-M4-M5-M6emb-implementation.md`
- `session-changes-2026-07-20.md` (this file, new)

`docs/probability-calibration-2026-07-17.md` stayed at the backend level — it spans
the ai-service and the frontend and is not peptide-specific. Cross-links between the
moved docs are same-folder relative links and were unaffected.
