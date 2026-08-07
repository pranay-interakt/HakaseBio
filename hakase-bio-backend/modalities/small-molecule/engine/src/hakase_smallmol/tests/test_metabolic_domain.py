"""Tests for the metabolic-clearance applicability guard.

The well-stirred IVIVE model is a HEPATIC METABOLIC model and is out of domain
for transporter-mediated (OATP uptake / biliary) clearance. The guard flags a
curated, cited list of known transporter substrates (rosuvastatin, bosentan,
troglitazone, …) by InChIKey, and leaves purely-metabolic drugs (diazepam,
diclofenac) in domain.

Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_metabolic_domain.py -q
"""

from __future__ import annotations

import pytest

from hakase_smallmol.pk_ivive import metabolic_domain as MD
from hakase_smallmol.pk_ivive import pk_ivive as PK

# Rosuvastatin — OATP1B1/1B3 uptake + biliary substrate; the canonical out-of-
# domain case. Written here in a DIFFERENT (achiral) SMILES form than the curated
# file stores, to prove matching is by InChIKey connectivity, not string match.
ROSUVASTATIN_ACHIRAL = "CC(C)c1nc(N(C)S(C)(=O)=O)nc(-c2ccc(F)cc2)c1C=CC(O)CC(O)CC(=O)O"
BOSENTAN = "COc1ccc(-c2nc(NS(=O)(=O)c3ccc(C(C)(C)C)cc3)c(OCCO)c(-c3ccccn3)n2)cc1"
# Diazepam — pure CYP metabolic clearance; must stay in domain.
DIAZEPAM = "CN1C(=O)CN=C(c2ccccc2)c2cc(Cl)ccc21"
# Diclofenac — an ACID, highly protein bound (fu ~0.017), yet metabolically
# cleared and part of the validated in-domain metabolic-CL set. It is the reason
# a naive acid+binding physchem heuristic is NOT shipped; it must stay in domain.
DICLOFENAC = "OC(=O)Cc1ccccc1Nc1c(Cl)cccc1Cl"

_ML = {
    "clint_hep_ul_min_1e6": 50.0,
    "fu_plasma": 0.1,
    "vdss_l_per_kg": 1.0,
    "half_life_obach_h": 5.0,
}


# --------------------------------------------------------------------------- #
# The guard, in isolation
# --------------------------------------------------------------------------- #
def test_rosuvastatin_flagged_out_of_domain_for_metabolic_cl():
    v = MD.assess_metabolic_clearance_domain(ROSUVASTATIN_ACHIRAL)
    assert v.in_domain is False
    assert v.verdict == MD.OUT_OF_DOMAIN_VERDICT
    assert v.check_ran is True
    assert v.compound == "Rosuvastatin"
    assert "OATP" in (v.mechanism or "")
    assert v.rationale and "out of domain" in v.rationale.lower()
    assert any("PMID" in r for r in v.references)


def test_bosentan_flagged_out_of_domain():
    v = MD.assess_metabolic_clearance_domain(BOSENTAN)
    assert v.in_domain is False
    assert v.verdict == MD.OUT_OF_DOMAIN_VERDICT


def test_diazepam_pure_metabolic_is_in_domain():
    v = MD.assess_metabolic_clearance_domain(DIAZEPAM)
    assert v.in_domain is True
    assert v.verdict == MD.IN_DOMAIN_VERDICT
    assert v.rationale is None
    assert v.check_ran is True


def test_diclofenac_metabolic_acid_is_in_domain():
    # Guards against a false positive: an acidic, highly-bound but metabolically
    # cleared drug must NOT be flagged.
    v = MD.assess_metabolic_clearance_domain(DICLOFENAC)
    assert v.in_domain is True
    assert v.verdict == MD.IN_DOMAIN_VERDICT


def test_invalid_smiles_does_not_manufacture_exclusion():
    v = MD.assess_metabolic_clearance_domain("not-a-smiles")
    assert v.in_domain is True  # conservative: never a false out-of-domain
    assert v.check_ran is False


def test_lookup_matches_by_inchikey_skeleton():
    flag = MD.lookup_nonmetabolic_flag(ROSUVASTATIN_ACHIRAL)
    assert flag is not None and flag.compound_name == "Rosuvastatin"
    assert MD.lookup_nonmetabolic_flag(DIAZEPAM) is None


# --------------------------------------------------------------------------- #
# Integration into predict_pk_ivive
# --------------------------------------------------------------------------- #
def test_predict_pk_ivive_surfaces_out_of_domain_for_rosuvastatin():
    res = PK.predict_pk_ivive(ROSUVASTATIN_ACHIRAL, ml_inputs=_ML, species="human")
    assert res["source"] == "ivive"  # still computes — but flagged, not silent
    block = res["metabolic_clearance_domain"]
    assert block["flagged"] is True
    assert block["verdict"] == MD.OUT_OF_DOMAIN_VERDICT
    # The confidence signal is downgraded and names the concrete limitation.
    assert res["confidence"]["level"] == "low"
    assert "out_of_domain_for_metabolic_cl" in res["confidence"]["flags"]
    assert any("out of domain" in w.lower() for w in res.get("system_warnings", []))


def test_predict_pk_ivive_diazepam_not_flagged():
    res = PK.predict_pk_ivive(DIAZEPAM, ml_inputs=_ML, species="human")
    assert res["source"] == "ivive"
    block = res["metabolic_clearance_domain"]
    assert block["flagged"] is False
    assert block["verdict"] == MD.IN_DOMAIN_VERDICT
    # A pure-metabolic human drug carries no metabolic-CL flag.
    assert "out_of_domain_for_metabolic_cl" not in res["confidence"].get("flags", [])


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
