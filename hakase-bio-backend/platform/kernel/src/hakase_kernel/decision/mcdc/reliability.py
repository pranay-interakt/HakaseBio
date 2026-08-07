"""Per-instance applicability -> reliability weighting.

For each endpoint model we need a graded, per-compound statement of how far the
query compound sits from the region where that model was calibrated. The field's
usual answer is a binary in/out applicability-domain flag; here it is a
continuous reliability weight in ``[0, 1]`` that feeds the epistemic width of the
credal evidence (see :mod:`mcdc.evidence`).

The default scorer uses a k-nearest-neighbour non-conformity in the endpoint's
own feature space: the mean distance to the ``k`` nearest calibration compounds.
Distances are converted to a reliability weight with a smooth, monotone map
calibrated against the distribution of calibration-set distances, so the scale is
data-driven rather than an arbitrary threshold.

This is *not* a claim that "near = correct". It is a claim that distance is a
usable, monotone proxy for reducible ignorance, and the downstream conformal risk
control does not rely on it being correct -- only the efficiency of the decision
does.
"""

from __future__ import annotations

import numpy as np
from sklearn.neighbors import NearestNeighbors


class KNNApplicabilityScorer:
    """k-NN distance-based applicability scorer for one endpoint model.

    Parameters
    ----------
    k:
        Number of neighbours used to compute the non-conformity distance.
    metric:
        Any metric accepted by :class:`sklearn.neighbors.NearestNeighbors`.
    """

    def __init__(self, k: int = 10, metric: str = "euclidean") -> None:
        if k < 1:
            raise ValueError(f"k must be >= 1, got {k}")
        self.k = k
        self.metric = metric
        self._nn: NearestNeighbors | None = None
        self._d_ref: float | None = None  # typical in-sample distance (median)
        self._spread: float | None = None  # robust spread of in-sample distances

    def fit(self, features: np.ndarray) -> KNNApplicabilityScorer:
        """Fit on the endpoint's calibration feature matrix ``(n_samples, n_dim)``."""
        features = np.asarray(features, dtype=float)
        if features.ndim != 2:
            raise ValueError("features must be a 2D array (n_samples, n_dim)")
        n = features.shape[0]
        if n <= self.k:
            raise ValueError(f"need more than k={self.k} calibration points, got {n}")
        self._nn = NearestNeighbors(n_neighbors=self.k, metric=self.metric)
        self._nn.fit(features)
        # Reference distribution of in-sample k-NN distances (exclude self at idx 0).
        dists, _ = self._nn.kneighbors(features)
        in_sample = dists[:, 1:].mean(axis=1) if self.k > 1 else dists[:, 0]
        d_ref = float(np.median(in_sample))
        # Robust spread (median absolute deviation, scaled to a std-equivalent).
        mad = float(np.median(np.abs(in_sample - d_ref)))
        spread = 1.4826 * mad
        if spread <= 0.0:
            # Fall back to the interquartile-based spread, then to std; never to a
            # silent constant. If the features are truly degenerate we raise.
            spread = float(np.subtract(*np.percentile(in_sample, [75, 25])))
        if spread <= 0.0:
            spread = float(np.std(in_sample))
        if spread <= 0.0:
            raise ValueError(
                "calibration features are degenerate (identical points); "
                "cannot define an applicability scale"
            )
        self._d_ref = d_ref
        self._spread = spread
        return self

    def reliability(self, features: np.ndarray) -> np.ndarray:
        """Return per-compound reliability weights in ``[0, 1]``.

        weight = exp( -max(0, d - d_ref) / spread ), where ``d`` is the mean
        distance to the ``k`` nearest calibration compounds, ``d_ref`` is the
        median in-sample distance, and ``spread`` is a robust scale of the
        in-sample distances. Compounds within the normal in-domain range
        (``d <= d_ref``) score ~1; reliability decays only as a compound moves
        into the tail and beyond the calibration manifold. This is calibrated to
        the training distribution rather than an arbitrary threshold.
        """
        if self._nn is None or self._d_ref is None or self._spread is None:
            raise RuntimeError("scorer must be fit before calling reliability()")
        features = np.asarray(features, dtype=float)
        if features.ndim != 2:
            raise ValueError("features must be a 2D array (n_samples, n_dim)")
        dists, _ = self._nn.kneighbors(features)
        d = dists.mean(axis=1)
        excess = np.maximum(0.0, d - self._d_ref)
        return np.exp(-excess / self._spread)
