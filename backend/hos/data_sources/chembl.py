"""ChEMBL web-services client.

API: https://www.ebi.ac.uk/chembl/api/data/docs. Molecules by standard InChIKey
(``/molecule.json?molecule_structures__standard_inchi_key=``), activities by molecule and
target (``/activity.json``), with pagination via ``page_meta.next``.

Two properties of ChEMBL data are preserved rather than flattened:

* ``standard_relation``: a value reported as ``>`` or ``<`` is a censored bound, not a
  measurement at that value. Only ``=`` values become plain LITERATURE quantities; bounds
  carry the flag ``censored_lower_bound`` / ``censored_upper_bound``.
* ``data_validity_comment``: ChEMBL's curation warnings are attached as QC flags.

Licence: ChEMBL is CC BY-SA 3.0; attribution is recorded on every result (share-alike
implications for commercial redistribution must be reviewed; docs/05).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlencode

from hos.core.provenance import Citation, Provenance
from hos.core.quantity import Quantity
from hos.data_sources.base import SourceResult, SourceStatus
from hos.data_sources.http import CachedHttp

__all__ = ["CHEMBL_BASE", "HERG_TARGET", "ChEMBLClient"]

CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data"
#: ChEMBL target for human hERG (KCNH2, UniProt Q12809), verified against the live API.
HERG_TARGET = "CHEMBL240"
LICENSE = "CC BY-SA 3.0 (ChEMBL, EMBL-EBI)"
_MAX_PAGES = 20


class ChEMBLClient:
    source = "ChEMBL"

    def __init__(self, http: CachedHttp | None = None) -> None:
        self.http = http or CachedHttp()

    def molecule_by_inchikey(self, inchikey: str, *, refresh: bool = False) -> SourceResult:
        url = f"{CHEMBL_BASE}/molecule.json?" + urlencode(
            {"molecule_structures__standard_inchi_key": inchikey}
        )
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
        mols = (payload or {}).get("molecules")
        if mols is None:
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
        if not mols:
            return SourceResult(
                self.source,
                SourceStatus.NOT_FOUND,
                inchikey,
                url,
                at,
                from_cache=cached,
                license=LICENSE,
            )
        m = mols[0]
        cid = m.get("molecule_chembl_id")
        rec = {
            "chembl_id": cid,
            "pref_name": m.get("pref_name"),
            "max_phase": m.get("max_phase"),
            "molecule_type": m.get("molecule_type"),
            "first_approval": m.get("first_approval"),
            "withdrawn_flag": m.get("withdrawn_flag"),
            "black_box_warning": m.get("black_box_warning"),
            "report_card": f"https://www.ebi.ac.uk/chembl/compound_report_card/{cid}/",
        }
        return SourceResult(
            self.source,
            SourceStatus.OK,
            inchikey,
            url,
            at,
            records=(rec,),
            from_cache=cached,
            license=LICENSE,
            attribution=f"ChEMBL {cid}, EMBL-EBI, CC BY-SA 3.0",
        )

    def similar_molecules(
        self, smiles: str, *, threshold: int = 70, limit: int = 50, refresh: bool = False
    ) -> SourceResult:
        """Structures ChEMBL holds that resemble ``smiles``, as candidate analogues.

        ``threshold`` is ChEMBL's similarity percentage, used only to retrieve candidates;
        the similarity a prediction is weighted by is recomputed locally from the returned
        structures (``hos.triage.readacross``), so the number behind a result is one this
        system computed and can state the method for.

        An empty match set is ``NOT_FOUND``, never an error. ChEMBL answers 404 for a
        structure it holds nothing similar to, which is the same thing.
        """
        url = (
            f"{CHEMBL_BASE}/similarity/{quote(smiles, safe='')}/{int(threshold)}.json?"
            + urlencode({"limit": limit})
        )
        status, payload, at, cached, err = self.http.get_json(url, refresh=refresh)
        if status is SourceStatus.NOT_FOUND:
            return SourceResult(
                self.source, status, smiles, url, at, from_cache=cached, license=LICENSE
            )
        if status is not SourceStatus.OK:
            return SourceResult(
                self.source,
                status,
                smiles,
                url,
                at,
                from_cache=cached,
                error=err,
                license=LICENSE,
            )
        mols = (payload or {}).get("molecules")
        if mols is None:
            return SourceResult(
                self.source,
                SourceStatus.ERROR,
                smiles,
                url,
                at,
                from_cache=cached,
                error="unexpected response schema",
                license=LICENSE,
            )
        records = []
        for m in mols:
            structures = m.get("molecule_structures") or {}
            records.append(
                {
                    "chembl_id": m.get("molecule_chembl_id"),
                    "pref_name": m.get("pref_name"),
                    "canonical_smiles": structures.get("canonical_smiles"),
                    "standard_inchi_key": structures.get("standard_inchi_key"),
                    "chembl_similarity": m.get("similarity"),
                }
            )
        if not records:
            return SourceResult(
                self.source,
                SourceStatus.NOT_FOUND,
                smiles,
                url,
                at,
                from_cache=cached,
                license=LICENSE,
            )
        return SourceResult(
            self.source,
            SourceStatus.OK,
            smiles,
            url,
            at,
            records=tuple(records),
            from_cache=cached,
            license=LICENSE,
            attribution="ChEMBL similarity search, EMBL-EBI, CC BY-SA 3.0",
        )

    def activities(
        self,
        molecule_chembl_id: str,
        *,
        target_chembl_id: str | None = None,
        standard_types: Iterable[str] = (),
        refresh: bool = False,
    ) -> SourceResult:
        return self._activities(
            {"molecule_chembl_id": molecule_chembl_id},
            molecule_chembl_id,
            target_chembl_id=target_chembl_id,
            standard_types=standard_types,
            refresh=refresh,
        )

    def activities_for(
        self,
        molecule_chembl_ids: Iterable[str],
        *,
        target_chembl_id: str | None = None,
        standard_types: Iterable[str] = (),
        refresh: bool = False,
    ) -> SourceResult:
        """Activities for several molecules in one query (``molecule_chembl_id__in``).

        Used where a set of candidate analogues must be checked for a measured endpoint:
        one request answers for all of them instead of one request each. The records
        carry ``molecule_chembl_id``, so the caller groups them itself.
        """
        ids = sorted({i for i in molecule_chembl_ids if i})
        if not ids:
            raise ValueError("activities_for needs at least one molecule id")
        return self._activities(
            {"molecule_chembl_id__in": ",".join(ids)},
            f"{len(ids)} molecules",
            target_chembl_id=target_chembl_id,
            standard_types=standard_types,
            refresh=refresh,
        )

    def _activities(
        self,
        selector: dict[str, Any],
        subject: str,
        *,
        target_chembl_id: str | None,
        standard_types: Iterable[str],
        refresh: bool,
    ) -> SourceResult:
        params: dict[str, Any] = {**selector, "limit": 100}
        if target_chembl_id:
            params["target_chembl_id"] = target_chembl_id
        types = list(standard_types)
        if types:
            params["standard_type__in"] = ",".join(types)
        url = f"{CHEMBL_BASE}/activity.json?" + urlencode(params)
        query = f"{subject}/{target_chembl_id or '*'}/{','.join(types) or '*'}"
        records: list[dict[str, Any]] = []
        q: dict[str, Quantity] = {}
        next_url: str | None = url
        first_at: str | None = None
        cached_all = True
        pages = 0
        while next_url and pages < _MAX_PAGES:
            status, payload, at, cached, err = self.http.get_json(next_url, refresh=refresh)
            first_at = first_at or at
            cached_all = cached_all and cached
            if status is not SourceStatus.OK:
                return SourceResult(
                    self.source,
                    status,
                    query,
                    url,
                    at,
                    from_cache=cached,
                    error=err,
                    license=LICENSE,
                )
            body = payload or {}
            acts = body.get("activities")
            if acts is None:
                return SourceResult(
                    self.source,
                    SourceStatus.ERROR,
                    query,
                    url,
                    at,
                    error="unexpected response schema",
                    license=LICENSE,
                )
            for a in acts:
                rec, qty = _activity(a, at)
                rec["molecule_chembl_id"] = a.get("molecule_chembl_id")
                records.append(rec)
                if qty is not None:
                    q[f"activity:{a.get('activity_id')}"] = qty
            nxt = (body.get("page_meta") or {}).get("next")
            next_url = f"https://www.ebi.ac.uk{nxt}" if nxt else None
            pages += 1
        truncated = next_url is not None
        if not records:
            return SourceResult(
                self.source,
                SourceStatus.NOT_FOUND,
                query,
                url,
                first_at,
                from_cache=cached_all,
                license=LICENSE,
            )
        return SourceResult(
            self.source,
            SourceStatus.OK,
            query,
            url,
            first_at,
            records=tuple(records),
            quantities=q,
            from_cache=cached_all,
            license=LICENSE,
            attribution="ChEMBL activities, EMBL-EBI, CC BY-SA 3.0",
            error=f"truncated after {_MAX_PAGES} pages" if truncated else None,
        )

    def herg_ic50(self, molecule_chembl_id: str, *, refresh: bool = False) -> SourceResult:
        return self.activities(
            molecule_chembl_id,
            target_chembl_id=HERG_TARGET,
            standard_types=("IC50",),
            refresh=refresh,
        )


_UNIT_MAP = {"nM": "nM", "uM": "uM", "mM": "mM", "pM": "pM", "M": "M"}


def _activity(a: dict[str, Any], at: str | None) -> tuple[dict[str, Any], Quantity | None]:
    doc = a.get("document_chembl_id")
    rec = {
        k: a.get(k)
        for k in (
            "activity_id",
            "standard_type",
            "standard_relation",
            "standard_value",
            "standard_units",
            "pchembl_value",
            "assay_chembl_id",
            "assay_description",
            "assay_type",
            "document_chembl_id",
            "document_journal",
            "document_year",
            "data_validity_comment",
            "activity_comment",
            "target_chembl_id",
            "target_pref_name",
        )
    }
    value, units, rel = a.get("standard_value"), a.get("standard_units"), a.get("standard_relation")
    unit = _UNIT_MAP.get(units or "")
    if value is None or unit is None or rel not in ("=", ">", ">=", "<", "<="):
        rec["hos_note"] = "not converted to a quantity (missing value, unit or relation)"
        return rec, None
    flags = []
    if rel in (">", ">="):
        flags.append("censored_lower_bound")
    elif rel in ("<", "<="):
        flags.append("censored_upper_bound")
    if a.get("data_validity_comment"):
        flags.append(f"chembl_validity:{a['data_validity_comment']}")
    act_url = f"https://www.ebi.ac.uk/chembl/api/data/activity/{a.get('activity_id')}"
    cit = Citation(
        key=f"chembl:{doc}",
        text=f"ChEMBL document {doc}"
        + (f", {a.get('document_journal')}" if a.get("document_journal") else "")
        + (f" ({a.get('document_year')})" if a.get("document_year") else ""),
        url=f"https://www.ebi.ac.uk/chembl/document_report_card/{doc}/",
        year=a.get("document_year"),
    )
    prov = Provenance.literature(
        source_name="ChEMBL",
        citation=cit,
        source_url=act_url,
        source_record_id=f"activity:{a.get('activity_id')}",
        retrieved_at=datetime.fromisoformat(at) if at else None,
        notes=f"{a.get('standard_type')} {rel} {value} {units}; assay {a.get('assay_chembl_id')}: "
        f"{a.get('assay_description')}",
    )
    label = f"{a.get('standard_type')} ({a.get('target_pref_name') or a.get('target_chembl_id')})"
    if rel != "=":
        label += f" {rel} bound"
    return rec, Quantity(
        value=float(value), unit=unit, provenance=prov, label=label, qc_flags=tuple(flags)
    )
