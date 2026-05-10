# Layer 2 — In Silico Confirmation Layer

## Overview

Layer 2 is the **Confirmation Layer** of HakaseAI's 4-layer BioDigital Twin pipeline. Where Layer 1 produces a fast, browser-only in vitro digital twin from a SMILES string, Layer 2 takes those L1 outputs and runs a battery of **physics-based simulations and ML predictors** that *confirm or falsify* the L1 hypothesis before any wet-lab or in vivo work begins.

The end product of Layer 2 is the **Pre-Confirmation Directive** — a signed, versioned contract that:

1. Locks the upstream L1 evidence with an `EvidencePointer` (cryptographic provenance).
2. Declares the **Expected Ranges** that the Layer 3 ex vivo / animal cohort assays must reproduce (e.g. "primary hepatocyte CL must be within 2-fold of 12 mL/min/kg").
3. Attaches **Falsifiers** from the registry — explicit, pre-registered conditions under which Layer 3 evidence will refute the L2 prediction and halt progression.

Everything Layer 2 emits is traceable, replayable, and HAIOps-governed. No hidden state.

L2 runs as a **10-stage staged pipeline**. Stages 0–4 and 6–9 run client-side in seconds; stages 2 (docking) and 5 (FEP) are dispatched to the Python AI service (and optionally to RunPod GPUs) and may take minutes to hours.

---

## Pipeline Stages (in execution order)

```
Stage 0 — Ingest L1 Outputs                  (instant, browser)
Stage 1 — Target Druggability                 (~1s, AI service; ligand fields passive from L1)
Stage 2 — Docking (AutoDock Vina)            (~30s–10min, AI service)
Stage 3 — ML Affinity + ADMET-AI cross-check (~5s, AI service)
Stage 4 — Selectivity + Cardiotox ML         (~3s, AI service)
Stage 5 — Free-Energy Refinement (TIES FEP)  (~24 GPU-h, RunPod, optional)
Stage 6 — PBPK Projection                    (instant, browser)
Stage 7 — QSP / PD Coupling                  (instant, browser)
Stage 8 — Therapeutic-Index Ranking          (instant, browser)
Stage 9 — Output / Pre-Confirmation Directive (instant, browser)
```

Each stage has its own `runStageN(...)` function in `src/lib/l2Pipeline.ts` and is rendered as a card in `src/components/Layer2InSilicoScaffold.tsx`. Every stage produces a typed `StageNResult` object that is appended to the L2 run log; the final directive in Stage 9 packages the lot for handoff.

---

## Stage 0 — Ingest L1 Outputs

**Source**: `l2Pipeline.ts → runStage0()`, `Layer2InSilicoScaffold.tsx`

Stage 0 freezes the handoff from Layer 1. It reads the in-memory L1 state (`simResults`, `inVitroResults`, target UniProt, measured IC50/Ki) and validates that every required field is present. It then mints an `EvidencePointer` of the form `evt://l1/<sha256>` so that anything Stage 1+ does is provably tied to a specific L1 run — no later L1 re-runs can silently invalidate downstream conclusions.

| Input | Source |
|---|---|
| Canonical SMILES | L1 chemistry.ts |
| Target UniProt + gene symbol | L1 target catalog / user override |
| L1 measured pKi / pKd / IC50 | L1 binding simulator |
| L1 ADMET vector | L1 ADMET scorer |
| L1 hERG IC50 (if measured) | L1 cardiotox |

**Databases / datasets**: none external — purely local L1 state.

**Result object**: `Stage0Result` — SMILES, UniProt ID, presence flags for each L1 field, and the immutable `EvidencePointer`.

---

## Stage 1 — Target Druggability

**Source**: `l2Pipeline.ts → runStage1()`, `ai-service/models/protein_ml.py`

Stage 1 does one piece of meaningful work: **target druggability scoring**. The target UniProt sequence is fetched from UniProt and passed through a frozen **ESM-2** (Evolutionary Scale Modeling, Lin et al. 2022) language model in the AI service. The pooled embedding feeds a logistic head trained on a curated druggable/non-druggable protein set; the output is `druggability_probability ∈ [0,1]` and a class label.

**L1 ligand context (passive render, no work):** the right-pane tile shows L1's MW, logP, TPSA, QED, SA-score, Lipinski Rule-of-5 status, and Veber status — but these are **passively copied from the frozen L1 `SimResults`**, not recomputed. RDKit-JS is deterministic by construction, so an "L1 vs L2 ligand re-derivation" falsifier could never fire on real evidence. Per the v2.0.0 falsifier criterion (*pre-registered, machine-checkable, AND able to fire on real evidence*), no such falsifier exists in the `FALSIFIER_REGISTRY`. Integrity of the L1→L2 ligand handoff is enforced upstream by the **L1 EvidencePointer** minted in Stage 0 (`evt://l1/<sha256>`), which cryptographically binds every downstream stage to the exact L1 run that produced the SMILES + descriptors.

| Database / model | Use |
|---|---|
| **UniProt REST** (`proteinApi.ts`) | Reference sequence for the target |
| **ESM-2** (Meta AI, frozen weights) | Protein representation |
| **Druggability classifier** (logistic head over ESM-2) | Binary druggable probability |
| **L1 `SimResults` (passive)** | Ligand descriptors carried over for at-a-glance context — not recomputed |

**Result object**: `Stage1Result` — `{ protein: { uniprot, druggability_probability, druggability_class, source }, rdkit_descriptors, rule_of_5, veber_pass }`. The `rdkit_descriptors` / `rule_of_5` / `veber_pass` fields are L1-pinned values surfaced for UI density; the only Stage 1 computation is `protein.*`.

---

## Stage 2 — Docking (AutoDock Vina)

**Source**: `l2Pipeline.ts → runStage2Docking()`, `ai-service/models/docking_vina.py`

This is the first physics-based confirmation. Stage 2 dispatches an **AutoDock Vina 1.2.7** docking job to the AI service. The pipeline:

1. **PDB selection**: query the **RCSB PDB** REST for structures of the UniProt target. Prioritize X-ray structures with resolution &lt; 2.5 Å that contain a co-crystallized ligand in the orthosteric pocket. This anchors the docking box around a biologically meaningful site.
2. **Receptor prep**: chain isolation, water/ion stripping, **OpenBabel** protonation at pH 7.4, conversion to PDBQT.
3. **Ligand prep**: 3D embedding via RDKit, **UFF (Universal Force Field)** energy minimization, OpenBabel charge assignment, PDBQT export.
4. **Docking**: Vina with exhaustiveness 16, top-9 modes, search box centered on the resolved pocket.
5. **Scoring + RMSD**: extract best-mode affinity (kcal/mol), compute pose RMSD vs the co-crystal ligand, derive a pKd-equivalent (`pKd_eq = -ΔG / (R·T·ln10)`).

| Database / tool | Use |
|---|---|
| **RCSB PDB** REST | Experimental structure selection |
| **OpenBabel** | Protonation, PDBQT prep |
| **RDKit + UFF** | 3D ligand embedding |
| **AutoDock Vina 1.2.7** | Docking engine |

**Result object**: `Stage2Result` — `{ pdbId, resolutionÅ, vinaAffinityKcalMol, pKdEq, bestPoseRmsd, coCrystalLigand, n_modes }`.

**Falsifier wired by this stage**: if `pKdEq` and L1 `pKi` disagree by &gt; 1.5 log units, the directive flags `physics_vs_assay_disagreement`.

---

## Stage 3 — ML Affinity + ADMET Cross-Check

**Source**: `l2Pipeline.ts → runStage3()`, `ai-service/models/binding_ml.py`, `ai-service/models/admet_ml.py`

Stage 3 brings two trained ML models to bear:

**ML affinity (DeepDTA-style)**: a gradient-boosted regressor over a concatenation of the ligand's **2048-bit Morgan fingerprint (radius 2)** and the target's **ESM-2 mean-pool embedding**, trained on **BindingDB + ChEMBL** affinity records. Outputs a learned `pKd_predicted`.

**ADMET-AI**: the **Chemprop** directed message-passing graph neural network checkpoint released as ADMET-AI (Swanson et al. 2024), covering 41 ADMET endpoints (CYP inhibition, hepatic clearance, BBB, hERG, Ames, AMES, hepatotoxicity, etc.).

**Cross-check logic**: the stage computes a **disagreement score** between L2-ML `pKd_predicted`, L2-physics `pKdEq` (Stage 2), and L1 `pKi`. The classification is:

| Class | Rule |
|---|---|
| `strong` | All three agree within 0.5 log units |
| `moderate` | Within 1.0 log unit |
| `disagreement` | Spread &gt; 1.0 log unit (raises a falsifier) |

| Database / model | Use |
|---|---|
| **BindingDB + ChEMBL** (training) | DeepDTA-style affinity GBM |
| **ADMET-AI / Chemprop checkpoint** | 41-endpoint ADMET vector |
| **ESM-2** (re-used) | Target embedding |

**Result object**: `Stage3Result` — `{ pKdPredicted, admetVector, agreementClass, disagreementLogUnits }`.

---

## Stage 4 — Selectivity + Cardiotox ML

**Source**: `l2Pipeline.ts → runStage4()`, `ai-service/models/cardiotox.py`

Stage 4 specifically interrogates **cardiac risk** because hERG block is the single most common reason late-stage candidates fail. It runs a Morgan-FP **Random Forest** classifier trained on the **ChEMBL hERG bioactivity table** (IC50 &lt; 10 µM = blocker), and a paired classifier for selectivity vs the closest off-target paralogues drawn from L1's target catalog.

A **consensus** is then computed against the L1 measured hERG IC50 (if available):

| Consensus | Rule |
|---|---|
| `Low` | Both L1 IC50 &gt; 10 µM and ML p(blocker) &lt; 0.3 |
| `High` | Either L1 IC50 &lt; 1 µM or ML p(blocker) &gt; 0.7 |
| `Conflict` | L1 and ML disagree across the 0.5 boundary — flagged as a falsifier |

| Database / model | Use |
|---|---|
| **ChEMBL** cardiotox & paralog assays | Training set |
| **scikit-learn RandomForest** on Morgan FP r=2, 2048 bits | Inference |

**Result object**: `Stage4Result` — `{ hergMlProb, selectivityScore, consensusCardiacRisk, conflictWithL1 }`.

---

## Stage 5 — Free-Energy Refinement (TIES FEP)

**Source**: `l2Pipeline.ts → runStage5Fep()`, `ai-service/models/fep_runpod.py`

Stage 5 is the most expensive and is **opt-in**. It runs a relative-binding **Free-Energy Perturbation** simulation using **TIES (Thermodynamic Integration with Enhanced Sampling)** built on top of **OpenMM 8** with the **OpenFF Sage 2.x** force field, on solvated all-atom systems. The compute is dispatched to **RunPod Serverless GPUs** (~24 GPU-hours per ΔΔG). It computes ΔΔG between a reference compound (typically the L1 lead) and an analog, refining the docking-derived ranking with a physically rigorous estimate.

Because of cost, Stage 5 is gated behind an explicit user action and is recommended only when Stages 2–4 already show a borderline call.

| Database / tool | Use |
|---|---|
| **OpenFF Sage 2.x** | Small-molecule force field |
| **OpenMM 8** | MD engine |
| **TIES** (Wright et al.) | Alchemical FEP protocol |
| **RunPod Serverless** | GPU dispatch |

**Result object**: `Stage5Result` — `{ ddgKcalMol, ddgUncertaintyKcalMol, convergedReplicas, totalReplicas, gpuHours }`.

---

## Stage 6 — PBPK Projection

**Source**: `lib/pbpk.ts`, `l2Pipeline.ts → runStage6()`

Stage 6 projects a **human plasma concentration vs. time curve** without leaving the browser. The model is a **two-compartment PBPK ODE** (central + peripheral) integrated by **fixed-step RK4**. Inputs:

- **Allometric scaling** to a 70 kg human using **Davies & Morris 1993** physiology constants (organ weights, blood flows).
- **Hepatic clearance** computed by the **well-stirred liver model** from L1 microsomal stability and L1 plasma protein binding.
- **Renal clearance** scaled by predicted fraction unbound.
- **Volume of distribution** estimated by the **Poulin & Theil** method from logP, fu, and tissue:plasma partition coefficients.

The integrator emits Cmax, AUC0–24h, t½, time-to-Cmax, and full time-course arrays for plotting in the L2 panel.

| Reference / dataset | Use |
|---|---|
| **Davies & Morris 1993** | Human physiology constants |
| **Obach 2008** in vitro→in vivo CL bins | Clearance scaling |
| **Poulin & Theil** | Vd prediction |

**Result object**: `PBPKOutput` — `{ cMaxNgMl, auc024hNgHrMl, halfLifeH, tMaxH, timeCourse[] }`.

---

## Stage 7 — QSP / PD Coupling

**Source**: `lib/pdModel.ts`, `l2Pipeline.ts → runStage7()`

Stage 7 couples the PBPK unbound-plasma curve to a **pharmacodynamic Hill-equation** model of receptor occupancy:

```
Occupancy(t) = C_u(t)^n / (Ki^n + C_u(t)^n)
```

…where `Ki` comes from L1 (cross-checked against Stages 2–3), `C_u(t)` is the unbound concentration from Stage 6, and `n` is the Hill coefficient (default 1, overridable per-target). The stage outputs **peak occupancy**, **AUC of effect**, and **time-above-threshold** (default 75% occupancy) — the latter is the key driver for selecting a Layer 4 dosing schedule.

| Reference | Use |
|---|---|
| L1 Ki / Kd | Affinity input |
| Hill 1910 / Black–Leff operational model | Occupancy ODE |

**Result object**: `Stage7Result` — `{ peakOccupancyPct, aucOfEffect, timeAboveThresholdH, threshold }`.

---

## Stage 8 — Therapeutic-Index Ranking

**Source**: `lib/l2DoseProjection.ts`, `l2Pipeline.ts → runStage8()`

Stage 8 collapses everything upstream into a single **first-pass human dose projection** and a **safety margin** assessment. It computes:

- The required Cmax to achieve the target occupancy from Stage 7.
- The corresponding mg/kg dose using **Yee 1997** Caco-2 permeability bins to estimate fraction absorbed `F`.
- Margin ratios against `(hERG IC50)`, `(CYP3A4 IC50)`, and the **worst-case off-target** from Stage 4.

Margins are bucketed into tiers:

| Tier | Rule |
|---|---|
| `SAFE` | All margins ≥ 30× |
| `CAUTION` | Any margin in 10–30× |
| `RISK` | Any margin &lt; 10× — directive will require additional Layer 3 mitigations |

| Reference | Use |
|---|---|
| **Yee 1997** Caco-2/F bins | Bioavailability bin |
| **Obach 2008** | CL-to-dose conversion |
| Stages 4, 6, 7 | Margin numerators / denominators |

**Result object**: `L2DoseProjection` — `{ projectedDoseMgKg, requiredCmaxNgMl, marginHerg, marginCyp3a4, marginWorstOffTarget, marginTier }`.

---

## Stage 9 — Output / Pre-Confirmation Directive

**Source**: `l2Pipeline.ts → runStage9()`, `lib/confirmationEngine.ts`, `@workspace/preclinical-handoff` (FALSIFIER_REGISTRY)

The terminal stage. It assembles a versioned **Pre-Confirmation Directive** — the v2.0.0 contract object — containing:

1. **Provenance**: every upstream `EvidencePointer` (L1 ingest, each L2 stage), the model versions, the FF version, the PDB ID used, the RunPod job ID for FEP if any.
2. **Expected Ranges** for every Layer 3 assay, derived from Stages 1–8 (e.g. `primary_hepatocyte_clearance ∈ [6, 24] mL/min/kg`).
3. **Falsifiers** drawn from the global `FALSIFIER_REGISTRY` and parameterized by this run's numbers — each falsifier is a precise, machine-checkable predicate that Layer 3 evaluates automatically (e.g. `ex_vivo_herg_IC50 < 1 µM ⇒ HALT`).
4. **Headline call**: GO / GO-WITH-CAUTION / NO-GO with a one-paragraph rationale.

The directive is what Layer 3 (Animal Cohort) consumes. Layer 3 has no other channel into Layer 2 — the directive is the API.

| Database / registry | Use |
|---|---|
| **FALSIFIER_REGISTRY** (`@workspace/preclinical-handoff`) | Pre-registered falsifier templates |
| All Stage 0–8 results | Directive content |

**Result object**: `PreConfirmationDirective` v2.0.0 — the contract for Layer 3.

---

## Component Map

| File | Responsibility |
|---|---|
| `src/components/Layer2InSilicoScaffold.tsx` | UI scaffold, stage cards, run-trigger orchestration |
| `src/lib/l2Pipeline.ts` | The engine room — `runStage0` … `runStage9` |
| `src/lib/pbpk.ts` | Two-compartment PBPK ODE (RK4) |
| `src/lib/pdModel.ts` | Hill / occupancy PD coupling |
| `src/lib/l2DoseProjection.ts` | Human dose + margin tiering |
| `src/lib/confirmationEngine.ts` | Directive assembly + falsifier evaluation |
| `src/lib/proteinApi.ts` | UniProt fetch helpers |
| `artifacts/ai-service/main.py` | FastAPI endpoints (`/predict/binding-ml`, `/predict/admet-ml`, `/predict/cardiotox`, `/dock/vina`, `/fep/ties`, `/predict/druggability`) |
| `artifacts/ai-service/models/protein_ml.py` | ESM-2 embeddings + druggability head |
| `artifacts/ai-service/models/docking_vina.py` | Vina + OpenBabel + RDKit prep wrapper |
| `artifacts/ai-service/models/binding_ml.py` | DeepDTA-style affinity GBM |
| `artifacts/ai-service/models/admet_ml.py` | ADMET-AI / Chemprop checkpoint |
| `artifacts/ai-service/models/cardiotox.py` | hERG Random Forest |
| `artifacts/ai-service/models/fep_runpod.py` | RunPod dispatch for TIES FEP |

---

## Database / Model Glossary

| Resource | Type | Where used |
|---|---|---|
| **RDKit / RDKit-JS** | Cheminformatics toolkit | Stages 1, 2 ligand prep |
| **UniProt** | Reference protein DB | Stage 1 sequence fetch |
| **RCSB PDB** | Experimental structures | Stage 2 docking target |
| **OpenBabel** | Chemistry conversion | Stage 2 PDBQT prep |
| **AutoDock Vina 1.2.7** | Docking engine | Stage 2 |
| **ESM-2** (Meta AI) | Protein language model | Stages 1, 3 |
| **BindingDB + ChEMBL** | Affinity data | Stage 3 GBM training |
| **ADMET-AI / Chemprop** | GNN | Stage 3 ADMET vector |
| **ChEMBL hERG / paralog assays** | Cardiotox & selectivity training | Stage 4 |
| **OpenFF Sage 2.x** | Small-molecule FF | Stage 5 FEP |
| **OpenMM 8** | MD engine | Stage 5 FEP |
| **TIES** | Alchemical FEP protocol | Stage 5 FEP |
| **RunPod Serverless** | GPU dispatch | Stage 5 FEP |
| **Davies & Morris 1993** | Human physiology constants | Stage 6 PBPK |
| **Obach 2008** | IVIVE clearance bins | Stages 6, 8 |
| **Poulin & Theil** | Vd prediction | Stage 6 |
| **Yee 1997** | Caco-2/F bins | Stage 8 |
| **FALSIFIER_REGISTRY** | Pre-registered predicates | Stage 9 directive |

---

## Handoff Contract to Layer 3

The single output of Layer 2 is the **`PreConfirmationDirective` v2.0.0** object. Layer 3 consumes only that — there is no shared mutable state. This is what makes the L1→L2→L3→L4 pipeline auditable: every claim Layer 3 makes can be traced back to the exact L2 stage and the exact L1 evidence pointer that supported it, and any contradiction triggers a registered falsifier rather than silent disagreement.

For the corresponding Layer 3 specification, see [`layer-2-in-silico-and-layer-3-ex-vivo.md`](./layer-2-in-silico-and-layer-3-ex-vivo.md).
