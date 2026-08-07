"""Fast, local, server-owned Layer-1 small-molecule contract.

Layer 1 is deliberately small.  It evaluates a structure with the models that
ship with Hakase and does not contact third-party model hubs.  In particular it


Every number and every decision below is produced here in the backend.  The
frontend receives this envelope unchanged and is only allowed to render it.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from functools import lru_cache
from threading import Lock
from time import perf_counter
from typing import Any
from uuid import uuid4

import requests
from hakase_kernel.translational.celltype_aggregation import predict_celltype_aggregation
from hakase_kernel.translational.lab_reference import assess
from rdkit import Chem, DataStructs
from rdkit.Chem import QED, AllChem, Crippen, Descriptors, Lipinski, rdMolDescriptors

from hakase_smallmol.admet.admet_ml import predict_admet_ml
from hakase_smallmol.binding.binding_ml import predict_binding_ml
from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox
from hakase_smallmol.dili.dili_ml import predict_dili_ml
from hakase_smallmol.safety.assay_reliability import assess_assay_reliability

SCHEMA_VERSION = "hakase.small-molecule.l1.v2"
_ANALYSIS_LOCK = Lock()
_ANALYSIS_STORE: dict[str, dict[str, Any]] = {}
_MAX_STORED_ANALYSES = 500


def _round(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def _rdkit_readout(smiles: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Return canonical structure, RDKit descriptors, and an embedded conformer.

    The feasibility flags are conventional Lipinski/Veber rule checks.  They are
    labelled as rules rather than predictions, and no pKa, bioavailability, or
    synthetic-accessibility estimate is invented here.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES")
    canonical_smiles = Chem.MolToSmiles(mol, canonical=True)

    molecular_weight = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    hba = Lipinski.NumHAcceptors(mol)
    hbd = Lipinski.NumHDonors(mol)
    rotatable_bonds = Lipinski.NumRotatableBonds(mol)

    lipinski_failures = [
        label
        for label, failed in (
            ("molecular_weight > 500 Da", molecular_weight > 500),
            ("logP > 5", logp > 5),
            ("H-bond acceptors > 10", hba > 10),
            ("H-bond donors > 5", hbd > 5),
        )
        if failed
    ]
    veber_failures = [
        label
        for label, failed in (
            ("topological polar surface area > 140 Å²", tpsa > 140),
            ("rotatable bonds > 10", rotatable_bonds > 10),
        )
        if failed
    ]

    descriptors = {
        "molecular_weight_da": _round(molecular_weight, 2),
        "exact_molecular_weight_da": _round(rdMolDescriptors.CalcExactMolWt(mol), 4),
        "logp": _round(logp),
        "tpsa_a2": _round(tpsa, 2),
        "h_bond_acceptors": int(hba),
        "h_bond_donors": int(hbd),
        "rotatable_bonds": int(rotatable_bonds),
        "ring_count": int(rdMolDescriptors.CalcNumRings(mol)),
        "aromatic_ring_count": int(rdMolDescriptors.CalcNumAromaticRings(mol)),
        "fraction_csp3": _round(rdMolDescriptors.CalcFractionCSP3(mol)),
        "heavy_atom_count": int(mol.GetNumHeavyAtoms()),
        "formal_charge": int(Chem.GetFormalCharge(mol)),
        "qed": _round(QED.qed(mol)),
        "lipinski_rule_of_five_pass": not lipinski_failures,
        "lipinski_violations": len(lipinski_failures),
        "lipinski_failure_reasons": lipinski_failures,
        "veber_pass": not veber_failures,
        "veber_failure_reasons": veber_failures,
        "source": "RDKit",
    }

    # 3D coordinates are calculated on the server.  The client receives a
    # standard mol block it can display/download without a chemistry library.
    conformer: dict[str, Any] = {"available": False, "source": "RDKit ETKDGv3/MMFF"}
    try:
        molecule_3d = Chem.AddHs(Chem.Mol(mol))
        status = AllChem.EmbedMolecule(molecule_3d, AllChem.ETKDGv3())
        if status == 0:
            AllChem.MMFFOptimizeMolecule(molecule_3d)
            conformer = {
                "available": True,
                "format": "molblock-v2000",
                "molblock": Chem.MolToMolBlock(molecule_3d),
                "source": "RDKit ETKDGv3/MMFF",
            }
        else:
            conformer["reason"] = f"RDKit conformer embedding returned status {status}"
    except Exception as exc:  # A conformer is an enrichment, not a fabricated fallback.
        conformer["reason"] = f"3D generation unavailable: {type(exc).__name__}: {exc}"

    return canonical_smiles, descriptors, conformer


@lru_cache(maxsize=1)
def _local_training_fingerprints() -> tuple[Any, ...]:
    """Build a local DILI+hERG Tanimoto reference set from vendored data only."""
    import hakase_kernel.base as base

    fingerprints: list[Any] = []
    seen: set[str] = set()
    for filename in ("dili.tab", "herg_karim.tab"):
        smiles, _ = base.load_tdc_tab(filename)
        for training_smiles in smiles:
            if training_smiles in seen:
                continue
            reference_mol = Chem.MolFromSmiles(training_smiles)
            if reference_mol is None:
                continue
            seen.add(training_smiles)
            fingerprints.append(AllChem.GetMorganFingerprintAsBitVect(reference_mol, 2, nBits=2048))
    return tuple(fingerprints)


@lru_cache(maxsize=1)
def _safety_training_fingerprints_by_model() -> dict[str, tuple[Any, ...]]:
    """Keep each shipped safety model's applicability reference separate."""
    import hakase_kernel.base as base

    references: dict[str, tuple[Any, ...]] = {}
    for label, filename in (("hERG model", "herg_karim.tab"), ("DILI model", "dili.tab")):
        smiles, _ = base.load_tdc_tab(filename)
        fingerprints = []
        for training_smiles in smiles:
            reference_mol = Chem.MolFromSmiles(training_smiles)
            if reference_mol is not None:
                fingerprints.append(
                    AllChem.GetMorganFingerprintAsBitVect(reference_mol, 2, nBits=2048)
                )
        references[label] = tuple(fingerprints)
    return references


def _tanimoto_applicability(mol: Any) -> dict[str, Any]:
    """Nearest-neighbour applicability domain against the shipped safety data."""
    fingerprints = _local_training_fingerprints()
    if not fingerprints:
        return {
            "status": "unavailable",
            "reason": "No vendored DILI/hERG training fingerprints were available.",
        }
    query = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=2048)
    nearest = max(DataStructs.BulkTanimotoSimilarity(query, fingerprints))
    label = (
        "in_domain" if nearest >= 0.65 else "border_domain" if nearest >= 0.40 else "out_of_domain"
    )
    per_model = {}
    for model_name, model_fingerprints in _safety_training_fingerprints_by_model().items():
        if not model_fingerprints:
            per_model[model_name] = {"status": "unavailable", "domain": "unavailable"}
            continue
        model_nearest = max(DataStructs.BulkTanimotoSimilarity(query, model_fingerprints))
        per_model[model_name] = {
            "status": "available",
            "domain": "in_domain" if model_nearest >= 0.65 else "out_of_domain",
            "nearest_tanimoto": _round(model_nearest),
        }
    return {
        "status": "available",
        "nearest_tanimoto": _round(nearest),
        "domain": label,
        "reference_set": "vendored DILI + hERG_Karim training chemistry",
        "reference_count": len(fingerprints),
        "method": "Morgan radius-2, 2048-bit fingerprint; nearest-neighbour Tanimoto",
        "thresholds": {"in_domain": 0.65, "border_domain": 0.40},
        "model_domains": per_model,
    }


def _first(values: Any) -> str | None:
    """Read the first OpenFDA string field without inventing a replacement."""
    if isinstance(values, list) and values and isinstance(values[0], str):
        return values[0]
    return None


@lru_cache(maxsize=256)
def _regulatory_outlook(canonical_smiles: str) -> dict[str, Any]:
    """Live exact-identity regulatory lookup using PubChem + the official OpenFDA API.

    FDA databases cannot query a novel structure directly.  The backend first
    resolves the exact structure to a public compound title, then queries that
    name against Drugs@FDA and label records.  A novel structure therefore gets
    an explicit ``not_found`` result rather than a made-up regulatory outlook.
    """
    mol = Chem.MolFromSmiles(canonical_smiles)
    if mol is None:
        return {"status": "unavailable", "reason": "RDKit could not resolve the input structure."}
    inchikey = Chem.MolToInchiKey(mol)
    headers = {"Accept": "application/json", "User-Agent": "HakaseAI-L1/1.0"}
    try:
        identity_response = requests.get(
            f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/{inchikey}/property/Title/JSON",
            headers=headers,
            timeout=2.5,
        )
        identity_json = identity_response.json() if identity_response.ok else {}
        properties = (identity_json.get("PropertyTable") or {}).get("Properties") or []
        name = (
            properties[0].get("Title") if properties and isinstance(properties[0], dict) else None
        )
    except requests.RequestException as exc:
        return {
            "status": "unavailable",
            "reason": f"PubChem identity resolution unavailable: {type(exc).__name__}: {exc}",
            "inchikey": inchikey,
        }
    except ValueError as exc:
        return {
            "status": "unavailable",
            "reason": f"PubChem identity response could not be read: {type(exc).__name__}: {exc}",
            "inchikey": inchikey,
        }

    if not isinstance(name, str) or not name.strip():
        return {
            "status": "not_found",
            "inchikey": inchikey,
            "reason": "No public compound name resolved for this exact structure; FDA sources cannot be queried by novel SMILES alone.",
            "sources": ["PubChem exact InChIKey identity", "OpenFDA (not queried without a name)"],
        }
    name = name.strip()

    def get_json(url: str, params: dict[str, str]) -> tuple[dict[str, Any] | None, str | None]:
        try:
            response = requests.get(url, params=params, headers=headers, timeout=2.5)
            if response.status_code == 404:
                return {}, None
            if not response.ok:
                return None, f"OpenFDA HTTP {response.status_code}"
            return response.json(), None
        except (requests.RequestException, ValueError) as exc:
            return None, f"OpenFDA unavailable: {type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=2) as executor:
        applications_future = executor.submit(
            get_json,
            "https://api.fda.gov/drug/drugsfda.json",
            {"search": f'products.active_ingredients.name:"{name}"', "limit": "5"},
        )
        labels_future = executor.submit(
            get_json,
            "https://api.fda.gov/drug/label.json",
            {"search": f'openfda.generic_name:"{name}"', "limit": "5"},
        )
        applications, applications_error = applications_future.result()
        labels, labels_error = labels_future.result()

    if applications is None and labels is None:
        return {
            "status": "unavailable",
            "inchikey": inchikey,
            "identity_name": name,
            "reason": "; ".join(value for value in (applications_error, labels_error) if value),
            "sources": [
                "PubChem exact InChIKey identity",
                "OpenFDA Drugs@FDA",
                "OpenFDA drug labels",
            ],
        }

    application_results = (applications or {}).get("results") or []
    label_results = (labels or {}).get("results") or []
    label_records = [
        {
            "brand_name": _first((record.get("openfda") or {}).get("brand_name")),
            "generic_name": _first((record.get("openfda") or {}).get("generic_name")),
            "manufacturer_name": _first((record.get("openfda") or {}).get("manufacturer_name")),
            "route": _first((record.get("openfda") or {}).get("route")),
            "product_type": _first((record.get("openfda") or {}).get("product_type")),
            "boxed_warning": _first(record.get("boxed_warning")),
            "warnings": _first(record.get("warnings")),
            "source": "OpenFDA drug label",
        }
        for record in label_results
        if isinstance(record, dict)
    ]
    applications_records = [
        {
            "application_number": record.get("application_number"),
            "sponsor_name": record.get("sponsor_name"),
            "application_type": record.get("application_type"),
            "products": record.get("products"),
            "source": "OpenFDA Drugs@FDA",
        }
        for record in application_results
        if isinstance(record, dict)
    ]
    found = bool(application_results or label_results)
    return {
        "status": "available" if found else "not_found",
        "inchikey": inchikey,
        "identity_name": name,
        "exact_structure_match": True,
        "reason": (
            None
            if found
            else "No OpenFDA Drugs@FDA application or label was returned for this exact identity."
        ),
        "drugsfda_applications": applications_records,
        "drug_labels": label_records,
        "source_errors": [value for value in (applications_error, labels_error) if value],
        "sources": ["PubChem exact InChIKey identity", "OpenFDA Drugs@FDA", "OpenFDA drug labels"],
        "queried_at": datetime.now(UTC).isoformat(),
    }


def _prediction_value(envelope: dict[str, Any], key: str) -> float | None:
    value = (envelope.get("prediction") or {}).get(key)
    return float(value) if isinstance(value, (int, float)) else None


def _safety_readouts(
    admet: dict[str, Any], hERG: dict[str, Any], dili: dict[str, Any]
) -> dict[str, Any]:
    endpoints = admet["endpoints"]
    hERG_probability = _prediction_value(hERG, "blocker_probability")
    dili_probability = _prediction_value(dili, "dili_probability")
    return {
        "hERG_local_probability": {
            "value": hERG_probability,
            "risk_class": (hERG.get("prediction") or {}).get("risk_class"),
            "source": "CardioTox local Random Forest",
        },
        "dili_local_probability": {
            "value": dili_probability,
            "risk_class": (dili.get("prediction") or {}).get("risk_class"),
            "source": "DILI-ML local Random Forest",
        },
        "hERG_admet_ai_probability": {"value": endpoints.get("hERG"), "source": "ADMET-AI"},
        "dili_admet_ai_probability": {"value": endpoints.get("DILI"), "source": "ADMET-AI"},
        "ames_admet_ai_probability": {"value": endpoints.get("AMES"), "source": "ADMET-AI"},
        "clintox_admet_ai_probability": {"value": endpoints.get("ClinTox"), "source": "ADMET-AI"},
        "carcinogenicity_admet_ai_probability": {
            "value": endpoints.get("Carcinogens_Lagunin"),
            "source": "ADMET-AI",
        },
    }


_ADMET_REFERENCE_KEYS = {
    "molecular_weight": "mw",
    "logP": "logp",
    "QED": "qed",
    "tpsa": "tpsa",
    "Solubility_AqSolDB": "solubility_logS",
    "HIA_Hou": "hia_prob",
    "Pgp_Broccatelli": "pgp_substrate_prob",
    "Bioavailability_Ma": "bioavailability_prob",
    "PAMPA_NCATS": "pampa_prob",
    "VDss_Lombardo": "vdss",
    "Clearance_Hepatocyte_AZ": "hepatocyte_clint",
    "Clearance_Microsome_AZ": "microsome_clint",
    "Half_Life_Obach": "half_life_h",
    "hERG": "herg",
    "DILI": "dili",
    "AMES": "ames",
    "ClinTox": "clintox",
    "Carcinogens_Lagunin": "carcinogenicity",
    "Skin_Reaction": "skin_sensitization",
}


def _admet_assessments(admet: dict[str, Any]) -> dict[str, Any]:
    """Attach a backend-owned interpretation to every ADMET-AI endpoint.

    ``lab_reference.assess`` supplies published rules only where Hakase has a
    defensible range.  Endpoints without one are still returned in full with an
    explicit ``info`` status; no frontend heuristic fills that gap.
    """
    assessed: dict[str, Any] = {}
    for endpoint, value in admet["endpoints"].items():
        numeric_value = float(value) if isinstance(value, (int, float)) else None
        reference_key = _ADMET_REFERENCE_KEYS.get(endpoint)
        assessment = (
            assess(reference_key, numeric_value)
            if reference_key
            else {
                "status": "info",
                "value": numeric_value,
                "reference": "No backend reference range is defined for this endpoint.",
                "basis": "Raw ADMET-AI endpoint shown without an outcome classification.",
            }
        )
        assessed[endpoint] = {
            "endpoint": endpoint,
            "model_value": numeric_value,
            "source": "ADMET-AI",
            "reference_key": reference_key,
            "assessment": assessment,
        }
    return assessed


_ADMET_SECTION_ENDPOINTS = {
    "Absorption": {
        "Caco2_Wang",
        "Solubility_AqSolDB",
        "HIA_Hou",
        "Pgp_Broccatelli",
        "Bioavailability_Ma",
        "PAMPA_NCATS",
        "HydrationFreeEnergy_FreeSolv",
        "Lipophilicity_AstraZeneca",
    },
    "Distribution": {"BBB_Martins", "PPBR_AZ", "VDss_Lombardo"},
    "Metabolism": {
        "CYP1A2_Veith",
        "CYP2C19_Veith",
        "CYP2C9_Substrate_CarbonMangels",
        "CYP2C9_Veith",
        "CYP2D6_Substrate_CarbonMangels",
        "CYP2D6_Veith",
        "CYP3A4_Substrate_CarbonMangels",
        "CYP3A4_Veith",
    },
    "Excretion": {"Clearance_Hepatocyte_AZ", "Clearance_Microsome_AZ", "Half_Life_Obach"},
    "Toxicity": {
        "AMES",
        "hERG",
        "DILI",
        "ClinTox",
        "Carcinogens_Lagunin",
        "Skin_Reaction",
        "LD50_Zhu",
        "NR-AR-LBD",
        "NR-AR",
        "NR-AhR",
        "NR-Aromatase",
        "NR-ER-LBD",
        "NR-ER",
        "NR-PPAR-gamma",
        "SR-ARE",
        "SR-ATAD5",
        "SR-HSE",
        "SR-MMP",
        "SR-p53",
    },
    "Physchem": {
        "molecular_weight",
        "logP",
        "hydrogen_bond_acceptors",
        "hydrogen_bond_donors",
        "Lipinski",
        "QED",
        "stereo_centers",
        "tpsa",
        "PAINS_alert",
        "BRENK_alert",
        "NIH_alert",
    },
}


def _admet_sections(assessments: dict[str, Any]) -> dict[str, Any]:
    """Backend-defined presentation sections; the browser does not categorise endpoints."""
    assigned: set[str] = set()
    sections: dict[str, Any] = {}
    for section, endpoints in _ADMET_SECTION_ENDPOINTS.items():
        selected = {key: assessments[key] for key in endpoints if key in assessments}
        assigned.update(selected)
        sections[section] = selected
    sections["Additional ADMET-AI endpoints"] = {
        key: value for key, value in assessments.items() if key not in assigned
    }
    return sections


def _rdkit_assessments(descriptors: dict[str, Any]) -> dict[str, Any]:
    mapping = {
        "molecular_weight_da": "mw",
        "logp": "logp",
        "tpsa_a2": "tpsa",
        "qed": "qed",
        "lipinski_violations": "lipinski",
    }
    return {
        name: {
            "endpoint": name,
            "model_value": descriptors.get(name),
            "source": "RDKit",
            "assessment": assess(reference_key, descriptors.get(name)),
        }
        for name, reference_key in mapping.items()
    }


def _stage_gate(
    descriptors: dict[str, Any],
    applicability: dict[str, Any],
    hERG: dict[str, Any],
    dili: dict[str, Any],
    *,
    toxicity_signal_detection: bool,
) -> dict[str, Any]:
    """A transparent rule-based Layer-1 gate, evaluated only on backend output."""
    hERG_risk = (hERG.get("prediction") or {}).get("risk_class")
    dili_risk = (dili.get("prediction") or {}).get("risk_class")
    safety_checks = [
        {
            "name": "hERG local safety model",
            "value": hERG_risk,
            "source": "CardioTox local Random Forest",
            "status": (
                "poor"
                if hERG_risk == "High"
                else "borderline" if hERG_risk == "Moderate" else "good"
            ),
        },
        {
            "name": "DILI local safety model",
            "value": dili_risk,
            "source": "DILI-ML local Random Forest",
            "status": (
                "poor"
                if dili_risk == "High"
                else "borderline" if dili_risk == "Moderate" else "good"
            ),
        },
    ]
    if not toxicity_signal_detection:
        safety_checks = [
            {
                "name": "hERG local safety model",
                "value": "Not requested",
                "source": "Not run by the submitted simulation configuration",
                "status": "info",
            },
            {
                "name": "DILI local safety model",
                "value": "Not requested",
                "source": "Not run by the submitted simulation configuration",
                "status": "info",
            },
        ]
    checks = safety_checks + [
        {
            "name": "Lipinski rule-of-five",
            "value": "pass" if descriptors["lipinski_rule_of_five_pass"] else "review",
            "source": "RDKit",
            "status": "good" if descriptors["lipinski_rule_of_five_pass"] else "borderline",
        },
        {
            "name": "Tanimoto applicability domain",
            "value": applicability.get("domain", applicability.get("status")),
            "source": "vendored DILI + hERG training chemistry",
            "status": (
                "borderline"
                if applicability.get("domain") == "out_of_domain"
                else "good" if applicability.get("status") == "available" else "info"
            ),
        },
    ]

    high_risks = [check["name"] for check in checks[:2] if check["value"] == "High"]
    watch_reasons = [check["name"] for check in checks[:2] if check["value"] == "Moderate"]
    if not descriptors["lipinski_rule_of_five_pass"]:
        watch_reasons.append("Lipinski rule-of-five")
    if applicability.get("domain") == "out_of_domain":
        watch_reasons.append("Tanimoto applicability domain")
    if high_risks:
        verdict = "NO-GO"
        rationale = (
            f"NO-GO because a local safety model reported High risk: {', '.join(high_risks)}."
        )
        recommendation = "Stop"
    elif watch_reasons:
        verdict = "WATCH"
        rationale = f"WATCH because these Layer-1 checks need review: {', '.join(watch_reasons)}."
        recommendation = "Proceed with caution"
    else:
        verdict = "GO"
        rationale = (
            "GO for Layer-1 progression: no configured local safety or feasibility gate triggered."
        )
        recommendation = "Proceed"
    missing_evidence = []
    if not toxicity_signal_detection:
        missing_evidence.extend(["Cardiac-safety screening", "DILI screening"])
    if applicability.get("status") != "available":
        missing_evidence.append("Applicability-domain evidence")
    if missing_evidence and not high_risks and not watch_reasons:
        verdict = "WATCH"
        recommendation = "Additional evidence required"
        rationale = "Additional evidence is required before progression because one or more configured evidence groups were not run or were unavailable."
    recommended_experiments = []
    if toxicity_signal_detection and any(
        check["name"].startswith("hERG") and check["status"] != "good" for check in checks
    ):
        recommended_experiments.append("Orthogonal cardiac-safety assay")
    if toxicity_signal_detection and any(
        check["name"].startswith("DILI") and check["status"] != "good" for check in checks
    ):
        recommended_experiments.append("Hepatotoxicity counterscreen")
    if not recommended_experiments:
        recommended_experiments.append("Confirmatory concentration-response assay")
    return {
        "verdict": verdict,
        "headline": "Local Layer-1 stage gate (not a clinical or regulatory determination).",
        "rationale": rationale,
        "recommendation": recommendation,
        "major_risks": high_risks or watch_reasons,
        "missing_evidence": missing_evidence,
        "recommended_next_experiments": recommended_experiments,
        "checks": checks,
        "policy": {
            "no_go": "A High local CardioTox or DILI-ML risk class.",
            "watch": "A Moderate local safety risk, a Lipinski violation, or out-of-domain Tanimoto result.",
            "go": "No configured Layer-1 gate triggered.",
        },
        "source": "hakase_smallmol.l1.pipeline",
    }


def record_l1_override(
    analysis_id: str,
    *,
    reviewer: str,
    decision: str,
    rationale: str,
    flagged_checks: list[str],
) -> dict[str, Any]:
    """Record a user review through the backend and return the effective gate.

    This is intentionally a review record, not a model edit: the original
    model verdict and every safety flag remain in the immutable analysis data.
    Runtime persistence is used while authentication/database storage is off.
    """
    normalized_reviewer = reviewer.strip()
    normalized_rationale = rationale.strip()
    if not normalized_reviewer:
        raise ValueError("reviewer is required")
    if decision not in {"GO", "WATCH", "NO-GO"}:
        raise ValueError("decision must be GO, WATCH, or NO-GO")
    if not normalized_rationale:
        raise ValueError("rationale is required")
    with _ANALYSIS_LOCK:
        analysis = _ANALYSIS_STORE.get(analysis_id)
        if analysis is None:
            raise ValueError(
                "analysis_id was not found; run Layer 1 again before recording an override"
            )
        original_verdict = analysis["verdict"]
        record = {
            "status": "recorded",
            "analysis_id": analysis_id,
            "reviewer": normalized_reviewer,
            "decision": decision,
            "rationale": normalized_rationale,
            "flagged_checks": [
                item for item in flagged_checks if isinstance(item, str) and item.strip()
            ],
            "original_backend_verdict": original_verdict,
            "effective_verdict": decision,
            "recorded_at": datetime.now(UTC).isoformat(),
            "persistence": "backend runtime review record; durable user storage is added with authentication",
        }
        analysis["override"] = record
    return record


def get_l1_analysis(analysis_id: str) -> dict[str, Any]:
    """Return the immutable Layer-1 payload plus any server-recorded review.

    Layer 2 consumes this backend record by ID.  It deliberately does not accept
    a browser-assembled approximation of Layer 1, so Confirmation can always
    state exactly which L1 analysis it received.
    """
    with _ANALYSIS_LOCK:
        stored = _ANALYSIS_STORE.get(analysis_id)
        if stored is None:
            raise ValueError(
                "analysis_id was not found; run Layer 1 again before opening Confirmation"
            )
        payload = stored.get("report_payload")
        if not isinstance(payload, dict):
            raise ValueError("The completed analysis has no Layer-1 payload")
        return {
            "analysis_id": analysis_id,
            "created_at": stored.get("created_at"),
            "requested": stored.get("requested", {}),
            "analysis": payload,
            "override": stored.get("override"),
            "owner": "hakase_smallmol.l1.pipeline",
        }


def generate_l1_wetlab_report(analysis_id: str) -> dict[str, Any]:
    """Generate a backend-owned, downloadable wet-lab review report in Markdown."""
    with _ANALYSIS_LOCK:
        stored = _ANALYSIS_STORE.get(analysis_id)
        if stored is None:
            raise ValueError(
                "analysis_id was not found; run Layer 1 again before generating a report"
            )
        data = stored.get("report_payload")
        override = stored.get("override")
    if not isinstance(data, dict):
        raise ValueError("The completed analysis has no reportable Layer-1 payload")

    lines = [
        "# HakaseAI — Layer 1 In Vitro Wet-Lab Review",
        "",
        f"- Analysis ID: `{analysis_id}`",
        f"- Canonical SMILES: `{data.get('canonical_smiles')}`",
        f"- Generated: {datetime.now(UTC).isoformat()}",
        "",
        "## Stage gate",
        "",
        f"- Verdict: **{(data.get('verdict') or {}).get('verdict')}**",
        f"- Rationale: {(data.get('verdict') or {}).get('rationale')}",
        "",
        "## Structural feasibility",
        "",
    ]
    for name, entry in (data.get("rdkit_assessments") or {}).items():
        assessment = (entry or {}).get("assessment") or {}
        lines.append(
            f"- {name}: {entry.get('model_value')} — {assessment.get('status')} "
            f"({assessment.get('reference') or assessment.get('reason') or 'no reference range'})"
        )
    lines.extend(["", "## Safety assessment", ""])
    for name, entry in (data.get("safety_assessments") or {}).items():
        assessment = (entry or {}).get("assessment") or {}
        lines.append(f"- {name}: {entry.get('model_value')} — {assessment.get('status')}")
    lines.extend(["", "## ADMET properties", ""])
    for section, endpoints in (data.get("admet_ai_sections") or {}).items():
        heading = "Additional properties" if section == "Additional ADMET-AI endpoints" else section
        lines.extend([f"### {heading}", ""])
        for name, entry in (endpoints or {}).items():
            assessment = (entry or {}).get("assessment") or {}
            lines.append(
                f"- {name}: {entry.get('model_value')} — {assessment.get('status')} "
                f"({assessment.get('reference') or assessment.get('reason') or 'no reference range'})"
            )
        lines.append("")
    lines.extend(
        ["## Regulatory outlook", "", "```json", str(data.get("regulatory_outlook")), "```"]
    )
    if override:
        lines.extend(["", "## Manual review record", "", "```json", str(override), "```"])
    return {
        "analysis_id": analysis_id,
        "format": "markdown",
        "filename": f"hakase-layer-1-wetlab-{analysis_id}.md",
        "content": "\n".join(lines),
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l1.pipeline",
    }


def run_l1_pipeline(
    smiles: str,
    *,
    uniprot_id: str | None = None,
    target_protein: str | None = None,
    pdb_id: str | None = None,
    target_resolution: dict[str, Any] | None = None,
    target_evidence: dict[str, Any] | None = None,
    therapeutic_area: str | None = None,
    simulation_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the focused Layer-1 screen with an exact-identity regulatory lookup.

    Scientific predictors use the vendored local models and RDKit.  Regulatory
    evidence is the sole public-record integration: it is queried by exact
    structure identity and returns an explicit unavailable/not-found envelope
    when no record can be resolved.
    """
    started_at = perf_counter()
    normalized_smiles = smiles.strip()
    if not normalized_smiles:
        raise ValueError("smiles is required")

    raw_options = simulation_options or {}
    options = {
        "admet_profiling": bool(raw_options.get("admet_profiling", True)),
        "binding_simulation": bool(raw_options.get("binding_simulation", False)),
        "toxicity_signal_detection": bool(raw_options.get("toxicity_signal_detection", True)),
        "behavioral_fingerprinting": bool(raw_options.get("behavioral_fingerprinting", False)),
        "confidence_threshold": float(raw_options.get("confidence_threshold", 0.70)),
    }

    canonical_smiles, descriptors, conformer = _rdkit_readout(normalized_smiles)
    molecule = Chem.MolFromSmiles(canonical_smiles)
    assert molecule is not None  # validated in _rdkit_readout

    admet = (
        predict_admet_ml(canonical_smiles)
        if options["admet_profiling"]
        else {
            "source": "not_requested",
            "ml_available": False,
            "endpoints": {},
            "reason": "ADMET profiling was disabled by the submitted simulation configuration.",
        }
    )
    if options["admet_profiling"] and not admet.get("ml_available"):
        raise RuntimeError(f"ADMET-AI engine unavailable: {admet.get('error', 'unknown error')}")

    # These are local cached RF models.  They never call external hubs and an
    # unavailable second opinion remains explicit rather than blocking ADMET-AI.
    hERG = (
        predict_cardiotox(canonical_smiles)
        if options["toxicity_signal_detection"]
        else {"source": "not_requested", "prediction": {}}
    )
    dili = (
        predict_dili_ml(canonical_smiles)
        if options["toxicity_signal_detection"]
        else {"source": "not_requested", "prediction": {}}
    )
    assay_reliability = assess_assay_reliability(canonical_smiles)
    applicability = _tanimoto_applicability(molecule)
    regulatory_outlook = _regulatory_outlook(canonical_smiles)
    safety = _safety_readouts(admet, hERG, dili)
    admet_assessments = _admet_assessments(admet)
    safety_assessments = {
        "hERG_local": {
            "endpoint": "hERG screening result",
            "model_value": _prediction_value(hERG, "blocker_probability"),
            "source": "CardioTox local Random Forest",
            "assessment": {
                "status": {
                    "Low": "Low predicted likelihood",
                    "Moderate": "Intermediate predicted likelihood",
                    "High": "High predicted likelihood",
                }.get((hERG.get("prediction") or {}).get("risk_class"), "Model score unavailable"),
                "unit": "model score",
                "basis": "Screening prediction; not a clinical probability or confirmed safety result.",
            },
        },
        "dili_local": {
            "endpoint": "DILI screening result",
            "model_value": _prediction_value(dili, "dili_probability"),
            "source": "DILI-ML local Random Forest",
            "assessment": {
                "status": (
                    "Intermediate model score"
                    if _prediction_value(dili, "dili_probability") is not None
                    else "Model score unavailable"
                ),
                "unit": "model score",
                "basis": "Screening prediction; validated decision thresholds are not configured for this result.",
            },
        },
    }
    stage_gate = _stage_gate(
        descriptors,
        applicability,
        hERG,
        dili,
        toxicity_signal_detection=options["toxicity_signal_detection"],
    )

    binding_run: dict[str, Any] = {
        "status": "not_requested",
        "reason": "Binding simulation was disabled by the submitted simulation configuration.",
    }
    if options["binding_simulation"]:
        if uniprot_id and uniprot_id.strip():
            binding_result = predict_binding_ml(canonical_smiles, uniprot_id.strip())
            binding_run = {
                "status": "available" if binding_result.get("ml_available") else "unavailable",
                "result": binding_result,
                "reason": binding_result.get("error"),
            }
        else:
            binding_run = {
                "status": "needs_target",
                "reason": "BindingML requires a resolved UniProt target.",
            }

    behavioral_run: dict[str, Any] = {
        "status": "not_requested",
        "reason": "Behavioural fingerprinting was disabled by the submitted simulation configuration.",
    }
    if options["behavioral_fingerprinting"]:
        gene_symbol = (target_evidence or {}).get("gene_symbol") or (target_resolution or {}).get(
            "gene_symbol"
        )
        if isinstance(gene_symbol, str) and gene_symbol.strip():
            behavioral_result = predict_celltype_aggregation(
                targets=[{"gene_symbol": gene_symbol.strip().upper(), "uniprot_id": uniprot_id}],
                top_n=10,
            )
            behavioral_run = {
                "status": (
                    "available"
                    if behavioral_result.get("ml_available")
                    and behavioral_result.get("source") == "ml"
                    else "unavailable"
                ),
                "result": behavioral_result,
                "reason": behavioral_result.get("error"),
            }
        else:
            behavioral_run = {
                "status": "needs_target",
                "reason": "Behavioural fingerprinting requires a resolved target gene symbol.",
            }

    analysis_id = str(uuid4())
    analysis_data = {
        "analysis_id": analysis_id,
        "canonical_smiles": canonical_smiles,
        "verdict": stage_gate,
        "rdkit_feasibility": descriptors,
        "rdkit_assessments": _rdkit_assessments(descriptors),
        "tanimoto_applicability": applicability,
        "safety": safety,
        "safety_assessments": safety_assessments,
        "assay_reliability": assay_reliability,
        "admet_ai_endpoints": admet_assessments,
        "admet_ai_sections": _admet_sections(admet_assessments),
        "three_dimensional_structure": conformer,
        "regulatory_outlook": regulatory_outlook,
        "target_resolution": target_resolution
        or {
            "status": "unresolved",
            "target_protein": None,
            "uniprot_id": None,
            "pdb_id": None,
            "reason": "No resolved protein target was provided for this analysis.",
        },
        "target_evidence": target_evidence or {},
        "simulation_configuration": {
            **options,
            "confidence_threshold_note": "Review preference only; model-specific calibrated decision thresholds are not changed.",
        },
        "optional_model_runs": {
            "binding_simulation": binding_run,
            "behavioral_fingerprinting": behavioral_run,
        },
    }
    with _ANALYSIS_LOCK:
        if len(_ANALYSIS_STORE) >= _MAX_STORED_ANALYSES:
            _ANALYSIS_STORE.pop(next(iter(_ANALYSIS_STORE)))
        _ANALYSIS_STORE[analysis_id] = {
            "verdict": stage_gate["verdict"],
            "created_at": datetime.now(UTC).isoformat(),
            "requested": {
                "smiles": normalized_smiles,
                "uniprot_id": uniprot_id.strip() if uniprot_id and uniprot_id.strip() else None,
                "target_protein": (
                    target_protein.strip() if target_protein and target_protein.strip() else None
                ),
                "pdb_id": pdb_id.strip().upper() if pdb_id and pdb_id.strip() else None,
                "target_resolution": target_resolution or None,
                "target_evidence": target_evidence or None,
                "therapeutic_area": (
                    therapeutic_area.strip()
                    if therapeutic_area and therapeutic_area.strip()
                    else None
                ),
                "simulation_options": options,
            },
            "report_payload": analysis_data,
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "requested": {
            "smiles": normalized_smiles,
            "uniprot_id": uniprot_id.strip() if uniprot_id and uniprot_id.strip() else None,
            "target_protein": (
                target_protein.strip() if target_protein and target_protein.strip() else None
            ),
            "pdb_id": pdb_id.strip().upper() if pdb_id and pdb_id.strip() else None,
            "therapeutic_area": (
                therapeutic_area.strip() if therapeutic_area and therapeutic_area.strip() else None
            ),
            "simulation_options": options,
        },
        "analysis": {
            "status": "available",
            "data": analysis_data,
        },
        "molecular_properties": {
            "status": "not_requested",
            "reason": "Superseded by rdkit_feasibility.",
        },
        "binding": {
            "status": "not_requested",
            "reason": "Target binding is outside the focused Layer-1 screen.",
        },
        "provenance": {
            "owner": "hakase_smallmol.l1.pipeline",
            "schema_version": SCHEMA_VERSION,
            "computed_at": datetime.now(UTC).isoformat(),
            "inference_time_ms": _round((perf_counter() - started_at) * 1000, 2),
            "client_contract": "display-only",
            "engines": [
                "RDKit",
                "ADMET-AI",
                "CardioTox local Random Forest",
                "DILI-ML local Random Forest",
                "local Morgan/Tanimoto applicability domain",
                "RDKit FilterCatalog PAINS/Brenk assay-reliability screen",
                "OpenFDA exact-identity regulatory lookup",
                "BindingML" if options["binding_simulation"] else "BindingML (not requested)",
                (
                    "Drug2cell / Tabula Sapiens"
                    if options["behavioral_fingerprinting"]
                    else "Drug2cell / Tabula Sapiens (not requested)"
                ),
            ],
            "excluded": ["Ersilia", "ADMETlab", "external model hubs", "legacy invitro_panel"],
        },
    }
