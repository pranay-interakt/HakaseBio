"""Offline unit tests for the domain model, evidence contract and decision engine.

These run without network. They build real Evidence Objects directly and verify
the Decision Engine's policy logic (hard constraints, thresholds, traceability),
plus domain validation and evidence immutability.
"""

from __future__ import annotations

import pytest

from hakase_peptide.decision import DecisionEngine, get_policy_store
from hakase_peptide.decision.record import Decision
from hakase_peptide.domain.evidence import (
    ApplicabilityDomain,
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from hakase_peptide.domain.peptide import Peptide, PeptideValidationError
from hakase_peptide.domain.platform_evidence import PlatformEvidence
from hakase_peptide.domain.target import Target, TargetValidationError


# ---- domain -----------------------------------------------------------------
def test_peptide_validation_rejects_nonstandard():
    with pytest.raises(PeptideValidationError):
        Peptide.create("HELLOZ")  # Z is non-standard


def test_peptide_disulfide_must_connect_cysteines():
    with pytest.raises(PeptideValidationError):
        Peptide.create("ACDEFG", disulfide_bridges="1-6")  # pos6 is G, not C


def test_peptide_subject_id_is_deterministic():
    a = Peptide.create("ACDEFGHIKL")
    b = Peptide.create("acdefghikl")  # case-insensitive clean
    assert a.subject_id == b.subject_id


def test_target_rejects_bad_uniprot():
    with pytest.raises(TargetValidationError):
        Target.create(uniprot_accession="NOTREAL!!")


def test_evidence_is_immutable():
    ev = _mk_ev(EvidenceType.SAFETY, {"hemolysis": {"probability": 0.1}}, 0.8)
    with pytest.raises(Exception):
        ev.evidence_id = "x"  # frozen dataclass


# ---- decision engine --------------------------------------------------------
def _mk_ev(etype, payload, conf, tier=EvidenceTier.ML_MODEL):
    return EvidenceObject(
        evidence_type=etype,
        producing_service=f"{etype.value}_service",
        subject_id="subj-1",
        execution_id="exec-1",
        scientific_payload=payload,
        confidence=Confidence.make(conf, "test"),
        uncertainty=Uncertainty(model_uncertainty=1 - conf),
        applicability_domain=ApplicabilityDomain(in_domain=True),
        validation_status=ValidationStatus.INTERNALLY_VALIDATED,
        provenance=Provenance(originating_service=f"{etype.value}_service"),
        evidence_tier=tier,
    )


def _platform_evidence(hemolysis_prob):
    evs = [
        _mk_ev(
            EvidenceType.PHYSICOCHEMICAL,
            {
                "physicochemical": {
                    "instability_index": 20.0,
                    "net_charge_pH7": 4.0,
                    "hydrophobic_moment": 0.8,
                }
            },
            1.0,
            EvidenceTier.DETERMINISTIC,
        ),
        _mk_ev(
            EvidenceType.STRUCTURAL,
            {"geometry": {"mean_plddt": 85.0}},
            0.85,
            EvidenceTier.STRUCTURE_MODEL,
        ),
        _mk_ev(
            EvidenceType.FUNCTIONAL,
            {
                "antimicrobial": {"probability": 0.9},
                "cell_permeability": {"probability": 0.3},
                "receptor_engagement": {"receptor_engagement_score": 6},
            },
            0.86,
        ),
        _mk_ev(
            EvidenceType.DEVELOPABILITY,
            {
                "solubility": {"camsol_score": 0.5},
                "aggregation": {"mean_a3v": -0.05},
                "synthesis": {"difficulty_score": 3},
                "stability": {"instability_index": 20.0},
            },
            0.9,
            EvidenceTier.DETERMINISTIC,
        ),
        _mk_ev(
            EvidenceType.SAFETY,
            {
                "hemolysis": {"probability": hemolysis_prob},
                "immunogenicity": {"band": "Low"},
                "chemical_liabilities": {"n_high": 0},
            },
            0.82,
        ),
    ]
    return PlatformEvidence.assemble("subj-1", "exec-1", evs)


def test_hard_constraint_forces_no_go():
    pe = _platform_evidence(hemolysis_prob=0.95)  # above generic 0.8 hard bar
    policy = get_policy_store().get("generic-peptide-policy")
    rec = DecisionEngine().decide(pe, policy)
    assert rec.decision is Decision.NO_GO
    assert rec.forced_by_hard_constraint is True


def test_clean_peptide_can_go():
    pe = _platform_evidence(hemolysis_prob=0.05)  # safe
    policy = get_policy_store().get("amp-policy")
    rec = DecisionEngine().decide(pe, policy)
    assert rec.decision in (Decision.GO, Decision.CONDITIONAL_GO)
    assert rec.forced_by_hard_constraint is False
    # full traceability: every participating domain is in the trace
    domains = {t["domain"] for t in rec.evidence_trace}
    assert {"physicochemical", "structural", "functional", "developability", "safety"} <= domains


def test_missing_domain_reduces_completeness():
    pe = _platform_evidence(hemolysis_prob=0.05)
    # drop the safety evidence
    pe2 = PlatformEvidence.assemble(
        "subj-1",
        "exec-1",
        [e for e in pe.evidence.values() if e.evidence_type is not EvidenceType.SAFETY],
    )
    rec = DecisionEngine().decide(pe2, get_policy_store().get("generic-peptide-policy"))
    assert rec.completeness["completeness_fraction"] < 1.0
    assert "safety" in rec.completeness["unavailable_domains"]


def test_policy_resolution_priority():
    store = get_policy_store()
    assert store.resolve(policy_id="amp-policy").resolved_by == "explicit_policy_id"
    assert store.resolve(modality="antimicrobial").policy.policy_id == "amp-policy"
    assert store.resolve().resolved_by == "platform_default"
