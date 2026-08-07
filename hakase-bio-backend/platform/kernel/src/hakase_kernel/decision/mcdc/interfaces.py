"""Production integration contracts.

These abstract base classes are the seams a client implements to connect MC-DC to
a real pipeline. The engine never fabricates predictions or applicability scores:
it calls these interfaces, which the client backs with real models and real
calibration data. There are no default numeric stand-ins.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


class EndpointModel(ABC):
    """A single calibrated ADMET / toxicity endpoint mapped to one key-event node.

    Implementations wrap the client's own trained model. ``predict`` must return
    *calibrated* probabilities (e.g. via Venn--Abers or temperature scaling) that
    the key event is activated, together with an aleatoric (assay-noise)
    half-width per compound.
    """

    #: Identifier of the key-event node this endpoint observes.
    node: str

    @abstractmethod
    def predict(self, features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Return ``(y_hat, aleatoric)`` arrays for a feature matrix.

        ``y_hat`` and ``aleatoric`` are both in ``[0, 1]`` with shape
        ``(n_samples,)``.
        """
        raise NotImplementedError


class ApplicabilityScorer(ABC):
    """Per-instance reliability scorer for one endpoint (see
    :class:`mcdc.reliability.KNNApplicabilityScorer` for the default)."""

    @abstractmethod
    def fit(self, features: np.ndarray) -> ApplicabilityScorer:
        raise NotImplementedError

    @abstractmethod
    def reliability(self, features: np.ndarray) -> np.ndarray:
        """Return per-compound reliability weights in ``[0, 1]``."""
        raise NotImplementedError
