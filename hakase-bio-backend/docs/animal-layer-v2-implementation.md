# Animal Layer v2 — Implementation Plan

**Status:** design document, not yet implemented
**Scope:** `hakase-bio-backend` L3 (animal cohort) + the L1/L2 → L3 handoff consumed by `hakase-invitro-workspace`
**Date:** 2026-08-06

---

## 0. Decisions this document assumes

| Decision | Choice |
|---|---|
| mrgsolve role | New capabilities only. The Python kernel keeps the linear perfusion-limited PBPK it already does; mrgsolve owns saturable kinetics, TMDD, PK/PD, repeat-dose accumulation, and population IIV. |
| R runtime | Sidecar container exposing a plumber HTTP API. Main backend image stays Python-only. |
| Existing defects | Fixed as part of this migration, not as a separate patch. Tracked in §6. |
| Scope | See §1.3 — capability boundary chosen deliberately. |

---

## 1. Where we are

### 1.1 What exists and is correct

The handoff architecture is sound and should be preserved:

```
L1 in-vitro analysis (analysis_id, persisted, immutable)
  ├─ admet_ai_endpoints          → ml_inputs for IVIVE
  ├─ optional_model_runs.binding_simulation.result.prediction.Kd_nM
  ├─ safety_assessments          → hERG / DILI / Ames signals
  └─ target_evidence             → UniProt, gene symbol
        │
        ▼  parameter_engine.resolve_from_analysis()   [locates, never recomputes]
   ResolvedInputs
        │
        ▼  l3_input_contract()   → POST /predict/l3/contract
   readiness + study_design_options  (browser renders, derives nothing)
        │
        ▼  run_animal_study()    → POST /predict/l3/run
   study record
```

`AnimalStudyWorkspace.tsx` (273 lines) is a pure consumer — two fetches and rendering. Keep that contract absolutely. Every number below must be produced server-side.

The engines worth keeping as-is: `safety_engine.py` (FDA km allometry, honest three-anchor design), `parameter_engine.py`, `study_engine.py`, `evidence_engine.py`, `store.py`.

### 1.2 Verified defects to fix during migration

Reproduced numerically against the kernel, not inferred from reading:

| # | Defect | Location | Measured impact |
|---|---|---|---|
| D1 | ODE time axis is minutes; API labels it hours | `pbpk_adapter.py:253` passes `linspace(0, duration_h, …)` into a kernel whose flows are L/min (`model.py:206`) | A 48 h study simulates 48 min. Observed terminal t½ = 34.20 t-units against an independent algebraic 34.66 **minutes**. |
| D2 | AUC truncated at `t_last`, never extrapolated to ∞ | `cohort.py:211` `np.trapz` | At the shipped 24 h / `n_time=100` default, AUC is **58% below** the converged value (217 vs 517). |
| D3 | Grid too coarse; linear trapezoid on a convex decay | `pbpk_adapter.py:138` `n_time=100` | At T=240, n=100 → AUC 707 vs n=2000 → 506. **37% high.** |
| D4 | Blood concentration aliased to plasma | `cohort.py:259` `curves["plasma"] = curves["venous_blood"]`; `model.py:270` returns `C_out = (C_t/Kp)·BPR` | Every "plasma" value off by BPR. Propagates into `target_coverage`'s `C_free = C_total·fu_plasma` and thence into the 50% occupancy GO/NO-GO. |
| D5 | t½ mixes reference fluids | `cohort.py:229` — plasma-referenced Vss ÷ blood-referenced CL | Reported t½ disagrees with the curve it was computed from (15.07 vs observed 34.20). |
| D6 | `ka = 1.0` hardcoded, promised override does not exist | `pbpk_adapter.py:91`; `run_arm_exposure` has no `ka` parameter | Sets Cmax/Tmax for every oral and SC compound regardless of chemistry. Also `baseF=0.5` (L246), `ka=10.0` repeat-IV (L104). |
| D7 | Model is fully linear → dose groups carry zero information | No Michaelis–Menten, no solubility limit, `f_abs` dose-independent | `dose_proportionality` can only ever return β ≈ 1.000. Its "saturable clearance" / "saturable absorption" branches are unreachable. |
| D8 | Sex is inert | `SEX_MODIFIERS` are identity (`store.py:75`); `pbpk_adapter.py:251` never passes sex to `get_physiology` | UI collects it, report prints it, nothing uses it. |
| D9 | Shared seed across arms | `pipeline.py:104` `seed=42` for every arm | All dose groups reuse identical virtual animals. |
| D10 | Occupancy gate is window-dependent | `pkpd_engine.py` unweighted mean over the user's chosen duration | Same compound, 24 h vs 168 h → different GO/NO-GO. |
| D11 | Parameter uncertainty presented as inter-animal variability | `cohort.py:41` `sample_disposition` draws each animal from the compound's CI, independently per parameter | Epistemic uncertainty labelled "inter-animal" (`pkpd_engine.py:56`). Ignores real fu/CL/Kp correlation. |
| D12 | No numeric or unit assertions in tests | `platform/kernel/tests/test_cohort.py` only does `assert "auc" in ep` | Why D1 survived. |

### 1.3 Capability boundary — what we will and will not build

A real GLP repeat-dose study produces body weights, food consumption, clinical chemistry, hematology, organ weights, gross pathology and histopathology. **We will not simulate those observations.** There is no mechanistic or ML basis to generate a plausible serum ALT trajectory or a hepatocellular hypertrophy finding for a novel compound, and fabricating one would be worse than useless — a scientist would act on it.

What we *can* do honestly, and will:

1. **Exposure and toxicokinetics, done to ICH S3A standard** — nonlinear PK, realistic sampling schedules, individual-animal NCA, accumulation ratios, dose-proportionality that can actually detect nonlinearity.
2. **Target engagement** — mass-action occupancy over the dosing interval at steady state.
3. **Predicted tox liabilities with explicit provenance** — organ-level hazard from pretrained open models and public in-vivo evidence, labelled as prediction.
4. **A derived point of departure** — reverse-dosimetry POD from in-vitro bioactivity, plus allometric NOAEL from public anchors, plus exposure-based margins (AUC and Cmax, not just dose).
5. **A study-design recommendation** — the dose levels, group sizes, sampling times and species a study director should actually run, with the rationale.

That last item is the highest-value output and the one nobody else gives you. Framing shifts from *"here is your virtual study result"* to *"here is the study you should run, and here is what we predict it will show."* That is defensible; the former is not.

---

## 2. The real animal-study flow, in order

This is the sequence an actual preclinical package follows. Each stage maps to a pipeline stage in §4.

| # | Stage | What happens in the lab | Typical duration |
|---|---|---|---|
| A0 | **In-vitro ADME package** | Microsomal/hepatocyte CLint, plasma protein binding, blood:plasma ratio, Caco-2/MDCK permeability, solubility, metabolic stability, CYP inhibition/induction, hERG patch clamp | 2–4 weeks |
| A1 | **Species selection** | Choose a rodent + non-rodent. Driven by metabolic similarity to human (metabolite cross-species comparison), target homology/pharmacological relevance, and regulatory precedent | 1 week |
| A2 | **IVIVE + PBPK projection** | Scale in-vitro CLint to in-vivo CL per species, predict Vss (Rodgers & Rowland or Poulin–Theil), simulate exposure. Choose a starting dose | 1–2 weeks |
| A3 | **Cassette / snapshot PK** | n=2–3 animals, single IV + single PO, sparse sampling. Confirms the IVIVE projection before spending on a real study | 1–2 weeks |
| A4 | **Single-dose PK, IV and PO** | n=3/route, serial sampling (IV: 0.083, 0.25, 0.5, 1, 2, 4, 8, 24 h). Gives CL, Vss, t½, F, MRT | 2 weeks |
| A5 | **Dose-range finding (DRF), non-GLP** | 3–4 dose levels, n=3/sex/group, 7–14 days. Body weight, clinical signs, limited clinical pathology. Finds the MTD and the top dose for the GLP study | 3–5 weeks |
| A6 | **Toxicokinetics within the DRF/GLP study** | Satellite animals or main-study sparse sampling. Confirms exposure increases with dose, checks accumulation and sex differences, gives the AUC that safety margins are actually built on | concurrent |
| A7 | **GLP repeat-dose toxicity** | OECD TG 407 (28-day) or 408 (90-day). Control + 3 doses, ≥5/sex/group (10 for 90-day), full clinical pathology, organ weights, histopathology. Yields the **NOAEL** | 3–6 months |
| A8 | **Safety pharmacology core battery** | ICH S7A — CNS (Irwin/FOB), cardiovascular (telemetry, QT), respiratory | concurrent with A7 |
| A9 | **Genotoxicity battery** | Ames, in-vitro micronucleus/chromosome aberration, in-vivo micronucleus (ICH S2) | concurrent |
| A10 | **Efficacy / PK-PD in a disease model** | Target engagement → biomarker → efficacy endpoint. Establishes the exposure needed for effect | variable |
| A11 | **Human dose projection** | NOAEL → HED via BSA (FDA 2005 km), ÷ safety factor 10 → MRSD. Cross-checked against a PBPK-projected human exposure and the efficacious exposure from A10 | 2 weeks |
| A12 | **Regulatory package** | ICH M3(R2) assembly for the IND/CTA | — |

**Where our app sits today:** A0 (L1 in-vitro), A2 (L2 IVIVE), and a partial A2/A4. Everything from A3 onward is either absent or misrepresented.

**Where v2 should reach:** honest coverage of A1–A6 and A11, with predicted-liability support for A7–A9. A7's histopathology stays out of scope permanently.

---

## 3. Tool map

Everything below is free, open-source, or free-with-registration. Nothing commercial.

### 3.1 Simulation engines

| Tool | Lang | Install | Use in our flow | Notes |
|---|---|---|---|---|
| **mrgsolve** | R | `install.packages("mrgsolve")` (CRAN, actively maintained — reference manual dated Jan 2026) | **Primary v2 engine for A2/A4/A6.** Nonlinear (Michaelis–Menten) clearance, TMDD, effect compartments, repeat dosing via event objects, population IIV via `$OMEGA` | C++ compiled, very fast. Needs a compiler in the sidecar image. Time units are model-declared — kills D1 by construction. |
| **rxode2 / nlmixr2** | R | `install.packages("nlmixr2")` (v5.0.0) | Population simulation with a proper `OMEGA` covariance matrix; parameter estimation if you ever fit to real animal data | Fixes D11 properly — separates IIV from parameter uncertainty. |
| **httk** | R | `install.packages("httk")` (US EPA) | Cross-check for our IVIVE and a ready-made rat PBTK. Ships chemical-specific data for 987 chemicals in human and 212 in rat; can push human in-vitro data to predictions in human, rat, mouse, dog and rabbit for 553 chemicals | Best independent validation source we have. Use it as a regression oracle. |
| **PK-Sim / MoBi (OSP Suite)** | R via `ospsuite` / GUI | GitHub `Open-Systems-Pharmacology`; `ospsuite` R package, R 4.x, Windows + Linux | Fully parameterised whole-body physiology for mouse, rat, minipig, dog, monkey, beagle, rabbit | Heaviest option. Use it to **source physiology**, and as a second-opinion engine for hard cases — not in the hot path. |
| **scipy / existing kernel** | Python | already present | Keeps doing the linear perfusion-limited PBPK | Retained per the "new capabilities only" decision. |

### 3.2 Parameter sourcing and IVIVE

| Tool | Access | Gives us |
|---|---|---|
| **OPERA** | Free, open-source (NICEATM + EPA) | QSAR predictions for intrinsic clearance, fu_plasma, logP, pKa — exactly the IVIVE inputs. Independent of ADMET-AI, so a useful cross-check. |
| **ICE (Integrated Chemical Environment)** | Free web + downloadable data, NIEHS/NICEATM. v4.2 (Jul 2025) carries invitrodb 4.2 | Built-in IVIVE workflow: converts in-vitro assay AC50s into equivalent administered doses. This is the missing `in_vitro_pod` block in `safety_engine.py`. |
| **EPA CTX APIs** | Free API key by request (`ccte_api@epa.gov`) | Programmatic ToxRefDB (in-vivo NOAELs/LOAELs by species and endpoint), ToxValDB, invitroDB, chemical properties. Already partly used by `evidence_engine.py` — expand it. |
| **ChEMBL** | Free REST API + local dump | Measured animal PK, potency, mechanism. Already wired via the `chembl` MCP. |
| **PubChem** | Free REST | Physchem, LD50 records. |
| **Curated measured CLint** | In-repo `resources/measured_clint_reference.csv` (Naritomi 2003, Ito 2004) | Already in `pk_ivive.py` — the correct pattern. Extend coverage. |

### 3.3 Analysis

| Tool | Lang | Use |
|---|---|---|
| **PKNCA** (v0.12.x) | R | Individual-animal NCA — AUClast, AUCinf, %AUCextrap, Cmax, Tmax, t½ by regression on the terminal phase, accumulation ratio. Includes **sparse-sampling NCA with covariance across time points**, which is exactly the rodent TK design. Replaces our `np.trapz` (fixes D2, D3, D5). |
| **ubiquity** | R | Automated preclinical NCA + report generation, wraps PKNCA. |
| **PharmPy** | Python | Model management, if you later want Python-side popPK. |

### 3.4 Predicted liabilities (pretrained, no training needed)

| Tool | Install | Endpoint |
|---|---|---|
| **ADMET-AI** | `pip install admet-ai`, source at `github.com/swansonk14/admet_ai` | 41 ADMET endpoints from TDC, plus a drug-induced cardiotoxicity model trained on FDA **DICTrank** (555 drugs). Highest average rank on the TDC ADMET benchmark leaderboard. Already used at L1 — reuse the same run, do not re-predict. |
| **TDC (Therapeutics Data Commons)** | `pip install PyTDC` | Benchmark datasets for DILI, hERG, Ames, Carcinogens, LD50_Zhu, ClinTox. Use `LD50_Zhu` for an acute-toxicity prior and `DILI` for hepatic liability. |
| **OPERA** | binary / CLI | Independent hazard endpoints for cross-check. |
| **ToxCast via ICE/CTX** | API | Assay-level bioactivity → reverse dosimetry POD. |

### 3.5 Species selection support (A1)

| Tool | Use |
|---|---|
| **UniProt REST + BLAST** | Target orthologue identity across rat/mouse/dog/cyno. Below ~70% identity in the binding site, the rodent is pharmacologically irrelevant and you need the non-rodent. |
| **Open Targets** (MCP already connected) | Target expression and tractability by species. |
| **ChEMBL cross-species bioactivity** | Measured potency against the orthologue where it exists. |

---

## 4. Target architecture

```
┌──────────────────────────────────────────────────────────┐
│  hakase-invitro-workspace  (React, display-only)         │
│  POST /api/ai/l3/contract   POST /api/ai/l3/run          │
└────────────────────────┬─────────────────────────────────┘
                         │  (Express BFF :3000 — NOT in this repo;
                         │   confirm the /api/ai/* → /predict/* map)
┌────────────────────────▼─────────────────────────────────┐
│  FastAPI :8090   hakase_smallmol.l3                      │
│                                                          │
│  parameter_engine  → ResolvedInputs from L1              │
│  species_engine    → A1 orthologue/precedent ranking      │NEW
│  design_engine     → doses, n/sex/group, sampling times   │NEW
│  ivive_engine      → CLint→CL, Kp, fu  (existing)         │
│  ┌──────────────── simulation dispatch ────────────────┐ │
│  │ linear + single-dose  → Python kernel (existing)    │ │
│  │ nonlinear / repeat /  → R sidecar (mrgsolve)        │ │NEW
│  │ population / PK-PD                                   │ │
│  └──────────────────────────────────────────────────────┘ │
│  nca_engine        → PKNCA via sidecar                    │NEW
│  pod_engine        → ICE/ToxCast reverse dosimetry        │NEW
│  safety_engine     → anchors + AUC-based margins (extend) │
│  hazard_engine     → ADMET-AI/TDC liabilities (from L1)   │NEW
│  translation_engine→ NOAEL→HED→MRSD                       │NEW
│  decision_engine   → stage gate (extend)                  │
│  reporting_engine  → study protocol + prediction report   │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP, JSON
┌────────────────────────▼─────────────────────────────────┐
│  R sidecar :8091   plumber                                │
│  POST /simulate   mrgsolve                                │
│  POST /nca        PKNCA (dense + sparse)                  │
│  POST /popsim     rxode2                                  │
│  POST /httk       httk cross-check                        │
│  Stateless. Model code lives in the image, versioned.     │
└──────────────────────────────────────────────────────────┘
```

### 4.1 Why a sidecar rather than rpy2

`rpy2` embeds R in the Python process: one R state, GIL contention, and an R-level segfault takes the API down. A plumber sidecar is stateless, independently scalable, independently versioned, and testable with `curl`. Cost is JSON serialisation, which is negligible next to ODE solve time.

### 4.2 Sidecar contract

```
POST /simulate
{
  "model": "pbpk_nonlinear_v1",
  "params": { "CLint": 28.5, "Vmax": 12.0, "Km": 3.4, "fu": 0.08,
              "BP": 1.1, "Kp": {...}, "ka": 0.7, "F": 0.42 },
  "physiology": { "species": "rat", "sex": "male", "BW": 0.3, ... },
  "regimen": [{ "amt": 25, "cmt": 1, "ii": 24, "addl": 13, "rate": 0 }],
  "omega": [[0.09, 0], [0, 0.16]],
  "n_subjects": 10,
  "tgrid": { "end": 336, "delta": 0.05, "add": [0.083, 0.25, 0.5, 1, 2, 4, 8, 24] },
  "seed": 20260806
}
→ { "time_unit": "h", "conc_unit": "mg/L", "subjects": [...], "meta": {...} }
```

Two rules, both non-negotiable:

- **`time_unit` is explicit in every request and every response.** D1 must be impossible to reintroduce. The Python side asserts on it.
- **`tgrid` carries both a dense grid (for AUC accuracy) and the explicit nominal sampling times (for the NCA that mirrors the real study).** This is what kills D3.

### 4.3 Docker

```yaml
services:
  api:
    build: ./service            # Python only, unchanged
    environment:
      R_SIDECAR_URL: http://r-sidecar:8091
  r-sidecar:
    build: ./deploy/docker/r-sidecar
    # FROM rocker/r-ver:4.4.x
    # renv.lock pins mrgsolve, PKNCA, rxode2, nlmixr2, httk, plumber
```

Pin with `renv.lock`, not bare `install.packages`. A silent CRAN bump changing a solver default is exactly the class of bug we just spent this document cataloguing.

---

## 5. Pipeline stages in detail

### Stage 1 — Species selection (new, A1)

Input: target UniProt from `ResolvedInputs`, metabolic profile from L1.
Output: ranked species with rationale, not a free-text dropdown.

- Orthologue identity via UniProt REST, binding-site residue conservation where a structure exists.
- Metabolic-similarity flag: if L1 predicts the dominant clearance route is CYP2D6, warn that rat CYP2D isoforms differ substantially and the rat CL projection is weak.
- Regulatory precedent from ToxRefDB — what species has this chemical class actually been tested in.

Replaces the current unqualified `["rat","mouse","dog","monkey"]` dropdown.

> **Note on the old UI:** `hakase-bio-frontend/apps/hakase-ai/src/lib/animalSim.ts` assigns each species a `cyp3a4Activity` / `cyp2d6Activity` / `cyp2c9Activity`. Rats express CYP3A1/3A2/3A9 and CYP2D1/2/3/4/18, not CYP3A4 or CYP2D6. Those are not real quantities. Do not carry them into v2.

### Stage 2 — Study design (new)

Given the compound and the objective (PK / DRF / TK), emit a **protocol**:

- **Dose levels.** Geometric spacing (typically 3–4×) anchored on the projected exposure at the efficacious concentration and capped by the predicted MTD. Not user-typed guesses.
- **Group sizes.** n=3/sex for single-dose PK; n=3–5/sex for DRF; n≥5/sex for a 28-day study (OECD TG 407), n≥10/sex for 90-day (TG 408). Enforce, don't just accept `cohort_size ≥ 2` as the router does today.
- **Sampling schedule.** IV: 0.083, 0.25, 0.5, 1, 2, 4, 8, 24 h. PO: add 0.5–1 h density around the predicted Tmax. Rodents get sparse/composite sampling because of blood-volume limits — max ~10% of circulating volume, so a 300 g rat with ~22 mL blood tolerates roughly 2.2 mL total. **This is a hard constraint the current engine does not model at all.**
- **Route and formulation** with a vehicle suggestion from predicted solubility.

Output is a downloadable protocol, and simultaneously the input to Stage 3.

### Stage 3 — Simulation (dispatch)

Route by required capability:

- Linear, single dose, no IIV → Python kernel (after the §6 fixes).
- Anything else → mrgsolve.

Nonlinear clearance model — this is what makes multiple dose groups mean something (fixes D7):

```
CL_total = CL_renal + Vmax·C_u / (Km + C_u)
```

Parameterise `Vmax`/`Km` from measured microsomal kinetics when available; when not, **say so and fall back to linear with an explicit flag**, never invent a Km. Same rule for solubility-limited absorption: a dose-dependent `f_abs` requires a measured or predicted solubility, and the model must state which.

IIV via `$OMEGA` with literature-typical CVs for CL, V and ka, drawn **once per animal**, held constant across that animal's profile — structurally separate from the parameter-uncertainty Monte Carlo. That is the correct fix for D11.

### Stage 4 — NCA (new)

Feed the simulated concentrations at the **nominal sampling times** into PKNCA, exactly as a real study's bioanalysis would be. Report AUClast, AUCinf, **%AUCextrap** (flag > 20% as an unreliable CL/F, standard practice), Cmax, Tmax, terminal t½ by log-linear regression with its R², CL/F, Vz/F, MRT, and accumulation ratio for repeat dosing.

This gives us metrics computed the way a scientist would compute them, from the same data they would have, rather than from the solver's internal state. It fixes D2, D3 and D5 simultaneously and makes the output directly comparable to real study reports.

### Stage 5 — POD and safety margins (extend)

Three anchors, keeping `safety_engine.py`'s honest structure, now with the third actually filled in:

1. **Evidence NOAEL** — ToxRefDB via CTX API. Already implemented.
2. **Allometric NOAEL** — FDA km scaling of a public anchor. Already implemented, correct.
3. **In-vitro POD** — reverse dosimetry through ICE from ToxCast AC50s. Currently `not_integrated`. Implement it.

Then compute **AUC-based and Cmax-based margins**, not only dose-based. We have the exposure; use it. This is how margins are actually set in a preclinical package.

### Stage 6 — Predicted liabilities (new)

Forward L1's ADMET-AI outputs — DICTrank cardiotoxicity, DILI, hERG, Ames — plus TDC `LD50_Zhu` for an acute prior. Every one labelled `provenance: ml`, with the training-set size and the applicability-domain verdict alongside. No re-prediction; reuse the L1 run so the numbers cannot drift between layers.

### Stage 7 — Translation (new)

NOAEL → HED via FDA 2005 BSA/km → MRSD with the standard 10× factor. Cross-check against the PBPK-projected human exposure and the efficacious exposure. Report the therapeutic index. This is the number the whole preclinical package exists to produce.

### Stage 8 — Decision and report

Extend `decision_engine.py`. Fix D10 by evaluating occupancy **over one dosing interval τ at steady state**, not over the user's arbitrary window. Add nonlinearity and accumulation as explicit criteria. Keep the existing named-thresholds design — it is right.

---

## 6. Migration order

Each phase ends green and shippable.

**Phase 0 — Test harness first.** Before touching anything: numeric regression tests with analytical ground truth (one-compartment IV bolus where CL, V, AUC∞ and t½ are known in closed form), plus mass-balance and unit assertions. Add an httk cross-check as an independent oracle. This is the guard that D1–D5 lacked (D12).

**Phase 1 — Fix the kernel.** D1 (declare and convert time units at the adapter boundary; assert), D4 (`plasma = venous_blood / BPR`, and stop the alias), D5 (consistent reference fluid), D2/D3 (route metrics through NCA rather than raw `trapz`; raise the solve grid). D6: make `ka` a real parameter with a documented default and provenance flag. D8: pass sex through, and either populate `SEX_MODIFIERS` from literature or remove the field from the UI — an inert control that looks functional is worse than no control. D9: seed per arm.

**Phase 2 — R sidecar.** Container, plumber, `/simulate` and `/nca`, `renv.lock`. Validate mrgsolve against the fixed Python kernel on the linear case — they must agree to within solver tolerance before mrgsolve is trusted with anything the kernel cannot do.

**Phase 3 — Nonlinear PK + NCA.** Michaelis–Menten clearance, repeat dosing, PKNCA. D7 resolves here: dose groups start carrying information.

**Phase 4 — Design and species engines.** Stages 1 and 2. Sampling-volume constraints. Protocol output.

**Phase 5 — POD, liabilities, translation.** Stages 5–7. ICE integration, CTX API key, ADMET-AI forwarding.

**Phase 6 — Population IIV.** rxode2 `OMEGA`. Fixes D11 properly.

---

## 7. Compute budget

Realistic numbers so the UI can set expectations honestly:

| Job | Engine | Wall time |
|---|---|---|
| Single arm, linear, n=10, dense grid | Python kernel (Radau, 13 cmt) | 2–5 s |
| Single arm, nonlinear, n=10 | mrgsolve | < 1 s |
| 4 arms × n=10, repeat dose, 14 days | mrgsolve | 2–4 s |
| Population, n=200, IIV | rxode2 | 5–15 s |
| Sensitivity sweep, 8 params × 5 levels | mrgsolve | 10–30 s |
| PKNCA on 40 profiles | PKNCA | < 1 s |
| httk cross-check | httk | 1–3 s |

mrgsolve is compiled C++ and materially faster than the current scipy Radau path, so Phase 3 should *improve* latency despite doing more. Everything above fits a synchronous request. Only the full sensitivity sweep warrants a job queue — the `/api/ai/dock` async pattern already in the codebase is the model to copy.

---

## 8. Open items

1. **The Express BFF is not in this workspace.** `deploy/nginx/hakase-backend.conf` routes `/api/` to :3000 and FastAPI sits internal at :8090, but the frontend calls `/api/ai/l3/*` while FastAPI registers `/predict/l3/*`. Confirm that mapping exists before assuming L3 is reachable end to end.
2. **CTX API key** — request from `ccte_api@epa.gov`, free, needed for ToxRefDB/ToxValDB at scale.
3. **`SEX_MODIFIERS`** — decide: populate from literature, or remove the control. Do not ship it inert.
4. **Vmax/Km sourcing** — without measured microsomal kinetics, nonlinearity cannot be predicted honestly. Decide whether to require it as an optional measured input or to gate the nonlinear path behind its presence.

---

## 9. References

- ICH M3(R2) — Nonclinical Safety Studies for the Conduct of Human Clinical Trials
- ICH S3A — Toxicokinetics: Assessment of Systemic Exposure in Toxicity Studies
- ICH S7A — Safety Pharmacology Studies for Human Pharmaceuticals
- OECD TG 407 (28-day) / TG 408 (90-day) repeated-dose oral toxicity, rodent
- FDA (2005) *Estimating the Maximum Safe Starting Dose in Initial Clinical Trials for Therapeutics in Adult Healthy Volunteers* — BSA/km conversion
- Rodgers & Rowland (2006) *J Pharm Sci* 95:1238 — tissue partitioning
- Pearce, Strope, Setzer, Sipes & Wambaugh (2017) *J Stat Softw* 79(4):1–26 — httk
- Simple, Automatic Noncompartmental Analysis: The PKNCA R Package (2015) *J Pharmacokinet Pharmacodyn* 42(1)
- Swanson et al. (2024) *Bioinformatics* 40(7):btae416 — ADMET-AI
- ADMET-AI cardiotoxicity / DICTrank (2025) *Circulation* — DOI 10.1161/CIRCULATIONAHA.124.070413
