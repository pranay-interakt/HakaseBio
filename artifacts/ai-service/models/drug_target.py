import os
import urllib.parse
import urllib.request
import json
import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs, Descriptors, Crippen
from utils.descriptors import smiles_to_mol, compute_descriptors

API_SERVER_URL = os.environ.get("API_SERVER_URL", "http://localhost:8080")


def _fetch_chembl_similar_targets(smiles: str, threshold: int = 70, limit: int = 10) -> dict:
    """Call the api-server's ChEMBL similarity-targets route. Returns {} on any failure."""
    try:
        qs = urllib.parse.urlencode({"smiles": smiles, "threshold": threshold, "limit": limit})
        url = f"{API_SERVER_URL}/api/chembl/similar-targets?{qs}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {}


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
    """
    Drug-target binding prediction.

    Strategy:
      • If target_id is one of our curated TARGET_PROFILES (e.g. "EGFR", "BRAF"),
        run the per-target pharmacophore + descriptor QSAR (legacy path, useful
        for known oncology targets with strong literature priors).
      • Otherwise (no target_id, or a UniProt accession not in our profiles):
        query real ChEMBL measured data via the api-server's
        /api/chembl/similar-targets route. Returns experimentally-anchored
        targets with measured pIC50, UniProt accession, gene name and PDB IDs.
    """
    mol = smiles_to_mol(smiles)
    desc = compute_descriptors(smiles)
    fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=2048)

    # Path 1: curated profile QSAR for one of our known reference targets.
    if target_id and target_id in TARGET_PROFILES:
        profile = TARGET_PROFILES[target_id]
        score_data = _score_target(mol, fp, desc, profile)
        result = {
            "target_id": target_id,
            "uniprot": profile["uniprot"],
            "target_name": profile["name"],
            "target_class": profile["target_class"],
            "binding_probability": round(score_data["probability"], 3),
            "estimated_pIC50": round(score_data["pic50"], 2),
            "estimated_IC50_nM": round(10 ** (9 - score_data["pic50"]), 1),
            "confidence": score_data["confidence"],
            "evidence": score_data["evidence"],
            "data_source": "Pharmacophore QSAR (curated profile)",
        }
        return {
            "smiles": smiles,
            "predictions": [result],
            "model_info": {
                "engine": "HakaseAI DrugTarget-Predictor v1.1",
                "method": "Pharmacophore matching + descriptor-based QSAR (curated profile)",
                "targets_screened": 1,
            },
        }

    # Path 2: real ChEMBL similarity-based target prediction.
    chembl = _fetch_chembl_similar_targets(smiles, threshold=70, limit=12)
    # Distinguish three transport states:
    #   • {} → service unreachable / network error      → Path 3 (error)
    #   • {targets: []} → ChEMBL responded, no hits     → empty result with "no_targets"
    #   • {targets: [...]} → real data                  → score below
    service_unreachable = not isinstance(chembl, dict) or chembl == {}
    chembl_targets = chembl.get("targets") if isinstance(chembl, dict) else None

    if not service_unreachable:
        # If user requested a specific UniProt, enforce STRICT filter — empty result
        # is preferred to silently returning unrelated targets.
        if target_id and isinstance(chembl_targets, list):
            chembl_targets = [
                t for t in chembl_targets
                if (t.get("uniprotId") or "").upper() == target_id.upper()
            ]
            if not chembl_targets:
                return {
                    "smiles": smiles,
                    "predictions": [],
                    "model_info": {
                        "engine": "HakaseAI DrugTarget-Predictor v1.1",
                        "method": "ChEMBL similarity (target-filtered)",
                        "targets_screened": 0,
                        "requested_target_id": target_id,
                        "status": "requested_target_not_found",
                        "note": f"No ChEMBL similar-molecule activity data linking this compound to UniProt {target_id}.",
                    },
                }

        results = []
        for t in chembl_targets:
            ic50_nm = float(t.get("bestValue_nM") or 0.0)
            if ic50_nm <= 0:
                continue
            pic50 = 9 - np.log10(ic50_nm)
            # Confidence from similarity + hit count
            sim = float(t.get("bestSimilarity") or 0.0)  # already 0-100
            hits = int(t.get("hits") or 1)
            prob = max(0.0, min(0.95, (sim / 100.0) * 0.7 + min(hits, 4) / 4.0 * 0.25))
            if pic50 >= 7:
                conf = "High"
            elif pic50 >= 5:
                conf = "Medium"
            else:
                conf = "Low"
            evidence = []
            evidence.append(f"ChEMBL measured {t.get('bestActivityType', 'IC50')} = {ic50_nm:.1f} nM")
            if t.get("bestSourceName"):
                evidence.append(f"Inferred from {sim:.0f}% similar molecule: {t.get('bestSourceName')} ({t.get('bestSourceChemblId')})")
            if t.get("hits"):
                evidence.append(f"{t.get('hits')} similar compound{'s' if t.get('hits') != 1 else ''} in ChEMBL active against this target")
            if t.get("pdbCount"):
                pdb_preview = ", ".join((t.get("pdbIds") or [])[:3])
                evidence.append(f"{t.get('pdbCount')} PDB structure(s) available" + (f" (e.g. {pdb_preview})" if pdb_preview else ""))
            results.append({
                "target_id": t.get("targetChemblId") or t.get("uniprotId") or "?",
                "uniprot": t.get("uniprotId"),
                "target_name": t.get("targetName"),
                "target_class": t.get("targetType") or "Protein",
                "gene_name": t.get("geneName"),
                "organism": t.get("organism"),
                "binding_probability": round(prob, 3),
                "estimated_pIC50": round(float(pic50), 2),
                "estimated_IC50_nM": round(ic50_nm, 1),
                "confidence": conf,
                "evidence": evidence,
                "pdb_ids": t.get("pdbIds") or [],
                "pdb_count": t.get("pdbCount") or 0,
                "similarity_pct": sim,
                "data_source": "ChEMBL similarity (measured activity)",
            })
        results.sort(key=lambda x: x["estimated_pIC50"], reverse=True)
        return {
            "smiles": smiles,
            "predictions": results,
            "model_info": {
                "engine": "HakaseAI DrugTarget-Predictor v1.1",
                "method": "ChEMBL similarity → activity aggregation → UniProt → PDB enrichment",
                "targets_screened": len(results),
                "similar_compounds_queried": chembl.get("similarCount", 0),
                "similarity_threshold_pct": chembl.get("threshold", 70),
                "status": "found" if results else "no_targets",
            },
        }

    # Path 2b: ChEMBL responded but found no protein targets (e.g. very novel scaffold,
    # or only non-protein assays returned). Return empty without claiming the service is down.
    if not service_unreachable:
        return {
            "smiles": smiles,
            "predictions": [],
            "model_info": {
                "engine": "HakaseAI DrugTarget-Predictor v1.1",
                "method": "ChEMBL similarity → activity aggregation",
                "targets_screened": 0,
                "similar_compounds_queried": chembl.get("similarCount", 0) if isinstance(chembl, dict) else 0,
                "similarity_threshold_pct": chembl.get("threshold", 70) if isinstance(chembl, dict) else 70,
                "status": "no_targets",
                "note": "ChEMBL similarity search returned no protein targets meeting the activity-data filters.",
            },
        }

    # Path 3: ChEMBL service unreachable (network error). Explicit failure metadata —
    # do NOT fall back to fabricated predictions.
    return {
        "smiles": smiles,
        "predictions": [],
        "model_info": {
            "engine": "HakaseAI DrugTarget-Predictor v1.1",
            "method": "ChEMBL similarity (unavailable)",
            "targets_screened": 0,
            "status": "service_unreachable",
            "error": "ChEMBL similarity service is unreachable. No predictions returned.",
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
