"""Dose range-finding / MTD study (ICH M3(R2) sections 1.5 and 4).

A short parallel-group study that informs dose selection for the pivotal repeat-dose
studies and, when it defines an MTD, can supply the acute toxicity information M3(R2)
section 4 asks for. The laboratory returns numeric endpoints (body weight, food consumption,
clinical pathology) and observations (clinical signs, unscheduled deaths) per animal.

The driver:

* compares each dose group with the concurrent control per endpoint, descriptively or by
  Dunnett's test when the protocol states one (the analysis shared with the repeat-dose driver);
* tabulates, per group, animals at start, unscheduled deaths and animals showing each clinical
  sign (OECD TG 407 paragraph 50 format);
* states the M3(R2) section 1.5 high-dose facts that apply: the top dose against the
  1000 mg/kg/day limit dose and, when exposures are supplied, the margin to clinical exposure
  against the 10-fold and 50-fold statements.

M3(R2) does not define the MTD; the protocol states its MTD criteria and their basis. The MTD,
the basis for the pivotal high dose and the recommended doses are Study Director
determinations.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
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
from hos.drivers.repeat_dose_tox.driver import EndpointSpec
from hos.drivers.repeat_dose_tox.guidelines import M3R2_LIMIT_DOSE_MG_KG_DAY
from hos.kernel.attestation import Role

OBSERVATIONS = ("clinical_sign", "mortality")
#: ICH M3(R2) section 1.5 statements used as facts, each quoted in the interpretation
M3R2_MARGIN_ACCEPTABLE = 50.0  # "a 50-fold margin of exposure ... generally ... acceptable"
M3R2_MARGIN_EXCEPTION = 10.0  # "does not result in a mean exposure margin of 10-fold"
M3R2_CLINICAL_DOSE_G_DAY = 1.0  # "and the clinical dose exceeds 1 g per day"
M3R2_EXCEPTION_DOSE = 2000.0  # "or a dose of 2000 mg/kg/day or the MFD, whichever is lower"


class DRFParams(BaseModel):
    glp: bool
    species: Literal["rat", "mouse", "dog", "monkey", "minipig", "rabbit"]
    strain: str = Field(min_length=1)
    route: str = Field(min_length=1)
    vehicle: str = Field(min_length=1)
    include_control: bool
    dose_levels_mg_per_kg_day: list[float] = Field(min_length=1)
    sexes: list[Literal["M", "F"]] = Field(min_length=1)
    animals_per_sex_per_group: int = Field(ge=1)
    dosing_duration_days: int = Field(ge=1)
    endpoints: list[EndpointSpec] = Field(default_factory=list)
    timepoints: list[str] = Field(min_length=1)
    statistics: Literal["none", "dunnett"]
    alpha: float | None = Field(default=None, gt=0, lt=0.5)
    statistics_basis: str = Field(min_length=1, description="why this analysis (or none)")
    mtd_criteria: str = Field(
        min_length=1,
        description="the protocol's MTD criteria and their "
        "basis (ICH M3(R2) does not define the MTD)",
    )
    exposure_metric: Literal["AUC", "Cmax"] = Field(
        description="for exposure margins; M3(R2) Note 1: generally group-mean AUC, Cmax for "
        "acute cardiovascular or CNS effects"
    )
    concentration_unit: str = Field(min_length=1, description="for exposure inputs")

    @field_validator("dose_levels_mg_per_kg_day")
    @classmethod
    def _doses(cls, v: list[float]) -> list[float]:
        if any(d <= 0 for d in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("dose levels exclude the control and are strictly increasing")
        return v

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @model_validator(mode="after")
    def _design(self) -> DRFParams:
        errs = []
        if self.statistics == "dunnett":
            if self.alpha is None:
                errs.append("Dunnett's test needs its significance level alpha")
            if not self.include_control:
                errs.append("Dunnett's test compares each group with a concurrent control")
            if self.animals_per_sex_per_group < 2:
                errs.append("Dunnett's test needs at least two animals per group")
        elif self.alpha is not None:
            errs.append("alpha is given only when a statistical test is stated")
        names = [e.name for e in self.endpoints]
        if len(set(names)) != len(names) or set(names) & set(OBSERVATIONS):
            errs.append(f"endpoint names must be unique and not {list(OBSERVATIONS)}")
        if len(set(self.sexes)) != len(self.sexes):
            errs.append("sexes must be unique")
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def groups(self) -> list[float]:
        return ([0.0] if self.include_control else []) + list(self.dose_levels_mg_per_kg_day)

    def endpoint(self, name: str) -> EndpointSpec:
        return next(e for e in self.endpoints if e.name == name)

    def exposure_unit(self) -> str:
        return (
            f"{self.concentration_unit}*h"
            if self.exposure_metric == "AUC"
            else self.concentration_unit
        )


class EndpointEffect(BaseModel):
    endpoint: str
    control_mean: float
    cv: float = Field(ge=0, lt=1)
    effect_percent_by_dose: list[float]


class SignTruth(BaseModel):
    sign: str = Field(min_length=1)
    from_dose: float = Field(gt=0)
    fraction: float = Field(gt=0, le=1)
    timepoint: str


class DeathTruth(BaseModel):
    dose: float = Field(gt=0)
    count: int = Field(ge=1)
    timepoint: str
    description: str = Field(min_length=1)


class DRFSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    endpoints: list[EndpointEffect] = Field(default_factory=list)
    clinical_signs: list[SignTruth] = Field(default_factory=list)
    deaths: list[DeathTruth] = Field(default_factory=list)


def _sexes(sexes: list[str], n: int) -> str:
    """ "5M + 5F per group" from the protocol's sexes and group size."""
    return " + ".join(f"{n}{s}" for s in sexes) + " per group"


def _p(params: BaseModel) -> DRFParams:
    if not isinstance(params, DRFParams):
        raise TypeError("expected DRFParams")
    return params


class DoseRangeFindingDriver(StudyDriver):
    id = "dose_range_finding"
    name = "Dose range-finding / MTD study"
    version = "1.0.0"
    requirement_ids = ("tox.dose_range_finding",)
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.3.2"
    glp_capable = True
    description = (
        "Short parallel-group study for dose selection: group comparisons, "
        "clinical-sign and mortality incidence, M3(R2) 1.5 high-dose facts; MTD and "
        "recommended doses by the Study Director."
    )
    reference_keys = ("ich_m3r2", "oecd_tg407")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return DRFParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return DRFSimulation

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
            duration_of_dosing=f"{p.dosing_duration_days} days",
            doses=", ".join(fmt_param(d) for d in p.groups())
            + " mg/kg/day"
            + (" (0 = control)" if p.include_control else ""),
            gender_and_number=_sexes(list(p.sexes), p.animals_per_sex_per_group),
            # range-finding studies are always non-pivotal (M4S(R2) Appendix B, 2.6.7.6 note 1)
            listed_in=("2.6.7.1", "2.6.7.6"),
        )

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        top = p.dose_levels_mg_per_kg_day[-1]
        notes = []
        if top > M3R2_LIMIT_DOSE_MG_KG_DAY:
            notes.append(
                f"top dose {top:g} mg/kg/day exceeds the 1000 mg/kg/day limit dose; "
                "M3(R2) 1.5 allows more only when 1000 mg/kg/day gives under a 10-fold "
                "margin and the clinical dose exceeds 1 g/day"
            )
        design: dict[str, Any] = {
            "test_system": f"{p.species} ({p.strain}), sexes {', '.join(p.sexes)}",
            "route": f"{p.route}; vehicle {p.vehicle}",
            "groups": ("control, " if p.include_control else "no concurrent control, ")
            + ", ".join(f"{d:g}" for d in p.dose_levels_mg_per_kg_day)
            + f" mg/kg/day; {p.animals_per_sex_per_group} per sex per group",
            "duration": f"{p.dosing_duration_days} days of dosing",
            "endpoints": [f"{e.name} [{e.unit}]" for e in p.endpoints]
            + ["clinical signs", "mortality"],
            "timepoints": ", ".join(p.timepoints),
            "statistics": (
                f"Dunnett two-sided vs control, alpha {p.alpha:g}"
                if p.statistics == "dunnett"
                else "descriptive only"
            )
            + f" ({p.statistics_basis})",
            "mtd_criteria": p.mtd_criteria,
            "high_dose_rules": "M3(R2) 1.5: MTD, saturation of exposure, MFD, 50-fold exposure "
            "margin or the 1000 mg/kg/day limit dose; lethality is not an "
            "intended endpoint (M3(R2) 4)",
        }
        if notes:
            design["design_notes"] = notes
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Dose range-finding study of {compound.name} in the {p.species}",
            objective="Characterise tolerability over a dose range to select doses for the "
            "pivotal repeat-dose studies (ICH M3(R2) 1.5) and, where an MTD is "
            "defined, provide acute toxicity information (M3(R2) 4).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"species": p.species, "strain": p.strain},
            design=design,
            steps=(
                ProtocolStep(
                    1, "Dosing", f"Dose daily for {p.dosing_duration_days} days by {p.route}.", ()
                ),
                ProtocolStep(
                    2,
                    "Observations",
                    "Record clinical signs and any unscheduled "
                    "death or euthanasia with its time; lethality is not an intended "
                    "endpoint (M3(R2) 4).",
                    (),
                ),
                ProtocolStep(
                    3, "Measurements", "Record each declared endpoint at each timepoint.", ()
                ),
                ProtocolStep(
                    4,
                    "Return data",
                    "One row per animal x endpoint (or observation) "
                    "x timepoint per data_template.csv.",
                    (),
                ),
            ),
            acceptance_criteria=(),
            materials=(f"test article and vehicle ({p.vehicle})",),
            deliverables=("data CSV per template", "dose range-finding report"),
            glp=p.glp,
            references=(cite("ich_m3r2"), cite("oecd_tg407")),
            regulatory_basis=("ICH M3(R2) sections 1.5, 4",),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(p.groups()) * len(p.sexes) * p.animals_per_sex_per_group
        return StudyPlan(
            execution_duration_days=float(p.dosing_duration_days),
            duration_basis="dosing period per protocol; acclimatisation, necropsy and reporting "
            "are scheduled by the laboratory",
            sample_count=n,
            sample_count_basis="animals: groups x sexes x animals per group",
            dependencies=("dose formulation method",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {
                "group": i + 1,
                "dose_mg_per_kg_day": f"{d:g}",
                "sex": s,
                "animals": p.animals_per_sex_per_group,
            }
            for i, d in enumerate(p.groups())
            for s in p.sexes
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="Long format. Numeric endpoints: one row per animal x endpoint x "
            "timepoint with unit and value. Observations: endpoint clinical_sign "
            "(observation = the sign) or mortality (observation = found dead / "
            "euthanised moribund, with the timepoint), no value.",
            columns=(
                DataColumn("subject_id", "laboratory animal id", kind="text"),
                DataColumn("sex", "M or F", kind="text", choices=tuple(p.sexes)),
                DataColumn("dose", "dose group", unit="mg/kg/day", minimum=0),
                DataColumn(
                    "endpoint",
                    "endpoint name, clinical_sign or mortality",
                    kind="text",
                    choices=(*[e.name for e in p.endpoints], *OBSERVATIONS),
                ),
                DataColumn(
                    "timepoint",
                    "protocol timepoint for numeric endpoints; the day "
                    "observed for clinical signs and deaths",
                    kind="text",
                ),
                DataColumn("unit", "unit of value", kind="text", required=False),
                DataColumn("value", "observed value", unit_column="unit", required=False),
                DataColumn(
                    "observation",
                    "clinical sign or mortality description",
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
        subj: dict[str, tuple[str, float]] = {}
        seen: set[tuple[str, str, str, str]] = set()
        for i, r in enumerate(records, start=1):
            match = [d for d in p.groups() if dose_eq(d, r["dose"])]
            if not match:
                errors.append(f"row {i}: dose {r['dose']:g} is not a group in the design")
                continue
            prev = subj.setdefault(r["subject_id"], (r["sex"], match[0]))
            if prev != (r["sex"], match[0]):
                errors.append(f"row {i}: subject {r['subject_id']} changes sex or dose")
            if r["endpoint"] in OBSERVATIONS:
                if not r.get("observation") or r.get("value") is not None:
                    errors.append(f"row {i}: {r['endpoint']} rows give an observation and no value")
                key = (r["subject_id"], r["endpoint"], r["timepoint"], str(r.get("observation")))
            else:
                if r["timepoint"] not in p.timepoints:
                    errors.append(
                        f"row {i}: timepoint {r['timepoint']!r} is not in the protocol "
                        f"{p.timepoints}"
                    )
                if r.get("value") is None or not r.get("unit"):
                    errors.append(f"row {i}: {r['endpoint']} needs a value and unit")
                elif not U.compatible(r["unit"], p.endpoint(r["endpoint"]).unit):
                    errors.append(f"row {i}: unit {r['unit']!r} incompatible with {r['endpoint']}")
                key = (r["subject_id"], r["endpoint"], r["timepoint"], "")
            if key in seen:
                errors.append(f"row {i}: duplicate row {key}")
            seen.add(key)
        return errors, []

    # -- analysis ------------------------------------------------------------------------

    def analysis_inputs(self, params: BaseModel) -> Mapping[str, str]:
        u = _p(params).exposure_unit()
        return {
            "animal_exposure_at_top_dose": u,
            "clinical_exposure": u,
            "clinical_dose_per_day": "g/day",
        }

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        numeric = [dict(r, phase="main") for r in data.records if r["endpoint"] not in OBSERVATIONS]
        cmp_ = compare_groups(
            numeric,
            endpoint_unit=lambda e: p.endpoint(e).unit,
            groups=p.groups(),
            alpha=p.alpha if p.statistics == "dunnett" else None,
            prov_note=f"file sha256 {data.file_sha256[:16]}",
        )
        tables = []
        if cmp_.rows:
            tables.append(
                tabulate(
                    "Dose-group comparisons with control"
                    + (" (Dunnett, two-sided)" if p.statistics == "dunnett" else ""),
                    (
                        "endpoint",
                        "sex",
                        "phase",
                        "timepoint",
                        "dose",
                        "n",
                        "mean (SD)",
                        "% vs control",
                        "p (Dunnett)",
                        "significant",
                    ),
                    cmp_.rows,
                    note=("descriptive only: " + p.statistics_basis)
                    if p.statistics == "none"
                    else "Statistical significance is not adversity.",
                )
            )
        q = dict(cmp_.quantities)

        # incidence (OECD TG 407 paragraph 50 format)
        m_inc = method("tox.incidence")
        animals: dict[tuple[float, str], set[str]] = defaultdict(set)
        deaths: dict[tuple[float, str], list[str]] = defaultdict(list)
        signs: dict[tuple[float, str, str], set[str]] = defaultdict(set)
        for r in data.records:
            d = next(g for g in p.groups() if dose_eq(g, r["dose"]))
            animals[(d, r["sex"])].add(str(r["subject_id"]))
            if r["endpoint"] == "mortality":
                deaths[(d, r["sex"])].append(
                    f"{r['subject_id']} ({r['timepoint']}: {r['observation']})"
                )
            elif r["endpoint"] == "clinical_sign":
                signs[(d, r["sex"], str(r["observation"]))].add(str(r["subject_id"]))
        inc_rows = []
        for (d, sex), ids in sorted(animals.items()):
            inc_rows.append(
                (
                    f"{d:g}",
                    sex,
                    len(ids),
                    len(deaths[(d, sex)]),
                    "; ".join(deaths[(d, sex)]) or "-",
                    len(
                        {a for (dd, ss, _), v in signs.items() if dd == d and ss == sex for a in v}
                    ),
                )
            )
        tables.append(
            tabulate(
                "Group incidence",
                (
                    "dose (mg/kg/day)",
                    "sex",
                    "animals",
                    "unscheduled deaths",
                    "deaths (time)",
                    "animals with signs",
                ),
                inc_rows,
                note="OECD TG 407 paragraph 50 format",
            )
        )
        sign_rows = [
            (f"{d:g}", sex, sign, f"{len(ids)}/{len(animals[(d, sex)])}")
            for (d, sex, sign), ids in sorted(signs.items())
        ]
        if sign_rows:
            tables.append(
                tabulate(
                    "Clinical signs",
                    ("dose (mg/kg/day)", "sex", "sign", "animals affected"),
                    sign_rows,
                )
            )
        total_deaths = sum(len(v) for v in deaths.values())
        q["deaths.unscheduled"] = Quantity.computed(
            float(total_deaths),
            "dimensionless",
            method=m_inc,
            label="unscheduled deaths, all groups",
        )

        # M3(R2) 1.5 high-dose facts
        a, c = inputs.get("animal_exposure_at_top_dose"), inputs.get("clinical_exposure")
        if a is not None and c is not None:
            u = p.exposure_unit()
            q["margin.top_dose"] = Quantity.computed(
                a.magnitude_in(u) / c.magnitude_in(u),
                "dimensionless",
                method=method("tox.exposure_margin_m3r2"),
                inputs=[a, c],
                label=f"exposure margin at the top dose ({p.exposure_metric})",
            )
        cd = inputs.get("clinical_dose_per_day")
        if cd is not None:
            q["clinical_dose_g_per_day"] = cd
        findings: list[QCFinding] = []
        if not data.records:
            findings.append(QCFinding("no_data", QCStatus.FAIL, "no analysable data"))
        for (d, sex), ids in sorted(animals.items()):
            if len(ids) < p.animals_per_sex_per_group:
                findings.append(
                    QCFinding(
                        f"animals.{d:g}.{sex}",
                        QCStatus.WARN,
                        f"{d:g} mg/kg/day {sex}: {len(ids)} of "
                        f"{p.animals_per_sex_per_group} animals returned",
                    )
                )
        return AnalysisResult(
            quantities=q,
            tables=tuple(tables),
            qc=QCVerdict.of(findings),
            evidence_admissible=True,
            notes=tuple(cmp_.notes)
            + tuple(
                f"unscheduled death at {d:g} mg/kg/day ({sex}): {x}"
                for (d, sex), v in sorted(deaths.items())
                for x in v
            ),
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        top = p.dose_levels_mg_per_kg_day[-1]
        if top >= M3R2_LIMIT_DOSE_MG_KG_DAY:
            out.append(
                InterpretiveStatement(
                    f"The top dose ({top:g} mg/kg/day) reaches the 1000 mg/kg/day limit dose that "
                    "M3(R2) 1.5 considers appropriate for rodents and non-rodents, except where it "
                    "gives under a 10-fold exposure margin and the clinical dose exceeds 1 g/day.",
                    "ICH M3(R2) 1.5 limit dose",
                    ("ich_m3r2",),
                    "info",
                )
            )
        mq = analysis.quantities.get("margin.top_dose")
        cd = analysis.quantities.get("clinical_dose_g_per_day")
        if mq is not None:
            m = mq.require()
            out.append(
                InterpretiveStatement(
                    f"Exposure margin at the top dose: {m:.3g}-fold ({p.exposure_metric}).",
                    "ICH M3(R2) 1.5 and Note 1",
                    ("ich_m3r2",),
                    "info",
                )
            )
            if m >= M3R2_MARGIN_ACCEPTABLE:
                out.append(
                    InterpretiveStatement(
                        "The top dose provides at least a 50-fold exposure margin, which M3(R2) 1.5 "
                        "generally considers acceptable as the maximum dose; to support US Phase III, "
                        "dose-limiting toxicity generally should be identified in at least one "
                        "species when this margin is the limit.",
                        "ICH M3(R2) 1.5 50-fold margin",
                        ("ich_m3r2",),
                        "notable",
                    )
                )
            if (
                cd is not None
                and top >= M3R2_LIMIT_DOSE_MG_KG_DAY
                and m < M3R2_MARGIN_EXCEPTION
                and cd.magnitude_in("g/day") > M3R2_CLINICAL_DOSE_G_DAY
            ):
                out.append(
                    InterpretiveStatement(
                        "1000 mg/kg/day gives under a 10-fold margin and the clinical dose exceeds "
                        "1 g/day: M3(R2) 1.5 limits doses by a 10-fold exposure margin, 2000 "
                        "mg/kg/day or the MFD, whichever is lower.",
                        "ICH M3(R2) 1.5 exception",
                        ("ich_m3r2",),
                        "notable",
                    )
                )
        deaths = [n.split(": ", 1)[1] for n in analysis.notes if n.startswith("unscheduled death")]
        if deaths:
            out.append(
                InterpretiveStatement(
                    f"{len(deaths)} unscheduled deaths occurred. M3(R2) 4: lethality should not be an "
                    "intended endpoint in studies assessing acute toxicity.",
                    "ICH M3(R2) 4",
                    ("ich_m3r2",),
                    "concern",
                )
            )
        for k, v in analysis.quantities.items():
            if k.endswith("|p"):
                _, endpoint, sex, _, tp, dose = k[:-2].split("|")
                out.append(
                    InterpretiveStatement(
                        f"Statistically significant difference in {endpoint} ({sex}, {tp}) at {dose} "
                        f"mg/kg/day versus control (Dunnett p = {v.require():.3g}).",
                        f"Dunnett two-sided, alpha {p.alpha:g}",
                        ("dunnett1955",),
                        "notable",
                    )
                )
        if not out:
            out.append(
                InterpretiveStatement(
                    "Group results are tabulated for the Study Director's MTD assessment against the "
                    "protocol's criteria.",
                    "ICH M3(R2) 1.5, 4",
                    ("ich_m3r2",),
                    "info",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                f"MTD against the protocol criteria ({p.mtd_criteria})",
                "Basis and value of the pivotal-study high dose (M3(R2) 1.5)",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "mtd",
                "Maximum tolerated dose",
                "mg/kg/day",
                Role.STUDY_DIRECTOR,
                True,
                "The MTD against the protocol's stated criteria (M3(R2) does not define them); "
                "record 'not established' if the top dose was tolerated.",
            ),
            ExpertDetermination(
                "high_dose_basis",
                "Basis for the pivotal-study high dose",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Which M3(R2) 1.5 basis governs the high dose of the pivotal studies.",
                choices=(
                    "mtd",
                    "limit_dose",
                    "exposure_saturation",
                    "maximum_feasible_dose",
                    "exposure_margin_50x",
                ),
            ),
            ExpertDetermination(
                "recommended_high_dose",
                "Recommended pivotal high dose",
                "mg/kg/day",
                Role.STUDY_DIRECTOR,
                True,
                "High dose recommended for the pivotal studies.",
            ),
            ExpertDetermination(
                "recommended_mid_dose",
                "Recommended pivotal mid dose",
                "mg/kg/day",
                Role.STUDY_DIRECTOR,
                False,
                "Optional.",
            ),
            ExpertDetermination(
                "recommended_low_dose",
                "Recommended pivotal low dose",
                "mg/kg/day",
                Role.STUDY_DIRECTOR,
                False,
                "Optional.",
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
        lines = []
        for d in determinations:
            val = d.get("category")
            if val is None:
                qd = d.get("quantity") or {}
                val = (
                    f"{qd.get('value'):g} {qd.get('unit')}"
                    if qd.get("available")
                    else "not established"
                )
            lines.append(f"{d['label']}: {val} ({d['signer_name']}, {d['role']})")
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + (
                    " ".join(lines)
                    if lines
                    else "MTD and recommended doses not yet determined by the Study Director."
                ),
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection("Results", "Group comparisons and incidence.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, DRFSimulation)
        eff = {e.endpoint: e for e in s.endpoints}
        for e in p.endpoints:
            if e.name not in eff or len(eff[e.name].effect_percent_by_dose) != len(
                p.dose_levels_mg_per_kg_day
            ):
                raise ValueError(f"simulation needs {e.name!r} with one effect per dose level")
        rows: list[dict[str, Any]] = []
        for gi, d in enumerate(p.groups()):
            di = p.dose_levels_mg_per_kg_day.index(d) if d > 0 else None
            for sex in p.sexes:
                n = p.animals_per_sex_per_group
                ids = [f"{sex}{gi + 1}-{a + 1:02d}" for a in range(n)]
                dead = {x.timepoint: x for x in s.deaths if dose_eq(x.dose, d)}
                for k, sid in enumerate(ids):
                    for e in p.endpoints:
                        t = eff[e.name]
                        mu = t.control_mean * (
                            1 + (0.0 if di is None else t.effect_percent_by_dose[di]) / 100.0
                        )
                        for tp in p.timepoints:
                            v = float(rng.normal(mu, t.cv * abs(mu))) if t.cv else mu
                            rows.append(
                                {
                                    "subject_id": sid,
                                    "sex": sex,
                                    "dose": d,
                                    "endpoint": e.name,
                                    "timepoint": tp,
                                    "unit": e.unit,
                                    "value": v,
                                    "observation": None,
                                }
                            )
                    for sg in s.clinical_signs:
                        if d >= sg.from_dose and k < math.ceil(sg.fraction * n):
                            rows.append(
                                {
                                    "subject_id": sid,
                                    "sex": sex,
                                    "dose": d,
                                    "endpoint": "clinical_sign",
                                    "timepoint": sg.timepoint,
                                    "unit": None,
                                    "value": None,
                                    "observation": sg.sign,
                                }
                            )
                    for tp, x in dead.items():
                        if k < x.count:
                            rows.append(
                                {
                                    "subject_id": sid,
                                    "sex": sex,
                                    "dose": d,
                                    "endpoint": "mortality",
                                    "timepoint": tp,
                                    "unit": None,
                                    "value": None,
                                    "observation": x.description,
                                }
                            )
        return rows, "sim.drf_declared_effects"
