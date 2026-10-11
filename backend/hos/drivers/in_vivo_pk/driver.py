"""Single-dose in vivo pharmacokinetics in a test species (ICH M3(R2) section 3).

Groups receive one dose by a stated administration (IV bolus, IV infusion or extravascular).
The laboratory returns one row per sample. For each animal profile the driver computes Cmax,
Tmax, Clast, Tlast, C0 (IV bolus) and AUC(0-t). The terminal phase used for lambda_z is the
scientist's selection: every candidate fit over the last 3, 4, ... points after Tmax is
tabulated (with the vendor "best fit" marked as a suggestion), and the scientist enters the
start time of the terminal phase for each profile as a recorded input (ABI 1.1
``post_data_inputs``). Only then are t1/2, AUCinf, %AUC extrapolated, MRT, CL (CL/F), Vz (Vz/F),
Vss (intravenous only) and absolute bioavailability computed (:mod:`hos.core.nca`).

The scientist then signs that the terminal-phase selections are appropriate; the system
never chooses them.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core import units as U
from hos.core.citations import cite
from hos.core.methods import method
from hos.core.nca import BLQ_RULE, SingleDoseNCA, bioavailability, single_dose_nca
from hos.core.provenance import ProvenanceKind, Uncertainty
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
    Prerequisite,
    ProtocolDocument,
    ProtocolStep,
    ReportSection,
    StudyDriver,
    StudyPlan,
    tabulate,
)
from hos.kernel.attestation import Role

INPUT_PREFIX = "terminal_phase_start"


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


class PKGroup(BaseModel):
    group_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    administration: Literal["extravascular", "iv_infusion", "iv_bolus"]
    route: str = Field(min_length=1, description="e.g. oral gavage, intravenous")
    dose: float = Field(gt=0, description="in the protocol dose unit")
    infusion_duration_h: float | None = Field(default=None, gt=0)
    formulation: str = Field(min_length=1)
    sex: Literal["M", "F"]
    animals: int = Field(ge=1)
    sampling_times_h: list[float] = Field(min_length=3, description="nominal, after dosing")

    @field_validator("sampling_times_h")
    @classmethod
    def _times(cls, v: list[float]) -> list[float]:
        if any(t < 0 for t in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("sampling times are >= 0 and strictly increasing")
        return v

    @model_validator(mode="after")
    def _infusion(self) -> PKGroup:
        if (self.administration == "iv_infusion") != (self.infusion_duration_h is not None):
            raise ValueError("infusion_duration_h is given for, and only for, an IV infusion")
        return self

    @property
    def intravenous(self) -> bool:
        return self.administration != "extravascular"


class InVivoPKParams(BaseModel):
    glp: bool
    species: str = Field(min_length=1)
    strain: str = Field(min_length=1)
    analyte: str = Field(min_length=1)
    matrix: Literal["plasma", "serum", "whole_blood"]
    bioanalytical_technique: Literal["chromatographic", "ligand_binding"]
    bioanalytical_method_reference: str = Field(min_length=1)
    concentration_unit: str = Field(min_length=1)
    lloq: float = Field(gt=0)
    dose_unit: str = Field(min_length=1, description="e.g. mg/kg")
    groups: list[PKGroup] = Field(min_length=1)
    crossover: bool = Field(description="the same animals receive more than one group's dose")
    washout_justification: str | None = None
    dose_time_rule: Literal["zero_single_dose", "measured_predose"] = Field(
        description="zero_single_dose: drug-naive animals, concentration 0 at dose time when "
        "there is no time-0 sample (extravascular and infusion)"
    )
    auc_method: Literal["linear", "linear_up_log_down"]
    auc_method_basis: str = Field(min_length=1)
    blq_rule: Literal["leading_zero_then_excluded"] = Field(description=BLQ_RULE)
    auc_inf_basis: Literal["observed_clast"] = Field(
        description="AUCinf from the observed last concentration (CDISC AUCIFO)"
    )
    max_extrapolated_percent: float | None = Field(default=None, gt=0, lt=100)
    min_adjusted_r2: float | None = Field(default=None, gt=0, le=1)
    acceptance_basis: str | None = Field(
        default=None, description="source of any extrapolation or fit limit stated above"
    )

    @field_validator("concentration_unit", "dose_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @model_validator(mode="after")
    def _design(self) -> InVivoPKParams:
        errs = []
        ids = [g.group_id for g in self.groups]
        if len(set(ids)) != len(ids):
            errs.append("group ids must be unique")
        if self.crossover and not (self.washout_justification or "").strip():
            errs.append("a crossover design needs its washout justification")
        if (self.max_extrapolated_percent is not None or self.min_adjusted_r2 is not None) and not (
            self.acceptance_basis or ""
        ).strip():
            errs.append(
                "state the basis of the extrapolation or fit limits (ICH M13A's 80% "
                "coverage is a bioequivalence criterion, not a preclinical rule)"
            )
        if self.dose_time_rule == "measured_predose":
            for g in self.groups:
                if g.administration != "iv_bolus" and g.sampling_times_h[0] != 0:
                    errs.append(
                        f"group {g.group_id}: a measured pre-dose sample needs time 0 "
                        "in the schedule"
                    )
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def group(self, gid: str) -> PKGroup:
        return next(g for g in self.groups if g.group_id == gid)


class GroupProfile(BaseModel):
    group_id: str
    concentrations: list[float] = Field(
        description="true mean concentration at each nominal sampling time of the group"
    )


class InVivoPKSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    profiles: list[GroupProfile] = Field(min_length=1)
    between_animal_sd_log: float = Field(ge=0, lt=1)
    residual_sd_log: float = Field(ge=0, lt=1)


def _p(params: BaseModel) -> InVivoPKParams:
    if not isinstance(params, InVivoPKParams):
        raise TypeError("expected InVivoPKParams")
    return params


def input_name(group_id: str, subject: str) -> str:
    return f"{INPUT_PREFIX}.{group_id}.{subject}"


class _Profile:
    __slots__ = ("group", "nca", "rows", "subject")

    def __init__(self, subject: str, group: PKGroup, rows: list[Mapping[str, Any]]) -> None:
        self.subject, self.group = subject, group
        self.rows = sorted(rows, key=lambda r: float(r["nominal_time"]))
        self.nca: SingleDoseNCA | None = None

    @property
    def tag(self) -> str:
        return f"{self.group.group_id}/{self.subject}"


class InVivoPKDriver(StudyDriver):
    id = "in_vivo_pk"
    name = "Single-dose pharmacokinetics in a test species (NCA)"
    version = "1.0.0"
    requirement_ids = ("adme.in_vivo_pk",)
    modalities = frozenset(
        {Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.MONOCLONAL_ANTIBODY}
    )
    ctd_section = "4.2.2.2"
    glp_capable = True
    description = (
        "Single-dose PK by non-compartmental analysis: Cmax, AUC, terminal phase "
        "selected by the scientist, t1/2, AUCinf, CL, Vz, Vss and absolute "
        "bioavailability."
    )
    reference_keys = ("ich_m3r2", "fda_ba_2022", "ich_m13a", "certara_phoenix_nca")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return InVivoPKParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return InVivoPKSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp}
        if requirement.species:
            out["species"] = requirement.species[0]
        return out

    def prerequisites(self, params: BaseModel) -> tuple[Prerequisite, ...]:
        return ()

    # -- design ----------------------------------------------------------------------

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        du, cu = p.dose_unit, p.concentration_unit
        groups = [
            f"{g.group_id}: {g.dose:g} {du} {g.route} ({g.administration.replace('_', ' ')}"
            + (f", {g.infusion_duration_h:g} h" if g.infusion_duration_h else "")
            + f"), {g.formulation}; {g.animals} {g.sex}; samples at "
            + ", ".join(f"{t:g}" for t in g.sampling_times_h)
            + " h"
            for g in p.groups
        ]
        design: dict[str, Any] = {
            "test_system": f"{p.species} ({p.strain})",
            "groups": groups,
            "crossover": f"yes ({p.washout_justification})" if p.crossover else "no (parallel)",
            "analyte_matrix": f"{p.analyte} in {p.matrix.replace('_', ' ')}",
            "bioanalysis": f"{p.bioanalytical_technique} method, LLOQ {p.lloq:g} {cu} "
            f"({p.bioanalytical_method_reference})",
            "nca": f"{p.auc_method.replace('_', ' ')} trapezoidal rule ({p.auc_method_basis}); "
            f"actual times; BLQ: {BLQ_RULE}; dose time: "
            + (
                "zero for drug-naive single dose"
                if p.dose_time_rule == "zero_single_dose"
                else "measured pre-dose sample"
            )
            + "; AUCinf from observed Clast; IV bolus C0 by log-linear back-extrapolation",
            "terminal_phase": "selected per profile by the responsible scientist after the data "
            "are received (at least 3 declining points)",
        }
        limits = []
        if p.max_extrapolated_percent is not None:
            limits.append(f"%AUC extrapolated <= {p.max_extrapolated_percent:g}%")
        if p.min_adjusted_r2 is not None:
            limits.append(f"adjusted R-squared >= {p.min_adjusted_r2:g}")
        if limits:
            design["fit_limits"] = f"{'; '.join(limits)} ({p.acceptance_basis})"
        ivs = [g for g in p.groups if g.intravenous]
        evs = [g for g in p.groups if not g.intravenous]
        design["bioavailability"] = (
            "absolute F from "
            + ", ".join(g.group_id for g in evs)
            + " vs "
            + ", ".join(g.group_id for g in ivs)
            if ivs and evs
            else "not estimable (needs an intravenous and an extravascular group)"
        )
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Single-dose pharmacokinetics of {compound.name} in the {p.species}",
            objective="Characterise absorption and disposition after a single dose (ICH M3(R2) "
            "section 3: pharmacokinetics in test species).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id, "analyte": p.analyte},
            test_system={"species": p.species, "strain": p.strain, "matrix": p.matrix},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Dosing",
                    "Dose each group as stated; record the actual dose "
                    "time and, for infusions, the actual infusion duration.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Sampling",
                    "Collect samples at the scheduled times; record the "
                    "actual time of each sample.",
                    (),
                ),
                ProtocolStep(
                    3,
                    "Bioanalysis",
                    f"Assay with the validated method "
                    f"({p.bioanalytical_method_reference}); report concentrations below "
                    f"{p.lloq:g} {cu} as BLQ.",
                    (),
                ),
                ProtocolStep(4, "Return data", "One row per sample per data_template.csv.", ()),
            ),
            acceptance_criteria=(),
            materials=(f"validated {p.bioanalytical_technique} method for {p.analyte}",),
            deliverables=("data CSV per template", "pharmacokinetic report"),
            glp=p.glp,
            references=(
                cite("ich_m3r2"),
                cite("fda_ba_2022"),
                cite("ich_m13a"),
                cite("certara_phoenix_nca"),
            ),
            regulatory_basis=("ICH M3(R2) section 3",),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = sum(g.animals * len(g.sampling_times_h) for g in p.groups)
        last = max(t for g in p.groups for t in g.sampling_times_h)
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"in-life sampling over {last:g} h per group"
            + (" plus washout between periods" if p.crossover else "")
            + "; scheduling and bioanalysis turnaround are set by the laboratory",
            sample_count=n,
            sample_count_basis="animals x sampling times, summed over groups",
            dependencies=(f"bioanalytical method ({p.bioanalytical_method_reference})",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {
                "group_id": g.group_id,
                "dose": f"{g.dose:g}",
                "dose_unit": p.dose_unit,
                "sex": g.sex,
                "nominal_time_h": f"{t:g}",
                "animals": g.animals,
            }
            for g in p.groups
            for t in g.sampling_times_h
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        cu = p.concentration_unit
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per sample; times are hours after the start of dosing. A "
            "sample below the LLOQ has blq=yes and an empty concentration.",
            columns=(
                DataColumn("subject_id", "laboratory animal id", kind="text"),
                DataColumn(
                    "group_id",
                    "dose group",
                    kind="text",
                    choices=tuple(g.group_id for g in p.groups),
                ),
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
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[str, str, float]] = set()
        groups_of: dict[str, set[str]] = defaultdict(set)
        for i, r in enumerate(records, start=1):
            g = p.group(str(r["group_id"]))
            if not any(_same(float(r["nominal_time"]), t) for t in g.sampling_times_h):
                errors.append(
                    f"row {i}: nominal time {r['nominal_time']:g} h is not in group "
                    f"{g.group_id}'s schedule"
                )
            key = (str(r["subject_id"]), g.group_id, float(r["nominal_time"]))
            if key in seen:
                errors.append(
                    f"row {i}: duplicate sample for {key[0]} in {g.group_id} at {key[2]:g} h"
                )
            seen.add(key)
            groups_of[str(r["subject_id"])].add(g.group_id)
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
        for sid, gs in sorted(groups_of.items()):
            if len(gs) > 1 and not p.crossover:
                errors.append(f"{sid} appears in groups {sorted(gs)} but the design is parallel")
            if len({p.group(g).sex for g in gs}) > 1:
                errors.append(f"{sid} appears in groups of different sex")
        prof: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
        for r in records:
            prof[(str(r["subject_id"]), str(r["group_id"]))].append(r)
        for (sid, gid), rows in sorted(prof.items()):
            ordered = sorted(rows, key=lambda r: float(r["nominal_time"]))
            if any(
                float(b["actual_time"]) <= float(a["actual_time"]) for a, b in pairwise(ordered)
            ):
                errors.append(f"{sid} in {gid}: actual times do not increase with nominal times")
        return errors, []

    # -- inputs ---------------------------------------------------------------------------

    def post_data_inputs(self, params: BaseModel, data: IngestedData) -> Mapping[str, str]:
        keys = sorted({(str(r["group_id"]), str(r["subject_id"])) for r in data.records})
        return {input_name(g, s): "h" for g, s in keys}

    # -- analysis ------------------------------------------------------------------------

    def _profiles(
        self, p: InVivoPKParams, data: IngestedData, inputs: Mapping[str, Quantity]
    ) -> tuple[list[_Profile], list[str]]:
        rows: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
        for r in data.records:
            rows[(str(r["group_id"]), str(r["subject_id"]))].append(r)
        out, rejected = [], []
        for (gid, sid), rs in sorted(rows.items()):
            prof = _Profile(sid, p.group(gid), rs)
            sel = inputs.get(input_name(gid, sid))
            start: float | None = None
            if sel is not None and sel.is_available:
                if sel.kind is ProvenanceKind.USER_SUPPLIED:
                    start = sel.magnitude_in("h")
                else:
                    rejected.append(
                        f"{prof.tag}: the terminal-phase start must be entered as a "
                        f"user-supplied selection, not {sel.kind.value}"
                    )
            prof.nca = single_dose_nca(
                [float(r["actual_time"]) for r in prof.rows],
                [None if r["blq"] == "yes" else float(r["concentration"]) for r in prof.rows],
                administration=prof.group.administration,
                method=p.auc_method,
                dose_time_rule=p.dose_time_rule,
                terminal_start=start,
                infusion_duration=prof.group.infusion_duration_h,
            )
            out.append(prof)
        return out, rejected

    def _dose_quantity(
        self,
        p: InVivoPKParams,
        value: float,
        unit: str,
        target_per_kg: str,
        target: str,
        *,
        m: Any,
        label: str,
        inputs: Sequence[Quantity] = (),
    ) -> Quantity:
        q = Quantity.computed(value, unit, method=m, label=label, inputs=inputs)
        for t in (target_per_kg, target):
            if U.compatible(unit, t):
                return q.to(t)
        return q

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        cu, du = p.concentration_unit, p.dose_unit
        auc_u = f"{cu}*h"
        M = {
            k: method(k)
            for k in (
                "nca.cmax_tmax",
                "nca.auc_last",
                "nca.c0_back_extrapolation",
                "nca.lambda_z",
                "nca.half_life",
                "nca.auc_inf",
                "nca.auc_pct_extrap",
                "nca.moments",
                "nca.clearance",
                "nca.volume_z",
                "nca.vss",
                "nca.bioavailability",
                "tk.group_summary",
            )
        }
        profiles, rejected = self._profiles(p, data, inputs)
        findings = [
            QCFinding(f"selection.kind.{i}", QCStatus.WARN, m) for i, m in enumerate(rejected)
        ]
        tables = []
        q: dict[str, Quantity] = {}
        per: dict[str, dict[str, Quantity]] = {}

        def qty(v: float | None, unit: str, mid: str, label: str, reason: str) -> Quantity:
            if v is None:
                return Quantity.unavailable(unit, reason=reason, label=label)
            return Quantity.computed(v, unit, method=M[mid], label=label)

        for x in profiles:
            n = x.nca
            assert n is not None
            g, tag = x.group, x.tag
            why_l = n.reasons.get("lambda_z", "")
            why_i = n.reasons.get("auc_inf", why_l)
            why_a = n.reasons.get("auc_last") or n.reasons.get("cmax", "")
            d: dict[str, Quantity] = {
                "cmax": qty(n.cmax, cu, "nca.cmax_tmax", f"Cmax {tag}", n.reasons.get("cmax", "")),
                "tmax": qty(n.tmax, "h", "nca.cmax_tmax", f"Tmax {tag}", n.reasons.get("cmax", "")),
                "auc_last": qty(n.auc_last, auc_u, "nca.auc_last", f"AUC(0-t) {tag}", why_a),
                "lambda_z": qty(n.lambda_z, "1/h", "nca.lambda_z", f"lambda_z {tag}", why_l),
                "half_life": qty(n.half_life, "h", "nca.half_life", f"t1/2 {tag}", why_l),
                "auc_inf": qty(n.auc_inf, auc_u, "nca.auc_inf", f"AUCinf {tag}", why_i),
                "auc_pct_extrap": qty(
                    n.auc_pct_extrap,
                    "percent",
                    "nca.auc_pct_extrap",
                    f"%AUC extrapolated {tag}",
                    why_i,
                ),
                "mrt_inf": qty(n.mrt_inf, "h", "nca.moments", f"MRTinf {tag}", why_i),
            }
            if g.administration == "iv_bolus":
                d["c0"] = qty(
                    n.c0,
                    cu,
                    "nca.c0_back_extrapolation",
                    f"C0 {tag}",
                    n.reasons.get("auc_last", "not estimable"),
                )
            cl_lab = "CL" if g.intravenous else "CL/F"
            vz_lab = "Vz" if g.intravenous else "Vz/F"
            if n.auc_inf is not None and n.lambda_z is not None:
                d["cl"] = self._dose_quantity(
                    p,
                    g.dose / n.auc_inf,
                    f"({du})/({auc_u})",
                    "L/h/kg",
                    "L/h",
                    m=M["nca.clearance"],
                    label=f"{cl_lab} {tag}",
                    inputs=[d["auc_inf"]],
                )
                d["vz"] = self._dose_quantity(
                    p,
                    g.dose / (n.lambda_z * n.auc_inf),
                    f"({du})/({cu})",
                    "L/kg",
                    "L",
                    m=M["nca.volume_z"],
                    label=f"{vz_lab} {tag}",
                    inputs=[d["auc_inf"], d["lambda_z"]],
                )
                if g.intravenous and n.mrt_inf is not None:
                    d["vss"] = self._dose_quantity(
                        p,
                        g.dose / n.auc_inf * n.mrt_inf,
                        f"({du})/({cu})",
                        "L/kg",
                        "L",
                        m=M["nca.vss"],
                        label=f"Vss {tag}",
                        inputs=[d["cl"], d["mrt_inf"]],
                    )
            else:
                d["cl"] = Quantity.unavailable("L/h/kg", reason=why_i, label=f"{cl_lab} {tag}")
                d["vz"] = Quantity.unavailable("L/kg", reason=why_i, label=f"{vz_lab} {tag}")
            if g.intravenous and "vss" not in d:
                d["vss"] = Quantity.unavailable("L/kg", reason=why_i, label=f"Vss {tag}")
            per[tag] = d
            # QC on the selection
            if n.terminal is not None:
                if not g.intravenous and n.terminal.start_time <= (n.tmax or 0):
                    findings.append(
                        QCFinding(
                            f"terminal.tmax.{tag}",
                            QCStatus.WARN,
                            f"{tag}: the terminal phase starts at or before "
                            "Tmax, so the absorption phase is in the regression",
                        )
                    )
                if p.min_adjusted_r2 is not None and n.terminal.adj_r_squared < p.min_adjusted_r2:
                    findings.append(
                        QCFinding(
                            f"terminal.r2.{tag}",
                            QCStatus.WARN,
                            f"{tag}: adjusted R-squared {n.terminal.adj_r_squared:.4f} below the stated "
                            f"{p.min_adjusted_r2:g} ({p.acceptance_basis})",
                        )
                    )
            if (
                p.max_extrapolated_percent is not None
                and n.auc_pct_extrap is not None
                and n.auc_pct_extrap > p.max_extrapolated_percent
            ):
                findings.append(
                    QCFinding(
                        f"extrap.{tag}",
                        QCStatus.WARN,
                        f"{tag}: {n.auc_pct_extrap:.1f}% of AUCinf is extrapolated, above the stated "
                        f"{p.max_extrapolated_percent:g}% ({p.acceptance_basis})",
                    )
                )
        unselected = [
            x.tag for x in profiles if x.nca and x.nca.terminal is None and x.nca.cmax is not None
        ]
        if unselected:
            findings.append(
                QCFinding(
                    "terminal.unselected",
                    QCStatus.WARN,
                    f"terminal phase not selected for {len(unselected)} profiles; lambda_z-dependent "
                    "parameters are unavailable until the scientist enters each "
                    f"{INPUT_PREFIX} input",
                )
            )
        pre_q = [
            x.tag
            for x in profiles
            if x.group.administration != "iv_bolus"
            and any(float(r["nominal_time"]) == 0 and r["blq"] == "no" for r in x.rows)
        ]
        if pre_q:
            sec = "3.3.4" if p.bioanalytical_technique == "chromatographic" else "4.3.4"
            findings.append(
                QCFinding(
                    "predose.quantifiable",
                    QCStatus.WARN,
                    f"{len(pre_q)} pre-dose samples have quantifiable "
                    f"{p.analyte} (ICH M10 {sec} lists this as a reason for "
                    "reanalysis)",
                )
            )

        # individual parameters
        cols = (
            "profile",
            "Cmax",
            "Tmax",
            "C0",
            "AUC(0-t)",
            "lambda_z",
            "t1/2",
            "AUCinf",
            "%extrap",
            "CL (CL/F)",
            "Vz (Vz/F)",
            "Vss",
            "MRTinf",
        )
        rows = []
        for x in profiles:
            d = per[x.tag]
            rows.append(
                (
                    x.tag,
                    d["cmax"],
                    d["tmax"],
                    d.get("c0"),
                    d["auc_last"],
                    d["lambda_z"],
                    d["half_life"],
                    d["auc_inf"],
                    d["auc_pct_extrap"],
                    d["cl"],
                    d["vz"],
                    d.get("vss"),
                    d["mrt_inf"],
                )
            )
        tables.append(
            tabulate(
                "Individual pharmacokinetic parameters",
                cols,
                rows,
                note=f"{p.auc_method.replace('_', ' ')} trapezoidal rule on actual "
                f"times; BLQ: {BLQ_RULE}; extravascular CL and Vz are "
                "apparent (CL/F, Vz/F); Vss for intravenous dosing only",
            )
        )

        # terminal-phase candidates
        m_lz = M["nca.lambda_z"]
        cand_rows: list[tuple[Any, ...]] = []
        for x in profiles:
            n = x.nca
            assert n is not None
            for c in n.candidates:
                marks = []
                if n.suggestion is not None and c == n.suggestion:
                    marks.append("vendor best fit")
                if (
                    n.terminal is not None
                    and _same(c.start_time, n.terminal.start_time)
                    and c.n_points == n.terminal.n_points
                ):
                    marks.append("SELECTED")
                cand_rows.append(
                    (
                        x.tag,
                        f"{c.start_time:g}",
                        c.n_points,
                        Quantity.computed(
                            c.lambda_z,
                            "1/h",
                            method=m_lz,
                            label=f"lambda_z candidate {x.tag} from {c.start_time:g} h",
                        ),
                        f"{c.adj_r_squared:.5f}",
                        ", ".join(marks),
                    )
                )
            if n.terminal is not None and not any(
                _same(c.start_time, n.terminal.start_time) and c.n_points == n.terminal.n_points
                for c in n.candidates
            ):
                cand_rows.append(
                    (
                        x.tag,
                        f"{n.terminal.start_time:g}",
                        n.terminal.n_points,
                        per[x.tag]["lambda_z"],
                        f"{n.terminal.adj_r_squared:.5f}",
                        "SELECTED (includes Tmax or earlier points)",
                    )
                )
        tables.append(
            tabulate(
                "Terminal-phase candidates",
                ("profile", "start (h)", "points", "lambda_z", "adjusted R-squared", "note"),
                cand_rows,
                note="fits over the last 3, 4, ... quantifiable points after Tmax; the vendor best fit "
                "(largest adjusted R-squared, Certara Phoenix) is a suggestion; the scientist "
                f"selects each start time ({INPUT_PREFIX}.<group>.<animal>, in h)",
            )
        )

        # group summaries
        summ_keys = ("cmax", "tmax", "auc_last", "auc_inf", "half_life", "cl", "vz", "vss")
        g_rows = []
        for g in p.groups:
            ds = [per[x.tag] for x in profiles if x.group.group_id == g.group_id]
            row: list[Any] = [g.group_id, f"{g.dose:g} {du}", g.administration, len(ds)]
            for key in summ_keys:
                qs = [d[key] for d in ds if key in d and d[key].is_available]
                if not qs or len(qs) < len(ds):
                    row.append(
                        Quantity.unavailable(
                            ds[0][key].unit if ds and key in ds[0] else "dimensionless",
                            reason=f"{len(ds) - len(qs)} of {len(ds)} profiles without a value",
                            label=f"mean {key} {g.group_id}",
                        )
                        if ds and key in ds[0]
                        else None
                    )
                    continue
                unit = qs[0].unit
                vals = [x.magnitude_in(unit) for x in qs]
                sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
                mq = Quantity.computed(
                    float(np.mean(vals)),
                    unit,
                    method=M["tk.group_summary"],
                    label=f"mean {key} {g.group_id} (n={len(vals)})",
                    uncertainty=Uncertainty(kind="sd", sd=sd, n=len(vals))
                    if sd is not None
                    else None,
                )
                q[f"mean.{key}.{g.group_id}"] = mq
                row.append(mq)
            g_rows.append(tuple(row))
        tables.append(
            tabulate(
                "Group means (SD)",
                (
                    "group",
                    "dose",
                    "administration",
                    "n",
                    "Cmax",
                    "Tmax",
                    "AUC(0-t)",
                    "AUCinf",
                    "t1/2",
                    "CL (CL/F)",
                    "Vz (Vz/F)",
                    "Vss",
                ),
                g_rows,
                note="a group mean is reported only when every profile has the value",
            )
        )

        # absolute bioavailability
        ivs = [g for g in p.groups if g.intravenous]
        evs = [g for g in p.groups if not g.intravenous]
        f_rows = []
        for ev in evs:
            for iv in ivs:
                lab = f"F {ev.group_id} vs {iv.group_id}"
                a_ev = [per[x.tag]["auc_inf"] for x in profiles if x.group.group_id == ev.group_id]
                a_iv = [per[x.tag]["auc_inf"] for x in profiles if x.group.group_id == iv.group_id]
                if not a_ev or not a_iv or not all(a.is_available for a in a_ev + a_iv):
                    fq = Quantity.unavailable(
                        "dimensionless",
                        label=lab,
                        reason="needs AUCinf for every profile in both groups",
                    )
                else:
                    mev = float(np.mean([a.require() for a in a_ev]))
                    miv = float(np.mean([a.require() for a in a_iv]))
                    fq = Quantity.computed(
                        bioavailability(mev, ev.dose, miv, iv.dose),
                        "dimensionless",
                        method=M["nca.bioavailability"],
                        inputs=a_ev + a_iv,
                        label=lab,
                        notes=None
                        if _same(ev.dose, iv.dose)
                        else f"doses differ ({ev.dose:g} vs {iv.dose:g} {du}): "
                        "assumes linear PK between them",
                    )
                    q[f"F.{ev.group_id}.{iv.group_id}"] = fq
                f_rows.append((ev.group_id, iv.group_id, f"{ev.dose:g} / {iv.dose:g} {du}", fq))
        if f_rows:
            tables.append(
                tabulate(
                    "Absolute bioavailability",
                    ("extravascular", "intravenous", "doses", "F"),
                    f_rows,
                    note="F = (mean AUCinf_ev x Dose_iv)/(mean AUCinf_iv x Dose_ev)",
                )
            )
        q["profiles.selected"] = Quantity.computed(
            float(sum(1 for x in profiles if x.nca and x.nca.terminal is not None)),
            "dimensionless",
            method=M["nca.lambda_z"],
            label="profiles with a selected terminal phase",
        )
        return AnalysisResult(
            quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings), evidence_admissible=True
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        out: list[InterpretiveStatement] = []
        sel = analysis.quantities.get("profiles.selected")
        n_prof = sum(
            len(t.rows)
            for t in analysis.tables
            if t.title == "Individual pharmacokinetic parameters"
        )
        if sel is not None:
            out.append(
                InterpretiveStatement(
                    f"lambda_z-dependent parameters were computed for {int(sel.require())} of "
                    f"{n_prof} profiles, each from a terminal phase selected by the scientist with at "
                    "least three declining points.",
                    "FDA 2022 Appendix A section B; ICH M13A 2.1.8",
                    ("fda_ba_2022", "ich_m13a"),
                    "info",
                )
            )
        for k, v in analysis.quantities.items():
            if k.startswith("F.") and v.is_available:
                _, ev, iv = k.split(".")
                out.append(
                    InterpretiveStatement(
                        f"Absolute bioavailability of {ev} relative to {iv}: F = {v.require():.3g} "
                        "(dose-normalised group mean AUCinf)"
                        + (f"; {v.provenance.notes}" if v.provenance.notes else "")
                        + ".",
                        "ratio of dose-normalised AUC after extravascular and intravenous dosing",
                        ("cdisc_pk_terms", "shang2022"),
                        "info",
                    )
                )
        for f in analysis.qc.findings:
            out.append(
                InterpretiveStatement(
                    f.message,
                    "NCA quality check"
                    if not f.code.startswith("predose")
                    else "ICH M10 study sample analysis",
                    ("ich_m10",) if f.code.startswith("predose") else ("fda_ba_2022",),
                    "notable",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Selection of the terminal log-linear phase for each profile",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "terminal_phase_selection",
                "Terminal-phase selections appropriate",
                None,
                Role.RESPONSIBLE_SCIENTIST,
                True,
                "Confirm that the terminal phase selected for each profile is log-linear and "
                "suitable for lambda_z (FDA 2022 Appendix A: three or more terminal points); the "
                "signature binds this analysis, including every selection.",
                choices=("accepted", "not_accepted"),
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
        det = next((d for d in determinations if d["key"] == "terminal_phase_selection"), None)
        concl = (
            f"Terminal-phase selections {det['category']} by {det['signer_name']} "
            f"({det['role']}). Rationale: {det['rationale']}"
            if det
            else "Terminal-phase selections not yet confirmed by the responsible scientist."
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
            ReportSection("Results", "Non-compartmental analysis.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, InVivoPKSimulation)
        prof = {gp.group_id: gp.concentrations for gp in s.profiles}

        def lognormal(sd: float) -> float:
            return float(np.exp(rng.normal(0.0, sd))) if sd else 1.0

        rows: list[dict[str, Any]] = []
        animals: dict[str, list[str]] = {}
        for gi, g in enumerate(p.groups):
            if g.group_id not in prof or len(prof[g.group_id]) != len(g.sampling_times_h):
                raise ValueError(
                    f"simulation needs one concentration per sampling time for group {g.group_id}"
                )
            if p.crossover:
                ids = animals.setdefault(g.sex, [f"{g.sex}{k + 1:02d}" for k in range(g.animals)])
            else:
                ids = [f"{g.sex}{gi + 1}{k + 1:02d}" for k in range(g.animals)]
            for sid in ids[: g.animals]:
                a = lognormal(s.between_animal_sd_log)
                for t, c_true in zip(g.sampling_times_h, prof[g.group_id], strict=True):
                    c = c_true * a * lognormal(s.residual_sd_log)
                    ok = c >= p.lloq
                    rows.append(
                        {
                            "subject_id": sid,
                            "group_id": g.group_id,
                            "nominal_time": t,
                            "actual_time": t,
                            "concentration": c if ok else None,
                            "blq": "no" if ok else "yes",
                        }
                    )
        return rows, "sim.pk_declared_profile"
