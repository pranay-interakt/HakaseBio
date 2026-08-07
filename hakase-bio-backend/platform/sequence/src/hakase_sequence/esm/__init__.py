"""Sequence representation providers used by the Functional & Safety services.

Default (no key, no GPU): deterministic biochemical descriptors — a real,
reproducible feature vector (amino-acid composition + physicochemistry) suitable
for similarity search and as ML input.

Optional upgrade (key-gated): NVIDIA NIM ESM2-650M protein embeddings — a real
learned representation. Activates only when NVIDIA_API_KEY is set; otherwise the
descriptor provider is used and this is reported transparently in provenance.
"""

from .applicability import EmbeddingApplicability, embedding_applicability
from .base import EmbeddingProvider, EmbeddingResult
from .descriptors import DescriptorEmbeddingProvider
from .esm2_nvidia import NvidiaESM2Provider
from .resolve import resolve_embedding_provider
from .storage import (
    PER_RESIDUE,
    POOLED,
    EmbeddingStore,
    LocalFilesystemStore,
    load_embedding,
    resolve_embedding_store,
)

__all__ = [
    "EmbeddingResult",
    "EmbeddingProvider",
    "DescriptorEmbeddingProvider",
    "NvidiaESM2Provider",
    "resolve_embedding_provider",
    "EmbeddingApplicability",
    "embedding_applicability",
    "EmbeddingStore",
    "LocalFilesystemStore",
    "resolve_embedding_store",
    "load_embedding",
    "POOLED",
    "PER_RESIDUE",
]
