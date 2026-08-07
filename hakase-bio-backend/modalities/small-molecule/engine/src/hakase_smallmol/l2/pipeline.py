"""Backend-owned Confirmation inputs and synchronous stage dispatch.

The browser may request a stage and render its response, but it never derives
an L2 value.  Long-running physical jobs (Vina and TIES) keep their dedicated
asynchronous endpoints and job records.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from hakase_structure.protein_ml import predict_protein_ml

from hakase_smallmol.admet.admet_ml import predict_admet_ml
from hakase_smallmol.admet.caco2_ml import predict_caco2_ml
from hakase_smallmol.admet.half_life_ml import predict_half_life_ml
from hakase_smallmol.admet.solubility_ml import predict_solubility_ml
from hakase_smallmol.admet.vdss_ml import predict_vdss_ml
from hakase_smallmol.binding.binding_ml import predict_binding_ml
from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox
from hakase_smallmol.dili.dili_ml import predict_dili_ml
from hakase_smallmol.ersilia_hub import predict_cytotoxicity
from hakase_smallmol.l1.pipeline import get_l1_analysis
from hakase_smallmol.l2.confirmation_block import build_confirmation_block
from hakase_smallmol.l2.pd_coupling import predict_pd_coupling
from hakase_smallmol.l2.therapeutic_index import rank_therapeutic_index
from hakase_smallmol.pk_ivive.pk_ivive import predict_pk_ivive
from hakase_smallmol.safety.ames_ml import predict_ames_ml
from hakase_smallmol.safety.reactive_metabolites import predict_reactive_metabolites
from hakase_smallmol.safety.safety_triage import predict_safety_triage
from hakase_smallmol.safety.tox21_ml import predict_tox21_panel

STAGES: tuple[dict[str, str], ...] = (
    {
        "id": "0",
        "name": "Ingest Layer 1 outputs",
        "mode": "server_contract",
        "models": "Layer 1 persisted analysis",
    },
    {
        "id": "1",
        "name": "Target druggability",
        "mode": "server_ml",
        "models": "ProteinML druggability classifier",
    },
    {
        "id": "2",
        "name": "Molecular docking",
        "mode": "server_async",
        "models": "Vina docking service",
    },
    {
        "id": "3",
        "name": "Binding, ADME + disposition cross-check",
        "mode": "server_ml",
        "models": "BindingML; ADMET-AI; Caco2-ML; SolubilityML; VDss-ML; HalfLife-ML",
    },
    {
        "id": "4",
        "name": "Safety + selectivity cross-check",
        "mode": "server_ml",
        "models": "Safety Triage; Tox21; CardioTox; DILI-ML; Ames-ML; reactive-metabolite alerts",
    },
    {
        "id": "5",
        "name": "Free-energy refinement",
        "mode": "server_async",
        "models": "TIES FEP / RunPod",
    },
    {
        "id": "6",
        "name": "IVIVE pharmacokinetic projection",
        "mode": "server_ml",
        "models": "IVIVE well-stirred hepatic clearance; ADMET-AI disposition inputs",
    },
    {
        "id": "7",
        "name": "Target engagement (PD coupling)",
        "mode": "server_ml",
        "models": "Equilibrium receptor occupancy (Clark/Hill) over the affinity and disposition anchors",
    },
    {
        "id": "8",
        "name": "Therapeutic-index ranking",
        "mode": "server_ml",
        "models": "Margin ranking over Stage 7 engagement and Stage 4 safety concentrations",
    },
    {
        "id": "9",
        "name": "Confirmation block",
        "mode": "server_rollup",
        "models": "Rollup of every executed Confirmation stage; runs no model of its own",
    },
)

# Stages whose result another stage reads. Ordered so a dependency is always
# computed before the stage that consumes it.
_STAGE_DEPENDENCIES: dict[str, tuple[str, ...]] = {
    "6": (),
    "7": ("3", "6"),
    "8": ("4", "7"),
    "9": ("1", "3", "4", "6", "7", "8"),
}

# Stages the configured batch runs synchronously, in execution order.
_CONFIGURED_SYNCHRONOUS: tuple[str, ...] = ("0", "1", "3", "4", "6", "7", "8", "9")

# Stages that are explicitly dispatched asynchronous physical jobs.
_ASYNC_STAGES: frozenset[str] = frozenset({"2", "5"})


def _availability(value: Any) -> tuple[bool, str | None]:
    """Read a model's own availability envelope without manufacturing a pass.

    Several model adapters intentionally return a structured fallback rather
    than raising.  A wrapper stage must not relabel that fallback as an
    available prediction merely because the HTTP request itself succeeded.
    """
    if not isinstance(value, dict):
        return True, None
    if value.get("ml_available") is False or value.get("available") is False:
        return False, str(
            value.get("error")
            or value.get("reason")
            or "The backend model did not return a usable prediction."
        )
    if value.get("source") in {"fallback", "unavailable", "insufficient-input"}:
        return False, str(
            value.get("error")
            or value.get("reason")
            or "The backend model did not return a usable prediction."
        )
    return True, None


def _result_status(result: Any) -> tuple[str, list[str]]:
    """Return available/partial/unavailable based on real child model output."""
    if isinstance(result, dict):
        root_available, root_reason = _availability(result)
        if not root_available:
            return "unavailable", [root_reason] if root_reason else []
    candidates = (
        list(result.values())
        if isinstance(result, dict) and any(isinstance(v, dict) for v in result.values())
        else [result]
    )
    states = [_availability(candidate) for candidate in candidates]
    unavailable = [reason for available, reason in states if not available and reason]
    if unavailable and len(unavailable) == len(states):
        return "unavailable", unavailable
    if unavailable:
        return "partial", unavailable
    return "available", []


def _presentation_group(title: str, fields: list[tuple[str, Any]]) -> dict[str, Any]:
    """Return a display contract made only from values produced upstream."""

    def display_value(value: Any) -> Any:
        # Presentation-only rounding belongs on the server. The unrounded model
        # output remains in `result`; React never derives or changes it.
        if isinstance(value, float):
            return round(value, 4)
        return value

    return {
        "title": title,
        "fields": [
            {"label": label, "value": display_value(value)}
            for label, value in fields
            if value is not None and value != ""
        ],
    }


def l1_ivive_inputs(l1: dict[str, Any]) -> dict[str, float]:
    """Reuse the completed Layer 1 ADMET readout for IVIVE.

    IVIVE must consume the exact analysis record that entered Confirmation.
    This avoids a second ADMET inference for the same molecule and preserves a
    traceable Layer 1 -> Layer 2 handoff.  The transformation from bound plasma
    protein percentage to unbound fraction is performed here on the server.
    """
    endpoints = l1.get("admet_endpoints") or {}

    def numeric(endpoint: str) -> float | None:
        value = (endpoints.get(endpoint) or {}).get("model_value")
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    supplied: dict[str, float] = {}
    mapping = {
        "Clearance_Hepatocyte_AZ": "clint_hep_ul_min_1e6",
        "VDss_Lombardo": "vdss_l_per_kg",
        "Half_Life_Obach": "half_life_obach_h",
    }
    for endpoint, parameter in mapping.items():
        value = numeric(endpoint)
        if value is not None:
            supplied[parameter] = value

    bound_percent = numeric("PPBR_AZ")
    if bound_percent is not None:
        supplied["fu_plasma"] = max(0.0, min(1.0, 1.0 - bound_percent / 100.0))
    return supplied


def _presentation_for_stage(stage: str, result: Any) -> dict[str, Any]:
    """Create a compact server-owned presentation contract for real outcomes.

    Values are copied verbatim from their model envelopes.  This is deliberately
    a selection/labeling contract, not a browser-side scoring or calculation.
    """
    if stage == "1" and isinstance(result, dict):
        prediction = result.get("prediction") or {}
        return {
            "groups": [
                _presentation_group(
                    "Target druggability",
                    [
                        ("Druggability class", prediction.get("druggability_class")),
                        ("Druggability probability", prediction.get("druggability_probability")),
                        ("Sequence length", result.get("sequence_length")),
                    ],
                )
            ]
        }
    if stage == "3" and isinstance(result, dict):
        groups: list[dict[str, Any]] = []
        binding = result.get("binding_ml") or {}
        if _availability(binding)[0]:
            prediction = binding.get("prediction") or {}
            groups.append(
                _presentation_group(
                    "Binding assessment",
                    [
                        ("Predicted pKd", prediction.get("pKd_predicted")),
                        ("Predicted Kd (nM)", prediction.get("Kd_nM")),
                        ("Affinity class", prediction.get("affinity_class")),
                    ],
                )
            )
        admet = result.get("admet_ml") or {}
        if _availability(admet)[0]:
            endpoints = admet.get("endpoints") or {}
            model_info = admet.get("model_info") or {}
            groups.append(
                _presentation_group(
                    "ADMET cross-check",
                    [
                        ("Model", model_info.get("engine")),
                        ("Endpoints returned", model_info.get("endpoint_count")),
                        ("Caco-2 permeability", endpoints.get("Caco2_Wang")),
                        ("HIA", endpoints.get("HIA_Hou")),
                        ("Hepatocyte clearance", endpoints.get("Clearance_Hepatocyte_AZ")),
                        ("P-gp substrate probability", endpoints.get("Pgp_Broccatelli")),
                    ],
                )
            )
        focused = [
            ("Caco2-ML", result.get("caco2_ml"), "log Papp", "log_papp"),
            ("SolubilityML", result.get("solubility_ml"), "Predicted logS", "logS_predicted"),
            ("VDss-ML", result.get("vdss_ml"), "Predicted VDss (L/kg)", "vdss_l_per_kg"),
            (
                "HalfLife-ML",
                result.get("half_life_ml"),
                "Predicted half-life (h)",
                "half_life_hours",
            ),
        ]
        fields: list[tuple[str, Any]] = []
        for label, envelope, value_label, value_key in focused:
            if isinstance(envelope, dict) and _availability(envelope)[0]:
                prediction = envelope.get("prediction") or {}
                fields.append((value_label, prediction.get(value_key)))
                fields.append(
                    (
                        f"{label} class",
                        next(
                            (
                                prediction.get(key)
                                for key in (
                                    "permeability_class",
                                    "solubility_class",
                                    "distribution_class",
                                    "half_life_class",
                                )
                                if prediction.get(key) is not None
                            ),
                            None,
                        ),
                    )
                )
        if fields:
            groups.append(_presentation_group("Independent ADME and disposition models", fields))
        return {"groups": groups}
    if stage == "4" and isinstance(result, dict):
        safety = result.get("safety_triage") or {}
        triage = safety.get("triage") or {}
        endpoints = safety.get("endpoints") or {}
        groups = []
        if _availability(safety)[0]:
            groups.append(
                _presentation_group(
                    "Safety triage",
                    [
                        ("Triage tier", triage.get("tier")),
                        ("Summary", triage.get("headline")),
                        ("hERG signal", (endpoints.get("herg") or {}).get("signal")),
                        ("hERG probability", (endpoints.get("herg") or {}).get("probability")),
                        ("DILI signal", (endpoints.get("dili") or {}).get("signal")),
                        ("DILI probability", (endpoints.get("dili") or {}).get("probability")),
                        ("Ames signal", (endpoints.get("ames") or {}).get("signal")),
                        ("Ames probability", (endpoints.get("ames") or {}).get("probability")),
                    ],
                )
            )
        tox21 = result.get("tox21") or {}
        if _availability(tox21)[0]:
            summary = tox21.get("summary") or {}
            groups.append(
                _presentation_group(
                    "Safety assay panel",
                    [
                        ("Assays evaluated", summary.get("n_assays_evaluated")),
                        ("In-domain flags", summary.get("n_flagged_in_domain")),
                        ("Top liability", (summary.get("top_liability") or {}).get("assay")),
                    ],
                )
            )
        independent = [
            ("CardioTox hERG blocker probability", result.get("cardiotox"), "blocker_probability"),
            ("DILI-ML probability", result.get("dili_ml"), "dili_probability"),
            ("Ames-ML mutagenic probability", result.get("ames_ml"), "mutagenic_probability"),
        ]
        independent_fields: list[tuple[str, Any]] = []
        for label, envelope, key in independent:
            if isinstance(envelope, dict) and _availability(envelope)[0]:
                independent_fields.append((label, (envelope.get("prediction") or {}).get(key)))
        reactive = result.get("reactive_metabolites") or {}
        if isinstance(reactive, dict):
            independent_fields.extend(
                [
                    ("Reactive-metabolite alert class", reactive.get("rm_class")),
                    ("Reactive-metabolite alerts", reactive.get("alert_count")),
                ]
            )
        if independent_fields:
            groups.append(_presentation_group("Independent safety models", independent_fields))
        return {"groups": groups}
    if stage == "6" and isinstance(result, dict):
        parameters = result.get("parameters") or {}
        inputs = result.get("inputs") or {}
        confidence = result.get("confidence") or {}
        domain = result.get("metabolic_clearance_domain") or {}
        warnings = result.get("system_warnings") or []
        return {
            "groups": [
                _presentation_group(
                    "Pharmacokinetic projection",
                    [
                        ("Total plasma clearance (L/h)", parameters.get("cl_total_plasma_l_h")),
                        ("Hepatic plasma clearance (L/h)", parameters.get("cl_hepatic_plasma_l_h")),
                        ("Renal plasma clearance (L/h)", parameters.get("cl_renal_plasma_l_h")),
                        ("Half-life (h)", parameters.get("half_life_h")),
                        ("Vdss (L/kg)", parameters.get("vdss_l_per_kg")),
                        ("Extraction class", parameters.get("extraction_class")),
                        (
                            "First-pass availability",
                            parameters.get("hepatic_first_pass_availability_fh"),
                        ),
                    ],
                ),
                _presentation_group(
                    "Evidence and limitations",
                    [
                        ("Projection confidence", confidence.get("level")),
                        ("Metabolic clearance applicability", domain.get("verdict")),
                        ("Limitation", confidence.get("rationale")),
                        ("System warnings", "; ".join(str(item) for item in warnings if item)),
                    ],
                ),
                _presentation_group(
                    "Input evidence",
                    [
                        (
                            "Hepatocyte intrinsic clearance",
                            (inputs.get("clint_hep_ul_min_1e6") or {}).get("value"),
                        ),
                        ("Unbound plasma fraction", (inputs.get("fu_plasma") or {}).get("value")),
                        ("Distribution volume", (inputs.get("vdss_l_per_kg") or {}).get("value")),
                        (
                            "Half-life reference",
                            (inputs.get("half_life_obach_h") or {}).get("value"),
                        ),
                    ],
                ),
            ]
        }
    if stage == "7" and isinstance(result, dict):
        return _presentation_for_engagement(result)
    if stage == "8" and isinstance(result, dict):
        return _presentation_for_index(result)
    if stage == "9" and isinstance(result, dict):
        return _presentation_for_confirmation(result)
    return {"groups": []}


def _presentation_for_engagement(result: dict[str, Any]) -> dict[str, Any]:
    """Select the Stage-7 occupancy values already computed by the engine."""
    if result.get("available") is not True:
        return {"groups": []}
    anchor = result.get("affinity_anchor") or {}
    unbound = result.get("unbound_fraction") or {}
    model = result.get("model") or {}
    achieved = result.get("achieved_engagement") or {}

    required_fields: list[tuple[str, Any]] = [
        (
            f"Unbound concentration for {item.get('occupancy_percent')}% occupancy (nM)",
            item.get("unbound_concentration_nm"),
        )
        for item in result.get("required_unbound_concentrations") or []
    ]

    groups = [
        _presentation_group(
            "Affinity anchor",
            [
                ("Anchor type", anchor.get("activity_type")),
                ("Anchor value (nM)", anchor.get("kd_nm")),
                ("Provenance", anchor.get("provenance")),
                ("Source", anchor.get("source")),
                ("Apparent potency (not equilibrium Kd)", anchor.get("affinity_is_apparent")),
            ],
        ),
        _presentation_group(
            "Occupancy requirement",
            [
                ("Model", model.get("name")),
                ("Hill coefficient", model.get("hill_coefficient")),
                ("Hill provenance", model.get("hill_coefficient_provenance")),
                ("Unbound plasma fraction", unbound.get("value")),
                *required_fields,
            ],
        ),
    ]
    if achieved.get("available") is True:
        groups.append(
            _presentation_group(
                "Projected engagement at the simulated dose",
                [
                    ("Dose (mg)", achieved.get("dose_mg")),
                    ("Route", achieved.get("route")),
                    ("Total concentration (nM)", achieved.get("total_concentration_nm")),
                    ("Unbound concentration (nM)", achieved.get("unbound_concentration_nm")),
                    ("Cu / Kd", achieved.get("cu_over_kd")),
                    ("Target occupancy (%)", achieved.get("occupancy_percent")),
                    ("Basis", achieved.get("basis")),
                ],
            )
        )
    else:
        groups.append(
            _presentation_group(
                "Projected engagement at the simulated dose",
                [("Not projected", achieved.get("reason"))],
            )
        )
    groups.append(
        _presentation_group(
            "Limitations",
            [
                (f"Limitation {index + 1}", text)
                for index, text in enumerate(result.get("limitations") or [])
            ],
        )
    )
    return {"groups": groups}


def _presentation_for_index(result: dict[str, Any]) -> dict[str, Any]:
    """Select the Stage-8 margin table already ranked by the engine."""
    if result.get("available") is not True:
        return {"groups": []}
    efficacy = result.get("efficacy_anchor") or {}
    limiting = result.get("limiting_margin") or {}
    coverage = result.get("coverage") or {}

    groups = [
        _presentation_group(
            "Efficacy anchor",
            [
                ("Anchor", efficacy.get("label")),
                ("Concentration (nM)", efficacy.get("value_nm")),
                ("Provenance", efficacy.get("provenance")),
                ("Apparent potency", efficacy.get("is_apparent")),
            ],
        ),
        _presentation_group(
            "Ranked margins",
            [
                (
                    f"{margin.get('label')} ({margin.get('band')})",
                    f"{margin.get('margin_fold')}-fold "
                    f"({margin.get('safety_concentration_nm')} nM / "
                    f"{margin.get('efficacy_concentration_nm')} nM)",
                )
                for margin in result.get("computed_margins") or []
            ]
            or [("Computed margins", "None — no numeric safety concentration was available.")],
        ),
        _presentation_group(
            "Limiting margin",
            [
                ("Constraint", limiting.get("label")),
                ("Margin (fold)", limiting.get("margin_fold")),
                ("Band", limiting.get("band")),
                ("Interpretation", limiting.get("note")),
            ],
        ),
        _presentation_group(
            "Margins that could not be computed",
            [
                (str(item.get("label")), f"Requires {item.get('required_measurement')}")
                for item in result.get("not_computable") or []
            ],
        ),
        _presentation_group(
            "Categorical liabilities (not rankable as a margin)",
            [
                (
                    str(item.get("name")),
                    f"{item.get('signal') or 'signal reported'}"
                    + (
                        f" · p = {item.get('probability')}"
                        if item.get("probability") is not None
                        else ""
                    ),
                )
                for item in result.get("categorical_liabilities") or []
            ],
        ),
        _presentation_group(
            "Coverage",
            [
                ("Margins computed", coverage.get("margins_computed")),
                ("Margins blocked", coverage.get("margins_blocked")),
                ("Note", coverage.get("note")),
            ],
        ),
    ]
    return {"groups": groups}


def _presentation_for_confirmation(result: dict[str, Any]) -> dict[str, Any]:
    """Select the Stage-9 rollup already decided by the engine."""
    if result.get("available") is not True:
        return {"groups": []}
    counts = result.get("counts") or {}
    completeness = result.get("evidence_completeness") or {}
    conditions = result.get("conditions") or []

    def by_severity(severity: str) -> list[tuple[str, Any]]:
        return [
            (str(item.get("title")), str(item.get("detail")))
            for item in conditions
            if item.get("severity") == severity
        ]

    return {
        "groups": [
            _presentation_group(
                "Confirmation decision",
                [
                    ("Verdict", result.get("verdict")),
                    ("Summary", result.get("headline")),
                    ("Blocking conditions", counts.get("block")),
                    ("Reservations", counts.get("warn")),
                    ("Satisfied conditions", counts.get("pass")),
                ],
            ),
            _presentation_group(
                "Evidence completeness",
                [
                    ("Stages evaluated", completeness.get("stages_evaluated")),
                    ("Stages with a usable result", completeness.get("stages_with_a_usable_result")),
                    ("Stages available", ", ".join(completeness.get("stages_available") or [])),
                    ("Note", completeness.get("note")),
                ],
            ),
            _presentation_group("Blocking conditions", by_severity("block")),
            _presentation_group("Reservations to carry into Layer 3", by_severity("warn")),
            _presentation_group("Satisfied conditions", by_severity("pass")),
        ]
    }


def _status_for(stage: dict[str, str], *, has_target: bool) -> dict[str, Any]:
    stage_id = stage["id"]
    mode = stage["mode"]
    if stage_id in {"1", "3", "7", "8"} and not has_target:
        return {
            **stage,
            "status": "needs_target",
            "reason": "Layer 1 did not record a UniProt target for this analysis.",
        }
    if mode == "not_configured":
        return {
            **stage,
            "status": "not_configured",
            "reason": "No server-side contract is configured for this stage yet; no frontend estimate is shown.",
        }
    if mode == "server_async":
        return {
            **stage,
            "status": "ready",
            "reason": "This stage is an asynchronous backend job and must be explicitly dispatched.",
        }
    return {**stage, "status": "ready", "reason": "Ready for server execution."}


def l2_input_contract(analysis_id: str) -> dict[str, Any]:
    """Make the exact L1→L2 handoff record available to the UI."""
    stored = get_l1_analysis(analysis_id)
    analysis = stored["analysis"]
    requested = stored.get("requested") or {}
    descriptors = analysis.get("rdkit_feasibility") or {}
    return {
        "schema_version": "hakase.small-molecule.l2.confirmation.v1",
        "status": "available",
        "analysis_id": analysis_id,
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l2.pipeline",
        "l1": {
            "canonical_smiles": analysis.get("canonical_smiles"),
            "uniprot_id": requested.get("uniprot_id"),
            "target_protein": requested.get("target_protein"),
            "pdb_id": requested.get("pdb_id"),
            "target_resolution": requested.get("target_resolution"),
            "target_evidence": requested.get("target_evidence"),
            "therapeutic_area": requested.get("therapeutic_area"),
            "verdict": analysis.get("verdict"),
            "review": stored.get("override"),
            "descriptors": {
                key: descriptors.get(key)
                for key in (
                    "molecular_weight_da",
                    "logp",
                    "tpsa_a2",
                    "qed",
                    "lipinski_rule_of_five_pass",
                )
            },
            "admet_sections": analysis.get("admet_ai_sections") or {},
            "admet_endpoints": analysis.get("admet_ai_endpoints") or {},
            "safety_assessments": analysis.get("safety_assessments") or {},
            "regulatory_outlook": analysis.get("regulatory_outlook") or {},
            "simulation_configuration": analysis.get("simulation_configuration") or {},
            "optional_model_runs": analysis.get("optional_model_runs") or {},
        },
        "stages": [
            _status_for(stage, has_target=bool(requested.get("uniprot_id"))) for stage in STAGES
        ],
        "virtual_tissue": {
            "label": "Virtual tissue (computational projections only)",
            "models": [
                {
                    "id": "celltype_aggregation",
                    "name": "Tissue-expression and cell-type projection",
                    "engine": "Drug2cell pattern + Tabula Sapiens v2",
                    "requires": "Resolved target gene symbol and provisioned Tabula Sapiens aggregate.",
                },
                {
                    "id": "patient_line",
                    "name": "Oncology patient-line projection",
                    "engine": "DepMap PRISM 24Q2 expression + Chronos essentiality",
                    "requires": "Resolved target gene, Layer 1 potency evidence, oncology scope, and provisioned DepMap snapshot.",
                },
            ],
            "limitations": "These outputs are computational projections over reference data. They are not ex-vivo measurements and are never substituted when the required datasets are unavailable.",
        },
        "provenance": {
            "source_analysis_id": analysis_id,
            "source_owner": stored.get("owner"),
            "client_contract": "display-only",
        },
    }


def _execute_stage(
    stage: str,
    *,
    contract: dict[str, Any],
    cache: dict[str, Any],
    options: dict[str, Any],
) -> dict[str, Any] | None:
    """Compute one stage's raw result, memoising it for dependent stages.

    Returns ``None`` for a stage that is an explicitly dispatched asynchronous
    job.  Dependencies are executed first so that Stage 7/8/9 read the exact
    model output the earlier stages produced rather than re-running them.
    """
    if stage in cache:
        return cache[stage]
    if stage in _ASYNC_STAGES:
        return None

    l1 = contract["l1"]
    smiles = str(l1.get("canonical_smiles") or "")
    uniprot_id = l1.get("uniprot_id")
    stage_map = {item["id"]: item for item in contract["stages"]}

    def dependency(dependency_id: str) -> Any:
        """Run a prerequisite stage, but only when it is itself runnable."""
        metadata = stage_map.get(dependency_id) or {}
        if metadata.get("status") != "ready":
            return None
        return _execute_stage(dependency_id, contract=contract, cache=cache, options=options)

    for prerequisite in _STAGE_DEPENDENCIES.get(stage, ()):
        dependency(prerequisite)

    result: dict[str, Any]
    if stage == "0":
        result = contract
    elif stage == "1":
        result = predict_protein_ml(str(uniprot_id))
    elif stage == "3":
        result = {
            "binding_ml": predict_binding_ml(smiles, str(uniprot_id)),
            "admet_ml": predict_admet_ml(smiles),
            "caco2_ml": predict_caco2_ml(smiles),
            "solubility_ml": predict_solubility_ml(smiles),
            "vdss_ml": predict_vdss_ml(smiles),
            "half_life_ml": predict_half_life_ml(smiles),
        }
    elif stage == "4":
        result = {
            "safety_triage": predict_safety_triage(smiles),
            "tox21": predict_tox21_panel(smiles),
            "cardiotox": predict_cardiotox(smiles),
            "dili_ml": predict_dili_ml(smiles),
            "ames_ml": predict_ames_ml(smiles),
            "reactive_metabolites": predict_reactive_metabolites(smiles),
        }
    elif stage == "6":
        # The IVIVE projection reuses the ADMET readout that entered
        # Confirmation rather than paying a second inference for the same
        # molecule. A dose is optional: without one the closed-form clearance
        # and half-life are still returned, only the exposure block is omitted.
        result = predict_pk_ivive(
            smiles,
            ml_inputs=l1_ivive_inputs(l1),
            species=str(options.get("species") or "human"),
            body_weight_kg=options.get("body_weight_kg"),
            dose_mg=options.get("dose_mg"),
        )
    elif stage == "7":
        result = predict_pd_coupling(
            l1=l1,
            binding_ml=(cache.get("3") or {}).get("binding_ml"),
            ivive=cache.get("6"),
            hill_coefficient=options.get("hill_coefficient"),
        )
    elif stage == "8":
        # Cytotoxicity is fetched here rather than accepted from the caller: a
        # concentration that enters a margin must come from the server, and the
        # adapter reports `unavailable` honestly when it is not configured.
        result = rank_therapeutic_index(
            pd_coupling=cache.get("7"),
            safety_stage=cache.get("4"),
            cytotoxicity=predict_cytotoxicity(smiles),
            measured_safety_concentrations=options.get("measured_safety_concentrations"),
        )
    elif stage == "9":
        result = build_confirmation_block(
            l1=l1,
            stage_results={key: value for key, value in cache.items() if value is not None},
        )
    else:
        return None

    cache[stage] = result
    return result


def _stage_envelope(
    analysis_id: str, stage: str, metadata: dict[str, Any], result: dict[str, Any]
) -> dict[str, Any]:
    result_status, unavailable_reasons = _result_status(result)
    return {
        "analysis_id": analysis_id,
        "stage": metadata,
        "status": result_status,
        "result": result,
        "presentation": _presentation_for_stage(stage, result),
        "unavailable_model_reasons": unavailable_reasons,
        "provenance": {
            "owner": "hakase_smallmol.l2.pipeline",
            "computed_at": datetime.now(UTC).isoformat(),
            "client_contract": "display-only",
        },
    }


def run_l2_stage(
    analysis_id: str, stage: str, options: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Run a supported synchronous Confirmation stage on the server."""
    contract = l2_input_contract(analysis_id)
    stage_map = {item["id"]: item for item in contract["stages"]}
    metadata = stage_map.get(stage)
    if metadata is None:
        raise ValueError(f"Unknown Layer-2 stage: {stage}")
    if metadata["status"] != "ready":
        return {
            "analysis_id": analysis_id,
            "stage": metadata,
            "status": metadata["status"],
            "reason": metadata["reason"],
        }

    result = _execute_stage(stage, contract=contract, cache={}, options=options or {})
    if result is None:
        return {
            "analysis_id": analysis_id,
            "stage": metadata,
            "status": "server_async",
            "reason": "Dispatch this stage through its dedicated backend job endpoint.",
        }
    return _stage_envelope(analysis_id, stage, metadata, result)


def run_configured_l2_stages(
    analysis_id: str, options: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Run the configured, synchronous Confirmation stages as one server job.

    The browser submits one request and only renders this envelope.  Docking and
    FEP are deliberately not silently dispatched here: both have explicit
    inputs/cost controls in their dedicated server endpoints.

    One shared result cache is threaded through the whole batch, so the
    engagement, therapeutic-index and confirmation stages read the exact model
    output produced earlier in the same run instead of re-inferring it.
    """
    contract = l2_input_contract(analysis_id)
    cache: dict[str, Any] = {}
    resolved_options = options or {}
    stage_map = {item["id"]: item for item in contract["stages"]}
    executed: list[dict[str, Any]] = []

    # Execute in dependency order first so the cache is populated correctly,
    # then emit the envelopes in the roster order the UI renders.
    envelopes: dict[str, dict[str, Any]] = {}
    for stage_id in _CONFIGURED_SYNCHRONOUS:
        metadata = stage_map.get(stage_id)
        if metadata is None or metadata["status"] != "ready":
            continue
        result = _execute_stage(
            stage_id, contract=contract, cache=cache, options=resolved_options
        )
        if result is not None:
            envelopes[stage_id] = _stage_envelope(analysis_id, stage_id, metadata, result)

    for stage in contract["stages"]:
        stage_id = stage["id"]
        if stage_id in envelopes:
            executed.append(envelopes[stage_id])
        elif stage_id in _ASYNC_STAGES:
            executed.append(
                {
                    "analysis_id": analysis_id,
                    "stage": stage,
                    "status": "requires_explicit_dispatch",
                    "reason": "This backend job needs its own supplied inputs and explicit dispatch; it was not started by the configured run.",
                }
            )
        else:
            executed.append(
                {
                    "analysis_id": analysis_id,
                    "stage": stage,
                    "status": stage["status"],
                    "reason": stage["reason"],
                }
            )
    return {
        "analysis_id": analysis_id,
        "status": "available",
        "stages": executed,
        "provenance": {
            "owner": "hakase_smallmol.l2.pipeline",
            "computed_at": datetime.now(UTC).isoformat(),
            "client_contract": "display-only",
            "dispatch": "configured_synchronous_stages",
        },
    }
