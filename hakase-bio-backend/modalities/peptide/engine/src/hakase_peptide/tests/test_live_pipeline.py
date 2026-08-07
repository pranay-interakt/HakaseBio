"""Live (network) tests — real ESMFold + real classifiers end to end.

Skipped by default; run with HAKASE_RUN_LIVE=1 to exercise the real folding API
and the full analyze pipeline. These make outbound HTTP calls to the ESM Atlas
public API and require scikit-learn to be installed for the classifiers.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("HAKASE_RUN_LIVE") != "1",
    reason="Set HAKASE_RUN_LIVE=1 to run live network tests.",
)


def test_structure_provider_real_fold():
    from hakase_peptide.structure import analyze_structure, resolve_structure_provider

    pred = resolve_structure_provider().fold("GLPALISWIKRKRQQ")
    assert 0.0 <= pred.mean_plddt <= 100.0
    assert len(pred.per_residue_plddt) == 15
    geom = analyze_structure(pred.pdb)
    assert geom["n_residues"] == 15
    assert geom["radius_of_gyration_angstrom"] > 0


def test_full_analyze_produces_decision():
    from hakase_peptide.pipeline import analyze_peptide

    out = analyze_peptide(sequence="GIGAVLKVLTTGLPALISWIKRKRQQ", modality="antimicrobial")
    assert out["decision"]["decision"] in ("GO", "CONDITIONAL_GO", "NO_GO")
    # all five evidence domains present and real
    ev = out["platform_evidence"]["evidence"]
    for d in ("physicochemical", "structural", "functional", "developability", "safety"):
        assert d in ev
        assert ev[d]["validation_status"] != "unavailable"
