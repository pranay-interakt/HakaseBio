"""M8 — API surface + numpy-sanitisation for the Physicochemical Evidence Object.

Covers the three things Milestone M8 adds on top of A/B/C (it exposes their
object; it adds no new science):

  - Endpoint contract: the thin ``analyze_physicochemical`` helper (which backs
    ``POST /v3/peptide/physicochemical``) returns the single §14 Physicochemical
    Evidence Object with a stable shape and no decision layer. A FastAPI
    ``TestClient`` variant runs the real route where FastAPI is installed and
    skips cleanly where it is not (the sanctioned test env has no FastAPI).
  - Full-pipeline decision-variable extraction: the exposed object still plugs
    into the Decision Layer — ``decision/variables.py`` resolves
    ``physicochemical.{net_charge_pH7,instability_index,hydrophobic_moment}``
    to normalised [0, 1] favourabilities via ``extract_variables``.
  - Numpy JSON-sanitisation of embeddings: ``api.jsonsafe.sanitize`` turns the
    numpy scalars/arrays an embedding block can carry into JSON-native types so
    the response serialises, and the real helper output round-trips through it.

Run: pytest hakase_peptide/tests/test_physicochemical.py
"""

from __future__ import annotations

import json

import numpy as np
import pytest
from hakase_kernel.config import get_config

from hakase_peptide.decision.variables import extract_variables
from hakase_peptide.domain.ids import new_id
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.domain.platform_evidence import PlatformEvidence
from hakase_peptide.infrastructure.audit import get_audit_log
from hakase_peptide.infrastructure.model_registry import get_model_registry
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.infrastructure.resource_manager import get_resource_manager
from hakase_peptide.jsonsafe import sanitize
from hakase_peptide.pipeline import analyze_physicochemical
from hakase_peptide.services.physicochemical import PhysicochemicalService

MAGAININ2 = "GIGKFLHSAKKFGKAFVGEIMNS"

# The three §6 descriptor groups the typed §14 payload always carries.
_DESCRIPTOR_KEYS = (
    "molecular_weight",
    "isoelectric_point",
    "net_charge_by_ph",
    "gravy_score",
    "hydrophobicity_profile",
    "hydrophobic_moment",
    "charge_distribution",
    "instability_index",
    "aliphatic_index",
    "aromaticity",
    "boman_index",
    "compositional_statistics",
)


def _context(pep: Peptide) -> ExecutionContext:
    return ExecutionContext(
        execution_id=new_id("exec"),
        peptide=pep,
        target=None,
        policy_id=None,
        config=get_config(),
        registry=get_model_registry(),
        resources=get_resource_manager(),
        audit=get_audit_log(),
    )


# ── Endpoint contract (helper-level; always runs) ───────────────────────────


def test_helper_returns_single_physicochemical_evidence_object():
    result = analyze_physicochemical(sequence=MAGAININ2)

    assert set(result) >= {"input", "execution_id", "evidence"}
    assert result["input"]["sequence"] == MAGAININ2

    ev = result["evidence"]
    assert ev["evidence_type"] == "physicochemical"
    assert ev["producing_service"] == "physicochemical_service"
    # Decision-free endpoint: the object is present and real, never fabricated.
    assert ev["validation_status"] != "unavailable"
    # No decision layer is run by this entry point.
    assert "decision" not in result and "platform_evidence" not in result

    payload = ev["scientific_payload"]
    # §14 typed block …
    for block in (
        "peptide_object_reference",
        "descriptors",
        "embeddings",
        "provenance",
        "confidence_summary",
        "validation_status",
    ):
        assert block in payload, f"missing §14 block: {block}"
    for key in _DESCRIPTOR_KEYS:
        assert key in payload["descriptors"], f"missing descriptor: {key}"
    # … alongside the legacy flat block the decision variables resolve against.
    assert "physicochemical" in payload
    assert payload["peptide_object_reference"] == result["input"]["subject_id"]


def test_helper_honours_modifications_and_environment():
    # C (M7) is merged: a declared terminal cap must flow through the helper.
    base = analyze_physicochemical(sequence=MAGAININ2)
    amidated = analyze_physicochemical(sequence=MAGAININ2, modifications={"c_terminus": "amide"})
    # Amidation shifts the subject identity (modification participates in the id).
    assert base["input"]["subject_id"] != amidated["input"]["subject_id"]
    assert amidated["evidence"]["validation_status"] != "unavailable"


def test_helper_rejects_invalid_sequence():
    from hakase_peptide.domain.peptide import PeptideValidationError

    with pytest.raises(PeptideValidationError):
        analyze_physicochemical(sequence="XZ123")


def test_endpoint_route_contract():
    """Real HTTP route where FastAPI is available; skipped in the deps-minimal
    test env (pytest/pydantic/numpy/requests, no FastAPI)."""
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from hakase_peptide.api.router import get_router

    app = FastAPI()
    app.include_router(get_router())
    client = TestClient(app)

    resp = client.post("/v3/peptide/physicochemical", json={"sequence": MAGAININ2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["evidence"]["evidence_type"] == "physicochemical"
    assert body["evidence"]["scientific_payload"]["peptide_object_reference"]

    bad = client.post("/v3/peptide/physicochemical", json={"sequence": "XZ123"})
    assert bad.status_code == 422


# ── Full-pipeline decision-variable extraction ──────────────────────────────


def test_decision_variables_extract_from_exposed_object():
    pep = Peptide.create(MAGAININ2)
    ev = PhysicochemicalService().run(_context(pep))
    platform = PlatformEvidence.assemble(pep.subject_id, ev.execution_id, [ev])

    names = ["net_charge_pH7", "instability_index", "hydrophobic_moment"]
    extracted = extract_variables(platform, names)
    for name in names:
        var = extracted[name]
        assert var.present, f"{name} did not resolve from physicochemical.* path"
        assert var.raw is not None
        assert var.normalized is not None
        assert 0.0 <= var.normalized <= 1.0, f"{name} normalised out of [0,1]"


# ── Numpy JSON-sanitisation of embeddings ───────────────────────────────────


def test_sanitize_converts_numpy_embedding_block():
    # An embeddings block carrying numpy scalars/arrays (as a real PLM path or a
    # future inline vector would) must survive json.dumps after sanitisation.
    raw = {
        "embeddings": {
            "pooled_vector": {
                "dimension": np.int64(1280),
                "storage_uri": "file:///tmp/hakase-embeddings/x.npy",
                "vector": np.asarray([0.1, 0.2, 0.3], dtype=np.float32),
                "confidence": {"tier": "exact", "in_domain": np.bool_(True)},
            },
            "per_residue_matrix": {
                "dimension": np.int32(1280),
                "matrix": np.zeros((2, 3), dtype=np.float64),
            },
        }
    }
    with pytest.raises(TypeError):
        json.dumps(raw)  # numpy present -> not serialisable as-is

    clean = sanitize(raw)
    json.dumps(clean)  # must not raise

    pooled = clean["embeddings"]["pooled_vector"]
    assert pooled["dimension"] == 1280 and isinstance(pooled["dimension"], int)
    assert pooled["vector"] == [pytest.approx(0.1), pytest.approx(0.2), pytest.approx(0.3)]
    assert pooled["confidence"]["in_domain"] is True
    assert clean["embeddings"]["per_residue_matrix"]["matrix"] == [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]


def test_helper_output_round_trips_through_sanitize():
    # The exact composition the endpoint uses: helper -> sanitize -> JSON.
    result = analyze_physicochemical(sequence=MAGAININ2)
    encoded = json.dumps(sanitize(result))
    reloaded = json.loads(encoded)
    assert reloaded["evidence"]["scientific_payload"]["embeddings"]["pooled_vector"]["storage_uri"]
