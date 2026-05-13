# HakaseAI — BioDigital Twin Platform
## Combined Platform Documentation & User Guide
### Version 2.0 · May 2026

> Single source of truth replacing the legacy `hakase-ai-user-manual.md` (March 2026, 3-layer trial-twin) and `HakaseBio_Platform_Documentation.md` (4-layer cohort/trial). HakaseAI is now a **pre-clinical-only** BioDigital Twin platform; trial-twin, K-M curves, virtual patient cohorts, adaptive design, and site rankings have been retired. The canonical engineering reference for layer internals remains `artifacts/hakase-ai/docs/LAYERS_REFERENCE.md` — this document is the product- and user-facing companion.

---

## Table of Contents

1. What HakaseAI Is
2. Core Operating Principles
3. Site Map & Navigation
4. The Dashboard at a Glance
5. Layer 1 — In-Vitro Twin
6. Layer 2 — Confirmation (In-Silico ↔ Ex-Vivo)
7. The IVIVE Gate
8. Layer 3 — Animal Cohort
9. Layer 4 — First-In-Human Readiness
10. Cross-Cutting Surfaces (HAIOps, Regulatory Outlook, Safety Flags, Provenance)
11. Importing Molecules, Targets, and Projects
12. 3D Molecular Viewer
13. Exports & Sealed Handoffs
14. Marketing & Information Pages
15. Quick Reference (thresholds, runtimes, routes, glossary)

---

## 1. What HakaseAI Is

HakaseAI is a four-layer BioDigital Twin for **pre-clinical drug development**. It takes a candidate molecule and walks it through every gate that stands between a SMILES string and a defensible First-In-Human readiness package — without inventing data and without papering over missing measurements.

| # | Layer | Brand color | Question it answers |
|---|---|---|---|
| 1 | **In-Vitro Twin** | Violet | Is this molecule drug-like, safe, and worth confirming? |
| 2 | **Confirmation Layer** (In-Silico + Ex-Vivo) | Cyan / Teal | Do orthogonal in-silico + ex-vivo evidence streams agree on what L1 said? |
| — | **IVIVE Gate** | Cyan ↔ Amber | Is the cross-species substrate strong enough to justify animal study design? |
| 3 | **Animal Cohort** | Amber | What does the multi-species PBPK study look like, and what NOAEL / HED falls out? |
| 4 | **First-In-Human Readiness** | Emerald | What MABEL-biased starting dose and IND-enabling package follow? |

Each layer hands off a **typed, sealed evidence block** to the next. The L4 output is a `PreClinicalPackage v2.0.0` — a tamper-evident bundle a CRO, regulator, or licensing partner can ingest as-is. The platform's product surface is everything *up to* IND submission; the legacy clinical-trial simulator has been removed.

---

## 2. Core Operating Principles

These are not aspirations; they are enforced in code and surfaced in the UI.

### Anti-fabrication
- Empty / unrunnable values render as **`—`**, never `0`, never a literature midpoint.
- No silent fallbacks. When a database degrades (UniProt, ChEMBL, BindingDB, AlphaFold, GTEx, Tabula Sapiens, etc.), the **External Validation Sources Unavailable** banner appears and explicitly states no values were injected.
- Class-median substrate (e.g. Lombardo 2018 / Smith 2010 fu_p anchors in IVIVE) is allowed only behind explicit `CLASS-MEDIAN` pills and a substrate-mode tag that propagates downstream.

### Source-quality tiered evidence
Every output ships with a tier badge, surfaced everywhere a number appears. The ladder splits into a *computed* side and a *substrate* side because the regulatory weight of "computed by us" vs "anchored against external evidence" is fundamentally different.

**Computed-side tiers** (platform-generated):

| Tier | Meaning |
|---|---|
| `HEURISTIC` | Rule- or descriptor-based. Lowest confidence; below most stage-gate thresholds. |
| `STRUCTURAL` | Derived from validated structural rules (e.g. Lipinski, structural alerts). |
| `ML` | A pre-trained model with disclosed corpus + version (ESM2, Chemprop, DeepDTA, Cardiotox-ML, DILI-ML, Drug2cell + Tabula Sapiens v2, DepMap PRISM 24Q2, …). |

**Substrate-side tiers** (external evidence anchored to *this* compound or its class):

| Tier | Meaning |
|---|---|
| `LITERATURE` | Published value with DOI / PMID for this exact compound or a sufficiently-similar congener (Tanimoto ≥ 0.4). Sources: FDA Drug Approval Packages, DrugBank PK panel, PK-DB, Open TG-GATEs, eTRANSAFE, primary literature. **Satisfies** the IVIVE cross-species defensibility rule. |
| `IN-HOUSE` | Bench / CRO measurement supplied by the operating team, with assay method + lab + date. **Satisfies** the IVIVE cross-species defensibility rule. |
| `CLASS-MEDIAN` | Drug-class median anchor (Lombardo 2018 fu_p, Smith 2010 PPB). Keeps downstream math runnable but does **not** satisfy the cross-species rule. |

> **Transition note.** In this release the in-app IVIVE cell badge still reads `MEASURED` for both LITERATURE and IN-HOUSE inputs; the schema split that exposes the distinction per cell is a planned follow-up. Marketing surfaces and the cross-species rule already use the new ladder.

### Cascade gates and overrides
- The **Cascade Gate** (L1 → L3) blocks any compound whose verdict is `NO-GO`, whose safety key falls below 0.6, or whose non-safety average falls below 0.6.
- Blocked compounds raise a **Stage-Gate Review Required** banner with a `BLOCKED BY` chip list, per-output quality detail, and an *Override & advance to L3* button.
- Every override (Stage-Gate, IVIVE sign-off, Confirmation seal) requires actor + role + justification + authority citation, all persisted to the provenance trail.

### Stale-results guard
The dashboard clears `simResults` and `inVitroResults` whenever the live SMILES diverges from the SMILES that produced the current results. The radar and organ panels never linger on the previous compound's numbers while the live Lipinski strip already reflects a new structure.

---

## 3. Site Map & Navigation

The product runs as a single web artifact (`artifacts/hakase-ai/`) with a public marketing site and a dashboard behind login.

| Route | Purpose | Audience |
|---|---|---|
| `/` (Landing) | Hero pitch, four-layer pipeline strip, step-by-step flow, server-side bullet list, privacy notice | Visitor |
| `/platform` | Architecture deep-dive — overview cards plus L1 / L2 / L3 / L4 sections with screenshots | Visitor (technical) |
| `/story` | Two parallel narratives — Simple (3-question framing including FIH readiness) and Technical (layer-by-layer breakdown) | Visitor |
| `/ivive` | The IVIVE Gate — measurements, tier ladder, math anchors, hard-block / soft-warn / sign-off | Visitor (technical) |
| `/regulatory` | Cross-layer Regulatory Outlook — coverage matrix per layer, methodology pillars, sealed handoff | Visitor (regulatory) |
| `/haiops` | HAIOps governance — five pillars, safety flag cascade, model lifecycle, compliance | Visitor (governance / QA) |
| `/apis` | Live external APIs, reference databases, computation engines, data-flow overview | Visitor (technical) |
| `/advanced` | Tier / upgrade overview reflecting the four pre-clinical layers | Visitor |
| `/privacy` | Privacy policy | Visitor |
| `/login` | Sign-in | User |
| `/app` (dashboard) | The four-layer simulation workspace | Authenticated user |

The top navigation bar exposes all of these as a dropdown; the dropdown labels match the L1–L4 model and no longer reference the retired trial-twin.

---

## 4. The Dashboard at a Glance

The dashboard occupies the route under `/app` and is structured as four persistent zones:

- **Top bar** — logo · four-step layer stepper (L1 In-Vitro · L2 Confirmation · L3 Animal Cohort · L4 FIH Readiness) · notification + settings.
- **Projects sidebar** (collapsible) — current project metadata, list of saved projects, *+ New Project* button, *Import via API* panel.
- **Main content area** — inputs on the left, results on the right.
- **Status bar** — appears below the stepper when a simulation is running, showing the layer name, current substage, percent complete, and a *Cancel* button. On completion a success banner appears with a *Continue to [Next Layer]* button.

### Layer stepper behaviour

- Active layer is highlighted in the layer's brand color (violet / cyan / amber / emerald).
- Completed layers show a checkmark.
- Layers with a running simulation show a spinner.
- Click any step to jump to that layer; gating banners (e.g. Stage-Gate Review, IVIVE block) prevent advancing past a blocked transition.

### Projects sidebar

- **Current Project** shows compound name (auto-filled from SMILES), UniProt target, indication, and a four-segment progress bar (one per layer).
- **Saved Projects** lists past runs with their L1 verdict (`GO` / `WATCH` / `NO-GO`), key metrics, and timestamps. Click to load.
- **+ New Project** resets all inputs and results.

### Importing a project via API

The *Import via API* panel pulls existing studies or publications. Choose a source, enter an ID, hit *Fetch*:

| Source | What to enter | Example |
|---|---|---|
| ClinicalTrials.gov | NCT number | `NCT04292899` |
| PubMed | PMID | `36150754` |
| LIMS | Record ID | `LIMS-2024-001` |
| EHR / Epic | Study or patient record ID | `PAT-001` |

A result card surfaces project name, indication, phase, and sponsor; *Add* saves it to your project list. Importing a publication or trial does **not** auto-populate molecule fields — those still come from the L1 input panel.

---

## 5. Layer 1 — In-Vitro Twin

> **Goal.** Take a SMILES + (optional) target and produce ADMET, binding, toxicity, selectivity, and a `GO` / `NO-GO` / `MAYBE` verdict.

### 5.1 Inputs

| Field | Notes |
|---|---|
| **SMILES string** | Canonicalised + validated by RDKit on every keystroke. Invalid input disables the run button. Accepted MW: 100–1,500 Da. A 2D structure preview appears below the input. |
| **Molecule name** | Free-form display label (e.g. `HAK-KRAS-112`). Auto-generated from SMILES if blank. |
| **UniProt target ID** | e.g. `P00533` (EGFR). Drives the binding model and selectivity panel. Without a target, binding simulation is skipped and only ADMET + toxicity run. |
| **PDB ID** | Optional 4-char code for visualisation and downstream docking. Not required at L1. |
| **Therapeutic area preset** | Oncology · CNS · Cardiovascular · Anti-infective · Metabolic · Rare Disease · Immunology. Adjusts the off-target panel composition and ADMET weighting. |
| **Fingerprint mode** | Toggle. ON runs the extended 28-substage fingerprint; OFF runs the 18-substage standard pass. Cost vs. resolution trade-off. |
| **Diagen mode** | `Cascade` (auto-advance into L3 if the cascade gate passes) vs. `Manual` (always require Stage-Gate Review). |

If no target is supplied, the **Target Suggestion Engine** proposes one via ChEMBL similarity search plus a curated heuristic catalog (~20 core targets — EGFR, CDK4, BTK, KRAS, JAK1/2, …).

### 5.2 Importing a molecule

In the *Import via API* panel choose any of:

| Database | ID format | Example |
|---|---|---|
| ChEMBL | CHEMBL + number | `CHEMBL521` (Ibuprofen) |
| PubChem | CID number | `3672` (Ibuprofen) |
| DrugBank | DB + number | `DB00530` (Erlotinib) |
| UniChem | UCI + number | `UCI2` |
| ZINC | ZINC + number | `ZINC000003594435` |

The result card shows the compound name, SMILES, and MW. *Use* populates the main SMILES field.

The **Diagen AI** panel (Hakase ecosystem badge) imports an AI-generated molecule by Molecule ID (synchronous), Batch Job ID (async, webhook-based), or Cascade (auto-runs L1 → L2 → L3 → L4 in sequence).

### 5.3 What the simulation actually does

When you click **Run In-Vitro Simulation**, the platform runs (in order):

1. **Chemistry init** — RDKit loads, ~40 descriptors are computed (MW, LogP, TPSA, HBD/HBA, rotatable bonds, fraction sp³, Crippen ClogP/MR, kappa, chi, Labute ASA), and pharmacophores (Michael acceptors, basic amines, etc.) are detected.
2. **Target retrieval** — UniProt KB pulls protein metadata + sequence; AlphaFold or PDB pulls structure.
3. **Solubility-ML** (Chemprop ensemble) → logS + solubility class.
4. **Binding-ML** (DeepDTA-GBM, BindingDB-trained, Morgan + ESM-2 protein embedding) → predicted pKd / Ki.
5. **Properties** sanity check.
6. **ADMET-ML v2** (Chemprop-RDKit GNN ensemble) → 50+ ADMET endpoints including Caco-2, HIA, bioavailability.
7. **Cardiotox-ML** → hERG IC50 (µM) + risk class.
8. **DILI-ML** (DILIrank-trained) → DILI probability + risk class.
9. **In-vitro simulation engine** synthesises descriptors + ML outputs into simulated lab readouts: dose-response IC50/EC50 (Hill), microsomal/hepatocyte intrinsic clearance, CYP inhibition panel (1A2, 2C9, 2C19, 2D6, 3A4), Caco-2 P_app, PAMPA P_e, P-gp efflux ratio, plasma fu (%), and the off-target / selectivity panel.
10. **GO/NO-GO scoring** weighted over Lipinski violations, structural alerts, hERG/DILI risk, and aggregate ADMET.
11. **Cascade Gate evaluation** — see §2.

Runtime: typically 5–30 seconds (longer with Fingerprint mode ON).

### 5.4 Reading the results

The right pane renders, in order:

| Panel | Shows |
|---|---|
| **L1 INPUTS strip** (cyan) | Compound · UniProt target · MW · LogP · TPSA · predicted Ki (nM) · hERG IC50 (µM) · plasma fu (%) · Caco-2 Papp · microsomal CLint · off-target hits (n / total) · L1 GO/NO-GO. |
| **Computational ADMET — Consensus View** | 5-axis radar (Absorption · Distribution · Metabolism · Excretion · Toxicity) where each axis renders **mean(ML + Rule)** as the headline. A per-axis badge — `Consensus` (Δ < 8 pts, emerald), `Aligned` (Δ < 20 pts, yellow), or `Divergent` (orange) — surfaces ML/Rule disagreement. ML / Rule / Δ values appear beneath the radar. The 50+ endpoint grid sits below. |
| **hERG / Cardiotox card** | IC50 µM + risk class (Low > 10, Moderate 1–10, High < 1) + ML provenance (Cardiotox model card, version). |
| **DILI / Hepatotoxicity card** | DILIrank-compatible risk class + severity hint + ML model citation. |
| **Binding panel** | ChEMBL-derived pIC50 (similar molecules) **vs.** ML-predicted pKd (DeepDTA). Deltas are highlighted to surface disagreement. |
| **Off-target / Selectivity** | Top off-targets within the therapeutic-area panel + selectivity ratios. |
| **GO / NO-GO verdict** | One of `GO` / `NO-GO` / `MAYBE` with rationale chips (Lipinski violations, hERG risk class, DILI risk class, structural alerts, aggregate ADMET). |
| **RECOMMENDATIONS** (amber) | Free-form: Lipinski warnings, formulation hints (e.g. "logP 6.29 → consider LBDDS"), short t½ warnings, NO-GO escalation note. |
| **Stage-Gate Review banner** | Only renders when a verdict exists. Shows safety-min / non-safety-avg scores, `BLOCKED BY` chips, per-output quality detail (HEURISTIC / ML badges), and *Override & advance to L3*. |
| **External Validation Sources Unavailable** banner | Lists databases that 5xx'd or timed out. Explicitly states no fallbacks were injected. |

---

## 6. Layer 2 — Confirmation (In-Silico ↔ Ex-Vivo)

> **Goal.** Reconcile L1 in-silico predictions against ex-vivo measurements, run a structured falsifier check, allow authorised overrides, and seal a `ConfirmationEvidenceBlock` that L3 and L4 can cite.

L2 is split into two parallel **sub-tracks** (toggled via pill buttons), with a compact **Confirmation Orchestrator** strip rendered above them. Above both sits the **IVIVE Substrate Inputs** panel (orchestrator-level — both sub-tracks consume it).

### 6.1 IVIVE Substrate Inputs (the matrix)

The orchestrator-level panel captures the cross-species measurements the IVIVE math needs *before* either sub-track runs. The matrix persists to local storage so users do not re-enter it between sessions.

| Measurement | Range | Why IVIVE needs it |
|---|---|---|
| `fu_p` — fraction unbound in plasma | 0 – 1 | Required by the well-stirred liver model; converts Cmax,total ↔ Cmax,unbound. |
| `fu_mic` — microsomal binding fraction unbound | 0 – 1 | Obach 1999 correction. The single most common reason published IVIVE diverges from observed clearance. |
| `B/P` — blood-to-plasma ratio | 0 – 10 | Converts plasma CL → blood CL (hepatic blood flow Q_h is a *blood* flow). |

Captured per species: Human · Mouse · Rat · Dog (Beagle) · Monkey (Cyno) — a 15-cell matrix. Each cell carries its own `assayMethod` and `notes` provenance fields. Empty cells render `—`; out-of-range values are rejected and the error is shown inline.

### 6.2 Sub-Track A — In-Silico (10-stage pipeline)

Inputs (overridable): target receptor occupancy (default 0.75), body weight (kg), route (oral / IV), dosing frequency (QD/BID/TID/QID), and optional overrides for plasma fu, volume of distribution, oral bioavailability, and total clearance.

| # | Stage | What it does |
|---|---|---|
| 0 | **Ingest L1 outputs** | Validates and freezes L1 fields; sets the L1 evidence pointer. |
| 1 | **Target druggability** | ESM-2 protein druggability probability + class. |
| 2 | **Docking** | *Opt-in.* AutoDock Vina (or alt) on the receptor chosen by `rankPdbCandidates`. Skip envelope is intentional — docking has real cost and must be confirmed. |
| 3 | **ML affinity + ADMET cross-check** | DeepDTA pKd vs. L1 pKi agreement test. |
| 4 | **Selectivity + cardiotox ML consensus** | Compares L1 selectivity against the Morgan-RF cardiotox call. |
| 5 | **Free-energy refinement (TIES FEP)** | *Opt-in.* Runs on RunPod GPU. Requires `RUNPOD_API_KEY` + `RUNPOD_FEP_ENDPOINT_ID`, Ligand B SMILES, PDB, and explicit cost confirmation (~$40–50). |
| 6 | **PBPK projection** | 2-compartment RK4 ODE solver. |
| 7 | **QSP / PD coupling** | Hill-equation receptor-occupancy curve over time. |
| 8 | **Therapeutic-index ranking** | TI margins (hERG, CYP, CC50, off-target) + first-human dose projection. |
| 9 | **Output / handoff** | Final L2-handoff JSON synthesis. |

A **L1 Output strip** at the top of the In-Silico tab mirrors L1 INPUTS so users never lose sight of what L1 said. Each stage emits its own card with status, value(s), and provenance.

### 6.3 Sub-Track B — Ex-Vivo

Inputs: transporter confidence floor (slider, gates the transporter panel), IC50 nM override (manual), and the standard L2 PBPK params (inherited from In-Silico).

| # | Stage | Source |
|---|---|---|
| 1 | Tissue selectivity + transporter flags | 54-organ GTEx expression matrix × Cu projection |
| 2 | DILI risk classifier + manual severity | ML DILI probability + manual DILIrank entry |
| 3 | Cell-type aggregation | Drug2cell over Tabula Sapiens atlas (today returns 503 — atlas not provisioned; field renders `—`) |
| 4 | Patient-line projection | DepMap PRISM oncology panel scaling |
| 5 | DILI biomarker proxy + permeability | Mechanism mapping → GLDH / ALT / miR-122 signals |
| 6 | Cascade integration | Emits per-readout tier envelope consumed by L3 |

### 6.4 The Confirmation Orchestrator

Compact strip above the sub-track tabs. Collapsed by default; force-expandable from L3 when a sealed block is missing.

Workflow:

1. **Emit Pre-Confirmation Directive** — binds in-silico predictions to the substrate fields the orchestrator expects. Predicted central values come from L1 in-silico evidence (null-when-missing); the hERG field prefers a LITERATURE or IN-HOUSE IC50 over the ML-derived proxy.
2. **Enter Substrate Measurements** — fields: hepatocyte CL_int (mL/min/kg), CYP3A4 inhibition IC50 (µM), BSEP inhibition IC50 (µM), hERG IC50 (µM), cellular dose-response (fold). Each field accepts LITERATURE (DOI/PMID for this compound or Tanimoto ≥ 0.4 congener), IN-HOUSE (operator-supplied with assay method + lab + date), or CLASS-MEDIAN (Lombardo/Smith fallback) — tagged per cell.
3. **Falsifier check** — runs the falsifier registry (e.g. `FX-CLEARANCE-OVERPREDICT` if the substrate value > 3× the in-silico prediction).
4. **Override authoring** — files an `OverrideRecord` citing actor, role (e.g. `PreClinicalSafetyReviewer`, `ProgramLead`), and authority (e.g. `AKTHealth-SOP-PCS-007#§3.4`).
5. **Joint-output synthesis** — merges ML and kinetic evidence into `agree | disagree | partial | mlGap` states across the five joint outputs (CYP transporter, clearance fractions, dose response, off-target, hERG-PBPK projection).
6. **Seal** — emits the `ConfirmationEvidenceBlock`. Required: directive must exist, ex-vivo measurements must be entered, every unhandled trigger must have a matching override.

The sealed block carries `gateStatus: passed | overridden | failed`, an emitted-at ISO timestamp, and `OverrideRecord[]`. It is captured in dashboard state and consumed by L3 and L4. A **L2 Confirmation Inputs panel** (cyan) on the L3 tab mirrors the block visually so the propagation is always inspectable; if the block is missing, an amber strip with *Open seal flow* surfaces inline.

---

## 7. The IVIVE Gate

The IVIVE page (`/ivive`) is the marketing/spec surface for the standalone gate that sits between L2 confirmation and L3 animal-cohort design. The in-app implementation is the IVIVE Substrate Inputs panel (§6.1) plus the well-stirred clearance scaler that consumes it.

### 7.1 The four-tier ladder

The tier is **deterministic** from the matrix — no judgement calls.

| Tier | Rule | What it means |
|---|---|---|
| **Insufficient** | No `fu_p (human)` | Hard block. IVIVE math cannot start; the bridge to animal-cohort design is closed until at least the human plasma binding is on the bench. |
| **Minimum** | `fu_p (human)` only | IVIVE math runs, but cross-species extrapolation is undefended. Animal-cohort design is allowed only with explicit sign-off acknowledging the gap. |
| **Standard** | `fu_p` (human + mouse + rat) AND `B/P` (human + ≥ 1 preclinical) | Tier ladder satisfied. Class-median cells are allowed at this level; cross-species defensibility is evaluated separately. |
| **Premium** | Standard + `fu_mic` (human + ≥ 1 preclinical) | Full Obach-correction substrate. The highest tier the ladder reports; the confidence band the L4 MABEL projection pulls through. |

### 7.2 Cross-species defensibility flag (independent of tier)

Standard / Premium can be *reached* with class-median cells, but the green defensibility flag only flips when **LITERATURE** or **IN-HOUSE** cells satisfy the rule (`fu_p` AND `B/P` each have human + ≥ 1 preclinical species). Class-median cells from Lombardo 2018 / Smith 2010 anchors keep downstream math runnable but do not satisfy the rule.

### 7.3 Math anchors

- **Obach 1999** — `CL_int_corrected = CL_int_measured / fu_mic` (also a 29-compound IVIVE benchmark for engine recalibration)
- **Hosea 2009 / Wang 2010** — extended IVIVE benchmark sets · validates beyond Obach's 29
- **Lombardo 2018** — `fu_p` drug-class medians · CLASS-MEDIAN substrate anchor
- **Smith 2010** — plasma protein binding review · CLASS-MEDIAN substrate anchor
- **ICH M3(R2)** — allometric scaling and species selection conventions

### 7.4 Hard blocks, soft warns, info

| Class | Items | Behaviour |
|---|---|---|
| **Hard blocks** | In-vitro twin not run · L1 verdict NO-GO · Insufficient tier (no human fu_p) | Cannot be acknowledged away. Block release to L3. |
| **Soft warns** | In-silico ConfirmationBlock not yet sealed · cross-species rule met only with class-median estimates · substrate mode class-median or mixed · HAIOps safety flag with `reviewRequired` | Per-alert acknowledgment required at sign-off. |
| **Info** | `ivie-no-fumic` (Obach correction skipped because `fu_mic` is missing) | Tracked through to provenance but does not gate sign-off. |

### 7.5 Sign-off payload

Captured per release: name + role + ISO timestamp · justification text · acknowledged alert IDs · substrate mode (`literature` / `in-house` / `class-median` / `mixed`). Tamper-evident; consumed by L3 animal-cohort design and L4 FIH MABEL projection. A run sealed on class-median substrate is **not** silently identical to a run sealed on literature or in-house substrate — the substrate mode tag rides through to the IND-enabling package.

---

## 8. Layer 3 — Animal Cohort

> **Goal.** Run a simulated animal study battery (ICH M3(R2)-aligned), compute PBPK-derived NOAEL / MTD, scale to human via BSA + PBPK, and emit a Phase-1-ready FIH dose proposal.

### 8.1 Inputs

| Field | Options |
|---|---|
| **Species & strain** | Mouse (CD-1) · Mouse (C57BL/6) · Rat (Sprague Dawley) · Rat (Wistar) · Dog (Beagle) · Cynomolgus Monkey. Each carries its own kmFactor, clScaleFactor, and hepatic blood flow. |
| **Study type** | Single Dose (Acute) · Sub-Acute (14-Day) · Sub-Chronic (28-Day GLP) · Chronic (90-Day GLP) |
| **Route** | Oral · IV · SC · IM · Topical · Inhalation |
| **Formulation** (Oral only) | Plain · SAS · SMEDDS · LBDDS · Nanocrystal — impacts F% via the BCS class table |

Species, study, route, and formulation can be auto-configured from the L1 RECOMMENDATIONS (e.g. logP > 5 → LBDDS).

### 8.2 What gets computed

The cohort sim consumes the L1 ADMET fields (`lipinski.{MW, LogP, HBD, TPSA}`, `admet.{absorption, metabolism, toxicity}`, `toxAlerts`, `binding.primaryIC50`) plus the species table to compute:

- **Allometric clearance** scaled by species body-weight ratio.
- **NOAEL** — therapeutic dose (10 × IC50 Cmax) × `admet.toxicity` × organ-alert adjustments.
- **MTD** — NOAEL × species/study factor.
- **HED (BSA / Km method)** — `noael × (sp.kmFactor / 37)`.
- **HED (PBPK-refined)** — BSA HED × PBPK clearance correction.
- **Proposed FIH dose** — `min(HED) / 10`.

> **Known propagation gap.** The cohort sim today consumes L1 ADMET only. The L2 ConfirmationBlock (Kd, PBPK CL, permeability, joint outputs) and the IVIVE substrate-mode tag are surfaced on screen via the L2 Confirmation Inputs panel but are not yet wired into the NOAEL/MTD/HED math. This is documented as the next major step.

### 8.3 Reading the results

In order on the L3 tab:

1. Upstream **Safety Flag Cascade** banner (when L1/L2 flags exist).
2. **Override banner** (when overrides apply at `toLayer ≤ 3`).
3. **External Validation Sources Unavailable** banner (degraded DBs).
4. **L2 Confirmation Inputs panel** (cyan; the L2-side mirror).
5. **Core PBPK metrics** — NOAEL · MTD · animal t½.
6. **PK profiles** — SVG of animal vs. projected human 1-compartment curves.
7. **Study Group Design** — Vehicle · Low · Mid · High · Recovery · Satellite TK rows with per-arm dose multiple, animals per sex, and totals.
8. **Predicted Toxicity Signals** — Cardiovascular (QT prolongation from hERG, ICH S7B) · Hepatic (ALT/AST, DILI alert, ICH M3(R2)) · Genotoxicity (Ames prediction, ICH S2(R1)) · Tissue Accumulation · General Systemic. Each carries risk level, ICH reference, the specific predicted finding, and structural / pharmacological basis.
9. **Human Translation Panel** — HED (BSA vs. PBPK-refined) · Safety Margin (Excellent > 10× / Acceptable 3–10× / Narrow < 3×) · **Proposed FIH Dose** in mg and mg/kg · projected human Cmax, AUC, t½ at the proposed starting dose.
10. **Regulatory Checklist (IND-enabling gap report)** — pass/warn against ICH M3(R2), S4A, S2(R1), S3A, S7A/S7B, and S6(R1) where applicable.
11. **Provenance footer** — engine + version + database queries + latencies.

L3 emits an `AnimalCohortEvidenceBlock` containing per-cohort study records, a back-pointer to the L2 ConfirmationBlock (when sealed), in-vivo falsifier triggers, and the computed NOAEL / MTD / HED / FIH dose.

---

## 9. Layer 4 — First-In-Human Readiness

> **Goal.** Convert the Pre-Clinical Package (L1 + L2 + L3 evidence) into a Phase 1 strategy seed: starting dose (MABEL vs. HED), escalation scheme, special-population arms, IND-gate readiness.

### 9.1 Inputs (received as props from upstream)

| Prop | Source | Required? |
|---|---|---|
| `confirmationBlock` | L2 sealed block | Optional today; required for full FIH derivation |
| `animalResults` | L3 cohort sim output | Required |
| `simResults` | L1 sim | Required (provides molecule + target context) |

### 9.2 What L4 produces

- **Starting-dose selection** — MABEL (Minimum Anticipated Biological Effect Level, per FDA 2005 / EMA 2017) vs. HED-based starting dose with explicit safety-factor justification. MABEL is preferred whenever target engagement is the binding constraint.
- **Escalation scheme** — Fibonacci vs. accelerated titration; SAD then MAD design.
- **Special-population arms** — Renal-impairment / Hepatic-impairment cohort recommendations driven by L2 clearance fractions and L3 toxicity signals.
- **IND-gate readiness checklist** — GLP toxicology coverage · CMC readiness · Investigator's Brochure outline · Pre-IND meeting prerequisites. Every gap surfaces as a HAIOps flag with a remediation path — never a silent waiver.
- **Designation eligibility** — Breakthrough Therapy · Fast Track · Accelerated Approval · Orphan Drug, computed from L1–L3 evidence quality, indication, and target population.

> **Status.** The Phase 1 Planner is embedded directly inside the L4 panel and consumes the typed `PreClinicalPackage` boundary payload in-process — there is no cross-artifact JSON paste. The current planner renders read-only synthesis; an interactive planner editor is the next major L4 work. The previously planned standalone *Hakase Clinical* artifact has been removed.

### 9.3 Sealed handoff — `PreClinicalPackage v2.0.0`

L4 emits a tamper-evident bundle that contains:

- L1 verdict (`SimResults` + `InVitroResults`)
- L2 `ConfirmationEvidenceBlock` (in-silico evidence, ex-vivo evidence, joint outputs, overrides, gate status)
- IVIVE sign-off + substrate-mode tag
- L3 `AnimalCohortEvidenceBlock` (study records, NOAEL, MTD, HED, FIH dose)
- L4 IND-gate result with HAIOps provenance

A CRO, regulator, or licensing partner can ingest this artifact as-is. This is the product surface; everything in the platform is in service of producing it cleanly.

---

## 10. Cross-Cutting Surfaces

### 10.1 HAIOps Governance (`/haiops`)

The page documents *how* the platform is allowed to ship a verdict. Five pillars:

| # | Pillar | What it covers |
|---|---|---|
| 1 | **Clinical Validation** | Model card, training corpus, evaluation set, validation status for every ML call. |
| 2 | **Regulatory Audit Trail** | Every override (Stage-Gate, IVIVE, Confirmation) persisted with actor + role + justification + authority citation. |
| 3 | **Patient Safety Surveillance** | Safety Flag Cascade — flags raised upstream are *never* cleared downstream. |
| 4 | **Compliance Monitoring** | Codified rules engine for ICH / FDA mappings. |
| 5 | **Confidence Scoring** | Source-quality tiers propagate everywhere. Computed-side: HEURISTIC / STRUCTURAL / ML. Substrate-side: LITERATURE / IN-HOUSE / CLASS-MEDIAN. |

The page also renders Safety Flag Cascade, AI Model Governance, Model Lifecycle, Clinician-in-the-Loop Design, Data Governance & Provenance, and a Regulatory Compliance section (ICH S7A/B, M3(R2)). HAIOps and Safety Flags are policy-locked surfaces — they are not modified in feature work.

### 10.2 Regulatory Outlook (`/regulatory`)

A consolidated read-out of the regulatory contract the platform is held to. The marketing page is a static spec surface; the runtime-computed outlook lives inside the dashboard layers themselves.

| Layer | Outlook contents |
|---|---|
| **L1 — In Vitro** | hERG / Cardiac QT flags · Mutagenicity / Genotox alerts · Required IND-enabling studies (six study types, urgency-weighted Urgent → Required → Waivable) · Physicochemical vs. FDA guidance (RO5, BCS Class I/II) · Source-quality tier badge per output · Precedent drug context. |
| **L2 — Confirmation** | Structural confirmation (ESM-2 + Vina docking) · Selectivity & cardiotox cross-check (Morgan-RF) · Opt-in FEP refinement (RunPod TIES) · Ex-vivo evidence (organoid / hERG patch / hepatocyte CL) · Sealed `ConfirmationBlock v2.0.0`. |
| **L3 — Animal Cohort** | Multi-species PBPK (rat · dog · monkey) · FDA-IIG-compliant formulation engine · Allometric scaling per ICH M3(R2) · NOAEL → HED with bootstrap CIs · Cross-validated vs. ToxCast / ToxRefDB · FAERS AE label signals (pre-populates WARNINGS AND PRECAUTIONS) · Phase I clinical-pharmacology study package (SAD, MAD, Food Effect, Renal/Hepatic Impairment, TQT (ICH E14), DDI, PopPK) tagged Required vs. Recommended. |
| **L4 — FIH Readiness** | MABEL-biased starting dose (FDA 2005 / EMA 2017) · IND-enabling gate (GLP tox · CMC · Investigator's Brochure · Pre-IND meeting prerequisites) · Designation eligibility · Sealed `PreClinicalPackage v2.0.0` handoff. |

Methodology pillars surfaced on the page: Deterministic Rules Engine · ICH Guideline Mapping · PBPK-Driven Dosing · FAERS Signal Integration · MABEL-Biased Starting Dose · Sealed Handoff.

### 10.3 Safety Flag Cascade

Flags raised at any layer cascade forward and are filtered per tab. The Safety Flag Cascade banner appears above the relevant layer's results whenever upstream flags exist. The `safetyFlags.ts` engine is policy-locked.

### 10.4 Provenance & Degradation

- **Provenance footer** at the bottom of each layer's results panel renders database queries (name, endpoint, status, latency) and engine versions.
- **External Validation Sources Unavailable** banner — the renamed "Database Degradation Notice" — surfaces when an external database (UniProt, ChEMBL, BindingDB, AlphaFold, GTEx, Tabula Sapiens, …) returns 5xx, times out, or returns no data. It states honestly that *no* fallback values were injected.

---

## 11. Importing Molecules, Targets, and Projects

| What you have | Where to enter | Result |
|---|---|---|
| Plain SMILES | L1 input panel · *SMILES* field | Real-time RDKit validation; 2D preview renders below. |
| ChEMBL / PubChem / DrugBank / UniChem / ZINC ID | L1 *Import via API* panel | Result card with name + SMILES + MW; *Use* populates the SMILES field. |
| `.sdf` / `.mol2` / `.mol` file | L1 *SDF / MOL2 Upload* drop zone (max 10 MB) | SMILES + 3D coordinates extracted automatically. |
| CSV with a `smiles` header column | L1 *Batch CSV* drop zone (max 500 rows) | Batch screen; results sortable by QED / Toxicity / Binding / Composite. |
| UniProt accession (e.g. `P00533`) | L1 *Target UniProt ID* | Pulls protein metadata + sequence + AlphaFold/PDB structure. |
| 4-char PDB code | L1 *PDB Structure ID* | Optional; overrides auto-selected structure for visualisation. |
| Diagen Molecule ID, Batch Job ID | L1 *Import from Diagen AI* panel | Synchronous, async-batch (webhook), or full Cascade L1 → L4 modes. |
| ClinicalTrials.gov / PubMed / LIMS / EHR ID | Sidebar *Import via API* | Saves a project shell with sponsor / phase / indication metadata. |

---

## 12. 3D Molecular Viewer

Open from a validated SMILES via *View 3D*, or from one of three viewer-mode buttons in the right panel:

| Mode | Use it for |
|---|---|
| **Cinematic** | Immersive presentation-quality rendering with dramatic lighting. |
| **Scientific** | Split-panel ball-and-stick view with element coloring for detailed structural analysis. |
| **Explorer** | Multi-molecule comparison mode — rotate, zoom, and overlay. |
| **Docking** | Pose viewer; opens automatically when you click a cell in the L1 Binding Affinity heatmap. |

The viewer shows the molecule name, SMILES preview, and a **Live Preview** badge. Close via the **×** button.

---

## 13. Exports & Sealed Handoffs

| Layer | Export options |
|---|---|
| **L1 — In-Vitro** | PNG (charts) · PDF Report · JSON (raw simulation data) · CSV (batch table) |
| **L2 — Confirmation** | Sealed `ConfirmationEvidenceBlock` JSON · per-stage cards as PDF |
| **IVIVE Gate** | Signed sign-off record (name, role, ISO timestamp, justification, ack'd alert IDs, substrate mode) |
| **L3 — Animal Cohort** | CSV (raw) · PDF Report · `AnimalCohortEvidenceBlock` JSON |
| **L4 — FIH Readiness** | Full PDF report · **`PreClinicalPackage v2.0.0`** sealed bundle (the regulator-ingestible artefact) |

Across all layers, the **Full Report** button generates a Claude-powered narrative synthesis with GO/NO-GO rationale, risk flags, mitigation recommendations, cross-layer consistency checks, and recommended next steps.

### 13.1 Evidence Hash Chain (tamper-evident provenance)

Every sealed block in the pipeline is cryptographically chained to the block before it using SHA-256. The construction is:

- `l1Hash = sha256(canonicalJSON(simResults + inVitroResults))`
- `l2Hash = sha256(l1Hash + canonicalJSON(ConfirmationEvidenceBlock))`
- `iviveHash = sha256(l2Hash + canonicalJSON(IvieHandoffSignOff))`
- `l3Hash = sha256(iviveHash + canonicalJSON(AnimalCohortEvidenceBlock))`
- `l4Hash = sha256(l3Hash + canonicalJSON(PreClinicalPackage v2.0.0))`

Because each downstream hash folds the upstream hash into its input, any post-hoc edit to an L1 measurement, an L2 stage output, an IVIVE sign-off, or an L3 cohort result invalidates every subsequent hash. A regulator can re-derive the chain from the exported bundle and compare against the stored hashes; mismatch at any stage names the broken layer.

Each chain hash is emitted with the `sha256:` prefix. The dashboard surfaces the first 8 hex characters as a small badge next to each layer's stepper checkmark — the full hash is visible on hover. Stages that have not sealed yet show no badge. The chain itself is portable: the verifier helper (`verifyChain` in `@workspace/preclinical-handoff`) accepts a partial set of payloads so that a downstream consumer can verify the tail of a chain without needing every upstream input.

The hash chain is canonical-JSON based: object keys are sorted recursively before hashing, so two semantically equivalent payloads that differ only in field ordering hash identically. Non-finite numbers (NaN, ±Infinity) and BigInts are rejected at hash time — they cannot be silently encoded as null.

---

## 14. Marketing & Information Pages

- **Landing (`/`)** — Hero, four-layer pipeline strip, step-by-step flow, server-side bullet list, privacy block, stats reframed for the pre-clinical product.
- **Platform (`/platform`)** — Architecture deep-dive: overview cards, then L1 / L2 / L3 / L4 sections with screenshots and captions. The L2 section walks through the 10-stage in-silico pipeline + the ex-vivo sub-track. L4 covers the FIH planner and IND gate.
- **Story (`/story`)** — Two parallel narratives: a Simple version (3-question framing including the FIH-readiness question) and a Technical version (layer-by-layer breakdown).
- **IVIVE (`/ivive`)** — The standalone gate: three measurements × five species, four-tier ladder, math anchors, 10-stage pipeline strip, hard blocks vs. soft warns vs. info, sign-off payload.
- **Regulatory (`/regulatory`)** — Cross-layer Regulatory Outlook (see §10.2), methodology pillars, sealed handoff CTA.
- **HAIOps (`/haiops`)** — Five pillars, Safety Flag Cascade, AI Model Governance, Model Lifecycle, Clinician-in-the-Loop, Data Governance, Regulatory Compliance.
- **APIs (`/apis`)** — Live external APIs, reference databases, computation engines, data-flow overview.
- **Advanced (`/advanced`)** — Tier / upgrade overview reflecting the four pre-clinical layers (the legacy "Trial Digital Twin" L4 has been replaced with "First-In-Human Readiness").
- **Privacy (`/privacy`)** — Privacy policy.

---

## 15. Quick Reference

### 15.1 External resources used by the platform

| Name | Kind | Where it shows up |
|---|---|---|
| RDKit | Cheminformatics toolkit | L1 chemistry init |
| ChEMBL | DB | L1 SMILES import + similarity + target lookup; L1 binding panel reference |
| PubChem · DrugBank · UniChem · ZINC | DBs | L1 *Import via API* compound sources |
| UniProt KB | DB | L1 target metadata |
| AlphaFold DB · PDB (RCSB) | DBs | L1 structure for visualisation, L2 docking |
| BindingDB | DB | DeepDTA training corpus |
| ADMET-AI v2 | ML (Chemprop GNN) | L1 ADMET endpoints |
| DeepDTA-GBM | ML (Morgan + ESM-2) | L1 binding + L2 cross-check |
| Cardiotox-ML | ML | L1 hERG IC50 |
| DILI-ML / DILIrank | ML + DB | L1 + L2 hepatotoxicity |
| ESM-2 | Protein LM | L2 druggability + binding embeddings |
| AutoDock Vina (or alt) | Docking engine | L2 Stage 2 (opt-in) |
| TIES FEP | Free-energy method | L2 Stage 5 (opt-in, RunPod GPU) |
| GTEx | Expression DB | L2 Ex-Vivo Stage 1 (54-organ matrix) |
| Tabula Sapiens | Single-cell atlas | L2 Ex-Vivo Stage 3 (currently unprovisioned → 503) |
| DepMap PRISM | Cell-line panel | L2 Ex-Vivo Stage 4 |
| PBPK 2-comp RK4 solver | ODE model | L2 Stage 6 + L3 PK profiles |
| ICH M3(R2) | Regulatory standard | L3 study-type definitions |
| ICH S7A / S7B | Regulatory standard | Safety pharmacology — surfaced on `/regulatory` |
| ICH S2(R1) | Regulatory standard | Genotox battery — L3 IND checklist |
| ICH E14 | Regulatory standard | QT/QTc (TQT) — surfaced on `/regulatory` |
| FDA 2005 / EMA 2017 | Regulatory guidance | MABEL-biased FIH starting dose (L4) |
| BSA / Km method | Scaling rule | L3 HED |
| BCS class table | Reference | L3 formulation → F% |
| FAERS | Post-market AE DB | L3 / `/regulatory` AE label-signal calibration |
| ToxCast / ToxRefDB | Tox DB | L3 cross-validation reference |
| Lombardo 2018 · Smith 2010 · Obach 1999 | Pharmacokinetics literature | IVIVE class-median anchors + microsomal binding correction |
| FDA Drug Approval Packages (DAPs) | Regulatory PK ground truth | Held-out human PK for ~1,000+ approved compounds — IVIVE LITERATURE substrate + recalibration corpus |
| DrugBank PK panel · PK-DB (UKonstanz) | Curated human PK | Broader IVIVE LITERATURE substrate coverage |
| Obach 1999 · Hosea 2009 · Wang 2010 | IVIVE benchmark sets | Engine recalibration / fold-error reporting |
| Open TG-GATEs · eTRANSAFE | Toxicogenomics + translational safety | Cross-species recalibration substrate (hepatocyte CL_int proxies) |
| ECOTox | Environmental tox | L1 ecotox card (no fallback table — explicit policy) |

### 15.2 Key thresholds

| Metric | Threshold |
|---|---|
| MW (Lipinski) | ≤ 500 Da |
| LogP (Lipinski) | ≤ 5 |
| Caco-2 Papp | High > 20 · Moderate 5–20 · Low < 5 (×10⁻⁶ cm/s) |
| PAMPA Pe | High > 10 · Moderate 2–10 · Low < 2 |
| Microsomal CLint | Stable < 15 · Moderate 15–50 · Unstable > 50 (µL/min/mg) |
| Plasma protein binding | Highly Bound < 5% free · Moderate 5–20% · Weakly > 20% |
| hERG IC50 | Low risk > 10 µM · Moderate 1–10 · High < 1 |
| hERG safety margin | Acceptable > 30× therapeutic IC50 |
| CYP IC50 (per enzyme) | Low risk > 20 µM · Moderate 5–20 · High < 5 |
| Binding affinity | Strong < 50 nM · Moderate 50–500 · Weak > 500 |
| Cascade Gate — safety key | Each must reach quality score ≥ 0.6 |
| Cascade Gate — non-safety avg | Average must reach ≥ 0.6 |
| ADMET Consensus badge | Consensus Δ < 8 pts · Aligned Δ < 20 · Divergent otherwise |
| Safety margin (NOAEL → HED) | Excellent > 10× · Acceptable 3–10× · Narrow < 3× |

### 15.3 Typical runtimes

| Stage | Range |
|---|---|
| L1 In-Vitro Twin (Standard) | 5–30 seconds |
| L1 with Fingerprint mode ON | 30–60 seconds |
| L2 In-Silico (without opt-in stages 2 + 5) | 1–3 minutes |
| L2 In-Silico Stage 2 (Docking) | 2–5 minutes |
| L2 In-Silico Stage 5 (FEP, RunPod GPU) | 30–90 minutes (cost-confirmed) |
| L2 Ex-Vivo sub-track | 1–2 minutes |
| IVIVE Gate (sign-off flow only) | seconds — the math runs as part of L2 |
| L3 Animal Cohort | 1–4 minutes |
| L4 FIH Readiness synthesis | seconds (read-only over upstream blocks today) |

### 15.4 Sealed evidence blocks at a glance

| Block | Emitted by | Consumed by |
|---|---|---|
| `EvidencePointer` (L1) | L1, frozen by L2 orchestrator | L2 evidence records |
| `ConfirmationEvidenceBlock` | L2 Confirmation Orchestrator | L3 panel mirror, L4 PreClinicalPackage |
| IVIVE sign-off record | IVIVE gate | L3 cohort design, L4 MABEL projection |
| `AnimalCohortEvidenceBlock` | L3 | L4 PreClinicalPackage |
| `PreClinicalPackage v2.0.0` | L4 | External — CROs, regulators, licensing partners |

### 15.5 Common workflows

- **Single compound from scratch** — Type SMILES → set UniProt target + therapeutic area → *Run In-Vitro Simulation* → review verdict + Stage-Gate banner → enter IVIVE substrate matrix (literature + in-house cells) → run L2 In-Silico (and Tissue-Scale if substrate exists) → seal Confirmation block → sign IVIVE handoff → run L3 → review L4 readiness.
- **Compound from a database** — *Import via API* (ChEMBL / PubChem / DrugBank / UniChem / ZINC) → *Use* → continue as above.
- **Diagen Cascade run** — *Import from Diagen AI* → choose *Cascade* → enter Molecule ID → walk away while L1 → L4 propagate.
- **Batch screening** — Drop CSV with `smiles` header (≤ 500 rows) → set ranking criteria + composite weights → run → export top-N CSV. (Batch is L1 only.)
- **Stage-Gate override path** — When the cascade gate blocks: review the `BLOCKED BY` chips and per-output quality detail, then *Override & advance to L3*. Capture actor, role, justification, and authority citation in the override modal — these persist to the provenance trail.
- **IVIVE substrate hardening** — Open the IVIVE Substrate Inputs panel, fill the matrix with literature or in-house `fu_p`, `fu_mic`, and `B/P` values across human + ≥ 1 preclinical species, watch the tier badge climb from Insufficient → Standard → Premium and the cross-species defensibility flag flip green.

### 15.6 Glossary (selected)

- **ADMET** — Absorption, Distribution, Metabolism, Excretion, Toxicity. The five-axis radar in the L1 results panel.
- **AOP** — Adverse Outcome Pathway. OECD-curated mechanistic chains from molecular initiating event to organ-level adverse outcome.
- **BCS** — Biopharmaceutics Classification System. Drives oral formulation choice in L3.
- **CL_int** — Intrinsic clearance. Microsomal or hepatocyte-derived; the substrate for the well-stirred liver model.
- **DDI** — Drug-Drug Interaction. Predicted from the L1 CYP inhibition panel.
- **DILI** — Drug-Induced Liver Injury. L1 DILI-ML risk class; DILIrank reference.
- **FIH** — First-In-Human. The L4 product surface.
- **GLP** — Good Laboratory Practice. Required for IND-enabling tox studies.
- **HED** — Human Equivalent Dose. Computed by both BSA/Km and PBPK-refined methods in L3.
- **IC50 / EC50** — Half-maximal inhibitory / effective concentration.
- **IND** — Investigational New Drug. The regulatory submission L4 prepares for.
- **IVIVE** — In-Vitro to In-Vivo Extrapolation. The standalone gate between L2 and L3.
- **MABEL** — Minimum Anticipated Biological Effect Level. The preferred starting-dose method whenever target engagement is binding (FDA 2005 / EMA 2017).
- **MTD** — Maximum Tolerated Dose.
- **NOAEL** — No Observed Adverse Effect Level.
- **PBPK** — Physiologically-Based Pharmacokinetic modelling. 2-compartment RK4 ODE solver; used in L2 Stage 6 and L3 PK profiles.
- **QED** — Quantitative Estimate of Drug-likeness.
- **RP2D** — Recommended Phase 2 Dose. (Surfaced on the L4 planner; defined by the post-FIH study, not the platform.)
- **SA Score** — Synthetic Accessibility (1–10). Lower = easier to synthesise.
- **SAD / MAD** — Single Ascending Dose / Multiple Ascending Dose. Phase 1 designs surfaced in L4.
- **Stage-Gate** — The L1 → L3 cascade gate plus the human review banner that appears when it blocks.

---

*Document maintained alongside `artifacts/hakase-ai/docs/LAYERS_REFERENCE.md`. When the two diverge, LAYERS_REFERENCE is the engineering source of truth and this guide should be updated to match.*
