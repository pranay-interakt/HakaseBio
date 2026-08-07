"""The external-evidence panel — one server-owned call per layer.

The retired workspace fired nine independent cross-origin requests from the
browser and assembled the panel client-side. Here the assembly is a backend
concern: the caller names a layer and supplies the identifiers already resolved
upstream, and the panel comes back complete, with every source carrying its own
status so a silent registry is visible rather than invisible.

Layer scoping mirrors what a reviewer needs at each stage:

  target   (Layer 1)  STRING, KEGG, Reactome — what the target does and what it
                      is connected to
  hazard   (Layer 2/3) EPA CCTE human hazard, ECOTOX, ToxCast/Tox21 — measured
                      toxicology for the substance
  clinical (Layer 4)  ClinicalTrials.gov, PharmGKB, DisGeNET, gnomAD — the
                      human-population and clinical-precedent picture

Sources run concurrently and are individually time-boxed; one unreachable
registry never delays or fails the rest of the panel.
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from hakase_smallmol.external import SCHEMA_VERSION
from hakase_smallmol.external.ccte import fetch_ecotox, fetch_toxcast, fetch_toxref
from hakase_smallmol.external.clinical_trials import phase1_landscape, search_clinical_trials
from hakase_smallmol.external.disgenet import fetch_disgenet
from hakase_smallmol.external.gnomad import fetch_gnomad
from hakase_smallmol.external.kegg import fetch_kegg
from hakase_smallmol.external.pharmgkb import fetch_pharmgkb
from hakase_smallmol.external.reactome import fetch_reactome
from hakase_smallmol.external.string_db import fetch_string_interactions

PANELS = ("target", "hazard", "clinical")

# Which sources each panel runs, and which identifier each one needs. Surfaced
# in the response so the UI can explain a skipped source rather than hide it.
PANEL_SOURCES: dict[str, tuple[dict[str, str], ...]] = {
    "target": (
        {"key": "string", "name": "STRING", "requires": "gene_symbol or uniprot_id"},
        {"key": "kegg", "name": "KEGG", "requires": "gene_symbol"},
        {"key": "reactome", "name": "Reactome", "requires": "uniprot_id"},
    ),
    "hazard": (
        {"key": "toxref", "name": "EPA CCTE Hazard (ToxRefDB/ToxValDB)", "requires": "inchikey or compound name"},
        {"key": "ecotox", "name": "EPA ECOTOX", "requires": "inchikey or compound name"},
        {"key": "toxcast", "name": "EPA ToxCast / Tox21", "requires": "inchikey or compound name"},
    ),
    "clinical": (
        {"key": "clinical_trials", "name": "ClinicalTrials.gov", "requires": "gene_symbol, target_protein or therapeutic_area"},
        {"key": "phase1_trials", "name": "ClinicalTrials.gov (Phase 1)", "requires": "gene_symbol, target_protein or therapeutic_area"},
        {"key": "pharmgkb", "name": "PharmGKB", "requires": "gene_symbol"},
        {"key": "disgenet", "name": "DisGeNET", "requires": "gene_symbol"},
        {"key": "gnomad", "name": "gnomAD", "requires": "gene_symbol"},
    ),
}


def _skipped(requirement: str) -> dict[str, Any]:
    return {
        "status": "skipped",
        "reason": f"This source needs {requirement}, which was not resolved upstream.",
        "provenance": "not queried",
    }


def _guarded(fn: Callable[[], dict[str, Any]], source: str) -> dict[str, Any]:
    """Never let one source's unexpected failure take down the panel."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "source": source,
            "reason": f"{type(exc).__name__}: {exc}",
            "provenance": "not retrieved",
        }


def collect_external_panel(
    *,
    panel: str = "target",
    gene_symbol: str | None = None,
    uniprot_id: str | None = None,
    inchikey: str | None = None,
    compound_name: str | None = None,
    casrn: str | None = None,
    therapeutic_area: str | None = None,
    target_protein: str | None = None,
    max_results: int = 25,
) -> dict[str, Any]:
    """Run one layer's external sources concurrently and shape the panel."""
    requested = (panel or "target").strip().lower()
    if requested not in PANELS:
        raise ValueError(
            f"panel must be one of {', '.join(PANELS)}; received {panel!r}."
        )

    gene = (gene_symbol or "").strip() or None
    uniprot = (uniprot_id or "").strip() or None
    key = (inchikey or "").strip() or None
    name = (compound_name or "").strip() or None
    cas = (casrn or "").strip() or None
    area = (therapeutic_area or "").strip() or None
    protein = (target_protein or "").strip() or None

    jobs: dict[str, Callable[[], dict[str, Any]]] = {}

    if requested == "target":
        identifier = gene or uniprot
        jobs["string"] = (
            (lambda: fetch_string_interactions(identifier, limit=max_results))
            if identifier
            else (lambda: _skipped("a gene symbol or UniProt accession"))
        )
        jobs["kegg"] = (
            (lambda: fetch_kegg(gene)) if gene else (lambda: _skipped("a gene symbol"))
        )
        jobs["reactome"] = (
            (lambda: fetch_reactome(uniprot, limit=max_results))
            if uniprot
            else (lambda: _skipped("a UniProt accession"))
        )

    elif requested == "hazard":
        resolvable = bool(key or name or cas)
        jobs["toxref"] = (
            (lambda: fetch_toxref(inchikey=key, name=name, casrn=cas))
            if resolvable
            else (lambda: _skipped("an InChIKey, CAS number or compound name"))
        )
        jobs["ecotox"] = (
            (lambda: fetch_ecotox(inchikey=key, name=name, casrn=cas))
            if resolvable
            else (lambda: _skipped("an InChIKey, CAS number or compound name"))
        )
        jobs["toxcast"] = (
            (lambda: fetch_toxcast(inchikey=key, name=name, casrn=cas, limit=max_results))
            if resolvable
            else (lambda: _skipped("an InChIKey, CAS number or compound name"))
        )

    else:  # clinical
        term = gene or protein or area
        jobs["clinical_trials"] = (
            (lambda: search_clinical_trials(term=term, max_results=max_results))
            if term
            else (lambda: _skipped("a gene symbol, target protein or therapeutic area"))
        )
        jobs["phase1_trials"] = (
            (lambda: phase1_landscape(term=term, max_results=max_results))
            if term
            else (lambda: _skipped("a gene symbol, target protein or therapeutic area"))
        )
        jobs["pharmgkb"] = (
            (lambda: fetch_pharmgkb(gene)) if gene else (lambda: _skipped("a gene symbol"))
        )
        jobs["disgenet"] = (
            (lambda: fetch_disgenet(gene, limit=max_results))
            if gene
            else (lambda: _skipped("a gene symbol"))
        )
        jobs["gnomad"] = (
            (lambda: fetch_gnomad(gene)) if gene else (lambda: _skipped("a gene symbol"))
        )

    with ThreadPoolExecutor(max_workers=len(jobs) or 1) as pool:
        futures = {
            source_key: pool.submit(_guarded, job, source_key)
            for source_key, job in jobs.items()
        }
        sources = {source_key: future.result() for source_key, future in futures.items()}

    live = sorted(k for k, v in sources.items() if v.get("status") == "live")
    empty = sorted(k for k, v in sources.items() if v.get("status") == "no-data")
    skipped = sorted(k for k, v in sources.items() if v.get("status") == "skipped")
    failed = sorted(
        k for k, v in sources.items() if v.get("status") in {"error", "unavailable"}
    )

    return {
        "schema_version": SCHEMA_VERSION,
        "panel": requested,
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.external.panel",
        "identifiers": {
            "gene_symbol": gene,
            "uniprot_id": uniprot,
            "inchikey": key,
            "compound_name": name,
            "casrn": cas,
            "therapeutic_area": area,
            "target_protein": protein,
        },
        "catalogue": list(PANEL_SOURCES[requested]),
        "sources": sources,
        "sources_with_data": live,
        "sources_empty": empty,
        "sources_skipped": skipped,
        "sources_failed": failed,
        "available": bool(live),
        "reason": (
            None
            if live
            else "No external source returned data for the identifiers supplied."
        ),
        "provenance": {
            "owner": "hakase_smallmol.external.panel",
            "client_contract": "display-only",
        },
        "limitations": (
            "Every block is a retrieval from a public database. Absence of a record means the "
            "database holds no curated entry for these identifiers; it is never evidence of "
            "absence of the underlying biology or hazard."
        ),
    }


__all__ = ["PANELS", "PANEL_SOURCES", "collect_external_panel"]
