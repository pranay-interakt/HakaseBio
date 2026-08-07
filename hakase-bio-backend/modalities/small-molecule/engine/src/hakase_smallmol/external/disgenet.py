"""DisGeNET — gene–disease associations for the resolved target.

DisGeNET (https://disgenet.com) aggregates curated and text-mined gene–disease
associations. Since v2023 the REST API requires an API key, supplied through
``DISGENET_API_KEY``. Without it the module reports the source as gated rather
than silently degrading — a missing key is a configuration fact, not evidence.

The association score is DisGeNET's own (0–1, evidence-weighted). It is carried
through verbatim; nothing is rescaled or re-ranked here.
"""

from __future__ import annotations

import os
from typing import Any

from hakase_smallmol.external._http import (
    DEFAULT_TIMEOUT,
    SourceUnavailable,
    as_float,
    no_data,
    unavailable,
)

DISGENET_API = "https://api.disgenet.com/api/v1"
SOURCE = "DisGeNET (api.disgenet.com)"
API_KEY_ENV = "DISGENET_API_KEY"


def _authorised_get(path: str, params: dict[str, Any], api_key: str) -> Any:
    import requests

    try:
        response = requests.get(
            f"{DISGENET_API}{path}",
            params=params,
            headers={
                "Authorization": api_key,
                "Accept": "application/json",
                "User-Agent": "HakaseAI-BioTwin/2.0",
            },
            timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SourceUnavailable(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code in (401, 403):
        raise SourceUnavailable(
            "DisGeNET rejected the credentials (HTTP "
            f"{response.status_code}). Check the {API_KEY_ENV} value."
        )
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise SourceUnavailable(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceUnavailable(f"Response was not JSON: {exc}") from exc


def fetch_disgenet(gene_symbol: str, *, limit: int = 20) -> dict[str, Any]:
    """Ranked gene–disease associations for one gene symbol."""
    symbol = (gene_symbol or "").strip().upper()
    if not symbol:
        return no_data(SOURCE, "No gene symbol was resolved upstream, so DisGeNET cannot be queried.")

    api_key = (os.environ.get(API_KEY_ENV) or "").strip()
    if not api_key:
        return {
            "status": "unavailable",
            "source": SOURCE,
            "gene_symbol": symbol,
            "reason": (
                "DisGeNET requires an API key. Set the "
                f"{API_KEY_ENV} environment variable on the service to enable this source."
            ),
            "remediation": (
                "Register at https://disgenet.com/, then set "
                f"{API_KEY_ENV} in the service environment. No gene–disease evidence is shown "
                "until it is configured — an unconfigured source is never treated as a negative "
                "result."
            ),
            "provenance": "not queried",
        }

    try:
        payload = _authorised_get(
            "/gda/summary",
            {"gene_symbol": symbol, "page_number": 0, "order_by": "score"},
            api_key,
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), gene_symbol=symbol)

    rows = ((payload or {}).get("payload") or []) if isinstance(payload, dict) else (payload or [])
    if not rows:
        return no_data(
            SOURCE,
            f"DisGeNET returned no gene–disease association for {symbol!r}.",
            gene_symbol=symbol,
        )

    diseases: list[dict[str, Any]] = []
    for row in rows[:limit]:
        diseases.append(
            {
                "disease_id": row.get("diseaseUMLSCUI") or row.get("diseaseid"),
                "disease_name": row.get("diseaseName") or row.get("disease_name"),
                "disease_type": row.get("diseaseType") or row.get("diseasetype"),
                "score": as_float(row.get("score")),
                "evidence_index": as_float(row.get("ei") or row.get("EI")),
                "n_genes": row.get("numberOfGenes") or row.get("Ngenes"),
                "n_variants": row.get("numberOfVariants") or row.get("Nvariants"),
                "n_publications": row.get("numPMIDs") or row.get("NofPmids"),
                "disease_classes": row.get("diseaseClasses_MSH") or row.get("diseaseClasses"),
            }
        )

    first = rows[0] if isinstance(rows[0], dict) else {}
    scored = [d for d in diseases if d["score"] is not None]
    types = [d["disease_type"] for d in diseases if d["disease_type"]]
    top_type = max(set(types), key=types.count) if types else None

    return {
        "status": "live",
        "source": SOURCE,
        "gene_symbol": symbol,
        "gene_id": first.get("geneNcbiID") or first.get("geneid"),
        "diseases": diseases,
        "n_diseases": len(diseases),
        "disease_specificity_index": as_float(first.get("geneDSI") or first.get("DSI")),
        "disease_pleiotropy_index": as_float(first.get("geneDPI") or first.get("DPI")),
        "top_disease_class": top_type,
        "strongest_association": (
            max(scored, key=lambda d: d["score"])["disease_name"] if scored else None
        ),
        "url": f"https://disgenet.com/search?view=GENES&idents={symbol}",
        "limitations": (
            "Associations mix expert curation with text mining, so a high score reflects "
            "literature weight rather than causal proof. The Disease Pleiotropy Index is a "
            "target-liability signal: a highly pleiotropic gene raises the prior for "
            "on-target off-tissue effects."
        ),
        "provenance": "measured (curated + text-mined public knowledge base)",
    }


__all__ = ["API_KEY_ENV", "fetch_disgenet"]
