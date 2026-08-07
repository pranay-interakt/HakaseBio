# S2-T5 — PBPK exposure validation gate: result

**CURRENT (HEAD, n=10 in-domain measured rat CLint) — PASSES both gate criteria.**
Reproduce: `run_pbpk_validation.py --species rat --benchmark
datasets/rat_measured_clint_indomain.csv --test-fraction 1.0`
- Clearance: median **1.38×**, **100% within 3×** (control 76%), **90% within 2×**
  (control 49%) — clearly beats the permutation control.
- Calibrated 90% coverage: **90.0%** at nominal 90% (**±2.52-fold**), leave-one-out
  lognormal predictive interval.
- Vss (rat, Sawada 1985, n=9): median **1.43×**, 88.9% within 3×, calibrated 88.9%
  at ±2.78-fold.

Provenance is now primary-cited (Naritomi 2003 / Ito & Houston 2004); the measured
reference set has grown to 21 rat drugs. Still not a final freeze — the Vss set (n=9)
is small, and the httk 67-chemical rat set is the suggested next data lever.

<details><summary>Earlier snapshot (n=8, median 1.71×) — retained for history</summary>

- Point accuracy: median 1.71×, 100% within 3× (chance 56%), 62% within 2×.
- Calibrated coverage: 87.5% at nominal 90% (±4.4-fold).
- Caveat at the time: n = 8 in-domain drugs (9 with the out-of-domain OATP substrate);
  the CLint source (`data/rat hepatocyte CLint.csv`) still lacked primary citations.
  Superseded by the primary-cited measured-reference set above.

</details>

Update 2026-07-30 (later): two engine bugs found by the gate were fixed and the
gate re-run on measured rat CLint. History below is retained for context.

## Measured-input gate (user rat CLint + Sawada 1985 observed CL)

| set | n | median fold | within 2× (chance) | within 3× (chance) | coverage |
|---|---|---|---|---|---|
| in-domain (excl. troglitazone) | 8 | **1.71×** | 62% | **100%** (52%) | — |
| all | 9 | 1.89× | 56% (33%) | 89% (52%) | 22% |

High-clearance drugs are now correct (propranolol 45→35, diltiazem 40→44,
zidovudine 35→40). Troglitazone (OATP substrate) is out of the metabolic-clearance
domain. Midazolam/diazepam misses are CLint-vs-CL source discrepancies in the
input data, not engine error.

**Engine fixes applied (kernel `model.py` `clearance_law`):**
- Hepatic clearance was flow-limited twice and a per-kg value treated as absolute.
  Now recovers the intrinsic clearance `cl_hepatic/(BPR·(1−E_H))` and flow-limits
  once via ODE perfusion. Kernel regression test added.
- Renal clearance never fired (compartment `"kidney"` vs code `"kidneys"`); enabled
  with correct per-kg→absolute, plasma-referenced scaling.
- Harness AUC grid densified over the first 2 h (coarse uniform grid over-estimated
  AUC on the IV bolus spike → under-estimated CL for fast drugs).

**Remaining:** coverage (22%) — predictive intervals capture only physiological
variability, not ADMET/data uncertainty. Widen them (propagate input uncertainty)
for the final gate pass.

---

## (Historical) Path B — structure→ML→IVIVE, before the engine fixes

**Verdict: RED. The engine did not pass the rat clearance gate with ML-only inputs.**

Date: 2026-07-30 · Species: rat · Endpoint scored: systemic clearance (CL, mL/min/kg)

## How the gate is run (non-circular)

- Inputs (hepatocyte CLint, fu) are **predicted from chemical structure** by the ML
  ADMET ensemble — independent of the observed in-vivo CL. (This required restoring
  `admet_regression/model_4.pt`, which was a broken git-LFS pointer; pulled and
  SHA256-verified.)
- Benchmark: 40 rat drugs (`datasets/rat_pk_benchmark.csv`), observed CL as the
  target. An earlier upload had `CLint` **algebraically back-calculated from the
  observed CL** (`CLint = Qh·CLH/(fu·(Qh−CLH))`, matched 37/40 rows exactly) — that
  is circular and was discarded; ML predicts CLint instead.
- Leakage controls: salts stripped to parent, exact-parent dedup, scaffold split
  with a no-overlap assertion.
- Random baseline: 100-permutation control the model must beat.

## Results

| Run | n | median fold | within 2× (chance) | within 3× (chance) | coverage |
|---|---|---|---|---|---|
| Rat-confirmed only (Sawada 1985) | 14 | **3.94×** | 28.6% (25.9%) | 50.0% (45.7%) | 7.1% |
| Mixed set (species-unverified rows included) | 15 | 1.83× | 66.7% (51.1%) | 73.3% (66.6%) | 6.7% |

The mixed-set number is **optimistically biased**: its species-unverified rows
happen to sit in the mid-CL range where the model's compressed output lands. The
**rat-confirmed number is the honest one.**

## Why it fails

1. **No discriminating power (compression).** On clean rat data the predictions
   collapse into ~9.5–21.4 mL/min/kg across a **90× range** of true values
   (0.5–45). The model predicts nearly the same CL for warfarin (obs 0.5) as for
   propranolol (obs 45). Median fold 3.94× is outside the 2–3× band, and within-2×
   (28.6%) barely beats random pairing (25.9%).

2. **Overconfident uncertainty (coverage 7% vs nominal 90%).** The 90% intervals
   are ~±11% wide but the real error is ~4×, so the truth falls outside them ~93%
   of the time. The bands capture inter-animal physiology but not the dominant
   ADMET/IVIVE prediction error.

## Likely root cause

The only CLint/fu source is a **human-trained** ADMET model (TDC
`Clearance_Hepatocyte_AZ`, `PPBR_AZ`), scaled with **rat** physiology. Human
hepatocyte-CLint predictions are compressed toward their mean and are the wrong
species, so the rat CL predictions are near-constant. Fixing this needs a
rat-relevant CLint source and/or recalibration — an engine/ADMET task, not a
harness one.

## What is trustworthy now

The **harness** is correct, tested (13 unit tests), and non-circular — the four
CI checks (ruff, black, boundaries, pytest) are green. It is doing its job: it
caught that the engine is not ready to freeze. Reproduce:

```
python modalities/small-molecule/validation/run_pbpk_validation.py --species rat
# rat-confirmed only:
python .../run_pbpk_validation.py --species rat \
    --benchmark <rat_only.csv> --test-fraction 1.0
python .../plot_pbpk_validation.py <report.json>
```

## Next steps (engine, not harness)

1. Give the IVIVE core a **rat-relevant CLint** (measured rat hepatocyte CLint, or
   a rat-calibrated model) instead of the human ADMET value.
2. Investigate the compression (is the ML CLint regressed to the mean? does the
   well-stirred term saturate?).
3. Fix uncertainty propagation so predicted intervals include ADMET prediction
   error (see the `pbpk-ivive-uncertainty` work) → calibrated coverage.
4. Re-run this gate. Only a rat median fold within 2–3× **and** calibrated
   coverage clears S2-T5.
