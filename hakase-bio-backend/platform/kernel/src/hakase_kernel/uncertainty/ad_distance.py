"""Distance-based applicability domain (kernel, S1-T4).

Answers "is this query close enough to the training set to trust the model, or
are we extrapolating?" as a three-state verdict: ``in`` / ``edge`` / ``out``.
The PBPK layer gates on this (S1-T6 refuses out-of-domain rather than returning a
confidently-wrong number); the states line up with the S1-T1 contract's
``DomainVerdict``.

Modality-agnostic by construction: it operates on **numeric feature vectors**, not
molecules. A modality computes its own descriptors or fingerprints (RDKit lives in
the modality, never here) and hands the kernel plain arrays. Two metrics:

  * ``euclidean`` — continuous descriptors, standardised by the training mean/SD;
    nearest-neighbour distance is compared to thresholds calibrated from the
    training set's own leave-one-out NN-distance distribution (percentiles).
  * ``tanimoto`` — binary fingerprints; nearest-neighbour Tanimoto similarity is
    compared to fixed thresholds (default 0.65 / 0.40, the Jaworska 2005 / Sheridan
    2012 QSAR convention).

Every verdict carries a ``score`` in ``[0, 1]`` where higher = more in-domain, so
callers get one comparable closeness number regardless of metric.

Pure ``numpy`` + stdlib. No RDKit, no SMILES.

References
----------
- Jaworska et al. (2005) ATLA 33:445 — AD definition for QSAR models
- Netzeva et al. (2005) ATLA 33:155 — OECD guidance on AD
- Sheridan (2012) J Chem Inf Model 52:814 — Tanimoto AD for RF models
"""

from __future__ import annotations

from enum import Enum

import numpy as np

DEFAULT_IN_SIMILARITY = 0.65
DEFAULT_EDGE_SIMILARITY = 0.40
DEFAULT_IN_PERCENTILE = 95.0
DEFAULT_EDGE_PERCENTILE = 99.0


class DomainState(str, Enum):
    """Three-state applicability-domain verdict (matches the S1-T1 contract)."""

    IN = "in"
    EDGE = "edge"
    OUT = "out"


class ADError(ValueError):
    """Invalid applicability-domain configuration or query."""


class DomainVerdict:
    """One query's verdict. ``score`` in ``[0, 1]`` (higher = more in-domain)."""

    __slots__ = ("state", "score", "distance", "nearest_index", "metric")

    def __init__(
        self, state: DomainState, score: float, distance: float, nearest_index: int, metric: str
    ) -> None:
        self.state = state
        self.score = score
        self.distance = distance
        self.nearest_index = nearest_index
        self.metric = metric

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return (
            f"DomainVerdict(state={self.state.value!r}, score={self.score:.3f}, "
            f"distance={self.distance:.3f}, nearest_index={self.nearest_index}, "
            f"metric={self.metric!r})"
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "state": self.state.value,
            "score": self.score,
            "distance": self.distance,
            "nearest_index": self.nearest_index,
            "metric": self.metric,
        }


def _euclidean_loo_nn_distances(standardized: np.ndarray) -> np.ndarray:
    """Leave-one-out nearest-neighbour distance for each reference row."""
    n = standardized.shape[0]
    if n < 2:
        return np.zeros(n, dtype=float)
    diff = standardized[:, None, :] - standardized[None, :, :]
    dist = np.sqrt((diff * diff).sum(axis=-1))
    np.fill_diagonal(dist, np.inf)
    return dist.min(axis=1)


class ApplicabilityDomain:
    """A fitted applicability-domain classifier over a training feature set."""

    def __init__(
        self,
        metric: str,
        reference: np.ndarray,
        in_threshold: float,
        edge_threshold: float,
        *,
        mean: np.ndarray | None = None,
        std: np.ndarray | None = None,
    ) -> None:
        # `higher_is_in` distinguishes similarity (tanimoto) from distance (euclidean).
        self.metric = metric
        self._reference = reference
        self._in_threshold = in_threshold
        self._edge_threshold = edge_threshold
        self._mean = mean
        self._std = std
        self._higher_is_in = metric == "tanimoto"

    # -- fitting ------------------------------------------------------------ #
    @classmethod
    def fit(
        cls,
        reference: object,
        *,
        metric: str = "euclidean",
        standardize: bool = True,
        in_threshold: float | None = None,
        edge_threshold: float | None = None,
        in_percentile: float = DEFAULT_IN_PERCENTILE,
        edge_percentile: float = DEFAULT_EDGE_PERCENTILE,
        in_similarity: float = DEFAULT_IN_SIMILARITY,
        edge_similarity: float = DEFAULT_EDGE_SIMILARITY,
    ) -> ApplicabilityDomain:
        """Fit to a ``(n_samples, n_features)`` training matrix.

        ``euclidean`` thresholds default to the ``in_percentile`` / ``edge_percentile``
        of the training set's own leave-one-out NN distances (in standardised space);
        ``tanimoto`` thresholds default to ``in_similarity`` / ``edge_similarity``.
        Explicit ``in_threshold`` / ``edge_threshold`` override the defaults.
        ``standardize`` (euclidean only) z-scores features by the training mean/SD;
        turn it off to work in the raw feature space.
        """
        arr = np.asarray(reference, dtype=float)
        if arr.ndim != 2 or arr.shape[0] < 1:
            raise ADError(f"reference must be a non-empty 2-D array, got shape {arr.shape}")

        if metric == "tanimoto":
            ref_bool = arr != 0.0
            in_t = in_threshold if in_threshold is not None else in_similarity
            edge_t = edge_threshold if edge_threshold is not None else edge_similarity
            cls._check_order(in_t, edge_t, higher_is_in=True)
            return cls("tanimoto", ref_bool, in_t, edge_t)

        if metric == "euclidean":
            if standardize:
                mean = arr.mean(axis=0)
                std = arr.std(axis=0)
                std = np.where(std > 0.0, std, 1.0)  # guard constant features
            else:
                mean = np.zeros(arr.shape[1])
                std = np.ones(arr.shape[1])
            standardized = (arr - mean) / std
            if in_threshold is None or edge_threshold is None:
                loo = _euclidean_loo_nn_distances(standardized)
                in_t = (
                    in_threshold
                    if in_threshold is not None
                    else float(np.percentile(loo, in_percentile))
                )
                edge_t = (
                    edge_threshold
                    if edge_threshold is not None
                    else float(np.percentile(loo, edge_percentile))
                )
            else:
                in_t, edge_t = in_threshold, edge_threshold
            cls._check_order(in_t, edge_t, higher_is_in=False)
            return cls("euclidean", standardized, in_t, edge_t, mean=mean, std=std)

        raise ADError(f"metric must be 'euclidean' or 'tanimoto', got {metric!r}")

    @staticmethod
    def _check_order(in_t: float, edge_t: float, *, higher_is_in: bool) -> None:
        if higher_is_in:
            if not (in_t >= edge_t):
                raise ADError(f"in_threshold ({in_t}) must be >= edge_threshold ({edge_t})")
        else:
            if not (in_t <= edge_t):
                raise ADError(f"in_threshold ({in_t}) must be <= edge_threshold ({edge_t})")

    # -- classification ----------------------------------------------------- #
    def classify(self, query: object) -> DomainVerdict:
        """Classify a single feature vector as in / edge / out of domain."""
        q = np.asarray(query, dtype=float).ravel()
        if q.shape[0] != self._reference.shape[1]:
            raise ADError(
                f"query has {q.shape[0]} features, reference has {self._reference.shape[1]}"
            )
        if self.metric == "tanimoto":
            return self._classify_tanimoto(q)
        return self._classify_euclidean(q)

    def classify_many(self, queries: object) -> list[DomainVerdict]:
        arr = np.asarray(queries, dtype=float)
        if arr.ndim != 2:
            raise ADError("queries must be a 2-D array")
        return [self.classify(row) for row in arr]

    def _classify_euclidean(self, q: np.ndarray) -> DomainVerdict:
        qs = (q - self._mean) / self._std
        diff = self._reference - qs
        dist = np.sqrt((diff * diff).sum(axis=1))
        idx = int(np.argmin(dist))
        d = float(dist[idx])
        if d <= self._in_threshold:
            state = DomainState.IN
        elif d <= self._edge_threshold:
            state = DomainState.EDGE
        else:
            state = DomainState.OUT
        # Closeness score: 1 at zero distance, 0.5 at the in-threshold.
        scale = self._in_threshold if self._in_threshold > 0.0 else 1.0
        score = scale / (scale + d)
        return DomainVerdict(state, float(score), d, idx, "euclidean")

    def _classify_tanimoto(self, q: np.ndarray) -> DomainVerdict:
        qb = q != 0.0
        ref = self._reference  # bool matrix
        inter = np.logical_and(ref, qb).sum(axis=1)
        union = np.logical_or(ref, qb).sum(axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            sims = np.where(union > 0, inter / union, 0.0)
        idx = int(np.argmax(sims))
        sim = float(sims[idx])
        if sim >= self._in_threshold:
            state = DomainState.IN
        elif sim >= self._edge_threshold:
            state = DomainState.EDGE
        else:
            state = DomainState.OUT
        return DomainVerdict(state, sim, 1.0 - sim, idx, "tanimoto")


__all__ = [
    "DomainState",
    "DomainVerdict",
    "ApplicabilityDomain",
    "ADError",
    "DEFAULT_IN_SIMILARITY",
    "DEFAULT_EDGE_SIMILARITY",
    "DEFAULT_IN_PERCENTILE",
    "DEFAULT_EDGE_PERCENTILE",
]
