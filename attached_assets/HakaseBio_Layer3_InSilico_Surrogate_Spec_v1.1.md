# HakaseBio · Layer 3 Ex-Vivo · In-Silico Surrogate Spec — v1.1

**Status:** Active build spec. Supersedes v1.0 (`HakaseBio_Layer3_InSilico_Surrogate_Spec_1777808267607.docx`).
**Authoring:** AKTHealth · HakaseAI · May 2026
**Companion:** HAIOps Bio 4-Layer Implementation Playbook
**Mirrors:** L1 heuristic + ML pattern (`lib/admet.ts`, `lib/inVitroSim.ts`)

---

## v1.0 → v1.1 changelog

v1.1 keeps the v1.0 direction unchanged: L3 is in-silico-surrogate-first (T0 default),
vendors / CROs are opt-in upgrades (T1 / T2 / T3). v1.1 closes six implementation gaps
and one honesty gap surfaced during code review:

1. **Build estimate honest** — 6–9 weeks single-dev, 4–6 weeks parallelised; plan 8 weeks.
   v1.0's "3–5 weeks" underestimated CELLxGENE TypeScript-client friction, organoid
   composition curation, and DILI training infra.
2. **`organoid-response-ml` minimum-N gate** — bootstrap cohort 50–150 pairs; minimum 30
   compound-organoid pairs per organoid type OR ≥3 chemical scaffolds before the
   calibration layer ships. Below that, surrogate surfaces the structural prediction
   alone with its un-calibrated band. Retraining trigger: ≥10% cohort growth or ≥1.2×
   band shift, not a fixed weekly schedule.
3. **Drug2cell attribution, not reimplementation** — `pip install drug2cell`
   (Teichmann lab, github.com/Teichlab/drug2cell, MIT). Pin Tabula Sapiens v2 by SHA;
   wrap output in `cellTypeAggregator`. v1.0's "reimplemented" framing was wrong.
4. **`prediction_only` as a discriminated union** — `CascadeFlagState` is a tagged enum
   (`pass` / `fail` / `prediction_only` / `not_applicable`) with exhaustive-switch
   enforcement. Amber Curator's refusal-to-sign becomes a compile-time guarantee.
5. **T1 retrieval real spec** — Tanimoto thresholds (≥0.85 high-confidence, 0.7–0.85
   informational, <0.5 no-match), distinct typed errors (`NoAnalogsFound` /
   `ServiceUnreachable` / `RegistrationRequired`), realistic 2-week ToxRefDB +
   MPS-Database ingest.
6. **Per-readout `tier` field** — `tier` lives on each readout block, never at envelope
   top level. Mixed-tier envelopes are the normal case.
7. **§9.1 numbers reframed as targets, not predictions** — "target fold-error bands, to
   be measured against initial calibration cohorts; bands surfaced in the UI will be
   actual measured values from those cohorts, not literature-derived targets. We do
   not narrow the band ahead of the data."

---

## 1. Direction (unchanged from v1.0)

L3 is built first as an **in-silico surrogate** that mirrors the pattern that already
works at L1: deterministic heuristic engines + trained ML models on real public
datasets + cascade-gated outputs with honestly-labelled confidence intervals.
Vendor adapters and CRO panels become **opt-in upgrades**, not gating dependencies.

The honesty rule from L1 / L2 carries forward unchanged: every T0 output ships with
its computation method, its training-cohort hash where ML is involved, its
applicability-domain score, and an explicit fold-error band. We do not produce a
number we cannot defend. We do not fabricate organoid IC50s.

---

## 2. Tier architecture

| Tier | What it is | Default for | Vendor / CRO required? |
|------|------------|-------------|------------------------|
| **T0** — In-silico surrogate | Heuristic + ML predictions of organoid response from L1 + L2 + public atlases. Default L3 path. Always runnable. | Every compound | No |
| **T1** — Public-data anchored | T0 + retrieval of existing wet readouts on the compound or near analogs from HCMI / MPS-Database / ONTOX / JUMP-CP / NCATS / ToxRefDB. | Compounds with known analogs | No |
| **T2** — CRO wet panel | Independent CRO (Charles River, Eurofins, Inotiv, WuXi AppTec, Pharmaron) runs an organoid / PCLS / hepatocyte panel as work-for-hire. | Compounds entering IND-enabling work | CRO; no chip-vendor lock-in |
| **T3** — Vendor adapter | Direct integration with a chip vendor (Emulate, CN Bio, Mimetas, TissUse, InSphero) for programs that have chosen one. | Per-program | Vendor; per-program decision |

Each tier is independently runnable. T0 ships first; T1–T3 are progressive upgrades.

---

## 3. T0 surrogate — what it computes

Six concrete predictions per compound:

### 3.1 Tissue-selectivity matrix (54 organs)
Per organ, predicted exposure margin = unbound concentration in tissue ÷ IC50.
Inputs: L2 PBPK per-compartment Cu, L1 IC50, GTEx target mRNA expression.
Method: deterministic; ML used only for tissue partitioning where PBPK lacks an
explicit compartment. Output: 54-row table with CIs propagated from L1 IC50 SE
and L2 PBPK posterior.

### 3.2 Cell-type efficacy (Drug2cell pattern)
For each cell type in Tabula Sapiens v2 (~480 across 28 organs):
score = target_gene_expression × predicted_drug_affinity. Inputs: Tabula Sapiens v2
expression matrix (CELLxGENE Census API), L1 affinity, L2 unbound concentration.
**Method (v1.1 correction):** `pip install drug2cell` (Teichmann lab, MIT-licensed),
attribute properly, pin Tabula Sapiens v2 by SHA, wrap Python output in our
`cellTypeAggregator`.

### 3.3 Predicted organoid efficacy (cell-type aggregation)
Aggregate Drug2cell per-cell-type response weighted by published organoid composition
fractions; project to organoid IC50 via Hill-equation fit.
Honest fold-error: typically 3–5× vs. wet on retrospective benchmarks. Output explicitly
labelled "T0 prediction, fold-error 3–5× expected" once the calibration cohort is
assembled (§7.3 v1.1 minimum-N).

### 3.4 Predicted organoid hepatotoxicity (DILI mechanism classifier)
Inputs: L1 cytotoxicity, L1 ADMET descriptors, L2 hepatic Cu, transporter substrate
flags. Method: Random Forest (or gradient-boosted ensemble) on DILIrank
(~700 compounds with adjudicated DILI severity). Output: severity class
(most-DILI / less-DILI / no-DILI) with calibrated probability + mechanism flags
(mitochondrial / BSEP / ROS / immune-mediated).

### 3.5 Predicted patient-line variance (HCMI projection — oncology only)
Inputs: target gene + indication, L1 affinity, HCMI catalogue, DepMap PRISM cell-line
response. Output: predicted IC50 distribution across patient-line genomics with
predicted variance. `null` when out of applicability domain (non-oncology).

### 3.6 Predicted DILI biomarker proxy
Rule-based mapping from §3.4 mechanism flags to expected biomarker pattern
(mitochondrial → GLDH; cholestatic → ALP; hepatocellular → ALT, miR-122; immune →
eosinophilia priors). Output: predicted biomarker pattern likelihood — triage-grade.

### 3.7 Predicted permeability and Kp,uu
Inputs: L1 Caco-2, L2 PBPK gut + brain compartments, transporter flags. Method:
deterministic mapping. Output: predicted F_oral, brain Kp,uu where CNS-relevant.

### 3.8 What T0 deliberately does NOT predict
- Real-time perfusion kinetics in coupled multi-organ chips (T3 territory).
- Patient-derived non-cancer organoid efficacy (HUB Foundation; T3).
- Specific adaptive immune responses (no public dataset of meaningful size).
- Microbiome interactions (out of scope for surrogate AND chip vendors).

---

## 4. Module decomposition

### 4.1 New `lib/` modules (TypeScript)

| Module | Est. lines | Purpose |
|---|---|---|
| `lib/exVivoSurrogate.ts` | 500–650 | Top-level orchestrator |
| `lib/tissueSelectivity.ts` | 250–350 | 54-organ margin matrix |
| `lib/cellTypeAggregator.ts` | 300–400 | Drug2cell + organoid composition |
| `lib/hepatotoxPredictor.ts` | 250–350 | DILI severity + mechanism wrapper |
| `lib/patientLineProjection.ts` | 200–300 | HCMI + DepMap (oncology) |
| `lib/transporterFlags.ts` | 150–200 | BSEP / OAT / OCT / MRP / OATP QSAR |
| `lib/cascadeFlagState.ts` (v1.1) | 80–120 | Discriminated union for cascade states |
| `lib/gtexClient.ts` (v1.1) | 100–150 | GTEx Portal v2 client (gene + median TPM) |

### 4.2 New ML services
- **dili-ml** — LightGBM/XGBoost on Morgan FP + L1 ADMET; trained on DILIrank.
- **tissue-deconv-ml** — embedding-lookup + small calibration regression.
- **organoid-response-ml** — gradient-boosted regressor over T0 prediction features
  + chemical descriptors. **v1.1: minimum-N gate (30 pairs OR ≥3 scaffolds)**.

### 4.3 External APIs
- **CELLxGENE Census** — primary route to Tabula Sapiens v2 + HCA v2.
  **v1.1 path:** bulk-download Tabula Sapiens v2 + HCA v2 to local Parquet for v1
  (loses the API's dynamic slicing; gains independence from Census uptime). Stand
  up a Python sidecar with the official `cellxgene-census` client when slicing
  becomes necessary.
- **GTEx Portal v2** — REST, no auth, CORS allow `*`. Implementation note: as of
  build time the public `medianGeneExpression` endpoint exposes `gtex_v8` only;
  `gtex_v10` is announced but not yet wired. We use v8 honestly; flip to v10
  when available.
- **HCMI / DepMap PRISM / DILIrank / JUMP-CP / ToxRefDB / MPS-Database** —
  bulk-downloaded snapshots, cached locally, content-addressed in DVC.

---

## 5. Module interface sketches

### 5.1 `lib/cascadeFlagState.ts` (v1.1 NEW — discriminated union)

```typescript
export type CascadeFlagState =
  | { kind: "pass"; checkedAt: string }
  | { kind: "fail"; checkedAt: string; reason: string; remediation: RemediationRoute }
  | { kind: "prediction_only";
      checkedAt: string;
      method: string;
      foldError: { median: number; p90: number; cohortN: number; measuredAt: string | null };
      applicabilityDomain: { inDomain: boolean; score: number; rationale: string };
      snapshotsWithinCadence: boolean;
      uiBanner: string }
  | { kind: "not_applicable"; checkedAt: string; reason: string };

// Compile-time exhaustive-switch enforcement.
export function assertExhaustive(s: never): never { /* … */ }

// Amber Curator gate — load-bearing fields require `pass`. T0 outputs (kind:
// "prediction_only") are explicitly rejected per spec §8.2.
export function canSignLoadBearing(state: CascadeFlagState): boolean {
  return state.kind === "pass";
}
```

### 5.2 `lib/exVivoSurrogate.ts` (orchestrator)

```typescript
export interface L3SurrogateInput {
  compoundId: string;
  smiles: string;
  inchiKey: string;
  l1Outputs: L1Envelope;
  l2Outputs: L2Envelope;
  context: {
    indication?: string;
    targetUniprotId: string;
    organoidTypes: OrganoidType[];
    cnsRelevant: boolean;
  };
}

export interface L3SurrogateOutput {
  // Every readout carries its OWN tier + cascade state — never a top-level field.
  tissueSelectivity:        ReadoutBlock<TissueSelectivityMatrix>;
  cellTypeResponse:         ReadoutBlock<CellTypeResponseMatrix>;
  organoidEfficacy:         ReadoutBlock<OrganoidEfficacyPrediction>;
  hepatotoxClassification:  ReadoutBlock<DILIPrediction>;
  patientLineVariance:      ReadoutBlock<PatientLinePrediction> | { kind: "not_applicable"; reason: string };
  diliBiomarkerProxy:       ReadoutBlock<BiomarkerPattern>;
  permeability:             ReadoutBlock<PermeabilityPrediction>;
  provenance:               ProvenanceEnvelope;
}

interface ReadoutBlock<V> {
  tier: "t0" | "t1" | "t2" | "t3";
  value: V;
  cascadeState: CascadeFlagState;
  applicability: ApplicabilityDomain;
  provenance: { method: string; modelVersion?: string; trainingCohortHash?: string; computedAt: string };
}
```

### 5.3 `lib/tissueSelectivity.ts`

```typescript
export interface TissueSelectivityRow {
  tissueId: string;            // GTEx tissueSiteDetailId
  tissueName: string;
  ontologyId: string;          // UBERON
  predictedCu_uM: number;
  ic50_uM: number;
  marginRatio: number;         // ic50 / Cu
  onTargetScore: number;       // engagement × expression weight
  targetExpressionTpm: number; // GTEx
  pbpkCompartment: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
}

export interface TissueSelectivityMatrix {
  rows: TissueSelectivityRow[];
  // … provenance + cascade state
}

export async function computeTissueSelectivityMatrix(
  args: { sim: SimResults; iv: InVitroResults; l2Params?: L2InputParams }
): Promise<TissueSelectivityMatrix>;
```

### 5.4 `lib/transporterFlags.ts`

```typescript
export type TransporterChannel =
  | "bsep" | "oat1" | "oat3" | "oct2"
  | "oatp1b1" | "oatp1b3" | "pgp" | "bcrp" | "mrp2";

export interface TransporterFlag {
  substrate: boolean;
  inhibitor: boolean;
  confidence: number;       // 0–1
  rationale: string;        // cites the published QSAR rule
}

export function predictTransporterFlags(L: LipinskiAnalysis): TransporterFlagsResult;
```

(§5.5–5.7 hepatotoxPredictor / patientLineProjection / cellTypeAggregator: shapes
unchanged from v1.0; per-readout tier and discriminated cascade state added.)

---

## 6. Data sources (unchanged from v1.0 except dataset version notes)

GTEx **v8** (v10 pending REST endpoint), Tabula Sapiens v2, Human Cell Atlas v2,
DILIrank, LTKB, ToxRefDB / ToxValDB, Tox21 / ToxCast, HCMI, DepMap PRISM,
JUMP-CP, MPS-Database, NCATS Tissue Chip. Every snapshot content-addressed in DVC;
SHA travels in provenance envelope.

---

## 7. ML models — training and calibration

### 7.1 dili-ml — DILI severity + mechanism classifier
Architecture: gradient-boosted ensemble on Morgan FP (radius 2, 2048 bits) + L1
ADMET vector. Training: DILIrank primary, LTKB cross-validation. Targets: 3-class
severity + 4-channel mechanism. CV: 5-fold stratified by chemical scaffold.
Calibration: temperature scaling. Same model shape as `cardiotox-ml`.

### 7.2 tissue-deconv-ml
Precomputed cell-type embedding matrix + lightweight regression head. Inference:
vector dot product (sub-ms). Not strictly a learned model; primarily an embedding
lookup + Drug2cell scoring with a small calibration head.

### 7.3 organoid-response-ml — calibration model (online retraining)
Architecture: LightGBM regressor over T0 prediction features + chemical descriptors,
target = wet-measured organoid response.

**v1.1 concrete numbers:**
- **Bootstrap cohort:** 50–150 compound-organoid pairs from HCMI published
  validation, PDXE encyclopedia (Novartis 2015), Tox21 organoid-mode expansions
  since 2023, supplementary HUB-line validation papers. DepMap PRISM (6000 × 2000
  IC50s) usable as labelled-proxy with explicit "2D not organoid" tag.
- **Minimum-N gate:** 30 compound-organoid pairs per organoid type **OR** cohort
  spans ≥3 chemical scaffolds. Below threshold the calibration model is **suppressed**
  and the surrogate surfaces the structural `cellTypeAggregator` output alone with
  its un-calibrated band.
- **Retraining trigger:** when calibration cohort grows ≥10% **OR** observed
  fold-error band shifts ≥1.2×, whichever first. Steady-state ≈ monthly.
- **Ownership:** Performance & Lineage Swarm owns retraining pipeline; Compliance
  Swarm owns QMRF refresh per retrain. Each retrain bumps `model_version` and emits
  cascade flag 6 event with new fold-error band.

### 7.4 Validation strategy
Every ML model ships with: (a) QMRF document keyed to OECD QSAR five validation
principles; (b) V&V40 credibility report at rigor matched to FDA 2024 AI draft
guidance; (c) retrospective fold-error report against any wet data we have. All
three required for cascade flag 4 (Regulatory) to pass at L3.

---

## 8. Cascade integration at L3

Same six-flag HAIOps cascade as every other layer. The catch matrix from the
playbook §3.1 carries forward unchanged.

### 8.1 Flag-by-flag T0 behaviour

| Flag | T0-specific behaviour |
|---|---|
| 1. Data Quality | Validates dataset snapshots within refresh cadence. Surfaces `prediction_only` state distinct from "data missing." |
| 2. Bias & Equity | Validates HCMI line-projection coverage; flags sparse-coverage indications and absent patient-line variance for non-cancer. |
| 3. Clinical Relevance | Validates that requested organoid type is biologically representative of indication-target organ. |
| 4. Regulatory | Enforces QMRF + V&V40 + fold-error report on every ML model. Tags T0 outputs as triage-grade, never IND-supporting on their own. |
| 5. Safety Signal | DILI mechanism triggers, predicted iPSC-CM arrhythmia from L1+L2, hERG cross-check. |
| 6. Drift & Stability | Tracks T0-vs-wet fold-error; drift events trigger `organoid-response-ml` retraining. |

### 8.2 The `prediction_only` envelope state — v1.1 discriminated union

v1.0 specified `prediction_only` as a string state distinct from pass / fail. v1.1
promotes it to a tagged enum branch in TypeScript so every consumer is forced (at
compile time) to handle each branch:

```typescript
function evaluateForSigning(s: CascadeFlagState): SignatureDecision {
  switch (s.kind) {
    case "pass":             return canSign;
    case "fail":             return blockWithReason(s.reason);
    case "prediction_only":  return requireWetAnchor(s.method, s.foldError);
    case "not_applicable":   return skip;
    default:                 return assertExhaustive(s);
  }
}
```

The Amber Curator's refusal-to-sign at L4 becomes a **compile-time guarantee**:
the `canSignLoadBearing` predicate accepts only `kind: "pass"` for load-bearing
fields. Adding a new branch to `CascadeFlagState` without updating the curator is
a compile-time error.

---

## 9. Validation, benchmarking, honest confidence

### 9.1 Calibration cohorts — v1.1 reframed as targets, not predictions

v1.0 listed expected fold-errors ("2–3× for tissues with explicit PBPK
compartments, 3–5× for organoid IC50, 0.78–0.85 AUC for DILI"). Those are
literature upper-bound expectations, not measurements on our cohort, and stating
them as predicted bands violated the doc's own honesty rule.

v1.1: **Target fold-error bands, to be measured against initial calibration
cohorts. The bands surfaced in the UI will be the actual measured values from
those cohorts, not the literature-derived targets. We do not narrow the band ahead
of the data.**

The `foldError` field in `CascadeFlagState` carries `cohortN: 0` until the
calibration cohort is assembled; the UI explicitly renders "calibration cohort not
yet assembled" rather than a fabricated band.

### 9.2 Continuous calibration
Every T2 / T3 wet readout that arrives is logged as a calibration sample.
Performance & Lineage Swarm tracks T0-vs-wet fold-error per surrogate output and
updates the bands surfaced in the UI. As the cohort grows, T0 confidence intervals
tighten honestly; labelling never narrows ahead of the data.

### 9.3 Honest confidence in the UI

```
┌─ Predicted Organoid Efficacy (Liver, T0) ────────────────────┐
│  Predicted IC50:    1.4 µM (median)                          │
│  95% CI:            0.4 – 4.8 µM                             │
│  Fold-error vs wet: not yet measured — calibration cohort    │
│                     pending (≥30 compound-pairs required)    │
│  Applicability:     in domain (score 0.84)                   │
│  Method:            cell-type aggregation + DILIrank         │
│  ⚠ T0 in-silico surrogate — predicted, not measured.         │
│    Wet anchoring (T2/T3) required for IND-supporting claims. │
└──────────────────────────────────────────────────────────────┘
```

Every field is real and traceable. Fold-error number is measured (or honestly
absent), not invented.

---

## 10. Build order

### 10.1 Stage 1 — Surface what already exists (~3–5 days) ✅ STAGE 1 SHIPPED
- `lib/tissueSelectivity.ts` — 54-row matrix from L1 IC50 + L2 PBPK Cu + GTEx v8.
- `lib/transporterFlags.ts` — 9 channels, QSAR rule-based on L1 ADMET.
- `lib/cascadeFlagState.ts` — discriminated union, exhaustive-switch enforcement.
- `lib/gtexClient.ts` — GTEx Portal v2 client with UBERON ↔ PBPK-compartment map.
- L3 Run button enabled. Cascade flag 1 firing with `prediction_only` state.

### 10.2 Stage 2 — DILI prediction (~5–7 days)
- Train `dili-ml` on DILIrank + LTKB.
- `lib/hepatotoxPredictor.ts` wired.
- QMRF + V&V40 + fold-error report shipped.

### 10.3 Stage 3 — Cell-type aggregation (~7–10 days)
- `lib/cellTypeAggregator.ts` against CELLxGENE Census (bulk-download path for v1).
- Curate organoid composition table (separate parallel track, ~3–5 days).
- Initial calibration cohort assembled (HCMI + literature).

### 10.4 Stage 4 — Patient-line projection (oncology) (~5–7 days)
- `lib/patientLineProjection.ts` against HCMI + DepMap PRISM.

### 10.5 Stage 5 — DILI biomarker proxy + permeability surfacing (~3 days)
### 10.6 Stage 6 — Cascade integration tests + L3 → L4 envelope (~2–3 days)

### 10.7 Stage 7 — T1 retrieval (~2 weeks, parallel) — v1.1 expanded scope
- Tanimoto thresholds: ≥0.85 high-confidence, 0.7–0.85 informational, <0.5 no-match.
- Distinct typed errors: `NoAnalogsFound` / `ServiceUnreachable` / `RegistrationRequired`.
- ToxRefDB registration flow + schema-shift handling.
- Pattern: mirror existing ChEMBL similar-targets v2 retrieval path.

### 10.8 Stage 8 — T2 / T3 hooks (later)
- CRO request workflow (Charles River, Eurofins, Inotiv, WuXi AppTec, Pharmaron).
- Vendor adapter abstraction (Emulate / CN Bio / Mimetas / TissUse / InSphero).

### 10.9 Total estimate — v1.1 honest re-estimate
**Stages 1–6: 6–9 weeks single-dev, 4–6 weeks parallelised across two. Plan 8
weeks** with calibration-cohort assembly as a separate parallel track. Stages 7–8
are improvements that land later without changing what users see today.

---

## 11. What stays as honest stub

Same discipline as L2 GPU-only stages — where the surrogate cannot reach a
defensible answer, the output is honestly absent.

### 11.1 Genuine wet-only territory
- Real-time perfusion kinetics in coupled multi-organ chips → T3 routing.
- Patient-derived non-cancer organoid efficacy → T3 with HUB sublicense.
- Specific adaptive immune responses → CRO immune-organoid panels.
- GLP-grade hepatotox / cardiotox claims for IND submission → T2 (CRO under GLP)
  or T3 (vendor with qualified protocol). Cascade flag 4 enforces this.

### 11.2 What the user sees in stub-honest cases
Same pattern as L2 GPU-only cards. Clear card with readout name, "Out of scope
for in-silico surrogate" / "Wet anchoring required" message, routing button. No
number, no fake CI, no progress bar that does nothing.

---

## 12. Migration plan
Same as v1.0 §12. v1.1 supersedes v1.0; the v1.0 .docx remains in
`attached_assets/` for the record.

---

## 13. Risks (unchanged from v1.0)
13.1 Honest fold-error bands are wide. 13.2 DILI dataset is small (~700
compounds). 13.3 Cell-type composition tables are approximate. 13.4 Patient-line
projection is oncology-skewed. 13.5 The "good enough" trap (mitigated by Amber
Curator). 13.6 Continuous calibration drift (handled by Performance & Lineage
Swarm).

---

## Appendix A — One-page summary

- **Direction:** L3 in-silico-surrogate-first; vendors / CROs opt-in.
- **Tiers:** T0 default · T1 public-data retrieval · T2 CRO wet panel · T3 vendor adapter.
- **What T0 predicts:** tissue-selectivity matrix · cell-type efficacy · organoid
  efficacy · DILI severity + mechanism · patient-line variance (oncology) ·
  permeability + Kp,uu · transporter flags.
- **What T0 does not predict:** multi-organ coupling kinetics, patient-derived
  non-cancer organoid efficacy, adaptive immune responses, GLP-grade tox claims.
- **Build size:** ~6 lib modules + 3 ML services + 2 external ingests
  (CELLxGENE Census bulk + GTEx REST). **8 weeks honest plan.**
- **Honest confidence:** every T0 output carries computation method + training
  cohort hash + applicability domain + measured fold-error band (or honest absence).
  UI badge "T0 in-silico surrogate · predicted, not measured."
- **Cascade gating:** flag 4 requires QMRF + V&V40 + fold-error report. Amber
  Curator at L4 refuses to sign clinical handoffs whose load-bearing claims rest
  only on T0 — **compile-time guaranteed via discriminated `CascadeFlagState`**.
- **Honesty rule:** we do not produce a number we cannot defend. Where the
  surrogate cannot reach a defensible answer, the output is honestly absent.

---

## Appendix B — Build order quick reference

| Stage | Build | Effort | Result |
|---|---|---|---|
| 1 ✅ | tissueSelectivity + transporterFlags + cascadeFlagState + gtexClient | 3–5 d | L3 Run enabled; tissue + transporter cards live |
| 2 | dili-ml + hepatotoxPredictor | 5–7 d | Hepatotox card with calibrated confidence |
| 3 | cellTypeAggregator (Drug2cell pip + bulk Tabula Sapiens) | 7–10 d | Organoid efficacy cards |
| 4 | patientLineProjection (HCMI + DepMap) | 5–7 d | Oncology patient-line variance |
| 5 | DILI biomarker proxy + permeability/Kp,uu surfacing | 3 d | Final card set |
| 6 | Cascade integration tests + L3→L4 envelope per-readout tier | 2–3 d | End-to-end pipeline verified |
| 7 | T1 public-data retrieval (parallel) | 2 weeks | Public-data analog cards |
| 8 | T2 / T3 procurement + vendor adapter hooks | later | Wet anchoring as routed action |
