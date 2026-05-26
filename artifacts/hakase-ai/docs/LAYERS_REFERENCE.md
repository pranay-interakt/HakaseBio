# HakaseAI BioDigital Twin — Layers Reference

> **Scope.** End-to-end reference for every layer of the BioDigital Twin pipeline as implemented in `artifacts/hakase-ai/` on **May 13, 2026**. Covers user inputs, pipeline stages in execution order, component map, databases / models touched, result panels rendered, the handoff payload between layers, plus the cross-cutting HAIOps governance, IVIVE gate, and Regulatory Outlook surfaces.
>
> **Policy reminder.** No fake data, no synthetic fallbacks, no silent coercion, no defaults for missing required output fields. Where a value is unknown or unrunnable, the UI must render `—` (or skip envelopes for opt-in stages) — never a placeholder.
>
> **Layer numbering** (May 2026 4-layer restructure):
> | # | Name                        | Brand color | Source of truth |
> |---|-----------------------------|-------------|-----------------|
> | 1 | In-Vitro                    | Violet      | `chemistry.ts`, `inVitroSim.ts`, `admet.ts`, `aiService.ts` |
> | 2 | Confirmation (In-Silico ↔ Ex-Vivo) | Cyan / Teal | `l2Pipeline.ts`, `Layer2InSilicoScaffold.tsx`, `Layer3ExVivoScaffold.tsx`, `ConfirmationLayerPanel.tsx`, `confirmationEngine.ts` |
> | 3 | Animal Cohort               | Amber       | `animalSim.ts` |
> | 4 | First-In-Human              | Emerald     | `HakaseAI.tsx` (FirstInHumanPanel block, `activeLayer === 4`) |
>
> Several legacy file names from before the restructure are retained — most importantly `Layer3ExVivoScaffold.tsx` (now the **L2 Ex-Vivo** sub-track) and the `Layer2AnimalResults` component name (now the **L3** results panel). These are flagged inline.

---

## Cross-Cutting Concerns

### Cascade Gate (`src/lib/cascadeGate.ts`)

Decides whether the auto-cascade is permitted to push **L1 → L3 Animal Cohort** auto-derivation **without** stage-gate human review. (L2 Confirmation has its own separate engine.)

| Constant | Value | Meaning |
|---|---|---|
| `SAFETY_KEYS` | `["hERG", "hepatotoxicity", "bioactivation", "cyp_panel"]` | Hard-blocking quality keys |
| `SAFETY_MIN_SCORE` | `0.6` | Each safety key must reach this minimum quality score |
| `NON_SAFETY_MIN_AVG` | `0.6` | Average of non-safety outputs must reach this |

**Block rules**

1. Any `goNogo === "NO-GO"` compound is blocked regardless of data quality.
2. Any single safety output below `SAFETY_MIN_SCORE` blocks (heuristic-only outputs typically score below this).
3. Average of all non-safety outputs below `NON_SAFETY_MIN_AVG` blocks.

When blocked, the dashboard renders the **"Stage-Gate Review Required"** banner with a `BLOCKED BY` chip list, the per-output quality detail (`HEURISTIC` / `ML` tier badges), and an **"Override & advance to L3"** button. Overrides are logged to provenance with actor, role, justification, and authority citation.

### Provenance & Degradation

- `provenanceL1`, `provenanceL3` — per-layer provenance state captured in `HakaseAI.tsx`. Each holds `databaseQueries[]` (database name, endpoint, status, latency) and engine versions.
- `ProvenanceFooter` — renders the provenance trail at the bottom of each layer's results panel.
- `dbDegradationWarnings` — emitted when an external database (UniProt, ChEMBL, BindingDB, AlphaFold, GTEx, Tabula Sapiens, etc.) returns 5xx, times out, or returns no data.
- `GracefulDegradationBanner` — renamed from "Database Degradation Notice" → **"External Validation Sources Unavailable"**. States honestly that *no* fallback values were injected; the affected fields render `—`.

### Safety Flags (`src/lib/safetyFlags.ts`, do not modify)

Flags raised at any layer cascade forward. `getFlagsForLayer(safetyFlags, layer)` filters them per tab. `SafetyFlagCascadeBanner` displays upstream flags above each layer's results.

### HAIOps Governance (`src/pages/HAIOps.tsx`, do not modify)

Cross-cutting governance surface that documents *how* the platform is allowed to ship a verdict. It is referenced by every layer's "Regulatory Outlook" gap report and by the IVIVE sign-off page.

**Five Pillars** (the `PILLARS` constant at the top of `HAIOps.tsx`, rendered as the page overview):
1. **Clinical Validation** — model card, training corpus, evaluation set, and validation status for every ML call (`MlAdmetCard`, Cardiotox, DILI-ML, DeepDTA, Drug2cell).
2. **Regulatory Audit Trail** — every override (Stage-Gate, IVIVE, Confirmation) is persisted with actor + role + justification + authority citation through the provenance trail.
3. **Patient Safety Surveillance** — Safety Flag Cascade: flags raised upstream are *never* cleared downstream; filtered per tab via `getFlagsForLayer`.
4. **Compliance Monitoring** — codified rules engine for ICH / FDA mappings (see Regulatory section for which standards are surfaced where).
5. **Confidence Scoring** — every output carries a source-quality tier (`HEURISTIC` / `STRUCTURAL` / `ML` / `MEASURED`); badges propagate into the Stage-Gate Review and the L2 confirmation joint outputs.

The page also renders **Safety Flag Cascade**, **AI Model Governance**, **Model Lifecycle**, **Clinician-in-the-Loop Design**, **Data Governance & Provenance**, and a **Regulatory Compliance** section (ICH S7A/B, M3(R2) referenced in-page).

> ⚠ `HAIOps.tsx` and `safetyFlags.ts` are **policy-locked** — do not modify in feature work.

### Stale-Results Guard (`HakaseAI.tsx` ~line 970)

A `useEffect` clears `simResults` and `inVitroResults` whenever the live SMILES diverges from `simResults.smiles`. Without this guard, the radar / organ panels could keep rendering the *previous* compound's numbers while the live Lipinski strip already reflects the new SMILES. Empty state renders `—`, never zero.

### Stage-Gate Review Conditional Render

The Stage-Gate Review banner (cross-referenced from §1.3) only mounts when `simResults` exists. Pre-molecule the layer renders a quiescent placeholder; this prevents the banner from flashing "BLOCKED BY: —" before the user has run anything.

---

## Layer 1 — In-Vitro

> **Goal.** Take a SMILES string + (optional) target identifier and produce ADMET, binding, toxicity, selectivity, and a GO / NO-GO verdict. This is the entry point.

### 1.1 Inputs (Dashboard Form)

| Field | Type | Behaviour | Source |
|---|---|---|---|
| **SMILES string** | text | Canonicalized + validated by RDKit on every keystroke; invalid input disables the run button. | `src/lib/chemistry.ts` |
| **Molecule name** | text | Free-form display label (e.g. `HAK-KRAS-112`). Not used for any computation. | dashboard form |
| **ChEMBL import** | button | Pulls a molecule by ChEMBL ID (e.g. `CHEMBL452`); auto-fills SMILES + name. | `src/lib/apiImport.ts` |
| **UniProt target ID** | text | e.g. `P00533` (EGFR). Drives the binding model + selectivity panel. | `src/lib/proteinApi.ts` |
| **PDB ID** | text | e.g. `4HJO`. 3D structure for visualisation and downstream docking; not required at L1. | dashboard form |
| **Therapeutic area** | select | Oncology / CNS / Cardiovascular / Anti-infective / Metabolic. Adjusts off-target panel composition and ADMET weighting. | `src/lib/inVitroSim.ts` |
| **Fingerprint mode** | toggle | When ON, runs an extended fingerprint pass (28 sub-stages instead of 18). Cost vs. resolution tradeoff. | `HakaseAI.tsx` (run loop) |
| **Diagen mode** | select | `Cascade` (auto-advance into L3 if cascade gate passes) vs. `Manual` (always require review). | `HakaseAI.tsx` |

If no target is supplied, the **Target Suggestion Engine** (`src/lib/targetSuggestion.ts`) proposes targets via:
- ChEMBL similarity search against the input SMILES + harvest of known targets.
- Heuristic pharmacophore matching against a curated catalog (~20 core targets: EGFR, CDK4, BTK, KRAS, JAK1/2, etc.).

### 1.2 Pipeline Stages (execution order)

Run trigger: `handleAnalyzeMolecule()` in `HakaseAI.tsx`.

1. **Chemistry init** (`chemistry.ts`) — load `RDKit_minimal.js`, compute ~40 molecular descriptors (MW, logP, TPSA, HBD/HBA, rotatable bonds, aromatic rings, fraction sp³, Crippen ClogP/MR, kappa, chi, Labute ASA, …), detect pharmacophores (Michael acceptors, basic amines, etc.).
2. **Target retrieval** (`proteinApi.ts`) — query UniProt KB for protein metadata, sequence, length, function. Pull AlphaFold or PDB structure for visualisation.
3. **Solubility-ML** — `POST /predict/solubility-ml` (Chemprop ensemble) → logS + solubility class.
4. **Binding-ML (DeepDTA-GBM)** — `POST /predict/binding-ml` (BindingDB-trained, Morgan + ESM-2 protein embedding ensemble) → predicted pKd / Ki.
5. **Properties** — `POST /predict/properties` → physicochemical sanity check.
6. **ADMET-ML v2** — `POST /predict/admet-ml` (Chemprop-RDKit GNN ensemble) → 50+ ADMET endpoints incl. Caco-2, HIA, bioavailability.
7. **Cardiotox-ML** — `POST /predict/cardiotox` → hERG IC50 (µM) + risk class.
8. **DILI-ML** — `POST /predict/dili-ml` (DILIrank-trained Chemprop + Morgan-RF) → DILI probability + risk class.
9. **In-Vitro simulation engine** (`inVitroSim.ts`) — synthesises descriptors + ML outputs into simulated lab readouts:
   - Dose-response IC50 / EC50 (Hill-slope model).
   - Microsomal / hepatocyte intrinsic clearance.
   - CYP inhibition panel (1A2, 2C9, 2C19, 2D6, 3A4).
   - Caco-2 P_app, PAMPA P_e, P-gp efflux ratio.
   - Plasma fu (%) via PPB sim.
   - Off-target / selectivity panel (top hits within the chosen therapeutic-area target panel).
10. **GO / NO-GO scoring** (`admet.ts`) — weighted assessment over Lipinski violations, structural alerts (`safetyFlags.ts`), hERG/DILI risk, and aggregate ADMET. Emits `goNogo: "GO" | "NO-GO" | "MAYBE"`.
11. **Cascade gate evaluation** (`cascadeGate.ts`) — see cross-cutting section above.

### 1.3 Result Panels (rendered when `simStatus[1] === "complete"`)

| Panel | Shows | Source |
|---|---|---|
| **L1 INPUTS** (cyan) | Compound · UniProt target · MW·LogP·TPSA · Predicted Ki (nM) · hERG IC50 (µM) · Plasma fu (%) · Caco-2 Papp · Microsomal CLint · Off-target hits (n/total) · L1 Go / No-Go | `Layer2InSilicoScaffold.tsx:600` (visual ref) |
| **Computational ADMET — Consensus View** | 5-axis radar (A/D/M/E/T) where each axis renders **mean(ML + Rule)** as the headline, with a per-axis **Consensus / Aligned / Divergent** badge (`<8` pts emerald, `<20` pts yellow, else orange) and the ML / Rule / Δ breakdown beneath. Per-property grid (50+ endpoints) sits below the radar. | `MlAdmetCard.tsx` ~282–380 |
| **hERG / Cardiotox card** | IC50 µM + risk class (Low/Moderate/High) + provenance (`ML / Cardiotox`) | rendered in `HakaseAI.tsx` |
| **DILI / Hepatotoxicity card** | DILIrank-compatible risk class + severity hint + ML model citation | `HakaseAI.tsx` |
| **Binding panel** | ChEMBL-derived pIC50 (similar molecules) **vs.** ML-predicted pKd (DeepDTA) — deltas surface disagreement | `HakaseAI.tsx` |
| **Off-target / Selectivity** | Top off-targets within therapeutic-area panel + selectivity ratios | `inVitroSim.ts` driven |
| **GO / NO-GO verdict** | One of `GO` / `NO-GO` / `MAYBE` with rationale chips | `admet.ts` |
| **RECOMMENDATIONS** (amber) | Free-form recommendations: Lipinski warnings, formulation hints (e.g. "logP 6.29 → consider LBDDS"), short t½ warnings, NO-GO escalation note | `HakaseAI.tsx` |
| **Stage-Gate Review banner** | `safetyMin` / `avgNonSafety` scores, `BLOCKED BY` chip list, per-output quality detail (`HEURISTIC`/`ML` badges + brief model citation), **"Override & advance to L3"** button | `HakaseAI.tsx` ~3744–3800 |
| **External Validation Sources Unavailable** banner (when applicable) | Lists DBs that 5xx'd / timed out — explicitly states no fallbacks injected | `HakaseAI.tsx` ~7836 |

### 1.4 Database / Model Glossary (L1)

| Resource | Type | Used for |
|---|---|---|
| **RDKit** | Chem toolkit | Descriptors, validation, canonicalization |
| **ChEMBL** | DB | SMILES import, similarity search, target lookup, historical activity |
| **UniProt KB** | DB / API | Protein metadata + sequence |
| **AlphaFold DB** | DB | 3D structure when no PDB exists |
| **PDB** | DB | Crystal/cryo-EM structures |
| **BindingDB** | DB | Training corpus for DeepDTA-GBM (n ≈ 116) |
| **ADMET-AI v2** | ML | Chemprop-RDKit GNN ensemble, ADMET endpoints |
| **DeepDTA-GBM** | ML | Morgan + ESM-2, predicted pKd |
| **Cardiotox** | ML | hERG IC50 + risk class |
| **DILIrank / DILI-ML** | DB + ML | Hepatotoxicity risk |

### 1.5 Handoff to L2

L1 emits a `SimResults` object (`src/lib/admet.ts`) and an `InVitroResults` object (`src/lib/inVitroSim.ts`). The L2 orchestrator freezes an **`EvidencePointer`** to L1 via `freezeL1EvidencePointer(compoundIdRaw, ISOTimestamp)` (`confirmationEngine.ts`). All downstream evidence cites this pointer for traceability.

---

## Layer 2 — Confirmation (In-Silico ↔ Ex-Vivo)

> **Goal.** Reconcile L1 in-silico predictions against ex-vivo measurements, run a structured falsifier check, allow authorised overrides, and **seal** a `ConfirmationEvidenceBlock` that L3 and L4 can cite.
>
> **Layout.** L2 is split into two parallel sub-tracks (toggled via pill buttons) plus a compact **Confirmation Orchestrator** strip rendered above them. Above both sits the **IVIVE Wet-Lab Inputs** panel (orchestrator-level — both sub-tracks consume it).

### 2.0 IVIVE Wet-Lab Inputs (`IvieInputsPanel.tsx`, `lib/ivieInputs.ts`)

> **Goal.** Capture the cross-species measurements required by the IVIVE math (well-stirred liver model + species-translation calibration) before any L2 sub-track runs. Per the IVIVE Input Scoping doc, this block closes the single largest defensibility gap (the "cross-species rule").

**Captured measurements** (per species: human, mouse, rat, dog, monkey)

| Measurement | Range | Why IVIVE needs it |
|---|---|---|
| `fu_p` (plasma) | (0, 1] | Required by well-stirred liver model and Cmax,total ↔ Cmax,unbound conversion |
| `fu_mic` (microsomal) | (0, 1] | Obach 1999 correction — the #1 reason published IVIVE diverges from observed CL |
| `B/P` (blood-to-plasma) | (0, 10] | Converts plasma CL → blood CL (Q_h is a blood flow) |

Each cell carries its own `assayMethod` and `notes` provenance fields. The matrix persists to `localStorage` under `hakase.ivieInputs.v1`.

**Tier ladder** (matches the founding-partner offer in the scoping doc)

| Tier | Requires |
|---|---|
| Insufficient | (nothing — fu_p human still empty) |
| **Minimum** | fu_p (human) |
| **Standard** *(default scope)* | + fu_p (mouse) + fu_p (rat) + B/P (human + ≥1 preclinical) |
| **Premium** | + fu_mic (human + ≥1 preclinical) |

**Cross-species rule.** Satisfied iff **fu_p AND B/P** each have human + ≥1 preclinical species value. The panel renders an amber call-out when unmet — the IVIVE Calibration panel (P1, follow-on) will block the "evidence-based L3 study design" badge until the rule is satisfied.

**Wiring into the engine.** `Layer2InSilicoScaffold` merges human values into the L2 params right before invoking `runStage8` / `runFullPipeline` via `mergeIvie(params)`. Precedence: explicit form override > IVIVE measured value > L1 fallback. `l2DoseProjection.scaleHepaticCL` accepts `{ fuMic, bpRatio }` opts and applies the corrections (Obach 1999 fu_mic correction; plasma → blood CL conversion). When values are absent the legacy heuristic path is preserved unchanged — **no synthetic defaults**.

**Anti-fabrication.** Empty cells render `—`, not zero. Out-of-range values are rejected (the cell is set to `null` and the error is shown inline). Validation is range-strict per measurement.

### 2.0b IVIVE Output & Sign-off Handoff (`src/pages/IVIVE.tsx`, route `/ivive`)

> **Goal.** Treat IVIVE as a **standalone gate** between L2 confirmation and L3 animal-cohort design. Wet-lab substrate in (§2.0), tiered confidence assessment + cross-species defensibility check + sealed sign-off out. This is the marketing/spec surface for the gate; the in-app implementation is `mergeIvie` + `l2DoseProjection.scaleHepaticCL` (§2.0).

#### Output panels

| Panel | Shows |
|---|---|
| **Three measurements** | `fu_p` (plasma) · `fu_mic` (microsomal, Obach 1999) · `B/P` (blood-to-plasma) — per species: Human · Mouse · Rat · Dog (Beagle) · Monkey (Cyno). 15-cell matrix. |
| **Tier ladder** | `Insufficient` (no human fu_p — **BLOCK**) · `Minimum` (human fu_p only — explicit sign-off required) · `Standard` (fu_p human+mouse+rat AND B/P human+≥1 preclinical — auto-substrate allowed) · `Premium` (Standard + fu_mic human+≥1 preclinical). Tier is **deterministic** from the matrix; no judgement calls. |
| **Cross-species defensibility flag** | Independent of tier: counts **measured-only** cells. Standard / Premium can be *reached* with auto-estimated cells, but the green defensibility flag only flips when the rule is satisfied with measured values. |
| **Math anchors** | Well-stirred liver model · Obach 1999 (`CL_int_corrected = CL_int_measured / fu_mic`) · Lombardo 2018 + Smith 2010 fu_p auto-substrate anchors · ICH M3(R2) species selection. |
| **10-stage pipeline strip** | (1) receive sealed in-silico ConfirmationBlock v2.0.0 → (2) capture wet-lab matrix → (3) tier assessment → (4) Obach fu_mic correction → (5) well-stirred CL_h per species → (6) plasma → blood CL via B/P → (7) cross-species rule check (measured-only) → (8) hard-block / soft-warn assembly → (9) sign-off → (10) release to L3. |

#### Hard blocks vs soft warns vs sign-off

| Class | Items | Behaviour |
|---|---|---|
| **Hard blocks** | In-vitro twin not run · L1 verdict NO-GO · Insufficient tier (no human fu_p) | Cannot be acknowledged away — block release to L3. |
| **Soft warns** | In-silico ConfirmationBlock not yet sealed · cross-species rule met only with estimates · substrate mode auto-estimated or mixed · HAIOps safety flag with `reviewRequired` | Per-alert acknowledgment required at sign-off. |
| **Info** | `ivie-no-fumic` — `fu_mic` missing (Obach correction skipped). Surfaced as informational, not warn; does not require acknowledgment. | Tracked through to provenance but does not gate sign-off. |
| **Sign-off payload** | Name + role + ISO timestamp · justification text · acknowledged alert IDs · substrate mode (`measured` / `auto-estimated` / `mixed`) | Tamper-evident; consumed by L3 animal-cohort design and L4 FIH MABEL projection. |

**Substrate mode propagation.** A run sealed on auto-substrate is *not* silently identical to a run sealed on measured substrate — the substrate mode tag rides through the L3 NOAEL/HED panel and is read again by the L4 MABEL projector before the IND-enabling package is assembled.

### 2.1 Sub-Track A: In-Silico (`Layer2InSilicoScaffold.tsx`)

#### Inputs (`InputParamsCard`)

| Field | Default | Notes |
|---|---|---|
| Target receptor occupancy | 0.75 | Slider 0.50 – 0.95 |
| Body weight (kg) | 70 | Numeric |
| Route | oral | Oral PO / IV (F=1) |
| Dosing freq. | QD | QD / BID / TID / QID |
| `fuOverride` | — | Plasma protein binding override |
| `VdOverride` (L/kg) | — | Volume of distribution |
| `FOverride` | — | Oral bioavailability |
| `CLOverride` (mL/min/kg) | — | Total clearance |

#### Pipeline Stages (`l2Pipeline.ts`)

| # | Stage | Notes |
|---|---|---|
| 0 | **Ingest L1 outputs** | Validates and freezes `l1Fields`. Sets the L1 pointer. |
| 1 | **Target druggability** | ESM-2 protein druggability probability + class. |
| 2 | **Docking** | **Opt-in skip envelope** at `l2Pipeline.ts:387`. Requires manual confirmation (compute cost). Uses `rankPdbCandidates` to choose receptor. |
| 3 | **ML affinity + ADMET cross-check** | DeepDTA pKd vs L1 pKi agreement test. |
| 4 | **Selectivity + cardiotox ML consensus** | Compares L1 selectivity against Morgan-RF cardiotox call. |
| 5 | **Free-energy refinement (TIES FEP)** | **Opt-in skip envelope** at `l2Pipeline.ts:591`. Runs on RunPod GPU. Requires `RUNPOD_API_KEY` + `RUNPOD_FEP_ENDPOINT_ID`, Ligand B SMILES, PDB, and explicit cost confirmation (~$40–50). Skip envelope is intentional, not a fallback. |
| 6 | **PBPK projection** | 2-compartment RK4 ODE solver from `pbpk.ts`. |
| 7 | **QSP / PD coupling** | Hill-equation receptor-occupancy curve over time. |
| 8 | **Therapeutic-index ranking** | TI margins (hERG, CYP, CC50, off-target) + first human dose projection in `l2DoseProjection.ts`. |
| 9 | **Output / handoff** | Final `L2-handoff-v1` JSON synthesis. |

#### Result rows

`L1OutputRow` strip at the top mirrors L1 INPUTS (so the user never loses sight of what L1 said). Each stage emits its own card with status + value(s) + provenance.

### 2.2 Sub-Track B: Ex-Vivo (`Layer3ExVivoScaffold.tsx` — legacy filename)

#### Inputs

| Field | Notes |
|---|---|
| `transporterConfidenceFloor` | Slider — gates the transporter panel |
| `ic50_nM_override` | Manual override |
| Standard L2 PBPK params | Inherited from In-Silico sub-track |

#### Stage Cards

| # | Stage | Source |
|---|---|---|
| 1 | **Tissue selectivity + transporter flags** | 54-organ GTEx expression matrix × Cu projection |
| 2 | **DILI risk classifier + manual severity** | ML DILI probability + manual DILIrank entry |
| 3 | **Cell-type aggregation** | Drug2cell scoring over Tabula Sapiens atlas (currently 503 — atlas not provisioned) |
| 4 | **Patient-line projection** | DepMap PRISM oncology panel scaling |
| 5 | **DILI biomarker proxy + permeability** | Mechanism mapping → GLDH / ALT / miR-122 signals |
| 6 | **Cascade integration** | Emits per-readout tier envelope consumed by L3 |

> Stage 3 returns 503 today. Per policy, no synthetic atlas is injected — the field renders `—` and the degradation banner surfaces. Tabula Sapiens atlas provisioning is staged as a follow-up.

### 2.3 Confirmation Orchestrator (`ConfirmationLayerPanel.tsx`)

The compact strip above the sub-track tabs. **Collapsed by default** (`expanded: false`). Force-expandable from L3 via `forceExpandSignal` prop.

#### Workflow steps

1. **Emit Pre-Confirmation Directive** (`handleEmitDirective`, line 139) — binds in-silico predictions to required ex-vivo assays. Anti-fabrication: predicted central values come from L1 in-silico evidence (which is null-when-missing); hERG prefers measured in-vitro IC50 over the ML-derived proxy.
2. **Enter Ex-Vivo Measurements** — defaults from `DEFAULT_MEASUREMENTS` (line 84):
   - `primary_hepatocyte_clearance` (mL/min/kg)
   - `cyp3a4_inhibition_ic50` (µM)
   - `bsep_inhibition` (µM)
   - `herg_patch_clamp` (µM)
   - `primary_cellular_dose_response` (fold)
3. **Falsifier check** (`handleRunFalsifierCheck`) — runs `checkFalsifiers` against the registry (e.g. `FX-CLEARANCE-OVERPREDICT` if measured > 3× predicted).
4. **Override authoring** (`handleFileOverride`) — files an `OverrideRecord` citing actor, role (e.g. `PreClinicalSafetyReviewer`, `ProgramLead`), and authority (e.g. `AKTHealth-SOP-PCS-007#§3.4`).
5. **Joint-output synthesis** — merges ML and kinetic evidence into `agree | disagree | partial | mlGap` states across the five joint outputs.
6. **Seal** (`handleEmitConfirmationBlock`, line 199) — calls `buildConfirmationBlock` and fires `onConfirmationBlockReady(block)`. Required fields: directive must exist; ex-vivo measurements must be entered; unhandled triggers must have matching overrides.

#### Engine helpers (`confirmationEngine.ts`)

| Helper | Purpose |
|---|---|
| `freezeL1EvidencePointer` | Snapshots L1 results into a versioned pointer |
| `buildInSilicoEvidenceFromL1` | Maps L1 results to `InSilicoEvidenceRecord[]` |
| `evaluateInSilicoGate` | Checks confidence per class against `GatePolicySnapshot` |
| `buildExVivoEvidence` | Creates directive-bound `ExVivoEvidenceRecord[]` from UI |
| `checkFalsifiers` | Evaluates `fold_gt`, `lt`, etc. triggers |
| `buildOverride` | Constructs signed audit record |
| `buildConfirmationBlock` | Synthesises the final block + validates write-time invariants |
| `defaultGatePolicy` | Returns the active `GatePolicySnapshot` |
| `l1ConfidenceByClass` | Per-class confidence vector from L1 results |

### 2.4 `ConfirmationEvidenceBlock` Shape (`lib/preclinical-handoff/src/v2_0_0.ts:390`)

```text
ConfirmationEvidenceBlock {
  inSilico: LayerEvidenceBlock {
    evidence: InSilicoEvidenceRecord[]   // per-record value, unit, confidence, falsified flag
    confidenceByClass, falsifierTriggers
  },
  exVivo:   LayerEvidenceBlock { evidence: ExVivoEvidenceRecord[], … },
  jointOutputs: {
    cypTransporter:       { perEnzyme, transporterPanel, status, synthesisedValue, unit, jointConfidence },
    clearanceFractions:   { hepatic, renal, biliary, status, jointConfidence },
    doseResponse:         { status, synthesisedValue, unit, jointConfidence },
    offTarget:            { status, synthesisedValue, unit, jointConfidence },
    hergPbpkProjection:   { status, synthesisedValue, unit, jointConfidence },
  },
  overrides:  OverrideRecord[],
  gateStatus: "passed" | "overridden" | "failed"
  emittedAt:  ISOTimestamp
}
```

### 2.5 L3-side Surfacing — `L2ConfirmationInputsPanel`

Rendered on the L3 Animal Cohort tab (`HakaseAI.tsx:4433`). Mirrors the L1 INPUTS panel visually. Displays:

| Row | Source path |
|---|---|
| Confirmation verdict | `block.gateStatus` |
| In-silico evidence count | `block.inSilico.evidence.length` |
| Ex-vivo evidence count | `block.exVivo.evidence.length` |
| CYP joint signals | inhibitor count across `perEnzyme` + `transporterPanel` |
| Clearance fractions | `Hep XX% · Ren YY% · Bil ZZ%` |
| Dose-response joint | `status · value unit` |
| Off-target joint | `status · value unit` |
| hERG-PBPK joint | `status · value unit` |
| Falsifiers triggered | count where `evidence[].falsified === true` |
| Overrides applied | `block.overrides.length` |
| Joint confidence (avg) | mean across the 5 jointOutputs.jointConfidence |

Status pill: **LIVE** (passed, green) / **OVERRIDDEN** (amber) / **FAILED** (red) / **PENDING** (amber when `block === null`).

**"L2 Confirmation block not sealed" call-out** (amber strip with **"Open seal flow"** button) appears when the L2 sub-track is complete but no block was sealed. Button calls `setActiveLayer(2)` + increments `confirmationExpandSignal` → orchestrator force-expands.

### 2.6 Database / Model Glossary (L2)

| Resource | Used in |
|---|---|
| **AutoDock Vina** (or alt docking engine) | Stage 2 docking |
| **TIES FEP** (RunPod) | Stage 5 free-energy refinement |
| **ESM-2** | Druggability + binding embeddings |
| **DeepDTA** | ML pKd cross-check |
| **GTEx** | 54-organ expression matrix (Ex-Vivo Stage 1) |
| **Tabula Sapiens** | Cell-type atlas (Ex-Vivo Stage 3 — currently unprovisioned) |
| **DepMap PRISM** | Oncology cell-line panel (Ex-Vivo Stage 4) |
| **DILIrank** | Hepatotoxicity reference set |

### 2.7 Handoff to L3

The sealed `ConfirmationEvidenceBlock` is captured in `HakaseAI.tsx` state (`confirmationBlock`). Today **the L3 cohort sim consumes only L1 ADMET** (`runAnimalCohortSimulation(layer1, …)` in `animalSim.ts:245`). Direct propagation of L2-confirmed Kd / PBPK clearance / measured permeability / joint outputs into NOAEL / safety-margin / FIH math is the **next staged step** — surfaced on screen via the L2 Confirmation Inputs panel so the gap is visible.

---

## Layer 3 — Animal Cohort

> **Goal.** Run a simulated animal study battery (ICH M3(R2)-aligned), compute PBPK-derived NOAEL / MTD, scale to human via BSA + PBPK, and emit a Phase-1-ready FIH dose proposal.
>
> Internally `activeLayer === 3`. The results component is named `Layer2AnimalResults` for legacy reasons — it renders the L3 panel.

### 3.1 Inputs

| Field | Options | Source |
|---|---|---|
| **Species** | Mouse (CD-1), Mouse (C57BL/6), Rat (Sprague Dawley), Rat (Wistar), Dog (Beagle), Cynomolgus Monkey | `animalSim.ts:28–71` (each species defines `kmFactor`, `clScaleFactor`, `hepaticBloodFlow`) |
| **Study type** | Single Dose (Acute), Sub-Acute (14-Day), Sub-Chronic (28-Day GLP), Chronic (90-Day GLP) | `animalSim.ts:91–112` |
| **Route** | Oral, IV, SC, IM, Topical, Inhalation | `HakaseAI.tsx:4286–4300` |
| **Formulation** (Oral only) | Plain / Unformulated, SAS, SMEDDS, LBDDS, Nanocrystal | `animalSim.ts:286` (impacts F% via BCS class) |

Auto-configured from L1 data (overridable): species, study, route, formulation are populated from L1 RECOMMENDATIONS (e.g. logP > 5 → LBDDS).

### 3.2 Simulation Core (`animalSim.ts`)

```text
runAnimalCohortSimulation(layer1, speciesId, studyTypeId, routeOfAdmin, formulationType, seed)
```

**L1 fields consumed** (lines 257–261):
- `lipinski.{MW, LogP, HBD, TPSA}`
- `admet.{absorption, metabolism, toxicity}`
- `toxAlerts`
- `binding.primaryIC50`

**Math**:

| Quantity | Formula / approach | Lines |
|---|---|---|
| Allometric clearance | `sp.clScaleFactor * Math.pow(bwH / bw, -0.25)` | 322 |
| NOAEL | Therapeutic dose (10× IC50 Cmax) × `admet.toxicity` × organ-alert adjustments | 331–354 |
| MTD | NOAEL × species/study factor | 331–354 |
| HED (BSA / Km) | `noael * (sp.kmFactor / 37)` | 367–371 |
| HED (PBPK-refined) | BSA HED × PBPK clearance correction | 367–371 |
| FIH dose | `min(HED) / 10` | 375 |

> ⚠ The cohort sim does **not** consume the L2 ConfirmationEvidenceBlock today. This is the propagation gap surfaced by `L2ConfirmationInputsPanel`.

### 3.3 Result Panels (`Layer2AnimalResults`, `HakaseAI.tsx:7729–7987`)

Order on the page:

1. **Upstream `SafetyFlagCascadeBanner`** (when L1/L2 flags exist).
2. **`OverrideBanner`** (when overrides apply at `toLayer ≤ 3`).
3. **`GracefulDegradationBanner`** (DBs that degraded).
4. **`L2ConfirmationInputsPanel`** (cyan; new — see §2.5).
5. **Core PBPK metrics** — NOAEL, MTD, animal t½ (line 7760).
6. **PK profiles** — SVG of Animal vs. Projected Human 1-compartment curves (line 7774).
7. **Study Group Design** — Vehicle / Low / Mid / High dose group table (line 7864).
8. **Predicted Toxicity Signals** — organ-specific (Cardio, Hepatic, Genotox) with ICH mapping (line 7891).
9. **Human Translation Panel** — HED (BSA vs PBPK), Safety Margin, **Proposed FIH Dose** (line 7913).
10. **Regulatory Checklist** — IND-enabling gap report (line 7958).
11. **`ProvenanceFooter`** (line 4439, 8159) — engine + version + databaseQueries.

### 3.4 Database / Model Glossary (L3)

| Resource | Used for |
|---|---|
| **Species PK reference table** (`animalSim.ts:28–71`) | kmFactor, clScaleFactor, hepatic blood flow per species |
| **PBPK 2-compartment model** (`pbpk.ts`) | Animal + projected human concentration profiles |
| **ICH M3(R2)** | Study type definitions (acute / sub-acute / sub-chronic / chronic) |
| **BSA / Km method** | HED scaling |
| **BCS class table** | Formulation → F% modulation |

### 3.5 Handoff to L4

L3 emits an `AnimalCohortEvidenceBlock` (`lib/preclinical-handoff/src/v2_0_0.ts:409–423`):
- `studyRecords[]` (per cohort: species, dose group, observed signals)
- `confirmationPackageRef` (back-pointer to L2 block, if sealed)
- `falsifiersTriggeredInVivo[]`
- Computed NOAEL / MTD / HED / FIH dose

Together with the L2 `ConfirmationEvidenceBlock`, this forms the Pre-Clinical Package consumed by L4.

---

## Layer 4 — First-In-Human

> **Goal.** Convert the Pre-Clinical Package (L1 + L2 + L3 evidence) into a Phase 1 clinical trial design seed: starting dose (MABEL vs HED), escalation scheme, special-population arms, IND-gate readiness.
>
> Internally `activeLayer === 4`. Block in `HakaseAI.tsx:4451`.

### 4.1 Inputs (received as props)

| Prop | Source | Required? |
|---|---|---|
| `confirmationBlock` | L2 sealed block | Optional today; required for full FIH derivation |
| `animalResults` | L3 cohort sim output | Required |
| `simResults` (L1) | L1 sim | Required (provides molecule + target context) |

### 4.2 Result Panel (`FirstInHumanPanel`, `HakaseAI.tsx:10395`)

Phase 1 strategy synthesis. Includes:
- **Starting-dose selection** — chooses between **MABEL** (Minimum Anticipated Biological Effect Level) and **HED-based** starting dose with explicit safety-factor justification.
- **Escalation scheme** — Fibonacci vs. accelerated titration; SAD then MAD design.
- **Special-population arms** — Renal impairment / Hepatic impairment cohort recommendations driven by L2 clearance fractions + L3 toxicity signals.
- **IND-gate readiness** — checklist of preclinical evidence requirements per ICH / FDA.

> **Status.** The Phase 1 planner redesign is staged as a follow-up. The current panel renders read-only synthesis; an interactive planner editor is the next major L4 work.

### 4.3 Handoff: L4 → Hakase Clinical

L4 emits an **IND-gate readiness package** as a typed boundary payload (`lib/preclinical-handoff/` v1 `PreClinicalPackage`). The Phase 1 Planner (`Phase1Planner.tsx`) is embedded directly inside the L4 `FirstInHumanPanel` and consumes that package in-process — no cross-artifact JSON paste. The previously-planned standalone `Hakase Clinical` artifact (a separate React + Vite app) has been removed; if a future deployment surface is needed, build it fresh.

---

## Regulatory Intelligence — Cross-Layer Outlook (`src/pages/Regulatory.tsx`, route `/regulatory`)

> **Goal.** Marketing / spec surface that documents the per-layer **Regulatory Outlook** the platform aims to surface at every pre-clinical layer. As of May 2026 this page is **a static spec page** (hardcoded coverage arrays + screenshot stills of the in-app outlook); the runtime-computed Regulatory Outlook lives inside the dashboard layers themselves and is sourced from `safetyFlags.ts`, `admet.ts`, `animalSim.ts`, and the L4 IND-gate. Treat the items below as the contract the live outlook is held to.

### Coverage matrix (one column per layer)

| Layer | Outlook contents | Source of truth |
|---|---|---|
| **L1 — In Vitro Twin** | hERG / Cardiac QT flags · Mutagenicity / Genotox alerts · Required IND-enabling studies (six study types, urgency-weighted Urgent → Required → Waivable) · Physicochemical vs FDA guidance (RO5, BCS Class I/II) · Source-quality tier badge per output · Precedent drug context (approved drugs in same structural class) | `safetyFlags.ts`, `admet.ts`, `chemistry.ts`, ChEMBL similarity |
| **L2 — Confirmation** | Structural confirmation (ESM-2 + Vina docking) · Selectivity & cardiotox cross-check (Morgan-RF) · Opt-in FEP refinement (RunPod TIES) · Ex-vivo evidence (organoid / hERG patch / hepatocyte CL) · **Sealed `ConfirmationBlock` v2.0.0** | `l2Pipeline.ts`, `confirmationEngine.ts` |
| **L3 — Animal Cohort** | Multi-species PBPK (rat · dog · monkey) · FDA-IIG-compliant formulation engine · Allometric scaling per **ICH M3(R2)** · NOAEL → HED with bootstrap CIs · Cross-validated vs ToxCast / ToxRefDB · FAERS AE label signals (pre-populates WARNINGS AND PRECAUTIONS) · Phase I clinical-pharmacology package (SAD, MAD, Food Effect, Renal/Hepatic Impairment, **TQT (ICH E14)**, DDI, PopPK) tagged Required vs Recommended | `animalSim.ts`, `pbpk.ts`, FAERS reference |
| **L4 — FIH Readiness** | **MABEL-biased starting dose** (FDA 2005 / EMA 2017 — preferred over NOAEL/HED whenever target engagement is the binding constraint) · IND-enabling gate (GLP tox · CMC · Investigator's Brochure · Pre-IND meeting prerequisites) · Designation eligibility (Breakthrough · Fast Track · Accelerated Approval · Orphan) · **Sealed `PreClinicalPackage` v2.0.0** handoff | `FirstInHumanPanel` (`HakaseAI.tsx:10395`), `Phase1Planner.tsx`, `lib/preclinical-handoff/src/v2_0_0.ts` |

### Methodology pillars (rendered on `/regulatory`)

| Pillar | Behaviour |
|---|---|
| **Deterministic rules engine** | hERG → Cardiac QT study, mutagenicity → Ames + MN battery, CYP → full DDI panel. No AI hallucination risk for compliance-critical items. |
| **ICH guideline mapping** | Studies are mapped to **ICH S7A/S7B** (safety pharmacology), **ICH E14** (QT/QTc), **ICH M3(R2)** (non-clinical), and FDA clinical pharmacology guidance for NDA / BLA. |
| **PBPK-driven dosing** | Phase I MRSD, interval, and DLT-risk are computed directly from PBPK outputs (not static estimates); the 1/10 × Cmax rule follows FDA Phase I dose-escalation guidance. |
| **FAERS signal integration** | AE rates are calibrated against FDA's Adverse Event Reporting System for label-informing incidence estimates. |
| **MABEL-biased starting dose** | Per FDA 2005 / EMA 2017 — *preferred* over NOAEL/HED whenever target engagement is binding. Calculation derived from L1–L3 evidence; never authored, never silently overridden. |
| **Sealed handoff** | `PreClinicalPackage v2.0.0` bundles L1 verdict + L2 ConfirmationBlock + L3 NOAEL/HED + L4 IND-gate result with full HAIOps provenance — tamper-evident, regulator-ingestible. |

> **Anti-fabrication.** The Regulatory Outlook never invents a flag. Empty / unrunnable items render `—` and surface in the gap report; hard blocks cannot be silently waived (only acknowledged via the IVIVE / Stage-Gate sign-off flow).

---

## Component Map

```
artifacts/hakase-ai/src/
├── pages/
│   └── HakaseAI.tsx              ← Main dashboard. Holds activeLayer, simStatus, simResults,
│                                   inVitroResults, animalResults, confirmationBlock,
│                                   confirmationExpandSignal. Renders all four layer tabs.
├── components/
│   ├── MlAdmetCard.tsx           ← L1 ADMET 5-axis radar + grid
│   ├── Layer2InSilicoScaffold.tsx ← L2 In-Silico sub-track (10 stages)
│   ├── Layer3ExVivoScaffold.tsx  ← L2 Ex-Vivo sub-track (legacy filename)
│   ├── ConfirmationLayerPanel.tsx ← L2 Orchestrator: directive → measurements → seal
│   └── (FirstInHumanPanel inline in HakaseAI.tsx ~10395)
├── lib/
│   ├── chemistry.ts              ← RDKit, descriptors, pharmacophore
│   ├── apiImport.ts              ← ChEMBL import
│   ├── proteinApi.ts             ← UniProt, AlphaFold, PDB
│   ├── targetSuggestion.ts       ← ChEMBL similarity + heuristic catalog
│   ├── aiService.ts              ← All /predict/* calls
│   ├── inVitroSim.ts             ← In-vitro sim engine
│   ├── admet.ts                  ← SimResults shape, GO/NO-GO scoring
│   ├── safetyFlags.ts            ← Safety flag engine (do not modify)
│   ├── cascadeGate.ts            ← L1 → L3 cascade gate
│   ├── ecotox.ts                 ← Ecotox (no fallback table — explicit policy)
│   ├── confirmationEngine.ts     ← All buildXxx + checkFalsifiers helpers
│   ├── l2Pipeline.ts             ← 10-stage L2 In-Silico pipeline
│   ├── l2DoseProjection.ts       ← TI margins + first human dose projection
│   ├── pbpk.ts                   ← 2-comp RK4 ODE solver
│   ├── animalSim.ts              ← L3 runAnimalCohortSimulation
│   └── layerArchitecture.ts      ← Layer numbering + routing comments
└── (companion package)
    └── lib/preclinical-handoff/src/v2_0_0.ts
                                  ← All v2.0.0 handoff types: PreClinicalPackageV2_0_0,
                                    ConfirmationEvidenceBlock, AnimalCohortEvidenceBlock,
                                    LayerEvidenceBlock, OverrideRecord, EvidencePointer,
                                    GatePolicySnapshot, FalsifierId, ConfidenceVector
```

---

## Master Database / Model Glossary

| Name | Kind | Where it's used |
|---|---|---|
| **RDKit** | Cheminformatics toolkit | L1 chemistry init |
| **ChEMBL** | DB | L1 SMILES import + similarity + target lookup |
| **UniProt KB** | DB | L1 target metadata |
| **AlphaFold DB / PDB** | DB | L1 structure for visualization, L2 docking |
| **BindingDB** | DB | DeepDTA training corpus |
| **ADMET-AI v2** | ML (Chemprop GNN) | L1 ADMET endpoints |
| **DeepDTA-GBM** | ML (Morgan + ESM-2) | L1 binding + L2 cross-check |
| **Cardiotox** | ML | L1 hERG IC50 |
| **DILI-ML / DILIrank** | ML + DB | L1 + L2 hepatotoxicity |
| **ESM-2** | Protein LM | L2 druggability + binding embeddings |
| **AutoDock Vina** (or alt) | Docking engine | L2 Stage 2 (opt-in) |
| **TIES FEP** | Free-energy method | L2 Stage 5 (opt-in, RunPod GPU) |
| **GTEx** | Expression DB | L2 Ex-Vivo Stage 1 (54-organ matrix) |
| **Tabula Sapiens** | Single-cell atlas | L2 Ex-Vivo Stage 3 (currently unprovisioned → 503) |
| **DepMap PRISM** | Cell-line panel | L2 Ex-Vivo Stage 4 |
| **PBPK 2-comp RK4** | ODE model | L2 Stage 6 + L3 PK profiles |
| **ICH M3(R2)** | Regulatory standard | L3 study type definitions |
| **ICH S7A / S7B** | Regulatory standard | Safety pharmacology — surfaced on `/regulatory` |
| **ICH E14** | Regulatory standard | QT/QTc (TQT) — surfaced on `/regulatory` |
| **FDA 2005 / EMA 2017** | Regulatory guidance | MABEL-biased FIH starting dose (L4) |
| **BSA / Km method** | Scaling rule | L3 HED |
| **BCS class table** | Reference | L3 formulation → F% |
| **FAERS** | Post-market AE DB | L3 / `/regulatory` AE label-signal calibration |
| **ToxCast / ToxRefDB** | Tox DB | L3 cross-validation reference |
| **Lombardo 2018 · Smith 2010 · Obach 1999** | Pharmacokinetics literature | IVIVE auto-substrate anchors + microsomal binding correction (§2.0b) |

---

## Master Handoff Diagram

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  L1 In-Vitro                                                        │
   │  Inputs: SMILES, target, therapeutic area, fingerprint mode         │
   │  → SimResults (admet, lipinski, binding, toxAlerts, goNogo)         │
   │  → InVitroResults                                                   │
   │  → freezeL1EvidencePointer(compoundId, ts) ────────┐                │
   └────────────────────────────────────────────────────┼────────────────┘
                                                       │
   ┌──── Cascade Gate (cascadeGate.ts) ────────────────┴────────────────┐
   │  Block if NO-GO, safety key < 0.6, or non-safety avg < 0.6         │
   │  Else: auto-cascade or stage-gate review w/ override                │
   └──────────────────────────────────────────────────────────┬─────────┘
                                                              │
                              ┌───────────────────────────────┴─────────┐
   ┌──────────────────────────┴─────────┐  ┌────────────────────────────┴──┐
   │  L2 In-Silico (10 stages)          │  │  L2 Ex-Vivo (6 stages)        │
   │  l2Pipeline.ts                     │  │  Layer3ExVivoScaffold.tsx     │
   │  Stages 2 + 5 are opt-in skip envs │  │  Stage 3 = Tabula Sapiens     │
   └──────────────────────────┬─────────┘  └────────────────────────────┬──┘
                              └───────────────────────┬──────────────────┘
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  L2 Confirmation Orchestrator (ConfirmationLayerPanel.tsx)           │
   │  Emit directive → enter measurements → falsifier check → overrides   │
   │  → Seal ConfirmationEvidenceBlock                                    │
   │  Joint outputs: cypTransporter, clearanceFractions, doseResponse,    │
   │                 offTarget, hergPbpkProjection                        │
   │  gateStatus: passed | overridden | failed                            │
   └──────────────────────────────────────────────────────┬───────────────┘
                                                          │  (sealed block,
                                                          │   surfaced on L3
                                                          │   via L2ConfirmationInputsPanel)
                                                          ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  L3 Animal Cohort (animalSim.ts)                                     │
   │  Inputs: species, study, route, formulation                          │
   │  Consumes: L1 ADMET only (today — propagation gap surfaced)          │
   │  Outputs: NOAEL, MTD, HED (BSA + PBPK), FIH dose, study group design │
   │  Emits: AnimalCohortEvidenceBlock                                    │
   └──────────────────────────────────────────────────────────┬───────────┘
                                                              ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  L4 First-In-Human (FirstInHumanPanel)                               │
   │  Inputs: confirmationBlock + animalResults + simResults              │
   │  Outputs: MABEL vs HED start, escalation scheme, special-pop arms,   │
   │           IND-gate readiness                                         │
   │  → Phase1Planner embedded in L4 (Phase1Planner.tsx)                  │
   └──────────────────────────────────────────────────────────────────────┘
```

---

## Open Items / Known Gaps

| # | Gap | Status |
|---|---|---|
| 1 | L3 cohort sim consumes only L1 ADMET — L2 confirmed values (Kd, PBPK CL, measured permeability, joint outputs) not propagated into NOAEL/MTD/HED math | Surfaced on screen via `L2ConfirmationInputsPanel`; propagation is the next major step |
| 2 | Tabula Sapiens atlas not provisioned → L2 Ex-Vivo Stage 3 returns 503 | Honest 503 + `—`; no synthetic atlas injected |
| 3 | RunPod FEP credentials (`RUNPOD_API_KEY`, `RUNPOD_FEP_ENDPOINT_ID`) not configured | L2 Stage 5 stays in skip envelope |
| 4 | L4 Phase 1 planner is read-only synthesis | Interactive planner editor staged as follow-up |
| 5 | L4 → Hakase Clinical handoff is a documented contract, not live wiring | Cross-artifact integration staged |
| 6 | Legacy file/component names (`Layer3ExVivoScaffold.tsx`, `Layer2AnimalResults`) do not match current layer numbering | Semantic rename pending |
