"""NVIDIA NIM ESM2-650M embedding provider (key-gated, real API).

Endpoint: POST {NVIDIA_ESM2_URL}  (default health.api.nvidia.com/v1/biology/meta/esm2-650m)
Auth:     Authorization: Bearer $NVIDIA_API_KEY
Body:     {"sequences": ["<AA seq>"], "output_format": "npz"}

The NIM returns ESM2 per-residue embeddings (npz or h5). We mean-pool over
residues to obtain the pooled 1280-dim representation. The provider handles both
a binary npz body and a JSON body carrying the array; anything it cannot parse
raises a ServiceFailure (never a fabricated vector). It refuses to construct
without a key.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import requests
from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure

from .base import EmbeddingProvider, EmbeddingResult


class NvidiaESM2Provider(EmbeddingProvider):
    name = "nvidia_esm2"
    model_id = "esm2_650m"
    model_version = "650M"
    is_plm = True  # genuine learned protein-language-model embedding

    def __init__(self, config: PlatformConfig | None = None) -> None:
        self._cfg = config or get_config()
        if not self._cfg.nvidia_api_key:
            raise ServiceFailure(
                "NVIDIA ESM2-650M requested but NVIDIA_API_KEY is not set.",
                failure_type=FailureType.PARTIAL,
                reason_code="nvidia_key_missing",
            )

    def embed(self, sequence: str) -> EmbeddingResult:
        try:
            resp = requests.post(
                self._cfg.nvidia_esm2_url,
                headers={
                    "Authorization": f"Bearer {self._cfg.nvidia_api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": self._cfg.http_user_agent,
                },
                json={"sequences": [sequence], "output_format": "npz"},
                timeout=self._cfg.structure_timeout_s,
            )
        except requests.RequestException as exc:
            raise ServiceFailure(
                f"NVIDIA ESM2 request failed: {exc}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="nvidia_network_error",
            ) from exc
        if resp.status_code != 200:
            snippet = resp.text[:200].replace("\n", " ")
            raise ServiceFailure(
                f"NVIDIA ESM2 returned HTTP {resp.status_code}: {snippet}",
                failure_type=FailureType.RECOVERABLE,
                reason_code="nvidia_http_error",
            )

        arr = self._parse_embedding(resp)
        arr = np.asarray(arr, dtype=float)
        if arr.ndim == 3:  # (batch, residues, dim)
            arr = arr[0]
        per_residue: list[list[float]] | None = None
        if arr.ndim == 2:  # (residues, dim) -> keep matrix, mean pool
            per_residue = [[float(x) for x in row] for row in arr.tolist()]
            mean_vec = arr.mean(axis=0)
        elif arr.ndim == 1:  # already pooled; no per-residue matrix returned
            mean_vec = arr
        else:
            raise ServiceFailure(
                f"Unexpected ESM2 embedding rank {arr.ndim}.",
                failure_type=FailureType.PARTIAL,
                reason_code="nvidia_unexpected_shape",
            )
        return EmbeddingResult(
            sequence=sequence,
            mean_vector=[float(x) for x in mean_vec.tolist()],
            dim=int(mean_vec.shape[0]),
            model_id=self.model_id,
            model_version=self.model_version,
            provider=self.name,
            per_residue=per_residue,
            metadata={"pooling": "mean_over_residues"},
        )

    def _parse_embedding(self, resp: requests.Response) -> Any:
        ctype = resp.headers.get("Content-Type", "")
        # Binary npz body.
        if "json" not in ctype:
            try:
                with np.load(io.BytesIO(resp.content), allow_pickle=False) as npz:
                    keys = list(npz.keys())
                    if not keys:
                        raise KeyError("empty npz")
                    # ESM2 NIM stores embeddings under 'embeddings' or the first key.
                    key = "embeddings" if "embeddings" in keys else keys[0]
                    return npz[key]
            except Exception as exc:  # noqa: BLE001
                raise ServiceFailure(
                    f"Could not parse ESM2 npz response: {exc}",
                    failure_type=FailureType.PARTIAL,
                    reason_code="nvidia_npz_parse_error",
                ) from exc
        # JSON body carrying the array.
        try:
            payload = resp.json()
        except ValueError as exc:
            raise ServiceFailure(
                "ESM2 response was neither valid npz nor JSON.",
                failure_type=FailureType.PARTIAL,
                reason_code="nvidia_unparseable",
            ) from exc
        for key in ("embeddings", "embedding", "output", "data"):
            if isinstance(payload, dict) and key in payload and payload[key] is not None:
                return payload[key]
        raise ServiceFailure(
            "ESM2 JSON response contained no recognizable embedding field.",
            failure_type=FailureType.PARTIAL,
            reason_code="nvidia_unexpected_schema",
        )
