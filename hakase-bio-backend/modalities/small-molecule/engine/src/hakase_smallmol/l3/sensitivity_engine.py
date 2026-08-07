"""Local one-at-a-time sensitivity of the PK metrics to disposition inputs.

Exposure AUC ∝ dose / CL, so the drivers of the exposure prediction are the
drivers of clearance and distribution. This runs a cheap, exact local
sensitivity on the deterministic IVIVE core (``compute_ivive`` — no ODE, no ML)
by central-differencing each input, giving normalised sensitivity coefficients

    S_p = (Δoutput / output) / (Δinput / input)

for total clearance and half-life. |S| ≈ 1 → proportional driver; |S| ≈ 0 →
negligible. This tells the scientist which measurement would most tighten the
prediction — the value-of-information the stage gate cites.
"""

from __future__ import annotations

from typing import Any


def _base_ivive_args(arm_result: dict[str, Any]) -> dict[str, Any] | None:
    ivive = arm_result.get("ivive") or {}
    inputs = ivive.get("inputs") or {}
    system = ivive.get("system_parameters") or {}

    def _v(block: Any) -> float | None:
        return (block or {}).get("value") if isinstance(block, dict) else None

    clint = _v(inputs.get("clint_hep_ul_min_1e6"))
    fu = _v(inputs.get("fu_plasma"))
    vdss = _v(inputs.get("vdss_l_per_kg"))
    if clint is None or fu is None:
        return None
    return {
        "clint_hep_ul_min_1e6": clint,
        "fu_plasma": fu,
        "vdss_l_per_kg": vdss,
        "body_weight_kg": _v(system.get("body_weight_kg")) or 0.25,
        "blood_plasma_ratio": _v(system.get("blood_plasma_ratio")) or 1.0,
        "q_h_ml_min_kg": _v(system.get("hepatic_blood_flow_ml_min_kg")) or 20.7,
        "hpgl_1e6_per_g": _v(system.get("hepatocellularity_1e6_per_g")) or 99.0,
        "liver_g_per_kg": _v(system.get("liver_weight_g_per_kg")) or 25.7,
    }


def _metric(out: dict[str, Any], key: str) -> float | None:
    v = out.get(key)
    return float(v) if isinstance(v, (int, float)) else None


def compute_sensitivity(
    arm_result: dict[str, Any],
    *,
    perturbation: float = 0.2,
) -> dict[str, Any]:
    """OAT sensitivity of hepatic CL and half-life to the disposition inputs."""
    from hakase_smallmol.pk_ivive.pk_ivive import compute_ivive

    base = _base_ivive_args(arm_result)
    if base is None:
        return {"available": False, "reason": "No IVIVE disposition inputs to perturb."}

    metrics = ("cl_hepatic_plasma_l_h", "half_life_h")
    # Inputs to perturb, and which metrics they can move.
    inputs = ("clint_hep_ul_min_1e6", "fu_plasma", "vdss_l_per_kg", "q_h_ml_min_kg")

    try:
        base_out = compute_ivive(**base)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"Baseline IVIVE failed: {exc}"}
    base_metrics = {m: _metric(base_out, m) for m in metrics}

    coefficients: dict[str, dict[str, float | None]] = {}
    for inp in inputs:
        if base.get(inp) is None or base[inp] == 0:
            continue
        hi = dict(base)
        lo = dict(base)
        hi[inp] = base[inp] * (1.0 + perturbation)
        lo[inp] = base[inp] * (1.0 - perturbation)
        try:
            out_hi = compute_ivive(**hi)
            out_lo = compute_ivive(**lo)
        except Exception:  # noqa: BLE001
            continue
        coefficients[inp] = {}
        for m in metrics:
            y0 = base_metrics.get(m)
            yh = _metric(out_hi, m)
            yl = _metric(out_lo, m)
            if y0 and yh is not None and yl is not None and y0 != 0:
                # Central difference normalised sensitivity coefficient.
                s = ((yh - yl) / y0) / (2.0 * perturbation)
                coefficients[inp][m] = round(s, 3)
            else:
                coefficients[inp][m] = None

    # Rank inputs by their strongest absolute influence on any metric.
    ranking = sorted(
        (
            (inp, max((abs(v) for v in coeffs.values() if v is not None), default=0.0))
            for inp, coeffs in coefficients.items()
        ),
        key=lambda kv: kv[1],
        reverse=True,
    )

    return {
        "available": bool(coefficients),
        "perturbation": perturbation,
        "metrics": list(metrics),
        "sensitivity_coefficients": coefficients,
        "ranking": [{"input": inp, "max_abs_sensitivity": round(v, 3)} for inp, v in ranking],
        "dominant_driver": ranking[0][0] if ranking else None,
        "model": "Central-difference local sensitivity on the deterministic IVIVE core",
        "provenance": "derived",
        "limitations": (
            "Local (±20%) sensitivity around the point estimate; captures first-order drivers of "
            "clearance/half-life, not global interactions or absorption-side sensitivity."
        ),
    }


__all__ = ["compute_sensitivity"]
