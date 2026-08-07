"""PBPK / exposure layer (see ``docs/pbpk-layer.md``).

Stage 1 begins with the disposition contract; the ODE/absorption/cohort engines
(Stage 2) land alongside it later. Kept modality-agnostic per the kernel policy.
"""

from __future__ import annotations

from hakase_kernel.pbpk.contract import (
    ApplicabilityDomain,
    DispositionParameters,
    DomainVerdict,
    ModalityExtension,
    Provenance,
    Quantity,
    SpeciesContext,
)

__all__ = [
    "ApplicabilityDomain",
    "DispositionParameters",
    "DomainVerdict",
    "ModalityExtension",
    "Provenance",
    "Quantity",
    "SpeciesContext",
]
