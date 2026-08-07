# Phase 0 Spec — Small-Molecule PBPK Exposure Engine (Virtual Animal MVP)

**Status:** Planning only. No implementation. Clean rebuild — supersedes and retires the current `animal_sim.py` and the frontend TS reimplementation.
**Companion:** `virtual-animal-architecture.md` (the scientific evaluation this spec implements).
**Phase 0 thesis:** Ship the single most defensible slice — a *properly built, uncertainty-aware, small-molecule whole-body PBPK exposure engine* + AOP-anchored calibrated hazard flags — and nothing it cannot validate. This alone replaces the current primitive layer.

---

## 1. Objective & success criteria

**Objective:** Given a small-molecule therapeutic + a specified animal + a study design, predict systemic and tissue **exposure** (the `.odt` §8 Toxicokinetics block) quantitatively, with **calibrated uncertainty**, plus **§12/§13 hazard/risk** as calibrated probabilities. Everything else in the `.odt` returns an explicit `not_predicted` with a reason.

**Phase 0 is "done" when:**
1. Predicts plasma Cmax / Tmax / AUC₀–₂₄ / CL / Vd / T½ + full concentration–time profile for rat, mouse, dog, monkey given SMILES + dose + route.
2. Every numeric output carries a **predictive interval** whose **coverage is validated** (90% interval contains truth ≈90% of the time on held-out compounds).
3. **Applicability-domain gating** returns a hard "out-of-domain" refusal for compounds unlike the calibration set, instead of a confident wrong number.
4. Passes a scaffold-split validation harness (§12) with reported fold-error distribution.
5. Old engine + orphaned TS path removed; single new endpoint live; `check_boundaries.py` green.

**Explicit non-goals for Phase 0:** organ-specific toxicity magnitude, histopathology, clinical-pathology panels, efficacy/PD, biologics/peptides/nucleic acids, cross-organ biological coupling. These are Phase 1+.

---

## 2. Scope mapped to the `.odt` endpoint list

| `.odt` section | Phase 0 treatment |
|---|---|
| §2 Test Article | Input (SMILES, MW, formulation) |
| §3 Animal Info | Input (species, strain, sex, age, BW) |
| §4 Study Design | Input (study type, dose levels, route, frequency, duration) |
| §5 Environment/Housing | Ignored (out of PK scope; accepted, unused) |
| §6 In-life endpoints | `not_predicted` |
| §7 Clinical pathology | `not_predicted` (Phase 1: liver clin-chem) |
| **§8 Toxicokinetics** | **Predicted quantitatively + intervals** ← core deliverable |
| §9 Organ weights | `not_predicted` |
| §10 Gross pathology | `not_predicted` |
| §11 Histopathology | `not_predicted` |
| §12 Acute toxicity (LD50/MTD, target organ) | **Calibrated hazard probabilities + allometric MTD estimate w/ interval**; qualitative target-organ flags |
| §13 Study outcomes | Auto-generated **summary of what was predicted**, safety-margin arithmetic, and a machine-readable list of what was *not* predicted and why |

The output contract makes "not predicted" a **first-class typed value**, never a silent omission or a fabricated number.

---

## 3. Module placement & boundaries (clean rebuild)

Respecting the two-tier rule (`platform/` never imports `modalities/`; modality→platform is allowed; service is the composition root):

```
platform/kernel/src/hakase_kernel/
  pbpk/                         # NEW — modality-agnostic PBPK backbone
    physiology/                #   species/strain/sex/age parameter store
    model.py                   #   whole-body ODE system (compartments, solver)
    absorption.py              #   route models (IV, oral+BCS, SC)
    cohort.py                  #   virtual-population sampling
    contract.py                #   DispositionParameters dataclass (the plug interface)
    registry.py                #   modality front-ends register here (existing pattern)
  uncertainty/                 # EXISTS — reuse: interval propagation, calibration
    applicability_domain.py    #   NEW — OOD gating

modalities/small-molecule/engine/src/hakase_smallmol/
  disposition/                 # NEW — SMILES -> DispositionParameters
    ivive.py                   #   fu, CLint, blood:plasma, Kp predictors
    register.py                #   registers small-mol front-end into kernel.pbpk.registry
  hazard/                      # NEW — AOP-anchored calibrated hazard flags
    (reuses existing dili/, cardiotox/, safety/ai models as inputs)

service/src/hakase_service/
  main.py                      # composition root: import register.py, expose endpoint
```

**Why this split:** the PBPK ODE, physiology store, cohort sampling, and uncertainty are identical across modalities — they belong in the kernel. Only the *disposition parameterisation* (how a molecule becomes `fu`/`CLint`/`Kp`) is modality-specific. When peptides/mAbs arrive, they add their own `disposition/` front-end and register it; the kernel is untouched. This is the whole reason the architecture is modality-extensible without rewrites.

**Boundary compliance:** kernel exposes an abstract front-end interface + registry; the small-molecule package `import`s the kernel and registers into it; `service` imports both to wire them. No platform→modality import. `check_boundaries.py` stays green.

---

## 4. The disposition-parameter contract (the modality plug)

The single interface every modality front-end must satisfy. Kernel defines it; kernel PBPK consumes it; front-ends produce it. Described here as a schema (not code):

`DispositionParameters` (per compound, per species):
- `fu_plasma` — fraction unbound in plasma
- `blood_plasma_ratio`
- `kp[organ]` — tissue:plasma partition coefficients for each PBPK compartment (or the physchem inputs to compute them in-kernel)
- `cl_int_hepatic` — intrinsic hepatic clearance (scaled from in-vitro/IVIVE)
- `cl_renal_mechanism` — {GFR-filtration, +secretion, +reabsorption} with parameters
- `permeability` — effective permeability (drives permeability-limited organs, absorption)
- `fraction_metabolized` — vs excreted unchanged
- optional `target` — {uniprot, affinity, tissue} for later PD phases (unused in Phase 0)
- **each field carries a value + uncertainty (distribution or interval) + a `source` tag** (measured / IVIVE-predicted / QSAR / default)

The front-end also declares its **applicability domain descriptor** (what chemical space it was calibrated on) so the kernel can gate OOD compounds.

**Design rule:** the PBPK kernel never sees a SMILES. It sees only `DispositionParameters`. That decoupling is the contract that makes the whole thing modality-agnostic.

---

## 5. Physiological parameter store (`kernel/pbpk/physiology/`)

Replaces the 6 hard-coded species dicts in the current `animal_sim.py` with a queryable, parameterised store.

**Schema:** `Physiology(species, strain, sex, age, body_weight) → parameters`:
- Organ **volumes** and **blood flows** (liver, kidney, heart, lung, gut, spleen, brain, muscle, adipose, skin, bone, rest) — per unit body weight, scaled by BW.
- **Cardiac output**, **GFR**, **hepatic blood flow**.
- **Plasma protein** concentrations (albumin, AGP) — for `fu` scaling.
- **Enzyme/transporter abundances** per organ (CYP isoforms, UGT, key transporters) — species-specific, drives metabolic clearance scaling.
- Reference values from published physiology (Brown et al. 1997; Davies & Morris 1993 for the base set; ICRP/literature for enzyme abundances).

**Variable handling (per architecture doc §7):** species/strain selects a base parameter set; sex/age/BW/disease apply as **typed modifiers on parameters** (e.g., sex → enzyme-abundance multipliers; age → maturation curves; disease → hepatic-impairment factor), *not* as opaque model inputs. Missing strain data falls back to species defaults with an inflated uncertainty flag.

**Coverage for Phase 0:** mouse (CD-1, C57BL/6), rat (SD, Wistar), dog (beagle), cynomolgus monkey. Human included as the FIH-translation target only.

---

## 6. PBPK model (`kernel/pbpk/model.py`)

**Structure:** whole-body perfusion-limited compartment model (permeability-limited option for select organs), solved with `scipy.integrate.solve_ivp` (stiff solver, e.g. `LSODA`/`BDF`). Compartments: arterial + venous blood, lung, liver (+ gut input for oral first-pass), kidney, heart, brain, muscle, adipose, skin, spleen, rest-of-body.

**Governing equations:** standard mass-balance per compartment
`V_organ · dC/dt = Q_organ · (C_art − C_organ/Kp_organ) [± clearance/input terms]`
with:
- **Hepatic clearance** via the **well-stirred liver model** from `cl_int_hepatic` and hepatic blood flow (extend to parallel-tube as an option later).
- **Renal clearance** = GFR·fu (+ secretion/reabsorption if the contract supplies it) — *and the model states this assumption in `model_warnings`*.
- Blood coupling through the venous/arterial compartments (the cross-organ exposure link).

**Key improvement over current engine:** proper venous/arterial mixing, lung compartment, physiologically-grounded `Kp` (Rodgers & Rowland / Poulin & Theil mechanistic tissue-composition equations, not the current `0.70 + 0.05·10^logP` heuristic), and mechanistic hepatic clearance rather than ad-hoc scaling.

**Outputs per solve:** concentration–time in every compartment → derive Cmax, Tmax, AUC (trapezoidal), CL, Vss (mechanistic, from steady-state tissue amounts), terminal T½ (from log-linear tail regression, not the current shortcut).

## 6a. Absorption models (`kernel/pbpk/absorption.py`)
Route-specific input functions:
- **IV** — bolus/infusion directly to venous.
- **Oral** — dissolution → gut → portal → liver first-pass. Formulation enters here: BCS classification (reuse the existing formulation/BCS logic, cleaned up) modulates dissolution rate and `fa`. This is where §2 formulation and §5 fasting/diet would attach.
- **SC** — depot with first-order absorption.
Repeat-dose (§4 frequency/duration) = periodic dosing forcing term → accumulation and steady-state.

---

## 7. IVIVE parameterisation (`modalities/small-molecule/disposition/ivive.py`)

Turns a SMILES into the `DispositionParameters` contract:
- RDKit descriptors (MW, logP, TPSA, pKa, HBD/HBA, fraction ionised at pH 7.4).
- `fu`, blood:plasma from QSAR/plasma-protein-binding models (reuse existing ADMET GNN `PPBR_AZ` where available; flag source).
- `Kp` via **Rodgers & Rowland** (mechanistic, uses logP, pKa, tissue composition) — the accepted method; falls back to Poulin-Theil.
- `cl_int_hepatic` from predicted hepatocyte/microsomal intrinsic clearance (reuse `Clearance_Hepatocyte_AZ`), scaled to whole-liver via abundance from the physiology store.
- **Applicability-domain descriptor:** the chemical-space fingerprint region the underlying ADMET models were trained on.

**Reuse, don't rebuild:** the existing `admet/`, `dili/`, `cardiotox/`, `safety/` model assets stay; this layer *orchestrates* them into the contract and attaches provenance + uncertainty to each value. Where the source is a point-estimate ML model, wrap it with an empirical error distribution derived from that model's own validation residuals.

---

## 8. Virtual cohort, uncertainty & applicability domain

**Cohort (`kernel/pbpk/cohort.py`):** sample `N` virtual animals from body-weight and physiological-parameter distributions (log-normal BW; correlated organ scaling). Deterministic seeding for reproducibility. This is the *aleatoric* (biological variability) source.

**Uncertainty (`kernel/uncertainty/`, reuse existing):**
- *Epistemic* (parameter/model ignorance): propagate the `DispositionParameters` uncertainty distributions through the ODE via Monte-Carlo sampling.
- Combine aleatoric + epistemic → predictive interval per endpoint.
- Report intervals, not just means.

**Applicability domain (`kernel/uncertainty/applicability_domain.py`, NEW):** compare the query compound's descriptor/fingerprint against the front-end's declared domain. Three states: `in-domain` (full confidence), `edge` (widened intervals + warning), `out-of-domain` (**refuse**: return a structured "out of applicability domain" result, not a number). This is the single most important safety feature for a tool that influences animal use.

---

## 9. Hazard layer (`modalities/small-molecule/hazard/`)

AOP-anchored, **calibrated probabilities** feeding `.odt` §12/§13:
- Reuse existing DILI, hERG/cardiotox, Ames/safety models as **molecular-initiating-event / key-event** evidence.
- Output per hazard: calibrated probability + confidence + the ICH guideline it maps to + a plain-language target-organ flag (qualitative).
- **Calibration required:** raw classifier scores are recalibrated (Platt/isotonic) against held-out data so a "0.7" means 70% observed positive rate. Report a reliability check.
- MTD/LD50: allometric estimate with an interval, clearly labelled as coarse; *not* presented with false precision.

No histopathology or quantitative organ-tox magnitude in Phase 0 — that is explicitly Phase 1 (liver QSP) territory.

---

## 10. Output schema

Single structured response object:
```
{
  meta: { engine_version, species, study_design, compound_id, applicability_domain_state },
  toxicokinetics: {           # §8 — quantitative, each with interval
     cmax:{value, ci_low, ci_high, unit, source},
     tmax, auc_0_24, clearance, vd_ss, half_life,
     plasma_curve:[{t, conc_mean, conc_ci_low, conc_ci_high}],
     tissue_curves:{ organ -> [...] }
  },
  human_translation: { hed, fih_dose, safety_margin, ... , with intervals },
  hazard: [ {organ, probability, ci, ich_guideline, basis, calibrated:true} ],   # §12
  acute_estimates: { mtd:{value, ci}, ld50:{value, ci, coarse:true} },
  outcomes_summary: { ... },   # §13 auto-generated
  not_predicted: [ {section:"§7 clinical_pathology", reason:"no validated model in Phase 0"} , ... ],
  model_warnings: [ "renal CL = GFR·fu; secretion/reabsorption not modelled", ... ],
  provenance: { per-parameter source + database query outcomes }
}
```
Frontend consumes this directly (replacing both the orphaned `predictAnimalCohort` call *and* the client-side `animalSim.ts`).

---

## 11. API surface

Single endpoint at the service composition root, replacing `/predict/animal-cohort`:

`POST /predict/virtual-animal/exposure`
Request: `{ smiles, compound_meta, animal:{species,strain,sex,age,body_weight}, study:{type,dose_levels,route,frequency,duration}, formulation, cohort_size, overrides? }`
Response: the §10 schema. `422` for out-of-applicability-domain (structured payload, mirroring the existing IVIVE 422 pattern the frontend already unwraps).

---

## 12. Validation harness (Phase 0 acceptance gate)

Built as a first-class deliverable, not an afterthought (`modalities/small-molecule/validation/`):
- **Data:** public animal PK (ChEMBL animal assays, PK-DB, literature PBPK datasets) for rat/mouse/dog/monkey plasma PK.
- **Split:** scaffold/cluster split (not random); additionally a temporal holdout. Dedup salts/analogues to prevent leakage.
- **Metrics:** fold-error distribution for Cmax/AUC/CL (% within 2×, 3×); interval **coverage** (target ≈ nominal); reliability diagram for hazard probabilities.
- **Controls:** permutation test (shuffle → performance collapses); known-compound positive/negative controls; cross-species transfer test (fit rat, predict dog).
- **Gate:** engine ships only when coverage is calibrated and fold-errors are within the field-standard 2–3× band on held-out compounds.

---

## 13. Retirement / migration of current code

- **Remove** `modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/animal_sim.py` (superseded).
- **Remove** the orphaned frontend TS reimplementation `animalSim.ts` `runAnimalCohortSimulation` and repoint `HakaseAI.tsx` to the new endpoint via `aiService.ts` (rewrite `predictAnimalCohort`).
- **Delete** the three stale duplicate `AnimalCohortRequest` class defs (small-molecule/antibody/structure routers) — dead since the restructure.
- **Preserve & relocate** the genuinely useful pieces: live-DB query functions (CCTE/PubChem/ChEMBL/PK-DB) → move to `platform/datasources` or a kernel data layer (they're modality-agnostic); the BCS/formulation logic → `kernel/pbpk/absorption.py`.
- Keep `pk_ivive.py` (the L2 IVIVE piece) — it *feeds* this engine.

## 14. Dependencies
No new heavy deps expected: `scipy` (solver), `numpy`, `rdkit` — all already present. Optional later: an ODE-sensitivity/parameter-estimation lib for calibration. Uncertainty layer reuses `hakase_kernel/uncertainty`.

## 15. Open decisions (to resolve before build)
1. **Kp method default:** Rodgers & Rowland vs Poulin & Theil as primary (recommend R&R; needs pKa prediction quality check).
2. **Calibration data access:** is public animal-PK volume (ChEMBL/PK-DB) enough for coverage-calibrated validation, or do we need to license/curate a set? (Ties to the data-acquisition plan.)
3. **Renal model depth:** filtration-only (fast) vs +secretion for known transporter substrates (accuracy).
4. **How much of the existing ADMET GNN stack to trust as IVIVE inputs** vs replacing with mechanistic/measured — needs a per-endpoint reliability audit.
5. **Frontend cutover:** hard switch vs feature-flag the new engine alongside the old TS path during validation.
```
