import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs, Descriptors, Crippen
from utils.descriptors import smiles_to_mol, compute_descriptors


KINASE_PHARMACOPHORE = {
    "hinge_binder": "[nH]c1ncnc1",
    "kinase_scaffold": "c1ccc2[nH]c3ccccc3c2c1",
    "aminopyrimidine": "Nc1ncccn1",
}

TARGET_PROFILES = {
    "EGFR": {
        "uniprot": "P00533",
        "name": "Epidermal Growth Factor Receptor",
        "target_class": "Tyrosine Kinase",
        "preferred_logp_range": (2, 5),
        "preferred_mw_range": (300, 560),
        "preferred_tpsa_range": (60, 120),
        "key_features": ["quinazoline", "anilinoquinazoline", "pyrimidine"],
        "smarts_patterns": [
            "c1cnc2ccccc2n1",
            "c1ccc(Nc2ncccn2)cc1",
            "c1cnc(Nc2ccccc2)nc1",
        ],
        "reference_drugs": {
            "Erlotinib": "C=Cc1cc2c(Nc3ccc(OC)c(OC)c3)ncnc2cc1OC",
            "Gefitinib": "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
        },
    },
    "BRAF": {
        "uniprot": "P15056",
        "name": "Serine/threonine-protein kinase B-raf",
        "target_class": "Serine/Threonine Kinase",
        "preferred_logp_range": (2, 6),
        "preferred_mw_range": (350, 600),
        "preferred_tpsa_range": (60, 130),
        "key_features": ["sulfonamide", "pyridine", "urea"],
        "smarts_patterns": [
            "NS(=O)(=O)c1ccccc1",
            "NC(=O)Nc1ccccc1",
        ],
        "reference_drugs": {
            "Vemurafenib": "CCCS(=O)(=O)Nc1ccc(-c2c3cc(F)ccc3[nH]c2c2ccncc2)cc1",
        },
    },
    "BCL2": {
        "uniprot": "P10415",
        "name": "Apoptosis regulator Bcl-2",
        "target_class": "Anti-Apoptotic (PPI)",
        "preferred_logp_range": (3, 7),
        "preferred_mw_range": (400, 900),
        "preferred_tpsa_range": (80, 180),
        "key_features": ["macrocycle", "sulfonamide", "biphenyl"],
        "smarts_patterns": [
            "c1ccc(-c2ccccc2)cc1",
        ],
        "reference_drugs": {
            "Venetoclax": "CC1(C)CCC(c2ccc(Cl)cc2)=C(c2ccc(NC(=O)c3cc(cc4ccccc34)S(=O)(=O)Nc3cc(NS(C)(=O)=O)ccc3OC)cc2)C1",
        },
    },
    "COX2": {
        "uniprot": "P35354",
        "name": "Prostaglandin G/H Synthase 2 (COX-2)",
        "target_class": "Cyclooxygenase",
        "preferred_logp_range": (1, 4),
        "preferred_mw_range": (200, 450),
        "preferred_tpsa_range": (40, 100),
        "key_features": ["sulfonamide", "diaryl", "carboxylic_acid"],
        "smarts_patterns": [
            "c1ccc(-c2ccccc2)cc1",
            "NS(=O)(=O)",
        ],
        "reference_drugs": {
            "Celecoxib": "Cc1ccc(-c2cc(C(F)(F)F)nn2-c2ccc(S(N)(=O)=O)cc2)cc1",
        },
    },
    "HDAC": {
        "uniprot": "Q13547",
        "name": "Histone Deacetylase 1",
        "target_class": "Epigenetic Enzyme",
        "preferred_logp_range": (1, 4),
        "preferred_mw_range": (250, 500),
        "preferred_tpsa_range": (60, 130),
        "key_features": ["hydroxamic_acid", "benzamide", "cap_group"],
        "smarts_patterns": [
            "C(=O)NO",
            "NC(=O)c1ccccc1",
        ],
        "reference_drugs": {
            "Vorinostat": "ONC(=O)CCCCCCC(=O)Nc1ccccc1",
        },
    },
}


def predict_binding(smiles: str, target_id: str | None = None) -> dict:
    mol = smiles_to_mol(smiles)
    desc = compute_descriptors(smiles)

    fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=2048)

    if target_id and target_id in TARGET_PROFILES:
        targets_to_score = {target_id: TARGET_PROFILES[target_id]}
    else:
        targets_to_score = TARGET_PROFILES

    results = []
    for tid, profile in targets_to_score.items():
        score_data = _score_target(mol, fp, desc, profile)
        results.append({
            "target_id": tid,
            "uniprot": profile["uniprot"],
            "target_name": profile["name"],
            "target_class": profile["target_class"],
            "binding_probability": round(score_data["probability"], 3),
            "estimated_pIC50": round(score_data["pic50"], 2),
            "estimated_IC50_nM": round(10 ** (9 - score_data["pic50"]), 1),
            "confidence": score_data["confidence"],
            "evidence": score_data["evidence"],
        })

    results.sort(key=lambda x: x["binding_probability"], reverse=True)

    return {
        "smiles": smiles,
        "predictions": results,
        "model_info": {
            "engine": "HakaseAI DrugTarget-Predictor v1.0",
            "method": "Pharmacophore matching + descriptor-based QSAR",
            "targets_screened": len(results),
        },
    }


def _score_target(mol, fp, desc, profile):
    evidence = []
    score = 0.0

    mw = desc["MolWt"]
    logp = desc["LogP"]
    tpsa = desc["TPSA"]

    mw_lo, mw_hi = profile["preferred_mw_range"]
    if mw_lo <= mw <= mw_hi:
        score += 0.15
        evidence.append(f"MW {mw:.0f} Da within preferred range ({mw_lo}-{mw_hi})")

    lp_lo, lp_hi = profile["preferred_logp_range"]
    if lp_lo <= logp <= lp_hi:
        score += 0.1
        evidence.append(f"LogP {logp:.1f} within preferred range ({lp_lo}-{lp_hi})")

    tp_lo, tp_hi = profile["preferred_tpsa_range"]
    if tp_lo <= tpsa <= tp_hi:
        score += 0.1
        evidence.append(f"TPSA {tpsa:.0f} within preferred range")

    for smarts_pat in profile.get("smarts_patterns", []):
        pat = Chem.MolFromSmarts(smarts_pat)
        if pat and mol.HasSubstructMatch(pat):
            score += 0.2
            evidence.append(f"Contains pharmacophore pattern: {smarts_pat}")
            break

    max_sim = 0.0
    best_ref = None
    for ref_name, ref_smiles in profile.get("reference_drugs", {}).items():
        ref_mol = Chem.MolFromSmiles(ref_smiles)
        if ref_mol:
            ref_fp = AllChem.GetMorganFingerprintAsBitVect(ref_mol, 2, nBits=2048)
            sim = DataStructs.TanimotoSimilarity(fp, ref_fp)
            if sim > max_sim:
                max_sim = sim
                best_ref = ref_name

    if max_sim > 0.3:
        score += min(0.35, max_sim)
        evidence.append(f"Tanimoto similarity {max_sim:.2f} to {best_ref}")
    elif max_sim > 0.15:
        score += max_sim * 0.5
        evidence.append(f"Weak similarity {max_sim:.2f} to {best_ref}")

    score = min(score, 0.95)

    pic50 = 5.0 + score * 5
    if max_sim > 0.5:
        pic50 += (max_sim - 0.5) * 3

    if score > 0.6:
        conf = "High"
    elif score > 0.35:
        conf = "Medium"
    else:
        conf = "Low"

    return {
        "probability": score,
        "pic50": pic50,
        "confidence": conf,
        "evidence": evidence,
    }
