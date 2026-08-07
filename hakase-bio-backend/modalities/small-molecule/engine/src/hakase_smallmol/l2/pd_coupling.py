"""Layer-2 Stage 7 — target-engagement (PD) coupling.

What this module computes
-------------------------
Equilibrium fractional receptor occupancy under the Clark/Hill relationship

    phi(Cu) = Cu^n / (Cu^n + Kd^n)

and its inverse, the unbound concentration required to reach a named occupancy

    Cu(phi) = Kd * (phi / (1 - phi))^(1/n)

with ``n = 1`` unless a Hill coefficient is supplied.  A Hill coefficient is
never inferred: cooperativity is a measured property, and assuming n != 1 would
change every derived concentration.

What this module deliberately does NOT compute
----------------------------------------------
An **effect** magnitude.  The Black & Leff (1983) operational model relates
occupancy to response through a transducer ratio ``tau``

    E / Emax = tau * phi / (1 + tau * phi)

``tau`` is a system-and-tissue property that this platform has no measurement
for.  Rather than silently collapsing to the direct-link special case
(``E/Emax = phi``, which is only true for a system with no receptor reserve),
the direct-link projection is returned *labelled as an assumption* and the
absence of ``tau`` is reported as an explicit limitation.

Affinity provenance
-------------------
Kd is taken in this precedence order:

1. A measured Layer-1 target evidence value whose activity type is ``Kd`` or
   ``Ki`` — used directly (Ki == Kd for a competitive reversible ligand at
   equilibrium).
2. A measured Layer-1 ``IC50``/``EC50`` — used as an *apparent* potency anchor
   only.  Converting IC50 to Ki requires the Cheng-Prusoff correction, which
   needs the assay substrate concentration and Km.  Neither is recorded, so the
   value is carried with ``affinity_is_apparent = True`` and every derived
   concentration inherits that caveat.
3. The BindingML predicted ``Kd_nM`` — provenance ``ml``.

If none is available the stage returns ``available = False`` with the missing
quantities named.  No occupancy is produced from a guessed affinity.
"""

from __future__ import annotations

from typing import Any

# Occupancy levels reported for every run. 0.5 is the definitional Kd anchor;
# 0.8/0.9 are the levels most commonly cited as a target-engagement objective
# for a reversible inhibitor. They are reporting choices, not thresholds that
# gate a decision.
REPORTED_OCCUPANCIES: tuple[float, ...] = (0.5, 0.8, 0.9)

# Activity types that measure an equilibrium dissociation constant directly.
_EQUILIBRIUM_TYPES = frozenset({"KD", "KI"})
# Activity types that measure an apparent, assay-condition-dependent potency.
_APPARENT_TYPES = frozenset({"IC50", "EC50"})


def _number(value: Any) -> float | None:
    """Return a finite positive float, or None. Booleans are not numbers here."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")) or result <= 0:
        return None
    return result


def occupancy_at(cu_nm: float, kd_nm: float, hill: float = 1.0) -> float:
    """Fractional occupancy at an unbound concentration (Clark / Hill)."""
    numerator = cu_nm**hill
    return numerator / (numerator + kd_nm**hill)


def concentration_for_occupancy(fraction: float, kd_nm: float, hill: float = 1.0) -> float:
    """Unbound concentration required for a named fractional occupancy."""
    return kd_nm * (fraction / (1.0 - fraction)) ** (1.0 / hill)


def _resolve_affinity(
    target_evidence: dict[str, Any] | None,
    binding_ml: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Select the affinity anchor and record exactly where it came from."""
    evidence = target_evidence or {}
    measured = _number(evidence.get("value_nM"))
    activity_type = str(evidence.get("activity_type") or "").upper().replace(" ", "")

    if measured is not None and activity_type in _EQUILIBRIUM_TYPES:
        return {
            "kd_nm": measured,
            "activity_type": activity_type,
            "provenance": "measured",
            "source": "Layer 1 target evidence (ChEMBL measured activity)",
            "affinity_is_apparent": False,
            "caveat": None,
        }

    if measured is not None and activity_type in _APPARENT_TYPES:
        return {
            "kd_nm": measured,
            "activity_type": activity_type,
            "provenance": "measured",
            "source": "Layer 1 target evidence (ChEMBL measured activity)",
            "affinity_is_apparent": True,
            "caveat": (
                f"The anchor is a measured {activity_type}, not an equilibrium Kd. "
                "Cheng-Prusoff correction to Ki requires the assay substrate "
                "concentration and Km, neither of which is recorded, so every "
                "concentration below is apparent rather than thermodynamic."
            ),
        }

    prediction = (binding_ml or {}).get("prediction") or {}
    predicted = _number(prediction.get("Kd_nM"))
    if predicted is not None:
        domain = (binding_ml or {}).get("applicability_domain") or {}
        caveat = (
            "The anchor is a model prediction, not a measurement. Occupancy "
            "concentrations inherit the full uncertainty of the affinity model."
        )
        if domain.get("verdict") == "out_of_domain":
            caveat = (
                "The anchor is a model prediction made outside the model's "
                f"applicability domain. {domain.get('rationale') or ''} Every "
                "concentration below is an extrapolation and should be treated as "
                "a ranking signal only."
            ).strip()
        return {
            "kd_nm": predicted,
            "activity_type": "Kd",
            "provenance": "ml",
            "source": "BindingML predicted affinity",
            "affinity_is_apparent": False,
            "applicability_domain": domain.get("verdict"),
            "applicability_rationale": domain.get("rationale"),
            "caveat": caveat,
        }
    return None


def _unbound_fraction(l1: dict[str, Any]) -> dict[str, Any] | None:
    """Derive fu,plasma from the Layer-1 ADMET plasma-protein-binding readout."""
    endpoints = l1.get("admet_endpoints") or {}
    bound_percent = (endpoints.get("PPBR_AZ") or {}).get("model_value")
    if isinstance(bound_percent, bool) or not isinstance(bound_percent, (int, float)):
        return None
    fu = 1.0 - float(bound_percent) / 100.0
    if fu <= 0.0 or fu > 1.0:
        return None
    return {
        "value": round(fu, 6),
        "percent_bound": round(float(bound_percent), 3),
        "provenance": "ml",
        "source": "ADMET-AI PPBR_AZ (plasma protein bound %)",
    }


def _exposure_anchor(ivive: dict[str, Any] | None) -> dict[str, Any] | None:
    """Read the total plasma concentration anchor produced by the IVIVE stage.

    Only the IV-bolus C0 is used, because it is the one concentration the IVIVE
    module derives without assuming an absorption rate constant. mg/L is
    converted to nM with the molecular weight, which is why MW is required.
    """
    exposure = (ivive or {}).get("exposure") or {}
    c0 = _number(exposure.get("c0_mg_per_l"))
    if c0 is None:
        return None
    return {
        "c_total_mg_per_l": c0,
        "dose_mg": exposure.get("dose_mg"),
        "route": exposure.get("route"),
        "basis": "IV-bolus C0 from the IVIVE projection (CL and Vss determined)",
    }


def predict_pd_coupling(
    *,
    l1: dict[str, Any],
    binding_ml: dict[str, Any] | None = None,
    ivive: dict[str, Any] | None = None,
    hill_coefficient: float | None = None,
) -> dict[str, Any]:
    """Project target engagement from affinity, protein binding and exposure."""
    missing: list[str] = []

    affinity = _resolve_affinity(l1.get("target_evidence"), binding_ml)
    if affinity is None:
        missing.append(
            "target affinity (no measured Kd/Ki/IC50 in the Layer 1 target "
            "evidence and no BindingML prediction)"
        )

    fu = _unbound_fraction(l1)
    if fu is None:
        missing.append("unbound plasma fraction (ADMET PPBR_AZ was not returned)")

    if affinity is None:
        return {
            "available": False,
            "source": "insufficient-input",
            "reason": "Target engagement cannot be projected without an affinity anchor.",
            "missing": missing,
            "owner": "hakase_smallmol.l2.pd_coupling",
        }

    hill = _number(hill_coefficient) or 1.0
    kd = affinity["kd_nm"]

    # Dose-independent core: the unbound concentration each occupancy requires.
    required = [
        {
            "occupancy_fraction": fraction,
            "occupancy_percent": round(fraction * 100.0, 1),
            "unbound_concentration_nm": round(
                concentration_for_occupancy(fraction, kd, hill), 4
            ),
        }
        for fraction in REPORTED_OCCUPANCIES
    ]

    result: dict[str, Any] = {
        "available": True,
        "source": "pd-coupling",
        "owner": "hakase_smallmol.l2.pd_coupling",
        "model": {
            "name": "Equilibrium receptor occupancy (Clark / Hill)",
            "equation": "phi = Cu^n / (Cu^n + Kd^n)",
            "hill_coefficient": hill,
            "hill_coefficient_provenance": (
                "supplied" if hill_coefficient is not None else "assumed n = 1 (no cooperativity evidence)"
            ),
        },
        "affinity_anchor": affinity,
        "unbound_fraction": fu,
        "required_unbound_concentrations": required,
        "limitations": [
            "Occupancy is an equilibrium projection. It assumes the unbound "
            "plasma concentration equals the unbound concentration at the target "
            "site; that equality does not hold where a transporter, an "
            "intracellular target or a blood-tissue barrier is involved.",
            "No effect magnitude is computed. The operational model requires a "
            "transducer ratio (tau) describing receptor reserve, which this "
            "platform does not measure. Occupancy is not response.",
        ],
    }

    if affinity.get("caveat"):
        result["limitations"].insert(0, affinity["caveat"])

    # Exposure-dependent extension: only when the IVIVE stage produced a
    # concentration and the Layer-1 record carries a molecular weight to
    # convert mg/L into nM.
    exposure = _exposure_anchor(ivive)
    molecular_weight = _number((l1.get("descriptors") or {}).get("molecular_weight_da"))
    if exposure is None:
        result["achieved_engagement"] = {
            "available": False,
            "reason": (
                "No exposure was projected. Supply a dose to the IVIVE stage to "
                "convert these concentrations into an achieved occupancy."
            ),
        }
        return result
    if molecular_weight is None:
        result["achieved_engagement"] = {
            "available": False,
            "reason": "Molecular weight was not returned by Layer 1, so mg/L cannot be converted to nM.",
        }
        return result
    if fu is None:
        result["achieved_engagement"] = {
            "available": False,
            "reason": "Unbound plasma fraction was not returned, so a total concentration cannot be made unbound.",
        }
        return result

    # mg/L / (g/mol) = mmol/L  ->  * 1e6 = nmol/L
    c_total_nm = exposure["c_total_mg_per_l"] / molecular_weight * 1e6
    cu_nm = c_total_nm * fu["value"]
    phi = occupancy_at(cu_nm, kd, hill)
    result["achieved_engagement"] = {
        "available": True,
        "dose_mg": exposure.get("dose_mg"),
        "route": exposure.get("route"),
        "basis": exposure["basis"],
        "total_concentration_nm": round(c_total_nm, 4),
        "unbound_concentration_nm": round(cu_nm, 4),
        "cu_over_kd": round(cu_nm / kd, 4),
        "occupancy_fraction": round(phi, 5),
        "occupancy_percent": round(phi * 100.0, 2),
        "direct_link_effect_fraction": round(phi, 5),
        "direct_link_note": (
            "Effect fraction shown under the direct-link assumption (response "
            "proportional to occupancy, i.e. no receptor reserve). It is an "
            "assumption made explicit, not a predicted response."
        ),
    }
    return result
