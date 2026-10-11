"""Toxicokinetics: systemic exposure in a toxicity study (ICH S3A).

The laboratory returns one row per sample: animal, sex, dose group, study day, nominal and
actual time after dosing, concentration (or BLQ), and, for incurred-sample reanalysis, the
repeat concentration. For every animal and profile day the driver computes Cmax, Tmax, Clast,
Tlast, AUC(0-t) and, where the profile covers it, AUC over the dosing interval
(:mod:`hos.core.nca`), then summarises by dose, sex and day (ICH S3A 3.9: means or medians
with variability), assesses dose proportionality by the power model against the acceptance
interval the protocol states in advance (:mod:`hos.core.dose_proportionality`), reports the
observed ratio of exposure between profile days, and evaluates ISR (ICH M10 section 5).

What the system does not decide: whether exposure is adequate for the toxicity study (ICH S3A
3.4 gives principles, no numeric criterion), and whether steady state was reached (which
decides whether the observed day ratio may be called an accumulation ratio, CDISC ARAUC).
Both are Study Director determinations.
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
    M10_CHROMATOGRAPHIC,
    M10_LIGAND_BINDING_ISR,
    M10Criterion,
    isr_percent_difference,
    isr_required_count,
)
from hos.core.citations import cite
from hos.core.dose_proportionality import acceptance_interval, fit_power_model
from hos.core.methods import method
from hos.core.nca import BLQ_RULE, ExposureNCA, exposure_nca
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import Quantity
from hos.core.regulatory.context import Modality, ProgramContext
from hos.core.regulatory.engine import StudyRequirement
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
    Prerequisite,
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
from hos.kernel.attestation import Role

SEXES = ("M", "F")
_PARAMS = ("cmax", "auc_tau", "auc_last")
_LABEL = {"cmax": "Cmax", "auc_tau": "AUC(0-tau)", "auc_last": "AUC(0-t)"}


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


class DoseProportionalitySpec(BaseModel):
    """Acceptance region for the power-model criterion, stated before analysis."""

    theta_low: float = Field(
        gt=0,
        lt=1,
        description="lower limit for the dose-normalised "
        "ratio at the extremes of the dose range (e.g. 0.8 or 0.5)",
    )
    theta_high: float = Field(gt=1, description="upper limit (e.g. 1.25 or 2)")
    ci_level: float = Field(gt=0, lt=1, description="confidence level as a fraction (e.g. 0.9)")
    basis: str = Field(
        min_length=1,
        description="why these limits (Hummel 2009 notes both 0.8/1.25 and 0.5/2 are in use)",
    )


class ToxicokineticsParams(BaseModel):
    glp: bool
    parent_study: str = Field(min_length=1, description="the toxicity study this TK supports")
    species: str = Field(min_length=1)
    strain: str = Field(min_length=1)
    route: str = Field(min_length=1)
    administration: Literal["extravascular", "intravenous_infusion"] = Field(
        description="IV bolus is not supported: it needs back-extrapolation of C0"
    )
    analyte: str = Field(min_length=1)
    matrix: Literal["plasma", "serum", "whole_blood"]
    bioanalytical_technique: Literal["chromatographic", "ligand_binding"]
    bioanalytical_method_reference: str = Field(
        min_length=1, description="validation report of the method (ICH S3A 3.10-3.11, M10)"
    )
    concentration_unit: str = Field(min_length=1)
    lloq: float = Field(gt=0, description="lower limit of quantification, concentration unit")
    dose_unit: str = Field(min_length=1, description="e.g. mg/kg/day")
    dose_levels: list[float] = Field(min_length=1, description="dosed groups; control excluded")
    control_group_assayed: bool
    sexes: list[Literal["M", "F"]] = Field(min_length=1)
    single_sex_justification: str | None = None
    animals_per_sex_per_group: int = Field(ge=1)
    satellite_groups: bool
    dosing_interval_h: float = Field(gt=0, description="tau, hours between doses")
    profile_days: list[int] = Field(min_length=1, description="study days; day 1 = first dose")
    sampling: Literal["profile", "monitor"] = Field(description="ICH S3A Note 1")
    sampling_times_h: list[float] = Field(min_length=1, description="nominal, after dosing")
    sampling_justification: str = Field(min_length=1, description="ICH S3A 3.3")
    auc_method: Literal["linear", "linear_up_log_down"]
    auc_method_basis: str = Field(min_length=1, description="ICH M13A 2.2.2.2: report the method")
    blq_rule: Literal["leading_zero_then_excluded"] = Field(description=BLQ_RULE)
    dose_proportionality: DoseProportionalitySpec | None = None

    @field_validator("concentration_unit", "dose_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @field_validator("dose_levels")
    @classmethod
    def _doses(cls, v: list[float]) -> list[float]:
        if any(d <= 0 for d in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError(
                "dose levels are positive and strictly increasing (the control "
                "group is declared by control_group_assayed)"
            )
        return v

    @field_validator("profile_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 1 for d in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("profile days are >= 1 and strictly increasing")
        return v

    @field_validator("sampling_times_h")
    @classmethod
    def _times(cls, v: list[float]) -> list[float]:
        if any(t < 0 for t in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("sampling times are >= 0 and strictly increasing")
        return v

    @model_validator(mode="after")
    def _design(self) -> ToxicokineticsParams:
        errs = []
        if len(set(self.sexes)) != len(self.sexes):
            errs.append("sexes must be unique")
        if len(self.sexes) == 1 and not (self.single_sex_justification or "").strip():
            errs.append(
                "exposure is normally estimated in both sexes; state the justification "
                "for one sex (ICH S3A 3.5)"
            )
        if self.sampling == "profile" and self.sampling_times_h[0] != 0:
            errs.append(
                "a profile needs a pre-dose sample at time 0: AUC(0-t) runs from time "
                "zero (FDA 2022 III.A.9.b)"
            )
        if self.dose_proportionality is not None and len(self.dose_levels) < 2:
            errs.append("dose proportionality needs at least two dose levels")
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def isr_criterion(self) -> M10Criterion:
        return (
            M10_CHROMATOGRAPHIC["isr_limit"]
            if self.bioanalytical_technique == "chromatographic"
            else M10_LIGAND_BINDING_ISR
        )

    def reanalysis_section(self) -> str:
        return "3.3.4" if self.bioanalytical_technique == "chromatographic" else "4.3.4"

    def groups(self) -> list[float]:
        return ([0.0] if self.control_group_assayed else []) + list(self.dose_levels)

    def tau_in_schedule(self) -> bool:
        return any(_same(t, self.dosing_interval_h) for t in self.sampling_times_h)


class ProfilePoint(BaseModel):
    time_h: float = Field(ge=0)
    concentration: float = Field(ge=0)


class ToxicokineticsSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    reference_dose: float = Field(gt=0, description="dose of the reference profile, dose unit")
    reference_profile: list[ProfilePoint] = Field(
        min_length=1, description="true day-1 concentrations at every nominal sampling time"
    )
    dose_exponent: float = Field(description="beta1 of the power model (1 = proportional)")
    day_factor: dict[str, float] = Field(description="exposure multiplier per profile day")
    sex_factor: dict[str, float] = Field(description="exposure multiplier per sex (M, F)")
    between_animal_sd_log: float = Field(ge=0, lt=1)
    residual_sd_log: float = Field(ge=0, lt=1)
    isr_fraction: float = Field(ge=0, le=1, description="fraction of samples reanalysed")
    isr_sd_log: float = Field(ge=0, lt=1)


def _sexes(sexes: list[str], n: int) -> str:
    """ "5M + 5F per group" from the protocol's sexes and group size."""
    return " + ".join(f"{n}{s}" for s in sexes) + " per group"


def _p(params: BaseModel) -> ToxicokineticsParams:
    if not isinstance(params, ToxicokineticsParams):
        raise TypeError("expected ToxicokineticsParams")
    return params


class _Profile:
    __slots__ = ("day", "dose", "nca", "rows", "sex", "subject")

    def __init__(
        self, subject: str, sex: str, dose: float, day: int, rows: list[Mapping[str, Any]]
    ) -> None:
        self.subject, self.sex, self.dose, self.day = subject, sex, dose, day
        self.rows = sorted(rows, key=lambda r: float(r["nominal_time"]))
        self.nca: ExposureNCA | None = None


class ToxicokineticsDriver(StudyDriver):
    id = "toxicokinetics"
    name = "Toxicokinetics in a toxicity study (ICH S3A)"
    version = "1.0.0"
    requirement_ids = ("tox.toxicokinetics",)
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.3.2"
    glp_capable = True
    description = (
        "Systemic exposure per dose, sex and day within a toxicity study: "
        "non-compartmental Cmax and AUC, dose proportionality by the power model, "
        "observed exposure ratios between days, and incurred-sample reanalysis."
    )
    reference_keys = ("ich_s3a", "ich_m10", "fda_ba_2022", "ich_m13a", "smith2000")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return ToxicokineticsParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return ToxicokineticsSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp}
        if requirement.species:
            out["species"] = requirement.species[0]
        return out

    def prerequisites(self, params: BaseModel) -> tuple[Prerequisite, ...]:
        return (
            Prerequisite(
                "bioanalytical.validation",
                "TK concentrations from GLP toxicity studies need a validated "
                "bioanalytical method (ICH M10 section 1.3)",
                "ich_m10",
            ),
        )

    # -- design ----------------------------------------------------------------------

    def _notes(self, p: ToxicokineticsParams) -> list[str]:
        notes = []
        if len(p.profile_days) == 1:
            notes.append(
                "one profile day: ICH S3A 4.3 describes profiling or monitoring at the "
                "start and towards the end of the treatment period"
            )
        if not p.control_group_assayed:
            notes.append("control samples not assayed (ICH S3A Note 8: often unnecessary)")
        if p.single_sex_justification:
            notes.append(f"one sex: {p.single_sex_justification}")
        if p.sampling == "monitor":
            notes.append(
                "monitoring design: C(time) and Cmax only; AUC is not estimated (ICH S3A Note 1)"
            )
        elif not p.tau_in_schedule():
            notes.append(
                f"no sample at the end of the dosing interval ({p.dosing_interval_h:g} h): "
                "AUC(0-tau) will not be estimable"
            )
        if p.dose_proportionality is not None:
            notes.append(
                "log transformation: the power model PK = beta0 * Dose^beta1 is linear "
                "on the ln-ln scale (Smith et al. 2000); rationale required by ICH S3A "
                "3.9"
            )
        return notes

    # -- CTD Module 2.6 summaries (ABI 1.2) --------------------------------------

    def summary_facts(self, params: BaseModel) -> SummaryFacts | None:
        p = _p(params)
        return SummaryFacts(
            test_system=f"{p.species.capitalize()} ({p.strain}); {p.matrix.replace('_', ' ')}",
            method_of_administration=p.route,
            duration_of_dosing="profiles on study day " + ", ".join(str(d) for d in p.profile_days),
            doses=", ".join(fmt_param(d) for d in p.dose_levels) + f" {p.dose_unit}",
            gender_and_number=_sexes(list(p.sexes), p.animals_per_sex_per_group)
            + (" (satellite groups)" if p.satellite_groups else ""),
            # supportive toxicokinetics are tabulated in 2.6.7.2 (M4S(R2) Appendix B)
            listed_in=("2.6.7.2",),
        )

    def summary_tables(
        self, params: BaseModel, results: Mapping[str, Any]
    ) -> tuple[SummaryTable, ...]:
        """Exposure by dose, sex and profile day (template 2.6.7.3)."""
        p = _p(params)
        q = results.get("quantities", {})
        rows = []
        for dose in p.dose_levels:
            for sex in p.sexes:
                for day in p.profile_days:
                    keys = [
                        f"mean.{m}.{dose:g}.{sex}.day{day}" for m in ("cmax", "auc_tau", "auc_last")
                    ]
                    if not any(k in q for k in keys):
                        continue
                    rows.append(
                        (
                            f"{dose:g} {p.dose_unit}",
                            sex,
                            f"day {day}",
                            *(ValueRef(k) if k in q else "—" for k in keys),
                        )
                    )
        return (
            SummaryTable(
                template="2.6.7.3",
                title=f"Toxicokinetics: {p.analyte} in {p.species} {p.matrix.replace('_', ' ')}",
                columns=("Dose", "Sex", "Day", "Cmax (mean)", "AUCτ (mean)", "AUClast (mean)"),
                rows=tuple(rows),
                notes=(
                    f"Supports {p.parent_study}. Means as computed in the study; SD and "
                    "individual values are in the study report.",
                ),
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
        cu, du = p.concentration_unit, p.dose_unit
        dp = p.dose_proportionality
        design: dict[str, Any] = {
            "parent_study": p.parent_study,
            "test_system": f"{p.species} ({p.strain}), sexes {', '.join(p.sexes)}",
            "route": f"{p.route} ({p.administration})",
            "dose_groups": (
                ("control (assayed), " if p.control_group_assayed else "")
                + ", ".join(f"{d:g}" for d in p.dose_levels)
                + f" {du}"
            ),
            "animals": f"{p.animals_per_sex_per_group} per sex per group"
            + (" (satellite TK groups)" if p.satellite_groups else " (main study)"),
            "dosing_interval": f"{p.dosing_interval_h:g} h",
            "profile_days": ", ".join(f"day {d}" for d in p.profile_days),
            "sampling": f"{p.sampling}: "
            + ", ".join(f"{t:g}" for t in p.sampling_times_h)
            + f" h ({p.sampling_justification})",
            "analyte_matrix": f"{p.analyte} in {p.matrix.replace('_', ' ')}",
            "bioanalysis": f"{p.bioanalytical_technique} method, LLOQ {p.lloq:g} {cu} "
            f"({p.bioanalytical_method_reference})",
            "nca": f"{p.auc_method.replace('_', ' ')} trapezoidal rule ({p.auc_method_basis}); "
            f"actual sampling times; BLQ: {BLQ_RULE}",
            "dose_proportionality": (
                f"power model; {dp.ci_level:.0%} CI of beta1 within "
                f"[1 + ln({dp.theta_low:g})/ln r, 1 + ln({dp.theta_high:g})/ln r]"
                f" ({dp.basis})"
            )
            if dp
            else "not assessed",
            "isr": f"ICH M10 section 5: within ±{p.isr_criterion().value:g}% for at least 2/3 of "
            "repeats",
        }
        notes = self._notes(p)
        if notes:
            design["design_notes"] = notes
        criteria = [
            AcceptanceCriterion("m10.isr", p.isr_criterion().statement, "ich_m10 section 5")
        ]
        if dp:
            criteria.append(
                AcceptanceCriterion(
                    "dose_proportionality",
                    f"{dp.ci_level:.0%} CI of the power-model slope wholly "
                    f"inside the interval for theta {dp.theta_low:g}-{dp.theta_high:g}",
                    "smith2000",
                )
            )
        refs = [cite("ich_s3a"), cite("ich_m10"), cite("fda_ba_2022"), cite("ich_m13a")]
        if dp:
            refs += [cite("smith2000"), cite("hummel2009")]
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Toxicokinetics of {compound.name} in the {p.species} ({p.parent_study})",
            objective="Describe the systemic exposure achieved and its relationship to dose "
            "level and the time course of the toxicity study (ICH S3A section 2).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id, "analyte": p.analyte},
            test_system={"species": p.species, "strain": p.strain, "matrix": p.matrix},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Sampling",
                    f"Collect {p.matrix.replace('_', ' ')} at "
                    + ", ".join(f"{t:g}" for t in p.sampling_times_h)
                    + " h after dosing on "
                    + ", ".join(f"day {d}" for d in p.profile_days)
                    + "; record the actual time of each sample.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Bioanalysis",
                    f"Assay with the validated method "
                    f"({p.bioanalytical_method_reference}); report concentrations below "
                    f"{p.lloq:g} {cu} as BLQ.",
                    ("analytical runs meet ICH M10",),
                ),
                ProtocolStep(
                    3,
                    "Incurred sample reanalysis",
                    "Reanalyse a predefined subset of "
                    "samples around Cmax and in the elimination phase in separate runs "
                    "on different days (ICH M10 section 5).",
                    (),
                ),
                ProtocolStep(
                    4,
                    "Return data",
                    "One row per sample per data_template.csv; the pre-dose sample is time 0.",
                    (),
                ),
            ),
            acceptance_criteria=tuple(criteria),
            materials=(f"validated {p.bioanalytical_technique} method for {p.analyte}",),
            deliverables=("data CSV per template", "toxicokinetic report"),
            glp=p.glp,
            references=tuple(refs),
            regulatory_basis=("ICH S3A", "ICH M10 section 5 (ISR)"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = (
            len(p.groups())
            * len(p.sexes)
            * p.animals_per_sex_per_group
            * len(p.profile_days)
            * len(p.sampling_times_h)
        )
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"concurrent with the toxicity study {p.parent_study} (profiles on "
            + ", ".join(f"day {d}" for d in p.profile_days)
            + "); bioanalysis turnaround is set by the laboratory",
            sample_count=n,
            sample_count_basis="groups x sexes x animals x profile days x sampling times",
            dependencies=(
                f"validated bioanalytical method ({p.bioanalytical_method_reference})",
                f"toxicity study {p.parent_study}",
            ),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {
                "dose": f"{d:g}",
                "dose_unit": p.dose_unit,
                "sex": s,
                "day": day,
                "nominal_time_h": f"{t:g}",
                "animals": p.animals_per_sex_per_group,
            }
            for d in p.groups()
            for s in p.sexes
            for day in p.profile_days
            for t in p.sampling_times_h
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        cu = p.concentration_unit
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per sample. day is the study day (day 1 = first dose); times "
            "are hours after that day's dose and the pre-dose sample is time 0. "
            "A sample below the LLOQ has blq=yes and an empty concentration. "
            "isr_concentration is the repeat value for samples chosen for ISR.",
            columns=(
                DataColumn("subject_id", "laboratory animal id", kind="text"),
                DataColumn("sex", "M or F", kind="text", choices=tuple(p.sexes)),
                DataColumn("dose", "dose group (0 = control)", unit=p.dose_unit, minimum=0),
                DataColumn("day", "study day", kind="integer", minimum=1),
                DataColumn("nominal_time", "nominal time after dosing", unit="h", minimum=0),
                DataColumn("actual_time", "actual time after dosing", unit="h", minimum=0),
                DataColumn(
                    "concentration",
                    "concentration (empty when BLQ)",
                    unit=cu,
                    required=False,
                    minimum=0,
                ),
                DataColumn("blq", "below the LLOQ", kind="text", choices=("yes", "no")),
                DataColumn(
                    "isr_concentration",
                    "ISR repeat concentration",
                    unit=cu,
                    required=False,
                    minimum=0,
                ),
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        warnings: list[str] = []
        seen: set[tuple[str, int, float]] = set()
        subject: dict[str, tuple[str, float]] = {}
        groups = p.groups()
        for i, r in enumerate(records, start=1):
            sid, dose = str(r["subject_id"]), float(r["dose"])
            if not any(_same(dose, g) for g in groups):
                errors.append(
                    f"row {i}: dose {dose:g} is not a protocol group"
                    + (
                        ""
                        if p.control_group_assayed
                        else " (control samples are not assayed in this protocol)"
                    )
                )
            if r["day"] not in p.profile_days:
                errors.append(f"row {i}: day {r['day']} is not a profile day {p.profile_days}")
            if not any(_same(float(r["nominal_time"]), t) for t in p.sampling_times_h):
                errors.append(
                    f"row {i}: nominal time {r['nominal_time']:g} h is not in the sampling schedule"
                )
            key = (sid, int(r["day"]), float(r["nominal_time"]))
            if key in seen:
                errors.append(
                    f"row {i}: duplicate sample for {sid} day {r['day']} at {r['nominal_time']:g} h"
                )
            seen.add(key)
            if sid in subject and subject[sid] != (r["sex"], dose):
                errors.append(f"row {i}: {sid} changes sex or dose group")
            subject.setdefault(sid, (r["sex"], dose))
            conc = r.get("concentration")
            if r["blq"] == "yes" and conc is not None:
                errors.append(f"row {i}: a BLQ sample has no concentration")
            if r["blq"] == "no":
                if conc is None:
                    errors.append(f"row {i}: concentration is required when blq=no")
                elif conc < p.lloq * (1 - 1e-9):
                    errors.append(
                        f"row {i}: {conc:g} {p.concentration_unit} is below the LLOQ "
                        f"{p.lloq:g}; the calibration range starts at the LLOQ (ICH "
                        "M10 3.2.4), so report it as BLQ"
                    )
            if r.get("isr_concentration") is not None and r["blq"] != "no":
                errors.append(f"row {i}: ISR applies to quantified samples")
        by_profile: dict[tuple[str, int], list[Mapping[str, Any]]] = defaultdict(list)
        for r in records:
            by_profile[(str(r["subject_id"]), int(r["day"]))].append(r)
        for (sid, day), rows in sorted(by_profile.items()):
            ordered = sorted(rows, key=lambda r: float(r["nominal_time"]))
            if any(
                float(b["actual_time"]) <= float(a["actual_time"]) for a, b in pairwise(ordered)
            ):
                errors.append(f"{sid} day {day}: actual times do not increase with nominal times")
        return errors, warnings

    # -- analysis ------------------------------------------------------------------------

    def analysis_inputs(self, params: BaseModel) -> Mapping[str, str]:
        cu = _p(params).concentration_unit
        return {"human_auc": f"{cu}*h", "human_cmax": cu}

    def _profiles(
        self, p: ToxicokineticsParams, records: Sequence[Mapping[str, Any]]
    ) -> list[_Profile]:
        rows: dict[tuple[str, int], list[Mapping[str, Any]]] = defaultdict(list)
        for r in records:
            rows[(str(r["subject_id"]), int(r["day"]))].append(r)
        out = []
        for (sid, day), rs in sorted(rows.items()):
            prof = _Profile(sid, str(rs[0]["sex"]), float(rs[0]["dose"]), day, rs)
            times = [float(r["actual_time"]) for r in prof.rows]
            concs = [None if r["blq"] == "yes" else float(r["concentration"]) for r in prof.rows]
            tau_idx = next(
                (
                    i
                    for i, r in enumerate(prof.rows)
                    if _same(float(r["nominal_time"]), p.dosing_interval_h)
                ),
                None,
            )
            prof.nca = exposure_nca(
                times,
                concs,
                method=p.auc_method,
                tau_nominal_index=tau_idx,
                auc_estimable=p.sampling == "profile",
            )
            out.append(prof)
        return out

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        cu, du = p.concentration_unit, p.dose_unit
        units = {"cmax": cu, "auc_tau": f"{cu}*h", "auc_last": f"{cu}*h"}
        m_cmax, m_auc, m_tau = (
            method("nca.cmax_tmax"),
            method("nca.auc_last"),
            method("nca.auc_tau"),
        )
        m_param = {"cmax": m_cmax, "auc_tau": m_tau, "auc_last": m_auc}
        m_sum, m_norm = method("tk.group_summary"), method("tk.dose_normalised")
        profiles = self._profiles(p, data.records)
        dosed = [x for x in profiles if x.dose > 0]
        findings: list[QCFinding] = []
        tables = []
        q: dict[str, Quantity] = {}
        notes: list[str] = []

        def value(x: _Profile, key: str) -> float | None:
            assert x.nca is not None
            v: float | None = getattr(x.nca, key)
            return v

        def indiv(x: _Profile, key: str, label: str) -> Quantity:
            assert x.nca is not None
            v = value(x, key)
            unit = {"tmax": "h", "tlast": "h", "clast": cu}.get(key) or units[key]
            m = m_param.get(key, m_cmax)
            if v is None:
                return Quantity.unavailable(
                    unit,
                    reason=x.nca.reasons.get(key) or x.nca.reasons.get("cmax", "not estimable"),
                    label=label,
                )
            return Quantity.computed(v, unit, method=m, label=label)

        # individual exposure ------------------------------------------------------------
        ind_rows = []
        for x in profiles:
            assert x.nca is not None
            tag = f"{x.subject} day {x.day}"
            ind_rows.append(
                (
                    x.subject,
                    x.sex,
                    f"{x.dose:g}",
                    x.day,
                    f"{x.nca.n_quantifiable}/{x.nca.n_samples}",
                    indiv(x, "cmax", f"Cmax {tag}"),
                    indiv(x, "tmax", f"Tmax {tag}"),
                    indiv(x, "tlast", f"Tlast {tag}"),
                    indiv(x, "auc_last", f"AUC(0-t) {tag}"),
                    indiv(x, "auc_tau", f"AUC(0-tau) {tag}"),
                )
            )
        tables.append(
            tabulate(
                "Individual exposure",
                (
                    "animal",
                    "sex",
                    f"dose ({du})",
                    "day",
                    "quantifiable/samples",
                    "Cmax",
                    "Tmax",
                    "Tlast",
                    "AUC(0-t)",
                    "AUC(0-tau)",
                ),
                ind_rows,
                note=f"{p.auc_method.replace('_', ' ')} trapezoidal rule on actual times; "
                f"BLQ: {BLQ_RULE}; tau = {p.dosing_interval_h:g} h",
            )
        )

        # group summaries --------------------------------------------------------------------
        groups: dict[tuple[float, str, int], list[_Profile]] = defaultdict(list)
        for x in dosed:
            groups[(x.dose, x.sex, x.day)].append(x)
        mean_rows, median_rows = [], []
        means: dict[tuple[float, str, int, str], Quantity] = {}
        for (dose, sex, day), xs in sorted(groups.items()):
            g = f"{dose:g} {du} {sex} day {day}"
            if len(xs) < p.animals_per_sex_per_group:
                findings.append(
                    QCFinding(
                        f"profiles.{dose:g}.{sex}.{day}",
                        QCStatus.WARN,
                        f"{g}: {len(xs)} profiles returned, {p.animals_per_sex_per_group} planned",
                    )
                )
            mrow: list[Any] = [f"{dose:g}", sex, day]
            drow: list[Any] = [f"{dose:g}", sex, day]
            for key in ("cmax", "tmax", "auc_tau", "auc_last"):
                vals = [v for x in xs if (v := value(x, key)) is not None]
                unit = "h" if key == "tmax" else units[key]
                lab = "Tmax" if key == "tmax" else _LABEL[key]
                if not vals:
                    reason = (
                        next(
                            (
                                x.nca.reasons.get(key)
                                for x in xs
                                if x.nca and x.nca.reasons.get(key)
                            ),
                            None,
                        )
                        or "not estimable"
                    )
                    na = Quantity.unavailable(unit, reason=reason, label=f"{lab} {g}")
                    mrow.append(na)
                    drow.append(na)
                    continue
                sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
                mq = Quantity.computed(
                    float(np.mean(vals)),
                    unit,
                    method=m_sum,
                    label=f"mean {lab} {g} (n={len(vals)})",
                    uncertainty=Uncertainty(kind="sd", sd=sd, n=len(vals))
                    if sd is not None
                    else None,
                )
                dq = Quantity.computed(
                    float(np.median(vals)),
                    unit,
                    method=m_sum,
                    label=f"median {lab} {g} (n={len(vals)})",
                    uncertainty=Uncertainty(
                        kind="range", lower=min(vals), upper=max(vals), n=len(vals)
                    ),
                )
                mrow.append(mq)
                drow.append(dq)
                if key != "tmax":
                    means[(dose, sex, day, key)] = mq
                    q[f"mean.{key}.{dose:g}.{sex}.day{day}"] = mq
            for key in ("cmax", "auc_tau"):
                gm = means.get((dose, sex, day, key))
                mrow.append(
                    Quantity.computed(
                        gm.require() / dose,
                        f"({units[key]})/({du})",
                        method=m_norm,
                        inputs=[gm],
                        label=f"{_LABEL[key]}/dose {g}",
                    )
                    if gm
                    else Quantity.unavailable(
                        f"({units[key]})/({du})",
                        reason=f"no mean {_LABEL[key]}",
                        label=f"{_LABEL[key]}/dose {g}",
                    )
                )
            mrow.insert(3, f"{len(xs)}")
            drow.insert(3, f"{len(xs)}")
            mean_rows.append(tuple(mrow))
            median_rows.append(tuple(drow))
        tables.append(
            tabulate(
                "Exposure by dose, sex and day: mean (SD)",
                (
                    f"dose ({du})",
                    "sex",
                    "day",
                    "n",
                    "Cmax",
                    "Tmax",
                    "AUC(0-tau)",
                    "AUC(0-t)",
                    "Cmax/dose",
                    "AUC(0-tau)/dose",
                ),
                mean_rows,
                note="ICH S3A 3.9: means or medians with estimates of "
                "variability; n per parameter is in each label",
            )
        )
        tables.append(
            tabulate(
                "Exposure by dose, sex and day: median (range)",
                (f"dose ({du})", "sex", "day", "n", "Cmax", "Tmax", "AUC(0-tau)", "AUC(0-t)"),
                median_rows,
            )
        )

        # dose proportionality ------------------------------------------------------------------
        dp = p.dose_proportionality
        if dp is not None:
            m_dp = method("tk.dose_proportionality_power")
            dp_rows: list[tuple[Any, ...]] = []
            for sex in p.sexes:
                for day in p.profile_days:
                    for key in _PARAMS:
                        xs = [x for x in dosed if x.sex == sex and x.day == day]
                        pts = [
                            (x.dose, v) for x in xs if (v := value(x, key)) is not None and v > 0
                        ]
                        excluded = len(xs) - len(pts)
                        label = f"{_LABEL[key]} {sex} day {day}"
                        if len({d for d, _ in pts}) < 2 or len(pts) < 3:
                            dp_rows.append(
                                (
                                    sex,
                                    day,
                                    _LABEL[key],
                                    len(pts),
                                    None,
                                    Quantity.unavailable(
                                        "dimensionless",
                                        label=f"beta1 {label}",
                                        reason="needs at least two dose levels and "
                                        "three animals with quantifiable exposure",
                                    ),
                                    None,
                                    "not assessed",
                                )
                            )
                            continue
                        fit = fit_power_model(
                            [d for d, _ in pts], [v for _, v in pts], ci_level=dp.ci_level
                        )
                        lo, hi = acceptance_interval(fit.dose_ratio, dp.theta_low, dp.theta_high)
                        unc = (
                            Uncertainty(
                                kind=f"ci{round(dp.ci_level * 100)}",
                                lower=fit.ci[0],
                                upper=fit.ci[1],
                                n=fit.n,
                            )
                            if fit.ci
                            else None
                        )
                        b1 = Quantity.computed(
                            fit.beta1,
                            "dimensionless",
                            method=m_dp,
                            label=f"beta1 {label}",
                            uncertainty=unc,
                            notes=f"{excluded} animals excluded (exposure not quantifiable)"
                            if excluded
                            else None,
                        )
                        q[f"dp.{key}.{sex}.day{day}.beta1"] = b1
                        met = fit.ci is not None and lo <= fit.ci[0] and fit.ci[1] <= hi
                        verdict = "criterion met" if met else "criterion not met"
                        dp_rows.append(
                            (
                                sex,
                                day,
                                _LABEL[key],
                                fit.n,
                                f"{fit.dose_ratio:g}",
                                b1,
                                f"[{lo:.4f}, {hi:.4f}]",
                                verdict + (f"; {excluded} excluded" if excluded else ""),
                            )
                        )
            tables.append(
                tabulate(
                    "Dose proportionality (power model)",
                    (
                        "sex",
                        "day",
                        "parameter",
                        "n",
                        "dose ratio r",
                        "beta1 (CI)",
                        "acceptance interval",
                        "result",
                    ),
                    dp_rows,
                    note=f"ln(PK) on ln(dose) over individual animals; {dp.ci_level:.0%} CI; "
                    f"theta {dp.theta_low:g}-{dp.theta_high:g} ({dp.basis}). AUC(0-t) ends at "
                    "each animal's last measurable concentration, which can differ by dose.",
                )
            )
        else:
            notes.append(
                "dose proportionality not assessed: no acceptance interval stated in the protocol"
            )

        # exposure ratio between days ---------------------------------------------------------
        m_ratio = method("tk.exposure_ratio_days")
        if len(p.profile_days) > 1:
            first = p.profile_days[0]
            r_rows = []
            for dose in p.dose_levels:
                for sex in p.sexes:
                    for day in p.profile_days[1:]:
                        cells: list[Any] = [f"{dose:g}", sex, f"day {day} / day {first}"]
                        for key in _PARAMS:
                            a = means.get((dose, sex, day, key))
                            b = means.get((dose, sex, first, key))
                            lab = f"{_LABEL[key]} ratio {dose:g} {sex} day {day}/{first}"
                            if a is None or b is None or b.require() == 0:
                                cells.append(
                                    Quantity.unavailable(
                                        "dimensionless",
                                        label=lab,
                                        reason=f"mean {_LABEL[key]} not available on both days",
                                    )
                                )
                                continue
                            rq = Quantity.computed(
                                a.require() / b.require(),
                                "dimensionless",
                                method=m_ratio,
                                inputs=[a, b],
                                label=lab,
                            )
                            q[f"ratio.{key}.{dose:g}.{sex}.day{day}"] = rq
                            cells.append(rq)
                        r_rows.append(tuple(cells))
            tables.append(
                tabulate(
                    "Observed exposure ratio between profile days",
                    (f"dose ({du})", "sex", "days", "Cmax", "AUC(0-tau)", "AUC(0-t)"),
                    r_rows,
                    note="ratio of group means; called an accumulation ratio only if steady "
                    "state is established (CDISC ARAUC), which the Study Director "
                    "determines",
                )
            )

        # exposure multiples ------------------------------------------------------------------
        h_auc, h_cmax = inputs.get("human_auc"), inputs.get("human_cmax")
        if h_auc is not None or h_cmax is not None:
            m_mult = method("tk.exposure_multiple")
            last = p.profile_days[-1]
            mult_rows = []
            for dose in p.dose_levels:
                for sex in p.sexes:
                    cells = [f"{dose:g}", sex]
                    for key, h in (("auc_tau", h_auc), ("cmax", h_cmax)):
                        a = means.get((dose, sex, last, key))
                        lab = f"{_LABEL[key]} multiple {dose:g} {sex} day {last}"
                        if h is None or a is None:
                            cells.append(
                                Quantity.unavailable(
                                    "dimensionless",
                                    label=lab,
                                    reason="human exposure not supplied"
                                    if h is None
                                    else f"mean animal {_LABEL[key]} not available",
                                )
                            )
                            continue
                        mq = Quantity.computed(
                            a.require() / h.magnitude_in(units[key]),
                            "dimensionless",
                            method=m_mult,
                            inputs=[a, h],
                            label=lab,
                        )
                        q[f"multiple.{key}.{dose:g}.{sex}"] = mq
                        cells.append(mq)
                    mult_rows.append(tuple(cells))
            tables.append(
                tabulate(
                    f"Exposure multiples over stated human exposure (day {last})",
                    (f"dose ({du})", "sex", "AUC(0-tau)", "Cmax"),
                    mult_rows,
                    note="animal group mean / human value; total concentrations",
                )
            )

        # samples that call for reanalysis (M10 3.3.4 / 4.3.4) ---------------------------------
        sec = p.reanalysis_section()
        ctrl_q = [r for r in data.records if float(r["dose"]) == 0 and r["blq"] == "no"]
        if ctrl_q:
            findings.append(
                QCFinding(
                    "control.quantifiable",
                    QCStatus.WARN,
                    f"{len(ctrl_q)} control-group samples have quantifiable {p.analyte} "
                    f"(ICH M10 {sec} lists this as a reason for reanalysis)",
                )
            )
        pre_q = [
            r
            for r in data.records
            if int(r["day"]) == 1
            and float(r["dose"]) > 0
            and float(r["nominal_time"]) == 0
            and r["blq"] == "no"
        ]
        if pre_q:
            findings.append(
                QCFinding(
                    "predose.quantifiable",
                    QCStatus.WARN,
                    f"{len(pre_q)} day-1 pre-dose samples have quantifiable {p.analyte} "
                    f"(ICH M10 {sec} lists this as a reason for reanalysis)",
                )
            )
        no_auc = [
            x
            for x in dosed
            if x.nca
            and x.nca.auc_last is None
            and x.nca.cmax is not None
            and p.sampling == "profile"
        ]
        if no_auc:
            findings.append(
                QCFinding(
                    "auc.unavailable",
                    QCStatus.WARN,
                    f"AUC(0-t) not estimable for {len(no_auc)} profiles: "
                    + "; ".join(sorted({x.nca.reasons["auc_last"] for x in no_auc if x.nca})),
                )
            )

        # incurred sample reanalysis (M10 section 5) -------------------------------------------
        crit = p.isr_criterion()
        isr = [r for r in data.records if r.get("isr_concentration") is not None]
        need = isr_required_count(len(data.records))
        if not isr:
            findings.append(
                QCFinding(
                    "isr.absent",
                    QCStatus.WARN,
                    "no incurred sample reanalysis in this study; ICH M10 section 5 expects ISR at "
                    "least once per species for nonclinical studies within its scope",
                )
            )
        else:
            m_isr = method("bioanalysis.isr")
            diffs = [
                isr_percent_difference(float(r["concentration"]), float(r["isr_concentration"]))
                for r in isr
            ]
            within = sum(abs(d) <= crit.value for d in diffs)
            frac = within / len(diffs)
            q["isr.fraction_within"] = Quantity.computed(
                100.0 * frac, "percent", method=m_isr, label="ISR repeats within limit"
            )
            tables.append(
                tabulate(
                    "Incurred sample reanalysis",
                    ("animal", "day", "time (h)", "initial", "repeat", "% difference"),
                    [
                        (
                            str(r["subject_id"]),
                            int(r["day"]),
                            f"{float(r['nominal_time']):g}",
                            f"{float(r['concentration']):g} {cu}",
                            f"{float(r['isr_concentration']):g} {cu}",
                            Quantity.computed(
                                d,
                                "percent",
                                method=m_isr,
                                label=f"ISR {r['subject_id']} day {r['day']}",
                            ),
                        )
                        for r, d in zip(isr, diffs, strict=True)
                    ],
                    note=f"{len(isr)} repeats of {len(data.records)} samples (minimum {need}); "
                    f"{within} within ±{crit.value:g}% ({100 * frac:.1f}%)",
                )
            )
            if frac < M10_CHROMATOGRAPHIC["isr_fraction"].value:
                findings.append(
                    QCFinding(
                        "isr.criterion",
                        QCStatus.FAIL,
                        f"ISR: {within}/{len(diffs)} repeats within ±{crit.value:g}%; at least 2/3 "
                        "required (ICH M10 section 5)",
                    )
                )
            if len(isr) < need:
                findings.append(
                    QCFinding(
                        "isr.count",
                        QCStatus.FAIL,
                        f"ISR: {len(isr)} samples reanalysed; the ICH M10 section 5 minimum for "
                        f"{len(data.records)} study samples is {need}",
                    )
                )
        return AnalysisResult(
            quantities=q,
            tables=tuple(tables),
            qc=QCVerdict.of(findings),
            evidence_admissible=True,
            notes=tuple(notes),
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        dp = p.dose_proportionality
        b1 = {k: v for k, v in analysis.quantities.items() if k.startswith("dp.")}
        if dp is not None and b1:
            out.append(
                InterpretiveStatement(
                    f"Dose proportionality was assessed by the power model for {len(b1)} "
                    "parameter/sex/day combinations against the acceptance interval stated in the "
                    "protocol (theta "
                    f"{dp.theta_low:g}-{dp.theta_high:g}); the result of each is in the table.",
                    "power model with a confidence-interval criterion",
                    ("smith2000", "hummel2009"),
                    "info",
                )
            )
            not_met = [
                r
                for t in analysis.tables
                if t.title.startswith("Dose proportionality")
                for r in t.rows
                if str(r[-1]).startswith("criterion not met")
            ]
            if not_met:
                out.append(
                    InterpretiveStatement(
                        f"The criterion is not met for {len(not_met)} combinations. ICH S3A 3.4.3: "
                        "non-linear kinetics should not necessarily result in dose limitations or "
                        "invalidate the findings, but call for very careful interpretation of the "
                        "toxicity findings.",
                        "ICH S3A 3.4.3",
                        ("ich_s3a",),
                        "notable",
                    )
                )
        ratios = [
            v.require()
            for k, v in analysis.quantities.items()
            if k.startswith("ratio.") and v.is_available
        ]
        if ratios:
            out.append(
                InterpretiveStatement(
                    f"Observed exposure ratios between the last and first profile days range from "
                    f"{min(ratios):.3g} to {max(ratios):.3g}. ICH S3A Note 3 names accumulation "
                    "(long half-life) and auto-induction as causes of time-dependent exposure; the "
                    "cause is not determined here.",
                    "ICH S3A Note 3",
                    ("ich_s3a",),
                    "info",
                )
            )
        mults = {k: v for k, v in analysis.quantities.items() if k.startswith("multiple.")}
        if mults:
            low = f"{p.dose_levels[0]:g}"
            lows = [
                f"{v.require():.3g} ({_LABEL[k.split('.')[1]]}, {k.split('.')[-1]})"
                for k, v in mults.items()
                if k.split(".")[2] == low
            ]
            if lows:
                out.append(
                    InterpretiveStatement(
                        f"At the lowest dose ({low} {p.dose_unit}) the exposure multiples over the "
                        f"stated human exposure are {', '.join(lows)}. ICH S3A 3.4.1: low-dose "
                        "exposure should ideally equal or just exceed the maximum expected in "
                        "patients.",
                        "ICH S3A 3.4.1",
                        ("ich_s3a",),
                        "info",
                    )
                )
        for f in analysis.qc.findings:
            if f.status is QCStatus.FAIL or f.code.startswith(("isr.", "control.", "predose.")):
                out.append(
                    InterpretiveStatement(
                        f.message,
                        "ICH M10 study sample analysis",
                        ("ich_m10",),
                        "concern" if f.status is QCStatus.FAIL else "notable",
                    )
                )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Whether systemic exposure is adequate for the toxicity study, including the "
                "low-dose margin and any non-linearity (ICH S3A 3.4)",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        p = _p(params)
        dets = [
            ExpertDetermination(
                "exposure_adequacy",
                "Systemic exposure adequate for the toxicity study",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Conclude whether the exposure achieved supports the toxicity study (ICH S3A 3.4); "
                "S3A gives principles and no numeric criterion.",
                choices=("adequate", "not_adequate"),
            )
        ]
        if len(p.profile_days) > 1:
            dets.append(
                ExpertDetermination(
                    "steady_state",
                    f"Steady state reached by day {p.profile_days[-1]}",
                    None,
                    Role.STUDY_DIRECTOR,
                    False,
                    "Whether exposure on the last profile day is at steady state; only then is the "
                    "observed day ratio an accumulation ratio (CDISC ARAUC).",
                    choices=("established", "not_established"),
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
        by_key = {d["key"]: d for d in determinations}
        lines = []
        for key, label in (
            ("exposure_adequacy", "Exposure adequacy"),
            ("steady_state", "Steady state"),
        ):
            d = by_key.get(key)
            if d:
                lines.append(
                    f"{label}: {d['category']} ({d['signer_name']}, {d['role']}). "
                    f"Rationale: {d['rationale']}"
                )
        if "exposure_adequacy" not in by_key:
            lines.append("Exposure adequacy not yet determined by the Study Director.")
        n_prof = sum(1 for t in analysis.tables if t.title == "Individual exposure" for _ in t.rows)
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + f"{n_prof} individual profiles. "
                + " ".join(lines),
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection(
                "Results", "Per ICH S3A sections 2, 3.9 and 3.11.", tables=analysis.tables
            ),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, ToxicokineticsSimulation)
        ref = {round(pt.time_h, 9): pt.concentration for pt in s.reference_profile}
        missing = [t for t in p.sampling_times_h if round(t, 9) not in ref]
        if missing:
            raise ValueError(f"reference_profile needs every sampling time; missing {missing}")
        for day in p.profile_days:
            if str(day) not in s.day_factor:
                raise ValueError(f"simulation needs day_factor[{str(day)!r}]")
        for sex in p.sexes:
            if sex not in s.sex_factor:
                raise ValueError(f"simulation needs sex_factor[{sex!r}]")

        def lognormal(sd: float) -> float:
            return float(np.exp(rng.normal(0.0, sd))) if sd else 1.0

        rows: list[dict[str, Any]] = []
        for gi, dose in enumerate(p.groups()):
            for sex in p.sexes:
                for k in range(p.animals_per_sex_per_group):
                    sid = f"{sex}{gi}{k + 1:02d}"
                    animal = lognormal(s.between_animal_sd_log)
                    for day in p.profile_days:
                        for t in p.sampling_times_h:
                            c = (
                                0.0
                                if dose == 0
                                else (
                                    ref[round(t, 9)]
                                    * (dose / s.reference_dose) ** s.dose_exponent
                                    * s.day_factor[str(day)]
                                    * s.sex_factor[sex]
                                    * animal
                                    * lognormal(s.residual_sd_log)
                                )
                            )
                            q = c >= p.lloq
                            rows.append(
                                {
                                    "subject_id": sid,
                                    "sex": sex,
                                    "dose": dose,
                                    "day": day,
                                    "nominal_time": t,
                                    "actual_time": t,
                                    "concentration": c if q else None,
                                    "blq": "no" if q else "yes",
                                    "isr_concentration": None,
                                }
                            )
        quant = [i for i, r in enumerate(rows) if r["blq"] == "no"]
        k = min(len(quant), int(np.ceil(s.isr_fraction * len(rows))))
        for i in sorted(rng.choice(quant, size=k, replace=False).tolist()) if k else []:
            rows[i]["isr_concentration"] = rows[i]["concentration"] * lognormal(s.isr_sd_log)
        return rows, "sim.tk_power_profile"
