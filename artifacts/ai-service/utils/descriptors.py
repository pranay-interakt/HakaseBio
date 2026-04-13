from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski, rdMolDescriptors, Crippen
import numpy as np


DESCRIPTOR_NAMES = [
    "MolWt", "LogP", "TPSA", "HBA", "HBD", "RotBonds",
    "AromaticRings", "HeavyAtoms", "FractionCSP3", "NumRings",
    "MolRefractivity", "NumHeteroatoms", "NumAmideBonds",
    "LabuteASA", "BalabanJ", "BertzCT",
    "NumAliphaticRings", "NumSaturatedRings",
    "NumAromaticHeterocycles", "NumSaturatedHeterocycles",
    "Chi0v", "Chi1v", "Chi2v", "Chi3v",
    "Kappa1", "Kappa2", "Kappa3",
    "HallKierAlpha",
]


def smiles_to_mol(smiles: str):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Invalid SMILES: {smiles}")
    return mol


def compute_descriptors(smiles: str) -> dict[str, float]:
    mol = smiles_to_mol(smiles)
    return {
        "MolWt": Descriptors.MolWt(mol),
        "LogP": Crippen.MolLogP(mol),
        "TPSA": Descriptors.TPSA(mol),
        "HBA": Lipinski.NumHAcceptors(mol),
        "HBD": Lipinski.NumHDonors(mol),
        "RotBonds": Lipinski.NumRotatableBonds(mol),
        "AromaticRings": Descriptors.NumAromaticRings(mol),
        "HeavyAtoms": Descriptors.HeavyAtomCount(mol),
        "FractionCSP3": Descriptors.FractionCSP3(mol),
        "NumRings": Descriptors.RingCount(mol),
        "MolRefractivity": Crippen.MolMR(mol),
        "NumHeteroatoms": Descriptors.NumHeteroatoms(mol),
        "NumAmideBonds": rdMolDescriptors.CalcNumAmideBonds(mol),
        "LabuteASA": Descriptors.LabuteASA(mol),
        "BalabanJ": Descriptors.BalabanJ(mol) if Descriptors.RingCount(mol) > 0 else 0.0,
        "BertzCT": Descriptors.BertzCT(mol),
        "NumAliphaticRings": Descriptors.NumAliphaticRings(mol),
        "NumSaturatedRings": Descriptors.NumSaturatedRings(mol),
        "NumAromaticHeterocycles": Descriptors.NumAromaticHeterocycles(mol),
        "NumSaturatedHeterocycles": Descriptors.NumSaturatedHeterocycles(mol),
        "Chi0v": Descriptors.Chi0v(mol),
        "Chi1v": Descriptors.Chi1v(mol),
        "Chi2v": Descriptors.Chi2v(mol),
        "Chi3v": Descriptors.Chi3v(mol),
        "Kappa1": Descriptors.Kappa1(mol),
        "Kappa2": Descriptors.Kappa2(mol),
        "Kappa3": Descriptors.Kappa3(mol),
        "HallKierAlpha": Descriptors.HallKierAlpha(mol),
    }


def descriptor_vector(smiles: str) -> np.ndarray:
    d = compute_descriptors(smiles)
    return np.array([d[n] for n in DESCRIPTOR_NAMES], dtype=np.float64)
