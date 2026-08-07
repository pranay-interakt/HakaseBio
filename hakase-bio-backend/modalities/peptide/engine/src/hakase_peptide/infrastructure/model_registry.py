"""Model Registry (doc 01 §4.5, doc 03 "Computational Model").

Central catalogue of every computational model / algorithm the platform uses,
with its version, capabilities, validation status and benchmark metadata. The
registry lets services attach exact model provenance to their evidence and lets
an auditor confirm which model version produced a result.

Entries here describe *real* assets: the trained peptide classifiers (with their
cross-validated AUCs measured at training time), the deterministic biochemistry
engine, ESMFold, ESM2-650M, and Boltz-2. Benchmark numbers that are not
independently measured within this repo are left as ``None`` rather than
invented.
"""

from __future__ import annotations

import threading
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class ModelEntry:
    model_id: str
    version: str
    kind: str  # "deterministic" | "ml" | "structure" | "embedding"
    capabilities: list[str]
    validation_status: str  # mirrors evidence ValidationStatus vocabulary
    provider: str  # "in_tree" | "esm_atlas" | "nvidia_nim" | "runpod" ...
    references: list[str] = field(default_factory=list)
    benchmark: dict[str, Any] = field(default_factory=dict)  # measured metrics only
    license: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ModelRegistry:
    def __init__(self) -> None:
        self._entries: dict[str, ModelEntry] = {}
        self._lock = threading.Lock()

    def register(self, entry: ModelEntry) -> None:
        with self._lock:
            self._entries[entry.model_id] = entry

    def get(self, model_id: str) -> ModelEntry | None:
        return self._entries.get(model_id)

    def require(self, model_id: str) -> ModelEntry:
        e = self.get(model_id)
        if e is None:
            raise KeyError(f"Model '{model_id}' is not registered.")
        return e

    def all(self) -> list[ModelEntry]:
        return list(self._entries.values())

    def version_map(self, model_ids: list[str]) -> dict[str, str]:
        out: dict[str, str] = {}
        for mid in model_ids:
            e = self.get(mid)
            if e:
                out[mid] = e.version
        return out


def _seed(reg: ModelRegistry) -> None:
    reg.register(
        ModelEntry(
            model_id="peptide_biochem_engine",
            version="1.0.0",
            kind="deterministic",
            capabilities=[
                "molecular_weight",
                "isoelectric_point",
                "net_charge",
                "gravy",
                "windowed_hydrophobicity",
                "charge_distribution",
                "instability_index",
                "aliphatic_index",
                "boman_index",
                "aromaticity",
                "hydrophobic_moment",
                "hydrophobic_moment_beta",
                "compositional_statistics",
                "secondary_structure_propensity",
                "protease_sites",
                "extinction_coefficient",
                "aggregation_aggrescan",
                "solubility",
                "synthesis_complexity",
            ],
            validation_status="internally_validated",
            provider="in_tree",
            references=[
                "Kyte & Doolittle 1982 J Mol Biol 157:105",
                "Guruprasad 1990 Protein Eng 4:155 (instability index)",
                "Eisenberg 1984 (hydrophobic moment)",
                "Boman 2003 J Intern Med 254:197",
            ],
            license="internal",
        )
    )
    reg.register(
        ModelEntry(
            model_id="peptide_activity_classifiers",
            version="1.1.0",
            kind="ml",
            capabilities=["hemolysis", "antimicrobial", "cell_permeability"],
            validation_status="internally_validated",
            provider="in_tree",
            references=[
                "HemoPI-2: Chaudhary 2016 Biomed Res Int 2016:8525987",
                "CAMP v3.0: Wang 2016 NAR 44:D1087; APD3",
                "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
            ],
            benchmark={
                "metric": "stratified_cv_auc",
                "note": "measured at train time; see payload models_cv_auc",
            },
            license="internal",
        )
    )
    reg.register(
        ModelEntry(
            model_id="camsol_intrinsic",
            version="1.0.0",
            kind="deterministic",
            capabilities=["intrinsic_solubility"],
            validation_status="internally_validated",
            provider="in_tree",
            references=["Sormanni 2015 J Mol Biol 427:478 (CamSol)"],
            license="internal",
        )
    )
    reg.register(
        ModelEntry(
            model_id="esmfold_v1",
            version="1.0.0",
            kind="structure",
            capabilities=["single_chain_structure", "plddt"],
            validation_status="internally_validated",
            provider="esm_atlas",
            references=["Lin 2023 Science 379:1123 (ESMFold / ESM-2)"],
            license="MIT",
        )
    )
    reg.register(
        ModelEntry(
            model_id="esm2_650m",
            version="650M",
            kind="embedding",
            capabilities=["per_residue_embedding", "mean_embedding"],
            validation_status="not_validated",
            provider="nvidia_nim",
            references=["Lin 2023 Science 379:1123 (ESM-2)"],
            license="MIT",
        )
    )
    reg.register(
        ModelEntry(
            model_id="boltz2",
            version="2.0.0",
            kind="structure",
            capabilities=["complex_structure", "binding_affinity", "conformation_ensemble"],
            validation_status="internally_validated",
            provider="runpod_gpu",
            references=["Passaro 2025 bioRxiv 2025.06.14.659707 (Boltz-2)"],
            license="MIT",
        )
    )

    reg.register(
        ModelEntry(
            model_id="functional_structured_ml_v2",
            version="2.0.0",
            kind="ml",
            capabilities=[
                "antimicrobial_activity",
                "cell_penetration_activity",
                "hemolytic_liability",
            ],
            validation_status="internally_validated",
            provider="in_tree",
            references=[
                "HemoPI-2: Chaudhary 2016 Biomed Res Int 2016:8525987",
                "CAMP v3.0: Wang 2016 NAR 44:D1087; APD3",
                "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
            ],
            benchmark={
                "metric": "stratified_cv_auc",
                "note": "measured at train time; see functional payload training_cv_auc per endpoint",
            },
            license="internal",
        )
    )
    reg.register(
        ModelEntry(
            model_id="functional_embedding_ml_v1",
            version="1.0.0",
            kind="ml",
            capabilities=[
                "antimicrobial_activity_embedding",
                "cell_penetration_activity_embedding",
            ],
            validation_status="internally_validated",
            provider="in_tree",
            references=[
                "CAMP v3.0: Wang 2016 NAR 44:D1087",
                "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
            ],
            benchmark={
                "metric": "train_auc",
                "note": "measured at train time; see functional payload training_auc per endpoint",
            },
            license="internal",
        )
    )


_REGISTRY: ModelRegistry | None = None
_LOCK = threading.Lock()


def get_model_registry() -> ModelRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        with _LOCK:
            if _REGISTRY is None:
                r = ModelRegistry()
                _seed(r)
                _REGISTRY = r
    return _REGISTRY
