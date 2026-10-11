"""Liver microsomal metabolic stability by substrate depletion, with IVIVE.

Design: the test article (and any positive controls) is incubated with liver microsomes
of each species with and without NADPH; parent is quantified by LC-MS/MS at the protocol
timepoints. Analysis follows the in vitro half-life approach of Obach (1999): first-order
depletion fit -> k, t1/2 -> CLint,app -> optional fu,mic correction (Hallifax & Houston
2006, domain per Gertz et al. 2008) -> scaling with cited MPPGL and liver weight ->
well-stirred hepatic clearance (Wilkinson & Shand 1975) -> extraction ratio.

Every scientific design value (substrate and protein concentration, temperature, buffer,
cofactor, timepoints) and every acceptance criterion is a parameter stated by the user,
with the basis of the acceptance criteria recorded. The driver supplies no defaults for
them; cited recommendations are offered separately (``recommendations.py``).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core.adme import (
    classify_extraction,
    clint_in_vitro,
    extraction_ratio,
    fit_depletion,
    fu_blood_from_plasma,
    fu_mic_hallifax_houston,
    hepatic_clearance_well_stirred,
    scale_clint_to_liver,
)
from hos.core.citations import cite
from hos.core.methods import method
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import MeasurementSeries, Quantity
from hos.core.reference_params import ReferenceParameterSet
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
    SummaryFacts,
    SummaryTable,
    ValueRef,
    fmt_param,
    tabulate,
)

Species = Literal["human", "rat", "mouse", "dog", "monkey"]
SPECIES: tuple[str, ...] = ("human", "rat", "mouse", "dog", "monkey")
TEST_ARTICLE_CODE = "TA"


class PositiveControl(BaseModel):
    name: str = Field(min_length=1)
    acceptance_clint_low_uL_min_mg: float | None = Field(default=None, gt=0)
    acceptance_clint_high_uL_min_mg: float | None = Field(default=None, gt=0)
    acceptance_basis: str | None = Field(
        default=None, description="Source of the acceptance range, e.g. lab SOP and revision"
    )

    @model_validator(mode="after")
    def _range(self) -> PositiveControl:
        lo, hi = self.acceptance_clint_low_uL_min_mg, self.acceptance_clint_high_uL_min_mg
        if (lo is None) != (hi is None):
            raise ValueError("give both ends of the acceptance range or neither")
        if lo is not None and hi is not None:
            if lo >= hi:
                raise ValueError("acceptance range low must be below high")
            if not self.acceptance_basis:
                raise ValueError("an acceptance range requires its basis (e.g. lab SOP id)")
        return self


class MetabolicStabilityParams(BaseModel):
    species: list[Species] = Field(min_length=1)
    substrate_concentration_uM: float = Field(gt=0)
    protein_concentration_mg_per_mL: float = Field(gt=0)
    incubation_temperature_C: float
    buffer: str = Field(min_length=1, description="e.g. composition, molarity and pH")
    cofactor: str = Field(
        min_length=1, description="e.g. NADPH concentration or regenerating system"
    )
    quench: str = Field(min_length=1, description="termination solvent incl. internal standard")
    analytical_method: str = Field(min_length=1)
    timepoints_min: list[float] = Field(min_length=3)
    replicates: int = Field(ge=1)
    include_minus_nadph_control: bool = True
    positive_controls: list[PositiveControl] = Field(default_factory=list)
    acceptance_min_r2: float = Field(gt=0, le=1)
    acceptance_min_depletion_percent: float = Field(ge=0, lt=100)
    acceptance_basis: str = Field(
        min_length=1, description="Where the acceptance criteria come from"
    )
    max_minus_nadph_loss_percent: float | None = Field(default=None, ge=0, lt=100)
    fu_mic_correction: Literal["none", "hallifax_houston"] = "none"

    @field_validator("timepoints_min")
    @classmethod
    def _times(cls, v: list[float]) -> list[float]:
        if v[0] != 0:
            raise ValueError("the first timepoint must be 0 min (the reference sample)")
        if any(b <= a for a, b in pairwise(v)):
            raise ValueError("timepoints must be strictly increasing")
        return v

    @field_validator("species")
    @classmethod
    def _unique_species(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("species must be unique")
        return v

    def compound_codes(self) -> list[str]:
        return [TEST_ARTICLE_CODE] + [f"PC{i + 1}" for i in range(len(self.positive_controls))]

    def cofactor_arms(self) -> list[str]:
        return ["NADPH", "none"] if self.include_minus_nadph_control else ["NADPH"]


class MetabolicStabilitySimulation(BaseModel):
    """True generator parameters. No defaults: the user states the model being simulated."""

    half_life_min: dict[str, float] = Field(description="true t1/2 per species (test article)")
    control_half_life_min: dict[str, dict[str, float]] = Field(
        default_factory=dict, description="code -> species -> t1/2"
    )
    minus_nadph_half_life_min: float | None = Field(
        default=None, gt=0, description="t1/2 without cofactor; omit for no loss"
    )
    t0_response: float = Field(gt=0)
    analytical_cv: float = Field(ge=0, lt=1, description="multiplicative log-normal noise SD")


def sample_id(code: str, species: str, cofactor: str, rep: int, t: float) -> str:
    return f"{code}-{species.upper()}-{'N' if cofactor == 'NADPH' else 'X'}-R{rep}-T{t:g}"


class MetabolicStabilityDriver(StudyDriver):
    id = "metabolic_stability"
    name = "Liver microsomal metabolic stability (substrate depletion) with IVIVE"
    version = "1.0.0"
    requirement_ids = ("adme.metabolic_stability",)
    modalities = frozenset({Modality.SMALL_MOLECULE})
    ctd_section = "4.2.2.4"
    glp_capable = False
    description = (
        "In vitro half-life by parent depletion in liver microsomes across species; "
        "CLint,app and well-stirred predicted hepatic clearance."
    )
    reference_keys = (
        "obach1999",
        "di_kerns2016",
        "wilkinson1975",
        "houston1994",
        "hallifax2006",
        "gertz2008",
        "barter2007",
    )

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return MetabolicStabilityParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return MetabolicStabilitySimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        sp = [s for s in requirement.species if s in SPECIES]
        return {"species": sp} if sp else {}

    # -- design ----------------------------------------------------------------

    # -- CTD Module 2.6 summaries (ABI 1.2) --------------------------------------

    def summary_facts(self, params: BaseModel) -> SummaryFacts | None:
        p = _p(params)
        return SummaryFacts(
            test_system="liver microsomes: " + ", ".join(str(s) for s in p.species),
            method_of_administration=f"in vitro incubation ({p.cofactor})",
            doses=(
                f"{fmt_param(p.substrate_concentration_uM)} µM substrate; "
                f"{fmt_param(p.protein_concentration_mg_per_mL)} mg/mL protein"
            ),
        )

    def summary_tables(
        self, params: BaseModel, results: Mapping[str, Any]
    ) -> tuple[SummaryTable, ...]:
        """In vitro metabolism (template 2.6.5.10): parent depletion by species."""
        p = _p(params)
        q = results.get("quantities", {})
        keys = ("t_half", "clint_app", "clint_in_vivo", "clh")
        rows = tuple(
            (str(sp), *(ValueRef(f"{sp}.{k}") if f"{sp}.{k}" in q else "—" for k in keys))
            for sp in p.species
            if any(f"{sp}.{k}" in q for k in keys)
        )
        return (
            SummaryTable(
                template="2.6.5.10",
                title="Pharmacokinetics: metabolic stability in liver microsomes",
                columns=("Species", "t1/2", "CLint,app", "CLint (scaled)", "Hepatic CL"),
                rows=rows,
                notes=(
                    "Parent depletion only: metabolites were not profiled, so the template's "
                    "metabolite rows do not apply.",
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
        controls = [c.name for c in p.positive_controls]
        steps = (
            ProtocolStep(
                1,
                "Prepare test article",
                f"Prepare {compound.name} so that the incubation concentration is "
                f"{p.substrate_concentration_uM:g} uM; record the stock solvent and its "
                "final concentration in the incubation.",
                ("substrate concentration", "organic solvent content"),
            ),
            ProtocolStep(
                2,
                "Prepare incubations",
                f"Dilute liver microsomes ({', '.join(p.species)}) to "
                f"{p.protein_concentration_mg_per_mL:g} mg/mL protein in {p.buffer}. "
                f"Pre-incubate at {p.incubation_temperature_C:g} C.",
                ("protein concentration", "temperature", "microsome lot recorded"),
            ),
            ProtocolStep(
                3,
                "Initiate",
                f"Start reactions by adding cofactor ({p.cofactor}). "
                + (
                    "Run a matched arm without cofactor ('none') to detect NADPH-independent loss. "
                    if p.include_minus_nadph_control
                    else ""
                )
                + f"{p.replicates} replicate(s) per arm.",
                ("time zero defined at cofactor addition",),
            ),
            ProtocolStep(
                4,
                "Sample",
                "Remove aliquots at "
                + ", ".join(f"{t:g}" for t in p.timepoints_min)
                + f" min into {p.quench}. Label each sample with its sample_id from "
                "sample_manifest.csv.",
                ("exact sampling times", "quench volume ratio"),
            ),
            ProtocolStep(
                5,
                "Analyse",
                f"Centrifuge and quantify parent by {p.analytical_method}. Report the "
                "analyte/internal-standard response ratio per sample; mark samples below "
                "the lower limit of quantification as blq=yes with an empty response.",
                ("same internal standard across a time course",),
            ),
            ProtocolStep(
                6,
                "Return data",
                "Return one CSV per data_template.csv with the required metadata.",
                (),
            ),
        )
        criteria = [
            AcceptanceCriterion(
                "depletion_fit_r2",
                f"ln(% remaining) vs time regression R^2 >= {p.acceptance_min_r2:g}",
                p.acceptance_basis,
            ),
            AcceptanceCriterion(
                "minimum_depletion",
                f"total depletion >= {p.acceptance_min_depletion_percent:g}% for "
                "CLint,app to be reported as determined (else reported as below "
                "the assay's resolving power)",
                p.acceptance_basis,
            ),
        ]
        if p.max_minus_nadph_loss_percent is not None:
            criteria.append(
                AcceptanceCriterion(
                    "minus_nadph_loss",
                    f"loss without cofactor <= {p.max_minus_nadph_loss_percent:g}%",
                    p.acceptance_basis,
                )
            )
        for i, c in enumerate(p.positive_controls):
            if c.acceptance_clint_low_uL_min_mg is not None:
                criteria.append(
                    AcceptanceCriterion(
                        f"positive_control_PC{i + 1}",
                        f"{c.name} CLint,app within {c.acceptance_clint_low_uL_min_mg:g}-"
                        f"{c.acceptance_clint_high_uL_min_mg:g} uL/min/mg",
                        c.acceptance_basis or "",
                    )
                )
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Metabolic stability of {compound.name} in liver microsomes "
            f"({', '.join(p.species)})",
            objective="Determine the in vitro half-life and apparent intrinsic clearance of the "
            "test article by parent depletion, and project hepatic clearance by IVIVE.",
            hypothesis=hypothesis,
            test_article={
                "name": compound.name,
                "id": compound.id,
                "smiles": compound.smiles,
                "inchikey": compound.inchikey or "not computed",
            },
            test_system={
                "system": "liver microsomes",
                "species": ", ".join(p.species),
                "positive_controls": ", ".join(controls) or "none specified",
            },
            design={
                "substrate_concentration": f"{p.substrate_concentration_uM:g} uM",
                "protein_concentration": f"{p.protein_concentration_mg_per_mL:g} mg/mL",
                "temperature": f"{p.incubation_temperature_C:g} C",
                "buffer": p.buffer,
                "cofactor": p.cofactor,
                "timepoints_min": [f"{t:g}" for t in p.timepoints_min],
                "replicates": p.replicates,
                "arms": ", ".join(p.cofactor_arms()),
                "fu_mic_correction": p.fu_mic_correction,
            },
            steps=steps,
            acceptance_criteria=tuple(criteria),
            materials=(
                f"Liver microsomes: {', '.join(p.species)} (record supplier and lot)",
                f"Cofactor: {p.cofactor}",
                f"Buffer: {p.buffer}",
                f"Quench: {p.quench}",
                *(f"Positive control: {c}" for c in controls),
            ),
            deliverables=(
                "data CSV per template",
                "LC-MS/MS method summary",
                "microsome lot certificates",
            ),
            glp=False,
            references=tuple(cite(k) for k in ("obach1999", "di_kerns2016", "wilkinson1975")),
            regulatory_basis=("ICH M3(R2) section 3: in vitro metabolic data across species",),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(self._manifest(p))
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"bench scheduling is set by the laboratory; each incubation spans "
            f"{p.timepoints_min[-1]:g} min",
            sample_count=n,
            sample_count_basis=(
                f"test article: {len(p.species)} species x {len(p.cofactor_arms())} arm(s) x "
                f"{p.replicates} replicate(s) x {len(p.timepoints_min)} timepoints"
                + (
                    f"; {len(p.positive_controls)} positive control(s): {len(p.species)} species x "
                    f"NADPH arm x {p.replicates} replicate(s) x {len(p.timepoints_min)} timepoints"
                    if p.positive_controls
                    else ""
                )
            ),
            dependencies=("test article identity and purity documented",),
            material_requirements=tuple(protocol.materials),
        )

    def _manifest(self, p: MetabolicStabilityParams) -> list[dict[str, Any]]:
        names = {
            TEST_ARTICLE_CODE: "test article",
            **{f"PC{i + 1}": c.name for i, c in enumerate(p.positive_controls)},
        }
        rows = []
        for code in p.compound_codes():
            for sp in p.species:
                for cof in p.cofactor_arms():
                    if code != TEST_ARTICLE_CODE and cof == "none":
                        continue
                    for r in range(1, p.replicates + 1):
                        for t in p.timepoints_min:
                            rows.append(
                                {
                                    "sample_id": sample_id(code, sp, cof, r, t),
                                    "compound_code": code,
                                    "compound": names[code],
                                    "species": sp,
                                    "cofactor": cof,
                                    "replicate": r,
                                    "time_min": f"{t:g}",
                                }
                            )
        return rows

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        rows = self._manifest(_p(params))
        for r in rows:
            if r["compound_code"] == TEST_ARTICLE_CODE:
                r["compound"] = compound.name
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per sample in sample_manifest.csv: parent response by LC-MS/MS.",
            columns=(
                DataColumn("sample_id", "sample id from sample_manifest.csv", kind="text"),
                DataColumn(
                    "compound_code",
                    "TA = test article, PCn = positive control",
                    kind="text",
                    choices=tuple(p.compound_codes()),
                ),
                DataColumn("species", "microsome species", kind="text", choices=tuple(p.species)),
                DataColumn(
                    "cofactor", "NADPH or none", kind="text", choices=tuple(p.cofactor_arms())
                ),
                DataColumn("replicate", "replicate number", kind="integer", minimum=1),
                DataColumn("time", "sampling time after cofactor addition", unit="min", minimum=0),
                DataColumn(
                    "response",
                    "analyte / internal standard response ratio",
                    unit="dimensionless",
                    required=False,
                    minimum=0,
                    exclusive_minimum=True,
                ),
                DataColumn(
                    "blq", "below lower limit of quantification", kind="text", choices=("yes", "no")
                ),
            ),
        )

    def validate_records(
        self, records: Sequence[Mapping[str, Any]], params: BaseModel
    ) -> tuple[list[str], list[str]]:
        p = _p(params)
        manifest = {r["sample_id"]: r for r in self._manifest(p)}
        errors: list[str] = []
        warnings: list[str] = []
        seen: set[str] = set()
        for i, r in enumerate(records, start=1):
            sid = r["sample_id"]
            m = manifest.get(sid)
            if m is None:
                errors.append(f"row {i}: sample_id {sid!r} is not in the sample manifest")
                continue
            if sid in seen:
                errors.append(f"row {i}: duplicate sample_id {sid!r}")
            seen.add(sid)
            if (r["compound_code"], r["species"], r["cofactor"], r["replicate"]) != (
                m["compound_code"],
                m["species"],
                m["cofactor"],
                m["replicate"],
            ) or abs(r["time"] - float(m["time_min"])) > 1e-9:
                errors.append(f"row {i}: fields do not match the manifest entry for {sid!r}")
            if r["blq"] == "no" and r.get("response") is None:
                errors.append(f"row {i}: response is required when blq=no")
            if r["blq"] == "yes" and r.get("response") is not None:
                errors.append(f"row {i}: response must be empty when blq=yes")
        missing = sorted(set(manifest) - seen)
        if missing:
            warnings.append(
                f"{len(missing)} manifest sample(s) not returned: "
                + ", ".join(missing[:10])
                + (" ..." if len(missing) > 10 else "")
            )
        # every series needs a quantifiable zero-time reference
        t0 = {
            (r["compound_code"], r["species"], r["cofactor"])
            for r in records
            if r["time"] == 0 and r["blq"] == "no"
        }
        series = {(r["compound_code"], r["species"], r["cofactor"]) for r in records}
        for s in sorted(series - t0):
            errors.append(f"series {s} has no quantifiable 0 min sample")
        return errors, warnings

    # -- analysis --------------------------------------------------------------

    def analysis_inputs(self, params: BaseModel) -> Mapping[str, str]:
        p = _p(params)
        out: dict[str, str] = {}
        for sp in p.species:
            out[f"fu_plasma.{sp}"] = "dimensionless"
            out[f"blood_plasma_ratio.{sp}"] = "dimensionless"
        if p.fu_mic_correction == "hallifax_houston":
            out["lipophilicity_logP_or_logD74"] = "dimensionless"
        return out

    def _series(
        self, data: IngestedData, code: str, species: str, cofactor: str
    ) -> tuple[MeasurementSeries | None, list[str]]:
        by_t: dict[float, list[float]] = defaultdict(list)
        blq_t: set[float] = set()
        for r in data.records:
            if (r["compound_code"], r["species"], r["cofactor"]) != (code, species, cofactor):
                continue
            if r["blq"] == "yes":
                blq_t.add(r["time"])
            else:
                by_t[r["time"]].append(float(r["response"]))
        notes = []
        excluded = sorted(blq_t - set(by_t))
        if excluded:
            notes.append(f"{code}/{species}/{cofactor}: timepoints {excluded} all BLQ, excluded")
        ts = sorted(by_t)
        if len(ts) < 2:
            return None, notes
        return MeasurementSeries(
            x=tuple(ts),
            y=tuple(float(np.mean(by_t[t])) for t in ts),
            x_unit="min",
            y_unit="dimensionless",
            provenance=data.provenance(),
            x_label="time",
            y_label=f"mean response ({code}, {species}, {cofactor})",
        ), notes

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        rp = ReferenceParameterSet()
        protein = Quantity.user_supplied(
            p.protein_concentration_mg_per_mL,
            "mg/mL",
            actor="study protocol",
            label="Microsomal protein concentration",
        )
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        notes: list[str] = []
        series_out: list[dict[str, Any]] = []
        summary_rows, course_rows, control_rows = [], [], []
        pr_method = method("adme.percent_remaining")

        def unavailable(unit: str, label: str, reason: str) -> Quantity:
            return Quantity.unavailable(unit, reason=reason, label=label)

        lipo = inputs.get("lipophilicity_logP_or_logD74")
        for sp in p.species:
            s, n = self._series(data, TEST_ARTICLE_CODE, sp, "NADPH")
            notes += n
            if s is None:
                findings.append(
                    QCFinding(
                        f"{sp}.no_series",
                        QCStatus.FAIL,
                        f"{sp}: fewer than two quantifiable timepoints",
                    )
                )
                continue
            series_out.append(s.to_dict())
            fit = fit_depletion(
                s, min_r2=p.acceptance_min_r2, min_depletion_pct=p.acceptance_min_depletion_percent
            )
            findings += [
                QCFinding(f"{sp}.{f.code}", f.status, f.message, f.observed, f.threshold)
                for f in fit.qc.findings
            ]
            for t, y in zip(s.x, s.y, strict=True):
                course_rows.append(
                    (
                        sp,
                        Quantity.user_supplied(
                            t, "min", actor="study protocol", label="nominal sampling time"
                        ),
                        Quantity.computed(
                            100.0 * y / s.y[0], "percent", method=pr_method, label="% remaining"
                        ),
                    )
                )
            clint = clint_in_vitro(fit, protein)
            fu_mic = None
            if p.fu_mic_correction == "hallifax_houston":
                fu_mic = (
                    fu_mic_hallifax_houston(lipo, protein)
                    if lipo is not None
                    else unavailable(
                        "dimensionless", "fu,mic", "lipophilicity (logP or logD7.4) not supplied"
                    )
                )
            civ = scale_clint_to_liver(clint, sp, params=rp, fu_mic=fu_mic)
            fup = inputs.get(f"fu_plasma.{sp}") or unavailable(
                "dimensionless", f"fu,p ({sp})", f"plasma unbound fraction for {sp} not supplied"
            )
            bp = inputs.get(f"blood_plasma_ratio.{sp}") or unavailable(
                "dimensionless", f"B:P ({sp})", f"blood:plasma ratio for {sp} not supplied"
            )
            fub = fu_blood_from_plasma(fup, bp)
            clh = hepatic_clearance_well_stirred(civ, fub, sp, params=rp)
            eh = extraction_ratio(clh, sp, params=rp)
            fh = (
                Quantity.computed(
                    1.0 - eh.require(),
                    "dimensionless",
                    method=method("adme.extraction_ratio"),
                    inputs=[eh],
                    parameter_set_version=rp.version,
                    label=f"Fh, predicted hepatic availability ({sp})",
                    qc_flags=eh.qc_flags,
                )
                if eh.is_available
                else unavailable("dimensionless", f"Fh ({sp})", eh.provenance.reason or "")
            )
            for key, val in (
                ("k", fit.k),
                ("t_half", fit.half_life),
                ("clint_app", clint),
                ("clint_in_vivo", civ),
                ("fu_blood", fub),
                ("clh", clh),
                ("eh", eh),
                ("fh", fh),
            ):
                q[f"{sp}.{key}"] = val
            if fu_mic is not None:
                q[f"{sp}.fu_mic"] = fu_mic
            summary_rows.append(
                (sp, fit.half_life, clint, civ, clh, eh, classify_extraction(eh), fh)
            )

            if p.include_minus_nadph_control:
                sx, n = self._series(data, TEST_ARTICLE_CODE, sp, "none")
                notes += n
                if sx is not None:
                    series_out.append(sx.to_dict())
                    rem = Quantity.computed(
                        100.0 * sx.y[-1] / sx.y[0],
                        "percent",
                        method=pr_method,
                        label=f"% remaining without NADPH at {sx.x[-1]:g} min ({sp})",
                    )
                    q[f"{sp}.minus_nadph_remaining"] = rem
                    loss = 100.0 - rem.require()
                    if (
                        p.max_minus_nadph_loss_percent is not None
                        and loss > p.max_minus_nadph_loss_percent
                    ):
                        findings.append(
                            QCFinding(
                                f"{sp}.minus_nadph_loss",
                                QCStatus.WARN,
                                f"{sp}: {loss:.1f}% loss without NADPH exceeds the "
                                f"{p.max_minus_nadph_loss_percent:g}% criterion; non-NADPH-dependent "
                                "loss contributes to depletion",
                                round(loss, 2),
                                p.max_minus_nadph_loss_percent,
                            )
                        )

            for i, pc in enumerate(p.positive_controls):
                code = f"PC{i + 1}"
                cs, n = self._series(data, code, sp, "NADPH")
                notes += n
                if cs is None:
                    continue
                series_out.append(cs.to_dict())
                cfit = fit_depletion(
                    cs,
                    min_r2=p.acceptance_min_r2,
                    min_depletion_pct=p.acceptance_min_depletion_percent,
                )
                cclint = clint_in_vitro(cfit, protein).relabel(f"CLint,app {pc.name} ({sp})")
                q[f"control.{code}.{sp}.clint_app"] = cclint
                verdict = "no acceptance range supplied"
                if pc.acceptance_clint_low_uL_min_mg is not None and cclint.is_available:
                    lo, hi = pc.acceptance_clint_low_uL_min_mg, pc.acceptance_clint_high_uL_min_mg
                    ok = lo <= cclint.require() <= (hi or lo)
                    verdict = "within range" if ok else "OUTSIDE range"
                    if not ok:
                        findings.append(
                            QCFinding(
                                f"{sp}.{code}.out_of_range",
                                QCStatus.FAIL,
                                f"positive control {pc.name} ({sp}) CLint,app outside "
                                f"{lo:g}-{hi:g} uL/min/mg ({pc.acceptance_basis}); run not "
                                "acceptable",
                                round(cclint.require(), 3),
                                [lo, hi],
                            )
                        )
                control_rows.append((pc.name, sp, cfit.half_life, cclint, verdict))

        tables = [
            tabulate(
                "Test article: depletion and IVIVE by species",
                ("species", "t1/2", "CLint,app", "CLint,in vivo", "CLh", "Eh", "extraction", "Fh"),
                summary_rows,
                note="Well-stirred model; reference parameters registry " + rp.version,
            )
        ]
        if course_rows:
            tables.append(
                tabulate(
                    "Test article time course (NADPH arm, mean of replicates)",
                    ("species", "time", "% remaining"),
                    course_rows,
                )
            )
        if control_rows:
            tables.append(
                tabulate(
                    "Positive controls",
                    ("control", "species", "t1/2", "CLint,app", "acceptance"),
                    control_rows,
                )
            )
        return AnalysisResult(
            quantities=q,
            tables=tuple(tables),
            qc=QCVerdict.of(findings),
            evidence_admissible=True,
            series=tuple(series_out),
            notes=tuple(notes),
        )

    # -- interpretation --------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        judgement: list[str] = []
        for sp in p.species:
            eh = analysis.quantities.get(f"{sp}.eh")
            clint = analysis.quantities.get(f"{sp}.clint_app")
            if clint is not None and "insufficient_depletion" in clint.qc_flags:
                out.append(
                    InterpretiveStatement(
                        f"In {sp} microsomes total depletion was below the "
                        f"{p.acceptance_min_depletion_percent:g}% criterion; CLint,app is poorly "
                        "determined and should be reported as below the assay's resolving power.",
                        f"acceptance criterion 'minimum_depletion' ({p.acceptance_basis})",
                        ("obach1999",),
                        "notable",
                    )
                )
            if clint is not None and "poor_depletion_fit" in clint.qc_flags:
                out.append(
                    InterpretiveStatement(
                        f"In {sp} microsomes the ln-linear fit did not meet R^2 >= "
                        f"{p.acceptance_min_r2:g}; first-order depletion may not hold.",
                        f"acceptance criterion 'depletion_fit_r2' ({p.acceptance_basis})",
                        ("obach1999",),
                        "notable",
                    )
                )
            if eh is not None and eh.is_available:
                band = classify_extraction(eh)
                out.append(
                    InterpretiveStatement(
                        f"Predicted hepatic extraction in {sp} is {band} (Eh = {eh.require():.2f}).",
                        "Eh = CLh/Qh with the well-stirred model; conventional bands <0.3 low, "
                        "0.3-0.7 intermediate, >0.7 high",
                        ("wilkinson1975", "obach1999"),
                        "concern" if band == "high" else "info",
                    )
                )
            elif eh is not None:
                out.append(
                    InterpretiveStatement(
                        f"Hepatic clearance in {sp} was not projected: {eh.provenance.reason}.",
                        "IVIVE requires CLint, fu,blood and cited physiological scalars",
                        ("obach1999",),
                        "info",
                    )
                )
            fu_mic = analysis.quantities.get(f"{sp}.fu_mic")
            if fu_mic is not None and "out_of_applicability_domain" in fu_mic.qc_flags:
                out.append(
                    InterpretiveStatement(
                        f"The predicted fu,mic used for {sp} is outside the range in which the "
                        "Hallifax-Houston equation was found reliable; measure fu,inc.",
                        "applicability domain logP/D 0-3 (below 5 at <= 0.1 mg/mL protein)",
                        ("gertz2008", "hallifax2006"),
                        "notable",
                    )
                )
            rem = analysis.quantities.get(f"{sp}.minus_nadph_remaining")
            if rem is not None and p.max_minus_nadph_loss_percent is None:
                judgement.append(
                    f"Significance of {rem.require():.1f}% parent remaining at the "
                    f"last timepoint without NADPH in {sp} (no laboratory criterion "
                    "supplied)"
                )
        for f in analysis.qc.findings:
            if f.code.endswith("out_of_range"):
                out.append(
                    InterpretiveStatement(
                        f"Run acceptance failed: {f.message}.",
                        "positive-control acceptance criterion",
                        ("di_kerns2016",),
                        "concern",
                    )
                )
        if any(c.acceptance_clint_low_uL_min_mg is None for c in p.positive_controls):
            judgement.append(
                "Acceptability of positive-control results (no acceptance range supplied)"
            )
        if not p.positive_controls:
            judgement.append("Run acceptability without a positive control")
        judgement.append("Selection of species and scaling approach for human clearance prediction")
        return Interpretation(statements=tuple(out), requires_expert_judgement=tuple(judgement))

    # -- report ----------------------------------------------------------------

    def _report_sections(
        self,
        protocol: ProtocolDocument,
        data: IngestedData,
        analysis: AnalysisResult,
        interpretation: Interpretation,
        determinations: Sequence[Mapping[str, Any]],
    ) -> list[ReportSection]:
        p = protocol.parameters
        qc = "\n".join(f"- [{f.status.value}] {f.code}: {f.message}" for f in analysis.qc.findings)
        return [
            ReportSection(
                "Summary",
                f"Parent depletion was "
                f"{'SIMULATED (not measured)' if data.is_simulated else 'measured'} in "
                f"liver microsomes of "
                f"{', '.join(p['species'])} at {p['substrate_concentration_uM']:g} uM "
                f"substrate and {p['protein_concentration_mg_per_mL']:g} mg/mL protein. "
                "CLint,app follows the in vitro half-life method (Obach 1999); hepatic "
                "clearance uses the well-stirred model.",
                tables=analysis.tables[:1],
            ),
            ReportSection(
                "Study design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection("Results", "Time courses and controls.", tables=analysis.tables[1:]),
            ReportSection("Quality control", qc or "All acceptance criteria met."),
        ]

    # -- simulation ------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, MetabolicStabilitySimulation)
        missing = [sp for sp in p.species if sp not in s.half_life_min]
        if missing:
            raise ValueError(f"simulation needs half_life_min for {missing}")
        rows = []
        for m in self._manifest(p):
            code, sp, cof, t = m["compound_code"], m["species"], m["cofactor"], float(m["time_min"])
            if code == TEST_ARTICLE_CODE:
                th = s.half_life_min[sp] if cof == "NADPH" else s.minus_nadph_half_life_min
            else:
                th = s.control_half_life_min.get(code, {}).get(sp)
                if th is None:
                    raise ValueError(f"simulation needs control_half_life_min[{code}][{sp}]")
            k = 0.0 if th is None else np.log(2.0) / th
            noise = float(np.exp(rng.normal(0.0, s.analytical_cv))) if s.analytical_cv else 1.0
            rows.append(
                {
                    "sample_id": m["sample_id"],
                    "compound_code": code,
                    "species": sp,
                    "cofactor": cof,
                    "replicate": m["replicate"],
                    "time": t,
                    "response": s.t0_response * float(np.exp(-k * t)) * noise,
                    "blq": "no",
                }
            )
        return rows, "sim.first_order_depletion"


def _p(params: BaseModel) -> MetabolicStabilityParams:
    if not isinstance(params, MetabolicStabilityParams):
        raise TypeError("expected MetabolicStabilityParams")
    return params
