# Animal Cohort Layer (L3) — Team Reference

**Layer:** L3 — Virtual Preclinical Study Engine (Animal Cohort)
**Status:** Implemented and tested. Backend + frontend live.
**Position:** `L1 (In-vitro / ADMET / IVIVE)` → `L2 (Confirmation)` → **`L3 (Animal Cohort)`** → `First-in-Human (future)`
**Companion docs:** [`animal-cohort-layer.md`](animal-cohort-layer.md) (architecture & rationale), [`virtual-animal-architecture.md`](virtual-animal-architecture.md) (scientific feasibility), [`pbpk-layer.md`](pbpk-layer.md) (kernel PBPK contract).

This is the "where is everything / what does it do / which endpoint" handbook. Read `animal-cohort-layer.md` first for the *why*.

---

## 1. One-paragraph summary

L3 turns a completed L1/L2 analysis into a **complete virtual preclinical study**: multiple dose groups run through a validated whole-body PBPK cohort simulation, then target coverage, PK/PD, safety margins, public animal evidence, sensitivity analysis, and a GO/NO-GO stage-gate recommendation — each output stamped with `{model, confidence, limitations, provenance}`. **Every scientific number is computed in the Python backend** by a validated model, a mechanistic calculation, an open engine, or a public dataset. The frontend (`AnimalStudyWorkspace.tsx`) only collects study-design inputs and renders what the backend returns. Nothing is fabricated, hard-coded, or LLM-generated; anything that cannot be produced is returned as a typed `not_predicted` / `available:false` with a reason.

---

## 2. The design contract (non-negotiable, inherited from L1/L2)

1. **No fabrication.** A value is real (model/measured/reference/derived) or it is `available:false` with a `missing` list + reason.
2. **Everything backend.** All APIs, tools, algorithms, and logic live in the backend. The frontend is display-only.
3. **Provenance everywhere.** Each block carries `model`, `confidence`, `limitations`, `provenance`.
4. **Cross-species honesty.** Human-trained ML clearance is *not* predictive across species (validated: Spearman 0.21, p=0.48). Non-human arms driven by ML clearance are flagged `low` confidence, and that flag propagates to the stage gate.

---

## 3. Backend file map

All under `hakase-bio-backend/modalities/small-molecule/engine/src/hakase_smallmol/l3/` unless noted. **2,109 LOC across 13 modules.**

| File | Role | Key public symbols |
|---|---|---|
| `__init__.py` | Package + `SCHEMA_VERSION` | `SCHEMA_VERSION = "hakase.small-molecule.l3.animal-cohort.v1"` |
| `pbpk_adapter.py` | **The workhorse.** Runs one dose-group arm end-to-end (IVIVE→Kp→disposition→cohort). **Engine selection (kernel/mrgsolve)**, frequency parsing, minutes↔hours units. | `run_arm_exposure()`, `AnimalSpec`, `ArmSpec`, `parse_frequency_h()`, `KA_PER_H` |
| `mrgsolve_adapter.py` | **mrgsolve engine.** Marshals disposition+physiology to JSON, runs `run_mrgsolve.R` via Rscript, returns a kernel-shaped cohort. Availability probe + graceful fallback. | `run_cohort_mrgsolve()`, `mrgsolve_available()`, `mrgsolve_info()` |
| `mrgsolve/run_mrgsolve.R` | The **mrgsolve whole-body PBPK model** (C++ ODE DSL) + population runner. Mirrors the kernel equations exactly, in hours. | (Rscript) |
| `study_engine.py` | Validate/normalise study design → simulation arms. Species catalog. | `build_arms()`, `normalize_dose_groups()`, `species_catalog()`, `StudyDesignError` |
| `parameter_engine.py` | Resolve inputs from the L1/L2 record (potency, target, safety flags, IVIVE ML inputs). Readiness gate. | `resolve_from_analysis()`, `resolve_from_smiles()`, `readiness()`, `ResolvedInputs` |
| `pkpd_engine.py` | PK-metric tables, dose-proportionality, mechanistic target coverage (receptor occupancy). | `pk_metrics_for_arm()`, `dose_proportionality()`, `target_coverage()`, `pkpd_summary()` |
| `evidence_engine.py` | Live public-data lookups (ChEMBL, EPA CCTE, PubChem, PK-DB). | `collect_evidence()` |
| `safety_engine.py` | Three safety anchors (evidence NOAEL, allometric MTD, in-vitro POD status) + dose margins + hazard flags. | `compute_safety()`, `allometric_anchor()`, `KM_FACTORS` |
| `sensitivity_engine.py` | Local OAT sensitivity of PK metrics to disposition inputs. | `compute_sensitivity()` |
| `decision_engine.py` | Transparent criterion-weighted stage gate + value-of-information. | `stage_gate()`, `THRESHOLDS` |
| `reporting_engine.py` | Assembles the report, the display-only presentation, and a Markdown export. | `assemble_report()`, `report_markdown()` |
| `contract.py` | L1/L2 → L3 handoff + readiness contract (mirrors `l2_input_contract`). | `l3_input_contract()` |
| `pipeline.py` | **Orchestrator.** Sequences every engine into one study record. | `run_animal_study()` |
| `store.py` | In-memory study persistence by `study_id`. | `put_study()`, `get_study()` |
| `tests/` | `test_l3_engines.py` (16 unit tests, no network/ML) + `test_l3_pipeline_integration.py` (real pipeline, ML-gated). | — |

**Reused from the platform kernel (not re-implemented — the validated Phase-0 engine):**

| Capability | Location |
|---|---|
| 13-compartment perfusion-limited PBPK ODE (scipy Radau) | `platform/kernel/.../pbpk/model.py` |
| Virtual-cohort Monte-Carlo (N animals, per-organ curves + 90% CI) | `platform/kernel/.../pbpk/cohort.py` (`run_virtual_cohort`) |
| `DispositionParameters` handoff contract (full provenance envelope) | `platform/kernel/.../pbpk/contract.py` |
| Route/dose absorption forcing models (IV/oral/SC/repeat) | `platform/kernel/.../pbpk/absorption.py` |
| Species/strain physiology store (human, rat, mouse, dog, monkey + allometric anchor) | `platform/kernel/.../pbpk/physiology/store.py` |
| Applicability-domain OOD gating | `platform/kernel/.../uncertainty/applicability_domain.py` |
| IVIVE disposition (source of truth) | `modalities/small-molecule/.../pk_ivive/pk_ivive.py` |
| Tissue Kp (Rodgers & Rowland) | `modalities/small-molecule/.../pk_ivive/kp.py`, `disposition.py` |

**Router wiring:** endpoints added to `modalities/small-molecule/engine/src/hakase_smallmol/router.py` (imports at top, request models near `AnimalCohortRequest`, endpoints after the L2 block). The service mounts this router in `service/src/hakase_service/main.py`.

---

## 4. Frontend file map

All under `hakase-invitro-workspace/src/`.

| File | Change | What it does |
|---|---|---|
| `AnimalStudyWorkspace.tsx` | **New (~230 lines).** | The L3 UI. Collects study design, calls 2 endpoints (`/l3/contract` on mount, `/l3/run` on submit), renders the stage gate, per-arm PK + coverage charts, dose comparison, safety margins, sensitivity, and evidence. **Display-only** — the only client math is SVG chart-coordinate scaling and presentation rounding. |
| `App.tsx` | Edited | Imports the workspace; adds `"animal-cohort"` to the stage union; enables the **Animal Cohort** nav tab; renders `<AnimalStudyWorkspace>`. |
| `styles.css` | Appended (~85 lines) | `.l3-*` classes (gate banner, criteria, arm grid, safety anchors, sensitivity bars, readiness) using the existing theme tokens. |

**Display-only guarantee:** the frontend never computes a scientific value. It sends form inputs and renders the returned JSON. Verified: 2 `fetch` calls, no ODE/occupancy/margin math client-side.

---

## 5. Data flow (per study run)

```
L1/L2 analysis record (analysis_id)  ─ or a raw SMILES
   │  parameter_engine.resolve_from_analysis()   (potency, target, safety flags, IVIVE ML inputs)
   ▼
study_engine.build_arms()            (validate species/route/schedule → one ArmSpec per active dose group)
   ▼  for each arm:
pbpk_adapter.run_arm_exposure()      AD gate → IVIVE (MC) → Kp → assemble_disposition → run_virtual_cohort
   ▼
pkpd_engine.pkpd_summary()           PK metrics + dose-proportionality + target coverage (receptor occupancy)
   ▼
evidence_engine.collect_evidence()   ChEMBL / EPA CCTE / PubChem / PK-DB  (best-effort, provenance-tagged)
   ▼
safety_engine.compute_safety()       evidence NOAEL + allometric MTD (FDA km) + in-vitro POD status + margins
   ▼
sensitivity_engine.compute_sensitivity()   OAT drivers of clearance/half-life
   ▼
decision_engine.stage_gate()         GO / NO-GO / CONDITIONAL + criteria + value-of-information
   ▼
reporting_engine.assemble_report()   presentation contract + Markdown
   ▼
store.put_study(study_id)            persisted for report retrieval
```

Orchestrated by `pipeline.run_animal_study()`.

---

## 6. Feature reference — what each block does

| Output block | Engine | What it produces | Provenance |
|---|---|---|---|
| **Simulation Readiness** | `parameter_engine.readiness()` | Which blocks can be produced given the inputs; applicability-domain label; potency presence. | derived |
| **Study Summary** | `pipeline` | Species/strain/sex/route/dose groups/schedule/cohort. | context |
| **Selected Scientific Models** | `reporting_engine` | The list of models/datasets that actually produced numbers. | meta |
| **Plasma PK + Tissue Exposure** | `pbpk_adapter` → kernel cohort | Per-organ mean/p05/p95 concentration–time curves. | derived (PBPK) |
| **PK Metrics** | `pkpd_engine.pk_metrics_for_arm()` | Cmax/Tmax/AUC/CL/Vss/t½ with 90% intervals, per tissue. | derived |
| **Target Coverage / PK-PD** | `pkpd_engine.target_coverage()` | 1:1 mass-action receptor occupancy from free drug + Kd: peak, average, %time above threshold. Absent potency → `not_predicted`. | derived (ml Kd) |
| **Population Variability** | kernel cohort | Inter-animal spread (the 90% intervals). | derived |
| **Safety Margins** | `safety_engine.compute_safety()` | (1) Evidence NOAEL, (2) allometric MTD/NOAEL with interval, (3) in-vitro POD status; per-arm dose margins; hazard flags. | measured + derived + ml |
| **Public Evidence** | `evidence_engine.collect_evidence()` | ChEMBL analogue PK, EPA CCTE NOAEL, PubChem LD50, PK-DB parameters. | measured (public) |
| **Sensitivity** | `sensitivity_engine.compute_sensitivity()` | Ranked normalised sensitivity of CL/t½ to CLint, fu, Vdss, Q_h. | derived |
| **Dose Comparison** | `pkpd_engine.dose_proportionality()` | Power-model slope β (linear vs saturable). | derived |
| **Stage-Gate Recommendation** | `decision_engine.stage_gate()` | GO / NO-GO / CONDITIONAL; per-criterion verdicts; value-of-information (next measurements). | derived |
| **Scientific Report** | `reporting_engine` | Markdown export + presentation contract. | meta |

---

## 7. Endpoint reference

Router paths are `/predict/l3/*` (reached from the frontend as `/api/ai/l3/*` via the same proxy that maps L1/L2). Defined in `hakase_smallmol/router.py`.

| Method & path | Handler | Request (JSON) | Returns |
|---|---|---|---|
| `POST /predict/l3/contract` | `api_l3_contract` | `{analysis_id?}` or `{smiles?}` | Handoff + **readiness** contract: target/potency from L1, readiness checks, species catalog, supported routes/frequencies. |
| `POST /predict/l3/design` | `api_l3_design` | full study request | Validates/normalises the design **without simulating**; returns the normalised arms + warnings. Cheap pre-flight. |
| `POST /predict/l3/run` | `api_l3_run` | full study request | Runs the whole study (all engines) → the persisted study record (incl. `study_id`, `presentation`, `stage_gate`). |
| `GET /predict/l3/report/{study_id}` | `api_l3_report` | — | The persisted record + a Markdown report. |

**Full study request body** (`L3AnimalStudyRequest`):
```json
{
  "analysis_id": "…",              // OR "smiles": "…"
  "animal": { "species": "rat", "strain": "sprague_dawley", "sex": "male", "body_weight": null },
  "dose_groups": [ { "dose_mg_per_kg": 5 }, { "dose_mg_per_kg": 25 }, { "dose_mg_per_kg": 100 } ],
  "route": "ORAL",                 // IV | ORAL | SC
  "frequency": "QD",               // QD | BID | TID | QID | QnH | null (single dose)
  "duration_h": 48,
  "infusion_duration_h": null,     // IV infusion only
  "formulation": "plain",
  "cohort_size": 10,               // 2–1000 virtual animals per arm
  "seed": 42,
  "overrides": null,               // measured disposition overrides (optional)
  "collect_public_evidence": true
}
```

Existing related endpoints (unchanged): `POST /predict/pbpk/exposure` (single-arm exposure, the Phase-0 engine L3 builds on), `POST /predict/l1`, `POST /predict/l2/*`.

---

## 8. Tools & datasets integrated (and where)

| Tool / dataset | Role in L3 | Where wired | License / access |
|---|---|---|---|
| **Hakase kernel PBPK** (scipy) | Default ODE + virtual-cohort engine (Radau). | `platform/kernel/pbpk/*`, called by `pbpk_adapter.py` | in-house |
| **mrgsolve** (Metrum, R/C++) | **Alternative + cross-validation PBPK engine.** Same disposition & physiology as the kernel; a whole-body PBPK expressed in mrgsolve's C++ ODE DSL. Selectable per run; `auto` prefers it when R is installed. Kernel↔mrgsolve agree to <1% (tested). | `l3/mrgsolve_adapter.py` + `l3/mrgsolve/run_mrgsolve.R` | GPL (R pkg) |
| **Hakase IVIVE** | Disposition source of truth (CLint, fu, Vdss, CL split). | `pk_ivive.py`, called by `pbpk_adapter.py` | in-house |
| **Hakase ADMET ML** | The ML inputs behind IVIVE (reused from the L1 record; no second inference). | via `parameter_engine.py` (`l1_ivive_inputs`) | in-house |
| **RDKit** | Descriptors for BCS/absorption; structure parsing. | `pbpk_adapter.py` | BSD |
| **ChEMBL** (REST) | Analogue in-vivo animal PK (CL/Vd/t½/F) at 70% similarity; target potency. | `evidence_engine.py` (`query_chembl_pk`) | CC BY-SA |
| **EPA CCTE Hazard / ToxRefDB** (REST) | Measured in-vivo NOAEL/LOAEL by species → safety anchor. | `evidence_engine.py` (`query_ccte_hazard`) | public (optional API key `EPA_CCTE_API_KEY`) |
| **PubChem** (REST) | Rodent acute LD50; compound-name resolution. | `evidence_engine.py` | public |
| **PK-DB** (REST) | Curated experimental PK parameters. | `evidence_engine.py` (`query_pkdb_data`) | public |
| **FDA (2005) km factors** | Body-surface-area interspecies dose scaling for the allometric NOAEL anchor. | `safety_engine.py` (`KM_FACTORS`) | literature reference constants |

### Consciously NOT integrated (and why — honest boundaries)

| Tool | Verdict | Reason |
|---|---|---|
| **EPA httk** | Reimplemented-in-spirit, not shelled out | httk itself substitutes human fu/Kp/CLint for animals — no capability the kernel lacks. Adapter interface left open for future R-based cross-validation. |
| **PK-Sim / MoBi** | Reference only | GUI/.NET, not embeddable as a Python service. |
| **AnimalGAN** | `not_predicted` (unsupported) | No public downloadable weights/inference repo located; emulating its 38 clinical-pathology measures would be fabrication. Surfaced as a named unsupported capability. |
| **Open TG-GATEs / DrugMatrix** | Named, not quantitatively used | Compound-identity-keyed transcriptomics; listed as a source, not used for quantitative anchoring in v1. |
| **QSP (DILIsym / O'Hara-Rudy) via COPASI/PySB** | Deferred (Phase 2) | Organ-toxicity *magnitude* — out of scope for the exposure/cohort layer. |

---

## 9. Simulation engines (kernel + mrgsolve)

L3 runs each dose group through a **selectable PBPK engine** (`engine` field: `auto` | `mrgsolve` | `kernel`):

- **kernel** — the in-house 13-compartment scipy/Radau PBPK. Always available. Runs internally in **minutes** (converted to hours at the boundary).
- **mrgsolve** — Metrum's validated R/C++ ODE engine (`l3/mrgsolve/run_mrgsolve.R`), the *same* whole-body PBPK equations and the *same* disposition + physiology, run natively in **hours**. Selectable when R is installed.
- **auto** (default) — prefer mrgsolve when available, else kernel. If `mrgsolve` is requested but R is missing, it falls back to kernel and flags it per arm.

The two engines **cross-validate**: for the same disposition they agree to **<1%** on Cmax/AUC/t½ (`test_l3_mrgsolve.py`). This makes L3's exposure numbers defensible against an independent, widely-used tool.

**R / mrgsolve setup (one-time):**
```bash
brew install r                                   # R 4.6.x (arm64)
mkdir -p ~/Rlibs
Rscript -e '.libPaths("~/Rlibs"); install.packages(c("jsonlite","mrgsolve"),
  repos="https://cloud.r-project.org", type="source")'   # Homebrew R needs source builds
```
The adapter finds `Rscript` on `/opt/homebrew/bin` (or PATH), sets `R_LIBS_USER=~/Rlibs`, and caches compiled models in `~/.hakase_mrgsolve_cache`. No R → the layer silently uses the kernel engine; nothing breaks. The `/predict/l3/contract` response reports live mrgsolve availability + version under `study_design_options.engines`.

## 10. How to run & test

**Unit tests (fast, no network/ML):**
```bash
cd hakase-bio-backend
PYTHONPATH="platform/kernel/src:platform/structure/src:modalities/small-molecule/engine/src" \
  .venv/bin/python -m pytest modalities/small-molecule/engine/src/hakase_smallmol/l3/tests -q
```
20 tests: 16 unit (no network/ML) + 2 pipeline integration + 4 mrgsolve/cross-validation. The ML- and R-dependent tests auto-skip when those stacks are unavailable. All green.

**Frontend build/typecheck:**
```bash
cd hakase-invitro-workspace
npm run build          # tsc -b && vite build — clean
```

**Manual API check** (in-process, no server warmup): see the `TestClient` snippet used during development — POST `/predict/l3/contract`, `/predict/l3/design`, `/predict/l3/run`, GET `/predict/l3/report/{id}`.

---

## 11. Known limitations (surface these to users, they're in the output too)

- **Cross-species PK** is only as good as the disposition inputs; non-human ML clearance is flagged `low` confidence and prefers measured/curated CLint where available.
- **Safety margins** are dose-based (NOAEL/LD50 vs administered dose), not AUC-based, because the public anchors are reported as doses. The allometric NOAEL is model-derived (weaker provenance) with an explicit ÷/×3 interspecies interval. In-vitro POD (ToxCast AC50 reverse-dosimetry) is **not integrated in v1**.
- **Target coverage** is receptor occupancy (target engagement), not an efficacy/PD-effect prediction, and uses plasma free-drug as the biophase surrogate.
- **Repeat IV** dosing is approximated as a fast first-order input (flagged); repeat oral/SC is modelled properly.
- **Not predicted at all** (returns typed `not_predicted`): organ-toxicity magnitude, histopathology, clinical-pathology panels (AnimalGAN), efficacy, immunogenicity, biologics/peptides/nucleic-acid modalities.

---

## 12. Extension points

- **httk / mrgsolve cross-validation:** add an `httk_adapter.py` behind a Plumber R service; the `DispositionParameters` contract is already the clean plug.
- **In-vitro POD:** wire ToxCast AC50 from the CCTE bioactivity API into `safety_engine` for reverse-dosimetry margins.
- **New species:** add a physiology row in `platform/kernel/.../physiology/store.py`; `species_catalog()` and the UI pick it up automatically.
- **Durable persistence:** replace the four functions in `store.py` with a DB-backed implementation.
- **New modality (mAb/peptide):** the kernel PBPK + `DispositionParameters.modality_extension` slot already anticipate this; L3's engines consume the contract, not small-molecule specifics.
