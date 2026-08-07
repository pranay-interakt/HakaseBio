"""Physiologically-Based Pharmacokinetics (PBPK) animal cohort popPK simulator.
Uses scipy.integrate.solve_ivp to solve mass-balance ordinary differential equations (ODEs).
Integrates live biological data sources: ChEMBL, PubChem, and EPA CCTE.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any

import httpx
import numpy as np
from scipy.integrate import solve_ivp

try:
    from hakase_smallmol.admet.admet_ml import predict_admet_ml
except ImportError:
    try:
        from admet_ml import predict_admet_ml
    except ImportError:
        predict_admet_ml = None

logger = logging.getLogger(__name__)

# ── Animal Physiology Templates (Davies & Morris 1993, Brown et al. 1997) ──
SPECIES_LIBRARY: dict[str, dict[str, Any]] = {
    "mouse_cd1": {
        "id": "mouse_cd1",
        "displayName": "Mouse (CD-1)",
        "species": "Mouse",
        "strain": "CD-1",
        "bodyWeight": 0.025,
        "kmFactor": 3,
        "gfr": 5.2,
        "hepaticBloodFlow": 90,
        "cardiacOutput": 500,
        "clScaleFactor": 0.28,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 0.82,
        "cyp2d6Activity": 0.10,
        "cyp2c9Activity": 0.65,
        "plasmaProteinBinding": 0.05,
        "rodent": True,
        "regulatory": "Efficacy, oncology, PK screen",
        "V_liver": 0.055,
        "V_kidney": 0.0167,
        "V_heart": 0.005,
        "V_blood": 0.04,
        "Q_liver": 0.116,
        "Q_kidney": 0.091,
        "Q_heart": 0.066,
    },
    "mouse_c57bl6": {
        "id": "mouse_c57bl6",
        "displayName": "Mouse (C57BL/6)",
        "species": "Mouse",
        "strain": "C57BL/6",
        "bodyWeight": 0.022,
        "kmFactor": 3,
        "gfr": 5.0,
        "hepaticBloodFlow": 85,
        "cardiacOutput": 480,
        "clScaleFactor": 0.27,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 0.79,
        "cyp2d6Activity": 0.08,
        "cyp2c9Activity": 0.62,
        "plasmaProteinBinding": 0.04,
        "rodent": True,
        "regulatory": "Immunology, oncology, transgenic models",
        "V_liver": 0.055,
        "V_kidney": 0.0167,
        "V_heart": 0.005,
        "V_blood": 0.04,
        "Q_liver": 0.116,
        "Q_kidney": 0.091,
        "Q_heart": 0.066,
    },
    "rat_sd": {
        "id": "rat_sd",
        "displayName": "Rat (Sprague Dawley)",
        "species": "Rat",
        "strain": "Sprague Dawley",
        "bodyWeight": 0.300,
        "kmFactor": 6,
        "gfr": 5.5,
        "hepaticBloodFlow": 70,
        "cardiacOutput": 360,
        "clScaleFactor": 0.40,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 1.20,
        "cyp2d6Activity": 1.45,
        "cyp2c9Activity": 0.88,
        "plasmaProteinBinding": 0.02,
        "rodent": True,
        "regulatory": "Primary GLP toxicology (ICH M3, OECD 407/408)",
        "V_liver": 0.0366,
        "V_kidney": 0.0073,
        "V_heart": 0.0033,
        "V_blood": 0.04,
        "Q_liver": 0.174,
        "Q_kidney": 0.141,
        "Q_heart": 0.060,
    },
    "rat_wistar": {
        "id": "rat_wistar",
        "displayName": "Rat (Wistar)",
        "species": "Rat",
        "strain": "Wistar",
        "bodyWeight": 0.280,
        "kmFactor": 6,
        "gfr": 5.3,
        "hepaticBloodFlow": 68,
        "cardiacOutput": 350,
        "clScaleFactor": 0.39,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 1.18,
        "cyp2d6Activity": 1.40,
        "cyp2c9Activity": 0.85,
        "plasmaProteinBinding": 0.02,
        "rodent": True,
        "regulatory": "European regulatory preference; carcinogenicity studies",
        "V_liver": 0.0366,
        "V_kidney": 0.0073,
        "V_heart": 0.0033,
        "V_blood": 0.04,
        "Q_liver": 0.174,
        "Q_kidney": 0.141,
        "Q_heart": 0.060,
    },
    "dog_beagle": {
        "id": "dog_beagle",
        "displayName": "Dog (Beagle)",
        "species": "Dog",
        "strain": "Beagle",
        "bodyWeight": 10.0,
        "kmFactor": 20,
        "gfr": 3.2,
        "hepaticBloodFlow": 31,
        "cardiacOutput": 118,
        "clScaleFactor": 0.62,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 0.95,
        "cyp2d6Activity": 0.00,
        "cyp2c9Activity": 0.72,
        "plasmaProteinBinding": -0.03,
        "rodent": False,
        "regulatory": "Non-rodent GLP tox; CV safety pharmacology (ICH S7A)",
        "V_liver": 0.0328,
        "V_kidney": 0.0041,
        "V_heart": 0.008,
        "V_blood": 0.04,
        "Q_liver": 0.308,
        "Q_kidney": 0.173,
        "Q_heart": 0.050,
    },
    "monkey_cyno": {
        "id": "monkey_cyno",
        "displayName": "Cynomolgus Monkey",
        "species": "Monkey",
        "strain": "Cynomolgus (Mauritian)",
        "bodyWeight": 4.0,
        "kmFactor": 12,
        "gfr": 2.8,
        "hepaticBloodFlow": 44,
        "cardiacOutput": 145,
        "clScaleFactor": 0.75,
        "halfLifeExponent": 0.25,
        "cyp3a4Activity": 1.05,
        "cyp2d6Activity": 0.90,
        "cyp2c9Activity": 0.95,
        "plasmaProteinBinding": -0.01,
        "rodent": False,
        "regulatory": "Biologics, CNS penetration, immunogenicity (NHP standard)",
        "V_liver": 0.0300,
        "V_kidney": 0.0040,
        "V_heart": 0.0050,
        "V_blood": 0.04,
        "Q_liver": 0.184,
        "Q_kidney": 0.097,
        "Q_heart": 0.050,
    },
}

# ── Live API Integration ──


def get_epa_ccte_headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "HakaseAI-BioTwin/2.0"}
    key = os.environ.get("EPA_CCTE_API_KEY")
    if key:
        headers["x-api-key"] = key
    return headers


async def query_ccte_hazard(name: str) -> dict[str, Any]:
    """Query EPA CCTE Hazard API for Measured NOAEL/LOAEL."""
    result = {
        "dtxsid": None,
        "preferred_name": None,
        "noael_min": None,
        "loael_min": None,
        "status": "unresolved",
        "species_covered": [],
    }
    if not name:
        return result

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # 1. Resolve Name to DTXSID
            url_res = f"https://api-ccte.epa.gov/chemical/search/start-with/{name}"
            r_res = await client.get(url_res, headers=get_epa_ccte_headers())
            if r_res.status_code != 200:
                return result
            res_data = r_res.json()
            first = res_data[0] if isinstance(res_data, list) and res_data else res_data
            dtxsid = first.get("dtxsid")
            pref_name = first.get("preferredName")
            if not dtxsid:
                return result

            result["dtxsid"] = dtxsid
            result["preferred_name"] = pref_name

            # 2. Get Hazard Records
            url_haz = f"https://api-ccte.epa.gov/hazard/search/by-dtxsid/{dtxsid}"
            r_haz = await client.get(url_haz, headers=get_epa_ccte_headers())
            if r_haz.status_code != 200:
                result["status"] = "error"
                return result

            haz_data = r_haz.json()
            if not isinstance(haz_data, list) or not haz_data:
                result["status"] = "no-data"
                return result

            noaels = []
            loaels = []
            species_covered = []

            for rec in haz_data:
                sp = str(rec.get("species") or "").lower()
                val = rec.get("toxvalNumeric") or rec.get("toxval_numeric") or rec.get("value")
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    continue
                if val <= 0:
                    continue

                v_type = str(rec.get("toxvalType") or rec.get("toxval_type") or "").upper()
                if "NOAEL" in v_type or "NOEL" in v_type:
                    noaels.append(val)
                elif "LOAEL" in v_type or "LOEL" in v_type:
                    loaels.append(val)

                for common in ["rat", "mouse", "rabbit", "dog"]:
                    if common in sp and common not in species_covered:
                        species_covered.append(common)

            result["noael_min"] = min(noaels) if noaels else None
            result["loael_min"] = min(loaels) if loaels else None
            result["species_covered"] = species_covered
            result["status"] = "live" if noaels else "no-data"

        except Exception as e:
            logger.warning("CCTE API error: %s", e)
            result["status"] = "error"

    return result


async def query_pubchem_toxicology(smiles: str) -> dict[str, Any]:
    """Query PubChem PUG REST + View API to find rodent toxicity data."""
    result = {"cid": None, "ld50_mg_kg": None, "source": "PubChem"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # 1. Resolve SMILES to CID
            url_cid = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/{smiles}/property/CID/JSON"
            r_cid = await client.get(url_cid)
            if r_cid.status_code != 200:
                return result
            cid = r_cid.json().get("PropertyTable", {}).get("Properties", [{}])[0].get("CID")
            if not cid:
                return result
            result["cid"] = cid

            # 2. Query View API for Toxicology/LD50
            url_view = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON?heading=Toxicology"
            r_view = await client.get(url_view)
            if r_view.status_code != 200:
                return result

            # DFS search for LD50/Toxicity values in JSON view
            ld50_vals = []

            def search_json(node: Any):
                if isinstance(node, dict):
                    if str(node.get("TOCHeading") or "").upper() == "ACUTE EFFECTS":
                        for inf in node.get("Information", []):
                            val_str = str(
                                inf.get("Value", {}).get("StringWithMarkup", [{}])[0].get("String")
                                or ""
                            )
                            if "LD50" in val_str:
                                # Simple regex extract for mg/kg
                                import re

                                match = re.search(r"(\d+(\.\d+)?)\s*mg/kg", val_str)
                                if match:
                                    ld50_vals.append(float(match.group(1)))
                    for k, v in node.items():
                        search_json(v)
                elif isinstance(node, list):
                    for item in node:
                        search_json(item)

            search_json(r_view.json())
            if ld50_vals:
                result["ld50_mg_kg"] = min(ld50_vals)

        except Exception as e:
            logger.warning("PubChem API error: %s", e)

    return result


async def query_chembl_pk(smiles: str) -> dict[str, Any]:
    """Query ChEMBL API for similar compound animal PK measurements."""
    result = {"chembl_id": None, "assays": []}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # 1. Similarity lookup at 70% threshold
            url_sim = f"https://www.ebi.ac.uk/chembl/api/data/similarity/{smiles}/70.json?limit=5"
            r_sim = await client.get(url_sim)
            if r_sim.status_code != 200:
                return result
            molecules = r_sim.json().get("molecules", [])
            chembl_ids = [
                m.get("molecule_chembl_id") for m in molecules if m.get("molecule_chembl_id")
            ]
            if not chembl_ids:
                return result

            result["chembl_id"] = chembl_ids[0]

            # 2. Fetch PK activities
            ids_str = ",".join(chembl_ids[:3])
            url_act = f"https://www.ebi.ac.uk/chembl/api/data/activity.json?molecule_chembl_id__in={ids_str}&standard_type__in=Clearance,Vd,T1/2,F&limit=30"
            r_act = await client.get(url_act)
            if r_act.status_code == 200:
                acts = r_act.json().get("activities", [])
                for act in acts:
                    val = act.get("standard_value")
                    try:
                        val = float(val)
                    except (ValueError, TypeError):
                        continue
                    result["assays"].append(
                        {
                            "molecule_chembl_id": act.get("molecule_chembl_id"),
                            "species": act.get("assay_organism"),
                            "type": act.get("standard_type"),
                            "value": val,
                            "units": act.get("standard_units"),
                        }
                    )
        except Exception as e:
            logger.warning("ChEMBL API error: %s", e)

    return result


async def query_pkdb_data(substance_name: str) -> dict[str, Any]:
    """Query the open-source PK-DB REST API for real experimental preclinical/clinical PK values."""
    result = {"matched": False, "substance_name": substance_name, "parameters": []}
    if not substance_name:
        return result

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            url = f"https://pk-db.com/api/v1/substances/?name={substance_name}"
            res = await client.get(url)
            if res.status_code == 200:
                data = res.json()
                if data and isinstance(data, list):
                    matched_sub = data[0]
                    result["matched"] = True
                    result["substance_name"] = matched_sub.get("name", substance_name)
                    sid = matched_sub.get("sid")

                    if sid:
                        outputs_url = f"https://pk-db.com/api/v1/outputs/?substance={sid}&limit=50"
                        out_res = await client.get(outputs_url)
                        if out_res.status_code == 200:
                            outputs_data = out_res.json()
                            for item in outputs_data:
                                pk_param = item.get("pk_parameter") or item.get("parameter")
                                val = item.get("value")
                                unit = item.get("unit")
                                study = item.get("study")
                                if pk_param and val is not None:
                                    result["parameters"].append(
                                        {
                                            "parameter": str(pk_param),
                                            "value": (
                                                float(val)
                                                if isinstance(val, (int, float))
                                                else str(val)
                                            ),
                                            "unit": str(unit) if unit else "",
                                            "source": (
                                                f"PK-DB Study ID: {study}" if study else "PK-DB"
                                            ),
                                        }
                                    )
        except Exception as e:
            logger.warning("PK-DB API lookup failed: %s", e)

    return result


# ── PBPK ODE Solver ──


def pbpk_odes(t, y, params):
    # y = [A_depot, C_v, C_a, C_liver, C_kidney, C_heart, C_rest]
    A_depot, C_v, C_a, C_liver, C_kidney, C_heart, C_rest = y

    Q_CO = params["Q_CO"]
    Q_liver = params["Q_liver"]
    Q_kidney = params["Q_kidney"]
    Q_heart = params["Q_heart"]
    Q_rest = params["Q_rest"]

    V_v = params["V_v"]
    V_a = params["V_a"]
    V_liver = params["V_liver"]
    V_kidney = params["V_kidney"]
    V_heart = params["V_heart"]
    V_rest = params["V_rest"]

    K_p_liver = params["K_p_liver"]
    K_p_kidney = params["K_p_kidney"]
    K_p_heart = params["K_p_heart"]
    K_p_rest = params["K_p_rest"]

    CL_hep = params["CL_hep"]
    CL_ren = params["CL_ren"]
    ka = params["ka"]
    route = params["route"]

    # exiting concentrations (equilibrium with tissue partitioning)
    C_out_liver = C_liver / K_p_liver
    C_out_kidney = C_kidney / K_p_kidney
    C_out_heart = C_heart / K_p_heart
    C_out_rest = C_rest / K_p_rest

    d_A_depot = -ka * A_depot

    # Check absorption route injection target
    gi_input = ka * A_depot if route == "Oral" else 0.0
    sc_input = ka * A_depot if route == "SC" else 0.0

    # Venous compartment rate of change
    d_C_v = (
        Q_liver * C_out_liver
        + Q_kidney * C_out_kidney
        + Q_heart * C_out_heart
        + Q_rest * C_out_rest
        + sc_input
        - Q_CO * C_v
    ) / V_v

    # Arterial compartment rate of change
    d_C_a = (Q_CO * C_v - Q_CO * C_a) / V_a

    # Liver tissue compartment (hepatic first pass for Oral route)
    d_C_liver = (Q_liver * (C_a - C_out_liver) + gi_input - CL_hep * C_out_liver) / V_liver

    # Kidney tissue compartment (renal clearance)
    d_C_kidney = (Q_kidney * (C_a - C_out_kidney) - CL_ren * C_out_kidney) / V_kidney

    # Heart tissue compartment
    d_C_heart = (Q_heart * (C_a - C_out_heart)) / V_heart

    # Rest of Body compartment
    d_C_rest = (Q_rest * (C_a - C_out_rest)) / V_rest

    return [d_A_depot, d_C_v, d_C_a, d_C_liver, d_C_kidney, d_C_heart, d_C_rest]


# ── Formulation and BCS Module (Translated from formulationDB.ts) ──


def Delaney_esol(logP: float, mw: float, num_ar_rings: int, rot_bonds: int) -> float:
    return 0.16 - 0.638 * logP - 0.0062 * mw + 0.066 * num_ar_rings - 0.74 * (rot_bonds / 10.0)


def is_high_permeability(logP: float, tpsa: float, mw: float, hbd: int) -> bool:
    return logP > 1.0 and tpsa < 120.0 and mw < 500.0 and hbd <= 5


def classify_bcs(
    logP: float, tpsa: float, mw: float, hbd: int, num_ar_rings: int, rot_bonds: int
) -> dict[str, Any]:
    logS = Delaney_esol(logP, mw, num_ar_rings, rot_bonds)
    sol_threshold = -4.0 + math.log10(250.0 / max(mw, 100.0))
    high_sol = logS > sol_threshold
    high_perm = is_high_permeability(logP, tpsa, mw, hbd)

    if high_sol and high_perm:
        cls = "I"
        label = "Class I — High Solubility / High Permeability"
        challenge = "Formulation-independent absorption; plain tablet appropriate"
        strategy = "Immediate-release tablet or hard gelatin capsule"
    elif not high_sol and high_perm:
        cls = "II"
        label = "Class II — Low Solubility / High Permeability"
        challenge = "Dissolution-rate limited; formulation is the key driver of bioavailability"
        strategy = (
            "Lipid-based LBDDS/SMEDDS, amorphous solid dispersion, or nanosuspension recommended"
        )
    elif high_sol and not high_perm:
        cls = "III"
        label = "Class III — High Solubility / Low Permeability"
        challenge = "Permeability-limited; rapid dissolution but poor membrane crossing"
        strategy = "Permeation enhancers, prodrug strategy, or modified release"
    else:
        cls = "IV"
        label = "Class IV — Low Solubility / Low Permeability"
        challenge = "Both solubility and permeability limited — challenging candidate"
        strategy = "SMEDDS, lipid nanoparticles, or formulation combination strategy"

    return {
        "class": cls,
        "label": label,
        "solubility": "High" if high_sol else "Low",
        "permeability": "High" if high_perm else "Low",
        "logS": round(logS, 4),
        "challenge": challenge,
        "strategy": strategy,
    }


FORMULATION_MULTIPLIERS = {
    "plain": {
        "I": 1.0,
        "II": 1.0,
        "III": 1.0,
        "IV": 1.0,
        "fAbsMax": 0.95,
        "label": "Plain Tablet / Capsule",
        "excipients": [
            "MCC PH102 (microcrystalline cellulose)",
            "Lactose monohydrate",
            "Croscarmellose sodium",
            "Magnesium stearate",
        ],
    },
    "lipid": {
        "I": 1.1,
        "II": 3.2,
        "III": 1.4,
        "IV": 2.4,
        "fAbsMax": 0.90,
        "label": "Lipid-Based LBDDS / SMEDDS",
        "excipients": [
            "Labrasol (PEG-8 caprylic/capric glycerides)",
            "Labrafac Lipophile WL 1349 (caprylic/capric triglycerides)",
            "Cremophor EL (PEG-35 castor oil)",
            "Capmul MCM (glyceryl caprylate)",
        ],
    },
    "amorphous": {
        "I": 1.05,
        "II": 2.8,
        "III": 1.2,
        "IV": 2.0,
        "fAbsMax": 0.85,
        "label": "Amorphous Solid Dispersion (ASD)",
        "excipients": [
            "HPMC-AS (Hypromellose acetate succinate)",
            "PVP-VA (Povidone-vinyl acetate 64)",
            "Soluplus (PEG-PCL-PVAc graft polymer)",
            "Aerosil 200 (colloidal silica)",
        ],
    },
    "nanoparticle": {
        "I": 1.05,
        "II": 2.2,
        "III": 1.1,
        "IV": 1.7,
        "fAbsMax": 0.85,
        "label": "Nanosuspension / Nanoparticle",
        "excipients": [
            "Polysorbate 80 (Tween 80)",
            "HPMC E5 (Hypromellose 5cP)",
            "Lutrol F68 (Poloxamer 188)",
            "D-α-Tocopherol PEG 1000 succinate (TPGS)",
        ],
    },
    "cyclodextrin": {
        "I": 1.1,
        "II": 1.9,
        "III": 1.3,
        "IV": 1.5,
        "fAbsMax": 0.80,
        "label": "Cyclodextrin Inclusion Complex",
        "excipients": [
            "HP-β-CD (Hydroxypropyl-beta-cyclodextrin)",
            "SBE-β-CD (Sulfobutylether-beta-cyclodextrin, Captisol)",
        ],
    },
    "enteric": {
        "I": 1.0,
        "II": 1.3,
        "III": 1.1,
        "IV": 1.2,
        "fAbsMax": 0.90,
        "label": "Enteric-Coated / pH-Modified",
        "excipients": [
            "Eudragit L100-55 (methacrylic acid copolymer)",
            "HPMCP (Hydroxypropyl methylcellulose phthalate)",
            "MCC PH102 (microcrystalline cellulose)",
            "Lactose monohydrate",
        ],
    },
}


def compute_formulation_impact(
    logP: float,
    tpsa: float,
    mw: float,
    hbd: int,
    num_ar_rings: int,
    rot_bonds: int,
    baseF: float,
    formulation_type: str,
) -> dict[str, Any]:
    bcs = classify_bcs(logP, tpsa, mw, hbd, num_ar_rings, rot_bonds)
    f_def = FORMULATION_MULTIPLIERS.get(formulation_type, FORMULATION_MULTIPLIERS["plain"])
    mult = f_def.get(bcs["class"], 1.0)
    raw_F = min(baseF * mult, f_def["fAbsMax"])
    formulated_F = min(raw_F, 0.99)
    enhancement = formulated_F / max(baseF, 0.01)

    if enhancement >= 3.0:
        impact = f"Very High ({enhancement:.1f}x improvement)"
    elif enhancement >= 2.0:
        impact = f"High ({enhancement:.1f}x improvement)"
    elif enhancement >= 1.3:
        impact = f"Moderate ({enhancement:.1f}x improvement)"
    elif enhancement >= 1.05:
        impact = f"Low ({enhancement:.1f}x improvement)"
    else:
        impact = "None (plain appropriate)"

    return {
        "bcs": bcs,
        "formulation": {
            "id": formulation_type,
            "label": f_def["label"],
            "description": f"Formulation using {f_def['label']} technology.",
            "keyExcipients": f_def["excipients"],
            "multiplier": {k: f_def[k] for k in ["I", "II", "III", "IV"]},
            "fAbsMax": f_def["fAbsMax"],
            "bestFor": (
                ["II", "IV"]
                if formulation_type in ["lipid", "amorphous", "cyclodextrin"]
                else ["I", "III"]
            ),
        },
        "base_f": round(baseF, 3),
        "formulated_f": round(formulated_F, 3),
        "enhancement": round(enhancement, 2),
        "impact_label": impact,
    }


# ── Main Run Simulation Logic ──


async def run_animal_cohort_simulation(
    smiles: str,
    species_id: str,
    study_type_id: str,
    route_of_admin: str,
    cohort_size: int,
    formulation: str,
    starting_dose_mg_kg: float,
    ml_admet: dict[str, Any],
    measured_noael_override: float | None = None,
) -> dict[str, Any]:
    """Execute PBPK cohort simulation using scipy ODE solver and live database queries."""

    # 0. Resolve properties using in-house GNN model and RDKit descriptors
    rdkit_props = {}
    admet_endpoints = {}

    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, Lipinski

        mol = Chem.MolFromSmiles(smiles)
        if mol:
            rdkit_props["mw"] = float(Descriptors.MolWt(mol))
            rdkit_props["logP"] = float(Descriptors.MolLogP(mol))
            rdkit_props["tpsa"] = float(Descriptors.TPSA(mol))
            rdkit_props["hbd"] = float(Lipinski.NumHDonors(mol))
            rdkit_props["rotBonds"] = float(Lipinski.NumRotatableBonds(mol))
            rdkit_props["numArRings"] = int(Lipinski.NumAromaticRings(mol))
    except Exception as e:
        logger.warning("RDKit descriptor calculation failed: %s", e)

    if predict_admet_ml is not None:
        try:
            admet_res = predict_admet_ml(smiles)
            if admet_res.get("ml_available"):
                admet_endpoints = admet_res.get("endpoints") or {}
        except Exception as e:
            logger.warning("GNN model prediction failed: %s", e)

    # 1. Fetch live API records concurrently
    ccte_task = query_ccte_hazard(ml_admet.get("molName", ""))
    pubchem_task = query_pubchem_toxicology(smiles)
    chembl_task = query_chembl_pk(smiles)
    pkdb_task = query_pkdb_data(ml_admet.get("molName", ""))

    # Let's run concurrently via asyncio
    import asyncio

    try:
        ccte_res, pubchem_res, chembl_res, pkdb_res = await asyncio.gather(
            ccte_task, pubchem_task, chembl_task, pkdb_task
        )
    except Exception as e:
        logger.error("Error gathering API endpoints: %s", e)
        ccte_res = {
            "dtxsid": None,
            "preferred_name": None,
            "noael_min": None,
            "loael_min": None,
            "status": "no-data",
            "species_covered": [],
        }
        pubchem_res = {"cid": None, "ld50_mg_kg": None, "source": "PubChem"}
        chembl_res = {"chembl_id": None, "assays": []}
        pkdb_res = {
            "matched": False,
            "substance_name": ml_admet.get("molName", ""),
            "parameters": [],
        }

    # 2. Determine measured NOAEL / LOAEL
    measured_noael = None
    noael_source = "None"
    loael_val = None
    dtxsid = None
    species_covered = []

    if measured_noael_override is not None:
        measured_noael = measured_noael_override
        noael_source = "User Override"
    elif ccte_res.get("noael_min") is not None:
        measured_noael = ccte_res["noael_min"]
        loael_val = ccte_res.get("loael_min")
        noael_source = "EPA ToxRefDB/ToxValDB (CCTE)"
        dtxsid = ccte_res.get("dtxsid")
        species_covered = ccte_res.get("species_covered", [])
    elif pubchem_res.get("ld50_mg_kg") is not None:
        measured_noael = pubchem_res["ld50_mg_kg"] / 100.0
        noael_source = "PubChem Acute Toxicity LD50 Translation"
        species_covered = ["rat"]
    else:
        endpoints = admet_endpoints if admet_endpoints else (ml_admet.get("endpoints") or {})
        ld50_zhu = endpoints.get("LD50_Zhu")
        if ld50_zhu is not None:
            mw_val = rdkit_props.get("mw") or ml_admet.get("lipinski", {}).get("mw", 300.0)
            ld50_mol_kg = 10 ** (-float(ld50_zhu))
            ld50_mg_kg = ld50_mol_kg * mw_val * 1000.0
            measured_noael = ld50_mg_kg / 100.0
            noael_source = "GNN predicted LD50_Zhu translation"
            species_covered = ["rat"]

    if measured_noael is None or measured_noael <= 0:
        measured_noael = 10.0
        noael_source = "Physiological default"
        species_covered = ["rat"]

    # 3. Setup physiological properties and virtual cohort
    sp = SPECIES_LIBRARY.get(species_id, SPECIES_LIBRARY["rat_sd"])

    np.random.seed(42)
    weights = np.random.lognormal(mean=np.log(sp["bodyWeight"]), sigma=0.15, size=cohort_size)

    # 4. Retrieve compound properties
    lipinski = ml_admet.get("lipinski", {})
    mw = rdkit_props.get("mw") or lipinski.get("mw", 300.0)
    logP = rdkit_props.get("logP") or lipinski.get("logP", 2.0)
    tpsa = rdkit_props.get("tpsa") or lipinski.get("tpsa", 80.0)
    hbd = rdkit_props.get("hbd") or lipinski.get("hbd", 2)
    rot_bonds = rdkit_props.get("rotBonds") or lipinski.get("rotBonds", 5)
    num_ar_rings = rdkit_props.get("numArRings") if "numArRings" in rdkit_props else int(logP * 0.5)

    admet = ml_admet.get("admet", {})
    absorption = admet_endpoints.get("Bioavailability_Ma") or admet.get("absorption", 0.8)
    metabolism = admet.get("metabolism", 0.5)
    excretion = admet.get("excretion", 0.5)
    toxicity = admet.get("toxicity", 0.2)

    # 5. Formulation-adjusted bioavailability
    f_res = compute_formulation_impact(
        logP, tpsa, mw, hbd, num_ar_rings, rot_bonds, absorption, formulation
    )
    bioavail = 1.0 if route_of_admin == "IV" else f_res["formulated_f"]

    # 6. Partition coefficients (Poulin & Theil lipid-water partitioning)
    K_p_liver = 0.70 + 0.05 * (10**logP)
    K_p_kidney = 0.75 + 0.03 * (10**logP)
    K_p_heart = 0.80 + 0.02 * (10**logP)

    # Bound Kp to physiological bounds
    K_p_liver = max(0.1, min(100.0, K_p_liver))
    K_p_kidney = max(0.1, min(100.0, K_p_kidney))
    K_p_heart = max(0.1, min(100.0, K_p_heart))

    # Human volume of distribution matches ADMET GNN VDss
    vd_human = ml_admet.get("endpoints", {}).get("VDss_Lombardo", 1.0)
    # Volume matches human for rest-of-body compartment
    K_p_rest = max(0.1, min(100.0, vd_human))

    # Intrinsic clearance (Clearance_Hepatocyte_AZ in µL/min/10⁶ cells)
    clint_hep = ml_admet.get("endpoints", {}).get("Clearance_Hepatocyte_AZ", 10.0)
    if clint_hep is None or clint_hep <= 0:
        clint_hep = 10.0

    fu = 1.0 - float(ml_admet.get("endpoints", {}).get("PPBR_AZ", 80.0)) / 100.0
    fu = max(0.01, min(1.0, fu))

    # 7. Run cohort simulations
    t_span = (0.0, 24.0)
    t_eval = np.linspace(0.0, 24.0, 60)

    curves = []
    cmaxs = []
    aucs = []
    half_lifes = []
    clearances = []

    for i, bw_i in enumerate(weights):
        # Scale cardiac output and GFR allometrically (per-kg CL ∝ BW^-0.25)
        scale_factor = (bw_i / sp["bodyWeight"]) ** (-0.25)
        Q_CO_i = (sp["cardiacOutput"] * 60 / 1000) * bw_i * scale_factor  # L/h

        Q_liver_i = sp["Q_liver"] * Q_CO_i
        Q_kidney_i = sp["Q_kidney"] * Q_CO_i
        Q_heart_i = sp["Q_heart"] * Q_CO_i
        Q_rest_i = Q_CO_i - Q_liver_i - Q_kidney_i - Q_heart_i

        # Volumes
        V_liver_i = sp["V_liver"] * bw_i
        V_kidney_i = sp["V_kidney"] * bw_i
        V_heart_i = sp["V_heart"] * bw_i
        V_blood_i = sp["V_blood"] * bw_i
        V_v_i = 0.7 * V_blood_i
        V_a_i = 0.3 * V_blood_i

        V_rest_i = bw_i - V_liver_i - V_kidney_i - V_heart_i - V_blood_i
        if V_rest_i <= 0:
            V_rest_i = 0.5 * bw_i

        # Clearance scaling
        # Clint (L/h) = Clint_hep (µL/min/10⁶ cells) * 99 (10⁶ cells/g) * (V_liver * 1000) (g) * 60 / 10^6
        CL_hep_i = clint_hep * 99.0 * (V_liver_i * 1000.0) * 60.0 / 1e6  # L/h
        # Renal GFR clearance
        CL_ren_i = (sp["gfr"] * 60 / 1000) * bw_i * scale_factor * fu  # L/h

        # Absorption rate (estimated from Caco2 Wang)
        caco2 = ml_admet.get("endpoints", {}).get("Caco2_Wang", -5.0)
        ka_i = 10 ** (float(caco2) + 5.0)  # scale to typical absorption constant /h
        ka_i = max(0.2, min(5.0, ka_i))

        ode_params = {
            "Q_CO": Q_CO_i,
            "Q_liver": Q_liver_i,
            "Q_kidney": Q_kidney_i,
            "Q_heart": Q_heart_i,
            "Q_rest": Q_rest_i,
            "V_v": V_v_i,
            "V_a": V_a_i,
            "V_liver": V_liver_i,
            "V_kidney": V_kidney_i,
            "V_heart": V_heart_i,
            "V_rest": V_rest_i,
            "K_p_liver": K_p_liver,
            "K_p_kidney": K_p_kidney,
            "K_p_heart": K_p_heart,
            "K_p_rest": K_p_rest,
            "CL_hep": CL_hep_i,
            "CL_ren": CL_ren_i,
            "ka": ka_i,
            "route": route_of_admin,
        }

        # Initial state
        dose_mg = starting_dose_mg_kg * bw_i
        if route_of_admin == "IV":
            y0 = [0.0, dose_mg / V_v_i, 0.0, 0.0, 0.0, 0.0, 0.0]
        else:
            y0 = [dose_mg * bioavail, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

        sol = solve_ivp(pbpk_odes, t_span, y0, args=(ode_params,), t_eval=t_eval)

        # Venous plasma concentration profile (convert to ng/mL)
        conc_profile = sol.y[1] * 1000.0  # mg/L -> ng/mL
        curves.append(conc_profile)

        cmax_i = float(np.max(conc_profile))
        cmaxs.append(cmax_i)

        # Trapezoidal AUC
        auc_i = float(np.trapz(conc_profile, sol.t))
        aucs.append(auc_i)

        # Mechanistic half-life
        cl_tot_i = CL_hep_i + CL_ren_i
        vd_ss_i = (
            V_v_i
            + V_a_i
            + V_liver_i * K_p_liver
            + V_kidney_i * K_p_kidney
            + V_heart_i * K_p_heart
            + V_rest_i * K_p_rest
        )
        t12_i = math.log(2) * vd_ss_i / cl_tot_i
        half_lifes.append(t12_i)
        clearances.append(cl_tot_i / bw_i)

    # Aggregate cohort results
    curves = np.array(curves)
    mean_curve = np.mean(curves, axis=0)
    std_curve = np.std(curves, axis=0)

    animal_pk_curve = [
        {"time": round(float(t), 2), "conc": round(float(c), 1)} for t, c in zip(t_eval, mean_curve)
    ]

    # 8. Human translation (FIH) via FDA allometric Scaling
    # HED = Animal NOAEL * (Km_animal / Km_human)
    hed_bsa = measured_noael * (sp["kmFactor"] / 37.0)
    hed_pbpk = hed_bsa  # default to BSA allometric

    fih_dose_mg_kg = (min(hed_bsa, hed_pbpk)) / 10.0
    fih_dose = fih_dose_mg_kg * 70.0

    # Simulate Human PK curve at FIH dose
    # Fetch human ADMET clearance and volume
    cl_human = ml_admet.get("endpoints", {}).get("Clearance_Hepatocyte_AZ", 10.0)
    vd_human = ml_admet.get("endpoints", {}).get("VDss_Lombardo", 1.0)
    fu_human = 1.0 - float(ml_admet.get("endpoints", {}).get("PPBR_AZ", 80.0)) / 100.0
    fu_human = max(0.01, min(1.0, fu_human))

    # Human blood flow and organ specs
    h_sp = {
        "V_liver": 0.0257 * 70.0,
        "V_kidney": 0.0044 * 70.0,
        "V_heart": 0.004 * 70.0,
        "V_blood": 0.04 * 70.0,
        "Q_liver": 0.25 * 1300.0 * 60 / 1000,
        "Q_kidney": 0.19 * 1300.0 * 60 / 1000,
        "Q_heart": 0.05 * 1300.0 * 60 / 1000,
        "Q_CO": 1300.0 * 60 / 1000,
        "gfr": 120.0 * 60 / 1000,
    }
    h_sp["V_rest"] = 70.0 - h_sp["V_liver"] - h_sp["V_kidney"] - h_sp["V_heart"] - h_sp["V_blood"]
    h_sp["Q_rest"] = h_sp["Q_CO"] - h_sp["Q_liver"] - h_sp["Q_kidney"] - h_sp["Q_heart"]

    CL_hep_h = cl_human * 99.0 * (h_sp["V_liver"] * 1000.0) * 60.0 / 1e6
    CL_ren_h = h_sp["gfr"] * fu_human

    human_ode_params = {
        "Q_CO": h_sp["Q_CO"],
        "Q_liver": h_sp["Q_liver"],
        "Q_kidney": h_sp["Q_kidney"],
        "Q_heart": h_sp["Q_heart"],
        "Q_rest": h_sp["Q_rest"],
        "V_v": 0.7 * h_sp["V_blood"],
        "V_a": 0.3 * h_sp["V_blood"],
        "V_liver": h_sp["V_liver"],
        "V_kidney": h_sp["V_kidney"],
        "V_heart": h_sp["V_heart"],
        "V_rest": h_sp["V_rest"],
        "K_p_liver": K_p_liver,
        "K_p_kidney": K_p_kidney,
        "K_p_heart": K_p_heart,
        "K_p_rest": K_p_rest,
        "CL_hep": CL_hep_h,
        "CL_ren": CL_ren_h,
        "ka": 1.0,
        "route": route_of_admin,
    }

    y0_h = (
        [fih_dose * bioavail, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        if route_of_admin != "IV"
        else [0.0, fih_dose / (0.7 * h_sp["V_blood"]), 0.0, 0.0, 0.0, 0.0, 0.0]
    )
    sol_h = solve_ivp(pbpk_odes, t_span, y0_h, args=(human_ode_params,), t_eval=t_eval)
    human_mean_curve = sol_h.y[1] * 1000.0
    human_pk_curve = [
        {"time": round(float(t), 2), "conc": round(float(c), 1)}
        for t, c in zip(t_eval, human_mean_curve)
    ]

    # 9. Dose groups study design
    therapeutic_target = 100.0  # target plasma concentration ng/mL
    study_groups = [
        {
            "name": "Vehicle Control",
            "type": "control",
            "doseLevel": 0.0,
            "doseMultiple": 0.0,
            "nPerSex": 5,
            "color": "slate",
        },
        {
            "name": "Low Dose",
            "type": "low",
            "doseLevel": round(measured_noael / 10.0, 2),
            "doseMultiple": 0.1,
            "nPerSex": 5,
            "color": "blue",
        },
        {
            "name": "Mid Dose",
            "type": "mid",
            "doseLevel": round(math.sqrt(measured_noael / 10.0 * measured_noael), 2),
            "doseMultiple": 0.3,
            "nPerSex": 5,
            "color": "amber",
        },
        {
            "name": "High Dose (NOAEL)",
            "type": "high",
            "doseLevel": round(measured_noael, 2),
            "doseMultiple": 1.0,
            "nPerSex": 5,
            "color": "red",
        },
    ]
    if study_type_id in ["sub_chronic_28d", "chronic_90d"]:
        study_groups.append(
            {
                "name": "Recovery (High)",
                "type": "recovery",
                "doseLevel": round(measured_noael, 2),
                "doseMultiple": 1.0,
                "nPerSex": 3,
                "color": "emerald",
            }
        )
    if study_type_id != "single_dose":
        study_groups.append(
            {
                "name": "Satellite TK",
                "type": "satellite",
                "doseLevel": round(measured_noael, 2),
                "doseMultiple": 0.0,
                "nPerSex": 3,
                "color": "violet",
            }
        )

    total_animals = sum(g["nPerSex"] * 2 for g in study_groups)

    # Cost
    cost_per_animal = 0.8 if sp["rodent"] else 8.0
    estimated_cost_M = (total_animals * cost_per_animal * (1.0 + sp["kmFactor"] * 0.01)) / 1000.0

    # Toxicity flags
    toxicity_flags = []
    if float(ml_admet.get("endpoints", {}).get("hERG", 0.0)) > 0.5 or logP > 4.5:
        toxicity_flags.append(
            {
                "organ": "Cardiovascular",
                "risk": "moderate",
                "basis": "hERG channel affinity (structural alert, LogP > 4.5)",
                "finding": "Predicted QT prolongation risk — hERG inhibition likely",
                "ich": "ICH S7B",
            }
        )
    if float(ml_admet.get("endpoints", {}).get("DILI", 0.0)) > 0.4:
        toxicity_flags.append(
            {
                "organ": "Hepatic",
                "risk": "moderate",
                "basis": "DILI structural alerts; reactive metabolite risk",
                "finding": "ALT/AST elevation expected at high dose",
                "ich": "ICH S9",
            }
        )
    if float(ml_admet.get("endpoints", {}).get("AMES", 0.0)) > 0.6:
        toxicity_flags.append(
            {
                "organ": "Genotoxicity",
                "risk": "high",
                "basis": "AMES mutagenic structural alerts",
                "finding": "Ames test positive predicted — S2(R1) battery required",
                "ich": "ICH S2(R1)",
            }
        )

    if not toxicity_flags:
        toxicity_flags.append(
            {
                "organ": "General Systemic",
                "risk": "low",
                "basis": "Acceptable ADMET profile; no major structural alerts",
                "finding": "No significant organ-specific toxicity signals predicted",
                "ich": "ICH M3(R2)",
            }
        )

    overall_risk = (
        "high"
        if any(f["risk"] == "high" for f in toxicity_flags)
        else "moderate" if any(f["risk"] == "moderate" for f in toxicity_flags) else "low"
    )

    # Checklist
    checklist = [
        {
            "guideline": "ICH M3(R2)",
            "requirement": "Rodent repeat-dose tox (IND-enabling)",
            "status": "pass" if sp["rodent"] else "warn",
            "note": "SD rat study design satisfies rodent criteria",
        },
        {
            "guideline": "ICH S4A",
            "requirement": "Non-rodent repeat-dose tox",
            "status": "pass" if not sp["rodent"] else "warn",
            "note": "Dog/Monkey study design satisfies non-rodent criteria",
        },
        {
            "guideline": "ICH S7A",
            "requirement": "Safety pharmacology (CNS, CV, Respiratory)",
            "status": "pass",
            "note": "CV safety pharmacology in dog; CNS/respiratory in rat",
        },
        {
            "guideline": "ICH S7B",
            "requirement": "hERG / QT interval assessment",
            "status": "warn" if toxicity == "high" else "pass",
            "note": "Standard QT interval screens included in protocol",
        },
        {
            "guideline": "FDA Guidance 2005",
            "requirement": "FIH dose calculation (allometric scaling)",
            "status": "pass",
            "note": f"HED = {hed_bsa:.3f} mg/kg via BSA method; proposed FIH = {fih_dose_mg_kg:.3f} mg/kg",
        },
        {
            "guideline": "OECD 407",
            "requirement": "GLP compliance documentation",
            "status": "pass",
            "note": f"GLP protocol generated for {total_animals} animals",
        },
    ]

    ind_enabling_complete = len([c for c in checklist if c["status"] == "warn"]) <= 1

    # Justification
    species_justification = (
        f"{sp['displayName']} selected based on: (1) {sp['regulatory']}; "
        f"(2) metabolic profile homology; "
        f"(3) body weight {sp['bodyWeight']:.3f} kg supports the cohort design; "
        f"(4) historical regulatory acceptance. "
        f"PBPK allometric scaling produced HED of {hed_bsa:.3f} mg/kg (BSA method) "
        f"yielding a proposed FIH starting dose of {fih_dose_mg_kg:.3f} mg/kg ({fih_dose:.1f} mg absolute) "
        f"with a {measured_noael / fih_dose_mg_kg:.1f}x safety margin over NOAEL."
    )

    # Warnings
    model_warnings = [
        "PBPK simulation uses standard default multi-compartment parameters scaled allometrically.",
        "Renal clearance estimated as GFR * fu (filtration only); secretion/reabsorption not modeled.",
    ]

    # Build complete return payload
    return {
        "species": sp,
        "studyType": {
            "id": study_type_id,
            "label": (
                "Sub-Chronic (28-Day GLP)"
                if study_type_id == "sub_chronic_28d"
                else (
                    "Chronic (90-Day GLP)"
                    if study_type_id == "chronic_90d"
                    else "Single Dose (Acute)"
                )
            ),
            "durationWeeks": (
                4
                if study_type_id == "sub_chronic_28d"
                else 12 if study_type_id == "chronic_90d" else 1
            ),
            "animalsPerSexRodent": 10,
            "animalsPerSexNonRodent": 4,
            "recoveryGroup": study_type_id in ["sub_chronic_28d", "chronic_90d"],
            "satelliteTK": study_type_id != "single_dose",
            "oecd": "OECD 407",
            "ich": "ICH M3(R2)",
        },
        "routeOfAdmin": route_of_admin,
        "noael": round(float(measured_noael), 2),
        "mtd": round(float(loael_val or measured_noael * 1.5), 2),
        "loqNoael": round(float(measured_noael * 0.8), 2),
        "hiNoael": round(float(measured_noael * 1.2), 2),
        "animalCmax": round(float(np.mean(cmaxs)), 1),
        "animalAuc": round(float(np.mean(aucs)), 0),
        "animalHalfLife": round(float(np.mean(half_lifes)), 2),
        "animalClearance": round(float(np.mean(clearances)), 3),
        "hedBsa": round(float(hed_bsa), 3),
        "hedPbpk": round(float(hed_pbpk), 3),
        "fihDose": round(float(fih_dose), 1),
        "fihDoseMgKg": round(float(fih_dose_mg_kg), 3),
        "safetyMarginNoael": round(float(measured_noael / fih_dose_mg_kg), 1),
        "safetyMarginMtd": round(float((loael_val or measured_noael * 1.5) / fih_dose_mg_kg), 1),
        "humanCmax": round(float(np.max(human_mean_curve)), 1),
        "humanAuc": round(float(np.trapz(human_mean_curve, t_eval)), 0),
        "humanHalfLife": round(
            float(
                math.log(2)
                * (
                    h_sp["V_blood"]
                    + h_sp["V_liver"] * K_p_liver
                    + h_sp["V_kidney"] * K_p_kidney
                    + h_sp["V_heart"] * K_p_heart
                    + h_sp["V_rest"] * K_p_rest
                )
                / (CL_hep_h + CL_ren_h)
            ),
            2,
        ),
        "animalPkCurve": animal_pk_curve,
        "humanPkCurve": human_pk_curve,
        "studyGroups": study_groups,
        "totalAnimals": total_animals,
        "estimatedCostM": round(float(estimated_cost_M), 2),
        "toxicityFlags": toxicity_flags,
        "overallRisk": overall_risk,
        "checklist": checklist,
        "indEnablingComplete": ind_enabling_complete,
        "speciesJustification": species_justification,
        "formulationResult": f_res,
        "pkBasis": {
            "source": "GNN predicted Clearance_Hepatocyte_AZ",
            "clHumanLPerHPerKg": round(float((CL_hep_h + CL_ren_h) / 70.0), 4),
            "vdssHumanLPerKg": round(float(vd_human), 4),
            "fuPlasma": round(float(fu), 4),
            "humanHalfLifeH": round(
                float(
                    math.log(2)
                    * (
                        h_sp["V_blood"]
                        + h_sp["V_liver"] * K_p_liver
                        + h_sp["V_kidney"] * K_p_kidney
                        + h_sp["V_heart"] * K_p_heart
                        + h_sp["V_rest"] * K_p_rest
                    )
                    / (CL_hep_h + CL_ren_h)
                ),
                3,
            ),
        },
        "noaelBasis": {
            "source": noael_source,
            "noaelMgKgDay": round(float(measured_noael), 2),
            "loaelMgKgDay": round(float(loael_val), 2) if loael_val is not None else None,
            "species": species_covered,
            "dtxsid": dtxsid,
        },
        "modelWarnings": model_warnings,
        "pkDbMatch": pkdb_res,
    }
