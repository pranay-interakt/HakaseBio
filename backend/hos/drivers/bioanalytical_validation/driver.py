"""Bioanalytical method validation for chromatographic methods (ICH M10 section 3).

The laboratory returns every injection of the validation runs: calibration standards,
QCs, blanks, zero samples, blanks after the ULOQ, matrix-lot QCs, dilution QCs and
stability QCs. For each run the driver fits the calibration curve with the model and
weighting the laboratory's procedure fixes, rejects standards outside the M10 limits and
re-evaluates the curve once, judges run acceptance, and back-calculates every sample.
It then evaluates each validation element against the M10 criteria, citing the section.

The system reports whether each M10 criterion is met. Whether the method is validated is
the responsible scientist's determination, recorded with a signature.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core import units as U
from hos.core.bioanalysis import (
    M10_CHROMATOGRAPHIC as M10,
)
from hos.core.bioanalysis import (
    CalibrationFit,
    cv_percent,
    fit_calibration,
)
from hos.core.citations import cite
from hos.core.methods import method
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import Quantity
from hos.core.regulatory.context import Modality, ProgramContext
from hos.drivers.base import (
    AcceptanceCriterion,
    AnalysisResult,
    CompoundInfo,
    DataColumn,
    DataTemplate,
    ExpertDetermination,
    IngestedData,
    Interpretation,
    InterpretiveStatement,
    ProtocolDocument,
    ProtocolStep,
    ReportSection,
    StudyDriver,
    StudyPlan,
    tabulate,
)
from hos.kernel.attestation import Role

EXPERIMENTS = (
    "calibration",
    "accuracy_precision",
    "selectivity",
    "matrix_effect",
    "carryover",
    "dilution",
    "stability",
)
SAMPLE_TYPES = ("cal", "qc", "blank", "zero", "blank_after_uloq", "lloq")
QC_KEYS = ("LLOQ", "LQC", "MQC", "HQC")


class QCLevels(BaseModel):
    LLOQ: float = Field(gt=0)
    LQC: float = Field(gt=0)
    MQC: float = Field(gt=0)
    HQC: float = Field(gt=0)


class StabilityTest(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    kind: Literal["freeze_thaw", "bench_top", "long_term", "processed_sample"]
    condition: str = Field(min_length=1)
    duration: str = Field(min_length=1)
    cycles: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _cycles(self) -> StabilityTest:
        if self.kind == "freeze_thaw":
            need = int(M10["freeze_thaw_min_cycles"].value)
            if self.cycles is None or self.cycles < need:
                raise ValueError(
                    f"freeze-thaw stability needs at least {need} cycles (ICH M10 3.2.8)"
                )
        return self


class BioanalyticalValidationParams(BaseModel):
    glp: bool
    analyte: str = Field(min_length=1)
    internal_standard: str | None = Field(
        default=None, description="internal standard; omit only for a method without one"
    )
    matrix: str = Field(min_length=1, description="e.g. species, matrix and anticoagulant")
    species: str = Field(min_length=1)
    technique: str = Field(min_length=1)
    concentration_unit: str = Field(min_length=1)
    regression_model: Literal["linear", "quadratic"]
    weighting: Literal["none", "1/x", "1/x^2"]
    regression_basis: str = Field(min_length=1, description="written procedure fixing the model")
    calibration_levels: list[float]
    qc_levels: QCLevels
    accuracy_precision_runs: int
    accuracy_precision_replicates: int
    selectivity_sources: int
    rare_matrix_justification: str | None = None
    matrix_effect_sources: int
    matrix_effect_replicates: int
    dilution_factors: list[float] = Field(default_factory=list)
    dilution_replicates: int | None = None
    stability_tests: list[StabilityTest] = Field(default_factory=list)
    stability_replicates: int | None = None

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised concentration unit {v!r}")
        return v

    @field_validator("calibration_levels")
    @classmethod
    def _levels(cls, v: list[float]) -> list[float]:
        need = int(M10["cal_min_levels"].value)
        if len(v) < need:
            raise ValueError(
                f"at least {need} calibration levels including LLOQ and ULOQ (ICH M10 3.2.4)"
            )
        if any(c <= 0 for c in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("calibration levels must be positive and strictly increasing")
        return v

    @model_validator(mode="after")
    def _design(self) -> BioanalyticalValidationParams:
        lloq, uloq = self.calibration_levels[0], self.calibration_levels[-1]
        q = self.qc_levels
        errs = []
        if lloq != q.LLOQ:
            errs.append("the LLOQ QC must equal the lowest calibration standard (M10 3.2.4)")
        if not (lloq < q.LQC <= 3 * lloq):
            errs.append("the low QC must lie within three times the LLOQ (M10 3.2.5.1)")
        if 0.75 * uloq > q.HQC or uloq < q.HQC:
            errs.append("the high QC must be at least 75% of the ULOQ (M10 3.2.5.1)")
        if not (q.LQC < q.MQC < q.HQC):
            errs.append("QC levels must increase LLOQ < LQC < MQC < HQC")
        if self.accuracy_precision_runs < M10["ap_min_runs"].value:
            errs.append("accuracy and precision need at least 3 runs (M10 3.2.5.2)")
        if self.accuracy_precision_replicates < M10["ap_min_replicates"].value:
            errs.append(
                "accuracy and precision need at least 5 replicates per QC level per "
                "run (M10 3.2.5.2)"
            )
        rare = bool(self.rare_matrix_justification and self.rare_matrix_justification.strip())
        if self.selectivity_sources < M10["selectivity_min_sources"].value and not rare:
            errs.append(
                "selectivity needs at least 6 sources/lots unless the matrix is rare "
                "(state the justification) (M10 3.2.1)"
            )
        if self.matrix_effect_sources < M10["matrix_min_sources"].value and not rare:
            errs.append(
                "matrix effect needs at least 6 sources/lots unless the matrix is rare (M10 3.2.3)"
            )
        if self.matrix_effect_replicates < M10["matrix_min_replicates"].value:
            errs.append("matrix effect needs at least 3 replicates per QC per lot (M10 3.2.3)")
        if self.dilution_factors:
            if any(f <= 1 for f in self.dilution_factors):
                errs.append("dilution factors are greater than 1")
            if (self.dilution_replicates or 0) < M10["dilution_min_replicates"].value:
                errs.append("dilution integrity needs at least 5 replicates per factor (M10 3.2.7)")
        if self.stability_tests:
            if len({t.name for t in self.stability_tests}) != len(self.stability_tests):
                errs.append("stability test names must be unique")
            if (self.stability_replicates or 0) < M10["stability_min_aliquots"].value:
                errs.append("stability needs at least 3 aliquots per QC level (M10 3.2.8)")
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def mid_range_note(self) -> str | None:
        lloq, uloq = self.calibration_levels[0], self.calibration_levels[-1]
        lo, hi = lloq + 0.30 * (uloq - lloq), lloq + 0.50 * (uloq - lloq)
        if lo <= self.qc_levels.MQC <= hi:
            return None
        return (
            f"medium QC {self.qc_levels.MQC:g} is outside 30-50% of the calibration range "
            f"({lo:g}-{hi:g} {self.concentration_unit}); M10 3.2.5.1 places it 'around' "
            "that range"
        )


class BioanalyticalSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    slope: float = Field(gt=0, description="response ratio per unit concentration")
    intercept: float
    is_response: float = Field(gt=0)
    response_cv: float = Field(ge=0, lt=1)
    blank_fraction_of_lloq: float = Field(ge=0, description="blank analyte response / LLOQ")
    blank_is_fraction: float = Field(
        ge=0, description="IS-channel response in blanks (no IS added) / IS response"
    )
    carryover_fraction_of_lloq: float = Field(ge=0)
    matrix_lot_cv: float = Field(ge=0, lt=1)
    dilution_bias_percent: float
    stability_loss_percent: dict[str, float]


def _p(params: BaseModel) -> BioanalyticalValidationParams:
    if not isinstance(params, BioanalyticalValidationParams):
        raise TypeError("expected BioanalyticalValidationParams")
    return params


def _cal_level(p: BioanalyticalValidationParams, i: int) -> str:
    return f"CAL{i + 1}"


class BioanalyticalValidationDriver(StudyDriver):
    id = "bioanalytical_validation"
    name = "Bioanalytical method validation (chromatographic, ICH M10)"
    version = "1.0.0"
    requirement_ids = ("bioanalytical.validation",)
    modalities = frozenset(
        {
            Modality.SMALL_MOLECULE,
            Modality.PEPTIDE,
            Modality.OLIGONUCLEOTIDE,
            Modality.ANTIBODY_DRUG_CONJUGATE,
        }
    )
    ctd_section = "4.2.2.1"
    glp_capable = True
    description = (
        "Full validation of a chromatographic bioanalytical method against ICH M10 "
        "section 3: calibration, accuracy and precision, selectivity, matrix effect, "
        "carry-over, dilution integrity and stability."
    )
    reference_keys = ("ich_m10",)

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return BioanalyticalValidationParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return BioanalyticalSimulation

    def prefill_from_requirement(self, requirement: Any) -> dict[str, Any]:
        return {"glp": requirement.glp}

    # -- design ----------------------------------------------------------------------

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        u = p.concentration_unit
        q = p.qc_levels
        notes = [n for n in (p.mid_range_note(),) if n]
        if p.rare_matrix_justification:
            notes.append(f"rare matrix: {p.rare_matrix_justification}")
        covered = {t.kind for t in p.stability_tests}
        missing_stab = [
            k
            for k in ("freeze_thaw", "bench_top", "long_term", "processed_sample")
            if k not in covered
        ]
        if missing_stab:
            notes.append(
                "stability elements not in this protocol (M10 3.2.8): " + ", ".join(missing_stab)
            )
        design: dict[str, Any] = {
            "analyte": p.analyte,
            "internal_standard": p.internal_standard or "none",
            "matrix": p.matrix,
            "species": p.species,
            "technique": p.technique,
            "calibration": f"{len(p.calibration_levels)} levels "
            f"{', '.join(f'{c:g}' for c in p.calibration_levels)} {u}",
            "regression": f"{p.regression_model}, weighting {p.weighting} ({p.regression_basis})",
            "QCs": f"LLOQ {q.LLOQ:g}, LQC {q.LQC:g}, MQC {q.MQC:g}, HQC {q.HQC:g} {u}",
            "accuracy_precision": f"{p.accuracy_precision_runs} runs x "
            f"{p.accuracy_precision_replicates} replicates per level",
            "selectivity": f"{p.selectivity_sources} sources/lots",
            "matrix_effect": f"{p.matrix_effect_sources} lots x {p.matrix_effect_replicates} "
            "replicates at LQC and HQC",
            "dilution": (
                ", ".join(f"{f:g}x" for f in p.dilution_factors)
                + f" ({p.dilution_replicates} replicates)"
            )
            if p.dilution_factors
            else "not evaluated",
            "stability": [
                f"{t.name} ({t.kind}): {t.condition}, {t.duration}"
                + (f", {t.cycles} cycles" if t.cycles else "")
                for t in p.stability_tests
            ]
            or "not evaluated",
        }
        if notes:
            design["design_notes"] = notes
        criteria = tuple(
            AcceptanceCriterion(f"m10.{c.key}", c.statement, f"ich_m10 section {c.section}")
            for c in M10.values()
            if not c.key.startswith("isr")
        )
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Validation of an {p.technique} method for {p.analyte} in {p.matrix}",
            objective="Demonstrate that the method is suitable for the analysis of study "
            "samples per ICH M10 section 3 (chromatography).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id, "analyte": p.analyte},
            test_system={"matrix": p.matrix, "species": p.species},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Reference standards and stock solutions",
                    "Use characterised reference standards; prepare calibration "
                    "standards and QCs from separate stock solutions (M10 3.1, 3.2.5.1).",
                    ("certificate of analysis on file",),
                ),
                ProtocolStep(
                    2,
                    "Calibration",
                    "Every analytical run contains a blank, a zero "
                    f"sample and the {len(p.calibration_levels)} calibration levels; "
                    "blank and zero samples are not used in the regression (M10 "
                    "3.2.4).",
                    ("freshly spiked standards in at least one run",),
                ),
                ProtocolStep(
                    3,
                    "Accuracy and precision",
                    f"{p.accuracy_precision_runs} runs over at least two days, "
                    f"{p.accuracy_precision_replicates} replicates of each QC level "
                    "per run (M10 3.2.5.2).",
                    (),
                ),
                ProtocolStep(
                    4,
                    "Selectivity and matrix effect",
                    f"Blanks from {p.selectivity_sources} individual sources with LLOQ "
                    f"samples; LQC and HQC in {p.matrix_effect_sources} lots "
                    "(M10 3.2.1, 3.2.3).",
                    (),
                ),
                ProtocolStep(
                    5,
                    "Carry-over",
                    "Blank samples injected after the ULOQ standard (M10 3.2.6).",
                    (),
                ),
                ProtocolStep(
                    6,
                    "Dilution integrity and stability",
                    "Dilution QCs above the ULOQ diluted with blank matrix; stability "
                    "QCs at low and high level against fresh calibration standards "
                    "(M10 3.2.7, 3.2.8).",
                    (),
                ),
                ProtocolStep(
                    7,
                    "Return data",
                    "Every injection, one row each, per "
                    "data_template.csv; record each sample's run.",
                    (),
                ),
            ),
            acceptance_criteria=criteria,
            materials=(
                f"reference standard {p.analyte}",
                f"internal standard {p.internal_standard}"
                if p.internal_standard
                else "no internal standard",
                f"blank {p.matrix}: at least {max(p.selectivity_sources, p.matrix_effect_sources)} "
                "individual sources",
            ),
            deliverables=("data CSV per template", "bioanalytical method validation report"),
            glp=p.glp,
            references=(cite("ich_m10"),),
            regulatory_basis=("ICH M10 section 3 (chromatography)",),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        return StudyPlan(
            execution_duration_days=None,
            duration_basis="set by the laboratory; long-term stability runs for the stated "
            "storage period",
            sample_count=self._expected_injections(p),
            sample_count_basis="calibration standards, QCs, blanks and validation samples "
            "implied by the design (minimum)",
            dependencies=("characterised reference standard of the analyte",),
            material_requirements=tuple(protocol.materials),
        )

    def _expected_injections(self, p: BioanalyticalValidationParams) -> int:
        per_curve = len(p.calibration_levels) + 2
        n = p.accuracy_precision_runs * (per_curve + 4 * p.accuracy_precision_replicates)
        n += per_curve + 2 * p.selectivity_sources
        n += per_curve + 2 * p.matrix_effect_sources * p.matrix_effect_replicates
        n += len(p.dilution_factors) * (p.dilution_replicates or 0)
        n += len(p.stability_tests) * 2 * (p.stability_replicates or 0)
        return n

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        rows: list[dict[str, Any]] = [
            {
                "experiment": "calibration",
                "level": _cal_level(p, i),
                "nominal": f"{c:g}",
                "unit": p.concentration_unit,
                "note": "in every analytical run",
            }
            for i, c in enumerate(p.calibration_levels)
        ]
        for k in QC_KEYS:
            rows.append(
                {
                    "experiment": "accuracy_precision",
                    "level": k,
                    "nominal": f"{getattr(p.qc_levels, k):g}",
                    "unit": p.concentration_unit,
                    "note": f"{p.accuracy_precision_replicates} replicates x "
                    f"{p.accuracy_precision_runs} runs",
                }
            )
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        levels = (
            [_cal_level(p, i) for i in range(len(p.calibration_levels))]
            + list(QC_KEYS)
            + ["DQC", "BLANK", "ZERO"]
        )
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per injection. Every run carries its own calibration curve: "
            "its standards, blank and zero sample use experiment=calibration. "
            "Responses are peak areas (or heights) as integrated.",
            columns=(
                DataColumn("run_id", "analytical run identifier", kind="text"),
                DataColumn("experiment", "validation element", kind="text", choices=EXPERIMENTS),
                DataColumn(
                    "sample_type",
                    "cal, qc, blank, zero, blank_after_uloq or lloq",
                    kind="text",
                    choices=SAMPLE_TYPES,
                ),
                DataColumn(
                    "level",
                    "calibration level (CAL1..), QC level, DQC, BLANK or ZERO",
                    kind="text",
                    choices=tuple(levels),
                ),
                DataColumn(
                    "nominal_concentration",
                    "nominal concentration (empty for blanks)",
                    unit=p.concentration_unit,
                    required=False,
                    minimum=0,
                ),
                DataColumn(
                    "analyte_response", "analyte peak response", unit="dimensionless", minimum=0
                ),
                DataColumn(
                    "is_response",
                    "internal standard peak response",
                    unit="dimensionless",
                    required=False,
                    minimum=0,
                ),
                DataColumn(
                    "source_lot",
                    "matrix source/lot (selectivity, matrix effect)",
                    kind="text",
                    required=False,
                ),
                DataColumn(
                    "dilution_factor",
                    "dilution factor applied",
                    unit="dimensionless",
                    required=False,
                    minimum=1,
                ),
                DataColumn(
                    "stability_test",
                    "stability test name from the protocol",
                    kind="text",
                    required=False,
                ),
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        warnings: list[str] = []
        cal_nominal = {_cal_level(p, i): c for i, c in enumerate(p.calibration_levels)}
        qc_nominal = p.qc_levels.model_dump()
        tests = {t.name for t in p.stability_tests}
        runs_with_cal = {r["run_id"] for r in records if r["sample_type"] == "cal"}
        for i, r in enumerate(records, start=1):
            st, lvl, nom = r["sample_type"], r["level"], r.get("nominal_concentration")
            if p.internal_standard and st not in ("blank",) and r.get("is_response") is None:
                errors.append(f"row {i}: is_response is required (method uses an IS)")
            if st == "cal" and (
                lvl not in cal_nominal
                or nom is None
                or abs(nom - cal_nominal[lvl]) > 1e-9 * max(1, nom)
            ):
                errors.append(
                    f"row {i}: calibration standard {lvl} nominal does not match the protocol"
                )
            if st in ("qc", "lloq"):
                if lvl in qc_nominal:
                    if nom is None or abs(nom - qc_nominal[lvl]) > 1e-9 * max(1, nom):
                        errors.append(f"row {i}: {lvl} nominal does not match the protocol")
                elif lvl == "DQC":
                    if nom is None or r.get("dilution_factor") is None:
                        errors.append(f"row {i}: a dilution QC needs nominal and dilution_factor")
                    elif r["dilution_factor"] not in p.dilution_factors:
                        errors.append(
                            f"row {i}: dilution factor {r['dilution_factor']:g} is not "
                            "in the protocol"
                        )
                else:
                    errors.append(f"row {i}: level {lvl} is not a QC level")
            if st in ("blank", "zero", "blank_after_uloq") and nom not in (None, 0):
                errors.append(f"row {i}: a {st} sample has no nominal concentration")
            if (
                r["experiment"] in ("selectivity", "matrix_effect")
                and st in ("blank", "qc")
                and not r.get("source_lot")
            ):
                errors.append(f"row {i}: {r['experiment']} samples need their source_lot")
            if (
                r["experiment"] == "stability"
                and st == "qc"
                and r.get("stability_test") not in tests
            ):
                errors.append(
                    f"row {i}: stability_test must name a protocol test ({sorted(tests)})"
                )
            if r["run_id"] not in runs_with_cal and st != "cal":
                errors.append(f"row {i}: run {r['run_id']} has no calibration standards")
        return errors, warnings

    # -- analysis ------------------------------------------------------------------------

    def _ratio(self, r: Mapping[str, Any]) -> float:
        a = float(r["analyte_response"])
        is_ = r.get("is_response")
        return a / float(is_) if is_ else a

    def _fit_run(
        self, p: BioanalyticalValidationParams, rows: list[Mapping[str, Any]]
    ) -> dict[str, Any]:
        cal = [r for r in rows if r["sample_type"] == "cal"]
        lloq, uloq = p.calibration_levels[0], p.calibration_levels[-1]

        def limits(nominal: float) -> float:
            return M10["cal_accuracy_lloq"].value if nominal == lloq else M10["cal_accuracy"].value

        def evaluate(fit: CalibrationFit) -> list[dict[str, Any]]:
            out = []
            for r in cal:
                nom = float(r["nominal_concentration"])
                bc = fit.back_calculate(self._ratio(r))
                dev = None if bc is None else 100.0 * (bc - nom) / nom
                out.append(
                    {
                        "level": r["level"],
                        "nominal": nom,
                        "back_calc": bc,
                        "deviation": dev,
                        "pass": dev is not None and abs(dev) <= limits(nom),
                    }
                )
            return out

        fit = fit_calibration(
            [float(r["nominal_concentration"]) for r in cal],
            [self._ratio(r) for r in cal],
            model=p.regression_model,
            weighting=p.weighting,
        )
        first = evaluate(fit)
        rejected = [i for i, e in enumerate(first) if not e["pass"]]
        if rejected:  # M10 3.2.4: reject and re-evaluate the curve without them
            keep = [r for i, r in enumerate(cal) if i not in rejected]
            fit = fit_calibration(
                [float(r["nominal_concentration"]) for r in keep],
                [self._ratio(r) for r in keep],
                model=p.regression_model,
                weighting=p.weighting,
            )
        final = evaluate(fit)
        for i in rejected:
            final[i] = {**final[i], "pass": False, "rejected": True}
        passing = [e for e in final if e["pass"]]
        frac = 100.0 * len(passing) / len(final) if final else 0.0
        levels_ok = len({e["level"] for e in passing})
        lloq_ok = any(e["pass"] and e["nominal"] == lloq for e in final)
        uloq_ok = any(e["pass"] and e["nominal"] == uloq for e in final)
        # M10 3.2.4: with replicate standards, at least 50% per level must meet the criteria
        by_level: dict[str, list[bool]] = defaultdict(list)
        for e in final:
            by_level[e["level"]].append(bool(e["pass"]))
        replicate_ok = all(sum(v) / len(v) >= 0.5 for v in by_level.values() if len(v) > 1)
        # M10 3.2.4: for accuracy and precision runs, losing every LLOQ or ULOQ standard
        # rejects the run
        ap_run = any(r["experiment"] == "accuracy_precision" for r in rows)
        accepted = (
            frac >= M10["cal_fraction_passing"].value
            and levels_ok >= M10["cal_min_levels"].value
            and replicate_ok
            and (not ap_run or (lloq_ok and uloq_ok))
        )
        return {
            "fit": fit,
            "standards": final,
            "fraction_passing": frac,
            "levels_passing": levels_ok,
            "accepted": accepted,
            "lloq_ok": lloq_ok,
            "uloq_ok": uloq_ok,
            "replicate_ok": replicate_ok,
        }

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        u = p.concentration_unit
        m_cal, m_bc = method("bioanalysis.calibration"), method("bioanalysis.back_calculation")
        m_ap, m_int = method("bioanalysis.accuracy_precision"), method("bioanalysis.interference")
        lloq = p.calibration_levels[0]
        runs: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
        for r in data.records:
            runs[str(r["run_id"])].append(r)
        fits = {rid: self._fit_run(p, rows) for rid, rows in runs.items()}
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        tables = []

        def pct(v: float, label: str, m: Any = m_ap, unc: Uncertainty | None = None) -> Quantity:
            return Quantity.computed(v, "percent", method=m, label=label, uncertainty=unc)

        def fail(code: str, msg: str, section: str) -> None:
            findings.append(QCFinding(code, QCStatus.FAIL, f"{msg} (ICH M10 {section})"))

        # calibration per run
        cal_rows = []
        for rid, f in sorted(fits.items()):
            c = f["fit"].coefficients
            cal_rows.append(
                (
                    rid,
                    Quantity.computed(c[1], f"1/({u})", method=m_cal, label=f"slope run {rid}"),
                    Quantity.computed(
                        c[0], "dimensionless", method=m_cal, label=f"intercept run {rid}"
                    ),
                    f"{sum(e['pass'] for e in f['standards'])}/{len(f['standards'])}",
                    "accepted" if f["accepted"] else "REJECTED",
                )
            )
            if not f["accepted"]:
                fail(
                    f"run.{rid}.calibration",
                    f"run {rid}: calibration does not meet M10 (fraction passing "
                    f"{f['fraction_passing']:.0f}%, levels {f['levels_passing']}, LLOQ "
                    f"{'ok' if f['lloq_ok'] else 'rejected'}, ULOQ "
                    f"{'ok' if f['uloq_ok'] else 'rejected'}); run rejected",
                    "3.2.4",
                )
        tables.append(
            tabulate(
                "Calibration by run",
                ("run", "slope", "intercept", "standards within limits", "run"),
                cal_rows,
                note=f"{p.regression_model} regression, weighting {p.weighting} "
                f"({p.regression_basis})",
            )
        )
        accepted_runs = {rid for rid, f in fits.items() if f["accepted"]}

        def back_calc(r: Mapping[str, Any]) -> float | None:
            f = fits[str(r["run_id"])]
            bc: float | None = f["fit"].back_calculate(self._ratio(r))
            return bc

        # accuracy and precision
        ap = [
            r
            for r in data.records
            if r["experiment"] == "accuracy_precision"
            and r["sample_type"] in ("qc", "lloq")
            and r["level"] in QC_KEYS
        ]
        ap_runs = sorted({str(r["run_id"]) for r in ap} & accepted_runs)
        if len(ap_runs) < M10["ap_min_runs"].value:
            fail(
                "ap.runs",
                f"{len(ap_runs)} accepted accuracy/precision runs; at least "
                f"{M10['ap_min_runs'].value:g} required",
                "3.2.5.2",
            )
        ap_rows = []
        for lvl in QC_KEYS:
            nom = getattr(p.qc_levels, lvl)
            acc_lim = M10["qc_accuracy_lloq" if lvl == "LLOQ" else "qc_accuracy"].value
            cv_lim = M10["qc_cv_lloq" if lvl == "LLOQ" else "qc_cv"].value
            pooled: list[float] = []
            for rid in ap_runs:
                vals = [
                    bc
                    for r in ap
                    if str(r["run_id"]) == rid
                    and r["level"] == lvl
                    and (bc := back_calc(r)) is not None
                ]
                if len(vals) < M10["ap_min_replicates"].value:
                    fail(
                        f"ap.{rid}.{lvl}.n",
                        f"run {rid} {lvl}: {len(vals)} replicates; at least "
                        f"{M10['ap_min_replicates'].value:g} required",
                        "3.2.5.2",
                    )
                if not vals:
                    continue
                pooled += vals
                acc = 100.0 * float(np.mean(vals)) / nom
                cv = cv_percent(vals)
                ap_rows.append(
                    (
                        lvl,
                        rid,
                        len(vals),
                        pct(acc, f"{lvl} run {rid} accuracy"),
                        pct(cv, f"{lvl} run {rid} CV") if cv is not None else None,
                    )
                )
                if abs(acc - 100) > acc_lim or (cv is not None and cv > cv_lim):
                    fail(
                        f"ap.{rid}.{lvl}",
                        f"run {rid} {lvl}: within-run accuracy {acc:.1f}% / "
                        f"CV {cv if cv is not None else float('nan'):.1f}% outside ±{acc_lim:g}% "
                        f"/ {cv_lim:g}%",
                        "3.2.5.2",
                    )
            if pooled:
                acc = 100.0 * float(np.mean(pooled)) / nom
                cv = cv_percent(pooled)
                qa = pct(acc, f"{lvl} between-run accuracy")
                q[f"ap.{lvl}.between_run_accuracy"] = qa
                if cv is not None:
                    q[f"ap.{lvl}.between_run_cv"] = pct(cv, f"{lvl} between-run CV")
                ap_rows.append((lvl, "all", len(pooled), qa, q.get(f"ap.{lvl}.between_run_cv")))
                if abs(acc - 100) > acc_lim or (cv is not None and cv > cv_lim):
                    fail(
                        f"ap.{lvl}",
                        f"{lvl}: between-run accuracy {acc:.1f}% / CV "
                        f"{cv if cv is not None else float('nan'):.1f}% outside ±{acc_lim:g}% / "
                        f"{cv_lim:g}%",
                        "3.2.5.2",
                    )
        tables.append(
            tabulate(
                "Accuracy and precision",
                ("level", "run", "n", "accuracy (% nominal)", "CV"),
                ap_rows,
            )
        )

        def lloq_ref(rid: str, field: str) -> float | None:
            rows = [
                r
                for r in runs[rid]
                if (r["sample_type"] == "lloq")
                or (r["sample_type"] == "cal" and r["nominal_concentration"] == lloq)
            ]
            vals = [float(r[field]) for r in rows if r.get(field) is not None]
            return float(np.mean(vals)) if vals else None

        def interference_rows(
            experiment: str, sample_type: str, label: str, a_key: str, i_key: str, section: str
        ) -> None:
            rows_out = []
            blanks = [
                r
                for r in data.records
                if r["experiment"] == experiment and r["sample_type"] == sample_type
            ]
            for r in blanks:
                rid = str(r["run_id"])
                ref_a, ref_i = lloq_ref(rid, "analyte_response"), lloq_ref(rid, "is_response")
                if not ref_a:
                    fail(
                        f"{experiment}.{rid}.ref", f"run {rid}: no LLOQ reference response", section
                    )
                    continue
                pa = 100.0 * float(r["analyte_response"]) / ref_a
                pi = (
                    100.0 * float(r["is_response"]) / ref_i
                    if ref_i and r.get("is_response") is not None
                    else None
                )
                if p.internal_standard and pi is None:
                    fail(
                        f"{experiment}.{r.get('source_lot') or rid}.is",
                        f"{label}: IS-channel response not reported, so IS interference "
                        "cannot be assessed",
                        section,
                    )
                tag = r.get("source_lot") or rid
                rows_out.append(
                    (
                        tag,
                        pct(pa, f"{label} {tag} analyte % of LLOQ", m_int),
                        pct(pi, f"{label} {tag} IS % of LLOQ IS", m_int)
                        if pi is not None
                        else None,
                    )
                )
                if pa > M10[a_key].value or (pi is not None and pi > M10[i_key].value):
                    fail(
                        f"{experiment}.{tag}",
                        f"{label} {tag}: {pa:.1f}% of LLOQ analyte"
                        + (f", {pi:.1f}% of IS" if pi is not None else "")
                        + f" exceeds {M10[a_key].value:g}% / {M10[i_key].value:g}%",
                        section,
                    )
            if rows_out:
                tables.append(
                    tabulate(label, ("source", "analyte % of LLOQ", "IS % of LLOQ"), rows_out)
                )

        interference_rows(
            "selectivity",
            "blank",
            "Selectivity (blank matrix)",
            "interference_analyte",
            "interference_is",
            "3.2.1",
        )
        sel_lots = {
            r.get("source_lot")
            for r in data.records
            if r["experiment"] == "selectivity" and r["sample_type"] == "blank"
        }
        if len(sel_lots) < min(p.selectivity_sources, M10["selectivity_min_sources"].value):
            fail(
                "selectivity.sources",
                f"{len(sel_lots)} blank sources returned; protocol states {p.selectivity_sources}",
                "3.2.1",
            )
        interference_rows(
            "carryover",
            "blank_after_uloq",
            "Carry-over (blank after ULOQ)",
            "carryover_analyte",
            "carryover_is",
            "3.2.6",
        )

        # matrix effect
        me_rows = []
        for (lot, lvl), vals in sorted(
            self._group(
                [
                    r
                    for r in data.records
                    if r["experiment"] == "matrix_effect"
                    and r["sample_type"] == "qc"
                    and str(r["run_id"]) in accepted_runs
                ],
                lambda r: (r.get("source_lot"), r["level"]),
                back_calc,
            ).items()
        ):
            nom = getattr(p.qc_levels, lvl)
            acc = 100.0 * float(np.mean(vals)) / nom
            cv = cv_percent(vals)
            me_rows.append(
                (
                    lot,
                    lvl,
                    len(vals),
                    pct(acc, f"matrix {lot} {lvl} accuracy"),
                    pct(cv, f"matrix {lot} {lvl} CV") if cv is not None else None,
                )
            )
            if (
                len(vals) < M10["matrix_min_replicates"].value
                or abs(acc - 100) > M10["matrix_accuracy"].value
                or (cv is not None and cv > M10["matrix_cv"].value)
            ):
                fail(
                    f"matrix.{lot}.{lvl}",
                    f"matrix lot {lot} {lvl}: n={len(vals)}, accuracy "
                    f"{acc:.1f}%, CV {cv if cv is not None else float('nan'):.1f}%",
                    "3.2.3",
                )
        if me_rows:
            tables.append(
                tabulate("Matrix effect", ("lot", "level", "n", "accuracy", "CV"), me_rows)
            )

        # dilution
        dil_rows = []
        for factor, rows in sorted(
            self._rows_by(
                [
                    r
                    for r in data.records
                    if r["experiment"] == "dilution"
                    and r["level"] == "DQC"
                    and str(r["run_id"]) in accepted_runs
                ],
                lambda r: float(r["dilution_factor"]),
            ).items()
        ):
            vals, noms = [], []
            for r in rows:
                bc = back_calc(r)
                if bc is not None:
                    vals.append(bc * factor)
                    noms.append(float(r["nominal_concentration"]))
            if not vals:
                continue
            acc = 100.0 * float(np.mean([v / n for v, n in zip(vals, noms, strict=True)]))
            cv = cv_percent(vals)
            dil_rows.append(
                (
                    f"{factor:g}x",
                    len(vals),
                    pct(acc, f"dilution {factor:g}x accuracy"),
                    pct(cv, f"dilution {factor:g}x CV") if cv is not None else None,
                )
            )
            if (
                len(vals) < M10["dilution_min_replicates"].value
                or abs(acc - 100) > M10["dilution_accuracy"].value
                or (cv is not None and cv > M10["dilution_cv"].value)
            ):
                fail(
                    f"dilution.{factor:g}",
                    f"dilution {factor:g}x: n={len(vals)}, accuracy "
                    f"{acc:.1f}%, CV {cv if cv is not None else float('nan'):.1f}%",
                    "3.2.7",
                )
        if dil_rows:
            tables.append(
                tabulate("Dilution integrity", ("factor", "n", "accuracy", "CV"), dil_rows)
            )

        # stability
        stab_rows = []
        for (test, lvl), vals in sorted(
            self._group(
                [
                    r
                    for r in data.records
                    if r["experiment"] == "stability"
                    and r["sample_type"] == "qc"
                    and str(r["run_id"]) in accepted_runs
                ],
                lambda r: (r.get("stability_test"), r["level"]),
                back_calc,
            ).items()
        ):
            nom = getattr(p.qc_levels, lvl)
            acc = 100.0 * float(np.mean(vals)) / nom
            qa = pct(acc, f"stability {test} {lvl} mean % of nominal")
            q[f"stability.{test}.{lvl}"] = qa
            stab_rows.append((test, lvl, len(vals), qa))
            if (
                len(vals) < M10["stability_min_aliquots"].value
                or abs(acc - 100) > M10["stability_accuracy"].value
            ):
                fail(
                    f"stability.{test}.{lvl}",
                    f"stability {test} {lvl}: n={len(vals)}, mean {acc:.1f}% of nominal",
                    "3.2.8",
                )
        if stab_rows:
            tables.append(
                tabulate("Stability", ("test", "level", "n", "mean % of nominal"), stab_rows)
            )
        for t in p.stability_tests:
            if not any(r[0] == t.name for r in stab_rows):
                fail(
                    f"stability.{t.name}.missing",
                    f"no accepted data for stability test {t.name}",
                    "3.2.8",
                )
        q["runs.accepted"] = Quantity.computed(
            float(len(accepted_runs)),
            "dimensionless",
            method=m_cal,
            label="accepted analytical runs",
        )
        _ = m_bc
        return AnalysisResult(
            quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings), evidence_admissible=True
        )

    @staticmethod
    def _rows_by(rows: list[Mapping[str, Any]], key: Any) -> dict[Any, list[Mapping[str, Any]]]:
        out: dict[Any, list[Mapping[str, Any]]] = defaultdict(list)
        for r in rows:
            out[key(r)].append(r)
        return out

    def _group(
        self, rows: list[Mapping[str, Any]], key: Any, back_calc: Any
    ) -> dict[Any, list[float]]:
        out: dict[Any, list[float]] = defaultdict(list)
        for r in rows:
            bc = back_calc(r)
            if bc is not None:
                out[key(r)].append(bc)
        return out

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        fails = [f for f in analysis.qc.findings if f.status is QCStatus.FAIL]
        out = []
        if not fails:
            out.append(
                InterpretiveStatement(
                    "Every evaluated validation element meets its ICH M10 section 3 acceptance "
                    "criterion.",
                    "ICH M10 sections 3.2.1-3.2.8",
                    ("ich_m10",),
                    "info",
                )
            )
        for f in fails:
            out.append(
                InterpretiveStatement(
                    f.message, "ICH M10 acceptance criterion", ("ich_m10",), "concern"
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Whether the method is validated for use with study samples, considering any "
                "unmet criteria, elements not evaluated, and partial-validation needs",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "method_validated",
                "Method validation conclusion",
                None,
                Role.RESPONSIBLE_SCIENTIST,
                True,
                "Conclude whether the method is validated for analysing study samples "
                "(ICH M10 section 3); the system reports each criterion, it does not decide.",
                choices=("validated", "not_validated"),
            ),
        )

    # -- report ------------------------------------------------------------------------

    def _report_sections(
        self,
        protocol: ProtocolDocument,
        data: IngestedData,
        analysis: AnalysisResult,
        interpretation: Interpretation,
        determinations: Sequence[Mapping[str, Any]],
    ) -> list[ReportSection]:
        det = next((d for d in determinations if d["key"] == "method_validated"), None)
        concl = (
            f"Conclusion by {det['signer_name']} ({det['role']}): {det['category']}. "
            f"Rationale: {det['rationale']}"
            if det
            else "Validation conclusion not yet recorded by the responsible scientist."
        )
        n_fail = sum(f.status is QCStatus.FAIL for f in analysis.qc.findings)
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + f"{n_fail} ICH M10 criteria not met. {concl}",
            ),
            ReportSection(
                "Method and design",
                "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items()),
            ),
            ReportSection("Results", "Per ICH M10 section 3.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, BioanalyticalSimulation)
        has_is = bool(p.internal_standard)
        lloq = p.calibration_levels[0]
        lloq_ratio = s.intercept + s.slope * lloq

        def noise() -> float:
            return float(np.exp(rng.normal(0.0, s.response_cv))) if s.response_cv else 1.0

        def inj(
            run: str,
            exp: str,
            st: str,
            lvl: str,
            conc: float | None,
            factor: float = 1.0,
            lot: str | None = None,
            lot_factor: float = 1.0,
            test: str | None = None,
            loss: float = 0.0,
        ) -> dict[str, Any]:
            is_r = s.is_response * noise() if has_is else None
            if has_is and st in ("blank", "blank_after_uloq"):  # M10: no IS added to blanks
                is_r = s.blank_is_fraction * s.is_response * noise()
            if conc is None:
                ratio = 0.0
            else:
                eff = conc / factor * (1 - loss / 100.0)
                ratio = (s.intercept + s.slope * eff) * noise() * lot_factor
            area = max(ratio * (is_r if is_r else 1.0), 0.0)
            return {
                "run_id": run,
                "experiment": exp,
                "sample_type": st,
                "level": lvl,
                "nominal_concentration": conc,
                "analyte_response": area,
                "is_response": is_r,
                "source_lot": lot,
                "dilution_factor": factor if lvl == "DQC" else None,
                "stability_test": test,
            }

        def curve(run: str) -> list[dict[str, Any]]:
            rows = [
                inj(run, "calibration", "cal", _cal_level(p, i), c)
                for i, c in enumerate(p.calibration_levels)
            ]
            rows.append(inj(run, "calibration", "blank", "BLANK", None))
            rows.append(inj(run, "calibration", "zero", "ZERO", None))
            return rows

        rows: list[dict[str, Any]] = []
        for k in range(p.accuracy_precision_runs):
            run = f"AP{k + 1}"
            rows += curve(run)
            for lvl in QC_KEYS:
                for _ in range(p.accuracy_precision_replicates):
                    rows.append(
                        inj(
                            run,
                            "accuracy_precision",
                            "lloq" if lvl == "LLOQ" else "qc",
                            lvl,
                            getattr(p.qc_levels, lvl),
                        )
                    )
        rows.append(
            {
                **inj("AP1", "carryover", "blank_after_uloq", "BLANK", None),
                "analyte_response": s.carryover_fraction_of_lloq
                * lloq_ratio
                * (s.is_response if has_is else 1.0),
            }
        )
        rows += curve("SEL")
        for j in range(p.selectivity_sources):
            lot = f"LOT{j + 1}"
            blank = inj("SEL", "selectivity", "blank", "BLANK", None, lot=lot)
            blank["analyte_response"] = (
                s.blank_fraction_of_lloq * lloq_ratio * (s.is_response if has_is else 1.0) * noise()
            )
            rows.append(blank)
            rows.append(inj("SEL", "selectivity", "lloq", "LLOQ", p.qc_levels.LLOQ, lot=lot))
        rows += curve("ME")
        for j in range(p.matrix_effect_sources):
            lf = float(np.exp(rng.normal(0.0, s.matrix_lot_cv))) if s.matrix_lot_cv else 1.0
            for lvl in ("LQC", "HQC"):
                for _ in range(p.matrix_effect_replicates):
                    rows.append(
                        inj(
                            "ME",
                            "matrix_effect",
                            "qc",
                            lvl,
                            getattr(p.qc_levels, lvl),
                            lot=f"LOT{j + 1}",
                            lot_factor=lf,
                        )
                    )
        if p.dilution_factors:
            rows += curve("DIL")
            uloq = p.calibration_levels[-1]
            for f in p.dilution_factors:
                for _ in range(p.dilution_replicates or 0):
                    nominal = uloq * f / 2.0
                    r = inj("DIL", "dilution", "qc", "DQC", nominal, factor=f)
                    r["analyte_response"] *= 1 + s.dilution_bias_percent / 100.0
                    rows.append(r)
        if p.stability_tests:
            rows += curve("STAB")
            for t in p.stability_tests:
                if t.name not in s.stability_loss_percent:
                    raise ValueError(f"simulation needs stability_loss_percent[{t.name!r}]")
                for lvl in ("LQC", "HQC"):
                    for _ in range(p.stability_replicates or 0):
                        rows.append(
                            inj(
                                "STAB",
                                "stability",
                                "qc",
                                lvl,
                                getattr(p.qc_levels, lvl),
                                test=t.name,
                                loss=s.stability_loss_percent[t.name],
                            )
                        )
        return rows, "sim.bioanalytical_runs"
