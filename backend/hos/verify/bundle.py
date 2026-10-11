"""Build the verification section of a Module 4 export from the kernel's records."""

from __future__ import annotations

import json
import platform
from typing import Any

import numpy as np
import pint
import rdkit
import scipy

from hos import __version__
from hos.core.reference_params import REGISTRY_VERSION
from hos.db.repository import content_hash
from hos.drivers.base import DRIVER_ABI
from hos.kernel.ledger import canonical_json

__all__ = ["BUNDLE_FORMAT", "software_versions", "verification_files"]

BUNDLE_FORMAT = "hos-verification-bundle/1"


def software_versions() -> dict[str, str]:
    return {
        "hos": __version__,
        "python": platform.python_version(),
        "rdkit": rdkit.__version__,
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "pint": pint.__version__,
        "driver_abi": DRIVER_ABI,
        "reference_parameters": REGISTRY_VERSION,
    }


def _json(obj: Any) -> bytes:
    return json.dumps(obj, indent=1, sort_keys=True, default=str).encode()


def verification_files(
    kernel: Any, program: Any, studies: list[Any], imports: list[Any]
) -> tuple[dict[str, bytes], dict[str, Any]]:
    """Files to add under ``verification/`` and the bundle manifest."""
    files: dict[str, bytes] = {}
    raw: dict[str, bytes] = {}
    # the programme's complete audit history: every compound and every study, including
    # those not in Module 4 (refused, simulated, cancelled)
    subjects = {program.id}
    subjects |= {c.id for c in kernel.repo.compounds(program.id)}
    subjects |= {s.id for s in kernel.repo.studies(program.id)}
    for s in studies:
        subjects |= {s.id, s.compound_id}
        compound = kernel.repo.compound(s.compound_id)
        data = s.data or {}
        data_sha = data.get("file_sha256")
        for f in s.raw_files or []:
            raw[f["sha256"]] = kernel.files.get(f["sha256"])
        analysis_hash = (s.results or {}).get("analysis_hash")
        dets = [d for d in s.determinations or [] if d.get("analysis_hash") == analysis_hash]
        files[f"verification/studies/{s.id}.json"] = _json(
            {
                "study_id": s.id,
                "program_id": s.program_id,
                "requirement_id": s.requirement_id,
                "driver_id": s.driver_id,
                "driver_version": s.driver_version,
                "glp": s.glp,
                "compound": {
                    "id": compound.id,
                    "name": compound.name,
                    "smiles": compound.smiles,
                    "inchikey": compound.inchikey,
                    "kind": compound.kind or "small_molecule",
                    "entity": (compound.entity or {}).get("spec"),
                },
                "hypothesis": s.hypothesis,
                "parameters": s.parameters,
                "analysis_inputs": s.analysis_inputs or {},
                "data_file": {
                    "sha256": data_sha,
                    "filename": data.get("filename"),
                    "origin": data.get("origin"),
                },
                "raw_files": s.raw_files or [],
                "expected": {
                    "protocol_hash": s.protocol_hash,
                    "data_hash": content_hash(data),
                    "analysis_hash": analysis_hash,
                    "report_hash": s.report_hash,
                },
                "results": s.results,
                "determinations": dets,
                "report": s.report,
                "signatures": s.signatures or [],
            }
        )
    for s in imports:
        subjects |= {s.id, s.compound_id}
        rec = s.import_record or {}
        raw[rec["report"]["sha256"]] = kernel.files.get(rec["report"]["sha256"])
        for d in rec.get("datasets", []):
            raw[d["sha256"]] = kernel.files.get(d["sha256"])
        files[f"verification/imports/{s.id}.json"] = _json(
            {
                "study_id": s.id,
                "requirement_id": s.requirement_id,
                "glp": s.glp,
                "import_record": rec,
                "import_hash": s.report_hash,
                "signatures": s.signatures or [],
            }
        )
    for sha, content in raw.items():
        files[f"verification/raw/{sha}"] = content
    entries = kernel.ledger.entries()
    # other programmes' entries are shown only as (prev_hash, content_digest, entry_hash):
    # the chain still recomputes to the head, their content stays private (docs/15 P0.3).
    # Scheme-1 entries cannot be redacted without breaking the chain and are kept whole.
    chain = [
        {**e.body(), "entry_hash": e.entry_hash}
        if e.subject_id in subjects or e.scheme == 1
        else {
            "seq": e.seq,
            "scheme": e.scheme,
            "redacted": True,
            "prev_hash": e.prev_hash,
            "content_digest": e.content_digest(),
            "entry_hash": e.entry_hash,
        }
        for e in entries
    ]
    redacted = sum(1 for c in chain if c.get("redacted"))
    files["verification/ledger/chain.jsonl"] = (
        "\n".join(canonical_json(c) for c in chain).encode() + b"\n"
    )
    mine = [e.to_dict() for e in entries if e.subject_id in subjects]
    files["verification/ledger/entries.jsonl"] = "\n".join(
        canonical_json(e) for e in mine
    ).encode() + (b"\n" if mine else b"")
    manifest = {
        "format": BUNDLE_FORMAT,
        "software": software_versions(),
        "program": {"id": program.id, "name": program.name, "context": program.context},
        "ledger": {
            "head": kernel.ledger.head,
            "entries": len(entries),
            "program_entries": len(mine),
            "redacted_entries": redacted,
        },
        "studies": sorted(s.id for s in studies),
        "imports": sorted(s.id for s in imports),
    }
    files["verification/manifest.json"] = _json(manifest)
    return files, manifest
