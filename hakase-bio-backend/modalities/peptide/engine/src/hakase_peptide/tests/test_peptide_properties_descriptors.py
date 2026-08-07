"""Unit tests for the §6 deterministic descriptors added in roadmap M1.

Covers windowed hydrophobicity (§6.3), positional charge distribution (§6.5),
the β-strand hydrophobic-moment option (§6.4) and the compositional-statistics
block (§6.10), plus a guard that the public return schema (and the keys the
decision layer relies on) is preserved.

Run: pytest hakase_peptide/tests/test_peptide_properties_descriptors.py
"""

from __future__ import annotations

import math

import pytest

from hakase_peptide.properties.properties import (
    DEFAULT_HYDROPHOBICITY_WINDOW,
    REFERENCE_PARAMETER_SETS,
    _charge_distribution,
    _compositional_statistics,
    _hydrophobic_moment,
    _windowed_hydrophobicity,
    predict_peptide_properties,
)

# Well-known amphipathic AMPs used as golden fixtures.
MAGAININ2 = "GIGKFLHSAKKFGKAFVGEIMNS"
MELITTIN = "GIGAVLKVLTTGLPALISWIKRKRQQ"


# ── §6.3 windowed hydrophobicity ────────────────────────────────────────────


def test_windowed_hydrophobicity_window_count_and_size():
    hp = _windowed_hydrophobicity(MAGAININ2)
    n = len(MAGAININ2)
    w = hp["window_size"]
    assert w == DEFAULT_HYDROPHOBICITY_WINDOW
    # One window per start position: n - w + 1.
    assert len(hp["windowed_values"]) == n - w + 1
    assert hp["scale"] == "Kyte-Doolittle"


def test_windowed_hydrophobicity_matches_manual_mean():
    from hakase_peptide.properties import KD

    seq = "AAAIIILLL"
    w = 3
    hp = _windowed_hydrophobicity(seq, window=w)
    expected0 = sum(KD[c] for c in seq[0:3]) / 3
    assert hp["windowed_values"][0] == pytest.approx(round(expected0, 4))
    assert len(hp["windowed_values"]) == len(seq) - w + 1


def test_windowed_hydrophobicity_clamps_when_shorter_than_window():
    hp = _windowed_hydrophobicity("AC", window=7)
    # Width clamps to the sequence length; a single whole-sequence window.
    assert hp["window_size"] == 2
    assert hp["requested_window_size"] == 7
    assert len(hp["windowed_values"]) == 1


# ── §6.4 β-strand hydrophobic moment option ─────────────────────────────────


def test_hydrophobic_moment_helix_vs_beta_differ():
    mu_helix = _hydrophobic_moment(MAGAININ2, angle_deg=100.0)
    mu_beta = _hydrophobic_moment(MAGAININ2, angle_deg=160.0)
    assert mu_helix >= 0.0 and mu_beta >= 0.0
    # The two periodicities probe different faces — they must not coincide.
    assert not math.isclose(mu_helix, mu_beta, rel_tol=1e-3)


def test_hydrophobic_moment_periodicity_surfaced_in_return():
    r = predict_peptide_properties(MAGAININ2)
    prof = r["hydrophobic_moment_profile"]
    assert prof["default_assumed_periodicity_deg"] == 100.0
    assert prof["helix_100deg"] == r["physicochemical"]["hydrophobic_moment"]
    assert prof["beta_160deg"] == r["physicochemical"]["hydrophobic_moment_beta"]
    assert prof["helix_100deg"] != prof["beta_160deg"]


# ── §6.5 positional charge distribution ─────────────────────────────────────


def test_charge_distribution_profile_length_and_variance():
    cd = _charge_distribution(MAGAININ2)
    assert len(cd["profile"]) == len(MAGAININ2)
    assert cd["variance"] >= 0.0
    # Cationic AMP: at least one strongly positive per-residue charge (K/R).
    assert max(cd["profile"]) > 0.5


def test_charge_distribution_uniform_neutral_has_zero_variance():
    # No ionisable side chains => flat all-zero profile => zero variance.
    cd = _charge_distribution("AAAAAA")
    assert cd["profile"] == [0.0] * 6
    assert cd["variance"] == 0.0


# ── §6.10 compositional statistics ──────────────────────────────────────────


def test_compositional_statistics_block():
    cs = _compositional_statistics(MELITTIN)
    n = len(MELITTIN)
    # Per-frequency 6-dp rounding accumulates a tiny residual over ~n terms.
    assert sum(cs["aa_frequencies"].values()) == pytest.approx(1.0, abs=1e-4)
    assert sum(cs["dipeptide_frequencies"].values()) == pytest.approx(1.0, abs=1e-4)
    assert cs["cys_count"] == MELITTIN.count("C")
    assert cs["pro_content"] == pytest.approx(MELITTIN.count("P") / n, abs=1e-6)
    assert cs["gly_content"] == pytest.approx(MELITTIN.count("G") / n, abs=1e-6)


# ── schema preservation (signature unchanged, decision paths intact) ────────


def test_return_dict_preserves_legacy_and_adds_new_blocks():
    r = predict_peptide_properties(MAGAININ2)
    # New §6 blocks present.
    for key in (
        "hydrophobicity_profile",
        "charge_distribution",
        "compositional_statistics",
        "hydrophobic_moment_profile",
        "reference_parameter_sets",
    ):
        assert key in r
    # Legacy keys the decision layer resolves against are untouched.
    phys = r["physicochemical"]
    for key in ("net_charge_pH7", "instability_index", "hydrophobic_moment"):
        assert key in phys
    assert r["reference_parameter_sets"] == REFERENCE_PARAMETER_SETS
