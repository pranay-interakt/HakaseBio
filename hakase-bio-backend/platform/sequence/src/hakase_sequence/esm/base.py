"""Embedding provider interface."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EmbeddingResult:
    sequence: str
    mean_vector: list[float]  # pooled representation
    dim: int
    model_id: str
    model_version: str
    provider: str
    per_residue: list[list[float]] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class EmbeddingProvider(abc.ABC):
    name: str
    model_id: str
    model_version: str

    # True for a genuine learned protein-language-model embedding (e.g. ESM2);
    # False for the deterministic descriptor *surrogate*. This distinction drives
    # payload completeness and the embedding confidence tier: only a real PLM that
    # emits both a pooled vector and a per-residue matrix yields a "complete"
    # object; the surrogate is reported as "partially_complete" / tier "reduced"
    # (roadmap "Decisions (locked)").
    is_plm: bool = False

    @abc.abstractmethod
    def embed(self, sequence: str) -> EmbeddingResult: ...
