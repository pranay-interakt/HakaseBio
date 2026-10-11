# 03 — Product Architecture: The OS Concept

## 3.1 Kernel + drivers (the mental model)

HOS is built like an operating system, not like eighteen applications. There is a **small kernel**
and a **growing library of drivers**. Linux shipped a kernel plus device drivers; the driver library
is what made it an OS. Same shape here: the kernel schedules scientific work onto heterogeneous
execution targets, and each driver knows how to run one study type.

### The kernel = four primitives

1. **Study/Experiment lifecycle** — a state machine:
   `PROPOSED → DESIGNED → PLANNED → DISPATCHED → DATA_RECEIVED → ANALYZED → REPORTED → APPROVED`
   (plus `CANCELLED` and `FAILED`; amendment returns to `DESIGNED`, replacement data to
   `DATA_RECEIVED`, re-analysis to `ANALYZED`, each with a recorded reason). There is no costing
   state: price is a laboratory quote, not something the system estimates
   (`hos/kernel/lifecycle.py`).
2. **Entity graph** — the typed objects and their relationships: `Substance`, `Lot`, `Sample`,
   `Protocol`, `Run`, `Result`, `Subject`, `Study`, `Finding`, `Program`, `Instrument/ExecutionTarget`.
   Two relationships are load-bearing: **`derived_from`** (complete, bidirectional lineage) and the
   **`hypothesis` link** (every run records the question it answers — the field every incumbent omits,
   and the thing that makes a closed loop possible). See `docs/07`.
3. **Provenance ledger** — append-only record of every value and every computation, with inputs,
   method+version, reference-parameter version, library versions, actor, timestamp. The ALCOA+
   "original." See `docs/07`, `docs/10`.
4. **Attestation boundaries** — the four legal signatures (Study Director, QA, IACUC/Vet, QP) as
   first-class primitives. The kernel assembles what they need and records the signature; it never
   signs for them.

### The execution abstraction (the heart of "OS")

```
ExecutionTarget (interface)                    implemented in hos/kernel/execution/
├── ExternalLabTarget  # a CRO: dispatch bundle out, return file in        (built)
├── InHouseTarget      # sponsor's lab, named responsible scientist         (built)
├── SimulationTarget   # declared, seeded generator; SIMULATED, never evidence (built)
└── RoboticSystem      # worklist in, data out                              (planned)
```

The kernel dispatches a study's steps onto an `ExecutionTarget` without the driver caring which kind
it is. For the initial build, `ExternalCRO` (and a `SimulatedTarget` for demonstration, clearly
labeled as such) are the concrete implementations; `RoboticSystem` and full `HumanBench` capture come
later. This is what distinguishes HOS from a LIMS: it *runs* work, it does not merely record it.

### Drivers = study types

A **driver** implements the `StudyDriver` interface. The implemented interface is specified in
`docs/08`; the original capability sketch below maps onto it (`qc` is part of `analyze`, the
regulatory slot is the driver's `ctd_section`):

- `design(molecule, context) -> Protocol`  — compose a correct, parameterized protocol.
- `plan(protocol, target) -> Plan`          — cost, timeline, materials, dependencies.
- `instruction_package(protocol) -> Package`— exactly what a CRO/robot/human needs to execute.
- `ingest(raw_data) -> StructuredRun`       — parse whatever format comes back.
- `analyze(run) -> list[Result]`            — apply the driver's cited equations; emit Quantities.
- `qc(run) -> QCVerdict`                     — enforce acceptance criteria (controls, Z′, etc.).
- `report(results) -> StudyReport`          — formatted report, every figure traceable.
- `regulatory_slot() -> CTDLocation`        — where this study sits in Module 4 / SEND.

Adding study type N is bounded, repeatable work against this interface — which is why the driver
library is the compounding asset.

## 3.2 Module map (how the kernel + drivers surface as product)

These are *views onto the lifecycle*, not separate apps. Priority is set in `docs/11`.

- **M1 Program & portfolio** — TPP as a live object; gates as executable criteria; kill-reason capture.
- **M2 Design studio** — molecule intake, descriptors, predicted properties (labeled), design
  hypothesis required.
- **M3 Registry** — modality-native identity; lot≠substance; incumbent **mirroring** for adoption.
- **M4 Protocol engine** — protocols as structured, versioned, executable objects; literature→protocol.
- **M5 Planner/scheduler** — feasibility (material/instrument/passage/expiry), batching, cost vs. CRO.
- **M6 Inventory & sample state** — freeze-thaw counting, reagent-lot→result linkage (both usually absent).
- **M7 Execution** — bench mode / robot orchestration / CRO dispatch via the execution abstraction.
- **M8 Capture & integration** — parser library over real instrument/CRO formats; plate-map lineage.
- **M9 Analysis & results** — cited fits, QC gating at capture, cross-source normalization.
- **M10 In vivo & vivarium** — randomization/blinding built in; IACUC linkage; continuous streams.
- **M11 External study workspace** — the CRO handoff as one shared object (the commercial wedge).
- **M12 Toxicology/safety workbench** — GLP lifecycle; pathology peer review; **continuous SEND**.
- **M13 CMC/analytical/release** — specs, stability, conditional-release states.
- **M14 Regulatory assembly** — IND readiness dashboard; Module 4 from source; gap analysis vs. ICH.
- **M15 Quality & compliance** — Part 11 audit trail, validation accelerator, two-plane boundary.
- **M16 Knowledge & memory** — "has anyone done this?"; ontology annotation at capture.
- **M17 Agent runtime** — agents act through the same API + permissions + audit trail as the UI.
- **M18 Platform** — migration tooling, open API, connectors, export guarantee.

## 3.3 What "run a study and get an outcome" actually means

The OS does not produce biology. It produces **decisions and documents**: a finished protocol, a
plan (cost/timeline/critical path), the analyzed result (curve, NOAEL, pass/fail) when data arrives,
the study report, the regulatory section, and the recommendation for what to run next. The pipetting
is bought from a CRO; everything around it is the product. (Analogy: an airline ops system never
flies a plane, yet it is the airline's most valuable software.)
