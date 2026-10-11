"""Similarity-weighted read-across over measured analogue values (GenRA-style).

The estimate for a query structure is the similarity-weighted mean of the measured values
of its nearest structural analogues:

    y_hat = sum(s_i * y_i) / sum(s_i)

where ``s_i`` is the ECFP4 Tanimoto similarity between the query and analogue *i*, and
``y_i`` is that analogue's measured value **in the scale the caller wants to average in**.
Potencies are averaged on the logarithmic scale (pIC50), so the caller transforms before
calling and back afterwards; this function does no unit or scale conversion of its own.

The applicability domain is part of the method, not an afterthought: the estimate exists
only when at least ``min_analogues`` analogues sit at or above ``min_similarity``.
Otherwise :class:`ReadAcross` returns no value and states why, and the caller must return
UNAVAILABLE rather than a number.

References:
  * Shah I, Liu J, Judson RS, Thomas RS, Patlewicz G. Systematically evaluating read-across
    prediction and performance using a local validity approach characterized by chemical
    structure and bioactivity information. Regul Toxicol Pharmacol. 2016;79:12-24.
    doi:10.1016/j.yrtph.2016.05.008
  * Helman G, Shah I, Patlewicz G. Transitioning the generalised read-across approach
    (GenRA) to quantitative predictions: a case study using acute oral toxicity data.
    Comput Toxicol. 2019;12:100097. doi:10.1016/j.comtox.2019.100097
  * Rogers D, Hahn M. Extended-connectivity fingerprints. J Chem Inf Model.
    2010;50(5):742-754. doi:10.1021/ci100050t  (ECFP4 / Morgan fingerprints)

The neighbourhood parameters are choices, not findings: they are recorded with every
result (:meth:`ReadAcrossParams.to_dict`) and no threshold is claimed optimal. Until a
pre-registered, held-out validation is published for an endpoint, this method makes no
accuracy claim for it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from rdkit import Chem
from rdkit.Chem import rdFingerprintGenerator

__all__ = [
    "FINGERPRINT_BITS",
    "FINGERPRINT_RADIUS",
    "ReadAcross",
    "ReadAcrossParams",
    "fingerprint",
    "read_across",
    "tanimoto",
]

#: ECFP4 (Morgan radius 2) over 2048 bits — the fingerprint of Rogers & Hahn 2010 as
#: implemented by RDKit.
FINGERPRINT_RADIUS = 2
FINGERPRINT_BITS = 2048
_GENERATOR = rdFingerprintGenerator.GetMorganGenerator(
    radius=FINGERPRINT_RADIUS, fpSize=FINGERPRINT_BITS
)


def fingerprint(mol: Chem.Mol) -> frozenset[int]:
    """The on-bits of the molecule's ECFP4 fingerprint."""
    return frozenset(_GENERATOR.GetFingerprint(mol).GetOnBits())


def tanimoto(a: frozenset[int], b: frozenset[int]) -> float:
    """Tanimoto (Jaccard) similarity of two fingerprints' on-bit sets.

    Two structures with no on-bits at all are defined as 0.0 rather than 1.0: an empty
    fingerprint carries no evidence of similarity.
    """
    if not a or not b:
        return 0.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


@dataclass(frozen=True, slots=True)
class ReadAcrossParams:
    """The neighbourhood this run used. Recorded with every result."""

    min_similarity: float = 0.5
    max_analogues: int = 10
    min_analogues: int = 3

    def __post_init__(self) -> None:
        if not 0.0 < self.min_similarity <= 1.0:
            raise ValueError("min_similarity must be in (0, 1]")
        if self.min_analogues < 1 or self.max_analogues < self.min_analogues:
            raise ValueError("need 1 <= min_analogues <= max_analogues")

    def to_dict(self) -> dict[str, Any]:
        return {
            "min_similarity": self.min_similarity,
            "max_analogues": self.max_analogues,
            "min_analogues": self.min_analogues,
            "fingerprint": f"ECFP{2 * FINGERPRINT_RADIUS}/{FINGERPRINT_BITS} bits",
            "similarity": "Tanimoto",
        }


@dataclass(frozen=True, slots=True)
class ReadAcross:
    """The outcome of one read-across: a value, or the reason there is none."""

    value: float | None
    used: tuple[int, ...]
    nearest_similarity: float | None
    low: float | None
    high: float | None
    reason: str | None = None

    @property
    def in_domain(self) -> bool:
        return self.value is not None


def read_across(
    similarities: Sequence[float],
    values: Sequence[float],
    params: ReadAcrossParams | None = None,
) -> ReadAcross:
    """Similarity-weighted mean of analogue values, or an abstention with its reason.

    ``similarities`` and ``values`` are parallel: entry *i* is one analogue's similarity to
    the query and its measured value in the averaging scale. The nearest ``max_analogues``
    analogues at or above ``min_similarity`` are used; ``used`` gives their indices in the
    input, so the caller can report exactly which analogues supported the number.
    """
    if len(similarities) != len(values):
        raise ValueError("similarities and values must be the same length")
    p = params or ReadAcrossParams()
    eligible = [i for i, s in enumerate(similarities) if s >= p.min_similarity]
    eligible.sort(key=lambda i: (-similarities[i], i))
    chosen = eligible[: p.max_analogues]
    nearest = similarities[chosen[0]] if chosen else (max(similarities) if similarities else None)
    if len(chosen) < p.min_analogues:
        return ReadAcross(
            value=None,
            used=tuple(chosen),
            nearest_similarity=nearest,
            low=None,
            high=None,
            reason=(
                f"{len(chosen)} analogue(s) at Tanimoto >= {p.min_similarity:g}; "
                f"{p.min_analogues} are required, so no value is predicted"
            ),
        )
    weights = sum(similarities[i] for i in chosen)
    estimate = sum(similarities[i] * values[i] for i in chosen) / weights
    used_values = [values[i] for i in chosen]
    return ReadAcross(
        value=estimate,
        used=tuple(chosen),
        nearest_similarity=nearest,
        low=min(used_values),
        high=max(used_values),
    )
