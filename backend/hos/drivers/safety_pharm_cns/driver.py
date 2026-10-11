"""Safety pharmacology core battery: central nervous system (ICH S7A 2.7.1).

S7A 2.7.1: "Motor activity, behavioral changes, coordination, sensory/motor reflex responses
and body temperature should be evaluated", for example by a functional observation battery
(Mattsson et al. 1996), a modified Irwin's (Irwin 1968) or another appropriate test
(Haggerty 1991). The itemised observation list and scoring scale of those methods could not
be read, so the protocol states them, each observation mapped to one of the five S7A domains;
the protocol is refused if a domain is not covered.

The study is single-dose (S7A 2.5) with a vehicle control and, unless justified, a positive
control (2.3.3.1), at doses that include and exceed the primary pharmacodynamic range (2.4.1),
observed at timepoints chosen on PK/PD grounds (2.3.1). The driver tabulates, per observation,
dose, sex and timepoint, the incidence of findings (a score other than the protocol's normal
score) and, for continuous measures such as body temperature, group means compared with the
vehicle group (descriptively, or by Dunnett's test when the protocol states it). No incidence
statistic is applied: none is verified for S7A endpoints. Whether there is an adverse CNS effect
is the Study Director's determination.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from types import MappingProxyType
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core import units as U
from hos.core.citations import cite
from hos.core.methods import method
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
    fmt_param,
    tabulate,
)
from hos.drivers.repeat_dose_tox.analysis import compare_groups, dose_eq
from hos.kernel.attestation import Role

#: ICH S7A 2.7.1: the five CNS domains of the core battery
S7A_CNS_DOMAINS = (
    "motor_activity",
    "behaviour",
    "coordination",
    "sensory_motor_reflex",
    "body_temperature",
)
GROUPS = ("vehicle", "test", "positive")
METHOD_CITATION = {"fob": "mattsson1996", "modified_irwin": "irwin1968", "other": "haggerty1991"}


class Observation(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\- ]+$")
    domain: Literal[
        "motor_activity", "behaviour", "coordination", "sensory_motor_reflex", "body_temperature"
    ]
    scale: Literal["binary", "ordinal", "continuous"]
    normal_score: int | None = Field(
        default=None, description="binary/ordinal: the score meaning no finding"
    )
    score_min: int | None = None
    score_max: int | None = None
    unit: str | None = Field(default=None, description="continuous measures")

    @model_validator(mode="after")
    def _scale(self) -> Observation:
        if self.scale == "continuous":
            if not self.unit or not U.is_valid_unit(self.unit):
                raise ValueError(f"{self.name}: a continuous measure needs a valid unit")
            if self.normal_score is not None:
                raise ValueError(f"{self.name}: continuous measures have no normal score")
        else:
            lo, hi = (0, 1) if self.scale == "binary" else (self.score_min, self.score_max)
            if lo is None or hi is None or hi <= lo:
                raise ValueError(f"{self.name}: an ordinal scale needs score_min < score_max")
            if self.normal_score is None or not lo <= self.normal_score <= hi:
                raise ValueError(f"{self.name}: state the normal score within the scale")
            if self.unit:
                raise ValueError(f"{self.name}: scores have no unit")
        return self

    def bounds(self) -> tuple[int, int]:
        if self.scale == "binary":
            return 0, 1
        assert self.score_min is not None and self.score_max is not None
        return self.score_min, self.score_max


class CNSParams(BaseModel):
    glp: bool
    species: str = Field(min_length=1)
    strain: str = Field(min_length=1)
    sexes: list[Literal["M", "F"]] = Field(min_length=1)
    route: str = Field(min_length=1)
    vehicle: str = Field(min_length=1)
    method: Literal["fob", "modified_irwin", "other"]
    method_reference: str = Field(min_length=1, description="the laboratory's procedure")
    dose_levels_mg_per_kg: list[float] = Field(min_length=1)
    dose_selection_basis: str = Field(
        min_length=1,
        description="S7A 2.4.1: include and exceed "
        "the primary pharmacodynamic or therapeutic range",
    )
    animals_per_sex_per_group: int = Field(ge=1)
    group_size_basis: str = Field(
        min_length=1,
        description="S7A 2.3.3.1: adequate to show or rule out a biologically significant effect",
    )
    positive_control: str | None = Field(default=None, description="substance and dose")
    positive_control_omission_justification: str | None = None
    timepoints: list[str] = Field(min_length=1)
    baseline_timepoint: str | None = Field(default=None, description="pre-dose timepoint, if any")
    timepoint_basis: str = Field(min_length=1, description="S7A 2.3.1: PK/PD considerations")
    observations: list[Observation] = Field(min_length=1)
    statistics: Literal["none", "dunnett"]
    alpha: float | None = Field(default=None, gt=0, lt=0.5)
    statistics_basis: str = Field(min_length=1)

    @field_validator("dose_levels_mg_per_kg")
    @classmethod
    def _doses(cls, v: list[float]) -> list[float]:
        if any(d <= 0 for d in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("dose levels are positive and strictly increasing")
        return v

    @model_validator(mode="after")
    def _design(self) -> CNSParams:
        errs = []
        covered = {o.domain for o in self.observations}
        missing = [d for d in S7A_CNS_DOMAINS if d not in covered]
        if missing:
            errs.append(f"S7A 2.7.1 domains not covered by any observation: {missing}")
        names = [o.name for o in self.observations]
        if len(set(names)) != len(names):
            errs.append("observation names must be unique")
        if (
            not self.positive_control
            and not (self.positive_control_omission_justification or "").strip()
        ):
            errs.append(
                "include a positive control or justify its omission (S7A 2.3.3.1: "
                "positive controls may not be necessary in well-characterized in vivo "
                "test systems)"
            )
        if self.baseline_timepoint and self.baseline_timepoint not in self.timepoints:
            errs.append("the baseline timepoint must be one of the timepoints")
        if self.statistics == "dunnett":
            if self.alpha is None:
                errs.append("Dunnett's test needs its significance level alpha")
            if self.animals_per_sex_per_group < 2:
                errs.append("Dunnett's test needs at least two animals per group")
        elif self.alpha is not None:
            errs.append("alpha is given only when a statistical test is stated")
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def observation(self, name: str) -> Observation:
        return next(o for o in self.observations if o.name == name)

    def groups(self) -> list[tuple[str, float]]:
        out = [("vehicle", 0.0)] + [("test", d) for d in self.dose_levels_mg_per_kg]
        return out + ([("positive", -1.0)] if self.positive_control else [])


class ObservationTruth(BaseModel):
    observation: str
    incidence_by_dose: list[float] | None = Field(
        default=None, description="binary/ordinal: fraction of animals with a finding per dose"
    )
    finding_score: int | None = None
    positive_control_incidence: float | None = Field(default=None, ge=0, le=1)
    control_mean: float | None = None
    sd: float | None = Field(default=None, ge=0)
    effect_by_dose: list[float] | None = Field(
        default=None, description="continuous: change from control mean per dose (absolute)"
    )
    positive_control_effect: float | None = None


class CNSSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    observations: list[ObservationTruth] = Field(min_length=1)


def _sexes(sexes: list[str], n: int) -> str:
    """ "5M + 5F per group" from the protocol's sexes and group size."""
    return " + ".join(f"{n}{s}" for s in sexes) + " per group"


def _p(params: BaseModel) -> CNSParams:
    if not isinstance(params, CNSParams):
        raise TypeError("expected CNSParams")
    return params


class SafetyPharmCNSDriver(StudyDriver):
    id = "safety_pharm_cns"
    name = "Safety pharmacology: central nervous system (ICH S7A 2.7.1)"
    version = "1.0.0"
    requirement_ids = ("safety.core_battery",)
    components = MappingProxyType({"safety.core_battery": ("cns",)})
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.1.3"
    glp_capable = True
    description = (
        "Functional observation battery / modified Irwin covering the five S7A "
        "2.7.1 domains; incidence by dose, sex and time; adverse CNS effect by the "
        "Study Director."
    )
    reference_keys = ("ich_s7a", "mattsson1996", "irwin1968", "haggerty1991")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return CNSParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return CNSSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp}
        if requirement.species:
            out["species"] = requirement.species[0]
        return out

    # -- design ----------------------------------------------------------------------

    # -- CTD Module 2.6 summaries (ABI 1.2) --------------------------------------

    def summary_facts(self, params: BaseModel) -> SummaryFacts | None:
        p = _p(params)
        return SummaryFacts(
            test_system=f"{p.species.capitalize()} ({p.strain})",
            method_of_administration=f"{p.route} ({p.vehicle})",
            duration_of_dosing="single dose",
            doses="vehicle, " + ", ".join(fmt_param(d) for d in p.dose_levels_mg_per_kg) + " mg/kg",
            gender_and_number=_sexes(list(p.sexes), p.animals_per_sex_per_group),
            organ_systems=f"Central nervous system ({p.method.replace('_', ' ')})",
        )

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        design: dict[str, Any] = {
            "test_system": f"{p.species} ({p.strain}), sexes {', '.join(p.sexes)}, conscious",
            "method": f"{p.method.replace('_', ' ')} ({p.method_reference})",
            "groups": f"vehicle ({p.vehicle}), "
            + ", ".join(f"{d:g}" for d in p.dose_levels_mg_per_kg)
            + " mg/kg"
            + (
                f", positive control {p.positive_control}"
                if p.positive_control
                else f"; no positive control: {p.positive_control_omission_justification}"
            ),
            "animals": f"{p.animals_per_sex_per_group} per sex per group ({p.group_size_basis})",
            "dosing": f"single dose, {p.route} (S7A 2.5)",
            "dose_selection": p.dose_selection_basis,
            "timepoints": ", ".join(p.timepoints) + f" ({p.timepoint_basis})",
            "observations": [
                f"{o.name} [{o.domain.replace('_', ' ')}; {o.scale}"
                + (
                    f", {o.unit}"
                    if o.unit
                    else f", scale {o.bounds()[0]}-{o.bounds()[1]}, normal {o.normal_score}"
                )
                + "]"
                for o in p.observations
            ],
            "analysis": "incidence of findings per group and timepoint; continuous measures "
            + ("by Dunnett vs vehicle" if p.statistics == "dunnett" else "descriptively vs vehicle")
            + f" ({p.statistics_basis})",
        }
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Central nervous system safety pharmacology of {compound.name} in the "
            f"{p.species}",
            objective="Evaluate motor activity, behavioural changes, coordination, sensory/motor "
            "reflex responses and body temperature (ICH S7A 2.7.1).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"species": p.species, "strain": p.strain},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Dosing",
                    f"Single dose by {p.route}; vehicle and positive "
                    "control groups dosed alongside.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Observations",
                    "Score every observation at every timepoint "
                    "blind to treatment where feasible; record body temperature.",
                    (),
                ),
                ProtocolStep(
                    3,
                    "Return data",
                    "One row per animal x observation x timepoint per data_template.csv.",
                    (),
                ),
            ),
            acceptance_criteria=(),
            materials=tuple(x for x in (p.vehicle, p.positive_control) if x),
            deliverables=("data CSV per template", "safety pharmacology report"),
            glp=p.glp,
            references=(cite("ich_s7a"), cite(METHOD_CITATION[p.method])),
            regulatory_basis=("ICH S7A 2.7.1", "ICH S7A 2.3-2.5"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(p.groups()) * len(p.sexes) * p.animals_per_sex_per_group
        return StudyPlan(
            execution_duration_days=1.0,
            duration_basis="single dose with observations over the stated timepoints (S7A 2.5); "
            "scheduling and reporting are set by the laboratory",
            sample_count=n,
            sample_count_basis="animals: groups x sexes x animals",
            dependencies=("dose formulation method",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {
                "group": g,
                "dose_mg_per_kg": "" if d < 0 else f"{d:g}",
                "sex": s,
                "animals": p.animals_per_sex_per_group,
            }
            for g, d in p.groups()
            for s in p.sexes
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per animal x observation x timepoint. group is vehicle, test or "
            "positive; dose is the test-article dose (0 for vehicle, empty for the "
            "positive control). result is the score, or the measured value with its "
            "unit for continuous measures.",
            columns=(
                DataColumn("subject_id", "laboratory animal id", kind="text"),
                DataColumn("sex", "M or F", kind="text", choices=tuple(p.sexes)),
                DataColumn(
                    "group",
                    "vehicle, test or positive",
                    kind="text",
                    choices=GROUPS if p.positive_control else GROUPS[:2],
                ),
                DataColumn("dose", "test-article dose", unit="mg/kg", required=False, minimum=0),
                DataColumn(
                    "observation",
                    "observation name",
                    kind="text",
                    choices=tuple(o.name for o in p.observations),
                ),
                DataColumn("timepoint", "timepoint", kind="text", choices=tuple(p.timepoints)),
                DataColumn("unit", "unit of result (dimensionless for scores)", kind="text"),
                DataColumn("result", "score or measured value", unit_column="unit"),
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[str, str, str]] = set()
        subj: dict[str, tuple[str, str, float | None]] = {}
        for i, r in enumerate(records, start=1):
            g, dose = r["group"], r.get("dose")
            if g == "vehicle" and dose not in (None, 0):
                errors.append(f"row {i}: vehicle animals have dose 0")
            if g == "test" and (
                dose is None or not any(dose_eq(dose, d) for d in p.dose_levels_mg_per_kg)
            ):
                errors.append(f"row {i}: test dose must be a protocol dose level")
            if g == "positive" and dose is not None:
                errors.append(f"row {i}: positive-control rows have no test-article dose")
            o = p.observation(r["observation"])
            v = float(r["result"])
            if o.scale == "continuous":
                if not U.compatible(r["unit"], o.unit or ""):
                    errors.append(f"row {i}: unit {r['unit']!r} incompatible with {o.name}")
            else:
                lo, hi = o.bounds()
                if r["unit"] != "dimensionless" or v != int(v) or not lo <= v <= hi:
                    errors.append(f"row {i}: {o.name} is scored {lo}-{hi} (unit dimensionless)")
            key = (str(r["subject_id"]), o.name, str(r["timepoint"]))
            if key in seen:
                errors.append(f"row {i}: duplicate {key}")
            seen.add(key)
            prev = subj.setdefault(str(r["subject_id"]), (r["sex"], g, dose))
            if prev != (r["sex"], g, dose):
                errors.append(f"row {i}: {r['subject_id']} changes sex or group")
        return errors, []

    # -- analysis ------------------------------------------------------------------------

    @staticmethod
    def _group_label(r: Mapping[str, Any]) -> str:
        if r["group"] == "positive":
            return "positive control"
        return f"{float(r.get('dose') or 0):g} mg/kg"

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        m_inc = method("safety.observation_incidence")
        q: dict[str, Quantity] = {}
        tables = []
        findings: list[QCFinding] = []

        # incidence for scored observations
        animals: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
        found: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
        for r in data.records:
            o = p.observation(r["observation"])
            if o.scale == "continuous":
                continue
            key = (o.name, self._group_label(r), str(r["sex"]), str(r["timepoint"]))
            animals[key].add(str(r["subject_id"]))
            if int(r["result"]) != o.normal_score:
                found[key].add(str(r["subject_id"]))
        order = {
            lab: i
            for i, lab in enumerate(
                ["0 mg/kg", *[f"{d:g} mg/kg" for d in p.dose_levels_mg_per_kg], "positive control"]
            )
        }
        tp_order = {t: i for i, t in enumerate(p.timepoints)}
        inc_rows = []
        for key in sorted(
            animals, key=lambda k: (k[0], order.get(k[1], 99), k[2], tp_order.get(k[3], 99))
        ):
            name, grp, sex, tp = key
            n, k = len(animals[key]), len(found[key])
            inc_rows.append(
                (name, p.observation(name).domain.replace("_", " "), grp, sex, tp, f"{k}/{n}")
            )
            if k and grp not in ("0 mg/kg", "positive control"):
                q[f"incidence|{name}|{grp}|{sex}|{tp}"] = Quantity.computed(
                    float(k),
                    "dimensionless",
                    method=m_inc,
                    label=f"{name}: animals with findings, {grp} {sex} {tp} (of {n})",
                )
        if inc_rows:
            tables.append(
                tabulate(
                    "Incidence of findings",
                    (
                        "observation",
                        "S7A domain",
                        "group",
                        "sex",
                        "timepoint",
                        "animals with finding",
                    ),
                    inc_rows,
                    note="a finding is any score other than the protocol's "
                    "normal score; no incidence statistic is applied",
                )
            )

        # continuous measures vs vehicle (positive control reported separately)
        cont = [o for o in p.observations if o.scale == "continuous"]
        if cont:
            recs = [
                {
                    "endpoint": r["observation"],
                    "sex": r["sex"],
                    "phase": "main",
                    "timepoint": r["timepoint"],
                    "dose": float(r.get("dose") or 0),
                    "unit": r["unit"],
                    "value": float(r["result"]),
                }
                for r in data.records
                if r["group"] != "positive"
                and p.observation(r["observation"]).scale == "continuous"
            ]
            cmp_ = compare_groups(
                recs,
                endpoint_unit=lambda e: p.observation(e).unit or "",
                groups=[0.0, *p.dose_levels_mg_per_kg],
                alpha=p.alpha if p.statistics == "dunnett" else None,
                prov_note=f"file sha256 {data.file_sha256[:16]}",
                dose_unit="mg/kg",
            )
            q.update(cmp_.quantities)
            tables.append(
                tabulate(
                    "Continuous measures vs vehicle",
                    (
                        "measure",
                        "sex",
                        "phase",
                        "timepoint",
                        "dose",
                        "n",
                        "mean (SD)",
                        "% vs vehicle",
                        "p (Dunnett)",
                        "significant",
                    ),
                    cmp_.rows,
                    note=("descriptive only: " + p.statistics_basis)
                    if p.statistics == "none"
                    else "Statistical significance is not adversity.",
                )
            )
        if p.positive_control:
            pos = [r for r in data.records if r["group"] == "positive"]
            if not pos:
                findings.append(
                    QCFinding(
                        "positive.missing",
                        QCStatus.FAIL,
                        "the protocol's positive control returned no data (S7A 2.3.3.1)",
                    )
                )
        for g, d in p.groups():
            for sex in p.sexes:
                ids = {
                    str(r["subject_id"])
                    for r in data.records
                    if r["sex"] == sex
                    and r["group"] == g
                    and (g == "positive" or dose_eq(float(r.get("dose") or 0), max(d, 0)))
                }
                if len(ids) < p.animals_per_sex_per_group:
                    lab = "positive control" if g == "positive" else f"{max(d, 0):g} mg/kg"
                    findings.append(
                        QCFinding(
                            f"animals.{lab}.{sex}",
                            QCStatus.WARN,
                            f"{lab} {sex}: {len(ids)} of "
                            f"{p.animals_per_sex_per_group} animals returned",
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
        inc = {k: v for k, v in analysis.quantities.items() if k.startswith("incidence|")}
        if inc:
            obs = sorted({k.split("|")[1] for k in inc})
            out.append(
                InterpretiveStatement(
                    f"Findings in test-article groups for: {', '.join(obs)}. S7A 2.4.1 asks for the "
                    "dose-response relationship and time course (onset, duration) of an adverse "
                    "effect; both are in the incidence table.",
                    "ICH S7A 2.4.1",
                    ("ich_s7a",),
                    "notable",
                )
            )
        else:
            out.append(
                InterpretiveStatement(
                    "No scored finding in any test-article group at any timepoint.",
                    "ICH S7A 2.7.1",
                    ("ich_s7a",),
                    "info",
                )
            )
        for k, v in analysis.quantities.items():
            if k.endswith("|p"):
                _, measure, sex, _, tp, dose = k[:-2].split("|")
                out.append(
                    InterpretiveStatement(
                        f"Statistically significant difference in {measure} ({sex}, {tp}) at {dose} "
                        f"mg/kg versus vehicle (Dunnett p = {v.require():.3g}).",
                        f"Dunnett two-sided, alpha {p.alpha:g}",
                        ("dunnett1955",),
                        "notable",
                    )
                )
        top = p.dose_levels_mg_per_kg[-1]
        if not inc and not any(k.endswith("|p") for k in analysis.quantities):
            out.append(
                InterpretiveStatement(
                    f"With no effect observed, S7A 2.4.1 expects the highest dose ({top:g} mg/kg) to "
                    "produce moderate adverse effects in this or similar studies; whether it does is "
                    "for the Study Director to establish.",
                    "ICH S7A 2.4.1",
                    ("ich_s7a",),
                    "info",
                )
            )
        for f in analysis.qc.findings:
            out.append(
                InterpretiveStatement(
                    f.message,
                    "ICH S7A 2.3.3.1",
                    ("ich_s7a",),
                    "concern" if f.status is QCStatus.FAIL else "notable",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Whether the findings constitute an adverse CNS effect, and at which doses",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "overall_conclusion",
                "Adverse CNS effect",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Whether the test article produced an adverse effect on CNS function (S7A "
                "2.7.1), considering dose-response, time course and the positive control.",
                choices=("no_effect_identified", "effect_identified"),
            ),
            ExpertDetermination(
                "no_effect_dose",
                "Highest dose without an adverse CNS effect",
                "mg/kg",
                Role.STUDY_DIRECTOR,
                False,
                "Optional; record 'not established' if an effect occurred at every dose.",
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
        det = next((d for d in determinations if d["key"] == "overall_conclusion"), None)
        concl = (
            f"Conclusion: {det['category'].replace('_', ' ')} ({det['signer_name']}, "
            f"{det['role']}). Rationale: {det['rationale']}"
            if det
            else "Conclusion not yet recorded by the Study Director."
        )
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + concl,
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection("Results", "Incidence and continuous measures.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, CNSSimulation)
        truth = {t.observation: t for t in s.observations}
        rows: list[dict[str, Any]] = []
        n = p.animals_per_sex_per_group
        for gi, (g, d) in enumerate(p.groups()):
            di = p.dose_levels_mg_per_kg.index(d) if g == "test" else None
            for sex in p.sexes:
                for k in range(n):
                    sid = f"{sex}{gi + 1}-{k + 1:02d}"
                    for o in p.observations:
                        t = truth.get(o.name)
                        if t is None:
                            raise ValueError(f"simulation needs a truth for {o.name!r}")
                        for tp in p.timepoints:
                            base = tp == p.baseline_timepoint
                            if o.scale == "continuous":
                                if t.control_mean is None or t.effect_by_dose is None:
                                    raise ValueError(
                                        f"{o.name}: control_mean and effect_by_dose are needed"
                                    )
                                eff = (
                                    0.0
                                    if base
                                    else (
                                        t.effect_by_dose[di]
                                        if di is not None
                                        else (t.positive_control_effect or 0.0)
                                        if g == "positive"
                                        else 0.0
                                    )
                                )
                                v = (
                                    t.control_mean
                                    + eff
                                    + (float(rng.normal(0, t.sd)) if t.sd else 0.0)
                                )
                                unit = o.unit
                            else:
                                if t.incidence_by_dose is None or t.finding_score is None:
                                    raise ValueError(
                                        f"{o.name}: incidence_by_dose and finding_score are needed"
                                    )
                                frac = (
                                    0.0
                                    if base
                                    else (
                                        t.incidence_by_dose[di]
                                        if di is not None
                                        else (t.positive_control_incidence or 0)
                                        if g == "positive"
                                        else 0.0
                                    )
                                )
                                v = float(
                                    t.finding_score
                                    if k < math.ceil(frac * n)
                                    else o.normal_score or 0
                                )
                                unit = "dimensionless"
                            rows.append(
                                {
                                    "subject_id": sid,
                                    "sex": sex,
                                    "group": g,
                                    "dose": None if g == "positive" else d,
                                    "observation": o.name,
                                    "timepoint": tp,
                                    "unit": unit,
                                    "result": v,
                                }
                            )
        return rows, "sim.cns_declared"
