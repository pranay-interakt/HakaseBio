"""Compute physicochemical properties using RDKit."""

import pandas as pd
from rdkit import Chem
from rdkit.Chem.Crippen import MolLogP
from rdkit.Chem.Descriptors import MolWt
from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams
from rdkit.Chem.QED import qed
from rdkit.Chem.rdMolDescriptors import (
    CalcNumAtomStereoCenters,
    CalcNumHBA,
    CalcNumHBD,
    CalcTPSA,
)

from tqdm import tqdm


params_pains = FilterCatalogParams()
params_pains.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS)
catalog_pains = FilterCatalog(params_pains)

params_brenk = FilterCatalogParams()
params_brenk.AddCatalog(FilterCatalogParams.FilterCatalogs.BRENK)
catalog_brenk = FilterCatalog(params_brenk)

params_nih = FilterCatalogParams()
params_nih.AddCatalog(FilterCatalogParams.FilterCatalogs.NIH)
catalog_nih = FilterCatalog(params_nih)


def pains_alert(mol: Chem.Mol) -> int:
    """Determines how many of the PAINS alert rules are satisfied by the molecule.

    :param mol: An RDKit molecule.
    :return: The number of PAINS alert rules satisfied by the molecule.
    """
    return len(catalog_pains.GetMatches(mol))


def brenk_alert(mol: Chem.Mol) -> int:
    """Determines how many of the BRENK alert rules are satisfied by the molecule.

    :param mol: An RDKit molecule.
    :return: The number of BRENK alert rules satisfied by the molecule.
    """
    return len(catalog_brenk.GetMatches(mol))


def nih_alert(mol: Chem.Mol) -> int:
    """Determines how many of the NIH alert rules are satisfied by the molecule.

    :param mol: An RDKit molecule.
    :return: The number of NIH alert rules satisfied by the molecule.
    """
    return len(catalog_nih.GetMatches(mol))


def lipinski_rule_of_five(mol: Chem.Mol) -> float:
    """Determines how many of the Lipinski rules are satisfied by the molecule.

    :param mol: An RDKit molecule.
    :return: The number of Lipinski rules satisfied by the molecule.
    """
    return float(
        sum(
            [
                MolWt(mol) <= 500,
                MolLogP(mol) <= 5,
                CalcNumHBA(mol) <= 10,
                CalcNumHBD(mol) <= 5,
            ]
        )
    )


PHYSCHEM_PROPERTY_TO_FUNCTION = {
    "molecular_weight": MolWt,
    "logP": MolLogP,
    "hydrogen_bond_acceptors": CalcNumHBA,
    "hydrogen_bond_donors": CalcNumHBD,
    "Lipinski": lipinski_rule_of_five,
    "QED": qed,
    "stereo_centers": CalcNumAtomStereoCenters,
    "tpsa": CalcTPSA,
    "PAINS_alert": pains_alert,
    "BRENK_alert": brenk_alert,
    "NIH_alert": nih_alert,
}


def compute_physicochemical_properties(all_smiles: list[str], mols: list[Chem.Mol] | None = None) -> pd.DataFrame:
    """Compute physicochemical properties for a list of molecules.

    :param all_smiles: A list of SMILES.
    :param mols: A list of RDKit molecules. If None, RDKit molecules will be computed from the SMILES.
    :return: A DataFrame containing the computed physicochemical properties with SMILES strings as the index.
    """
    # Compute RDKit molecules if needed
    if mols is None:
        mols = [Chem.MolFromSmiles(smiles) for smiles in all_smiles]
    else:
        assert len(all_smiles) == len(mols)

    # Compute phyiscochemical properties and put in DataFrame with SMILES as index
    physchem_properties = pd.DataFrame(
        data=[
            {
                property_name: property_function(mol)
                for property_name, property_function in PHYSCHEM_PROPERTY_TO_FUNCTION.items()
            }
            for mol in tqdm(mols, desc="Computing physchem properties")
        ],
        index=all_smiles,
    )

    return physchem_properties
