"""Embedding artifact storage — write large vectors *by reference* (spec §6.11).

Embedding tensors (a pooled vector, and especially the per-residue matrix which
is ``length × dim``) are too large to inline in every Evidence Object. The §14
``embeddings`` block therefore carries only ``dimension`` + ``storage_uri``; the
tensor itself is written to a store and referenced by URI.

V3 has no object store, so the sanctioned default (roadmap "Decisions (locked)")
is a **local-filesystem fallback** that writes NumPy artifacts and returns a
``file://`` URI. The ``EmbeddingStore`` seam leaves room for an ``s3://`` / ``gs://``
backend later without touching the service. The write directory is resolved from
``PlatformConfig`` (env ``EMBEDDING_STORAGE_DIR``), defaulting to
``<tempdir>/hakase-embeddings/`` — never repo-relative, so nothing large is
committed and tests stay hermetic.

Filenames are content-addressed by ``subject_id`` + ``model_id`` + ``model_version``
+ ``kind``, so repeated runs on the same peptide are idempotent (they overwrite
the identical artifact rather than accumulating).
"""

from __future__ import annotations

import abc
import os
import re
import tempfile
from collections.abc import Sequence
from urllib.parse import urlparse
from urllib.request import url2pathname

import numpy as np
from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure

# The two artifact kinds a provider can emit.
POOLED = "pooled"
PER_RESIDUE = "per_residue"

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _slug(text: str) -> str:
    """Filesystem-safe token (``peptide:ab12`` -> ``peptide_ab12``)."""
    return _SAFE.sub("_", text).strip("_") or "unknown"


class EmbeddingStore(abc.ABC):
    """Writes an embedding tensor and returns a stable URI referencing it."""

    @abc.abstractmethod
    def put(
        self,
        *,
        subject_id: str,
        model_id: str,
        model_version: str,
        kind: str,
        array: Sequence,
    ) -> str: ...


class LocalFilesystemStore(EmbeddingStore):
    """Local-fs fallback: writes ``.npy`` (pooled) / compressed ``.npz``
    (per-residue) under ``base_dir`` and returns a ``file://`` URI."""

    def __init__(self, base_dir: str | None = None) -> None:
        self.base_dir = base_dir or os.path.join(tempfile.gettempdir(), "hakase-embeddings")

    def put(
        self,
        *,
        subject_id: str,
        model_id: str,
        model_version: str,
        kind: str,
        array: Sequence,
    ) -> str:
        arr = np.asarray(array, dtype=float)
        if arr.size == 0:
            raise ServiceFailure(
                "Refusing to store an empty embedding array.",
                failure_type=FailureType.PARTIAL,
                reason_code="embedding_store_empty",
            )
        try:
            os.makedirs(self.base_dir, exist_ok=True)
            stem = f"{_slug(subject_id)}.{_slug(model_id)}.{_slug(model_version)}.{_slug(kind)}"
            if arr.ndim >= 2:
                path = os.path.join(self.base_dir, stem + ".npz")
                np.savez_compressed(path, **{kind: arr})
            else:
                path = os.path.join(self.base_dir, stem + ".npy")
                np.save(path, arr)
        except OSError as exc:
            raise ServiceFailure(
                f"Could not write embedding artifact: {exc}",
                failure_type=FailureType.PARTIAL,
                reason_code="embedding_store_write_error",
            ) from exc
        return "file://" + os.path.abspath(path)


def resolve_embedding_store(config: PlatformConfig | None = None) -> EmbeddingStore:
    cfg = config or get_config()
    backend = cfg.embedding_storage_backend
    if backend == "local_fs":
        return LocalFilesystemStore(cfg.embedding_storage_dir)
    raise ServiceFailure(
        f"Unknown EMBEDDING_STORAGE_BACKEND '{backend}'.",
        failure_type=FailureType.CRITICAL,
        reason_code="bad_embedding_storage_backend",
    )


def load_embedding(uri: str) -> np.ndarray:
    """Read back an artifact written by ``LocalFilesystemStore`` (test/inspection
    helper). Only ``file://`` URIs are supported by the local backend."""
    parsed = urlparse(uri)
    if parsed.scheme != "file":
        raise ValueError(f"Unsupported storage_uri scheme '{parsed.scheme}'.")
    path = url2pathname(parsed.path)
    if path.endswith(".npz"):
        with np.load(path) as npz:
            return npz[npz.files[0]]
    return np.load(path)
