"""Peptide routing (docs/14 Wave P, P-1): US classification by 21 CFR 600.3(h)(6); ICH routing
by manufacturing origin (S6(R1) section 1.3). Known values come from the primary texts in
docs/research/peptide_routing.md."""

import pytest

from hos.core.regulatory import (
    Indication,
    Modality,
    PeptideOrigin,
    ProgramContext,
    Route,
    derive_study_set,
    us_protein_classification,
)
from hos.core.regulatory.diff import diff_contexts
from hos.core.regulatory.engine import (
    PEPTIDE_ORIGIN_FACT,
    S6_DETERMINATION_FACT,
    RequirementStatus,
)

BASE = dict(indication=Indication.CHRONIC_NON_ONCOLOGY, route=Route.SUBCUTANEOUS,
            intended_clinical_duration_days=365, max_trial_duration_days=28)
SIG = {"signer_name": "Rae Scientist", "role": "responsible_scientist",
       "signed_at": "2026-10-11T10:00:00+00:00"}


def _peptide(**kw):
    return ProgramContext(modality=Modality.PEPTIDE, **BASE, **kw)


def _by_id(ss):
    return {r.id: r for r in ss.requirements}


# ---- 21 CFR 600.3(h)(6) ---------------------------------------------------------------------

def test_insulin_is_a_protein():
    """85 FR 10057: insulin, chains of 21 and 30 amino acids associated as in nature, is 51
    amino acids and so a protein."""
    c = us_protein_classification([21, 30], True)
    assert c.outcome == "protein" and c.amino_acids == 51
    assert "biological product" in c.statement and c.section == "21 CFR 600.3(h)(6)"


@pytest.mark.parametrize(("n", "outcome"), [(40, "not_protein"), (41, "protein"), (2, "not_protein")])
def test_the_line_is_greater_than_forty(n, outcome):
    assert us_protein_classification([n], None).outcome == outcome


@pytest.mark.parametrize(("chains", "assoc", "outcome", "aa"), [
    ([20, 15], None, "not_protein", 35),     # 40 or fewer even counted together
    ([20, 15], False, "not_protein", 35),
    ([41, 5], None, "protein", 41),          # one contiguous chain already exceeds 40
    ([41, 5], False, "protein", 41),
    ([20, 25], True, "protein", 45),         # counted together when associated as in nature
    ([20, 25], None, "pending", None),       # the association decides it
    ([20, 25], False, "pending", None),      # the rule states counting only for natural association
])
def test_multiple_chains(chains, assoc, outcome, aa):
    c = us_protein_classification(chains, assoc)
    assert (c.outcome, c.amino_acids) == (outcome, aa)
    if outcome == "pending":
        assert c.pending_fact


def test_unknown_size_is_pending_and_bad_counts_are_refused():
    c = us_protein_classification([], None)
    assert c.outcome == "pending" and "amino acids in each chain" in c.pending_fact
    for bad in ([0], [-3], [2.5], [True]):
        with pytest.raises(ValueError):
            us_protein_classification(bad, None)


# ---- programme context ----------------------------------------------------------------------

def test_context_validates_the_new_facts():
    with pytest.raises(ValueError, match="peptide programmes only"):
        ProgramContext(modality=Modality.SMALL_MOLECULE, peptide_origin=PeptideOrigin.RECOMBINANT,
                       **BASE)
    with pytest.raises(ValueError, match="not an amino-acid polymer"):
        ProgramContext(modality=Modality.SMALL_MOLECULE, amino_acid_chains=(12,), **BASE)
    with pytest.raises(ValueError, match="its signature"):
        _peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS,
                 s6_determination={"applies": True})
    ctx = _peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS, amino_acid_chains=(21, 30),
                   chains_naturally_associated=True)
    assert ProgramContext.from_dict(ctx.to_dict()) == ctx


def test_older_stored_contexts_still_load():
    d = _peptide().to_dict()
    for k in ("peptide_origin", "amino_acid_chains", "chains_naturally_associated",
              "s6_determination"):
        d.pop(k)
    assert ProgramContext.from_dict(d).peptide_origin is None


# ---- ICH routing ----------------------------------------------------------------------------

def test_chemically_synthesised_peptide_follows_m3r2_with_s6_items_pending():
    ss = derive_study_set(_peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS,
                                   amino_acid_chains=(31,)))
    r = _by_id(ss)
    assert r["genotox.ames"].status is RequirementStatus.REQUIRED          # M3(R2) / S2(R1)
    assert r["tox.repeat_dose_rodent"].status is RequirementStatus.REQUIRED
    for item in ("bio.species_relevance", "bio.immunogenicity"):
        assert r[item].status is RequirementStatus.CONDITIONAL
        assert r[item].pending_fact == S6_DETERMINATION_FACT
    assert {c.key for c in ss.governing_guidelines} >= {"ich_m3r2", "ich_s2r1", "ich_s6r1"}
    assert ss.classification is not None and ss.classification.outcome == "not_protein"


def test_a_long_synthetic_peptide_is_a_us_protein_but_keeps_its_ich_routing():
    """No ICH text draws a 40-amino-acid line: a synthetic 45-mer is a biological product in
    the US yet its nonclinical guideline still follows origin plus the S6 determination."""
    short = derive_study_set(_peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS,
                                      amino_acid_chains=(31,)))
    long_ = derive_study_set(_peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS,
                                      amino_acid_chains=(45,)))
    assert long_.classification.outcome == "protein"
    assert [(r.id, r.status) for r in short.requirements] == \
        [(r.id, r.status) for r in long_.requirements]


def test_recombinant_peptide_follows_s6r1():
    ss = derive_study_set(_peptide(peptide_origin=PeptideOrigin.RECOMBINANT))
    r = _by_id(ss)
    assert "genotox.ames" not in r
    assert r["genotox.battery"].status is RequirementStatus.NOT_REQUIRED     # S6(R1) 4.7
    assert r["bio.species_relevance"].status is RequirementStatus.REQUIRED
    assert {c.key for c in ss.governing_guidelines} == {"ich_m3r2", "ich_s6r1"}


def test_unknown_origin_makes_the_set_conditional_on_it():
    ss = derive_study_set(_peptide())
    assert not ss.required()
    assert all(r.pending_fact for r in ss.conditional())
    assert _by_id(ss)["genotox.ames"].pending_fact == PEPTIDE_ORIGIN_FACT
    assert ss.classification.outcome == "pending"
    assert any("unknown origin" in n for n in ss.notes)


@pytest.mark.parametrize(("applies", "status"), [(True, RequirementStatus.REQUIRED),
                                                 (False, RequirementStatus.NOT_REQUIRED)])
def test_the_signed_determination_decides_the_s6_items(applies, status):
    det = {"applies": applies, "rationale": "40-mer agonist with a non-human target sequence",
           "signature": SIG}
    ss = derive_study_set(_peptide(peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS,
                                   s6_determination=det))
    for item in ("bio.species_relevance", "bio.immunogenicity"):
        r = _by_id(ss)[item]
        assert r.status is status
        assert "Rae Scientist (responsible_scientist) determined on 2026-10-11" in r.rationale


def test_small_molecules_are_unchanged():
    ss = derive_study_set(ProgramContext(modality=Modality.SMALL_MOLECULE, **BASE))
    assert ss.classification is None and "bio.immunogenicity" not in _by_id(ss)


def test_diff_shows_what_the_origin_changes():
    d = diff_contexts(_peptide(), _peptide(peptide_origin=PeptideOrigin.RECOMBINANT))
    assert "peptide_origin" in d.context_changes
    assert not d.unchanged
