import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen, Lipinski, rdMolDescriptors
from rdkit.Chem.QED import qed
from utils.descriptors import smiles_to_mol, compute_descriptors


def predict_admet(smiles: str) -> dict:
    mol = smiles_to_mol(smiles)
    desc = compute_descriptors(smiles)

    mw = desc["MolWt"]
    logp = desc["LogP"]
    tpsa = desc["TPSA"]
    hba = desc["HBA"]
    hbd = desc["HBD"]
    rot = desc["RotBonds"]
    fsp3 = desc["FractionCSP3"]
    arom_rings = desc["AromaticRings"]
    mr = desc["MolRefractivity"]

    caco2 = _predict_caco2(logp, tpsa, mw, hbd)
    hia = _predict_hia(logp, tpsa, mw, hbd, rot)
    pgp_substrate = _predict_pgp(mw, logp, hbd, hba)
    bbb = _predict_bbb(logp, tpsa, mw, hbd)
    ppb = _predict_ppb(logp, mw, arom_rings)
    vd = _predict_vd(logp, mw, ppb)
    cyp_inhibition = _predict_cyp_inhibition(logp, mw, arom_rings, hba)
    hepatic_clearance = _predict_clearance(mw, logp, rot, fsp3)
    half_life = _predict_half_life(hepatic_clearance, vd)
    ld50 = _predict_ld50(logp, mw, tpsa, hba, hbd)
    herg = _predict_herg(logp, mw, hba, arom_rings)
    ames = _predict_ames(arom_rings, mw, logp)
    dili = _predict_dili(mw, logp, tpsa, hba)

    lipinski_violations = sum([
        mw > 500, logp > 5, hba > 10, hbd > 5
    ])
    veber_pass = tpsa <= 140 and rot <= 10

    return {
        "smiles": smiles,
        "descriptors": desc,
        "absorption": {
            "caco2_permeability": round(caco2, 2),
            "caco2_class": "High" if caco2 > -5.15 else "Low",
            "human_intestinal_absorption": round(hia, 1),
            "hia_class": "High" if hia > 80 else "Moderate" if hia > 30 else "Low",
            "pgp_substrate": pgp_substrate,
            "oral_bioavailability_score": round(min(100, max(0, hia * (1 - 0.3 * int(pgp_substrate)))), 1),
        },
        "distribution": {
            "bbb_permeant": bbb > 0.5,
            "bbb_score": round(bbb, 3),
            "plasma_protein_binding_pct": round(ppb, 1),
            "volume_of_distribution_L_kg": round(vd, 2),
            "cns_penetration": "Yes" if bbb > 0.5 and tpsa < 90 else "No",
        },
        "metabolism": {
            "cyp2d6_inhibitor": cyp_inhibition["CYP2D6"],
            "cyp3a4_inhibitor": cyp_inhibition["CYP3A4"],
            "cyp2c9_inhibitor": cyp_inhibition["CYP2C9"],
            "cyp1a2_inhibitor": cyp_inhibition["CYP1A2"],
            "hepatic_clearance_mL_min_kg": round(hepatic_clearance, 2),
            "clearance_class": "High" if hepatic_clearance > 15 else "Moderate" if hepatic_clearance > 5 else "Low",
        },
        "excretion": {
            "half_life_hours": round(half_life, 1),
            "half_life_class": "Short" if half_life < 3 else "Moderate" if half_life < 8 else "Long",
        },
        "toxicity": {
            "ld50_mg_kg": round(ld50, 0),
            "toxicity_class": _tox_class(ld50),
            "herg_inhibitor": herg,
            "ames_mutagenicity": ames,
            "dili_risk": dili,
            "max_recommended_daily_dose_mg": round(_mrdd(mw, ld50), 0),
        },
        "druglikeness": {
            "lipinski_violations": lipinski_violations,
            "lipinski_pass": lipinski_violations <= 1,
            "veber_pass": veber_pass,
            "qed_estimate": round(qed(mol), 3),
        },
        "model_info": {
            "engine": "HakaseAI RDKit-QSPR v1.0",
            "method": "Descriptor-based QSPR with calibrated heuristics",
            "confidence": "Directional — suitable for early-stage screening",
        },
    }


def _predict_caco2(logp, tpsa, mw, hbd):
    base = -4.5 + 0.3 * logp - 0.01 * tpsa - 0.001 * mw - 0.15 * hbd
    return np.clip(base, -8, -3)


def _predict_hia(logp, tpsa, mw, hbd, rot):
    score = 95 - 0.5 * tpsa - 3 * hbd - 0.03 * mw + 5 * min(logp, 3) - rot
    return np.clip(score, 0, 100)


def _predict_pgp(mw, logp, hbd, hba):
    score = 0.005 * mw + 0.3 * hbd + 0.2 * hba - 0.4 * logp
    return bool(score > 2.5)


def _predict_bbb(logp, tpsa, mw, hbd):
    score = 0.4 * logp - 0.01 * tpsa - 0.001 * mw - 0.1 * hbd + 0.3
    return 1 / (1 + np.exp(-score))


def _predict_ppb(logp, mw, arom_rings):
    base = 50 + 10 * logp + 0.02 * mw + 5 * arom_rings
    return np.clip(base, 10, 99.5)


def _predict_vd(logp, mw, ppb):
    free_fraction = (100 - ppb) / 100
    vd = 0.5 + 0.8 * logp * free_fraction + 0.002 * mw
    return np.clip(vd, 0.04, 20)


def _predict_cyp_inhibition(logp, mw, arom_rings, hba):
    results = {}
    base = 0.3 * logp + 0.002 * mw + 0.2 * arom_rings - 0.1 * hba
    results["CYP2D6"] = bool(base + 0.3 * (logp > 3) > 2.0)
    results["CYP3A4"] = bool(base + 0.2 * (mw > 400) > 1.8)
    results["CYP2C9"] = bool(base + 0.15 * (arom_rings > 2) > 2.0)
    results["CYP1A2"] = bool(base + 0.4 * (arom_rings > 1) > 2.2)
    return results


def _predict_clearance(mw, logp, rot, fsp3):
    cl = 5 + 2 * logp + 0.01 * mw + 0.5 * rot - 3 * fsp3
    return np.clip(cl, 0.5, 60)


def _predict_half_life(clearance, vd):
    if clearance < 0.1:
        return 24.0
    t_half = 0.693 * vd * 70 / (clearance * 60)
    return np.clip(t_half, 0.5, 72)


def _predict_ld50(logp, mw, tpsa, hba, hbd):
    base = 2000 - 200 * max(0, logp - 3) + 5 * tpsa - 0.5 * mw + 50 * hba
    return np.clip(base, 5, 10000)


def _tox_class(ld50):
    if ld50 <= 5:
        return "Class I — Fatal"
    elif ld50 <= 50:
        return "Class II — Fatal"
    elif ld50 <= 300:
        return "Class III — Toxic"
    elif ld50 <= 2000:
        return "Class IV — Harmful"
    elif ld50 <= 5000:
        return "Class V — May Be Harmful"
    else:
        return "Class VI — Non-toxic"


def _predict_herg(logp, mw, hba, arom_rings):
    score = 0.4 * logp + 0.003 * mw + 0.3 * arom_rings - 0.1 * hba
    return bool(score > 2.5)


def _predict_ames(arom_rings, mw, logp):
    score = 0.3 * arom_rings + 0.001 * mw + 0.1 * logp
    return bool(score > 1.5)


def _predict_dili(mw, logp, tpsa, hba):
    score = 0.002 * mw + 0.3 * logp - 0.005 * tpsa - 0.1 * hba
    return "High" if score > 1.5 else "Moderate" if score > 0.8 else "Low"


def _mrdd(mw, ld50):
    return max(1, ld50 * 0.01 * (500 / max(mw, 100)))
