"""Embedding wiring for the Physicochemical Service (roadmap M4 / M5 / M6-emb).

Covers:
  - M4: the default key-free descriptor provider is wired end-to-end — a real
        vector is written to the store and referenced by ``storage_uri``; the
        object is honestly ``partially_complete`` (surrogate, no per-residue).
  - M4: a mocked NVIDIA ESM2 path — pooled + per-residue both stored, object
        ``complete``, embedding provenance recorded.
  - M4/§12: an unavailable embedding (NVIDIA requested with no key) still
        publishes the evidence with the embedding marked ``unavailable`` and no
        fabricated vector.
  - M5: length / compositional out-of-domain inputs lower ``embedding_tier`` and
        set ``applicability_domain.extrapolation_flag`` (§10.2).
  - The local-fs store round-trips the artifact it writes.

Run: pytest hakase_peptide/tests/test_physicochemical_embeddings.py
"""

from __future__ import annotations

import dataclasses
import io

import numpy as np
import pytest
from hakase_kernel.config import get_config
from hakase_sequence.esm import LocalFilesystemStore, embedding_applicability, load_embedding

from hakase_peptide.domain.ids import new_id
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.infrastructure.audit import get_audit_log
from hakase_peptide.infrastructure.model_registry import get_model_registry
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.infrastructure.resource_manager import get_resource_manager
from hakase_peptide.services.physicochemical import PhysicochemicalService

MAGAININ2 = "GIGKFLHSAKKFGKAFVGEIMNS"
ESM2_DIM = 1280


def _context(pep: Peptide, config) -> ExecutionContext:
    return ExecutionContext(
        execution_id=new_id("exec"),
        peptide=pep,
        target=None,
        policy_id=None,
        config=config,
        registry=get_model_registry(),
        resources=get_resource_manager(),
        audit=get_audit_log(),
    )


def _config(tmp_path, **overrides):
    """A PlatformConfig with a hermetic embedding store dir + any overrides."""
    base = dataclasses.replace(get_config(), embedding_storage_dir=str(tmp_path), **overrides)
    return base


def _run(seq, config, **pep_kw):
    pep = Peptide.create(seq, **pep_kw)
    ev = PhysicochemicalService().run(_context(pep, config))
    return pep, ev


# ── M4: descriptor provider wired end-to-end (default, key-free) ─────────────


def test_descriptor_embedding_stored_by_reference(tmp_path):
    cfg = _config(tmp_path)  # default provider == "descriptors"
    pep, ev = _run(MAGAININ2, cfg)
    emb = ev.scientific_payload["embeddings"]

    pooled = emb["pooled_vector"]
    assert pooled["dimension"] == 26  # descriptor vector width
    assert pooled["storage_uri"].startswith("file://")
    assert pooled["confidence"]["tier"] == "reduced"  # surrogate, not a PLM

    # The artifact really exists and matches the reported dimension — not faked.
    arr = load_embedding(pooled["storage_uri"])
    assert arr.shape == (26,)

    # Descriptor surrogate has no learned per-residue matrix.
    pr = emb["per_residue_matrix"]
    assert pr["dimension"] is None and pr["storage_uri"] is None
    assert pr["confidence"]["tier"] == "unavailable"

    # §14 completeness + embedding provenance (M6-emb).
    assert ev.scientific_payload["validation_status"] == "partially_complete"
    prov = ev.scientific_payload["provenance"]
    assert prov["embedding_model_identifier_and_version"] == "peptide_biochem_engine:1.0.0"


# ── M4: mocked NVIDIA ESM2 path (real PLM: pooled + per-residue) ─────────────


def _fake_npz_response(matrix: np.ndarray):
    buf = io.BytesIO()
    np.savez(buf, embeddings=matrix)
    body = buf.getvalue()

    class _Resp:
        status_code = 200
        headers = {"Content-Type": "application/octet-stream"}
        content = body
        text = ""

        def json(self):
            raise ValueError("not json")

    return _Resp()


def test_nvidia_esm2_embedding_complete(tmp_path, monkeypatch):
    matrix = np.tile(np.arange(ESM2_DIM, dtype=float), (len(MAGAININ2), 1))  # (L, 1280)
    monkeypatch.setattr(
        "hakase_sequence.esm.esm2_nvidia.requests.post",
        lambda *a, **k: _fake_npz_response(matrix),
    )
    cfg = _config(tmp_path, embedding_provider="nvidia_esm2", nvidia_api_key="test-key")
    _, ev = _run(MAGAININ2, cfg)
    emb = ev.scientific_payload["embeddings"]

    # Pooled (mean over residues) and per-residue matrix both stored by reference.
    assert emb["pooled_vector"]["dimension"] == ESM2_DIM
    assert emb["per_residue_matrix"]["dimension"] == ESM2_DIM
    pr = load_embedding(emb["per_residue_matrix"]["storage_uri"])
    assert pr.shape == (len(MAGAININ2), ESM2_DIM)

    # In-domain learned PLM embedding => exact tier, complete object.
    assert emb["pooled_vector"]["confidence"]["tier"] == "exact"
    assert ev.scientific_payload["confidence_summary"]["embedding_tier"] == "exact"
    assert ev.scientific_payload["validation_status"] == "complete"
    prov = ev.scientific_payload["provenance"]
    assert prov["embedding_model_identifier_and_version"] == "esm2_650m:650M"


# ── §12: embedding unavailable still publishes the object, never fabricates ──


def test_embedding_unavailable_publishes_object(tmp_path):
    # NVIDIA requested but no key -> provider resolution fails -> unavailable.
    cfg = _config(tmp_path, embedding_provider="nvidia_esm2", nvidia_api_key=None)
    _, ev = _run(MAGAININ2, cfg)
    emb = ev.scientific_payload["embeddings"]

    for slot in ("pooled_vector", "per_residue_matrix"):
        assert emb[slot]["confidence"]["tier"] == "unavailable"
        assert emb[slot]["dimension"] is None  # no fabricated vector
        assert emb[slot]["storage_uri"] is None

    assert ev.scientific_payload["confidence_summary"]["embedding_tier"] == "unavailable"
    assert ev.scientific_payload["validation_status"] == "partially_complete"
    assert ev.scientific_payload["provenance"]["embedding_model_identifier_and_version"] is None
    # Deterministic descriptors are unaffected — degradation is embedding-only.
    assert ev.scientific_payload["confidence_summary"]["deterministic_tier"] == "exact"
    assert any("embedding unavailable" in w for w in ev.warnings)


# ── M5: length / compositional OOD -> embedding_tier + extrapolation_flag ────


def test_low_complexity_sequence_flags_extrapolation(tmp_path):
    # Homopolymer: in the reliable *length* band but compositionally out-of-domain
    # for an embedding, so applicability must flag extrapolation (§10.2).
    cfg = _config(tmp_path)
    _, ev = _run("AAAAAAAAAA", cfg)
    assert ev.applicability_domain.extrapolation_flag is True
    assert ev.applicability_domain.in_domain is False


def test_embedding_applicability_signals():
    assert embedding_applicability(MAGAININ2).in_domain is True
    assert embedding_applicability("AC").extrapolation_flag is True  # too short
    assert embedding_applicability("A" * 9).extrapolation_flag is True  # low complexity
    assert embedding_applicability("ACDEFGHIKX").extrapolation_flag is True  # non-standard residue


# ── Local-fs store round-trip ───────────────────────────────────────────────


def test_local_store_roundtrip(tmp_path):
    store = LocalFilesystemStore(str(tmp_path))
    uri = store.put(
        subject_id="peptide:abc123",
        model_id="esm2_650m",
        model_version="650M",
        kind="per_residue",
        array=[[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
    )
    assert uri.startswith("file://")
    got = load_embedding(uri)
    assert got.shape == (2, 3)
    assert got[1, 2] == pytest.approx(6.0)
