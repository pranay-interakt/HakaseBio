"""Difference between two derived study sets (docs/14 P10).

Answers "what changes in our nonclinical package if the programme changes?": e.g. a longer
clinical trial, a new population, a switch to advanced-cancer development. Every entry
names the guideline section that drives it, taken from the rules engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from hos.core.regulatory.context import ProgramContext
from hos.core.regulatory.engine import StudyRequirement, StudySet, derive_study_set

__all__ = ["RequirementChange", "StudySetDiff", "diff_contexts", "diff_study_sets"]


@dataclass(frozen=True, slots=True)
class RequirementChange:
    requirement_id: str
    name: str
    change: str  # added | removed | lengthened | shortened | retimed | status | species | glp
    before: Any = None
    after: Any = None
    section_before: str | None = None
    section_after: str | None = None
    rationale: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"requirement_id": self.requirement_id, "name": self.name, "change": self.change,
                "before": self.before, "after": self.after,
                "section_before": self.section_before, "section_after": self.section_after,
                "rationale": self.rationale}


@dataclass(frozen=True, slots=True)
class StudySetDiff:
    context_changes: dict[str, tuple[Any, Any]]
    changes: tuple[RequirementChange, ...] = field(default_factory=tuple)

    @property
    def unchanged(self) -> bool:
        return not self.changes

    def to_dict(self) -> dict[str, Any]:
        kinds: dict[str, int] = {}
        for c in self.changes:
            kinds[c.change] = kinds.get(c.change, 0) + 1
        return {"context_changes": {k: {"before": a, "after": b}
                                    for k, (a, b) in self.context_changes.items()},
                "changes": [c.to_dict() for c in self.changes], "summary": kinds}


def _active(r: StudyRequirement) -> bool:
    return r.status.value != "not_required"


def diff_study_sets(a: StudySet, b: StudySet) -> StudySetDiff:
    ca, cb = a.context.to_dict(), b.context.to_dict()
    ctx_changes = {k: (ca.get(k), cb.get(k)) for k in sorted(set(ca) | set(cb))
                   if ca.get(k) != cb.get(k)}
    ra = {r.id: r for r in a.requirements}
    rb = {r.id: r for r in b.requirements}
    out: list[RequirementChange] = []
    for rid in sorted(set(ra) | set(rb)):
        x, y = ra.get(rid), rb.get(rid)
        if x is None or (y is not None and not _active(x) and _active(y)):
            assert y is not None
            out.append(RequirementChange(rid, y.name, "added", None, y.status.value, None,
                                         y.section, y.rationale))
            continue
        if y is None or (not _active(y) and _active(x)):
            name = x.name
            out.append(RequirementChange(rid, name, "removed", x.status.value,
                                         y.status.value if y else None, x.section,
                                         y.section if y else None,
                                         y.rationale if y else "no longer derived"))
            continue
        if x.status is not y.status:
            out.append(RequirementChange(rid, y.name, "status", x.status.value, y.status.value,
                                         x.section, y.section, y.rationale))
        if x.duration_weeks != y.duration_weeks and x.duration_weeks and y.duration_weeks:
            kind = "lengthened" if y.duration_weeks > x.duration_weeks else "shortened"
            out.append(RequirementChange(rid, y.name, kind, x.duration_weeks, y.duration_weeks,
                                         x.section, y.section, y.rationale))
        if x.timing is not y.timing:
            out.append(RequirementChange(rid, y.name, "retimed", x.timing.value, y.timing.value,
                                         x.section, y.section, y.rationale))
        if tuple(x.species) != tuple(y.species):
            out.append(RequirementChange(rid, y.name, "species", list(x.species),
                                         list(y.species), x.section, y.section, y.rationale))
        if x.glp != y.glp:
            out.append(RequirementChange(rid, y.name, "glp", x.glp, y.glp, x.section, y.section,
                                         y.rationale))
    return StudySetDiff(context_changes=ctx_changes, changes=tuple(out))


def diff_contexts(a: ProgramContext, b: ProgramContext) -> StudySetDiff:
    return diff_study_sets(derive_study_set(a), derive_study_set(b))
