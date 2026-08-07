import dataclasses
import math

import numpy as np
from hakase_kernel.pbpk.absorption import (
    IVBolus,
    IVInfusion,
    Oral,
    RepeatDose,
    SCDepot,
)
from hakase_kernel.pbpk.contract import (
    ApplicabilityDomain,
    DispositionParameters,
    ModalityExtension,
    Quantity,
    SpeciesContext,
)
from hakase_kernel.pbpk.physiology.store import get_physiology


def test_iv_bolus():
    model = IVBolus(dose=100.0)
    assert model.get_initial_amounts() == {"venous_blood": 100.0}
    assert model.get_input_rate(10.0) == {}


def test_iv_infusion():
    model = IVInfusion(dose=100.0, duration=10.0)
    assert model.get_initial_amounts() == {}
    assert model.get_input_rate(5.0) == {"venous_blood": 10.0}
    assert model.get_input_rate(15.0) == {}


def test_sc_depot():
    model = SCDepot(dose=100.0, ka=0.5, f_abs=0.8)
    assert model.get_initial_amounts() == {}
    expected_rate = 0.5 * 0.8 * 100.0 * math.exp(-0.5 * 2.0)
    rate = model.get_input_rate(2.0)
    assert "venous_blood" in rate
    assert math.isclose(rate["venous_blood"], expected_rate, rel_tol=1e-5)


def test_oral():
    model = Oral(dose=100.0, ka=0.5, f_abs=0.8)
    assert model.get_initial_amounts() == {}
    expected_rate = 0.5 * 0.8 * 100.0 * math.exp(-0.5 * 2.0)
    rate = model.get_input_rate(2.0)
    assert "gut" in rate
    assert math.isclose(rate["gut"], expected_rate, rel_tol=1e-5)


def test_repeat_dose():
    tau = 12.0
    ka = 0.1
    dose = 10.0
    model = RepeatDose(dose=dose, ka=ka, f_abs=1.0, tau=tau, compartment="gut")

    assert model.get_initial_amounts() == {}

    # At t=25, doses were given at t=0, t=12, t=24
    t = 25.0
    expected_rate = ka * dose * (math.exp(-ka * 25.0) + math.exp(-ka * 13.0) + math.exp(-ka * 1.0))
    rate = model.get_input_rate(t)
    assert "gut" in rate
    assert math.isclose(rate["gut"], expected_rate, rel_tol=1e-5)


def dummy_disposition():
    qty = lambda v: Quantity(value=v, units="dummy", provenance="assumed", source="test")
    return DispositionParameters(
        fu_plasma=qty(1.0),
        fu_blood=qty(1.0),
        blood_plasma_ratio=qty(1.0),
        cl_hepatic=qty(0.0),
        cl_renal=qty(0.0),
        cl_total=qty(0.0),
        kp={"rest": qty(1.0)},
        vdss=qty(1.0),
        extraction_ratio=qty(0.0),
        hepatic_first_pass=qty(0.0),
        species_context=SpeciesContext(species="rat"),
        applicability_domain=ApplicabilityDomain(verdict="in"),
        modality_extension=ModalityExtension(modality="small-molecule"),
    )


def perfusion_limited_transport(organ, A, V, C_in, Q, disp, phys):
    if V <= 0 or Q <= 0:
        return 0.0, C_in
    kp = disp.kp.get(organ)
    kp_val = kp.value if kp else 1.0
    C_tissue = A / V
    C_out = C_tissue / kp_val
    dA = Q * (C_in - C_out)
    return dA, C_out


def first_pass_clearance(organ, A, V, C_out, disp, phys):
    if organ == "liver":
        return (disp.cl_hepatic.value / 1000.0) * C_out
    return 0.0


def run_with_forcing(disp, phys, forcing_model, t_end=2000.0):
    """Wrap ODE solver to include absorption input rates."""
    from hakase_kernel.pbpk.model import COMPARTMENTS, build_flows, build_volumes, pbpk_deriv
    from scipy.integrate import solve_ivp

    V = build_volumes(phys)
    Q = build_flows(phys)

    def deriv_with_input(t, y):
        dydt = pbpk_deriv(t, y, V, Q, disp, phys, perfusion_limited_transport, first_pass_clearance)
        inputs = forcing_model.get_input_rate(t)
        for comp, rate in inputs.items():
            idx = COMPARTMENTS.index(comp)
            dydt[idx] += rate
        return dydt

    y0 = np.zeros(len(COMPARTMENTS))
    initial = forcing_model.get_initial_amounts()
    for comp, amt in initial.items():
        idx = COMPARTMENTS.index(comp)
        y0[idx] += amt

    res = solve_ivp(
        deriv_with_input,
        (0, t_end),
        y0,
        method="Radau",
        rtol=1e-6,
        atol=1e-6,
    )
    return res, V, Q


def test_oral_first_pass_reproduces_hand_calc():
    """
    If we give an oral dose, the drug is absorbed into the gut compartment and flows to the liver.
    F_sys = AUC_oral / AUC_iv * Dose_iv / Dose_oral
    Hand calculation: F_sys = f_abs * (1 - E_h).
    E_h = CL_h / Q_liver.
    """
    phys = get_physiology("rat")
    # Simplify flows to guarantee exact known Q_liver
    # We will override liver flow directly
    Q_liver_ml = 20.0
    inflated_flows = {k: 0.0 for k in phys.organ_blood_flow_ml_min}
    inflated_flows["liver"] = Q_liver_ml
    inflated_flows["gut"] = 10.0
    inflated_vols = {k: v for k, v in phys.organ_volume_l.items()}
    inflated_vols["gut"] = 0.05
    inflated_vols["liver"] = 0.05
    phys = dataclasses.replace(
        phys, organ_blood_flow_ml_min=inflated_flows, organ_volume_l=inflated_vols
    )

    # Q_liver in L/min is 0.02
    Q_liver_L = 0.02

    qty = lambda v: Quantity(value=v, units="dummy", provenance="assumed", source="test")
    disp = dummy_disposition()
    # Set liver clearance to 0.01 L/min => E_h = 0.01 / 0.02 = 0.5
    disp = dataclasses.replace(disp, cl_hepatic=qty(10.0))

    # IV dose
    iv_model = IVBolus(dose=100.0)
    res_iv, V, Q = run_with_forcing(disp, phys, iv_model, t_end=2000.0)

    # Oral dose
    f_abs = 0.8
    oral_model = Oral(dose=100.0, ka=0.05, f_abs=f_abs)
    res_oral, V, Q = run_with_forcing(disp, phys, oral_model, t_end=2000.0)

    # Integrate AUC in venous blood
    c_ven_iv = res_iv.y[1, :] / V["venous_blood"]
    auc_iv = np.trapz(c_ven_iv, res_iv.t)

    c_ven_oral = res_oral.y[1, :] / V["venous_blood"]
    auc_oral = np.trapz(c_ven_oral, res_oral.t)

    F_sys = auc_oral / auc_iv

    # Hand calculation
    CL = 10.0 / 1000.0
    # In well-stirred ODE, F_h = Q / (Q + CL)
    F_h = Q["liver"] / (Q["liver"] + CL)
    F_sys_hand = f_abs * F_h

    assert math.isclose(F_sys, F_sys_hand, rel_tol=1e-2), f"AUC F_sys={F_sys} vs Hand={F_sys_hand}"
