# The PBPK / Exposure Layer — Current State, Downsides, and Rebuild Plan

**Scope:** This document covers the **PBPK / exposure layer only** — the machinery that turns *molecule + dose + animal* into *drug concentrations over time* (systemic and per-organ). Everything downstream of exposure (organ response, toxicity, NOAEL/MTD, study design, histopathology, the rest of `Variables_AnimalLayer.odt` beyond §8 TK) belongs to the **separate animal-testing-layer document** and is deliberately excluded here.

**The clean interface:** the PBPK layer's job ends at *"here is the concentration–time profile in each compartment, plus CL, Vd, Cmax, Tmax, AUC, t½ — with uncertainty."* The animal layer consumes that and nothing more.

**Status:** FINAL — build-ready spec. No code has been changed yet. Decisions locked: build in-repo (no external engine), parent drug only in v1 (metabolites → v2). The build task breakdown is Part 6; the execution guardrails are Part 7.

**Related docs:** `virtual-animal-architecture.md` (the scientific feasibility evaluation — the "why"). This document is the "what and how" for the exposure engine, and consolidates the earlier Stage-1 IVIVE spec.

---

## Part 1 — What the PBPK layer is today, and how it works

### 1.1 It lives in three places, and they disagree

| # | Location | Role | Size | Species |
|---|---|---|---|---|
| 1 | [`pk_ivive.py`](../modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/pk_ivive.py) | **IVIVE** → systemic PK (CL, t½, AUC, IV curve) | 417 lines | human only |
| 2 | [`animal_sim.py`](../modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/animal_sim.py) | **Tissue PBPK** ODE (per-organ curves) — entangled with animal-layer code | 1291 lines | 6 hard-coded |
| 3 | `hakase-bio-frontend/.../lib/animalSim.ts` | **Second PBPK**, simpler, in TypeScript | ~612 lines | 6 hard-coded |

**Wiring reality:**
- IVIVE (#1) is exposed and used.
- The Python tissue PBPK (#2) is exposed at `POST /predict/animal-cohort` but is **orphaned** — the frontend never calls it (`predictAnimalCohort` in `aiService.ts` is defined but unused).
- The UI actually runs the **TypeScript** reimplementation (#3), `runAnimalCohortSimulation`, client-side.

So there are **two divergent PBPK implementations**, the more capable one (Python) is dead code from the UI's perspective, and there is no test forcing them to agree.

### 1.2 How the IVIVE works (`pk_ivive.py`)

Turns ADMET-ML predictions into systemic human PK via the **well-stirred liver model** (Rowland/Wilkinson; Houston scale-up). This piece is methodologically correct and well-engineered.

**Inputs** (each tagged with provenance — `measured` override > caller ML > server ML, never guessed):
- `Clearance_Hepatocyte_AZ` → CLint (µL/min/10⁶ cells)
- `PPBR_AZ` → fu (fraction unbound)
- `VDss_Lombardo` → Vdss (L/kg)
- `Half_Life_Obach` → independent t½ cross-check

**Equations:**
```
CLint,invivo = CLint,hep · HPGL · LW / 1000          (µL/min/10⁶ → mL/min/kg)
fu,blood     = fu,plasma / R_bp
CL_blood     = Q_h · fu_b · CLint / (Q_h + fu_b · CLint)   (well-stirred)
E_h          = CL_blood / Q_h ;  F_h = 1 − E_h
t½           = ln2 · Vss / CL_plasma
AUC_iv       = dose / CL_plasma  ;  one-compartment IV-bolus curve
```
**Human system constants** (cited, overridable): `Q_h = 20.7 mL/min/kg`, `HPGL = 99×10⁶ cells/g`, `liver = 25.7 g/kg`, `BW = 70 kg`, `R_bp = 1.0` (assumed).

**Design strengths worth preserving:** a pure unit-testable core (`compute_ivive`) separate from the ML-sourcing wrapper; a strict **no-fallback / provenance contract** (missing input → `insufficient-input` envelope with a `missing` list, never a computed guess); the Obach half-life cross-check (flags disagreement > 3×); and honesty about scope (renal/biliary CL disclosed-but-absent; oral curve omitted because `ka` would have to be assumed).

**What it does NOT do:** no tissue distribution (systemic only — one lumped Vd, no per-organ concentration), human only, hepatic CL only.

### 1.3 How the tissue PBPK works (`animal_sim.py`, PBPK portions only)

This is the multi-compartment engine. (The same file also contains NOAEL, toxicity flags, study design, cost, ICH checklists — **all of that is animal-layer, out of scope here**, and its entanglement in one file is itself a downside; see §2.1.)

**Species physiology — `SPECIES_LIBRARY`:** 6 hard-coded dicts (`mouse_cd1`, `mouse_c57bl6`, `rat_sd`, `rat_wistar`, `dog_beagle`, `monkey_cyno`). Each carries body weight, organ volume fractions (`V_liver/kidney/heart/blood`), blood-flow fractions (`Q_liver/kidney/heart`), cardiac output, GFR, and CYP/PPB descriptors.

**The ODE — `pbpk_odes`:** a 7-state perfusion-limited system
`y = [A_depot, C_v (venous), C_a (arterial), C_liver, C_kidney, C_heart, C_rest]`
with venous/arterial mixing, tissue efflux at `C_organ / Kp_organ`, hepatic clearance on the liver compartment, renal clearance on the kidney compartment, and a route-switched depot input (Oral → gut input to liver first-pass; SC → venous; IV → direct to venous).

**Parameterisation (the weak points):**
- **Kp (heuristic):** `K_p_liver = 0.70 + 0.05·10^logP` (kidney `0.75+0.03·…`, heart `0.80+0.02·…`), bounded `[0.1, 100]`; `K_p_rest = VDss_Lombardo` (a lumped distribution volume used as a tissue partition).
- **Hepatic CL:** `CL_hep = CLint · 99 · (V_liver·1000) · 60 / 1e6` (scaled from the ML hepatocyte CLint — recomputed here, *not* taken from the IVIVE layer).
- **Renal CL:** `GFR · BW · scale · fu` (filtration only).
- **Absorption:** single `ka = 10^(Caco2 + 5)`, bounded `[0.2, 5]`.
- **Allometry:** per-animal `BW^−0.25` scaling of flows/clearance.

**Virtual cohort:** N animals with log-normal body weight (`np.random.seed(42)`, σ=0.15); each solved over 0–24 h; aggregate mean/std curves; derive Cmax, AUC (trapezoid), t½, CL.

**Human translation:** a separate hard-coded human organ spec block solves a human curve at an FIH dose. (The FIH *dose* is NOAEL-derived → animal-layer; the human *curve* is exposure → belongs here. This split is currently entangled.)

**PK outputs (the part the animal layer should consume):** `animalCmax/Auc/HalfLife/Clearance`, `animalPkCurve`, `humanCmax/Auc/HalfLife`, `humanPkCurve`, `pkBasis`.

### 1.4 The live path (`animalSim.ts`)

A **1-compartment analytic** model (`ka/ke`), seeded from `smiles+species+studyType`, no live databases, with simpler bioavailability / Vd / clearance heuristics. It diverges from the Python engine and is what the user currently sees.

---

## Part 2 — Downsides

### 2.1 Architecture / hygiene
1. **Two divergent implementations** (Python vs TypeScript) with no parity test → silent drift; the capable one is orphaned.
2. **PBPK entangled with animal-layer code** — the ODE lives in a 1291-line file mixed with NOAEL, tox flags, study design, cost, and ICH checklists. Cannot evolve the exposure engine in isolation.
3. **No shared physiology** — IVIVE hard-codes human constants; the tissue PBPK hard-codes 6 species dicts; neither reads a common store.
4. **IVIVE ↔ PBPK disconnect** — the IVIVE computes a defensible CL via well-stirred liver, but the tissue PBPK **ignores it and recomputes clearance ad hoc**. Two sources of truth that can disagree.
5. **Stale duplicates** — dead `AnimalCohortRequest` model definitions in three routers (leftovers from the modality restructure).

### 2.2 Science / mechanism
6. **Kp is a heuristic**, not mechanistic (`0.70 + 0.05·10^logP`). Per-organ exposure is the *entire premise* of a multi-organ system, and it is fed by this guess. `K_p_rest = VDss` conflates a lumped volume with a partition coefficient.
7. **No metabolites** — parent drug only. The liver→heart metabolite story is structurally impossible today. (Deferred to v2 by decision, but the architecture must leave room.)
8. **Renal = filtration only** (`GFR·fu`); no secretion/reabsorption (disclosed, not faked).
9. **Absorption is crude** — one `ka` from Caco2, no dissolution/gut compartment in the ODE; the BCS/formulation logic that exists only adjusts static bioavailability `F`, not the input *dynamics*; food/formulation effects not in the ODE.
10. **Human-only IVIVE** means the "PK basis" reported for animals is partly human-derived.
11. **No uncertainty anywhere** — point estimates only. The fixed `seed=42` produces *reproducibility theatre*, not real biological variability, and no confidence intervals.
12. **Duplicated t½ logic** — computed two different ways in the same file (log-linear tail vs mechanistic `ln2·Vss/CL`).
13. **No applicability domain** — a confident number is returned for any SMILES, including compounds nothing like the ADMET training set.

### 2.3 Validation
14. **No validation harness at all** — no benchmark against measured PK, no fold-error, no coverage. The engine's accuracy is currently *unknown*.

---

## Part 3 — Improvement plan (each downside → its fix)

| # | Downside | Fix |
|---|---|---|
| 1 | Two implementations, drift | One Python engine; retire the TS path; frontend calls the endpoint |
| 2 | PBPK/animal entanglement | Split exposure from animal layer: PBPK backbone in `kernel`, disposition front-end in `modality`; animal-layer code migrates to its own module/doc |
| 3 | Hard-coded species/human | One species/strain **physiology store** in the kernel; IVIVE and PBPK both read it |
| 4 | IVIVE↔PBPK disconnect | IVIVE becomes the **sole producer** of a `DispositionParameters` object; the PBPK consumes it — single source of CL/fu/Kp |
| 6 | Kp heuristic | **Rodgers & Rowland** mechanistic Kp |
| 8 | Renal filtration-only | Keep filtration in v1 (flagged); add secretion for known substrates later |
| 9 | Crude absorption | Proper per-route absorption sub-models; couple BCS/dissolution into the oral *input dynamics* |
| 10 | Human-only IVIVE | Human becomes just one row of the species store; IVIVE runs per species |
| 11 | No uncertainty | Residual-derived input distributions + Monte-Carlo propagation → intervals; real cohort variability, not a fixed seed |
| 12 | Duplicated t½ | Single derivation |
| 13 | No applicability domain | AD gating — refuse out-of-domain compounds via the existing no-fallback envelope |
| 14 | No validation | Validation harness: scaffold split, fold-error, interval coverage |
| 7 | No metabolites | Architecture keeps the species list open; metabolite species added in v2 |
| 5 | Stale duplicates | Delete the dead `AnimalCohortRequest` defs |

The through-line: **collapse three implementations into one, split exposure from tox, make every parameter mechanistic-or-measured with an uncertainty, and gate on validation.**

---

## Part 4 — Implementation plan (PBPK layer only)

Two stages. Decisions locked: **build in-repo**, **parent-only v1**. Boundary-safe under `check_boundaries.py` (modality → platform allowed; platform → modality forbidden).

### 4.1 Target module layout
```
platform/kernel/src/hakase_kernel/
  pbpk/
    physiology/        # NEW — species/strain store + tissue-composition tables
    contract.py        # NEW — DispositionParameters dataclass (the plug interface)
    model.py           # NEW (Stage 2) — multi-compartment ODE
    absorption.py      # NEW (Stage 2) — IV / oral+BCS / SC input models
    cohort.py          # NEW (Stage 2) — virtual-population sampling
  uncertainty/
    residuals.py       # NEW — ML residual → distribution
    applicability_domain.py  # NEW — OOD gating

modalities/small-molecule/src/hakase_smallmol/pk_ivive/
  pk_ivive.py          # EXTEND — species-aware, renal CL, uncertainty
  kp.py                # NEW — Rodgers & Rowland Kp (imports kernel tissue tables)
  disposition.py       # NEW — assembles DispositionParameters

service/src/hakase_service/
  main.py              # one endpoint: POST /predict/pbpk/exposure
```

### 4.2 Stage 1 — Disposition parameters (extend IVIVE)
Extend, do not rebuild, `pk_ivive.py` so its output is the complete `DispositionParameters` contract:
- **Species/strain physiology store** (kernel) — the human constants become the `human` row; add rat/mouse/dog/monkey; sex/age/BW as typed modifiers.
- **Mechanistic Kp** (Rodgers & Rowland, modality `kp.py`) — from logP + pKa + fraction-ionised + tissue composition, per organ.
- **Renal CL** (`GFR·fu`, flagged) → total CL.
- **Uncertainty** — wrap each ML input in a residual-derived distribution; Monte-Carlo through the unchanged pure core → intervals; provenance drives interval width; keep the deterministic point estimate.
- **Applicability domain** — in/edge/out-of-domain; refuse OOD.
- **Emit `DispositionParameters`** — `{fu, blood_plasma_ratio, cl_hepatic, cl_renal, cl_total, kp[organ], vdss, extraction_ratio, species_context, applicability_domain}`, each field `{value, ci_low, ci_high, provenance, source, units}`.

**Free cross-check:** Kp + organ volumes imply `Vss = Vplasma + Σ Vtissue·Kp`; compare against ML `VDss_Lombardo` (mirrors the existing Obach t½ cross-check).

**Stage-1 acceptance:** Kp unit tests vs published reference drugs; species-store constants match literature; Vss cross-check passes/flags correctly; uncertainty widths track provenance and are seed-reproducible; existing no-fallback tests still pass.

### 4.3 Stage 2 — Tissue PBPK ODE (rebuild, cleanly, in the kernel)
A proper multi-compartment engine that **consumes `DispositionParameters`** and produces exposure:
- **Perfusion-limited compartments** (permeability-limited option), multi-species from the store; venous/arterial mixing; hepatic CL taken from the disposition object (not recomputed); renal CL from the store.
- **Absorption sub-models** — IV, oral (dissolution/BCS → gut → portal → first-pass), SC; repeat-dose forcing for accumulation.
- **Virtual cohort** — sample from real parameter distributions (retire the fixed seed as the *only* variability); Monte-Carlo over disposition uncertainty.
- **Outputs** — plasma + per-organ concentration curves, Cmax, Tmax, AUC, CL, Vss, t½ — **every value with a confidence interval.** This is exactly the `.odt` §8 Toxicokinetics block, and it is the entire feed to the animal layer.

**Validation gate (HARD — the whole point):** predicted vs measured plasma PK on a scaffold-split set (ChEMBL animal PK assays / PK-DB) for rat/mouse/dog/monkey; fold-error within the field-standard 2–3× band; interval coverage calibrated (90% interval contains truth ≈90% of the time); permutation and cross-species-transfer controls. **Freeze the engine here** — the animal layer may only be built on a validated, frozen exposure model, because organ error = exposure error × organ-model error.

### 4.4 Retirement / migration
Sequenced so nothing is deleted before its replacement is validated:
- **Do NOT delete `animal_sim.py` during the PBPK phase.** Its PBPK ODE is *superseded* by Stage 2, but the file also holds the only animal-layer code (NOAEL, tox, study design) — that stays live until the animal-testing-layer rebuild consumes the new exposure engine. Mark the PBPK portions deprecated; physical deletion happens in the animal-layer work, not here.
- **Delete** `animalSim.ts` `runAnimalCohortSimulation` and repoint the frontend to `POST /predict/pbpk/exposure` — only after the Stage-2 validation gate passes.
- **Delete** the stale `AnimalCohortRequest` duplicates (dead already — safe anytime).
- **Keep + extend** `pk_ivive.py` (becomes the disposition producer).
- **Relocate** the live-DB query functions (CCTE/PubChem/ChEMBL/PK-DB) to `platform/datasources` (modality-agnostic); move the BCS/formulation logic into `kernel/pbpk/absorption.py`.

### 4.5 Open decisions (PBPK-scoped)
1. **pKa source — RESOLVED: add a dedicated pKa predictor.**
   - **Primary: QupKake** — SOTA open-source micro-pKa (GNN + GFN2-xTB semiempirical QM features), RMSE ≈ 0.5–0.8 pKa units, outperforms other open models by 0.25–0.34 on independent test sets. Predicts per-site micro-pKa, which is what Rodgers & Rowland ionisation classification needs. Dependency cost: requires the `xtb` QM binary (conda-forge) + PyTorch Geometric, and ~1–5 s/molecule for the QM step — so **cache pKa per canonical SMILES**.
   - **Fallback / high-throughput mode: pkasolver** — pure GNN, fast, fine-tuned on experimental pKa; use when the xtb dependency or per-molecule latency is a problem.
   - **Measured override always wins** — a user/measured pKa is provenance `measured` and bypasses prediction (consistent with the existing no-fallback/provenance contract).
   - **Sensitivity flag** — when a predicted pKa falls in ~[6, 8], fraction-ionised at plasma pH 7.4 is highly sensitive to pKa error; widen the Kp uncertainty and flag it rather than reporting a falsely tight interval.
   - **Validate before trusting in Kp** — benchmark the chosen predictor on a public set (SAMPL6/7 pKa, or the JCIM public benchmark) as part of S1-T3a acceptance.
2. **ADMET residuals** — do per-endpoint validation residuals exist to parameterise the input error distributions, or must they be derived first?
3. **Renal secretion in v1** — filtration-only, or attempt secretion for known transporter substrates?
4. **Compartment count in v1** — full ~12-organ set vs a core subset (liver/kidney/heart/brain/rest).
5. **Human FIH translation ownership** — the HED/FIH *dose* is animal-layer/translational; the human *exposure curve* is PBPK. Recommend: keep human as just another species in the store (exposure), and move HED/FIH dose selection to the animal-layer document.

### 4.6 Boundary with the animal-testing-layer document
The PBPK layer hands off exactly at **`DispositionParameters` + per-organ exposure curves (with intervals)**. Everything past that line — organ response, metabolic maps, toxicity, NOAEL/MTD, study design, and the `.odt` endpoints beyond §8 — is documented and built separately.

---

## Part 5 — Integration & modality scope

### 5.1 Is the engine universal across modalities?
No — it is **modality-extensible**, not universal. What is shared vs. rebuilt:

- **Reusable (kernel platform):** the species/strain physiology store, the `DispositionParameters` contract, the ODE solver + virtual-cohort + uncertainty machinery, the validation-harness pattern.
- **Rebuilt per modality:** the **disposition front-end** (small molecules use IVIVE + Rodgers & Rowland Kp — intrinsically small-molecule physics) *and* the **transport physics** (perfusion-limited for small molecules; two-pore + FcRn + TMDD for mAbs; delivery-vehicle-dominated for nucleic acids — different ODE structure, not just a different input encoder).

What we build here is the **small-molecule instance**. Each future modality gets a sibling PBPK-layer document + its own front-end and transport law, sharing the kernel.

**Design requirements this imposes:**
1. `DispositionParameters` must be **common-core + modality extension** (small molecule fills a subset; mAbs add FcRn/TMDD; NA add delivery-vehicle params) — never a small-molecule-shaped struct.
2. The Stage-2 kernel ODE must take the per-organ **transport law and clearance/binding terms as injected components**, so a new modality supplies its own law without forking the backbone.

### 5.2 Mapping onto the 4-layer pre-clinical architecture
Frontend taxonomy: **L1 In Vitro → L2 Confirmation → L3 Animal Cohort → L4 First In Human.**

- **L2 Confirmation** currently emits `L2DoseProjection` (`lib/l2DoseProjection.ts`) — a client-side, heuristic, `confidence: "low"` first-pass carrying `F_oral`, `Vd_L_per_kg`, `hepaticCL_mL_min_kg`, `fu_fraction`, `targetCmaxUnbound_nM`. **`DispositionParameters` is the mechanistic, multi-species, uncertainty-bearing backend replacement for it.** Stage 1 upgrades L2 from a low-confidence heuristic to a validated projection.
- **The PBPK layer spans the L2/L3 boundary:** the disposition half (IVIVE → `DispositionParameters`) is **L2's engine**; the tissue-distribution half (Stage-2 ODE → per-organ curves) is the **exposure engine that feeds L3**.
- **This document = L2 engine + L3 exposure. The animal-testing-layer document = L3 response (organ/tox/NOAEL) + L4.** The hand-off line is the same L2→L3 seam that already exists in the code (`animalSim.ts` reads `l2Projection`).

### 5.3 Other modalities
L2 Confirmation is a per-modality layer concept. Each modality's L2 runs its own disposition front-end and emits the same `DispositionParameters` contract; the same L3 PBPK consumes it **provided the kernel ODE accepts that modality's transport law** (§5.1 requirement 2). Adding a modality is then "new front-end + new transport law," never "rewrite the backbone."

---

## Part 6 — Build task breakdown

Each task is atomic, ordered, and independently verifiable — one task = one branch = one commit = one Claude Code prompt. "Acceptance" is the definition of done; every task must also pass the Part 7 checks. Do not start a task before its predecessors are merged.

**Species rollout — rat-first, modular.** Rat (Sprague Dawley) is the reference species: the full vertical (physiology → Kp → IVIVE → PBPK → the S2-T5 validation gate) is calibrated and validated on **rat only** first. Species are defined as **data** (a config file), so adding mouse/dog/monkey later is "drop in a data row + validate it," never a code change — that is the modularity. Two caveats: (1) the R&R tissue composition is **species-specific** (the current values are Rodgers–Leahy–Rowland *rat* values), so each future species needs its own composition or the flagged conserved-mammalian default — never a silent copy of rat's; (2) any species other than rat is `provisional/unvalidated` until it passes its own validation. Keep already-added non-rat rows behind that flag rather than trusting them.

### Stage 1 — Disposition parameters (extend IVIVE)
| ID | Task | Files | Acceptance |
|----|------|-------|-----------|
| **S1-T1** | Define the `DispositionParameters` contract (common core + modality-extension slots; every field `{value, ci_low, ci_high, provenance, source, units}`) | `platform/kernel/.../pbpk/contract.py` (NEW) | dataclass instantiable; unit test round-trips a small-molecule instance and an empty modality-extension; `check_boundaries.py` green |
| **S1-T2** | Species/strain physiology store; migrate the human constants from `pk_ivive.py` into the `human` row; add rat/mouse/dog/monkey + tissue-composition tables | `platform/kernel/.../pbpk/physiology/` (NEW) | constants match cited literature (unit tests); lookup by (species,strain,sex,age,bw) with modifiers; BW scaling test |
| **S1-T2b** | Generic-mammal allometric fallback + data-file species loading, so the handoff works for **any** animal: an un-calibrated species is parameterised from body weight (allometric volumes/flows/GFR) + a conserved mammalian tissue-composition default; uncertainty inflated and an `allometric_extrapolation` flag set. Species load from a data file, not code. Flag metabolic clearance as the least-transferable term for non-human species. | `platform/kernel/.../pbpk/physiology/` | an unknown species resolves to an allometric row with the extrapolation flag + widened uncertainty; a calibrated species is unaffected (regression test); adding a species via the data file needs no code change |
| **S1-T3a** | pKa predictor wrapper — QupKake primary (GNN + xtb), pkasolver fallback; measured-override support; per-SMILES cache; near-physiological-pH sensitivity flag | `modalities/small-molecule/.../pk_ivive/pka.py` (NEW) | benchmarked on a public pKa set (SAMPL/JCIM) with reported RMSE; returns per-site pKa + ionisation class; measured override bypasses prediction; cache hit test |
| **S1-T3** | Rodgers & Rowland Kp per organ (imports kernel tissue tables; consumes S1-T3a pKa) | `modalities/small-molecule/.../pk_ivive/kp.py` (NEW) | Kp for ≥3 published reference drugs within tolerance (unit tests); ionisation handled via the S1-T3a pKa output |
| **S1-T4** | Uncertainty helpers: ML residual → distribution; applicability-domain gate | `platform/kernel/.../uncertainty/residuals.py`, `applicability_domain.py` (NEW) | residual→lognormal test; AD returns in/edge/out on fixtures |
| **S1-T5** | Extend `pk_ivive.py`: species-aware system params (from store), renal CL, total CL; Monte-Carlo wrapper → intervals; **preserve the pure core, provenance, and no-fallback envelope** | `modalities/small-molecule/.../pk_ivive/pk_ivive.py` (EXTEND) | all existing IVIVE tests still pass unchanged; new interval outputs; seed-reproducible |
| **S1-T6** | Assemble `DispositionParameters` (fu, CL split, Kp[organ], vdss, AD, species_context) + Kp-derived Vss cross-check vs ML VDss | `modalities/small-molecule/.../pk_ivive/disposition.py` (NEW) | emits a valid contract object; Vss cross-check flags divergence correctly (unit test) |

*Stage 1 exit:* the disposition producer emits a validated, multi-species, uncertainty-tagged contract. No ODE yet.

### Stage 2 — Tissue PBPK ODE (rebuild in kernel)
| ID | Task | Files | Acceptance |
|----|------|-------|-----------|
| **S2-T1** | General multi-compartment perfusion-limited ODE consuming `DispositionParameters`; per-organ transport law + clearance/binding terms are **injected** (§5.1 req 2) | `platform/kernel/.../pbpk/model.py` (NEW) | mass-balance conservation test (total drug accounted for); reduces to the known 1-compartment analytic for a degenerate single-tissue case |
| **S2-T2** | Absorption sub-models (IV / oral+BCS / SC) + repeat-dose forcing; migrate BCS/formulation logic out of `animal_sim.py` | `platform/kernel/.../pbpk/absorption.py` (NEW) | per-route unit tests; oral first-pass reproduces a hand-calc |
| **S2-T3** | Virtual-cohort sampling from real parameter distributions + Monte-Carlo over disposition uncertainty | `platform/kernel/.../pbpk/cohort.py` (NEW) | reproducible under seed; outputs per-endpoint intervals |
| **S2-T4** | Service endpoint `POST /predict/pbpk/exposure` returning the §8 block (plasma + per-organ Cmax/Tmax/AUC/CL/Vss/t½ + curves, all with CI) | `service/src/hakase_service/main.py` | endpoint returns the documented schema; `sanitize()` applied; smoke test |
| **S2-T5** | Validation harness — **rat first**: scaffold split vs rat PK from ChEMBL animal-PK / PK-DB; fold-error, interval coverage, permutation control (cross-species transfer deferred until a 2nd species is calibrated) | `modalities/small-molecule/validation/` | report generated for rat; metrics computed on a held-out rat set |
| **S2-T6** | Retirement (per §4.4, gated on S2-T5 passing): delete TS `runAnimalCohortSimulation` + repoint frontend; delete stale `AnimalCohortRequest` dups; relocate DB queries to `platform/datasources`. **Leave `animal_sim.py` in place.** | frontend + routers | frontend calls new endpoint; boundaries green; animal-layer code untouched |

*Stage 2 exit (HARD GATE):* exposure validated (fold-error within 2–3×, calibrated coverage) and **frozen**. Only then may the animal-testing-layer build begin.

---

## Part 7 — Build guardrails (must hold for every task)

1. **Repo & branch:** work inside `hakase-bio-backend` (a git repo, default branch `dev`). Branch from `dev` per task — never commit directly to `dev`. One task → one branch → one focused commit.
2. **Environment:** use the repo's own `.venv` to run `pytest`. Do not create a new interpreter.
3. **Pre-commit checks — all four must pass locally before committing:**
   - `ruff` (lint)
   - `black` (format)
   - `python scripts/check_boundaries.py` (architecture boundaries)
   - `pytest` (the task's tests + the existing suite)
   These three tools (ruff/black/check_boundaries) are exactly what CI runs — reproduce them locally.
4. **Boundary rule:** `platform/` must never import `modalities/`; a modality may import `platform/`; no modality→modality import. New kernel code stays modality-agnostic (no SMILES, no RDKit in `platform/`).
5. **Commit attribution:** author as `bh-yeshwanth` only. **Do NOT add a `Co-Authored-By: Claude` trailer** (project policy).
6. **Scope discipline:** implement only the current task. Do not delete `animal_sim.py`; do not rewire the frontend before S2-T5 passes; do not start a downstream task early.
7. **Definition of done:** small scoped diff + new tests + all four checks green + the task's acceptance criterion demonstrably met.
