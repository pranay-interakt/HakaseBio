"""Data-derived applicability-domain threshold — replacing the arbitrary Tanimoto 0.4.

THE HEURISTIC THIS REPLACES
───────────────────────────
`_ml_base.AD_THRESHOLD = 0.4` declares a molecule "in domain" iff its nearest-neighbour
Tanimoto similarity to the training set is ≥ 0.4. The 0.4 is a fixed global constant that
ignores how internally dense a given training set actually is — two endpoints with very
different chemical coverage get the same cutoff, which is not defensible.

THE DEFENSIBLE ALTERNATIVE (standard AD practice)
─────────────────────────────────────────────────
Derive the cutoff from the training set's OWN nearest-neighbour similarity distribution: a
query is in-domain if it is at least as close to the training set as training molecules are
to each other. Concretely (Sahigara et al. 2012; Klingspohn et al. 2017), compute each
training molecule's k-nearest-neighbour similarity, and set the in-domain threshold at a low
percentile of that distribution (default 5th percentile of the 1-NN similarity) — i.e. a
query is out-of-domain only if it is more isolated than 95% of the training set is from its
own neighbours. This is learned from data, per endpoint, with a clear definition, and it
degrades gracefully (a diverse training set gets a lower, more permissive cutoff; a tight
one gets a higher, stricter cutoff).

We keep the fixed 0.4 available as a documented floor so the derived cutoff can never become
absurdly permissive on a pathological training set, and we always report BOTH numbers with
their provenance so the change is auditable, never silent.

References
──────────
  • Sahigara F. et al. (2012) Comparison of different approaches to define the applicability
    domain of QSAR models. Molecules 17:4791.
  • Klingspohn W. et al. (2017) Efficiency of different measures for defining the
    applicability domain of classification models. J. Cheminform. 9:44.
  • Bemis G., Murcko M. (1996) The properties of known drugs. J. Med. Chem. 39:2887.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = ["ADThreshold", "derive_ad_threshold", "tanimoto_nearest"]

_FIXED_FLOOR = 0.4  # the legacy constant, retained only as a conservative floor


@dataclass(frozen=True)
class ADThreshold:
    threshold: float  # the derived in-domain Tanimoto cutoff actually used
    derived: float  # the raw data-derived value (before applying the floor)
    floor: float  # the legacy 0.4 floor
    percentile: float  # percentile of the training kNN-similarity distribution used
    k: int
    n_train: int
    method: str
    basis: str

    def as_dict(self) -> dict:
        return {
            "ad_threshold": round(self.threshold, 4),
            "ad_threshold_derived": round(self.derived, 4),
            "ad_threshold_floor": self.floor,
            "percentile": self.percentile,
            "k": self.k,
            "n_train": self.n_train,
            "method": self.method,
            "basis": self.basis,
        }


def _tanimoto_matrix_row(query_bits: np.ndarray, train_bits: np.ndarray) -> np.ndarray:
    """Tanimoto of one 0/1 query vector against every 0/1 training row. Pure, exact."""
    q = query_bits.astype(np.float32)
    T = train_bits.astype(np.float32)
    with np.errstate(
        divide="ignore", over="ignore", invalid="ignore"
    ):  # float32 matmul false-positive
        dot = T @ q
        union = q.sum() + T.sum(axis=1) - dot
        tani = np.where(union > 0, dot / union, 0.0)
    return tani


def tanimoto_nearest(query_bits: np.ndarray, train_bits: np.ndarray) -> float:
    """Max Tanimoto similarity of the query to any training molecule."""
    return float(_tanimoto_matrix_row(query_bits, train_bits).max())


def derive_ad_threshold(
    train_bits: np.ndarray,
    *,
    k: int = 1,
    percentile: float = 5.0,
    max_ref: int = 2000,
    seed: int = 0,
) -> ADThreshold:
    """Derive the in-domain cutoff from the training set's own kNN-similarity distribution.

    For each of up to ``max_ref`` sampled training molecules, compute its k-th nearest
    (excluding itself) Tanimoto similarity to the rest of the training set; the in-domain
    threshold is the ``percentile``-th percentile of those similarities, floored at the
    legacy 0.4. A query is in-domain iff its nearest-training Tanimoto ≥ this threshold.
    """
    T = np.asarray(train_bits, dtype=np.float32)
    if T.ndim != 2 or T.shape[0] < 3:
        raise ValueError("train_bits must be a 2D 0/1 matrix with >= 3 rows")
    n = T.shape[0]
    rng = np.random.default_rng(seed)
    idx = rng.choice(n, size=min(max_ref, n), replace=False)
    knn_sims = np.empty(idx.size, dtype=float)
    for i, gi in enumerate(idx):
        sims = _tanimoto_matrix_row(T[gi], T)
        sims[gi] = -1.0  # exclude self
        if k == 1:
            knn_sims[i] = float(sims.max())
        else:
            knn_sims[i] = float(np.sort(sims)[-k])  # k-th nearest
    derived = float(np.percentile(knn_sims, percentile))
    threshold = max(derived, _FIXED_FLOOR)
    return ADThreshold(
        threshold=threshold,
        derived=derived,
        floor=_FIXED_FLOOR,
        percentile=percentile,
        k=k,
        n_train=n,
        method=(
            f"{percentile:g}th percentile of training {k}-NN Tanimoto similarity, "
            f"floored at legacy {_FIXED_FLOOR} (Sahigara 2012)"
        ),
        basis=(
            "a query is in-domain iff it is at least as close to training as the least "
            "typical 95% of training molecules are to their own neighbours"
        ),
    )
