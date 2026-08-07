# PBPK / IVIVE Validation (S2-T5) — Team Handoff

**Status: strong provisional PASS on the rat clearance gate.** The exposure engine
now predicts rat clearance within the field-standard fold band on a real,
non-circular benchmark, with calibrated uncertainty. This is *not yet* the final
S2-T6 freeze sign-off (small dataset; Vss not yet validated), but the validation
layer and the engine are in far better shape than when we started.

Author of this pass: bh-yeshwanth · Date: 2026-07-30 · Scope: `modalities/small-molecule/validation/` + one kernel engine fix.

---

## ⚠️ ADDENDUM (2026-07-31, fifth pass) — rat hepatocellularity reconciled (store now carries the cited rat HPGL)

A latent inconsistency in the rat IVIVE scale-up, flagged during the fourth pass, is
now closed.

- **The bug.** The rat hepatocyte-CLint → whole-liver scale-up
  (`pk_ivive.compute_ivive`) multiplies by `HPGL · liver_g_per_kg / 1000`. The
  kernel physiology store's rat rows carried **no** hepatocellularity, so
  `resolve_system_parameters("rat")` fell back to the **human** 99e6/g (Barter 2007),
  flagged `hpgl_provenance="assumed"`. But the **benchmark** deconvolves Naritomi's
  reported in-vivo CLint with **÷4.8 = rat HPGL 120e6/g × liver 40 g/kg ÷ 1000**
  (Houston & Carlile 1997; the standard rat value, also used by Ito & Houston 2004).
  So the harness deconvolved with 120e6/g and the engine re-scaled with 99e6/g — a
  silent ~0.75× under-scaling of every rat in-vivo CLint (`99·36.6 / (120·40) = 0.76`).
- **The fix.** Gave the rat rows (`sprague_dawley`, `wistar`) their **own cited
  hepatocellularity, 120e6/g** (Houston & Carlile 1997), in
  `platform/kernel/.../physiology/store.py`. `resolve_system_parameters("rat")` now
  returns `hpgl_provenance="reference"` with no assumed-human warning, and the rat
  scale-up factor is `120·36.6/1000 = 4.39` — consistent with the benchmark's 120e6/g.
  The small residual vs the benchmark's 4.8 is the **liver-weight** source difference
  (store uses Brown 1997's 36.6 g/kg, which drives the whole 13-compartment volume
  model; Naritomi's frame used 40 g/kg); it is documented, not forced, because the
  store's liver weight must stay single-sourced to Brown 1997 for Vss.
- **Which value & why.** Human 99e6/g (Barter 2007) is a *human* weighted mean;
  applying it to rat is simply wrong. Rat HPGL is well-established at 120e6/g and is
  exactly what the CLint benchmark already assumes — so 120e6/g both fixes the science
  and removes the harness/engine inconsistency. The store's `hepatocellularity_1e6_per_g`
  field is now documented as species-specific; other species stay `None` (assumed-human,
  flagged) until validated.
- **Clearance gate: no regression — slightly better.** median **1.40× → 1.38×**,
  within-3× **100 % (unchanged)**, within-2× **80 % → 90 %**, calibrated 90 % coverage
  **90 %** at **±2.62 → ±2.52-fold**. Per-drug the +21 % scale-up nudges under-predictors
  onto the line (diazepam 1.53→1.37, phenytoin 1.40→1.24, diclofenac 2.29→1.94) and the
  over-predictors up slightly (aminopyrine 2.13→2.38, still the max and well within 3×).
- Tests updated to pin the new contract: `test_pbpk_physiology.py`
  (`test_rat_hepatocellularity_is_species_specific`) and
  `test_pk_ivive_species_uncertainty.py` (rat provenance now `reference`, no warning).
  Provenance notes updated in `measured_reference.py` and the store header.
- **Scope note:** kernel physiology + IVIVE only; `animal_sim.py` is untouched (it
  carries its own hard-coded `99.0` for a separate, orphaned engine — out of scope here).

---

## ⚠️ ADDENDUM (2026-07-31, fourth pass) — base-Kp logP fixed with a reliability-gated resolver

The third-pass diagnosis below (Crippen over-estimates neutral logP for lipophilic
fused-azole bases; the adipose `P·fNL` term amplifies it) is now **fixed**, and the
recommended permanent tissue-Kp validation set is **built**. This supersedes the
"flagged, not forced" status of that item.

- **New neutral-logP resolver** (`pk_ivive/logp_resolver.py`), wired into the Kp path
  in `validation/run_pbpk_validation.py`. It is a **reliability-gated, one-directional
  cap on Crippen**, not a global swap:
  1. default to Crippen;
  2. only for the **base** regime, compute the logD-anchored reconstruction
     `logP = logD7.4 + log10 R(7.4)` (thermodynamic identity; logD7.4 = the ML
     `Lipophilicity_AstraZeneca` endpoint);
  3. trust it **only when `log10 R(7.4) ≤ 1.0`** — i.e. the base is weakly ionised at
     plasma pH, so the reconstruction is robust to pKa error. This is exactly what
     separates the fused-azole *weak* bases (`log10 R` ≈ 0.15–0.3) from the
     moderate/strong bases (`log10 R` ≥ 1.5);
  4. cap **downward only** (use it iff it is *below* Crippen), so it can never inflate
     a logP the way the reverted global swap did.
- **Why this succeeds where the prior attempt failed.** The prior swap applied the
  ionisation correction to *every* base and so over-corrected the strong ones
  (chlorpromazine 5.19→6.31, because its `log10 R`≈3.1 inherits the full pKa error).
  The `log10 R ≤ 1.0` gate leaves every strong base on Crippen; the downward-only rule
  protects the anchors. Concretely the gate fires for **only** midazolam / alprazolam /
  triazolam and touches nothing else.
- **logP vs literature (the 4 Vss anchors): unchanged** — diazepam (neutral),
  phenobarbital (neutral), chlorpromazine & pentazocine (strong bases, `log10 R`≫1) all
  stay on Crippen. The fused-azole bases move onto their experimental logP:
  midazolam 4.32→3.20 (exp 3.1), alprazolam 3.58→2.32 (exp 2.3), triazolam 4.23→2.75
  (exp 2.4). Among affected compounds: **3 wins, 0 regressions.**
- **Tissue-Kpu vs Rodgers 2005/2006 experimental** (new permanent set,
  `datasets/rodgers_tissue_kpu.csv`; runner `validate_tissue_kp.py`; 9 compounds,
  76 tissue observations). Toggling **only** logP, Crippen→resolver:
  **pooled median fold 3.19×→1.91×, within-3× 49%→66%, GMFE 3.55×→2.32×.**
  Per-compound: alprazolam 11.15×→1.96×, midazolam 6.95×→2.86×, triazolam 11.06×→1.41×
  (all IMPROVED); the 3 strong-base regression controls (imipramine, lidocaine,
  fentanyl) and the 3 non-azole benzodiazepines are **byte-identical** (unchanged).
- **Vss gate: no regression (identical).** median **1.43×**, **88.9 % within 3×**,
  ±2.78-fold, diazepam **1.01×** — every gate compound is either neutral, an acid, or a
  strong base, so none is touched by the resolver. Per-drug before=after.
- 8 new unit tests (`validation/tests/test_logp_resolver.py`) pin the contract
  (cap fires for weak bases, strong bases/neutrals/acids untouched, downward-only,
  degrades to Crippen with no logD). All CI green (ruff/black/boundaries; 234 pytest
  passed, 2 pre-existing skips).
- **Scope note:** the resolver is wired into the validation Kp path only. The live
  `/predict/pbpk/exposure` endpoint (`service/main.py`) still calls
  `Descriptors.MolLogP` directly and is a one-line follow-up to adopt
  `logp_resolver.neutral_logp_for_smiles` (deliberately left out of this IVIVE-scoped
  change).

---

## ⚠️ ADDENDUM (2026-07-31, third pass) — grown sets + phenylbutazone root-caused

Follow-up on the second pass below. Both gates grown from cited primary sources, and
the one Vss outlier root-caused and fixed:

- **Clearance gate grown 4 → 10 drugs** (added 6 low-extraction compounds from
  **Ito & Houston 2004, PMID 15180335** — rat hepatocyte CLint + observed CLh; only
  low-extraction added because Ito's Qh frame (100 mL/min/kg) differs from ours (70),
  which only matters for flow-limited drugs). **Now: median 1.40×, 100 % within 3×,
  calibrated coverage 90.0 %, ±2.62-fold.**
- **Phenylbutazone Vss outlier root-caused & fixed.** It was NOT the Kp model — the
  **pKa heuristic** (`pk_ivive/pka.py`) misclassified phenylbutazone's acidic
  1,3-dicarbonyl C–H as a base (its amide ring-nitrogens matched the aniline rule), so
  the drug was treated as a neutral and over-distributed. Added an active-methine acid
  rule (`[CX4;H1]` so barbiturates' quaternary C is untouched) and excluded amide N
  from the aniline rule. Phenylbutazone Vss **29.8× → 1.4×**. **Vss gate now: median
  1.43×, 88.9 % within 3×, 88.9 % coverage, ±2.78-fold** (was ±17-fold).
- Two tests that assumed the ADMET model was offline were updated (they now force ML
  off via monkeypatch) — a consequence of `model_4.pt` being restored so ML loads.
- **Data note:** Obach 2008's PDF is human-only (rat data is supplemental); the
  Rodgers–Rowland papers give tissue Kp, not a direct observed-Vss table.
- **Vss growth investigated, found impractical from these papers.** Reconstructing
  observed Vss from Rodgers 2006 experimental tissue Kpu is too noisy to serve as gate
  targets — validated on the diazepam anchor (Sawada observed Vss 5.30 vs
  Kpu-reconstruction ~3.7, ~1.4× error inherent to the reconstruction). The Vss gate
  therefore stays at its strong n=9 state.
- **But the same data gave a real diagnosis.** Spot-validating the engine's predicted
  Kp against Rodgers' experimental tissue Kpu: excellent for **neutrals/acids**
  (diazepam 1.38×, phenobarbital 1.65×, phenytoin 2.56× median tissue-Kp fold) but the
  engine over-predicts tissue partitioning for some lipophilic bases (midazolam ~7×,
  alprazolam ~40× in adipose).
- **Base-Kp over-prediction root-caused to logP, not the Kp model.** The Kp model is
  correct: feeding midazolam's *experimental* logP (3.1) instead of RDKit Crippen (4.3)
  drops its adipose Kp from 17× over to spot-on (5.7 vs obs 6.3). The error is that
  **Crippen logP over-estimates ~1 unit for specific lipophilic fused-azole bases**,
  and the adipose term (`P·fNL`) amplifies it. **An ML-LogD→neutral-logP swap was
  attempted and reverted** — it over-corrects strong bases (chlorpromazine lit logP
  5.19 → corrected 6.31 vs Crippen's accurate 4.89) and regressed the diazepam anchor,
  i.e. it trades errors rather than fixing cleanly. **The real fix is a proper neutral-
  logP predictor** (Crippen is actually within ~0.3–0.8 of literature for most gate
  compounds; the failure is compound-specific). Flagged, not forced. A permanent
  tissue-Kp validation set (Rodgers Table 5) is recommended to track this.

---

## ⚠️ ADDENDUM (2026-07-30, second pass) — supersedes headline numbers below

A follow-up pass traced every benchmark value back to primary tables (the actual
Naritomi 2003 and Sawada 1985 PDFs) and, in doing so, found and fixed deeper issues.
**Where this addendum conflicts with the sections below, the addendum is current.**

- **Clearance gate is now single-source and honest.** The prior benchmark's CLint
  values did not trace to Naritomi, and its observed-CL column was mixed-source with
  some wrong values (diazepam CL was 8.0; real rat CL ≈ 35–43). Rebuilt as **4
  Naritomi drugs** (diazepam, diltiazem, zidovudine, acetaminophen), CLint recomputed
  from **Naritomi Table 3 ÷ 4.8** (hepatocellularity), fu/B:P from Table 2, observed
  CL = Naritomi **EH×Qh**. Proprietary **quinotolast dropped** (observed-CL sources
  disagree ~10×). **Result: median 1.23×, 100 % within 2× and 3×, ±2.92-fold interval.**
  (The old "1.71×, n=8" was propped up by non-traceable inputs.)
- **The independent Vss endpoint now exists and is validated.** The claim below that
  "the harness is already parameterised to score Vss" was **false** — Vss was read as
  an input, never scored, and the cohort's `vss` was actually a blood *compartment
  volume* (a latent bug). Built a real steady-state Vss (`Σ V·Kp + V_blood·BPR`),
  wired it as a scored endpoint, and validated against **9 rat drugs** from the
  correct Sawada 1985 paper (**PMID 3938813**). **Result: median 1.65×, 77.8 % within
  3×, 88.9 % calibrated coverage.** Phenylbutazone (29.8×) is the lone outlier — a
  Rodgers–Rowland weakness for highly protein-bound acids (flag, akin to the OATP
  exclusion on the CL side).
- **Root-cause engine bug found & fixed: the physiology store had only 3 of 10
  organs.** Muscle (~40 % of body weight), adipose, skin, brain, gut, spleen, lung
  were absent for **every species** — so the "13-compartment" model ran as ~4
  compartments and could not reproduce Vss. Populated the rat row from **Brown 1997**.
  This is invisible to the CL gate (AUC-based CL is volume-insensitive) but was the
  real reason Vss failed. Solver tolerance tightened (`rtol 1e-6`) so the fuller,
  stiffer system conserves mass.
- **`model_4.pt` / git-lfs resolved (§3.3 caveat is obsolete).** `git-lfs` is now
  installed; HEAD already stores the correct pointer and the object is present — the
  ML ensemble loads. Separately, **9 other `.pt` files are raw binaries in history**
  (pre-existing LFS debt) — deferred to a coordinated `git lfs migrate import`, not
  this branch.
- 86 kernel + validation tests pass; ruff/black/boundary checks clean.

---

## 0. TL;DR for the busy reader

- S2-T5 is the **hard validation gate**: prove the PBPK exposure engine predicts
  measured rat PK before anything downstream trusts it. It existed but was
  **producing meaningless numbers**.
- We fixed the **harness** (unit bugs, one-constant-for-every-drug bug, leakage
  controls, tests), removed a **fabricated dataset**, restored the **ML ADMET
  model**, and found & fixed **three real engine bugs** — one of which also fixes
  the **live `/predict/pbpk/exposure` endpoint**.
- Result on the real, cited, non-circular benchmark (in-domain, n=8):
  **median fold 1.71×, 100 % within 3×, calibrated 90 % coverage = 87.5 %.**
  Both criteria the spec requires (accuracy within 2–3× **and** calibrated
  coverage) are met.
- Remaining before a *final* freeze: grow the measured-CLint set beyond 8 drugs,
  add observed rat **Vss**, firm the CLint file's per-value provenance. All are
  **data-acquisition** tasks, not code.

---

## 1. What S2-T5 is and why it matters

The PBPK engine (built in S2-T1…T4) takes a molecule's structure and predicts what
happens to it in a rat over time — how fast it's cleared, its exposure (AUC), its
peak (Cmax). **S2-T5 is the exam that checks those predictions against real
measured rat data.** The spec makes it a *hard gate*: the engine may not be frozen
or wired into the product (S2-T6) until it passes, because "organ error = exposure
error × organ-model error" — a wrong exposure model poisons everything above it.

"Pass" means two things, both required:
1. **Accuracy** — predicted vs measured clearance within the field-standard
   **2–3× fold-error** band.
2. **Calibrated coverage** — a 90 % predictive interval actually contains the truth
   ~90 % of the time.

## 2. The starting state — why it looked done but wasn't

The harness ran and printed a full report, so it *looked* finished. It wasn't. The
numbers were meaningless for three independent reasons, each of which we fixed:

1. **Unit mismatch.** It compared the engine's answer in one unit against the lab
   value in another (e.g. `L/min` vs `mL/min/kg`). This produced a fake "2978×
   clearance failure" that was purely a unit bug — the real error was ~1.3×.
2. **One constant for every drug.** It secretly fed *identical* disposition inputs
   (fu=0.1, CLint=10 …) to every compound, so it wasn't testing per-drug behaviour
   at all.
3. **A fabricated answer key.** The 5-row benchmark was hand-typed round numbers
   that don't even satisfy their own arithmetic (AUC ≠ Dose ÷ CL).

**Lesson for the team:** a validation harness that runs cleanly can still be
validating nothing. Making it *honest* is what exposed the real gaps.

## 3. What we did, step by step (need → why → how)

### 3.1 Made the harness correct

- **Unit reconciliation** (`run_pbpk_validation.py`). *Need:* compare like with
  like. *How:* convert predictions into benchmark units before scoring — mg/L →
  ng/mL (Cmax), mg·min/L → ng·h/mL (AUC), L/min → mL/min/kg (CL, ÷ body weight).
- **Per-compound inputs, no fabrication.** *Need:* each drug must drive the model
  with *its own* disposition. *How:* read per-row measured in-vitro inputs
  (CLint, fu) from the benchmark; fall back to ML ADMET; if a hard-required input
  (CLint or fu) is still missing, the compound is **skipped, never back-filled**.
- **Leakage controls** (`pbpk_holdout.py`). *Need:* an honest held-out test set.
  *How:* strip salts to the parent structure, drop exact-parent duplicates, and
  split by Bemis–Murcko scaffold with an assertion that no scaffold appears in
  both train and test.
- **Endpoint-independent scoring.** *Need:* a drug with a published CL but no Cmax
  should still count toward CL. *How:* score each endpoint only over the compounds
  that have an observed value for it.
- **Tests** (`tests/test_pbpk_metrics.py`, `tests/test_pbpk_holdout.py`). 13 unit
  tests pin fold-error symmetry, coverage, permutation-control discrimination,
  salt de-duplication, and the no-scaffold-leakage guarantee.

### 3.2 Removed the fabricated data

*Need:* a gate graded against fiction is worse than no gate — it hands out false
confidence. *How:* quarantined the fabricated file
(`datasets/_UNVERIFIED_synthetic_rat_pk.csv.quarantine`), replaced the benchmark
with a documented schema (`datasets/RAT_PK_BENCHMARK.README.md`), and made the
harness **refuse to run** on an empty benchmark rather than invent numbers.

### 3.3 Restored the ML ADMET model

*Need:* the pipeline predicts CLint/fu from structure via a local Chemprop
ensemble; it was silently dead. *Why:* one of the five regression weights
(`vendor/hakase_admet/.../admet_regression/model_4.pt`) was a **git-LFS pointer**,
not the real file, so the whole ensemble failed to load and every ADMET call fell
back to empty. *How:* pulled just that object via the **LFS batch API** using the
`gh` token (git-lfs is not installed on this machine), **verified its SHA-256**
against the pointer, and placed it. ML ADMET now loads (`ml_available: True`).

> ⚠️ **Commit caveat:** `model_4.pt` is LFS-tracked. On a machine without git-lfs,
> committing it would store the raw 1.3 MB binary instead of a pointer. Either
> install git-lfs first, or **exclude `model_4.pt` from the commit** and treat its
> restoration as a local/CI environment fix.

### 3.4 Tried structure→ML→IVIVE end-to-end (Path B) — and learned why it fails for rat

*Need:* the "production" path is structure → ML ADMET → IVIVE → PBPK. *Result:* it
**fails the rat gate** (median ~4×, chance-level). *Why, proven:* the ADMET models
are **human-trained** (TDC `Clearance_Hepatocyte_AZ`, `PPBR_AZ`); their predicted
CLint is **statistically uncorrelated with rat clearance** (Spearman 0.21,
p = 0.48) and compresses a 90× range of true values into a 10× band. No code trick
fixes an uninformative input. **Conclusion:** an accurate *rat* IVIVE needs a
rat-relevant CLint source (measured or rat-calibrated), not the human ML value.

### 3.5 Caught the first "measured" dataset was circular

*Need:* verify uploaded data before trusting it. *Finding:* an uploaded sheet's
`CLint` column was **algebraically back-calculated from the observed clearance**
(`CLint = Qh·CLH/(fu·(Qh−CLH))`, matching 37/40 rows exactly). Feeding it back
reproduces the answer trivially — a **fake 100 % pass**. We discarded it. *Lesson:*
a "perfect" gate result is a red flag, not a triumph.

### 3.6 Verified and used the real CLint data

*Need:* independent, real rat CLint. *How:* the second uploaded file
(`data/rat hepatocyte CLint.csv`, primary source **Naritomi et al. 2003,
DMD 31(5):580, PMID 12695346**) is genuinely **non-circular** — its CLint predicts
the *independent* observed clearances at ~2× (not 1.0), i.e. real signal. We built
`datasets/rat_measured_clint_benchmark.csv` (9 drugs where a measured CLint overlaps
an observed CL) and its in-domain subset (8 drugs, excluding the OATP transporter
substrate troglitazone, which is outside the metabolic-clearance model's domain).

### 3.7 Found and fixed three real engine bugs

The now-honest gate surfaced genuine engine defects (not harness bugs). All are
fixed; the first also fixes the **live production endpoint**.

1. **Hepatic clearance flow-limited twice + wrong units**
   (`platform/kernel/src/hakase_kernel/pbpk/model.py`, `clearance_law`).
   *Why:* the IVIVE core already returns the *well-stirred systemic* clearance
   (flow-limited once at Q_h). The ODE then applied it again through the perfused
   liver compartment (double limit), and treated a per-kg value as absolute
   (mis-scaling by 1/body-weight). The two errors partly cancelled, so it looked
   plausible while under-predicting high-clearance drugs ~2× (propranolol read ~20
   vs observed 45). *How fixed:* recover the flow-independent **intrinsic**
   clearance `cl_hepatic / (BPR·(1−E_H))` (the Q_h cancels algebraically), scale
   per-kg → absolute, and let the ODE's perfusion flow-limit **once**. Locked in
   with a kernel regression test (`test_hepatic_clearance_single_flow_limit`).
2. **Renal clearance never fired.** The compartment is `"kidney"` but the code
   matched `"kidneys"` — dead code. Enabled with correct per-kg → absolute,
   plasma-referenced scaling.
3. **AUC grid too coarse** (`run_pbpk_validation.py`). A uniform 500-point time
   grid over-estimated AUC on the IV-bolus concentration spike, under-estimating CL
   for fast drugs. Densified sampling over the first 2 h.

After these, propranolol reads **35** (was 20), diltiazem **44**, zidovudine **40** —
high-clearance drugs land on the unity line.

### 3.8 Calibrated the uncertainty (coverage)

*Need:* the gate's second criterion is *calibrated coverage*. The cohort's
Monte-Carlo p05–p95 reflects only inter-animal physiology (~±11 %), not the
model/input error — so raw coverage was ~0 %, which is the *wrong interval* for a
predictive check. *How:* added a **leave-one-out lognormal predictive interval**
(PK error is multiplicative): for each drug the log-residual mean/SD of the *other*
drugs define its interval, using the small-sample **t-prediction-interval** formula.
Coverage is now a genuine out-of-sample estimate. We report the interval **width**
(a fold factor) as the honest model-quality signal. The repo's distribution-free
`ConformalRegressor` is the target once the set exceeds ~19 drugs (it cannot certify
90 % at n = 8, and correctly refuses).

### 3.9 Firmed the citations

Every benchmark value now carries a verified primary source: **Naritomi 2003
(PMID 12695346)** for CLint; **Sawada et al. 1985, J Pharmacokinet Biopharm 13:477
(PMID 3938813)** and Naritomi 2003 for observed CL.

## 4. The result

Rat clearance gate, measured-CLint benchmark:

| Set | n | median fold | within 3× (chance) | within 2× | calibrated 90 % coverage |
|---|---|---|---|---|---|
| **In-domain** (metabolic only) | 8 | **1.71×** | **100 %** (56 %) | 62 % | **87.5 %** (±4.4-fold) |
| All (incl. OATP substrate) | 9 | 1.89× | 89 % (52 %) | 56 % | 88.9 % (±7.5-fold) |

The in-domain set **passes both gate criteria**. It clearly beats the permutation
control (100 % vs 56 % within 3×), so the signal is real and non-circular.

**Why AUC is not a separate endpoint:** for an IV bolus, AUC = Dose/CL exactly, so
an AUC gate is mathematically identical to the CL gate — validating it separately
would be circular. **Vss** is the genuinely independent second endpoint and is the
next thing to add (needs observed rat Vss data).

## 5. What this means for production

The `clearance_law` fix is not just for the gate — the live
**`POST /predict/pbpk/exposure`** endpoint (`service/src/hakase_service/main.py`)
uses the same function, so every exposure prediction the product makes is now
correctly flow-limited and unit-consistent. High-clearance compounds that were
silently under-predicted ~2× are corrected.

## 6. Files changed

**Engine (kernel):**
- `platform/kernel/src/hakase_kernel/pbpk/model.py` — `clearance_law` rewrite (hepatic intrinsic + single flow-limit; renal enabled + unit fix).
- `platform/kernel/tests/test_pbpk_model.py` — new regression test.

**Validation harness:**
- `modalities/small-molecule/validation/run_pbpk_validation.py` — units, per-row inputs, endpoint-independent scoring, dense AUC grid, calibrated coverage, `--benchmark`/`--test-fraction` flags.
- `.../validation/pbpk_holdout.py` — salt strip, parent dedup, leakage assertion, `benchmark_file`, empty-file guard.
- `.../validation/pbpk_metrics.py` — non-finite/zero guards, formatting.
- `.../validation/plot_pbpk_validation.py` — new pred-vs-observed plot.
- `.../validation/tests/test_pbpk_metrics.py`, `.../tests/test_pbpk_holdout.py` — new (13 tests).

**Data & reports:**
- `.../validation/datasets/rat_pk_benchmark.csv` — 40-drug benchmark (schema + SMILES).
- `.../validation/datasets/rat_measured_clint_benchmark.csv` + `..._indomain.csv` — cited measured-CLint sets.
- `.../validation/datasets/RAT_PK_BENCHMARK.README.md` — schema/provenance doc.
- `.../validation/datasets/_UNVERIFIED_synthetic_rat_pk.csv.quarantine` — quarantined fabricated data.
- `.../validation/reports/S2-T5_GATE_REPORT.md` + PNG plots + JSON reports.

**Model weights (see §3.3 caveat):** `.../vendor/hakase_admet/resources/models/admet_regression/model_4.pt` restored from LFS.

## 7. How to run it

```bash
# full 40-drug structure→ML gate (rat)
python modalities/small-molecule/validation/run_pbpk_validation.py --species rat

# measured-CLint gate, in-domain, score every row
python modalities/small-molecule/validation/run_pbpk_validation.py \
    --species rat \
    --benchmark modalities/small-molecule/validation/datasets/rat_measured_clint_indomain.csv \
    --test-fraction 1.0

# render the pred-vs-observed plot from the latest report
python modalities/small-molecule/validation/plot_pbpk_validation.py

# the four CI checks
ruff check . && black --check . && python scripts/check_boundaries.py && pytest
```

## 8. What's still open (before a *final* S2-T6 freeze)

All data-acquisition, not code:
1. **Grow the measured-CLint set** beyond 8 in-domain drugs (need independent rat
   hepatocyte CLint + observed CL for more compounds).
2. **Add observed rat Vss** to validate the Kp/partitioning path (Sawada 1985
   reports it; it's paywalled). The harness is already parameterised to score it.
3. **Firm per-value provenance** of `data/rat hepatocyte CLint.csv` (values are
   Naritomi-traceable but marked "representative").
4. Note a real **cross-source discrepancy**: rat diazepam CL is reported as 8
   (Sawada) vs ~39 (Li & Jusko 2022) — some gate "misses" may be observed-data
   quality, not model error, meaning the engine is plausibly *better* than 1.71×.

## 9. Glossary (for non-PK teammates)

- **IVIVE** — In-Vitro→In-Vivo Extrapolation: scale a lab-dish clearance (CLint)
  up to whole-body clearance.
- **Well-stirred model** — the standard equation turning intrinsic clearance +
  liver blood flow + free fraction into hepatic clearance.
- **CLint** — intrinsic clearance: how fast liver enzymes chew a drug, independent
  of blood flow. **fu** — fraction of drug unbound (free) in plasma.
- **Fold-error** — max(pred/obs, obs/pred); the field trusts predictions within
  2–3×. **Coverage** — how often the stated confidence interval contains the truth.
- **Scaffold split / leakage** — testing on molecules structurally unlike the
  training ones, so the score isn't inflated by near-duplicates.
- **Permutation control** — shuffle predictions against truth; a real model must
  beat this random baseline.
