"""Per-parameter reliability / uncertainty budgets for resolved physiology.

Every resolved physiology row (:class:`store.ScaledPhysiology`) carries an
uncertainty map keyed by parameter group. Calibrated species (a literature-
measured row) get a baseline budget; species resolved by allometric
extrapolation from body weight alone get an **inflated** budget, and their
metabolic-clearance parameter is flagged as the single least-reliable quantity.

The ``cv`` values here are **assumed uncertainty budgets** — engineering
order-of-magnitude estimates of the 1-sigma coefficient of variation, not
values fitted to data. They exist so the downstream Monte-Carlo (S1-T5) can turn
provenance/reliability into interval widths; they are named constants precisely
so they can be tuned or replaced with fitted residuals later. They are honest
about being assumptions, consistent with the project's no-silent-guess policy.

Kernel policy: modality-agnostic, pure stdlib.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

# Parameter groups an uncertainty budget is expressed over.
ORGAN_VOLUME = "organ_volume"
BLOOD_FLOW = "blood_flow"
CARDIAC_OUTPUT = "cardiac_output"
GFR = "gfr"
TISSUE_COMPOSITION = "tissue_composition"
METABOLIC_CLEARANCE = "metabolic_clearance"

PARAMETER_GROUPS: tuple[str, ...] = (
    ORGAN_VOLUME,
    BLOOD_FLOW,
    CARDIAC_OUTPUT,
    GFR,
    TISSUE_COMPOSITION,
    METABOLIC_CLEARANCE,
)


class Reliability(str, Enum):
    """Qualitative trust in a parameter, high to low."""

    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"
    VERY_LOW = "very_low"


_RANK: dict[Reliability, int] = {
    Reliability.HIGH: 3,
    Reliability.MODERATE: 2,
    Reliability.LOW: 1,
    Reliability.VERY_LOW: 0,
}


def reliability_rank(r: Reliability) -> int:
    """Integer rank (higher = more reliable) for ordering comparisons."""
    return _RANK[r]


@dataclass(frozen=True)
class ParameterUncertainty:
    """Assumed 1-sigma ``cv`` and qualitative ``reliability`` for one group."""

    cv: float  # coefficient of variation (fractional 1-sigma) — assumed budget
    reliability: Reliability
    basis: str  # short note on why this reliability

    def __post_init__(self) -> None:
        if self.cv < 0.0:
            raise ValueError(f"cv must be >= 0, got {self.cv}")


# --------------------------------------------------------------------------- #
# Baseline budgets — a calibrated (literature-measured) row.
# Human is the IVIVE anchor, so its metabolic-clearance term is more trusted;
# for a non-human calibrated species interspecies metabolic differences make
# metabolic clearance the weakest of its groups.
# --------------------------------------------------------------------------- #
def _calibrated_common() -> dict[str, ParameterUncertainty]:
    return {
        ORGAN_VOLUME: ParameterUncertainty(0.15, Reliability.MODERATE, "literature organ weights"),
        BLOOD_FLOW: ParameterUncertainty(0.20, Reliability.MODERATE, "literature perfusion"),
        CARDIAC_OUTPUT: ParameterUncertainty(
            0.20, Reliability.MODERATE, "literature cardiac output"
        ),
        GFR: ParameterUncertainty(0.25, Reliability.MODERATE, "literature GFR"),
        TISSUE_COMPOSITION: ParameterUncertainty(
            0.30, Reliability.LOW, "R&R mammalian-surrogate composition"
        ),
    }


def calibrated_uncertainty(is_human: bool) -> dict[str, ParameterUncertainty]:
    """Baseline uncertainty budget for a calibrated species row."""
    budget = _calibrated_common()
    if is_human:
        budget[METABOLIC_CLEARANCE] = ParameterUncertainty(
            0.30, Reliability.MODERATE, "human IVIVE anchor"
        )
    else:
        budget[METABOLIC_CLEARANCE] = ParameterUncertainty(
            0.50, Reliability.LOW, "interspecies metabolic differences"
        )
    return budget


# --------------------------------------------------------------------------- #
# Inflated budget — a species resolved by allometric extrapolation only.
# Every group is wider than its calibrated counterpart, and metabolic clearance
# is the single least-reliable quantity (no species-specific metabolism at all).
# --------------------------------------------------------------------------- #
def extrapolated_uncertainty() -> dict[str, ParameterUncertainty]:
    """Inflated uncertainty budget for an allometrically-extrapolated row."""
    return {
        ORGAN_VOLUME: ParameterUncertainty(0.30, Reliability.LOW, "allometric extrapolation"),
        BLOOD_FLOW: ParameterUncertainty(0.40, Reliability.LOW, "allometric extrapolation"),
        CARDIAC_OUTPUT: ParameterUncertainty(0.40, Reliability.LOW, "allometric extrapolation"),
        GFR: ParameterUncertainty(0.50, Reliability.LOW, "allometric extrapolation"),
        TISSUE_COMPOSITION: ParameterUncertainty(
            0.50, Reliability.LOW, "conserved-mammal default, unverified for this species"
        ),
        METABOLIC_CLEARANCE: ParameterUncertainty(
            1.00, Reliability.VERY_LOW, "no species-specific metabolism; least reliable"
        ),
    }


__all__ = [
    "ORGAN_VOLUME",
    "BLOOD_FLOW",
    "CARDIAC_OUTPUT",
    "GFR",
    "TISSUE_COMPOSITION",
    "METABOLIC_CLEARANCE",
    "PARAMETER_GROUPS",
    "Reliability",
    "reliability_rank",
    "ParameterUncertainty",
    "calibrated_uncertainty",
    "extrapolated_uncertainty",
]
