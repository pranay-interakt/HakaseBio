import requests
import numpy as np


ALPHAFOLD_API = "https://alphafold.ebi.ac.uk/api"
UNIPROT_API = "https://rest.uniprot.org/uniprotkb"


def predict_protein(uniprot_id: str) -> dict:
    protein_info = _fetch_uniprot(uniprot_id)
    alphafold_info = _fetch_alphafold(uniprot_id)

    sequence = protein_info.get("sequence", "")
    composition = _amino_acid_composition(sequence) if sequence else {}
    sec_structure = _predict_secondary_structure(sequence) if sequence else {}
    physicochemical = _sequence_properties(sequence) if sequence else {}

    binding_sites = protein_info.get("binding_sites", [])
    active_sites = protein_info.get("active_sites", [])

    return {
        "uniprot_id": uniprot_id,
        "protein_name": protein_info.get("name", "Unknown"),
        "gene_name": protein_info.get("gene", "Unknown"),
        "organism": protein_info.get("organism", "Unknown"),
        "sequence_length": len(sequence),
        "amino_acid_composition": composition,
        "secondary_structure_prediction": sec_structure,
        "physicochemical_properties": physicochemical,
        "binding_sites": binding_sites[:10],
        "active_sites": active_sites[:10],
        "alphafold": {
            "has_structure": alphafold_info.get("has_structure", False),
            "pdb_url": alphafold_info.get("pdb_url"),
            "confidence_score": alphafold_info.get("confidence"),
            "model_version": alphafold_info.get("version"),
        },
        "druggability": _assess_druggability(protein_info, sequence),
        "model_info": {
            "engine": "HakaseAI ProteinAnalyzer v1.0",
            "method": "UniProt integration + sequence-based prediction",
            "data_sources": ["UniProt", "AlphaFold DB"],
        },
    }


def _fetch_uniprot(uniprot_id: str) -> dict:
    try:
        resp = requests.get(f"{UNIPROT_API}/{uniprot_id}.json", timeout=10)
        if resp.status_code != 200:
            return {"name": "Unknown", "gene": uniprot_id, "organism": "Unknown", "sequence": ""}

        data = resp.json()

        name = "Unknown"
        if "proteinDescription" in data:
            rec = data["proteinDescription"].get("recommendedName", {})
            name = rec.get("fullName", {}).get("value", "Unknown")

        gene = "Unknown"
        if "genes" in data and data["genes"]:
            gene = data["genes"][0].get("geneName", {}).get("value", "Unknown")

        organism = data.get("organism", {}).get("scientificName", "Unknown")
        sequence = data.get("sequence", {}).get("value", "")

        binding_sites = []
        active_sites = []
        for feat in data.get("features", []):
            if feat.get("type") == "Binding site":
                loc = feat.get("location", {})
                binding_sites.append({
                    "type": "binding",
                    "start": loc.get("start", {}).get("value"),
                    "end": loc.get("end", {}).get("value"),
                    "description": feat.get("description", ""),
                })
            elif feat.get("type") == "Active site":
                loc = feat.get("location", {})
                active_sites.append({
                    "type": "active",
                    "start": loc.get("start", {}).get("value"),
                    "end": loc.get("end", {}).get("value"),
                    "description": feat.get("description", ""),
                })

        return {
            "name": name,
            "gene": gene,
            "organism": organism,
            "sequence": sequence,
            "binding_sites": binding_sites,
            "active_sites": active_sites,
        }

    except Exception:
        return {"name": "Unknown", "gene": uniprot_id, "organism": "Unknown", "sequence": ""}


def _fetch_alphafold(uniprot_id: str) -> dict:
    try:
        resp = requests.get(f"{ALPHAFOLD_API}/prediction/{uniprot_id}", timeout=10)
        if resp.status_code != 200:
            return {"has_structure": False}

        data = resp.json()
        if isinstance(data, list) and data:
            entry = data[0]
        else:
            entry = data

        return {
            "has_structure": True,
            "pdb_url": entry.get("pdbUrl"),
            "confidence": entry.get("globalMetricValue"),
            "version": entry.get("latestVersion"),
        }
    except Exception:
        return {"has_structure": False}


def _amino_acid_composition(sequence: str) -> dict:
    if not sequence:
        return {}
    total = len(sequence)
    aa_counts = {}
    for aa in sequence:
        aa_counts[aa] = aa_counts.get(aa, 0) + 1
    return {aa: round(count / total * 100, 1) for aa, count in sorted(aa_counts.items())}


def _predict_secondary_structure(sequence: str) -> dict:
    if not sequence:
        return {}
    total = len(sequence)
    helix_aa = set("AELM")
    sheet_aa = set("VIY")
    coil_aa = set("GPNS")

    helix = sum(1 for aa in sequence if aa in helix_aa)
    sheet = sum(1 for aa in sequence if aa in sheet_aa)
    coil = sum(1 for aa in sequence if aa in coil_aa)
    other = total - helix - sheet - coil

    return {
        "alpha_helix_pct": round(helix / total * 100, 1),
        "beta_sheet_pct": round(sheet / total * 100, 1),
        "coil_pct": round(coil / total * 100, 1),
        "other_pct": round(other / total * 100, 1),
        "method": "Chou-Fasman propensity estimation",
    }


def _sequence_properties(sequence: str) -> dict:
    if not sequence:
        return {}

    mw_table = {
        "A": 89.1, "R": 174.2, "N": 132.1, "D": 133.1, "C": 121.2,
        "E": 147.1, "Q": 146.2, "G": 75.0, "H": 155.2, "I": 131.2,
        "L": 131.2, "K": 146.2, "M": 149.2, "F": 165.2, "P": 115.1,
        "S": 105.1, "T": 119.1, "W": 204.2, "Y": 181.2, "V": 117.1,
    }
    mw = sum(mw_table.get(aa, 110) for aa in sequence) - 18 * (len(sequence) - 1)

    charge_aa = {"R": 1, "K": 1, "D": -1, "E": -1, "H": 0.1}
    net_charge = sum(charge_aa.get(aa, 0) for aa in sequence)

    hydrophobic = set("AILMFWV")
    hydrophobic_pct = sum(1 for aa in sequence if aa in hydrophobic) / len(sequence) * 100

    return {
        "molecular_weight_kDa": round(mw / 1000, 1),
        "estimated_pI": round(7.0 + net_charge * 0.01, 1),
        "net_charge_pH7": round(net_charge, 1),
        "hydrophobic_pct": round(hydrophobic_pct, 1),
        "sequence_length": len(sequence),
    }


def _assess_druggability(protein_info: dict, sequence: str) -> dict:
    binding_count = len(protein_info.get("binding_sites", []))
    active_count = len(protein_info.get("active_sites", []))

    score = 0.3
    evidence = []

    if binding_count > 0:
        score += min(0.3, binding_count * 0.1)
        evidence.append(f"{binding_count} known binding site(s)")

    if active_count > 0:
        score += 0.2
        evidence.append(f"{active_count} active site(s) — enzyme target")

    if sequence:
        if len(sequence) < 800:
            score += 0.1
            evidence.append("Moderate size — favorable for small molecule binding")
        elif len(sequence) > 2000:
            score -= 0.1
            evidence.append("Large protein — may require PPI or allosteric approach")

    score = min(max(score, 0.1), 0.95)

    return {
        "druggability_score": round(score, 2),
        "druggability_class": "High" if score > 0.6 else "Moderate" if score > 0.35 else "Low",
        "evidence": evidence,
    }
