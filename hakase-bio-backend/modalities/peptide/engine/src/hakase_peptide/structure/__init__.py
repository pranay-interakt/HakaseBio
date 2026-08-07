"""Structure engine — the Structural Biology Service's computational back end.

Two tiers, cleanly separated (this is the refactor the user asked for):

  * **Default tier (GPU-free, API/CPU):** single-chain peptide structure from
    ESMFold, via the ESM Atlas public API (no key) or the NVIDIA NIM ESMFold
    endpoint (when a key is present). Real coordinates, real pLDDT.

  * **Conformation layer (optional, GPU):** Boltz-2 for peptide–target
    complexes, binding affinity and conformational ensembles. Only reached when
    a GPU provider is explicitly configured; otherwise it returns a structured
    ``unavailable`` — never a fabricated complex.
"""

from hakase_structure.pdb_tools import analyze_structure
from hakase_structure.prediction import StructurePrediction
from hakase_structure.providers import (
    ESMFoldAtlasProvider,
    NvidiaESMFoldProvider,
    StructureProvider,
    resolve_structure_provider,
)

from .complex_prediction import (
    Boltz2ComplexPredictionProvider,
    ComplexPredictionProvider,
    default_complex_prediction_provider,
    predict_complex,
)
from .conformation import ConformationLayer
from .isolated_structure import (
    ISOLATED_STRUCTURE_LIMITATIONS,
    build_isolated_structure,
    build_pdb_output,
    unavailable_isolated_structure,
)
from .provenance import apply_structural_provenance
from .structural_evidence import build_structural_evidence, unavailable_interface_analysis
from .structural_feasibility import (
    build_structural_feasibility,
    unavailable_structural_feasibility,
)

__all__ = [
    "StructurePrediction",
    "StructureProvider",
    "ESMFoldAtlasProvider",
    "NvidiaESMFoldProvider",
    "resolve_structure_provider",
    "analyze_structure",
    "ConformationLayer",
    "ComplexPredictionProvider",
    "Boltz2ComplexPredictionProvider",
    "default_complex_prediction_provider",
    "predict_complex",
    "ISOLATED_STRUCTURE_LIMITATIONS",
    "apply_structural_provenance",
    "build_isolated_structure",
    "build_pdb_output",
    "build_structural_feasibility",
    "build_structural_evidence",
    "unavailable_interface_analysis",
    "unavailable_isolated_structure",
    "unavailable_structural_feasibility",
]
