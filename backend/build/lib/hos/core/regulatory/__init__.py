"""Regulatory rules engine.

Encodes the ICH and FDA guidance that determines *which nonclinical studies a
programme must run* as structured, cited rules. The study set for a programme is
**derived** from the rules and the programme's context; it is never hand-written
per programme, and every requirement names the guideline section that triggered it.
"""

from hos.core.regulatory.classification import ProteinClassification, us_protein_classification
from hos.core.regulatory.context import (
    ClinicalPopulation,
    Indication,
    Modality,
    PeptideOrigin,
    ProgramContext,
    Route,
)
from hos.core.regulatory.engine import (
    StudyCategory,
    StudyRequirement,
    StudySet,
    Timing,
    derive_study_set,
)

__all__ = [
    "ClinicalPopulation",
    "Indication",
    "Modality",
    "PeptideOrigin",
    "ProgramContext",
    "ProteinClassification",
    "Route",
    "StudyCategory",
    "StudyRequirement",
    "StudySet",
    "Timing",
    "derive_study_set",
    "us_protein_classification",
]
