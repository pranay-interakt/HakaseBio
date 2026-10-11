"""RDKit descriptors against known reference values (RDKit 2026.09.1)."""

import pytest

from hos.core.descriptors import InvalidStructureError, compute_profile
from hos.core.provenance import ProvenanceKind

ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O"


def test_aspirin_reference_values():
    p = compute_profile(ASPIRIN)
    assert p.formula == "C9H8O4"
    assert p.molecular_weight.value == pytest.approx(180.159, abs=1e-3)
    assert p.tpsa.value == pytest.approx(63.60, abs=1e-2)
    assert p.hbd.value == 1 and p.hba.value == 3
    assert p.clogp.value == pytest.approx(1.3101, abs=1e-3)
    assert p.qed.value == pytest.approx(0.5501, abs=1e-3)
    assert p.inchikey == "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"


@pytest.mark.parametrize(
    "smiles,inchikey",
    [
        ("Cn1cnc2c1c(=O)n(C)c(=O)n2C", "RYYVLZVUVIJVGH-UHFFFAOYSA-N"),  # caffeine
        ("CN(C)C(=N)NC(=N)N", "XZWYZXLIPXDOLR-UHFFFAOYSA-N"),          # metformin
    ],
)
def test_public_identifiers_match(smiles, inchikey):
    assert compute_profile(smiles).inchikey == inchikey


def test_atorvastatin_breaks_ro5_twice():
    smi = ("CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CC[C@@H](O)"
           "C[C@@H](O)CC(=O)O")
    p = compute_profile(smi)
    assert p.lipinski_violations.value == 2  # MW > 500 and cLogP > 5
    assert p.veber_pass is False             # 12 rotatable bonds


def test_every_descriptor_is_computed_with_citation_and_software():
    p = compute_profile(ASPIRIN)
    for name, q in p.quantities().items():
        assert q.provenance.kind is ProvenanceKind.COMPUTED, name
        assert q.provenance.citations, name
        assert "rdkit" in q.provenance.software, name


def test_invalid_structure_raises():
    with pytest.raises(InvalidStructureError):
        compute_profile("not a molecule")
