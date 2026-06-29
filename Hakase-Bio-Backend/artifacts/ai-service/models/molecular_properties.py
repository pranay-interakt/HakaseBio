import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen, Lipinski, rdMolDescriptors, AllChem
from rdkit.Chem import DataStructs
from utils.descriptors import smiles_to_mol, compute_descriptors


def predict_properties(smiles: str) -> dict:
    mol = smiles_to_mol(smiles)
    desc = compute_descriptors(smiles)

    mw = desc["MolWt"]
    logp = desc["LogP"]
    tpsa = desc["TPSA"]
    hba = desc["HBA"]
    hbd = desc["HBD"]
    rot = desc["RotBonds"]
    fsp3 = desc["FractionCSP3"]

    # Delaney ESOL aromatic proportion: #aromatic heavy atoms / #heavy atoms.
    # Computed here (not in _predict_solubility) so the function signature
    # stays small and the helper remains a pure formula.
    heavy_n = mol.GetNumHeavyAtoms()
    aromatic_proportion = (
        sum(1 for a in mol.GetAtoms() if a.GetIsAromatic()) / heavy_n
        if heavy_n > 0 else 0.0
    )
    solubility = _predict_solubility(logp, mw, rot, aromatic_proportion)
    bioavailability = _predict_bioavailability(mw, logp, tpsa, hbd, hba, rot)
    pka = _estimate_pka(mol)
    charge_state = _charge_at_ph(pka, 7.4)

    fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=2048)
    fp_array = np.zeros(2048)
    DataStructs.ConvertToNumpyArray(fp, fp_array)
    complexity = fp_array.sum() / 2048

    return {
        "smiles": smiles,
        "physicochemical": {
            "molecular_weight": round(mw, 2),
            "logP": round(logp, 2),
            "logD_7_4": round(logp - 0.5 * (1 if hba > 2 else 0), 2),
            "tpsa": round(tpsa, 2),
            "hba": int(hba),
            "hbd": int(hbd),
            "rotatable_bonds": int(rot),
            "aromatic_rings": int(desc["AromaticRings"]),
            "heavy_atom_count": int(desc["HeavyAtoms"]),
            "fraction_csp3": round(fsp3, 3),
            "molar_refractivity": round(desc["MolRefractivity"], 2),
        },
        "solubility": {
            "logS_predicted": round(solubility, 2),
            "solubility_mg_mL": round(10 ** solubility * mw, 4),
            "solubility_class": _sol_class(solubility),
        },
        "bioavailability": {
            "oral_bioavailability_pct": round(bioavailability, 1),
            "bioavailability_class": "High" if bioavailability > 70 else "Moderate" if bioavailability > 30 else "Low",
            "rule_of_five_pass": mw <= 500 and logp <= 5 and hba <= 10 and hbd <= 5,
            "veber_pass": tpsa <= 140 and rot <= 10,
            "ghose_pass": 160 <= mw <= 480 and -0.4 <= logp <= 5.6 and 40 <= desc["MolRefractivity"] <= 130,
            "egan_pass": tpsa <= 131.6 and logp <= 5.88,
        },
        "ionization": {
            "estimated_pka": round(pka, 1) if pka else None,
            "charge_at_pH_7_4": charge_state,
        },
        "complexity": {
            "bertz_ct": round(desc["BertzCT"], 1),
            "fingerprint_density": round(complexity, 4),
            "synthetic_accessibility_estimate": round(_sa_estimate(mw, rot, desc["NumRings"], fsp3, complexity), 1),
        },
        "lead_likeness": {
            "lead_like": mw <= 450 and logp <= 4.2 and rot <= 10 and hbd <= 5 and hba <= 8,
            "fragment_like": mw <= 300 and logp <= 3 and hbd <= 3 and hba <= 3 and rot <= 3,
            "ppi_like": mw >= 400 and logp >= 2 and desc["AromaticRings"] >= 2,
        },
        "model_info": {
            "engine": "HakaseAI RDKit-PropertyPredictor v1.0",
            "method": "Physics-based QSPR with RDKit descriptors",
        },
    }


def _predict_solubility(logp, mw, rot, aromatic_proportion):
    """Delaney 2004 ESOL closed-form aqueous solubility (logS, mol/L).

    Reference: Delaney, J. S. (2004). "ESOL: Estimating Aqueous Solubility
    Directly from Molecular Structure." J. Chem. Inf. Comput. Sci., 44(3),
    1000-1005. https://doi.org/10.1021/ci034243x

    Closed-form linear regression — no learning, no fingerprints. This is
    intentionally methodologically distinct from the ML solubility second
    opinion (RandomForest on Morgan FP + RDKit descriptors) so the paired
    UI view in HakaseAI shows two genuinely independent estimates.
    """
    logs = 0.16 - 0.63 * logp - 0.0062 * mw + 0.066 * rot - 0.74 * aromatic_proportion
    return float(np.clip(logs, -10, 2))


def _sol_class(logs):
    if logs > 0:
        return "Highly Soluble"
    elif logs > -2:
        return "Soluble"
    elif logs > -4:
        return "Moderately Soluble"
    elif logs > -6:
        return "Poorly Soluble"
    else:
        return "Insoluble"


def _predict_bioavailability(mw, logp, tpsa, hbd, hba, rot):
    score = 90 - 0.04 * mw - 0.3 * tpsa - 4 * hbd + 3 * min(logp, 3) - 1.5 * rot
    return np.clip(score, 0, 100)


def _estimate_pka(mol):
    smiles = Chem.MolToSmiles(mol)
    if "C(=O)O" in smiles or "c(=O)[nH]" in smiles:
        return 4.5
    if "N" in smiles and "n" not in smiles.lower():
        return 9.0
    if "[NH]" in smiles or "[nH]" in smiles:
        return 7.5
    if "S(=O)(=O)O" in smiles:
        return 1.5
    if "P(=O)(O)" in smiles:
        return 2.5
    return None


def _charge_at_ph(pka, ph):
    if pka is None:
        return "Neutral"
    if pka < ph - 2:
        return "Anionic"
    elif pka > ph + 2:
        return "Cationic"
    else:
        return "Mixed/Zwitterionic"


def _sa_estimate(mw, rot, rings, fsp3, complexity):
    score = 1.0 + 0.003 * mw + 0.2 * rot + 0.3 * rings + 3 * complexity - fsp3
    return np.clip(score, 1, 10)
