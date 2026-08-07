"""Unit tests for the neutral-logP resolver (S2-T5 follow-up).

Hermetic — no ML calls. Where a logD is needed it is passed explicitly; the pKa
comes from the RDKit-only heuristic backend. They pin the resolver's contract:

  * fused-azole weak bases are capped downward onto the logD reconstruction,
  * moderate/strong bases and non-bases (the compounds that already validate) are
    left on Crippen — the guarantee that keeps the Vss gate from regressing,
  * the cap is one-directional (never inflates), and degrades to Crippen with no logD.

Run:  python3 -m pytest modalities/small-molecule/validation/tests/test_logp_resolver.py
"""

from __future__ import annotations

import math

from hakase_smallmol.pk_ivive.logp_resolver import (
    MAX_LOG10R_FOR_LOGD,
    resolve_neutral_logp,
)
from hakase_smallmol.pk_ivive.pka import (
    MicroPka,
    PkaResult,
    SiteType,
    classify,
    predict_pka,
)


def _pka(*sites: MicroPka) -> PkaResult:
    tup = tuple(sites)
    return PkaResult(
        smiles="test",
        sites=tup,
        ionisation_class=classify(tup),
        provenance="test",
        backend="test",
        low_confidence=False,
    )


def test_weak_base_is_capped_downward_to_reconstruction():
    # Base pKa 7.0 → log10 R(7.4) ≈ 0.15 (well within the reliable window). Crippen
    # over-estimates; the resolver caps it to logD + log10 R.
    pka = _pka(MicroPka(pka=7.0, site_type=SiteType.BASE))
    r = resolve_neutral_logp(crippen_logp=4.32, pka_result=pka, logd_7_4=3.06)
    log10r = math.log10(1.0 + 10.0 ** (7.0 - 7.4))
    assert r.source == "logd-capped"
    assert r.logp == 3.06 + log10r
    assert r.logp < 4.32  # strictly lowered


def test_strong_base_is_left_on_crippen():
    # Base pKa 10.5 → log10 R ≈ 3.1 ≫ threshold: reconstruction unreliable, so
    # Crippen is kept even though logD is far lower. This protects chlorpromazine /
    # pentazocine / propranolol — the class the reverted global swap over-corrected.
    pka = _pka(MicroPka(pka=10.5, site_type=SiteType.BASE))
    r = resolve_neutral_logp(crippen_logp=4.89, pka_result=pka, logd_7_4=3.21)
    assert r.source == "crippen"
    assert r.logp == 4.89
    assert r.log10_r_plasma is not None and r.log10_r_plasma > MAX_LOG10R_FOR_LOGD


def test_neutral_is_left_on_crippen():
    # No ionisable site → not the base regime → untouched (protects the diazepam /
    # barbiturate Vss-gate anchors).
    r = resolve_neutral_logp(crippen_logp=3.15, pka_result=_pka(), logd_7_4=2.60)
    assert r.source == "crippen"
    assert r.logp == 3.15


def test_acid_is_left_on_crippen():
    pka = _pka(MicroPka(pka=4.5, site_type=SiteType.ACID))
    r = resolve_neutral_logp(crippen_logp=2.29, pka_result=pka, logd_7_4=0.61)
    assert r.source == "crippen"
    assert r.logp == 2.29


def test_cap_is_one_directional_never_inflates():
    # Weak base but Crippen already reads BELOW the reconstruction → keep Crippen,
    # never raise it (this directionality is what the reverted attempt lacked).
    pka = _pka(MicroPka(pka=7.0, site_type=SiteType.BASE))
    r = resolve_neutral_logp(crippen_logp=2.0, pka_result=pka, logd_7_4=3.0)
    assert r.source == "crippen"
    assert r.logp == 2.0


def test_missing_logd_degrades_to_crippen():
    pka = _pka(MicroPka(pka=7.0, site_type=SiteType.BASE))
    r = resolve_neutral_logp(crippen_logp=4.32, pka_result=pka, logd_7_4=None)
    assert r.source == "crippen"
    assert r.logp == 4.32


def test_midazolam_smiles_with_heuristic_pka_is_capped():
    # End-to-end with the real (heuristic) pKa the pipeline uses: midazolam's fused
    # imidazole is caught as a base pKa ~7, so a supplied logD caps Crippen down.
    smiles = "Cc1ncc2n1-c1ccc(Cl)cc1C(c1ccccc1F)=NC2"
    pka = predict_pka(smiles, allow_heuristic=True)
    r = resolve_neutral_logp(crippen_logp=4.32, pka_result=pka, logd_7_4=3.06)
    assert r.source == "logd-capped"
    assert r.logp < 4.0  # onto ~3.2, near experimental logP 3.1


def test_chlorpromazine_smiles_with_heuristic_pka_is_untouched():
    # Strong aliphatic-amine base → large R → Crippen kept (accurate at 4.9 vs 5.19).
    smiles = "CN(C)CCCN1c2ccccc2Sc2ccc(Cl)cc21"
    pka = predict_pka(smiles, allow_heuristic=True)
    r = resolve_neutral_logp(crippen_logp=4.89, pka_result=pka, logd_7_4=3.21)
    assert r.source == "crippen"
    assert r.logp == 4.89
