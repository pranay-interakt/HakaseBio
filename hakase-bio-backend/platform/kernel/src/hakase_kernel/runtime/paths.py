"""Canonical filesystem locations, resolved once for the whole backend.

Before the platform/modality split every module computed its own
``CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")``. That
worked when all the science lived in one package; once the code moved into
separate packages each of those resolved to a *different* directory, and none of
them held the artifacts. Paths are therefore resolved centrally here.

Three distinct kinds of data, deliberately separated:

``cache_dir()``        Regenerable runtime artifacts — trained model pickles,
                       embedding matrices. Git-ignored. Safe to delete.
``calibration_dir()``  Versioned build artifacts that are expensive or
                       network-dependent to regenerate (conformal calibration,
                       screening thresholds). Tracked in git.
``pdb_fixtures_dir()`` Reference PDB structures used by docking. Tracked, and
                       byte-sensitive: PDB is a fixed-width format, so these
                       must never be touched by whitespace-stripping tooling.

All three honour environment overrides so deployments can point at a mounted
volume without code changes.

Training datasets are handled differently, via ``register_dataset_dir()``. They
are owned by whichever modality ships them, and ``platform/`` may not import
``modalities/`` — so the kernel cannot name their location. Each modality
registers its own directory at import time and the kernel only ever searches
what it was given.
"""

from __future__ import annotations

import os
from pathlib import Path


def _repo_root() -> Path:
    """Walk up from this file to the repository root.

    paths.py lives at platform/kernel/src/hakase_kernel/runtime/paths.py, so the
    root is five levels up. Falls back to an explicit override when the package
    is installed somewhere else entirely.
    """
    override = os.environ.get("HAKASE_REPO_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parents[5]


def cache_dir() -> Path:
    """Regenerable runtime artifacts. Git-ignored; created on demand."""
    p = Path(os.environ.get("HAKASE_CACHE_DIR") or _repo_root() / "var" / "cache")
    p.mkdir(parents=True, exist_ok=True)
    return p


def calibration_dir() -> Path:
    """Tracked, versioned calibration artifacts."""
    p = Path(os.environ.get("HAKASE_CALIBRATION_DIR") or _repo_root() / "assets" / "calibration")
    p.mkdir(parents=True, exist_ok=True)
    return p


def pdb_fixtures_dir() -> Path:
    """Tracked reference PDB structures for docking."""
    p = Path(
        os.environ.get("HAKASE_PDB_FIXTURES_DIR")
        or _repo_root() / "platform" / "structure" / "fixtures" / "pdb"
    )
    p.mkdir(parents=True, exist_ok=True)
    return p


# Registered by modalities at import time; the kernel never populates this.
_DATASET_DIRS: list[Path] = []


def register_dataset_dir(path: str | Path) -> None:
    """Register a directory of vendored training datasets.

    Modalities own their datasets, so the kernel is told where they are rather
    than computing a path into ``modalities/``. Idempotent — importing a
    modality twice registers its directory once.
    """
    p = Path(path).expanduser().resolve()
    if p not in _DATASET_DIRS:
        _DATASET_DIRS.append(p)


def dataset_dirs() -> list[Path]:
    """Every directory searched for vendored datasets, in precedence order."""
    override = os.environ.get("HAKASE_DATASET_DIR")
    prefix = [Path(override).expanduser().resolve()] if override else []
    return prefix + list(_DATASET_DIRS)


def resolve_dataset(filename: str) -> Path | None:
    """Locate a vendored dataset by filename, or None if no registered dir has it."""
    for base in dataset_dirs():
        candidate = base / filename
        if candidate.exists():
            return candidate
    return None


def resolve_artifact(name: str) -> Path:
    """Locate a named artifact, preferring tracked calibration over runtime cache.

    Lets callers ask for e.g. ``conformal_calibration.json`` without knowing
    which tier it lives in, and keeps the old flat-``cache/`` call sites working
    with a one-line change.
    """
    for base in (calibration_dir(), cache_dir()):
        candidate = base / name
        if candidate.exists():
            return candidate
    # Default write location for something that does not exist yet.
    return cache_dir() / name
