"""Clinical precedent: what has already been done to this target in humans.

A starting-dose recommendation is much stronger when it can be read against
compounds that have already entered the clinic against the same target. Two
public sources are queried live:

  • **ClinicalTrials.gov API v2** — registered Phase 1 studies naming the target
    or its gene symbol, with sponsor, status, enrolment and start date. This is
    the record of what has actually been attempted in humans.
  • **ChEMBL** — approved and clinical-phase compounds annotated against the
    same target, with their maximum clinical phase, which tells you whether the
    target is precedented at all.

Both report their own status. Where a source returns nothing the block says "no
precedent located" — an absence of evidence, never re-labelled as evidence of a
novel target, because registry coverage is incomplete by construction.
"""

from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from typing import Any

CTGOV_API = "https://clinicaltrials.gov/api/v2/studies"
CHEMBL_API = "https://www.ebi.ac.uk/chembl/api/data"
TIMEOUT_S = 20.0


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL = _ssl_context()


def _get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=_SSL) as r:  # noqa: S310
        return json.loads(r.read())


def _query_clinicaltrials(term: str, *, page_size: int = 20) -> dict[str, Any]:
    """Registered Phase 1 studies mentioning the target."""
    params = urllib.parse.urlencode(
        {
            "query.term": term,
            "filter.advanced": "AREA[Phase]PHASE1",
            "pageSize": str(max(1, min(page_size, 50))),
            "fields": ",".join(
                [
                    "NCTId",
                    "BriefTitle",
                    "Phase",
                    "OverallStatus",
                    "LeadSponsorName",
                    "EnrollmentCount",
                    "StartDate",
                    "InterventionName",
                    "Condition",
                ]
            ),
        }
    )
    try:
        payload = _get_json(f"{CTGOV_API}?{params}")
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}", "trials": []}

    trials: list[dict[str, Any]] = []
    for study in payload.get("studies", []) or []:
        protocol = study.get("protocolSection") or {}
        ident = protocol.get("identificationModule") or {}
        status = protocol.get("statusModule") or {}
        sponsor = (protocol.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}
        design = protocol.get("designModule") or {}
        arms = protocol.get("armsInterventionsModule") or {}
        conditions = (protocol.get("conditionsModule") or {}).get("conditions") or []
        trials.append(
            {
                "nct_id": ident.get("nctId"),
                "title": ident.get("briefTitle"),
                "status": status.get("overallStatus"),
                "start_date": (status.get("startDateStruct") or {}).get("date"),
                "sponsor": sponsor.get("name"),
                "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
                "phases": design.get("phases"),
                "conditions": conditions[:4],
                "interventions": [
                    i.get("name")
                    for i in (arms.get("interventions") or [])[:4]
                    if isinstance(i, dict)
                ],
                "url": (
                    f"https://clinicaltrials.gov/study/{ident['nctId']}"
                    if ident.get("nctId")
                    else None
                ),
            }
        )
    return {
        "status": "live" if trials else "no-data",
        "query_term": term,
        "n_trials": len(trials),
        "trials": trials,
        "source": "ClinicalTrials.gov API v2 (NIH/NLM)",
    }


def _query_chembl_target_drugs(gene_symbol: str, *, limit: int = 25) -> dict[str, Any]:
    """Compounds annotated against the target, with their maximum clinical phase."""
    try:
        target_url = (
            f"{CHEMBL_API}/target/search.json?"
            + urllib.parse.urlencode({"q": gene_symbol, "limit": 5})
        )
        targets = (_get_json(target_url) or {}).get("targets") or []
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}", "compounds": []}

    human_single = [
        t
        for t in targets
        if t.get("organism") == "Homo sapiens" and t.get("target_type") == "SINGLE PROTEIN"
    ]
    target = (human_single or targets or [{}])[0]
    chembl_id = target.get("target_chembl_id")
    if not chembl_id:
        return {"status": "no-data", "reason": f"No ChEMBL target matched {gene_symbol!r}."}

    try:
        mech_url = (
            f"{CHEMBL_API}/mechanism.json?"
            + urllib.parse.urlencode({"target_chembl_id": chembl_id, "limit": limit})
        )
        mechanisms = (_get_json(mech_url) or {}).get("mechanisms") or []
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}", "compounds": []}

    compounds: list[dict[str, Any]] = []
    for mech in mechanisms:
        compounds.append(
            {
                "molecule_chembl_id": mech.get("molecule_chembl_id"),
                "action_type": mech.get("action_type"),
                "mechanism_of_action": mech.get("mechanism_of_action"),
                "max_phase": mech.get("max_phase"),
                "first_approval": mech.get("first_approval"),
            }
        )
    approved = [c for c in compounds if isinstance(c.get("max_phase"), (int, float)) and c["max_phase"] >= 4]
    return {
        "status": "live" if compounds else "no-data",
        "target_chembl_id": chembl_id,
        "target_name": target.get("pref_name"),
        "n_compounds": len(compounds),
        "n_approved": len(approved),
        "compounds": compounds,
        "target_precedented": bool(approved),
        "source": "ChEMBL mechanism-of-action annotations (EMBL-EBI)",
    }


def collect_clinical_precedent(
    *,
    gene_symbol: str | None,
    target_protein: str | None = None,
    therapeutic_area: str | None = None,
) -> dict[str, Any]:
    """Assemble the clinical-precedent block for the first-in-human dossier."""
    term = gene_symbol or target_protein
    if not term:
        return {
            "available": False,
            "reason": (
                "No target gene symbol or protein name was resolved upstream, so clinical "
                "precedent cannot be searched."
            ),
        }
    query = term if not therapeutic_area else f"{term} {therapeutic_area}"
    trials = _query_clinicaltrials(query)
    chembl = _query_chembl_target_drugs(gene_symbol) if gene_symbol else {"status": "skipped"}

    sources_live = [
        name
        for name, block in (("ClinicalTrials.gov", trials), ("ChEMBL", chembl))
        if isinstance(block, dict) and block.get("status") == "live"
    ]
    precedented = bool(chembl.get("target_precedented")) if isinstance(chembl, dict) else False
    return {
        "available": bool(sources_live),
        "query": {"term": term, "combined_query": query, "therapeutic_area": therapeutic_area},
        "phase1_trials": trials,
        "target_compounds": chembl,
        "sources_with_data": sources_live,
        "target_precedented": precedented,
        "novelty_note": (
            "The target has at least one approved compound annotated in ChEMBL, so it is "
            "clinically precedented. This lowers the novel-target risk factor in the "
            "safety-factor calculation."
            if precedented
            else "No approved compound against this target was located. Registry and annotation "
            "coverage is incomplete, so this is an absence of located evidence, not proof "
            "that the target is novel — but a novel-target risk factor should be considered "
            "unless precedent is confirmed by other means."
        ),
        "model": "Live REST lookups against ClinicalTrials.gov API v2 and ChEMBL",
        "provenance": "measured (public registries)",
        "limitations": (
            "Registry search is keyword-based over trial titles and conditions, so it will "
            "include some unrelated studies and miss trials that do not name the target. It "
            "is a starting point for a precedent review, not a systematic one."
        ),
    }


__all__ = ["collect_clinical_precedent"]
