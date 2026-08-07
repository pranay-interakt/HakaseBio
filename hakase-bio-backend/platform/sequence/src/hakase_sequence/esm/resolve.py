"""Embedding provider resolution.

Default is the key-free descriptor provider. ``nvidia_esm2`` is selected only
when explicitly configured *and* a key is present; a missing key raises rather
than silently downgrading, so provenance always reflects what actually ran.
"""

from __future__ import annotations

from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure

from .base import EmbeddingProvider
from .descriptors import DescriptorEmbeddingProvider
from .esm2_nvidia import NvidiaESM2Provider


def resolve_embedding_provider(config: PlatformConfig | None = None) -> EmbeddingProvider:
    cfg = config or get_config()
    choice = cfg.embedding_provider
    if choice == "descriptors":
        return DescriptorEmbeddingProvider()
    if choice == "nvidia_esm2":
        return NvidiaESM2Provider(cfg)  # raises if no key
    raise ServiceFailure(
        f"Unknown EMBEDDING_PROVIDER '{choice}'.",
        failure_type=FailureType.CRITICAL,
        reason_code="bad_embedding_provider",
    )
