"""EPA CCTE — ToxRefDB/ToxValDB hazard, ECOTOX, and ToxCast bioactivity.

One chemical resolution (structure → DTXSID) feeds three measured-data
resources published by the EPA Center for Computational Toxicology and
Exposure:

  human hazard   ToxRefDB / ToxValDB in-vivo study values: NOAEL, LOAEL, LD50,
                 by species, route and study type. This is measured animal
                 toxicology — the ground truth an L3 prediction is checked
                 against.
  eco hazard     ECOTOX aquatic and terrestrial endpoints (LC50, EC50, NOEC).
  bioactivity    ToxCast/Tox21 high-throughput in-vitro screening: per-assay
                 hit calls and AC50 values across the ~1 400-assay battery.

Uses the same ``EPA_CCTE_API_KEY`` credential as the existing animal-evidence
adapter. Without a key the CCTE gateway rejects the request, and that is
reported as a configuration state, not as an absence of hazard.
"""

from __future__ import annotations

import os
from typing import Any

import requests

from hakase_smallmol.external._http import (
    DEFAULT_TIMEOUT,
    SourceUnavailable,
    as_float,
    no_data,
    unavailable,
)

CCTE_API = "https://api-ccte.epa.gov"
SOURCE_HAZARD = "EPA CCTE Hazard (ToxRefDB / ToxValDB)"
SOURCE_ECOTOX = "EPA ECOTOX (via CCTE Hazard)"
SOURCE_BIOACTIVITY = "EPA CCTE Bioactivity (ToxCast / Tox21)"
API_KEY_ENV = "EPA_CCTE_API_KEY"

MAMMALIAN_SPECIES = ("rat", "mouse", "rabbit", "dog", "monkey", "hamster", "guinea pig")


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "HakaseAI-BioTwin/2.0"}
    key = (os.environ.get(API_KEY_ENV) or "").strip()
    if key:
        headers["x-api-key"] = key
    return headers


def _ccte_get(path: str, *, timeout: float = DEFAULT_TIMEOUT) -> Any | None:
    try:
        response = requests.get(f"{CCTE_API}{path}", headers=_headers(), timeout=timeout)
    except requests.RequestException as exc:
        raise SourceUnavailable(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code in (401, 403):
        raise SourceUnavailable(
            f"EPA CCTE rejected the request (HTTP {response.status_code}). Set {API_KEY_ENV} "
            "on the service to enable this source."
        )
    if response.status_code != 200:
        raise SourceUnavailable(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceUnavailable(f"Response was not JSON: {exc}") from exc


def _key_configured() -> bool:
    return bool((os.environ.get(API_KEY_ENV) or "").strip())


def _not_configured(source: str) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "source": source,
        "reason": (
            f"The EPA CCTE API requires a key. Set {API_KEY_ENV} on the service to enable this "
            "source."
        ),
        "remediation": (
            "Request a key at https://www.epa.gov/comptox-tools/computational-toxicology-and-"
            f"exposure-apis and set {API_KEY_ENV} in the service environment. Until then no "
            "measured EPA hazard data is shown — an unconfigured source is not a negative result."
        ),
        "provenance": "not queried",
    }


def resolve_dtxsid(
    *, inchikey: str | None = None, name: str | None = None, casrn: str | None = None
) -> dict[str, Any]:
    """Resolve a chemical to its DSSTox substance identifier."""
    if not _key_configured():
        return _not_configured("EPA CCTE Chemical")
    attempts: list[tuple[str, str]] = []
    if inchikey:
        attempts.append(("inchikey", f"/chemical/search/equal/{inchikey.strip()}"))
    if casrn:
        attempts.append(("casrn", f"/chemical/search/equal/{casrn.strip()}"))
    if name:
        attempts.append(("name", f"/chemical/search/equal/{requests.utils.quote(name.strip())}"))
        attempts.append(
            ("name-prefix", f"/chemical/search/start-with/{requests.utils.quote(name.strip())}")
        )
    if not attempts:
        return no_data(
            "EPA CCTE Chemical",
            "No InChIKey, CAS number or preferred name was available to resolve the chemical.",
        )

    last_error: str | None = None
    for how, path in attempts:
        try:
            payload = _ccte_get(path)
        except SourceUnavailable as exc:
            last_error = str(exc)
            continue
        rows = payload if isinstance(payload, list) else ([payload] if payload else [])
        for row in rows:
            if isinstance(row, dict) and row.get("dtxsid"):
                return {
                    "status": "live",
                    "source": "EPA CCTE Chemical",
                    "dtxsid": row.get("dtxsid"),
                    "preferred_name": row.get("preferredName"),
                    "casrn": row.get("casrn"),
                    "resolved_by": how,
                }
    if last_error:
        return unavailable("EPA CCTE Chemical", last_error)
    return no_data(
        "EPA CCTE Chemical",
        "The chemical is not registered in the DSSTox substance registry, so no EPA hazard or "
        "bioactivity record can be retrieved for it.",
    )


def _tox_val_type(raw: Any) -> str:
    value = str(raw or "").upper()
    if "NOAEL" in value or "NOEL" in value:
        return "NOAEL"
    if "LOAEL" in value or "LOEL" in value:
        return "LOAEL"
    if "LD50" in value:
        return "LD50"
    if "LC50" in value:
        return "LC50"
    if "EC50" in value:
        return "EC50"
    if "NOEC" in value:
        return "NOEC"
    return value or "other"


def fetch_toxref(
    *, inchikey: str | None = None, name: str | None = None, casrn: str | None = None
) -> dict[str, Any]:
    """Measured in-vivo mammalian hazard values (ToxRefDB / ToxValDB)."""
    if not _key_configured():
        return _not_configured(SOURCE_HAZARD)
    resolution = resolve_dtxsid(inchikey=inchikey, name=name, casrn=casrn)
    if resolution.get("status") != "live":
        return {**resolution, "source": SOURCE_HAZARD, "records": []}

    dtxsid = resolution["dtxsid"]
    payload: Any = None
    for path in (
        f"/hazard/human/search/by-dtxsid/{dtxsid}",
        f"/hazard/search/by-dtxsid/{dtxsid}",
    ):
        try:
            payload = _ccte_get(path, timeout=30.0)
        except SourceUnavailable as exc:
            payload = None
            last = str(exc)
        else:
            last = None
        if payload:
            break
    if not payload:
        return {
            **no_data(
                SOURCE_HAZARD,
                last
                or "EPA holds no in-vivo mammalian hazard record for this substance.",
            ),
            "dtxsid": dtxsid,
            "preferred_name": resolution.get("preferred_name"),
            "records": [],
        }

    records: list[dict[str, Any]] = []
    for row in payload if isinstance(payload, list) else []:
        value = as_float(row.get("toxvalNumeric") or row.get("toxval_numeric") or row.get("value"))
        if value is None or value <= 0:
            continue
        species_raw = str(row.get("species") or "").lower()
        species = next((s for s in MAMMALIAN_SPECIES if s in species_raw), None)
        if not species:
            continue
        records.append(
            {
                "study_type": row.get("studyType") or row.get("study_type"),
                "species": species,
                "tox_val_type": _tox_val_type(row.get("toxvalType") or row.get("toxval_type")),
                "value_mg_kg_day": value,
                "units": row.get("toxvalUnits") or row.get("toxval_units") or "mg/kg/day",
                "exposure_route": row.get("exposureRoute") or row.get("exposure_route"),
                "study_duration": row.get("studyDuration") or row.get("study_duration_value"),
                "study_duration_units": row.get("studyDurationUnits")
                or row.get("study_duration_units"),
                "critical_effect": row.get("criticalEffect") or row.get("critical_effect"),
                "source": row.get("source"),
            }
        )

    noaels = [r["value_mg_kg_day"] for r in records if r["tox_val_type"] == "NOAEL"]
    loaels = [r["value_mg_kg_day"] for r in records if r["tox_val_type"] == "LOAEL"]
    ld50s = [r["value_mg_kg_day"] for r in records if r["tox_val_type"] == "LD50"]
    species_covered = sorted({r["species"] for r in records})

    return {
        "status": "live" if records else "no-data",
        "source": SOURCE_HAZARD,
        "dtxsid": dtxsid,
        "preferred_name": resolution.get("preferred_name"),
        "casrn": resolution.get("casrn"),
        "records": records,
        "n_records": len(records),
        "most_conservative_noael_mg_kg_day": min(noaels) if noaels else None,
        "most_conservative_loael_mg_kg_day": min(loaels) if loaels else None,
        "lowest_ld50_mg_kg": min(ld50s) if ld50s else None,
        "species_covered": species_covered,
        "reason": (
            None
            if records
            else "The substance is registered but carries no mammalian in-vivo hazard value."
        ),
        "url": f"https://comptox.epa.gov/dashboard/chemical/details/{dtxsid}",
        "limitations": (
            "These are values other laboratories measured for this substance, often in an "
            "environmental or occupational context rather than a pharmaceutical one. Study "
            "design, purity and route may differ from the intended clinical programme."
        ),
        "provenance": "measured (public regulatory datasets)",
    }


def fetch_ecotox(
    *, inchikey: str | None = None, name: str | None = None, casrn: str | None = None
) -> dict[str, Any]:
    """ECOTOX environmental toxicology endpoints for the substance."""
    if not _key_configured():
        return _not_configured(SOURCE_ECOTOX)
    resolution = resolve_dtxsid(inchikey=inchikey, name=name, casrn=casrn)
    if resolution.get("status") != "live":
        return {**resolution, "source": SOURCE_ECOTOX, "studies": []}

    dtxsid = resolution["dtxsid"]
    try:
        payload = _ccte_get(f"/hazard/eco/search/by-dtxsid/{dtxsid}", timeout=30.0)
    except SourceUnavailable as exc:
        return {
            **unavailable(SOURCE_ECOTOX, str(exc)),
            "dtxsid": dtxsid,
            "studies": [],
        }
    if not payload:
        return {
            **no_data(SOURCE_ECOTOX, "ECOTOX holds no ecotoxicology record for this substance."),
            "dtxsid": dtxsid,
            "preferred_name": resolution.get("preferred_name"),
            "studies": [],
        }

    studies: list[dict[str, Any]] = []
    for row in payload if isinstance(payload, list) else []:
        value = as_float(row.get("toxvalNumeric") or row.get("toxval_numeric") or row.get("value"))
        if value is None or value <= 0:
            continue
        studies.append(
            {
                "species": row.get("speciesCommon")
                or row.get("species")
                or row.get("speciesScientific"),
                "species_scientific": row.get("speciesScientific"),
                "endpoint": _tox_val_type(row.get("toxvalType") or row.get("toxval_type")),
                "raw_endpoint": row.get("toxvalType") or row.get("toxval_type"),
                "value": value,
                "units": row.get("toxvalUnits") or row.get("toxval_units"),
                "duration": row.get("studyDuration") or row.get("study_duration_value"),
                "duration_units": row.get("studyDurationUnits") or row.get("study_duration_units"),
                "exposure_route": row.get("exposureRoute") or row.get("exposure_route"),
                "effect": row.get("effect") or row.get("criticalEffect"),
                "reference": row.get("longRef") or row.get("source"),
            }
        )

    noec = [s["value"] for s in studies if s["endpoint"] in {"NOEC", "NOAEL"}]
    lc50 = [s["value"] for s in studies if s["endpoint"] in {"LC50", "EC50"}]

    return {
        "status": "live" if studies else "no-data",
        "source": SOURCE_ECOTOX,
        "dtxsid": dtxsid,
        "preferred_name": resolution.get("preferred_name"),
        "studies": studies,
        "n_studies": len(studies),
        "lowest_noec": min(noec) if noec else None,
        "lowest_lc50_ec50": min(lc50) if lc50 else None,
        "species_covered": sorted({s["species"] for s in studies if s["species"]}),
        "reason": (
            None if studies else "The substance is registered but carries no ECOTOX endpoint."
        ),
        "url": "https://cfpub.epa.gov/ecotox/",
        "limitations": (
            "Environmental toxicology in non-mammalian species. It informs the environmental "
            "risk assessment a marketing application needs; it is not a human safety endpoint "
            "and must not be read as one."
        ),
        "provenance": "measured (public regulatory dataset)",
    }


def fetch_toxcast(
    *,
    inchikey: str | None = None,
    name: str | None = None,
    casrn: str | None = None,
    limit: int = 60,
) -> dict[str, Any]:
    """ToxCast/Tox21 high-throughput in-vitro screening results."""
    if not _key_configured():
        return _not_configured(SOURCE_BIOACTIVITY)
    resolution = resolve_dtxsid(inchikey=inchikey, name=name, casrn=casrn)
    if resolution.get("status") != "live":
        return {**resolution, "source": SOURCE_BIOACTIVITY, "assay_hits": []}

    dtxsid = resolution["dtxsid"]
    try:
        payload = _ccte_get(f"/bioactivity/data/search/by-dtxsid/{dtxsid}", timeout=45.0)
    except SourceUnavailable as exc:
        return {
            **unavailable(SOURCE_BIOACTIVITY, str(exc)),
            "dtxsid": dtxsid,
            "assay_hits": [],
        }
    if not payload:
        return {
            **no_data(
                SOURCE_BIOACTIVITY,
                "The substance has not been screened in the ToxCast/Tox21 battery.",
            ),
            "dtxsid": dtxsid,
            "preferred_name": resolution.get("preferred_name"),
            "assay_hits": [],
        }

    rows = payload if isinstance(payload, list) else []
    parsed: list[dict[str, Any]] = []
    for row in rows:
        hit_call = row.get("hitc")
        if hit_call is None:
            hit_call = row.get("hitCall")
        active = None
        numeric_hit = as_float(hit_call)
        if numeric_hit is not None:
            # Newer ToxCast releases report a continuous hit-call probability.
            active = numeric_hit >= 0.9 if numeric_hit <= 1.0 else numeric_hit == 1.0
        parsed.append(
            {
                "assay_name": row.get("assayName") or row.get("aenm") or row.get("aeid"),
                "assay_source": row.get("assaySourceName") or row.get("asid"),
                "gene": row.get("geneSymbol") or row.get("gene"),
                "ac50_uM": as_float(row.get("ac50")),
                "hit_call_raw": hit_call,
                "active": active,
                "top_response": as_float(row.get("top")),
                "cytotoxicity_flag": row.get("cytotox"),
            }
        )

    scored = [p for p in parsed if p["active"] is not None]
    actives = [p for p in scored if p["active"]]
    actives.sort(key=lambda p: (p["ac50_uM"] if p["ac50_uM"] is not None else float("inf")))
    shown = (actives + [p for p in scored if not p["active"]])[:limit]

    return {
        "status": "live",
        "source": SOURCE_BIOACTIVITY,
        "dtxsid": dtxsid,
        "preferred_name": resolution.get("preferred_name"),
        "casrn": resolution.get("casrn"),
        "assay_hits": shown,
        "n_assays_screened": len(scored),
        "n_active": len(actives),
        "hit_rate": round(len(actives) / len(scored), 4) if scored else None,
        "most_potent_active": actives[0] if actives and actives[0]["ac50_uM"] else None,
        "url": f"https://comptox.epa.gov/dashboard/chemical/invitrodb/{dtxsid}",
        "limitations": (
            "ToxCast is an in-vitro screening battery run at concentrations that frequently "
            "exceed clinically achievable exposure. A hit is a bioactivity observation, not a "
            "hazard determination, and cytotoxicity-driven hits are a known confounder — read "
            "the AC50 against the projected free plasma concentration before acting on it."
        ),
        "provenance": "measured (public high-throughput screening)",
    }


__all__ = [
    "API_KEY_ENV",
    "fetch_ecotox",
    "fetch_toxcast",
    "fetch_toxref",
    "resolve_dtxsid",
]
