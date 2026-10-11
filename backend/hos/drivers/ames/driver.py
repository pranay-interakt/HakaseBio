"""Bacterial reverse mutation (Ames) test, OECD TG 471 (1997, corrected 2020), with the ICH
S2(R1) overlay for pharmaceuticals.

The protocol is checked against TG 471: at least five strains in the recommended combination
(paragraph 13), with and without metabolic activation (16), at least five analysable
concentrations (20), top dose by the 5 mg/plate limit, cytotoxicity or solubility (19, 21),
triplicate plating (29), concurrent strain-specific positive and vehicle controls (22),
untreated controls unless waived on historical data (26), and incubation at 37 °C for
48-72 h (31).

The laboratory returns one row per plate. The driver reports, per experiment, strain and
activation condition, the individual counts, mean and SD (32-33); the fold over the concurrent
vehicle mean (for information only: neither TG 471 nor S2(R1) sets a fold threshold); and
comparisons with the facility's historical control ranges, a required input (14, 39; S2(R1)
5.1). The positive / negative / equivocal call follows TG 471 paragraphs 35-37 and is the
Study Director's.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core.citations import cite
from hos.core.methods import method
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
    ProtocolDocument,
    ProtocolStep,
    ReportSection,
    StudyDriver,
    StudyPlan,
    tabulate,
)
from hos.kernel.attestation import Role

#: TG 471 paragraph 13: the recommended combination, one strain from each slot.
STRAIN_SLOTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("S. typhimurium TA1535", ("TA1535",)),
    ("S. typhimurium TA1537 or TA97 or TA97a", ("TA1537", "TA97", "TA97a")),
    ("S. typhimurium TA98", ("TA98",)),
    ("S. typhimurium TA100", ("TA100",)),
    (
        "E. coli WP2 uvrA, or E. coli WP2 uvrA (pKM101), or S. typhimurium TA102",
        ("WP2 uvrA", "WP2 uvrA (pKM101)", "TA102"),
    ),
)
KNOWN_STRAINS = (
    "TA1535",
    "TA1537",
    "TA97",
    "TA97a",
    "TA98",
    "TA100",
    "TA102",
    "WP2 uvrA",
    "WP2 uvrA (pKM101)",
    "WP2",
    "WP2 (pKM101)",
)
#: TG 471 paragraph 19 / S2(R1) 3.2.1: 5 mg/plate (5000 ug) or 5 ul/plate
TOP_DOSE_LIMIT = {"ug": 5000.0, "uL": 5.0}
S9 = ("plus", "minus")
TREATMENTS = ("test", "vehicle", "untreated", "positive")


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


class PositiveControlSpec(BaseModel):
    strain: str
    s9: Literal["plus", "minus"]
    substance: str = Field(min_length=1)
    amount_per_plate: str = Field(min_length=1, description="e.g. 1 ug/plate")


class HistoricalRange(BaseModel):
    strain: str
    s9: Literal["plus", "minus"]
    control: Literal["negative", "positive"]
    mean: float = Field(ge=0)
    sd: float = Field(ge=0)
    lower: float = Field(ge=0)
    upper: float = Field(ge=0)
    range_type: str = Field(min_length=1, description="e.g. 95% control limits, or min-max")
    reference: str = Field(min_length=1, description="historical database and period")

    @model_validator(mode="after")
    def _range(self) -> HistoricalRange:
        if self.upper < self.lower:
            raise ValueError("historical range upper limit is below its lower limit")
        return self


class AmesParams(BaseModel):
    glp: bool
    guideline: Literal["oecd_tg471"]
    method: Literal["plate_incorporation", "preincubation"]
    preincubation_minutes: float | None = Field(default=None, gt=0)
    preincubation_temperature_c: float | None = None
    strains: list[str] = Field(min_length=1)
    strain_set_justification: str | None = None
    metabolic_activation: str = Field(min_length=1, description="e.g. induced rat liver S9")
    s9_percent_v_v: float = Field(gt=0, le=100)
    vehicle: str = Field(min_length=1)
    untreated_control: bool
    untreated_waiver_basis: str | None = None
    concentration_unit: Literal["ug", "uL"] = Field(description="amount per plate")
    concentrations: list[float] = Field(min_length=1, description="per plate")
    top_dose_basis: Literal[
        "limit_5_mg_per_plate", "cytotoxicity", "solubility", "above_limit_impurities"
    ]
    top_dose_justification: str = Field(min_length=1)
    plates_per_dose: int = Field(ge=1)
    duplicate_plating_justification: str | None = None
    incubation_temperature_c: float
    incubation_hours: float = Field(gt=0)
    positive_controls: list[PositiveControlSpec] = Field(min_length=1)
    historical_controls: list[HistoricalRange] = Field(min_length=1)

    @field_validator("concentrations")
    @classmethod
    def _concs(cls, v: list[float]) -> list[float]:
        if any(c <= 0 for c in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("concentrations are positive and strictly increasing")
        return v

    @model_validator(mode="after")
    def _design(self) -> AmesParams:
        errs = []
        unknown = [s for s in self.strains if s not in KNOWN_STRAINS]
        if unknown:
            errs.append(f"unknown strains {unknown}; TG 471 strains are {list(KNOWN_STRAINS)}")
        if len(set(self.strains)) != len(self.strains):
            errs.append("strains must be unique")
        if len(self.strains) < 5:
            errs.append("at least five strains should be used (TG 471 paragraph 13)")
        missing = [
            label for label, opts in STRAIN_SLOTS if not any(s in opts for s in self.strains)
        ]
        if missing and not (self.strain_set_justification or "").strip():
            errs.append(
                "the recommended combination (TG 471 paragraph 13) lacks: "
                + "; ".join(missing)
                + " (state strain_set_justification to deviate)"
            )
        if len(self.concentrations) < 5:
            errs.append(
                "at least five analysable concentrations should be used (TG 471 paragraph 20)"
            )
        limit = TOP_DOSE_LIMIT[self.concentration_unit]
        top = self.concentrations[-1]
        if top > limit * (1 + 1e-9) and self.top_dose_basis != "above_limit_impurities":
            errs.append(
                f"top concentration {top:g} exceeds 5 mg/plate or 5 ul/plate; only "
                "substantial mutagenic impurities justify that (TG 471 paragraph 21)"
            )
        if self.top_dose_basis == "limit_5_mg_per_plate" and not _same(top, limit):
            errs.append(
                f"the stated basis is the 5 mg/plate limit but the top concentration "
                f"is {top:g} {self.concentration_unit}/plate (TG 471 paragraph 19)"
            )
        if self.plates_per_dose < 2 or (
            self.plates_per_dose == 2 and not (self.duplicate_plating_justification or "").strip()
        ):
            errs.append(
                "triplicate plating; duplicate only when scientifically justified (TG 471 "
                "paragraph 29)"
            )
        if not self.untreated_control and not (self.untreated_waiver_basis or "").strip():
            errs.append(
                "untreated controls are needed unless historical data show the solvent "
                "has no deleterious or mutagenic effect (TG 471 paragraph 26)"
            )
        if not _same(self.incubation_temperature_c, 37) or not 48 <= self.incubation_hours <= 72:
            errs.append("plates should be incubated at 37 °C for 48-72 hours (TG 471 paragraph 31)")
        if (self.method == "preincubation") != (
            self.preincubation_minutes is not None and self.preincubation_temperature_c is not None
        ):
            errs.append(
                "preincubation time and temperature are given for, and only for, the "
                "preincubation method"
            )
        for s in self.strains:
            for c in S9:
                if not any(pc.strain == s and pc.s9 == c for pc in self.positive_controls):
                    errs.append(f"no positive control for {s} with S9 {c} (TG 471 paragraph 22)")
                if not any(
                    h.strain == s and h.s9 == c and h.control == "negative"
                    for h in self.historical_controls
                ):
                    errs.append(
                        f"no historical negative-control range for {s} with S9 {c} "
                        "(TG 471 paragraphs 14, 39)"
                    )
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def notes(self) -> list[str]:
        out = []
        if not 5 <= self.s9_percent_v_v <= 30:
            out.append(f"S9 at {self.s9_percent_v_v:g}% v/v; TG 471 paragraph 16: usually 5-30%")
        if self.method == "preincubation" and (
            (self.preincubation_minutes or 0) < 20
            or not 30 <= (self.preincubation_temperature_c or 0) <= 37
        ):
            out.append(
                "preincubation outside 'usually for 20 min. or more at 30-37 °C' (TG 471 "
                "paragraph 28)"
            )
        ratios = [b / a for a, b in pairwise(self.concentrations)]
        if any(r > 10**0.5 * 1.05 for r in ratios):
            out.append(
                "spacing wider than approximately half-log (√10) in places (TG 471 "
                "paragraph 20, initial experiment)"
            )
        if self.plates_per_dose == 2:
            out.append(f"duplicate plating: {self.duplicate_plating_justification}")
        if self.strain_set_justification:
            out.append(f"strain set: {self.strain_set_justification}")
        return out

    def historical(self, strain: str, s9: str, control: str) -> HistoricalRange | None:
        return next(
            (
                h
                for h in self.historical_controls
                if h.strain == strain and h.s9 == s9 and h.control == control
            ),
            None,
        )


class StrainTruth(BaseModel):
    strain: str
    s9: Literal["plus", "minus"]
    vehicle_mean: float = Field(ge=0)
    positive_mean: float = Field(ge=0)
    fold_by_concentration: list[float] = Field(
        description="true mean / vehicle mean at each protocol concentration"
    )


class AmesSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    truth: list[StrainTruth] = Field(min_length=1)
    count_model: Literal["expected", "poisson"] = Field(
        description="expected: the declared mean rounded; poisson: Poisson-sampled counts"
    )
    lawn_reduced_from: float | None = Field(
        default=None,
        gt=0,
        description="concentration at and above which the background lawn is reduced",
    )
    precipitate_from: float | None = Field(default=None, gt=0)


def _p(params: BaseModel) -> AmesParams:
    if not isinstance(params, AmesParams):
        raise TypeError("expected AmesParams")
    return params


class AmesDriver(StudyDriver):
    id = "ames"
    name = "Bacterial reverse mutation test (Ames, OECD TG 471)"
    version = "1.0.0"
    requirement_ids = ("genotox.ames",)
    modalities = frozenset({Modality.SMALL_MOLECULE, Modality.PEPTIDE})
    ctd_section = "4.2.3.3.1"
    glp_capable = True
    description = (
        "Revertant counts by strain, metabolic activation and concentration against "
        "the concurrent and historical controls; the call is the Study Director's."
    )
    reference_keys = ("oecd_tg471", "ich_s2r1")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return AmesParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return AmesSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        return {"glp": requirement.glp, "guideline": "oecd_tg471"}

    # -- design ----------------------------------------------------------------------

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        u = f"{p.concentration_unit}/plate"
        notes = p.notes()
        if context is not None and context.modality is Modality.PEPTIDE:
            notes.append(
                "peptide: ICH S2(R1) 5.2.1 states the bacterial reversion assay is not "
                "suitable for a peptide that is likely to degrade (amino-acid "
                "contamination)"
            )
        design: dict[str, Any] = {
            "strains": ", ".join(p.strains),
            "metabolic_activation": f"with and without {p.metabolic_activation} "
            f"({p.s9_percent_v_v:g}% v/v in the S9-mix)",
            "method": p.method.replace("_", " ")
            + (
                f" ({p.preincubation_minutes:g} min at {p.preincubation_temperature_c:g} °C)"
                if p.method == "preincubation"
                else ""
            ),
            "concentrations": ", ".join(f"{c:g}" for c in p.concentrations) + f" {u}",
            "top_dose": f"{p.concentrations[-1]:g} {u}: {p.top_dose_basis.replace('_', ' ')} "
            f"({p.top_dose_justification})",
            "plates": f"{p.plates_per_dose} per concentration and control",
            "controls": f"vehicle ({p.vehicle})"
            + (
                ", untreated"
                if p.untreated_control
                else f"; untreated waived: {p.untreated_waiver_basis}"
            )
            + "; strain-specific positive controls",
            "positive_controls": [
                f"{pc.strain} S9 {pc.s9}: {pc.substance} {pc.amount_per_plate}"
                for pc in p.positive_controls
            ],
            "historical_controls": [
                f"{h.strain} S9 {h.s9} {h.control}: mean {h.mean:g}, SD "
                f"{h.sd:g}, {h.range_type} {h.lower:g}-{h.upper:g} "
                f"({h.reference})"
                for h in p.historical_controls
            ],
            "incubation": f"{p.incubation_temperature_c:g} °C for {p.incubation_hours:g} h",
            "evaluation": "TG 471 paragraphs 35-37: concentration-related and/or reproducible "
            "increase, biological relevance first; the call is the Study "
            "Director's",
        }
        if notes:
            design["design_notes"] = notes
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Bacterial reverse mutation test of {compound.name} (OECD TG 471)",
            objective="Detect point mutations by reversion in amino-acid-requiring strains of "
            "S. typhimurium and E. coli (OECD TG 471; ICH S2(R1)).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"strains": list(p.strains)},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Cultures",
                    "Grow each strain to late exponential or early "
                    "stationary phase (approximately 10^9 cells/ml) at 37 °C (TG 471 "
                    "paragraphs 11-12); confirm strain characteristics.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Treatment",
                    f"{p.method.replace('_', ' ')} with and without "
                    f"S9 at each concentration, vehicle, positive"
                    + (" and untreated" if p.untreated_control else "")
                    + " controls, "
                    f"{p.plates_per_dose} plates each.",
                    (),
                ),
                ProtocolStep(
                    3,
                    "Incubation and scoring",
                    f"{p.incubation_hours:g} h at "
                    f"{p.incubation_temperature_c:g} °C; count revertant colonies; "
                    "record background lawn and precipitate per plate.",
                    (),
                ),
                ProtocolStep(4, "Return data", "One row per plate per data_template.csv.", ()),
            ),
            acceptance_criteria=(
                AcceptanceCriterion(
                    "tg471.vehicle_historical",
                    "vehicle-control counts within the laboratory's historical range",
                    "oecd_tg471 para 14",
                ),
                AcceptanceCriterion(
                    "tg471.analysable",
                    "at least five analysable concentrations",
                    "oecd_tg471 para 20",
                ),
            ),
            materials=(
                f"strains {', '.join(p.strains)}",
                p.metabolic_activation,
                p.vehicle,
                *sorted({pc.substance for pc in p.positive_controls}),
            ),
            deliverables=("data CSV per template", "bacterial reverse mutation test report"),
            glp=p.glp,
            references=(cite("oecd_tg471"), cite("ich_s2r1")),
            regulatory_basis=("OECD TG 471", "ICH S2(R1)"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        per = len(p.concentrations) + 2 + (1 if p.untreated_control else 0)
        n = len(p.strains) * 2 * per * p.plates_per_dose
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"incubation {p.incubation_hours:g} h per experiment; any "
            "confirmatory experiment and scheduling are set by the laboratory",
            sample_count=n,
            sample_count_basis="strains x (with, without S9) x (concentrations + vehicle + "
            "positive [+ untreated]) x plates, one experiment",
            dependencies=("strain characterisation and S9 batch qualification",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        rows: list[dict[str, Any]] = []
        for s in p.strains:
            for c in S9:
                rows += [
                    {
                        "strain": s,
                        "s9": c,
                        "treatment": "test",
                        "concentration": f"{x:g}",
                        "plates": p.plates_per_dose,
                    }
                    for x in p.concentrations
                ]
                rows.append(
                    {
                        "strain": s,
                        "s9": c,
                        "treatment": "vehicle",
                        "concentration": "",
                        "plates": p.plates_per_dose,
                    }
                )
                rows.append(
                    {
                        "strain": s,
                        "s9": c,
                        "treatment": "positive",
                        "concentration": "",
                        "plates": p.plates_per_dose,
                    }
                )
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per plate. s9 is plus or minus. concentration is the test "
            f"article amount per plate ({p.concentration_unit}/plate), empty for "
            "controls. background_lawn and precipitate as observed (TG 471 "
            "paragraph 19).",
            columns=(
                DataColumn("experiment", "experiment identifier (e.g. 1, 2)", kind="text"),
                DataColumn("strain", "tester strain", kind="text", choices=tuple(p.strains)),
                DataColumn("s9", "metabolic activation", kind="text", choices=S9),
                DataColumn(
                    "treatment",
                    "test, vehicle, untreated or positive",
                    kind="text",
                    choices=TREATMENTS
                    if p.untreated_control
                    else tuple(t for t in TREATMENTS if t != "untreated"),
                ),
                DataColumn(
                    "concentration",
                    "test article per plate",
                    unit=p.concentration_unit,
                    required=False,
                    exclusive_minimum=True,
                    minimum=0,
                ),
                DataColumn("plate", "plate number", kind="integer", minimum=1),
                DataColumn(
                    "revertants", "revertant colonies on the plate", kind="integer", minimum=0
                ),
                DataColumn(
                    "background_lawn",
                    "normal, reduced or absent",
                    kind="text",
                    choices=("normal", "reduced", "absent"),
                    required=False,
                ),
                DataColumn(
                    "precipitate",
                    "precipitate visible to the unaided eye",
                    kind="text",
                    choices=("yes", "no"),
                    required=False,
                ),
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[Any, ...]] = set()
        for i, r in enumerate(records, start=1):
            conc = r.get("concentration")
            if r["treatment"] == "test":
                if conc is None or not any(_same(conc, c) for c in p.concentrations):
                    errors.append(f"row {i}: test plates need a protocol concentration")
            elif conc is not None:
                errors.append(
                    f"row {i}: {r['treatment']} plates have no test-article concentration"
                )
            key = (r["experiment"], r["strain"], r["s9"], r["treatment"], conc, r["plate"])
            if key in seen:
                errors.append(f"row {i}: duplicate plate {key}")
            seen.add(key)
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
        m_sum, m_fold = method("genetox.revertant_summary"), method("genetox.fold_over_vehicle")
        u = f"{p.concentration_unit}/plate"
        cells: dict[tuple[str, str, str], dict[tuple[str, float | None], list[Mapping[str, Any]]]]
        cells = defaultdict(lambda: defaultdict(list))
        for r in data.records:
            cells[(str(r["experiment"]), str(r["strain"]), str(r["s9"]))][
                (str(r["treatment"]), r.get("concentration"))
            ].append(r)
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        rows: list[tuple[Any, ...]] = []
        above_hist: list[str] = []

        def summary(rs: list[Mapping[str, Any]], label: str) -> Quantity:
            v = [float(r["revertants"]) for r in rs]
            sd = float(np.std(v, ddof=1)) if len(v) > 1 else None
            return Quantity.computed(
                float(np.mean(v)),
                "dimensionless",
                method=m_sum,
                label=f"{label} (n={len(v)})",
                uncertainty=Uncertainty(kind="sd", sd=sd, n=len(v)) if sd is not None else None,
            )

        for (exp, strain, s9), groups in sorted(cells.items()):
            tag = f"exp {exp} {strain} S9 {s9}"
            veh_rows = groups.get(("vehicle", None), [])
            veh = summary(veh_rows, f"vehicle {tag}") if veh_rows else None
            if veh is None:
                findings.append(
                    QCFinding(
                        f"vehicle.missing.{tag}",
                        QCStatus.FAIL,
                        f"{tag}: no concurrent vehicle control (TG 471 22)",
                    )
                )
            hneg = p.historical(strain, s9, "negative")
            hpos = p.historical(strain, s9, "positive")
            if veh is not None:
                q[f"mean.{exp}.{strain}.{s9}.vehicle"] = veh
                if hneg and not hneg.lower <= veh.require() <= hneg.upper:
                    findings.append(
                        QCFinding(
                            f"vehicle.historical.{tag}",
                            QCStatus.WARN,
                            f"{tag}: vehicle mean {veh.require():.1f} outside the historical "
                            f"negative range {hneg.lower:g}-{hneg.upper:g} ({hneg.range_type}) "
                            "(TG 471 paragraph 14)",
                        )
                    )
                rows.append((exp, strain, s9, "vehicle", "", veh, None, len(veh_rows), "", ""))
            for label in ("untreated", "positive"):
                rs = groups.get((label, None), [])
                if not rs:
                    if label == "positive":
                        findings.append(
                            QCFinding(
                                f"positive.missing.{tag}",
                                QCStatus.FAIL,
                                f"{tag}: no concurrent positive control (TG 471 paragraph 22)",
                            )
                        )
                    continue
                sq = summary(rs, f"{label} {tag}")
                q[f"mean.{exp}.{strain}.{s9}.{label}"] = sq
                fold = (
                    Quantity.computed(
                        sq.require() / veh.require(),
                        "dimensionless",
                        method=m_fold,
                        inputs=[sq, veh],
                        label=f"{label} fold over vehicle {tag}",
                    )
                    if veh is not None and veh.require() > 0
                    else None
                )
                rows.append((exp, strain, s9, label, "", sq, fold, len(rs), "", ""))
                if label == "positive" and hpos and not hpos.lower <= sq.require() <= hpos.upper:
                    findings.append(
                        QCFinding(
                            f"positive.historical.{tag}",
                            QCStatus.WARN,
                            f"{tag}: positive-control mean {sq.require():.1f} outside the historical "
                            f"positive range {hpos.lower:g}-{hpos.upper:g} (TG 471 paragraph 39)",
                        )
                    )
            analysable = 0
            cytotoxic = soluble_limit = False
            for conc in p.concentrations:
                rs = next(
                    (
                        v
                        for (t, c), v in groups.items()
                        if t == "test" and c is not None and _same(c, conc)
                    ),
                    [],
                )
                if not rs:
                    continue
                lawns = {str(r["background_lawn"]) for r in rs if r.get("background_lawn")}
                precip = any(r.get("precipitate") == "yes" for r in rs)
                cytotoxic |= bool(lawns & {"reduced", "absent"})
                soluble_limit |= precip
                if "absent" not in lawns:
                    analysable += 1
                if len(rs) < p.plates_per_dose:
                    findings.append(
                        QCFinding(
                            f"plates.{tag}.{conc:g}",
                            QCStatus.WARN,
                            f"{tag} {conc:g} {u}: {len(rs)} of "
                            f"{p.plates_per_dose} plates (TG 471 paragraph 29: "
                            "an occasional lost plate does not necessarily "
                            "invalidate the assay)",
                        )
                    )
                tq = summary(rs, f"{conc:g} {u} {tag}")
                q[f"mean.{exp}.{strain}.{s9}.{conc:g}"] = tq
                fold = None
                if veh is not None and veh.require() > 0:
                    fold = Quantity.computed(
                        tq.require() / veh.require(),
                        "dimensionless",
                        method=m_fold,
                        inputs=[tq, veh],
                        label=f"fold over vehicle {conc:g} {u} {tag}",
                    )
                    q[f"fold.{exp}.{strain}.{s9}.{conc:g}"] = fold
                over = hneg is not None and tq.require() > hneg.upper
                if over:
                    above_hist.append(f"{tag} {conc:g} {u}")
                rows.append(
                    (
                        exp,
                        strain,
                        s9,
                        "test",
                        f"{conc:g}",
                        tq,
                        fold,
                        len(rs),
                        ", ".join(sorted(lawns)) + (" precipitate" if precip else ""),
                        "above" if over else "",
                    )
                )
            if analysable < 5:
                findings.append(
                    QCFinding(
                        f"analysable.{tag}",
                        QCStatus.WARN,
                        f"{tag}: {analysable} analysable concentrations; at "
                        "least five should be used (TG 471 paragraph 20)",
                    )
                )
            if p.top_dose_basis == "cytotoxicity" and not cytotoxic:
                findings.append(
                    QCFinding(
                        f"topdose.{tag}",
                        QCStatus.WARN,
                        f"{tag}: the top dose is justified by cytotoxicity but "
                        "no reduced or absent lawn was recorded (TG 471 "
                        "paragraph 19)",
                    )
                )
            if p.top_dose_basis == "solubility" and not soluble_limit:
                findings.append(
                    QCFinding(
                        f"topdose.{tag}",
                        QCStatus.WARN,
                        f"{tag}: the top dose is justified by solubility but no "
                        "precipitate was recorded (TG 471 paragraph 19)",
                    )
                )
        tables = [
            tabulate(
                "Revertants per plate",
                (
                    "experiment",
                    "strain",
                    "S9",
                    "treatment",
                    f"conc. ({u})",
                    "mean (SD)",
                    "fold over vehicle",
                    "plates",
                    "lawn / precipitate",
                    "vs historical negative upper limit",
                ),
                rows,
                note="TG 471 paragraphs 32-33; the fold over vehicle is shown for information "
                "(no fold threshold in TG 471 or ICH S2(R1)); historical ranges as "
                "stated in the protocol",
            )
        ]
        if above_hist:
            q["observations.above_historical"] = Quantity.computed(
                float(len(above_hist)),
                "dimensionless",
                method=m_sum,
                label="test-article means above the historical negative upper limit",
            )
        return AnalysisResult(
            quantities=q,
            tables=tuple(tables),
            qc=QCVerdict.of(findings),
            evidence_admissible=True,
            notes=tuple(f"above historical negative upper limit: {a}" for a in above_hist),
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        out: list[InterpretiveStatement] = []
        above = [n.split(": ", 1)[1] for n in analysis.notes if n.startswith("above historical")]
        if above:
            out.append(
                InterpretiveStatement(
                    "Test-article means above the upper limit of the historical negative-control "
                    "range: " + "; ".join(above) + ". TG 471 paragraph 35: a concentration-related "
                    "and/or reproducible increase may indicate a positive result, with biological "
                    "relevance considered first.",
                    "TG 471 paragraphs 35, 39; ICH S2(R1) 5.1",
                    ("oecd_tg471", "ich_s2r1"),
                    "notable",
                )
            )
        else:
            out.append(
                InterpretiveStatement(
                    "No test-article mean exceeds the upper limit of the historical negative-control "
                    "range for its strain and activation condition.",
                    "TG 471 paragraph 39; ICH S2(R1) 5.1",
                    ("oecd_tg471", "ich_s2r1"),
                    "info",
                )
            )
        out.append(
            InterpretiveStatement(
                "Fold increases over the concurrent vehicle are shown for information only: neither "
                "TG 471 nor ICH S2(R1) sets a fold threshold, and statistical significance alone is "
                "not determinative (TG 471 paragraph 35).",
                "TG 471 paragraph 35",
                ("oecd_tg471",),
                "info",
            )
        )
        if context is not None and context.modality is Modality.PEPTIDE:
            out.append(
                InterpretiveStatement(
                    "For a peptide likely to degrade, the bacterial reversion assay is not suitable "
                    "because of amino-acid contamination (ICH S2(R1) 5.2.1).",
                    "ICH S2(R1) 5.2.1",
                    ("ich_s2r1",),
                    "notable",
                )
            )
        for f in analysis.qc.findings:
            out.append(
                InterpretiveStatement(
                    f.message,
                    "OECD TG 471 design and controls",
                    ("oecd_tg471",),
                    "concern" if f.status is QCStatus.FAIL else "notable",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Positive, negative or equivocal, considering concentration-response, "
                "reproducibility, biological relevance and historical controls (TG 471 35-37)",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "ames_call",
                "Ames test outcome",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Positive: a concentration-related increase and/or a reproducible increase at one or "
                "more concentrations in at least one strain with or without S9, biological relevance "
                "first; negative: those criteria not met; equivocal: may remain so regardless of "
                "repeats (OECD TG 471 paragraphs 35-37; ICH S2(R1) 5.1).",
                choices=("positive", "negative", "equivocal"),
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
        det = next((d for d in determinations if d["key"] == "ames_call"), None)
        concl = (
            f"Outcome: {det['category']}, by {det['signer_name']} ({det['role']}). "
            f"Rationale: {det['rationale']}"
            if det
            else "Outcome not yet determined by the Study Director."
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
            ReportSection(
                "Results",
                "Individual plate counts are in the data appendix.",
                tables=analysis.tables,
            ),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, AmesSimulation)
        truth: dict[tuple[str, str], StrainTruth] = {(t.strain, t.s9): t for t in s.truth}

        def count(mean: float) -> int:
            return int(rng.poisson(mean)) if s.count_model == "poisson" else round(mean)

        rows: list[dict[str, Any]] = []
        for strain in p.strains:
            for c in S9:
                t = truth.get((strain, c))
                if t is None or len(t.fold_by_concentration) != len(p.concentrations):
                    raise ValueError(
                        f"simulation needs truth for {strain} S9 {c} with one fold "
                        "per concentration"
                    )
                plan: list[tuple[str, float | None, float]] = [
                    ("vehicle", None, t.vehicle_mean),
                    ("positive", None, t.positive_mean),
                ]
                if p.untreated_control:
                    plan.append(("untreated", None, t.vehicle_mean))
                plan += [
                    ("test", x, t.vehicle_mean * f)
                    for x, f in zip(p.concentrations, t.fold_by_concentration, strict=True)
                ]
                for treat, conc, mean in plan:
                    lawn = "normal"
                    if conc is not None and s.lawn_reduced_from and conc >= s.lawn_reduced_from:
                        lawn = "reduced"
                    pre = (
                        "yes"
                        if conc is not None and s.precipitate_from and conc >= s.precipitate_from
                        else "no"
                    )
                    for k in range(p.plates_per_dose):
                        rows.append(
                            {
                                "experiment": "1",
                                "strain": strain,
                                "s9": c,
                                "treatment": treat,
                                "concentration": conc,
                                "plate": k + 1,
                                "revertants": count(mean),
                                "background_lawn": lawn,
                                "precipitate": pre,
                            }
                        )
        return rows, "sim.ames_counts"
