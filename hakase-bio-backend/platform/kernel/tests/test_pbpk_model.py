import dataclasses

import numpy as np
from hakase_kernel.pbpk.contract import (
    ApplicabilityDomain,
    DispositionParameters,
    ModalityExtension,
    Quantity,
    SpeciesContext,
)
from hakase_kernel.pbpk.model import (
    build_flows,
    clearance_law,
    run_pbpk_model,
    transport_law,
)
from hakase_kernel.pbpk.physiology.store import get_physiology


def dummy_disposition():
    qty = lambda v: Quantity(value=v, units="dummy", provenance="assumed", source="test")
    return DispositionParameters(
        fu_plasma=qty(1.0),
        fu_blood=qty(1.0),
        blood_plasma_ratio=qty(1.0),
        cl_hepatic=qty(0.0),
        cl_renal=qty(0.0),
        cl_total=qty(0.0),
        kp={"rest": qty(1.0)},  # others default
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
    C_out = C_tissue / kp_val  # assume BPR = 1.0
    dA = Q * (C_in - C_out)
    return dA, C_out


def simple_clearance(organ, A, V, C_out, disp, phys):
    if organ == "liver":
        return (disp.cl_hepatic.value / 1000.0) * C_out
    return 0.0


def test_mass_balance_conservation():
    phys = get_physiology("rat")
    disp = dummy_disposition()

    initial_amounts = {"venous_blood": 100.0}

    res, V, Q = run_pbpk_model(
        disp,
        phys,
        perfusion_limited_transport,
        simple_clearance,
        time_span=(0, 60),
        initial_amounts=initial_amounts,
        max_step=1.0,
    )

    total_mass = np.sum(res.y, axis=0)
    assert np.allclose(total_mass, 100.0, rtol=1e-5), "Mass is not conserved!"


def test_degenerate_one_compartment():
    phys = get_physiology("rat")
    # artificially inflate Q to simulate instant mixing
    inflated_flows = {k: v * 1e6 for k, v in phys.organ_blood_flow_ml_min.items()}
    phys = dataclasses.replace(
        phys,
        cardiac_output_ml_min=phys.cardiac_output_ml_min * 1e6,
        organ_blood_flow_ml_min=inflated_flows,
    )

    qty = lambda v: Quantity(value=v, units="dummy", provenance="assumed", source="test")
    disp = dummy_disposition()
    disp = dataclasses.replace(disp, cl_hepatic=qty(10.0))  # 10 mL/min

    initial_amounts = {"venous_blood": 100.0}

    res, V, Q = run_pbpk_model(
        disp,
        phys,
        perfusion_limited_transport,
        simple_clearance,
        time_span=(0, 60),
        initial_amounts=initial_amounts,
        rtol=1e-8,
        atol=1e-8,
    )

    Vss = phys.body_weight_kg
    CL = 10.0 / 1000.0  # L/min
    k = CL / Vss

    t_end = res.t[-1]

    C_venous_num = res.y[1, -1] / V["venous_blood"]
    C_analytic = (100.0 / Vss) * np.exp(-k * t_end)

    assert np.isclose(
        C_venous_num, C_analytic, rtol=1e-3
    ), f"Num: {C_venous_num}, Ana: {C_analytic}"


def test_hepatic_clearance_single_flow_limit():
    """The production ``clearance_law`` must feed the ODE the flow-independent
    intrinsic clearance and let perfusion flow-limit the liver ONCE.

    The IVIVE core hands over ``cl_hepatic`` — the well-stirred *systemic*
    clearance, already flow-limited at Q_h. A correct ODE recovers the intrinsic
    clearance ``cl_hepatic / (BPR·(1−E_H))`` and reproduces the well-stirred
    systemic clearance at the ODE's own liver blood flow. The earlier bug applied
    ``cl_hepatic`` directly on the perfused liver (double flow-limiting) AND
    treated a per-kg value as absolute, so this pins the emergent CL to the
    single-flow-limit expectation.
    """
    phys = get_physiology("rat")
    qty = lambda v: Quantity(value=v, units="x", provenance="assumed", source="test")
    organs = [
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
    kp = {o: qty(1.0) for o in organs}  # trivial distribution: Vss ≈ body weight
    cl_hep, e_h, bpr = 35.0, 0.5, 1.0  # mL/min/kg (plasma), blood extraction
    disp = DispositionParameters(
        fu_plasma=qty(0.5),
        fu_blood=qty(0.5),
        blood_plasma_ratio=qty(bpr),
        cl_hepatic=qty(cl_hep),
        cl_renal=qty(0.0),
        cl_total=qty(cl_hep),
        kp=kp,
        vdss=qty(1.0),
        extraction_ratio=qty(e_h),
        hepatic_first_pass=qty(1.0 - e_h),
        species_context=SpeciesContext(species="rat"),
        applicability_domain=ApplicabilityDomain(verdict="in"),
        modality_extension=ModalityExtension(modality="small-molecule"),
    )
    dose = 100.0
    # Dense early sampling so trapezoidal AUC resolves the IV distribution phase.
    t_eval = np.unique(np.concatenate([np.linspace(0, 60, 3000), np.linspace(60, 3000, 3000)]))
    res, V, Q = run_pbpk_model(
        disp,
        phys,
        transport_law,
        clearance_law,
        time_span=(0, 3000),
        initial_amounts={"venous_blood": dose},
        t_eval=t_eval,
        rtol=1e-9,
        atol=1e-12,
    )
    c_ven = res.y[1, :] / V["venous_blood"]  # BPR = 1 → blood == plasma
    cl_pred_abs = dose / np.trapz(c_ven, res.t)  # L/min

    cl_int_u_abs = (cl_hep / (bpr * (1.0 - e_h))) * phys.body_weight_kg / 1000.0
    q_liver = build_flows(phys)["liver"]
    cl_expected_abs = q_liver * cl_int_u_abs / (q_liver + cl_int_u_abs)

    assert np.isclose(cl_pred_abs, cl_expected_abs, rtol=0.05), (
        f"emergent CL {cl_pred_abs:.5f} L/min != single-flow-limit "
        f"expectation {cl_expected_abs:.5f} L/min"
    )
