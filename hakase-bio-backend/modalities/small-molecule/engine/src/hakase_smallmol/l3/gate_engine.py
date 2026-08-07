"""The L2→L3 stage gate — hard blocks, soft warnings, and reviewer sign-off.

Before an animal study may be simulated, the accumulated L1/L2 evidence is
checked against a fixed set of named conditions. Two severities:

  * **block**   — the study cannot be simulated. Not overridable from the UI;
                  the underlying evidence has to change.
  * **warn**    — the study *can* proceed, but a named reviewer must explicitly
                  acknowledge each warning and sign. The acknowledgement is
                  persisted with the study record so an audit can reconstruct
                  who accepted which residual risk, and when.

Every condition below is derived from data that actually exists in the L1
record. Nothing is inferred, defaulted, or invented: if the evidence needed to
evaluate a condition is absent, that absence *is* the warning.

This module computes; it does not decide policy. ``run_animal_study`` enforces.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from hakase_smallmol.l3.parameter_engine import ResolvedInputs

# Signal tokens that count as an active (non-clear) safety flag.
_ACTIVE_SAFETY_SIGNALS = frozenset({"high", "positive", "flag", "alert", "fail"})

# Verdicts that require a recorded L1 manual review before L3 may run.
_VERDICTS_NEEDING_REVIEW = frozenset({"WATCH", "NO-GO"})


def _condition(
    code: str,
    severity: str,
    title: str,
    detail: str,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "detail": detail,
        "acknowledgeable": severity == "warn",
        **extra,
    }


def _l1_verdict_conditions(resolved: ResolvedInputs) -> list[dict[str, Any]]:
    """Conditions arising from the L1 gate verdict and its review record."""
    out: list[dict[str, Any]] = []
    verdict_block = resolved.l1_verdict or {}
    verdict = str(verdict_block.get("verdict") or "").upper()
    override = verdict_block.get("override") or resolved.l1_override

    if not verdict:
        out.append(
            _condition(
                "L1_VERDICT_MISSING",
                "block",
                "No Layer 1 verdict on the record",
                "The animal cohort layer consumes a completed Layer 1 analysis. This record "
                "carries no gate verdict, so there is nothing to review or carry forward.",
            )
        )
        return out

    if verdict == "NO-GO" and not override:
        out.append(
            _condition(
                "L1_NOGO_UNREVIEWED",
                "block",
                "Layer 1 verdict is NO-GO with no recorded review",
                "Layer 1 recommended against progression and no manual review has been "
                "recorded against this analysis. Record a Layer 1 review with a rationale "
                "before designing an animal study.",
                verdict=verdict,
            )
        )
    elif verdict in _VERDICTS_NEEDING_REVIEW:
        recorded = bool(override)
        out.append(
            _condition(
                "L1_VERDICT_NEEDS_REVIEW",
                "warn",
                f"Layer 1 verdict is {verdict}",
                (
                    "Layer 1 flagged borderline ADMET or safety signals requiring active "
                    "monitoring. Acknowledge that you accept the residual risk before progressing."
                    + (
                        f" A Layer 1 review is on record (effective verdict: "
                        f"{override.get('effective_verdict', 'recorded')})."
                        if recorded
                        else " No Layer 1 review is on record."
                    )
                ),
                verdict=verdict,
                l1_review_recorded=recorded,
            )
        )
    return out


def _disposition_conditions(resolved: ResolvedInputs, species: str) -> list[dict[str, Any]]:
    """Whether species-matched measured disposition exists, or the projection
    will run on human-trained ML extrapolated across species."""
    from hakase_smallmol.pk_ivive.measured_reference import lookup_measured_record

    if not resolved.smiles:
        return []
    try:
        record = lookup_measured_record(resolved.smiles, species)
    except Exception:  # noqa: BLE001 — a lookup failure is itself "no measured data"
        record = None

    if record is not None:
        return []

    return [
        _condition(
            "NO_SPECIES_MATCHED_DISPOSITION",
            "warn",
            f"No measured {species} disposition — cross-species data missing",
            (
                f"No species-matched measured hepatocyte CLint / fu / blood:plasma record exists "
                f"for this structure in {species}. Clearance will be derived from human-trained "
                "ADMET models extrapolated across species, which is the weakest link in the "
                "projection. The study design and any downstream dose will be tagged "
                "'ML-derived cross-species clearance' in the audit trail and should not be used "
                "for a regulatory submission without measured in-house or literature data."
            ),
            species=species,
        )
    ]


def _safety_conditions(resolved: ResolvedInputs) -> list[dict[str, Any]]:
    """Active L1/L2 safety signals that cascade into L3."""
    active: list[str] = []
    for name, entry in (resolved.safety_flags or {}).items():
        if not isinstance(entry, dict):
            continue
        signal = str(entry.get("signal") or entry.get("label") or entry.get("status") or "").lower()
        if signal in _ACTIVE_SAFETY_SIGNALS:
            active.append(name)

    if not active:
        return []
    return [
        _condition(
            "ACTIVE_SAFETY_FLAGS",
            "warn",
            f"{len(active)} safety flag{'s' if len(active) != 1 else ''} marked for review",
            (
                "Active Layer 1 / Layer 2 safety signals cascade into the animal cohort layer "
                "and are carried onto every downstream margin. Acknowledge that you accept the "
                "residual safety burden."
            ),
            endpoints=sorted(active),
        )
    ]


def _potency_conditions(resolved: ResolvedInputs) -> list[dict[str, Any]]:
    if resolved.potency:
        return []
    return [
        _condition(
            "NO_TARGET_POTENCY",
            "warn",
            "No target potency on the record",
            (
                "No Ki / IC50 / Kd is available from the Layer 1 binding run or ChEMBL. Target "
                "coverage cannot be computed, so the stage-gate efficacy criterion will return "
                "'unknown' rather than pass or fail."
            ),
        )
    ]


def _domain_conditions(resolved: ResolvedInputs) -> list[dict[str, Any]]:
    """Structure validity and applicability-domain gate."""
    out: list[dict[str, Any]] = []
    if not (resolved.smiles and resolved.smiles.strip()):
        out.append(
            _condition(
                "NO_STRUCTURE",
                "block",
                "No molecular structure resolved",
                "The animal cohort layer requires a structure to parameterise the exposure model.",
            )
        )
        return out

    from hakase_kernel.uncertainty.applicability_domain import predict_applicability_domain

    try:
        ad = predict_applicability_domain(resolved.smiles)
        label = ad.get("ad_label")
    except Exception as exc:  # noqa: BLE001
        return [
            _condition(
                "APPLICABILITY_UNAVAILABLE",
                "block",
                "Applicability domain could not be evaluated",
                f"The applicability-domain gate did not return a verdict: {exc}",
            )
        ]

    if label not in {"In-domain", "Border-domain"}:
        out.append(
            _condition(
                "OUT_OF_DOMAIN",
                "block",
                "Compound is outside the model applicability domain",
                (
                    f"Applicability verdict: {label or 'unavailable'}. A pharmacokinetic "
                    "projection outside the trained chemical domain would not be defensible. "
                    "Use a closer analogue or supply measured disposition inputs."
                ),
                applicability_domain=label,
            )
        )
    elif label == "Border-domain":
        out.append(
            _condition(
                "BORDER_DOMAIN",
                "warn",
                "Compound sits at the edge of the applicability domain",
                (
                    "The structure is at the boundary of the trained chemical space. Quantitative "
                    "exposure values should be treated as directional."
                ),
                applicability_domain=label,
            )
        )
    return out


def _confirmation_conditions(analysis_id: str | None) -> list[dict[str, Any]]:
    """Whether a Layer 2 confirmation sign-off has been sealed for this analysis."""
    from hakase_smallmol.l3.signoff_store import get_signoff

    if not analysis_id:
        return []
    if get_signoff(analysis_id) is not None:
        return []
    return [
        _condition(
            "L2_NOT_SEALED",
            "warn",
            "Layer 2 confirmation block is not sealed",
            (
                "The animal cohort will run without a sealed in-silico ↔ ex-vivo reconciliation "
                "for this analysis. Signing this gate seals it; the signature should cite the "
                "rationale."
            ),
        )
    ]


def evaluate_gate(resolved: ResolvedInputs, *, species: str = "rat") -> dict[str, Any]:
    """Evaluate every gate condition for a resolved L1/L2 record.

    ``species`` is the intended study species — it determines whether a
    species-matched measured disposition record exists.
    """
    from hakase_smallmol.l3.signoff_store import get_signoff

    conditions: list[dict[str, Any]] = []
    conditions += _domain_conditions(resolved)
    conditions += _l1_verdict_conditions(resolved)
    conditions += _confirmation_conditions(resolved.analysis_id)
    conditions += _disposition_conditions(resolved, species)
    conditions += _safety_conditions(resolved)
    conditions += _potency_conditions(resolved)

    blocks = [c for c in conditions if c["severity"] == "block"]
    warnings = [c for c in conditions if c["severity"] == "warn"]
    signoff = get_signoff(resolved.analysis_id) if resolved.analysis_id else None

    acknowledged = set((signoff or {}).get("acknowledged_codes") or [])
    outstanding = [w["code"] for w in warnings if w["code"] not in acknowledged]

    return {
        "analysis_id": resolved.analysis_id,
        "species": species,
        "generated_at": datetime.now(UTC).isoformat(),
        "blocks": blocks,
        "warnings": warnings,
        "counts": {
            "block": len(blocks),
            "warn": len(warnings),
            "acknowledged": len([w for w in warnings if w["code"] in acknowledged]),
        },
        "outstanding_warning_codes": outstanding,
        "signoff": signoff,
        "clear_to_proceed": not blocks and not outstanding and signoff is not None,
        "policy": {
            "blocks_are_overridable": False,
            "warnings_require": "explicit per-warning acknowledgement plus a named signature",
            "note": (
                "Signing records who accepted the residual risk. It does not alter any model "
                "output; the original verdict and every flag remain on the immutable record."
            ),
        },
        "owner": "hakase_smallmol.l3.gate_engine",
    }


__all__ = ["evaluate_gate"]
