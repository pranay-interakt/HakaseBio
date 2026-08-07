"""Peptide-target complex prediction workflow.

Task 14 lives here so the structural service can use one stable abstraction
instead of knowing Boltz-specific details. The workflow is intentionally honest:
it returns unavailable/blocked/pending/failed states when execution cannot
produce a real structure, and only marks available when a provider returns one.
"""

from __future__ import annotations

import re
import urllib.request
from typing import Any, Literal, Protocol

from hakase_kernel.config import PlatformConfig, get_config

from ..domain.peptide import STANDARD_AA
from .conformation import ConformationLayer

ComplexPredictionStatus = Literal[
    "available",
    "pending",
    "blocked",
    "failed",
    "not_applicable",
    "unavailable",
]

SEQUENCE_STRATEGY = "sequence_target_complex_prediction"
PDB_STRATEGY = "pdb_target_complex_prediction"
BLOCKED_STRATEGIES = {"target_enrichment_required", "isolated_peptide_only"}
SUPPORTED_STRATEGIES = {SEQUENCE_STRATEGY, PDB_STRATEGY, *BLOCKED_STRATEGIES}
PDB_RE = re.compile(r"^[0-9][A-Za-z0-9]{3}$")
CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,4}$")


class ComplexPredictionProvider(Protocol):
    name: str
    model_version: str

    def availability(self) -> tuple[bool, str]: ...

    def predict_from_sequences(
        self, *, peptide_sequence: str, target_sequence: str
    ) -> dict[str, Any]: ...

    def predict_from_pdb(
        self, *, peptide_sequence: str, pdb_id: str, chain_id: str
    ) -> dict[str, Any]: ...


class Boltz2ComplexPredictionProvider:
    """Boltz-2-backed provider adapter.

    The current conformation layer submits asynchronous co-folding jobs. If the
    provider returns a queued job, the workflow reports ``pending`` with job
    provenance. If a future/local provider returns a structure immediately, the
    same adapter normalizes it to ``completed``.
    """

    name = "boltz2"
    model_version = "1.0"

    def __init__(self, config: PlatformConfig | None = None) -> None:
        self._cfg = config or get_config()
        self._layer = ConformationLayer(self._cfg)

    def availability(self) -> tuple[bool, str]:
        return self._layer.availability()

    def predict_from_sequences(
        self, *, peptide_sequence: str, target_sequence: str
    ) -> dict[str, Any]:
        return self._submit(
            {
                "entities": [
                    {"id": "P", "type": "peptide", "sequence": peptide_sequence},
                    {"id": "T", "type": "protein", "sequence": target_sequence},
                ],
                "options": {"affinity": False, "output_format": "pdb"},
            }
        )

    def predict_from_pdb(
        self, *, peptide_sequence: str, pdb_id: str, chain_id: str
    ) -> dict[str, Any]:
        pdb_url = f"{self._cfg.rcsb_base_url.rstrip('/')}/download/{pdb_id.upper()}.pdb"
        target_sequence = _target_sequence_from_pdb_url(
            pdb_url,
            chain_id,
            timeout_s=self._cfg.resource_timeout_s,
        )
        return self._submit(
            {
                "entities": [
                    {"id": "P", "type": "peptide", "sequence": peptide_sequence},
                    {"id": "T", "type": "protein", "sequence": target_sequence},
                ],
                "templates": [
                    {
                        "source_url": pdb_url,
                        "source_format": "pdb",
                        "chain_ids": ["T"],
                        "template_ids": [chain_id],
                    }
                ],
                "options": {"affinity": False, "output_format": "pdb"},
            }
        )

    @staticmethod
    def _submit(request: dict[str, Any]) -> dict[str, Any]:
        from hakase_structure.cofolding import submit_cofold

        return submit_cofold(request)


def default_complex_prediction_provider(
    config: PlatformConfig | None = None,
) -> ComplexPredictionProvider:
    return Boltz2ComplexPredictionProvider(config or get_config())


def predict_complex(
    *,
    peptide_sequence: str,
    target_resolution: dict[str, Any] | None,
    strategy_selection: dict[str, Any] | None,
    provider: ComplexPredictionProvider | None = None,
    config: PlatformConfig | None = None,
) -> dict[str, Any]:
    active_provider = provider or default_complex_prediction_provider(config)
    strategy = _selected_strategy(strategy_selection)
    base = _base_payload(strategy=strategy, provider=active_provider)

    if not _target_supplied(target_resolution):
        return {
            **base,
            "status": "not_applicable",
            "complex_available": False,
            "provenance": _provenance(strategy_selection, target_resolution),
        }

    if strategy in BLOCKED_STRATEGIES:
        return {
            **base,
            "status": "blocked",
            "complex_available": False,
            "warnings": _messages(strategy_selection, "warnings"),
            "errors": _messages(strategy_selection, "errors"),
            "provenance": _provenance(strategy_selection, target_resolution),
        }

    if strategy not in SUPPORTED_STRATEGIES:
        return _failed(
            base,
            f"Unsupported complex prediction strategy: {strategy!r}.",
            "invalid_strategy",
            strategy_selection,
            target_resolution,
        )

    errors = _validate_inputs(strategy, peptide_sequence, target_resolution)
    if errors:
        return {
            **base,
            "status": "failed",
            "complex_available": False,
            "errors": errors,
            "provenance": _provenance(strategy_selection, target_resolution),
        }

    available, reason = active_provider.availability()
    if not available:
        return {
            **base,
            "status": "unavailable",
            "complex_available": False,
            "warnings": [{"code": "provider_unavailable", "message": reason}],
            "provenance": _provenance(strategy_selection, target_resolution),
        }

    resolved = _resolved_target(target_resolution)
    try:
        if strategy == SEQUENCE_STRATEGY:
            raw = active_provider.predict_from_sequences(
                peptide_sequence=peptide_sequence,
                target_sequence=str(resolved.get("sequence") or "").strip().upper(),
            )
        else:
            raw = active_provider.predict_from_pdb(
                peptide_sequence=peptide_sequence,
                pdb_id=str(resolved.get("pdb_id") or "").strip().upper(),
                chain_id=str(resolved.get("chain_id") or "").strip(),
            )
    except Exception as exc:  # noqa: BLE001 - provider failures become evidence, not crashes
        return _failed(
            base,
            f"{active_provider.name} complex prediction failed: {exc}",
            "provider_error",
            strategy_selection,
            target_resolution,
        )

    return _normalize_provider_result(
        base=base,
        raw=raw,
        strategy_selection=strategy_selection,
        target_resolution=target_resolution,
    )


def _normalize_provider_result(
    *,
    base: dict[str, Any],
    raw: dict[str, Any],
    strategy_selection: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _failed(
            base,
            f"Provider returned {type(raw).__name__}, expected object.",
            "invalid_provider_response",
            strategy_selection,
            target_resolution,
        )
    if raw.get("status") in {"failed", "error"}:
        return {
            **base,
            "status": "failed",
            "complex_available": False,
            "errors": [
                {
                    "code": "provider_failed",
                    "message": str(raw.get("error") or raw.get("reason") or "Provider failed."),
                }
            ],
            "provenance": _provenance(strategy_selection, target_resolution, raw),
        }

    structure = raw.get("structure") or (raw.get("result") or {}).get("structure")
    structure_format = raw.get("structure_format") or (raw.get("result") or {}).get(
        "structure_format"
    )
    if structure:
        confidence = raw.get("confidence")
        if confidence is None:
            confidence = (raw.get("result") or {}).get("confidence")
        return {
            **base,
            "status": "available",
            "confidence": _confidence_label(confidence),
            "complex_available": True,
            "structure_format": structure_format or "pdb",
            "structure": structure,
            "warnings": list(raw.get("warnings") or []),
            "provenance": _provenance(strategy_selection, target_resolution, raw),
        }

    if raw.get("job_id") or raw.get("status") in {"queued", "running", "pending"}:
        return {
            **base,
            "status": "pending",
            "complex_available": False,
            "warnings": [
                {
                    "code": "prediction_pending",
                    "message": "Complex prediction was submitted and has not completed yet.",
                }
            ],
            "provenance": _provenance(strategy_selection, target_resolution, raw),
        }

    return _failed(
        base,
        "Provider did not return a structure or job handle.",
        "missing_structure",
        strategy_selection,
        target_resolution,
    )


def _base_payload(*, strategy: str, provider: ComplexPredictionProvider) -> dict[str, Any]:
    return {
        "status": "blocked",
        "strategy": strategy,
        "provider": provider.name,
        "model_id": provider.name,
        "model_version": provider.model_version,
        "confidence": None,
        "complex_available": False,
        "structure_format": None,
        "structure": None,
        "warnings": [],
        "errors": [],
        "provenance": {},
    }


def _failed(
    base: dict[str, Any],
    message: str,
    code: str,
    strategy_selection: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        **base,
        "status": "failed",
        "complex_available": False,
        "errors": [{"code": code, "message": message}],
        "provenance": _provenance(strategy_selection, target_resolution),
    }


def _validate_inputs(
    strategy: str, peptide_sequence: str, target_resolution: dict[str, Any] | None
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    peptide = re.sub(r"\s+", "", str(peptide_sequence or "")).upper()
    if not peptide:
        errors.append(
            {"code": "invalid_peptide_sequence", "message": "Peptide sequence is required."}
        )
    elif sorted(set(peptide) - STANDARD_AA):
        errors.append(
            {
                "code": "invalid_peptide_sequence",
                "message": "Peptide sequence must contain only the 20 standard amino acids.",
            }
        )

    resolved = _resolved_target(target_resolution)
    if strategy == SEQUENCE_STRATEGY:
        target_sequence = re.sub(r"\s+", "", str(resolved.get("sequence") or "")).upper()
        if not target_sequence:
            errors.append(
                {"code": "missing_target_sequence", "message": "Target sequence is required."}
            )
        elif sorted(set(target_sequence) - STANDARD_AA):
            errors.append(
                {
                    "code": "invalid_target_sequence",
                    "message": "Target sequence must contain only the 20 standard amino acids.",
                }
            )
    elif strategy == PDB_STRATEGY:
        pdb_id = str(resolved.get("pdb_id") or "").strip()
        chain_id = str(resolved.get("chain_id") or "").strip()
        if not PDB_RE.match(pdb_id):
            errors.append(
                {
                    "code": "invalid_pdb_id",
                    "message": "PDB ID must be four characters and start with a digit.",
                }
            )
        if not CHAIN_RE.match(chain_id):
            errors.append(
                {
                    "code": "invalid_chain_id",
                    "message": "Chain ID must be 1-4 alphanumeric characters.",
                }
            )
    return errors


def _selected_strategy(strategy_selection: dict[str, Any] | None) -> str:
    if not isinstance(strategy_selection, dict):
        return "target_enrichment_required"
    return str(strategy_selection.get("selected_strategy") or "target_enrichment_required")


def _target_supplied(target_resolution: dict[str, Any] | None) -> bool:
    if not isinstance(target_resolution, dict):
        return False
    if target_resolution.get("status") in {"not_provided", "not_applicable"}:
        return False
    return bool(target_resolution.get("input") or target_resolution.get("resolved_target"))


def _resolved_target(target_resolution: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(target_resolution, dict):
        return {}
    resolved = target_resolution.get("resolved_target")
    if isinstance(resolved, dict):
        return resolved
    input_payload = target_resolution.get("input")
    if isinstance(input_payload, dict):
        return input_payload
    return {}


def _messages(source: dict[str, Any] | None, key: str) -> list[dict[str, str]]:
    if not isinstance(source, dict) or not isinstance(source.get(key), list):
        return []
    return [item for item in source[key] if isinstance(item, dict)]


def _provenance(
    strategy_selection: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
    provider_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "workflow": "peptide_target_complex_prediction",
        "strategy_selection": (
            strategy_selection.get("provenance") if isinstance(strategy_selection, dict) else {}
        ),
        "target_resolution": (
            target_resolution.get("provenance") if isinstance(target_resolution, dict) else {}
        ),
    }
    if provider_result:
        payload["provider_result"] = {
            key: provider_result.get(key)
            for key in ("job_id", "status", "summary", "runpod_job_id", "engine", "boltz_version")
            if key in provider_result
        }
    return payload


def _confidence_label(confidence: Any) -> str | None:
    if confidence is None:
        return None
    if isinstance(confidence, str):
        return confidence
    if isinstance(confidence, dict):
        for key in ("confidence", "confidence_label", "tier"):
            value = confidence.get(key)
            if isinstance(value, str) and value:
                return value
        numeric = (
            confidence.get("confidence_score") or confidence.get("iptm") or confidence.get("ptm")
        )
        if isinstance(numeric, int | float):
            if numeric >= 0.75:
                return "high"
            if numeric >= 0.5:
                return "moderate"
            return "low"
    return None


_THREE_TO_ONE = {
    "ALA": "A",
    "ARG": "R",
    "ASN": "N",
    "ASP": "D",
    "CYS": "C",
    "GLN": "Q",
    "GLU": "E",
    "GLY": "G",
    "HIS": "H",
    "ILE": "I",
    "LEU": "L",
    "LYS": "K",
    "MET": "M",
    "PHE": "F",
    "PRO": "P",
    "SER": "S",
    "THR": "T",
    "TRP": "W",
    "TYR": "Y",
    "VAL": "V",
}


def _target_sequence_from_pdb_url(pdb_url: str, chain_id: str, *, timeout_s: float) -> str:
    try:
        with urllib.request.urlopen(pdb_url, timeout=timeout_s) as response:
            pdb_text = response.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Could not retrieve target PDB {pdb_url}: {exc}") from exc

    sequence = _sequence_from_seqres(pdb_text, chain_id) or _sequence_from_atom_records(
        pdb_text, chain_id
    )
    if not sequence:
        raise RuntimeError(f"Could not extract protein sequence for PDB chain {chain_id!r}.")
    return sequence


def _sequence_from_seqres(pdb_text: str, chain_id: str) -> str:
    residues: list[str] = []
    wanted = chain_id.strip()
    for line in pdb_text.splitlines():
        if not line.startswith("SEQRES") or line[11:12].strip() != wanted:
            continue
        for residue in line[19:].split():
            one = _THREE_TO_ONE.get(residue.upper())
            if one:
                residues.append(one)
    return "".join(residues)


def _sequence_from_atom_records(pdb_text: str, chain_id: str) -> str:
    residues: list[str] = []
    seen: set[tuple[str, str]] = set()
    wanted = chain_id.strip()
    for line in pdb_text.splitlines():
        if not line.startswith("ATOM") or line[21:22].strip() != wanted:
            continue
        key = (line[22:26].strip(), line[26:27].strip())
        if key in seen:
            continue
        seen.add(key)
        one = _THREE_TO_ONE.get(line[17:20].strip().upper())
        if one:
            residues.append(one)
    return "".join(residues)
