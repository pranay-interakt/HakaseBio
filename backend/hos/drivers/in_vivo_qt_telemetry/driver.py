"""In vivo QT assessment by telemetry (ICH S7B 2.3.2, 3.1.3; E14/S7B Q&A 2022 section 3),
designed to serve the S7A cardiovascular core battery as well when blood pressure is measured
(S7B 2.3.2: "This assay can be designed to meet the objective of both ICH S7A (cardiovascular
core battery study) and S7B"; S7A 2.7.2: blood pressure, heart rate and the ECG).

Design: a Latin-square crossover in which every animal receives vehicle and each treatment
(the customary conscious telemetered non-rodent, Q&A 3.1), in a species S7B 3.1.3 lists; rats
and mice are refused. The laboratory returns interval means per animal, treatment, phase
(baseline / post-dose) and time: RR, QT, heart rate, optionally PR, QRS and blood pressure,
and plasma concentrations where sampled (Q&A 3.2: at least one PK sample on the PD day).

Analysis:

* QT corrected by the protocol's stated method, with its justification (S7B 3.1.3): individual
  animal (preferred when the drug affects heart rate, Q&A 3.3), Fridericia, Bazett or Van de
  Water (:mod:`hos.core.cardiac`); QTc-RR independence reported with matched pairs, slope and 95%
  CI, correlation and p-value (Q&A 3.3);
* per treatment and time: absolute means, change from baseline and from vehicle (within animal)
  with 95% CIs and p-values, and mean percent change from baseline (Q&A 3.5);
* exposure: Cmax per treatment against the stated high clinical exposure (Q&A 3.2; S7B Q&A 1.1).

No QTc threshold is applied: the Q&A's millisecond figures are explicitly hypothetical (Q&A
3.4). Assay sensitivity is the protocol's stated minimum detectable difference with its basis.
The QTc conclusion, and the cardiovascular conclusion, are Study Director determinations.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from types import MappingProxyType
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core import units as U
from hos.core.cardiac import correct_qt, individual_slope, rr_independence, t_summary
from hos.core.citations import cite
from hos.core.methods import method
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import Quantity
from hos.core.regulatory.context import Modality, ProgramContext
from hos.core.regulatory.engine import StudyRequirement
from hos.drivers.base import (
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
    SummaryFacts,
    SummaryTable,
    ValueRef,
    fmt_param,
    tabulate,
)
from hos.drivers.repeat_dose_tox.analysis import dose_eq
from hos.kernel.attestation import Role

TREATMENTS = ("vehicle", "test", "positive")
CORRECTION_METHOD = {
    "individual": "cv.qtc_individual",
    "fridericia": "cv.qtc_fridericia",
    "bazett": "cv.qtc_bazett",
    "van_de_water": "cv.qtc_van_de_water",
}
#: endpoint -> (column, unit, label)
ENDPOINTS = (
    ("qtc", None, "ms", "QTc"),
    ("qt", "qt", "ms", "QT"),
    ("hr", "heart_rate", "1/min", "heart rate"),
    ("pr", "pr", "ms", "PR"),
    ("qrs", "qrs", "ms", "QRS"),
    ("sbp", "sbp", "mmHg", "systolic BP"),
    ("dbp", "dbp", "mmHg", "diastolic BP"),
    ("map", "map", "mmHg", "mean arterial pressure"),
)


class TelemetryParams(BaseModel):
    glp: bool
    species: Literal["dog", "monkey", "minipig", "rabbit", "ferret", "guinea_pig"] = Field(
        description="S7B 3.1.3; adult rats and mice are not appropriate"
    )
    strain: str = Field(min_length=1)
    sexes: list[Literal["M", "F"]] = Field(min_length=1)
    animals: int = Field(ge=2, description="animals in the crossover")
    design: Literal["latin_square_crossover"]
    washout: str = Field(min_length=1, description="interval between periods and its basis")
    route: str = Field(min_length=1)
    vehicle: str = Field(min_length=1)
    dose_levels_mg_per_kg: list[float] = Field(min_length=1)
    dose_selection_basis: str = Field(
        min_length=1,
        description="S7B 3.1.3 / S7A: include and exceed the anticipated human exposure",
    )
    positive_control: str | None = None
    positive_control_basis: str | None = Field(
        default=None,
        description="S7B 3.1.1: positive controls validate the test system but "
        "need not be in every study; state the historical data if none is included",
    )
    telemetry_system: str = Field(min_length=1)
    interval_bin: str = Field(min_length=1, description="averaging interval, e.g. 15-min means")
    baseline: Literal["time_matched", "pre_dose"] = Field(
        description="time-matched: same times on the day before dosing (E14 Q&A 4.2)"
    )
    post_dose_times_h: list[float] = Field(min_length=1)
    qt_correction: Literal["individual", "fridericia", "bazett", "van_de_water"]
    rr_reference_ms: float | None = Field(
        default=None,
        gt=0,
        description="individual correction: reference RR (published values differ)",
    )
    correction_justification: str = Field(
        min_length=1, description="S7B 3.1.3: justified with data from the test system"
    )
    blood_pressure: bool = Field(
        description="measure BP to serve the S7A cardiovascular core battery as well (S7B 2.3.2)"
    )
    measure_pr_qrs: bool
    concentration_unit: str = Field(min_length=1)
    minimum_detectable_difference_ms: float | None = Field(default=None, gt=0)
    sensitivity_basis: str | None = None

    @field_validator("dose_levels_mg_per_kg")
    @classmethod
    def _doses(cls, v: list[float]) -> list[float]:
        if any(d <= 0 for d in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("dose levels are positive and strictly increasing")
        return v

    @field_validator("post_dose_times_h")
    @classmethod
    def _times(cls, v: list[float]) -> list[float]:
        if any(t <= 0 for t in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("post-dose times are positive and strictly increasing")
        return v

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @model_validator(mode="after")
    def _design(self) -> TelemetryParams:
        errs = []
        if self.qt_correction == "individual" and self.rr_reference_ms is None:
            errs.append("individual correction needs the reference RR (rr_reference_ms)")
        if self.qt_correction != "individual" and self.rr_reference_ms is not None:
            errs.append("rr_reference_ms applies to individual correction only")
        if not self.positive_control and not (self.positive_control_basis or "").strip():
            errs.append(
                "include a positive control or state the historical data that define "
                "the system's sensitivity (S7B 3.1.1; Q&A 3.4)"
            )
        if (self.minimum_detectable_difference_ms is not None) != bool(
            (self.sensitivity_basis or "").strip()
        ):
            errs.append(
                "state the minimum detectable difference together with its basis "
                "(Q&A 3.4; no fixed value exists)"
            )
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def treatments(self) -> list[tuple[str, float | None]]:
        return (
            [("vehicle", 0.0)]
            + [("test", d) for d in self.dose_levels_mg_per_kg]
            + ([("positive", None)] if self.positive_control else [])
        )

    def endpoints(self) -> list[tuple[str, str | None, str, str]]:
        keep = (
            {"qtc", "qt", "hr"}
            | ({"pr", "qrs"} if self.measure_pr_qrs else set())
            | ({"sbp", "dbp", "map"} if self.blood_pressure else set())
        )
        return [e for e in ENDPOINTS if e[0] in keep]


class AnimalTruth(BaseModel):
    qt_intercept_ms: float
    qt_rr_slope: float


class TelemetrySimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    animals: list[AnimalTruth] = Field(min_length=1, description="one per animal")
    rr_mean_ms: float = Field(gt=0)
    rr_sd_ms: float = Field(ge=0)
    qt_noise_sd_ms: float = Field(ge=0)
    rr_change_by_dose_ms: list[float]
    qtc_change_by_dose_ms: list[float]
    positive_control_qtc_change_ms: float = 0.0
    #: Baselines have no defaults. A physiological value the user did not state is one the
    #: simulator would be inventing, and it would then be analysed as if it were data.
    bp_baseline_mmhg: tuple[float, float, float] | None = Field(
        default=None, description="systolic, diastolic, mean arterial (mmHg), for this species"
    )
    bp_change_by_dose_mmhg: list[float] | None = None
    pr_baseline_ms: float | None = Field(
        default=None, gt=0, description="PR interval baseline (ms), for this species"
    )
    qrs_baseline_ms: float | None = Field(
        default=None, gt=0, description="QRS duration baseline (ms), for this species"
    )
    pr_change_by_dose_ms: list[float] | None = None
    qrs_change_by_dose_ms: list[float] | None = None
    cmax_by_dose: list[float] = Field(description="plasma concentration at the sampled time")
    pk_sample_time_h: float = Field(gt=0)


def _p(params: BaseModel) -> TelemetryParams:
    if not isinstance(params, TelemetryParams):
        raise TypeError("expected TelemetryParams")
    return params


def _tlabel(treatment: str, dose: float | None) -> str:
    if treatment == "vehicle":
        return "vehicle"
    if treatment == "positive":
        return "positive control"
    return f"{dose:g} mg/kg"


class InVivoQTTelemetryDriver(StudyDriver):
    id = "in_vivo_qt_telemetry"
    name = "In vivo QT telemetry (ICH S7B; S7A cardiovascular)"
    version = "1.0.0"
    requirement_ids = ("safety.in_vivo_qt", "safety.core_battery")
    components = MappingProxyType({"safety.core_battery": ("cardiovascular",)})
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.1.3"
    glp_capable = True
    description = (
        "Conscious telemetry crossover: QT corrected by a justified method, change "
        "from baseline and from vehicle with CIs, exposure coverage; QTc and "
        "cardiovascular conclusions by the Study Director."
    )
    reference_keys = ("ich_s7b", "ich_e14_s7b_qa", "ich_s7a", "student1908")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return TelemetryParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return TelemetrySimulation

    def components_covered(self, requirement_id: str, params: BaseModel) -> tuple[str, ...]:
        # S7A 2.7.2: blood pressure, heart rate and the ECG
        return self.components_for(requirement_id) if _p(params).blood_pressure else ()

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp, "design": "latin_square_crossover"}
        if requirement.id == "safety.core_battery":
            out["blood_pressure"] = True
        if requirement.species and requirement.species[0] in ("dog", "monkey", "minipig"):
            out["species"] = requirement.species[0]
        return out

    def analysis_inputs(self, params: BaseModel) -> Mapping[str, str]:
        return {"high_clinical_cmax": _p(params).concentration_unit}

    # -- design ----------------------------------------------------------------------

    # -- CTD Module 2.6 summaries (ABI 1.2) --------------------------------------

    def summary_facts(self, params: BaseModel) -> SummaryFacts | None:
        p = _p(params)
        return SummaryFacts(
            test_system=f"{p.species.replace('_', ' ').capitalize()} ({p.strain}), conscious telemetry",
            method_of_administration=f"{p.route} ({p.vehicle})",
            duration_of_dosing="single dose per period (Latin-square crossover)",
            doses="vehicle, " + ", ".join(fmt_param(d) for d in p.dose_levels_mg_per_kg) + " mg/kg",
            gender_and_number=f"{p.animals} animals ({'/'.join(p.sexes)}), each receiving every treatment",
            organ_systems="Cardiovascular (ECG, heart rate"
            + (", blood pressure)" if p.blood_pressure else ")"),
        )

    def summary_tables(
        self, params: BaseModel, results: Mapping[str, Any]
    ) -> tuple[SummaryTable, ...]:
        """Supporting safety-pharmacology table (2.6.3.4): exposure at each dose."""
        p = _p(params)
        q = results.get("quantities", {})
        rows = tuple(
            (
                f"{d:g} mg/kg",
                ValueRef(f"cmax.{d:g}") if f"cmax.{d:g}" in q else "—",
                ValueRef(f"multiple.{d:g}") if f"multiple.{d:g}" in q else "—",
            )
            for d in p.dose_levels_mg_per_kg
        )
        return (
            SummaryTable(
                template="2.6.3.4",
                title="Safety pharmacology: cardiovascular telemetry, exposure at each dose",
                columns=("Dose", "Cmax", "Multiple of the clinical Cmax"),
                rows=rows,
            ),
        )

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        corr = {
            "individual": f"individual animal QT-RR (RR_ref {p.rr_reference_ms:g} ms)"
            if p.rr_reference_ms
            else "individual animal QT-RR",
            "fridericia": "Fridericia",
            "bazett": "Bazett",
            "van_de_water": "Van de Water",
        }[p.qt_correction]
        design: dict[str, Any] = {
            "test_system": f"conscious telemetered {p.species} ({p.strain}), {p.animals} "
            f"animals, sexes {', '.join(p.sexes)}",
            "design": f"Latin-square crossover, every animal receives every treatment; washout "
            f"{p.washout}",
            "treatments": f"vehicle ({p.vehicle}), "
            + ", ".join(f"{d:g}" for d in p.dose_levels_mg_per_kg)
            + " mg/kg"
            + (
                f", positive control {p.positive_control}"
                if p.positive_control
                else f"; no positive control: {p.positive_control_basis}"
            ),
            "route": p.route,
            "dose_selection": p.dose_selection_basis,
            "recording": f"{p.telemetry_system}; {p.interval_bin}; ECG (RR, QT"
            + (", PR, QRS" if p.measure_pr_qrs else "")
            + "), heart rate"
            + (", blood pressure" if p.blood_pressure else ""),
            "baseline": "time-matched (same times, day before dosing)"
            if p.baseline == "time_matched"
            else "pre-dose",
            "post_dose_times": ", ".join(f"{t:g}" for t in p.post_dose_times_h) + " h",
            "qt_correction": f"{corr} ({p.correction_justification}); QTc-RR independence "
            "reported (Q&A 3.3)",
            "analysis": "change from baseline and from vehicle within animal, mean with 95% CI "
            "and p-value (Student's t); mean % change from baseline (Q&A 3.5)",
            "sensitivity": (
                f"minimum detectable difference {p.minimum_detectable_difference_ms:g}"
                f" ms ({p.sensitivity_basis})"
            )
            if p.minimum_detectable_difference_ms
            else "positive control in study",
            "exposure": "at least one plasma sample per animal on each PD day (Q&A 3.2); "
            "coverage of the high clinical exposure",
        }
        if p.blood_pressure:
            design["s7a"] = "also serves the S7A cardiovascular core battery (S7B 2.3.2)"
        refs = [cite("ich_s7b"), cite("ich_e14_s7b_qa"), cite("student1908")]
        refs += [
            c
            for c in method(CORRECTION_METHOD[p.qt_correction]).citations
            if c.key not in ("ich_s7b", "ich_e14_s7b_qa")
        ]
        if p.blood_pressure:
            refs.append(cite("ich_s7a"))
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"In vivo QT and cardiovascular telemetry of {compound.name} in the {p.species}",
            objective="Assess effects on ventricular repolarisation (QT) and, where stated, on "
            "blood pressure and heart rate (ICH S7B 3.1.3; S7A 2.7.2).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"species": p.species, "strain": p.strain},
            design=design,
            steps=(
                ProtocolStep(1, "Baseline", "Record the baseline per the stated type.", ()),
                ProtocolStep(
                    2,
                    "Treatment periods",
                    "Dose each animal with every treatment in "
                    "Latin-square order with the stated washout; record continuously.",
                    (),
                ),
                ProtocolStep(
                    3,
                    "Pharmacokinetics",
                    "Take at least one plasma sample per animal "
                    "on each dosing day (E14/S7B Q&A 3.2).",
                    (),
                ),
                ProtocolStep(4, "Return data", "Interval means per data_template.csv.", ()),
            ),
            acceptance_criteria=(),
            materials=tuple(x for x in (p.vehicle, p.positive_control) if x),
            deliverables=("data CSV per template", "cardiovascular safety pharmacology report"),
            glp=p.glp,
            references=tuple(dict.fromkeys(refs)),
            regulatory_basis=("ICH S7B 2.3.2, 3.1.3", "ICH E14/S7B Q&A 3.1-3.5")
            + (("ICH S7A 2.7.2",) if p.blood_pressure else ()),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        periods = len(p.treatments())
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"{periods} crossover periods separated by the washout ({p.washout}); "
            "scheduling is set by the laboratory",
            sample_count=p.animals * periods,
            sample_count_basis="animal-periods (each animal receives every treatment)",
            dependencies=(
                "telemetry implantation and recovery",
                "bioanalytical method for the PK samples",
            ),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {
                "treatment": t,
                "dose_mg_per_kg": "" if d is None else f"{d:g}",
                "animals": p.animals,
                "post_dose_times_h": ", ".join(f"{x:g}" for x in p.post_dose_times_h),
            }
            for t, d in p.treatments()
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        cols = [
            DataColumn("animal_id", "animal", kind="text"),
            DataColumn("sex", "M or F", kind="text", choices=tuple(p.sexes)),
            DataColumn("period", "crossover period", kind="integer", minimum=1),
            DataColumn(
                "treatment",
                "vehicle, test or positive",
                kind="text",
                choices=TREATMENTS if p.positive_control else TREATMENTS[:2],
            ),
            DataColumn(
                "dose",
                "test-article dose (0 vehicle, empty positive control)",
                unit="mg/kg",
                required=False,
                minimum=0,
            ),
            DataColumn(
                "phase", "baseline or post_dose", kind="text", choices=("baseline", "post_dose")
            ),
            DataColumn(
                "time",
                "time after dosing (baseline: the matched time, or <= 0 for a pre-dose baseline)",
                unit="h",
            ),
            DataColumn("rr", "RR interval", unit="ms", exclusive_minimum=True, minimum=0),
            DataColumn("qt", "QT interval", unit="ms", exclusive_minimum=True, minimum=0),
            DataColumn("heart_rate", "heart rate", unit="1/min", exclusive_minimum=True, minimum=0),
        ]
        if p.measure_pr_qrs:
            cols += [
                DataColumn("pr", "PR interval", unit="ms", minimum=0),
                DataColumn("qrs", "QRS duration", unit="ms", minimum=0),
            ]
        if p.blood_pressure:
            cols += [
                DataColumn(c, label, unit="mmHg", minimum=0)
                for c, label in (
                    ("sbp", "systolic BP"),
                    ("dbp", "diastolic BP"),
                    ("map", "mean arterial pressure"),
                )
            ]
        cols.append(
            DataColumn(
                "plasma_concentration",
                "plasma concentration where sampled",
                unit=p.concentration_unit,
                required=False,
                minimum=0,
            )
        )
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description=f"One row per animal x period x phase x time: interval means "
            f"({p.interval_bin}) as reported by {p.telemetry_system}.",
            columns=tuple(cols),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[str, int, str, float]] = set()
        received: dict[str, set[str]] = defaultdict(set)
        for i, r in enumerate(records, start=1):
            t, dose = r["treatment"], r.get("dose")
            if t == "vehicle" and dose not in (None, 0):
                errors.append(f"row {i}: vehicle periods have dose 0")
            if t == "test" and (
                dose is None or not any(dose_eq(dose, d) for d in p.dose_levels_mg_per_kg)
            ):
                errors.append(f"row {i}: test dose must be a protocol dose level")
            if t == "positive" and dose is not None:
                errors.append(f"row {i}: positive-control periods have no test-article dose")
            time = float(r["time"])
            if r["phase"] == "post_dose" and not any(
                abs(time - x) < 1e-9 for x in p.post_dose_times_h
            ):
                errors.append(f"row {i}: {time:g} h is not a post-dose time of the protocol")
            if (
                r["phase"] == "baseline"
                and p.baseline == "time_matched"
                and not any(abs(time - x) < 1e-9 for x in p.post_dose_times_h)
            ):
                errors.append(f"row {i}: a time-matched baseline uses the post-dose times")
            if r["phase"] == "baseline" and p.baseline == "pre_dose" and time > 0:
                errors.append(f"row {i}: a pre-dose baseline is at or before dosing (time <= 0)")
            key = (str(r["animal_id"]), int(r["period"]), str(r["phase"]), time)
            if key in seen:
                errors.append(f"row {i}: duplicate {key}")
            seen.add(key)
            received[str(r["animal_id"])].add(_tlabel(t, dose))
        need = {_tlabel(t, d) for t, d in p.treatments()}
        for a, got in sorted(received.items()):
            if got != need:
                errors.append(
                    f"animal {a}: the crossover needs every treatment {sorted(need)}; "
                    f"received {sorted(got)}"
                )
        return errors, []

    # -- analysis ------------------------------------------------------------------------

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        m_corr = method(CORRECTION_METHOD[p.qt_correction])
        m_ind, m_chg = method("cv.qtc_rr_independence"), method("cv.change_from_baseline")
        findings: list[QCFinding] = []
        q: dict[str, Quantity] = {}
        tables = []
        recs = [dict(r) for r in data.records]

        # 1. QT correction
        slopes: dict[str, float] = {}
        if p.qt_correction == "individual":
            for a in sorted({str(r["animal_id"]) for r in recs}):
                vrows = [
                    r for r in recs if str(r["animal_id"]) == a and r["treatment"] == "vehicle"
                ]
                try:
                    slopes[a] = individual_slope(
                        [float(r["qt"]) for r in vrows], [float(r["rr"]) for r in vrows]
                    )
                except ValueError as exc:
                    findings.append(
                        QCFinding(
                            f"slope.{a}",
                            QCStatus.FAIL,
                            f"animal {a}: {exc}; its QTc is unavailable",
                        )
                    )
            tables.append(
                tabulate(
                    "Individual QT-RR slopes (vehicle data)",
                    ("animal", "slope (ms/ms)"),
                    [
                        (
                            a,
                            Quantity.computed(
                                b, "dimensionless", method=m_corr, label=f"QT-RR slope {a}"
                            ),
                        )
                        for a, b in sorted(slopes.items())
                    ],
                    note=f"QTc = QT - b (RR - {p.rr_reference_ms:g} ms)",
                )
            )
        for r in recs:
            a = str(r["animal_id"])
            if p.qt_correction == "individual" and a not in slopes:
                r["qtc"] = None
                continue
            r["qtc"] = correct_qt(
                float(r["qt"]),
                float(r["rr"]),
                p.qt_correction,
                slope=slopes.get(a),
                rr_ref_ms=p.rr_reference_ms,
            )

        # 2. QTc-RR independence (Q&A 3.3)
        ind_rows = []
        for scope, rows in (
            ("all data", recs),
            ("vehicle", [r for r in recs if r["treatment"] == "vehicle"]),
        ):
            pairs = [(float(r["qtc"]), float(r["rr"])) for r in rows if r["qtc"] is not None]
            if len(pairs) < 3:
                # the check that validates the correction cannot run; an omitted row would
                # read as "nothing to flag" rather than "this was never tested"
                findings.append(
                    QCFinding(
                        f"independence.{scope.split()[0]}",
                        QCStatus.WARN,
                        f"QTc-RR independence not assessed for {scope}: {len(pairs)} matched "
                        "pair(s), at least 3 are needed; whether the correction removed the "
                        "heart-rate dependence is therefore unknown (E14/S7B Q&A 3.3)",
                    )
                )
                continue
            ri = rr_independence([x for x, _ in pairs], [y for _, y in pairs])
            sq = Quantity.computed(
                ri.slope,
                "dimensionless",
                method=m_ind,
                label=f"QTc-RR slope ({scope})",
                uncertainty=Uncertainty(
                    kind="ci95", lower=ri.slope_ci[0], upper=ri.slope_ci[1], n=ri.n_pairs
                ),
            )
            q[f"independence.{scope.split()[0]}.slope"] = sq
            ind_rows.append((scope, ri.n_pairs, sq, f"{ri.r:.4f}", f"{ri.p_value:.3g}"))
        tables.append(
            tabulate(
                "QTc-RR independence (E14/S7B Q&A 3.3)",
                ("data", "matched pairs", "slope (95% CI)", "correlation r", "p-value"),
                ind_rows,
                note=f"correction: {p.qt_correction.replace('_', ' ')} "
                f"({p.correction_justification})",
            )
        )

        # 3. change from baseline and from vehicle, within animal
        def baseline_value(a: str, period: int, time: float, col: str) -> float | None:
            rows = [
                r
                for r in recs
                if str(r["animal_id"]) == a
                and int(r["period"]) == period
                and r["phase"] == "baseline"
                and r.get(col) is not None
            ]
            if p.baseline == "time_matched":
                rows = [r for r in rows if abs(float(r["time"]) - time) < 1e-9]
            return float(np.mean([float(r[col]) for r in rows])) if rows else None

        deltas: dict[tuple[str, str, float], dict[str, float]] = defaultdict(dict)
        absolute: dict[tuple[str, str, float], list[float]] = defaultdict(list)
        pct: dict[tuple[str, str, float], list[float]] = defaultdict(list)
        for r in recs:
            if r["phase"] != "post_dose":
                continue
            a, period, time = str(r["animal_id"]), int(r["period"]), float(r["time"])
            lab = _tlabel(r["treatment"], r.get("dose"))
            for key, col, _u, _lab in p.endpoints():
                c = col or key
                if r.get(c) is None:
                    continue
                absolute[(key, lab, time)].append(float(r[c]))
                b = baseline_value(a, period, time, c)
                if b is None:
                    continue
                deltas[(key, lab, time)][a] = float(r[c]) - b
                if b != 0:
                    pct[(key, lab, time)].append(100.0 * (float(r[c]) - b) / b)
        missing_base = sorted({k[1] for k, v in absolute.items() if not deltas.get(k)})
        if missing_base:
            findings.append(
                QCFinding(
                    "baseline.missing",
                    QCStatus.FAIL,
                    f"no baseline for {missing_base}; changes from baseline cannot be computed",
                )
            )
        order = [_tlabel(t, d) for t, d in p.treatments()]
        summary_rows: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
        for key, _col, unit, label in p.endpoints():
            for lab in order:
                for time in p.post_dose_times_h:
                    k = (key, lab, time)
                    if not absolute.get(k):
                        continue
                    tag = f"{label} {lab} {time:g} h"
                    am = Quantity.computed(
                        float(np.mean(absolute[k])), unit, method=m_chg, label=f"mean {tag}"
                    )
                    d = deltas.get(k, {})
                    dq: Any = "-"
                    if d:
                        ts = t_summary(list(d.values()))
                        dq = Quantity.computed(
                            ts.mean,
                            unit,
                            method=m_chg,
                            label=f"change from baseline {tag} (n={ts.n})",
                            uncertainty=Uncertainty(
                                kind="ci95", lower=ts.ci[0], upper=ts.ci[1], sd=ts.sd, n=ts.n
                            )
                            if ts.ci
                            else None,
                            notes=None if ts.p_value is None else f"p = {ts.p_value:.3g}",
                        )
                    pq: Any = (
                        Quantity.computed(
                            float(np.mean(pct[k])),
                            "percent",
                            method=m_chg,
                            label=f"% change from baseline {tag}",
                        )
                        if pct.get(k)
                        else "-"
                    )
                    ddq: Any = "-"
                    veh = deltas.get((key, "vehicle", time), {})
                    if lab != "vehicle" and d and veh:
                        paired = [d[a] - veh[a] for a in d if a in veh]
                        if paired:
                            ts = t_summary(paired)
                            ddq = Quantity.computed(
                                ts.mean,
                                unit,
                                method=m_chg,
                                label=f"change vs vehicle {tag} (n={ts.n})",
                                uncertainty=Uncertainty(
                                    kind="ci95", lower=ts.ci[0], upper=ts.ci[1], sd=ts.sd, n=ts.n
                                )
                                if ts.ci
                                else None,
                                notes=None if ts.p_value is None else f"p = {ts.p_value:.3g}",
                            )
                            q[f"ddelta.{key}.{lab}.{time:g}"] = ddq
                            if ts.p_value is not None:
                                q[f"ddelta_p.{key}.{lab}.{time:g}"] = Quantity.computed(
                                    ts.p_value,
                                    "dimensionless",
                                    method=m_chg,
                                    label=f"p change vs vehicle {tag}",
                                )
                    summary_rows[key].append((lab, f"{time:g} h", am, dq, pq, ddq))
        for key, _c, unit, label in p.endpoints():
            if summary_rows.get(key):
                tables.append(
                    tabulate(
                        f"{label}: change from baseline and from vehicle",
                        (
                            "treatment",
                            "time",
                            f"mean ({unit})",
                            "change from baseline (95% CI)",
                            "% change from baseline",
                            "change vs vehicle (95% CI)",
                        ),
                        summary_rows[key],
                        note="within-animal differences; p-values in each value's notes (Student's "
                        "t, no multiplicity adjustment)",
                    )
                )

        # 4. exposure (Q&A 3.2, S7B Q&A 1.1)
        conc: dict[tuple[str, str], list[float]] = defaultdict(list)
        for r in recs:
            if r["phase"] == "post_dose" and r.get("plasma_concentration") is not None:
                conc[(_tlabel(r["treatment"], r.get("dose")), str(r["animal_id"]))].append(
                    float(r["plasma_concentration"])
                )
        animals = sorted({str(r["animal_id"]) for r in recs})
        cu = p.concentration_unit
        hc = inputs.get("high_clinical_cmax")
        exp_rows = []
        for dose in p.dose_levels_mg_per_kg:
            lab = f"{dose:g} mg/kg"
            without = [a for a in animals if not conc.get((lab, a))]
            if without:
                findings.append(
                    QCFinding(
                        f"pk.{lab}",
                        QCStatus.WARN,
                        f"{lab}: no plasma sample on the PD day for {without} (E14/S7B Q&A 3.2)",
                    )
                )
            cm = [max(conc[(lab, a)]) for a in animals if conc.get((lab, a))]
            if not cm:
                continue
            mq = Quantity.computed(
                float(np.mean(cm)), cu, method=m_chg, label=f"mean Cmax {lab} (n={len(cm)})"
            )
            q[f"cmax.{dose:g}"] = mq
            mult: Any = "-"
            if hc is not None:
                mult = Quantity.computed(
                    mq.require() / hc.magnitude_in(cu),
                    "dimensionless",
                    method=method("cv.exposure_multiple"),
                    inputs=[mq, hc],
                    label=f"exposure multiple {lab}",
                )
                q[f"multiple.{dose:g}"] = mult
            exp_rows.append((lab, mq, mult))
        if exp_rows:
            tables.append(
                tabulate(
                    "Exposure on the PD day",
                    ("dose", "mean Cmax", "multiple of high clinical Cmax"),
                    exp_rows,
                )
            )
        top = q.get(f"multiple.{p.dose_levels_mg_per_kg[-1]:g}")
        if hc is not None and top is not None and top.require() < 1:
            findings.append(
                QCFinding(
                    "exposure.coverage",
                    QCStatus.WARN,
                    f"top-dose Cmax is {top.require():.3g}x the stated high clinical exposure; the "
                    "in vivo QTc assessment should cover it (S7B Q&A 1.1; Q&A 3.2)",
                )
            )
        return AnalysisResult(
            quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings), evidence_admissible=True
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        ddq = {k: v for k, v in analysis.quantities.items() if k.startswith("ddelta.qtc.")}
        if ddq:
            hi = max(ddq.items(), key=lambda kv: kv[1].require())
            out.append(
                InterpretiveStatement(
                    f"Largest mean QTc change versus vehicle: {hi[1].require():.3g} ms "
                    f"({hi[1].label}). No QTc threshold is applied: the E14/S7B Q&A 3.4 figures are "
                    "explicitly hypothetical.",
                    "E14/S7B Q&A 3.4, 3.5",
                    ("ich_e14_s7b_qa",),
                    "info",
                )
            )
        if p.minimum_detectable_difference_ms:
            out.append(
                InterpretiveStatement(
                    f"Stated assay sensitivity: minimum detectable difference "
                    f"{p.minimum_detectable_difference_ms:g} ms ({p.sensitivity_basis}); Q&A 3.4 "
                    "requires the current variance to be consistent with the historical data.",
                    "E14/S7B Q&A 3.4",
                    ("ich_e14_s7b_qa",),
                    "info",
                )
            )
        if p.qt_correction in ("bazett", "fridericia", "van_de_water"):
            out.append(
                InterpretiveStatement(
                    "A fixed-coefficient correction was used; E14/S7B Q&A 3.3 prefers individual "
                    "correction when the test drug affects heart rate. The QTc-RR independence table "
                    "shows how well the correction removed the rate dependence.",
                    "E14/S7B Q&A 3.3",
                    ("ich_e14_s7b_qa",),
                    "notable",
                )
            )
        for f in analysis.qc.findings:
            out.append(
                InterpretiveStatement(
                    f.message,
                    "ICH S7B 3.1.3; E14/S7B Q&A 3",
                    ("ich_s7b", "ich_e14_s7b_qa"),
                    "concern" if f.status is QCStatus.FAIL else "notable",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Whether the study shows QTc prolongation, considering exposure coverage and assay "
                "sensitivity (S7B Q&A 1.1, 3.4)",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        p = _p(params)
        dets = [
            ExpertDetermination(
                "qtc_conclusion",
                "In vivo QTc conclusion",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Whether QTc is prolonged at exposures covering the high clinical exposure, in an "
                "assay of sufficient sensitivity (S7B Q&A 1.1, 3.4).",
                choices=("no_qtc_prolongation", "qtc_prolongation", "inconclusive"),
            )
        ]
        if p.blood_pressure:
            dets.append(
                ExpertDetermination(
                    "overall_conclusion",
                    "Adverse cardiovascular effect",
                    None,
                    Role.STUDY_DIRECTOR,
                    True,
                    "Whether blood pressure, heart rate or the ECG show an adverse effect "
                    "(S7A 2.7.2).",
                    choices=("no_effect_identified", "effect_identified"),
                )
            )
        return tuple(dets)

    # -- report ------------------------------------------------------------------------

    def _report_sections(
        self,
        protocol: ProtocolDocument,
        data: IngestedData,
        analysis: AnalysisResult,
        interpretation: Interpretation,
        determinations: Sequence[Mapping[str, Any]],
    ) -> list[ReportSection]:
        lines = [
            f"{d['label']}: {str(d['category']).replace('_', ' ')} ({d['signer_name']}, "
            f"{d['role']})"
            for d in determinations
            if d.get("category")
        ]
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + (
                    " ".join(lines)
                    if lines
                    else "Conclusions not yet recorded by the Study Director."
                ),
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection(
                "Results",
                "Individual interval means are in the data appendix "
                "(E14/S7B Q&A 3.5: individual animal data).",
                tables=analysis.tables,
            ),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, TelemetrySimulation)
        if len(s.animals) != p.animals:
            raise ValueError("simulation needs one truth per animal")
        nd = len(p.dose_levels_mg_per_kg)
        for name, v in (
            ("rr_change_by_dose_ms", s.rr_change_by_dose_ms),
            ("qtc_change_by_dose_ms", s.qtc_change_by_dose_ms),
            ("cmax_by_dose", s.cmax_by_dose),
        ):
            if len(v) != nd:
                raise ValueError(f"{name} needs one value per dose")
        # A simulated endpoint needs a declared truth. Without one the generator would be
        # inventing a physiological value, and the analysis would then run over it as if it
        # were data (CLAUDE.md rules 0 and 2).
        if p.blood_pressure and s.bp_baseline_mmhg is None:
            raise ValueError(
                "the protocol measures blood pressure, so the simulated truth must state "
                "bp_baseline_mmhg (systolic, diastolic, mean arterial) for this species"
            )
        if p.measure_pr_qrs and (s.pr_baseline_ms is None or s.qrs_baseline_ms is None):
            raise ValueError(
                "the protocol measures PR and QRS, so the simulated truth must state "
                "pr_baseline_ms and qrs_baseline_ms for this species"
            )
        for name, maybe in (
            ("pr_change_by_dose_ms", s.pr_change_by_dose_ms),
            ("qrs_change_by_dose_ms", s.qrs_change_by_dose_ms),
            ("bp_change_by_dose_mmhg", s.bp_change_by_dose_mmhg),
        ):
            if maybe is not None and len(maybe) != nd:
                raise ValueError(f"{name} needs one value per dose")
        treatments = p.treatments()
        rows: list[dict[str, Any]] = []
        for ai, a in enumerate(s.animals):
            aid = f"A{ai + 1:02d}"
            sex = p.sexes[ai % len(p.sexes)]
            for k in range(len(treatments)):
                t, d = treatments[(ai + k) % len(treatments)]  # Latin-square order
                di = p.dose_levels_mg_per_kg.index(d) if t == "test" and d is not None else None
                d_rr = s.rr_change_by_dose_ms[di] if di is not None else 0.0
                d_qtc = (
                    s.qtc_change_by_dose_ms[di]
                    if di is not None
                    else s.positive_control_qtc_change_ms
                    if t == "positive"
                    else 0.0
                )
                d_bp = (
                    s.bp_change_by_dose_mmhg[di]
                    if di is not None and s.bp_change_by_dose_mmhg
                    else 0.0
                )
                # no declared change means the truth is "no effect on this endpoint", which
                # is a statement the user made, not a value the generator chose
                d_pr = (
                    s.pr_change_by_dose_ms[di] if di is not None and s.pr_change_by_dose_ms else 0.0
                )
                d_qrs = (
                    s.qrs_change_by_dose_ms[di]
                    if di is not None and s.qrs_change_by_dose_ms
                    else 0.0
                )
                base_times = p.post_dose_times_h if p.baseline == "time_matched" else [-0.5]
                for phase, times in (("baseline", base_times), ("post_dose", p.post_dose_times_h)):
                    for time in times:
                        post = phase == "post_dose"
                        rr = (
                            s.rr_mean_ms
                            + (d_rr if post else 0.0)
                            + (float(rng.normal(0, s.rr_sd_ms)) if s.rr_sd_ms else 0.0)
                        )
                        qt = (
                            a.qt_intercept_ms
                            + a.qt_rr_slope * rr
                            + (d_qtc if post else 0.0)
                            + (float(rng.normal(0, s.qt_noise_sd_ms)) if s.qt_noise_sd_ms else 0.0)
                        )
                        row: dict[str, Any] = {
                            "animal_id": aid,
                            "sex": sex,
                            "period": k + 1,
                            "treatment": t,
                            "dose": d,
                            "phase": phase,
                            "time": time,
                            "rr": rr,
                            "qt": qt,
                            "heart_rate": 60000.0 / rr,
                            "plasma_concentration": None,
                        }
                        if p.measure_pr_qrs:
                            assert s.pr_baseline_ms is not None  # checked before generating
                            assert s.qrs_baseline_ms is not None
                            row.update(
                                pr=s.pr_baseline_ms + (d_pr if post else 0.0),
                                qrs=s.qrs_baseline_ms + (d_qrs if post else 0.0),
                            )
                        if p.blood_pressure:
                            assert s.bp_baseline_mmhg is not None  # checked before generating
                            sb, db, mb = s.bp_baseline_mmhg
                            e = d_bp if post else 0.0
                            row.update(sbp=sb + e, dbp=db + e, map=mb + e)
                        if post and di is not None and abs(time - s.pk_sample_time_h) < 1e-9:
                            row["plasma_concentration"] = s.cmax_by_dose[di]
                        rows.append(row)
        return rows, "sim.telemetry_declared"
