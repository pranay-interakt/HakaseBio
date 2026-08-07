# Physicochemical Service — M1 / M2 / M3 / M6-deterministic Implementation Notes

**Scope of this document.** A detailed record of the changes made to implement
roadmap milestones **M1**, **M2**, **M3**, and the **deterministic half of M6**
from [`physicochemical-implementation-roadmap.md`](./physicochemical-implementation-roadmap.md),
against the spec `Docs/02-Scientific Services/07_Physicochemical_Service_Specification.md`
(§ references below point at that spec).

It explains **what** changed, **why**, the **design decisions** taken at each
fork, and **how to verify** the work. It is written so a reviewer who has not
seen the diff can understand the reasoning without reading every line of code.

---

## 1. Summary

Before this work the Physicochemical Service computed the core §6 descriptors
(pI/net charge, GRAVY, instability, aliphatic index, aromaticity, Boman index),
but four §6 descriptors were missing, the evidence payload was an untyped dict,
confidence was a single blended `1.0`, and provenance recorded no
reference-parameter-set versions.

This change set closes those gaps while **extending the existing
`ScientificService → engine → EvidenceObject` architecture in place** — nothing
was relocated or replaced. Concretely:

| Milestone | What shipped |
|---|---|
| **M1** | The four missing §6 deterministic descriptors in the engine: windowed hydrophobicity (§6.3), positional charge distribution/variance (§6.5), β-strand hydrophobic-moment option (§6.4), and the compositional-statistics block (§6.10). |
| **M2** | A typed, §14-conforming evidence payload, validated against a ported Pydantic schema, carried alongside the legacy flat descriptor block. |
| **M3** | Per-descriptor confidence tiers (`exact` / `reduced` / `unavailable`) and a `confidence_summary` roll-up that never replaces the per-field breakdown (§10.3). |
| **M6 (deterministic half)** | `provenance.reference_parameter_sets` (scale / pKa / mass-table versions) and `model_identifier_and_version`, sourced from the Model Registry. |

**Guiding constraint honored throughout:** never emit a fabricated value. Where
something cannot be computed, the sanctioned `unavailable` tier is used
(embeddings are deferred to M4 and are emitted as `unavailable`, not faked).

---

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `apps/ai-service/models/peptide_properties.py` | modified | M1 descriptors + parameter-set version constants. |
| `apps/ai-service/hakase_peptide/domain/schemas/__init__.py` | **new** | Export surface for the typed schema package. |
| `apps/ai-service/hakase_peptide/domain/schemas/physicochemical.py` | **new** | Ported/trimmed Pydantic §14 payload schema. |
| `apps/ai-service/hakase_peptide/services/physicochemical.py` | rewritten | Builds + validates the typed payload; per-descriptor confidence; provenance. |
| `apps/ai-service/hakase_peptide/infrastructure/model_registry.py` | modified | Deterministic-engine entry lists the new descriptor capabilities. |
| `apps/ai-service/hakase_peptide/tests/test_peptide_properties_descriptors.py` | **new** | M1 engine unit tests. |
| `apps/ai-service/hakase_peptide/tests/test_physicochemical_evidence.py` | **new** | M2/M3/M6 + decision-variable contract tests. |
| `apps/ai-service/scripts/inspect_physicochemical.py` | **new** | Manual-inspection helper (not part of the runtime path). |

---

## 3. M1 — Deterministic descriptors in the engine

**File:** `models/peptide_properties.py`

### 3.1 What was added

Four pure functions, each derived from a published formula (no ML, no
fabrication), plus the wiring that surfaces them in the
`predict_peptide_properties` return dict.

- **`_windowed_hydrophobicity(seq, window=7)` — §6.3.**
  Computes `H_window(k) = (1/w) Σ h(r_i)` over the Kyte–Doolittle scale for every
  window start position, yielding `n − w + 1` values. Amphipathic segments — the
  hallmark of membrane-active/antimicrobial peptides — appear as peaks a single
  GRAVY average would hide. Returns `{windowed_values, window_size,
  requested_window_size, scale}`.
  - *Design choice — default width 7.* The spec says "typically 5–9 residues";
    7 is the mid-range convention.
  - *Design choice — clamping.* For sequences shorter than the requested window,
    the width is clamped to the sequence length so a single whole-sequence window
    is reported rather than an empty profile. `requested_window_size` records what
    was originally asked for, so the clamp is transparent, not silent.

- **`_per_residue_charge(seq, ph=7.4)` + `_charge_distribution(seq, ph=7.4)` — §6.5.**
  The per-residue helper returns the signed Henderson–Hasselbalch charge each
  ionisable **side chain** contributes (0 for non-ionisable residues).
  `_charge_distribution` returns `{profile, variance, mean_abs_charge, ph}`, where
  `variance` is the positional variance of that per-residue charge — the "charge
  clustering vs. even distribution" signal §6.5 asks for.
  - *Design choice — termini excluded.* The two chain-end charges would otherwise
    dominate the positional statistics for short peptides; the profile is meant to
    describe the *internal* charge pattern. The headline net charge (which does
    include termini) is unchanged and still comes from the existing
    `_charge_at_ph`. This is documented in the function docstring.

- **β-strand hydrophobic-moment option — §6.4.**
  No new function was needed: the existing `_hydrophobic_moment(seq, angle_deg)`
  already accepts an angle. The engine now computes it at **both** 100° (α-helix,
  the existing default) and 160° (β-strand), and records the assumed periodicity.
  This satisfies the roadmap's "β-strand μH option, `assumed_periodicity`
  recorded" without disturbing the existing helix value that downstream code reads.

- **`_compositional_statistics(seq)` — §6.10.**
  Returns `{aa_frequencies, dipeptide_frequencies, cys_count, pro_content,
  gly_content}` — the auxiliary composition features §6.10 lists (Cys for
  disulfide potential, Pro for rigidity/protease resistance, Gly for flexibility).

### 3.2 New return-dict keys (signature unchanged)

`predict_peptide_properties(...)` gained these keys; **all pre-existing keys are
untouched** (additive change, so existing consumers — including the React
`PeptideResult` panel — are unaffected):

- `physicochemical.hydrophobic_moment_beta` and
  `physicochemical.hydrophobic_moment_periodicity_deg` (helix default = 100°).
- Top-level `hydrophobicity_profile`, `charge_distribution`,
  `compositional_statistics`, `hydrophobic_moment_profile`
  (`{helix_100deg, beta_160deg, default_assumed_periodicity_deg}`), and
  `reference_parameter_sets` (used by M6 — see §6).

### 3.3 Why in the engine and not the service

§5.2/§9 classify these as deterministic, closed-form, exactly reproducible
computations. They belong in the descriptor engine (`models/`), where the other
closed-form descriptors already live, so the service layer stays a thin
packaging step (§5.4).

---

## 4. M2 — Typed §14 evidence payload

**Files:** new `hakase_peptide/domain/schemas/physicochemical.py` (+ package
`__init__.py`); rewritten `hakase_peptide/services/physicochemical.py`.

### 4.1 The key architectural decision (roadmap decision #1)

The roadmap flagged a fork: **(a)** replace the dataclass `EvidenceObject` with
the typed Pydantic schema, or **(b)** keep the generic dataclass payload and
*validate* a typed block against the schema.

**We took (b).** Rationale:

- The dataclass `EvidenceObject` (`domain/evidence.py`) is the execution
  contract the whole platform already runs on (orchestrator, evidence bus,
  decision engine, immutability, checksums). Replacing it is a large blast
  radius for no functional gain here.
- The constraint "keep `decision/variables.py` paths resolving" is trivially met
  if we leave the existing flat `physicochemical.*` block in place.
- We still get real type-safety where §14 matters: the descriptors/embeddings/
  provenance/confidence-summary block is **validated at build time** against the
  ported schema, so a missing or misspelled field fails loudly.

### 4.2 The ported schema

`domain/schemas/physicochemical.py` is adapted from the architecture repo's
`Docs/Evidence Object Schemas/physicochemical.py` and the `common.py` primitives
it depends on, **trimmed to what the backend actually populates**. Two
deliberate deviations from the source, both driven by how the running system
works:

1. **`peptide_object_reference` is a `str`, not a `uuid.UUID`.** The platform's
   peptide identity is the deterministic `Peptide.subject_id`
   (e.g. `"peptide:ab12…"`), not a UUID.
2. **The heavy `EvidenceObjectBase` envelope is not duplicated.** Header,
   metadata, and top-level uncertainty already live on the dataclass
   `EvidenceObject`; re-modeling them here would create two sources of truth.
   The schema models only the payload sub-blocks the service fills.

Every model sets `extra="forbid"`, so validation actually catches unexpected
keys (there is a test that asserts this).

### 4.3 Payload shape

The service assembles a plain dict, validates it via
`PhysicochemicalTypedPayload.model_validate(...)`, then merges
`model_dump(mode="json")` into `scientific_payload`. The result carries **both**:

- The **§14 block** at the payload root: `peptide_object_reference`,
  `descriptors` (all 12 §6 groups), `embeddings`, `provenance`,
  `confidence_summary`, `validation_status`.
- The **legacy blocks** kept for back-compat: `physicochemical` (flat),
  `secondary_structure`, `charge_profile`, `hbd_hba`, `sequence`, `length`,
  `cyclic`, `environment`.

- *Design choice — `mode="json"`.* Dumping in JSON mode lowers the
  `ConfidenceTier` enums to plain strings, keeping the payload JSON-serialisable
  so the evidence object's `payload_checksum` (which `json.dumps`-hashes the
  payload) keeps working. There is a test for this.
- *Design choice — engine→schema field mapping.* `molecular_weight.value` maps
  to the **average** mass (`molecular_weight_avg_da`), because that is the mass
  pharmacology uses for mg/kg↔µM conversions; the monoisotopic value remains
  available in the legacy flat block. `net_charge_by_ph.profile` is the existing
  `charge_profile` re-keyed to pH strings (`"4.0"`, …, `"9.0"`).

### 4.4 Decision-variable contract (must not break)

`decision/variables.py` resolves `physicochemical.net_charge_pH7`,
`.instability_index`, and `.hydrophobic_moment` by dotted path against
`scientific_payload`. Because the flat `physicochemical` block is preserved
verbatim, these keep resolving. This is covered by an explicit contract test
(`test_decision_variable_paths_resolve`) that runs the values through
`extract_variables` and asserts each is `present` with a non-`None` normalized
score.

---

## 5. M3 — Per-descriptor confidence tiers

**File:** `hakase_peptide/services/physicochemical.py` (+ `ConfidenceTier` in the
schema).

### 5.1 Why tiers, not a probability

§10.1 is explicit: deterministic descriptors carry **no statistical
uncertainty** — a correctly computed closed-form value is exact. The only real
question is whether the reference constants exist for the input. So confidence is
reported as an ordinal tier, not a continuous score:

- **`exact`** — closed-form value over standard residues, all constants present.
- **`reduced`** — computed but flagged as less reliable for this input.
- **`unavailable`** — could not be computed (the sanctioned "no value" path).

### 5.2 The tier logic

A small helper (`tier_for(value, length_sensitive=…)`) assigns a tier per field:

- Any descriptor whose engine value is `None` → **`unavailable`** with a reason.
  (Standard-residue peptides never hit this today; the machinery exists for
  M7's non-canonical residues, where an unknown residue must degrade *only* the
  affected descriptor — §12.)
- **`hydrophobic_moment`** and **`instability_index`** are marked
  `length_sensitive`: at extreme lengths (`length < 5` or `length > 200`) they
  become **`reduced`**, because §12 calls these out as unreliable at extreme
  lengths. Thresholds are named constants (`_SHORT_LEN`, `_LONG_LEN`) with an
  explanatory note attached to the tier.
- Everything else is **`exact`**.

The critical property, tested on a 2-mer: only the two length-sensitive
descriptors flip to `reduced`; all other descriptors stay `exact`. Degradation
is **per-descriptor**, never whole-object (§10.1, §12).

### 5.3 `confidence_summary` — a roll-up, never a replacement

§10.3 forbids collapsing the breakdown into one number. The service emits
`confidence_summary = {deterministic_tier, embedding_tier, aggregate_note}`:

- `deterministic_tier` = `exact` unless any descriptor is `reduced`/`unavailable`,
  in which case `reduced`, with an `aggregate_note` that explicitly points the
  reader back to the per-descriptor breakdown.
- `embedding_tier` = `unavailable` (embeddings deferred — see §7).

The per-field tiers and the summary **coexist** in the payload; the summary is a
convenience for the Decision Layer, not a substitute for traceability.

---

## 6. M6 (deterministic half) — Provenance & reference parameter sets

**Files:** `services/physicochemical.py`, `models/peptide_properties.py`,
`infrastructure/model_registry.py`.

### 6.1 Reference parameter sets

The engine now defines `REFERENCE_PARAMETER_SETS`, naming the exact empirical
scale/table behind each descriptor, and surfaces a copy in its return dict:

```
hydrophobicity_scale      = Kyte-Doolittle-1982
pKa_set                   = in-tree-HH-ladder-v1
mass_table_monoisotopic   = in-tree-monoisotopic-v1
mass_table_average        = IUPAC-average-residue-v1
instability_scale         = Guruprasad-1990
aliphatic_index_coeffs    = Ikai-1980
boman_scale               = Boman-2003
helical_periodicity_degrees = 100
beta_periodicity_degrees    = 160
```

These flow into `provenance.reference_parameter_sets` in the typed payload and
into the dataclass `Provenance.parameters`, satisfying §14's "record the
parameter set that produced each value."

- *Design choice — honest version identifiers.* The pKa ladder and monoisotopic
  masses are in-tree constants, so they are named `in-tree-…-v1` rather than
  claiming an external standard we don't actually track. The scales that *are*
  literature scales are named after their source.

### 6.2 Model identifier & version

The service reads the deterministic engine's version from the Model Registry
(`peptide_biochem_engine`) via `version_map(...)` and records
`model_identifier_and_version = "peptide_biochem_engine:1.0.0"` in provenance
(and in the dataclass `Provenance.model_checkpoints`). Pulling from the registry
means the version stays a single source of truth.

### 6.3 Model Registry capabilities

The deterministic-engine entry's `capabilities` list was extended to advertise
the new descriptors (`windowed_hydrophobicity`, `charge_distribution`,
`compositional_statistics`, `hydrophobic_moment_beta`, `aromaticity`), so an
auditor querying the registry sees what the engine now produces.

### 6.4 What is intentionally *not* here

- **No UniProt / external DB calls.** §8 states no external database is required
  for the core deterministic descriptors, and network cross-referencing is out of
  scope for this change. Provenance records the parameter-set versions; it does
  not reach out to UniProt.
- **Embedding provenance** (model id/version) is the M6 *embedding* half, tied to
  M4/M5, and is deferred.

---

## 7. Embeddings — deferred, but honestly represented

Embeddings (§6.11) are roadmap **M4** and are **not** wired here. Rather than
omit the field (which would make the payload non-conforming) or fake a vector,
the service emits the §14 `embeddings` block with both `pooled_vector` and
`per_residue_matrix` marked `confidence: unavailable`, `dimension: null`,
`storage_uri: null`. Correspondingly:

- `confidence_summary.embedding_tier = "unavailable"`.
- The payload-level `validation_status = "partially_complete"` (deterministic
  descriptors complete, embeddings absent) — the honest §14 value.

This is exactly the "graceful degradation with explicit annotation" §12 mandates.

> Note: the payload-level `validation_status` (`partially_complete`) is a
> *completeness* statement and is distinct from the dataclass
> `EvidenceObject.validation_status`, which stays `INTERNALLY_VALIDATED` (a
> *validation-provenance* axis). Two different questions, two different fields.

---

## 8. Testing

**Environment.** No interpreter on the machine ships the test deps; the repo
`.venv` is empty. Create one:

```bash
cd hakase-bio-backend/apps/ai-service
python3.14 -m venv .venv-test
./.venv-test/bin/python -m pip install pytest pydantic numpy requests
# requests is imported transitively via infrastructure/resource_manager.py
```

**Run the new tests:**

```bash
./.venv-test/bin/python -m pytest \
  hakase_peptide/tests/test_peptide_properties_descriptors.py \
  hakase_peptide/tests/test_physicochemical_evidence.py -v
```

### 8.1 Coverage

`test_peptide_properties_descriptors.py` (M1):
- windowed hydrophobicity window count (`n − w + 1`), window size, manual-mean
  cross-check, and short-sequence clamping;
- μH helix(100°) ≠ β(160°), and the periodicity surfaced in the return dict;
- charge-distribution profile length + non-negative variance, and a zero-variance
  case for a neutral homopolymer;
- compositional statistics (frequencies sum ≈ 1, Cys/Pro/Gly);
- schema-preservation guard: new blocks present **and** legacy decision-layer
  keys intact.

`test_physicochemical_evidence.py` (M2/M3/M6):
- the payload validates against the typed schema, and `extra="forbid"` rejects an
  unexpected descriptor key;
- normal peptide → all `exact`, `embedding_tier` unavailable, breakdown and
  summary coexist;
- 2-mer edge case → only μH + instability `reduced`, others `exact`;
- provenance carries `reference_parameter_sets` + the registry model id;
- **decision-variable contract**: the three `physicochemical.*` paths resolve via
  `extract_variables`;
- payload is JSON-serialisable (64-char checksum).

### 8.2 Result

16 new tests pass; the pre-existing `test_domain_and_decision.py` (9 tests) still
passes. Full `apps/ai-service` suite: **42 passed, 2 skipped, 2 failed**. The two
failures are in `tests/test_verdict_consolidation.py`
(`test_threshold_fallback_is_honest`, `test_status_declares_no_disk_state`),
which exercise `models/live_calibration.py` and import none of the modules
touched here — they are **pre-existing and unrelated**.

### 8.3 Manual inspection

`scripts/inspect_physicochemical.py <SEQUENCE>` prints the raw engine descriptors
and the typed evidence block (values + per-descriptor tiers) for eyeballing:

```bash
./.venv-test/bin/python scripts/inspect_physicochemical.py GIGKFLHSAKKFGKAFVGEIMNS  # magainin-2
./.venv-test/bin/python scripts/inspect_physicochemical.py AC                         # 2-mer edge case
```

---

## 9. Deferred (explicitly out of scope here)

Per the roadmap grouping, the following are **not** in this change set:

- **M4** — wire real ESM-2/ProtT5 embeddings into the evidence (pooled +
  per-residue, `storage_uri`).
- **M5** — embedding confidence & OOD/length applicability flags.
- **M6 (embedding half)** — embedding model id/version provenance.
- **M7** — modification & non-canonical residue handling (RDKit; terminal caps,
  cyclization graph, D-AA, PEG, lipidation). The `unavailable` per-descriptor
  path added in M3 is the hook this will use.
- **M8** — API surface (`POST /v3/peptide/physicochemical`), persistence, and
  full-pipeline tests.

---

## 10. Backwards-compatibility checklist

- ✅ `predict_peptide_properties(...)` signature unchanged; only additive keys.
- ✅ Legacy `scientific_payload` blocks (`physicochemical`, `secondary_structure`,
  `charge_profile`, `hbd_hba`, …) preserved verbatim.
- ✅ `decision/variables.py` paths (`net_charge_pH7`, `instability_index`,
  `hydrophobic_moment`) resolve unchanged (contract-tested).
- ✅ Dataclass `EvidenceObject` contract untouched; payload stays JSON-plain so
  `payload_checksum` keeps working.
- ✅ No new runtime dependency on the critical path (schema validation uses the
  already-required `pydantic`).
