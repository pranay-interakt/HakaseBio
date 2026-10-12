"""Reference sets: the measured compounds a read-across estimate is drawn from.

A read-across estimate is only as good as the set it searches. Searching a whole chemical
database for the nearest structures finds mostly compounds nobody measured for the endpoint
in question, so the estimate abstains almost always. The right source set is the compounds
that **have** been measured for that endpoint, which is what a reference set holds.

A set is built once by a recorded command (``hos-triage-reference build herg``), stored
under the data directory, and identified by a snapshot id computed from its contents and
the build logic's version. Every estimate records the snapshot id it used, so the number can
be reproduced exactly even after the set is rebuilt from a changed source.

What a set holds per compound: its identifier in the source, its structure, and its
aggregated measured value with the number of measurements behind it. Aggregation is the
median on the modelling scale (pIC50 for potency), so a compound measured many times does
not dominate and a single outlying assay does not move it.

What never enters a set: a value reported as a bound rather than a measurement, a record
the source flags as doubtful, a value whose unit cannot be converted, and any structure
RDKit cannot parse. Each exclusion is counted and reported by the build, never silently
dropped.

Licensing: a set derived from ChEMBL carries ChEMBL's CC BY-SA 3.0 terms, recorded in the
set itself. It is held locally as a build artefact and is not redistributed.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any

from rdkit import Chem

from hos.core.provenance import utc_now
from hos.data_sources.base import SourceStatus
from hos.data_sources.chembl import CHEMBL_BASE, HERG_TARGET, ChEMBLClient
from hos.triage.readacross import fingerprint

__all__ = [
    "BUILD_VERSION",
    "ENDPOINTS",
    "BuildReport",
    "MeasuredCompound",
    "ReferenceSet",
    "build_herg_reference",
    "load_reference",
    "reference_path",
    "save_reference",
]

#: Part of every snapshot id: changing how a set is aggregated changes the id, so a
#: prediction can never silently refer to a set built by different logic.
BUILD_VERSION = "triage-reference-2026.10.1"

#: The endpoints a reference set exists for, and the scale each is aggregated on.
ENDPOINTS = {"herg_ic50": {"unit": "nM", "scale": "pIC50"}}


@dataclass(frozen=True, slots=True)
class MeasuredCompound:
    """One measured compound in a reference set."""

    identifier: str
    name: str | None
    smiles: str
    inchikey: str
    #: the aggregated value on the set's modelling scale (pIC50 for potency)
    value: float
    n_measurements: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "identifier": self.identifier,
            "name": self.name,
            "smiles": self.smiles,
            "inchikey": self.inchikey,
            "value": self.value,
            "n_measurements": self.n_measurements,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> MeasuredCompound:
        return cls(
            identifier=str(d["identifier"]),
            name=d.get("name"),
            smiles=str(d["smiles"]),
            inchikey=str(d["inchikey"]),
            value=float(d["value"]),
            n_measurements=int(d["n_measurements"]),
        )


@dataclass(frozen=True, slots=True)
class ReferenceSet:
    """Measured compounds for one endpoint, with where they came from and when."""

    endpoint: str
    unit: str
    scale: str
    source: str
    source_query: str
    licence: str
    attribution: str
    retrieved_at: str
    build_version: str
    compounds: tuple[MeasuredCompound, ...]
    excluded: dict[str, int]
    #: True when the build stopped at its page limit with more records to read. A partial
    #: set is not the set of compounds measured for the endpoint, so every answer drawn
    #: from it says so.
    truncated: bool = False

    @property
    def snapshot_id(self) -> str:
        """Content hash of the set's contents and the logic that built it."""
        parts = [self.build_version, self.endpoint, self.scale, f"truncated={self.truncated}"]
        parts += sorted(f"{c.identifier}:{c.value:.6f}:{c.n_measurements}" for c in self.compounds)
        return "ref_" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "unit": self.unit,
            "scale": self.scale,
            "source": self.source,
            "source_query": self.source_query,
            "licence": self.licence,
            "attribution": self.attribution,
            "retrieved_at": self.retrieved_at,
            "build_version": self.build_version,
            "snapshot_id": self.snapshot_id,
            "truncated": self.truncated,
            "excluded": self.excluded,
            "compounds": [c.to_dict() for c in self.compounds],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ReferenceSet:
        return cls(
            endpoint=str(d["endpoint"]),
            unit=str(d["unit"]),
            scale=str(d["scale"]),
            source=str(d["source"]),
            source_query=str(d["source_query"]),
            licence=str(d["licence"]),
            attribution=str(d["attribution"]),
            retrieved_at=str(d["retrieved_at"]),
            build_version=str(d["build_version"]),
            compounds=tuple(MeasuredCompound.from_dict(c) for c in d["compounds"]),
            excluded=dict(d.get("excluded") or {}),
            truncated=bool(d.get("truncated", False)),
        )

    def fingerprints(self) -> tuple[tuple[MeasuredCompound, frozenset[int]], ...]:
        """Each compound with its ECFP4 fingerprint. Computed once per loaded set."""
        global _FPS
        key = self.snapshot_id
        cached = _FPS.get(key)
        if cached is None:
            out = []
            for c in self.compounds:
                mol = Chem.MolFromSmiles(c.smiles)
                if mol is not None:
                    out.append((c, fingerprint(mol)))
            cached = tuple(out)
            _FPS = {key: cached}  # one set at a time; a rebuild replaces it
        return cached


#: fingerprints of the currently loaded set, keyed by its snapshot id
_FPS: dict[str, tuple[tuple[MeasuredCompound, frozenset[int]], ...]] = {}


def reference_path(endpoint: str, data_dir: Path | None = None) -> Path:
    """Where a built set lives: ``<data dir>/triage_reference/<endpoint>.json``."""
    if data_dir is None:
        from hos.db.store import default_data_dir

        data_dir = default_data_dir()
    return data_dir / "triage_reference" / f"{endpoint}.json"


_LOADED: dict[str, tuple[float, ReferenceSet | None]] = {}


def load_reference(endpoint: str, data_dir: Path | None = None) -> ReferenceSet | None:
    """The installed set for an endpoint, or None when none is installed.

    Re-read when the file changes, so rebuilding a set takes effect without a restart.
    """
    path = reference_path(endpoint, data_dir)
    try:
        stamp = path.stat().st_mtime
    except FileNotFoundError:
        _LOADED.pop(str(path), None)
        return None  # no set installed, which is a state the screens report honestly
    except OSError as exc:
        # a permissions or path problem is not the same as "none installed": the operator
        # needs to know the set is there but unreadable
        raise RuntimeError(
            f"the {endpoint} reference set at {path} could not be read: {exc}"
        ) from exc
    hit = _LOADED.get(str(path))
    if hit is not None and hit[0] == stamp:
        return hit[1]
    loaded = ReferenceSet.from_dict(json.loads(path.read_text()))
    _LOADED[str(path)] = (stamp, loaded)
    return loaded


def save_reference(reference: ReferenceSet, data_dir: Path | None = None) -> Path:
    path = reference_path(reference.endpoint, data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(reference.to_dict(), indent=1, sort_keys=True))
    _LOADED.pop(str(path), None)
    return path


@dataclass(frozen=True, slots=True)
class BuildReport:
    """What a build did, for the operator and the record."""

    reference: ReferenceSet
    pages: int
    records: int

    def summary(self) -> dict[str, Any]:
        return {
            "endpoint": self.reference.endpoint,
            "snapshot_id": self.reference.snapshot_id,
            "compounds": len(self.reference.compounds),
            "records_read": self.records,
            "pages": self.pages,
            "complete": not self.reference.truncated,
            "excluded": self.reference.excluded,
            "retrieved_at": self.reference.retrieved_at,
            "licence": self.reference.licence,
        }


def _pic50(value: float, units: str) -> float | None:
    """pIC50 from a concentration in a ChEMBL standard unit, or None if not usable."""
    factor = {"M": 1e9, "mM": 1e6, "uM": 1e3, "nM": 1.0, "pM": 1e-3}.get(units)
    if factor is None:
        return None
    nm = value * factor
    if not math.isfinite(nm) or nm <= 0:
        return None
    return 9.0 - math.log10(nm)


def build_herg_reference(
    chembl: ChEMBLClient | None = None, *, max_pages: int = 40, page_size: int = 1000
) -> BuildReport:
    """Build the hERG IC50 reference set from ChEMBL target CHEMBL240 (human KCNH2).

    Reads every exact (``=``) IC50 record for the target, keeps the usable ones, and
    aggregates each compound to the median pIC50 of its own measurements.
    """
    client = chembl or ChEMBLClient()
    query = f"target_chembl_id={HERG_TARGET}&standard_type=IC50&standard_relation==&standard_flag=1"
    # ``only`` asks for just the fields the set needs, which keeps each page small enough
    # to fetch reliably
    fields = (
        "molecule_chembl_id,canonical_smiles,standard_value,standard_units,"
        "data_validity_comment,molecule_pref_name"
    )
    url = (
        f"{CHEMBL_BASE}/activity.json?target_chembl_id={HERG_TARGET}"
        f"&standard_type=IC50&standard_relation=%3D&limit={page_size}&only={fields}"
    )
    by_compound: dict[str, list[float]] = {}
    meta: dict[str, tuple[str | None, str]] = {}
    excluded = {"flagged_by_source": 0, "unusable_value": 0, "unparseable_structure": 0}
    records = 0
    pages = 0
    next_url: str | None = url
    while next_url and pages < max_pages:
        status, payload, _at, _cached, err = client.http.get_json(next_url)
        if status is not SourceStatus.OK:
            raise RuntimeError(f"ChEMBL returned {status.value} while building the set: {err}")
        body = payload or {}
        activities = body.get("activities")
        if activities is None:
            raise RuntimeError("unexpected ChEMBL response schema while building the set")
        for a in activities:
            records += 1
            cid = a.get("molecule_chembl_id")
            smiles = a.get("canonical_smiles")
            if not isinstance(cid, str) or not isinstance(smiles, str) or not smiles:
                excluded["unusable_value"] += 1
                continue
            if a.get("data_validity_comment"):
                excluded["flagged_by_source"] += 1
                continue
            value, units = a.get("standard_value"), a.get("standard_units")
            try:
                p = _pic50(float(value), str(units)) if value is not None else None
            except (TypeError, ValueError):
                p = None
            if p is None:
                excluded["unusable_value"] += 1
                continue
            by_compound.setdefault(cid, []).append(p)
            meta.setdefault(cid, (a.get("molecule_pref_name"), smiles))
        nxt = (body.get("page_meta") or {}).get("next")
        next_url = f"https://www.ebi.ac.uk{nxt}" if nxt else None
        pages += 1

    compounds: list[MeasuredCompound] = []
    for cid, values in sorted(by_compound.items()):
        name, smiles = meta[cid]
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            excluded["unparseable_structure"] += 1
            continue
        compounds.append(
            MeasuredCompound(
                identifier=cid,
                name=name if isinstance(name, str) else None,
                smiles=Chem.MolToSmiles(mol),
                inchikey=Chem.MolToInchiKey(mol),
                value=median(values),
                n_measurements=len(values),
            )
        )

    reference = ReferenceSet(
        endpoint="herg_ic50",
        unit=ENDPOINTS["herg_ic50"]["unit"],
        scale=ENDPOINTS["herg_ic50"]["scale"],
        source="ChEMBL",
        source_query=query,
        licence="CC BY-SA 3.0 (ChEMBL, EMBL-EBI)",
        attribution="ChEMBL activities for CHEMBL240, EMBL-EBI, CC BY-SA 3.0",
        retrieved_at=utc_now().isoformat(),
        build_version=BUILD_VERSION,
        compounds=tuple(compounds),
        excluded=excluded,
        truncated=next_url is not None,
    )
    return BuildReport(reference=reference, pages=pages, records=records)
