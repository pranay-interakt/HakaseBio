"""STRING — the functional interaction neighbourhood of the target.

A target does not act alone. STRING (https://string-db.org) aggregates
experimental, database, co-expression and text-mining evidence into a combined
confidence score (0–1000) per protein pair. For a drug programme the useful
reading is the *high-confidence experimental* neighbourhood: those partners are
the proteins whose function is most likely perturbed downstream of the target,
which is where an unexplained in-vivo finding usually traces back to.

Scores are STRING's own and are carried through unchanged.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import (
    SourceUnavailable,
    get_json,
    no_data,
    unavailable,
)

STRING_API = "https://string-db.org/api/json"
SOURCE = "STRING (string-db.org)"
HUMAN_TAXON = 9606

# STRING's own confidence bands.
HIGH_CONFIDENCE = 700
HIGHEST_CONFIDENCE = 900


def _channel(value: Any) -> float | None:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


def fetch_string_interactions(
    identifier: str, *, min_score: int = HIGH_CONFIDENCE, limit: int = 25
) -> dict[str, Any]:
    """High-confidence functional partners of a gene symbol or UniProt accession."""
    query = (identifier or "").strip()
    if not query:
        return no_data(SOURCE, "No gene symbol or accession was resolved upstream.")

    try:
        resolved = get_json(
            f"{STRING_API}/get_string_ids",
            params={"identifiers": query, "species": HUMAN_TAXON, "limit": 1, "caller_identity": "hakase.ai"},
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), query=query)
    if not resolved:
        return no_data(SOURCE, f"STRING could not map {query!r} to a human protein.", query=query)

    first = resolved[0] if isinstance(resolved, list) and resolved else {}
    string_id = first.get("stringId")
    preferred = first.get("preferredName") or query
    if not string_id:
        return no_data(SOURCE, f"STRING could not map {query!r} to a human protein.", query=query)

    try:
        partners = get_json(
            f"{STRING_API}/interaction_partners",
            params={
                "identifiers": string_id,
                "species": HUMAN_TAXON,
                "limit": limit,
                "required_score": min_score,
                "caller_identity": "hakase.ai",
            },
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), query=query, gene_symbol=preferred)

    rows: list[dict[str, Any]] = []
    for row in partners or []:
        combined = _channel(row.get("score"))
        rows.append(
            {
                "partner": row.get("preferredName_B") or row.get("stringId_B"),
                "string_id": row.get("stringId_B"),
                "combined_score": round(combined * 1000) if combined is not None and combined <= 1 else combined,
                "experimental": _channel(row.get("escore")),
                "database": _channel(row.get("dscore")),
                "text_mining": _channel(row.get("tscore")),
                "coexpression": _channel(row.get("ascore")),
                "neighbourhood": _channel(row.get("nscore")),
                "gene_fusion": _channel(row.get("fscore")),
            }
        )
    for row in rows:
        experimental = row["experimental"] or 0.0
        database = row["database"] or 0.0
        text = row["text_mining"] or 0.0
        row["dominant_evidence"] = (
            "Experimental"
            if experimental >= 0.5
            else "Curated database"
            if database >= 0.5
            else "Literature (text-mined)"
            if text >= 0.5
            else "Predicted (genomic context / co-expression)"
        )
    rows.sort(key=lambda r: (r["combined_score"] or 0), reverse=True)

    if not rows:
        return no_data(
            SOURCE,
            f"No partner of {preferred} reached the {min_score} confidence threshold.",
            query=query,
            gene_symbol=preferred,
        )

    experimental_partners = [r for r in rows if (r["experimental"] or 0.0) >= 0.5]
    return {
        "status": "live",
        "source": SOURCE,
        "query": query,
        "gene_symbol": preferred,
        "string_id": string_id,
        "min_combined_score": min_score,
        "interactions": rows,
        "n_partners": len(rows),
        "n_experimentally_supported": len(experimental_partners),
        "hub_degree": len(rows),
        "url": f"https://string-db.org/network/{string_id}",
        "interpretation": (
            f"{len(rows)} functional partner(s) at or above STRING confidence {min_score}; "
            f"{len(experimental_partners)} carry direct experimental support."
        ),
        "limitations": (
            "A functional-association network, not a physical-complex map. Text-mining "
            "contributes to the combined score, so a high score can reflect co-citation rather "
            "than interaction — read the per-channel scores, not just the combined one."
        ),
        "provenance": "measured + text-mined (public interaction database)",
    }


__all__ = ["HIGHEST_CONFIDENCE", "HIGH_CONFIDENCE", "fetch_string_interactions"]
