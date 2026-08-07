# Physicochemical Service — M4 / M5 / M6-embedding Implementation Notes

**Scope.** Record of the changes implementing roadmap milestones **M4** (wire
embeddings into the evidence), **M5** (embedding confidence & OOD flags), and the
**embedding half of M6** (embedding model id/version in provenance) from
[`physicochemical-implementation-roadmap.md`](./physicochemical-implementation-roadmap.md).
This is "Chat B" and builds on Chat A
([`physicochemical-M1-M2-M3-M6det-implementation.md`](./physicochemical-M1-M2-M3-M6det-implementation.md)).

It follows the roadmap's **Decisions (locked)** verbatim; where a choice was
locked, the rationale below points back at it rather than re-deciding.

---

## 1. Summary

Before this work the embedding providers (`hakase_peptide/embeddings/`) existed
but were **not wired** into the Physicochemical evidence: the §14 `embeddings`
block was emitted hard-coded `unavailable`, the per-residue matrix was discarded
even by the NVIDIA provider, there was no `storage_uri` writer, and provenance
carried no embedding model id.

This change wires the embeddings end-to-end while keeping the honesty constraint:
a real vector is generated and **stored by reference**, or the evidence is
published with the embedding explicitly `unavailable` — never a fabricated vector.

| Milestone | What shipped |
|---|---|
| **M4** | `embeddings/storage.py` (`EmbeddingStore` + `LocalFilesystemStore`, `file://` URIs); NVIDIA provider now retains the per-residue matrix; the service generates, stores-by-reference, and confidence-annotates the pooled + per-residue vectors. Embedding failure → object still published, embedding `unavailable` (§12). |
| **M5** | `embeddings/applicability.py` — length + compositional OOD (§10.2) → `confidence_summary.embedding_tier` and `applicability_domain.extrapolation_flag`. |
| **M6 (embedding half)** | `provenance.embedding_model_identifier_and_version` (+ the dataclass `Provenance.model_checkpoints`) records the embedding model that actually ran. |

---

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `hakase_peptide/config.py` | modified | `embedding_storage_backend` + `embedding_storage_dir` on `PlatformConfig` (env `EMBEDDING_STORAGE_BACKEND` / `EMBEDDING_STORAGE_DIR`). |
| `hakase_peptide/embeddings/base.py` | modified | `is_plm` flag on the provider contract (surrogate vs learned PLM). |
| `hakase_peptide/embeddings/descriptors.py` | modified | `is_plm = False`. |
| `hakase_peptide/embeddings/esm2_nvidia.py` | modified | `is_plm = True`; **retain** the `(residues, dim)` per-residue matrix instead of discarding it after mean-pooling. |
| `hakase_peptide/embeddings/storage.py` | **new** | `EmbeddingStore` ABC, `LocalFilesystemStore`, `resolve_embedding_store`, `load_embedding`. |
| `hakase_peptide/embeddings/applicability.py` | **new** | `embedding_applicability(seq)` — length/compositional OOD (§10.2). |
| `hakase_peptide/embeddings/__init__.py` | modified | Export the new storage + applicability surface. |
| `hakase_peptide/services/physicochemical.py` | modified | `_build_embeddings(context)` helper; wires embeddings, embedding_tier, extrapolation, provenance, and §14 completeness. |
| `hakase_peptide/tests/test_physicochemical_embeddings.py` | **new** | M4/M5/M6-emb + §12 + store round-trip tests. |
| `hakase_peptide/tests/test_physicochemical_evidence.py` | modified | Updated the two Chat-A assertions that assumed embeddings-unavailable-by-default. |

---

## 3. M4 — Wire embeddings; store by reference

### 3.1 The storage seam (locked decision #2)

`embeddings/storage.py` adds a minimal `EmbeddingStore` interface with a
`LocalFilesystemStore` default — the local-fs fallback the spec calls for. The
write dir is resolved from `PlatformConfig` (env `EMBEDDING_STORAGE_DIR`),
defaulting to `<tempdir>/hakase-embeddings/` — **never repo-relative**, so nothing
large is committed and tests stay hermetic. The pooled vector is written as
`.npy`, the per-residue matrix as compressed `.npz`; only `dimension` +
`storage_uri` land in the payload (stored **by reference**, not inlined). Filenames
are content-addressed by `subject_id` + `model_id` + `model_version` + kind, so
re-runs overwrite the identical artifact rather than accumulating. The `file://`
URI upgrades cleanly to `s3://`/`gs://` when a remote backend is added.

### 3.2 Retaining the per-residue matrix

`NvidiaESM2Provider.embed` previously mean-pooled and **discarded** the
`(residues, dim)` matrix. It now keeps it on `EmbeddingResult.per_residue` while
still returning the pooled mean. The descriptor surrogate has no learned
per-residue representation, so it leaves `per_residue = None` and the matrix slot
is honestly `unavailable` — not zero-filled.

### 3.3 Completeness & the surrogate (locked decision #3)

Only a genuine learned PLM embedding (`is_plm`) that emits **both** a pooled
vector and a per-residue matrix yields payload `validation_status = "complete"`.
The default key-free descriptor path is a **surrogate**:
`validation_status = "partially_complete"`, `embedding_tier = reduced`,
`per_residue_matrix.confidence = unavailable`, and an `aggregate_note` explaining
it. This means the default no-key posture reports `partially_complete` on every
run — an honest completeness signal ("deterministic descriptors present & exact,
PLM embedding absent"), not a failure.

### 3.4 Graceful degradation (§12)

`_build_embeddings` wraps provider resolution, `embed`, and the store write. Any
`ServiceFailure` (no key, network, parse, storage) **or** unexpected exception
degrades to `_embeddings_unavailable(...)`: the embedding block is emitted
`unavailable` (dimension/uri null), a warning is attached, and **the evidence
object is still published**. No path fabricates a vector.

---

## 4. M5 — Embedding confidence & OOD

`embeddings/applicability.py::embedding_applicability(seq)` answers a narrow,
deterministic question (§10.2): is the input inside the range where a PLM
embedding is trustworthy? Signals: length band (`< 5` too little context, `> 1024`
exceeds the window), non-standard residues, and low-complexity/homopolymeric
composition (dominant residue `> 80%`). It returns `in_domain` + `extrapolation_flag`
+ human-readable reasons (no invented "OOD score").

Wiring in the service:
- **`confidence_summary.embedding_tier`** — a real PLM embedding is `exact`
  in-domain, `reduced` out-of-domain; the descriptor surrogate is always `reduced`;
  a failed embedding is `unavailable`.
- **`applicability_domain.extrapolation_flag`** — the embedding OOD flag is OR-ed
  with the existing deterministic extreme-length flag (they are distinct signals;
  either makes the input an extrapolation).

### 4.1 Vocabulary note (locked decision #4)

The shared `ConfidenceTier` enum is `exact/reduced/unavailable` (no ML-specific
tier). For embeddings, `exact` = generated **and** in-domain, `reduced` =
generated but surrogate or out-of-domain, `unavailable` = generation failed.
Adding an ML-specific tier would ripple into the deterministic descriptors, so the
shared enum is reused with this documented meaning.

---

## 5. M6 (embedding half) — Provenance

`provenance.embedding_model_identifier_and_version` is set from the
`EmbeddingResult` that actually ran (`peptide_biochem_engine:1.0.0` for the
surrogate, `esm2_650m:650M` for ESM2), and the same id is appended to the
dataclass `Provenance.model_checkpoints`. On the unavailable path it is `None` —
honest: nothing produced an embedding. The deterministic-engine provenance from
Chat A is untouched.

---

## 6. Testing

**Environment.** Same as Chat A — build a venv (`python3.14 -m venv .venv-test`;
`pip install pytest pydantic numpy requests`). See
[`hakase-ai-service-test-env`](./physicochemical-implementation-roadmap.md).

```bash
cd hakase-bio-backend/apps/ai-service
./.venv-test/bin/python -m pytest hakase_peptide/tests -q
```

### 6.1 Coverage (`test_physicochemical_embeddings.py`)

- **Descriptor path (key-free):** pooled vector stored by reference, `storage_uri`
  is a real `file://` whose artifact loads to the reported `(26,)` shape;
  per-residue `unavailable`; `partially_complete`; embedding provenance
  `peptide_biochem_engine:1.0.0`.
- **Mocked NVIDIA ESM2:** `requests.post` monkeypatched to return an `npz`
  `(L, 1280)`; pooled + per-residue both stored (`1280`-dim, matrix shape
  `(L, 1280)`); in-domain → `exact`; `complete`; provenance `esm2_650m:650M`.
- **§12 unavailable:** NVIDIA requested with no key → embedding `unavailable`,
  no fabricated vector (`dimension`/`storage_uri` null), evidence still published,
  deterministic descriptors unaffected, a warning present.
- **M5 OOD:** homopolymer (in-length-band but low-complexity) sets
  `applicability_domain.extrapolation_flag`; unit checks of
  `embedding_applicability` for short / low-complexity / non-standard inputs.
- **Store round-trip:** `LocalFilesystemStore` write → `load_embedding` recovers
  the matrix.

Two Chat-A assertions were updated (the default path now yields a descriptor
surrogate, not `unavailable`).

### 6.2 Result

`hakase_peptide/tests`: **31 passed, 2 skipped**. The pre-existing, unrelated
failures in `tests/test_verdict_consolidation.py` (`models/live_calibration.py`)
are unchanged and untouched by this work.

---

## 7. Backwards-compatibility checklist

- ✅ `EmbeddingResult` / provider signatures additive (`is_plm`, `per_residue`).
- ✅ Legacy `scientific_payload` blocks and `decision/variables.py` paths untouched.
- ✅ §14 `validation_status` completeness field stays separate from the dataclass
  `ValidationStatus` enum (locked decision — no enum overwrite).
- ✅ Payload stays JSON-plain (`storage_uri` strings) so `payload_checksum` works.
- ✅ New config knobs default to the no-key / local-fs posture; no new required env.
