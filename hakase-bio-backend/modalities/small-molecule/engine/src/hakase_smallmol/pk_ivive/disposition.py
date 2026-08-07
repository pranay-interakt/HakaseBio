"""Assemble the ``DispositionParameters`` contract for a small molecule (S1-T6).

This is the Stage-1 exit: it collapses the disposition front-end's outputs into
the single ``DispositionParameters`` object (the S1-T1 kernel contract) that the
Stage-2 tissue-PBPK ODE will consume. It wires together:

  * the extended IVIVE readout (S1-T5) — fu, the CL split (hepatic / renal /
    total), extraction ratio, hepatic first-pass, VDss, species context, and the
    Monte-Carlo intervals when present;
  * the Rodgers & Rowland Kp per organ (S1-T3);
  * an applicability-domain verdict (S1-T4).

It also runs the **Kp-derived Vss cross-check** — ``Vss = Vplasma + Σ Vtissue·Kp``
— against the ML ``VDss_Lombardo`` and flags divergence beyond ~2–3× (mirroring
the existing IVIVE Obach t½ cross-check). The cross-check is recorded in the
contract's modality-extension metadata.

Modality file: consumes RDKit-derived logP indirectly (via the Kp inputs) and
the kernel contract/store; nothing kernel-forbidden is imported.
"""

from __future__ import annotations

from typing import Any

from hakase_kernel.pbpk.contract import (
    ApplicabilityDomain,
    DispositionParameters,
    ModalityExtension,
    Provenance,
    Quantity,
    SpeciesContext,
)
from hakase_smallmol.pk_ivive.kp import KpResult

# --------------------------------------------------------------------------- #
# Reference-human tissue volumes for the Vss cross-check (fraction of body
# weight ≈ L/kg, tissue density ~1). These are used ONLY for the Vss consistency
# check against the (human) ML VDss — a 2–3× sanity gate, not a precision output.
# Source: Brown R.P. et al. (1997) Toxicol Ind Health 13:407; ICRP 89.
# --------------------------------------------------------------------------- #
HUMAN_TISSUE_VOLUME_L_PER_KG: dict[str, float] = {
    "adipose": 0.2142,
    "bone": 0.0856,
    "brain": 0.0200,
    "gut": 0.0171,
    "heart": 0.0047,
    "kidney": 0.0044,
    "liver": 0.0257,
    "lung": 0.0076,
    "muscle": 0.4000,
    "pancreas": 0.0010,
    "skin": 0.0371,
    "spleen": 0.0026,
}

# Default divergence gate for the Vss cross-check (fold). ~2–3×; 3.0 chosen.
DEFAULT_VSS_FOLD_THRESHOLD = 3.0


def _human_plasma_volume_l_per_kg() -> float:
    """Plasma volume fraction from the kernel store: blood·(1 − hematocrit)."""
    from hakase_kernel.pbpk.physiology import store

    h = store.SPECIES_PHYSIOLOGY[("human", "reference")]
    return h.blood_volume_fraction * (1.0 - h.hematocrit)


def vss_crosscheck(
    kp_by_organ: dict[str, float],
    vdss_ml_l_per_kg: float,
    *,
    tissue_volumes: dict[str, float] | None = None,
    plasma_volume_l_per_kg: float | None = None,
    fold_threshold: float = DEFAULT_VSS_FOLD_THRESHOLD,
) -> dict[str, Any]:
    """Kp-derived ``Vss = Vplasma + Σ Vtissue·Kp`` vs the ML ``VDss``.

    Only organs present in both ``kp_by_organ`` and the tissue-volume table
    contribute. Returns the predicted Vss, the fold ratio to the ML value, and
    whether they agree within ``fold_threshold`` (both directions).
    """
    if vdss_ml_l_per_kg <= 0:
        raise ValueError(f"vdss_ml_l_per_kg must be > 0, got {vdss_ml_l_per_kg}")
    volumes = tissue_volumes if tissue_volumes is not None else HUMAN_TISSUE_VOLUME_L_PER_KG
    v_plasma = (
        plasma_volume_l_per_kg
        if plasma_volume_l_per_kg is not None
        else _human_plasma_volume_l_per_kg()
    )

    tissue_sum = 0.0
    used: list[str] = []
    for organ, kp in kp_by_organ.items():
        v = volumes.get(organ)
        if v is not None:
            tissue_sum += v * kp
            used.append(organ)

    vss_pred = v_plasma + tissue_sum
    ratio = vss_pred / vdss_ml_l_per_kg
    within = (1.0 / fold_threshold) <= ratio <= fold_threshold
    return {
        "vss_predicted_l_per_kg": round(vss_pred, 4),
        "vss_ml_l_per_kg": round(vdss_ml_l_per_kg, 4),
        "plasma_volume_l_per_kg": round(v_plasma, 5),
        "fold_ratio": round(ratio, 3),
        "fold_threshold": fold_threshold,
        "within_fold": within,
        "diverges": not within,
        "organs_used": used,
        "note": (
            "Kp-derived Vss = Vplasma + Σ Vtissue·Kp (reference-human tissue volumes, "
            "Brown 1997) cross-checked against ML VDss_Lombardo; divergence beyond "
            f"{fold_threshold:g}× flags an inconsistency between the mechanistic Kp and the "
            "empirical VDss."
        ),
    }


def domain_from_verdict(verdict: Any) -> ApplicabilityDomain:
    """Build the contract's ``ApplicabilityDomain`` from an ad_distance verdict.

    Accepts an ``ad_distance.DomainVerdict`` (``.state``/``.score``) or a plain
    ``"in"``/``"edge"``/``"out"`` string.
    """
    if isinstance(verdict, str):
        return ApplicabilityDomain(verdict=verdict)
    state = getattr(verdict, "state", None)
    state_value = getattr(state, "value", state)
    return ApplicabilityDomain(
        verdict=str(state_value),
        score=getattr(verdict, "score", None),
        rationale=f"{getattr(verdict, 'metric', 'distance')} nearest-neighbour applicability domain",
    )


def _interval(uncertainty: dict[str, Any] | None, metric: str) -> tuple[float | None, float | None]:
    """Pull (ci_low, ci_high) for a metric from the S1-T5 Monte-Carlo block."""
    if not uncertainty:
        return (None, None)
    d = (uncertainty.get("distributions") or {}).get(metric)
    if not d:
        return (None, None)
    return (d.get("ci_low"), d.get("ci_high"))


def _qty(
    value: float,
    units: str,
    provenance: str,
    source: str,
    ci: tuple[float | None, float | None] = (None, None),
) -> Quantity:
    return Quantity(
        value=value, units=units, provenance=provenance, source=source, ci_low=ci[0], ci_high=ci[1]
    )


def assemble_disposition(
    ivive_result: dict[str, Any],
    kp_result: KpResult,
    *,
    applicability_domain: ApplicabilityDomain | Any,
    vss_fold_threshold: float = DEFAULT_VSS_FOLD_THRESHOLD,
) -> DispositionParameters:
    """Assemble a ``DispositionParameters`` from the IVIVE + Kp outputs.

    ``ivive_result`` is a successful :func:`pk_ivive.predict_pk_ivive` payload
    (``source == "ivive"``); ``kp_result`` is a :class:`kp.KpResult`;
    ``applicability_domain`` is the contract type or an ad_distance verdict.
    """
    if ivive_result.get("source") != "ivive":
        raise ValueError(
            f"ivive_result must be a successful IVIVE readout (source='ivive'), got "
            f"{ivive_result.get('source')!r}"
        )

    params = ivive_result["parameters"]
    inputs = ivive_result.get("inputs", {})
    sysp = ivive_result.get("system_parameters", {})
    uncertainty = ivive_result.get("uncertainty")

    fu_in = inputs.get("fu_plasma", {})
    fu_value = fu_in.get("value")
    fu_provenance = fu_in.get("provenance", Provenance.ML.value)
    vdss_in = inputs.get("vdss_l_per_kg", {})
    if vdss_in.get("value") is None or not (vdss_in["value"] > 0):
        raise ValueError(
            "DispositionParameters requires a VDss (vdss_l_per_kg); the IVIVE readout has "
            "no real VDss so the disposition contract cannot be completed."
        )
    r_bp = (sysp.get("blood_plasma_ratio") or {}).get("value", 1.0)
    r_bp_prov = (sysp.get("blood_plasma_ratio") or {}).get("provenance", "assumed")

    ad = (
        applicability_domain
        if isinstance(applicability_domain, ApplicabilityDomain)
        else domain_from_verdict(applicability_domain)
    )

    # --- Vss cross-check (only when an ML/measured VDss is available) ---------
    extension_metadata: dict[str, Any] = {}

    # --- Metabolic-clearance applicability guard ------------------------------
    # Carry the IVIVE metabolic-CL domain verdict into the contract so Stage-2
    # sees it. When the compound is a known transporter substrate (out of domain
    # for the well-stirred metabolic model), escalate the contract's AD verdict to
    # "out" — that verdict drives the no-fallback envelope, letting downstream
    # refuse rather than trust a confidently-wrong metabolic clearance. The
    # structural-AD verdict is preserved in the metadata alongside the reason.
    metabolic_domain = ivive_result.get("metabolic_clearance_domain")
    if isinstance(metabolic_domain, dict):
        extension_metadata["metabolic_clearance_domain"] = metabolic_domain
        if metabolic_domain.get("flagged"):
            base_rationale = ad.rationale
            reason = metabolic_domain.get("rationale") or "out of domain for metabolic clearance"
            ad = ApplicabilityDomain(
                verdict="out",
                score=ad.score,
                threshold=ad.threshold,
                rationale=(
                    f"Out of domain for metabolic clearance: {reason}"
                    + (f" (structural AD: {base_rationale})" if base_rationale else "")
                ),
            )
    if vdss_in.get("value") is not None and vdss_in["value"] > 0:
        extension_metadata["vss_crosscheck"] = vss_crosscheck(
            kp_result.kp, float(vdss_in["value"]), fold_threshold=vss_fold_threshold
        )

    # --- Species context ------------------------------------------------------
    species_context = SpeciesContext(
        species=ivive_result.get("species", "human"),
        strain=ivive_result.get("strain"),
        body_weight_kg=(sysp.get("body_weight_kg") or {}).get("value"),
    )

    # --- Core quantities ------------------------------------------------------
    kp_quantities = {
        organ: _qty(value, "unitless", Provenance.DERIVED.value, "Rodgers & Rowland Kp (S1-T3)")
        for organ, value in kp_result.kp.items()
    }

    vdss_provenance = vdss_in.get("provenance", Provenance.ML.value)

    disposition = DispositionParameters(
        fu_plasma=_qty(float(fu_value), "fraction", fu_provenance, fu_in.get("source", "IVIVE fu")),
        fu_blood=_qty(
            float(params["fu_blood"]),
            "fraction",
            Provenance.DERIVED.value,
            "fu_plasma / blood:plasma ratio",
        ),
        blood_plasma_ratio=_qty(float(r_bp), "ratio", r_bp_prov, "R_bp"),
        cl_hepatic=_qty(
            float(params["cl_hepatic_plasma_ml_min_kg"]),
            "mL/min/kg",
            Provenance.DERIVED.value,
            "well-stirred liver IVIVE (S1-T5)",
            _interval(uncertainty, "cl_hepatic_plasma_ml_min_kg"),
        ),
        cl_renal=_qty(
            float(params["cl_renal_plasma_ml_min_kg"]),
            "mL/min/kg",
            Provenance.DERIVED.value,
            "glomerular filtration GFR·fu (S1-T5)",
            _interval(uncertainty, "cl_renal_plasma_ml_min_kg"),
        ),
        cl_total=_qty(
            float(params["cl_total_plasma_ml_min_kg"]),
            "mL/min/kg",
            Provenance.DERIVED.value,
            "hepatic + renal (S1-T5)",
            _interval(uncertainty, "cl_total_plasma_ml_min_kg"),
        ),
        kp=kp_quantities,
        vdss=_qty(
            float(vdss_in["value"]),
            "L/kg",
            vdss_provenance,
            vdss_in.get("source", "VDss_Lombardo"),
        ),
        extraction_ratio=_qty(
            float(params["extraction_ratio_eh"]),
            "fraction",
            Provenance.DERIVED.value,
            "E_h = CL_blood / Q_h",
            _interval(uncertainty, "extraction_ratio_eh"),
        ),
        hepatic_first_pass=_qty(
            float(params["hepatic_first_pass_availability_fh"]),
            "fraction",
            Provenance.DERIVED.value,
            "F_h = 1 − E_h",
            _interval(uncertainty, "hepatic_first_pass_availability_fh"),
        ),
        species_context=species_context,
        applicability_domain=ad,
        modality_extension=ModalityExtension(
            modality="small-molecule", metadata=extension_metadata
        ),
    )
    return disposition


__all__ = [
    "HUMAN_TISSUE_VOLUME_L_PER_KG",
    "DEFAULT_VSS_FOLD_THRESHOLD",
    "vss_crosscheck",
    "domain_from_verdict",
    "assemble_disposition",
]
