"""PubChem PUG-REST client.

API: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest. Compound properties by InChIKey:
``/rest/pug/compound/inchikey/{key}/property/{props}/JSON``. PubChem data are in the
public domain (NCBI). Note that PubChem's descriptors (XLogP3, TPSA, H-bond counts) are
themselves computed by PubChem; they are labelled as retrieved database values with that
fact recorded, not as measurements.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from hos.core.provenance import Citation, Provenance
from hos.core.quantity import Quantity
from hos.data_sources.base import SourceResult, SourceStatus
from hos.data_sources.http import CachedHttp

__all__ = ["PUBCHEM_BASE", "PubChemClient"]

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
_PROPS = (
    "MolecularFormula,MolecularWeight,ExactMass,XLogP,TPSA,HBondDonorCount,"
    "HBondAcceptorCount,IUPACName,SMILES,ConnectivitySMILES,InChIKey"
)
_NUMERIC = {
    "MolecularWeight": ("g/mol", "Molecular weight (PubChem)"),
    "ExactMass": ("g/mol", "Exact mass (PubChem)"),
    "XLogP": ("dimensionless", "XLogP3 (computed by PubChem)"),
    "TPSA": ("angstrom**2", "TPSA (computed by PubChem)"),
    "HBondDonorCount": ("dimensionless", "H-bond donors (computed by PubChem)"),
    "HBondAcceptorCount": ("dimensionless", "H-bond acceptors (computed by PubChem)"),
}
LICENSE = "Public domain (NCBI PubChem)"


class PubChemClient:
    source = "PubChem"

    def __init__(self, http: CachedHttp | None = None) -> None:
        self.http = http or CachedHttp()

    def compound_by_inchikey(self, inchikey: str, *, refresh: bool = False) -> SourceResult:
        url = f"{PUBCHEM_BASE}/compound/inchikey/{quote(inchikey)}/property/{_PROPS}/JSON"
        status, payload, at, cached, err = self.http.get_json(url, refresh=refresh)
        if status is not SourceStatus.OK:
            return SourceResult(
                self.source,
                status,
                inchikey,
                url,
                at,
                from_cache=cached,
                error=err,
                license=LICENSE,
            )
        if payload is None:
            return SourceResult(
                self.source,
                SourceStatus.ERROR,
                inchikey,
                url,
                at,
                error="empty response body",
                license=LICENSE,
            )
        try:
            props = payload["PropertyTable"]["Properties"]
        except (KeyError, TypeError):
            return SourceResult(
                self.source,
                SourceStatus.ERROR,
                inchikey,
                url,
                at,
                from_cache=cached,
                error="unexpected response schema",
                license=LICENSE,
            )
        if not props:
            return SourceResult(
                self.source,
                SourceStatus.NOT_FOUND,
                inchikey,
                url,
                at,
                from_cache=cached,
                license=LICENSE,
            )
        p = props[0]
        cid = p.get("CID")
        record_url = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
        q: dict[str, Quantity] = {}
        for key, (unit, label) in _NUMERIC.items():
            raw = p.get(key)
            if raw is None:
                q[key] = Quantity.unavailable(
                    unit,
                    reason=f"PubChem returned no {key} for CID {cid}",
                    source_name=self.source,
                    label=label,
                )
                continue
            q[key] = _lit(
                float(raw),
                unit,
                label,
                cid,
                record_url,
                at,
                note="computed by PubChem" if "computed" in label else None,
            )
        rec: dict[str, Any] = {
            "cid": cid,
            "inchikey": p.get("InChIKey"),
            "formula": p.get("MolecularFormula"),
            "iupac_name": p.get("IUPACName"),
            "smiles": p.get("SMILES"),
            "connectivity_smiles": p.get("ConnectivitySMILES"),
            "record_url": record_url,
        }
        if rec["inchikey"] and rec["inchikey"] != inchikey:
            return SourceResult(
                self.source,
                SourceStatus.ERROR,
                inchikey,
                url,
                at,
                from_cache=cached,
                error=f"PubChem returned InChIKey {rec['inchikey']} for query {inchikey}",
                license=LICENSE,
            )
        return SourceResult(
            self.source,
            SourceStatus.OK,
            inchikey,
            url,
            at,
            records=(rec,),
            quantities=q,
            from_cache=cached,
            license=LICENSE,
            attribution=f"PubChem CID {cid}",
        )


def _lit(
    value: float, unit: str, label: str, cid: Any, record_url: str, at: str | None, note: str | None
) -> Quantity:
    from datetime import datetime

    prov = Provenance.literature(
        source_name="PubChem",
        citation=Citation(
            key=f"pubchem:CID{cid}",
            text=f"PubChem Compound CID {cid}. National Center for Biotechnology Information.",
            url=record_url,
        ),
        source_url=record_url,
        source_record_id=f"CID{cid}",
        retrieved_at=datetime.fromisoformat(at) if at else None,
        notes=note,
    )
    return Quantity(value=value, unit=unit, provenance=prov, label=label)
