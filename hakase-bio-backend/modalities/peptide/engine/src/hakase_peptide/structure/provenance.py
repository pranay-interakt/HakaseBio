"""Provenance stamping for structural service payloads."""

from __future__ import annotations

from typing import Any

STRUCTURAL_SCHEMA_VERSION = "1.0.0"
STRUCTURAL_SERVICE_GENERATOR = "structural_service"


def apply_structural_provenance(
    payload: dict[str, Any],
    *,
    generated_at: str,
    provider: str,
    model_id: str,
    model_version: str,
) -> dict[str, Any]:
    """Add consistent structural-service provenance to all structural components."""
    components = {
        "isolated_structure": _isolated_context(payload, provider, model_id, model_version),
        "target_resolution": _target_resolution_context(payload),
        "strategy_selection": _strategy_selection_context(payload),
        "complex_prediction": _complex_prediction_context(payload),
        "interface_analysis": _fixed_context("interface_analysis", STRUCTURAL_SCHEMA_VERSION),
        "interface_confidence_summary": _confidence_context(
            payload.get("interface_confidence_summary"),
            default_provider="interface_confidence_aggregator",
        ),
        "structural_confidence_summary": _confidence_context(
            payload.get("structural_confidence_summary"),
            default_provider="structural_confidence_aggregator",
        ),
        "structural_evidence": _structural_evidence_context(payload),
    }
    for key, context in components.items():
        component = payload.get(key)
        if isinstance(component, dict):
            _stamp_component(component, generated_at=generated_at, **context)
    return payload


def _stamp_component(
    component: dict[str, Any],
    *,
    generated_at: str,
    provider: str,
    model_id: str,
    model_version: str,
) -> None:
    existing = component.get("provenance")
    provenance = dict(existing) if isinstance(existing, dict) else {}
    if provenance.get("generator") and provenance["generator"] != STRUCTURAL_SERVICE_GENERATOR:
        provenance.setdefault("component_generator", provenance["generator"])
    provenance.update(
        {
            "generator": STRUCTURAL_SERVICE_GENERATOR,
            "provider": provider,
            "model_id": model_id,
            "model_version": model_version,
            "schema_version": STRUCTURAL_SCHEMA_VERSION,
            "generated_at": generated_at,
            "deterministic": True,
        }
    )
    component["provenance"] = provenance


def _isolated_context(
    payload: dict[str, Any],
    provider: str,
    model_id: str,
    model_version: str,
) -> dict[str, str]:
    isolated = payload.get("isolated_structure")
    if isinstance(isolated, dict):
        prediction = isolated.get("prediction")
        provenance = isolated.get("provenance")
        if isinstance(prediction, dict):
            provider = str(prediction.get("provider") or provider)
            model_id = str(prediction.get("model_id") or model_id)
            model_version = str(prediction.get("model_version") or model_version)
        elif isinstance(provenance, dict):
            provider = str(provenance.get("provider") or provider)
            model_id = str(provenance.get("model_id") or model_id)
            model_version = str(provenance.get("model_version") or model_version)
    return {
        "provider": provider,
        "model_id": model_id,
        "model_version": model_version,
    }


def _target_resolution_context(payload: dict[str, Any]) -> dict[str, str]:
    provenance = _provenance(payload.get("target_resolution"))
    return _fixed_context(
        str(provenance.get("resolver") or "target_resolver"),
        str(provenance.get("resolver_version") or STRUCTURAL_SCHEMA_VERSION),
    )


def _strategy_selection_context(payload: dict[str, Any]) -> dict[str, str]:
    provenance = _provenance(payload.get("strategy_selection"))
    return _fixed_context(
        str(provenance.get("selector") or "structural_strategy_selector"),
        str(provenance.get("selector_version") or STRUCTURAL_SCHEMA_VERSION),
    )


def _complex_prediction_context(payload: dict[str, Any]) -> dict[str, str]:
    complex_prediction = payload.get("complex_prediction")
    if isinstance(complex_prediction, dict):
        provider = str(complex_prediction.get("provider") or "complex_prediction")
        model_id = str(complex_prediction.get("model_id") or provider)
        model_version = str(complex_prediction.get("model_version") or STRUCTURAL_SCHEMA_VERSION)
        return {
            "provider": provider,
            "model_id": model_id,
            "model_version": model_version,
        }
    return _fixed_context("complex_prediction", STRUCTURAL_SCHEMA_VERSION)


def _confidence_context(component: Any, *, default_provider: str) -> dict[str, str]:
    provenance = _provenance(component)
    provider = str(provenance.get("calculator") or default_provider)
    version = str(provenance.get("calculator_version") or STRUCTURAL_SCHEMA_VERSION)
    return _fixed_context(provider, version)


def _structural_evidence_context(payload: dict[str, Any]) -> dict[str, str]:
    provenance = _provenance(payload.get("structural_evidence"))
    provider = str(
        provenance.get("component_generator")
        or provenance.get("generator")
        or "structural_evidence_builder"
    )
    version = str(provenance.get("version") or STRUCTURAL_SCHEMA_VERSION)
    return _fixed_context(provider, version)


def _fixed_context(provider: str, version: str) -> dict[str, str]:
    return {
        "provider": provider,
        "model_id": provider,
        "model_version": version,
    }


def _provenance(component: Any) -> dict[str, Any]:
    if not isinstance(component, dict):
        return {}
    provenance = component.get("provenance")
    return provenance if isinstance(provenance, dict) else {}
