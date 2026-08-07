"""Reactome — curated reaction-level pathway membership for the target.

Reactome (https://reactome.org) is a peer-reviewed, reaction-level pathway
database. Where KEGG gives a coarse map, Reactome gives the individual
reactions a protein catalyses or participates in, each traceable to its
literature reference.

The top-level classification below is Reactome's own hierarchy, obtained by
walking each pathway's ancestor chain — not a keyword guess at the pathway name.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import SourceUnavailable, get_json, no_data, unavailable

REACTOME_API = "https://reactome.org/ContentService"
SOURCE = "Reactome (reactome.org)"
SPECIES = "Homo sapiens"


def _top_level(pathway_ids: list[str], *, cap: int = 12) -> list[str]:
    """Resolve each pathway to its Reactome top-level event via the ancestor API."""
    seen: list[str] = []
    for st_id in pathway_ids[:cap]:
        try:
            ancestors = get_json(f"{REACTOME_API}/data/event/{st_id}/ancestors")
        except SourceUnavailable:
            continue
        if not ancestors:
            continue
        # The API returns a list of ancestor chains, each ordered root-first.
        for chain in ancestors:
            if not isinstance(chain, list) or not chain:
                continue
            root = chain[0] or {}
            name = root.get("displayName")
            if name and name not in seen:
                seen.append(name)
    return seen


def fetch_reactome(uniprot_id: str, *, limit: int = 25) -> dict[str, Any]:
    """Pathways and reactions containing the given UniProt accession."""
    accession = (uniprot_id or "").strip().upper()
    if not accession:
        return no_data(
            SOURCE, "No UniProt accession was resolved upstream, so Reactome cannot be queried."
        )

    try:
        pathways = get_json(
            f"{REACTOME_API}/data/mapping/UniProt/{accession}/pathways",
            params={"species": SPECIES},
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), uniprot_id=accession)
    if not pathways:
        return no_data(
            SOURCE,
            f"Reactome has no human pathway containing {accession}.",
            uniprot_id=accession,
        )

    rows = [
        {
            "st_id": p.get("stId"),
            "name": p.get("displayName"),
            "species": (p.get("speciesName") or SPECIES),
            "is_inferred": bool(p.get("isInferred")),
            "schema_class": p.get("schemaClass"),
            "url": f"https://reactome.org/PathwayBrowser/#/{p.get('stId')}" if p.get("stId") else None,
        }
        for p in pathways
        if isinstance(p, dict)
    ][:limit]

    reactions: list[dict[str, Any]] = []
    reaction_error: str | None = None
    try:
        raw = get_json(
            f"{REACTOME_API}/data/mapping/UniProt/{accession}/reactions",
            params={"species": SPECIES},
        )
        reactions = [
            {"st_id": r.get("stId"), "name": r.get("displayName")}
            for r in (raw or [])
            if isinstance(r, dict)
        ]
    except SourceUnavailable as exc:
        reaction_error = str(exc)

    return {
        "status": "live",
        "source": SOURCE,
        "uniprot_id": accession,
        "pathways": rows,
        "n_pathways_returned": len(rows),
        "n_pathways_total": len(pathways),
        "top_level_processes": _top_level([r["st_id"] for r in rows if r["st_id"]]),
        "reactions": reactions[:limit],
        "n_reactions": len(reactions),
        "reactions_error": reaction_error,
        "url": f"https://reactome.org/content/query?q={accession}",
        "limitations": (
            "Reactome curates human biology to reaction granularity but is not exhaustive; "
            "absence of a pathway means absence of curation, not absence of function. Inferred "
            "events (flagged per row) are projected from other species by orthology."
        ),
        "provenance": "measured (peer-reviewed curated pathway database)",
    }


__all__ = ["fetch_reactome"]
