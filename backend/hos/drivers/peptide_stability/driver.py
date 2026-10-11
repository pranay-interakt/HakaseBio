"""Peptide stability in whole blood, serum or plasma (docs/14 Wave P, P-2).

Serves the in vitro metabolism expectation of ICH M3(R2) section 3 for peptides. FDA's draft
peptide guidance (December 2023) states that peptides are generally degraded by endopeptidases
and then exopeptidases, and that proteolysis is not confined to the organs of elimination, so
depletion in blood, serum or plasma is the in vitro stability endpoint for systemic exposure
(Di 2015 maps blood, serum and plasma to "degradation in systemic circulation").

Design facts from the primary papers (docs/research/drivers/peptide_stability.md):

* the matrix decides the result: the same peptide degrades at different rates in fresh blood,
  serum and heparin or EDTA plasma, and the rank order of peptides changes between them
  (Böttger et al. 2017). Matrix type, anticoagulant, clot activation, freshness and dilution
  are therefore required facts of every condition;
* peptide concentration, matrix content, temperature, sampling times and quench differ between
  papers (5 µM to about 0.5 mM; 25% to 100% matrix; 10 min to 24 h), so each is a protocol
  parameter with no default;
* intact peptide is expressed relative to the time-zero sample of the same replicate.

The fit (first-order or one-phase decay) is the protocol's choice; see
``hos.core.peptide_stability``. A between-species comparison is stated only for conditions
that differ in species alone. A protease panel is not built: no source read defines one.
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
from hos.core.peptide_stability import fit_decay, percent_of_time_zero
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

#: Fields of a condition other than its id; conditions equal in all but ``species`` are matched.
_CONDITION_FACTS = (
    "matrix",
    "anticoagulant",
    "serum_clot_activator",
    "freshly_collected",
    "matrix_percent",
    "pretreatment",
)


class Condition(BaseModel):
    """One incubation matrix. Every fact that changes the result is stated (Böttger 2017)."""

    id: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,40}$")
    species: str = Field(min_length=1)
    matrix: Literal["whole_blood", "serum", "plasma"]
    anticoagulant: str | None = Field(
        default=None, description="plasma and whole blood: e.g. K2-EDTA, lithium heparin"
    )
    serum_clot_activator: bool | None = Field(
        default=None, description="serum: clotted in an activator (separator) tube or not"
    )
    freshly_collected: bool = Field(description="freshly drawn, versus stored or commercial")
    material_source: str = Field(
        min_length=1, description="e.g. commercial pooled, lot; or in-house donors"
    )
    matrix_percent: float = Field(
        gt=0, le=100, description="matrix content of the incubation, % v/v"
    )
    pretreatment: str | None = Field(
        default=None, description="e.g. centrifuged to remove lipids, pre-warmed"
    )

    @model_validator(mode="after")
    def _facts(self) -> Condition:
        if self.matrix in ("plasma", "whole_blood") and not (self.anticoagulant or "").strip():
            raise ValueError(f"{self.id}: state the anticoagulant of {self.matrix}")
        if self.matrix == "serum":
            if self.anticoagulant:
                raise ValueError(f"{self.id}: serum has no anticoagulant")
            if self.serum_clot_activator is None:
                raise ValueError(
                    f"{self.id}: state whether the serum was clotted with an "
                    "activator (it changes degradation rates, Böttger 2017)"
                )
        elif self.serum_clot_activator is not None:
            raise ValueError(f"{self.id}: clot activation applies to serum only")
        return self

    def describe(self) -> str:
        extra = (f", {self.anticoagulant}" if self.anticoagulant else "") + (
            ", activator tube"
            if self.serum_clot_activator
            else ", no activator"
            if self.serum_clot_activator is False
            else ""
        )
        return (
            f"{self.species} {self.matrix.replace('_', ' ')}{extra}, {self.matrix_percent:g}%"
            f", {'fresh' if self.freshly_collected else 'stored'} ({self.material_source})"
        )


class PeptideStabilityParams(BaseModel):
    glp: bool
    conditions: list[Condition] = Field(min_length=1)
    peptide_concentration: float = Field(gt=0)
    concentration_unit: str
    temperature_c: float
    agitation: str = Field(min_length=1)
    sampling_times_min: list[float] = Field(min_length=3)
    replicates: int = Field(ge=1)
    quench: str = Field(
        min_length=1,
        description="composition and handling, incl. any base "
        "added to prevent co-precipitation (Nguyen 2010)",
    )
    quantification: str = Field(min_length=1, description="e.g. RP-HPLC C18 at 214 nm; LC-MS")
    response: Literal["peak_area", "peak_area_ratio", "concentration"]
    fit_model: Literal["first_order", "one_phase_decay"]
    fit_model_basis: str = Field(min_length=1)
    min_r2: float = Field(gt=0, le=1)
    min_depletion_percent: float = Field(ge=0, lt=100)
    acceptance_basis: str = Field(min_length=1, description="where the fit criteria come from")

    @field_validator("concentration_unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r}")
        return v

    @field_validator("sampling_times_min")
    @classmethod
    def _times(cls, v: list[float]) -> list[float]:
        if v[0] != 0 or any(b <= a for a, b in pairwise(v)):
            raise ValueError(
                "sampling times start at 0 (the normalisation sample) and strictly increase"
            )
        return v

    @model_validator(mode="after")
    def _design(self) -> PeptideStabilityParams:
        ids = [c.id for c in self.conditions]
        if len(set(ids)) != len(ids):
            raise ValueError("condition ids must be unique")
        if self.fit_model == "one_phase_decay" and len(self.sampling_times_min) < 4:
            raise ValueError(
                "the one-phase decay model has three parameters: sample at four or more times"
            )
        return self


class TrueDecay(BaseModel):
    condition: str
    half_life_min: float = Field(gt=0)
    plateau_percent: float = Field(ge=0, lt=100)


class PeptideStabilitySimulation(BaseModel):
    """True generator parameters; all stated by the user."""

    decay: list[TrueDecay] = Field(min_length=1)
    time_zero_response: float = Field(gt=0)
    proportional_sd_log: float = Field(ge=0, lt=1)
    quantitation_limit_percent: float = Field(
        ge=0,
        lt=100,
        description="responses below this % of time zero are returned as below the limit",
    )


def _p(params: BaseModel) -> PeptideStabilityParams:
    if not isinstance(params, PeptideStabilityParams):
        raise TypeError("expected PeptideStabilityParams")
    return params


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


class PeptideStabilityDriver(StudyDriver):
    id = "peptide_stability"
    name = "Peptide stability in blood, serum or plasma"
    version = "1.0.0"
    requirement_ids = ("adme.metabolic_stability",)
    modalities = frozenset({Modality.PEPTIDE})
    ctd_section = "4.2.2.4"
    glp_capable = True
    description = (
        "Depletion of intact peptide in stated blood, serum or plasma conditions; "
        "half-life with 95% CI by the protocol's model, censoring beyond the last "
        "sample, and a plateau check for incomplete degradation."
    )
    reference_keys = (
        "ich_m3r2",
        "bottger2017",
        "cavaco2021",
        "nguyen2010",
        "di2015",
        "fda_peptide_clinpharm_draft_2023",
        "graphpad_one_phase_decay",
        "obach1999",
    )

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return PeptideStabilityParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return PeptideStabilitySimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        return {"glp": requirement.glp}

    # -- design ----------------------------------------------------------------------

    def design(
        self,
        compound: CompoundInfo,
        params: BaseModel,
        context: ProgramContext | None = None,
        hypothesis: str | None = None,
    ) -> ProtocolDocument:
        p = _p(params)
        times = ", ".join(f"{t:g}" for t in p.sampling_times_min)
        notes = []
        species = {c.species for c in p.conditions}
        if len(species) > 1 and not _matched_pairs(p.conditions):
            notes.append(
                "species differ but no two conditions differ in species alone: "
                "between-species comparison will not be stated"
            )
        design: dict[str, Any] = {
            "conditions": [
                f"{c.id}: {c.describe()}" + (f"; {c.pretreatment}" if c.pretreatment else "")
                for c in p.conditions
            ],
            "incubation": f"{p.peptide_concentration:g} {p.concentration_unit} peptide at "
            f"{p.temperature_c:g} °C, {p.agitation}",
            "sampling": f"{times} min, {p.replicates} replicate(s) per condition",
            "quench": p.quench,
            "quantification": f"{p.quantification}; {p.response.replace('_', ' ')} of the intact "
            "parent relative to the same replicate's time-zero sample",
            "fit": f"{p.fit_model.replace('_', ' ')} ({p.fit_model_basis}); acceptance R^2 >= "
            f"{p.min_r2:g}, depletion >= {p.min_depletion_percent:g}% "
            f"({p.acceptance_basis})",
        }
        if notes:
            design["design_notes"] = notes
        return ProtocolDocument(
            driver_id=self.id,
            driver_version=self.version,
            title=f"Stability of {compound.name} in blood, serum or plasma",
            objective="Measure the loss of intact peptide in the stated matrices over time and "
            "estimate its in vitro half-life (ICH M3(R2) section 3, in vitro "
            "metabolism for peptides).",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id},
            test_system={"conditions": [c.model_dump() for c in p.conditions]},
            design=design,
            steps=(
                ProtocolStep(
                    1,
                    "Matrix preparation",
                    "Prepare each condition exactly as "
                    "stated (matrix, anticoagulant or clot activation, freshness, "
                    "dilution, pretreatment) and pre-warm.",
                    (),
                ),
                ProtocolStep(
                    2,
                    "Incubation",
                    f"Add the peptide to {p.peptide_concentration:g} "
                    f"{p.concentration_unit}; incubate at {p.temperature_c:g} °C with "
                    f"{p.agitation}.",
                    (),
                ),
                ProtocolStep(
                    3, "Sampling and quench", f"Sample at {times} min and quench: {p.quench}.", ()
                ),
                ProtocolStep(
                    4,
                    "Analysis",
                    f"Quantify the intact parent ({p.quantification}). "
                    "Report a sample below the quantitation limit as such; do not "
                    "enter zero.",
                    (),
                ),
                ProtocolStep(5, "Return data", "One row per sample per data_template.csv.", ()),
            ),
            acceptance_criteria=(
                AcceptanceCriterion("fit.r2", f"fit R^2 at least {p.min_r2:g}", p.acceptance_basis),
                AcceptanceCriterion(
                    "fit.depletion",
                    f"at least {p.min_depletion_percent:g}% depletion by the last sample",
                    p.acceptance_basis,
                ),
            ),
            materials=tuple(c.describe() for c in p.conditions),
            deliverables=("data CSV per template", "peptide stability report"),
            glp=p.glp,
            references=tuple(cite(k) for k in self.reference_keys),
            regulatory_basis=(
                "ICH M3(R2) section 3",
                "FDA draft guidance, peptide drug products (December 2023)",
            ),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(p.conditions) * p.replicates * len(p.sampling_times_min)
        return StudyPlan(
            execution_duration_days=None,
            duration_basis=f"incubations to {p.sampling_times_min[-1]:g} min; scheduling and "
            "analysis turnaround are set by the laboratory",
            sample_count=n,
            sample_count_basis="conditions x replicates x sampling times",
            dependencies=("a quantification method for the intact peptide in each matrix",),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(
        self, params: BaseModel, compound: CompoundInfo
    ) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        return tuple(
            {"condition": c.id, "replicate": r + 1, "time_min": f"{t:g}"}
            for c in p.conditions
            for r in range(p.replicates)
            for t in p.sampling_times_min
        )

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        unit = p.concentration_unit if p.response == "concentration" else "dimensionless"
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per sample. A sample below the quantitation limit has "
            "below_limit=yes and an empty response; it is excluded from the fit, "
            "never set to zero. Every replicate needs a quantifiable time-zero "
            "sample.",
            columns=(
                DataColumn(
                    "condition",
                    "incubation condition",
                    kind="text",
                    choices=tuple(c.id for c in p.conditions),
                ),
                DataColumn("replicate", "replicate incubation", kind="integer", minimum=1),
                DataColumn("time_min", "sampling time", unit="min", minimum=0),
                DataColumn(
                    "response",
                    f"intact parent ({p.response.replace('_', ' ')})",
                    unit=unit,
                    required=False,
                    exclusive_minimum=True,
                    minimum=0,
                ),
                DataColumn(
                    "below_limit",
                    "below the quantitation limit",
                    kind="text",
                    choices=("yes", "no"),
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
        zero: dict[tuple[str, int], bool] = {}
        for i, r in enumerate(records, start=1):
            cond, rep, t = str(r["condition"]), int(r["replicate"]), float(r["time_min"])
            if not any(_same(t, s) for s in p.sampling_times_min):
                errors.append(f"row {i}: {t:g} min is not a protocol sampling time")
            if (cond, rep, t) in seen:
                errors.append(f"row {i}: duplicate sample {cond} replicate {rep} at {t:g} min")
            seen.add((cond, rep, t))
            blq, v = r["below_limit"] == "yes", r.get("response")
            if blq and v is not None:
                errors.append(f"row {i}: a sample below the limit has no response")
            if not blq and v is None:
                errors.append(f"row {i}: response is required when below_limit=no")
            if t == 0:
                zero[(cond, rep)] = not blq
        for c in p.conditions:
            for rep in range(1, p.replicates + 1):
                if not zero.get((c.id, rep)):
                    errors.append(
                        f"{c.id} replicate {rep}: no quantifiable time-zero sample to normalise to"
                    )
        expected = len(p.conditions) * p.replicates * len(p.sampling_times_min)
        if len(seen) < expected:
            warnings.append(f"{expected - len(seen)} of {expected} planned samples not returned")
        return errors, warnings

    # -- analysis ------------------------------------------------------------------------

    def _analyze(
        self,
        data: IngestedData,
        params: BaseModel,
        compound: CompoundInfo,
        inputs: Mapping[str, Quantity],
    ) -> AnalysisResult:
        p = _p(params)
        m_pct = method("peptide.percent_of_time_zero")
        by_rep: dict[tuple[str, int], dict[float, float | None]] = defaultdict(dict)
        for r in data.records:
            v = r.get("response")
            by_rep[(str(r["condition"]), int(r["replicate"]))][float(r["time_min"])] = (
                None if r["below_limit"] == "yes" or v is None else float(v)
            )
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        summary_rows: list[tuple[Any, ...]] = []
        course_rows: list[tuple[Any, ...]] = []
        for c in p.conditions:
            reps = {
                rep: percent_of_time_zero(pts)
                for (cid, rep), pts in sorted(by_rep.items())
                if cid == c.id
            }
            excluded = sum(
                1
                for (cid, _), pts in by_rep.items()
                if cid == c.id
                for v in pts.values()
                if v is None
            )
            times = [t for pts in reps.values() for t in pts]
            pcts = [v for pts in reps.values() for v in pts.values()]
            for t in p.sampling_times_min:
                vals = [pts[t] for pts in reps.values() if t in pts]
                if vals:
                    sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
                    course_rows.append(
                        (
                            c.id,
                            f"{t:g}",
                            len(vals),
                            Quantity.computed(
                                float(np.mean(vals)),
                                "percent",
                                method=m_pct,
                                label=f"remaining {c.id} {t:g} min",
                                uncertainty=Uncertainty(kind="sd", sd=sd, n=len(vals))
                                if sd is not None
                                else None,
                            ),
                        )
                    )
            fit = fit_decay(
                times,
                pcts,
                model=p.fit_model,
                min_r2=p.min_r2,
                min_depletion_pct=p.min_depletion_percent,
                label=c.id,
            )
            findings.extend(fit.qc.findings)
            if excluded:
                findings.append(
                    QCFinding(
                        f"{c.id}.below_limit",
                        QCStatus.WARN,
                        f"{c.id}: {excluded} samples below the quantitation "
                        "limit, excluded from the fit",
                    )
                )
            last = [pts[fit.last_time_min] for pts in reps.values() if fit.last_time_min in pts]
            last_q = Quantity.computed(
                float(np.mean(last)),
                "percent",
                method=m_pct,
                label=f"remaining at {fit.last_time_min:g} min {c.id}",
            )
            q[f"k.{c.id}"], q[f"t_half.{c.id}"] = fit.k, fit.half_life
            q[f"remaining_last.{c.id}"] = last_q
            if fit.plateau is not None:
                q[f"plateau.{c.id}"] = fit.plateau
            summary_rows.append(
                (
                    c.id,
                    c.describe(),
                    len(reps),
                    fit.n_points,
                    last_q,
                    fit.k,
                    fit.half_life,
                    fit.plateau,
                    f"{fit.r_squared:.4f}" if fit.r_squared is not None else None,
                )
            )
        tables = [
            tabulate(
                "Half-life by condition",
                (
                    "condition",
                    "matrix",
                    "replicates",
                    "observations",
                    "remaining at last sample",
                    "k",
                    "t1/2 (95% CI)",
                    "plateau (95% CI)",
                    "R^2",
                ),
                summary_rows,
                note=f"{p.fit_model.replace('_', ' ')} fit on percent of each replicate's time "
                "zero; a half-life beyond the last sample is not reported",
            ),
            tabulate(
                "Intact peptide over time",
                ("condition", "time (min)", "n", "remaining (mean, SD)"),
                course_rows,
            ),
        ]
        return AnalysisResult(
            quantities=q, tables=tuple(tables), qc=QCVerdict.of(findings), evidence_admissible=True
        )

    # -- interpretation ------------------------------------------------------------------

    def _interpret(
        self, analysis: AnalysisResult, params: BaseModel, context: ProgramContext | None
    ) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        for c in p.conditions:
            th = analysis.quantities[f"t_half.{c.id}"]
            last = analysis.quantities[f"remaining_last.{c.id}"]
            if th.is_available:
                u = th.uncertainty
                ci = (
                    f" (95% CI {u.lower:.3g} to {u.upper:.3g})"
                    if u and u.lower is not None and u.upper is not None
                    else ""
                )
                text = f"{c.describe()}: in vitro t1/2 {th.require():.3g} min{ci}."
            else:
                text = (
                    f"{c.describe()}: no half-life reported ({th.provenance.reason}); "
                    f"{last.require():.1f}% remained at the last sample."
                )
            out.append(
                InterpretiveStatement(
                    text,
                    "depletion of intact peptide relative to time zero",
                    ("cavaco2021", "nguyen2010"),
                    "info",
                )
            )
        for f in analysis.qc.findings:
            if f.code.endswith("incomplete_degradation"):
                out.append(
                    InterpretiveStatement(
                        f.message,
                        "one-phase decay plateau",
                        ("graphpad_one_phase_decay",),
                        "notable",
                    )
                )
        out.append(
            InterpretiveStatement(
                "Each result holds for its matrix: degradation rates differ between fresh blood, "
                "serum and heparin or EDTA plasma, and the rank order of peptides changes between "
                "them (Böttger et al. 2017).",
                "matrix dependence",
                ("bottger2017",),
                "info",
            )
        )
        out.append(
            InterpretiveStatement(
                "Blood, serum and plasma speak to degradation in the systemic circulation (Di 2015). "
                "Peptides are generally degraded by endopeptidases and then exopeptidases, and "
                "proteolysis is not confined to the organs of elimination (FDA draft guidance, "
                "December 2023).",
                "clearance route of the matrices",
                ("di2015", "fda_peptide_clinpharm_draft_2023"),
                "info",
            )
        )
        pairs = _matched_pairs(p.conditions)
        for a, b in pairs:
            out.append(
                InterpretiveStatement(
                    f"{a.id} and {b.id} differ only in species ({a.species}, {b.species}), so their "
                    "half-lives are compared like for like.",
                    "matched conditions",
                    ("bottger2017",),
                    "info",
                )
            )
        species = {c.species for c in p.conditions}
        if len(species) > 1 and not pairs:
            out.append(
                InterpretiveStatement(
                    "Conditions in different species also differ in matrix facts, so no "
                    "between-species comparison is made.",
                    "matched conditions",
                    ("bottger2017",),
                    "notable",
                )
            )
        return Interpretation(statements=tuple(out), requires_expert_judgement=())

    # -- report ------------------------------------------------------------------------

    def _report_sections(
        self,
        protocol: ProtocolDocument,
        data: IngestedData,
        analysis: AnalysisResult,
        interpretation: Interpretation,
        determinations: Sequence[Mapping[str, Any]],
    ) -> list[ReportSection]:
        return [
            ReportSection(
                "Summary",
                f"{protocol.title}. Data are "
                + ("SIMULATED (not measured)." if data.is_simulated else "measured."),
            ),
            ReportSection(
                "Design", "\n".join(f"- **{k}:** {v}" for k, v in protocol.design.items())
            ),
            ReportSection(
                "Results", "Intact peptide relative to time zero.", tables=analysis.tables
            ),
        ]

    # -- simulation ----------------------------------------------------------------------

    def _simulate_rows(
        self, params: BaseModel, compound: CompoundInfo, sim: BaseModel, rng: np.random.Generator
    ) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, PeptideStabilitySimulation)
        truth = {d.condition: d for d in s.decay}
        rows: list[dict[str, Any]] = []
        for c in p.conditions:
            if c.id not in truth:
                raise ValueError(f"simulation needs a true half-life for {c.id}")
            d = truth[c.id]
            k = float(np.log(2.0)) / d.half_life_min
            for rep in range(1, p.replicates + 1):
                for t in p.sampling_times_min:
                    frac = (1 - d.plateau_percent / 100) * float(
                        np.exp(-k * t)
                    ) + d.plateau_percent / 100
                    noise = (
                        float(np.exp(rng.normal(0.0, s.proportional_sd_log)))
                        if s.proportional_sd_log and t > 0
                        else 1.0
                    )
                    blq = 100 * frac * noise < s.quantitation_limit_percent and t > 0
                    rows.append(
                        {
                            "condition": c.id,
                            "replicate": rep,
                            "time_min": t,
                            "response": None if blq else s.time_zero_response * frac * noise,
                            "below_limit": "yes" if blq else "no",
                        }
                    )
        return rows, "sim.peptide_decay_declared"


def _matched_pairs(conditions: Sequence[Condition]) -> list[tuple[Condition, Condition]]:
    """Pairs of conditions that differ in species and in nothing else."""
    out = []
    for i, a in enumerate(conditions):
        for b in conditions[i + 1 :]:
            if a.species != b.species and all(
                getattr(a, f) == getattr(b, f) for f in _CONDITION_FACTS
            ):
                out.append((a, b))
    return out
