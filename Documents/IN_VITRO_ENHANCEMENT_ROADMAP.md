# In‑Vitro Layer (L1) — Status, Alignment & Enhancement Roadmap

**Purpose of L1:** take a *novel* molecule with little/no public data and return a defensible, directional **GO / WATCH / NO‑GO** so a biotech knows whether a compound is worth real wet‑lab spend. The product is the *direction*, calibrated under uncertainty — not a claim of lab‑grade precision.

**Why this layer matters (the sales story, with receipts):** safety/toxicity + PK are the largest single cause of drug‑candidate attrition, and ~70% of toxicity‑related attrition is detectable *preclinically* (Waring 2015, *Nat Rev Drug Discov*; discovery‑toxicology literature). A calibrated in‑silico triage that catches cardiac/hepatic/genotoxic/endocrine liabilities and off‑target promiscuity *before* synthesis attacks exactly the failure mode that wastes the most money.

---

## 1. Where the layer stands now

Every value that drives the verdict is now sourced from a **real model or deterministic chemistry — never a heuristic guess** — and the verdict will not be issued on heuristics at all:

- **Verdict gate (no fake verdicts).** A GO/WATCH is issued *only* when the real ML safety stack ran (hERG, DILI, Ames, and all 12 Tox21 endpoints). Otherwise the verdict is **`INSUFFICIENT‑EVIDENCE`** — never a heuristic GO/WATCH. Deterministic chemistry (structural alerts, reactive‑metabolite SMARTS, Lipinski Ro5) can still fire a real **NO‑GO** with the ML offline.
- **Real model coverage:** ADMET‑AI (Chemprop GNN, 41 endpoints incl. Tox21), CardioTox RF (hERG), DILI‑ML RF, solubility RF, DeepDTA‑GBM binding (ESM‑2 + Morgan), reactive‑metabolite + structural‑alert SMARTS, BSEP/phospholipidosis QSAR, applicability‑domain scorer, lookup‑first known‑drug resolver.
- **Selectivity is now real:** the verdict's Selectivity dimension is driven by the **DeepDTA off‑target panel** (high‑affinity off‑targets, Kd ≤ 1 µM) — the old physchem promiscuity proxy no longer feeds the verdict.
- **Cytotoxicity is real‑or‑null:** CC50 comes from a configured Ersilia cell‑viability model or shows "—" (the logP/LD50 proxies were removed).
- **Ersilia Model Hub adapter** (config‑driven, local + fast remote‑serve client modes) lets any catalog model be swapped in as a real predictor with honest provenance.

---

## 2. Value → verdict alignment (defensibility map)

| Displayed value | Real source (ML stack on) | Feeds the verdict? |
|---|---|---|
| On‑target potency (IC50/Kd) | DeepDTA‑GBM / ChEMBL measured | ✅ Potency dim |
| Absorption (Caco‑2, HIA, F, P‑gp) | ADMET‑AI | ✅ Absorption dim |
| Metabolic stability (CLint, t½) | ADMET‑AI (note: t½ low R²) | ✅ Metabolism dim |
| Distribution (PPB fu, VDss, BBB) | ADMET‑AI (note: VDss negative R²) | ✅ Distribution dim |
| hERG | CardioTox RF (preferred) / ADMET‑AI | ✅ veto‑gated |
| DILI | DILI‑ML RF / ADMET‑AI | ✅ veto‑gated |
| Ames | ADMET‑AI | ✅ veto‑gated |
| Tox21 — SR‑MMP, SR‑ATAD5 | ADMET‑AI | ✅ veto‑gated |
| Tox21 — NR panel + SR‑stress (10) | ADMET‑AI | ✅ endocrine/stress WATCH dim |
| CYP inhibition (5 isoforms) | ADMET‑AI Veith | ✅ DDI WATCH |
| BSEP / phospholipidosis | QSAR (deterministic) | ✅ WATCH |
| Reactive metabolites / structural alerts | SMARTS (deterministic) | ✅ hard NO‑GO |
| Selectivity / off‑target | **DeepDTA off‑target panel** | ✅ Selectivity dim (now ml) |
| Cytotoxicity (CC50) → Therapeutic Index | Ersilia (configured) or null | ✅ TI WATCH (when real) |

Anything not from a real source under STRICT is shown as context only and does **not** move the verdict.

---

## 3. Enhancement roadmap (prioritized)

| # | Enhancement | What it buys you (the claim it unlocks) | Effort | Status |
|---|---|---|---|---|
| **P0** | **Conformal prediction intervals** per endpoint | Replace "High/Moderate/Low" with genuine calibrated CIs — *"Caco‑2 18 ×10⁻⁶ cm/s, 90% CI [9, 32]"* with a coverage guarantee. This is the single upgrade that survives a medicinal chemist's scrutiny. (Conformalized Graph Learning for ADMET, *JCIM* 2024.) | Med | Recommended |
| **P0** | **Frozen validation set + one‑command report card** | Lets you say *"≤5% false‑positive on a 152‑drug FDA‑approved hold‑out, ≥90% recall on withdrawn"* **with receipts**. The benchmark script exists; freeze the set + auto‑emit a PDF/MD scorecard. | Low‑Med | Partially built |
| **P1** | **Always‑on real off‑target panel** (+ cache) | Selectivity becomes real for *every* molecule, not just when ChEMBL is empty. Today it's gated for latency; serve DeepDTA warm + cache to run it always. | Low | New |
| **P1** | **Mechanistic hepatotoxicity sub‑score** | Fuse DILI + BSEP + reactive‑metabolite + SR‑MMP into one explainable liver‑risk readout — a differentiated, sellable safety signal you already have all the parts for. | Low | New |
| **P1** | **Assay‑anchored read‑across confidence lift** | When ChEMBL has measured analogues, blend measured values in and surface *"anchored to N measured analogues"* — turns extrapolation into interpolation where evidence exists. | Med | Partially built |
| **P2** | **Swap weak endpoints for better open models via Ersilia** | ADMET‑AI's VDss (R²≈−1.2) and half‑life (R²≈−2.4) are worse than the mean — surface them as "directional only" *and* wire stronger Ersilia/clearance models where they exist. | Med | Adapter ready |
| **P2** | **Orthogonal permeability (PAMPA/MDCK) + metabolic‑stability heads** | Two independent permeability/stability predictions → a consensus + disagreement badge (you already use this pattern for hERG). | Med | New |
| **P3** | **Peptide parity in the verdict gate** | Peptide engine (HemoPI‑2, CAMP, CPPsite, CamSol, homology) is real; extend the same INSUFFICIENT‑EVIDENCE gate + provenance map to peptides. | Med | Engine ready |

---

## 4. Claims you can defensibly make to scientists

**Say this (all true after the work above):**
- "Every number that moves the verdict is a real open‑source ML model or deterministic chemistry — provenance is shown on each value."
- "We refuse to issue a GO/WATCH on heuristics: with the safety models offline the verdict is INSUFFICIENT‑EVIDENCE, not a guess."
- "Calibrated hERG/DILI/Ames/Tox21 gates with a measured false‑positive rate on an FDA‑approved hold‑out." *(after P0 validation report)*
- "Applicability‑domain aware — extrapolations are flagged and cannot hard‑veto a candidate."
- "Recognises every FDA‑approved drug by structure and returns its measured profile." *(lookup‑first)*

**Don't say:** "accurate for any novel molecule." Nobody can. The honest, stronger framing is **"calibrated under uncertainty, with the applicability‑domain status visible on every result."**

---

## 5. The honest limit (worth stating up front)

For a novel molecule against a novel target, every model is *extrapolating* — the ground truth is wet‑lab data. State‑of‑the‑art (pharma's own) sits around AUROC ~0.85 hERG, ~0.88 DILI, MAE ~0.8–1.0 log for potency. The right word isn't "accurate," it's **"calibrated"**: a verdict that is right where it has evidence, honest where it doesn't, and explicit about which case you're in. That is genuinely sellable; a precise‑looking single number is not.

---

### Sources
- Waring et al. (2015) *An analysis of the attrition of drug candidates from four major pharmaceutical companies.* Nat Rev Drug Discov 14:475. <https://www.nature.com/articles/nrd4609>
- Conformalized Graph Learning for Molecular ADMET Property Prediction and Reliable Uncertainty Quantification, *JCIM* 2024. <https://pubs.acs.org/doi/10.1021/acs.jcim.4c01139>
- Gfeller et al. SwissTargetPrediction, *Nucleic Acids Res* 2019. <https://academic.oup.com/nar/article/47/W1/W357/5491750>
- Swanson et al. ADMET‑AI, *Bioinformatics* 2024. <https://github.com/swansonk14/admet_ai>
- Ersilia Model Hub. <https://ersilia.io> · catalog <https://catalog.ersilia.io>
