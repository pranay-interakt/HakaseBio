"""hERG (IKr) patch clamp study per ICH S7B and the ICH E14/S7B Q&As (2022).

Design follows S7B section 2.3.1 (in vitro IKr assay) and 3.1.1 (a sub-maximally effective
positive control in every in vitro study), and the "best practice" items of E14/S7B
Q&A 2.1: near-physiological temperature (35-37 C), stimulation frequency, a saturating
selective blocker at the end of each recording to measure background current, steady
state before measurement, IC50 reported in uM and ng/mL with the Hill coefficient,
per-cell inhibition, analytically verified concentrations, vehicle controls, and a
positive control (one of the reference drugs) at two or more concentrations giving
20-80% block. A positive control outside its expected range makes the study
inconclusive.

The safety margin follows S7B Q&A 1.2: IC50 / free high clinical exposure, with the
unbound fraction set to 1% if measured below 1%. The Q&A gives no fixed threshold: the
margin is compared with margins for reference drugs under the same protocol. The driver
applies a threshold only if the user supplies one with its basis; otherwise the risk
call is listed as requiring expert judgement.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Literal, Mapping, Optional, Sequence

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from hos.core.citations import cite
from hos.core.methods import method
from hos.core.pharmacology import fit_hill, herg_safety_margin
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError
from hos.core.regulatory.context import Modality, ProgramContext
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

#: E14/S7B Q&A 2.1 item 1 (verbatim range): "near physiological temperature (35-37 C)".
QA21_TEMPERATURE_C = (35.0, 37.0)
#: E14/S7B Q&A 2.1 item 2: "For hERG, a stimulation frequency of 0.2 - 1 Hz is recommended."
QA21_FREQUENCY_HZ = (0.2, 1.0)
#: E14/S7B Q&A 2.1 item 7: positive control at concentrations "achieving 20-80% block".
QA21_POSITIVE_CONTROL_BLOCK = (20.0, 80.0)
#: E14/S7B Q&A 1.2: unbound fraction "should be set to 1% if experimentally determined to be < 1%".
QA12_FU_FLOOR = 0.01


class ExpectedBlock(BaseModel):
    concentration_uM: float = Field(gt=0)
    low_percent: float
    high_percent: float

    @model_validator(mode="after")
    def _order(self) -> "ExpectedBlock":
        if self.low_percent >= self.high_percent:
            raise ValueError("low_percent must be below high_percent")
        return self


class HergParams(BaseModel):
    glp: bool
    cell_line: str = Field(min_length=1)
    platform: Literal["manual", "automated"]
    recording_temperature_C: float
    stimulation_frequency_Hz: float = Field(gt=0)
    voltage_protocol: str = Field(min_length=1)
    selective_blocker: str = Field(min_length=1,
                                   description="saturating selective blocker for background")
    vehicle: str = Field(min_length=1)
    test_concentrations_uM: list[float] = Field(min_length=4)
    cells_per_concentration: int = Field(ge=1)
    concentration_verification: bool
    positive_control: str = Field(min_length=1,
                                  description="one of the reference drugs (Q&A 1.2 / 2.1)")
    positive_control_concentrations_uM: list[float] = Field(min_length=2)
    positive_control_expected_block: list[ExpectedBlock] = Field(default_factory=list)
    positive_control_basis: Optional[str] = None
    constrain_asymptotes_0_100: bool
    acceptance_min_r2: float = Field(gt=0, le=1)
    max_background_fraction: Optional[float] = Field(default=None, gt=0, lt=1)
    acceptance_basis: str = Field(min_length=1)
    margin_threshold: Optional[float] = Field(default=None, gt=0)
    margin_threshold_basis: Optional[str] = None

    @field_validator("test_concentrations_uM", "positive_control_concentrations_uM")
    @classmethod
    def _ascending(cls, v: list[float]) -> list[float]:
        if any(c <= 0 for c in v):
            raise ValueError("concentrations must be positive")
        if any(b <= a for a, b in zip(v, v[1:])):
            raise ValueError("concentrations must be strictly increasing")
        return v

    @model_validator(mode="after")
    def _bases(self) -> "HergParams":
        if self.margin_threshold is not None and not self.margin_threshold_basis:
            raise ValueError("a margin threshold requires its basis (reference drugs under the "
                             "same protocol, S7B Q&A 1.2)")
        if self.positive_control_expected_block and not self.positive_control_basis:
            raise ValueError("expected positive-control block requires its basis")
        exp = {e.concentration_uM for e in self.positive_control_expected_block}
        if exp - set(self.positive_control_concentrations_uM):
            raise ValueError("expected block given for a concentration not in the design")
        return self

    def compliance(self) -> list[tuple[str, bool, str]]:
        """E14/S7B Q&A 2.1 best-practice checklist: (item, met, detail)."""
        t_lo, t_hi = QA21_TEMPERATURE_C
        f_lo, f_hi = QA21_FREQUENCY_HZ
        return [
            ("Q&A 2.1 item 1: recording at 35-37 C", t_lo <= self.recording_temperature_C <= t_hi,
             f"{self.recording_temperature_C:g} C"),
            ("Q&A 2.1 item 2: hERG stimulation 0.2-1 Hz",
             f_lo <= self.stimulation_frequency_Hz <= f_hi, f"{self.stimulation_frequency_Hz:g} Hz"),
            ("Q&A 2.1 item 2: saturating selective blocker for background current", True,
             self.selective_blocker),
            ("Q&A 2.1 item 6: concentrations verified analytically",
             self.concentration_verification,
             "measured and nominal reported" if self.concentration_verification else "not planned"),
            ("Q&A 2.1 item 7: positive control at >= 2 concentrations",
             len(self.positive_control_concentrations_uM) >= 2,
             ", ".join(f"{c:g}" for c in self.positive_control_concentrations_uM) + " uM"),
            ("Q&A 2.1 item 7: vehicle control included", True, self.vehicle),
        ]


class HergSimulation(BaseModel):
    ic50_uM: float = Field(gt=0)
    hill: float = Field(gt=0)
    positive_control_ic50_uM: float = Field(gt=0)
    positive_control_hill: float = Field(gt=0)
    baseline_current_pA: float = Field(gt=0)
    background_fraction: float = Field(ge=0, lt=1)
    inhibition_noise_sd_percent: float = Field(ge=0)
    vehicle_rundown_percent: float
    temperature_C: float


def _cell_id(article: str, i: int, j: int) -> str:
    return f"{article}-C{i + 1}-{j + 1}"


class HergPatchClampDriver(StudyDriver):
    id = "herg_patch_clamp"
    name = "hERG (IKr) patch clamp concentration-response with safety margin"
    version = "1.0.0"
    requirement_ids = ("safety.herg",)
    modalities = frozenset({Modality.SMALL_MOLECULE, Modality.PEPTIDE,
                            Modality.OLIGONUCLEOTIDE, Modality.ANTIBODY_DRUG_CONJUGATE})
    ctd_section = "4.2.1.3"
    glp_capable = True
    description = ("Concentration-response of hERG current inhibition per ICH E14/S7B Q&A 2.1; "
                   "IC50 with CI, Hill slope, and free-exposure margin per S7B Q&A 1.2.")
    reference_keys = ("ich_s7b", "ich_e14_s7b_qa", "delean1978", "crumb2016", "ridder2020",
                      "redfern2003")

    @classmethod
    def parameters_model(cls) -> type[BaseModel]:
        return HergParams

    @classmethod
    def simulation_parameters_model(cls) -> type[BaseModel]:
        return HergSimulation

    # -- design ----------------------------------------------------------------

    def design(self, compound: CompoundInfo, params: BaseModel,
               context: Optional[ProgramContext] = None,
               hypothesis: Optional[str] = None) -> ProtocolDocument:
        p = _p(params)
        comp = p.compliance()
        steps = (
            ProtocolStep(1, "Cells", f"Use {p.cell_line} on a {p.platform} patch clamp platform; "
                         "record cell passage and recording quality per cell.",
                         ("seal and series resistance must not compromise voltage control "
                          "(Q&A 2.1 item 3)",)),
            ProtocolStep(2, "Recording conditions",
                         f"Record at {p.recording_temperature_C:g} C with the voltage protocol "
                         f"'{p.voltage_protocol}' repeated at {p.stimulation_frequency_Hz:g} Hz.",
                         ("temperature logged per cell", "stimulation frequency")),
            ProtocolStep(3, "Baseline", "Record baseline current in vehicle until stable.",
                         ("stable baseline before drug application",)),
            ProtocolStep(4, "Test article",
                         f"Apply {', '.join(f'{c:g}' for c in p.test_concentrations_uM)} uM to "
                         f"at least {p.cells_per_concentration} cells per concentration; monitor "
                         "each concentration to steady state (Q&A 2.1 item 3).",
                         ("steady state reached", "per-cell inhibition recorded")),
            ProtocolStep(5, "Background current",
                         f"After the drug, if recording quality allows, apply {p.selective_blocker} "
                         "to measure residual background current in each cell (Q&A 2.1 item 2).",
                         ()),
            ProtocolStep(6, "Controls",
                         f"Vehicle control ({p.vehicle}) and positive control {p.positive_control} "
                         f"at {', '.join(f'{c:g}' for c in p.positive_control_concentrations_uM)} "
                         "uM, chosen to give 20-80% block (Q&A 2.1 item 7; S7B 3.1.1).",
                         ("positive control in every study (S7B 3.1.1)",)),
            ProtocolStep(7, "Concentration verification",
                         ("Collect bath solution and measure test-article concentration with a "
                          "validated analytical method; report nominal and measured (Q&A 2.1 "
                          "item 6).") if p.concentration_verification else
                         "Concentration verification is NOT planned (deviation from Q&A 2.1 "
                         "item 6; recorded in the report).", ()),
            ProtocolStep(8, "Return data", "One row per cell per concentration in the template.",
                         ()),
        )
        criteria = [
            AcceptanceCriterion("fit_r2", f"concentration-response fit R^2 >= "
                                f"{p.acceptance_min_r2:g}", p.acceptance_basis),
            AcceptanceCriterion("steady_state", "only steady-state measurements are analysed",
                                "ich_e14_s7b_qa (Q&A 2.1 item 3)"),
        ]
        if p.max_background_fraction is not None:
            criteria.append(AcceptanceCriterion(
                "background_current", f"cells with background current above "
                f"{100 * p.max_background_fraction:g}% of baseline are excluded",
                p.acceptance_basis))
        if p.positive_control_expected_block:
            criteria.append(AcceptanceCriterion(
                "positive_control", "positive-control block within the expected range at each "
                "concentration; otherwise the study is inconclusive (Q&A 2.1 item 7)",
                p.positive_control_basis or ""))
        return ProtocolDocument(
            driver_id=self.id, driver_version=self.version,
            title=f"In vitro hERG (IKr) assay of {compound.name}",
            objective="Characterise inhibition of hERG current by the test article (IC50, Hill "
                      "coefficient) and compute the safety margin over free high clinical "
                      "exposure for the ICH S7B integrated risk assessment.",
            hypothesis=hypothesis,
            test_article={"name": compound.name, "id": compound.id, "smiles": compound.smiles,
                          "molecular_weight": (f"{compound.molecular_weight.value:.3f} g/mol"
                                               if compound.molecular_weight else "unknown")},
            test_system={"cell_line": p.cell_line, "platform": p.platform},
            design={"concentrations_uM": [f"{c:g}" for c in p.test_concentrations_uM],
                    "cells_per_concentration": p.cells_per_concentration,
                    "temperature_C": f"{p.recording_temperature_C:g}",
                    "stimulation_Hz": f"{p.stimulation_frequency_Hz:g}",
                    "voltage_protocol": p.voltage_protocol,
                    "positive_control": p.positive_control,
                    "asymptotes": "constrained 0-100%" if p.constrain_asymptotes_0_100 else "free",
                    "best_practice_compliance": {c[0]: ("met" if c[1] else "NOT MET") + f" ({c[2]})"
                                                 for c in comp}},
            steps=steps,
            acceptance_criteria=tuple(criteria),
            materials=(p.cell_line, p.positive_control, p.selective_blocker, p.vehicle),
            deliverables=("data CSV per template", "per-cell recording quality log",
                          "bath concentration analytical report" if p.concentration_verification
                          else "statement that concentrations were not verified"),
            glp=p.glp,
            references=tuple(cite(k) for k in ("ich_s7b", "ich_e14_s7b_qa", "delean1978")),
            regulatory_basis=("ICH S7B section 2.3.1 (in vitro IKr assay)",
                              "ICH S7B section 3.1.1 (positive control in every in vitro study)",
                              "ICH E14/S7B Q&A 2.1 (best practice); Q&A 1.2 (safety margin)"),
            parameters=p.model_dump(),
        )

    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan:
        p = _p(params)
        n = len(self._manifest(p))
        return StudyPlan(
            execution_duration_days=None,
            duration_basis="set by the laboratory's recording throughput",
            sample_count=n,
            sample_count_basis=(f"{len(p.test_concentrations_uM)} test + "
                                f"{len(p.positive_control_concentrations_uM)} positive-control + 1 "
                                f"vehicle condition(s) x {p.cells_per_concentration} cells"),
            dependencies=("test article solubility in the recording solution established",)
                         + (("validated bioanalytical method for bath samples",)
                            if p.concentration_verification else ()),
            material_requirements=tuple(protocol.materials),
        )

    def _manifest(self, p: HergParams) -> list[dict[str, Any]]:
        rows = []
        for article, concs in (("TA", p.test_concentrations_uM),
                               ("PC", p.positive_control_concentrations_uM), ("VEH", [0.0])):
            for i, c in enumerate(concs):
                for j in range(p.cells_per_concentration):
                    rows.append({"cell_id": _cell_id(article, i, j), "article": article,
                                 "nominal_concentration_uM": f"{c:g}"})
        return rows

    def sample_manifest(self, params: BaseModel,
                        compound: CompoundInfo) -> tuple[Mapping[str, Any], ...]:
        return tuple(self._manifest(_p(params)))

    def data_template(self, params: BaseModel) -> DataTemplate:
        return DataTemplate(
            template_id=f"{self.id}/{self.version}",
            description="One row per recorded cell and condition. Currents are steady-state "
                        "peak tail (or protocol-defined) current amplitudes.",
            columns=(
                DataColumn("cell_id", "cell id from sample_manifest.csv", kind="text"),
                DataColumn("article", "TA test article, PC positive control, VEH vehicle",
                           kind="text", choices=("TA", "PC", "VEH")),
                DataColumn("nominal_concentration", "nominal concentration", unit="uM",
                           minimum=0),
                DataColumn("measured_concentration", "analytically measured bath concentration",
                           unit="uM", required=False, minimum=0),
                DataColumn("baseline_current", "current before drug", unit="pA",
                           minimum=0, exclusive_minimum=True),
                DataColumn("drug_current", "current at steady state with drug", unit="pA",
                           minimum=0),
                DataColumn("background_current", "residual current after selective blocker",
                           unit="pA", required=False, minimum=0),
                DataColumn("temperature", "recording temperature", unit="degC"),
                DataColumn("steady_state", "drug effect reached steady state", kind="text",
                           choices=("yes", "no")),
            ),
        )

    def validate_records(self, records: Sequence[Mapping[str, Any]],
                         params: BaseModel) -> tuple[list[str], list[str]]:
        p = _p(params)
        manifest = {r["cell_id"]: r for r in self._manifest(p)}
        errors, warnings = [], []
        seen: set[str] = set()
        for i, r in enumerate(records, start=1):
            m = manifest.get(r["cell_id"])
            if m is None:
                errors.append(f"row {i}: cell_id {r['cell_id']!r} not in the manifest")
                continue
            if r["cell_id"] in seen:
                errors.append(f"row {i}: duplicate cell_id {r['cell_id']!r}")
            seen.add(r["cell_id"])
            if r["article"] != m["article"] or \
                    abs(r["nominal_concentration"] - float(m["nominal_concentration_uM"])) > 1e-9:
                errors.append(f"row {i}: article/concentration do not match manifest for "
                              f"{r['cell_id']}")
            bg = r.get("background_current")
            if bg is not None and bg >= r["baseline_current"]:
                errors.append(f"row {i}: background current is not below baseline current")
            if p.concentration_verification and r["article"] == "TA" and \
                    r.get("measured_concentration") is None:
                warnings.append(f"row {i}: measured concentration missing for {r['cell_id']}")
        missing = sorted(set(manifest) - seen)
        if missing:
            warnings.append(f"{len(missing)} planned cell(s) not returned")
        return errors, warnings

    # -- analysis --------------------------------------------------------------

    def analysis_inputs(self, params: BaseModel) -> Mapping[str, str]:
        return {"cmax_total_high_clinical_exposure": "uM", "fu_plasma": "dimensionless",
                "free_cmax_high_clinical_exposure": "uM"}

    def _analyze(self, data: IngestedData, params: BaseModel, compound: CompoundInfo,
                 inputs: Mapping[str, Quantity]) -> AnalysisResult:
        p = _p(params)
        prov = data.provenance()
        inh_m = method("pharm.percent_inhibition")
        findings: list[QCFinding] = []
        notes: list[str] = []
        t_lo, t_hi = QA21_TEMPERATURE_C
        per_cell_rows = []
        by_article: dict[str, list[tuple[float, float, bool]]] = defaultdict(list)
        used_measured = True
        for r in data.records:
            if r["steady_state"] != "yes":
                notes.append(f"{r['cell_id']}: not at steady state, excluded")
                continue
            base, drug, bg = r["baseline_current"], r["drug_current"], r.get("background_current")
            bgv = bg if bg is not None else 0.0
            if bg is None:
                findings.append(QCFinding(f"{r['cell_id']}.no_background", QCStatus.WARN,
                                          "no selective-blocker background current; inhibition "
                                          "not background-corrected (Q&A 2.1 item 2)"))
            if p.max_background_fraction is not None and bg is not None and \
                    bg / base > p.max_background_fraction:
                notes.append(f"{r['cell_id']}: background {100 * bg / base:.0f}% of baseline "
                             "exceeds criterion, excluded")
                continue
            if not (t_lo <= r["temperature"] <= t_hi):
                findings.append(QCFinding(f"{r['cell_id']}.temperature", QCStatus.WARN,
                                          f"recorded at {r['temperature']:g} C, outside the "
                                          "35-37 C of Q&A 2.1 item 1", r["temperature"],
                                          list(QA21_TEMPERATURE_C)))
            inhib = 100.0 * (1.0 - (drug - bgv) / (base - bgv))
            conc = r["nominal_concentration"]
            if r["article"] == "TA":
                if r.get("measured_concentration") is not None:
                    conc = r["measured_concentration"]
                else:
                    used_measured = False
            by_article[r["article"]].append((conc, inhib, r.get("measured_concentration")
                                             is not None))
            per_cell_rows.append((r["cell_id"], r["article"],
                                  Quantity.user_supplied(r["nominal_concentration"], "uM",
                                                         actor="study protocol",
                                                         label="nominal concentration"),
                                  Quantity.computed(inhib, "percent", method=inh_m,
                                                    label="inhibition")))
        q: dict[str, Quantity] = {}
        tables = []
        ta = [x for x in by_article["TA"] if x[0] > 0]
        if len({c for c, _, _ in ta}) < 4:
            findings.append(QCFinding("too_few_concentrations", QCStatus.FAIL,
                                      "fewer than four test concentrations with usable cells; "
                                      "no IC50 can be fitted"))
            ic50 = Quantity.unavailable("uM", reason="fewer than four usable concentrations",
                                        label="hERG IC50")
            hill = Quantity.unavailable("dimensionless", reason="no fit", label="Hill slope")
            fit_note = None
        else:
            series = MeasurementSeries(
                x=tuple(c for c, _, _ in ta), y=tuple(v for _, v, _ in ta), x_unit="uM",
                y_unit="percent", provenance=prov, x_label="concentration",
                y_label="hERG inhibition (per cell)")
            try:
                fit = fit_hill(series, potency_label="hERG IC50", min_r2=p.acceptance_min_r2,
                               fix_top=0.0 if p.constrain_asymptotes_0_100 else None,
                               fix_bottom=100.0 if p.constrain_asymptotes_0_100 else None)
                ic50, hill = fit.ic50, fit.hill_slope
                findings += list(fit.qc.findings)
                fit_note = f"R^2 = {fit.r_squared:.3f}; {len(ta)} cells in fit"
                q["fit_upper_asymptote"] = fit.bottom.relabel("maximal inhibition (fitted)")
            except QuantityError as exc:
                findings.append(QCFinding("fit_failed", QCStatus.FAIL, str(exc)))
                ic50 = Quantity.unavailable("uM", reason=str(exc), label="hERG IC50")
                hill = Quantity.unavailable("dimensionless", reason=str(exc), label="Hill slope")
                fit_note = None
        if not used_measured and p.concentration_verification:
            findings.append(QCFinding("nominal_concentrations_used", QCStatus.WARN,
                                      "measured concentrations incomplete; IC50 fitted on "
                                      "nominal concentrations (Q&A 2.1 item 6)"))
        q["ic50"] = ic50
        q["hill"] = hill
        mw = compound.molecular_weight
        if ic50.is_available and mw is not None and mw.is_available:
            ng = ic50.magnitude_in("uM") * mw.magnitude_in("g/mol")  # umol/L * g/mol = ng/mL
            unc = ic50.uncertainty
            q["ic50_ng_per_mL"] = Quantity.computed(
                ng, "ng/mL", method=method("pharm.molar_to_mass_concentration"),
                inputs=[ic50, mw], label="hERG IC50 (mass concentration)",
                qc_flags=ic50.qc_flags,
                uncertainty=Uncertainty(kind="ci95", lower=unc.lower * mw.require(),
                                        upper=unc.upper * mw.require())
                if unc is not None and unc.lower is not None else None)

        # positive control
        pc_rows = []
        exp = {e.concentration_uM: e for e in p.positive_control_expected_block}
        pc_by_c: dict[float, list[float]] = defaultdict(list)
        for c, v, _ in by_article["PC"]:
            pc_by_c[c].append(v)
        in_window = 0
        for c in p.positive_control_concentrations_uM:
            vals = pc_by_c.get(c, [])
            if not vals:
                findings.append(QCFinding(f"pc.{c:g}.missing", QCStatus.FAIL,
                                          f"no positive-control data at {c:g} uM"))
                continue
            mean = float(np.mean(vals))
            mq = Quantity.computed(mean, "percent", method=inh_m,
                                   uncertainty=Uncertainty(kind="sd", sd=float(np.std(vals, ddof=1)),
                                                           n=len(vals)) if len(vals) > 1 else None,
                                   label=f"{p.positive_control} {c:g} uM mean inhibition")
            q[f"positive_control.{c:g}uM"] = mq
            lo20, hi80 = QA21_POSITIVE_CONTROL_BLOCK
            if lo20 <= mean <= hi80:
                in_window += 1
            verdict = "no expected range supplied"
            if c in exp:
                ok = exp[c].low_percent <= mean <= exp[c].high_percent
                verdict = "within expected range" if ok else "OUTSIDE expected range"
                if not ok:
                    findings.append(QCFinding(
                        f"pc.{c:g}.out_of_range", QCStatus.FAIL,
                        f"positive control {p.positive_control} at {c:g} uM gave {mean:.1f}% "
                        f"block, outside {exp[c].low_percent:g}-{exp[c].high_percent:g}% "
                        f"({p.positive_control_basis}); study inconclusive (Q&A 2.1 item 7)",
                        round(mean, 2), [exp[c].low_percent, exp[c].high_percent]))
            pc_rows.append((p.positive_control, Quantity.user_supplied(
                c, "uM", actor="study protocol", label="nominal"), mq, len(vals), verdict))
        if in_window < 2:
            findings.append(QCFinding("pc.block_window", QCStatus.WARN,
                                      f"{in_window} positive-control concentration(s) gave "
                                      "20-80% block; Q&A 2.1 item 7 asks for two or more",
                                      in_window, 2))
        veh = [v for _, v, _ in by_article["VEH"]]
        if veh:
            q["vehicle_inhibition"] = Quantity.computed(
                float(np.mean(veh)), "percent", method=inh_m,
                uncertainty=Uncertainty(kind="sd", sd=float(np.std(veh, ddof=1)), n=len(veh))
                if len(veh) > 1 else None, label="vehicle apparent inhibition (rundown)")

        # margin (S7B Q&A 1.2)
        free = inputs.get("free_cmax_high_clinical_exposure")
        total, fu = inputs.get("cmax_total_high_clinical_exposure"), inputs.get("fu_plasma")
        if free is None and total is not None and fu is not None:
            fu_v = fu.require()
            floored = max(fu_v, QA12_FU_FLOOR)
            free = Quantity.computed(
                total.magnitude_in("uM") * floored, "uM", method=method("safety.free_cmax_qa12"),
                inputs=[total, fu], label="free high clinical exposure (Cmax,ss x fu)",
                qc_flags=("fu_floored_at_1_percent",) if fu_v < QA12_FU_FLOOR else (),
                notes=f"fu,p used = {floored:g}" + (" (floored from "
                                                    f"{fu_v:g})" if fu_v < QA12_FU_FLOOR else ""))
        if free is None:
            margin = Quantity.unavailable(
                "dimensionless", reason="free high clinical exposure not supplied (give "
                "free_cmax_high_clinical_exposure, or total Cmax,ss and fu,p)",
                label="hERG safety margin")
        else:
            q["free_cmax"] = free
            margin = herg_safety_margin(ic50, free)
            unc = ic50.uncertainty
            if margin.is_available and unc is not None and unc.lower is not None:
                cm = free.magnitude_in("uM")
                margin = Quantity(value=margin.value, unit=margin.unit,
                                  provenance=margin.provenance, label=margin.label,
                                  qc_flags=margin.qc_flags,
                                  uncertainty=Uncertainty(kind="ci95", lower=unc.lower / cm,
                                                          upper=unc.upper / cm))
        q["margin"] = margin

        tables.append(tabulate("hERG potency and margin",
                               ("quantity", "value"),
                               [("IC50", ic50), ("IC50 (ng/mL)", q.get("ic50_ng_per_mL")),
                                ("Hill coefficient", hill), ("free high clinical exposure",
                                                             q.get("free_cmax")),
                                ("safety margin", margin)],
                               note=fit_note))
        if pc_rows:
            tables.append(tabulate("Positive control", ("drug", "concentration", "mean block",
                                                        "n cells", "acceptance"), pc_rows))
        tables.append(tabulate("Per-cell inhibition", ("cell", "article", "nominal conc.",
                                                       "inhibition"), per_cell_rows))
        return AnalysisResult(quantities={k: v for k, v in q.items() if v is not None},
                              tables=tuple(tables), qc=QCVerdict.of(findings),
                              evidence_admissible=True, notes=tuple(notes))

    # -- interpretation --------------------------------------------------------

    def _interpret(self, analysis: AnalysisResult, params: BaseModel,
                   context: Optional[ProgramContext]) -> Interpretation:
        p = _p(params)
        out: list[InterpretiveStatement] = []
        judgement = ["Integrated S7B risk assessment: low TdP risk also requires no QTc "
                     "prolongation in an in vivo assay of sufficient sensitivity (S7B Q&A 1.1)"]
        unmet = [c[0] for c in p.compliance() if not c[1]]
        if unmet:
            out.append(InterpretiveStatement(
                "The study design deviates from E14/S7B Q&A 2.1 best practice: "
                + "; ".join(unmet) + ". Margins from this protocol are comparable only with "
                "reference drugs run under the same protocol.",
                "best-practice checklist against Q&A 2.1", ("ich_e14_s7b_qa",), "notable"))
        if any(f.code.startswith("pc.") and f.status is QCStatus.FAIL
               for f in analysis.qc.findings):
            out.append(InterpretiveStatement(
                "Positive-control results fall outside their expected range: the study is "
                "inconclusive and should not be used to support E14 Q&As 5.1/6.1.",
                "E14/S7B Q&A 2.1 item 7", ("ich_e14_s7b_qa",), "concern"))
        ic50 = analysis.quantities.get("ic50")
        if ic50 is not None and "potency_extrapolated" in ic50.qc_flags:
            out.append(InterpretiveStatement(
                "The IC50 lies outside the tested concentration range and is an extrapolation.",
                "4PL inflection outside tested range", ("delean1978",), "notable"))
        m = analysis.quantities.get("margin")
        if m is not None and m.is_available:
            v = m.require()
            ci = (f" (95% CI {m.uncertainty.lower:.3g}-{m.uncertainty.upper:.3g}, IC50 "
                  "uncertainty only)" if m.uncertainty is not None and m.uncertainty.lower
                  is not None else "")
            if p.margin_threshold is not None:
                above = v > p.margin_threshold
                out.append(InterpretiveStatement(
                    f"hERG safety margin is {v:.3g}x{ci}, "
                    f"{'above' if above else 'not above'} the protocol-specific threshold of "
                    f"{p.margin_threshold:g}x ({p.margin_threshold_basis}).",
                    "S7B Q&A 1.2: compare with margins of reference drugs under the same protocol",
                    ("ich_e14_s7b_qa",), "info" if above else "concern"))
            else:
                out.append(InterpretiveStatement(
                    f"hERG safety margin is {v:.3g}x{ci}. No protocol-specific threshold was "
                    "supplied; S7B Q&A 1.2 requires comparison with reference drugs run under "
                    "the same protocol.", "S7B Q&A 1.2", ("ich_e14_s7b_qa",), "info"))
                judgement.append("Whether the margin indicates low hERG-mediated risk (no "
                                 "reference-drug threshold supplied)")
            if "herg_margin_below_30x_reference" in m.qc_flags:
                out.append(InterpretiveStatement(
                    "The margin is below 30x, the level below which Redfern et al. observed "
                    "torsadogenic drugs to cluster (a historical reference point, not a criterion).",
                    "Redfern 2003 retrospective analysis", ("redfern2003",), "notable"))
        elif m is not None:
            out.append(InterpretiveStatement(
                f"No safety margin computed: {m.provenance.reason}.",
                "S7B Q&A 1.2 margin requires free high clinical exposure",
                ("ich_e14_s7b_qa",), "info"))
        return Interpretation(statements=tuple(out), requires_expert_judgement=tuple(judgement))

    # -- report ----------------------------------------------------------------

    def _report_sections(self, protocol: ProtocolDocument, data: IngestedData,
                         analysis: AnalysisResult, interpretation: Interpretation,
                         determinations: Sequence[Mapping[str, Any]]) -> list[ReportSection]:
        comp = protocol.design.get("best_practice_compliance", {})
        qc = "\n".join(f"- [{f.status.value}] {f.code}: {f.message}" for f in analysis.qc.findings)
        return [
            ReportSection("Summary", "hERG current inhibition was measured by patch clamp; the "
                          "IC50 was fitted with a four-parameter logistic model.",
                          tables=analysis.tables[:1]),
            ReportSection("E14/S7B Q&A 2.1 best-practice compliance",
                          "\n".join(f"- {k}: {v}" for k, v in comp.items())),
            ReportSection("Results", "Positive control and per-cell data.",
                          tables=analysis.tables[1:]),
            ReportSection("Quality control", (qc or "No findings.") +
                          ("\n\nExcluded: " + "; ".join(analysis.notes) if analysis.notes else "")),
        ]

    # -- simulation ------------------------------------------------------------

    def _simulate_rows(self, params: BaseModel, compound: CompoundInfo, sim: BaseModel,
                       rng: np.random.Generator) -> tuple[list[dict[str, Any]], str]:
        p = _p(params)
        s = sim
        assert isinstance(s, HergSimulation)
        rows = []
        for m in self._manifest(p):
            c = float(m["nominal_concentration_uM"])
            if m["article"] == "TA":
                true = 100.0 / (1.0 + (s.ic50_uM / c) ** s.hill)
            elif m["article"] == "PC":
                true = 100.0 / (1.0 + (s.positive_control_ic50_uM / c) ** s.positive_control_hill)
            else:
                true = s.vehicle_rundown_percent
            inh = true + float(rng.normal(0.0, s.inhibition_noise_sd_percent))
            bg = s.background_fraction * s.baseline_current_pA
            drug = max(bg + (s.baseline_current_pA - bg) * (1.0 - inh / 100.0), 0.0)
            rows.append({"cell_id": m["cell_id"], "article": m["article"],
                         "nominal_concentration": c,
                         "measured_concentration": c if (m["article"] == "TA" and
                                                         p.concentration_verification) else None,
                         "baseline_current": s.baseline_current_pA, "drug_current": drug,
                         "background_current": bg, "temperature": s.temperature_C,
                         "steady_state": "yes"})
        return rows, "sim.four_parameter_logistic"


def _p(params: BaseModel) -> HergParams:
    if not isinstance(params, HergParams):
        raise TypeError("expected HergParams")
    return params
