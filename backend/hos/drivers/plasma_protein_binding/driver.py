"""Plasma protein binding by equilibrium dialysis (ICH M3(R2) section 3; ICH M12 7.2).

Each replicate cell returns the buffer-chamber and plasma-chamber concentrations measured at
the end of the incubation. The fraction unbound is fu = C_buffer / C_plasma (manufacturer's
instructions for the RED device; the RED approach validated by Waters et al. 2008), summarised
per compound, species and test concentration.

Quality rules applied, each with its source:

* an in-study positive control must fall within 3-fold of the mean fu,p from the assay's
  qualification (ICH M12 7.2);
* a measured fu below 1% may be used for drug-interaction predictions only if its reliability
  is demonstrated, otherwise fu,p = 0.01 (ICH M12 2.1.2.1). The system reports the measured
  value, flags it, and routes the reliability question to the responsible scientist;
* a buffer concentration below the LLOQ gives only an upper bound on fu.

Recovery (mass balance) and stability: no verified formula or acceptance criterion exists in
the sources read, so they are not computed here. The laboratory may report them per its SOP,
and they are checked only against criteria the protocol states with their basis.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core import units as U
from hos.core.bioanalysis import cv_percent
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
    SummaryFacts,
    SummaryTable,
    ValueRef,
    fmt_param,
    tabulate,
)
from hos.kernel.attestation import Role

TEST = "TEST"
#: ICH M12 7.2: "within 3-fold of the mean fu,p value ... reported with the qualification"
M12_POSITIVE_CONTROL_FOLD = 3.0
#: ICH M12 2.1.2.1: measured fu,p below 1% needs demonstrated reliability, else fu,p = 0.01
M12_FU_FLOOR = 0.01


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


class PositiveControl(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    species: str = Field(min_length=1)
    qualified_mean_fu: float = Field(gt=0, le=1, description="mean fu,p from assay qualification")
    qualification_reference: str = Field(min_length=1)


class PPBParams(BaseModel):
    glp: bool
    method: Literal["equilibrium_dialysis"]
    device: str = Field(min_length=1, description="e.g. RED device inserts, MWCO 8 kDa")
    membrane_mwco_da: float = Field(gt=0)
    matrices: dict[str, str] = Field(
        min_length=1, description="species -> matrix and anticoagulant, e.g. rat: plasma (K2EDTA)"
    )
    test_concentrations: list[float] = Field(min_length=1)
    concentration_unit: str = Field(min_length=1)
    lloq: float = Field(gt=0, description="bioanalytical LLOQ, concentration unit")
    incubation_time_h: float = Field(gt=0)
    temperature_c: float
    agitation: str = Field(min_length=1)
    atmosphere: str = Field(min_length=1, description="e.g. 5% CO2 (pH control) or ambient")
    equilibrium_basis: str = Field(
        min_length=1, description="evidence that equilibrium is reached by the incubation time"
    )
    plasma_volume_ul: float = Field(gt=0)
    buffer_volume_ul: float = Field(gt=0)
    buffer: str = Field(min_length=1)
    replicates: int = Field(ge=1)
    bioanalytical_method_reference: str = Field(min_length=1)
    positive_controls: list[PositiveControl] = Field(default_factory=list)
    recovery_criterion_percent: float | None = Field(default=None, gt=0)
    stability_criterion_percent: float | None = Field(default=None, gt=0)
    qc_criteria_basis: str | None = None

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @field_validator("test_concentrations")
    @classmethod
    def _concs(cls, v: list[float]) -> list[float]:
        if any(c <= 0 for c in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("test concentrations are positive and strictly increasing")
        return v

    @model_validator(mode="after")
    def _design(self) -> PPBParams:
        errs = []
        names = [pc.name for pc in self.positive_controls]
        if len(set(names)) != len(names) or TEST in names:
            errs.append(f"positive-control names must be unique and not {TEST!r}")
        for pc in self.positive_controls:
            if pc.species not in self.matrices:
                errs.append(f"positive control {pc.name}: species {pc.species} is not tested")
        if (
            self.recovery_criterion_percent is not None
            or self.stability_criterion_percent is not None
        ) and not (self.qc_criteria_basis or "").strip():
            errs.append(
                "state the basis of the recovery/stability criteria (no consensus "
                "criterion exists; e.g. the laboratory SOP)"
            )
        if errs:
            raise ValueError("; ".join(errs))
        return self

    def compounds(self) -> list[str]:
        return [TEST, *[pc.name for pc in self.positive_controls]]


class TrueFu(BaseModel):
    compound: str
    species: str
    fu: float = Field(gt=0, le=1)


class PPBSimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    fu: list[TrueFu] = Field(min_length=1)
    plasma_fraction_of_nominal: float = Field(
        gt=0, description="plasma-chamber concentration at equilibrium / nominal concentration"
    )
    analytical_sd_log: float = Field(ge=0, lt=1)


def _p(params: BaseModel) -> PPBParams:
    if not isinstance(params, PPBParams):
        raise TypeError("expected PPBParams")
    return params


class PlasmaProteinBindingDriver(StudyDriver):
    id = "plasma_protein_binding"
    name = "Plasma protein binding by equilibrium dialysis"
    version = "1.0.0"
    requirement_ids = ("adme.plasma_protein_binding",)
    modalities = frozenset({Modality.SMALL_MOLECULE, Modality.PEPTIDE})
    ctd_section = "4.2.2.3"
    glp_capable = True
    description = (
        "Fraction unbound in plasma across species by equilibrium dialysis, with the "
        "ICH M12 positive-control rule and the fu < 1% reliability flag."
    )
    reference_keys = ("ich_m3r2", "ich_m12", "waters2008", "thermo_red_2023")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return PPBParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return PPBSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        return {"glp": requirement.glp}

    # -- design ----------------------------------------------------------------------

    # -- CTD Module 2.6 summaries (ABI 1.2) --------------------------------------

    def summary_facts(self, params: BaseModel) -> SummaryFacts | None:
        p = _p(params)
        return SummaryFacts(
            test_system="; ".join(f"{sp}: {m}" for sp, m in p.matrices.items()),
            method_of_administration=f"in vitro, equilibrium dialysis ({p.device})",
            doses=", ".join(fmt_param(c) for c in p.test_concentrations)
            + f" {p.concentration_unit}",
        )

    def summary_tables(
        self, params: BaseModel, results: Mapping[str, Any]
    ) -> tuple[SummaryTable, ...]:
        """Plasma protein binding (template 2.6.5.6)."""
        p = _p(params)
        q = results.get("quantities", {})
        rows = tuple(
            (sp, f"{c:g} {p.concentration_unit}", ValueRef(k))
            for sp in p.matrices
            for c in p.test_concentrations
            if (k := f"fu.TEST.{sp}.{c:g}") in q
        )
        return (
            SummaryTable(
                template="2.6.5.6",
                title="Pharmacokinetics: plasma protein binding (equilibrium dialysis)",
                columns=("Species", "Concentration tested", "Fraction unbound (fu)"),
                rows=rows,
                notes=(
                    "Shown as the measured fraction unbound rather than the template's "
                    "% bound, so no value is derived here.",
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
        cu = p.concentration_unit
        notes = []
        mw = compound.molecular_weight
        if mw is not None and mw.is_available and mw.magnitude_in("g/mol") >= p.membrane_mwco_da:
            notes.append(
                f"the analyte's molecular weight ({mw.magnitude_in('g/mol'):.0f} Da) is "
                f"not below the membrane MWCO ({p.membrane_mwco_da:g} Da): it cannot "
                "equilibrate across the membrane"
            )
        missing_pc = [
            sp for sp in p.matrices if not any(pc.species == sp for pc in p.positive_controls)
        ]
        if missing_pc:
            notes.append(
                "no positive control for " + ", ".join(missing_pc) + " (ICH M12 7.2: "
                "the experiments should always include a qualified positive control)"
            )
        design: dict[str, Any] = {
            "method": f"equilibrium dialysis, {p.device}, MWCO {p.membrane_mwco_da:g} Da",
            "matrices": [f"{sp}: {m}" for sp, m in p.matrices.items()],
            "test_concentrations": ", ".join(f"{c:g}" for c in p.test_concentrations) + f" {cu}",
            "incubation": f"{p.incubation_time_h:g} h at {p.temperature_c:g} °C, {p.agitation}, "
            f"{p.atmosphere} (equilibrium: {p.equilibrium_basis})",
            "volumes": f"plasma {p.plasma_volume_ul:g} µL, buffer {p.buffer_volume_ul:g} µL "
            f"({p.buffer})",
            "replicates": f"{p.replicates} per compound, species and concentration",
            "bioanalysis": f"{p.bioanalytical_method_reference}; LLOQ {p.lloq:g} {cu}; samples "
            "matrix-matched before analysis",
            "positive_controls": [
                f"{pc.name} in {pc.species}: qualified mean fu "
                f"{pc.qualified_mean_fu:g} ({pc.qualification_reference})"
                for pc in p.positive_controls
            ]
            or "none declared",
            "calculation": "fu = C_buffer / C_plasma per cell; replicate mean and SD",
        }
        if p.recovery_criterion_percent or p.stability_criterion_percent:
            design["laboratory_qc"] = (
                (
                    f"recovery >= {p.recovery_criterion_percent:g}% "
                    if p.recovery_criterion_percent
                    else ""
                )
                + (
                    f"stability >= {p.stability_criterion_percent:g}% "
                    if p.stability_criterion_percent
                    else ""
                )
                + f"as reported by the laboratory ({p.qc_criteria_basis})"
            )
        if notes:
            design["design_notes"] = notes
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Plasma protein binding of {compound.name} by equilibrium dialysis",
            objective="Measure the fraction unbound in plasma of the test and toxicology species "
            "and humans (ICH M3(R2) section 3).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"matrices": dict(p.matrices)},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Spiking",
                    "Spike each plasma at the test concentrations; load "
                    "plasma and buffer chambers with the stated volumes.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Dialysis",
                    f"Incubate {p.incubation_time_h:g} h at "
                    f"{p.temperature_c:g} °C with {p.agitation}, {p.atmosphere}.",
                    (),
                ),
                ProtocolStep(
                    3,
                    "Sampling and analysis",
                    "Sample both chambers; matrix-match "
                    "(blank plasma to buffer, buffer to plasma) and assay "
                    f"({p.bioanalytical_method_reference}).",
                    ("calibrators and QCs within 15% (LLOQ 20%), ICH M12 7.2",),
                ),
                ProtocolStep(
                    4, "Return data", "One row per dialysis cell per data_template.csv.", ()
                ),
            ),
            acceptance_criteria=(
                AcceptanceCriterion(
                    "m12.positive_control",
                    "positive control fu within 3-fold of its qualified mean",
                    "ich_m12 section 7.2",
                ),
            ),
            materials=tuple(f"blank {m} ({sp})" for sp, m in p.matrices.items()),
            deliverables=("data CSV per template", "protein binding report"),
            glp=p.glp,
            references=(
                cite("ich_m3r2"),
                cite("ich_m12"),
                cite("waters2008"),
                cite("thermo_red_2023"),
            ),
            regulatory_basis=("ICH M3(R2) section 3", "ICH M12 sections 2.1.2.1, 7.2"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        cells = (
            sum(len(p.test_concentrations) * p.replicates for _ in p.matrices)
            + len(p.positive_controls) * p.replicates
        )
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"one {p.incubation_time_h:g} h incubation; scheduling and "
            "bioanalysis turnaround are set by the laboratory",
            sample_count=2 * cells,
            sample_count_basis="two chambers per dialysis cell (test article at every "
            "concentration and species, positive controls once each)",
            dependencies=(f"bioanalytical method ({p.bioanalytical_method_reference})",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        rows: list[dict[str, Any]] = [
            {
                "compound": TEST,
                "species": sp,
                "nominal": f"{c:g}",
                "unit": p.concentration_unit,
                "replicates": p.replicates,
            }
            for sp in p.matrices
            for c in p.test_concentrations
        ]
        rows += [
            {
                "compound": pc.name,
                "species": pc.species,
                "nominal": "per qualification",
                "unit": p.concentration_unit,
                "replicates": p.replicates,
            }
            for pc in p.positive_controls
        ]
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        cu = p.concentration_unit
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description=f"One row per dialysis cell. compound is {TEST} for the test article or "
            "a positive-control name. A buffer concentration below the LLOQ has "
            "buffer_blq=yes and an empty buffer_chamber. Recovery and stability "
            "are optional, as computed by the laboratory's SOP.",
            columns=(
                DataColumn(
                    "compound",
                    "test article or positive control",
                    kind="text",
                    choices=tuple(p.compounds()),
                ),
                DataColumn(
                    "species", "species of the plasma", kind="text", choices=tuple(p.matrices)
                ),
                DataColumn(
                    "nominal_concentration",
                    "nominal spiked concentration",
                    unit=cu,
                    exclusive_minimum=True,
                    minimum=0,
                ),
                DataColumn("replicate", "replicate cell", kind="integer", minimum=1),
                DataColumn(
                    "buffer_chamber",
                    "buffer-chamber concentration at the end of dialysis",
                    unit=cu,
                    required=False,
                    minimum=0,
                ),
                DataColumn(
                    "buffer_blq",
                    "buffer chamber below the LLOQ",
                    kind="text",
                    choices=("yes", "no"),
                ),
                DataColumn(
                    "plasma_chamber",
                    "plasma-chamber concentration at the end of dialysis",
                    unit=cu,
                    exclusive_minimum=True,
                    minimum=0,
                ),
                DataColumn(
                    "recovery_percent",
                    "recovery per laboratory SOP",
                    unit="percent",
                    required=False,
                    minimum=0,
                ),
                DataColumn(
                    "stability_percent",
                    "stability per laboratory SOP",
                    unit="percent",
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
        seen: set[tuple[str, str, float, int]] = set()
        pcs = {pc.name: pc for pc in p.positive_controls}
        for i, r in enumerate(records, start=1):
            comp, sp, nom = str(r["compound"]), str(r["species"]), float(r["nominal_concentration"])
            if comp == TEST and not any(_same(nom, c) for c in p.test_concentrations):
                errors.append(f"row {i}: {nom:g} is not a protocol test concentration")
            if comp in pcs and pcs[comp].species != sp:
                errors.append(
                    f"row {i}: positive control {comp} is declared for "
                    f"{pcs[comp].species}, not {sp}"
                )
            key = (comp, sp, nom, int(r["replicate"]))
            if key in seen:
                errors.append(f"row {i}: duplicate cell {key}")
            seen.add(key)
            b = r.get("buffer_chamber")
            if r["buffer_blq"] == "yes" and b is not None:
                errors.append(f"row {i}: a BLQ buffer chamber has no concentration")
            if r["buffer_blq"] == "no":
                if b is None:
                    errors.append(f"row {i}: buffer_chamber is required when buffer_blq=no")
                elif b < p.lloq * (1 - 1e-9):
                    errors.append(
                        f"row {i}: buffer {b:g} is below the LLOQ {p.lloq:g}; report "
                        "it as BLQ (ICH M10 3.2.4: the calibration range starts at "
                        "the LLOQ)"
                    )
            if float(r["plasma_chamber"]) < p.lloq * (1 - 1e-9):
                errors.append(f"row {i}: plasma chamber below the LLOQ; fu is not determinable")
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
        m_fu, m_pc = method("ppb.fraction_unbound"), method("ppb.positive_control_m12")
        groups: dict[tuple[str, str, float], list[Mapping[str, Any]]] = defaultdict(list)
        for r in data.records:
            groups[
                (str(r["compound"]), str(r["species"]), float(r["nominal_concentration"]))
            ].append(r)
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        rows: list[tuple[Any, ...]] = []
        below_1pct = []
        for (comp, sp, nom), rs in sorted(groups.items()):
            tag = f"{comp} {sp} {nom:g} {p.concentration_unit}"
            fus = [
                float(r["buffer_chamber"]) / float(r["plasma_chamber"])
                for r in rs
                if r["buffer_blq"] == "no"
            ]
            blq = [r for r in rs if r["buffer_blq"] == "yes"]
            if blq:
                bound = max(p.lloq / float(r["plasma_chamber"]) for r in blq)
                findings.append(
                    QCFinding(
                        f"blq.{comp}.{sp}.{nom:g}",
                        QCStatus.WARN,
                        f"{tag}: {len(blq)} buffer chambers below the LLOQ; fu < {bound:.3g} there, "
                        "and the reported mean uses the quantifiable cells only",
                    )
                )
            if not fus:
                fq = Quantity.unavailable(
                    "dimensionless",
                    label=f"fu {tag}",
                    reason="every buffer chamber below the LLOQ; fu is "
                    "below the bound in the QC findings",
                )
                rows.append((comp, sp, f"{nom:g}", 0, fq, None, None))
                continue
            sd = float(np.std(fus, ddof=1)) if len(fus) > 1 else None
            fq = Quantity.computed(
                float(np.mean(fus)),
                "dimensionless",
                method=m_fu,
                label=f"fu {tag} (n={len(fus)})",
                uncertainty=Uncertainty(kind="sd", sd=sd, n=len(fus)) if sd is not None else None,
            )
            q[f"fu.{comp}.{sp}.{nom:g}"] = fq
            cv = cv_percent(fus)
            bound_pct = Quantity.computed(
                100.0 * (1 - fq.require()),
                "percent",
                method=m_fu,
                inputs=[fq],
                label=f"% bound {tag}",
            )
            rows.append(
                (
                    comp,
                    sp,
                    f"{nom:g}",
                    len(fus),
                    fq,
                    Quantity.computed(cv, "percent", method=m_fu, label=f"CV {tag}")
                    if cv is not None
                    else None,
                    bound_pct,
                )
            )
            if comp == TEST and fq.require() < M12_FU_FLOOR:
                below_1pct.append(tag)
            for key, crit in (
                ("recovery_percent", p.recovery_criterion_percent),
                ("stability_percent", p.stability_criterion_percent),
            ):
                vals = [float(r[key]) for r in rs if r.get(key) is not None]
                if crit is not None and vals and min(vals) < crit:
                    findings.append(
                        QCFinding(
                            f"{key}.{comp}.{sp}.{nom:g}",
                            QCStatus.WARN,
                            f"{tag}: laboratory {key.split('_')[0]} as low as {min(vals):.1f}%, below "
                            f"the stated {crit:g}% ({p.qc_criteria_basis})",
                        )
                    )
        tables = [
            tabulate(
                "Fraction unbound",
                (
                    "compound",
                    "species",
                    f"nominal ({p.concentration_unit})",
                    "n",
                    "fu (mean, SD)",
                    "CV",
                    "% bound",
                ),
                rows,
                note=f"fu = C_buffer / C_plasma after {p.incubation_time_h:g} h; "
                "positive controls listed by name",
            )
        ]
        if below_1pct:
            findings.append(
                QCFinding(
                    "fu.below_1_percent",
                    QCStatus.WARN,
                    "measured fu below 1% for "
                    + "; ".join(below_1pct)
                    + ". ICH M12 2.1.2.1: unless "
                    "the reliability of fu,p < 1% is demonstrated, fu,p = 0.01 is used for "
                    "drug-interaction predictions",
                )
            )

        # positive controls (ICH M12 7.2)
        pc_rows = []
        for pc in p.positive_controls:
            meas = [v for k, v in q.items() if k.startswith(f"fu.{pc.name}.{pc.species}.")]
            lo, hi = (
                pc.qualified_mean_fu / M12_POSITIVE_CONTROL_FOLD,
                pc.qualified_mean_fu * M12_POSITIVE_CONTROL_FOLD,
            )
            if not meas:
                findings.append(
                    QCFinding(
                        f"pc.{pc.name}.missing",
                        QCStatus.FAIL,
                        f"positive control {pc.name} ({pc.species}): no "
                        "quantifiable result (ICH M12 7.2)",
                    )
                )
                continue
            for mq in meas:
                ratio = Quantity.computed(
                    mq.require() / pc.qualified_mean_fu,
                    "dimensionless",
                    method=m_pc,
                    inputs=[mq],
                    label=f"{pc.name} fu / qualified mean",
                )
                ok = lo * (1 - 1e-12) <= mq.require() <= hi * (1 + 1e-12)  # inclusive
                pc_rows.append(
                    (
                        pc.name,
                        pc.species,
                        mq,
                        f"{pc.qualified_mean_fu:g}",
                        ratio,
                        "within 3-fold" if ok else "OUTSIDE 3-fold",
                    )
                )
                if not ok:
                    findings.append(
                        QCFinding(
                            f"pc.{pc.name}.{pc.species}",
                            QCStatus.FAIL,
                            f"positive control {pc.name} ({pc.species}): fu {mq.require():.3g} is not "
                            f"within 3-fold of the qualified mean {pc.qualified_mean_fu:g} "
                            f"({lo:.3g}-{hi:.3g}) (ICH M12 7.2)",
                        )
                    )
        if pc_rows:
            tables.append(
                tabulate(
                    "Positive controls (ICH M12 7.2)",
                    ("control", "species", "fu", "qualified mean", "ratio", "result"),
                    pc_rows,
                )
            )
        for sp in p.matrices:
            if not any(pc.species == sp for pc in p.positive_controls):
                findings.append(
                    QCFinding(
                        f"pc.absent.{sp}",
                        QCStatus.WARN,
                        f"no positive control in {sp} (ICH M12 7.2: protein "
                        "binding experiments should always include one)",
                    )
                )
        return AnalysisResult(
            quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings), evidence_admissible=True
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        out: list[InterpretiveStatement] = []
        for f in analysis.qc.findings:
            if f.code.startswith("pc."):
                out.append(
                    InterpretiveStatement(
                        f.message,
                        "ICH M12 7.2 in-study positive control",
                        ("ich_m12",),
                        "concern" if f.status is QCStatus.FAIL else "notable",
                    )
                )
            elif f.code == "fu.below_1_percent":
                out.append(
                    InterpretiveStatement(
                        f.message, "ICH M12 2.1.2.1", ("ich_m12", "di2017"), "notable"
                    )
                )
            elif f.code.startswith(("recovery_percent", "stability_percent")):
                out.append(
                    InterpretiveStatement(
                        f.message + ". Di et al. 2012 found that, once equilibrium is established, "
                        "low recovery from nonspecific binding did not affect fu.",
                        "laboratory criterion stated in the protocol",
                        ("di2012",),
                        "notable",
                    )
                )
        if not any(f.status is QCStatus.FAIL for f in analysis.qc.findings):
            out.append(
                InterpretiveStatement(
                    "Fraction unbound is reported as C_buffer / C_plasma at the stated incubation "
                    "time; every declared positive control is within 3-fold of its qualified mean.",
                    "equilibrium dialysis; ICH M12 7.2",
                    ("thermo_red_2023", "ich_m12"),
                    "info",
                )
            )
        return Interpretation(
            statements=tuple(out),
            requires_expert_judgement=(
                "Whether fu below 1% is reliable enough to use instead of 0.01 (ICH M12 2.1.2.1)",
            ),
        )

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "fu_below_1_percent_reliable",
                "Reliability of fu below 1% demonstrated",
                None,
                Role.RESPONSIBLE_SCIENTIST,
                False,
                "Only if a measured fu is below 1%: whether the assay's qualification with highly "
                "bound positive controls demonstrates its reliability; if not, fu,p = 0.01 is used "
                "for drug-interaction predictions (ICH M12 2.1.2.1, 7.2).",
                choices=("demonstrated", "not_demonstrated"),
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
        det = next((d for d in determinations if d["key"] == "fu_below_1_percent_reliable"), None)
        n_fail = sum(f.status is QCStatus.FAIL for f in analysis.qc.findings)
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured). " if data.is_simulated else "measured. ")
                + f"{n_fail} positive-control failures."
                + (
                    f" Reliability of fu < 1%: {det['category']} ({det['signer_name']})."
                    if det
                    else ""
                ),
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection("Results", "Equilibrium dialysis.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, PPBSimulation)
        truth = {(t.compound, t.species): t.fu for t in s.fu}

        def noise() -> float:
            return (
                float(np.exp(rng.normal(0.0, s.analytical_sd_log))) if s.analytical_sd_log else 1.0
            )

        cells: list[tuple[str, str, float]] = [
            (TEST, sp, c) for sp in p.matrices for c in p.test_concentrations
        ]
        cells += [(pc.name, pc.species, p.test_concentrations[0]) for pc in p.positive_controls]
        rows: list[dict[str, Any]] = []
        for comp, sp, nom in cells:
            if (comp, sp) not in truth:
                raise ValueError(f"simulation needs a true fu for {comp} in {sp}")
            for k in range(p.replicates):
                plasma = nom * s.plasma_fraction_of_nominal * noise()
                buf = truth[(comp, sp)] * plasma * noise()
                ok = buf >= p.lloq
                rows.append(
                    {
                        "compound": comp,
                        "species": sp,
                        "nominal_concentration": nom,
                        "replicate": k + 1,
                        "buffer_chamber": buf if ok else None,
                        "buffer_blq": "no" if ok else "yes",
                        "plasma_chamber": plasma,
                        "recovery_percent": None,
                        "stability_percent": None,
                    }
                )
        return rows, "sim.ppb_declared_fu"
