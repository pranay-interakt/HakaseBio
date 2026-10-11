"""In vitro potency and selectivity (primary and secondary pharmacodynamics; ICH M3(R2) 2,
ICH S7A Note 2).

Each assay (the primary target, and any off-targets) returns concentration-response data
normalised as percent inhibition or percent activity. The driver fits the four-parameter
logistic model to each assay and compound (DeLean et al. 1978; the model as written in Ritz
et al. 2015, Eq. 2), reports the 50% effective concentration with its 95% confidence interval
and the Hill slope, checks declared reference compounds against acceptance ranges the protocol
states with their basis, and computes the relative potency of the test article, off-target
IC50 / primary IC50, with a delta-method standard error (Ritz et al. 2015).

No regulatory source defines a selectivity ratio or a threshold for it (searched: ICH M3(R2),
S7A, S7B, E14/S7B Q&A), so the ratio is reported as relative potency at the 50% effect level,
never judged. ICH S7A 2.4.1 asks that doses eliciting adverse effects be compared with those
eliciting the primary effect; that comparison is made in the safety pharmacology and toxicity
studies, not here.
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
from hos.core.pharmacology import HillFit, fit_hill
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError
from hos.core.regulatory.context import Modality, ProgramContext
from hos.core.regulatory.engine import StudyRequirement
from hos.drivers.base import (
    AcceptanceCriterion,
    AnalysisResult,
    CompoundInfo,
    DataColumn,
    DataTemplate,
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

TEST = "TEST"


class ReferenceCompound(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    acceptance_low: float = Field(gt=0, description="lowest acceptable IC50/EC50")
    acceptance_high: float = Field(gt=0)
    basis: str = Field(min_length=1, description="e.g. laboratory historical range")

    @model_validator(mode="after")
    def _range(self) -> ReferenceCompound:
        if self.acceptance_high <= self.acceptance_low:
            raise ValueError("acceptance_high must exceed acceptance_low")
        return self


class Assay(BaseModel):
    assay_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    target: str = Field(min_length=1)
    role: Literal["primary", "off_target"]
    assay_format: str = Field(min_length=1, description="e.g. radioligand binding, enzyme "
                              "activity, cell-based functional")
    species: str = Field(min_length=1)
    conditions: str = Field(min_length=1, description="substrate / ligand / agonist and its "
                            "concentration, cell line, incubation")
    readout: Literal["percent_inhibition", "percent_activity"]
    asymptotes: Literal["fitted", "fixed_0_100"]
    concentrations: list[float] = Field(min_length=4)
    replicates: int = Field(ge=1)
    reference: ReferenceCompound | None = None

    @field_validator("concentrations")
    @classmethod
    def _concs(cls, v: list[float]) -> list[float]:
        if any(c <= 0 for c in v) or any(b <= a for a, b in pairwise(v)):
            raise ValueError("concentrations are positive and strictly increasing")
        return v

    @property
    def potency_label(self) -> str:
        return "IC50" if self.readout == "percent_inhibition" else "EC50"

    def fixed(self) -> tuple[float | None, float | None]:
        """(fix_bottom, fix_top) for the 4PL as written y = bottom + (top-bottom)/(1+(C/IC50)^h):
        ``top`` is the response at low concentration."""
        if self.asymptotes == "fitted":
            return None, None
        return (100.0, 0.0) if self.readout == "percent_inhibition" else (0.0, 100.0)


class PotencyParams(BaseModel):
    glp: bool
    concentration_unit: str = Field(min_length=1)
    assays: list[Assay] = Field(min_length=1)
    min_r2: float = Field(gt=0, le=1, description="curve-fit acceptance (stated by the lab)")
    fit_acceptance_basis: str = Field(min_length=1)

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @model_validator(mode="after")
    def _design(self) -> PotencyParams:
        ids = [a.assay_id for a in self.assays]
        if len(set(ids)) != len(ids):
            raise ValueError("assay ids must be unique")
        if not any(a.role == "primary" for a in self.assays):
            raise ValueError("at least one primary-target assay is needed")
        return self

    def assay(self, aid: str) -> Assay:
        return next(a for a in self.assays if a.assay_id == aid)

    def compounds(self) -> list[str]:
        return [TEST, *sorted({a.reference.name for a in self.assays if a.reference})]


class CurveTruth(BaseModel):
    assay_id: str
    compound: str
    ic50: float = Field(gt=0)
    hill: float = Field(gt=0)
    noise_sd: float = Field(ge=0, description="additive noise, percentage points")


class PotencySimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    curves: list[CurveTruth] = Field(min_length=1)


def _p(params: BaseModel) -> PotencyParams:
    if not isinstance(params, PotencyParams):
        raise TypeError("expected PotencyParams")
    return params


def relative_potency(off: Quantity, on: Quantity) -> Quantity:
    """Off-target / primary 50% effective concentration with the delta-method SE for a ratio
    of independent estimates: SE(R) = R sqrt((SE_off/off)^2 + (SE_on/on)^2) (Ritz 2015)."""
    a, b = off.require(), on.require()
    r = a / b
    ua, ub = off.uncertainty, on.uncertainty
    unc = None
    if ua is not None and ub is not None and ua.sd is not None and ub.sd is not None:
        se = r * math.sqrt((ua.sd / a) ** 2 + (ub.sd / b) ** 2)
        unc = Uncertainty(kind="ci95", lower=max(r - 1.96 * se, 0.0), upper=r + 1.96 * se, sd=se)
    return Quantity.computed(r, "dimensionless", method=method("pharm.relative_potency"),
                             inputs=[off, on], uncertainty=unc,
                             label=f"relative potency {off.label} / {on.label}")


class InVitroPotencyDriver(StudyDriver):
    id = "in_vitro_potency"
    name = "In vitro potency and selectivity (4PL)"
    version = "1.0.0"
    requirement_ids = ("pharm.primary",)
    modalities = frozenset({Modality.SMALL_MOLECULE, Modality.PEPTIDE,
                            Modality.MONOCLONAL_ANTIBODY})
    ctd_section = "4.2.1.1"
    glp_capable = False
    description = ("Concentration-response potency at the primary target and off-targets by "
                   "4PL, with reference-compound checks and relative potency.")
    reference_keys = ("ich_m3r2", "ich_s7a", "delean1978", "ritz2015")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return PotencyParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return PotencySimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        return {"glp": requirement.glp}

    # -- design ----------------------------------------------------------------------

    def design(self, compound: CompoundInfo, params: BaseModel,
               context: ProgramContext | None = None,
               hypothesis: str | None = None) -> ProtocolDocument:
        p = _p(params)
        u = p.concentration_unit
        assays = [f"{a.assay_id} ({a.role}): {a.target}, {a.assay_format}, {a.species}; "
                  f"{a.conditions}; {a.readout.replace('_', ' ')}, asymptotes "
                  f"{a.asymptotes.replace('_', ' ')}; {len(a.concentrations)} concentrations "
                  f"{a.concentrations[0]:g}-{a.concentrations[-1]:g} {u} x {a.replicates}"
                  + (f"; reference {a.reference.name} accepted at {a.reference.acceptance_low:g}-"
                     f"{a.reference.acceptance_high:g} {u} ({a.reference.basis})"
                     if a.reference else "") for a in p.assays]
        conds = {a.conditions for a in p.assays}
        notes = []
        if len(conds) > 1 and any(a.role == "off_target" for a in p.assays):
            notes.append("assay conditions differ between assays: IC50 ratios are relative "
                         "potencies under those conditions, not affinity ratios (no Ki "
                         "conversion is applied)")
        design: dict[str, Any] = {"assays": assays,
                                  "curve_fit": f"4PL; R-squared >= {p.min_r2:g} "
                                               f"({p.fit_acceptance_basis})",
                                  "relative_potency": "off-target / primary 50% effective "
                                                      "concentration, delta-method 95% CI "
                                                      "(Ritz et al. 2015); no threshold"}
        if notes:
            design["design_notes"] = notes
        crit = tuple(AcceptanceCriterion(f"reference.{a.assay_id}",
                                         f"{a.reference.name} {a.potency_label} within "
                                         f"{a.reference.acceptance_low:g}-"
                                         f"{a.reference.acceptance_high:g} {u}", a.reference.basis)
                     for a in p.assays if a.reference)
        return ProtocolDocument(
            driver_id=self.id, driver_version=self.version,
            title=f"In vitro potency and selectivity of {compound.name}",
            objective="Characterise activity at the intended target and at off-targets (ICH "
                      "M3(R2) 2; primary and secondary pharmacodynamics, ICH S7A Note 2).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"targets": [a.target for a in p.assays]},
            design=design,
            steps=(
                ProtocolStep(1, "Concentration-response", "Test each compound at each assay's "
                             "concentrations in the stated replicates.", ()),
                ProtocolStep(2, "Normalisation", "Express responses as percent inhibition or "
                             "percent activity against the assay's controls.", ()),
                ProtocolStep(3, "Return data", "One row per well per data_template.csv.", ()),
            ),
            acceptance_criteria=crit,
            materials=tuple(f"reference {a.reference.name} ({a.assay_id})" for a in p.assays
                            if a.reference),
            deliverables=("data CSV per template", "pharmacology report"),
            glp=p.glp,
            references=(cite("ich_m3r2"), cite("ich_s7a"), cite("delean1978"), cite("ritz2015")),
            regulatory_basis=("ICH M3(R2) section 2", "ICH S7A Note 2"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = sum(len(a.concentrations) * a.replicates * (2 if a.reference else 1)
                for a in p.assays)
        return StudyPlan(
            execution_duration_days=None,
            duration_basis="set by the laboratory per assay",
            sample_count=n, sample_count_basis="wells: concentrations x replicates per assay "
                                               "and compound",
            dependencies=("assay validation with the reference compounds",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(self, params: BaseModel,
                        compound: CompoundInfo) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        rows: list[dict[str, Any]] = []
        for a in p.assays:
            for comp in [TEST] + ([a.reference.name] if a.reference else []):
                rows += [{"assay_id": a.assay_id, "compound": comp, "concentration": f"{c:g}",
                          "unit": p.concentration_unit, "replicates": a.replicates}
                         for c in a.concentrations]
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per well: assay, compound (TEST or the assay's reference), "
                        "concentration, replicate and the normalised response in percent.",
            columns=(
                DataColumn("assay_id", "assay", kind="text",
                           choices=tuple(a.assay_id for a in p.assays)),
                DataColumn("compound", "TEST or reference compound", kind="text",
                           choices=tuple(p.compounds())),
                DataColumn("concentration", "concentration", unit=p.concentration_unit,
                           exclusive_minimum=True, minimum=0),
                DataColumn("replicate", "replicate", kind="integer", minimum=1),
                DataColumn("response", "percent inhibition or percent activity per the assay",
                           unit="percent"),
            ),
        )

    def validate_records(self, records: Sequence[Mapping[str, Any]],
                         params: BaseModel) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors: list[str] = []
        seen: set[tuple[str, str, float, int]] = set()
        for i, r in enumerate(records, start=1):
            a = p.assay(str(r["assay_id"]))
            comp = str(r["compound"])
            if comp != TEST and (a.reference is None or a.reference.name != comp):
                errors.append(f"row {i}: {comp} is not the reference compound of {a.assay_id}")
            if not any(abs(float(r["concentration"]) - c) <= 1e-9 * c for c in a.concentrations):
                errors.append(f"row {i}: {r['concentration']:g} is not a concentration of "
                              f"{a.assay_id}")
            key = (a.assay_id, comp, float(r["concentration"]), int(r["replicate"]))
            if key in seen:
                errors.append(f"row {i}: duplicate well {key}")
            seen.add(key)
        return errors, []

    # -- analysis ------------------------------------------------------------------------

    def _analyze(self, data: IngestedData, params: BaseModel, compound: CompoundInfo,
                 inputs: Mapping[str, Quantity]) -> AnalysisResult:
        p = _p(params)
        u = p.concentration_unit
        prov = data.provenance()
        series: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
        for r in data.records:
            series[(str(r["assay_id"]), str(r["compound"]))].append(
                (float(r["concentration"]), float(r["response"])))
        fits: dict[tuple[str, str], HillFit] = {}
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        rows: list[tuple[Any, ...]] = []
        for (aid, comp), pts in sorted(series.items()):
            a = p.assay(aid)
            fb, ft = a.fixed()
            tag = f"{a.potency_label} {comp} at {a.target}"
            try:
                fit = fit_hill(MeasurementSeries(x=tuple(c for c, _ in pts),
                                                 y=tuple(v for _, v in pts), x_unit=u,
                                                 y_unit="percent", provenance=prov,
                                                 x_label="concentration", y_label="response"),
                               min_r2=p.min_r2, potency_label=tag, fix_bottom=fb, fix_top=ft)
            except QuantityError as exc:
                findings.append(QCFinding(f"fit.{aid}.{comp}", QCStatus.WARN,
                                          f"{tag}: no fit ({exc})"))
                rows.append((aid, a.role, comp, Quantity.unavailable(u, label=tag,
                                                                     reason=str(exc)),
                             None, "-", "no fit"))
                continue
            fits[(aid, comp)] = fit
            q[f"potency.{aid}.{comp}"] = fit.ic50
            q[f"hill.{aid}.{comp}"] = fit.hill_slope
            for f in fit.qc.findings:
                findings.append(QCFinding(f"{f.code}.{aid}.{comp}", f.status,
                                          f"{tag}: {f.message}"))
            verdict = ""
            if comp != TEST and a.reference is not None:
                ok = a.reference.acceptance_low <= fit.ic50.require() <= a.reference.acceptance_high
                verdict = "within acceptance" if ok else "OUTSIDE acceptance"
                if not ok:
                    findings.append(QCFinding(
                        f"reference.{aid}", QCStatus.FAIL,
                        f"{tag} {fit.ic50.require():.3g} {u} outside "
                        f"{a.reference.acceptance_low:g}-{a.reference.acceptance_high:g} "
                        f"({a.reference.basis}); the {aid} run is not valid"))
            rows.append((aid, a.role, comp, fit.ic50, fit.hill_slope, f"{fit.r_squared:.4f}",
                         ("extrapolated; " if fit.extrapolated else "") + verdict))
        tables = [tabulate("Potency (4PL)", ("assay", "role", "compound", "IC50/EC50 (95% CI)",
                                             "Hill slope", "R-squared", "note"), rows,
                           note="four-parameter logistic fit; an IC50 outside the tested range "
                                "is an extrapolation")]

        # relative potency of the test article
        invalid = {f.code.split(".", 1)[1] for f in findings if f.code.startswith("reference.")}
        primaries = [a for a in p.assays if a.role == "primary"]
        rp_rows: list[tuple[Any, ...]] = []
        for off in (a for a in p.assays if a.role == "off_target"):
            for on in primaries:
                lab = f"{off.assay_id} / {on.assay_id}"
                fo, fn = fits.get((off.assay_id, TEST)), fits.get((on.assay_id, TEST))
                reason = None
                if off.assay_id in invalid or on.assay_id in invalid:
                    reason = "an assay run failed its reference-compound acceptance"
                elif fn is None or fn.extrapolated:
                    reason = f"primary {on.potency_label} not determined within the tested range"
                elif fo is None:
                    reason = "off-target curve could not be fitted"
                elif fo.extrapolated and fo.ic50.require() > fo.concentration_range[1]:
                    reason = (f"off-target {off.potency_label} above the top concentration "
                              f"{fo.concentration_range[1]:g} {u}; relative potency > "
                              f"{fo.concentration_range[1] / fn.ic50.require():.3g}")
                elif fo.extrapolated:
                    reason = "off-target potency extrapolated below the tested range"
                if reason or fo is None or fn is None:
                    rq = Quantity.unavailable("dimensionless", label=f"relative potency {lab}",
                                              reason=reason or "not determined")
                    rp_rows.append((off.target, on.target, rq, "-", "-"))
                    continue
                rq = relative_potency(fo.ic50, fn.ic50)
                q[f"relative_potency.{off.assay_id}.{on.assay_id}"] = rq
                rp_rows.append((off.target, on.target, rq, fo.hill_slope, fn.hill_slope))
        if rp_rows:
            tables.append(tabulate(
                "Relative potency of the test article", ("off-target", "primary target",
                                                         "off / primary (95% CI)",
                                                         "Hill slope off", "Hill slope primary"),
                rp_rows, note="ratio of 50% effective concentrations (Ritz et al. 2015); with "
                              "different Hill slopes it applies at the 50% level only; no "
                              "threshold is applied"))
        return AnalysisResult(quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings),
                              evidence_admissible=True)

    # -- interpretation ------------------------------------------------------------------

    def _interpret(self, analysis: AnalysisResult, params: BaseModel,
                   context: ProgramContext | None) -> Interpretation:
        out: list[InterpretiveStatement] = []
        for k, v in analysis.quantities.items():
            if k.startswith("relative_potency.") and v.is_available:
                out.append(InterpretiveStatement(
                    f"{v.label}: {v.require():.3g}-fold at the 50% effect level.",
                    "ratio of fitted 50% effective concentrations", ("ritz2015",), "info"))
        out.append(InterpretiveStatement(
            "No regulatory threshold for selectivity exists in ICH M3(R2), S7A or S7B; ICH S7A "
            "2.4.1 compares doses eliciting adverse effects with those eliciting the primary "
            "effect in the safety pharmacology studies.", "ICH S7A 2.4.1", ("ich_s7a",), "info"))
        for f in analysis.qc.findings:
            out.append(InterpretiveStatement(
                f.message, "4PL curve fit and assay acceptance", ("delean1978",),
                "concern" if f.status is QCStatus.FAIL else "notable"))
        return Interpretation(statements=tuple(out), requires_expert_judgement=(
            "Pharmacological relevance of off-target activity at anticipated exposures",))

    # -- report ------------------------------------------------------------------------

    def _report_sections(self, protocol: ProtocolDocument, data: IngestedData,
                         analysis: AnalysisResult, interpretation: Interpretation,
                         determinations: Sequence[Mapping[str, Any]]) -> list[ReportSection]:
        return [
            ReportSection("Summary", f"{protocol.title}. Data are "
                          + ("SIMULATED (not measured)." if data.is_simulated else "measured.")),
            ReportSection("Design", "\n".join(f"- **{k}:** {v}"
                                              for k, v in protocol.design.items())),
            ReportSection("Results", "Concentration-response analysis.", tables=analysis.tables),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(self, params: BaseModel, compound: CompoundInfo, sim: BaseModel,
                       rng: np.random.Generator) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, PotencySimulation)
        truth = {(c.assay_id, c.compound): c for c in s.curves}
        rows: list[dict[str, Any]] = []
        for a in p.assays:
            for comp in [TEST] + ([a.reference.name] if a.reference else []):
                t = truth.get((a.assay_id, comp))
                if t is None:
                    raise ValueError(f"simulation needs a curve for {comp} in {a.assay_id}")
                lo, hi = (0.0, 100.0) if a.readout == "percent_inhibition" else (100.0, 0.0)
                for c in a.concentrations:
                    mean = lo + (hi - lo) / (1.0 + (t.ic50 / c) ** t.hill)
                    for k in range(a.replicates):
                        v = mean + (float(rng.normal(0.0, t.noise_sd)) if t.noise_sd else 0.0)
                        rows.append({"assay_id": a.assay_id, "compound": comp,
                                     "concentration": c, "replicate": k + 1, "response": v})
        return rows, "sim.four_parameter_logistic"
