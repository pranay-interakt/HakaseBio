"""Species/strain physiology + tissue-composition store for the PBPK layer.

See ``store.get_physiology`` for the lookup and ``tissue_composition`` for the
Rodgers & Rowland tissue tables. Unknown species are resolved by allometric
extrapolation; extra calibrated species load from ``data/species_physiology.json``
at import (see ``loader``). Modality-agnostic, pure stdlib.
"""

from __future__ import annotations

from hakase_kernel.pbpk.physiology import loader as loader
from hakase_kernel.pbpk.physiology.loader import load_species_definitions
from hakase_kernel.pbpk.physiology.reliability import (
    ParameterUncertainty,
    Reliability,
    calibrated_uncertainty,
    extrapolated_uncertainty,
    reliability_rank,
)
from hakase_kernel.pbpk.physiology.store import (
    AGE_MODIFIERS,
    ALLOMETRIC_FLOW_EXPONENT,
    DEFAULT_STRAIN,
    GENERIC_MAMMAL,
    SEX_MODIFIERS,
    SPECIES_PHYSIOLOGY,
    AgeClass,
    PhysiologyModifier,
    ScaledPhysiology,
    Sex,
    SpeciesPhysiology,
    get_physiology,
)
from hakase_kernel.pbpk.physiology.tissue_composition import (
    PLASMA_F_NEUTRAL_LIPID,
    PLASMA_F_NEUTRAL_PHOSPHOLIPID,
    PLASMA_PH,
    RED_CELL_INTRACELLULAR_PH,
    TISSUE_COMPOSITION,
    TissueComposition,
    get_tissue_composition,
)

# Register any extra calibrated species shipped in the packaged data file. The
# default file is empty, so calibrated behaviour is unchanged out of the box.
loader.load_default()

__all__ = [
    "AGE_MODIFIERS",
    "ALLOMETRIC_FLOW_EXPONENT",
    "DEFAULT_STRAIN",
    "GENERIC_MAMMAL",
    "SEX_MODIFIERS",
    "SPECIES_PHYSIOLOGY",
    "AgeClass",
    "PhysiologyModifier",
    "ScaledPhysiology",
    "Sex",
    "SpeciesPhysiology",
    "get_physiology",
    "load_species_definitions",
    "ParameterUncertainty",
    "Reliability",
    "calibrated_uncertainty",
    "extrapolated_uncertainty",
    "reliability_rank",
    "PLASMA_F_NEUTRAL_LIPID",
    "PLASMA_F_NEUTRAL_PHOSPHOLIPID",
    "PLASMA_PH",
    "RED_CELL_INTRACELLULAR_PH",
    "TISSUE_COMPOSITION",
    "TissueComposition",
    "get_tissue_composition",
]
