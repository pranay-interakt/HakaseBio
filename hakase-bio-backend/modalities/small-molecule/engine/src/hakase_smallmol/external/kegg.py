"""KEGG — pathway, disease and drug context for the target gene.

KEGG's REST interface (https://rest.kegg.jp) serves flat files, not JSON, so
this module parses the entry format directly. Three sections of a gene entry
matter here:

  PATHWAY   the curated pathways the gene participates in — the biology a
            perturbation propagates through
  DISEASE   KEGG DISEASE entries the gene is implicated in
  DRUG      KEGG DRUG entries annotated against the gene, i.e. existing
            pharmacology on the same target

Everything returned is a KEGG annotation; nothing is inferred.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import SourceUnavailable, get_text, no_data, unavailable

KEGG_REST = "https://rest.kegg.jp"
SOURCE = "KEGG (rest.kegg.jp)"
DEFAULT_ORGANISM = "hsa"  # Homo sapiens


def _entry_section(entry: str, header: str) -> list[str]:
    """Collect a KEGG entry section, including its continuation lines."""
    lines: list[str] = []
    inside = False
    for line in entry.splitlines():
        if line.startswith(header):
            inside = True
            remainder = line[len(header) :].strip()
            if remainder:
                lines.append(remainder)
        elif inside and line.startswith(" "):
            stripped = line.strip()
            if stripped:
                lines.append(stripped)
        elif inside:
            break
    return lines


def _split_id_name(line: str) -> dict[str, str]:
    parts = line.split(None, 1)
    if len(parts) == 2:
        return {"id": parts[0].strip(), "name": parts[1].strip()}
    return {"id": line.strip(), "name": line.strip()}


def _find_gene(gene_symbol: str, organism: str) -> tuple[str | None, str | None]:
    """Resolve a gene symbol to a KEGG gene id such as ``hsa:207``."""
    text = get_text(f"{KEGG_REST}/find/{organism}/{gene_symbol}")
    if not text:
        return None, None
    symbol_lower = gene_symbol.lower()
    fallback: tuple[str, str] | None = None
    for line in text.strip().splitlines():
        if not line.strip():
            continue
        entry_id, _, description = line.partition("\t")
        entry_id = entry_id.strip()
        description = description.strip()
        # KEGG lists symbols first, comma-separated, before the description.
        symbols = [s.strip().lower() for s in description.split(";")[0].split(",")]
        if symbol_lower in symbols:
            return entry_id, description
        if fallback is None:
            fallback = (entry_id, description)
    return fallback if fallback else (None, None)


def fetch_kegg(gene_symbol: str, *, organism: str = DEFAULT_ORGANISM) -> dict[str, Any]:
    """Pathways, diseases and annotated drugs for one gene."""
    symbol = (gene_symbol or "").strip()
    if not symbol:
        return no_data(SOURCE, "No gene symbol was resolved upstream, so KEGG cannot be queried.")

    try:
        gene_id, description = _find_gene(symbol, organism)
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), gene_symbol=symbol)
    if not gene_id:
        return no_data(SOURCE, f"KEGG has no {organism} gene entry for {symbol!r}.", gene_symbol=symbol)

    try:
        entry = get_text(f"{KEGG_REST}/get/{gene_id}")
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), gene_symbol=symbol, gene_id=gene_id)
    if not entry:
        return no_data(
            SOURCE, f"KEGG returned no entry body for {gene_id}.", gene_symbol=symbol, gene_id=gene_id
        )

    pathways = [
        {**_split_id_name(line), "category": "KEGG pathway"}
        for line in _entry_section(entry, "PATHWAY")
    ]
    diseases = [_split_id_name(line) for line in _entry_section(entry, "DISEASE")]
    drugs = [_split_id_name(line) for line in _entry_section(entry, "DRUG")]
    modules = [_split_id_name(line) for line in _entry_section(entry, "MODULE")]
    brite = _entry_section(entry, "BRITE")

    return {
        "status": "live",
        "source": SOURCE,
        "gene_symbol": symbol,
        "gene_id": gene_id,
        "description": description,
        "pathways": pathways,
        "n_pathways": len(pathways),
        "diseases": diseases,
        "n_diseases": len(diseases),
        "drugs": drugs,
        "n_drugs": len(drugs),
        "modules": modules,
        "brite_classification": brite[:6],
        "connectivity": (
            "high" if len(pathways) > 5 else "moderate" if len(pathways) > 2 else "low"
        ),
        "url": f"https://www.kegg.jp/entry/{gene_id}",
        "interpretation": (
            f"{symbol} is annotated to {len(pathways)} KEGG pathway(s), "
            f"{len(diseases)} disease entry/entries and {len(drugs)} drug entry/entries. "
            + (
                "Existing KEGG DRUG annotations indicate the target is already pharmacologically "
                "addressed."
                if drugs
                else "No KEGG DRUG entry is annotated against this gene."
            )
        ),
        "limitations": (
            "KEGG annotation coverage is curator-driven and uneven across gene families. "
            "Pathway breadth is a connectivity signal, not a polypharmacology prediction."
        ),
        "provenance": "measured (curated public knowledge base)",
    }


__all__ = ["DEFAULT_ORGANISM", "fetch_kegg"]
