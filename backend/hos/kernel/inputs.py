"""Reconstruction of external analysis inputs from their stored specification.

Shared by the kernel and the offline verifier (``hos-verify``) so that a recomputation uses
exactly the same provenance as the original analysis.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from hos.core.provenance import Citation
from hos.core.quantity import Quantity
from hos.kernel.errors import KernelError

__all__ = ["input_quantity"]


def input_quantity(name: str, spec: Mapping[str, Any], actor_name: str | None = None) -> Quantity:
    """``spec`` = ``{"value", "unit", "kind": measured|literature|user_supplied, "source",
    "url"?, "doi"?, "note"?, "entered_by"?}``."""
    try:
        value = float(spec["value"])
        unit = str(spec["unit"])
    except (KeyError, TypeError, ValueError):
        raise KernelError(f"{name}: an input needs a numeric value and a unit") from None
    kind = spec.get("kind", "user_supplied")
    source = spec.get("source")
    if kind == "measured":
        if not source:
            raise KernelError(f"{name}: a measured input must name its source study/assay")
        return Quantity.measured(
            value, unit, source_name=str(source), label=name, notes=spec.get("note")
        )
    if kind == "literature":
        if not source:
            raise KernelError(f"{name}: a literature input must name its source")
        cit = Citation(
            key=f"input:{name}", text=str(source), url=spec.get("url"), doi=spec.get("doi")
        )
        return Quantity.literature(
            value,
            unit,
            source_name=str(source),
            citation=cit,
            source_url=spec.get("url"),
            label=name,
            notes=spec.get("note"),
        )
    if kind == "user_supplied":
        who = spec.get("entered_by") or actor_name
        if not who:
            raise KernelError(f"{name}: a user-supplied input must be attributable")
        return Quantity.user_supplied(
            value, unit, actor=str(who), label=name, notes=spec.get("note")
        )
    raise KernelError(f"{name}: unknown input kind {kind!r}")
