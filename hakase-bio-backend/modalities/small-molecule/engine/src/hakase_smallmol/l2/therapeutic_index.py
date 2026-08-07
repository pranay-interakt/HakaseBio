"""Layer-2 Stage 8 — therapeutic-index and margin ranking.

A margin is a ratio of two concentrations::

    margin = C_safety / C_efficacy

Both terms must be real numbers on the same concentration basis (unbound, nM)
before a ratio means anything.  This module therefore does exactly two things:

1. Computes every margin for which **both** numerator and denominator are
   numeric, and ranks them ascending so the narrowest — the one that actually
   constrains the programme — is first.
2. For every margin it could *not* compute, names the single missing
   measurement that would close it.

Why so much of this is "not computable"
---------------------------------------
Most of the safety stack returns a **probability**, not a concentration.  A
hERG blocker probability of 0.71 cannot be divided by an unbound Cmax; it is a
classification, not an IC50.  Converting one to the other would be fabrication.
Those signals are therefore carried in a separate ``categorical_liabilities``
list: visible, ranked by severity, and explicitly excluded from the ratio maths.

This is the useful output.  A programme team reading it learns which single
wet-lab measurement (usually a hERG IC50) converts an unrankable liability into
a quantified margin.
"""

from __future__ import annotations

from typing import Any

# Interpretation bands for a computed margin. These are reporting labels drawn
# from common industry practice for early screening triage; they are not a
# regulatory threshold and they do not gate any decision in this pipeline.
_MARGIN_BANDS: tuple[tuple[float, str, str], ...] = (
    (30.0, "wide", "A margin above 30-fold is generally treated as low concern at screening stage."),
    (10.0, "adequate", "A margin of 10-30 fold is commonly accepted early but is monitored."),
    (3.0, "narrow", "A margin of 3-10 fold is narrow; it usually requires a measured confirmation."),
    (0.0, "critical", "A margin below 3-fold means the safety and efficacy concentrations overlap."),
)

# Keys under which an adapter may return a genuine concentration. Anything not
# listed here is treated as non-numeric and never coerced into a margin.
_CONCENTRATION_KEYS: tuple[tuple[str, float], ...] = (
    ("ic50_nm", 1.0),
    ("ic50_nM", 1.0),
    ("cc50_nm", 1.0),
    ("cc50_nM", 1.0),
    ("ec50_nm", 1.0),
    ("ec50_nM", 1.0),
    ("ic50_um", 1000.0),
    ("ic50_uM", 1000.0),
    ("cc50_um", 1000.0),
    ("cc50_uM", 1000.0),
)

# Signal tokens that mark a categorical liability as active.
_ACTIVE_TOKENS = frozenset({"high", "positive", "flag", "alert", "fail", "blocker"})


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")) or result <= 0:
        return None
    return result


def _band(margin: float) -> dict[str, str]:
    for threshold, label, note in _MARGIN_BANDS:
        if margin >= threshold:
            return {"band": label, "note": note}
    return {"band": "critical", "note": _MARGIN_BANDS[-1][2]}


def extract_concentration_nm(envelope: Any) -> dict[str, Any] | None:
    """Find a real concentration in a model envelope, or return None.

    Searches the envelope and its ``prediction`` block for one of the known
    concentration keys.  A probability, a class label or a band is not a
    concentration and is never converted into one.
    """
    if not isinstance(envelope, dict):
        return None
    if envelope.get("available") is False or envelope.get("ml_available") is False:
        return None
    for block in (envelope, envelope.get("prediction") or {}):
        if not isinstance(block, dict):
            continue
        for key, to_nm in _CONCENTRATION_KEYS:
            value = _number(block.get(key))
            if value is not None:
                return {
                    "value_nm": value * to_nm,
                    "reported_key": key,
                    "provenance": str(envelope.get("source") or "model"),
                }
    return None


def _categorical(name: str, envelope: Any, probability_keys: tuple[str, ...]) -> dict[str, Any] | None:
    """Describe a probability/class signal that cannot become a margin."""
    if not isinstance(envelope, dict):
        return None
    prediction = envelope.get("prediction") if isinstance(envelope.get("prediction"), dict) else {}
    probability = None
    for key in probability_keys:
        probability = _number(prediction.get(key)) or _number(envelope.get(key))
        if probability is not None:
            break
    signal = None
    for key in ("signal", "class", "risk_class", "band", "level"):
        candidate = prediction.get(key) or envelope.get(key)
        if isinstance(candidate, str) and candidate:
            signal = candidate
            break
    if probability is None and signal is None:
        return None
    active = bool(signal and any(token in signal.lower() for token in _ACTIVE_TOKENS))
    if probability is not None and probability >= 0.5:
        active = True
    return {
        "name": name,
        "probability": round(probability, 4) if probability is not None else None,
        "signal": signal,
        "active": active,
        "why_not_a_margin": (
            "This endpoint returns a classification probability, not a "
            "concentration. A margin requires a measured IC50 or CC50."
        ),
    }


def rank_therapeutic_index(
    *,
    pd_coupling: dict[str, Any] | None,
    safety_stage: dict[str, Any] | None,
    cytotoxicity: dict[str, Any] | None = None,
    measured_safety_concentrations: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Rank every computable margin and name what blocks the rest."""
    pd_result = pd_coupling or {}
    if pd_result.get("available") is not True:
        return {
            "available": False,
            "source": "insufficient-input",
            "reason": (
                "No efficacy concentration anchor is available, so no margin can "
                "be formed. Target engagement (Stage 7) must succeed first."
            ),
            "missing": ["efficacy anchor from Stage 7 target engagement"],
            "owner": "hakase_smallmol.l2.therapeutic_index",
        }

    # Efficacy anchor: the unbound concentration required for 50% occupancy.
    # By definition of the Clark relationship that concentration equals Kd.
    required = pd_result.get("required_unbound_concentrations") or []
    efficacy = next(
        (item for item in required if item.get("occupancy_fraction") == 0.5),
        None,
    )
    efficacy_nm = _number((efficacy or {}).get("unbound_concentration_nm"))
    if efficacy_nm is None:
        return {
            "available": False,
            "source": "insufficient-input",
            "reason": "The Stage 7 efficacy anchor did not return a 50% occupancy concentration.",
            "missing": ["50% occupancy unbound concentration"],
            "owner": "hakase_smallmol.l2.therapeutic_index",
        }

    affinity = pd_result.get("affinity_anchor") or {}
    efficacy_anchor = {
        "label": "Unbound concentration for 50% target occupancy",
        "value_nm": efficacy_nm,
        "provenance": affinity.get("provenance"),
        "source": affinity.get("source"),
        "is_apparent": bool(affinity.get("affinity_is_apparent")),
    }

    safety = safety_stage or {}
    overrides = measured_safety_concentrations or {}

    # Candidate safety anchors, in the order a reviewer would read them.
    candidates: list[dict[str, Any]] = [
        {
            "id": "herg",
            "label": "hERG cardiac margin",
            "envelope": safety.get("cardiotox"),
            "override_key": "herg_ic50_nm",
            "required_measurement": "a measured hERG IC50 (patch-clamp, nM)",
            "probability_keys": ("blocker_probability", "herg_probability", "probability"),
        },
        {
            "id": "cytotoxicity",
            "label": "General cytotoxicity margin",
            "envelope": cytotoxicity,
            "override_key": "cytotoxicity_cc50_nm",
            "required_measurement": "a measured cytotoxicity CC50 (nM)",
            "probability_keys": ("probability",),
        },
        {
            "id": "dili",
            "label": "Hepatotoxicity margin",
            "envelope": safety.get("dili_ml"),
            "override_key": "dili_ic50_nm",
            "required_measurement": (
                "a concentration-anchored hepatocyte toxicity readout (e.g. an "
                "IC50 for ATP depletion or BSEP inhibition, nM)"
            ),
            "probability_keys": ("dili_probability", "probability"),
        },
        {
            "id": "mutagenicity",
            "label": "Mutagenicity margin",
            "envelope": safety.get("ames_ml"),
            "override_key": "ames_ic50_nm",
            "required_measurement": (
                "Ames is a hazard call, not a potency; no concentration margin "
                "exists for it by design"
            ),
            "probability_keys": ("mutagenic_probability", "probability"),
        },
    ]

    computed: list[dict[str, Any]] = []
    not_computable: list[dict[str, Any]] = []
    categorical: list[dict[str, Any]] = []

    for candidate in candidates:
        override = _number(overrides.get(candidate["override_key"]))
        found = (
            {"value_nm": override, "reported_key": candidate["override_key"], "provenance": "measured"}
            if override is not None
            else extract_concentration_nm(candidate["envelope"])
        )
        signal = _categorical(candidate["label"], candidate["envelope"], candidate["probability_keys"])
        if found is not None:
            margin = found["value_nm"] / efficacy_nm
            computed.append(
                {
                    "id": candidate["id"],
                    "label": candidate["label"],
                    "safety_concentration_nm": round(found["value_nm"], 4),
                    "efficacy_concentration_nm": round(efficacy_nm, 4),
                    "margin_fold": round(margin, 3),
                    "safety_provenance": found["provenance"],
                    "efficacy_provenance": affinity.get("provenance"),
                    **_band(margin),
                }
            )
        else:
            not_computable.append(
                {
                    "id": candidate["id"],
                    "label": candidate["label"],
                    "reason": "No numeric safety concentration was returned by the backend model.",
                    "required_measurement": candidate["required_measurement"],
                }
            )
            if signal is not None:
                categorical.append(signal)

    # Tox21 assays are a panel of classifications; they are summarised, never ranked.
    tox21 = safety.get("tox21")
    if isinstance(tox21, dict) and tox21.get("available") is not False:
        summary = tox21.get("summary") or {}
        flagged = summary.get("n_flagged_in_domain")
        if flagged is not None:
            categorical.append(
                {
                    "name": "Tox21 nuclear-receptor / stress-response panel",
                    "probability": None,
                    "signal": f"{flagged} in-domain flag(s) of {summary.get('n_assays_evaluated')} assays",
                    "active": bool(_number(flagged)),
                    "why_not_a_margin": (
                        "Tox21 assays report qHTS activity calls. They are hazard "
                        "identification, not a potency that can be divided by an "
                        "efficacy concentration."
                    ),
                }
            )

    computed.sort(key=lambda item: item["margin_fold"])
    limiting = computed[0] if computed else None

    return {
        "available": True,
        "source": "therapeutic-index",
        "owner": "hakase_smallmol.l2.therapeutic_index",
        "efficacy_anchor": efficacy_anchor,
        "computed_margins": computed,
        "limiting_margin": limiting,
        "not_computable": not_computable,
        "categorical_liabilities": categorical,
        "coverage": {
            "margins_computed": len(computed),
            "margins_blocked": len(not_computable),
            "note": (
                "Only ratios of two real concentrations are ranked. Endpoints "
                "returning a probability are listed separately and are never "
                "converted into a margin."
            ),
        },
        "limitations": [
            "Margins use the unbound concentration for 50% target occupancy as "
            "the efficacy denominator. That is a target-engagement anchor, not a "
            "demonstrated efficacious exposure in a disease model.",
            "Safety concentrations and the efficacy concentration must share an "
            "unbound basis. A safety IC50 reported in a protein-containing assay "
            "buffer is not unbound and will overstate the margin.",
        ]
        + (
            [
                "The efficacy anchor is an apparent potency (IC50/EC50), not an "
                "equilibrium Kd, so every margin below is apparent."
            ]
            if efficacy_anchor["is_apparent"]
            else []
        ),
    }
