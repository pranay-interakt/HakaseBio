# 08 — Driver Specification & Catalogue

> Status: implemented in `backend/hos/drivers/`. ABI version **1.1** (1.1 adds `post_data_inputs`; drivers written for 1.0 load unchanged).

## 8.1 Model

A **driver** packages one study type end to end. The model follows an operating-system driver
subsystem:

| OS idea | HOS implementation |
|---|---|
| subsystem core shared by all drivers | `StudyDriver` base class: strict CSV ingest, SHA-256 of raw files, unit conversion, simulation detection, simulation taint, interpretation citation check, report appendices and disclaimer |
| driver hooks | `design`, `plan`, `data_template`, `sample_manifest`, `validate_records`, `_analyze`, `_interpret`, `_report_sections`, optional `_simulate_rows` |
| sub-devices | `components`: for a multi-part requirement (the S7A core battery), the parts this driver's study covers; readiness needs every part |
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
post_data_inputs(params, data) -> {name: unit}     human selections made after the data (ABI 1.1)
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

### `toxicokinetics` v1.0.0 — ICH S3A, with ISR per ICH M10 section 5

- **Serves.** `tox.toxicokinetics`, CTD 4.2.3.2. M4S(R2) files "supportive toxicokinetics
  evaluations" with the repeat-dose study. GLP-capable.
- **Modalities.** Small molecules, peptides and monoclonal antibodies.
- **Research note.** `docs/research/drivers/toxicokinetics.md`.
- **Design.** Every value is a required input:
  - parent toxicity study, species and strain, route and administration (extravascular or IV
    infusion; IV bolus would need C0 back-extrapolation and is refused);
  - analyte and matrix, bioanalytical technique and the validation report;
  - LLOQ, dose groups, whether control samples are assayed (S3A Note 8), sexes (one sex needs a
    justification, S3A §3.5), animals and satellite groups;
  - dosing interval and profile days, monitor or profile design (S3A Note 1);
  - sampling times with their justification (S3A §3.3) — a profile starts at a time-0 pre-dose
    sample;
  - trapezoidal rule with its basis (M13A §2.2.2.2), and the declared BLQ rule;
  - optionally, the dose-proportionality acceptance interval θL/θH and confidence level with
    their basis.
- **Return data.** One row per sample:
  - animal, sex, dose, study day, nominal and actual time;
  - concentration or BLQ — a quantified value below the LLOQ is rejected, since the calibration
    range starts at the LLOQ (M10 §3.2.4);
  - an optional ISR repeat value.
- **Analysis.**
  - Per animal and day: Cmax, Tmax, Tlast, AUC(0-t) and AUC(0-τ).
  - Per dose × sex × day: mean (SD) and median (range), plus dose-normalised Cmax and AUC.
  - Power-model β1 with its confidence interval against the acceptance interval.
  - Observed ratios between profile days.
  - Exposure multiples over a stated human Cmax and AUC.
  - ISR against M10 §5.
  - Flags for quantifiable control or day-1 pre-dose samples (M10 §3.3.4 / §4.3.4).
- **Determinations.** Both are categorical and signed by the Study Director:
  - exposure adequacy (adequate / not adequate), required;
  - steady state by the last profile day (established / not established), optional.
- **Known-value tests.**
  - Linear trapezoid by hand.
  - Exact log-down integration of an exponential.
  - The published acceptance intervals of Braeckman 2022 and Shang 2022.
  - β1 and its standard error against `scipy.stats.linregress`.
  - Exact recovery of declared exposure, β1 and day ratios from a noise-free generator.

### `in_vivo_pk` v1.0.0 — single-dose pharmacokinetics (ICH M3(R2) section 3)

- **Serves.** `adme.in_vivo_pk`, due before Phase III (M3(R2) §3), CTD 4.2.2.2. GLP-capable.
- **Modalities.** Small molecules, peptides and monoclonal antibodies.
- **Research note.** `docs/research/drivers/in_vivo_pk.md`.
- **Design.** Required inputs:
  - species and strain;
  - analyte, matrix, bioanalytical method and LLOQ;
  - dose unit;
  - groups, each with administration (IV bolus, IV infusion with duration, or extravascular),
    route, dose, formulation, sex, animals and sampling times;
  - parallel or crossover design (crossover needs a washout justification);
  - the dose-time rule (zero for a drug-naive single dose, or a measured pre-dose sample);
  - the trapezoidal rule with its basis, the declared BLQ rule, and AUCinf from the observed Clast;
  - optionally, %extrapolated and adjusted-R² limits with their basis.
- **Return data.** One row per sample: animal, group, nominal and actual time, concentration or
  BLQ.
- **Analysis.**
  - Per profile: Cmax, Tmax, C0 (IV bolus) and AUC(0-t).
  - Every candidate terminal-phase fit, with the vendor best fit marked as a suggestion.
  - Once the scientist has entered `terminal_phase_start.<group>.<animal>` (ABI 1.1
    `post_data_inputs`; it must be user-supplied, and it is recorded under the scientist's
    name): λz, t½, AUCinf, %extrapolated, MRTinf, CL (CL/F), Vz (Vz/F) and Vss (IV only).
  - Group means, reported only when every profile has the value.
  - Absolute F from the dose-normalised group mean AUCinf.
- **QC flags.**
  - A terminal phase starting at or before Tmax after extravascular dosing.
  - Fits or extrapolation outside the stated limits.
  - Quantifiable pre-dose samples (M10 §3.3.4).
  - Profiles without a selection.
- **Determination.** "Terminal-phase selections appropriate" (accepted / not accepted), signed by
  the responsible scientist. The signature binds the analysis that includes every selection.
- **Known-value tests.**
  - A one-compartment IV bolus is recovered exactly: C0, t½, AUCinf, CL = kV, Vz = Vss = V.
  - A constructed oral profile gives the exact AUCinf, CL/F and F.
  - The exact log-trapezoid AUMC.
  - Adjusted R², the vendor best-fit rule, and C0 back-extrapolation.

### `plasma_protein_binding` v1.0.0 — equilibrium dialysis (ICH M3(R2) §3; ICH M12 §7.2)

- **Serves.** `adme.plasma_protein_binding`, CTD 4.2.2.3, for small molecules and peptides.
  Monoclonal antibodies are excluded because they cannot cross a dialysis membrane.
- **Research note.** `docs/research/drivers/plasma_protein_binding.md`.
- **Design.** Required inputs:
  - device and membrane MWCO (a design note appears if the analyte is not smaller than the
    MWCO);
  - matrix per species with anticoagulant, test concentrations, LLOQ;
  - incubation time, temperature, agitation and atmosphere, with the evidence that equilibrium
    is reached;
  - chamber volumes, buffer and replicates;
  - bioanalytical method;
  - positive controls, each with its qualified mean fu and qualification reference;
  - optionally, laboratory recovery and stability criteria with their basis.
- **Return data.** One row per dialysis cell: compound, species, nominal concentration,
  replicate, buffer concentration or BLQ, plasma concentration, and optional laboratory recovery
  and stability.
- **Analysis.**
  - fu per cell; mean (SD), CV and % bound per compound × species × concentration.
  - An upper bound when the buffer is BLQ.
  - The positive-control 3-fold check (FAIL outside it).
  - A warning when a species has no positive control.
  - The fu < 1% flag.
  - Laboratory recovery and stability against the stated criteria.
- **Determination.** Optional: reliability of fu < 1% demonstrated / not demonstrated
  (responsible scientist).
- **Known-value tests.**
  - Exact fu recovery from declared chamber concentrations.
  - The M12 3-fold boundary: exactly 3-fold passes; 3.1-fold fails in either direction.

### `ames` v1.0.0 — bacterial reverse mutation test (OECD TG 471; ICH S2(R1))

- **Serves.** `genotox.ames`, CTD 4.2.3.3.1, for small molecules and peptides. A peptide
  programme gets the S2(R1) §5.2.1 caveat.
- **Research note.** `docs/research/drivers/ames.md`.
- **Design.** Inputs are checked against the TG 471 paragraph cited in each error message:
  - strains;
  - S9 source and % v/v;
  - plate incorporation or preincubation;
  - concentrations and the top-dose basis;
  - plates per dose;
  - vehicle and untreated controls;
  - incubation conditions;
  - positive controls per strain × S9;
  - historical negative (and optional positive) control ranges per strain × S9, with range type
    and reference.
- **Return data.** One row per plate: experiment, strain, S9, treatment, concentration, plate,
  revertants, background lawn, precipitate.
- **Analysis.**
  - Mean (SD) per experiment × strain × S9 × treatment/concentration.
  - Fold over vehicle, for information.
  - Vehicle and positive means compared with the historical ranges.
  - Test means above the historical negative upper limit.
  - The analysable-concentration count.
  - Top-dose evidence (lawn reduction or precipitate, depending on the stated basis).
  - Missing controls (FAIL) and lost plates.
- **Determination.** Positive / negative / equivocal (Study Director), guided by TG 471 ¶35–37.
- **Known-value tests.**
  - Exact means and folds from declared expected counts.
  - Each TG 471 design rule refused with its paragraph.
  - Historical-range and top-dose flags.

### `dose_range_finding` v1.0.0 — dose range-finding / MTD (ICH M3(R2) §1.5, §4)

- **Serves.** `tox.dose_range_finding`, CTD 4.2.3.2.
- **Research note.** `docs/research/drivers/dose_range_finding.md`.
- **Design.** Required inputs:
  - species and strain, route and vehicle;
  - control (optional), dose levels, sexes, animals per sex, dosing days;
  - numeric endpoints and their timepoints;
  - the statistics choice with its basis;
  - the MTD criteria with their basis;
  - the exposure metric (AUC or Cmax) for margins.
- **Return data.** Long format:
  - numeric endpoint rows at protocol timepoints;
  - clinical-sign and mortality rows with the observation and the day observed.
- **Analysis.**
  - The group comparison shared with `repeat_dose_toxicity`. It was refactored into
    `repeat_dose_tox/analysis.py`, and the repeat-dose analysis and report hashes were checked
    byte-identical before and after.
  - Incidence and clinical-sign tables.
  - The exposure margin at the top dose when exposures are supplied.
  - The M3(R2) §1.5 statements.
- **Determinations.** All by the Study Director:
  - MTD (or not established);
  - basis for the pivotal high dose (MTD / limit dose / exposure saturation / MFD / 50-fold
    margin);
  - recommended high dose (required);
  - recommended mid and low doses (optional).
- **Known-value tests.**
  - % vs control equals the declared effect.
  - The table equals the shared function's output.
  - Incidence counts.
  - Each M3(R2) §1.5 statement triggered only by its conditions.

### `in_vitro_potency` v1.0.0 — potency and selectivity (ICH M3(R2) §2; S7A Note 2)

- **Serves.** `pharm.primary`, CTD 4.2.1.1. Not GLP (M3(R2) §2: primary PD is generally
  non-GLP).
- **Research note.** `docs/research/drivers/in_vitro_potency.md`.
- **Design.**
  - Concentration unit, and the curve-fit acceptance (R²) with its basis.
  - Assays, each with: target, primary or off-target role, format, species and conditions;
    readout (percent inhibition or activity); asymptotes fitted or fixed at 0/100;
    concentrations and replicates; and an optional reference compound with its acceptance
    range and basis.
- **Return data.** One row per well: assay, compound, concentration, replicate, response in
  percent.
- **Analysis.**
  - A 4PL fit per assay and compound.
  - The reference-compound check (FAIL outside its range).
  - The relative potency of the test article for each off-target against each primary assay,
    with its delta-method CI. It is given as a lower bound when the off-target is inactive in
    range, and is unavailable when a run failed its reference check.
- **Determinations.** None. Relevance at clinical exposure is listed as needing expert
  judgement.
- **Known-value tests.**
  - The Ritz Eq. 2 identity with the implemented 4PL (b = hill).
  - Exact IC50 and Hill slope recovery and the exact ratio.
  - The delta-method SE by hand.

### `safety_pharm_cns` v1.0.0 — CNS core battery (ICH S7A §2.7.1)

- **Serves.** `safety.core_battery`, part `cns`. CTD 4.2.1.3. GLP-capable.
- **Research note.** `docs/research/drivers/safety_pharm_cns.md`.
- **Design.** Required inputs:
  - species and strain, sexes, route, vehicle;
  - method (FOB, modified Irwin or other) and the laboratory procedure;
  - doses with their basis (S7A §2.4.1);
  - group size with its basis (S7A §2.3.3.1);
  - a positive control, or a justification for omitting it (S7A §2.3.3.1);
  - timepoints with their basis (S7A §2.3.1), including any baseline;
  - observations, each with an S7A domain, a scale (binary, ordinal or continuous), a normal
    score or a unit;
  - the statistics choice for continuous measures.
- **Return data.** One row per animal × observation × timepoint: group (vehicle / test /
  positive), dose, unit, result.
- **Analysis.**
  - Incidence of findings.
  - Continuous measures against vehicle.
  - The positive-control check (FAIL if no data).
  - Missing-animal warnings.
- **Determinations.** Both by the Study Director:
  - adverse CNS effect (no effect identified / effect identified, the same categories as an
    imported core-battery conclusion), required;
  - highest dose without an adverse effect, optional.
- **Known-value tests.**
  - Exact incidence from declared fractions, including a normal score of 1.
  - % vs vehicle for body temperature.
  - Refusal of a protocol missing an S7A domain.

## 8.4 Writing a new driver

1. Subclass `StudyDriver`. Set the identity and match-table attributes, and implement the hooks.
2. Declare every scientific design value as a required parameter. If a citable convention
   exists, put it in the documentation with its source, not in a default.
3. Register methods and citations in the core registries (`methods.py`, `citations.py`), each
   with a verified source, then run `python scripts/lock_registries.py`. The registries are
   append-only (`tests/core/test_registry_lock.py`). Provenance embeds each method and its
   citations, so their content is part of every analysis hash, and editing an entry would make
   signed studies fail re-verification. Correct a citation by adding a new key; change a method
   by bumping its version.
4. Pass `check_driver` and add known-value tests from the source.
5. Ship it in-tree (add to `BUILTIN_DRIVERS`) or as a package exposing an entry point in the
   `hos.drivers` group.
