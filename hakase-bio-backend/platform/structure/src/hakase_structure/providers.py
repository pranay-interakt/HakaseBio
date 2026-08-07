"""Structure providers — real folding APIs, no GPU required by default.

ESMFoldAtlasProvider   -> ESM Atlas public API (no key, CPU/remote, MIT model).
NvidiaESMFoldProvider  -> NVIDIA NIM ESMFold (requires NVIDIA_API_KEY).

Both return a real ``StructurePrediction`` parsed from actual model output. On
network/HTTP failure they raise a RECOVERABLE ServiceFailure so the orchestrator
can retry, then degrade to structured ``unavailable`` — never a fake structure.
"""

from __future__ import annotations

import abc

import numpy as np
import requests
from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure

from .pdb_tools import parse_per_residue_plddt
from .prediction import StructurePrediction


class StructureProvider(abc.ABC):
    name: str
    model_id: str
    model_version: str
    max_length: int

    @abc.abstractmethod
    def fold(self, sequence: str) -> StructurePrediction: ...

    def _finish(
        self, sequence: str, pdb: str, scale_hint: str | None = None
    ) -> StructurePrediction:
        if "ATOM" not in pdb:
            raise ServiceFailure(
                f"{self.name} returned a response without ATOM records.",
                failure_type=FailureType.RECOVERABLE,
                reason_code="structure_no_atoms",
            )
        plddt, scale = parse_per_residue_plddt(pdb)
        if not plddt:
            raise ServiceFailure(
                f"{self.name} produced no parseable pLDDT values.",
                failure_type=FailureType.RECOVERABLE,
                reason_code="structure_no_plddt",
            )
        return StructurePrediction(
            sequence=sequence,
            pdb=pdb,
            per_residue_plddt=plddt,
            mean_plddt=float(np.mean(plddt)),
            provider=self.name,
            model_id=self.model_id,
            model_version=self.model_version,
            raw_plddt_scale=scale_hint or scale,
        )


class ESMFoldAtlasProvider(StructureProvider):
    name = "esmfold_esmatlas"
    model_id = "esmfold_v1"
    model_version = "1.0.0"

    def __init__(self, config: PlatformConfig | None = None) -> None:
        self._cfg = config or get_config()
        self.max_length = self._cfg.esmatlas_max_length

    def fold(self, sequence: str) -> StructurePrediction:
        if len(sequence) > self.max_length:
            raise ServiceFailure(
                f"Sequence length {len(sequence)} exceeds ESM Atlas limit "
                f"{self.max_length}; use the conformation layer or NVIDIA provider.",
                failure_type=FailureType.PARTIAL,
                reason_code="sequence_too_long",
            )
        try:
            resp = requests.post(
                self._cfg.esmatlas_fold_url,
                data=sequence,
                headers={"User-Agent": self._cfg.http_user_agent, "Content-Type": "text/plain"},
                timeout=self._cfg.esmatlas_timeout_s,
            )
        except requests.Timeout as exc:
            raise ServiceFailure(
                f"ESM Atlas request timed out after {self._cfg.esmatlas_timeout_s:g}s.",
                failure_type=FailureType.RECOVERABLE,
                reason_code="esmatlas_timeout",
            ) from exc
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"ESM Atlas request failed: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="esmatlas_network_error",
            ) from exc
        if resp.status_code != 200:
            snippet = resp.text[:200].replace("\n", " ")
            raise ServiceFailure(
                f"ESM Atlas returned HTTP {resp.status_code}: {snippet}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="esmatlas_http_error",
            )
        return self._finish(sequence, resp.text)


class NvidiaESMFoldProvider(StructureProvider):
    name = "nvidia_esmfold"
    model_id = "esmfold_v1"
    model_version = "1.0.0"
    max_length = 1024

    def __init__(self, config: PlatformConfig | None = None) -> None:
        self._cfg = config or get_config()
        if not self._cfg.nvidia_api_key:
            raise ServiceFailure(
                "NVIDIA ESMFold requested but NVIDIA_API_KEY is not set.",
                failure_type=FailureType.PARTIAL,
                reason_code="nvidia_key_missing",
            )

    def fold(self, sequence: str) -> StructurePrediction:
        try:
            resp = requests.post(
                self._cfg.nvidia_esmfold_url,
                headers={
                    "Authorization": f"Bearer {self._cfg.nvidia_api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": self._cfg.http_user_agent,
                },
                json={"sequence": sequence},
                timeout=self._cfg.structure_timeout_s,
            )
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"NVIDIA ESMFold request failed: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="nvidia_network_error",
            ) from exc
        if resp.status_code != 200:
            snippet = resp.text[:200].replace("\n", " ")
            raise ServiceFailure(
                f"NVIDIA ESMFold returned HTTP {resp.status_code}: {snippet}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="nvidia_http_error",
            )
        pdb = self._extract_pdb(resp.json())
        return self._finish(sequence, pdb)

    @staticmethod
    def _extract_pdb(payload) -> str:
        # NVIDIA NIM ESMFold returns the coordinates under one of these keys.
        if isinstance(payload, dict):
            for key in ("pdbs", "pdb", "output", "structures"):
                if key in payload and payload[key]:
                    val = payload[key]
                    if isinstance(val, list):
                        return val[0]
                    return val
        raise ServiceFailure(
            "NVIDIA ESMFold response did not contain a recognizable PDB field.",
            failure_type=FailureType.PARTIAL,
            reason_code="nvidia_unexpected_schema",
        )


def resolve_structure_provider(config: PlatformConfig | None = None) -> StructureProvider:
    """Select the default single-chain structure provider from configuration.

    Never silently substitutes: an explicit ``nvidia_esmfold`` selection without
    a key raises rather than quietly falling back.
    """
    cfg = config or get_config()
    choice = cfg.structure_provider
    if choice == "nvidia_esmfold":
        return NvidiaESMFoldProvider(cfg)
    if choice == "esmfold_esmatlas":
        return ESMFoldAtlasProvider(cfg)
    raise ServiceFailure(
        f"Unknown STRUCTURE_PROVIDER '{choice}'.",
        failure_type=FailureType.CRITICAL,
        reason_code="bad_structure_provider",
    )
