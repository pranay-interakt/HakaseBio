"""Execution targets: dispatch bundles, awaited returns, simulation marking."""

import hashlib
import io
import json
import zipfile

import pytest

from hos.drivers.base import DataOrigin
from hos.kernel.errors import KernelError
from hos.kernel.execution import (
    DispatchStatus,
    ExternalLabTarget,
    InHouseTarget,
    SimulationTarget,
    TargetKind,
    target_from_spec,
)
from tests.drivers.test_metabolic_stability import COMPOUND, PARAMS, SIM, D


def _pkg():
    p = D.validate_parameters(PARAMS)
    proto = D.design(COMPOUND, p)
    return p, D.instruction_package("S-42", proto, p, COMPOUND)


def test_external_lab_dispatch_produces_verifiable_bundle_and_awaits_data():
    p, pkg = _pkg()
    rec = ExternalLabTarget(laboratory="Example CRO", quote_reference="Q-123").dispatch(
        pkg, driver=D, params=p, compound=COMPOUND)
    assert rec.status is DispatchStatus.AWAITING_DATA
    assert rec.expected_origin is DataOrigin.MEASURED and rec.simulated is None
    assert rec.bundle_sha256 == hashlib.sha256(rec.bundle).hexdigest()
    with zipfile.ZipFile(io.BytesIO(rec.bundle)) as z:
        names = set(z.namelist())
        assert {"protocol.md", "sample_manifest.csv", "data_template.csv",
                "RETURN_INSTRUCTIONS.md", "MANIFEST.json"} <= names
        assert "# study_reference: S-42" in z.read("data_template.csv").decode()
        assert json.loads(z.read("MANIFEST.json"))["protocol_hash"] == pkg.protocol.content_hash
    assert any("does not send" in n for n in rec.notes)


def test_in_house_requires_named_scientist():
    with pytest.raises(KernelError):
        InHouseTarget(laboratory="Bldg 2", responsible_scientist=" ")


def test_simulation_target_returns_marked_data_immediately():
    p, pkg = _pkg()
    rec = SimulationTarget(simulation_parameters=SIM, seed=11).dispatch(
        pkg, driver=D, params=p, compound=COMPOUND)
    assert rec.status is DispatchStatus.DATA_AVAILABLE
    assert rec.expected_origin is DataOrigin.SIMULATED
    data = D.ingest(rec.simulated.content, p, study_reference="S-42")
    assert data.is_simulated


def test_specs_round_trip_and_simulation_needs_explicit_seed():
    for t in (ExternalLabTarget(laboratory="L"), InHouseTarget(laboratory="L", responsible_scientist="R"),
              SimulationTarget(simulation_parameters=SIM, seed=3)):
        assert target_from_spec(t.spec()) == t
    with pytest.raises(KernelError):
        target_from_spec({"kind": TargetKind.SIMULATION.value, "simulation_parameters": SIM})
