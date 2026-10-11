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
    pc = (pubchem or PubChemClient()).compound_by_inchikey(row.inchikey)
    kernel.attach_external_record(actor, compound_id, "pubchem", pc.to_dict())
    ch = chembl or ChEMBLClient()
    mol = ch.molecule_by_inchikey(row.inchikey)
    kernel.attach_external_record(actor, compound_id, "chembl", mol.to_dict())
    if include_herg and mol.ok:
        herg = ch.herg_ic50(mol.records[0]["chembl_id"])
        kernel.attach_external_record(actor, compound_id, "chembl_herg_ic50", herg.to_dict())
    return kernel.compound_view(compound_id)
