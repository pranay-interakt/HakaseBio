"""Unit tests for the typed Physicochemical Evidence payload (roadmap M2/M3/M6).

Covers:
  - M2: the scientific payload validates against the ported §14 Pydantic schema
        and carries peptide_object_reference + validation_status.
  - M3: per-descriptor confidence tiers (exact/reduced/unavailable) and the
        confidence_summary roll-up that never replaces the breakdown (§10.3).
  - M6: provenance.reference_parameter_sets + model_identifier_and_version.
  - Contract: decision/variables.py paths still resolve through extract_variables.

Run: pytest hakase_peptide/tests/test_physicochemical_evidence.py
"""

from __future__ import annotations

import pytest
from hakase_kernel.config import get_config

from hakase_peptide.decision.variables import extract_variables
from hakase_peptide.domain.ids import new_id
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.domain.platform_evidence import PlatformEvidence
from hakase_peptide.domain.schemas.physicochemical import PhysicochemicalTypedPayload
from hakase_peptide.infrastructure.audit import get_audit_log
from hakase_peptide.infrastructure.model_registry import get_model_registry
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.infrastructure.resource_manager import get_resource_manager
from hakase_peptide.services.physicochemical import PhysicochemicalService

MAGAININ2 = "GIGKFLHSAKKFGKAFVGEIMNS"


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


def _run(seq: str, **kw):
    pep = Peptide.create(seq, **kw)
    ev = PhysicochemicalService().run(_context(pep))
    return pep, ev


# ── M2: typed §14 payload validation ────────────────────────────────────────


def test_payload_validates_against_typed_schema():
    pep, ev = _run(MAGAININ2)
    p = ev.scientific_payload
    # The §14 block validates cleanly against the ported Pydantic model.
    typed = PhysicochemicalTypedPayload.model_validate(
        {
            "peptide_object_reference": p["peptide_object_reference"],
            "descriptors": p["descriptors"],
            "embeddings": p["embeddings"],
            "provenance": p["provenance"],
            "confidence_summary": p["confidence_summary"],
            "validation_status": p["validation_status"],
        }
    )
    assert typed.peptide_object_reference == pep.subject_id
    assert typed.validation_status == "partially_complete"  # embeddings deferred
    # All twelve §6 descriptor groups present.
    d = typed.descriptors
    assert d.molecular_weight.value is not None
    assert d.hydrophobicity_profile.window_size >= 1
    assert d.charge_distribution.variance >= 0.0
    assert d.compositional_statistics.cys_count == MAGAININ2.count("C")


def test_payload_rejects_unexpected_descriptor_key():
    _, ev = _run(MAGAININ2)
    bad = dict(ev.scientific_payload["descriptors"])
    bad["not_a_real_descriptor"] = {"value": 1.0, "confidence": {"tier": "exact"}}
    with pytest.raises(Exception):
        PhysicochemicalTypedPayload.model_validate(
            {
                "peptide_object_reference": "x",
                "descriptors": bad,
                "embeddings": ev.scientific_payload["embeddings"],
                "provenance": ev.scientific_payload["provenance"],
                "confidence_summary": ev.scientific_payload["confidence_summary"],
                "validation_status": "partially_complete",
            }
        )


# ── M3: per-descriptor confidence tiers ─────────────────────────────────────


def test_normal_peptide_all_exact_descriptor_embedding_surrogate():
    # Default (no-key) posture: deterministic descriptors all exact; the embedding
    # is the descriptor surrogate — pooled present (tier reduced), per-residue
    # unavailable — so the object is honestly partially_complete (roadmap locked).
    _, ev = _run(MAGAININ2)
    p = ev.scientific_payload
    tiers = {name: block["confidence"]["tier"] for name, block in p["descriptors"].items()}
    assert set(tiers.values()) == {"exact"}
    cs = p["confidence_summary"]
    assert cs["deterministic_tier"] == "exact"
    assert cs["embedding_tier"] == "reduced"  # surrogate, not a learned PLM
    # Roll-up does not replace the breakdown (§10.3): both coexist.
    assert p["descriptors"]["gravy_score"]["confidence"]["tier"] == "exact"
    assert p["embeddings"]["pooled_vector"]["confidence"]["tier"] == "reduced"
    assert p["embeddings"]["per_residue_matrix"]["confidence"]["tier"] == "unavailable"
    assert p["validation_status"] == "partially_complete"


def test_extreme_length_reduces_only_affected_descriptors():
    _, ev = _run("AC")  # 2-mer: below the reliable-length floor
    d = ev.scientific_payload["descriptors"]
    # Length-sensitive descriptors flagged reduced ...
    assert d["hydrophobic_moment"]["confidence"]["tier"] == "reduced"
    assert d["instability_index"]["confidence"]["tier"] == "reduced"
    # ... while all others stay exact (degradation is per-descriptor).
    assert d["gravy_score"]["confidence"]["tier"] == "exact"
    assert d["molecular_weight"]["confidence"]["tier"] == "exact"
    assert d["compositional_statistics"]["confidence"]["tier"] == "exact"
    assert ev.scientific_payload["confidence_summary"]["deterministic_tier"] == "reduced"


# ── M6: provenance & reference parameter sets ───────────────────────────────


def test_provenance_reference_parameter_sets_and_model_id():
    _, ev = _run(MAGAININ2)
    prov = ev.scientific_payload["provenance"]
    rps = prov["reference_parameter_sets"]
    for key in ("hydrophobicity_scale", "pKa_set", "mass_table_average", "instability_scale"):
        assert key in rps and rps[key]
    assert prov["model_identifier_and_version"] == "peptide_biochem_engine:1.0.0"
    assert "sequence_validation" in prov["originating_modules"]


# ── Decision-variable contract (must keep resolving) ────────────────────────


def test_decision_variable_paths_resolve():
    pep, ev = _run(MAGAININ2)
    platform = PlatformEvidence.assemble(pep.subject_id, ev.execution_id, [ev])
    extracted = extract_variables(
        platform, ["net_charge_pH7", "instability_index", "hydrophobic_moment"]
    )
    for name in ("net_charge_pH7", "instability_index", "hydrophobic_moment"):
        assert extracted[name].present, f"{name} failed to resolve"
        assert extracted[name].raw is not None
        assert extracted[name].normalized is not None


def test_payload_is_json_serialisable_checksum():
    _, ev = _run(MAGAININ2)
    # Payload must be plain JSON (enums lowered to strings) so the checksum works.
    assert isinstance(ev.payload_checksum, str) and len(ev.payload_checksum) == 64
