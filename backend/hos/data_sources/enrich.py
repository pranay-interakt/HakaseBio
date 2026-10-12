"""Compound enrichment: look a registered compound up in PubChem and ChEMBL and attach the
results (with their status, even when not found or unreachable) through the kernel, so the
lookup itself is on the ledger."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from hos.data_sources.chembl import ChEMBLClient
from hos.data_sources.pubchem import PubChemClient
from hos.kernel.attestation import Principal

if TYPE_CHECKING:
    from hos.kernel.kernel import Kernel

__all__ = ["enrich_compound"]


def enrich_compound(
    kernel: Kernel,
    actor: Principal,
    compound_id: str,
    *,
    pubchem: PubChemClient | None = None,
    chembl: ChEMBLClient | None = None,
    include_herg: bool = True,
) -> dict[str, Any]:
    row = kernel.repo.compound(compound_id)
    if not row.inchikey:
        raise ValueError("compound has no InChIKey; cannot query external databases")

    # Fetch everything first, then write once. Each source result carries its own status,
    # so a source being unreachable is recorded rather than raised — but a failure part
    # way through the writes would otherwise leave some records attached and others not,
    # with a ledger trail to match.
    ch = chembl or ChEMBLClient()
    pc = (pubchem or PubChemClient()).compound_by_inchikey(row.inchikey)
    mol = ch.molecule_by_inchikey(row.inchikey)
    fetched: list[tuple[str, dict[str, Any]]] = [
        ("pubchem", pc.to_dict()),
        ("chembl", mol.to_dict()),
    ]
    if include_herg and mol.ok:
        fetched.append(("chembl_herg_ic50", ch.herg_ic50(mol.records[0]["chembl_id"]).to_dict()))

    # one unit of work: the records and their ledger events commit together (docs/15 P0.1)
    with kernel.db.transaction():
        for source, record in fetched:
            kernel.attach_external_record(actor, compound_id, source, record)
    return kernel.compound_view(compound_id)
