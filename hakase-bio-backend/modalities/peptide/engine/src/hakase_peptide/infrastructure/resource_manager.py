"""Resource Manager (doc 01 §4.6).

Centralised, cached access to external biological databases so individual
services never talk to the network directly. All calls are real HTTP requests to
public endpoints (UniProt REST, RCSB). Failures raise a RECOVERABLE
``ServiceFailure`` (network) or return ``None`` (not found) — never fabricated
data.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import requests
from hakase_kernel.config import get_config
from hakase_kernel.faults import FailureType, ServiceFailure


class _TTLCache:
    def __init__(self, ttl_s: float = 86400.0) -> None:
        self._d: dict[str, tuple[float, object]] = {}
        self._ttl = ttl_s
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            item = self._d.get(key)
            if not item:
                return None
            ts, val = item
            if time.time() - ts > self._ttl:
                self._d.pop(key, None)
                return None
            return val

    def put(self, key: str, val: object) -> None:
        with self._lock:
            self._d[key] = (time.time(), val)


class ResourceManager:
    def __init__(self) -> None:
        self._cfg = get_config()
        self._seq_cache = _TTLCache()
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": self._cfg.http_user_agent})

    # ---- UniProt ------------------------------------------------------------
    def fetch_uniprot_sequence(self, accession: str) -> str | None:
        """Fetch the canonical protein sequence for a UniProt accession (FASTA)."""
        accession = accession.strip().upper()
        cache_key = f"uniprot:{accession}"
        cached = self._seq_cache.get(cache_key)
        if cached is not None:
            return cached or None  # empty string sentinel => known-missing

        url = f"{self._cfg.uniprot_base_url}/uniprotkb/{accession}.fasta"
        try:
            resp = self._session.get(url, timeout=self._cfg.resource_timeout_s)
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"UniProt request failed for {accession}: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="uniprot_network_error",
            ) from exc

        if resp.status_code == 404:
            self._seq_cache.put(cache_key, "")
            return None
        if resp.status_code != 200:
            raise ServiceFailure(
                f"UniProt returned HTTP {resp.status_code} for {accession}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="uniprot_http_error",
            )

        lines = resp.text.splitlines()
        seq = "".join(l.strip() for l in lines if l and not l.startswith(">"))
        seq = seq.upper()
        if not seq:
            return None
        self._seq_cache.put(cache_key, seq)
        return seq

    # ---- RCSB / PDB ---------------------------------------------------------
    def fetch_pdb(self, pdb_id: str) -> str | None:
        """Fetch a PDB coordinate file (text) from RCSB by 4-char id."""
        pdb_id = pdb_id.strip().lower()
        cache_key = f"pdb:{pdb_id}"
        cached = self._seq_cache.get(cache_key)
        if cached is not None:
            return cached or None

        url = f"{self._cfg.rcsb_base_url}/{pdb_id}.pdb"
        try:
            resp = self._session.get(url, timeout=self._cfg.resource_timeout_s)
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"RCSB request failed for {pdb_id}: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="rcsb_network_error",
            ) from exc
        if resp.status_code == 404:
            self._seq_cache.put(cache_key, "")
            return None
        if resp.status_code != 200:
            raise ServiceFailure(
                f"RCSB returned HTTP {resp.status_code} for {pdb_id}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="rcsb_http_error",
            )
        self._seq_cache.put(cache_key, resp.text)
        return resp.text

    # ---- ChEMBL / PubChem (small-molecule modifications, spec §8) -----------
    def fetch_pubchem_by_name(self, name: str) -> dict[str, Any] | None:
        """Resolve a compound name to ``{smiles, mass_avg}`` via PubChem PUG REST.

        Used by the cheminformatics engine to resolve non-standard residues and
        small-molecule modifications (PEG linkers, lipid tails). Returns ``None``
        when the name is not found; raises a RECOVERABLE ``ServiceFailure`` on a
        network/HTTP error. Never returns fabricated chemistry.
        """
        name = (name or "").strip()
        if not name:
            return None
        cache_key = f"pubchem:{name.lower()}"
        cached = self._seq_cache.get(cache_key)
        if cached is not None:
            return cached or None  # {} sentinel => known-missing

        from urllib.parse import quote

        url = (
            f"{self._cfg.pubchem_base_url}/compound/name/{quote(name)}"
            f"/property/CanonicalSMILES,MolecularWeight/JSON"
        )
        try:
            resp = self._session.get(url, timeout=self._cfg.resource_timeout_s)
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"PubChem request failed for {name}: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="pubchem_network_error",
            ) from exc
        if resp.status_code == 404:
            self._seq_cache.put(cache_key, {})
            return None
        if resp.status_code != 200:
            raise ServiceFailure(
                f"PubChem returned HTTP {resp.status_code} for {name}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="pubchem_http_error",
            )
        try:
            props = resp.json()["PropertyTable"]["Properties"][0]
            record = {
                "smiles": props.get("CanonicalSMILES"),
                "mass_avg": (
                    float(props["MolecularWeight"]) if props.get("MolecularWeight") else None
                ),
            }
        except (KeyError, IndexError, ValueError, TypeError):
            self._seq_cache.put(cache_key, {})
            return None
        self._seq_cache.put(cache_key, record)
        return record

    def fetch_chembl_by_name(self, name: str) -> dict[str, Any] | None:
        """Resolve a compound name to ``{smiles, mass_avg}`` via the ChEMBL REST API.

        Same contract as :meth:`fetch_pubchem_by_name`: ``None`` on a clean miss,
        RECOVERABLE ``ServiceFailure`` on network/HTTP error, never fabricated.
        """
        name = (name or "").strip()
        if not name:
            return None
        cache_key = f"chembl:{name.lower()}"
        cached = self._seq_cache.get(cache_key)
        if cached is not None:
            return cached or None

        from urllib.parse import quote

        url = f"{self._cfg.chembl_base_url}/molecule/search.json?q={quote(name)}"
        try:
            resp = self._session.get(url, timeout=self._cfg.resource_timeout_s)
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"ChEMBL request failed for {name}: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="chembl_network_error",
            ) from exc
        if resp.status_code == 404:
            self._seq_cache.put(cache_key, {})
            return None
        if resp.status_code != 200:
            raise ServiceFailure(
                f"ChEMBL returned HTTP {resp.status_code} for {name}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="chembl_http_error",
            )
        try:
            molecules = resp.json().get("molecules") or []
            if not molecules:
                self._seq_cache.put(cache_key, {})
                return None
            m = molecules[0]
            structures = m.get("molecule_structures") or {}
            props = m.get("molecule_properties") or {}
            record = {
                "smiles": structures.get("canonical_smiles"),
                "mass_avg": float(props["full_mwt"]) if props.get("full_mwt") else None,
            }
        except (KeyError, IndexError, ValueError, TypeError):
            self._seq_cache.put(cache_key, {})
            return None
        self._seq_cache.put(cache_key, record)
        return record


_RM: ResourceManager | None = None
_RM_LOCK = threading.Lock()


def get_resource_manager() -> ResourceManager:
    global _RM
    if _RM is None:
        with _RM_LOCK:
            if _RM is None:
                _RM = ResourceManager()
    return _RM
