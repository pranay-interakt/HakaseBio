"""Unit tests for the PBPK scaffold-split / leakage controls (S2-T5).

These prove the two leakage guards the spec demands: salts/analogues are
deduplicated so they cannot straddle the split, and no scaffold appears in both
train and test.

Run:  python3 -m pytest validation/tests/test_pbpk_holdout.py
"""

from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pbpk_holdout  # noqa: E402
from pbpk_holdout import compute_scaffold, load_pbpk_holdout, strip_salt  # noqa: E402


def test_strip_salt_collapses_salt_to_parent():
    free_base = strip_salt("CC(C)NCC(O)COc1cccc2ccccc12")  # propranolol
    salt = strip_salt("CC(C)NCC(O)COc1cccc2ccccc12.Cl")  # propranolol HCl
    assert free_base == salt


def test_strip_salt_keeps_largest_fragment():
    # acetate salt of a larger cation -> parent is the larger fragment
    assert strip_salt("CC(=O)[O-].c1ccccc1CC[NH3+]") == strip_salt("c1ccccc1CC[NH3+]")


def test_scaffold_of_salt_equals_scaffold_of_parent():
    assert compute_scaffold("CC(C)NCC(O)COc1cccc2ccccc12.Cl") == compute_scaffold(
        "CC(C)NCC(O)COc1cccc2ccccc12"
    )


def _write_benchmark(dir_path, rows):
    df = pd.DataFrame(rows)
    path = os.path.join(dir_path, "unittest_pk_benchmark.csv")
    df.to_csv(path, index=False)
    return path


def test_salt_and_freebase_are_deduplicated(tmp_path, monkeypatch):
    monkeypatch.setattr(pbpk_holdout, "DATASETS_DIR", str(tmp_path))
    _write_benchmark(
        tmp_path,
        [
            {
                "compound_name": "propranolol",
                "smiles": "CC(C)NCC(O)COc1cccc2ccccc12",
                "dose_mg_kg": 10,
                "cmax_ng_ml": 1,
                "auc_ng_h_ml": 1,
                "cl_ml_min_kg": 1,
            },
            {
                "compound_name": "propranolol HCl",
                "smiles": "CC(C)NCC(O)COc1cccc2ccccc12.Cl",
                "dose_mg_kg": 10,
                "cmax_ng_ml": 1,
                "auc_ng_h_ml": 1,
                "cl_ml_min_kg": 1,
            },
            {
                "compound_name": "caffeine",
                "smiles": "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
                "dose_mg_kg": 10,
                "cmax_ng_ml": 1,
                "auc_ng_h_ml": 1,
                "cl_ml_min_kg": 1,
            },
        ],
    )
    train, test = load_pbpk_holdout(species="unittest", test_fraction=0.5, seed=1)
    all_names = set(train["compound_name"]) | set(test["compound_name"])
    # The salt/free-base pair collapsed to a single parent row.
    assert len(train) + len(test) == 2
    assert not ({"propranolol", "propranolol HCl"} <= all_names)


def test_no_scaffold_leaks_across_split(tmp_path, monkeypatch):
    monkeypatch.setattr(pbpk_holdout, "DATASETS_DIR", str(tmp_path))
    rows = [
        {
            "compound_name": f"c{i}",
            "smiles": smi,
            "dose_mg_kg": 10,
            "cmax_ng_ml": 1,
            "auc_ng_h_ml": 1,
            "cl_ml_min_kg": 1,
        }
        for i, smi in enumerate(
            [
                "CC(=O)Nc1ccc(O)cc1",
                "CC(C)Cc1ccc(cc1)C(C)C(=O)O",
                "CC(C)NCC(O)COc1cccc2ccccc12",
                "CN1C(=O)CN=C(c2ccccc2)c3cc(Cl)ccc13",
                "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
                "CC(=O)Oc1ccccc1C(=O)O",
            ]
        )
    ]
    monkeypatch.setattr(pbpk_holdout, "DATASETS_DIR", str(tmp_path))
    _write_benchmark(tmp_path, rows)
    train, test = load_pbpk_holdout(species="unittest", test_fraction=0.5, seed=3)
    overlap = set(train["scaffold"]) & set(test["scaffold"])
    assert overlap == set()
    assert len(test) > 0 and len(train) > 0


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
