# Virtual Preclinical Study Engine (Animal Cohort) — Architecture

**Status:** Architecture / design. Precedes implementation.
**Layer name:** L3 — Virtual Preclinical Study Engine (Animal Cohort).
**Companions:** `virtual-animal-architecture.md` (scientific feasibility), `virtual-animal-phase0-spec.md` (the exposure-engine MVP this builds on), `pbpk-layer.md` (kernel PBPK contract).
**Position in the product:** `L1 (feasibility + ADMET + IVIVE)` → `L2 (Confirmation)` → **`L3 (Animal Cohort)`**.

---

## 0. TL;DR — what this layer is, and what already exists

The scientific backbone this layer needs is **already built and validated** in the codebase as "Phase 0":

| Capability | Where it already lives | Reuse verdict |
|---|---|---|
| Human/animal IVIVE PK (well-stirred liver, renal GFR, Monte-Carlo intervals) | `modalities/small-molecule/.../pk_ivive/pk_ivive.py` | **Reuse as-is** (source of truth) |
| Disposition handoff contract (`DispositionParameters`, full provenance envelope) | `platform/kernel/.../pbpk/contract.py` | **Reuse as-is** |
| Tissue partition coefficients (Schmitt/Rodgers-Rowland) | `.../pk_ivive/kp.py`, `.../physiology/tissue_composition.py` | **Reuse as-is** |
| 13-compartment perfusion-limited whole-body PBPK ODE (scipy Radau, mass-conserving) | `platform/kernel/.../pbpk/model.py` | **Reuse as-is** |
| Virtual-cohort Monte-Carlo (N animals, per-organ curves + 90% CI, Cmax/AUC/CL/Vss/t½) | `platform/kernel/.../pbpk/cohort.py` | **Reuse as-is** |
| Route/dose absorption forcing (IV bolus/infusion, Oral+BCS, SC depot, RepeatDose) | `platform/kernel/.../pbpk/absorption.py` | **Reuse as-is** |
| Species/strain physiology store (human, rat, mouse, dog, monkey + allometric anchor) | `platform/kernel/.../pbpk/physiology/store.py` | **Reuse as-is** |
| Applicability-domain OOD gating | `platform/kernel/.../uncertainty/applicability_domain.py` | **Reuse as-is** |
| Single-arm exposure endpoint (`/predict/pbpk/exposure`) | `service/.../main.py` | **Reuse; L3 orchestrates it** |
| Decision math (MCDC belief/plausibility, DSM early-warning) | `platform/kernel/.../decision/` | **Reuse for stage gate** |
| Live evidence adapters (EPA CCTE hazard, PubChem tox, ChEMBL PK) | `.../pk_ivive/animal_sim.py` (prototype) | **Salvage the adapters; retire the heuristic `SPECIES_LIBRARY`** |

**Therefore L3 is not a new PBPK engine.** It is the **study-level orchestration layer** that turns the validated single-arm exposure simulation into a *complete virtual preclinical study*: multiple dose groups, target coverage, PK/PD, safety margins, public animal evidence, sensitivity, dose comparison, and a stage-gate recommendation — every output carrying `{model, confidence, limitations, provenance}`.

The design principle inherited from every prior layer is absolute and non-negotiable here: **no fabricated, hard-coded, or LLM-generated scientific numbers.** Any quantity that cannot be produced by a validated model, a mechanistic calculation, an open engine, or a public dataset is returned as a typed `not_predicted` / `available:false` with a `missing` list and a reason — never a guess.

---

## 1. How a real pharma company runs this stage (the workflow we mirror)

After IVIVE/first-in-human PK projection, a program runs **IND-enabling nonclinical studies** (ICH M3(R2), S7A/S7B, S3A). The scientific sequence:

1. **Study design.** Pick species (a rodent + a non-rodent per ICH M3), strain, sex (both, per current FDA guidance), route (match intended clinical route), **dose groups** (vehicle control + low/mid/high, spaced to bracket the expected pharmacology and to find a NOAEL), dosing schedule (QD/BID…), and duration (single-dose → 2/4-week repeat-dose → chronic).
2. **Toxicokinetics (TK).** Satellite animals give plasma concentration–time per dose group → Cmax, Tmax, AUC, CL, Vd, t½, **dose proportionality**, **accumulation ratio** on repeat dosing, and **tissue exposure**. *(This is exactly the Phase-0 engine output, per dose group.)*
3. **Exposure–response / target coverage.** Compare free tissue/plasma exposure to the **in-vitro potency** (Ki/IC50/EC50) → time above target, %coverage, and a PK/PD (Emax/Hill) link where potency is known.
4. **Safety assessment.** Determine the **NOAEL** and the **exposure margin** = animal exposure at NOAEL ÷ projected efficacious/clinical exposure. Anchor organ-hazard flags (liver, cardiac, genotox) to AOP-style evidence.
5. **Evidence integration.** Cross-check against **public animal data** for the compound and near analogues (ChEMBL in-vivo PK, EPA CompTox/ToxRefDB/ToxCast, Open TG-GATEs).
6. **Uncertainty & sensitivity.** Which parameters drive the answer? How wide are the intervals? Is the compound in-domain?
7. **Stage-gate decision.** A documented GO / NO-GO / CONDITIONAL call: is exposure adequate, is the therapeutic index acceptable, is the evidence strong enough to commit to a real in-vivo study — or to refine dose/formulation first (the 3Rs "reduce/refine" objective).
8. **Study report.** A structured, provenance-stamped scientific report.

L3 reproduces steps **1–8 in silico**, honestly labelling what is quantitatively predicted vs. flagged vs. `not_predicted`.

---

## 2. Selected tools — and why

### Reused / integrated (the spine)

- **Hakase kernel PBPK (Python/scipy) — the ODE + cohort engine.** *Why:* it is already a whole-body, mass-conserving, perfusion-limited PBPK with Monte-Carlo virtual populations, keyed by species physiology, and it consumes the IVIVE handoff directly. It is the open-source, in-house equivalent of the role `httk::solve_pbtk` / `mrgsolve` would play.
- **Hakase IVIVE (`predict_pk_ivive`) — disposition source of truth.** *Why:* it is the L1/L2 handoff. L3 must not recompute PK; it consumes this record (via `analysis_id`).
- **RDKit** — descriptors for BCS/absorption and analogue search. Already a dependency.
- **ChEMBL** (REST + `mcp__plugin_bio-research_chembl`) — in-vivo animal PK, target Ki/IC50/EC50 for **target coverage**, and analogue bioactivity. Open (CC BY-SA), maintained.
- **EPA CompTox / CCTE (ToxCast, ToxRefDB, httk experimental data)** — in-vitro points-of-departure and in-vivo tox study data for **safety-margin evidence** and reverse-dosimetry. Public API, already partially wired in `animal_sim.py`.
- **PubChem / UniProt / PDB** — identity, target, and structure resolution (already used upstream).
- **Hakase decision kernel (MCDC + DSM)** — evidence-weighted GO/NO-GO with belief/plausibility intervals for the **stage gate**. Already in `platform/kernel/decision/`.

### Considered and **rejected** (with the honest reason)

- **EPA httk (R) — highest priority per brief, but rejected as a runtime dependency.** *Why rejected here:* it is an **R** package; **R is not present in this environment** and adding an R + Plumber sidecar is heavy operational surface. *Crucially, httk offers no scientific capability the kernel lacks:* for rat/dog/mouse/rabbit, httk itself **substitutes human fraction-unbound, partition coefficients, and intrinsic clearance** and only swaps in species physiology (EPA httk training, Jul 2025) — which is exactly what the kernel already does, with the *same* documented cross-species limitation. We adopt httk's **method and physiological reference values** (already cited in the store), not its R runtime. *(If R is later provisioned, an `httk_adapter` behind a Plumber service is a clean drop-in for cross-validation — noted as a future option, not a dependency.)*
- **mrgsolve (R/C++) — rejected, same reason:** R-only ODE solver; scipy Radau in `model.py` already fills the ODE role with validated mass conservation.
- **PK-Sim / MoBi (OSP suite)** — excellent reference implementations, but GUI/.NET-centric and not embeddable as a Python service. Used as a **structural reference** (already reflected in the kernel design), not integrated.
- **COPASI / PySB / BioSimulators (QSP)** — deferred. These power **organ-response QSP** (DILIsym-style liver, O'Hara-Rudy cardiac), which is Phase-2 (organ toxicity *magnitude*), out of scope for the cohort/exposure layer.
- **AnimalGAN (FDA/NCTR)** — **rejected as unusable**: peer-reviewed (Nat Commun 2023) but **no public downloadable weights or inference repo** could be located. Generating its 38 rat clinical-pathology measures without the real model would be fabrication. Surfaced in the UI as a **named `not_predicted` capability** with the reason "no open weights", never emulated.
- **DeepChem / BioNeMo** — general ML toolkits, not preclinical-study predictors; nothing here needs them that the existing ADMET ML stack doesn't already provide.
- **Open TG-GATEs / DrugMatrix** — integrated **only as compound-level evidence lookup** (REST), not as a training/prediction source; matching is by compound identity, so it contributes evidence for known compounds and analogues and is absent (honestly) otherwise.

**Net:** the scientifically defensible, fully-open stack is **kernel PBPK + IVIVE + RDKit + ChEMBL + EPA CompTox + decision kernel**, with httk/mrgsolve consciously reimplemented-in-spirit rather than shelled out to R, and AnimalGAN/QSP explicitly marked unsupported.

---

## 3. Backend architecture — modular engines

All under a new package `modalities/small-molecule/engine/.../l3/` (modality composition) leaning on `platform/kernel/pbpk` + `platform/kernel/decision` (modality-agnostic science). Two-tier rule preserved: `platform/` never imports `modalities/`.

```
l3/
  contract.py        # L3 study-input handoff (schema_version'd), mirrors l2_input_contract
  study_engine.py    # study design → normalized dose groups × schedule × arms
  parameter_engine.py# validate + resolve inputs from the L1/L2 record (no re-derivation)
  population_engine.py# thin wrapper over kernel run_virtual_cohort (per dose group)
  pbpk_adapter.py    # wraps assemble_disposition + kernel PBPK (the /pbpk/exposure core, reused)
  pkpd_engine.py     # target coverage + Emax/Hill PK/PD from potency (Ki/IC50)
  evidence_engine.py # ChEMBL animal PK + EPA CompTox/ToxRefDB + TG-GATEs lookups (async)
  safety_engine.py   # NOAEL/POD anchor + exposure margins + hazard-flag integration
  sensitivity_engine.py # one-at-a-time + variance sensitivity of PK metrics
  decision_engine.py # stage-gate via kernel MCDC/DSM (belief/plausibility → GO/NO-GO)
  reporting_engine.py# assembles the provenance-stamped scientific report + presentation
  pipeline.py        # orchestrator: ingest → validate → design → simulate → analyze → gate
```

**httk_adapter / mrgsolve_adapter** appear in the brief's suggested structure; here they are **explicitly optional cross-validation adapters, not built in v1** (no R). The interface is left open so they can be added behind a Plumber service later — documented, not stubbed with fakes.

### Data flow (revised from the brief, aligned to what exists)

```
L1/L2 analysis record (analysis_id)            ← source of truth (PK, potency, safety ML, target)
        ↓  parameter_engine (validate + resolve; no recompute)
Simulation Readiness  ────────────────────────  (AD gate + input completeness, per arm)
        ↓  study_engine (species/strain/sex/route/dose groups/schedule/duration/cohort)
Study Design  ────────────────────────────────  normalized arms
        ↓  pbpk_adapter × population_engine (per dose group, reuse kernel cohort)
Plasma PK + Tissue Exposure + PK Metrics  ────  Cmax/Tmax/AUC/CL/Vss/t½ + 90% CI, per organ
        ↓  pkpd_engine
Target Coverage + PK/PD  ──────────────────────  %time>target, Emax/Hill (only if potency known)
        ↓  population_engine aggregation
Population Variability  ───────────────────────  inter-animal spread (already in cohort output)
        ↓  safety_engine + evidence_engine
Safety Margins + Public Evidence  ─────────────  margins vs POD/NOAEL anchor; ChEMBL/CompTox/TGG
        ↓  sensitivity_engine
Sensitivity & Uncertainty  ────────────────────  parameter drivers of each metric
        ↓  (across arms)
Dose Comparison  ──────────────────────────────  dose-proportionality, accumulation, MTD bracket
        ↓  decision_engine (MCDC/DSM)
Stage-Gate Recommendation  ────────────────────  GO / NO-GO / CONDITIONAL + rationale + VOI
        ↓  reporting_engine
Scientific Report  ────────────────────────────  every block: model, confidence, limitations, provenance
```

### Persistence & API (mirrors L1/L2)

- Study records persisted like L1 analyses, keyed by `study_id`, retrievable for the report/handoff.
- New router endpoints under the small-molecule engine, surfaced through the service as `/api/ai/l3/*`:
  - `POST /predict/l3/contract` → the L3 input contract for an `analysis_id` (what's available, what's needed).
  - `POST /predict/l3/design` → validate + normalize a study design (readiness envelope).
  - `POST /predict/l3/run` → run the full study (all engines) → the study record.
  - `POST /predict/l3/arm` → run/inspect a single dose-group arm (debug/drill-down).
  - `GET  /predict/l3/report/{study_id}` → the assembled scientific report.
- Every response is a **display-only** contract: `{status, result, presentation, provenance}`, exactly like `run_l2_stage`. The browser renders; it never computes science.

---

## 4. Inputs and outputs

### Inputs

**From the L1/L2 record (never re-asked, never recomputed):** canonical SMILES, IVIVE disposition (CLint, fu, Vdss, BPR, CL split, extraction, first-pass) with provenance & Monte-Carlo intervals, tissue Kp, applicability-domain verdict, target (UniProt/gene) + potency evidence, and the L2 safety ML (hERG/DILI/Ames/Tox21/cardiotox) for hazard anchoring.

**Study-design inputs only (the genuinely new user inputs):**
- `species` + `strain` (from the physiology store catalog), `sex`, `age`, optional `body_weight`.
- `route` (IV bolus/infusion, oral, SC) + `formulation` (BCS class drives F for oral/SC).
- **`dose_groups`**: control + one or more active dose levels (mg/kg).
- `schedule`: frequency (QD/BID/…), duration (→ single vs repeat-dose), infusion duration for IV.
- `cohort_size` (virtual animals per arm), RNG seed.

### Outputs (sequence mirrors the simulation)

Simulation Readiness → Study Summary → Selected Scientific Models → Plasma PK → Tissue Exposure → PK Metrics → Target Coverage → PK/PD → Population Variability → Safety Margins → Public Evidence → Sensitivity Analysis → Dose Comparison → Stage-Gate Recommendation → Scientific Report.

**Every output block carries a uniform envelope:**
```json
{ "model": "<engine/dataset that produced it>",
  "confidence": "<nominal|low|out-of-domain, with rationale>",
  "limitations": "<what this number does and does not mean>",
  "provenance": "<measured|ml|reference|derived + citation/source>",
  "available": true }
```
When a block cannot be produced: `{"available": false, "missing": [...], "reason": "...", "remediation": "..."}`.

---

## 5. The scientifically hard parts — how each is kept honest

- **Cross-species PK.** IVIVE already flags: human-trained ML CLint is *not* predictive of rat clearance (Spearman 0.21, p=0.48; `pbpk-s2t5-validation-handoff.md`). L3 **propagates that low-confidence flag** into every downstream metric for non-human species driven by ML CLint, and prefers measured/curated species CLint where available. It never launders an ML number into a confident animal prediction.
- **Target coverage.** Computed only when a real potency value (Ki/IC50/EC50) exists (L1/L2 or ChEMBL); free-drug corrected via fu. No potency → `not_predicted`.
- **Safety margin / NOAEL.** This is the most fabrication-prone quantity. v1 policy (see §6, open decision): margins are computed against a **defensible exposure anchor** — an in-vitro point-of-departure via ToxCast/httk-style bioactivity:exposure, and/or an analogue in-vivo NOAEL from ChEMBL/ToxRefDB — **with the anchor's source shown**. A de-novo quantitative NOAEL is **not invented**; absent an anchor, the block reports hazard *flags* + "quantitative margin not predicted (no POD anchor)".
- **Stage gate.** The decision kernel combines the *available* evidence with explicit belief/plausibility; a gate built on thin evidence returns "CONDITIONAL — insufficient evidence" with a value-of-information note (what to measure next), not a false GO.
- **AnimalGAN / histopath / clin-path magnitude / efficacy.** Marked `not_predicted` (unsupported), with the reason, per the Phase-0 non-goals.

---

## 6. Open decisions to confirm before build

1. **Safety-margin anchor (highest impact on defensibility).** Preferred default: ToxCast/CompTox in-vitro POD + reverse-dosimetry *and* ChEMBL/ToxRefDB analogue in-vivo NOAEL, whichever are available, both shown with provenance; hazard-flags-only fallback otherwise. (Alternative: hazard-flags-only in v1, quantitative POD in v1.1.)
2. **Stage-gate criteria.** Default: coverage adequacy (exposure ≥ target with margin), therapeutic index vs. the safety anchor, evidence sufficiency, and in-domain status → MCDC. Thresholds surfaced and tunable, not hidden.
3. **Frontend surface.** A new `AnimalStudyWorkspace.tsx` in `hakase-invitro-workspace` (sibling to `IviveWorkspace`/`ConfirmationWorkspace`), consuming `/api/ai/l3/*`, rendering the output sequence as display-only cards with provenance badges and per-organ concentration–time charts.

---

## 7. What we deliberately do NOT build (honest boundaries)

- No organ-toxicity *magnitude* (ALT fold-change, histopath severity) — Phase 2 QSP.
- No AnimalGAN clinical-pathology emulation — no open weights.
- No efficacy/PD disease model, no immunogenicity — out of scope.
- No R runtime (httk/mrgsolve) in v1 — reimplemented-in-spirit; adapter left open for later cross-validation.
- No new PBPK physics — the kernel engine is the single ODE core.

The result is the most scientifically defensible open-source Virtual Preclinical Study Engine achievable on this codebase today: a genuine study-level workflow over a validated exposure engine, with every number traceable to a model, a mechanism, an open engine, or a public dataset — and everything else labelled, out loud, as not yet predictable.
