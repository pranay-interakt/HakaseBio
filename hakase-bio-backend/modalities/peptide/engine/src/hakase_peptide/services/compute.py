"""Cached bridges to the platform's real scientific engines.

These wrappers call the genuinely-real, already-validated modules in
``models/`` — deterministic biochemistry (``peptide_properties``) and the
trained GradientBoosting classifiers (``peptide_esm_ml``) — and memoize by the
peptide's full identity so a single workflow computes each at most once. This is
real memoization, not caching of fabricated values.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..domain.peptide import Peptide


@lru_cache(maxsize=2048)
def _properties_cached(
    sequence: str,
    cyclic: bool,
    ph: float,
    ionic: float,
    bridges: tuple[tuple[int, int], ...],
    modifications_json: str,
) -> dict[str, Any]:
    from hakase_peptide.properties import predict_peptide_properties

    bridge_spec = ",".join(f"{i}-{j}" for i, j in bridges) if bridges else None
    # The canonical modification payload is passed as a JSON string so it stays
    # hashable for lru_cache. The descriptor path is deliberately kept network-
    # free (resources=None, spec §13): mass increments come from literature
    # constants / built-in tables, and unresolvable chemistry degrades to an
    # explicit `unavailable` (spec §12) rather than triggering a per-request
    # ChEMBL/PubChem call on the cached hot path.
    modifications = json.loads(modifications_json) if modifications_json else None
    return predict_peptide_properties(
        sequence,
        cyclic=cyclic,
        ph=ph,
        ionic_strength=ionic,
        disulfide_bridges=bridge_spec,
        modifications=modifications,
    )


def _modifications_payload(peptide: Peptide) -> str:
    """Deterministic JSON view of the canonicalized modification set (or '')."""
    mset = peptide.mod_set
    if mset.is_empty:
        return ""
    payload = {
        "list": mset.to_list(),
        "n_terminus_free": mset.n_terminus_free,
        "c_terminus_free": mset.c_terminus_free,
        "head_to_tail_cyclic": mset.head_to_tail_cyclic,
    }
    return json.dumps(payload, sort_keys=True)


def properties_for(peptide: Peptide) -> dict[str, Any]:
    """Full deterministic property profile (real, exact biochemistry)."""
    return _properties_cached(
        peptide.sequence,
        peptide.cyclic,
        peptide.ph,
        peptide.ionic_strength_mM,
        peptide.disulfide_bridges,
        _modifications_payload(peptide),
    )


@lru_cache(maxsize=2048)
def _ml_cached(sequence: str) -> dict[str, Any]:
    from hakase_peptide.properties.esm_ml import predict_peptide_ml

    return predict_peptide_ml(sequence)


def activity_ml_for(peptide: Peptide) -> dict[str, Any]:
    """Trained-classifier outputs (hemolysis, AMP, CPP) + CamSol solubility."""
    return _ml_cached(peptide.sequence)
