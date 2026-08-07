"""PharmGKB — curated pharmacogenomics for a target or metabolising gene.

PharmGKB (https://www.pharmgkb.org) publishes clinical annotations linking
variants to drug response, each graded on the PharmGKB level-of-evidence scale
(1A strongest → 4 weakest), plus dosing guidelines from CPIC/DPWG.

What this returns is a retrieval, not a prediction: annotation level maps
directly onto the actionability label, and a gene with no annotation is
reported as unannotated rather than as "no pharmacogenomic risk".
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import (
    SourceUnavailable,
    get_json,
    no_data,
    unavailable,
)

PHARMGKB_API = "https://api.pharmgkb.org/v1"
SOURCE = "PharmGKB (api.pharmgkb.org)"

# PharmGKB level of evidence → the actionability language a reviewer uses.
_SIGNIFICANCE = {
    "1A": "Actionable",
    "1B": "Actionable",
    "2A": "Informative",
    "2B": "Informative",
    "3": "Uncertain",
    "4": "Uncertain",
}

# The pharmacogene panel with dosing consequences a Phase-1 protocol cares about.
PHARMACOGENES = (
    "CYP1A2",
    "CYP2B6",
    "CYP2C9",
    "CYP2C19",
    "CYP2D6",
    "CYP3A4",
    "CYP3A5",
    "CYP2E1",
    "UGT1A1",
    "NAT2",
    "TPMT",
    "DPYD",
    "SLCO1B1",
    "ABCB1",
    "G6PD",
    "VKORC1",
)


def _annotation_row(record: dict[str, Any], gene_symbol: str) -> dict[str, Any]:
    level = str(record.get("levelOfEvidence") or record.get("level") or "").strip() or None
    variant = record.get("variant") or {}
    haplotypes = record.get("haplotypes") or []
    phenotypes = record.get("phenotypes") or []
    categories = record.get("phenotypeCategories") or []
    return {
        "id": record.get("id"),
        "name": (
            variant.get("symbol")
            or variant.get("name")
            or (haplotypes[0] or {}).get("symbol")
            or (haplotypes[0] or {}).get("name")
        ),
        "gene": gene_symbol,
        "level_of_evidence": level,
        "significance": _SIGNIFICANCE.get(level or "", "Uncertain"),
        "phenotype": (
            (phenotypes[0] or {}).get("name")
            if phenotypes
            else ((categories[0] or {}).get("term") if categories else None)
        ),
        "phenotype_categories": [c.get("term") for c in categories if c.get("term")],
        "chemicals": [c.get("name") for c in (record.get("chemicals") or []) if c.get("name")],
    }


def fetch_pharmgkb(gene_symbol: str, *, limit: int = 12) -> dict[str, Any]:
    """Clinical annotations, guidelines and label annotations for one gene."""
    symbol = (gene_symbol or "").strip().upper()
    if not symbol:
        return no_data(SOURCE, "No gene symbol was resolved upstream, so PharmGKB cannot be queried.")

    try:
        gene_payload = get_json(
            f"{PHARMGKB_API}/data/gene", params={"symbol": symbol, "view": "base"}
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), gene_symbol=symbol)

    genes = (gene_payload or {}).get("data") or []
    if not genes:
        return no_data(
            SOURCE,
            f"PharmGKB has no gene record for {symbol!r}.",
            gene_symbol=symbol,
        )
    gene = genes[0]
    gene_id = gene.get("id")

    annotations: list[dict[str, Any]] = []
    guidelines: list[dict[str, Any]] = []
    label_annotations: list[dict[str, Any]] = []
    partial: list[str] = []

    try:
        payload = get_json(
            f"{PHARMGKB_API}/data/clinicalAnnotation",
            params={"location.genes.accessionId": gene_id, "view": "base"},
        )
        annotations = [
            _annotation_row(row, symbol) for row in ((payload or {}).get("data") or [])[:limit]
        ]
    except SourceUnavailable as exc:
        partial.append(f"clinical annotations unavailable ({exc})")

    try:
        payload = get_json(
            f"{PHARMGKB_API}/data/guidelineAnnotation",
            params={"relatedGenes.accessionId": gene_id, "view": "base"},
        )
        guidelines = [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "source": row.get("source"),
                "recommendation": row.get("recommendation"),
                "chemicals": [
                    c.get("name") for c in (row.get("relatedChemicals") or []) if c.get("name")
                ],
            }
            for row in ((payload or {}).get("data") or [])[:limit]
        ]
    except SourceUnavailable as exc:
        partial.append(f"dosing guidelines unavailable ({exc})")

    try:
        payload = get_json(
            f"{PHARMGKB_API}/data/labelAnnotation",
            params={"relatedGenes.accessionId": gene_id, "view": "base"},
        )
        label_annotations = [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "source": row.get("source"),
                "testing_level": row.get("testingLevel"),
            }
            for row in ((payload or {}).get("data") or [])[:limit]
        ]
    except SourceUnavailable as exc:
        partial.append(f"drug-label annotations unavailable ({exc})")

    actionable = [a for a in annotations if a["significance"] == "Actionable"]
    is_pharmacogene = symbol in PHARMACOGENES

    return {
        "status": "live",
        "source": SOURCE,
        "gene_symbol": gene.get("symbol") or symbol,
        "gene_id": gene_id,
        "gene_name": gene.get("name"),
        "is_established_pharmacogene": is_pharmacogene,
        "variants": annotations,
        "n_variants": len(annotations),
        "n_actionable": len(actionable),
        "guidelines": guidelines,
        "n_guidelines": len(guidelines),
        "label_annotations": label_annotations,
        "partial_failures": partial,
        "url": f"https://www.pharmgkb.org/gene/{gene_id}" if gene_id else "https://www.pharmgkb.org",
        "interpretation": (
            f"{len(actionable)} annotation(s) reach PharmGKB level 1A/1B (actionable) for "
            f"{symbol}."
            if actionable
            else (
                f"{symbol} is an established pharmacogene but no level 1 clinical annotation "
                "was returned for it."
                if is_pharmacogene
                else f"No level 1 clinical annotation was returned for {symbol}."
            )
        ),
        "limitations": (
            "PharmGKB curates published evidence. Absence of an annotation reflects absence of "
            "curated literature, not absence of a pharmacogenomic effect. Level assignments are "
            "PharmGKB's own and are not a regulatory determination."
        ),
        "provenance": "measured (curated public knowledge base)",
    }


__all__ = ["PHARMACOGENES", "fetch_pharmgkb"]
