"""Conformation layer — optional, GPU-backed Boltz-2 (doc 07 §7.4).

This is where Boltz-2 lives after the refactor: NOT on the default structure
path, but as a deeper tier for peptide–target complexes, binding affinity and
conformational ensembles. It wraps the existing, real Boltz-2 pipeline
(``models.cofolding`` + ``models.gpu_dispatch``) which dispatches to a GPU
endpoint (RunPod / AWS / Azure).

If no GPU provider is configured, the layer is *disabled* and every call returns
a structured ``unavailable`` reason. It never runs Boltz on CPU and never
fabricates a complex (consistent with cofolding.py's own honesty policy).
"""

from __future__ import annotations

from typing import Any

from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure

from ..domain.peptide import Peptide
from ..domain.target import Target


class ConformationLayer:
    def __init__(self, config: PlatformConfig | None = None) -> None:
        self._cfg = config or get_config()

    # ---- availability -------------------------------------------------------
    def availability(self) -> tuple[bool, str]:
        """(available, reason). Available only when a GPU provider is wired."""
        if not self._cfg.conformation_layer_enabled:
            return False, (
                "Conformation layer disabled: set ENABLE_CONFORMATION_LAYER=1 and a "
                "GPU_PROVIDER (runpod/aws/azure) with its credentials to enable Boltz-2."
            )
        try:
            from hakase_structure.cofolding import cofolding_configured  # lazy, heavy import
        except Exception as exc:  # noqa: BLE001
            return False, f"Boltz-2 pipeline import failed: {exc}"
        ok, detail = cofolding_configured()
        return bool(ok), detail

    def is_available(self) -> bool:
        return self.availability()[0]

    # ---- submission ---------------------------------------------------------
    def submit_complex(
        self,
        peptide: Peptide,
        target: Target | None,
        *,
        with_affinity: bool = True,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Submit an asynchronous Boltz-2 co-folding job. Returns the job record.

        Requires a configured GPU provider; otherwise raises a PARTIAL
        ServiceFailure so callers can surface a structured ``unavailable``.
        """
        available, reason = self.availability()
        if not available:
            raise ServiceFailure(
                reason,
                failure_type=FailureType.PARTIAL,
                reason_code="conformation_layer_disabled",
            )

        from hakase_structure.cofolding import submit_cofold  # lazy import

        entities: list[dict[str, Any]] = [
            {"id": "P", "type": "protein", "sequence": peptide.sequence}
        ]
        if target and target.sequence:
            entities.append({"id": "T", "type": "protein", "sequence": target.sequence})
        elif target and target.is_specified:
            raise ServiceFailure(
                "Target has no resolved sequence; resolve it via the Resource "
                "Manager (UniProt) before submitting a complex.",
                failure_type=FailureType.PARTIAL,
                reason_code="target_sequence_unresolved",
            )

        request: dict[str, Any] = {
            "entities": entities,
            "options": {
                "affinity": bool(with_affinity and target is not None),
                **(options or {}),
            },
        }
        return submit_cofold(request)

    def job_status(self, job_id: str) -> dict[str, Any] | None:
        from hakase_structure.cofolding import get_job  # lazy import

        return get_job(job_id)
