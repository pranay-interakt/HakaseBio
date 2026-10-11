"""Safety pharmacology core battery: respiratory system (ICH S7A 2.7.3).

S7A 2.7.3: "Respiratory rate and other measures of respiratory function (e.g., tidal volume (6)
or hemoglobin oxygen saturation) should be evaluated", quantified by appropriate methodology
rather than clinical observation. The protocol therefore requires respiratory rate and at least
one other measure. Tidal volume is ingested as reported by the acquisition system (its
plethysmographic corrections are the system's; the Drorbaugh and Fenn equation could not be
verified), with the system and correction method recorded. Minute volume is derived per animal
as tidal volume x respiratory rate (stated in Lim et al. 2014, a secondary source; S7A does not
name it).

Each dose group is compared with the vehicle group at each timepoint (a time-matched comparison:
an analysis choice consistent with S7A 2.3.1 and 2.4.1, not an S7A requirement), descriptively or
by Dunnett's test when the protocol states it. Whether there is an adverse respiratory effect is
the Study Director's determination; S7A sets no numeric criterion.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from types import MappingProxyType
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
from hos.drivers.repeat_dose_tox.analysis import compare_groups, dose_eq
from hos.kernel.attestation import Role

GROUPS = ("vehicle", "test", "positive")
MEASURES = {
    "respiratory_rate": ("respiratory rate", "1/min"),
    "tidal_volume": ("tidal volume", None),
    "spo2": ("SpO2", "percent"),
}


class RespiratoryParams(BaseModel):
    glp: bool
    species: str = Field(min_length=1)
    strain: str = Field(min_length=1)
    sexes: list[Literal["M", "F"]] = Field(min_length=1)
    route: str = Field(min_length=1)
    vehicle: str = Field(min_length=1)
    method: Literal[
        "whole_body_plethysmography", "head_out_plethysmography", "pulse_oximetry", "other"
    ]
    acquisition_system: str = Field(
        min_length=1, description="system, software and the corrections it applies to tidal volume"
    )
    measure_tidal_volume: bool
    tidal_volume_unit: Literal["mL", "mL/kg"] | None = None
    measure_spo2: bool
    dose_levels_mg_per_kg: list[float] = Field(min_length=1)
    dose_selection_basis: str = Field(min_length=1)
    animals_per_sex_per_group: int = Field(ge=1)
    group_size_basis: str = Field(min_length=1)
    positive_control: str | None = None
    positive_control_omission_justification: str | None = None
    timepoints: list[str] = Field(min_length=1)
    timepoint_basis: str = Field(min_length=1)
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
    def _design(self) -> RespiratoryParams:
        errs = []
        if not (self.measure_tidal_volume or self.measure_spo2):
            errs.append(
                "S7A 2.7.3: respiratory rate and other measures of respiratory function "
                "(e.g. tidal volume or haemoglobin oxygen saturation) should be evaluated"
            )
        if self.measure_tidal_volume != (self.tidal_volume_unit is not None):
            errs.append("state the tidal-volume unit when, and only when, tidal volume is measured")
        if (
            not self.positive_control
            and not (self.positive_control_omission_justification or "").strip()
        ):
            errs.append("include a positive control or justify its omission (S7A 2.3.3.1)")
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

    def measures(self) -> list[str]:
        return (
            ["respiratory_rate"]
            + (["tidal_volume"] if self.measure_tidal_volume else [])
            + (["spo2"] if self.measure_spo2 else [])
        )

    def unit(self, measure: str) -> str:
        if measure == "tidal_volume":
            assert self.tidal_volume_unit is not None
            return self.tidal_volume_unit
        u = MEASURES[measure][1]
        assert u is not None
        return u

    def mv_unit(self) -> str:
        return "mL/min" if self.tidal_volume_unit == "mL" else "mL/min/kg"

    def groups(self) -> list[tuple[str, float]]:
        out = [("vehicle", 0.0)] + [("test", d) for d in self.dose_levels_mg_per_kg]
        return out + ([("positive", -1.0)] if self.positive_control else [])


class MeasureTruth(BaseModel):
    vehicle_mean: float
    sd: float = Field(ge=0)
    effect_by_dose: list[float] = Field(description="absolute change from vehicle per dose")
    positive_control_effect: float = 0.0


class RespiratorySimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    measures: dict[str, MeasureTruth]
    effect_timepoints: list[str] = Field(description="timepoints at which effects are present")


def _p(params: BaseModel) -> RespiratoryParams:
    if not isinstance(params, RespiratoryParams):
        raise TypeError("expected RespiratoryParams")
    return params


class SafetyPharmRespiratoryDriver(StudyDriver):
    id = "safety_pharm_respiratory"
    name = "Safety pharmacology: respiratory system (ICH S7A 2.7.3)"
    version = "1.0.0"
    requirement_ids = ("safety.core_battery",)
    components = MappingProxyType({"safety.core_battery": ("respiratory",)})
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.1.3"
    glp_capable = True
    description = (
        "Respiratory rate with tidal volume and/or oxygen saturation, minute volume "
        "derived, each dose compared with vehicle at each timepoint; adverse effect "
        "by the Study Director."
    )
    reference_keys = ("ich_s7a", "murphy1994", "lim2014")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return RespiratoryParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return RespiratorySimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp}
        if requirement.species:
            out["species"] = requirement.species[0]
        return out

    # -- design ----------------------------------------------------------------------

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        measures = [f"{MEASURES[m][0]} [{p.unit(m)}]" for m in p.measures()]
        if p.measure_tidal_volume:
            measures.append(f"minute volume [{p.mv_unit()}] = tidal volume x rate (derived)")
        design: dict[str, Any] = {
            "test_system": f"{p.species} ({p.strain}), sexes {', '.join(p.sexes)}, conscious",
            "method": f"{p.method.replace('_', ' ')}; {p.acquisition_system}",
            "measures": measures,
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
            "analysis": "each dose vs vehicle at each timepoint, "
            + ("Dunnett two-sided" if p.statistics == "dunnett" else "descriptive")
            + f" ({p.statistics_basis})",
        }
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Respiratory safety pharmacology of {compound.name} in the {p.species}",
            objective="Evaluate respiratory rate and other measures of respiratory function "
            "(ICH S7A 2.7.3).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"species": p.species, "strain": p.strain},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Acclimatisation",
                    "Acclimatise animals to the measurement system before dosing.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Dosing and recording",
                    f"Single dose by {p.route}; record each "
                    "measure at every timepoint with the stated system.",
                    (),
                ),
                ProtocolStep(
                    3, "Return data", "One row per animal x timepoint per data_template.csv.", ()
                ),
            ),
            acceptance_criteria=(),
            materials=tuple(x for x in (p.vehicle, p.positive_control) if x),
            deliverables=("data CSV per template", "safety pharmacology report"),
            glp=p.glp,
            references=(cite("ich_s7a"), cite("murphy1994"))
            + ((cite("lim2014"),) if p.measure_tidal_volume else ()),
            regulatory_basis=("ICH S7A 2.7.3", "ICH S7A 2.3-2.5"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(p.groups()) * len(p.sexes) * p.animals_per_sex_per_group
        return StudyPlan(
            execution_duration_days=1.0,
            duration_basis="single dose with recordings over the stated timepoints (S7A 2.5); "
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
        cols = [
            DataColumn("subject_id", "laboratory animal id", kind="text"),
            DataColumn("sex", "M or F", kind="text", choices=tuple(p.sexes)),
            DataColumn(
                "group",
                "vehicle, test or positive",
                kind="text",
                choices=GROUPS if p.positive_control else GROUPS[:2],
            ),
            DataColumn(
                "dose",
                "test-article dose (0 vehicle, empty positive control)",
                unit="mg/kg",
                required=False,
                minimum=0,
            ),
            DataColumn("timepoint", "timepoint", kind="text", choices=tuple(p.timepoints)),
            DataColumn("respiratory_rate", "respiratory rate", unit="1/min", minimum=0),
        ]
        if p.measure_tidal_volume:
            cols.append(
                DataColumn(
                    "tidal_volume",
                    "tidal volume as reported by the system",
                    unit=p.unit("tidal_volume"),
                    minimum=0,
                )
            )
        if p.measure_spo2:
            cols.append(
                DataColumn(
                    "spo2", "haemoglobin oxygen saturation", unit="percent", minimum=0, maximum=100
                )
            )
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per animal x timepoint, the measures as reported by the "
            f"acquisition system ({p.acquisition_system}).",
            columns=tuple(cols),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[str, str]] = set()
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
            key = (str(r["subject_id"]), str(r["timepoint"]))
            if key in seen:
                errors.append(f"row {i}: duplicate {key}")
            seen.add(key)
            prev = subj.setdefault(str(r["subject_id"]), (r["sex"], g, dose))
            if prev != (r["sex"], g, dose):
                errors.append(f"row {i}: {r['subject_id']} changes sex or group")
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
        prov_note = f"file sha256 {data.file_sha256[:16]}"
        dosed = [r for r in data.records if r["group"] != "positive"]
        recs = [
            {
                "endpoint": MEASURES[m][0],
                "sex": r["sex"],
                "phase": "main",
                "timepoint": r["timepoint"],
                "dose": float(r.get("dose") or 0),
                "unit": p.unit(m),
                "value": float(r[m]),
            }
            for r in dosed
            for m in p.measures()
            if r.get(m) is not None
        ]
        unit_of = {MEASURES[m][0]: p.unit(m) for m in p.measures()}
        cmp_ = compare_groups(
            recs,
            endpoint_unit=lambda e: unit_of[e],
            groups=[0.0, *p.dose_levels_mg_per_kg],
            alpha=p.alpha if p.statistics == "dunnett" else None,
            prov_note=prov_note,
            dose_unit="mg/kg",
        )
        q = dict(cmp_.quantities)
        tables = [
            tabulate(
                "Measures vs vehicle at each timepoint",
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
                else "Dunnett two-sided vs the time-matched vehicle group; statistical "
                "significance is not adversity",
            )
        ]
        findings: list[QCFinding] = []

        # minute volume (derived per animal)
        if p.measure_tidal_volume:
            m_mv = method("safety.minute_volume")
            mv: dict[tuple[str, str, str], list[float]] = defaultdict(list)
            for r in data.records:
                lab = (
                    "positive control"
                    if r["group"] == "positive"
                    else f"{float(r.get('dose') or 0):g} mg/kg"
                )
                mv[(lab, r["sex"], r["timepoint"])].append(
                    float(r["tidal_volume"]) * float(r["respiratory_rate"])
                )
            mv_rows = []
            tp_order = {t: i for i, t in enumerate(p.timepoints)}
            veh = {
                (sx, tp): float(np.mean(v)) for (lab, sx, tp), v in mv.items() if lab == "0 mg/kg"
            }
            grp_order = {
                lab: i
                for i, lab in enumerate(
                    [
                        "0 mg/kg",
                        *[f"{d:g} mg/kg" for d in p.dose_levels_mg_per_kg],
                        "positive control",
                    ]
                )
            }
            for (lab, sex, tp), vals in sorted(
                mv.items(),
                key=lambda kv: (kv[0][1], tp_order.get(kv[0][2], 99), grp_order.get(kv[0][0], 99)),
            ):
                sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
                mq = Quantity.computed(
                    float(np.mean(vals)),
                    p.mv_unit(),
                    method=m_mv,
                    label=f"minute volume {lab} {sex} {tp} (n={len(vals)})",
                    uncertainty=Uncertainty(kind="sd", sd=sd, n=len(vals))
                    if sd is not None
                    else None,
                    notes=prov_note,
                )
                ref = veh.get((sex, tp))
                pct = (
                    Quantity.computed(
                        100.0 * (mq.require() - ref) / ref,
                        "percent",
                        method=m_mv,
                        inputs=[mq],
                        label=f"minute volume % vs vehicle {lab} {sex} {tp}",
                    )
                    if ref and lab != "0 mg/kg"
                    else None
                )
                if pct is not None and lab != "positive control":
                    q[f"mv|{lab}|{sex}|{tp}|pct_vs_vehicle"] = pct
                mv_rows.append((lab, sex, tp, mq, pct if pct is not None else "-"))
            tables.append(
                tabulate(
                    "Minute volume (tidal volume x rate, per animal)",
                    ("group", "sex", "timepoint", "mean (SD)", "% vs vehicle"),
                    mv_rows,
                    note="derived; ICH S7A 2.7.3 does not name minute volume (Lim et al. 2014)",
                )
            )

        # positive control group
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
            else:
                pc_rows = []
                for m in p.measures():
                    for tp in p.timepoints:
                        vals = [
                            float(r[m])
                            for r in pos
                            if r["timepoint"] == tp and r.get(m) is not None
                        ]
                        if vals:
                            pc_rows.append(
                                (
                                    MEASURES[m][0],
                                    tp,
                                    Quantity.computed(
                                        float(np.mean(vals)),
                                        p.unit(m),
                                        method=method("stats.group_summary"),
                                        label=f"positive control {MEASURES[m][0]} {tp}",
                                    ),
                                )
                            )
                tables.append(
                    tabulate("Positive control", ("measure", "timepoint", "mean"), pc_rows)
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
        sig = [(k, v) for k, v in analysis.quantities.items() if k.endswith("|p")]
        for k, v in sig:
            _, measure, sex, _, tp, dose = k[:-2].split("|")
            out.append(
                InterpretiveStatement(
                    f"Statistically significant difference in {measure} ({sex}, {tp}) at {dose} mg/kg "
                    f"versus vehicle (Dunnett p = {v.require():.3g}).",
                    f"Dunnett two-sided, alpha {p.alpha:g}",
                    ("dunnett1955",),
                    "notable",
                )
            )
        out.append(
            InterpretiveStatement(
                "Each dose group is compared with the vehicle group at the same timepoint; S7A 2.4.1 "
                "asks for the dose-response relationship and time course of any adverse effect.",
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
                "Whether the changes constitute an adverse respiratory effect, and at which doses",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "overall_conclusion",
                "Adverse respiratory effect",
                None,
                Role.STUDY_DIRECTOR,
                True,
                "Whether the test article produced an adverse effect on respiratory "
                "function (S7A 2.7.3), considering dose-response, time course and the positive "
                "control.",
                choices=("no_effect_identified", "effect_identified"),
            ),
            ExpertDetermination(
                "no_effect_dose",
                "Highest dose without an adverse respiratory effect",
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
            ReportSection(
                "Results", "Time-matched comparison with vehicle.", tables=analysis.tables
            ),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, RespiratorySimulation)
        for m in p.measures():
            if m not in s.measures or len(s.measures[m].effect_by_dose) != len(
                p.dose_levels_mg_per_kg
            ):
                raise ValueError(f"simulation needs {m} with one effect per dose")
        rows: list[dict[str, Any]] = []
        for gi, (g, d) in enumerate(p.groups()):
            di = p.dose_levels_mg_per_kg.index(d) if g == "test" else None
            for sex in p.sexes:
                for k in range(p.animals_per_sex_per_group):
                    sid = f"{sex}{gi + 1}-{k + 1:02d}"
                    for tp in p.timepoints:
                        row: dict[str, Any] = {
                            "subject_id": sid,
                            "sex": sex,
                            "group": g,
                            "dose": None if g == "positive" else d,
                            "timepoint": tp,
                        }
                        for m in p.measures():
                            t = s.measures[m]
                            eff = 0.0
                            if tp in s.effect_timepoints:
                                eff = (
                                    t.effect_by_dose[di]
                                    if di is not None
                                    else t.positive_control_effect
                                    if g == "positive"
                                    else 0.0
                                )
                            v = t.vehicle_mean + eff + (float(rng.normal(0, t.sd)) if t.sd else 0.0)
                            row[m] = max(v, 0.0) if m != "spo2" else min(max(v, 0.0), 100.0)
                        rows.append(row)
        return rows, "sim.respiratory_declared"
