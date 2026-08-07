# The PBPK / IVIVE Layer — the Full Story (S1-T1 → S2-T5)

**Audience:** anyone on the team who wants to understand what the PBPK/IVIVE
exposure layer is, why we built it the way we did, and where it stands today —
without needing a pharmacokinetics degree. Read top to bottom; each section says
what a stage *is*, *why* it exists, and *how* it works.

Last updated: 2026-07-30 · Status: **Stage 2 validation gate (S2-T5) passes on
clearance AND volume of distribution (both single-source, cited); S2-T6 not started.**

---

## Addendum (2026-07-31, third pass) — grown validation + phenylbutazone fixed

- **Clearance gate: 4 → 10 drugs** (added 6 low-extraction rat compounds from Ito &
  Houston 2004, PMID 15180335) → **median 1.40×, 100 % within 3×, 90.0 % coverage.**
- **Vss gate: phenylbutazone outlier root-caused & fixed** — a pKa mis-ionization
  (acidic 1,3-dicarbonyl C–H classified as a base), not a Kp-model flaw. After the fix
  the Vss gate is **median 1.43×, 88.9 % within 3×, 88.9 % coverage** (interval
  ±17-fold → ±2.78-fold).
- Both gates now rest on cited primary-source data with the one known outlier resolved.

## Addendum (2026-07-30, second pass) — what changed since first draft

A second pass verified every number against the primary-source PDFs and hardened the
engine. Current honest state (supersedes conflicting details lower down):

- **Clearance gate:** rebuilt as **4 single-source Naritomi drugs** with CLint
  recomputed from Naritomi Table 3, observed CL from Naritomi EH×Qh → **median 1.23×,
  100 % within 2× & 3×** (the earlier 1.71×/n=8 used non-traceable inputs).
- **Volume of distribution (Vss) is now a real, scored, independent endpoint** —
  validated on **9 rat drugs** (Sawada 1985, PMID 3938813): **median 1.65×, 77.8 %
  within 3×, 88.9 % coverage** (phenylbutazone the lone outlier).
- **Fixed the engine bug that made this possible:** the physiology store defined only
  liver/kidney/heart — muscle (~40 % of body weight), adipose, skin, brain, gut,
  spleen, lung were **missing for every species**, so the "13-compartment" model ran
  as ~4 and collapsed Vss. Populated the rat row from Brown 1997; also fixed a
  mislabeled cohort `vss` (was a compartment volume) and tightened solver tolerance.
- git-lfs installed; `model_4.pt` resolved (ML ADMET loads).

---

## 0. The one-paragraph summary

We are building a single, trustworthy engine that predicts **what a drug does
inside an animal's body over time** — how fast it's cleared, how much exposure
(AUC) it produces, how high it peaks — starting from just the molecule's chemical
structure. Stage 1 built the **science pieces** (physiology, partitioning, the
in-vitro→in-vivo scaling, uncertainty). Stage 2 wired them into a **whole-body
simulation** and then **validated it against real measured rat data**. That
validation (S2-T5) is a hard gate: nothing downstream is allowed to trust the
engine until it passes. It now passes on rat clearance.

## 1. Why this layer exists (the problem)

Before this work, the codebase had **three separate, inconsistent implementations**
of animal PK simulation, exposure and toxicity were tangled together, many
parameters were **magic numbers** with no source, and — most importantly — there
was **no validation at all**: the engine's accuracy against real measurements was
simply *unknown*.

The design through-line for the rebuild:

> Collapse three implementations into one, split **exposure** from **tox**, make
> every parameter **mechanistic-or-measured with an uncertainty**, and **gate on
> validation.**

And a scope rule that shaped everything: **rat first.** Calibrate and validate the
whole vertical on rat (Sprague-Dawley) only; other species are added later as
*data* (a config row) plus their own validation — never as new code.

## 2. How the code is organised

Two layers, with a strict dependency direction (enforced by `check_boundaries.py`):

- **`platform/kernel/`** — the reusable, modality-agnostic machinery: the
  physiology store, the disposition data-contract, the ODE solver, the
  virtual-cohort + uncertainty tools, the validation-harness pattern. The kernel
  must **never** import from a modality.
- **`modalities/small-molecule/`** — the small-molecule specifics: the IVIVE
  scaling, the Rodgers–Rowland partition model, the ADMET inputs, and the
  validation datasets/harness.

This split is why "add mouse later" is a data change, and why the same PBPK core
can serve other modalities.

---

## 3. Stage 1 — building the science pieces

Stage 1 produced the inputs and machinery the whole-body model needs. Order
matters (each builds on the last):

### S1-T1 — The disposition contract  *(commit 88db00a)*
**What:** `DispositionParameters` — the single data structure handed from the
front-end science to the ODE. It carries fraction unbound (fu), blood:plasma
ratio, the clearance split (hepatic/renal/total), per-organ partition coefficients
(Kp), volume of distribution, extraction ratio, the species it was computed for,
and an applicability-domain verdict. **Why:** one well-typed contract means the
physics engine never has to guess what it's being handed; every number arrives
with its units, provenance, and uncertainty envelope.

### S1-T2 — The species/strain physiology store  *(d806d63)*
**What:** a data-driven store of real physiological parameters per species/strain
— organ volumes, organ blood flows, cardiac output, hepatic blood flow, GFR, body
weight. **Why:** these are the "plumbing" constants of the body. Keeping them as
**data** (not code) is what makes the rat-first / add-species-later strategy work.

### S1-T2b — Any-species allometric fallback  *(71bbf9d)*
**What:** when a species has no explicit data row, derive its physiology by
allometric scaling from body weight. **Why:** graceful coverage for species we
haven't curated — flagged `provisional/unvalidated` so it's never silently trusted.

### S1-T3a — pKa predictor  *(66d7511)*
**What:** predict acid/base ionisation (pKa) from structure, with a strict opt-in
fallback. **Why:** ionisation drives how a drug partitions into tissues; it's a
prerequisite for the Kp model below.

### S1-T3 — Rodgers–Rowland tissue:plasma Kp  *(0018de3)*
**What:** compute per-organ partition coefficients (Kp = how strongly each tissue
concentrates the drug vs plasma) using the mechanistic Rodgers–Rowland method from
logP, pKa, fu, and rat-specific tissue composition. **Why:** Kp values are what
turn a blood concentration into tissue concentrations — they set the volume of
distribution and the shape of the concentration-time curve. (These compositions
are rat-specific by construction; other species need their own.)

### S1-T4 — Kernel uncertainty helpers  *(f1412b2)*
**What:** residual/uncertainty tooling and the applicability-domain machinery
(incl. conformal prediction). **Why:** every prediction should come with a
*calibrated* interval, not just a point — and the engine should know when a
molecule is outside the domain it can be trusted on.

### S1-T5 — Species-aware IVIVE + renal CL  *(42b8682)*
**What:** the **in-vitro→in-vivo extrapolation** core. Takes an in-vitro
hepatocyte intrinsic clearance (CLint) plus fu and, using the **well-stirred liver
model** and rat scaling factors (hepatocyte-per-gram-liver, liver weight, hepatic
blood flow), computes in-vivo hepatic clearance; adds renal filtration clearance;
and propagates Monte-Carlo uncertainty intervals. **Why:** this is the heart of
predicting clearance from a lab-dish measurement — the single most important
number for exposure.

### S1-T6 — The disposition assembler  *(8f4c441)*
**What:** ties S1-T1…T5 together — assembles a complete `DispositionParameters`
from the IVIVE result + Kp result, and cross-checks the Kp-derived volume of
distribution against an independent estimate. **Why:** produces the one object the
Stage-2 ODE consumes.

**End of Stage 1:** for any rat compound we can now produce a full, uncertainty-
carrying disposition description from structure + a couple of in-vitro inputs.

---

## 4. Stage 2 — the whole-body simulation and its validation

### S2-T1 — The multi-compartment perfusion-limited ODE  *(82917fd)*
**What:** the whole-body physiologically-based model — a system of differential
equations for ~13 compartments (arterial/venous blood, lung, liver, kidney, heart,
brain, muscle, adipose, skin, gut, spleen, rest), each perfused by blood flow, with
elimination in the liver and kidney. **Why:** this is the actual "simulate the
body" engine; given a disposition + physiology it produces concentration-vs-time in
every organ.

### S2-T2 — Absorption input models  *(428865a)*
**What:** how the drug enters — IV bolus, oral absorption with BCS-based logic, etc.
**Why:** the same disposition can be dosed different ways; the input model sets the
initial conditions / infusion.

### S2-T3 — Virtual cohort + Monte-Carlo  *(bcfa83a)*
**What:** instead of one "average animal," sample a **population** of virtual
animals (varying body weight → varying organ sizes/flows) and Monte-Carlo over the
disposition uncertainty, then aggregate per-endpoint medians and 90% intervals.
**Why:** real animals vary; a population gives a distribution, not a false single
number.

### S2-T4 — The exposure endpoint  *(2e11ddf)*
**What:** the `POST /predict/pbpk/exposure` API that runs the whole pipeline
(structure → ADMET/IVIVE → disposition → cohort ODE) and returns the exposure
metrics. **Why:** makes the engine callable by the product.

### S2-T5 — The validation gate  *(this work — see §5)*
The hard gate: prove the engine's predictions match measured rat PK. Detailed below.

### S2-T6 — Retirement / rewire  *(NOT started — gated on S2-T5)*
Delete the old duplicate animal-sim paths and point the frontend at the new
endpoint. **Deliberately not done:** the spec forbids it until S2-T5 passes cleanly.

---

## 5. S2-T5 in detail — the validation gate (what this pass did)

The gate is an *exam* for the engine: run known drugs through it, compare predicted
clearance to **measured rat clearance**, and it passes only if predictions are
within the field-standard **2–3× fold-error** band **and** the uncertainty is
**calibrated** (a 90% interval contains the truth ~90% of the time).

When we started, the harness *ran* and printed numbers — but the numbers were
meaningless. Making it honest is what did the work. In order:

1. **Fixed the harness itself.**
   - Unit bugs: it compared predictions and measurements in **different units**
     (a fake "2978× failure" that was really ~1.3×). Now converts to matched units.
   - It secretly fed **one identical set of inputs to every drug** — so it wasn't
     testing per-drug behaviour. Now each drug drives the model with its own inputs;
     if a required input is missing, the drug is **skipped, never back-filled**.
   - Leakage controls: strip salts to parent structure, drop duplicates, split by
     chemical scaffold with a no-overlap guarantee.
   - Added 13 unit tests for the scoring and split logic.

2. **Removed fabricated data.** The original 5-row benchmark was hand-typed numbers
   that didn't satisfy their own arithmetic (AUC ≠ Dose/CL). Quarantined it; the
   harness now refuses to run on an empty benchmark rather than invent numbers.

3. **Restored the ML ADMET model.** One of five ensemble weights (`model_4.pt`) was
   a broken git-LFS pointer, so the whole ADMET model silently failed to load. Pulled
   and SHA-256-verified it.

4. **Learned the human ML can't predict *rat* clearance.** The ADMET models are
   human-trained; their predicted CLint is **statistically uncorrelated with rat
   clearance** (Spearman 0.21, p=0.48). So "structure → ML → clearance" fails the rat
   gate — not a bug, an inherent species/model limitation.

5. **Caught a circular dataset.** An uploaded "measured" sheet's CLint was
   algebraically **back-calculated from the observed clearance** — feeding it back
   reproduces the answer trivially (a fake 100% pass). Discarded it.

6. **Verified and used real CLint data.** A second dataset (rat hepatocyte CLint,
   primary source **Naritomi 2003, PMID 12695346**) is genuinely independent — it
   predicts the observed clearances at ~2× (not 1.0×), i.e. real signal. Built a
   cited, non-circular benchmark from it (observed CL from **Sawada 1985,
   PMID 3938813** and Naritomi).

7. **Found and fixed three real engine bugs** the honest gate surfaced:
   - **Hepatic clearance was flow-limited twice** and a per-kg value was treated as
     absolute (mis-scaling by body weight). The two errors partly cancelled, hiding a
     ~2× under-prediction of high-clearance drugs. Fix: feed the ODE the *intrinsic*
     clearance and let perfusion flow-limit **once**. (Kernel regression test added.)
   - **Renal clearance never fired** — the code matched compartment `"kidneys"` but
     the compartment is `"kidney"`. Dead code; now enabled.
   - **AUC integration grid too coarse** — a uniform time grid over-estimated AUC on
     the IV-bolus spike. Densified it.
   > The hepatic fix also corrects the **live `/predict/pbpk/exposure` endpoint**,
   > which shares the same function — not just the gate.

8. **Calibrated the uncertainty.** The cohort's Monte-Carlo interval only captures
   inter-animal physiology (too narrow → ~0% coverage). Added a **leave-one-out
   lognormal predictive interval** (multiplicative PK error, small-sample t formula)
   that reports genuine coverage plus the interval width as a fold factor.

9. **Firmed citations.** Every benchmark value now carries a verified PMID.

### The result (rat clearance, measured-CLint benchmark, in-domain n=8)

| Metric | Value | Bar |
|---|---|---|
| Median fold error | **1.71×** | within 2–3× ✅ |
| Within 3× | **100%** (chance 56%) | ✅ beats control |
| Calibrated 90% coverage | **87.5%** (±4.4-fold) | ≈ nominal ✅ |

Both gate criteria are met. It is a **strong provisional pass**: the dataset is
small (8 in-domain drugs) and the CLint provenance, while now traced to Naritomi
2003, should be expanded before the final S2-T6 freeze.

---

## 6. Where it stands & what's next

- ✅ Stages 1 and 2 (T1–T4) built; the exposure engine runs end-to-end.
- ✅ S2-T5 validation gate: correct, tested, and **passing on rat clearance**.
- ✅ Three real engine bugs fixed (one improves production predictions).
- ⏳ **Before the final freeze / S2-T6:** grow the measured-CLint set beyond 8 drugs
  and add observed rat **Vss** — both are *data* tasks. The scarce values
  (rat hepatocyte CLint, fu, Vss) live in paywalled tables (Sawada 1985,
  Naritomi 2003); three independent research passes returned observed clearance but
  **no in-vitro CLint**, confirming it's a source-access problem, not a search
  problem. A person reading those two tables (~15–30 numbers) unlocks it.
- ⏳ **S2-T6 (retirement):** delete the old duplicate animal-sim paths and repoint the
  frontend — only after the gate is finalised.

**Note for reviewers:** AUC is deliberately *not* a separate validation endpoint —
for an IV bolus, AUC = Dose/CL exactly, so it would just restate the CL gate.

---

## 7. Glossary

- **PBPK** — Physiologically-Based PharmacoKinetics: simulate the drug in each organ
  using real blood flows and volumes.
- **IVIVE** — In-Vitro→In-Vivo Extrapolation: scale a lab-dish clearance up to the
  whole animal.
- **CLint** — intrinsic clearance: how fast liver enzymes metabolise a drug,
  independent of blood flow. **fu** — fraction of drug unbound (free) in plasma.
- **Well-stirred model** — the standard equation combining CLint, fu, and liver blood
  flow into hepatic clearance.
- **Kp** — tissue:plasma partition coefficient: how strongly a tissue concentrates
  the drug; sets the volume of distribution.
- **CL / AUC / Cmax / Vss** — clearance / total exposure / peak concentration /
  steady-state volume of distribution: the standard exposure metrics.
- **Fold-error** — max(pred/obs, obs/pred); the field trusts predictions within 2–3×.
- **Coverage** — how often a stated confidence interval actually contains the truth.
- **Scaffold split / leakage** — testing on molecules structurally unlike the training
  set, so the score isn't inflated by near-duplicates.
- **Applicability domain** — the chemical space the model is validated on; e.g.
  transporter substrates (OATP) are *outside* this metabolic-clearance model.
- **Permutation control** — shuffle predictions against truth; a real model must beat
  this random baseline.
