"""Public animal-evidence lookups (live, structure/name-keyed, no fabrication).

Composes real open data sources for the *Public Animal Evidence* output and to
feed the safety engine an evidence-based NOAEL/LD50 anchor:

  • EPA CCTE Hazard   — measured in-vivo NOAEL/LOAEL by species (ToxRefDB-backed)
  • ChEMBL            — analogue in-vivo PK (CL, Vd, t½, F) at 70% similarity
  • PubChem           — rodent acute LD50
  • PK-DB             — curated experimental PK parameters

The async adapters are the validated ones from the retired ``animal_sim``
prototype; here they are the canonical evidence source (the prototype's
heuristic ``SPECIES_LIBRARY`` simulation is NOT reused). Every source reports
its own status (``live`` / ``no-data`` / ``error``); nothing is invented when a
source is silent — the block simply reports "no public evidence located".
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

# Reuse the validated live adapters (structure/name-keyed REST clients).
from hakase_smallmol.pk_ivive.animal_sim import (
    query_ccte_hazard,
    query_chembl_pk,
    query_pkdb_data,
    query_pubchem_toxicology,
)


async def _resolve_name_from_smiles(smiles: str) -> str | None:
    """Best-effort compound name for name-keyed sources (CCTE, PK-DB).

    SMILES → PubChem CID → first synonym. Returns None on any failure (the
    name-keyed lookups then simply return 'unresolved' — never a guess).
    """
    if not smiles:
        return None
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r_cid = await client.get(
                f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/{smiles}/cids/JSON"
            )
            if r_cid.status_code != 200:
                return None
            cids = (r_cid.json().get("IdentifierList") or {}).get("CID") or []
            if not cids:
                return None
            cid = cids[0]
            r_syn = await client.get(
                f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON"
            )
            if r_syn.status_code != 200:
                return None
            info = (r_syn.json().get("InformationList") or {}).get("Information") or [{}]
            synonyms = info[0].get("Synonym") or []
            return synonyms[0] if synonyms else None
        except Exception:  # noqa: BLE001
            return None


async def _gather_evidence(smiles: str, compound_name: str | None) -> dict[str, Any]:
    name = compound_name or await _resolve_name_from_smiles(smiles)
    ccte_task = query_ccte_hazard(name or "")
    chembl_task = query_chembl_pk(smiles)
    pubchem_task = query_pubchem_toxicology(smiles)
    pkdb_task = query_pkdb_data(name or "")
    ccte, chembl, pubchem, pkdb = await asyncio.gather(
        ccte_task, chembl_task, pubchem_task, pkdb_task, return_exceptions=True
    )

    def _safe(x: Any) -> Any:
        return x if not isinstance(x, Exception) else {"status": "error", "error": str(x)}

    return {
        "resolved_name": name,
        "ccte_hazard": _safe(ccte),
        "chembl_pk": _safe(chembl),
        "pubchem_tox": _safe(pubchem),
        "pkdb": _safe(pkdb),
    }


def collect_evidence(smiles: str, compound_name: str | None = None) -> dict[str, Any]:
    """Synchronous entry: run all evidence lookups and structure the result.

    Returns the *Public Animal Evidence* block, plus a distilled
    ``noael_anchor`` / ``ld50_anchor`` the safety engine consumes.
    """
    try:
        raw = asyncio.run(_gather_evidence(smiles, compound_name))
    except RuntimeError:
        # Already inside an event loop (e.g. some test harnesses): use a fresh loop.
        loop = asyncio.new_event_loop()
        try:
            raw = loop.run_until_complete(_gather_evidence(smiles, compound_name))
        finally:
            loop.close()

    ccte = raw.get("ccte_hazard") or {}
    pubchem = raw.get("pubchem_tox") or {}
    chembl = raw.get("chembl_pk") or {}

    noael_anchor = None
    if isinstance(ccte, dict) and ccte.get("noael_min"):
        noael_anchor = {
            "noael_mg_kg_day": ccte["noael_min"],
            "species_covered": ccte.get("species_covered") or [],
            "provenance": "measured",
            "source": f"EPA CCTE Hazard / ToxRefDB (DTXSID {ccte.get('dtxsid')})",
        }
    ld50_anchor = None
    if isinstance(pubchem, dict) and pubchem.get("ld50_mg_kg"):
        ld50_anchor = {
            "ld50_mg_kg": pubchem["ld50_mg_kg"],
            "provenance": "measured",
            "source": f"PubChem acute toxicology (CID {pubchem.get('cid')})",
        }

    sources_live = [
        name
        for name, block in (
            ("EPA CCTE", ccte),
            ("ChEMBL", chembl),
            ("PubChem", pubchem),
            ("PK-DB", raw.get("pkdb")),
        )
        if isinstance(block, dict)
        and (
            block.get("status") == "live"
            or block.get("assays")
            or block.get("ld50_mg_kg")
            or block.get("matched")
        )
    ]

    return {
        "available": bool(sources_live),
        "resolved_name": raw.get("resolved_name"),
        "sources": {
            "ccte_hazard": ccte,
            "chembl_analogue_pk": chembl,
            "pubchem_toxicology": pubchem,
            "pkdb": raw.get("pkdb"),
        },
        "sources_with_data": sources_live,
        "noael_anchor": noael_anchor,
        "ld50_anchor": ld50_anchor,
        "unsupported_sources": [
            {
                "name": "Open TG-GATEs / DrugMatrix",
                "status": "not_integrated",
                "reason": "Toxicogenomics evidence is compound-identity-keyed and transcriptomic; "
                "surfaced as a named source but not used for quantitative anchoring in v1.",
            }
        ],
        "model": "Live REST lookups against EPA CCTE, ChEMBL, PubChem, PK-DB",
        "provenance": "measured (public datasets)",
        "limitations": (
            "Evidence is for the compound and near analogues where public data exist; absence of "
            "a source's data is reported as 'no data located', never as a negative safety finding."
        ),
    }


__all__ = ["collect_evidence"]
