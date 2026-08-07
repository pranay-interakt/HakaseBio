"""MC-DC engine: orchestration of graph propagation, decision, and the
conformal-risk-control guarantee.

Typical lifecycle::

    engine = MCDCEngine(graph, thresholds, rho=0.5)
    m_cal, g_cal = engine.compute_scalars(readings_calibration)
    engine.calibrate(m_cal, g_cal, y_true_calibration, alpha=0.1)
    records = engine.decide(readings_query)      # certified Go / Watch / No-Go

The engine is representation-agnostic: it consumes per-compound lists of
:class:`mcdc.evidence.EndpointReading`. Clients that hold tabular historical data
can build those readings with :func:`readings_from_arrays`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .crc import CRCResult, calibrate_risk_control, false_advancement_loss
from .decision import Decision, DecisionThresholds, decide, read_scalars
from .evidence import EndpointReading, build_evidence
from .graph import CredalGraph
from .interval import Interval


@dataclass(frozen=True)
class DecisionRecord:
    decision: Decision
    liability: float  # m(x): worst-case upper credal bound over AOs
    ignorance: float  # g(x): worst-case credal width over AOs
    adverse_outcome_beliefs: dict[str, tuple[float, float]]
    rate_limiting_outcome: str  # AO node driving the decision
    certified_alpha: float | None  # bound this decision inherits, if calibrated


class MCDCEngine:
    def __init__(self, graph: CredalGraph, thresholds: DecisionThresholds, rho: float) -> None:
        if rho < 0.0:
            raise ValueError(f"rho must be >= 0, got {rho}")
        self.graph = graph
        self.thresholds = thresholds
        self.rho = rho
        self._crc: CRCResult | None = None

    # ------------------------------------------------------------------ core
    def _beliefs(self, readings: list[EndpointReading]) -> dict[str, Interval]:
        evidence = build_evidence(readings, self.rho)
        return self.graph.propagate(evidence)

    def compute_scalars(
        self, readings_per_compound: list[list[EndpointReading]]
    ) -> tuple[np.ndarray, np.ndarray]:
        """Propagate every compound and return ``(m, g)`` arrays."""
        m = np.empty(len(readings_per_compound), dtype=float)
        g = np.empty(len(readings_per_compound), dtype=float)
        for i, readings in enumerate(readings_per_compound):
            beliefs = self._beliefs(readings)
            m_up, _m_lo, g_i = read_scalars(beliefs, self.graph.adverse_outcomes)
            m[i], g[i] = m_up, g_i
        return m, g

    # --------------------------------------------------------------- calibrate
    def calibrate(
        self,
        m: np.ndarray,
        g: np.ndarray,
        y_true: np.ndarray,
        alpha: float,
        **kwargs,
    ) -> CRCResult:
        """Fit ``lam_hat`` via conformal risk control; store it for decisions."""
        self._crc = calibrate_risk_control(
            m,
            g,
            y_true,
            self.thresholds,
            alpha,
            loss_fn=kwargs.pop("loss_fn", false_advancement_loss),
            **kwargs,
        )
        return self._crc

    @property
    def crc_result(self) -> CRCResult:
        if self._crc is None:
            raise RuntimeError("engine is not calibrated; call calibrate() first")
        return self._crc

    @property
    def lam_hat(self) -> float:
        return self.crc_result.lam_hat

    # ------------------------------------------------------------------ decide
    def decide(self, readings_per_compound: list[list[EndpointReading]]) -> list[DecisionRecord]:
        """Return a certified decision record per compound. Requires calibration."""
        lam = self.lam_hat
        alpha = self.crc_result.alpha
        records: list[DecisionRecord] = []
        for readings in readings_per_compound:
            beliefs = self._beliefs(readings)
            m_up, m_lo, g = read_scalars(beliefs, self.graph.adverse_outcomes)
            d = decide(m_up, m_lo, g, lam, self.thresholds)
            ao_beliefs = {a: beliefs[a].as_tuple() for a in self.graph.adverse_outcomes}
            rate_limiting = max(self.graph.adverse_outcomes, key=lambda a: beliefs[a].hi)
            records.append(
                DecisionRecord(
                    decision=d,
                    liability=m_up,
                    ignorance=g,
                    adverse_outcome_beliefs=ao_beliefs,
                    rate_limiting_outcome=rate_limiting,
                    certified_alpha=alpha,
                )
            )
        return records


def readings_from_arrays(
    y_hat: np.ndarray,
    aleatoric: np.ndarray,
    reliability: np.ndarray,
    endpoint_nodes: list[str],
) -> list[list[EndpointReading]]:
    """Build per-compound reading lists from aligned ``(n_compounds, n_endpoints)`` arrays.

    This is the adapter for clients with tabular historical pipeline data: one row
    per compound, one column per endpoint. ``endpoint_nodes[j]`` names the
    key-event node observed by endpoint column ``j``.
    """
    y_hat = np.asarray(y_hat, dtype=float)
    aleatoric = np.asarray(aleatoric, dtype=float)
    reliability = np.asarray(reliability, dtype=float)
    if not (y_hat.shape == aleatoric.shape == reliability.shape):
        raise ValueError("y_hat, aleatoric, reliability must share shape")
    if y_hat.ndim != 2:
        raise ValueError("arrays must be 2D (n_compounds, n_endpoints)")
    if y_hat.shape[1] != len(endpoint_nodes):
        raise ValueError("endpoint_nodes length must match number of endpoint columns")

    out: list[list[EndpointReading]] = []
    for i in range(y_hat.shape[0]):
        row = [
            EndpointReading(
                node=endpoint_nodes[j],
                y_hat=float(y_hat[i, j]),
                aleatoric=float(aleatoric[i, j]),
                reliability=float(reliability[i, j]),
            )
            for j in range(y_hat.shape[1])
        ]
        out.append(row)
    return out
