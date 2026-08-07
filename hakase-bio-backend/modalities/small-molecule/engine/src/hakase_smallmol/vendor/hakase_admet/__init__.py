"""Hakase ADMET — in-house Chemprop-RDKit ensemble for ADMET property prediction.

Exposes the model class and a thin batch-prediction helper. The ensemble
weights ship in ``resources/models`` (classification + regression folds) and
the DrugBank reference set in ``resources/data``.
"""

__version__ = "2.0.1"

from .admet_model import ADMETModel
from .admet_predict import admet_predict

# Branded alias — preferred entry point for Hakase backend code.
HakaseADMETModel = ADMETModel

__all__ = ["ADMETModel", "HakaseADMETModel", "admet_predict", "__version__"]
