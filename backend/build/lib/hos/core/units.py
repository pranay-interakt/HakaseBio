"""Unit handling.

A single :mod:`pint` registry is shared by the whole scientific core so that unit
conversions are real dimensional algebra rather than hand-rolled factors. Unit
strings are validated at :class:`~hos.core.quantity.Quantity` construction, so a
dimensionally incoherent computation fails loudly instead of producing a
plausible-looking wrong number.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Final

import pint

__all__ = ["DIMENSIONLESS", "UREG", "compatible", "convert", "is_valid_unit", "parse_unit"]

UREG: Final[pint.UnitRegistry] = pint.UnitRegistry(autoconvert_offset_to_baseunit=False)
UREG.formatter.default_format = "~P"

DIMENSIONLESS: Final[str] = "dimensionless"


@lru_cache(maxsize=512)
def parse_unit(unit: str) -> pint.Unit:
    """Parse a unit string into a pint Unit. Raises ``ValueError`` if invalid."""
    if unit is None or not str(unit).strip():
        raise ValueError("unit must be a non-empty string (use 'dimensionless')")
    try:
        return UREG.parse_units(str(unit))
    except Exception as exc:  # pint raises several distinct types
        raise ValueError(f"unrecognised unit {unit!r}: {exc}") from exc


def is_valid_unit(unit: str) -> bool:
    try:
        parse_unit(unit)
        return True
    except ValueError:
        return False


def compatible(unit_a: str, unit_b: str) -> bool:
    """True when two units measure the same physical dimension."""
    return parse_unit(unit_a).dimensionality == parse_unit(unit_b).dimensionality


def convert(value: float, from_unit: str, to_unit: str) -> float:
    """Convert a magnitude between dimensionally compatible units."""
    q = UREG.Quantity(value, parse_unit(from_unit))
    try:
        return float(q.to(parse_unit(to_unit)).magnitude)
    except pint.DimensionalityError as exc:
        raise ValueError(f"cannot convert {from_unit!r} to {to_unit!r}: {exc}") from exc
