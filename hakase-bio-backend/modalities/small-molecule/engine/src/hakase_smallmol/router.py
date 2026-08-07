import json
from functools import lru_cache
from typing import Any

import numpy as np
import requests
from fastapi import APIRouter, HTTPException
from hakase_kernel.translational.celltype_aggregation import (
    predict_celltype_aggregation,
)
from hakase_kernel.translational.patient_line import (
    predict_patient_line,
)
from hakase_kernel.uncertainty.applicability_domain import predict_applicability_domain
from hakase_kernel.uncertainty.explain import explain as shap_explain
from hakase_kernel.utils import sanitize
from hakase_structure import docking as docking_vina
from hakase_structure.protein import predict_protein
from hakase_structure.protein_ml import predict_protein_ml
from pydantic import BaseModel, Field

from hakase_smallmol import fep_runpod
from hakase_smallmol.admet.admet import predict_admet
from hakase_smallmol.admet.admet_ml import (
    predict_admet_ml,
    predict_admet_ml_batch,
)
from hakase_smallmol.admet.admetlab import (
    is_ready as admetlab_status,
)
from hakase_smallmol.admet.admetlab import (
    predict_bsep_inhibition,
    predict_pampa,
    predict_pgp_substrate,
    predict_phospholipidosis,
)
from hakase_smallmol.admet.bsep import predict_bsep
from hakase_smallmol.admet.caco2_ml import (
    predict_caco2_ml,
)
from hakase_smallmol.admet.half_life_ml import (
    predict_half_life_ml,
)
from hakase_smallmol.admet.solubility_ml import (
    predict_solubility_ml,
)
from hakase_smallmol.admet.vdss_ml import (
    predict_vdss_ml,
)
from hakase_smallmol.binding.binding_dta_adapter import predict_affinity as predict_dta_affinity
from hakase_smallmol.binding.binding_dta_adapter import status as dta_status
from hakase_smallmol.binding.binding_ml import (
    predict_binding_ml,
)
from hakase_smallmol.cardiotox.cardiotox import (
    predict_cardiotox,
)
from hakase_smallmol.dili.dili_ml import (
    predict_dili_ml,
)
from hakase_smallmol.drug_lookup import lookup_drug, lookup_status
from hakase_smallmol.drug_target import predict_binding
from hakase_smallmol.ersilia_hub import (
    predict_cytotoxicity,
    predict_ersilia,
)
from hakase_smallmol.l1.assay_bench import assay_catalogue, run_assay_bench
from hakase_smallmol.l1.pipeline import (
    generate_l1_wetlab_report,
    get_l1_analysis,
    record_l1_override,
    run_l1_pipeline,
)
from hakase_smallmol.l2.pipeline import (
    _availability,
    _presentation_for_stage,
    l1_ivive_inputs,
    l2_input_contract,
    run_configured_l2_stages,
    run_l2_stage,
)
from hakase_smallmol.l3.contract import l3_input_contract
from hakase_smallmol.l3.pipeline import run_animal_study
from hakase_smallmol.l3.reporting_engine import report_markdown
from hakase_smallmol.l3.store import get_study
from hakase_smallmol.molecular_properties import predict_properties
from hakase_smallmol.pk_ivive.pk_ivive import predict_pk_ivive
from hakase_smallmol.pkdb_anchor import (
    predict_pk_anchor,
)
from hakase_smallmol.safety.ames_ml import (
    predict_ames_ml,
)
from hakase_smallmol.safety.assay_reliability import assess_assay_reliability
from hakase_smallmol.safety.invitro_panel import predict_invitro_panel
from hakase_smallmol.safety.reactive_metabolites import predict_reactive_metabolites
from hakase_smallmol.safety.safety_triage import predict_safety_triage
from hakase_smallmol.safety.tox21_ml import (
    predict_tox21_head,
    predict_tox21_panel,
)

router = APIRouter()


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


class SmilesRequest(BaseModel):
    smiles: str


class BindingRequest(BaseModel):
    smiles: str
    target_id: str | None = None


class ProteinRequest(BaseModel):
    uniprot_id: str


class FullPipelineRequest(BaseModel):
    smiles: str
    uniprot_id: str | None = None
    target_id: str | None = None


class SimulationOptions(BaseModel):
    """Server-owned run configuration for the Layer-1 model portfolio."""

    admet_profiling: bool = True
    binding_simulation: bool = False
    toxicity_signal_detection: bool = True
    behavioral_fingerprinting: bool = False
    confidence_threshold: float = Field(default=0.70, ge=0.50, le=0.95)


class L1PipelineRequest(BaseModel):
    """Display-only frontend contract for small-molecule Layer 1."""

    smiles: str
    uniprot_id: str | None = None
    target_protein: str | None = None
    pdb_id: str | None = None
    target_resolution: dict[str, Any] | None = None
    target_evidence: dict[str, Any] | None = None
    therapeutic_area: str | None = None
    simulation_options: SimulationOptions | None = None


class L1OverrideRequest(BaseModel):
    """Backend-recorded manual review for one completed Layer-1 analysis."""

    analysis_id: str
    reviewer: str
    decision: str
    rationale: str
    flagged_checks: list[str] = []


class L1ReportRequest(BaseModel):
    analysis_id: str


class AssayBenchRequest(BaseModel):
    """Run a subset of the extended in-vitro bench.

    Supply ``assay_ids`` for named assays, ``group_ids`` for whole groups, or
    neither to run the full catalogue.
    """

    smiles: str
    assay_ids: list[str] | None = None
    group_ids: list[str] | None = None


class L2StageOptions(BaseModel):
    """Caller-supplied study context for the Confirmation stages.

    These are study *inputs* (a dose to project, a measured constant the lab
    actually ran), never scientific results. Every value is optional; omitting
    one narrows what a stage can report rather than substituting a default.
    """

    # Stage 6 — IVIVE. Without a dose the closed-form clearance and half-life
    # are still returned; only the exposure block is omitted.
    dose_mg: float | None = None
    species: str | None = None
    body_weight_kg: float | None = None
    # Stage 7 — occupancy. Cooperativity is never inferred; supplying a Hill
    # coefficient is the only way to move it off 1.
    hill_coefficient: float | None = None
    # Stage 8 — margins. Measured safety concentrations in nM, e.g.
    # {"herg_ic50_nm": 12000}. These are lab measurements, not predictions.
    measured_safety_concentrations: dict[str, float] | None = None


class L2StageRequest(BaseModel):
    """Server-owned Confirmation stage request."""

    analysis_id: str
    stage: str
    options: L2StageOptions | None = None


class L2RunConfiguredRequest(BaseModel):
    """Batch Confirmation run with the same optional study context."""

    analysis_id: str
    options: L2StageOptions | None = None


class VirtualTissueConfiguredRequest(BaseModel):
    """Backend batch request for the configured virtual-tissue sub-track.

    Values here are evidence passed from the server-returned target discovery
    result. The browser never transforms them into an outcome.
    """

    analysis_id: str | None = None
    target_gene_symbol: str | None = None
    uniprot_id: str | None = None
    l1_ic50_nM: float | None = None
    oncology: bool = True
    top_n: int = 25


@lru_cache(maxsize=256)
def _gene_symbol_for_uniprot(accession: str) -> str | None:
    """Resolve a UniProt accession to its canonical gene symbol.

    This is a server-side data lookup used only when Layer 1 already recorded a
    validated protein accession but its target-discovery response did not carry
    a gene symbol.  A miss remains unresolved; it is never guessed.
    """
    normalized = accession.strip().upper()
    if not normalized:
        return None
    try:
        response = requests.get(
            f"https://rest.uniprot.org/uniprotkb/{normalized}.json",
            params={"fields": "gene_names"},
            headers={"Accept": "application/json"},
            timeout=8,
        )
        if not response.ok:
            return None
        genes = response.json().get("genes") or []
        primary = ((genes[0] or {}).get("geneName") or {}).get("value") if genes else None
        return str(primary).strip() or None if primary else None
    except requests.RequestException:
        return None


class DTAReq(BaseModel):
    smiles: str
    uniprot_or_seq: str


class BatchSmilesRequest(BaseModel):
    smiles: list[str]


class FpOrSmilesRequest(BaseModel):
    """Privacy-preserving input: send EITHER `smiles` OR a client-computed
    `features` vector (Morgan-1024 r2 || [MolWt, MolLogP, TPSA, HBD, HBA,
    FractionCSP3]). In `features` mode the server never receives the structure.
    """

    smiles: str | None = None
    features: list[float] | None = None


class Tox21HeadRequest(BaseModel):
    smiles: str
    assay: str


class PkAnchorRequest(BaseModel):
    """Layer-3 human-PK anchor request.

    Provide at least one identifier (InChIKey preferred for exact structural
    matching). `projected` optionally carries the Layer-3 allometric human PK
    (clearance, vd, thalf, auc, cmax) so the service can return an
    observed-vs-projected validation verdict.
    """

    # Supplying a completed Layer-1 analysis lets the server resolve the
    # identifiers itself. A SMILES string will not match a substance registry;
    # the InChIKey and preferred name recorded during the regulatory lookup will.
    analysis_id: str | None = None
    name: str | None = None
    inchikey: str | None = None
    chembl_id: str | None = None
    smiles: str | None = None
    projected: dict[str, float] | None = None
    parameters: list[str] | None = None


class InVitroPanelRequest(BaseModel):
    smiles: str
    uniprot_id: str | None = None  # optional target → adds DeepDTA binding
    therapeutic_area: str | None = None


class ExplainRequest(BaseModel):
    """SHAP explanation request for a Layer-1 ML prediction."""

    smiles: str
    model: str = "dili"  # one of available_models(): cardiotox | dili | solubility
    top_k: int = 12


class BindingMlRequest(BaseModel):
    smiles: str
    uniprot_id: str


class CellTypeAggregationTarget(BaseModel):
    gene_symbol: str
    uniprot_id: str | None = None
    affinity_pKi: float | None = None


class CellTypeAggregationRequest(BaseModel):
    targets: list[CellTypeAggregationTarget]
    top_n: int = 25


class PatientLineRequest(BaseModel):
    target_gene_symbol: str
    l1_ic50_nM: float
    oncology: bool
    indication_keyword: str | None = None
    alpha: float = 1.0
    top_n: int = 25


class PkIviveRequest(BaseModel):
    """Layer 1 — quantitative human PK by IVIVE.

    `overrides` lets a caller substitute a MEASURED value for any Hakase ADMET input
    (keys: clint_hep_ul_min_1e6, fu_plasma, vdss_l_per_kg, half_life_obach_h,
    blood_plasma_ratio); measured wins over ML. `dose_mg` (optional) adds an
    assumption-free IV-bolus exposure block (AUC, C-t curve).
    """

    smiles: str | None = None
    analysis_id: str | None = None
    overrides: dict[str, float] | None = None
    ml_inputs: dict[str, float] | None = None
    body_weight_kg: float = 70.0
    blood_plasma_ratio: float | None = None
    dose_mg: float | None = None
    species: str = "human"
    strain: str | None = None
    montecarlo: bool = False
    mc_samples: int = 2000
    mc_coverage: float = 0.90


class AnimalCohortRequest(BaseModel):
    smiles: str
    species_id: str
    study_type_id: str
    route_of_admin: str
    cohort_size: int
    formulation: str
    starting_dose_mg_kg: float
    ml_admet: dict[str, Any]
    measured_noael_override: float | None = None


# ── Layer 3 — Virtual Preclinical Study Engine (Animal Cohort) ──
class L3ContractRequest(BaseModel):
    analysis_id: str | None = None
    smiles: str | None = None


class L3AnimalSpec(BaseModel):
    species: str
    strain: str | None = None
    sex: str | None = None
    age: str | None = None
    body_weight: float | None = Field(default=None, gt=0)


class L3DoseGroup(BaseModel):
    label: str | None = None
    dose_mg_per_kg: float = Field(ge=0)
    is_control: bool = False


class L3GateRequest(BaseModel):
    analysis_id: str
    species: str = "rat"


class L3SignoffRequest(BaseModel):
    analysis_id: str
    species: str = "rat"
    name: str = Field(min_length=1)
    role: str = Field(min_length=1)
    acknowledged_codes: list[str] = Field(default_factory=list)
    justification: str | None = None


class L3AnimalStudyRequest(BaseModel):
    analysis_id: str | None = None
    smiles: str | None = None
    animal: L3AnimalSpec
    dose_groups: list[L3DoseGroup] = Field(min_length=1)
    route: str
    frequency: str | None = None
    duration_h: float = Field(default=24.0, gt=0)
    infusion_duration_h: float | None = Field(default=None, gt=0)
    formulation: str = Field(default="plain", min_length=1)
    cohort_size: int = Field(default=8, ge=2, le=1_000)
    seed: int = 42
    overrides: dict[str, Any] | None = None
    collect_public_evidence: bool = True
    engine: str = "auto"  # "auto" | "mrgsolve" | "kernel"


# ── Layer 4 — First-in-Human Translation Engine ──
class L4ContractRequest(BaseModel):
    study_id: str


class L4RunRequest(BaseModel):
    """Design inputs for the first-in-human projection over a completed L3 study.

    Everything the clinical pharmacologist chooses is here; everything the
    science determines comes from the animal study record identified by
    ``study_id``.
    """

    study_id: str
    route: str = "ORAL"
    formulation: str = Field(default="standard", min_length=1)
    frequency: str | None = None
    duration_h: float = Field(default=168.0, gt=0)
    cohort_size: int = Field(default=20, ge=2, le=1_000)
    body_weight_kg: float = Field(default=60.0, gt=0)
    # FDA (2005) safety-factor risk flags, keyed by the ids in the contract's
    # `clinical_design_options.risk_factors`.
    risk_flags: dict[str, bool] | None = None
    escalation_scheme: str = "modified_fibonacci"
    escalation_levels: int = Field(default=7, ge=1, le=20)
    escalation_fold: float = Field(default=2.0, gt=1.0)
    max_dose_mg: float | None = Field(default=None, gt=0)
    # One dose-limiting-toxicity probability per ladder level. Without it the
    # 3+3 operating characteristics are reported as not simulable, never guessed.
    dlt_probabilities: list[float] | None = None
    sad_cohort_size: int = Field(default=8, ge=2, le=200)
    mad_cohort_size: int = Field(default=12, ge=2, le=200)
    mad_frequency: str = "QD"
    collect_precedent: bool = True
    # Benefit-risk and filing-readiness context.
    indication: str | None = None
    regulatory_region: str = "FDA"
    ind_declared_complete: dict[str, bool] | None = None
    ind_override_justification: str | None = None
    assess_benefit_risk: bool = True
    # Measured disposition inputs carried forward from the earlier layers so the
    # human projection runs on the same disposition the animal study did.
    overrides: dict[str, Any] | None = None
    seed: int = 42
    engine: str = "kernel"


# ── External public-database evidence panel ──
class ExternalPanelRequest(BaseModel):
    """Identifiers already resolved upstream; the panel never re-derives them."""

    panel: str = "target"  # target | hazard | clinical
    gene_symbol: str | None = None
    uniprot_id: str | None = None
    inchikey: str | None = None
    compound_name: str | None = None
    casrn: str | None = None
    therapeutic_area: str | None = None
    target_protein: str | None = None
    max_results: int = Field(default=25, ge=1, le=100)


class AntibodyRequest(BaseModel):
    heavy_chain: str
    light_chain: str | None = None
    format_hint: str | None = None
    expression_host: str | None = None
    subclass: str | None = None
    target_antigen: str | None = None


class AntibodyMlRequest(BaseModel):
    heavy_chain: str
    light_chain: str | None = None


class ErsiliaRequest(BaseModel):
    endpoint: str
    smiles: str


class DockingRequest(BaseModel):
    smiles: str
    pdb_id: str
    exhaustiveness: int = 8
    num_modes: int = 5


class FepRequest(BaseModel):
    ligand_a_smiles: str
    ligand_b_smiles: str
    pdb_id: str
    n_lambda_windows: int = 12
    n_replicas: int = 3
    ns_per_window: float = 5.0


@router.post("/predict/admet")
def api_predict_admet(req: SmilesRequest):
    try:
        return sanitize(predict_admet(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ADMET prediction failed: {str(e)}")


@router.post("/predict/l1")
def api_predict_l1(req: L1PipelineRequest):
    """Run the server-owned small-molecule Layer-1 workspace pipeline."""
    try:
        return sanitize(
            run_l1_pipeline(
                req.smiles,
                uniprot_id=req.uniprot_id,
                target_protein=req.target_protein,
                pdb_id=req.pdb_id,
                target_resolution=req.target_resolution,
                target_evidence=req.target_evidence,
                therapeutic_area=req.therapeutic_area,
                simulation_options=(
                    req.simulation_options.model_dump() if req.simulation_options else None
                ),
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layer-1 pipeline failed: {str(e)}")


@router.post("/predict/assay-reliability")
def api_assay_reliability(req: SmilesRequest):
    """Run the local RDKit PAINS/Brenk screen independently of Layer 1."""
    try:
        return sanitize(assess_assay_reliability(req.smiles))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Assay-reliability screen failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l1/overrides")
def api_record_l1_override(req: L1OverrideRequest):
    """Store a manual Layer-1 review without changing the model result itself."""
    try:
        return sanitize(
            record_l1_override(
                req.analysis_id,
                reviewer=req.reviewer,
                decision=req.decision,
                rationale=req.rationale,
                flagged_checks=req.flagged_checks,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-1 override could not be recorded: {str(e)}"
        )


@router.post("/predict/l1/report")
def api_generate_l1_wetlab_report(req: L1ReportRequest):
    """Create a backend-owned Layer-1 wet-lab review report."""
    try:
        return sanitize(generate_l1_wetlab_report(req.analysis_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-1 report could not be generated: {str(e)}"
        )


@router.get("/predict/l1/assay-bench/catalog")
def api_assay_bench_catalog():
    """Return the extended in-vitro assay catalogue the workspace renders."""
    return sanitize(assay_catalogue())


@router.post("/predict/l1/assay-bench/run")
def api_assay_bench_run(req: AssayBenchRequest):
    """Run a requested subset of the extended in-vitro bench server-side.

    One request replaces up to twenty browser round-trips. Each assay keeps its
    own availability envelope; a provider outage is reported, never substituted.
    """
    try:
        return sanitize(
            run_assay_bench(req.smiles, assay_ids=req.assay_ids, group_ids=req.group_ids)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Assay bench run failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l2/contract")
def api_l2_contract(req: L1ReportRequest):
    """Return the backend-owned L1 → Confirmation handoff contract."""
    try:
        return sanitize(l2_input_contract(req.analysis_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-2 input contract failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l2/stage")
def api_run_l2_stage(req: L2StageRequest):
    """Run a synchronous, backend-owned Confirmation stage."""
    try:
        options = req.options.model_dump(exclude_none=True) if req.options else {}
        return sanitize(run_l2_stage(req.analysis_id, req.stage, options))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-2 stage failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l2/run-configured")
def api_run_configured_l2_stages(req: L2RunConfiguredRequest):
    """Run the synchronous L2 stages in one backend-owned orchestration job."""
    try:
        options = req.options.model_dump(exclude_none=True) if req.options else {}
        return sanitize(run_configured_l2_stages(req.analysis_id, options))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Configured Layer-2 run failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l3/contract")
def api_l3_contract(req: L3ContractRequest):
    """Return the L1/L2 → Animal-Cohort handoff + simulation-readiness contract."""
    try:
        return sanitize(l3_input_contract(analysis_id=req.analysis_id, smiles=req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-3 contract failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l3/gate")
def api_l3_gate(req: L3GateRequest):
    """Evaluate the L2 → L3 stage gate for an analysis.

    Returns the hard blocks and soft warnings computed from the accumulated
    L1/L2 evidence, plus any signature already on record. The browser renders
    this; it never derives a condition itself.
    """
    from hakase_smallmol.l3.gate_engine import evaluate_gate
    from hakase_smallmol.l3.parameter_engine import resolve_from_analysis

    try:
        resolved = resolve_from_analysis(req.analysis_id)
        return sanitize(evaluate_gate(resolved, species=req.species))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Layer-3 gate failed: {type(e).__name__}: {e}")


@router.post("/predict/l3/signoff")
def api_l3_signoff(req: L3SignoffRequest):
    """Record a named reviewer's signature against the L2 → L3 stage gate.

    The signature records accepted residual risk. It cannot clear a hard block,
    and every soft warning must be acknowledged for it to be accepted.
    """
    from hakase_smallmol.l3.gate_engine import evaluate_gate
    from hakase_smallmol.l3.parameter_engine import resolve_from_analysis
    from hakase_smallmol.l3.signoff_store import SignoffError, record_signoff

    try:
        resolved = resolve_from_analysis(req.analysis_id)
        gate = evaluate_gate(resolved, species=req.species)
        record = record_signoff(
            analysis_id=req.analysis_id,
            name=req.name,
            role=req.role,
            acknowledged_codes=req.acknowledged_codes,
            justification=req.justification,
            gate_snapshot=gate,
        )
    except SignoffError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-3 sign-off failed: {type(e).__name__}: {e}"
        )
    return sanitize({"signoff": record, "gate": evaluate_gate(resolved, species=req.species)})


@router.post("/predict/l3/design")
def api_l3_design(req: L3AnimalStudyRequest):
    """Validate/normalise a study design without running the simulation.

    Returns the readiness envelope and the normalised arms so the UI can confirm
    the design before paying for the cohort simulation.
    """
    from hakase_smallmol.l3.pbpk_adapter import AnimalSpec
    from hakase_smallmol.l3.study_engine import StudyDesignError, build_arms

    animal = AnimalSpec(
        species=req.animal.species,
        strain=req.animal.strain,
        sex=req.animal.sex,
        age=req.animal.age,
        body_weight_kg=req.animal.body_weight,
    )
    try:
        arms, warnings = build_arms(
            animal=animal,
            dose_groups=[g.model_dump() for g in req.dose_groups],
            route=req.route,
            frequency=req.frequency,
            duration_h=req.duration_h,
            infusion_duration_h=req.infusion_duration_h,
        )
    except StudyDesignError as e:
        return sanitize({"available": False, "source": "input-error", "reason": str(e)})
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-3 design failed: {type(e).__name__}: {e}"
        )
    # Conformance against the closest OECD/ICH guideline, computed *before* the
    # cohort simulation is paid for, so a non-conformant design can be fixed
    # while it is still cheap to change.
    from hakase_smallmol.l3.study_outcomes_engine import check_design_conformance

    active_groups = [g for g in req.dose_groups if float(g.dose_mg_per_kg or 0) > 0]
    conformance = check_design_conformance(
        duration_h=req.duration_h,
        cohort_size=req.cohort_size,
        n_active_groups=len(active_groups),
        has_control=any(float(g.dose_mg_per_kg or 0) <= 0 for g in req.dose_groups),
    )
    return sanitize(
        {
            "available": True,
            "arms": [
                {
                    "label": a.label,
                    "dose_mg_per_kg": a.dose_mg_per_kg,
                    "route": a.route,
                    "frequency": a.frequency,
                    "duration_h": a.duration_h,
                }
                for a in arms
            ],
            "warnings": warnings,
            "design_conformance": conformance,
        }
    )


@router.post("/predict/l3/run")
def api_l3_run(req: L3AnimalStudyRequest):
    """Run the complete virtual preclinical study (all engines) on the backend."""
    try:
        record = run_animal_study(
            analysis_id=req.analysis_id,
            smiles=req.smiles,
            animal=req.animal.model_dump(),
            dose_groups=[g.model_dump() for g in req.dose_groups],
            route=req.route,
            formulation=req.formulation,
            cohort_size=req.cohort_size,
            frequency=req.frequency,
            duration_h=req.duration_h,
            infusion_duration_h=req.infusion_duration_h,
            seed=req.seed,
            overrides=req.overrides,
            collect_public_evidence=req.collect_public_evidence,
            engine=req.engine,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-3 study failed: {type(e).__name__}: {e}"
        )
    return sanitize(record)


@router.get("/predict/l3/report/{study_id}")
def api_l3_report(study_id: str):
    """Return the persisted study record plus a downloadable Markdown report."""
    try:
        record = get_study(study_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return sanitize({"study": record, "markdown": report_markdown(record)})


# ── Layer 4 — First-in-Human Translation Engine ──
@router.post("/predict/l4/contract")
def api_l4_contract(req: L4ContractRequest):
    """Return the Animal-Cohort → first-in-human handoff + readiness contract."""
    from hakase_smallmol.l4.contract import l4_input_contract

    try:
        return sanitize(l4_input_contract(req.study_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-4 contract failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l4/run")
def api_l4_run(req: L4RunRequest):
    """Run the complete first-in-human projection over a completed animal study."""
    from hakase_smallmol.l4.pipeline import run_first_in_human

    try:
        study = get_study(req.study_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        record = run_first_in_human(
            study=study,
            route=req.route,
            formulation=req.formulation,
            frequency=req.frequency,
            duration_h=req.duration_h,
            cohort_size=req.cohort_size,
            body_weight_kg=req.body_weight_kg,
            risk_flags=req.risk_flags,
            escalation_scheme=req.escalation_scheme,
            escalation_levels=req.escalation_levels,
            escalation_fold=req.escalation_fold,
            max_dose_mg=req.max_dose_mg,
            dlt_probabilities=req.dlt_probabilities,
            sad_cohort_size=req.sad_cohort_size,
            mad_cohort_size=req.mad_cohort_size,
            mad_frequency=req.mad_frequency,
            collect_precedent=req.collect_precedent,
            indication=req.indication,
            regulatory_region=req.regulatory_region,
            ind_declared_complete=req.ind_declared_complete,
            ind_override_justification=req.ind_override_justification,
            assess_benefit_risk_context=req.assess_benefit_risk,
            overrides=req.overrides,
            seed=req.seed,
            engine=req.engine,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Layer-4 projection failed: {type(e).__name__}: {e}"
        )
    return sanitize(record)


@router.get("/predict/l4/report/{projection_id}")
def api_l4_report(projection_id: str):
    """Return the persisted projection plus a downloadable Markdown dossier."""
    from hakase_smallmol.l4.reporting_engine import report_markdown as l4_report_markdown
    from hakase_smallmol.l4.store import get_projection

    try:
        record = get_projection(projection_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return sanitize({"projection": record, "markdown": l4_report_markdown(record)})


# ── External public-database evidence ──
@router.post("/predict/external/panel")
def api_external_panel(req: ExternalPanelRequest):
    """Run one layer's public-database lookups server-side and shape the panel."""
    from hakase_smallmol.external.panel import collect_external_panel

    try:
        return sanitize(
            collect_external_panel(
                panel=req.panel,
                gene_symbol=req.gene_symbol,
                uniprot_id=req.uniprot_id,
                inchikey=req.inchikey,
                compound_name=req.compound_name,
                casrn=req.casrn,
                therapeutic_area=req.therapeutic_area,
                target_protein=req.target_protein,
                max_results=req.max_results,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"External evidence panel failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/l2/virtual-tissue/run-configured")
def api_run_configured_virtual_tissue(req: VirtualTissueConfiguredRequest):
    """Run all configured virtual-tissue models on the backend.

    Dataset availability is surfaced as returned state; this endpoint never
    invents a substitute result when Tabula Sapiens or DepMap are absent.
    """
    target_gene_symbol = req.target_gene_symbol
    uniprot_id = req.uniprot_id
    l1_ic50_nM = req.l1_ic50_nM
    if req.analysis_id:
        try:
            stored = get_l1_analysis(req.analysis_id)
        except (KeyError, ValueError):
            raise HTTPException(
                status_code=404, detail="The selected Layer 1 analysis could not be found."
            )
        requested = stored.get("requested") or {}
        resolution = requested.get("target_resolution") or {}
        evidence = requested.get("target_evidence") or {}
        target_gene_symbol = (
            resolution.get("gene_symbol") or evidence.get("gene_symbol") or target_gene_symbol
        )
        uniprot_id = (
            requested.get("uniprot_id")
            or resolution.get("uniprot_id")
            or evidence.get("uniprot_id")
            or uniprot_id
        )
        l1_ic50_nM = (
            evidence.get("value_nM")
            if isinstance(evidence.get("value_nM"), (int, float))
            else l1_ic50_nM
        )
    if not target_gene_symbol and uniprot_id:
        target_gene_symbol = _gene_symbol_for_uniprot(uniprot_id)
    if not target_gene_symbol:
        return {
            "status": "needs_target",
            "reason": "The resolved protein target did not return a gene symbol required by the available virtual-tissue models.",
            "models": [],
        }

    def presentation_for(model_id: str, result: dict[str, Any]) -> dict[str, Any]:
        """Compact, server-owned reading view for an actual virtual-tissue result."""
        prediction = result.get("prediction") or {}
        if model_id == "celltype_aggregation":
            top = (prediction.get("top_cell_types") or [{}])[0]
            return {
                "groups": [
                    {
                        "title": "Cell-type aggregation",
                        "fields": [
                            {
                                "label": "Target genes in domain",
                                "value": ", ".join(prediction.get("targets_in_domain") or []),
                            },
                            {
                                "label": "Highest-expression cell type",
                                "value": top.get("cell_type"),
                            },
                            {"label": "Tissue", "value": top.get("tissue")},
                            {"label": "Organ", "value": top.get("organ")},
                            {"label": "Expression score", "value": top.get("score")},
                        ],
                    }
                ]
            }
        if model_id == "patient_line":
            distribution = prediction.get("distribution") or {}
            top = (prediction.get("top_sensitive_lines") or [{}])[0]
            return {
                "groups": [
                    {
                        "title": "Patient-line projection",
                        "fields": [
                            {"label": "Target gene", "value": prediction.get("query_gene_symbol")},
                            {
                                "label": "Cell lines evaluated",
                                "value": prediction.get("n_cell_lines_total"),
                            },
                            {
                                "label": "Median predicted IC50 (µM)",
                                "value": distribution.get("median_uM"),
                            },
                            {"label": "Most-sensitive line", "value": top.get("cell_line_name")},
                            {
                                "label": "Most-sensitive prediction (µM)",
                                "value": top.get("predicted_IC50_uM"),
                            },
                        ],
                    }
                ]
            }
        return {"groups": []}

    models: list[dict[str, Any]] = []
    # Cell-type aggregation (Drug2cell / Tabula Sapiens tissue "behavioural
    # fingerprinting") is withheld from the product surface for now: the atlas
    # artifact is not provisioned, so the projection could only ever return an
    # "unavailable" card. The raw /predict/celltype-aggregation endpoint remains
    # available for direct callers, but it is no longer emitted here.
    if l1_ic50_nM is None:
        models.append(
            {
                "id": "patient_line",
                "name": "Patient-line projection",
                "status": "needs_input",
                "reason": "No Layer-1 potency input was provided by the backend target evidence.",
            }
        )
    else:
        try:
            patient = sanitize(
                predict_patient_line(
                    target_gene_symbol=target_gene_symbol,
                    l1_ic50_nM=l1_ic50_nM,
                    oncology=req.oncology,
                    top_n=req.top_n,
                )
            )
            available, reason = _availability(patient)
            models.append(
                {
                    "id": "patient_line",
                    "name": "Patient-line projection",
                    "status": "available" if available else "unavailable",
                    "result": patient,
                    "presentation": (
                        presentation_for("patient_line", patient) if available else {"groups": []}
                    ),
                    "reason": (
                        reason
                        if available
                        else "The required reference data are not available for this projection. No substitute result was generated."
                    ),
                }
            )
        except Exception:
            models.append(
                {
                    "id": "patient_line",
                    "name": "Patient-line projection",
                    "status": "unavailable",
                    "reason": "The configured projection could not be completed. No substitute result was generated.",
                }
            )
    return sanitize(
        {
            "status": "available",
            "target_gene_symbol": target_gene_symbol,
            "uniprot_id": uniprot_id,
            "models": models,
            "provenance": {
                "owner": "hakase_smallmol.router",
                "dispatch": "configured_virtual_tissue_models",
                "client_contract": "display-only",
            },
        }
    )


@router.post("/predict/known-drug")
def api_predict_known_drug(req: SmilesRequest):
    """Lookup-first: returns measured-data envelope when the SMILES matches a
    known drug (InChIKey exact, stereo-variant, or ECFP4 Tanimoto ≥ 0.85).
    Returns {"matched": false} on miss so the caller falls through to ML/heuristic.

    This is the single most important gate the L1 pipeline now has: it
    stops the multi-veto stack from false-positiving FDA-approved drugs
    by returning their real measured profile (which may still be a NO-GO,
    but tagged as KNOWN-LIABILITY-NO-GO so the UI can distinguish).
    """
    try:
        hit = lookup_drug(req.smiles)
        if hit is None:
            return {"matched": False, "smiles": req.smiles}
        return sanitize({"matched": True, "smiles": req.smiles, **hit})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drug lookup failed: {str(e)}")


@router.get("/predict/known-drug/status")
def api_known_drug_status():
    """Health endpoint for the lookup index — counts of indexed drugs."""
    return sanitize(lookup_status())


@router.post("/predict/dta")
def api_predict_dta(req: DTAReq):
    """BindingDB-scale drug-target affinity (PLAPT / DeepPurpose).

    Replaces the legacy 125-row GBM for novel-target prediction. Set the
    backend with HAKASE_DTA_BACKEND env var: "deeppurpose" (default, CPU-OK),
    "plapt" (best accuracy, 17 GB GPU), or "legacy" (back to the seed GBM).
    """
    try:
        return sanitize(predict_dta_affinity(req.smiles, req.uniprot_or_seq))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DTA prediction failed: {str(e)}")


@router.post("/predict/protein-ml")
def api_predict_protein_ml(req: ProteinRequest):
    """Layer-2 target druggability using the backend ESM-2 model."""
    try:
        return sanitize(predict_protein_ml(req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ProteinML prediction failed: {str(e)}")


@router.get("/predict/dta/status")
def api_dta_status():
    return sanitize(dta_status())


@router.post("/predict/admet-ml")
def api_predict_admet_ml(req: SmilesRequest):
    """ML-enhanced ADMET prediction via Hakase ADMET (Chemprop GNN ensemble)."""
    try:
        return sanitize(predict_admet_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ADMET-ML prediction failed: {str(e)}")


@router.post("/predict/admet-ml/batch")
def api_predict_admet_ml_batch(req: BatchSmilesRequest):
    """Library-scale Hakase ADMET: one model call over a list of SMILES."""
    try:
        return sanitize(predict_admet_ml_batch(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ADMET-ML batch failed: {str(e)}")


@router.post("/predict/cardiotox")
def api_predict_cardiotox(req: FpOrSmilesRequest):
    """Dedicated hERG prediction. Accepts a fingerprint (privacy-preserving) or SMILES."""
    try:
        return sanitize(predict_cardiotox(req.smiles, req.features))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CardioTox prediction failed: {str(e)}")


@router.post("/predict/dili-ml")
def api_predict_dili_ml(req: FpOrSmilesRequest):
    """Binary DILI-risk classifier. Accepts a fingerprint (privacy-preserving) or SMILES."""
    try:
        return sanitize(predict_dili_ml(req.smiles, req.features))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DILI-ML prediction failed: {str(e)}")


@router.post("/predict/safety-triage")
def api_predict_safety_triage(req: SmilesRequest):
    """One coherent small-molecule safety verdict across hERG, DILI, Ames and the
    Tox21 panel. Returns a conservative, auditable tier (CLEAR / MONITOR /
    HIGH_RISK / INDETERMINATE): a hard alert requires an in-domain, FPR-controlled
    conformal-veto trip; out-of-domain flags escalate to confirm, never a
    unilateral NO-GO. No fabricated composite score."""
    try:
        return sanitize(predict_safety_triage(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Safety triage failed: {str(e)}")


@router.post("/predict/tox21")
def api_predict_tox21(req: SmilesRequest):
    """Full 12-assay Tox21 panel (nuclear-receptor + stress-response) for one SMILES.

    Each assay returns an isotonic-calibrated active probability, an FPR-controlled
    conformal veto flag (α=0.05 on true inactives), applicability-domain status,
    and its own held-out test metrics. Never returns a fabricated value."""
    try:
        return sanitize(predict_tox21_panel(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tox21 panel prediction failed: {str(e)}")


@router.post("/predict/tox21/assay")
def api_predict_tox21_head(req: Tox21HeadRequest):
    """Single Tox21 assay prediction (see /predict/tox21 for the full panel)."""
    try:
        return sanitize(predict_tox21_head(req.smiles, req.assay))
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tox21 assay prediction failed: {str(e)}")


@router.post("/predict/pk-anchor")
def api_predict_pk_anchor(req: PkAnchorRequest):
    """Human-PK anchor from PK-DB observed clinical pharmacokinetics.

    When ``analysis_id`` is supplied the identifiers are resolved from the
    stored Layer-1 regulatory record rather than being sent by the browser, so
    the identity used for the lookup is the same one the analysis recorded.
    """
    name, inchikey, smiles = req.name, req.inchikey, req.smiles
    if req.analysis_id:
        try:
            stored = get_l1_analysis(req.analysis_id)
        except (KeyError, ValueError):
            raise HTTPException(
                status_code=404, detail="The selected Layer 1 analysis could not be found."
            )
        analysis = stored.get("analysis") or {}
        regulatory = analysis.get("regulatory_outlook") or {}
        inchikey = inchikey or (regulatory.get("inchikey") or None)
        name = name or (regulatory.get("identity_name") or None)
        smiles = smiles or (analysis.get("canonical_smiles") or None)
    if not any((name, inchikey, req.chembl_id, smiles)):
        raise HTTPException(
            status_code=400,
            detail="Provide an identifier or a completed Layer 1 analysis to anchor against.",
        )
    try:
        return sanitize(
            predict_pk_anchor(
                name=name,
                inchikey=inchikey,
                chembl_id=req.chembl_id,
                smiles=smiles,
                projected=req.projected,
                parameters=req.parameters,
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PK-anchor lookup failed: {str(e)}")


@router.post("/predict/invitro-panel")
def api_predict_invitro_panel(req: InVitroPanelRequest):
    """Complete ML in-vitro panel + GO/WATCH/NO-GO verdict for a valid SMILES."""
    try:
        return sanitize(predict_invitro_panel(req.smiles, req.uniprot_id, req.therapeutic_area))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"In-vitro panel failed: {str(e)}")


@router.post("/predict/explain")
def api_predict_explain(req: ExplainRequest):
    """Per-prediction SHAP attributions for a tree-based Layer-1 ML model."""
    try:
        return sanitize(shap_explain(req.model, req.smiles, top_k=req.top_k))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SHAP explain failed: {str(e)}")


@router.post("/predict/solubility-ml")
def api_predict_solubility_ml(req: SmilesRequest):
    """Dedicated aqueous-solubility (logS) prediction (independent second opinion)."""
    try:
        return sanitize(predict_solubility_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SolubilityML prediction failed: {str(e)}")


@router.post("/predict/binding-ml")
def api_predict_binding_ml(req: BindingMlRequest):
    """Dedicated DeepDTA-style binding-affinity prediction (independent second opinion).

    Pairs the existing ChEMBL-similarity binding path: that path looks up
    measured pIC50 from ≥70%-Tanimoto neighbors in ChEMBL (no learning,
    coverage gap when no neighbors exist). This path is a learned regressor
    on (Morgan FP + RDKit descriptors) ⊕ ESM-2 mean-pool embedding so it
    generalizes to unseen drug-target pairs.
    """
    try:
        return sanitize(predict_binding_ml(req.smiles, req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BindingML prediction failed: {str(e)}")


@router.post("/predict/celltype-aggregation")
def api_predict_celltype_aggregation(req: CellTypeAggregationRequest):
    """Layer 3 Stage 3 — Drug2cell-style scoring over Tabula Sapiens v2.

    Atlas Parquet must be provisioned via colab_notebooks/prepare_tabula_sapiens.ipynb
    before this endpoint can succeed. When the Parquet is missing the endpoint returns
    HTTP 503 with `source = "data-not-provisioned"` and a remediation hint — there is
    NO synthetic fallback (project-wide policy: NO fake data, NO silent fallbacks).
    """
    try:
        result = predict_celltype_aggregation(
            targets=[t.model_dump() for t in req.targets],
            top_n=req.top_n,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"CellTypeAggregation failed: {type(e).__name__}: {e}"
        )

    sanitized = sanitize(result)
    if sanitized.get("source") == "data-not-provisioned":
        # 503 lets callers distinguish "atlas not loaded yet" from a real prediction failure.
        raise HTTPException(status_code=503, detail=sanitized)
    if sanitized.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitized)
    return sanitized


@router.post("/predict/patient-line")
def api_predict_patient_line(req: PatientLineRequest):
    """Layer 3 Stage 4 — Patient-line projection across DepMap PRISM 24Q2 oncology panel.

    Snapshot Parquet must be provisioned via colab_notebooks/prepare_depmap_prism.ipynb
    before this endpoint can succeed. When the Parquet is missing the endpoint returns
    HTTP 503 with `source = "data-not-provisioned"` and a remediation hint — there is
    NO synthetic fallback (project-wide policy: NO fake data, NO silent fallbacks).

    Non-oncology callers (oncology=False) get HTTP 400 with `source = "out-of-domain"` —
    they should mark Stage 4 as not_applicable via the Manual Entry path instead.
    """
    try:
        result = predict_patient_line(
            target_gene_symbol=req.target_gene_symbol,
            l1_ic50_nM=req.l1_ic50_nM,
            oncology=req.oncology,
            indication_keyword=req.indication_keyword,
            alpha=req.alpha,
            top_n=req.top_n,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"PatientLine projection failed: {type(e).__name__}: {e}"
        )

    sanitized = sanitize(result)
    if sanitized.get("source") == "data-not-provisioned":
        raise HTTPException(status_code=503, detail=sanitized)
    if sanitized.get("source") == "out-of-domain":
        raise HTTPException(status_code=400, detail=sanitized)
    if sanitized.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitized)
    return sanitized


@router.post("/predict/pk/ivive")
def api_predict_pk_ivive(req: PkIviveRequest):
    """Quantitative human PK (CL, t½, hepatic first-pass, exposure) by IVIVE.

    Sources CLint / fu / VDss from the REAL Hakase ADMET predictor (or measured
    overrides). NO heuristic fallback: when a required real input is missing the
    response is `source = "insufficient-input"` (HTTP 422) with the `missing`
    list — never a value computed from a guess. Invalid SMILES → HTTP 400.
    """
    l1_inputs: dict[str, float] = {}
    smiles = req.smiles
    if req.analysis_id:
        try:
            stored = get_l1_analysis(req.analysis_id)
        except KeyError:
            raise HTTPException(
                status_code=404, detail="The selected Layer 1 analysis could not be found."
            )
        analysis = stored.get("analysis") or {}
        smiles = str(analysis.get("canonical_smiles") or "")
        l1_inputs = l1_ivive_inputs({"admet_endpoints": analysis.get("admet_ai_endpoints") or {}})
    if not smiles or not smiles.strip():
        raise HTTPException(
            status_code=400, detail="Provide a SMILES string or a completed Layer 1 analysis."
        )
    try:
        result = predict_pk_ivive(
            smiles,
            overrides=req.overrides,
            ml_inputs={**l1_inputs, **(req.ml_inputs or {})},
            body_weight_kg=req.body_weight_kg,
            blood_plasma_ratio=req.blood_plasma_ratio,
            dose_mg=req.dose_mg,
            species=req.species,
            strain=req.strain,
            montecarlo=req.montecarlo,
            mc_samples=req.mc_samples,
            mc_coverage=req.mc_coverage,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"IVIVE PK projection failed: {type(e).__name__}: {e}"
        )

    sanitized = sanitize(result)
    if sanitized.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitized)
    if sanitized.get("source") == "insufficient-input":
        # Honest "cannot compute on real data" — surfaced, not silently faked.
        raise HTTPException(status_code=422, detail=sanitized)
    return {
        **sanitized,
        "analysis_id": req.analysis_id,
        "presentation": _presentation_for_stage("6", sanitized),
    }


@router.post("/predict/properties")
def api_predict_properties(req: SmilesRequest):
    try:
        return sanitize(predict_properties(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Property prediction failed: {str(e)}")


@router.post("/predict/binding")
def api_predict_binding(req: BindingRequest):
    try:
        return sanitize(predict_binding(req.smiles, req.target_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Binding prediction failed: {str(e)}")


@router.post("/predict/reactive-metabolites")
def api_predict_reactive_metabolites(req: SmilesRequest):
    """Reactive metabolite structural alert scanner.

    Screens the molecule against 26 literature-curated SMARTS patterns for
    structural motifs known to form reactive, protein-binding metabolites —
    the primary mechanism of idiosyncratic drug-induced liver injury (iDILI).

    Returns alert list sorted by severity (critical > high > moderate),
    a composite rm_score (0–100), and mechanistic rationale + mitigation
    for each triggered alert.
    """
    try:
        return sanitize(predict_reactive_metabolites(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reactive metabolite scan failed: {str(e)}")


@router.post("/predict/bsep")
def api_predict_bsep(req: SmilesRequest):
    """BSEP inhibition and phospholipidosis risk predictor.

    BSEP (Bile Salt Export Pump, ABCB11) inhibition is the #2 transporter-
    mediated DILI mechanism; phospholipidosis is a cationic amphiphile (CAD)
    liability linked to lysosomal drug accumulation. Both are computed via
    physicochemical rule-based pharmacophore models.
    """
    try:
        return sanitize(predict_bsep(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"BSEP/phospholipidosis prediction failed: {str(e)}"
        )


@router.post("/predict/applicability-domain")
def api_predict_applicability_domain(req: SmilesRequest):
    """Applicability domain (AD) confidence scorer.

    Computes Tanimoto nearest-neighbour similarity between the query
    molecule and the DILI + CardioTox training sets. Returns an AD label
    (In-domain / Border-domain / Out-of-domain) and confidence level so
    users know when ML predictions are reliable vs. extrapolations.
    """
    try:
        return sanitize(predict_applicability_domain(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Applicability domain scoring failed: {str(e)}"
        )


@router.post("/predict/ames-ml")
def api_predict_ames_ml(req: SmilesRequest):
    """Ames mutagenicity (bacterial reverse mutation) probability.

    Independent second-opinion RF classifier on TDC AMES (Xu et al., 2012).
    Binary label = mutagenic to at least one Ames strain (± S9). Response
    includes applicability-domain scoring against the training set.
    """
    try:
        return sanitize(predict_ames_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ames-ML prediction failed: {str(e)}")


@router.post("/predict/bbb-ml")
def api_predict_bbb_ml(req: SmilesRequest):
    """Blood-brain barrier penetration classification (TDC Martins).

    The gateway has advertised this path since the BBB adapter was added, but
    the route itself was never declared, so every call 404'd. Declaring it here
    makes the advertised surface real.
    """
    from hakase_smallmol.admet.bbb_ml import predict_bbb_ml

    try:
        return sanitize(predict_bbb_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BBB-ML prediction failed: {str(e)}")


@router.post("/predict/cyp-inhibition-ml")
def api_predict_cyp_inhibition_ml(req: SmilesRequest):
    """Per-isoform CYP inhibition probability (TDC Veith).

    Same situation as `/predict/bbb-ml`: advertised by the gateway, never
    declared. It is the basis of a perpetrator drug-interaction call, so it is
    worth having reachable on its own rather than only inside a bundle.
    """
    from hakase_smallmol.admet.cyp_inhibition_ml import predict_cyp_inhibition_ml

    try:
        return sanitize(predict_cyp_inhibition_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CYP-inhibition-ML prediction failed: {str(e)}")


@router.post("/predict/vdss-ml")
def api_predict_vdss_ml(req: SmilesRequest):
    """Steady-state volume of distribution regression (L/kg).

    Independent second-opinion RF regressor on TDC VDss_Lombardo, fitted on a
    log10 target (raw VDss spans 0.01-700 L/kg). Returns both the log-space
    estimate and the back-transformed L/kg value; the back-transformed
    conformal interval is asymmetric by construction.
    """
    try:
        return sanitize(predict_vdss_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"VDss-ML prediction failed: {str(e)}")


@router.post("/predict/half-life-ml")
def api_predict_half_life_ml(req: SmilesRequest):
    """Terminal plasma half-life regression (hours).

    Independent second-opinion RF regressor on TDC Half_Life_Obach, fitted on a
    log10 target. Trained on only 667 compounds for a composite endpoint —
    expect wide intervals and read it as order-of-magnitude triage.
    """
    try:
        return sanitize(predict_half_life_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"HalfLife-ML prediction failed: {str(e)}")


@router.post("/predict/caco2-ml")
def api_predict_caco2_ml(req: SmilesRequest):
    """Caco-2 apparent permeability regression (continuous log Papp).

    Independent second-opinion RF regressor on TDC Caco2_Wang (Wang et al.,
    2016). Continuous log₁₀(Papp) in cm/s at the 10⁻⁶ scale. Response
    includes qualitative permeability band + applicability-domain scoring.
    """
    try:
        return sanitize(predict_caco2_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Caco2-ML prediction failed: {str(e)}")


@router.post("/predict/cytotoxicity")
def api_predict_cytotoxicity(req: SmilesRequest):
    """Cytotoxicity (cell viability / CC50) via a configured Ersilia Model Hub model.

    Returns a real model prediction when HAKASE_ERSILIA_MODE + a cytotoxicity
    eos model id are configured; otherwise returns source="unavailable" with
    value=None. It NEVER fabricates a CC50 — the L1 engine treats an unavailable
    result as missing data, not as a heuristic number.
    """
    try:
        return sanitize(predict_cytotoxicity(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cytotoxicity prediction failed: {str(e)}")


@router.post("/predict/ersilia")
def api_predict_ersilia(req: ErsiliaRequest):
    """Generic Ersilia Model Hub passthrough for a configured L1 endpoint.

    endpoint ∈ {cytotoxicity, hepatotoxicity, ames, herg, solubility, …}. Real
    model output when configured; honest source="unavailable" otherwise. Never
    fabricates.
    """
    try:
        return sanitize(predict_ersilia(req.endpoint, req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ersilia prediction failed: {str(e)}")


@router.get("/predict/ersilia/status")
def api_ersilia_status():
    """Header status pill — reports ADMETlab 3.0 reachability (the source
    behind the four L1 Permeability/Safety endpoints).

    Route name kept as `/predict/ersilia/status` for frontend backwards-
    compat; the payload now describes ADMETlab, not Ersilia. If we ever
    add more remote-API providers, extend this into a per-provider map.
    """
    ad = admetlab_status()
    return sanitize(
        {
            "mode": "admetlab" if ad["state"] == "live" else "unreachable",
            "engine": ad["engine"],
            "url": ad["url"],
            "endpoints": {
                ep: {"state": ad["state"], "reason": ad["reason"], "source_key": None}
                for ep in ad["endpoints_wired"]
            },
            "live_count": len(ad["endpoints_wired"]) if ad["state"] == "live" else 0,
            "configured_count": len(ad["endpoints_wired"]),
            "all_live": ad["state"] == "live",
            "reason": ad["reason"],
            "timeout_s": ad["timeout_s"],
        }
    )


@router.post("/predict/pgp-substrate")
def api_predict_pgp_substrate(req: SmilesRequest):
    """P-gp substrate probability via ADMETlab 3.0 (Pgp-sub head).
    Governs the efflux ratio + P-gp-substrate chip on the Permeability tab."""
    try:
        return sanitize(predict_pgp_substrate(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"P-gp substrate prediction failed: {str(e)}")


@router.post("/predict/bsep-inhibition")
def api_predict_bsep_inhibition(req: SmilesRequest):
    """Cholestatic-DILI surrogate via ADMETlab 3.0 (H-HT hepatotoxicity head —
    ADMETlab doesn't expose a distinct BSEP endpoint). Feeds the BSEP tile on
    the Safety tab and the cholestatic-DILI flag cascade."""
    try:
        return sanitize(predict_bsep_inhibition(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BSEP prediction failed: {str(e)}")


@router.post("/predict/pampa")
def api_predict_pampa(req: SmilesRequest):
    """PAMPA permeability via ADMETlab 3.0 (PAMPA head).
    Value returned is log Papp; the wrapper converts to ×10⁻⁶ cm/s so the
    UI can render it in the same unit as the Caco-2 column."""
    try:
        return sanitize(predict_pampa(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PAMPA prediction failed: {str(e)}")


@router.post("/predict/phospholipidosis")
def api_predict_phospholipidosis(req: SmilesRequest):
    """Drug-induced phospholipidosis via ADMETlab 3.0 (Phospholipidosis head).
    Feeds the PLD tile on the Safety tab."""
    try:
        return sanitize(predict_phospholipidosis(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Phospholipidosis prediction failed: {str(e)}")


@router.post("/predict/dock")
def api_dock_submit(req: DockingRequest):
    """Layer 2 Stage 2 — AutoDock Vina docking (in-app, physical scoring).

    Asynchronous job: returns job_id immediately. Poll
    GET /predict/dock/status/{job_id} for progress + result.

    Pipeline (subprocess-based, no conflicting Python deps):
      RDKit 2026 → 3D embed + UFF optimize
      → obabel → ligand PDBQT (Gasteiger charges, pH 7.4)
      → RCSB fetch + clean → receptor PDBQT
      → box selection (co-crystal centroid first, blind dock fallback)
      → AutoDock Vina v1.2.7

    Strict project policy: NO fake data, NO silent fallbacks. Box method is
    always reported (`co_crystal` | `blind_dock`) so the reviewer can never
    confuse a blind dock for a pocket-targeted one.
    """
    if not req.smiles or not req.smiles.strip():
        raise HTTPException(status_code=400, detail="smiles is required")
    if not req.pdb_id or not req.pdb_id.strip():
        raise HTTPException(status_code=400, detail="pdb_id is required")
    if not (1 <= req.exhaustiveness <= 32):
        raise HTTPException(status_code=400, detail="exhaustiveness must be 1..32")
    if not (1 <= req.num_modes <= 20):
        raise HTTPException(status_code=400, detail="num_modes must be 1..20")
    job_id = docking_vina.submit_dock(
        smiles=req.smiles.strip(),
        pdb_id=req.pdb_id.strip(),
        exhaustiveness=req.exhaustiveness,
        num_modes=req.num_modes,
    )
    return {"job_id": job_id, "status": "queued"}


@router.get("/predict/dock/config")
def api_dock_config():
    """Preflight the optional local AutoDock Vina job for the UI."""
    return sanitize(docking_vina.tooling_status())


@router.get("/predict/dock/status/{job_id}")
def api_dock_status(job_id: str):
    job = docking_vina.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    payload = sanitize(job)
    # Presentation labels and values are emitted by the backend with the job;
    # the React client only lays them out after an actual Vina completion.
    result = payload.get("result") if isinstance(payload, dict) else None
    if payload.get("status") == "done" and isinstance(result, dict):
        poses = result.get("poses") if isinstance(result.get("poses"), list) else []
        best_pose = poses[0] if poses and isinstance(poses[0], dict) else {}
        payload["presentation"] = {
            "title": "Molecular docking",
            "groups": [
                {
                    "title": "Best scored pose",
                    "fields": [
                        {"label": "Receptor PDB", "value": result.get("pdb_id")},
                        {
                            "label": "Binding score (kcal/mol)",
                            "value": best_pose.get("affinity_kcal_mol"),
                        },
                        {"label": "Pose mode", "value": best_pose.get("mode")},
                        {"label": "Box method", "value": (result.get("box") or {}).get("method")},
                        {"label": "Runtime (s)", "value": result.get("runtime_seconds")},
                    ],
                }
            ],
        }
    return payload


@router.get("/predict/fep/config")
def api_fep_config():
    """Report whether the RunPod backend for Stage 5 FEP is configured.

    Returned to the UI so the Run button can be disabled with an honest
    message when credentials are missing — instead of letting the user
    click and hit a 503 mid-submission.
    """
    ok, reason = fep_runpod.runpod_configured()
    return {
        "configured": ok,
        "reason": (
            None
            if ok
            else "Required refinement service credentials are unavailable on this server."
        ),
    }


def _fep_presentation(result: dict[str, Any]) -> dict[str, Any]:
    """Server-owned display contract for an actual completed FEP job.

    The lambda-window series is forwarded verbatim from the worker.  The
    browser is only responsible for drawing that returned series; it does not
    derive free-energy values or uncertainty bounds.
    """
    windows = result.get("windows") if isinstance(result.get("windows"), list) else []
    series = [
        {
            "lambda": item.get("lambda"),
            "dG_kcal_mol": item.get("dG_kcal_mol"),
            "stderr_kcal_mol": item.get("stderr_kcal_mol"),
        }
        for item in windows
        if isinstance(item, dict)
        and all(
            isinstance(item.get(key), (int, float))
            for key in ("lambda", "dG_kcal_mol", "stderr_kcal_mol")
        )
    ]
    return {
        "groups": [
            {
                "title": "Relative binding free energy",
                "fields": [
                    {"label": "ΔΔG (B − A, kcal/mol)", "value": result.get("ddg_kcal_mol")},
                    {
                        "label": "ΔΔG uncertainty (1σ, kcal/mol)",
                        "value": result.get("ddg_uncertainty_kcalmol"),
                    },
                    {"label": "ΔΔG (kT at 298 K)", "value": result.get("ddg_kT")},
                ],
            },
            {
                "title": "FEP run metadata",
                "fields": [
                    {"label": "Lambda windows", "value": len(series)},
                    {"label": "Wall-clock time (min)", "value": result.get("wallclock_minutes")},
                    {"label": "GPU time (min)", "value": result.get("gpu_minutes")},
                    {"label": "Engine", "value": result.get("engine_version")},
                    {"label": "Force field", "value": result.get("force_field")},
                    {
                        "label": "Warnings",
                        "value": "; ".join(str(w) for w in result.get("warnings", []) if w),
                    },
                ],
            },
        ],
        "visualization": {
            "kind": "fep_lambda_windows",
            "title": "Per-window free-energy estimates",
            "x_label": "λ",
            "y_label": "ΔG (kcal/mol)",
            "series": series,
        },
    }


@router.post("/predict/fep")
def api_fep_submit(req: FepRequest):
    """Layer 2 Stage 5 — relative-binding free-energy refinement (TIES on RunPod).

    Asynchronous job: returns job_id immediately. Poll
    GET /predict/fep/status/{job_id} for progress + result.

    Pipeline (delegated to a user-provisioned RunPod Serverless worker):
      OpenMM + OpenFF Sage + TIES → relative-binding FEP, ΔΔG (B - A)
      Typical wall time ~24 GPU-h on A100 per ligand pair.

    Strict project policy: NO fabricated ΔΔG. If RunPod credentials are
    unset, this endpoint returns 503 with the exact missing-secret name
    so the operator can fix it; the UI surfaces the reason verbatim.
    """
    if not req.ligand_a_smiles or not req.ligand_a_smiles.strip():
        raise HTTPException(status_code=400, detail="ligand_a_smiles is required")
    if not req.ligand_b_smiles or not req.ligand_b_smiles.strip():
        raise HTTPException(status_code=400, detail="ligand_b_smiles is required")
    if not req.pdb_id or not req.pdb_id.strip():
        raise HTTPException(status_code=400, detail="pdb_id is required")
    if not (4 <= req.n_lambda_windows <= 32):
        raise HTTPException(status_code=400, detail="n_lambda_windows must be 4..32")
    if not (1 <= req.n_replicas <= 5):
        raise HTTPException(status_code=400, detail="n_replicas must be 1..5")
    if not (0.1 <= req.ns_per_window <= 50.0):
        raise HTTPException(status_code=400, detail="ns_per_window must be 0.1..50.0")

    ok, reason = fep_runpod.runpod_configured()
    if not ok:
        # 503 (Service Unavailable) — the endpoint exists but its GPU backend
        # is intentionally unconfigured. The UI shows `reason` verbatim.
        raise HTTPException(
            status_code=503,
            detail="Required refinement service credentials are unavailable on this server.",
        )

    try:
        job_id = fep_runpod.submit_fep(
            ligand_a_smiles=req.ligand_a_smiles.strip(),
            ligand_b_smiles=req.ligand_b_smiles.strip(),
            pdb_id=req.pdb_id.strip(),
            n_lambda_windows=req.n_lambda_windows,
            n_replicas=req.n_replicas,
            ns_per_window=req.ns_per_window,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"job_id": job_id, "status": "queued"}


@router.get("/predict/fep/status/{job_id}")
def api_fep_status(job_id: str):
    job = fep_runpod.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    payload = sanitize(job)
    result = payload.get("result") if isinstance(payload, dict) else None
    if payload.get("status") == "done" and isinstance(result, dict):
        payload["presentation"] = _fep_presentation(result)
    return payload


@router.post("/predict/full-pipeline")
def api_full_pipeline(req: FullPipelineRequest):
    try:
        admet_result = predict_admet(req.smiles)
        properties_result = predict_properties(req.smiles)
        binding_result = predict_binding(req.smiles, req.target_id)

        protein_result = None
        if req.uniprot_id:
            protein_result = predict_protein(req.uniprot_id)

        return sanitize(
            {
                "smiles": req.smiles,
                "admet": admet_result,
                "molecular_properties": properties_result,
                "drug_target_interaction": binding_result,
                "protein_analysis": protein_result,
                "pipeline_info": {
                    "engine": "HakaseAI Full AI Pipeline v1.0",
                    "modules_run": [
                        "ADMET Profiling",
                        "Molecular Properties",
                        "Drug-Target Interaction",
                    ]
                    + (["Protein Analysis"] if req.uniprot_id else []),
                },
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")
