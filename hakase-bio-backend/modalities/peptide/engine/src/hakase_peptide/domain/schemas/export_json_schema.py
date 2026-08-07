"""
Export every Evidence Object model as a standalone JSON Schema file.

Usage:
    python -m hakase_evidence_schemas.export_json_schema [output_dir]

Produces one .schema.json file per Evidence Object, suitable for:
  - the "Schema Validation: JSON Schema" component in the Recommended
    Engineering Stack (doc 14, Layer 3);
  - validating Evidence Objects before they are accepted onto the Evidence
    Bus, per Evidence Framework §15 ("explicit schema validation before
    acceptance").
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .developability import DevelopabilityEvidence
from .functional import FunctionalEvidence
from .physicochemical import PhysicochemicalEvidence
from .platform_evidence import PlatformEvidenceObject
from .safety import SafetyEvidence
from .structural import StructuralEvidence

MODELS = {
    "physicochemical_evidence": PhysicochemicalEvidence,
    "structural_evidence": StructuralEvidence,
    "functional_evidence": FunctionalEvidence,
    "developability_evidence": DevelopabilityEvidence,
    "safety_evidence": SafetyEvidence,
    "platform_evidence": PlatformEvidenceObject,
}


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("schemas")
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, model in MODELS.items():
        schema = model.model_json_schema()
        out_path = out_dir / f"{name}.schema.json"
        out_path.write_text(json.dumps(schema, indent=2, default=str))
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
