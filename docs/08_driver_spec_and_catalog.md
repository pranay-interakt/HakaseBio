# 08 — Driver Specification & Catalogue

> Status: implemented in `backend/hos/drivers/`. ABI version **1.0**.

## 8.1 Model

A **driver** packages one study type end to end. The model follows an operating-system driver
subsystem:

| OS idea | HOS implementation |
|---|---|
| subsystem core shared by all drivers | `StudyDriver` base class: strict CSV ingest, SHA-256 of raw files, unit conversion, simulation detection, simulation taint, interpretation citation check, report appendices and disclaimer |
| driver hooks | `design`, `plan`, `data_template`, `sample_manifest`, `validate_records`, `_analyze`, `_interpret`, `_report_sections`, optional `_simulate_rows` |
| device-ID match table | `requirement_ids` + `modalities`; `probe(requirement, context)` returns `Support` with design-parameter pre-fill |
| module registration / ABI | `DriverRegistry.register` refuses a missing identity attribute, an ABI-major mismatch, or a duplicate id |
| loadable modules | `DriverRegistry.discover()` loads drivers from the `hos.drivers` Python entry-point group |
| kernel selftests | `hos.drivers.conformance.check_driver` — every driver must pass |

A driver never touches the database or the ledger; the kernel calls it and records the results.

## 8.2 Interface

```
probe(requirement, context) -> Support            match + pre-fill (e.g. species, duration)
parameters_model() -> pydantic model              validated design parameters; no scientific defaults
design(compound, params, context, hypothesis) -> ProtocolDocument   deterministic; cites >= 1 reference
plan(protocol, params) -> StudyPlan                duration with stated basis; cost is always None
data_template(params) -> DataTemplate              exact CSV contract incl. required metadata
sample_manifest(params, compound)                  ids the lab labels samples with
instruction_package(ref, protocol, params, compound) -> InstructionPackage -> .to_bundle() zip
ingest(bytes, params, claimed_origin, study_reference) -> IngestedData
analysis_inputs(params) -> {name: unit}            values needed from outside the file
analyze(data, params, compound, inputs) -> AnalysisResult
interpret(analysis, params, context) -> Interpretation
expert_determinations(params) -> [ExpertDetermination]
report(protocol, data, analysis, interpretation, determinations) -> StudyReport
simulation_parameters_model() / simulate(params, compound, sim, seed, ref) -> SimulatedDataset
```

### Ingest contract (base class, every driver)

- UTF-8 CSV; `# key: value` metadata lines first; required metadata: `laboratory`, `analyst`,
  `run_date` (ISO 8601), `study_reference` (must equal the HOS study id).
- Header columns may carry a unit, `name [unit]`. Any dimensionally compatible unit is
  converted to the template unit and the conversion is recorded. Incompatible or unknown units
  are rejected. A per-row unit column is supported (`unit_column`) for long-format data.
- Rejected: missing or duplicate columns, unexpected columns, wrong field counts, non-numeric or
  non-finite values, values outside physical bounds, choices not in the list, empty required
  cells, empty files, header-only files, non-UTF-8 files, and a file declaring another template.
  **All** errors are returned with line numbers.
- Origin: a file is SIMULATED if it carries `# hos-simulated: true` or a `simulation:`
  instrument, whatever the uploader claims. A claim of SIMULATED is always honoured; data can be
  downgraded, never laundered upward.

### Analysis contract

- Numeric results are `Quantity` objects. Tables reject bare floats; integers are allowed only
  for counts.
- When the data are simulated, the base class adds `derived_from_simulated_data` to every
  quantity and sets `evidence_admissible = False`.
- Interpretation statements must name a basis and cite registered keys, or the driver raises.
  Anything needing expert judgement is listed in `requires_expert_judgement` and never decided.
- Determinations (e.g. NOAEL) are declared, with the role that owns them. The kernel records them
  only from that human, with a signature (`docs/10`).

### Conformance kit (15 checks)

The kit checks:
- identity and `describe()`;
- that parameters validate;
- that design is deterministic and cited;
- that the plan has no cost and states its basis;
- that the bundle is byte-deterministic with a valid manifest;
- that ingest rejects empty files, header-only files, non-UTF-8 files and non-numeric values;
- that simulation is seeded and reproducible;
- that simulated data cannot be claimed as measured;
- that analysis of simulated data is fully tainted and inadmissible;
- that every interpretation is cited;
- that the simulated report carries the disclaimer and never calls the data "measured";
- that measured data flows through to an admissible report.

## 8.3 Catalogue

### `metabolic_stability` v1.0.0 — liver microsomal substrate depletion with IVIVE

- **Serves.** `adme.metabolic_stability` (ICH M3(R2) §3), CTD 4.2.2.4, for small molecules.
- **Design parameters.** All required: species, substrate and protein concentration, temperature,
  buffer, cofactor, quench, analytical method, timepoints (starting at 0), replicates, minus-NADPH
  arm, positive controls (each acceptance range needs its basis), acceptance R² and minimum
  depletion with their basis, optional minus-NADPH loss criterion, and fu,mic correction
  (none / Hallifax–Houston).
- **No defaults.** The protocol research found no citable consensus source for the "standard"
  conditions (`docs/research/driver_protocols.md` A.8–A.11), so the driver offers none.
- **Return data.** Per sample: id from the manifest, compound code, species, cofactor, replicate,
  time, analyte/IS response, BLQ flag. The lab must return a quantifiable 0 min sample for each
  series.
- **Analysis.** Mean response per timepoint, then in sequence:
  - `fit_depletion`, which gives k and t½ (Obach 1999);
  - `clint_in_vitro`;
  - optional fu,mic (domain per Gertz 2008);
  - `scale_clint_to_liver` with cited MPPGL and liver weight, returning UNAVAILABLE for species
    without a verified scalar;
  - the well-stirred CLh, then Eh and Fh;
  - minus-NADPH % remaining;
  - positive-control CLint with its acceptance check.
  CLh is UNAVAILABLE without fu,p and B:P inputs.
- **Known-value tests.** Exact half-life recovery, and the hand-calculated IVIVE chain from the
  cited constants.

### `herg_patch_clamp` v1.0.0 — ICH S7B / E14-S7B Q&A

- **Serves.** `safety.herg` (S7B §§2.3.1, 3.1.2), CTD 4.2.1.3. GLP-capable.
- **Design.** Built on the E14/S7B Q&A 2.1 best-practice items, and the protocol carries a
  compliance checklist:
  - 35–37 °C recording;
  - 0.2–1 Hz stimulation;
  - a selective blocker for background current;
  - steady state before measurement;
  - analytically verified concentrations;
  - vehicle control;
  - a reference-drug positive control at ≥ 2 concentrations giving 20–80 % block (S7B §3.1.1 says
    a positive control belongs in every study).
- **Return data.** Per cell: baseline, drug and background currents, nominal and measured
  concentration, temperature, steady-state flag.
- **Analysis.**
  - background-corrected per-cell inhibition;
  - a 4PL fit on measured concentrations;
  - IC50 in µM and ng/mL (the latter from RDKit MW) with its CI, and the Hill coefficient;
  - positive-control block against its stated expected range; out of range means the study is
    *inconclusive* (Q&A 2.1 item 7);
  - margin = IC50 / free high clinical exposure, with fu floored at 1 % (S7B Q&A 1.2) and the CI
    propagated from the IC50.
- **Threshold.** No fixed safety threshold is applied. The Q&A requires comparison with reference
  drugs run under the same protocol, so a threshold is used only when the user supplies one with
  its basis.
- **Known-value tests.** Exact IC50/Hill recovery, the ng/mL conversion, the fu floor, and
  positive-control block values.

### `repeat_dose_toxicity` v1.0.0 — OECD TG 407/408/409 and ICH M3(R2)

- **Serves.** `tox.repeat_dose_rodent`, `tox.repeat_dose_nonrodent`, `tox.repeat_dose` and
  `tox.repeat_dose_marketing`, CTD 4.2.3.2. GLP-capable.
- **Design validation.** Checked against the TG minimums, citing the paragraph in each error:
  - TG 407 ¶17/18/22: ≥ 5/sex, ≥ 3 doses, 28 days, recovery ≥ 14 days;
  - TG 408 ¶15/16/20: ≥ 10/sex, ≥ 90 days;
  - TG 409 ¶12/13/6: ≥ 4/sex, 90 days.
  The protocol also flags a top dose above the M3(R2) §1.5 limit of 1000 mg/kg/day and dose
  spacing above 10-fold, and carries a coverage check against the TG haematology,
  clinical-chemistry and organ-weight lists.
- **Pre-fill.** From the requirement: species, duration, and the TG implied by that duration.
- **Return data.** Long format, one row per animal × endpoint × timepoint, with a per-row unit.
- **Analysis.** For each endpoint × sex × phase × timepoint:
  - group mean and SD;
  - % difference from control;
  - Dunnett two-sided p for each dose group against control (`scipy.stats.dunnett`, with a fixed
    QMC seed so results reproduce).
- **NOAEL.** The system reports statistical significance only. The NOAEL is a required
  `ExpertDetermination` by the Study Director, and "not established" can be recorded.
- **Known-value test.** Dunnett's (1955) blood-count example reproduces the published conclusion.

### `bioanalytical_validation` v1.0.0 — ICH M10 section 3 (chromatographic methods)

- **Serves.** `bioanalytical.validation` (M10 §3), CTD 4.2.2.1. GLP-capable. Research note:
  `docs/research/drivers/bioanalytical_validation.md`; criteria transcribed and cross-read
  independently from the official PDF.
- **Design.** Analyte, IS, matrix, species, technique, concentration unit, regression model and
  weighting with their written-procedure basis (M10 does not prescribe a weighting), calibration
  levels (≥ 6), QC levels checked against M10 §3.2.5.1 (LQC within 3× LLOQ, HQC ≥ 75% of ULOQ,
  MQC "around" 30–50% of range flagged when outside), runs and replicates (≥ 3 × ≥ 5),
  selectivity and matrix-effect lots (≥ 6 unless a rare-matrix justification is stated),
  dilution factors (≥ 5 replicates) and stability tests (freeze–thaw ≥ 3 cycles, ≥ 3 aliquots).
- **Return data.** One row per injection: run, experiment, sample type, level, nominal
  concentration, analyte and IS responses, source lot, dilution factor, stability test. Each
  run's curve (standards, blank, zero) is labelled experiment `calibration`.
- **Analysis.** Per run: the stated regression and weighting, standards outside ±15% (±20% at
  LLOQ) rejected and the curve re-evaluated once, run acceptance (≥ 75% of standards, ≥ 6 levels,
  ≥ 50% per level with replicates; for accuracy-and-precision runs both LLOQ and ULOQ retained).
  Then within- and between-run accuracy and precision, selectivity and carry-over relative to the
  LLOQ analyte and IS responses, matrix effect per lot, dilution integrity and stability, each
  failure citing its M10 section. ISR (M10 §5) is a core function used where study samples exist.
- **Determination.** "Method validated / not validated" is a categorical determination signed by
  the responsible scientist; the system reports criteria, it does not conclude.
- **Known-value tests.** Exact recovery (100% accuracy, 0% CV) from a noise-free response model;
  the weighted fit against an independent closed-form weighted regression; M10's ISR formula and
  sample-count rule.

## 8.4 Writing a new driver

1. Subclass `StudyDriver`. Set the identity and match-table attributes, and implement the hooks.
2. Declare every scientific design value as a required parameter. If a citable convention
   exists, put it in the documentation with its source, not in a default.
3. Register methods and citations in the core registries (`methods.py`, `citations.py`), each
   with a verified source.
4. Pass `check_driver` and add known-value tests from the source.
5. Ship it in-tree (add to `BUILTIN_DRIVERS`) or as a package exposing an entry point in the
   `hos.drivers` group.
