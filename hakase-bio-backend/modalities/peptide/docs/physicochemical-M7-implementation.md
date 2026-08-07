# Physicochemical Service — M7 Implementation Notes

**Scope.** Record of the changes implementing roadmap milestone **M7**
(modification & non-canonical residue handling — the largest and riskiest,
isolated milestone) from
[`physicochemical-implementation-roadmap.md`](./physicochemical-implementation-roadmap.md).
This is "Chat C" and is independent of Chat A
([`physicochemical-M1-M2-M3-M6det-implementation.md`](./physicochemical-M1-M2-M3-M6det-implementation.md))
and Chat B
([`physicochemical-M4-M5-M6emb-implementation.md`](./physicochemical-M4-M5-M6emb-implementation.md)).

It follows the roadmap constraint verbatim: **keep it isolated, never fabricate
parameters for unknown chemistry, reject conflicting annotations at Stage 1, and
on an unknown residue mark only the affected descriptor `unavailable` and compute
the rest.**

---

## 1. Summary

Before this work the platform **rejected any non-standard residue outright**
(`domain/peptide.py` and `models/peptide_properties.py::_clean_sequence` raised on
anything outside the 20-letter alphabet), the free-form `modifications` dict was
stored but never interpreted, molecular weight carried **no modification
increments** (§6.1), and there was no cheminformatics path for linker chemistry
(§8/§9). Modification annotations were never checked for internal consistency.

This change adds a **structured modification model** and a **cheminformatics
descriptor engine**, wires terminal-cap / cyclization / D-amino-acid / PEG /
lipidation handling into the deterministic engine, and enforces the spec's
failure-handling rules (§12):

| Concern | What shipped |
|---|---|
| **Canonicalization (§5.1)** | `domain/modifications.py` — `ModificationSet.from_raw()` normalizes the free-form dict into structured `Modification` records (terminal caps, head-to-tail / side-chain cyclization, D-stereochemistry, PEGylation, lipidation). |
| **Conflict rejection (§5.1/§12)** | `ModificationConflictError` raised during canonicalization → re-raised by `Peptide.create` as `PeptideValidationError` = **reject at Stage 1**, not a partial evidence object. |
| **MW increments (§6.1)** | Exact literature cap constants (acetyl `+42.0367`, amidation `−0.9847`, …) applied to reported MW; terminal caps also correct net charge / pI (§6.2). |
| **Cheminformatics (§8/§9)** | `models/cheminformatics.py::resolve_linker()` — RDKit (optional) + built-in acyl table + ChEMBL/PubChem via the Resource Manager, resolving non-standard chemistry. |
| **Graceful degradation (§12)** | Unresolvable chemistry → **only** `molecular_weight` marked `unavailable` (value `null`); every sequence-derived descriptor is still computed exactly. Never a fabricated mass. |

---

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `hakase_peptide/domain/modifications.py` | **new** | `ModType`, `Modification`, `ModificationSet`, `ModificationConflictError`; free-text → structured normalization, conflict detection, known cap-mass constants, canonical identity/caching key. |
| `models/cheminformatics.py` | **new** | `resolve_linker()` + `LinkerResult`; optional-RDKit guard; built-in acyl/lipid increment table; ChEMBL/PubChem resolution via the Resource Manager; explicit `unavailable` reason codes. |
| `hakase_peptide/domain/peptide.py` | modified | Build/validate `mod_set` at Stage 1 (reject conflicts); fold modifications into `subject_id` **only when non-empty**; expose `canonical_modifications` in `to_dict`. |
| `models/peptide_properties.py` | modified | `_apply_modifications()` helper; `predict_peptide_properties(..., modifications=, resources=)`; terminal-cap charge overrides in `_charge_at_ph` / `_isoelectric_point` / `_charge_profile`; reported vs base MW; `modifications` output block. |
| `hakase_peptide/services/compute.py` | modified | Thread the canonical modification payload (JSON, hashable) through the lru-cache; descriptor path kept network-free (§13). |
| `hakase_peptide/infrastructure/resource_manager.py` | modified | `fetch_pubchem_by_name` / `fetch_chembl_by_name` (real REST, cached, `ServiceFailure` on network, `None` on miss). |
| `hakase_peptide/config.py` | modified | `pubchem_base_url` + `chembl_base_url` on `PlatformConfig` (env `PUBCHEM_BASE_URL` / `CHEMBL_BASE_URL`). |
| `hakase_peptide/tests/test_physicochemical_modifications.py` | **new** | MW deltas, cap charge correction, conflict rejection, unknown-residue graceful degradation, exact linker resolution, identity. |

**Explicitly untouched** (isolation guarantee): `services/physicochemical.py`,
`domain/schemas/physicochemical.py`, and everything under `embeddings/` — the
typed-evidence and embedding work happening in parallel (Chats A/B).

---

## 3. Canonicalization & conflict rejection (§5.1 / §12)

### 3.1 The structured model

`ModificationSet.from_raw(raw, sequence, cyclic, disulfide_bridges)` reads a
tolerant vocabulary from the free-form dict — `n_terminus`/`c_terminus`,
`cyclization`, `d_residues`, `pegylation`, `lipidation`, and a generic
`other`/`custom` list — and emits a tuple of frozen `Modification` records. Each
record carries its `ModType`, attachment `site` (`"N"`/`"C"` terminus or a 1-based
index), original `descriptor`, optional `smiles`, and — **only when known** — the
average/monoisotopic mass increment. The set also exposes the derived predicates
the descriptor engine asks about: `n_terminus_free` / `c_terminus_free` (a cap or
a ring removes the free terminus) and `d_positions()`.

An empty set is inert: it contributes nothing to identity or descriptors, so
**unmodified peptides behave exactly as before** (verified — the pre-existing
`subject_id` determinism test and all 22 Chat-A/B tests still pass).

### 3.2 Conflicts rejected at Stage 1

`ModificationSet._check_conflicts` raises `ModificationConflictError` on mutually
inconsistent metadata; `Peptide.create` catches it and re-raises
`PeptideValidationError` so the Workflow Orchestrator gets a validation failure
rather than a partial Evidence Object (§12 row "Conflicting modification
annotations"). Rules:

- **Head-to-tail ring + capped/free terminus.** A backbone ring consumes both
  termini into an internal amide, so neither can also be acetylated/amidated
  **or asserted free** — this is the spec's canonical example ("a residue marked
  both cyclized and having a free terminus at the same position").
- **Two different caps on one terminus.**
- **Conflicting conjugations at one site** (e.g. a residue declared both PEG and
  lipid attachment).
- **Out-of-range / malformed site** (D-AA or linker position outside `1..n`, or a
  non-integer position) — an unresolvable annotation, rejected rather than clamped.

---

## 4. MW increments & charge correction (§6.1 / §6.2)

`_apply_modifications(modifications, base_mw_mono, base_mw_avg, resources)` sums
the per-modification increments onto the base backbone masses:

- **Terminal caps** carry exact Unimod constants from `domain/modifications.py`
  (acetyl `+42.0367`/`+42.01057`, amidation `−0.9847`/`−0.98402`, formyl, methyl).
- **Linkers** (PEG/lipid/other) with no built-in mass are handed to
  `resolve_linker` (see §5).
- **D-amino acids / head-to-tail cyclization** are mass-neutral in this model
  (stereochemistry; and the base mass convention already carries the terminal
  water) and contribute `0.0`.

The result exposes `modified_mw_avg_da` / `modified_mw_mono_da` (or `None` when
any increment is unresolved), `total_increment_*`, `mw_resolved`, and
`unavailable_descriptors`. In the output the **reported** `physicochemical`
molecular weight uses these values; the unmodified backbone masses stay available
as `molecular_weight_base_da` / `molecular_weight_base_avg_da` so internal
heuristics (permeability, half-life, developability) never lose a number.

**Charge (§6.2).** `_charge_at_ph` / `_isoelectric_point` / `_charge_profile`
gained optional `n_term_free` / `c_term_free` overrides. When `None` they default
to `not cyclic` — **byte-identical to the previous behaviour** — so only a
declared cap changes the result: an N-terminal acetylation drops the free amino
group's ≈`+0.8` at pH 7.4, a C-terminal amidation drops the free carboxyl's `−1`.

---

## 5. Cheminformatics engine (§8 / §9)

`models/cheminformatics.py::resolve_linker(descriptor, smiles=, resources=)`
resolves an **exact** mass increment (and optional RDKit descriptors) in order,
first exact hit wins:

1. **Built-in acyl/lipid table** — lauroyl/myristoyl/palmitoyl/stearoyl (+ C12/…/
   C18 synonyms), increment = fatty-acid − H₂O; exact literature constants.
2. **RDKit over a supplied SMILES** — `MolWt` / `CalcExactMolWt` + logP/TPSA/HBD/HBA.
3. **ChEMBL / PubChem structure** via the Resource Manager (`fetch_pubchem_by_name`
   then `fetch_chembl_by_name`), then RDKit.
4. **Explicit `unavailable`** with a reason code (`rdkit_absent`,
   `chem_structure_not_found`, `polydisperse_no_structure`, …).

Two honesty seams:

- **RDKit is optional.** The import is guarded (`_HAS_RDKIT`); its absence never
  raises on import — the engine degrades to the table/database path and, failing
  those, to `unavailable`. (In the current environment RDKit is absent, so the
  built-in table is the live exact path and everything else degrades.)
- **A molecular weight is not a conjugation increment.** If a database returns a
  molecule's MW but no structure RDKit can use, the engine reports `unavailable`
  rather than pretending the isolated-molecule mass is the attachment increment.
- **Polydisperse PEG** (`PEG2000` with no explicit structure) is, by nature, not
  exactly resolvable → `unavailable` with `polydisperse_no_structure`.

`services/compute.py` keeps the cached descriptor path **network-free** (§13,
"No external network dependency on the critical path"): it calls the engine with
`resources=None`, so mass comes from constants/tables and unresolved chemistry
degrades to `unavailable` instead of firing a per-request ChEMBL/PubChem call.
The database path remains a wired, unit-testable capability for callers that
supply a Resource Manager.

---

## 6. Graceful degradation — "only the affected descriptor" (§12)

The key isolation result: when a declared modification's mass is unresolvable,
`_apply_modifications` sets the reported MW to `None` and records
`unavailable_descriptors = {"molecular_weight": <reason>}`. Because
`services/physicochemical.py` already maps a `None` value to
`confidence.tier = "unavailable"` (`tier_for(None)` from Chat A/M3), **no service
edit was needed**: `molecular_weight` is tiered `unavailable` while GRAVY,
aromaticity, aliphatic index, Boman, instability, charge, etc. stay `exact`, and
the `confidence_summary.deterministic_tier` becomes `reduced` (not `failed`).
This is exactly the spec's "compute all unaffected descriptors normally; mark the
specific affected descriptor(s) unavailable; do not fail the entire service."

---

## 7. Testing

**Environment.** Same as Chats A/B — build a venv (`python3.14 -m venv`;
`pip install pytest pydantic numpy requests`). See
[`hakase-ai-service-test-env`](./physicochemical-implementation-roadmap.md).

```bash
cd hakase-bio-backend/apps/ai-service
./<venv>/bin/python -m pytest hakase_peptide/tests -q
```

### 7.1 Coverage (`test_physicochemical_modifications.py`)

- **Unmodified baseline:** reported MW == base MW, `modification_applied` false,
  `mod_set` empty — zero regression.
- **Cap MW deltas:** N-terminal acetylation `≈ +42.04` avg; C-terminal amidation
  `≈ −0.98` avg (both against the base backbone mass, ±0.02).
- **Cap charge correction:** acetylation removes the N-terminal positive charge
  (net-charge drop between `0.6` and `1.0`).
- **Conflict rejection at Stage 1:** acetyl + `cyclic=True`, `free` terminus +
  `cyclic=True`, and an out-of-range D-amino-acid position all raise
  `PeptideValidationError` from `Peptide.create`.
- **Unknown-chemistry degradation:** polydisperse `PEG2000` → engine
  `mw_resolved=False` and `unavailable_descriptors["molecular_weight"]`; reported
  MW `None`; base mass + GRAVY/instability/aromaticity all still present.
  Through the service: `descriptors.molecular_weight.confidence.tier ==
  "unavailable"`, other descriptors `exact`, `deterministic_tier == "reduced"`.
- **Exact linker resolution:** palmitoyl lipidation resolves via the built-in
  table (`≈ +238.41` avg, `mw_resolved=True`); `resolve_linker` unit checks for
  the exact / polydisperse / unknown paths.
- **Identity:** unmodified `subject_id` stable; a real modification produces a
  distinct `subject_id`.

### 7.2 Result

`hakase_peptide/tests`: **43 passed, 2 skipped** (12 new M7 tests + the existing
suite, no regressions). The pre-existing, unrelated skips/failures in
`models/live_calibration.py` are unchanged and untouched by this work.

---

## 8. Backwards-compatibility checklist

- ✅ `predict_peptide_properties(...)` signature is **additive** (`modifications`,
  `resources` after `disulfide_bridges`); existing positional callers
  (`models/peptide_ml.py`, `main.py`) are unaffected.
- ✅ `_charge_at_ph` / `_isoelectric_point` / `_charge_profile` overrides default
  to the previous `cyclic`-derived behaviour — identical output for peptides with
  no declared caps.
- ✅ `Peptide.subject_id` folds modifications in **only when non-empty** —
  unmodified ids stay byte-identical.
- ✅ `services/physicochemical.py`, `domain/schemas/physicochemical.py`, and
  `embeddings/` are untouched — no interference with parallel Chat-A/B work.
- ✅ RDKit stays an **optional** dependency; its absence never breaks import.
- ✅ New config knobs default to public endpoints; no new required env, and the
  cached descriptor path stays network-free (§13).
- ✅ No fabricated parameters anywhere: unknown chemistry → explicit
  `unavailable` with a reason code (§11 / §12).
