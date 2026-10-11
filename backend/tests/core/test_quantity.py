"""The integrity type: no value without provenance, no silent gaps."""

import math

import pytest

from hos.core.provenance import ApplicabilityCheck, Citation, Method, Provenance, ProvenanceKind
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError

CIT = Citation(key="t", text="Test reference.")
M = Method(id="t.m", version="1.0.0", name="test", citations=(CIT,))


def test_method_without_citation_is_rejected():
    with pytest.raises(ValueError):
        Method(id="x", version="1", name="x", citations=())


def test_computed_without_method_is_rejected():
    with pytest.raises(ValueError):
        Provenance(kind=ProvenanceKind.COMPUTED)


def test_predicted_requires_applicability():
    with pytest.raises(ValueError):
        Provenance(kind=ProvenanceKind.PREDICTED, method=M)


def test_unavailable_requires_reason():
    with pytest.raises(ValueError):
        Provenance.unavailable(reason="")


def test_measured_requires_source():
    with pytest.raises(ValueError):
        Provenance(kind=ProvenanceKind.MEASURED)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_values_rejected(bad):
    with pytest.raises(QuantityError):
        Quantity.computed(bad, "mg", method=M)


def test_bad_unit_rejected():
    with pytest.raises(ValueError):
        Quantity.computed(1.0, "furlongs_per_fortnightzz", method=M)


def test_unavailable_has_no_value_and_require_raises():
    g = Quantity.unavailable("mg", reason="not measured")
    assert g.value is None and not g.is_available
    with pytest.raises(QuantityError):
        g.require()


def test_value_bearing_kind_cannot_be_empty():
    with pytest.raises(QuantityError):
        Quantity(value=None, unit="mg", provenance=Provenance.user_supplied(actor="a"))


def test_unit_conversion_is_real_algebra():
    q = Quantity.measured(1500.0, "uL/min/mg", source_name="assay")
    assert math.isclose(q.to("mL/min/mg").value, 1.5)
    assert "converted" in q.to("mL/min/mg").provenance.notes


def test_incompatible_conversion_raises():
    q = Quantity.measured(1.0, "mg", source_name="balance")
    with pytest.raises(ValueError):
        q.to("min")


def test_predicted_out_of_domain_is_flagged():
    q = Quantity.predicted(
        0.5,
        "dimensionless",
        method=M,
        applicability=ApplicabilityCheck(in_domain=False, reason="outside range"),
    )
    assert "out_of_applicability_domain" in q.qc_flags


def test_ids_are_deterministic_and_input_linked():
    a = Quantity.measured(1.0, "mg", source_name="s")
    b = Quantity.computed(2.0, "mg", method=M, inputs=[a])
    b2 = Quantity.computed(2.0, "mg", method=M, inputs=[a])
    assert b.id == b2.id
    assert a.id in b.provenance.input_ids


def test_series_validation():
    with pytest.raises(QuantityError):
        MeasurementSeries(
            x=(0.0, 1.0),
            y=(1.0,),
            x_unit="min",
            y_unit="percent",
            provenance=Provenance.measured(source_name="s"),
        )


def test_simulated_requires_parameters_and_is_never_evidence():
    from hos.core.methods import method

    with pytest.raises(ValueError):
        Provenance(kind=ProvenanceKind.SIMULATED, method=method("sim.first_order_depletion"))
    p = Provenance.simulated(
        method=method("sim.first_order_depletion"), parameters="t1/2=20 min", seed=1
    )
    q = Quantity(value=1.0, unit="percent", provenance=p)
    assert q.is_simulated and not q.admissible_as_evidence
    assert "not a measurement" in q.provenance.notes


def test_values_derived_from_simulation_are_inadmissible():
    from hos.core.quantity import SIMULATION_TAINT

    q = Quantity.computed(2.0, "mg", method=M)
    assert q.admissible_as_evidence
    tq = q.tainted_by_simulation()
    assert SIMULATION_TAINT in tq.qc_flags and not tq.admissible_as_evidence
    assert tq.tainted_by_simulation().qc_flags.count(SIMULATION_TAINT) == 1
