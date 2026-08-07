import dataclasses
import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.integrate import solve_ivp

from hakase_kernel.pbpk.contract import DispositionParameters, Quantity
from hakase_kernel.pbpk.model import (
    COMPARTMENTS,
    ClearanceLaw,
    TransportLaw,
    build_flows,
    build_volumes,
    pbpk_deriv,
)
from hakase_kernel.pbpk.physiology.store import ScaledPhysiology


def _sample_quantity(qty: Quantity, rng: np.random.Generator) -> float:
    lo, hi = qty.ci_low, qty.ci_high
    val = qty.value
    if (
        lo is not None
        and hi is not None
        and lo > 0
        and hi > 0
        and math.isfinite(lo)
        and math.isfinite(hi)
    ):
        # Assume lo and hi represent 5th and 95th percentiles of a log-normal distribution
        # Z_0.95 = 1.64485
        mu = (math.log(hi) + math.log(lo)) / 2.0
        sigma = (math.log(hi) - math.log(lo)) / (2.0 * 1.6448536269514722)
        if sigma > 0:
            return rng.lognormal(mean=mu, sigma=sigma)
    return val


def sample_disposition(
    disp: DispositionParameters, rng: np.random.Generator
) -> DispositionParameters:
    def _repack(q: Quantity) -> Quantity:
        v = _sample_quantity(q, rng)
        return Quantity(
            value=v,
            units=q.units,
            provenance=q.provenance,
            source=q.source,
            ci_low=None,
            ci_high=None,
        )

    return dataclasses.replace(
        disp,
        fu_plasma=_repack(disp.fu_plasma),
        fu_blood=_repack(disp.fu_blood),
        blood_plasma_ratio=_repack(disp.blood_plasma_ratio),
        cl_hepatic=_repack(disp.cl_hepatic),
        cl_renal=_repack(disp.cl_renal),
        cl_total=_repack(disp.cl_total),
        kp={org: _repack(q) for org, q in disp.kp.items()},
        vdss=_repack(disp.vdss),
        extraction_ratio=_repack(disp.extraction_ratio),
        hepatic_first_pass=_repack(disp.hepatic_first_pass),
    )


def sample_physiology(
    phys: ScaledPhysiology, rng: np.random.Generator, bw_cv: float = 0.15
) -> ScaledPhysiology:
    bw_base = phys.body_weight_kg
    sigma_bw = math.sqrt(math.log(1 + bw_cv**2))
    mu_bw = math.log(bw_base) - 0.5 * sigma_bw**2
    bw_sampled = rng.lognormal(mean=mu_bw, sigma=sigma_bw)

    scale_flow = (bw_sampled / bw_base) ** 0.75
    scale_vol = bw_sampled / bw_base

    flows = {k: v * scale_flow for k, v in phys.organ_blood_flow_ml_min.items()}
    vols = {k: v * scale_vol for k, v in phys.organ_volume_l.items()}

    return dataclasses.replace(
        phys,
        body_weight_kg=bw_sampled,
        cardiac_output_ml_min=phys.cardiac_output_ml_min * scale_flow,
        blood_volume_l=phys.blood_volume_l * scale_vol,
        organ_blood_flow_ml_min=flows,
        organ_volume_l=vols,
    )


def _run_single_animal(
    disp: DispositionParameters,
    phys: ScaledPhysiology,
    transport_law: TransportLaw,
    clearance_law: ClearanceLaw,
    forcing_model_factory: Callable[[ScaledPhysiology], Any],
    time_eval: np.ndarray,
    **solve_ivp_kwargs,
):
    V = build_volumes(phys)
    Q = build_flows(phys)
    forcing_model = forcing_model_factory(phys)

    def deriv_with_input(t, y):
        dydt = pbpk_deriv(t, y, V, Q, disp, phys, transport_law, clearance_law)
        if hasattr(forcing_model, "get_input_rate"):
            inputs = forcing_model.get_input_rate(t)
            for comp, rate in inputs.items():
                if comp in COMPARTMENTS:
                    idx = COMPARTMENTS.index(comp)
                    dydt[idx] += rate
        return dydt

    y0 = np.zeros(len(COMPARTMENTS))
    if hasattr(forcing_model, "get_initial_amounts"):
        initial = forcing_model.get_initial_amounts()
        for comp, amt in initial.items():
            if comp in COMPARTMENTS:
                idx = COMPARTMENTS.index(comp)
                y0[idx] += amt

    # Tight tolerances for the stiff 13-compartment system (see run_pbpk_model);
    # holds mass conservation and AUC/Vss accuracy. Overridable via solve_ivp_kwargs.
    kwargs = {"method": "Radau", "rtol": 1e-6, "atol": 1e-9, "t_eval": time_eval}
    kwargs.update(solve_ivp_kwargs)

    res = solve_ivp(deriv_with_input, (time_eval[0], time_eval[-1]), y0, **kwargs)
    return res, V, Q


def _steady_state_vss_l_per_kg(
    disp: DispositionParameters, V: dict[str, float], phys: ScaledPhysiology
) -> float:
    """Plasma-referenced steady-state volume of distribution (L/kg).

    In the perfusion-limited model, at steady state the amount in a tissue is
    ``V_t·Kp_t·C_plasma`` and the amount in blood is ``V_blood·BPR·C_plasma``
    (blood conc = plasma·BPR). Summing and dividing by ``C_plasma`` gives

        Vss = Σ_tissue V_t·Kp_t + V_blood·BPR          (L, plasma-referenced)

    Kp defaults to 1.0 where a tissue has no value. Divided by body weight → L/kg,
    directly comparable to observed steady-state Vd.
    """
    bpr = disp.blood_plasma_ratio.value if disp.blood_plasma_ratio else 1.0
    vss_l = 0.0
    for comp, v in V.items():
        if comp in ("arterial_blood", "venous_blood"):
            vss_l += v * bpr
        else:
            kp = disp.kp[comp].value if (disp.kp and comp in disp.kp) else 1.0
            vss_l += v * kp
    bw = phys.body_weight_kg
    return vss_l / bw if bw > 0 else 0.0


def run_virtual_cohort(
    n_animals: int,
    seed: int,
    disp_base: DispositionParameters,
    phys_base: ScaledPhysiology,
    transport_law: TransportLaw,
    clearance_law: ClearanceLaw,
    forcing_model_factory: Callable[[ScaledPhysiology], Any],
    time_eval: np.ndarray,
    bw_cv: float = 0.15,
    **solve_ivp_kwargs,
) -> dict[str, Any]:
    """
    Sample N virtual animals from real physiological parameter distributions and
    run Monte-Carlo over the DispositionParameters uncertainty.
    Aggregates per-endpoint medians + 90% intervals and mean/CI concentration-time curves.
    """
    rng = np.random.default_rng(seed)
    all_c = {comp: [] for comp in COMPARTMENTS}
    endpoints = {
        comp: {"c_max": [], "t_max": [], "auc": [], "cl": [], "vss": [], "t_half": []}
        for comp in COMPARTMENTS
    }

    for _ in range(n_animals):
        disp = sample_disposition(disp_base, rng)
        phys = sample_physiology(phys_base, rng, bw_cv=bw_cv)

        res, V, Q = _run_single_animal(
            disp,
            phys,
            transport_law,
            clearance_law,
            forcing_model_factory,
            time_eval,
            **solve_ivp_kwargs,
        )

        forcing_model = forcing_model_factory(phys)
        dose = getattr(forcing_model, "dose", None)

        for i, comp in enumerate(COMPARTMENTS):
            c_comp = res.y[i, :] / V[comp]
            all_c[comp].append(c_comp)

            c_max = np.max(c_comp)
            t_max = res.t[np.argmax(c_comp)]
            auc = np.trapz(c_comp, res.t)

            endpoints[comp]["c_max"].append(c_max)
            endpoints[comp]["t_max"].append(t_max)
            endpoints[comp]["auc"].append(auc)

            if dose is not None and auc > 0:
                endpoints[comp]["cl"].append(dose / auc)

        # Steady-state volume of distribution — a single whole-body scalar, not a
        # per-compartment quantity. Stored on venous_blood (aliased to plasma).
        # NB: the previous code stored V[comp] (the blood COMPARTMENT volume) as
        # "vss", which is not a volume of distribution; t_half derived from it was
        # therefore also wrong.
        vss_l_per_kg = _steady_state_vss_l_per_kg(disp, V, phys)
        endpoints["venous_blood"]["vss"].append(vss_l_per_kg)
        ven_idx = COMPARTMENTS.index("venous_blood")
        ven_auc = np.trapz(res.y[ven_idx, :] / V["venous_blood"], res.t)
        if dose is not None and ven_auc > 0 and phys.body_weight_kg > 0:
            cl_plasma = dose / ven_auc  # L/min
            if cl_plasma > 0:
                vss_l = vss_l_per_kg * phys.body_weight_kg
                endpoints["venous_blood"]["t_half"].append(math.log(2) * vss_l / cl_plasma)

    results = {
        "time": time_eval.tolist(),
        "curves": {},
        "endpoints": {},
    }

    for comp in COMPARTMENTS:
        comp_curves = np.array(all_c[comp])
        results["curves"][comp] = {
            "mean": np.mean(comp_curves, axis=0).tolist(),
            "p05": np.percentile(comp_curves, 5, axis=0).tolist(),
            "p95": np.percentile(comp_curves, 95, axis=0).tolist(),
        }

        comp_endpoints = {}
        for ep, values in endpoints[comp].items():
            if not values:
                continue
            arr = np.array(values)
            comp_endpoints[ep] = {
                "median": float(np.median(arr)),
                "p05": float(np.percentile(arr, 5)),
                "p95": float(np.percentile(arr, 95)),
            }
        results["endpoints"][comp] = comp_endpoints

    # Alias venous_blood to plasma for UI convenience
    if "venous_blood" in results["curves"]:
        results["curves"]["plasma"] = results["curves"]["venous_blood"]
        results["endpoints"]["plasma"] = results["endpoints"]["venous_blood"]

    return results
