"""
Multi-compartment perfusion-limited whole-body ODE for PBPK.
"""

from typing import Protocol

import numpy as np
from scipy.integrate import solve_ivp
from scipy.integrate._ivp.ivp import OdeResult

from hakase_kernel.pbpk.contract import DispositionParameters
from hakase_kernel.pbpk.physiology.store import ScaledPhysiology

COMPARTMENTS = [
    "arterial_blood",
    "venous_blood",
    "lung",
    "liver",
    "kidney",
    "heart",
    "brain",
    "muscle",
    "adipose",
    "skin",
    "gut",
    "spleen",
    "rest",
]


class TransportLaw(Protocol):
    def __call__(
        self,
        organ: str,
        A_tissue: float,
        V_tissue: float,
        C_in: float,
        Q_tissue: float,
        disp: DispositionParameters,
        phys: ScaledPhysiology,
    ) -> tuple[float, float]:
        """
        Compute transport rate and venous output concentration.

        Args:
            organ: Name of the compartment.
            A_tissue: Amount of drug in the compartment.
            V_tissue: Volume of the compartment (L).
            C_in: Incoming blood concentration (Amount / L).
            Q_tissue: Blood flow to the compartment (L / min).
            disp: DispositionParameters.
            phys: ScaledPhysiology.

        Returns:
            dA_dt: Net rate of change of drug amount from transport (Amount / min).
            C_out: Concentration in the venous blood leaving the compartment (Amount / L).
        """
        ...


class ClearanceLaw(Protocol):
    def __call__(
        self,
        organ: str,
        A_tissue: float,
        V_tissue: float,
        C_out: float,
        disp: DispositionParameters,
        phys: ScaledPhysiology,
    ) -> float:
        """
        Compute elimination rate.

        Args:
            organ: Name of the compartment.
            A_tissue: Amount of drug in the compartment.
            V_tissue: Volume of the compartment (L).
            C_out: Venous output concentration (Amount / L).
            disp: DispositionParameters.
            phys: ScaledPhysiology.

        Returns:
            elimination_rate: Rate of drug elimination (Amount / min).
        """
        ...


def build_volumes(phys: ScaledPhysiology) -> dict[str, float]:
    """Build organ volumes in Litres."""
    V = {
        "arterial_blood": phys.blood_volume_l / 3.0,
        "venous_blood": phys.blood_volume_l * 2.0 / 3.0,
    }
    sum_organs = phys.blood_volume_l
    for org in COMPARTMENTS[2:-1]:  # exclude bloods and rest
        v = phys.organ_volume_l.get(org, 0.0)
        V[org] = v
        sum_organs += v

    # Tissue density assumed 1.0 kg/L
    V["rest"] = max(0.0, phys.body_weight_kg - sum_organs)
    return V


def build_flows(phys: ScaledPhysiology) -> dict[str, float]:
    """Build organ blood flows in Litres/min."""
    Q = {}
    Q_tot = phys.cardiac_output_ml_min / 1000.0
    Q["total"] = Q_tot

    # Splanchnic
    Q["gut"] = phys.organ_blood_flow_ml_min.get("gut", 0.0) / 1000.0
    Q["spleen"] = phys.organ_blood_flow_ml_min.get("spleen", 0.0) / 1000.0

    Q_liver_tot = phys.organ_blood_flow_ml_min.get("liver", 0.0) / 1000.0
    Q["hepatic_artery"] = max(0.0, Q_liver_tot - Q["gut"] - Q["spleen"])
    Q["liver"] = Q["hepatic_artery"] + Q["gut"] + Q["spleen"]

    sum_parallel = Q["liver"]
    for org in ["kidney", "heart", "brain", "muscle", "adipose", "skin"]:
        q = phys.organ_blood_flow_ml_min.get(org, 0.0) / 1000.0
        Q[org] = q
        sum_parallel += q

    Q["rest"] = max(0.0, Q_tot - sum_parallel)
    return Q


def pbpk_deriv(
    t: float,
    y: np.ndarray,
    V: dict[str, float],
    Q: dict[str, float],
    disp: DispositionParameters,
    phys: ScaledPhysiology,
    transport_law: TransportLaw,
    clearance_law: ClearanceLaw,
) -> np.ndarray:
    """The ODE derivative function."""
    A = {comp: y[i] for i, comp in enumerate(COMPARTMENTS)}
    dAdt = {comp: 0.0 for comp in COMPARTMENTS}
    C_out = {comp: 0.0 for comp in COMPARTMENTS}

    # Blood concentrations (assuming well-stirred)
    C_art = A["arterial_blood"] / V["arterial_blood"] if V["arterial_blood"] > 0 else 0.0
    C_ven = A["venous_blood"] / V["venous_blood"] if V["venous_blood"] > 0 else 0.0

    # Lung (receives all venous blood)
    lung_dA, lung_C_out = transport_law("lung", A["lung"], V["lung"], C_ven, Q["total"], disp, phys)
    lung_CL = clearance_law("lung", A["lung"], V["lung"], lung_C_out, disp, phys)
    dAdt["lung"] = lung_dA - lung_CL
    C_out["lung"] = lung_C_out

    # Arterial blood receives from lung
    dAdt["arterial_blood"] = Q["total"] * (C_out["lung"] - C_art)

    # Parallel organs (excluding liver, lung, gut, spleen)
    parallel = ["kidney", "heart", "brain", "muscle", "adipose", "skin", "rest"]
    venous_return = 0.0
    for org in parallel:
        org_dA, org_C_out = transport_law(org, A[org], V[org], C_art, Q[org], disp, phys)
        org_CL = clearance_law(org, A[org], V[org], org_C_out, disp, phys)
        dAdt[org] = org_dA - org_CL
        C_out[org] = org_C_out
        venous_return += Q[org] * org_C_out

    # Splanchnic organs
    for org in ["gut", "spleen"]:
        org_dA, org_C_out = transport_law(org, A[org], V[org], C_art, Q[org], disp, phys)
        org_CL = clearance_law(org, A[org], V[org], org_C_out, disp, phys)
        dAdt[org] = org_dA - org_CL
        C_out[org] = org_C_out

    # Liver
    liver_Q_in = Q["liver"]
    if liver_Q_in > 0:
        C_in_liver = (
            Q["hepatic_artery"] * C_art + Q["gut"] * C_out["gut"] + Q["spleen"] * C_out["spleen"]
        ) / liver_Q_in
    else:
        C_in_liver = 0.0

    liver_dA, liver_C_out = transport_law(
        "liver", A["liver"], V["liver"], C_in_liver, liver_Q_in, disp, phys
    )
    liver_CL = clearance_law("liver", A["liver"], V["liver"], liver_C_out, disp, phys)
    dAdt["liver"] = liver_dA - liver_CL
    C_out["liver"] = liver_C_out

    venous_return += liver_Q_in * liver_C_out

    # Venous blood receives from organs, sends to lung
    dAdt["venous_blood"] = venous_return - Q["total"] * C_ven

    return np.array([dAdt[comp] for comp in COMPARTMENTS])


def run_pbpk_model(
    disp: DispositionParameters,
    phys: ScaledPhysiology,
    transport_law: TransportLaw,
    clearance_law: ClearanceLaw,
    time_span: tuple[float, float],
    initial_amounts: dict[str, float] | None = None,
    **solve_ivp_kwargs,
) -> tuple[OdeResult, dict[str, float], dict[str, float]]:
    """
    Run the multi-compartment PBPK ODE.

    Args:
        disp: DispositionParameters contract.
        phys: ScaledPhysiology row.
        transport_law: Callable for per-organ transport rate.
        clearance_law: Callable for per-organ elimination rate.
        time_span: (t0, tf) in minutes.
        initial_amounts: Optional starting amounts per compartment.
        solve_ivp_kwargs: Additional kwargs for scipy.integrate.solve_ivp.

    Returns:
        res: Scipy OdeResult object.
        V: Evaluated volumes in L.
        Q: Evaluated flows in L/min.
    """
    V = build_volumes(phys)
    Q = build_flows(phys)

    y0 = np.zeros(len(COMPARTMENTS))
    if initial_amounts:
        for i, comp in enumerate(COMPARTMENTS):
            y0[i] = initial_amounts.get(comp, 0.0)

    # Tight tolerances: the full 13-compartment system includes fast, small-volume
    # compartments (spleen, gut) that make it stiff; scipy's default rtol=1e-3 lets
    # total mass drift ~1e-3. rtol=1e-6/atol=1e-9 holds mass conservation and AUC/Vss
    # accuracy. Callers may still override via solve_ivp_kwargs.
    kwargs = {"method": "Radau", "rtol": 1e-6, "atol": 1e-9}
    kwargs.update(solve_ivp_kwargs)

    res = solve_ivp(
        fun=lambda t, y: pbpk_deriv(t, y, V, Q, disp, phys, transport_law, clearance_law),
        t_span=time_span,
        y0=y0,
        **kwargs,
    )
    return res, V, Q


def transport_law(
    organ: str,
    A_tissue: float,
    V_tissue: float,
    C_in: float,
    Q_tissue: float,
    disp: DispositionParameters,
    phys: ScaledPhysiology,
) -> tuple[float, float]:
    """Standard perfusion-limited transport."""
    if V_tissue <= 0 or Q_tissue <= 0:
        return 0.0, C_in

    kp_val = 1.0
    if disp.kp and organ in disp.kp:
        kp_val = disp.kp[organ].value

    bpr = disp.blood_plasma_ratio.value if disp.blood_plasma_ratio else 1.0

    C_tissue = A_tissue / V_tissue
    # Kp is tissue/plasma. C_plasma = C_tissue / Kp.
    # C_out (blood) = C_plasma * BPR
    C_out = (C_tissue / kp_val) * bpr

    dA = Q_tissue * (C_in - C_out)
    return dA, C_out


def clearance_law(
    organ: str,
    A_tissue: float,
    V_tissue: float,
    C_out: float,
    disp: DispositionParameters,
    phys: ScaledPhysiology,
) -> float:
    """Elimination acting on the venous blood leaving an organ.

    Hepatic — the IVIVE core hands over the *well-stirred systemic* clearance
    ``cl_hepatic``, which already embeds one flow limitation (E_H = CL/Q_h).
    Feeding that back into a perfused liver compartment would flow-limit it a
    SECOND time; and because ``cl_hepatic`` is per-kg while the ODE works in
    absolute amounts, the old ``cl_hep/1000`` also mis-scaled it by 1/body-weight.
    Instead recover the flow-independent unbound intrinsic clearance

        cl_int_u = cl_hepatic / (BPR · (1 − E_H))          [ = fu_blood · CLint ]

    (Q_h cancels algebraically), scale to absolute L/min, and let the ODE's own
    liver perfusion produce the extraction exactly once — self-consistent with
    whatever Q_liver the physiology supplies.

    Renal — ``cl_renal`` is a plasma-referenced filtration clearance (fu·GFR);
    apply it to the plasma concentration (C_out / BPR). NB the compartment is
    ``"kidney"`` (the previous ``"kidneys"`` never matched, so renal elimination
    silently did nothing). Both disp clearances are per-kg, so multiply by body
    weight for absolute L/min.
    """
    bw = phys.body_weight_kg
    if organ == "liver":
        cl_hep = disp.cl_hepatic.value if disp.cl_hepatic else 0.0
        if not cl_hep or cl_hep <= 0.0:
            return 0.0
        bpr = disp.blood_plasma_ratio.value if disp.blood_plasma_ratio else 1.0
        e_h = disp.extraction_ratio.value if disp.extraction_ratio else 0.0
        # Cap E_H just below 1 so the recovered intrinsic clearance stays finite;
        # the ODE perfusion then saturates the systemic CL at liver blood flow.
        e_h = min(max(e_h, 0.0), 0.99)
        cl_int_u_per_kg = cl_hep / (bpr * (1.0 - e_h))  # fu_blood · CLint, flow-independent
        cl_int_u_abs = cl_int_u_per_kg * bw / 1000.0  # mL/min/kg → L/min
        return cl_int_u_abs * C_out
    if organ == "kidney":
        cl_ren = disp.cl_renal.value if disp.cl_renal else 0.0
        if not cl_ren or cl_ren <= 0.0:
            return 0.0
        bpr = disp.blood_plasma_ratio.value if disp.blood_plasma_ratio else 1.0
        return (cl_ren * bw / 1000.0 / bpr) * C_out  # mL/min/kg → L/min, plasma-referenced
    return 0.0
