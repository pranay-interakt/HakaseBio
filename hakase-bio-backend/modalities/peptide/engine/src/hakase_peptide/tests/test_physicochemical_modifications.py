"""M7 — modification & non-canonical residue handling (spec §5.1, §6.1, §9, §12).

Covers:
  - Terminal-cap MW increments: acetylation (+42.04 avg) and amidation (−0.98 avg).
  - Terminal-cap charge correction (acetylation removes the N-terminal +charge).
  - Conflicting-modification rejection at Stage 1 (Peptide.create -> validation error).
  - Unknown-chemistry graceful degradation: only molecular_weight is marked
    unavailable; every sequence-derived descriptor is still computed exactly.
  - Exact linker resolution via the cheminformatics built-in table (lipidation).
  - Modification participates in subject_id only when present.

Run: pytest hakase_peptide/tests/test_physicochemical_modifications.py
"""

from __future__ import annotations

import pytest
from hakase_chemistry.core import (
    REASON_POLYDISPERSE,
    REASON_RDKIT_ABSENT,
    resolve_linker,
)
from hakase_kernel.config import get_config

from hakase_peptide.domain.ids import new_id
from hakase_peptide.domain.peptide import Peptide, PeptideValidationError
from hakase_peptide.infrastructure.audit import get_audit_log
from hakase_peptide.infrastructure.model_registry import get_model_registry
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.infrastructure.resource_manager import get_resource_manager
from hakase_peptide.services.compute import properties_for
from hakase_peptide.services.physicochemical import PhysicochemicalService

MAGAININ2 = "GIGKFLHSAKKFGKAFVGEIMNS"

# Literature increments the engine must reproduce (Unimod).
ACETYL_AVG = 42.0367
AMIDE_AVG = -0.9847
PALMITOYL_AVG = 238.41


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


# ---------------------------------------------------------------------------
# Baseline: unmodified peptides are untouched (zero regression)
# ---------------------------------------------------------------------------


def test_unmodified_peptide_output_is_unchanged():
    pep = Peptide.create(MAGAININ2)
    props = properties_for(pep)
    phys = props["physicochemical"]
    assert pep.mod_set.is_empty
    assert phys["modification_applied"] is False
    # reported MW == base MW when nothing is modified
    assert phys["molecular_weight_avg_da"] == phys["molecular_weight_base_avg_da"]
    assert props["modifications"]["declared"] is False


# ---------------------------------------------------------------------------
# Terminal-cap mass increments (spec §6.1)
# ---------------------------------------------------------------------------


def test_acetylation_mw_delta():
    base = properties_for(Peptide.create(MAGAININ2))["physicochemical"]
    ac = properties_for(Peptide.create(MAGAININ2, modifications={"n_terminus": "acetyl"}))[
        "physicochemical"
    ]
    delta = ac["molecular_weight_avg_da"] - base["molecular_weight_base_avg_da"]
    assert delta == pytest.approx(ACETYL_AVG, abs=0.02)


def test_amidation_mw_delta():
    base = properties_for(Peptide.create(MAGAININ2))["physicochemical"]
    am = properties_for(Peptide.create(MAGAININ2, modifications={"c_terminus": "amide"}))[
        "physicochemical"
    ]
    delta = am["molecular_weight_avg_da"] - base["molecular_weight_base_avg_da"]
    assert delta == pytest.approx(AMIDE_AVG, abs=0.02)


def test_acetylation_removes_n_terminal_positive_charge():
    base = properties_for(Peptide.create(MAGAININ2))["physicochemical"]
    ac = properties_for(Peptide.create(MAGAININ2, modifications={"n_terminus": "acetyl"}))[
        "physicochemical"
    ]
    # Free N-terminal amino group carries ~+0.8 at pH 7.4; capping removes it.
    drop = base["net_charge_pH7"] - ac["net_charge_pH7"]
    assert 0.6 < drop < 1.0


# ---------------------------------------------------------------------------
# Conflicting modifications -> reject at Stage 1 (spec §5.1 / §12)
# ---------------------------------------------------------------------------


def test_acetyl_plus_head_to_tail_cyclization_rejected():
    with pytest.raises(PeptideValidationError, match="cyclization"):
        Peptide.create(MAGAININ2, cyclic=True, modifications={"n_terminus": "acetyl"})


def test_free_terminus_asserted_with_cyclization_rejected():
    # The spec's canonical example: a terminus both consumed by the ring and free.
    with pytest.raises(PeptideValidationError, match="free"):
        Peptide.create(MAGAININ2, cyclic=True, modifications={"c_terminus": "free"})


def test_out_of_range_d_amino_acid_rejected():
    with pytest.raises(PeptideValidationError, match="out of range"):
        Peptide.create(MAGAININ2, modifications={"d_residues": [999]})


# ---------------------------------------------------------------------------
# Unknown chemistry -> only MW unavailable, everything else exact (spec §12)
# ---------------------------------------------------------------------------


def test_unknown_linker_marks_only_molecular_weight_unavailable():
    # Polydisperse PEG with no explicit structure: mass genuinely unresolvable.
    pep = Peptide.create(
        MAGAININ2, modifications={"pegylation": {"position": 4, "descriptor": "PEG2000"}}
    )
    props = properties_for(pep)
    mods = props["modifications"]
    assert mods["mw_resolved"] is False
    assert "molecular_weight" in mods["unavailable_descriptors"]
    # Modified MW is unavailable (None), never fabricated…
    assert props["physicochemical"]["molecular_weight_avg_da"] is None
    # …but the base backbone mass and every sequence descriptor remain present.
    assert props["physicochemical"]["molecular_weight_base_avg_da"] > 0
    assert props["physicochemical"]["gravy"] is not None
    assert props["physicochemical"]["instability_index"] is not None
    assert props["physicochemical"]["aromaticity"] is not None


def test_service_marks_only_mw_descriptor_unavailable():
    pep = Peptide.create(
        MAGAININ2, modifications={"pegylation": {"position": 4, "descriptor": "PEG2000"}}
    )
    ev = PhysicochemicalService().run(_context(pep))
    desc = ev.scientific_payload["descriptors"]
    assert desc["molecular_weight"]["confidence"]["tier"] == "unavailable"
    assert desc["molecular_weight"]["value"] is None
    # Sequence-derived descriptors are still exact (graceful degradation).
    for field in ("gravy_score", "aromaticity", "aliphatic_index", "boman_index"):
        assert desc[field]["confidence"]["tier"] == "exact"
    # The roll-up reflects a reduced (not failed) deterministic tier.
    assert ev.scientific_payload["confidence_summary"]["deterministic_tier"] == "reduced"


# ---------------------------------------------------------------------------
# Exact linker resolution via the cheminformatics engine
# ---------------------------------------------------------------------------


def test_lipidation_resolves_exact_increment():
    pep = Peptide.create(
        MAGAININ2, modifications={"lipidation": {"position": 4, "descriptor": "palmitoyl"}}
    )
    props = properties_for(pep)
    mods = props["modifications"]
    assert mods["mw_resolved"] is True
    assert mods["total_increment_avg_da"] == pytest.approx(PALMITOYL_AVG, abs=0.05)
    assert props["physicochemical"]["molecular_weight_avg_da"] is not None


def test_resolve_linker_paths():
    ok = resolve_linker("palmitoyl")
    assert ok.available and ok.mass_avg == pytest.approx(PALMITOYL_AVG, abs=0.05)

    peg = resolve_linker("PEG2000")
    assert not peg.available and peg.reason == REASON_POLYDISPERSE

    mystery = resolve_linker("totally-made-up-linker")
    assert not mystery.available
    assert mystery.reason in (REASON_RDKIT_ABSENT, "chem_unresolvable")


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


def test_modification_changes_subject_id_only_when_present():
    plain = Peptide.create(MAGAININ2)
    plain2 = Peptide.create(MAGAININ2)
    ac = Peptide.create(MAGAININ2, modifications={"n_terminus": "acetyl"})
    assert plain.subject_id == plain2.subject_id  # unmodified id is stable
    assert ac.subject_id != plain.subject_id  # a real modification is distinct
