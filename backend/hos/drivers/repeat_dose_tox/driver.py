"""Repeat-dose toxicity: group design from OECD TG 407/408/409 and ICH M3(R2); per-endpoint
dose-group comparison with control by Dunnett's test.

What the system does: designs the study against the test guideline's minimums (animals
per sex per group, dose groups, duration, recovery satellites), checks endpoint coverage
against the guideline's haematology / clinical-chemistry / organ-weight lists, validates
individual-animal data, and for every endpoint x sex x phase x timepoint compares each
dose group with the concurrent control by Dunnett's many-to-one test (Dunnett 1955;
``scipy.stats.dunnett``), reporting group statistics, % difference and adjusted p-values.

What the system does not do: decide whether a change is adverse, or set the NOAEL. FDA
(2005, glossary) defines the NOAEL as the highest dose without a significant increase in
adverse effects and says biologically significant effects count even when not
statistically significant; that judgement is the Study Director's (21 CFR 58.33:
"overall responsibility for ... the interpretation ... of results"). The NOAEL is an
ExpertDetermination recorded by the kernel with the Study Director's signature.
Histopathology incidence data are reported by the pathologist and are outside this
driver's statistics.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any, Literal

import numpy as np
import scipy
from pydantic import BaseModel, Field, field_validator, model_validator
from scipy import stats

from hos.core import units as U
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
    Support,
    tabulate,
)
from hos.drivers.repeat_dose_tox.guidelines import (
    GUIDELINES,
    M3R2_LIMIT_DOSE_MG_KG_DAY,
    NON_RODENTS,
    RODENTS,
)
from hos.kernel.attestation import Role

_SOFTWARE = {"scipy": scipy.__version__, "numpy": np.__version__}
#: scipy.stats.dunnett integrates the multivariate t distribution by randomised quasi-Monte
#: Carlo; a fixed seed makes p-values reproducible to the last digit (determinism rule).
DUNNETT_QMC_SEED = 0
Category = Literal["body_weight", "food_consumption", "haematology", "clinical_chemistry",
                   "urinalysis", "organ_weight", "other"]


class EndpointSpec(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[^|,]+$")
    unit: str = Field(min_length=1)
    category: Category
    checklist_item: str | None = Field(
        default=None, description="the guideline checklist item this endpoint satisfies")

    @field_validator("unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not U.is_valid_unit(v):
            raise ValueError(f"unrecognised unit {v!r} (counts per volume: use 1/nL for 10^9/L)")
        return v


class RepeatDoseParams(BaseModel):
    glp: bool
    species: Literal["rat", "mouse", "dog", "monkey", "minipig", "rabbit"]
    strain: str = Field(min_length=1)
    guideline_basis: Literal["oecd_tg407", "oecd_tg408", "oecd_tg409", "ich_m3r2"]
    route: str = Field(min_length=1)
    vehicle: str = Field(min_length=1)
    dose_levels_mg_per_kg_day: list[float] = Field(min_length=1)
    animals_per_sex_per_group: int = Field(ge=2)
    dosing_duration_days: int = Field(ge=1)
    recovery: bool
    recovery_animals_per_sex: int | None = Field(default=None, ge=2)
    recovery_duration_days: int | None = Field(default=None, ge=1)
    endpoints: list[EndpointSpec] = Field(min_length=1)
    timepoints: list[str] = Field(min_length=1)
    alpha: float = Field(gt=0, lt=0.5)
    statistics_basis: str = Field(min_length=1, description="who chose the test and alpha")

    @field_validator("dose_levels_mg_per_kg_day")
    @classmethod
    def _doses(cls, v: list[float]) -> list[float]:
        if any(d <= 0 for d in v):
            raise ValueError("dose levels exclude the control (0) and must be positive")
        if any(b <= a for a, b in pairwise(v)):
            raise ValueError("dose levels must be strictly increasing")
        return v

    @field_validator("endpoints")
    @classmethod
    def _unique(cls, v: list[EndpointSpec]) -> list[EndpointSpec]:
        if len({e.name for e in v}) != len(v):
            raise ValueError("endpoint names must be unique")
        return v

    @model_validator(mode="after")
    def _guideline(self) -> RepeatDoseParams:
        if self.recovery and (self.recovery_animals_per_sex is None or
                              self.recovery_duration_days is None):
            raise ValueError("recovery groups need recovery_animals_per_sex and "
                             "recovery_duration_days")
        g = GUIDELINES.get(self.guideline_basis)
        if g is None:
            if len(self.dose_levels_mg_per_kg_day) < 3:
                raise ValueError("at least three dose levels plus control are expected")
            return self
        errs = []
        if self.species not in g.species:
            errs.append(f"{g.title} applies to {sorted(g.species)}")
        if self.animals_per_sex_per_group < g.min_animals_per_sex:
            errs.append(f"{g.animals_paragraph}: at least {g.min_animals_per_sex} per sex per group")
        if len(self.dose_levels_mg_per_kg_day) < g.min_dose_groups:
            errs.append(f"{g.dose_groups_paragraph}: at least {g.min_dose_groups} dose levels "
                        "and a concurrent control")
        if g.duration_exact and self.dosing_duration_days != g.duration_days:
            errs.append(f"{g.duration_paragraph}: {g.duration_days} days")
        if not g.duration_exact and self.dosing_duration_days < g.duration_days:
            errs.append(f"{g.duration_paragraph}: at least {g.duration_days} days")
        if self.recovery:
            assert self.recovery_animals_per_sex is not None
            if self.recovery_animals_per_sex < g.min_recovery_animals_per_sex:
                errs.append(f"{g.recovery_paragraph}: satellite groups of at least "
                            f"{g.min_recovery_animals_per_sex} per sex")
            if g.min_recovery_days and (self.recovery_duration_days or 0) < g.min_recovery_days:
                errs.append(f"{g.recovery_paragraph}: recovery of at least "
                            f"{g.min_recovery_days} days")
        if errs:
            raise ValueError("design does not meet the test guideline: " + "; ".join(errs))
        return self

    def groups(self) -> list[float]:
        return [0.0] + list(self.dose_levels_mg_per_kg_day)

    def recovery_doses(self) -> list[float]:
        return [0.0, self.dose_levels_mg_per_kg_day[-1]] if self.recovery else []

    def endpoint(self, name: str) -> EndpointSpec:
        return next(e for e in self.endpoints if e.name == name)


class EndpointTruth(BaseModel):
    control_mean: float
    cv: float = Field(ge=0, lt=1)
    effect_percent_by_dose: list[float]
    recovery_effect_fraction: float = Field(ge=0, le=1)


class RepeatDoseSimulation(BaseModel):
    endpoints: dict[str, EndpointTruth]


def _dose_eq(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(b))


class RepeatDoseToxicityDriver(StudyDriver):
    id = "repeat_dose_toxicity"
    name = "Repeat-dose toxicity with Dunnett comparison to control"
    version = "1.0.0"
    requirement_ids = ("tox.repeat_dose_rodent", "tox.repeat_dose_nonrodent", "tox.repeat_dose",
                       "tox.repeat_dose_marketing")
    modalities = frozenset({Modality.SMALL_MOLECULE, Modality.PEPTIDE, Modality.OLIGONUCLEOTIDE,
                            Modality.MONOCLONAL_ANTIBODY, Modality.RECOMBINANT_PROTEIN,
                            Modality.ANTIBODY_DRUG_CONJUGATE})
    ctd_section = "4.2.3.2"
    glp_capable = True
    description = ("Group design checked against OECD TG 407/408/409 and ICH M3(R2); "
                   "per-endpoint Dunnett comparisons; NOAEL set by the Study Director.")
    reference_keys = ("ich_m3r2", "oecd_tg407", "oecd_tg408", "oecd_tg409", "dunnett1955",
                      "jaki2013", "fda_mrsd_2005", "cfr21_58")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return RepeatDoseParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return RepeatDoseSimulation

    def prefill_from_requirement(self, requirement: StudyRequirement) -> dict[str, Any]:
        out: dict[str, Any] = {"glp": requirement.glp}
        if requirement.species:
            out["species"] = requirement.species[0]
        if requirement.duration_weeks:
            days = round(requirement.duration_weeks * 7)
            out["dosing_duration_days"] = days
            sp = out.get("species")
            if sp in RODENTS and days == 28:
                out["guideline_basis"] = "oecd_tg407"
            elif sp in RODENTS and days >= 90:
                out["guideline_basis"] = "oecd_tg408" if days <= 91 else "ich_m3r2"
            elif sp in NON_RODENTS and days == 90:
                out["guideline_basis"] = "oecd_tg409"
            else:
                out["guideline_basis"] = "ich_m3r2"
        return out

    def probe(self, requirement: StudyRequirement,
              context: ProgramContext | None = None) -> Support:
        s = super().probe(requirement, context)
        if not s.supported:
            return s
        unsupported = [sp for sp in requirement.species if sp not in RODENTS | NON_RODENTS]
        if unsupported and len(unsupported) == len(requirement.species):
            return Support(False, f"species {unsupported} not supported by this driver")
        return s

    # -- design ----------------------------------------------------------------

    def design(self, compound: CompoundInfo, params: BaseModel,
               context: ProgramContext | None = None,
               hypothesis: str | None = None) -> ProtocolDocument:
        p = _p(params)
        g = GUIDELINES.get(p.guideline_basis)
        cov = self.coverage(p)
        doses = p.groups()
        spacing = [b / a for a, b in pairwise(p.dose_levels_mg_per_kg_day)]
        design: dict[str, Any] = {
            "species": f"{p.species} ({p.strain})", "route": p.route, "vehicle": p.vehicle,
            "groups_mg_per_kg_day": [f"{d:g}" for d in doses],
            "animals_per_sex_per_group": p.animals_per_sex_per_group,
            "dosing_duration_days": p.dosing_duration_days,
            "recovery": (f"{p.recovery_animals_per_sex}/sex in control and top dose for "
                         f"{p.recovery_duration_days} days") if p.recovery else "none",
            "endpoints": [f"{e.name} [{e.unit}]" for e in p.endpoints],
            "timepoints": p.timepoints,
            "statistics": f"Dunnett two-sided many-to-one vs control, alpha {p.alpha:g} "
                          f"({p.statistics_basis})",
            "guideline_basis": g.title if g else "ICH M3(R2) (no OECD TG design minimum applied)",
        }
        if cov:
            design["guideline_endpoint_coverage"] = {k: ", ".join(v) or "none"
                                                     for k, v in cov.items()}
        notes = []
        if p.dose_levels_mg_per_kg_day[-1] > M3R2_LIMIT_DOSE_MG_KG_DAY:
            notes.append(f"top dose exceeds the ICH M3(R2) section 1.5 limit dose of "
                         f"{M3R2_LIMIT_DOSE_MG_KG_DAY:g} mg/kg/day; justify under the section "
                         "1.5 exceptions")
        if g and any(r > g.max_spacing_factor for r in spacing):
            notes.append(f"dose spacing above {g.max_spacing_factor:g}-fold ({g.spacing_paragraph} "
                         "prefers adding a dose group to very large intervals)")
        if g and g.needs_reverification:
            notes.append(f"{g.key} parameters transcribed from a mirrored copy; re-verify against "
                         "the OECD original")
        if notes:
            design["design_notes"] = notes
        steps = (
            ProtocolStep(1, "Animals and allocation",
                         f"{p.species} ({p.strain}); randomise to {len(doses)} groups x "
                         f"{p.animals_per_sex_per_group} per sex"
                         + (f", plus recovery satellites ({p.recovery_animals_per_sex}/sex) in "
                            "control and top dose" if p.recovery else "") + ". Record animal IDs.",
                         ("randomisation method recorded",)),
            ProtocolStep(2, "Dosing",
                         f"{p.route} administration once daily for {p.dosing_duration_days} days "
                         f"at {', '.join(f'{d:g}' for d in doses)} mg/kg/day in {p.vehicle}.",
                         ("dose formulation analysis",)),
            ProtocolStep(3, "In-life observations",
                         "Clinical observations, body weight and food consumption per the "
                         "guideline schedule" + (f" ({g.title})" if g else "") + ".", ()),
            ProtocolStep(4, "Clinical pathology",
                         "Collect samples at " + ", ".join(p.timepoints) + " for the declared "
                         "endpoints.", ()),
            ProtocolStep(5, "Necropsy",
                         "Gross necropsy, organ weights and histopathology per the guideline "
                         "lists; histopathology findings reported by the pathologist.", ()),
            ProtocolStep(6, "Return data",
                         "Individual-animal values in long format per data_template.csv.", ()),
        )
        return ProtocolDocument(
            driver_id=self.id, driver_version=self.version,
            title=f"{p.dosing_duration_days}-day repeat-dose {p.route} toxicity study of "
                  f"{compound.name} in {p.species}",
            objective="Characterise toxicity after repeated administration and its reversibility; "
                      "provide statistical comparisons of each dose group with control to "
                      "support the Study Director's determination of the NOAEL.",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id, "smiles": compound.smiles},
            test_system={"species": p.species, "strain": p.strain},
            design=design,
            steps=steps,
            acceptance_criteria=(
                AcceptanceCriterion("group_size", f"{p.animals_per_sex_per_group} evaluable "
                                    "animals per sex per group",
                                    g.animals_paragraph if g else "sponsor design"),
                AcceptanceCriterion("statistics", "statistical method chosen at design (this "
                                    "protocol: Dunnett); no multiple t-tests",
                                    "oecd_tg407 para 51; oecd_tg408 para 51"),
            ),
            materials=(f"test article {compound.name}", f"vehicle {p.vehicle}",
                       f"{p.species} ({p.strain})"),
            deliverables=("individual-animal data CSV per template", "histopathology report",
                          "dose formulation analysis", "toxicokinetic data (separate study "
                          "component)"),
            glp=p.glp,
            references=tuple(cite(k) for k in (
                ("ich_m3r2", "dunnett1955", "fda_mrsd_2005") +
                ((g.citation_key,) if g else ()))),
            regulatory_basis=("ICH M3(R2) sections 1.5 (high dose), 5 (two species, duration)",)
                             + ((g.title,) if g else ()),
            parameters=p.model_dump(),
        )

    def coverage(self, p: RepeatDoseParams) -> dict[str, list[str]]:
        """Guideline checklist items not covered by the declared endpoints."""
        g = GUIDELINES.get(p.guideline_basis)
        if g is None:
            return {}
        have = {(e.checklist_item or e.name).strip().lower() for e in p.endpoints}
        return {
            f"haematology missing ({g.endpoints_paragraphs})":
                [x for x in g.haematology if x.lower() not in have],
            "clinical chemistry missing": [x for x in g.clinical_chemistry if x.lower() not in have],
            "organ weights missing": [x for x in g.organ_weights if x.lower() not in have],
        }

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        main = len(p.groups()) * 2 * p.animals_per_sex_per_group
        rec = 2 * 2 * (p.recovery_animals_per_sex or 0) if p.recovery else 0
        return StudyPlan(
            execution_duration_days=float(p.dosing_duration_days + (p.recovery_duration_days or 0)
                                          if p.recovery else p.dosing_duration_days),
            duration_basis="dosing period plus recovery per protocol; acclimatisation, necropsy "
                           "and reporting are scheduled by the laboratory",
            sample_count=main + rec,
            sample_count_basis=f"{main} main-study + {rec} recovery animals",
            dependencies=("dose range-finding study", "validated bioanalytical method for TK "
                          "(ICH M10)", "dose formulation method"),
            material_requirements=tuple(protocol.materials),
        )

    def sample_manifest(self, params: BaseModel,
                        compound: CompoundInfo) -> tuple[Mapping[str, Any], ...]:
        p = _p(params)
        rows = []
        for i, d in enumerate(p.groups()):
            for sex in ("M", "F"):
                rows.append({"group": i + 1, "dose_mg_per_kg_day": f"{d:g}", "sex": sex,
                             "phase": "main", "animals": p.animals_per_sex_per_group})
                if p.recovery and any(_dose_eq(d, r) for r in p.recovery_doses()):
                    rows.append({"group": i + 1, "dose_mg_per_kg_day": f"{d:g}", "sex": sex,
                                 "phase": "recovery", "animals": p.recovery_animals_per_sex})
        return tuple(rows)

    def data_template(self, params: BaseModel) -> DataTemplate:
        p = _p(params)
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="Long format: one row per animal x endpoint x timepoint. The unit column "
                        "states each value's unit (counts per volume as 1/nL for 10^9/L).",
            columns=(
                DataColumn("subject_id", "laboratory animal id", kind="text"),
                DataColumn("sex", "M or F", kind="text", choices=("M", "F")),
                DataColumn("dose", "dose group", unit="mg/kg/day", minimum=0),
                DataColumn("phase", "main or recovery", kind="text",
                           choices=("main", "recovery") if p.recovery else ("main",)),
                DataColumn("endpoint", "endpoint name", kind="text",
                           choices=tuple(e.name for e in p.endpoints)),
                DataColumn("timepoint", "timepoint label", kind="text",
                           choices=tuple(p.timepoints)),
                DataColumn("unit", "unit of value", kind="text"),
                DataColumn("value", "observed value", unit_column="unit"),
            ),
        )

    def validate_records(self, records: Sequence[Mapping[str, Any]],
                         params: BaseModel) -> tuple[list[str], list[str]]:
        p = _p(params)
        errors, warnings = [], []
        subj: dict[str, tuple[str, float, str]] = {}
        seen: set[tuple[str, str, str]] = set()
        counts: dict[tuple[float, str, str], set[str]] = defaultdict(set)
        for i, r in enumerate(records, start=1):
            dose = r["dose"]
            match = [d for d in p.groups() if _dose_eq(d, dose)]
            if not match:
                errors.append(f"row {i}: dose {dose:g} is not a group in the design")
                continue
            if r["phase"] == "recovery" and not any(_dose_eq(dose, d) for d in p.recovery_doses()):
                errors.append(f"row {i}: dose {dose:g} has no recovery group")
            key = (r["sex"], match[0], r["phase"])
            prev = subj.setdefault(r["subject_id"], key)
            if prev != key:
                errors.append(f"row {i}: subject {r['subject_id']} changes sex/dose/phase")
            k = (r["subject_id"], r["endpoint"], r["timepoint"])
            if k in seen:
                errors.append(f"row {i}: duplicate value for {k}")
            seen.add(k)
            spec = p.endpoint(r["endpoint"])
            if not U.compatible(r["unit"], spec.unit):
                errors.append(f"row {i}: unit {r['unit']!r} incompatible with {spec.name} "
                              f"[{spec.unit}]")
            counts[(match[0], r["sex"], r["phase"])].add(r["subject_id"])
        for (d, sex, phase), ids in sorted(counts.items()):
            planned = p.animals_per_sex_per_group if phase == "main" else p.recovery_animals_per_sex
            if planned and len(ids) < planned:
                warnings.append(f"{phase} {d:g} mg/kg/day {sex}: {len(ids)} of {planned} "
                                "planned animals returned")
        return errors, warnings

    # -- analysis --------------------------------------------------------------

    def _analyze(self, data: IngestedData, params: BaseModel, compound: CompoundInfo,
                 inputs: Mapping[str, Quantity]) -> AnalysisResult:
        p = _p(params)
        summ_m, dun_m = method("stats.group_summary"), method("stats.dunnett")
        prov_note = f"file sha256 {data.file_sha256[:16]}"
        cells: dict[tuple[str, str, str, str], dict[float, list[float]]] = defaultdict(
            lambda: defaultdict(list))
        for r in data.records:
            spec = p.endpoint(r["endpoint"])
            v = U.convert(r["value"], r["unit"], spec.unit) if r["unit"] != spec.unit else r["value"]
            dose = next(d for d in p.groups() if _dose_eq(d, r["dose"]))
            cells[(r["endpoint"], r["sex"], r["phase"], r["timepoint"])][dose].append(float(v))

        rows: list[tuple[Any, ...]] = []
        q: dict[str, Quantity] = {}
        findings: list[QCFinding] = []
        notes: list[str] = []
        n_sig = 0
        for key in sorted(cells):
            endpoint, sex, phase, tp = key
            spec = p.endpoint(endpoint)
            groups = cells[key]
            ctrl = groups.get(0.0, [])
            treated = [d for d in sorted(groups) if d > 0 and len(groups[d]) >= 2]
            skipped = [d for d in sorted(groups) if d > 0 and len(groups[d]) < 2]
            if skipped:
                notes.append(f"{endpoint}/{sex}/{phase}/{tp}: groups {skipped} have n < 2, "
                             "not tested")
            if len(ctrl) < 2 or not treated:
                notes.append(f"{endpoint}/{sex}/{phase}/{tp}: control n < 2 or no testable "
                             "group; no comparison")
                pvals: dict[float, float | None] = {}
            else:
                res = stats.dunnett(*[np.asarray(groups[d]) for d in treated],
                                    control=np.asarray(ctrl), alternative="two-sided",
                                    rng=np.random.default_rng(DUNNETT_QMC_SEED))
                pvals = {d: float(pv) for d, pv in zip(treated, res.pvalue, strict=True)}
            cmean = float(np.mean(ctrl)) if ctrl else None
            label = f"{endpoint} ({sex}, {phase}, {tp})"
            for d in sorted(groups):
                vals = groups[d]
                mean = Quantity.computed(
                    float(np.mean(vals)), spec.unit, method=summ_m, software=_SOFTWARE,
                    uncertainty=Uncertainty(kind="sd", sd=float(np.std(vals, ddof=1)), n=len(vals))
                    if len(vals) > 1 else None,
                    label=f"{label} mean at {d:g} mg/kg/day", notes=prov_note)
                dose_q = Quantity.user_supplied(d, "mg/kg/day", actor="study protocol",
                                                label="dose")
                if d == 0:
                    rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, "control",
                                 "control", "control"))
                    continue
                pct: Any = "n/a"
                if cmean not in (None, 0.0):
                    assert cmean is not None
                    pct = Quantity.computed(100.0 * (mean.require() - cmean) / abs(cmean),
                                            "percent", method=summ_m, software=_SOFTWARE,
                                            label=f"{label} % vs control at {d:g}")
                pv = pvals.get(d)
                if pv is None:
                    rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, pct,
                                 "not tested", "-"))
                    continue
                pq = Quantity.computed(pv, "dimensionless", method=dun_m, software=_SOFTWARE,
                                       label=f"{label} Dunnett p at {d:g}",
                                       notes=f"two-sided; {len(treated)} groups vs control; "
                                             f"QMC seed {DUNNETT_QMC_SEED}")
                sig = pv < p.alpha
                rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, pct, pq,
                             "yes" if sig else "no"))
                if sig:
                    n_sig += 1
                    base = f"finding|{endpoint}|{sex}|{phase}|{tp}|{d:g}"
                    q[f"{base}|p"] = pq
                    q[f"{base}|mean"] = mean
                    if isinstance(pct, Quantity):
                        q[f"{base}|pct_vs_control"] = pct
        table = tabulate(
            "Dose-group comparisons with control (Dunnett, two-sided)",
            ("endpoint", "sex", "phase", "timepoint", "dose", "n", "mean (SD)", "% vs control",
             "p (Dunnett)", f"p < {p.alpha:g}"),
            rows,
            note="Statistical significance is not adversity. Biologically significant effects "
                 "can be non-significant (FDA 2005 glossary, NOAEL).")
        if not rows:
            findings.append(QCFinding("no_data", QCStatus.FAIL, "no analysable data"))
        return AnalysisResult(quantities=q, tables=(table,), qc=QCVerdict.of(findings),
                              evidence_admissible=True,
                              notes=tuple(notes) + (f"{n_sig} statistically significant "
                                                    "group differences",))

    # -- interpretation --------------------------------------------------------

    def _interpret(self, analysis: AnalysisResult, params: BaseModel,
                   context: ProgramContext | None) -> Interpretation:
        p = _p(params)
        g = GUIDELINES.get(p.guideline_basis)
        cites = ("dunnett1955",) + ((g.citation_key,) if g else ("ich_m3r2",))
        out = []
        for k, pq in analysis.quantities.items():
            if not k.endswith("|p"):
                continue
            base = k[:-2]
            _, endpoint, sex, phase, tp, dose = base.split("|")
            pct = analysis.quantities.get(f"{base}|pct_vs_control")
            direction = ""
            if pct is not None:
                direction = (f"{'increase' if pct.require() > 0 else 'decrease'} of "
                             f"{abs(pct.require()):.1f}% ")
            out.append(InterpretiveStatement(
                f"Statistically significant {direction}in {endpoint} ({sex}, {phase}, {tp}) at "
                f"{dose} mg/kg/day versus control (Dunnett p = {pq.require():.3g}).",
                f"Dunnett two-sided many-to-one comparison, alpha {p.alpha:g}",
                cites, "notable"))
        if not out:
            out.append(InterpretiveStatement(
                f"No dose group differed from control at alpha {p.alpha:g} (Dunnett) for the "
                "analysed endpoints.", "Dunnett two-sided many-to-one comparison", cites, "info"))
        cov = self.coverage(p)
        missing = [x for v in cov.values() for x in v]
        if missing and g is not None:
            out.append(InterpretiveStatement(
                f"{len(missing)} {g.key} checklist parameter(s) were not among the declared "
                "endpoints: " + ", ".join(missing[:12]) + (" ..." if len(missing) > 12 else ""),
                g.endpoints_paragraphs, (g.citation_key,), "notable"))
        return Interpretation(statements=tuple(out), requires_expert_judgement=(
            "Adversity of each statistically significant change, and biological significance of "
            "non-significant changes (FDA 2005 glossary)",
            "Integration of histopathology, clinical observations and toxicokinetics",
        ))

    def expert_determinations(self, params: BaseModel) -> tuple[ExpertDetermination, ...]:
        return (
            ExpertDetermination(
                "noael", "NOAEL", "mg/kg/day", Role.STUDY_DIRECTOR, True,
                "Highest dose without a significant increase in adverse effects versus control; "
                "biologically significant effects count even if not statistically significant "
                "(FDA 2005 glossary). Record 'not established' if adverse effects occur at the "
                "lowest dose."),
            ExpertDetermination("noael_male", "NOAEL (males)", "mg/kg/day", Role.STUDY_DIRECTOR,
                                False, "Optional sex-specific NOAEL."),
            ExpertDetermination("noael_female", "NOAEL (females)", "mg/kg/day",
                                Role.STUDY_DIRECTOR, False, "Optional sex-specific NOAEL."),
        )

    # -- report ----------------------------------------------------------------

    def _report_sections(self, protocol: ProtocolDocument, data: IngestedData,
                         analysis: AnalysisResult, interpretation: Interpretation,
                         determinations: Sequence[Mapping[str, Any]]) -> list[ReportSection]:
        noael = [d for d in determinations if d["key"] == "noael"]
        if noael:
            qd = noael[0]["quantity"]
            nb = (f"NOAEL determined by {noael[0]['signer_name']} (Study Director): "
                  + (f"{qd['value']:g} {qd['unit']}" if qd.get("available") else "not established")
                  + f". Rationale: {noael[0]['rationale']}")
        else:
            nb = "NOAEL not yet determined by the Study Director."
        return [
            ReportSection("Summary", f"{protocol.title}. "
                          + ("Data are SIMULATED (not measured). " if data.is_simulated else "")
                          + nb),
            ReportSection("Study design", "\n".join(f"- **{k}:** {v}"
                                                    for k, v in protocol.design.items())),
            ReportSection("Statistical comparisons", "; ".join(analysis.notes),
                          tables=analysis.tables),
        ]

    # -- simulation ------------------------------------------------------------

    def _simulate_rows(self, params: BaseModel, compound: CompoundInfo, sim: BaseModel,
                       rng: np.random.Generator) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, RepeatDoseSimulation)
        rows = []
        for e in p.endpoints:
            if e.name not in s.endpoints:
                raise ValueError(f"simulation needs a truth for endpoint {e.name!r}")
            if len(s.endpoints[e.name].effect_percent_by_dose) != len(p.dose_levels_mg_per_kg_day):
                raise ValueError(f"{e.name}: one effect per dose level is required")
        for gi, d in enumerate(p.groups()):
            for sex in ("M", "F"):
                phases = [("main", p.animals_per_sex_per_group)]
                if p.recovery and any(_dose_eq(d, r) for r in p.recovery_doses()):
                    phases.append(("recovery", p.recovery_animals_per_sex or 0))
                for phase, n in phases:
                    for a in range(n):
                        sid = f"{'R' if phase == 'recovery' else ''}{sex}{gi + 1}-{a + 1:02d}"
                        for e in p.endpoints:
                            t = s.endpoints[e.name]
                            eff = 0.0 if d == 0 else t.effect_percent_by_dose[gi - 1]
                            if phase == "recovery":
                                eff *= t.recovery_effect_fraction
                            mu = t.control_mean * (1 + eff / 100.0)
                            for tp in p.timepoints:
                                rows.append({"subject_id": sid, "sex": sex, "dose": d,
                                             "phase": phase, "endpoint": e.name, "timepoint": tp,
                                             "unit": e.unit,
                                             "value": float(rng.normal(mu, t.cv * abs(mu)))})
        return rows, "sim.repeat_dose_normal"


def _p(params: BaseModel) -> RepeatDoseParams:
    if not isinstance(params, RepeatDoseParams):
        raise TypeError("expected RepeatDoseParams")
    return params
