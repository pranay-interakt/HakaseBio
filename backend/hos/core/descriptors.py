"""Molecular descriptors computed with RDKit.

All descriptors are produced by published, peer-reviewed algorithms as implemented
in RDKit; nothing here is a bespoke approximation. The RDKit version in use is
recorded in the provenance of every value so a result can be reproduced exactly.

Reference values used in the unit tests (RDKit 2026.09.1, aspirin
``CC(=O)Oc1ccccc1C(=O)O``): MW 180.159 g/mol, TPSA 63.60 A^2, HBD 1, HBA 3,
cLogP 1.3101, QED 0.5501.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import rdkit
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors

from hos.core.methods import method
from hos.core.quantity import Quantity

__all__ = ["MolecularProfile", "parse_smiles", "compute_profile", "RDKIT_VERSION"]

RDLogger.DisableLog("rdApp.*")

RDKIT_VERSION: str = rdkit.__version__
_SOFTWARE = {"rdkit": RDKIT_VERSION}


class InvalidStructureError(ValueError):
    """Raised when a structure string cannot be parsed into a valid molecule."""


def parse_smiles(smiles: str) -> Chem.Mol:
    """Parse and sanitise a SMILES string.

    Raises :class:`InvalidStructureError` rather than returning ``None``, so an
    unparseable structure can never flow silently into a calculation.
    """
    if not smiles or not smiles.strip():
        raise InvalidStructureError("empty SMILES string")
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise InvalidStructureError(f"RDKit could not parse SMILES: {smiles!r}")
    return mol


@dataclass(frozen=True, slots=True)
class MolecularProfile:
    """Computed structural identity and physicochemical descriptors for one molecule."""

    input_smiles: str
    canonical_smiles: str
    inchi: Optional[str]
    inchikey: Optional[str]
    formula: str
    molecular_weight: Quantity
    exact_mass: Quantity
    clogp: Quantity
    tpsa: Quantity
    hbd: Quantity
    hba: Quantity
    rotatable_bonds: Quantity
    molar_refractivity: Quantity
    qed: Quantity
    fraction_csp3: Quantity
    ring_count: Quantity
    aromatic_ring_count: Quantity
    heavy_atom_count: Quantity
    lipinski_violations: Quantity
    lipinski_pass: bool
    veber_pass: bool
    rdkit_version: str = RDKIT_VERSION

    def quantities(self) -> dict[str, Quantity]:
        return {
            "molecular_weight": self.molecular_weight,
            "exact_mass": self.exact_mass,
            "clogp": self.clogp,
            "tpsa": self.tpsa,
            "hbd": self.hbd,
            "hba": self.hba,
            "rotatable_bonds": self.rotatable_bonds,
            "molar_refractivity": self.molar_refractivity,
            "qed": self.qed,
            "fraction_csp3": self.fraction_csp3,
            "ring_count": self.ring_count,
            "aromatic_ring_count": self.aromatic_ring_count,
            "heavy_atom_count": self.heavy_atom_count,
            "lipinski_violations": self.lipinski_violations,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_smiles": self.input_smiles,
            "canonical_smiles": self.canonical_smiles,
            "inchi": self.inchi,
            "inchikey": self.inchikey,
            "formula": self.formula,
            "rdkit_version": self.rdkit_version,
            "lipinski_pass": self.lipinski_pass,
            "veber_pass": self.veber_pass,
            "descriptors": {k: q.to_dict() for k, q in self.quantities().items()},
        }


def _q(value: float, unit: str, method_id: str, label: str) -> Quantity:
    return Quantity.computed(
        float(value),
        unit,
        method=method(method_id),
        software=_SOFTWARE,
        label=label,
    )


def compute_profile(smiles: str) -> MolecularProfile:
    """Compute the full descriptor profile for a structure.

    Every returned descriptor is a :class:`Quantity` with ``COMPUTED`` provenance
    naming the algorithm's primary citation and the RDKit version used.
    """
    mol = parse_smiles(smiles)

    try:
        inchi = Chem.MolToInchi(mol)
        inchikey = Chem.MolToInchiKey(mol) if inchi else None
    except Exception:  # InChI generation can fail for exotic valences
        inchi, inchikey = None, None

    mw = Descriptors.MolWt(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)
    clogp = Crippen.MolLogP(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    rotb = rdMolDescriptors.CalcNumRotatableBonds(mol)

    # Lipinski rule of five (Lipinski 2001): MW<=500, cLogP<=5, HBD<=5, HBA<=10
    violations = sum([mw > 500.0, clogp > 5.0, hbd > 5, hba > 10])
    # Veber (2002): rotatable bonds <= 10 and TPSA <= 140 A^2
    veber_pass = bool(rotb <= 10 and tpsa <= 140.0)

    return MolecularProfile(
        input_smiles=smiles,
        canonical_smiles=Chem.MolToSmiles(mol),
        inchi=inchi,
        inchikey=inchikey,
        formula=rdMolDescriptors.CalcMolFormula(mol),
        molecular_weight=_q(mw, "g/mol", "descr.mw", "Molecular weight"),
        exact_mass=_q(Descriptors.ExactMolWt(mol), "g/mol", "descr.mw", "Exact mass"),
        clogp=_q(clogp, "dimensionless", "descr.clogp", "cLogP (Crippen)"),
        tpsa=_q(tpsa, "angstrom**2", "descr.tpsa", "Topological polar surface area"),
        hbd=_q(hbd, "dimensionless", "descr.hbd", "H-bond donors"),
        hba=_q(hba, "dimensionless", "descr.hba", "H-bond acceptors"),
        rotatable_bonds=_q(rotb, "dimensionless", "descr.rotb", "Rotatable bonds"),
        molar_refractivity=_q(Crippen.MolMR(mol), "dimensionless", "descr.mr",
                              "Molar refractivity"),
        qed=_q(QED.qed(mol), "dimensionless", "descr.qed", "QED drug-likeness"),
        fraction_csp3=_q(rdMolDescriptors.CalcFractionCSP3(mol), "dimensionless",
                         "descr.fsp3", "Fraction Csp3"),
        ring_count=_q(rdMolDescriptors.CalcNumRings(mol), "dimensionless",
                      "descr.rings", "Ring count"),
        aromatic_ring_count=_q(rdMolDescriptors.CalcNumAromaticRings(mol), "dimensionless",
                               "descr.aromatic_rings", "Aromatic rings"),
        heavy_atom_count=_q(mol.GetNumHeavyAtoms(), "dimensionless",
                            "descr.heavy_atoms", "Heavy atoms"),
        lipinski_violations=_q(violations, "dimensionless", "rule.lipinski_ro5",
                               "Lipinski Ro5 violations"),
        lipinski_pass=bool(violations <= 1),
        veber_pass=veber_pass,
    )
