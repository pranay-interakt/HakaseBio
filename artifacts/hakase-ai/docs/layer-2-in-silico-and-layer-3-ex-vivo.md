# L2 In-Silico & L3 Ex-Vivo — Current State Reference

> **Scope of this doc.** Snapshot of what is **actually wired** in the free / CPU-only build of HakaseAI as of the May 2026 restructure, plus AI models used, honest gaps, and pending work. The L2 In-Silico and L3 Ex-Vivo scaffolds documented here are the two **sub-tracks** of the new **L2 Confirmation** wrapper. GPU-only stages (currently Stage 5 Free-Energy / FEP) are called out separately and **deferred to Premium** — they are not enabled in the free tier.
>
> **Source files:**
> - `artifacts/hakase-ai/src/components/Layer2InSilicoScaffold.tsx`
> - `artifacts/hakase-ai/src/components/Layer3ExVivoScaffold.tsx`
> - `artifacts/hakase-ai/src/lib/l2Pipeline.ts`, `lib/l2DoseProjection.ts`, `lib/pbpk.ts`
> - `artifacts/hakase-ai/src/lib/tissueSelectivity.ts`, `lib/transporterFlags.ts`, `lib/gtexClient.ts`, `lib/cascadeFlagState.ts`
> - `artifacts/ai-service/main.py` + `models/*.py`
>
> **Project-wide policy (do not violate when extending):** No fabricated data. No silent fallbacks. No synthetic numbers when a real source is unavailable — return HTTP 503 with the missing-secret/missing-data hint instead. **Never modify** `artifacts/hakase-ai/src/pages/HAIOps.tsx` or `artifacts/hakase-ai/src/lib/safetyFlags.ts`.

---

## 1. L2 In-Silico Sub-Track

### 1.1 Purpose
Computational triage between L1 In-Vitro and the L3 Ex-Vivo / L3 Animal Cohort wet steps. Takes the L1 handoff (SMILES, UniProt, ADMET signals, binding profile) and produces a dose projection + therapeutic-index verdict, plus an L2 → downstream JSON handoff.

### 1.2 Stage matrix (10 stages, 0–9)

| # | Stage | Wired? | Compute | Notes |
|---|---|---|---|---|
| **S0** | Ingest L1 (timestamps + field-availability check) | ✅ wired | CPU (browser) | Pure orchestration. |
| **S1** | RDKit descriptors + Lipinski / Veber + protein druggability | ✅ wired | CPU (browser RDKit + AI service) | Druggability via `ai-service POST /predict/protein-ml` (ESM2 embedding → RF classifier). |
| **S2** | **Docking (AutoDock Vina 1.2.7)** | ✅ wired · **opt-in** | CPU (server-side subprocess) | OpenBabel 3.1.1 prepares ligand+receptor PDBQT; RDKit embeds + UFF-minimizes ligand. Async job + status polling. PDB receptor auto-resolved from L1 UniProt and **explicitly quality-ranked** (X-ray > cryo-EM > NMR; lower resolution wins; bonus for non-blocklisted co-crystal ligand) across the top-5 candidates. Box auto-picked from a co-crystallized HETATM (with blocklist for waters / ions / buffers / cryoprotectants / modified residues); blind-dock fallback is explicit and warning-flagged. Vina score exposed as a **heuristic pKd-equivalent** (`pKd ≈ −score / 1.364`) for orthogonal cross-check vs Stage 3 binding-ml only — clearly labelled as NOT an experimental Kd. New `physical` quality tier added at 0.85 (between experimental 1.0 and ml 0.7). 30–90 s wall time per ligand → opt-in card so Run-Full-Pipeline skips it. |
| **S3** | ML affinity + ADMET cross-check | ✅ wired | CPU (AI service, sklearn / Chemprop) | `POST /predict/binding-ml` (DeepDTA-GBM) + `POST /predict/admet-ml` (Chemprop). Computes `|pKi_L1 − pKd_ML|` log-disagreement and an agreement class: `strong / moderate / disagreement`. |
| **S4** | Selectivity (L1 panel) + cardiotox cross-check | ✅ wired | CPU (AI service) | `POST /predict/cardiotox` (Morgan-FP RF). L1-vs-ML consensus class with `Conflict` surfaced explicitly. |
| **S5** | **Free-energy refinement (FEP / TIES-MD)** | 🟡 wired but **GPU-only · DEFERRED to Premium** | **GPU (RunPod Serverless A100, ~24 GPU-h, ≈ $40–$50 per ligand pair)** | OpenMM + OpenFF Sage + TIES-MD on a RunPod Serverless GPU endpoint. Backend at `artifacts/ai-service/models/fep_runpod.py` (RunPod dispatch + 30 s polling, 36 h hard cap, in-memory job store, single-worker `ThreadPoolExecutor` to prevent concurrent $50 dispatches). Endpoints: `POST /predict/fep`, `GET /predict/fep/status/{job_id}`, `GET /predict/fep/config`. Reads `RUNPOD_API_KEY` and `RUNPOD_FEP_ENDPOINT_ID`. **Per project policy, when these secrets are unset the backend returns HTTP 503 with the exact missing-secret name verbatim — NO fabricated ΔΔG anywhere, no silent fallback.** **Excluded from the free tier.** |
| **S6** | PBPK 2-compartment RK4 ODE | ✅ wired | CPU (browser) | `lib/pbpk.ts`, Davies & Morris physiology. |
| **S7** | QSP / PD Hill-equation receptor occupancy on the PBPK unbound-concentration curve | ✅ wired | CPU (browser) | Peak occupancy %, time>50 %, AUC of effect. |
| **S8** | Therapeutic-index ranking | ✅ wired | CPU (browser) | `lib/l2DoseProjection.ts` — required Cmax,unbound from configurable target occupancy; margins for hERG / CYP3A4 / CC50 / worst off-target with `SAFE ≥30× / CAUTION 10–30× / RISK <10×`; first-pass dose using logP-binned Vd proxy [Obach 2008]; Caco-2 → F bins [Yee 1997]; well-stirred liver model [MPPGL = 45, liver = 25.7 g/kg, Q_h = 20]. |
| **S9** | L2-handoff-v1 JSON | ✅ wired | CPU (browser) | Predicted dose mg/kg + mg/day, predicted unbound + total Cmax, liability flags, `free_energy_estimate` explicitly `null` when S5 is OOS, copyable to clipboard. |

### 1.3 Pipeline orchestration
`artifacts/hakase-ai/src/lib/l2Pipeline.ts → runFullPipeline` runs in dependency order:

```
S8 (fix dose) → S6 (PK with that per-administration dose) → S7 (PD with PK + fu)
```

Each stage returns `StageResult<T>` with `status: wired | out-of-scope | error | skipped` — **no silent fallbacks anywhere**.

### 1.4 L2 Input Parameters card
User-tunable controls feeding `params.l2` into the orchestrator:

- `targetOccupancy` (50–95 % slider, recomputes Ki multiplier)
- `bodyWeightKg`
- `route` (oral / IV — IV forces F = 1.0)
- `dosesPerDay` (QD / BID / TID / QID — multiplies daily dose)
- Four advanced overrides: `fuOverride`, `VdOverride`, `FOverride`, `CLOverride` (each annotated in the assumptions block citing the model it supersedes)

Plasma `fu` validation is explicit: if neither L1 nor override yield a valid fu, dose projection is **withheld** and surfaced as a warning.

### 1.5 UI summary (`Layer2InSilicoScaffold.tsx`)
- Live L1 inputs card
- Input-parameters card
- 10-stage pipeline grid with per-stage **Run** buttons that respect dependencies (S6 disabled until S8 produces a dose; S7 until S6 + S8 are present)
- "Run Full L2 Pipeline" button (skips opt-in S2 docking and GPU S5)
- Per-stage result cards: RDKit table + druggability gauge, ML cross-check tables, PK curve mini-chart, PD occupancy mini-chart, TI margins + verdict, copyable handoff JSON
- L1 → L2 and L2 → L3 contracts surfaced in the UI
- Stage 2 docking card: live RunPod-style status banner, top-N pose card, Vina score → heuristic pKd
- Stage 5 FEP card (GPU): live RunPod-config banner (probed once on mount via `getFepConfig`); input form for Ligand B SMILES + PDB ID (auto-prefilled from S2 result when available; Ligand A locked to L1 SMILES); explicit GPU-cost confirmation checkbox; Run button gated by `!fepConfig.configured || !fepLigandB || !fepPdbId || !fepCostOk` with an exact disabled-reason ("RunPod not configured" / "needs Ligand B SMILES" / "needs 4-letter PDB ID" / "confirm ~$50 GPU cost"); result card shows ΔΔG ± uncertainty (color-coded green / amber / red at ±1.5 kcal/mol thresholds), ΔΔG/k_B T, GPU-hours, perturbation summary (A/B SMILES + PDB + engine + FF + RunPod job_id), expandable per-λ-window table, worker warnings, and a Reset button to run another perturbation. **Free tier: this card is hidden / disabled.**

### 1.6 AI / ML models used in L2

| Model / endpoint | Layer/stage | Implementation | Compute |
|---|---|---|---|
| RDKit descriptors (Lipinski / Veber / TPSA / chi / kappa / Phi) | S1 | Browser RDKit (`@rdkit/rdkit`) | CPU |
| Protein druggability (ESM2 embedding → RandomForest classifier) | S1 | `ai-service POST /predict/protein-ml` | CPU |
| AutoDock Vina 1.2.7 docking | S2 | `ai-service` subprocess + OpenBabel 3.1.1 + RDKit 2026.3.1 | CPU |
| DeepDTA-GBM binding affinity (pKd) | S3 | `ai-service POST /predict/binding-ml` | CPU |
| Chemprop ADMET ML | S3 | `ai-service POST /predict/admet-ml` | CPU |
| Cardiotoxicity classifier (Morgan-FP RandomForest) | S4 | `ai-service POST /predict/cardiotox` | CPU |
| OpenMM + OpenFF Sage + TIES-MD (free-energy / FEP) | S5 | RunPod Serverless A100 worker | **GPU · Premium-only** |
| 2-compartment PBPK RK4 ODE | S6 | `lib/pbpk.ts` (browser) | CPU |
| QSP / PD Hill-equation receptor occupancy | S7 | Browser TS | CPU |
| Therapeutic-index ranker (`l2DoseProjection.ts`) | S8 | Browser TS | CPU |

### 1.7 Pending work for L2

- **Free-tier Stage 5 alternative** — when a CPU-only free-tier path is desired, S5 stays `out-of-scope` and the handoff JSON keeps `free_energy_estimate: null`. There is **no plan to fabricate a free-tier ΔΔG**.
- **Calibration cohort for cross-check disagreements** — S3 / S4 disagreement classes are computed but not yet calibrated against a cohort of measured pKi / cardiotox values.
- **L2 → L3 contract finalization** — the contract block is rendered in the UI but is not yet versioned in `lib/preclinical-handoff/` for L2 the same way `v2.0.0` versions L3.

---

## 2. L3 Ex-Vivo Sub-Track

### 2.1 Purpose
Real tissue without a live animal — **in-silico surrogate-first**. Per `attached_assets/HakaseBio_Layer3_InSilico_Surrogate_Spec_v1.1.md` (v1.1 markdown supersedes v1.0 .docx, which is preserved verbatim for the record), L3 is built T0-default (always runnable, no vendor) with T1 / T2 / T3 as opt-in upgrades:

| Tier | Source | In free tier? |
|---|---|---|
| **T0** | In-house in-silico surrogate (default — always runnable) | ✅ |
| **T1** | Public-data retrieval (GTEx, DepMap, HCMI, Cellosaurus) | ✅ where APIs are public |
| **T2** | CRO wet panel (organoid IC50, scRNA panel) | ❌ Manual Entry only in free tier; CRO ordering is Premium |
| **T3** | Chip vendor adapter (Emulate, CN Bio, Mimetas, TissUse, InSphero) | ❌ Premium-only |

The most expensive and most predictive pre-clinical step ($15k–$250k / cmpd in the wet world).

### 2.2 Stage matrix (6 stages)

| # | Stage | Wired? | Compute | Source files / notes |
|---|---|---|---|---|
| **S1** | Tissue-selectivity matrix + transporter flags | ✅ wired (T0 in-silico surrogate + T1 GTEx) | CPU (browser + GTEx REST) | `lib/tissueSelectivity.ts` orchestrates a 54-row matrix: self-computes the L2 chain via `computeL2DoseProjection` + `runPBPK` from L1 outputs (so L3 is **not blocked** on L2 having been clicked); fetches GTEx median TPM per gene; computes `marginRatio = IC50 / Cu` and `onTargetScore = engagement × (1 − exp(−TPM/10))` with explicit Rowland-Tözer `Cu_tissue ≈ Cu_plasma` assumption surfaced on every row. `lib/gtexClient.ts` uses `gtex_v8` honestly because v10 is not yet exposed at the `medianGeneExpression` endpoint (returns `null` for tissues without a PBPK compartment via `tissueToPbpkCompartment` UBERON ↔ 2-compartment-PBPK mapping). `lib/transporterFlags.ts` is a 9-channel QSAR (BSEP, OAT1/3, OCT2, OATP1B1/3, P-gp, BCRP, MRP2) — rule-based on L1 ADMET descriptors with cited thresholds [Polli 2001 / Morgan 2013 / Karlgren 2012 / Truong 2008 / Wittwer 2013 / Matsson 2009 / El-Sheikh 2008]. |
| **S2** | DILI severity + mechanism flags | 🟡 stub + Manual Entry | CPU (form) | Manual Entry: 5-class DILIrank severity dropdown + 4 mechanism flags (mitochondrial / BSEP / ROS / immune) + citation. ML model **pending** (DrugBank-served structured ADRs is Premium). |
| **S3** | Cell-type aggregation (Drug2cell-pattern) | ✅ wired (ML, **data-gated**) | CPU (AI service, NumPy / pyarrow) | `POST /api/ai/celltype-aggregation` (api-server proxy → ai-service `/predict/celltype-aggregation`) which scores each (cell_type, tissue) row in Tabula Sapiens v2 (~480 cell types × 28 organs) by `Σᵢ wᵢ · mean_log1p_expression(geneᵢ, cell_type, tissue)` where `wᵢ` is the min-max normalized pKi of `target_i` (uniform 1.0 when pKi absent). The **expression atlas is preprocessed off-platform** in `colab_notebooks/prepare_tabula_sapiens.ipynb` (Colab high-RAM runtime: pulls Tabula Sapiens via `cellxgene_census`, normalizes + log1p, aggregates per (cell_type, tissue, gene) with a tissue→organ rollup, attaches atlas SHA + cell/gene/organ counts as pyarrow file metadata) then uploaded to `artifacts/ai-service/cache/tabula_sapiens_aggregated.parquet`. **Until that artifact ships the endpoint returns HTTP 503 + `source: "data-not-provisioned"` with a remediation hint** — there is NO synthetic fallback. Frontend (`Layer3ExVivoScaffold.tsx`): `Stage3Result` is a discriminated union `{kind:"ml"|"manual"}`; `runStage3Ml` first calls `predictProtein(uniprotId)` to resolve the HUGO gene symbol from L1 UniProt (refuses to substitute the accession), then calls `predictCellTypeAggregation`, narrows on `source` (data-not-provisioned / out-of-domain / input-error / ml), and renders top-5 cell types + top-5 organs in a violet ML card. Manual Entry path also available: Cellosaurus CVCL accession + measured organoid IC50 + assay format + citation (T2 wet-data path). |
| **S4** | Patient-line projection (HCMI / DepMap, oncology-only) | 🟡 stub + Manual Entry | CPU (form) | Manual Entry: DepMap-format `ACH-NNNNNN` rows with measured IC50s, **or** an explicit "non-oncology — `not_applicable`" toggle. ML model **pending** (ETA 5–7 d per Spec v1.1 Appendix B). |
| **S5** | Biomarker proxy + permeability (brain Kp,uu) | ✅ wired (in-house, deterministic) | CPU (browser) | `lib/biomarkerProxy.ts` exports `deriveBiomarkers(mech)` — rule table per Spec v1.1 §3.6: mito → GLDH; cholestatic → ALP / bilirubin; hepatocellular → ALT / miR-122; immune → eosinophilia (citing Antoine 2013 / DILIN / Wang 2009 / Starkey Lewis 2011 / Andrade 2019). `lib/permeabilityProjection.ts` exports `projectPermeability(l1, brainKpUu_override)` — surfaces L1 Caco-2 Papp and accepts an opt-in measured brain Kp,uu (MDR1-MDCK ER or PET) — **never imputes a CNS value**. Auto-runs in `runFull` once S2 Manual Entry is filled. |
| **S6** | Cascade integration tests + L3 → L4 envelope | 🟡 orchestration-only | CPU (browser) | Pure orchestration that builds a per-readout tier envelope (`t0` in-house ML / `t-user` manual / `n/a` not_applicable / `pending`) from whatever S1–S5 contain. `buildStage6Envelope`: S3 ML → `t0`; S3 Manual → `t-user` (manual wins when both saved). Integration tests **pending** per spec. |

### 2.3 Manual Entry mode (May 2026) — discipline

Mirrors the L1 Target Protein "From Layer 1 / Manual Entry" toggle pattern across all five stub stages. Every user-entered value is tagged `source: "user-provided"` and the cascade flag state maps to the existing `prediction_only` variant (no new union variant). **`canSignLoadBearing` at L4 still refuses to sign load-bearing claims based on user-entered data.** The handoff JSON includes a `provenance` map per stage. The free tier ships with Manual Entry; the future Premium tier will replace Manual Entry on Stages 2 / 4 / 5 with DrugBank-served structured pharmacology / ADRs / DDIs (commercial license required, planned).

### 2.4 L3 Input Parameters card
- `targetOccupancy` slider (50–95 %)
- `bodyWeightKg`
- `route` (oral / IV)
- `dosingFreq` (QD / BID / TID / QID)
- `transporterConfidenceFloor` (0–0.9)
- `gtexDataset` display-only `gtex_v8`
- Advanced overrides: `IC50_nM` bypass, plus L2 `fu / Vd / F / CL`

These feed `params.l2` into `computeTissueSelectivityMatrix` so L3 is never blocked on L2 having been clicked.

### 2.5 UI summary (`Layer3ExVivoScaffold.tsx`)
- 6-stage pipeline grid
- Per-stage **Run stage** buttons (disabled with "Stub · honest absence" pill on stubs)
- **Run Full L3 Pipeline** button (S1 computes; S2–S6 surface their `out-of-scope-yet` ResultShell cards with explicit "intentionally absent rather than fabricated" copy — no synthetic data)
- Copyable L3-T0 handoff JSON (schema_version `L3-T0-stage1-v1`, includes `stages_pending` array)
- `prediction_only` cascade banner
- Top-on-target / tightest-margin summary cards
- Full sortable per-tissue table with PBPK-compartment badges and high / medium / low confidence pills
- 9-channel transporter card
- Saved-summary chip and `copyHandoff provenance.s3` (`"ml-celltype-aggregation"` / `"user-provided"`) narrowing on the discriminated union

Errors surface explicitly (no silent fallback). Honesty discipline: fold-error band carries `cohortN: 0` until a calibration cohort is assembled (≥30 compound-tissue wet pairs per spec §7.3).

### 2.6 AI / ML models / data sources used in L3

| Model / endpoint / dataset | Stage | Implementation | Compute |
|---|---|---|---|
| GTEx Portal v2 REST (`gtex_v8`) — median tissue gene expression | S1 | `lib/gtexClient.ts` | CPU (network) |
| 9-channel transporter QSAR (BSEP, OAT1/3, OCT2, OATP1B1/3, P-gp, BCRP, MRP2) | S1 | `lib/transporterFlags.ts` (rule-based on L1 ADMET) | CPU |
| Tissue-selectivity matrix orchestrator | S1 | `lib/tissueSelectivity.ts` | CPU |
| `predict/protein-ml` (ESM2 → RF) for UniProt → HUGO gene symbol | S3 | `ai-service` | CPU |
| Drug2cell-pattern cell-type aggregation over Tabula Sapiens v2 (~480 cell types × 28 organs) | S3 | `ai-service POST /predict/celltype-aggregation` + preprocessed parquet | CPU (data-gated) |
| Auto-derived biomarker rule table (Antoine 2013 / Wang 2009 / Andrade 2019) | S5 | Browser TS | CPU |
| **Stage 6 cascade integration tests** | S6 | Pending | — |

### 2.7 Pending work for L3

Per Spec v1.1 Appendix B:

- **S2 ML** — DILI severity classifier (Premium: DrugBank-served structured pharmacology / ADRs / DDIs requires commercial license)
- **S3 data provisioning** — Tabula Sapiens v2 aggregated parquet must be produced by the Colab notebook and uploaded to `artifacts/ai-service/cache/tabula_sapiens_aggregated.parquet`. Until then S3 ML returns `503 data-not-provisioned`.
- **S4 ML** — `patientLineProjection` (HCMI + DepMap oncology-only), ETA 5–7 d
- ~~**S5 ML**~~ — superseded: the deterministic rule table IS the in-house wiring; no ML model required for the free tier. Premium DrugBank integration will replace Manual Entry on the upstream S2 mechanism flags, which Stage 5 then consumes unchanged.
- **S6** — cascade integration tests + L3 → L4 envelope, ETA 2–3 d after S5
- **Calibration cohort** — fold-error band carries `cohortN: 0` until ≥30 compound-tissue wet pairs are assembled per spec §7.3

---

## 3. CPU vs GPU summary (free-tier scope)

| Layer / stage | CPU | GPU | Notes |
|---|---|---|---|
| L1 In Vitro (entire layer) | ✅ | — | Browser RDKit + AI service (CPU) |
| L2 S0–S4, S6–S9 | ✅ | — | All wired in free tier |
| **L2 S5 (Free-Energy / FEP)** | — | 🟡 GPU only | **Excluded from free tier · Premium expansion** |
| L3 S1 (tissue selectivity + transporters) | ✅ | — | Wired |
| L3 S3 (cell-type aggregation) | ✅ | — | Wired but **data-gated** on Tabula Sapiens v2 parquet |
| L3 S5 (biomarker proxy + permeability) | ✅ in-house (deterministic) | — | `lib/biomarkerProxy.ts` + `lib/permeabilityProjection.ts` |
| L3 S2 / S4 / S6 stubs | ✅ (Manual Entry / orchestration) | — | ML wiring pending for S2 + S4 |

**Free-tier promise:** every user-visible "Run" button either produces a real result on CPU or returns an honest `out-of-scope-yet` / `data-not-provisioned` / `503` card. Nothing fabricates a number.

---

## 4. Shared handoff envelope (context for the Confirmation wrapper)

The `lib/preclinical-handoff/src/v2.ts` package (exported alongside v1) defines the **architecture-refactor** shape for the new L2 Confirmation wrapper:

```ts
{
  compound,
  sourceRequest,
  l1InVitro,
  l2Confirmation: {
    inSilico,            // L2 In-Silico sub-track evidence
    exVivo,              // L3 Ex-Vivo sub-track evidence
    cypTransporterPanel, // joint
    clearanceFractions,  // joint
  },
  l4AnimalCohort,        // (now slot 3 in the May 2026 stepper)
  provenance,
}
```

Each layer block is `{evidence, overrides: UserOverride[], confidence: {level, basis}, provenance: LayerProvenance}` and may itself be `null` when the layer has not been run. The §6.1 joint panels gain `derivedFrom: ("in-silico"|"ex-vivo")[]` so consumers can distinguish **screening-grade** (ML / in-silico only) from **confirmation-grade** (ex-vivo present). The in-silico sub-track emits a typed `PreConfirmationHandoff` (prioritized assays + predicted ranges + falsification criteria) which the ex-vivo sub-track records observed deltas against (`HandoffDelta[]`) — **this is the explicit contract preventing the two sub-tracks from drifting**. v1 remains the active contract consumed by `Phase1Planner`; `migrateV1ToV2(pkg, opts)` lifts a v1 package losslessly where possible and surfaces every gap (no L1 ML-priors block, no ex-vivo, no per-layer confidence) as `null` blocks plus aggregate warnings — never fabricates evidence. Verified: all 3 starter fixtures (Ibuprofen-full, Imatinib-partial, mAb-MABEL) pass `isPreClinicalPackageV2` after migration with correct `derivedFrom` attribution and complete warning carry-forward; negative tests confirm rejection of missing layer keys and invalid confidence levels.

This is the contract the **L2 Confirmation wrapper** is being built against — both sub-tracks already emit into it; the wrapper's job is to surface the joint reconciliation (in-silico predictions vs ex-vivo observed deltas) before handoff to the L3 Animal Cohort layer.

---

*Last updated: May 2026 restructure. When extending: keep the no-fake-data discipline, never modify `HAIOps.tsx` / `safetyFlags.ts`, and add new wired stages by introducing a real model + endpoint, not a placeholder.*
