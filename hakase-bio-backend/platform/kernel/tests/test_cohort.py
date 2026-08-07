import numpy as np
from hakase_kernel.pbpk.absorption import IVBolus
from hakase_kernel.pbpk.cohort import run_virtual_cohort
from hakase_kernel.pbpk.contract import (
    ApplicabilityDomain,
    DispositionParameters,
    ModalityExtension,
    Quantity,
    SpeciesContext,
)
from hakase_kernel.pbpk.physiology.store import get_physiology


def test_virtual_cohort_reproducibility():
    phys_base = get_physiology("rat")

    def qty(v, low=None, high=None):
        return Quantity(
            value=v,
            ci_low=low,
            ci_high=high,
            units="dummy",
            provenance="assumed",
            source="test",
        )

    disp = DispositionParameters(
        fu_plasma=qty(0.5, 0.4, 0.6),
        fu_blood=qty(0.5, 0.4, 0.6),
        blood_plasma_ratio=qty(1.0),
        cl_hepatic=qty(10.0, 5.0, 20.0),
        cl_renal=qty(0.0),
        cl_total=qty(10.0),
        kp={"rest": qty(2.0, 1.0, 4.0)},
        vdss=qty(1.0),
        extraction_ratio=qty(0.0),
        hepatic_first_pass=qty(0.0),
        species_context=SpeciesContext(species="rat", body_weight_kg=0.25),
        applicability_domain=ApplicabilityDomain(verdict="in"),
        modality_extension=ModalityExtension(modality="small-molecule"),
    )

    def transport_law(organ, A, V, C_in, Q, d, p):
        if V <= 0 or Q <= 0:
            return 0.0, C_in
        kp_val = d.kp.get(organ, qty(1.0)).value
        C_out = (A / V) / kp_val
        return Q * (C_in - C_out), C_out

    def clearance_law(organ, A, V, C_out, d, p):
        if organ == "liver":
            return (d.cl_hepatic.value / 1000.0) * C_out
        return 0.0

    def forcing_factory(p):
        # dose scales with body weight: 1 mg/kg
        return IVBolus(dose=1.0 * p.body_weight_kg)

    time_eval = np.linspace(0, 100, 50)

    # Run with seed 42
    res1 = run_virtual_cohort(
        n_animals=5,
        seed=42,
        disp_base=disp,
        phys_base=phys_base,
        transport_law=transport_law,
        clearance_law=clearance_law,
        forcing_model_factory=forcing_factory,
        time_eval=time_eval,
        bw_cv=0.1,
        rtol=1e-3,
        atol=1e-3,
    )

    # Run again with same seed
    res2 = run_virtual_cohort(
        n_animals=5,
        seed=42,
        disp_base=disp,
        phys_base=phys_base,
        transport_law=transport_law,
        clearance_law=clearance_law,
        forcing_model_factory=forcing_factory,
        time_eval=time_eval,
        bw_cv=0.1,
        rtol=1e-3,
        atol=1e-3,
    )

    # Check reproducibility
    assert np.allclose(res1["curves"]["plasma"]["mean"], res2["curves"]["plasma"]["mean"])
    assert np.allclose(res1["curves"]["plasma"]["p05"], res2["curves"]["plasma"]["p05"])
    assert np.allclose(res1["curves"]["plasma"]["p95"], res2["curves"]["plasma"]["p95"])

    # Check that intervals make sense (p05 <= mean <= p95)
    mean_curve = np.array(res1["curves"]["plasma"]["mean"])
    p05_curve = np.array(res1["curves"]["plasma"]["p05"])
    p95_curve = np.array(res1["curves"]["plasma"]["p95"])
    assert np.all(p05_curve <= mean_curve + 1e-6)
    assert np.all(mean_curve <= p95_curve + 1e-6)

    # Check endpoints
    ep = res1["endpoints"]["plasma"]
    assert "c_max" in ep
    assert "t_max" in ep
    assert "auc" in ep
    assert "cl" in ep
    assert "vss" in ep
    assert "t_half" in ep

    assert ep["c_max"]["median"] > 0
    assert ep["c_max"]["p05"] <= ep["c_max"]["median"] <= ep["c_max"]["p95"]

    # Run with a different seed, expect different results
    res3 = run_virtual_cohort(
        n_animals=5,
        seed=99,
        disp_base=disp,
        phys_base=phys_base,
        transport_law=transport_law,
        clearance_law=clearance_law,
        forcing_model_factory=forcing_factory,
        time_eval=time_eval,
        bw_cv=0.1,
        rtol=1e-3,
        atol=1e-3,
    )

    assert not np.allclose(res1["curves"]["plasma"]["mean"], res3["curves"]["plasma"]["mean"])

    # Verify per-endpoint intervals are emitted
    assert "c_max" in res1["endpoints"]["plasma"]
    assert "median" in res1["endpoints"]["plasma"]["c_max"]
    assert "p05" in res1["endpoints"]["plasma"]["c_max"]
    assert "p95" in res1["endpoints"]["plasma"]["c_max"]

    for ep in ["c_max", "t_max", "auc", "cl"]:
        metrics = res1["endpoints"]["plasma"][ep]
        assert "median" in metrics
        assert "p05" in metrics
        assert "p95" in metrics

        # intervals must be somewhat ordered (could be equal if n_animals is small and metrics are uniform, but here variance exists)
        assert metrics["p05"] <= metrics["median"] <= metrics["p95"]
