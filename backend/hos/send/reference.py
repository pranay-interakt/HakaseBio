"""SENDIG v3.1.1 variable metadata and SEND Controlled Terminology 2026-09-25.

Both are extracted by ``scripts/build_send_reference.py`` from SHA-256-checked sources (CDISC
Library content as cached by CDISC's open-source CDISC Rules Engine; NCI EVS SEND Terminology)
and shipped as JSON with their provenance. See docs/research/send_export.md.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

__all__ = [
    "CT_VERSION",
    "SENDIG_VERSION",
    "Variable",
    "codelist",
    "ct",
    "dataset",
    "sendig",
    "term_check",
]

_DIR = Path(__file__).parent / "reference"
SENDIG_VERSION = "3.1.1"
CT_VERSION = "2026-09-25"


@lru_cache(maxsize=1)
def sendig() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((_DIR / "sendig_3_1_1.json").read_text())
    return data


@lru_cache(maxsize=1)
def ct() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((_DIR / "send_ct_2026_09_25.json").read_text())
    return data


@dataclass(frozen=True, slots=True)
class Variable:
    name: str
    label: str
    type: str  # Char | Num
    core: str  # Req | Exp | Perm
    role: str | None
    ordinal: int
    codelists: tuple[str, ...]
    format: str | None


def dataset(domain: str) -> tuple[str, str, str, tuple[Variable, ...]]:
    """(label, class, structure, variables in SENDIG order)."""
    d = sendig()["datasets"][domain]
    return (
        d["label"],
        d["class"],
        d["structure"],
        tuple(
            Variable(
                v["name"],
                v["label"],
                v["type"],
                v["core"],
                v.get("role"),
                v["ordinal"],
                tuple(v["codelists"]),
                v.get("format"),
            )
            for v in d["variables"]
        ),
    )


def codelist(code: str) -> dict[str, Any]:
    try:
        cl: dict[str, Any] = ct()["codelists"][code]
    except KeyError:
        raise KeyError(f"codelist {code} is not in SEND CT {CT_VERSION}") from None
    return cl


def term_check(code: str, value: str) -> str | None:
    """None if ``value`` is a term of codelist ``code``; otherwise a message saying whether the
    codelist is extensible (sponsor terms then need explaining in the nSDRG) or not."""
    cl = codelist(code)
    if value in cl["terms"]:
        return None
    if cl["extensible"]:
        return (
            f"{value!r} is not a term of extensible codelist {cl['submission_value']} "
            f"({code}); a sponsor-defined term must be described in the nSDRG"
        )
    return f"{value!r} is not a term of non-extensible codelist {cl['submission_value']} ({code})"
