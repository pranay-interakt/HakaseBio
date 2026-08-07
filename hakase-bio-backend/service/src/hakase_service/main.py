"""FastAPI composition root.

Assembles the application from platform services and modality routers. This
module owns *no* science: every prediction endpoint lives in the package that
owns it, and is mounted here.

Modality routers are mounted defensively — a modality whose optional heavy
dependencies are missing logs and is skipped, rather than taking down the whole
service. That behaviour was already proven by the peptide V3 vertical and is now
applied uniformly.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from hakase_kernel.utils import sanitize
from pydantic import BaseModel, Field

logger = logging.getLogger("hakase_service")

# Quieten training-framework chatter that would otherwise flood service logs.
for _noisy in ("lightning", "lightning.pytorch", "lightning.pytorch.utilities.rank_zero"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
os.environ.setdefault("TQDM_DISABLE", "1")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if os.environ.get("HAKASE_SKIP_PREWARM") == "1":
        logger.info("Prewarm skipped (HAKASE_SKIP_PREWARM=1)")
    else:
        _prewarm_in_background()
    yield


app = FastAPI(
    title="HakaseAI — AI Drug Discovery Service",
    description=(
        "Python AI prediction service: ADMET, molecular properties, "
        "drug-target interaction, peptide, antibody and protein analysis."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Modality + platform router mounts ────────────────────────────────────────
# (import path, attribute, human label). Each is mounted independently so one
# broken optional dependency cannot remove the rest of the API surface.
_MOUNTS: list[tuple[str, str, str]] = [
    ("hakase_structure.router", "router", "structure (protein / co-folding)"),
    ("hakase_smallmol.router", "router", "small-molecule"),
    ("hakase_antibody.router", "router", "antibody"),
]


def _mount_all() -> None:
    import importlib

    for module_path, attr, label in _MOUNTS:
        try:
            mod = importlib.import_module(module_path)
            app.include_router(getattr(mod, attr))
            logger.info("Mounted %s router", label)
        except Exception as exc:  # noqa: BLE001 — one modality must not sink the service
            logger.exception("Failed to mount %s router: %s", label, exc)

    # Peptide V3 exposes a router factory rather than a module-level router.
    try:
        from hakase_peptide.api import get_router as _get_peptide_v3_router

        app.include_router(_get_peptide_v3_router())
        logger.info("Mounted peptide V3 router at /v3/peptide")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to mount peptide V3 router: %s", exc)


_mount_all()


# ── Warmup ───────────────────────────────────────────────────────────────────
def _prewarm_in_background() -> None:
    """Background-prewarm ML models so the first request doesn't pay cold-load.

    Warmups stay off the startup path, so /health never depends on model
    readiness.  The sklearn-backed models deliberately warm in one worker: the
    import graph inside sklearn is not safe to initialise concurrently on this
    deployment's Python build (it can raise a ``_DeadlockError`` while loading
    ensemble submodules).  Independent non-sklearn workloads still warm in
    parallel.
    """
    import threading

    def _spawn(name: str, fn) -> None:
        threading.Thread(target=fn, name=f"{name}-prewarm", daemon=True).start()

    try:
        from hakase_smallmol.admet.admet_ml import warmup as admet_ml_warmup
        from hakase_smallmol.admet.caco2_ml import warmup as caco2_ml_warmup
        from hakase_smallmol.admet.half_life_ml import warmup as half_life_ml_warmup
        from hakase_smallmol.admet.solubility_ml import warmup as solubility_ml_warmup
        from hakase_smallmol.admet.vdss_ml import warmup as vdss_ml_warmup
        from hakase_smallmol.binding.binding_ml import warmup as binding_ml_warmup
        from hakase_smallmol.cardiotox.cardiotox import warmup as cardiotox_warmup
        from hakase_smallmol.dili.dili_ml import warmup as dili_ml_warmup
        from hakase_smallmol.ersilia_hub import warmup as ersilia_warmup
        from hakase_smallmol.pkdb_anchor import warmup as pkdb_anchor_warmup
        from hakase_smallmol.safety.ames_ml import warmup as ames_ml_warmup
        from hakase_smallmol.safety.safety_triage import warmup as safety_triage_warmup
        from hakase_smallmol.safety.tox21_ml import warmup as tox21_ml_warmup

        def _warm_sklearn_stack() -> None:
            for name, warm in [
                ("cardiotox", cardiotox_warmup),
                ("solubility-ml", solubility_ml_warmup),
                ("binding-ml", binding_ml_warmup),
                ("dili-ml", dili_ml_warmup),
                ("ames-ml", ames_ml_warmup),
                ("caco2-ml", caco2_ml_warmup),
                ("tox21-ml", tox21_ml_warmup),
                ("vdss-ml", vdss_ml_warmup),
                ("half-life-ml", half_life_ml_warmup),
                ("safety-triage-ad", safety_triage_warmup),
            ]:
                try:
                    warm()
                except Exception:  # noqa: BLE001 -- one optional model must not block the rest
                    logger.exception("%s prewarm failed", name)

        for nm, fn in [
            ("admet-ml", admet_ml_warmup),
            ("smallmol-sklearn-stack", _warm_sklearn_stack),
            ("pkdb-anchor", pkdb_anchor_warmup),
            ("ersilia", ersilia_warmup),
        ]:
            _spawn(nm, fn)
    except Exception:  # noqa: BLE001
        logger.exception("small-molecule prewarm setup failed")

    try:
        from hakase_kernel.translational.celltype_aggregation import (
            warmup as celltype_aggregation_warmup,
        )
        from hakase_kernel.translational.patient_line import warmup as patient_line_warmup

        _spawn("celltype-aggregation", celltype_aggregation_warmup)
        _spawn("patient-line", patient_line_warmup)
    except Exception:  # noqa: BLE001
        logger.exception("kernel prewarm setup failed")

    try:
        from hakase_structure.protein_ml import warmup as protein_ml_warmup

        _spawn("protein-ml", protein_ml_warmup)
    except Exception:  # noqa: BLE001
        logger.exception("structure prewarm setup failed")

    try:
        from hakase_peptide.properties.esm_ml import warmup as peptide_esm_ml_warmup

        _spawn("peptide-esm-ml", peptide_esm_ml_warmup)
    except Exception:  # noqa: BLE001
        logger.exception("peptide prewarm setup failed")

    # Live safety-threshold calibration — fits hERG/DILI/Ames operating points in
    # memory from a live ChEMBL reference set. Best-effort and deliberately
    # delayed so the safety models finish warming first; until it lands the
    # verdict uses documented literature defaults (honestly labelled).
    def _live_calibration_delayed() -> None:
        import time

        time.sleep(90)
        try:
            from hakase_smallmol import live_calibration

            live_calibration.fit_all()
        except Exception:  # noqa: BLE001 — calibration is best-effort
            pass

    _spawn("live-calibration", _live_calibration_delayed)


# ── Platform-level endpoints ─────────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "HakaseAI AI Service", "version": "1.0.0"}


@app.get("/registry/open-source")
def api_open_source_registry(modality: str | None = None):
    """Return the open-source data / tools / corpora registry.

    Pass ?modality=peptide_l1, antibody_l1, or biologic_l2 to filter. Lists the
    public datasets, scales, algorithms and ML models the engines lean on,
    alongside roadmap items that are flagged but NOT yet wired.
    """
    from hakase_kernel.runtime.registry import get_open_source_registry

    try:
        return sanitize(get_open_source_registry(modality))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Registry read failed: {e}")


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


@app.post("/predict/animal-cohort")
async def api_predict_animal_cohort(req: AnimalCohortRequest):
    """Physiologically-based pharmacokinetics (PBPK) animal cohort popPK simulation."""
    from hakase_smallmol.pk_ivive.animal_sim import run_animal_cohort_simulation

    try:
        result = await run_animal_cohort_simulation(
            smiles=req.smiles,
            species_id=req.species_id,
            study_type_id=req.study_type_id,
            route_of_admin=req.route_of_admin,
            cohort_size=req.cohort_size,
            formulation=req.formulation,
            starting_dose_mg_kg=req.starting_dose_mg_kg,
            ml_admet=req.ml_admet,
            measured_noael_override=req.measured_noael_override,
        )
        return sanitize(result)
    except Exception as e:  # noqa: BLE001
        logger.exception("Animal cohort simulation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Animal cohort simulation failed: {type(e).__name__}: {e}",
        )


@app.get("/models/status")
def api_models_status() -> dict[str, Any]:
    """Report which ML models are loaded and ready."""
    from hakase_kernel.translational.celltype_aggregation import (
        is_ready as celltype_aggregation_status,
    )
    from hakase_kernel.translational.patient_line import is_ready as patient_line_status
    from hakase_smallmol.admet.admet_ml import is_ready as admet_ml_status
    from hakase_smallmol.admet.half_life_ml import is_ready as half_life_ml_status
    from hakase_smallmol.admet.solubility_ml import is_ready as solubility_ml_status
    from hakase_smallmol.admet.vdss_ml import is_ready as vdss_ml_status
    from hakase_smallmol.binding.binding_ml import is_ready as binding_ml_status
    from hakase_smallmol.cardiotox.cardiotox import is_ready as cardiotox_status
    from hakase_smallmol.dili.dili_ml import is_ready as dili_ml_status
    from hakase_smallmol.pk_ivive.pk_ivive import is_ready as pk_ivive_status
    from hakase_smallmol.pkdb_anchor import is_ready as pkdb_anchor_status
    from hakase_smallmol.safety.ames_ml import is_ready as ames_ml_status
    from hakase_smallmol.safety.invitro_panel import is_ready as invitro_panel_status
    from hakase_smallmol.safety.tox21_ml import is_ready as tox21_ml_status
    from hakase_structure.protein_ml import is_ready as protein_ml_status

    return {
        "admet_ml": admet_ml_status(),
        "cardiotox": cardiotox_status(),
        "dili_ml": dili_ml_status(),
        "protein_ml": protein_ml_status(),
        "solubility_ml": solubility_ml_status(),
        "binding_ml": binding_ml_status(),
        "celltype_aggregation": celltype_aggregation_status(),
        "patient_line": patient_line_status(),
        "pk_ivive": pk_ivive_status(),
        "pkdb_anchor": pkdb_anchor_status(),
        "invitro_panel": invitro_panel_status(),
        "ames_ml": ames_ml_status(),
        "tox21_ml": tox21_ml_status(),
        "vdss_ml": vdss_ml_status(),
        "half_life_ml": half_life_ml_status(),
    }


@app.post("/models/warmup")
def api_models_warmup() -> dict[str, Any]:
    """Force-load ML models (use after deploy or first session)."""
    from hakase_kernel.translational.celltype_aggregation import (
        warmup as celltype_aggregation_warmup,
    )
    from hakase_kernel.translational.patient_line import warmup as patient_line_warmup
    from hakase_smallmol.admet.admet_ml import warmup as admet_ml_warmup
    from hakase_smallmol.admet.caco2_ml import warmup as caco2_ml_warmup
    from hakase_smallmol.admet.half_life_ml import warmup as half_life_ml_warmup
    from hakase_smallmol.admet.solubility_ml import warmup as solubility_ml_warmup
    from hakase_smallmol.admet.vdss_ml import warmup as vdss_ml_warmup
    from hakase_smallmol.binding.binding_ml import warmup as binding_ml_warmup
    from hakase_smallmol.cardiotox.cardiotox import warmup as cardiotox_warmup
    from hakase_smallmol.dili.dili_ml import warmup as dili_ml_warmup
    from hakase_smallmol.pkdb_anchor import warmup as pkdb_anchor_warmup
    from hakase_smallmol.safety.ames_ml import warmup as ames_ml_warmup
    from hakase_smallmol.safety.tox21_ml import warmup as tox21_ml_warmup
    from hakase_structure.protein_ml import warmup as protein_ml_warmup

    return {
        "admet_ml": admet_ml_warmup(),
        "cardiotox": cardiotox_warmup(),
        "dili_ml": dili_ml_warmup(),
        "protein_ml": protein_ml_warmup(),
        "solubility_ml": solubility_ml_warmup(),
        "binding_ml": binding_ml_warmup(),
        "celltype_aggregation": celltype_aggregation_warmup(),
        "patient_line": patient_line_warmup(),
        "pkdb_anchor": pkdb_anchor_warmup(),
        "ames_ml": ames_ml_warmup(),
        "caco2_ml": caco2_ml_warmup(),
        "tox21_ml": tox21_ml_warmup(),
        "vdss_ml": vdss_ml_warmup(),
        "half_life_ml": half_life_ml_warmup(),
    }


class AnimalContext(BaseModel):
    species: str
    strain: str | None = None
    sex: str | None = None
    age: str | None = None
    body_weight: float | None = Field(default=None, gt=0)


class StudyConfig(BaseModel):
    route: str
    dose: float = Field(gt=0)
    frequency: str | None = None
    duration: float | None = Field(default=None, gt=0)
    infusion_duration: float | None = Field(default=None, gt=0)


class PbpkExposureRequest(BaseModel):
    smiles: str | None = None
    analysis_id: str | None = None
    animal: AnimalContext
    study: StudyConfig
    formulation: str = Field(min_length=1)
    cohort_size: int = Field(ge=2, le=1_000)
    overrides: dict[str, Any] | None = None


def _interval_text(summary: Any) -> str | None:
    """Format a returned cohort summary without inventing an uncertainty value."""
    if not isinstance(summary, dict) or summary.get("median") is None:
        return None

    def _display(value: Any) -> str:
        """Four significant figures keep server-returned scientific values readable.

        This is presentation-only: the cohort result retains the full-precision
        floats in its structured endpoint payload.
        """
        return f"{float(value):.4g}" if isinstance(value, (int, float)) else str(value)

    median = _display(summary["median"])
    low, high = summary.get("p05"), summary.get("p95")
    if low is None or high is None:
        return median
    return f"{median} (90% interval {_display(low)}–{_display(high)})"


def _pbpk_presentation(
    cohort: dict[str, Any],
    disposition: dict[str, Any],
    ivive: dict[str, Any],
    applicability: dict[str, Any],
    formulation: dict[str, Any],
    study: StudyConfig,
) -> dict[str, Any]:
    """Create the display contract for real exposure results on the server."""
    plasma = (cohort.get("endpoints") or {}).get("plasma") or {}
    inputs = ivive.get("inputs") or {}
    confidence = ivive.get("confidence") or {}
    domain = ivive.get("metabolic_clearance_domain") or {}
    return {
        "groups": [
            {
                "title": "Plasma exposure summary",
                "fields": [
                    {
                        "label": "Peak plasma concentration (mg/L)",
                        "value": _interval_text(plasma.get("c_max")),
                    },
                    {
                        "label": "Plasma exposure (mg·min/L)",
                        "value": _interval_text(plasma.get("auc")),
                    },
                    {"label": "Total clearance (L/min)", "value": _interval_text(plasma.get("cl"))},
                    {
                        "label": "Distribution volume (L/kg)",
                        "value": _interval_text(plasma.get("vss")),
                    },
                    {"label": "Half-life (min)", "value": _interval_text(plasma.get("t_half"))},
                ],
            },
            {
                "title": "Disposition evidence",
                "fields": [
                    {
                        "label": "Hepatic intrinsic clearance",
                        "value": (inputs.get("clint_hep_ul_min_1e6") or {}).get("value"),
                    },
                    {
                        "label": "Intrinsic-clearance provenance",
                        "value": (inputs.get("clint_hep_ul_min_1e6") or {}).get("provenance"),
                    },
                    {
                        "label": "Unbound plasma fraction",
                        "value": (inputs.get("fu_plasma") or {}).get("value"),
                    },
                    {
                        "label": "Unbound-fraction provenance",
                        "value": (inputs.get("fu_plasma") or {}).get("provenance"),
                    },
                    {
                        "label": "Distribution-volume provenance",
                        "value": (disposition.get("vdss") or {}).get("provenance"),
                    },
                ],
            },
            {
                "title": "Study assumptions",
                "fields": [
                    {"label": "Administration route", "value": study.route},
                    {"label": "Study dose (mg)", "value": study.dose},
                    {"label": "Simulation window (min)", "value": study.duration},
                    {"label": "Formulation", "value": formulation.get("formulation_type")},
                    {
                        "label": "Route-adjusted absorption fraction",
                        "value": formulation.get("F_abs_formulated"),
                    },
                    {
                        "label": "Absorption limitation",
                        "value": "The route-adjusted absorption fraction is a screening assumption when compound-specific absorption evidence is not supplied.",
                    },
                ],
            },
            {
                "title": "Applicability and limitations",
                "fields": [
                    {"label": "Chemical applicability", "value": applicability.get("verdict")},
                    {"label": "Metabolic-clearance applicability", "value": domain.get("verdict")},
                    {"label": "Projection confidence", "value": confidence.get("level")},
                    {"label": "Limitation", "value": confidence.get("rationale")},
                    {"label": "Applicability note", "value": applicability.get("rationale")},
                ],
            },
        ]
    }


@app.get("/predict/pbpk/species")
@app.get("/api/ai/pbpk/species", include_in_schema=False)
def api_pbpk_species():
    """Return the calibrated species/strain rows the PBPK layer actually has.

    The workspace previously hard-coded its species list and reference body
    weights, which silently drifted from the kernel physiology store. Serving
    the catalogue keeps one source of truth: a species is offered only when a
    calibrated row exists for it.
    """
    from hakase_kernel.pbpk.physiology.store import DEFAULT_STRAIN, SPECIES_PHYSIOLOGY

    by_species: dict[str, dict] = {}
    for (species, strain), row in SPECIES_PHYSIOLOGY.items():
        entry = by_species.setdefault(
            species,
            {
                "id": species,
                "label": species.replace("_", " ").title(),
                "default_strain": DEFAULT_STRAIN.get(species, strain),
                "strains": [],
            },
        )
        entry["strains"].append(
            {
                "id": strain,
                "label": strain.replace("_", " ").title(),
                "reference_body_weight_kg": row.reference_body_weight_kg,
            }
        )

    for entry in by_species.values():
        default = next(
            (item for item in entry["strains"] if item["id"] == entry["default_strain"]),
            entry["strains"][0],
        )
        entry["reference_body_weight_kg"] = default["reference_body_weight_kg"]
        entry["strains"].sort(key=lambda item: item["id"])

    return sanitize(
        {
            "schema_version": "hakase.pbpk.species-catalogue.v1",
            "owner": "hakase_kernel.pbpk.physiology.store",
            "species": sorted(by_species.values(), key=lambda item: item["id"]),
            "limitations": (
                "Only species with a calibrated physiology row are listed. A species "
                "absent from this list has no reference organ set and is not offered "
                "rather than being extrapolated silently."
            ),
        }
    )


@app.post("/predict/pbpk/exposure")
@app.post("/api/ai/pbpk/exposure", include_in_schema=False)
def api_predict_pbpk_exposure(req: PbpkExposureRequest):
    """PBPK Exposure popPK simulation."""
    from hakase_kernel.uncertainty.applicability_domain import predict_applicability_domain

    smiles = req.smiles
    l1_inputs: dict[str, float] = {}
    if req.analysis_id:
        from hakase_smallmol.l1.pipeline import get_l1_analysis
        from hakase_smallmol.l2.pipeline import l1_ivive_inputs

        try:
            stored = get_l1_analysis(req.analysis_id)
        except (KeyError, ValueError):
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
        ad_result = predict_applicability_domain(smiles)
    except Exception as e:
        raise HTTPException(status_code=400, detail={"source": "input-error", "message": str(e)})

    if ad_result.get("ad_label") not in {"In-domain", "Border-domain"}:
        return sanitize(
            {
                "source": "insufficient-input",
                "missing": ["applicability_domain"],
                "available": False,
                "reason": "Applicability coverage is insufficient for a pharmacokinetic projection.",
                "remediation": "Use a closer chemical analogue, provide experimentally measured disposition inputs, or obtain additional evidence before projecting exposure.",
                "applicability_domain": ad_result,
            }
        )

    from hakase_smallmol.pk_ivive.disposition import assemble_disposition
    from hakase_smallmol.pk_ivive.pk_ivive import predict_pk_ivive

    try:
        ivive_res = predict_pk_ivive(
            smiles,
            overrides=req.overrides,
            ml_inputs=l1_inputs,
            species=req.animal.species,
            strain=req.animal.strain,
            body_weight_kg=req.animal.body_weight,
            montecarlo=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IVIVE failed: {e}")

    if ivive_res.get("source") == "insufficient-input":
        raise HTTPException(status_code=422, detail=sanitize(ivive_res))
    if ivive_res.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitize(ivive_res))

    try:
        from hakase_smallmol.pk_ivive.kp import compute_kp
        from hakase_smallmol.pk_ivive.logp_resolver import fetch_logd_7_4, resolve_neutral_logp
        from hakase_smallmol.pk_ivive.pka import predict_pka

        pka_res = predict_pka(smiles, allow_heuristic=True)

        from rdkit import Chem
        from rdkit.Chem import Descriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            raise ValueError("The completed analysis did not contain a valid molecular structure.")
        crippen_logp = Descriptors.MolLogP(mol)
        # Reliability-gated neutral-logP resolver (S2-T5): for lipophilic fused-azole
        # bases (midazolam/alprazolam/triazolam) Crippen over-estimates the neutral
        # logP and the adipose P·fNL term amplifies it into a large tissue-Kp
        # over-prediction. resolve_neutral_logp caps Crippen downward onto the
        # logD-anchored reconstruction only for weakly-ionised bases, leaving every
        # other compound (and the offline-ML case) on Crippen unchanged. Kp path only;
        # the formulation/absorption logP below stays Crippen by design.
        logp = resolve_neutral_logp(crippen_logp, pka_res, fetch_logd_7_4(smiles)).logp

        fu_plasma = ivive_res.get("inputs", {}).get("fu_plasma", {}).get("value")
        if fu_plasma is None:
            return sanitize(
                {
                    "source": "insufficient-input",
                    "available": False,
                    "reason": "The required unbound plasma fraction was not returned.",
                    "missing": ["fu_plasma"],
                    "remediation": "Provide a measured unbound fraction or rerun once the disposition input is available.",
                }
            )

        bpr = (ivive_res.get("system_parameters", {}).get("blood_plasma_ratio") or {}).get("value")
        if bpr is None:
            return sanitize(
                {
                    "source": "insufficient-input",
                    "available": False,
                    "reason": "The required blood-to-plasma ratio was not returned.",
                    "missing": ["blood_plasma_ratio"],
                    "remediation": "Provide a measured blood-to-plasma ratio before projecting exposure.",
                }
            )

        kp_res = compute_kp(logp, pka_res, fu_plasma=fu_plasma, blood_plasma_ratio=bpr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kp prediction failed: {e}")

    from hakase_kernel.pbpk.contract import ApplicabilityDomain

    ad = ApplicabilityDomain(
        verdict="in" if ad_result["ad_label"] == "In-domain" else "edge",
        score=ad_result.get("ad_score"),
        rationale=ad_result.get("coverage_note"),
    )

    try:
        disp = assemble_disposition(ivive_res, kp_res, applicability_domain=ad)
    except ValueError as e:
        return sanitize(
            {
                "source": "insufficient-input",
                "available": False,
                "reason": str(e),
                "remediation": "Required disposition evidence is incomplete; no exposure projection was generated.",
            }
        )
    if disp.applicability_domain.verdict == "out":
        return sanitize(
            {
                "source": "insufficient-input",
                "available": False,
                "reason": disp.applicability_domain.rationale
                or "The compound is outside the metabolic-clearance applicability domain.",
                "remediation": "Obtain measured clearance evidence or choose a suitable model before projecting exposure.",
                "applicability_domain": disp.applicability_domain.to_dict(),
            }
        )

    import numpy as np
    from hakase_kernel.pbpk.absorption import (
        IVBolus,
        IVInfusion,
        Oral,
        RepeatDose,
        SCDepot,
        compute_formulation_impact,
    )
    from hakase_kernel.pbpk.cohort import run_virtual_cohort
    from hakase_kernel.pbpk.physiology.store import get_physiology
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors

    phys_base = get_physiology(req.animal.species, req.animal.strain)

    mol = Chem.MolFromSmiles(smiles)
    mw = Descriptors.MolWt(mol)
    tpsa = Descriptors.TPSA(mol)
    logp = Descriptors.MolLogP(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    num_ar = rdMolDescriptors.CalcNumAromaticRings(mol)
    rot_bonds = rdMolDescriptors.CalcNumRotatableBonds(mol)

    # We use a baseF of 0.5 as a fallback for oral/sc absorption baseline if unknown.
    form_res = compute_formulation_impact(
        logp, tpsa, mw, hbd, num_ar, rot_bonds, baseF=0.5, formulation_type=req.formulation
    )
    f_abs = form_res["F_abs_formulated"]

    def factory(phys):
        dose = req.study.dose
        route = req.study.route.upper()
        if route == "IV":
            if req.study.infusion_duration and req.study.infusion_duration > 0:
                base = IVInfusion(dose, req.study.infusion_duration)
            else:
                base = IVBolus(dose)
        elif route == "SC":
            base = SCDepot(dose, ka=1.0, f_abs=f_abs)
        elif route == "ORAL":
            base = Oral(dose, ka=1.0, f_abs=f_abs)
        else:
            base = IVBolus(dose)

        if req.study.frequency:
            from hakase_kernel.pbpk.absorption import _parse_frequency

            tau = _parse_frequency(req.study.frequency)
            num = int(req.study.duration / tau) if req.study.duration else 1
            return RepeatDose(base, tau, num)
        return base

    rng = np.random.default_rng(42)
    duration = req.study.duration or 24.0
    t_eval = np.linspace(0, duration, 100)

    try:
        from hakase_kernel.pbpk.model import clearance_law, transport_law

        cohort_res = run_virtual_cohort(
            disp_base=disp,
            n_animals=req.cohort_size,
            time_eval=t_eval,
            forcing_model_factory=factory,
            phys_base=phys_base,
            transport_law=transport_law,
            clearance_law=clearance_law,
            seed=42,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cohort simulation failed: {e}")

    cohort_res["applicability_domain"] = ad.to_dict()
    cohort_res["formulation"] = form_res
    cohort_res["disposition"] = disp.to_dict()
    cohort_res["analysis_id"] = req.analysis_id
    cohort_res["source"] = "pbpk_exposure"
    cohort_res["available"] = True
    cohort_res["presentation"] = _pbpk_presentation(
        cohort_res,
        cohort_res["disposition"],
        ivive_res,
        cohort_res["applicability_domain"],
        form_res,
        req.study,
    )
    return sanitize(cohort_res)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("AI_SERVICE_PORT", "8090")))
