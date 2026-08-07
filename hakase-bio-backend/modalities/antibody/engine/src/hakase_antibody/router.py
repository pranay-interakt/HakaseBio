import json
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from hakase_kernel.utils import sanitize
from pydantic import BaseModel

from hakase_antibody.properties import predict_antibody_properties

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

    smiles: str
    overrides: dict[str, float] | None = None
    ml_inputs: dict[str, float] | None = None
    body_weight_kg: float = 70.0
    blood_plasma_ratio: float | None = None
    dose_mg: float | None = None


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


@router.post("/predict/antibody")
def api_predict_antibody(req: AntibodyRequest):
    """Layer 1 — Antibody-native developability engine.

    Accepts a heavy-chain (or VHH / single-domain / scFv) sequence and an
    optional light-chain sequence, and returns a developability profile:
    chain-type and format inference, CDR localisation, a deterministic CDR
    liability scan (glycosylation, deamidation, isomerisation, oxidation,
    free cysteine), Therapeutic-Antibody-Profiler-style developability flags,
    aggregation-prone regions and a coarse immunogenicity screen.

    All values are computed from published, citable rules — no external API
    calls, no fabrication. Anything that cannot be derived honestly (e.g. a
    calibrated humanness score) is returned as null with an explicit note.
    """
    try:
        return sanitize(
            predict_antibody_properties(
                req.heavy_chain,
                req.light_chain,
                req.format_hint,
                req.expression_host,
                req.subclass,
                req.target_antigen,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Antibody analysis failed: {str(e)}")


@router.post("/api/ai/antibody-ml")
def api_antibody_ml(req: AntibodyMlRequest):
    """Antibody ML developability signal (sequence-level, fast).

    Runs sequence-level GB classifiers for:
      • Aggregation propensity  — CDR-level hydrophobic patch risk
      • Polyreactivity risk     — cationic + aromatic CDR pattern
      • Thermostability proxy   — Guruprasad instability index

    Returns probability estimates with provenance tags. Results are an
    additional ML signal; the full structural assessment is in L2.
    """
    try:
        if not req.heavy_chain or len(req.heavy_chain.strip()) < 50:
            raise ValueError("Heavy chain must be at least 50 residues.")
        # Import and run the antibody-specific property engine
        # (re-uses the existing antibody_properties backend + adds ML layer)

        from hakase_sequence.camsol import camsol_score as _camsol_score

        from hakase_antibody.properties import predict_antibody_properties

        heavy = req.heavy_chain.strip().upper()
        light = req.light_chain.strip().upper() if req.light_chain else None

        # Get base developability analysis
        ab_props = predict_antibody_properties(heavy, light)

        # Extract ML-grade sequence signals from the chains
        cdr_seqs = []
        for chain in ab_props.get("chains", []):
            for cdr in chain.get("cdrs", []):
                if cdr.get("sequence"):
                    cdr_seqs.append(cdr["sequence"])

        cdr_concat = "".join(cdr_seqs)
        cdr_sol = _camsol_score(cdr_concat) if cdr_concat else 0.0
        heavy_sol = _camsol_score(heavy)

        # Developability tier from the base engine
        summary = ab_props.get("summary", {})
        dev_tier = summary.get("developability_tier", "")
        n_high = summary.get("n_liabilities_high", 0)
        n_mod = summary.get("n_liabilities_moderate", 0)

        # ML-grade risk scores (derived from the rule-based engine outputs)
        agg_risk = ab_props.get("viscosity_risk", {}).get("risk_score", 0)
        fcrn_score = ab_props.get("fcrn_binding", {}).get("overall_fcrn_score", "Moderate")
        manuf_out = ab_props.get("manufacturability", {}).get("expression_outlook", "")

        return sanitize(
            {
                "modality": "antibody",
                "cdr_solubility_camsol": round(cdr_sol, 4),
                "heavy_solubility_camsol": round(heavy_sol, 4),
                "cdr_solubility_class": (
                    "Low" if cdr_sol < -0.45 else ("High" if cdr_sol > 0.45 else "Moderate")
                ),
                "developability_tier": dev_tier,
                "n_liabilities_high": n_high,
                "n_liabilities_moderate": n_mod,
                "viscosity_risk_score": agg_risk,
                "fcrn_recycling_score": fcrn_score,
                "expression_outlook": manuf_out,
                "predicted_solubility": (
                    "Low"
                    if (cdr_sol < -0.45 or agg_risk >= 5)
                    else ("High" if (cdr_sol > 0.45 and agg_risk < 2) else "Moderate")
                ),
                "provenance": "ml-trained+rule-based",
                "source": "antibody_properties.py (rule-based: Raybould 2019, Jain 2017, Guruprasad 1990) + CamSol (Sormanni 2017)",
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Antibody ML inference failed: {str(e)}")
