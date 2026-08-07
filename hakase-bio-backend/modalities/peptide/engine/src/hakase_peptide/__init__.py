"""HakaseAI Peptide Discovery Platform — Version 3 (layered, evidence-driven).

This package is a ground-up implementation of the V3 architecture defined in the
Architecture Specification set (docs 01–06):

    Layer 1  Platform Infrastructure   (hakase_peptide.infrastructure)
    Layer 2  Core Scientific Services  (hakase_peptide.services)
    Layer 3  Decision & Validation     (hakase_peptide.decision)
    Layer 4  Presentation & Reporting  (hakase_peptide.api  -> FastAPI router)

Design invariants enforced throughout (see docs 01 §1.5, 04, 06):

  * Scientific Services generate immutable Evidence Objects and never make
    GO / NO-GO decisions.
  * The Decision Engine consumes only Evidence Objects, never raw models.
  * No fabricated numbers, no silent fallbacks, no hard-coded results. Every
    predictor either returns a real computed value or a structured
    ``unavailable`` evidence object carrying a machine-readable reason.
  * Structure prediction runs on a CPU/API path by default (ESMFold via the
    ESM Atlas public API); Boltz-2 is an *optional* deep "conformation layer"
    that is only reached when a GPU provider is explicitly configured.

The package deliberately reuses the genuinely-real scientific algorithms that
already exist in ``models/peptide_properties.py`` (deterministic biochemistry)
and ``models/peptide_esm_ml.py`` (trained GradientBoosting classifiers), wrapping
them in the standardized evidence contract rather than reimplementing science.
"""

from __future__ import annotations

PLATFORM_NAME = "HakaseAI Peptide Discovery Platform"
PLATFORM_VERSION = "3.0.0"
EVIDENCE_SCHEMA_VERSION = "3.0.0"

__all__ = ["PLATFORM_NAME", "PLATFORM_VERSION", "EVIDENCE_SCHEMA_VERSION"]
