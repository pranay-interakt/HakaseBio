"""Value of Information: turn an abstention ("Watch") into an experiment plan.

This is a capability no scalar-uncertainty pipeline can offer, and it falls out
of the credal structure for free. Because MC-DC represents each endpoint's
reducible (epistemic) ignorance as *interval width*, we can ask a question the
rest of the field cannot phrase precisely:

    "For this specific compound, which single confirmatory assay -- if we ran it
     and removed that endpoint's uncertainty -- would most reduce the ignorance
     that is blocking the decision, and could it flip a Watch into a Go or No-Go?"

Method. For a query compound with credal beliefs, we counterfactually *resolve*
one endpoint at a time: collapse that endpoint's contributed interval to its
point estimate (the effect of running the confirmatory experiment), re-propagate
the graph, and measure the resulting drop in decision ignorance ``g(x)`` and any
change in the decision. Endpoints are then ranked by the ignorance they control.

This is optimal-experiment-design reasoning applied at the *decision* level rather
than the model-training level, and it converts the framework's honest "I don't
know" into a concrete, prioritised next step in the lab.
"""

from __future__ import annotations

from dataclasses import dataclass

from .decision import Decision, DecisionThresholds, decide, read_scalars
from .evidence import EndpointReading, build_evidence
from .graph import CredalGraph


@dataclass(frozen=True)
class ExperimentValue:
    endpoint_node: str
    ignorance_before: float
    ignorance_after: float
    ignorance_reduction: float  # g(x) drop if this endpoint is resolved
    decision_before: Decision
    decision_after: Decision  # decision if this endpoint were resolved
    would_change_decision: bool

    def as_dict(self) -> dict:
        return {
            "endpoint_node": self.endpoint_node,
            "ignorance_reduction": round(self.ignorance_reduction, 4),
            "would_change_decision": self.would_change_decision,
            "decision_after": self.decision_after.value,
        }


def _resolve_reading(r: EndpointReading) -> EndpointReading:
    """Simulate running the confirmatory assay for endpoint ``r``: the aleatoric
    noise remains but the epistemic component is removed (reliability -> 1)."""
    return EndpointReading(node=r.node, y_hat=r.y_hat, aleatoric=r.aleatoric, reliability=1.0)


def rank_experiments(
    graph: CredalGraph,
    thresholds: DecisionThresholds,
    rho: float,
    readings: list[EndpointReading],
    lam: float,
) -> list[ExperimentValue]:
    """Rank the endpoints by how much resolving each would reduce decision ignorance.

    Parameters mirror the engine's configuration. ``lam`` is the calibrated policy
    parameter (``engine.lam_hat``). Returns one :class:`ExperimentValue` per
    endpoint reading, sorted by ignorance reduction (largest first).
    """
    if not readings:
        raise ValueError("readings must be non-empty")

    beliefs0 = graph.propagate(build_evidence(readings, rho))
    m0_up, m0_lo, g0 = read_scalars(beliefs0, graph.adverse_outcomes)
    d0 = decide(m0_up, m0_lo, g0, lam, thresholds)

    values: list[ExperimentValue] = []
    for i, r in enumerate(readings):
        counterfactual = list(readings)
        counterfactual[i] = _resolve_reading(r)
        beliefs = graph.propagate(build_evidence(counterfactual, rho))
        m_up, m_lo, g = read_scalars(beliefs, graph.adverse_outcomes)
        d = decide(m_up, m_lo, g, lam, thresholds)
        values.append(
            ExperimentValue(
                endpoint_node=r.node,
                ignorance_before=g0,
                ignorance_after=g,
                ignorance_reduction=max(0.0, g0 - g),
                decision_before=d0,
                decision_after=d,
                would_change_decision=(d != d0),
            )
        )
    values.sort(key=lambda v: v.ignorance_reduction, reverse=True)
    return values
