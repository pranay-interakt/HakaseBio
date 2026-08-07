"""Evidence layer: convert calibrated endpoint predictions into credal intervals
attached to key-event nodes, with epistemic inflation driven by per-instance
applicability.

Each machine-learning endpoint ``k`` observes exactly one key-event node. For a
compound it emits:

* ``y_hat``  -- a calibrated probability that the key event is activated
               (equivalently, that the endpoint liability exceeds its decision
               threshold), in ``[0, 1]``;
* ``aleatoric`` -- an irreducible (assay-noise) half-width in ``[0, 1]``;
* ``reliability`` -- a per-instance applicability weight in ``[0, 1]`` supplied
               by :mod:`mcdc.reliability` (1 = fully in-domain, 0 = fully
               out-of-domain).

The credal observation is

    center      = y_hat
    half_width  = aleatoric + rho * (1 - reliability)
    interval    = clamp([center - half_width, center + half_width], 0, 1)

so that an out-of-domain endpoint contributes a *wide* (ignorant) interval rather
than a confident point. ``rho`` is the epistemic inflation scale.
"""

from __future__ import annotations

from dataclasses import dataclass

from .interval import Interval, combine_consensus, point_with_halfwidth


@dataclass(frozen=True)
class EndpointReading:
    """A single endpoint's per-compound output, prior to credal encoding."""

    node: str
    y_hat: float
    aleatoric: float
    reliability: float

    def __post_init__(self) -> None:
        if not (0.0 <= self.y_hat <= 1.0):
            raise ValueError(f"y_hat must lie in [0, 1], got {self.y_hat}")
        if self.aleatoric < 0.0:
            raise ValueError(f"aleatoric half-width must be >= 0, got {self.aleatoric}")
        if not (0.0 <= self.reliability <= 1.0):
            raise ValueError(f"reliability must lie in [0, 1], got {self.reliability}")


def encode_reading(reading: EndpointReading, rho: float) -> Interval:
    """Encode one endpoint reading as a credal interval."""
    if rho < 0.0:
        raise ValueError(f"rho (epistemic scale) must be >= 0, got {rho}")
    half = reading.aleatoric + rho * (1.0 - reading.reliability)
    return point_with_halfwidth(reading.y_hat, half)


def build_evidence(readings: list[EndpointReading], rho: float) -> dict[str, Interval]:
    """Aggregate endpoint readings into one credal interval per observed node.

    Multiple endpoints observing the same node are fused with
    :func:`combine_consensus`: mutually consistent readings narrow belief, while
    conflicting readings widen it. This is the principled, calibration-friendly
    replacement for Dempster's rule of combination.
    """
    by_node: dict[str, list[Interval]] = {}
    for r in readings:
        by_node.setdefault(r.node, []).append(encode_reading(r, rho))
    return {node: combine_consensus(ivs) for node, ivs in by_node.items()}
