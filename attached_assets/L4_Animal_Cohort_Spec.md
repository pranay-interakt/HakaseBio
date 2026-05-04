# Layer 4 — Animal Cohort

**Color:** Emerald · **Icon:** Rabbit · **Slot:** `activeLayer === 4` in `HakaseAI.tsx`
**Source code:** `artifacts/hakase-ai/src/lib/animalSim.ts` (sim) + `HakaseAI.tsx` lines ~4047–4353 (UI) + `Layer2AnimalResults` component at line ~7478 (results render).
**Position in cascade:** L1 In Vitro → L2 In Silico → L3 Ex Vivo → **L4 Animal Cohort** → handoff to Hakase Clinical (Phase 1).

---

## 1. What L4 is

The last pre-clinical layer. It takes the L1 In Vitro readout (RDKit descriptors + ADMET + tox alerts + binding IC50) and runs an in-silico animal-study simulator that produces an **IND-enabling package**: a GLP-grade study design, animal PK/PD, NOAEL/MTD bands, allometric scaling to human, FIH (First-In-Human) starting dose, ICH/OECD regulatory checklist, and a formulation/BCS analysis. The pre-clinical package + tissue-selectivity dossier from L3 is then handed off to Hakase Clinical for Phase 1 design (architecture doc §8 — boundary of pre-clinical scope).

**Cascade gate:** Run-button is disabled until L1 has completed AND `cascadeGate.canAutoCascade === true`. If the upstream gate fails, the user can record an explicit override (logged with justification); otherwise L4 cannot be run.

---

## 2. Inputs (UI controls)

The left rail of L4 lets the user pick four things; each can be auto-configured from L1 and overridden manually (the "L1 Auto" violet pill marks auto-configured fields).

| Control | Options | Notes |
| --- | --- | --- |
| **Species / Strain** | Mouse CD-1, Mouse C57BL/6, Rat Sprague Dawley, Rat Wistar, Beagle Dog, Cynomolgus Monkey | Each has its own body weight, FDA Km factor, GFR, hepatic blood flow, cardiac output, clearance scale factor, allometric t½ exponent, CYP3A4/2D6/2C9 activity, plasma protein binding correction, and a regulatory-use blurb. |
| **Study Type** | Single Dose (Acute, OECD 423), Sub-Acute 14-Day (OECD 407), Sub-Chronic 28-Day GLP (OECD 407 / ICH S4A), Chronic 90-Day GLP (OECD 408 / ICH S4A) | Each carries duration weeks, animals/sex (rodent vs non-rodent), recovery group flag, satellite TK flag. |
| **Route of Administration** | Oral, IV, SC, IM, Topical, Inhalation | Drives bioavailability F% baseline (IV=1.0; SC≈0.75–0.90; Oral computed from physchem + BCS + formulation). |
| **Formulation** *(only for Oral)* | Plain, lipid-based, amorphous solid dispersion, nanocrystal, SEDDS, etc. (per `formulationDB.ts`) | FDA IIG-tagged. Auto-suggested when L1 logP/MW indicates BCS Class II/IV. |

In addition the L1→L4 cascade panel echoes the live L1 values that are flowing in (compound name, MW, logP, TPSA, predicted absorption %, Go/No-Go).

---

## 3. Outputs — exhaustive list

All outputs come from `AnimalCohortResults` (`animalSim.ts:147`). Grouped by section:

### 3.1 Study identity
- **Species block** — full `SpeciesParams` (species, strain, body weight g, FDA Km factor, GFR, hepatic blood flow, cardiac output, CYP3A4/2D6/2C9 activity, regulatory use).
- **Study type block** — label, OECD #, ICH #, duration weeks, animals/sex split, recovery/satellite flags.
- **Route of administration** — echoed.

### 3.2 Animal PK (at NOAEL/2)
- **NOAEL** (mg/kg/day) — No-Observed-Adverse-Effect Level. Computed as `therapeutic_dose × safety_factor × stochastic_jitter`, where `therapeutic_dose` is back-calculated from L1 binding IC50 (10× IC50 target Cmax) and `safety_factor ∈ [4, 10]` decreases with L1 toxicity score.
- **NOAEL band** — `loqNoael` (×0.75) and `hiNoael` (×1.35) confidence bracket.
- **MTD** (mg/kg/day) — Maximum Tolerated Dose, typically 5–10× NOAEL.
- **animalCmax** (ng/mL) — peak plasma concentration in the chosen species at NOAEL/2.
- **animalAuc** (ng·h/mL) — area under the PK curve over ~6×t½.
- **animalHalfLife** (h) — `ln(2) / ke`, where `ke = CL/Vd`.
- **animalClearance** (L/h/kg) — allometrically scaled from human CL using exponent 0.75 and species `clScaleFactor`.
- **animalPkCurve** — 60-point time-vs-concentration trace (1-compartment oral model with absorption rate ka, or IV bolus). Plotted as the animal PK chart.

### 3.3 Human Translation Panel (FIH)
- **HED (BSA method)** (mg/kg) — FDA Guidance 2005 allometric: `HED = NOAEL × (Km_animal / 37)`.
- **HED (PBPK-refined)** (mg/kg) — clearance-corrected refinement of the BSA method.
- **FIH dose** (mg absolute, for 70 kg adult) — conservative `min(HED_BSA, HED_PBPK) / 10`.
- **FIH dose** (mg/kg).
- **Safety margin vs NOAEL** (×) — `HED / NOAEL`.
- **Safety margin vs MTD** (×) — `HED / MTD`.
- **humanCmax** (ng/mL) — projected human peak at FIH dose.
- **humanAuc** (ng·h/mL) — projected human AUC.
- **humanHalfLife** (h) — projected human t½.
- **humanPkCurve** — 60-point projected human PK trace, plotted alongside the animal curve.

### 3.4 Study group design
A list of `StudyGroup` entries auto-generated from NOAEL:
- **Vehicle Control** (dose 0)
- **Low Dose** (NOAEL / 10)
- **Mid Dose** (geometric mean of low and high)
- **High Dose (NOAEL)** (full NOAEL)
- **Recovery (High)** *(only if `studyType.recoveryGroup`)* — half-size, off-dose recovery cohort
- **Satellite TK** *(only if `studyType.satelliteTK`)* — small toxicokinetic sampling cohort

For each group: dose level (mg/kg/day), dose multiple (× projected therapeutic dose), n per sex, color tag.

- **totalAnimals** — sum across all groups (× 2 for both sexes).
- **estimatedCostM** ($M) — `totalAnimals × cost-per-animal × duration multiplier` (rodent $0.8K, non-rodent $8K, +4% per study week).

### 3.5 Toxicity flags
A `ToxicityFlag[]` is derived from L1 ADMET tox score + L1 `toxAlerts` categories + structural rules. Each flag has: organ, risk level (low/moderate/high), basis (citation), finding (predicted observation), ICH guideline reference. Rules currently produce flags for:
- **Cardiovascular** — fires if `cardioRisk > 0.5` OR `logP > 4.5`. Cites ICH S7B (hERG / QT prolongation).
- **Hepatic** — fires if `hepatoRisk > 0.4`. Cites ICH S9 / DILI guidance (ALT/AST elevation).
- **Genotoxicity** — fires if `toxScore > 0.6`. Cites ICH S2(R1) (Ames + clastogenicity).
- **Tissue Accumulation** — fires if `MW > 500` AND `logP > 3`. Cites ICH S4A.
- **General Systemic (low risk)** — emitted when nothing else fires.

- **overallRisk** — high if any flag is high; moderate if any flag is moderate; else low.

### 3.6 Regulatory checklist
A 7-line `ChecklistItem[]` (each: guideline, requirement, pass/warn/n-a, note). Items:
1. **ICH M3(R2)** — Rodent repeat-dose tox (IND-enabling)
2. **ICH S4A** — Non-rodent repeat-dose tox
3. **ICH S7A** — Safety pharmacology (CNS, CV, Respiratory)
4. **ICH S7B** — hERG / QT interval assessment
5. **ICH S2(R1)** — Genotoxicity battery (Ames + clastogenicity)
6. **FDA Guidance 2005** — FIH dose calculation (allometric scaling) — note carries the actual HED + FIH numbers
7. **OECD 423 / 407** — GLP compliance documentation — note carries totalAnimals + protocol type

- **indEnablingComplete** — true if all items pass, OR at most one item is "warn".

### 3.7 Species justification
A multi-sentence prose paragraph (`speciesJustification`) auto-composed from species + study + HED + safety-margin numbers. Used in the IND application narrative.

### 3.8 Formulation / BCS result
`formulationResult` from `computeFormulationImpact()` — BCS class, base F%, formulated F%, excipient list, in-vivo permeability/solubility flags, FDA IIG references.

### 3.9 Provenance footer (`ProvenanceFooter`)
Every L4 result card is followed by a `provenanceL4` footer recording the engine (`animalSim.ts`), runtime, SMILES, and any database queries used (e.g. ChEMBL lookups for the binding IC50 source). If any upstream DB call degraded gracefully, a `GracefulDegradationBanner` is shown above the results.

### 3.10 Safety-flag cascade
- `getFlagsForLayer(safetyFlags, 4)` — any safety flag escalating from upstream layers is rendered in a `SafetyFlagCascadeBanner`.
- `safetyOverrides.filter(o => o.toLayer <= 4)` — any user-recorded override for L4 (with justification) is rendered in an `OverrideBanner`.

### 3.11 Live recommendation strip
Above the form, a dynamic recommendations panel renders amber/blue/emerald cards based on the live L1 values and (after run) the L4 outputs. Examples:
- Toxicity > 60% → recommend more tolerant species + 1/20 NOAEL starting dose.
- LogP > 5 → recommend lipid-based or amorphous solid dispersion formulation.
- Absorption < 45% → recommend IV/IP route or formulation enhancement.
- Half-life < 2 h → flag multiple daily doses or modified-release formulation.
- Half-life > 24 h → confirm QD feasibility, monitor accumulation in renally-impaired populations.
- NOAEL safety margin < 3× → recommend more conservative starting dose.
- All clean → "pre-clinical package ready for handoff to Hakase Clinical".

---

## 4. Outputs at a glance (TL;DR for the question "what do we get from Animal Cohort?")

After clicking **Run Animal Cohort Simulation**, the user gets, in one panel:

1. **NOAEL + MTD + confidence band** (mg/kg/day).
2. **Animal PK** — Cmax, AUC, half-life, clearance, plus a plotted concentration-vs-time curve.
3. **Human Translation Panel** — two HED estimates (BSA + PBPK), the proposed **FIH starting dose** (both mg/kg and absolute mg for a 70 kg adult), safety margins vs NOAEL and MTD, and a projected human PK curve overlaid on the animal curve.
4. **Auto-generated GLP study design** — dose groups (control / low / mid / high, plus recovery and satellite TK when applicable), animals per sex, total animal count, estimated $M cost.
5. **Toxicity flag panel** — per-organ findings (cardio / hepatic / genotox / accumulation), each tied to an ICH guideline, plus an overall risk verdict.
6. **Regulatory checklist** — 7 IND-enabling items (ICH M3, S4A, S7A, S7B, S2(R1), FDA 2005, OECD), each marked pass/warn with the actual numbers in the note. Aggregated as `indEnablingComplete: boolean`.
7. **Auto-written species justification paragraph** — drop-in text for the IND narrative.
8. **Formulation / BCS analysis** — class, base vs formulated F%, excipient suggestions.
9. **Provenance footer** — engine, runtime, SMILES, DB query log, and any graceful-degradation warnings.
10. **Live recommendations strip** — actionable warnings / OKs triggered by the L1 inputs and L4 results.

---

## 5. What L4 explicitly does **not** produce

- **No real animal data** — every number is in-silico per `animalSim.ts`. Outputs are simulated, deterministic given a seed (default 42). The provenance footer makes the engine source explicit.
- **No GxP-signed documents** — the regulatory checklist is a planning artifact, not a regulatory submission.
- **No tissue-selectivity dossier** — that comes from L3 and is appended at the handoff to Hakase Clinical, not generated inside L4.
- **No Phase 1 trial design** — handed off to Hakase Clinical via API per architecture doc §8. The legacy "Patient Cohort Twin" / "Trial Twin" panels are preserved as dead code behind `HIDE_PATIENT_TRIAL_LAYERS = true` in `lib/layerArchitecture.ts`.

---

## 6. Code map (where each output is produced)

| Output | Source |
| --- | --- |
| Species library + Km factors | `animalSim.ts` `SPECIES_LIBRARY` |
| Study type configs | `animalSim.ts` `STUDY_TYPES` |
| Bioavailability (oral, BCS-aware) | `computeFormulationImpact()` in `formulationDB.ts` + physchem rules in `runAnimalCohortSimulation` |
| Vd, CL, ke, t½, ka, tmax | `runAnimalCohortSimulation` (allometric scaling, exponent 0.75) |
| Animal & human PK curves | `generatePkCurve()` (1-compartment oral or IV bolus) |
| NOAEL / MTD | `runAnimalCohortSimulation` (L1 IC50-derived therapeutic dose × safety factor) |
| HED (BSA) | `noael × (Km_animal / 37)` per FDA Guidance 2005 |
| HED (PBPK) | `hedBsa × (CL_human_actual / CL_human_default)` |
| FIH dose | `min(hedBsa, hedPbpk) / 10` |
| Study groups & total animals | `studyGroups` block (control, low, mid, NOAEL, recovery?, satellite?) |
| Cost estimate | `(totalAnimals × $/animal × duration multiplier) / 1000` |
| Tox flags | Rule-based (`toxScore`, `hepatoRisk`, `cardioRisk`, MW+logP) |
| Regulatory checklist | 7 hard-coded line items, status derived from species/study/risk |
| Species justification text | Concatenation in `runAnimalCohortSimulation` |
| Formulation result | `computeFormulationImpact` |
| Render | `Layer2AnimalResults` in `HakaseAI.tsx` (line ~7478) |
| Provenance footer | `ProvenanceFooter` + `provenanceL4` from `createProvenance("animalSim.ts", ...)` |
| Cascade-gate enforcement | `cascadeGate.canAutoCascade` + `cascadeOverride` in `HakaseAI.tsx` |
