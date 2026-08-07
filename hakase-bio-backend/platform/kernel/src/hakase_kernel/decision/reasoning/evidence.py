"""EvidenceRecord — one auditable object that answers the seven questions per output.

The mandate: every prediction, confidence, warning, and verdict Hakase shows must be
scientifically justifiable. Concretely, for every output a scientist should be able to ask:

  1. Why was this prediction made?        → prediction + method + drivers
  2. What evidence supports it?           → drivers / corroborating signals
  3. What data generated it?              → provenance (dataset, split, model version)
  4. What assumptions were made?          → assumptions (exchangeability, AD, mechanism)
  5. How reliable is it?                  → calibrated reliability (or honest "not estimable")
  6. When should Hakase abstain instead?  → abstain flag + reason (selective / OOD / AD)
  7. What experiment would reduce it?     → next_experiment (value-of-information)

This module does NOT compute those signals — it *composes* them from the rest of the
engine (:mod:`reasoning.reliability`, :mod:`reasoning.selective`, :mod:`reasoning.ood`)
and the platform's existing applicability-domain / conformal / SHAP outputs, into one
structured, serialisable record. Its single strong opinion is the abstain policy: if the
reliability is not estimable, or the point is out of applicability domain, or a
distribution shift is flagged, the record is marked ``abstain=True`` and carries the
reason — it never launders missing evidence into a confident-looking number.

It mirrors the platform's Evidence Object vocabulary (``FieldConfidence`` tier + numeric +
rationale, ``ApplicabilityDomain``, provenance) so it can feed the existing safety verdict
and UI without inventing a parallel schema.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .reliability import ReliabilityEstimate

__all__ = ["AbstainPolicy", "EvidenceRecord", "build_record"]


@dataclass(frozen=True)
class AbstainPolicy:
    """When to abstain. Any triggered clause forces abstention; all are auditable."""

    require_estimable_reliability: bool = True  # no calibrated reliability ⇒ abstain
    require_in_domain: bool = True  # out of applicability domain ⇒ abstain
    abstain_on_shift: bool = True  # flagged distribution shift ⇒ abstain
    min_reliability: float | None = None  # below this calibrated P(correct) ⇒ abstain


def _tier(reliability: ReliabilityEstimate | None) -> str:
    if reliability is None or not reliability.estimable or reliability.value is None:
        return "indeterminate"
    return {"High": "high", "Medium": "medium", "Low": "low"}.get(reliability.band, "indeterminate")


@dataclass(frozen=True)
class EvidenceRecord:
    """A complete, auditable justification for one model output (the seven questions)."""

    # 1 — the prediction and how it was produced
    endpoint: str
    prediction: Any
    method: str
    # 2 — supporting evidence
    drivers: list = field(default_factory=list)
    corroborating: list = field(default_factory=list)
    # 3 — data lineage
    provenance: dict = field(default_factory=dict)
    # 4 — assumptions
    assumptions: list = field(default_factory=list)
    # 5 — reliability (calibrated, or honestly not estimable)
    reliability: dict | None = None
    confidence_tier: str = "indeterminate"
    # 6 — abstention
    abstain: bool = False
    abstain_reasons: list = field(default_factory=list)
    # 7 — the experiment that would most reduce uncertainty
    next_experiment: dict | None = None
    # supporting context
    applicability: dict | None = None
    shift: dict | None = None
    interval: list | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    def summary(self) -> str:
        head = f"[{self.endpoint}] {self.prediction} — {self.confidence_tier} confidence"
        if self.abstain:
            head += f"  ⚠ ABSTAIN: {'; '.join(self.abstain_reasons)}"
        return head


def build_record(
    *,
    endpoint: str,
    prediction: Any,
    method: str,
    reliability: ReliabilityEstimate | None = None,
    applicability: dict | None = None,
    shift: dict | None = None,
    drivers: list | None = None,
    corroborating: list | None = None,
    provenance: dict | None = None,
    assumptions: list | None = None,
    next_experiment: dict | None = None,
    interval: list | None = None,
    policy: AbstainPolicy | None = None,
) -> EvidenceRecord:
    """Assemble an :class:`EvidenceRecord` and apply the abstain policy.

    ``applicability`` is expected in the platform's shape
    ``{"ad_in_domain": bool|None, "ad_tanimoto_nearest": float|None}``; ``shift`` in the
    shape from :func:`reasoning.ood.detect_shift`'s ``as_dict()``. Missing pieces are left
    explicit (``None``) rather than defaulted to something reassuring.
    """
    policy = policy or AbstainPolicy()
    reasons: list[str] = []

    rel_dict = reliability.as_dict() if reliability is not None else None
    if policy.require_estimable_reliability and (
        reliability is None or not reliability.estimable or reliability.value is None
    ):
        reasons.append(
            "reliability is not estimable (no calibration sample) — refusing to show a "
            "confidence number that cannot be justified"
        )
    if (
        policy.min_reliability is not None
        and reliability is not None
        and reliability.value is not None
    ):
        if reliability.value < policy.min_reliability:
            reasons.append(
                f"calibrated reliability {reliability.value:.2f} is below the required "
                f"{policy.min_reliability:.2f}"
            )

    if policy.require_in_domain and applicability is not None:
        in_dom = applicability.get("ad_in_domain")
        if in_dom is False:
            reasons.append(
                "compound is OUT of the model's applicability domain — the prediction is an "
                "extrapolation; confirm experimentally rather than trusting the number"
            )
        elif in_dom is None:
            reasons.append("applicability domain could not be determined")

    if policy.abstain_on_shift and shift is not None and shift.get("shifted"):
        reasons.append(
            "distribution shift flagged — exchangeability with the calibration set is "
            "doubtful, so the calibrated/conformal guarantees may not hold here"
        )

    assumptions = list(assumptions or [])
    # every calibrated/conformal claim in the stack rests on this — state it, always
    assumptions.append(
        "calibration and selective-risk guarantees assume the query is exchangeable with "
        "the held-out calibration set (checked by the shift block)"
    )

    return EvidenceRecord(
        endpoint=endpoint,
        prediction=prediction,
        method=method,
        drivers=list(drivers or []),
        corroborating=list(corroborating or []),
        provenance=dict(provenance or {}),
        assumptions=assumptions,
        reliability=rel_dict,
        confidence_tier=_tier(reliability),
        abstain=bool(reasons),
        abstain_reasons=reasons,
        next_experiment=next_experiment,
        applicability=applicability,
        shift=shift,
        interval=interval,
    )
