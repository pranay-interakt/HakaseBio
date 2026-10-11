"""What a triage run produces.

A triage report is a list of :class:`Signal` objects, each the result of one screen over
one compound. A signal says what was looked at, what was found, and on what evidence —
matched substructures, or the measured analogues a prediction was drawn from.

Three rules hold for everything in this module:

* Every number is a :class:`~hos.core.quantity.Quantity`, so it carries its provenance.
  A screen that computes nothing carries no number.
* A screen that cannot answer says so (:data:`Outcome.NOT_PREDICTABLE`) with the reason.
  It never fills the gap with a default, an average or a plausible-looking value.
* Nothing here is evidence. A triage report informs a decision about what to run next;
  it is never written into a study record, counted towards readiness, or exported in a
  submission. See ``docs/16_in_silico_triage.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from hos.core.provenance import Citation
from hos.core.quantity import Quantity

__all__ = ["AlertMatch", "Analogue", "Outcome", "Signal", "TriageReport"]


class Outcome(str, Enum):
    """What one screen concluded.

    ``ALERTING``/``NO_ALERT`` are deterministic substructure results. ``MEASURED`` means
    the endpoint has already been measured for this compound and is reported rather than
    estimated. ``PREDICTED`` is a model estimate inside its applicability domain.
    ``NOT_PREDICTABLE`` is the honest answer when the screen could not reach one — too few
    analogues, no structure, or the source could not be reached — and always carries a
    reason.
    """

    ALERTING = "alerting"
    NO_ALERT = "no_alert"
    MEASURED = "measured"
    PREDICTED = "predicted"
    NOT_PREDICTABLE = "not_predictable"

    @property
    def is_answer(self) -> bool:
        return self is not Outcome.NOT_PREDICTABLE


@dataclass(frozen=True, slots=True)
class AlertMatch:
    """One substructure match: which alert, from which published set, and where it hit.

    ``atom_indices`` are indices into the compound's canonical structure, so a reviewer
    can see exactly which atoms matched rather than taking the label on trust.
    """

    alert: str
    alert_set: str
    scope: str
    reference: str
    atom_indices: tuple[int, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "alert": self.alert,
            "alert_set": self.alert_set,
            "scope": self.scope,
            "reference": self.reference,
            "atom_indices": list(self.atom_indices),
        }


@dataclass(frozen=True, slots=True)
class Analogue:
    """A measured compound that supported a read-across prediction.

    The analogue's own value is the real measurement it was drawn from, with its own
    provenance; ``similarity`` is the computed Tanimoto to the query structure.
    """

    identifier: str
    name: str | None
    smiles: str
    similarity: float
    value: Quantity
    n_measurements: int = 1
    source_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "identifier": self.identifier,
            "name": self.name,
            "smiles": self.smiles,
            "similarity": round(self.similarity, 4),
            "value": self.value.to_dict(),
            "n_measurements": self.n_measurements,
            "source_url": self.source_url,
        }


@dataclass(frozen=True, slots=True)
class Signal:
    """The result of one screen.

    ``quantity`` is present only when the screen produced a number; it is COMPUTED for a
    deterministic screen and PREDICTED for a model estimate. ``limits`` travels with the
    signal so what the result does not establish is read alongside what it does.
    """

    id: str
    title: str
    outcome: Outcome
    summary: str
    quantity: Quantity | None = None
    alerts: tuple[AlertMatch, ...] = ()
    analogues: tuple[Analogue, ...] = ()
    limits: tuple[str, ...] = ()
    citations: tuple[Citation, ...] = ()
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.outcome is Outcome.NOT_PREDICTABLE and not self.reason:
            raise ValueError(
                f"signal {self.id!r} is not predictable and must say why; a screen that "
                "cannot answer states the reason rather than returning a value"
            )
        if self.outcome is Outcome.PREDICTED and self.quantity is None:
            raise ValueError(f"signal {self.id!r} claims a prediction but carries no quantity")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "outcome": self.outcome.value,
            "summary": self.summary,
            "quantity": self.quantity.to_dict() if self.quantity else None,
            "alerts": [a.to_dict() for a in self.alerts],
            "analogues": [a.to_dict() for a in self.analogues],
            "limits": list(self.limits),
            "citations": [c.to_dict() for c in self.citations],
            "reason": self.reason,
        }


#: Carried on every report, and shown with it, so the standing limitation is never
#: separated from the result.
STANDING_LIMITATION = (
    "In silico triage is decision support for choosing and designing studies. It is not "
    "evidence, is never part of a study record or a submission, and no accuracy is claimed "
    "for any signal until a pre-registered, held-out validation is published for it."
)


@dataclass(frozen=True, slots=True)
class TriageReport:
    """Every signal for one compound, with the structure they were computed from."""

    compound_id: str
    program_id: str
    canonical_smiles: str
    signals: tuple[Signal, ...] = field(default_factory=tuple)
    limitation: str = STANDING_LIMITATION

    def to_dict(self) -> dict[str, Any]:
        return {
            "compound_id": self.compound_id,
            "program_id": self.program_id,
            "canonical_smiles": self.canonical_smiles,
            "signals": [s.to_dict() for s in self.signals],
            "limitation": self.limitation,
        }
