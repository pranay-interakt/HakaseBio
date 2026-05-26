# Implementation Prompt — Hakase BioTwin Boltz-2 Wiring & Multi-Modality Expansion

> Copy everything below the line and send it as a new message when you want the work done.
> It is self-contained: it assumes the assistant is starting fresh with the
> `Hakase-BioTwin-dev` repo mounted, and no memory of the review conversation.

---

You are working in the **Hakase BioTwin** repository (preclinical digital-twin platform).
Read this whole prompt before touching anything. **Do not write code until you have
read the files listed in "Orient yourself" and confirmed the plan with me.**

## Context

Hakase BioTwin is a small-molecule preclinical digital twin: SMILES in → Layer 1
(In-Vitro Twin: physicochemistry, ADMET, safety, binding, Go/No-Go) → Layer 2
(Confirmation: 10-stage in-silico pipeline + evidence-governance Confirmation Engine).
A Boltz-2 co-folding + binding-affinity integration was added but it is **not wired
into L1 or L2** — it is only reachable from a standalone page. We are going to wire it
in, then extend the platform beyond small molecules.

A full review and roadmap exists: **`Hakase_BioTwin_Boltz2_Review_and_Expansion_Plan.docx`**
in the repo root. Read it first — it has the rationale, the scorecard, per-modality
detail, the data-source table and the phased plan. This prompt is the execution brief.

## Non-negotiable rules (the platform's honesty contract)

1. **Never fabricate** a structure, a confidence value, an affinity or any numeric
   output. If something cannot be computed honestly, return an explicit `unavailable`
   / out-of-scope status with a reason. No silent defaults.
2. **Never regress the small-molecule pipeline.** It is the default branch and the
   reference implementation. Existing behaviour for a SMILES input must be byte-stable.
3. **Provenance on everything.** Every numeric output carries a provenance tier
   (`experimental` / `enriched` / `ml` / `structural` / `heuristic` / `cofolded` /
   `unavailable`). New outputs must too.
4. **Commercial-safe only.** Any new model / library / dataset must be MIT / Apache-2.0
   / BSD / open-data. No AlphaFold 3 weights, no ESM-3, no academic-only tools
   (NetMHC*, IMGT data, OPIG webservers, ViennaRNA). See the report's Section 6.
5. **Type-check and validate after every phase.** Run `tsc --noEmit` for the frontend
   lib and the relevant Python checks. Do not mark a phase done with errors.

## Orient yourself (read before coding)

- `Hakase_BioTwin_Boltz2_Review_and_Expansion_Plan.docx` — the full plan.
- `artifacts/ai-service/models/cofolding.py` — Boltz-2 upstream (validate, build YAML, dispatch).
- `runpod_worker_boltz/` — the GPU worker (`handler.py`, `boltz_runner.py`).
- `artifacts/hakase-ai/src/lib/l2Pipeline.ts` — the 10-stage L2 pipeline.
- `artifacts/hakase-ai/src/lib/admet.ts`, `inVitroSim.ts`, `cascadeGate.ts`,
  `confirmationEngine.ts`, `l2DoseProjection.ts`, `pbpk.ts`, `mlOverlay.ts`.
- `artifacts/hakase-ai/src/lib/aiService.ts`, `pages/CoFolding.tsx` — current cofold wiring.
- `Hakase_BioTwin_L1_L2_Algorithm_Reference.docx` — how L1/L2 currently work.

## Work in phases. After EACH phase: stop, summarise what changed, and wait for my OK.

### Phase 0 — Wire Boltz-2 into L1 and L2 (do this first, ship it, then check in)

1. **Co-folding as an L2 stage.** Add co-folding to `l2Pipeline.ts` as Stage 2b (sibling
   of docking). Opt-in (GPU-priced), same four statuses as other stages
   (`wired` / `out-of-scope` / `error` / `skipped`). Inputs from frozen L1 evidence.
2. **Route the affinity head.** Insert Boltz-2 affinity as a high-priority,
   structure-grounded source in: the L1 binding panel (above the curated TARGET_MAP
   anchor, below experimental/ML); L2 Stage 3 (show alongside Binding-ML with
   agree/diverge); L2 Stage 8 dose projection (a valid Ki source so it stops throwing).
   Where Stages 2, 2b and 5 all ran, render a three-method affinity consensus panel.
3. **Structure-confidence gate.** Before any Boltz-2 affinity is shown or propagated,
   gate on interface confidence — initial policy: ipTM ≥ 0.75 & ligand pLDDT ≥ 70 →
   full; ipTM 0.55–0.75 → propagate down-weighted + "low interface confidence" badge;
   ipTM < 0.55 → suppress from headline panels (pose still viewable, marked low).
   Make the thresholds policy-snapshotted (like the Confirmation Engine tolerance bands).
4. **Provenance tier.** Add a `cofolded` tier (weight ~0.65, scaled by interface
   confidence) to the provenance model and `cascadeGate.ts` so co-folding outputs flow
   through the cascade gate and can be sealed.
5. **Persistence.** Move the in-memory `_JOBS` dict in `cofolding.py` to SQLite-backed
   persistence; on AI-service restart, re-attach in-flight RunPod jobs by
   `runpod_job_id`. Persist predicted structures (CIF/PDB) to object storage keyed by
   content hash; reference the hash from the L2 record / PreClinicalPackage.
6. **Honest model naming.** Keep any UI product name, but record `Boltz-2` + exact
   version + MIT license in the model card and the sealed evidence block.

**Phase 0 exit criteria:** running the L2 pipeline on a small molecule with a known
target produces a Boltz-2 pose + confidence-gated affinity that appears in the L1
binding panel, is cross-checked in Stage 3, feeds Stage 8, carries the `cofolded`
provenance tier through the cascade gate, and is named as Boltz-2 in the package —
with **zero regression** to existing small-molecule output.

### Phase 1 — Modality router + Peptides

- Add an explicit **modality router** at the input (small molecule / peptide /
  antibody / oligonucleotide / PROTAC / ADC). Small molecule = default branch,
  unchanged. The router is a thin dispatch layer; reuse all modality-agnostic
  governance (cascade gate, Confirmation Engine, provenance, seal chain, package).
- **Add hard modality guards** (cross-cutting): `pbpk.ts`, Lipinski/Veber, the
  heuristic ADMET engine and RDKit drug-likeness must check modality and return
  out-of-scope rather than run on a non-small-molecule.
- **Peptide L1**: sequence descriptors (length, net charge @ pH 7.4, pI, GRAVY,
  aliphatic/Boman index, amphipathicity, non-natural/D-residue fraction, cyclisation);
  peptide ADMET (proteolytic stability, renal clearance, permeability, oral BA,
  half-life-extension need); peptide liabilities (Met/Trp oxidation, NG/NS deamidation,
  DG/DS isomerisation, aggregation stretches); immunogenicity via an MHC-II model
  trained on **IEDB** public data (commercial-safe).
- **Peptide L2**: peptide–target co-folding via Boltz-2; peptide-aware PK branch
  (do not reuse small-molecule PBPK); peptide falsifiers in the Confirmation Engine.
- Version the **PreClinicalPackage schema** (schema-version + modality fields).

### Phase 2 — Antibodies / nanobodies / bispecifics

- **L1**: ANARCI numbering (BSD) → CDR/framework extraction; developability profile
  (re-implement Therapeutic-Antibody-Profiler-style metrics from public data — CDR
  length, hydrophobic patches, charge patches, Fv charge symmetry); CDR liability scan;
  humanness (germline-similarity / repertoire methods, OGRDB + OAS data); immunogenicity
  (reuse the IEDB MHC-II model); Tm/stability; therapeutic precedents (WHO INN /
  Thera-SAbDab — verify commercial terms or derive from PDB + INN).
- **L2**: antibody–antigen co-folding via Boltz-2 + epitope/paratope mapping from
  interface residues; a **TMDD/FcRn PK model** (small-molecule PBPK hard-gated off);
  biologics falsifiers (Tm, SPR/BLI KD, ADA incidence, SEC-HPLC % monomer).

### Phase 3 — Oligonucleotides + PROTACs

- **Oligo L1**: descriptors (length, GC, MFE via **seqfold** (MIT) — not ViennaRNA;
  modification pattern); off-target hybridisation search vs. Ensembl/RefSeq
  transcriptome; oligo safety (CpG/TLR9 immunostimulation, class hepatotox, complement);
  class-based ADMET with honest low-confidence labels.
- **PROTAC L1**: warhead+linker+warhead decomposition; beyond-Rule-of-5 handling
  (do not penalise PROTACs with Lipinski); per-warhead ADMET via the existing engine.
- **L2**: ternary-complex co-folding (target + degrader + E3 ligase) via Boltz-2;
  per-interface affinity + cooperativity read-out; oligo/degrader falsifiers.

### Phase 4 — ADCs + consensus & hardening

- **ADC**: composite pipeline (antibody developability + payload small-molecule
  pipeline); DAR, linker stability, payload-release scoring; composite PK; ADC falsifiers.
- **Hardening**: optional Protenix-v1 / OpenFold3 (Apache-2.0) consensus structure for
  hard targets; DiffDock-L (MIT) as a Vina complement; self-hosted mmseqs2 MSA +
  single-sequence default for proprietary sequences (privacy); MSA/apo-structure
  caching; batch co-folding endpoint; complete the model-card set for all models.

## Cross-cutting (thread through phases, do not batch at the end)

- Extend the Confirmation Engine **falsifier registry** with per-modality classes as
  each modality lands (the comparator machinery already exists — this is registry content).
- Expose Boltz-2 **method conditioning** (X-ray/NMR/MD) in `cofolding._validate_options()`
  and the worker CLI — only if the pinned `boltz` version supports it.

## Deliverable per phase

A short written summary of: files changed, what each change does, how the honesty
contract was kept, the type-check/validation result, and confirmation that
small-molecule output did not regress. Then stop and wait for my approval before the
next phase.
