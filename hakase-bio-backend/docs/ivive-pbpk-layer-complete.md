# The IVIVE / PBPK Layer — Complete Technical Documentation

*Small-molecule pharmacokinetics layer, S1-T1 → present (branch `feat/pbpk-s2-t5`).*
*Status: code green (ruff/black/boundaries pass, 235 passed / 2 skipped). Branch not yet pushed to `origin`.*

---

## 0. Honest scientific-correctness statement (read this first)

This layer is **validated as correct within a defined applicability domain**, not
"universally correct." Precisely:

- The **ODE engine and the validation harness are correct** — the harness is
  non-circular (inputs derived independently of the observed endpoint), leakage-controlled
  (salt-stripped, exact-parent dedup, scaffold split with a no-overlap assertion),
  and benchmarked against a permutation control.
- The **predictions are trustworthy for in-domain compounds** whose CLint/fu are
  **measured, supplied as overrides, or covered by the curated measured-reference set**.

Three caveats remain and are stated wherever they apply below. (A fourth — the
base-Kp logP fix being harness-only — was **closed**: the reliability-gated logP
resolver is now wired into the live `/predict/pbpk/exposure` endpoint; see §2 and §5.)

1. **Rat ML CLint is uninformative.** The only structure→CLint model is human-trained
   (TDC `Clearance_Hepatocyte_AZ`). For rat it compresses toward the mean. *Mitigated*
   by a curated measured-reference tier (21 rat drugs, primary-cited) and a
   low-confidence flag when non-human PK falls back to human ML — **not eliminated**.
2. **Vss gate is small (n = 9).** Directionally validated; not yet a large-n freeze.
3. **Provenance/LFS debt.** 9 of 10 `.pt` model files are committed as raw binaries
   rather than LFS pointers (needs a coordinated `git lfs migrate`).

> **One-line verdict:** the machinery is scientifically defensible and green; the
> numbers are defensible for in-domain compounds with real inputs; the open items
> above are disclosure items, not silent errors.

---

## 1. The platform *before* S1-T1 — baseline and its downsides

Before this work there was **no dedicated small-molecule PK/PBPK layer**. Two things existed:

### 1.1 A human-trained ML ADMET ensemble
TDC-derived regressors — hepatocyte clearance (`Clearance_Hepatocyte_AZ`), plasma
protein binding (`PPBR_AZ`), steady-state volume (VDss), half-life. These produce a
**single point number per property, for "human," with no interval and no species awareness.**

### 1.2 `animal_sim.py` — a preclinical NOAEL / FIH-dose / tox engine
A large (~1,300-line) engine that returns NOAEL, first-in-human dose, safety margin,
toxicity flags, and study-group design. Its internal PK used:
- a **crude, duplicated perfusion ODE** (`pbpk_odes`), separate from any validated core;
- **Poulin–Theil Kp** (an older, less mechanistic tissue-partition method);
- **ML-predicted CLint** fed in directly.

### 1.3 Downsides of that baseline

| Problem | Consequence |
|---|---|
| **Human ML numbers used as if species-agnostic** | Rat/dog predictions were silently wrong; CLint compressed to ~9.5–21 mL/min/kg across a 90× true range (warfarin ≈ propranolol). |
| **No uncertainty / no calibration** | Point estimates only. When intervals were faked they were ~±11% wide while the real error was ~4× → coverage ~7% at nominal 90% (overconfident). |
| **No provenance** | No way to tell a measured value from an ML guess from an assumption. |
| **No validation gate** | Nothing benchmarked the engine against observed in-vivo data; "looks reasonable" was the only bar. |
| **Duplicated, unvalidated PK physics** | The animal engine's ODE + Poulin–Theil Kp were a second, cruder copy of PK physics with no test coverage. |
| **Collapsed compartment model (latent)** | The physiology store defined organs for liver/kidney/heart only; the "13-compartment" model effectively ran ~4 compartments → Vss collapsed to ≈ body weight regardless of Kp. |

In short: the platform could emit PK-shaped numbers, but they were **single-species,
uncalibrated, unprovenanced, and unvalidated.**

---

## 2. What the work built — S1-T1 → present

Two stages: **Stage 1** built the IVIVE front-end (structure → disposition parameters);
**Stage 2** built the PBPK ODE, the exposure endpoint, and the validation + hardening pass.

**Scale:** ~40k insertions across 76 files; ~20 new engine modules.

### Stage 1 — the IVIVE foundation

| Task | Deliverable | Why it matters |
|---|---|---|
| **S1-T1** | `DispositionParameters` contract (`platform/kernel/.../pbpk/contract.py`) | A typed, modality-agnostic handoff. Every field is a `Quantity` carrying `{value, ci_low, ci_high, provenance, source, units}` — **no unlabelled numbers**. |
| **S1-T2 / T2b** | Species/strain physiology store + allometric extrapolation | Organ volumes/flows per species; any species resolvable by allometry. |
| **S1-T3** | Rodgers & Rowland mechanistic tissue:plasma Kp | Replaces Poulin–Theil with the current-standard mechanistic partition model. |
| **S1-T3a** | pKa predictor (strict opt-in fallback) | Ionisation drives Kp; acids/bases partition very differently. |
| **S1-T4** | Uncertainty helpers — residuals + applicability domain | Out-of-domain compounds are **refused**, not confidently mis-predicted. |
| **S1-T5** | Species-aware IVIVE clearance + renal CL + Monte-Carlo intervals | Clearance computed in the correct species frame, with propagated intervals. |
| **S1-T6** | Disposition assembler + Kp-derived Vss cross-check | Fills the whole contract; sanity-gates Vss. |

### Stage 2 — the PBPK engine, endpoint, and validation

| Task | Deliverable |
|---|---|
| **S2-T1** | General multi-compartment perfusion-limited ODE (`kernel/pbpk/model.py`). |
| **S2-T2** | Absorption models (IV bolus/infusion, oral, SC depot, repeat-dose) + BCS/formulation logic. |
| **S2-T3** | Virtual-cohort sampler + Monte-Carlo (population PK). |
| **S2-T4** | `/predict/pbpk/exposure` service endpoint. |
| **S2-T5** | **Validation gate + engine fixes + Vss endpoint + measured-reference tier + logP resolver + hepatocellularity reconciliation** (the hardening pass — details below). |

### The S2-T5 hardening pass — what actually got fixed

- **A real validation gate** against observed rat in-vivo data (non-circular, leakage-controlled, permutation-baselined).
- **Three engine bugs the gate exposed:**
  - hepatic clearance was **flow-limited twice** and a per-kg value treated as absolute → now recovers intrinsic CL and flow-limits once via ODE perfusion;
  - **renal clearance never fired** (`"kidney"` vs `"kidneys"` key mismatch) → enabled with correct plasma-referenced per-kg scaling;
  - the physiology store ran **only ~4 of 13 compartments** (Vss collapse) → populated the 7 missing organs from Brown 1997.
- **`vss = V[comp]` mislabel fixed** → a true steady-state Vss (`Σ Vtissue·Kp + Vblood·BPR`, plasma-referenced).
- **Measured-reference tier** (`measured_clint_reference.csv`, **21 rat drugs**, verified to Naritomi 2003 & Ito 2004 PDFs) — production consults measured, primary-cited CLint/fu/BPR **before** ML fallback. Grown from 10 → 21 by extracting the remaining Ito & Houston 2004 Table I rat hepatocyte rows (incl. measured rat CLint for midazolam/alprazolam/triazolam — the fused-azole bases the logP resolver targets).
- **Low-confidence flag** when non-human PK falls back to human-trained ML.
- **Transporter-substrate guard** on metabolic clearance (e.g. OATP substrates flagged out-of-domain).
- **Reliability-gated logP resolver** for lipophilic fused-azole bases — **now wired into
  the live `/predict/pbpk/exposure` endpoint** (`service/.../main.py`, Kp path). Caps Crippen
  downward onto the logD-anchored reconstruction only for weakly-ionised bases
  (midazolam 4.32→3.20, alprazolam 3.58→2.32, triazolam 4.23→2.75); strong bases
  (propranolol log10 R=3.10, chlorpromazine) and the offline-ML case stay on Crippen, so the
  Vss gate is unchanged. The formulation/absorption logP is deliberately left on Crippen.
- **Rat hepatocellularity reconciled** to the cited 120×10⁶ cells/g.
- **phenylbutazone pKa outlier** root-caused and fixed (acidic 1,3-dicarbonyl C–H mis-classified as a base) → Vss 7.02 → 0.325 (obs 0.236).

---

## 3. The ML models behind the numbers — what we trained, vendored, and built

**Blunt correction up front, because it matters for defensibility: no bespoke ML model was
trained for the IVIVE/PBPK layer.** The predictive ML this layer consumes is a *vendored
open-source model*. The scientific contribution of this work is the mechanistic modelling,
the measured-reference data, and the guards around that model — **not new trained weights.**

### 3.1 The one predictive ML dependency — ADMET-AI (Chemprop), vendored offline

| Property | Value |
|---|---|
| What it is | **ADMET-AI** — a Chemprop **directed message-passing neural network (D-MPNN)** over the molecular graph + RDKit descriptors. |
| Origin / licence | Open-source, **MIT-licensed (© 2026 Kyle Swanson)**; vendored in-repo as `hakase_smallmol/vendor/hakase_admet` (v2.0.1) so it runs **fully offline** — no external API. |
| **Trained by whom** | The **ADMET-AI authors — not this team** — on **Therapeutics Data Commons (TDC)** ADMET datasets, with a DrugBank reference set. We ship their weights; we did not fit them. |
| Structure | Two 5-fold ensembles: `admet_regression/model_0..4.pt` (continuous endpoints) + `admet_classification/model_0..4.pt` (binary endpoints). |
| Coverage / loading | 41 ADMET endpoints + 60 physchem descriptors; lazy singleton (~30 s first call), degrades to an empty envelope if weights are missing. |

The five endpoints this layer actually reads:

| Endpoint | Feeds | TDC dataset | Training-data species |
|---|---|---|---|
| `Clearance_Hepatocyte_AZ` | `clint_hep_ul_min_1e6` | AstraZeneca hepatocyte clearance | **human** |
| `PPBR_AZ` | `fu_plasma` (= 1 − bound%) | AstraZeneca plasma protein binding | **human** |
| `VDss_Lombardo` | `vdss_l_per_kg` | Lombardo steady-state volume | **human** |
| `Half_Life_Obach` | `half_life_obach_h` | Obach half-life | **human** |
| `Lipophilicity_AstraZeneca` | logD₇.₄ for the logP resolver | AstraZeneca logD | assay value |

**This is why "human-trained" is flagged everywhere.** Every endpoint above is trained on
human data; using it in a *rat* frame is the single biggest limitation of the layer
(caveat #1). That is precisely why the measured-reference tier and the low-confidence flag
below exist.

### 3.2 What this team actually built on the ML side (none of it is a trained model)

- **Offline vendoring + weight repair.** Replaced the external `admet_ai` PyPI dependency
  (which silently fell through to empty envelopes) with the local `hakase_admet` engine, and
  repaired the broken git-LFS pointer for `admet_regression/model_4.pt` so the regression
  ensemble loads at all.
- **Measured-reference tier** (`measured_reference.py`) — a human-curated lookup table
  (Naritomi 2003 / Ito 2004) that **outranks** the ML for the 21 curated rat drugs. A table, not a model.
- **Reliability-gated logP resolver** — *uses* the ML `Lipophilicity_AstraZeneca` logD, but only
  to cap Crippen downward for weak bases. It learns nothing.
- **Applicability-domain gate** (`applicability_domain.py`) — a **Tanimoto nearest-neighbour**
  similarity score (Morgan fingerprints vs the DILI + CardioTox reference sets; Jaworska 2005 /
  OECD thresholds), **not** a trained classifier. Drives the in/edge/out verdict.
- **Low-confidence flag** — raised whenever non-human PK falls back to the human-trained ML CLint/fu.
- **The mechanistic, non-ML core** — pKa, Rodgers & Rowland Kp, the well-stirred liver model,
  and the PBPK ODE are **physics and chemistry, calibrated against measured data — not machine
  learning.**

> **Bottom line:** the layer's "intelligence" = 1 vendored open-source ML model + several
> mechanistic models + human-curated measured data. We trained no new weights; the contribution
> is making a human-trained model produce **species-honest, provenance-tagged, validated** PK.

### 3.3 Why not just predict rat CLint? (open-model survey, 2026-07)

The right way to get rat numbers is **measured rat data, not a rat value inferred from a
human model.** We surveyed the open-source landscape for a deployable rat-CLint predictor
before choosing to grow the measured table:

| Candidate | Rat-specific? | Deployable open weights? | Verdict |
|---|---|---|---|
| **ADMET-AI** (what we vendor) | No — `Clearance_Hepatocyte_AZ` is pooled human&rat with **no species switch** at inference | yes | Emits a species-agnostic blend; can't be steered to rat. |
| **OPERA** (NIEHS/EPA QSAR) | CLint model is **human** | yes | Not rat. |
| **httk** (EPA HTTK) | Uses *measured* in-vitro Clint + rat physiology (IVIVE, like us); own human→rat extrapolation is **RMSLE ≈ 0.7 (~5-fold)** | R pkg | Confirms human→rat prediction is poor. **But ships 67 chemicals of measured rat in-vitro Clint+fub** — a *data* asset, not a model. |
| **Mol. Pharm. 2022/2023 rat-CLint ML** | Yes (best ~2–3× fold) | Academic method papers, **no released weights** | Not a drop-in, and not clearly better than a measured lookup. |

**Conclusion: there is no open, deployable, genuinely-rat CLint model to adopt.** So we grew
the measured-reference table instead. **Correction worth recording:** *Riley, McGinnity &
Austin 2005 (DMD 33:1304)* — previously earmarked as a rat source — is on inspection a
**human** clearance paper (all tables human hepatocyte/microsome; its selling point is
predicting human CL *without* animal data). It contributes **no** rat rows. The real rat
sources are **Naritomi 2003** (rat set now exhausted, ~5 public compounds) and **Ito &
Houston 2004 Table I** (rat hepatocyte CLint — the source of the 10→21 growth).

> **Suggested next data source — the httk 67-chemical measured rat set.** US EPA's `httk`
> package ships 67 chemicals with *measured* rat in-vitro Clint + fub (open, primary-cited).
> Folding these in is the single biggest lever to grow the reference table past 21 and cut
> the layer's rat reliance on human-trained ML further. It's a one-time data extraction, not
> a model — see §9 item 3 for the concrete how.

---

## 4. Input parameters

### 4.1 Chemistry / disposition inputs (`predict_pk_ivive`)

**Where each number comes from — the resolution ladder.** Every disposition quantity is
resolved by the same four-tier precedence (`pk_ivive.py`), highest first. The tier that
wins sets the `provenance` label on the output:

| Tier | Source | Provenance | Where in code / data |
|---|---|---|---|
| 1 | **Caller `overrides`** — a value you supply on the request | `measured` | `overrides={…}` on the endpoint / `predict_pk_ivive` |
| 2 | **Curated measured reference** — species-matched, primary-cited | `measured` (cited) | `pk_ivive/resources/measured_clint_reference.csv` via `measured_reference.py` |
| 3 | **`ml_inputs`** — pre-computed ML values passed in | `ml` | `ml_inputs={…}` argument |
| 4 | **Server ML** — the Hakase ADMET ensemble, fetched here | `ml` | `admet.admet_ml.predict_admet_ml(smiles)` |
| — | **Assumed default** — when nothing above supplies it | `assumed` (flagged) | module constants |

Tier 2 (the measured reference) is rat CLint/fu/BPR digitised from **Naritomi 2003
(PMID 12695346)** — Table 3 hepatocyte CLint ÷ 4.8 hepatocellularity, Table 2 for fu & B:P —
and **Ito & Houston 2004 (PMID 15180335)**; each row carries its own `source` + `reference_pmid`.

Per-parameter origin:

| Parameter | Units | Role | Source / origin (by winning tier) |
|---|---|---|---|
| `smiles` | — | Molecular structure | **Caller** (API request). Salt-stripped to parent internally. |
| `clint_hep_ul_min_1e6` | µL/min/10⁶ cells | Intrinsic hepatic clearance | **The pivotal input.** override → measured-ref (Naritomi/Ito) → `ml_inputs` → **ML `Clearance_Hepatocyte_AZ`** (Hakase ADMET, TDC AstraZeneca hepatocyte-clearance assay, **human-trained → unreliable for rat**; caveat #1). |
| `fu_plasma` | fraction | Fraction unbound in plasma | Same ladder; ML source = **`PPBR_AZ`** (TDC AstraZeneca plasma-protein-binding), taken as `fu = 1 − bound%`. |
| `blood_plasma_ratio` (BPR) | ratio | Blood:plasma partitioning | Caller override or measured-ref column → `measured`; otherwise `DEFAULT_BLOOD_PLASMA_RATIO = 1.0` → **`assumed`** (flagged). |
| `vdss_l_per_kg` | L/kg | Steady-state volume anchor | Caller override → `measured`; else **ML `VDss_Lombardo`** (TDC Lombardo, human). Used as an input anchor, not the scored output. |
| `half_life_obach_h` | h | Half-life cross-check | Caller override; else **ML `Half_Life_Obach`** (TDC Obach, human). Independent cross-check only. |
| `species`, `strain`, `body_weight_kg` | — | Physiological context | **Caller**; selects the **physiology-store** row (organ volumes/flows/hematocrit; *Davies & Morris 1993 / Brown 1997*). |
| `dose_mg` | mg | Dose (optional at IVIVE stage) | **Caller**. |
| `montecarlo`, `mc_samples`, `mc_seed`, `mc_coverage` | — | Uncertainty controls | **Caller / defaults**; MC intervals at 90% coverage. |

*CLint → systemic CL* is then computed by the **well-stirred liver model** (Rowland/Wilkinson
1973; Houston IVIVE; Obach 1999, PMID in `pk_ivive.py` header), scaled by the physiology-store
hepatic blood flow for the requested species.

### 4.2 Kp (tissue-partition) inputs (`compute_kp`, Rodgers & Rowland)

| Parameter | Role | Source / origin |
|---|---|---|
| `logp` | Neutral octanol:water logP | **RDKit Crippen** (`Descriptors.MolLogP`), then the **reliability-gated resolver** caps it downward onto the logD-anchored value for weak fused-azole bases (logD from **ML `Lipophilicity_AstraZeneca`**; §2). |
| `pka_result` | Per-site pKa + ionisation | **pKa predictor** (`pka.py`), backend order QupKake → pkasolver → heuristic. ⚠️ In this repo's venv the QM/ML backends are uninstallable, so the **RDKit SMARTS heuristic actually runs** (coarse, and flagged as such). |
| `fu_plasma`, `blood_plasma_ratio` | Binding terms | From the §4.1 IVIVE resolution (same provenance). |
| `hematocrit` | Blood cell fraction | `DEFAULT_HEMATOCRIT = 0.45` (*R&R 2005; Brown 1997*). |
| `adipose_vegetable_oil` | Adipose lipid model flag | Module default (`True`). |
| tissue-composition tables | Per-organ neutral-lipid / phospholipid / water fractions | **Kernel tissue-composition store** (S1-T2), *Rodgers, Leahy & Rowland 2005 (bases) / Rodgers & Rowland 2006 (acids/neutrals)*. |

Output: per-organ Kp (tissue:plasma) for the full compartment set.

### 4.3 Exposure-endpoint request (`POST /predict/pbpk/exposure`)

```jsonc
{
  "smiles": "…",
  "animal":  { "species": "rat", "strain": null, "sex": null, "age": null, "body_weight": null },
  "study":   { "route": "IV|ORAL|SC", "dose": 1.0, "frequency": "q24h", "duration": 24.0 },
  "formulation": "…",
  "cohort_size": 50,
  "overrides": { "clint_hep_ul_min_1e6": 192.6, "fu_plasma": 0.14 }   // optional MEASURED values
}
```

**Origin:** every field here comes from the **API caller** (the frontend / client). `smiles`,
`animal`, `study`, `formulation`, and `cohort_size` are user/study inputs; `overrides` is the
hook into **tier 1** of the §4.1 ladder — anything supplied there is treated as `measured` and
outranks the reference set and ML. Everything not overridden is resolved down the ladder (tiers
2→4) as described above.

---

## 5. Calibrated outputs — and why they matter

Every numeric output is a `Quantity` = `{value, ci_low, ci_high, provenance, source, units}`.
The interval and the provenance label are as important as the value.

### 5.1 `DispositionParameters` (the S1-T6 contract)

| Output | Units | Why it matters |
|---|---|---|
| `fu_plasma`, `fu_blood` | fraction | Free-drug fraction — only free drug clears and distributes. |
| `blood_plasma_ratio` | ratio | Reconciles plasma-based binding with blood-flow-based clearance. |
| `cl_hepatic`, `cl_renal`, `cl_total` | mL/min/kg | The clearance split — sets systemic exposure (AUC ∝ dose/CL). |
| `extraction_ratio` | fraction | Hepatic extraction — governs first-pass loss and flow- vs enzyme-limitation. |
| `hepatic_first_pass` | fraction | Oral bioavailability driver. |
| `kp[organ]` | ratio | Per-organ tissue:plasma partition → distribution and Vss. |
| `vdss` | L/kg | Steady-state volume → half-life and dosing interval. |
| `applicability_domain` | in/edge/out | Whether to trust the number at all. |

### 5.2 Cohort exposure output (`/predict/pbpk/exposure`)

Concentration-time profiles per virtual animal, plus population summaries: **Cmax, AUC,
systemic CL, steady-state Vss**, each with Monte-Carlo intervals; formulation impact
(F_abs); applicability-domain verdict.

### 5.3 Validation gates (current)

| Gate | n | Median fold-error | Within 3× | Coverage @ 90% |
|---|---|---|---|---|
| **Clearance** (rat, measured CLint) | 10 | **1.38×** | 100% | 90% (±2.52-fold) |
| **Vss** (rat, Sawada 1985) | 9 | **1.43×** | 88.9% | ±2.78-fold |

*Why "calibrated" matters:* the baseline's intervals captured only physiological
variability (coverage ~7%). The current intervals are built to capture prediction error
too, so a stated 90% interval actually contains the truth ~90% of the time — the
difference between a decorative error bar and one a scientist can act on.

---

## 6. Connecting to the animal layer

### 6.1 Intended architecture (the contract is the plug)

```
 SMILES ──▶ IVIVE front-end ──▶ DispositionParameters ──▶ PBPK ODE ──▶ exposure (Cmax/AUC/CL/Vss)
 (small-molecule modality)        (kernel contract)         (kernel)          │
                                                                              ▼
                                              animal layer (animal_sim.py): NOAEL / FIH dose /
                                              safety margin / tox flags / study-group design
```

`DispositionParameters` is deliberately **modality-agnostic** (common core + an empty
extension slot for small molecules; mAbs would add FcRn/TMDD terms). The PBPK ODE
consumes it as its single source of truth. The animal layer consumes the ODE's exposure
output to derive preclinical/FIH quantities.

### 6.2 Current reality (be precise here)

- `POST /predict/pbpk/exposure` (the validated path) is **live** and uses the kernel
  engine, measured-reference tier, and calibrated intervals.
- `POST /predict/animal-cohort` (the NOAEL/FIH engine, `animal_sim.py`) is **still on its
  own legacy PK internals** with ML-predicted CLint. The S2-T6 refactor that would have
  routed it through the validated kernel engine **was implemented and then reverted**
  (`f437576` reverts `f114137`) after clarifying that the animal-cohort layer was out of
  scope for this IVIVE pass. **Do not modify `animal_sim.py` without an explicit S2-T6 go-ahead.**

### 6.3 The remaining seam (future S2-T6, backend-only)

Retire the animal engine's duplicated perfusion ODE + Poulin–Theil Kp and route its
§7 animal / §8 human PK through `run_virtual_cohort` (mechanistic RR Kp, IVIVE CL),
keeping the `/predict/animal-cohort` contract and the NOAEL/FIH wrapper intact so the
NOAEL/FIH-dose science is preserved while the PK physics becomes the validated one.

---

## 7. Frontend integration

### 7.1 Where the frontend stands today
- The IVIVE workflow page exists (`apps/hakase-ai/src/pages/IVIVE.tsx`) and gates the
  transition into animal-cohort design.
- The frontend currently calls the **legacy** endpoint:
  `aiService.ts:1501` → `fetch(\`${API_BASE}/animal-cohort\`, …)`.
- It does **not yet** call `/predict/pbpk/exposure` — the validated exposure path is
  backend-only from the UI's perspective.

### 7.2 Integration steps

1. **Add an aiService client** for the exposure endpoint:
   ```ts
   export async function predictPbpkExposure(req: PbpkExposureRequest): Promise<PbpkExposureResult> {
     const res = await fetch(`${API_BASE}/pbpk/exposure`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(req),
     });
     if (!res.ok) throw await res.json();
     return res.json();
   }
   ```
2. **Type the request/response** to mirror §4.3 and §5 (surface every `Quantity`'s
   `provenance`, `source`, and interval — the UI must show *measured* vs *ml* vs *assumed*).
3. **Render provenance + intervals**, not bare numbers. A CLint labelled
   `measured (Naritomi 2003, PMID:12695346)` should read differently from an ML fallback;
   an `applicability_domain = out` verdict should block downstream steps (the IVIVE page
   already models a hard block).
4. **Handle the non-200 contract**: `insufficient-input` (422, lists `missing` inputs +
   `remediation`), `input-error` (400), out-of-domain (returns `available:false` with a
   remediation string) — surface these as actionable UI states, not silent failures.
5. **Sequencing**: the L1 verdict should drive whether the exposure/animal step unlocks
   (the existing `HakaseAI.tsx` L1→L3 sequencing is the hook point).
6. **Migration path for animal-cohort**: keep `aiService.ts:1501` pointed at
   `/animal-cohort` until S2-T6 lands; then either repoint it at `/pbpk/exposure` (+ a
   NOAEL/FIH wrapper) or leave the contract stable while the backend swaps its internals.

---

## 8. Reproduce / verify

```bash
# from hakase-bio-backend, with the repo .venv active
ruff check . && black --check . && python scripts/check_boundaries.py
python -m pytest -q                                   # 235 passed, 2 skipped
python modalities/small-molecule/validation/run_pbpk_validation.py --species rat
```

## 9. Open items before "done" means "shipped"

1. **Push the branch + open a PR** — `feat/pbpk-s2-t5` is local-only (no upstream).
2. ~~Wire the logP resolver into `service/.../main.py`~~ — **DONE** (this pass): the base-Kp
   fix now ships in the live endpoint; 235 tests pass, ruff/black/boundaries green.
3. **SUGGESTED — fold in the httk 67-chemical measured rat set** (biggest open lever for
   the reference table). US EPA's `httk` R package ships **67 chemicals with measured rat
   in-vitro Clint + fub** (open/CC0, primary-cited). This would grow the measured-reference
   tier well past the current 21 and further shrink the layer's reliance on human-trained ML
   for rat. How to land it:
   - Pull the data from the `httk` package (`httk::chem.physical_and_invitro.data`, filter to
     rat rows) or the equivalent EPA CompTox export — **no R runtime needed in prod, it's a
     one-time data extraction to CSV**.
   - Reconcile units to `clint_hep_ul_min_1e6` (httk stores `Human.Clint`/`Rat.Clint` as
     µL/min/10⁶ hepatocytes — already our unit) and map `Rat.Funbound.plasma` → `fu_plasma`.
     De-dup against existing InChIKeys; generate `canonical_smiles`/`inchikey` via RDKit.
     Carry each row's primary `Reference`/DTXSID as `source` + citation.
   - Re-run the clearance gate; it should stay green (reference tier is outranked by benchmark
     overrides) but the *production* rat coverage jumps.
4. **LFS migrate** the 9 raw `.pt` files (coordinated force-push).
5. *(Enhancement)* Grow the Vss gate past n = 9 via Rodgers 2005/2006 Kp reconstruction.
6. *(Separate task)* S2-T6 animal-cohort rewire + frontend repoint — only on explicit go-ahead.
