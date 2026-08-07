"""Structured confidence reporting for normalized per-residue pLDDT values."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal

import numpy as np

from .plddt import PLDDT_OUTPUT_SCALE

ConfidenceCategory = Literal["very_high", "confident", "low", "very_low"]

PLDDT_VERY_HIGH_THRESHOLD = 90.0
PLDDT_CONFIDENT_THRESHOLD = 70.0
PLDDT_LOW_THRESHOLD = 50.0
LOW_CONFIDENCE_THRESHOLD = PLDDT_CONFIDENT_THRESHOLD

CATEGORY_ORDER: tuple[ConfidenceCategory, ...] = (
    "very_high",
    "confident",
    "low",
    "very_low",
)


def plddt_confidence_category(plddt: float) -> ConfidenceCategory:
    """Classify a normalized 0-100 pLDDT value."""
    if plddt >= PLDDT_VERY_HIGH_THRESHOLD:
        return "very_high"
    if plddt >= PLDDT_CONFIDENT_THRESHOLD:
        return "confident"
    if plddt >= PLDDT_LOW_THRESHOLD:
        return "low"
    return "very_low"


def build_per_residue_confidence(
    sequence: str, per_residue_plddt: Sequence[float]
) -> list[dict[str, Any]]:
    """Map residues to normalized pLDDT values using 1-based input positions."""
    return [
        {
            "position": idx,
            "residue": residue,
            "plddt": round(float(plddt), 2),
            "confidence_category": plddt_confidence_category(float(plddt)),
        }
        for idx, (residue, plddt) in enumerate(zip(sequence, per_residue_plddt), start=1)
    ]


def detect_low_confidence_regions(
    sequence: str, per_residue_plddt: Sequence[float]
) -> list[dict[str, Any]]:
    """Return contiguous 1-based ranges where pLDDT is below 70.

    Region severity is determined by the minimum pLDDT in the region, so a
    single very-low residue makes the whole contiguous low-confidence span
    "very_low".
    """
    regions: list[dict[str, Any]] = []
    start: int | None = None

    def close_region(end: int) -> None:
        assert start is not None
        scores = [float(v) for v in per_residue_plddt[start - 1 : end]]
        minimum = float(np.min(scores))
        regions.append(
            {
                "start": start,
                "end": end,
                "length": end - start + 1,
                "mean_plddt": round(float(np.mean(scores)), 2),
                "minimum_plddt": round(minimum, 2),
                "residues": sequence[start - 1 : end],
                "severity": "very_low" if minimum < PLDDT_LOW_THRESHOLD else "low",
            }
        )

    for idx, plddt in enumerate(per_residue_plddt, start=1):
        is_low_confidence = float(plddt) < LOW_CONFIDENCE_THRESHOLD
        if is_low_confidence and start is None:
            start = idx
        elif not is_low_confidence and start is not None:
            close_region(idx - 1)
            start = None

    if start is not None:
        close_region(len(per_residue_plddt))

    return regions


def summarize_per_residue_confidence(
    per_residue_plddt: Sequence[float], low_confidence_region_count: int
) -> dict[str, Any]:
    """Summarize category counts/fractions for normalized 0-100 pLDDT values."""
    total = len(per_residue_plddt)
    counts = dict.fromkeys(CATEGORY_ORDER, 0)
    for plddt in per_residue_plddt:
        counts[plddt_confidence_category(float(plddt))] += 1

    low_confidence_count = counts["low"] + counts["very_low"]
    fractions = {
        category: round((count / total) if total else 0.0, 3) for category, count in counts.items()
    }
    scores = [float(v) for v in per_residue_plddt]
    return {
        "total_residues": total,
        "category_counts": counts,
        "category_fractions": fractions,
        "low_confidence_residue_count": low_confidence_count,
        "low_confidence_residue_fraction": round(
            (low_confidence_count / total) if total else 0.0, 3
        ),
        "low_confidence_region_count": low_confidence_region_count,
        "mean_plddt": round(float(np.mean(scores)), 2) if scores else None,
        "minimum_plddt": round(float(np.min(scores)), 2) if scores else None,
        "maximum_plddt": round(float(np.max(scores)), 2) if scores else None,
        "plddt_scale": PLDDT_OUTPUT_SCALE,
    }


def build_confidence_report(sequence: str, per_residue_plddt: Sequence[float]) -> dict[str, Any]:
    """Build the additive structural confidence API payload."""
    if len(per_residue_plddt) != len(sequence):
        warning = (
            "Per-residue pLDDT unavailable: sequence length "
            f"({len(sequence)}) does not match pLDDT count ({len(per_residue_plddt)})."
        )
        return {
            "per_residue_confidence": [],
            "low_confidence_regions": [],
            "confidence_summary": {
                "status": "unavailable",
                "reason_code": "plddt_sequence_length_mismatch",
                "reason_detail": warning,
                "total_residues": len(sequence),
                "plddt_value_count": len(per_residue_plddt),
                "plddt_scale": PLDDT_OUTPUT_SCALE,
            },
            "warnings": [warning],
        }

    regions = detect_low_confidence_regions(sequence, per_residue_plddt)
    return {
        "per_residue_confidence": build_per_residue_confidence(sequence, per_residue_plddt),
        "low_confidence_regions": regions,
        "confidence_summary": summarize_per_residue_confidence(
            per_residue_plddt, low_confidence_region_count=len(regions)
        ),
        "warnings": [],
    }
