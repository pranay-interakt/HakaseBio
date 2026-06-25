# Hakase BioTwin — Layer 1 Assessment & Enhancement Plan

**Author:** Engineering review (Cowork session)
**Date:** 2026-06-25
**Scope of review:** Layer 1 ("In‑Vitro Digital Twin") — the small‑molecule GO / WATCH / NO‑GO triage layer. Code reviewed: `artifacts/hakase-ai/src/lib/l1Scorecard.ts` (1,306 lines), `l1Thresholds.json`, `calibration.ts`, `cascadeGate.ts`, and the Python `artifacts/ai-service` (16.5k LOC, 40+ endpoints).

---

## 1. The one‑paragraph answer

**Layer 1 is genuinely good — better than most commercial "AI triage" front‑ends I've seen, and the scientific logic is defensible to a medicinal chemist.** It is not a toy. The verdict engine implements real industry methodology (MPO weighted‑geometric‑mean desirability à la QED/CNS‑MPO, regulatory‑grounded hard vetoes under ICH M7/S7B/S2(R1), applicability‑domain gating per OECD QSAR principle 3, and calibration‑gated "abstain rather than false‑stop" behaviour). The honesty discipline — `INSUFFICIENT‑EVIDENCE` instead of a fabricated GO, provenance on every number, lookup‑first for known drugs — is exactly the posture that survives buyer scrutiny. **The product is real and sellable as a "calibrated preclinical triage layer."** Where it is *thin* relative to the people you named (Certara/Simcyp) is **quantitative PK/PBPK, mechanistic DDI, and live measured‑data enrichment** — and those are precisely the highest‑leverage things to build next. This document reviews the code, positions it against Simcyp/GastroPlus/Schrödinger, and lays out a prioritized plan of API‑based tools, data sources, and industry logic to close the gap.

---

## 2. What Layer 1 actually is (scope)

L1 takes a **novel small molecule with little/no public data** and returns a **direction** — advance / watch / get‑an‑assay / stop — so a biotech knows whether a compound is worth real wet‑lab spend. The trustworthy output is the *direction*, not lab‑grade numbers. It is explicitly **not** a replacement for IND‑enabling tox, patch‑clamp, or a clinical efficacy claim.

The verdict is produced by a five‑path cascade:

| Path | Fires when | Basis | Trust |
|---|---|---|---|
| Known‑drug lookup | SMILES matches a known drug (InChIKey / Tanimoto) | Published ChEMBL/DrugCentral status | Experimental (highest) |
| Deterministic vetoes | Structural alerts, reactive‑metabolite SMARTS, Lipinski ≥3 | Curated SMARTS / ICH rules | High |
| ML safety + ADMET | Novel compound, ai‑service up | ADMET‑AI (Chemprop), CardioTox RF, DILI‑ML | Bounded by model AUROC |
| Calibration gate | A strong ML liability before it can hard‑stop | Conformal: veto only if in‑domain AND lower bound > threshold | Prevents false NO‑GO |
| Heuristic fallback | ai‑service down | Physchem QSPR | Worst case; cannot issue GO/WATCH under STRICT |

**Already wired data sources / models:** ChEMBL, PubChem, DrugCentral, UniProt, AlphaFold, RCSB PDB, TDC, Ersilia Model Hub, ADMET‑AI, BindingDB‑scale DTA (PLAPT/DeepPurpose), plus a biologics stack (ANARCI, OAS, AbLang2, BioPhi, SAbDab, IgFold, Boltz). This is a serious integration surface already.

---

## 3. Code review — is it OK?

### 3.1 What's strong (keep doing this)

- **The verdict math is correct and defensible.** Weighted *geometric* mean of Harrington/Derringer‑Suich desirabilities (`geometricComposite`) is the right scalarization — a single weak safety axis genuinely drags the composite down, so you can't "average away" a liability. Weights renormalize only over computable dimensions, so a molecule is never penalized for a missing endpoint. This is textbook MPO done properly.
- **Separation of vetoes from the composite.** Hard liabilities are deterministic stage‑gates, not averaged in. This mirrors how a real portfolio committee triages and is the single most important design decision in the file.
- **Calibration‑gated vetoes (`assessVeto`) + applicability‑domain gating.** An out‑of‑domain ML prediction (NN‑Tanimoto < 0.40) cannot hard‑veto — it escalates to WATCH·review‑escalate. This is the difference between a sellable tool and one a chemist laughs out of the room.
- **Chemotype awareness.** Beyond‑Rule‑of‑5 (PROTAC/molecular‑glue/macrocycle) and covalent‑by‑design routing means you don't false‑stop osimertinib‑like warheads or degraders. Very few triage tools get this right.
- **Honesty gates.** `STRICT_NO_HEURISTIC` → `INSUFFICIENT‑EVIDENCE` when the real ML safety stack didn't run; lookup‑first returns measured values with `provenance="experimental"`; the conservative GO‑guard downgrades GO→WATCH on any of five failure conditions. The whole codebase carries provenance per value. This is the product's actual moat.
- **Verdict‑consistent banded score** (GO ∈ [70,100], WATCH ∈ [40,69], NO‑GO ∈ [1,39]) guarantees a library sort never ranks a vetoed compound above a salvageable one. Smart.

### 3.2 Concrete improvements — code‑wise

1. **`l1Scorecard.ts` is a 1,306‑line god‑function.** `computeL1Scorecard` is ~760 lines. Split into pure sub‑scorers (`scorePotency`, `scoreSafety`, `scoreDevelopability`, `assembleVerdict`) in a `l1/` folder. It will make the logic unit‑testable in isolation and reviewable. No behaviour change — pure refactor.
2. **Tests are a scratch file, not a suite.** `_l1regression.mts` is an inert "SAFE TO DELETE" stub that *says* 8/8 passed but doesn't run in CI. **Promote the archetype suite to a real Vitest/Jest suite** (the 9 cases described in `L1_VALIDATION_REPORT.md` §4) and gate merges on it. This is the highest‑value low‑effort code task — the verdict logic is exactly the kind of thing that silently regresses.
3. **Magic numbers inside the desirability/score maps.** Potency bands (`ic50 < 10 ? 96 : ...`), selectivity bands (`n<=0?95:...`), and the drug‑likeness blend (`qed*70 + ...`) are inline literals. Move them into `l1Thresholds.json` alongside the veto thresholds so all tunable science lives in one auditable file.
4. **Safety‑dimension detection by regex** (`/hERG|DILI|Ames|toxicity|Mitochondrial|ATAD5|Endocrine/i`) is fragile — rename a dimension label and `mlCoverage` silently breaks. Tag dimensions with an explicit `axis: "safety" | "adme" | ...` field instead of string‑matching the display label.
5. **The recalibration script has never been run on the live ADMET‑AI distribution** (per `L1_HONEST_READINESS.md` items #1–2). Thresholds are "sensible defaults." Until `scripts/recalibrate-l1-thresholds.mjs` runs against real model outputs on a frozen hold‑out, the "FPR ≤ 5%" claim is aspirational, not measured. **This is a correctness gap, not a style nit.**
6. **`known_drugs` table is 18 rows.** The whole lookup‑first moat depends on coverage; 18 drugs means almost every real query falls through to the ML path. The DrugCentral 2024 build to ~4,600 rows is described but not shipped. Ship it.
7. **No request‑level caching / rate‑limit handling visible at the orchestration layer** for the external APIs (ChEMBL returns frequent 500s — you already note this). The read‑across path got retry+session‑cache; generalize that to a single shared HTTP client with caching + backoff for *all* external calls (PubChem, UniProt, DrugCentral).

### 3.3 Concrete improvements — logic / science‑wise

1. **The biggest scientific gap is PK.** L1 has ADMET endpoints but **no quantitative pharmacokinetics** — no predicted plasma concentration‑time curve, no AUC/Cmax, no human dose projection beyond allometric class rules. Everything Certara sells starts here. (Section 5.)
2. **DDI is a single WATCH flag, not a model.** Today CYP inhibition raises one "Strong CYP inhibition (DDI risk)" flag at p ≥ 0.70. There is no `[I]/Ki`, no R‑value, no AUC‑ratio. A **mechanistic‑static DDI model** (FDA‑guidance R1/R2) is a few hundred lines of pure Python and turns a vague flag into a quantitative, regulator‑recognized readout. (Section 5.)
3. **No post‑market safety grounding.** You predict DILI/hERG but never check whether a *matched or analogous* drug actually has FAERS adverse‑event signals or a DailyMed boxed warning. Real‑world pharmacovigilance is free via openFDA and would make the safety verdict far more credible.
4. **Weak endpoints are scored as if equal.** ADMET‑AI's VDss (R²≈−1.2) and half‑life (R²≈−2.4) are *worse than guessing* yet feed Distribution/Metabolism dims at face value. Down‑weight or label them "directional only," and prefer stronger Ersilia/clearance heads where they exist (your roadmap P2 — do it).
5. **Selectivity/off‑target panel is latency‑gated**, so most molecules don't get it. Serve DeepDTA warm + cache so Selectivity is real for *every* molecule (roadmap P1).
6. **No conformal prediction intervals on numeric outputs.** You return a point + coarse High/Moderate/Low. A real conformal layer (Vovk/Romano; Conformalized Graph Learning for ADMET, *JCIM* 2024) gives calibrated 80/90/95% CIs with a coverage guarantee. This is the single upgrade your own docs (correctly) flag as the one that survives a chemist's scrutiny.

**Bottom line on code:** architecture and scientific reasoning are strong; the gaps are (a) test/CI rigor, (b) un‑run calibration, (c) thin lookup coverage, and (d) missing quantitative PK/DDI. None are rewrites — they're additive.

---

## 4. Is it a good product? Competitive positioning

Yes — with a clear lane. Here's the landscape you're implicitly competing in:

| Player | What they own | Price / access | Where Hakase wins / loses |
|---|---|---|---|
| **Certara Simcyp** (V24, Apr 2025; **EMA‑qualified for DDI**, Aug 2025) | Gold‑standard population PBPK, IVIVE, CYP+transporter DDI, virtual bioequivalence, special populations, first‑in‑human dosing | $$$$ enterprise license, desktop, steep expertise curve | **Loses** on quantitative PBPK/DDI depth & regulatory standing. **Wins** on early‑discovery triage speed, novel‑chemistry handling, modern UI, AI‑native, price |
| **Simulations Plus GastroPlus** | Absorption/PBPK, formulation/biopharmaceutics, ADMET Predictor | $$$$ enterprise | Same shape as Simcyp |
| **Schrödinger** | Physics‑based potency/FEP, structure‑based design | $$$$ + compute | Hakase already has a FEP/docking/co‑folding runpod stack; not the core L1 fight |
| **Open ADMET front‑ends** (ADMET‑AI, SwissADME, pkCSM, Deep‑PK) | Free endpoint predictions | Free, no verdict logic, no provenance, no PK | **Hakase wins** decisively — they have endpoints, you have a *calibrated decision* with provenance |

**The strategic read:** Simcyp is a deep, expensive, expert‑operated *quantitative PK* tool used **later** (IND‑enabling, clinical pharmacology). Hakase L1 is a fast, AI‑native *triage* tool used **earlier** (which compounds to even make). You don't beat Simcyp at PBPK on day one — but you can **absorb the 20% of Simcyp's methodology that matters at the triage stage** (mechanistic‑static DDI, a PK‑Sim‑backed first‑pass PBPK, IVIVE dose projection) and offer it inside a calibrated GO/NO‑GO that Simcyp doesn't provide. That combination — "Simcyp‑grade early signals + a defensible verdict, in one click" — is a real product wedge.

---

## 5. The enhancement plan — APIs, data sources & industry logic

Organized as four workstreams. Each item lists the concrete API/library, what it unlocks, and where it plugs into the existing code.

### Workstream A — Quantitative PK / PBPK (the Simcyp gap, highest leverage)

This is what turns "ADMET endpoints" into "a digital twin." Three escalating tiers:

**A1 — IVIVE + 1‑compartment human‑dose projection (fast win, pure Python).**
You already predict CLint (hepatocyte), fu, Caco‑2, MW, logP. Add the well‑stirred liver model to scale CLint → hepatic CL, combine with allometric Vd, and emit predicted **human CL, Vd, t½, F%, and a first‑in‑human dose band** with a concentration‑time curve. New endpoint `POST /predict/pk/ivive`. ~1–2 weeks. No external dependency.

**A2 — Mechanistic‑static DDI model (FDA‑guidance, regulator‑recognized).**
Implement the FDA basic + mechanistic‑static equations: R1 = 1 + [I]/Ki (reversible), R2 for time‑dependent inhibition, and the AUC‑ratio with fm/Fg. Inputs you already have or can get from ChEMBL/ADMET‑AI (CYP inhibition probabilities → Ki estimates, fu, Cmax from A1). Output: per‑CYP **AUC‑ratio (AUCR)** with the FDA 1.25/2/5 risk bands instead of a single WATCH flag. New endpoint `POST /predict/ddi/static`. ~1–2 weeks, pure Python. *This is the single most "Certara‑like" thing you can ship cheaply.*

**A3 — Full whole‑body PBPK via PK‑Sim / Open Systems Pharmacology.**
Your registry already lists this as roadmap (`open_source_registry.py` → "Open‑source PBPK (PK‑Sim / Pumas.jl / mrgsolve)"). PK‑Sim/MoBi is **open‑source (since 2016, OSP suite)** and scriptable; `mrgsolve` (R) and `Pumas.jl` (Julia) are the lighter‑weight simulation engines. Wrap a PK‑Sim model template behind `POST /predict/pbpk` to produce concentration‑time profiles in virtual populations (the Simcyp headline feature) — including special populations (hepatic/renal impairment, pediatric). Bigger lift (4–8 weeks incl. a worker container) but it's the capability that lets you say "PBPK" honestly. Start with A1/A2 and treat A3 as the flagship.

### Workstream B — Live measured‑data enrichment (cheap, high‑credibility APIs)

These are free public APIs that ground predictions in real measured/clinical data. All are HTTP/JSON or GraphQL — drop‑in for your existing external‑API pattern.

| Source | API | What it adds to L1 | Plug‑in point |
|---|---|---|---|
| **openFDA / FAERS** | `api.fda.gov/drug/event` | Real post‑market adverse‑event counts for matched/analog drugs → grounds the safety verdict in human pharmacovigilance | New `safety enrichment` flag on lookup + analog hits |
| **DailyMed** | NIH SPL API | FDA boxed warnings, contraindications, DDI label sections | Same; surfaces "this analog carries a boxed warning" |
| **Open Targets Platform** | GraphQL (`api.platform.opentargets.org`) + **official MCP server** | Target tractability, genetic association, known‑drug & target‑safety evidence | Target‑validation panel feeding the Selectivity/efficacy story |
| **EPA CompTox / ToxCast (CTX API)** | invitrodb v4.3 (Aug 2025) | *Measured* in‑vitro bioactivity / Tox21 for the query or analogs → turns predicted Tox21 into measured where it exists | Read‑across anchoring + Tox21 dim provenance upgrade |
| **DrugCentral** | bulk + REST | Expand `known_drugs.py` 18 → ~4,600 approved/investigational with measured ADMET | Lookup‑first coverage (the moat) |
| **PharmGKB** | REST | CYP pharmacogenomic variants → DDI/dosing context | DDI model (A2) population context |
| **BindingDB / ChEMBL** (already wired) | REST | Keep; use for Ki priors in the DDI model and measured analog anchoring | A2 + read‑across |

**Note — you already have these as live MCP tools in this workspace:** `chembl` (compound/target/bioactivity/admet/mechanism), `c-trials` (ClinicalTrials.gov), `pubmed`, `consensus`, `biorxiv`, and Open Targets (`ot`). The agent layer can call them today for evidence/citations even before the service‑level HTTP integrations ship.

### Workstream C — Statistical rigor (the "survives a chemist" upgrades)

- **C1 — Conformal prediction intervals** per numeric endpoint (Vovk/Romano; *JCIM* 2024 conformalized graph learning). Replace High/Moderate/Low with calibrated CIs and a coverage guarantee. ~3–5 days once a calibration split is frozen.
- **C2 — Run the recalibration for real + freeze the validation set.** Execute `recalibrate-l1-thresholds.mjs` against the live ADMET‑AI distribution on a frozen DrugCentral approved/withdrawn hold‑out, then auto‑emit a one‑command **report card** (the "≤5% FPR on 152 FDA drugs, ≥90% recall on withdrawn — with receipts" claim). Partially built; finish it.
- **C3 — Mechanistic hepatotoxicity sub‑score.** Fuse DILI + BSEP + reactive‑metabolite + SR‑MMP into one explainable liver‑risk readout. You have all the parts; this is a differentiated, sellable signal.

### Workstream D — Engineering hardening

- **D1** — Promote the L1 archetype tests to a real CI‑gated suite (Section 3.2 #2).
- **D2** — Refactor `computeL1Scorecard` into pure sub‑scorers; move magic numbers into `l1Thresholds.json`.
- **D3** — One shared cached + backoff HTTP client for all external APIs.
- **D4** — Tag dimensions with an explicit `axis` field; kill the regex‑based safety detection.

---

## 6. Sequenced roadmap ("give 100%")

A pragmatic order that ships credibility fast, then depth:

**Sprint 1 (≈2 wks) — Make the current claims true.** C2 (run calibration + frozen report card), D1 (real test suite), ship the DrugCentral lookup expansion (18→~4,600). *Outcome: every claim in your sales deck is now measured, not aspirational.*

**Sprint 2 (≈2–3 wks) — The cheap Simcyp wedge.** A1 (IVIVE human‑dose + C‑t curve) and A2 (mechanistic‑static DDI with AUCR bands). *Outcome: you now output quantitative PK and a regulator‑recognized DDI readout — the first things a pharma PK scientist asks for.*

**Sprint 3 (≈2 wks) — Ground in real data.** B (openFDA/FAERS + DailyMed + ToxCast measured anchoring + Open Targets). C1 (conformal intervals). *Outcome: predictions are cross‑checked against measured human/in‑vitro data; numbers carry honest CIs.*

**Sprint 4 (≈4–8 wks) — The flagship.** A3 (PK‑Sim/OSP whole‑body PBPK with virtual populations). C3 (mechanistic hepatotox sub‑score). D2–D4 (refactor + hardening). *Outcome: you can say "PBPK" and "virtual population" honestly, with a calibrated verdict Simcyp doesn't offer.*

---

## 7. Honest limits to keep stating

For a novel molecule against a novel target, every model is extrapolating — ground truth is wet‑lab data, and pharma's own internal models sit around AUROC ~0.85 (hERG), ~0.88 (DILI), MAE ~0.8–1.0 log for potency. The right word is **"calibrated," not "accurate."** Keep the discipline you already have: provenance on every number, `INSUFFICIENT‑EVIDENCE` over a fabricated GO, applicability‑domain visible on every result. Even a PK‑Sim PBPK layer is only as good as its inputs — present it as a *first‑pass model to be confirmed*, the same way Certara's own outputs require expert qualification. That framing is what makes the stronger capabilities credible rather than over‑claimed.

---

### Sources

- Simcyp PBPK Simulator — Certara. <https://www.certara.com/software/simcyp-pbpk/>
- Simcyp V24 / EMA DDI qualification (2025) — Certara guide. <https://intuitionlabs.ai/articles/certara-drug-development-software-guide>
- Using the Simcyp R Package for PBPK Workflows — PMC. <https://pmc.ncbi.nlm.nih.gov/articles/PMC12072214/>
- PK‑Sim / Open Systems Pharmacology (open‑source PBPK). <https://github.com/Open-Systems-Pharmacology/PK-Sim>
- OSP Community (open access modeling & simulation) — PMC. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6930856/>
- Mechanistic‑static DDI models for regulatory filing — *Clin Pharmacokinet* 2022. <https://link.springer.com/article/10.1007/s40262-022-01204-4>
- Static vs Dynamic CYP DDI model predictions — *Clin Pharmacokinet* 2024. <https://pmc.ncbi.nlm.nih.gov/articles/PMC11762507/>
- openFDA Drug Adverse Event (FAERS) API. <https://open.fda.gov/apis/drug/event/>
- Open Targets Platform GraphQL API. <https://platform.opentargets.org/api> · MCP server <https://github.com/opentargets/open-targets-platform-mcp>
- EPA CompTox / ToxCast CTX APIs (invitrodb v4.3, Aug 2025). <https://www.epa.gov/comptox-tools/computational-toxicology-and-exposure-apis-data-domains>
- ADMET‑AI (Swanson et al., *Bioinformatics* 2024). <https://github.com/swansonk14/admet_ai>
- Conformalized Graph Learning for ADMET — *JCIM* 2024. <https://pubs.acs.org/doi/10.1021/acs.jcim.4c01139>
- Waring et al. (2015) attrition analysis — *Nat Rev Drug Discov* 14:475. <https://www.nature.com/articles/nrd4609>
