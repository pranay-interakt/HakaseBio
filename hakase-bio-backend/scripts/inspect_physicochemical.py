"""Manual inspection of the physicochemical descriptors + typed evidence payload.

Usage (from the repo root, with the test venv python):
    python scripts/inspect_physicochemical.py GIGKFLHSAKKFGKAFVGEIMNS
    python scripts/inspect_physicochemical.py AC        # 2-mer edge case

Prints the new §6 engine descriptors and the §14 evidence block so you can
read the actual values and per-descriptor confidence tiers by hand.
"""

from __future__ import annotations

import json
import sys

sys.path.insert(0, ".")

from hakase_peptide.config import get_config
from hakase_peptide.domain.ids import new_id
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.infrastructure.audit import get_audit_log
from hakase_peptide.infrastructure.model_registry import get_model_registry
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.infrastructure.resource_manager import get_resource_manager
from hakase_peptide.properties import predict_peptide_properties
from hakase_peptide.services.physicochemical import PhysicochemicalService


def main() -> None:
    seq = sys.argv[1] if len(sys.argv) > 1 else "GIGKFLHSAKKFGKAFVGEIMNS"

    # ---- 1. Raw engine descriptors (M1) --------------------------------------
    r = predict_peptide_properties(seq)
    print("=" * 70)
    print(f"SEQUENCE: {seq}  (length {len(seq)})")
    print("=" * 70)
    print("\n--- M1: new §6 engine descriptors ---")
    print("hydrophobicity_profile:", json.dumps(r["hydrophobicity_profile"]))
    print("charge_distribution:   ", json.dumps(r["charge_distribution"]))
    print("hydrophobic_moment:    ", json.dumps(r["hydrophobic_moment_profile"]))
    print("compositional_statistics:")
    print(json.dumps(r["compositional_statistics"], indent=2))
    print("reference_parameter_sets:", json.dumps(r["reference_parameter_sets"], indent=2))

    # ---- 2. Typed §14 evidence payload (M2/M3/M6) ----------------------------
    pep = Peptide.create(seq)
    ctx = ExecutionContext(
        execution_id=new_id("exec"),
        peptide=pep,
        target=None,
        policy_id=None,
        config=get_config(),
        registry=get_model_registry(),
        resources=get_resource_manager(),
        audit=get_audit_log(),
    )
    ev = PhysicochemicalService().run(ctx)
    p = ev.scientific_payload

    print("\n--- M3: per-descriptor confidence tiers ---")
    for name, block in p["descriptors"].items():
        print(f"  {name:26s} tier={block['confidence']['tier']}")
    print("confidence_summary:", json.dumps(p["confidence_summary"], indent=2))

    print("\n--- M6: provenance ---")
    print("model_identifier_and_version:", p["provenance"]["model_identifier_and_version"])
    print("reference_parameter_sets keys:", list(p["provenance"]["reference_parameter_sets"]))

    print("\n--- decision-variable contract (must stay resolvable) ---")
    for k in ("net_charge_pH7", "instability_index", "hydrophobic_moment"):
        print(f"  physicochemical.{k} = {p['physicochemical'][k]}")

    print("\n--- validation_status / embeddings ---")
    print("payload validation_status:", p["validation_status"])
    print("embeddings pooled tier:", p["embeddings"]["pooled_vector"]["confidence"]["tier"])
    print("\n(full payload has keys:", sorted(p.keys()), ")")


if __name__ == "__main__":
    main()
