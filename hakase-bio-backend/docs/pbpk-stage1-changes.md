# PBPK Layer — Stage 1 (Disposition Parameters) — Change Documentation

**Scope:** everything built for **Stage 1** of the PBPK/exposure layer, tasks
**S1‑T1 … S1‑T6** (plus an added **S1‑T2b**), per `docs/pbpk-layer.md` Part 6.
Stage 1 delivers the **disposition producer**: it turns *molecule + species* into
a validated, uncertainty‑tagged **`DispositionParameters`** object — the single
contract the Stage‑2 tissue‑PBPK ODE will consume. **No ODE is built in Stage 1.**

**Author:** bh‑yeshwanth · **Base:** `dev` @ `2850d0d` · **Status:** all tasks
implemented, reviewed, and committed on feature branches; **nothing merged to
`dev` yet** (branches stacked locally per instruction).

---

## 1. What Stage 1 produced (at a glance)

The disposition front‑end now emits, for a small molecule, a kernel‑level
`DispositionParameters` object carrying:

- fraction unbound (plasma & blood), blood:plasma ratio;
- the **clearance split** — hepatic (metabolic), renal (filtration), total;
- **per‑organ Rodgers & Rowland Kp** (12 tissues);
- steady‑state volume (VDss), extraction ratio, hepatic first‑pass;
- **species context** and an **applicability‑domain** verdict;
- **Monte‑Carlo intervals** on the derived quantities;
- a **Kp‑derived Vss cross‑check** against the ML VDss.

Every numeric field carries the full `{value, ci_low, ci_high, provenance,
source, units}` envelope. The design is **common‑core + modality‑extension**, so
mAb/nucleic‑acid modalities can reuse the kernel pieces later.

---

## 2. Commit / branch map

One task = one branch = one focused commit (Part 7). Branches are **stacked**
where a task depends on earlier, unmerged work.

| Task | Branch | Commit | Tier | Depends on |
|------|--------|--------|------|-----------|
| S1‑T1 | `feat/pbpk-disposition-contract` | `88db00a` | kernel | — (from `dev`) |
| S1‑T2 | `feat/pbpk-physiology-store` | `d806d63` | kernel | — (from `dev`) |
| S1‑T2b | `feat/pbpk-species-extrapolation` | `71bbf9d` | kernel | S1‑T2 |
| S1‑T3a | `feat/pbpk-pka-predictor` | `66d7511` | modality | — (from `dev`) |
| S1‑T3 | `feat/pbpk-rr-kp` | `0018de3` | modality | S1‑T3a + S1‑T2 |
| S1‑T4 | `feat/pbpk-uncertainty-helpers` | `f1412b2` | kernel | — (from `dev`) |
| S1‑T5 | `feat/pbpk-ivive-uncertainty` | `42b8682` | modality | S1‑T4 + S1‑T2 |
| S1‑T6 | `feat/pbpk-disposition-assembler` | `8f4c441` | modality | S1‑T1 + S1‑T3 + S1‑T5 (full stack) |

`feat/pbpk-disposition-assembler` is the **integration branch**: it contains the
entire Stage‑1 stack merged together (all four checks green there).

```
dev
├─ S1-T1  contract ─────────────────────────────────┐
├─ S1-T2  physiology ──┬─ S1-T2b extrapolation       │
│                      ├──────────────► S1-T3 (rr-kp) │  (merges T3a+T2)
├─ S1-T3a pka ─────────┘                              │
├─ S1-T4  uncertainty ──► S1-T5 (ivive) ──────────────┤  (merges T4+T2)
└──────────────────────────────────────► S1-T6 ◄──────┘  (merges T1+T3+T5)
```

---

## 3. Per‑task detail

### S1‑T1 — `DispositionParameters` contract (kernel)
**Files:** `platform/kernel/src/hakase_kernel/pbpk/contract.py` (+ `__init__.py`),
`platform/kernel/tests/test_pbpk_contract.py`.

The plug interface between the disposition front‑end and the Stage‑2 ODE. Pure
stdlib (no numpy/RDKit).

- `Quantity` — the `{value, ci_low, ci_high, provenance, source, units}` envelope.
  CI bounds are optional (`None` until Monte‑Carlo attaches them — no fabricated
  tight intervals). `provenance` validated against `Provenance`
  = `measured | ml | reference | assumed | derived`.
- `DispositionParameters` — common core (`fu_plasma`, `fu_blood`,
  `blood_plasma_ratio`, `cl_hepatic`, `cl_renal`, `cl_total`, `kp[organ]`,
  `vdss`, `extraction_ratio`, `hepatic_first_pass`, `species_context`,
  `applicability_domain`) **+ a `modality_extension` slot** (empty for small
  molecules; mAb/NA fill it).
- `SpeciesContext`, `ApplicabilityDomain` (verdict `in`/`edge`/`out`),
  `ModalityExtension` — supporting types; `to_dict`/`from_dict` round‑trip.

**Acceptance:** instantiable; small‑molecule instance and empty modality
extension round‑trip; boundaries green. **12 tests.**

### S1‑T2 — species/strain physiology store (kernel)
**Files:** `platform/kernel/.../pbpk/physiology/{store.py, tissue_composition.py,
__init__.py}`, `platform/kernel/tests/test_pbpk_physiology.py`.

The modality‑agnostic physiology the PBPK layer reads.

- **7 calibrated rows** — human (constants **mirrored from `pk_ivive.py`**:
  Q_h 20.7, HPGL 99e6/g, liver 25.7 g/kg, BW 70), rat SD/Wistar, mouse
  CD‑1/C57BL/6, dog beagle, cynomolgus. Every constant cited (Brown 1997,
  Davies & Morris 1993, Barter 2007).
- **Rodgers & Rowland tissue‑composition tables** for 12 organs (water / neutral‑
  lipid / neutral‑phospholipid fractions, acidic phospholipid, intracellular pH,
  albumin/lipoprotein ratios) + plasma reference constants.
- **Typed modifiers**: `Sex`/`AgeClass` (multiplicative, identity by default),
  body weight → **allometric scaling** (flows ∝ BW^0.75, volumes ∝ BW).
- `get_physiology(species, strain, sex, age, body_weight_kg)`.

**Design note:** tissue composition is treated as **conserved across mammals**
(standard R&R practice — species‑specific tables don't exist for mouse/dog/
monkey); only volumes/flows are per‑species. **16 tests.**

### S1‑T2b — resolve *any* species by allometric extrapolation (kernel)
**Files:** adds `physiology/{loader.py, reliability.py, data/species_physiology.json}`,
extends `store.py`/`__init__.py`; `test_pbpk_species_extrapolation.py`.

- Unknown species (+ a body weight) → built from a **`GENERIC_MAMMAL`** anchor
  (1‑kg mammalian consensus derived from the calibrated set), flagged
  `allometric_extrapolation=True` with an **inflated uncertainty budget**;
  **metabolic clearance marked least‑reliable** (`VERY_LOW`). Conserved mammalian
  tissue composition reused.
- **Data‑file species**: drop a JSON entry into `data/species_physiology.json`
  (or load a file) to add a *calibrated* species **with no code change**; a
  data‑file entry may not override a calibrated row.
- `reliability.py`: per‑parameter‑group `ParameterUncertainty` budgets
  (baseline vs inflated), used later by the disposition intervals.

**Acceptance:** rabbit (bw only) → extrapolated + flagged + widened; rat_sd
byte‑for‑byte unchanged; fixture species loads with no code change. **12 tests.**

### S1‑T3a — pKa predictor wrapper (modality)
**Files:** `modalities/small-molecule/.../pk_ivive/pka.py`,
`.../tests/test_pka.py`.

One interface over three backends: **QupKake** (GNN + GFN2‑xTB) primary,
**pkasolver** fallback, **RDKit SMARTS heuristic** last resort. Returns per‑site
**micro‑pKa**, ionisation class (acid/base/neutral/zwitterion/ampholyte), and
fraction ionised at any pH (Henderson–Hasselbalch).

- **Measured‑pKa override** bypasses prediction (provenance `measured`).
- Results **cached per canonical SMILES** (+ backend).
- Predicted pKa in **[6, 8]** flags low confidence.
- The heuristic is **gated behind explicit opt‑in** (`allow_heuristic` /
  `STRICT_PKA`), mirroring pk_ivive's `STRICT_ML`/no‑fallback contract — the auto
  path **refuses** rather than silently returning a coarse guess.

**Environment reality:** neither `xtb` (QupKake) nor pkasolver is installable in
this repo's venv, so both real backends are **wired but report unavailable**; the
heuristic is what runs and is benchmarked. **20 tests.**

### S1‑T3 — Rodgers & Rowland Kp per organ (modality)
**Files:** `modalities/small-molecule/.../pk_ivive/kp.py`, `.../tests/test_kp.py`.

Mechanistic tissue:plasma partition from the kernel R&R tables (S1‑T2) and the
pKa/ionisation output (S1‑T3a), replacing the old logP‑heuristic Kp. Predicts
`Kpu` (tissue:unbound‑plasma‑water) and `Kp = Kpu·fu` for the full compartment
set.

- **Base regime** (pKa_base ≥ 7): neutral‑lipid/phospholipid partition + acidic‑
  phospholipid binding, with the association constant `Ka` **back‑calculated from
  the blood:plasma ratio via the red‑blood‑cell equation**.
- **Acid/neutral regime**: albumin (acids/zwitterions) or lipoprotein
  (neutrals/weak bases) association derived from `fu`.
- Adipose uses the vegetable‑oil:water partition.

**Validation:** verapamil (base), warfarin (acid), diazepam (neutral) reproduce
the expected regimes and literature‑consistent magnitude/ordering; muscle Kpu is
pinned by an **independent longhand recomputation**. Equations/constants cross‑
checked against the Simulations‑Plus general‑approach poster and the mrgsolve
`Calc_KpRR` reference. **13 tests.**

### S1‑T4 — kernel uncertainty helpers (kernel)
**Files:** `platform/kernel/.../uncertainty/{residuals.py, ad_distance.py}`,
`platform/kernel/tests/test_uncertainty_helpers.py`. Pure numpy + stdlib.

- `residuals.py` — maps ML validation residuals to a **lognormal** error model
  (`LogNormalError`: geometric mean‑bias, geometric SD, multiplicative intervals,
  seed‑reproducible sampling). Multiplicative error is the right model for PK
  parameters.
- `ad_distance.py` — distance‑based **applicability domain** over numeric feature
  vectors → `in`/`edge`/`out` (matches the S1‑T1 contract). Metrics: `euclidean`
  (percentile‑calibrated NN distance) and `tanimoto` (fingerprints).

**Design note:** a SMILES/RDKit `applicability_domain.py` already exists in the
kernel and is served by the small‑molecule router; to keep the new code modality‑
agnostic **and** avoid touching in‑use code, the vector‑based AD lives in the new
`ad_distance.py`. **11 tests.**

### S1‑T5 — species‑aware IVIVE + renal CL + Monte‑Carlo (modality)
**Files:** extends `modalities/small-molecule/.../pk_ivive/pk_ivive.py`;
`.../tests/test_pk_ivive_species_uncertainty.py`. **The pure `compute_ivive`
core is untouched.**

1. `resolve_system_parameters(species)` — sources Q_h, HPGL, liver weight, GFR,
   BW from the kernel store keyed by species; **human reproduces the historical
   constants exactly.** HPGL not established for non‑human species → assumed
   human, flagged.
2. `compute_renal_clearance(gfr, fu)` = `fu·GFR` (glomerular filtration only) and
   total CL = hepatic + renal, added **in the wrapper**.
3. `montecarlo_ivive()` — samples each ML input from its S1‑T4 lognormal residual
   model, **calls `compute_ivive` per draw** (never modifies it), reports median +
   90% intervals. **Provenance drives width** (measured → zero); seed‑reproducible;
   **off by default**.
4. Provenance tags and the no‑fallback **`insufficient-input`** envelope preserved
   exactly; deterministic path unchanged.

**14 tests** (pure core pinned, per‑species run, renal/total, MC, envelope).

### S1‑T6 — assemble `DispositionParameters` + Vss cross‑check (modality)
**Files:** `modalities/small-molecule/.../pk_ivive/disposition.py`,
`.../tests/test_disposition.py`.

- `assemble_disposition(ivive_result, kp_result, applicability_domain)` — builds
  the full S1‑T1 contract from the S1‑T5 IVIVE readout + S1‑T3 Kp, mapping every
  quantity to a `Quantity` with provenance/units and attaching S1‑T5 MC intervals
  as `ci_low`/`ci_high` when present.
- `vss_crosscheck` — `Vss = Vplasma + Σ Vtissue·Kp` (reference‑human tissue
  volumes, Brown 1997; plasma volume from the kernel store) vs ML `VDss_Lombardo`,
  flagging divergence beyond ~2–3×; recorded in the modality‑extension metadata.
- `domain_from_verdict` adapts an S1‑T4 `ad_distance` verdict to the contract AD.

**Acceptance:** emits a valid, round‑trippable `DispositionParameters`; Vss cross‑
check flags divergence in both directions. **10 tests.**

---

## 4. Cross‑cutting properties

- **No‑fallback / provenance discipline** upheld throughout: the pKa heuristic and
  IVIVE both **refuse** rather than silently guess; every number carries a
  provenance tag; assumed values are flagged, never disguised as measured.
- **`compute_ivive` (the pure core) was never modified** — species params, renal
  CL, and Monte‑Carlo are all wrapper‑level additions.
- **Boundary rule** (`platform/` never imports `modalities/`) holds — the kernel
  pieces (contract, physiology, uncertainty) are modality‑agnostic; RDKit/SMILES
  live only in the modality (`pka.py`, `kp.py`, `disposition.py`, and the extended
  `pk_ivive.py`). `check_boundaries.py` is green on every branch.
- **Commits** authored as `bh-yeshwanth`, **no Claude trailers.**

## 5. Verification

On the integration branch (`feat/pbpk-disposition-assembler`, full stack): the
four CI checks all pass — `ruff check .`, `black --check`,
`python scripts/check_boundaries.py`, and `pytest` (**164 passed, 2 skipped**;
`dev` baseline was 68 passed, 2 skipped). Per‑task new‑test counts:
T1 = 12, T2 = 16, T2b = 12, T3a = 20, T3 = 13, T4 = 11, T5 = 14, T6 = 10.

## 6. Known limitations / caveats carried forward

1. **pKa predictor is a heuristic here.** QupKake needs the `xtb` QM binary
   (conda‑forge) and pkasolver isn't on PyPI, so neither runs in this venv. The
   reported benchmark RMSE (~0.79 on an easy monoprotic set) is the *heuristic's*,
   **not** QupKake‑on‑SAMPL. Kp accuracy inherits this until the QM/ML stack is
   installed (or a measured pKa is supplied). The heuristic is opt‑in only.
2. **Kp numeric validation is directional, not tight.** The R&R equations and
   constants are cross‑validated against three independent sources and pinned by
   longhand recomputation, but the exact per‑tissue published Kpu tables are
   paywalled — so the drug tests assert equation‑correctness + literature‑
   consistent regime/range/ordering, not tight agreement to a specific table.
3. **Assumed uncertainty budgets.** The Monte‑Carlo default residual σ's (S1‑T5)
   and the physiology reliability CVs (S1‑T2b) are **assumed order‑of‑magnitude
   budgets**, not fitted from ADMET validation residuals (spec open decision #2).
   They are named constants, overridable, and clearly labelled.
4. **Non‑human HPGL assumed.** Hepatocellularity is only established for human;
   other species assume the human value, flagged (metabolic CL is the least
   reliable cross‑species term).
5. **`ad_distance.py` naming.** The task named `applicability_domain.py`, but that
   file already exists as an in‑use SMILES/RDKit scorer; the modality‑agnostic AD
   was added as `ad_distance.py`. Consolidation (make the existing one lazy / move
   it to the modality) is a possible follow‑up.
6. **Vss cross‑check tissue volumes are local.** Defined in `disposition.py`
   (Brown 1997 reference‑human) because the kernel store only carries
   liver/kidney/heart volumes — adequate for a 2–3× sanity gate.
7. **A few pre‑existing repo issues untouched** (out of scope): the ADMET‑AI model
   file fails to load in this venv (the no‑fallback path handles it), and a
   `modalities/peptide/validation/build_golden.py` black‑format nit predates this
   work.

## 7. Merge & next steps

- **Merge order to `dev`** (respecting dependencies): T1, T2, T2b, T3a, T4 (any
  order — all from `dev`), then T3 (after T3a, T2), T5 (after T4, T2), T6 (after
  T1, T3, T5). Each was reviewed and committed independently; the integration
  branch demonstrates they compose cleanly.
- **Stage‑1 exit is met**: the disposition producer emits a multi‑species,
  uncertainty‑tagged, cross‑checked `DispositionParameters`. **No ODE yet.**
- **Stage 2** (separate work) builds the kernel tissue‑PBPK ODE that *consumes*
  this contract (`docs/pbpk-layer.md` Part 6, S2‑T1…). Before Stage 2 leans on
  pKa/Kp quantitatively, install the QM/ML pKa stack and wire real per‑endpoint
  residuals so the intervals and Kp are validated rather than provisional.
```
