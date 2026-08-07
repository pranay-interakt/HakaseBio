"""Value object for a single-chain structure prediction result."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .plddt import PLDDT_OUTPUT_SCALE


@dataclass(frozen=True)
class StructurePrediction:
    sequence: str
    pdb: str  # full PDB coordinate text (real, not synthetic)
    per_residue_plddt: list[float]  # normalized to 0..100
    mean_plddt: float  # 0..100
    provider: str
    model_id: str
    model_version: str
    raw_plddt_scale: str  # "0-1" or "0-100" as returned by provider
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self, include_pdb: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "provider": self.provider,
            "model_id": self.model_id,
            "model_version": self.model_version,
            "mean_plddt": round(self.mean_plddt, 2),
            "n_residues": len(self.per_residue_plddt),
            "plddt_scale": PLDDT_OUTPUT_SCALE,
            "raw_plddt_scale": self.raw_plddt_scale,
        }
        if include_pdb:
            d["pdb"] = self.pdb
            d["per_residue_plddt"] = [round(v, 2) for v in self.per_residue_plddt]
        return d
