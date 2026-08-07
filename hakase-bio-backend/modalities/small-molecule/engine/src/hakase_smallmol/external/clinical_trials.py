"""ClinicalTrials.gov — registered trial context for a condition or target.

Queried through the official REST API v2. Two distinct readings are produced:

  landscape   how many trials, at which phases, with what enrolment — the
              design benchmark a Phase-1 protocol is written against
  status mix  how the registered studies resolved (completed, terminated,
              withdrawn). Termination rate is a *registry* statistic, not a
              success probability, and is labelled as such.

The registry is keyword-indexed, so a query returns studies whose titles or
conditions mention the term. That recall/precision limit is reported with the
result rather than hidden behind a tidy number.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import (
    SourceUnavailable,
    get_json,
    no_data,
    unavailable,
)

CTG_API = "https://clinicaltrials.gov/api/v2"
SOURCE = "ClinicalTrials.gov API v2"

_FIELDS = (
    "NCTId,BriefTitle,Phase,OverallStatus,Condition,InterventionName,"
    "EnrollmentCount,StartDate,PrimaryCompletionDate,LeadSponsorName,HasResults,WhyStopped"
)


def _phase(phases: Any) -> str:
    if not phases:
        return "Not applicable / not specified"
    value = phases[0] if isinstance(phases, list) and phases else phases
    return str(value).replace("PHASE", "Phase ").replace("_", " ").strip() or "Unknown"


def _trial(study: dict[str, Any]) -> dict[str, Any]:
    protocol = study.get("protocolSection") or {}
    identification = protocol.get("identificationModule") or {}
    status = protocol.get("statusModule") or {}
    design = protocol.get("designModule") or {}
    sponsor = protocol.get("sponsorCollaboratorsModule") or {}
    arms = protocol.get("armsInterventionsModule") or {}
    conditions = protocol.get("conditionsModule") or {}
    nct_id = identification.get("nctId")
    return {
        "nct_id": nct_id,
        "title": identification.get("briefTitle"),
        "phase": _phase(design.get("phases")),
        "status": status.get("overallStatus"),
        "why_stopped": status.get("whyStopped"),
        "conditions": (conditions.get("conditions") or [])[:4],
        "interventions": [
            i.get("name") for i in (arms.get("interventions") or [])[:4] if i.get("name")
        ],
        "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
        "start_date": (status.get("startDateStruct") or {}).get("date"),
        "primary_completion": (status.get("primaryCompletionDateStruct") or {}).get("date"),
        "sponsor": (sponsor.get("leadSponsor") or {}).get("name"),
        "has_results": bool(study.get("hasResults")),
        "url": f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else None,
    }


def search_clinical_trials(
    *,
    condition: str | None = None,
    intervention: str | None = None,
    term: str | None = None,
    phase: str | None = None,
    max_results: int = 25,
) -> dict[str, Any]:
    """Registered studies matching a condition, intervention or free term."""
    if not any((condition, intervention, term)):
        return no_data(
            SOURCE,
            "No condition, intervention or search term was available, so the registry cannot be "
            "queried.",
        )

    params: dict[str, Any] = {
        "fields": _FIELDS,
        "pageSize": max(1, min(int(max_results), 100)),
        "format": "json",
        "countTotal": "true",
    }
    if condition:
        params["query.cond"] = condition
    if intervention:
        params["query.intr"] = intervention
    if term:
        params["query.term"] = term
    if phase:
        params["filter.advanced"] = f"AREA[Phase]{phase}"

    try:
        payload = get_json(f"{CTG_API}/studies", params=params, timeout=25.0)
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), query=params)

    studies = (payload or {}).get("studies") or []
    if not studies:
        return no_data(
            SOURCE,
            "No registered study matched the query. The registry is keyword-indexed, so this is "
            "an absence of a text match, not proof that no trial exists.",
            query={k: v for k, v in params.items() if k.startswith("query")},
        )

    trials = [_trial(s) for s in studies]
    total = (payload or {}).get("totalCount") or len(trials)

    by_phase: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for trial in trials:
        by_phase[trial["phase"]] = by_phase.get(trial["phase"], 0) + 1
        key = str(trial["status"] or "UNKNOWN")
        by_status[key] = by_status.get(key, 0) + 1

    enrolments = [t["enrollment"] for t in trials if isinstance(t["enrollment"], (int, float))]
    terminated = sum(by_status.get(k, 0) for k in ("TERMINATED", "WITHDRAWN", "SUSPENDED"))
    completed = by_status.get("COMPLETED", 0)
    resolved = terminated + completed

    return {
        "status": "live",
        "source": SOURCE,
        "query": {k: v for k, v in params.items() if k.startswith("query")},
        "trials": trials,
        "n_returned": len(trials),
        "total_matching": total,
        "by_phase": by_phase,
        "by_status": by_status,
        "median_enrollment": (
            sorted(enrolments)[len(enrolments) // 2] if enrolments else None
        ),
        "n_with_posted_results": sum(1 for t in trials if t["has_results"]),
        "terminated_or_withdrawn": terminated,
        "completed": completed,
        "termination_fraction_of_resolved": (
            round(terminated / resolved, 3) if resolved else None
        ),
        "url": "https://clinicaltrials.gov/",
        "limitations": (
            "Registry counts describe what was registered, not what succeeded. Registration is "
            "incomplete outside the jurisdictions that mandate it, active studies have no "
            "outcome yet, and the termination fraction covers only resolved studies in this "
            "result page — it is not a probability of technical success."
        ),
        "provenance": "measured (public trial registry)",
    }


def phase1_landscape(*, term: str, max_results: int = 25) -> dict[str, Any]:
    """Phase-1 studies specifically — the first-in-human design benchmark."""
    result = search_clinical_trials(term=term, phase="PHASE1", max_results=max_results)
    if result.get("status") == "live":
        result["scope"] = "Phase 1 only"
    return result


__all__ = ["phase1_landscape", "search_clinical_trials"]
