"""One-letter codes, FASTA, average mass and HELM structure (docs/14 P4;
docs/research/sequence_entities.md)."""

import json
from pathlib import Path

import pytest

from hos.core.reference_params import RESIDUE_MASS_TABLE, RESIDUE_MASS_TABLE_VERSION
from hos.core.sequence import (
    ALPHABET,
    HelmError,
    average_chain_mass,
    parse_fasta,
    parse_helm,
    sequence_errors,
)

UNIPROT = Path(__file__).parent.parent / "fixtures" / "uniprot"


def _uniprot(acc):
    return json.loads((UNIPROT / f"{acc}.json").read_text())["sequence"]


# ---- known values ---------------------------------------------------------------------------

@pytest.mark.parametrize("acc", ["P01308", "P01275"])
def test_average_mass_matches_uniprot(acc):
    """UniProt states each sequence's mass in daltons, rounded; the ExPASy method (sum of
    average residue masses plus one water) reproduces it."""
    s = _uniprot(acc)
    q = average_chain_mass(s["value"], label=acc)
    assert len(s["value"]) == s["length"]
    assert round(q.require()) == s["molWeight"]
    assert q.provenance.method.id == "seq.average_mass"


def test_average_mass_is_the_stated_sum():
    q = average_chain_mass("GGW", label="x")                  # 2 Gly + Trp + water
    assert q.require() == pytest.approx(2 * 57.0519 + 186.2132 + 18.01524, abs=1e-9)
    assert RESIDUE_MASS_TABLE_VERSION in (q.provenance.notes or "")


def test_residue_masses_are_cited_reference_values():
    p = RESIDUE_MASS_TABLE.get("residue_mass.average.W")
    assert p.value == 186.2132 and p.citation_key == "expasy_findmod_masses"
    assert RESIDUE_MASS_TABLE.get("water_mass.average").value == 18.01524
    assert len(RESIDUE_MASS_TABLE.entries) == 23            # 22 residues and water


def test_ambiguity_codes_have_no_mass_and_sec_is_flagged():
    q = average_chain_mass("ACBX", label="x")
    assert not q.is_available and "B, X" in q.provenance.reason
    sec = average_chain_mass("AUA", label="x")
    assert "selenocysteine_mass_uses_older_selenium_weight" in sec.qc_flags


def test_each_symbol_names_its_authority():
    assert ALPHABET["A"].authority == "IUPAC-IUB 1983"
    assert ALPHABET["U"].authority == "IUPAC-IUB 1983 (later addendum)"
    assert ALPHABET["O"].authority == "ExPASy mass table"
    assert "J" not in ALPHABET


# ---- FASTA ----------------------------------------------------------------------------------

def test_fasta_records_and_line_joining():
    recs, errs = parse_fasta(">heavy chain\nQVQLVQ\nSGAEVK\n\n>light chain\nDIQMTQ SPSS\n")
    assert not errs
    assert [(r.description, r.sequence) for r in recs] == [
        ("heavy chain", "QVQLVQSGAEVK"), ("light chain", "DIQMTQSPSS")]


@pytest.mark.parametrize(("text", "msg"), [
    (">x\nACD*\n", "translation stop"),
    (">x\nAC-D\n", "gap"),
    (">x\nacd\n", "lower-case"),
    (">x\nAC1D\n", "not a one-letter amino-acid code"),
    ("ACD\n>x\nA\n", "before the first '>'"),
    (">\nACD\n", "needs a description"),
    ("", "no FASTA records"),
])
def test_fasta_is_strict(text, msg):
    _, errs = parse_fasta(text)
    assert any(msg in e for e in errs), errs


def test_sequence_errors():
    assert sequence_errors("ACDEFGHIKLMNPQRSTVWY") == []
    assert sequence_errors("") == ["empty sequence"]


# ---- HELM 2.04 ------------------------------------------------------------------------------

@pytest.mark.parametrize("helm", [
    # specification 5.3.1 example
    "PEPTIDE1{A.R.G.[dF].C.K.[ahA].E.D.A}|RNA1{R(A)P.[mR](U)[sP].R(G)P.R([5meC])P.[dR](T)P."
    "[dR](T)P.[dR](T)P}|CHEM1{SS3}$$$$",
    # 5.6.1.1 and 5.6.1.2 in-line SMILES
    "PEPTIDE1{G.[[*:1]N[C@@H](C=O)C([*:2])=O].C}$$$$",
    "PEPTIDE1{G.[[*]N[C@@H](C=O)C([*])=O |$_R1;;;;;;_R2;$|].C}$$$$",
    # a disulfide-cyclised peptide: a connection within one polymer (5.3)
    "PEPTIDE1{C.A.A.A.C}$PEPTIDE1,PEPTIDE1,1:R3-5:R3$$$",
])
def test_specification_examples_parse(helm):
    st = parse_helm(helm)
    assert st.polymers and not st.uses_helm2_features and st.version is None


def test_helm2_features_and_marker():
    st = parse_helm("PEPTIDE1{A.(G,L).A'3'}$$G1(PEPTIDE1)$$V2.0")
    assert st.uses_helm2_features and st.version == "V2.0"
    assert [m.kind for m in st.polymers[0].monomers] == ["id", "list", "id"]
    assert st.polymers[0].monomers[2].repeat == "3"
    unmarked = parse_helm("PEPTIDE1{A.(G,L)}$$$$")
    assert unmarked.warnings and "V2.0" in unmarked.warnings[0]
    ann = parse_helm('PEPTIDE1{A}"hc"$$${"PEPTIDE1":{"ChainType":"hc"}}$V2.0')
    assert ann.extended_annotation == {"PEPTIDE1": {"ChainType": "hc"}}


def test_monomer_positions_count_branches_for_connections():
    st = parse_helm("RNA1{R(A)P.R(G)P}|CHEM1{SS3}$RNA1,CHEM1,6:R2-1:R1$$$")
    assert len(st.polymers[0].monomers) == 6 and st.connections[0].source_position == "6"


@pytest.mark.parametrize(("helm", "msg"), [
    ("PEPTIDE1{A.C}$$$", "four sections"),
    ("PEPTIDE1{AC}$$$$", "more than one monomer"),
    ("PEPTIDE1{A.C}$PEPTIDE1,PEPTIDE1,1:R3-9:R3$$$", "has no monomer 9"),
    ("PEPTIDE1{A. C}$$$$", "whitespace"),
    ("PEP1{A}$$$$", "not a polymer ID"),
    ("PEPTIDE1{A}$$${bad}$V2.0", "not valid JSON"),
    ("PEPTIDE1{A}$$$$V3", "'V2.0' or nothing"),
    ("PEPTIDE1{(A+G,L)}$$$$V2.0", "mixes"),
    ("PEPTIDE1{A'5-2'}$$$$V2.0", "minimum above its maximum"),
    ("PEPTIDE1{A}$PEPTIDE1,PEPTIDE9,1:R3-1:R3$$$", "not a polymer or group"),
    ("PEPTIDE1{A}$PEPTIDE1,PEPTIDE1,1:Q3-1:R3$$$", "not an attachment point"),
    ("PEPTIDE1{A}|PEPTIDE1{C}$$$$", "unique"),
    ("PEPTIDE1{A}$$G1(PEPTIDE2)$$V2.0", "not a polymer or group"),
])
def test_malformed_helm_is_refused(helm, msg):
    with pytest.raises(HelmError) as exc:
        parse_helm(helm)
    assert any(msg in e for e in exc.value.errors), exc.value.errors
