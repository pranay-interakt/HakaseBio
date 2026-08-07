"""Load extra species definitions from a JSON data file (S1-T2b).

Adding a *calibrated* species requires no code change: drop an entry into
``data/species_physiology.json`` (auto-loaded at import) or load your own file
with :func:`load_species_definitions`. Truly unknown species are handled instead
by allometric extrapolation in :func:`store.get_physiology` — this loader is only
for species you have real physiology for.

JSON is used (not YAML) to keep the kernel dependency-free (stdlib ``json``).

Data-file entry schema (one object per species in the top-level ``"species"``
array)::

    {
      "species": "guinea_pig",
      "strain": "hartley",
      "reference_body_weight_kg": 0.7,
      "cardiac_output_ml_min_kg": 300.0,
      "hepatic_blood_flow_ml_min_kg": 85.0,
      "gfr_ml_min_kg": 4.0,
      "plasma_albumin_g_l": 32.0,
      "blood_volume_fraction": 0.075,
      "hematocrit": 0.42,
      "organ_volume_fraction": {"liver": 0.045, "kidney": 0.009, "heart": 0.004},
      "organ_blood_flow_fraction": {"liver": 0.20, "kidney": 0.13, "heart": 0.05},
      "hepatocellularity_1e6_per_g": null,   // optional
      "source": "..."                          // optional citation
    }

Loaded rows use the conserved mammalian tissue-composition default (like every
calibrated row). A data-file entry may not override an existing calibrated
(species, strain) — that would break the byte-for-byte guarantee — so a collision
raises. Malformed entries raise; there is no silent fallback.

Kernel policy: modality-agnostic, pure stdlib.
"""

from __future__ import annotations

import json
from collections.abc import MutableMapping
from importlib.resources import files
from pathlib import Path
from typing import Any

from hakase_kernel.pbpk.physiology.store import (
    DEFAULT_STRAIN,
    SPECIES_PHYSIOLOGY,
    SpeciesPhysiology,
)

DEFAULT_DATA_RESOURCE = ("data", "species_physiology.json")

_REQUIRED_SCALARS = (
    "reference_body_weight_kg",
    "cardiac_output_ml_min_kg",
    "hepatic_blood_flow_ml_min_kg",
    "gfr_ml_min_kg",
    "plasma_albumin_g_l",
    "blood_volume_fraction",
    "hematocrit",
)
_REQUIRED_MAPS = ("organ_volume_fraction", "organ_blood_flow_fraction")


def _num(entry: dict[str, Any], key: str, species: str) -> float:
    if key not in entry:
        raise ValueError(f"species {species!r}: missing required field {key!r}")
    val = entry[key]
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise ValueError(f"species {species!r}: field {key!r} must be a number, got {val!r}")
    return float(val)


def _frac_map(entry: dict[str, Any], key: str, species: str) -> dict[str, float]:
    if key not in entry or not isinstance(entry[key], dict) or not entry[key]:
        raise ValueError(f"species {species!r}: field {key!r} must be a non-empty object")
    out: dict[str, float] = {}
    for organ, v in entry[key].items():
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise ValueError(f"species {species!r}: {key}[{organ!r}] must be a number")
        out[str(organ)] = float(v)
    return out


def _row_from_entry(entry: dict[str, Any]) -> SpeciesPhysiology:
    if not isinstance(entry, dict):
        raise ValueError(f"species entry must be an object, got {type(entry).__name__}")
    species = entry.get("species")
    strain = entry.get("strain")
    if not isinstance(species, str) or not species:
        raise ValueError("species entry: 'species' must be a non-empty string")
    if not isinstance(strain, str) or not strain:
        raise ValueError(f"species {species!r}: 'strain' must be a non-empty string")

    scalars = {k: _num(entry, k, species) for k in _REQUIRED_SCALARS}
    maps = {k: _frac_map(entry, k, species) for k in _REQUIRED_MAPS}

    hpgl = entry.get("hepatocellularity_1e6_per_g")
    if hpgl is not None and (not isinstance(hpgl, (int, float)) or isinstance(hpgl, bool)):
        raise ValueError(
            f"species {species!r}: 'hepatocellularity_1e6_per_g' must be a number or null"
        )

    return SpeciesPhysiology(
        species=species.strip().lower(),
        strain=strain.strip().lower(),
        reference_body_weight_kg=scalars["reference_body_weight_kg"],
        cardiac_output_ml_min_kg=scalars["cardiac_output_ml_min_kg"],
        hepatic_blood_flow_ml_min_kg=scalars["hepatic_blood_flow_ml_min_kg"],
        gfr_ml_min_kg=scalars["gfr_ml_min_kg"],
        plasma_albumin_g_l=scalars["plasma_albumin_g_l"],
        blood_volume_fraction=scalars["blood_volume_fraction"],
        hematocrit=scalars["hematocrit"],
        organ_volume_fraction=maps["organ_volume_fraction"],
        organ_blood_flow_fraction=maps["organ_blood_flow_fraction"],
        hepatocellularity_1e6_per_g=None if hpgl is None else float(hpgl),
        source=entry.get("source"),
    )


def _register(
    rows: list[SpeciesPhysiology],
    registry: MutableMapping[tuple[str, str], SpeciesPhysiology],
    default_strain: MutableMapping[str, str],
) -> list[SpeciesPhysiology]:
    for row in rows:
        key = (row.species, row.strain)
        if key in registry:
            raise ValueError(
                f"species {key} already defined; a data-file entry may not override "
                f"an existing (calibrated) row"
            )
        registry[key] = row
        default_strain.setdefault(row.species, row.strain)
    return rows


def _parse(text: str) -> list[SpeciesPhysiology]:
    doc = json.loads(text)
    if not isinstance(doc, dict) or "species" not in doc:
        raise ValueError("species data file must be an object with a 'species' array")
    entries = doc["species"]
    if not isinstance(entries, list):
        raise ValueError("'species' must be an array")
    return [_row_from_entry(e) for e in entries]


def load_species_definitions(
    path: str | Path,
    *,
    registry: MutableMapping[tuple[str, str], SpeciesPhysiology] | None = None,
    default_strain: MutableMapping[str, str] | None = None,
) -> list[SpeciesPhysiology]:
    """Parse ``path`` and register its species. Returns the rows added."""
    rows = _parse(Path(path).read_text(encoding="utf-8"))
    return _register(
        rows,
        SPECIES_PHYSIOLOGY if registry is None else registry,
        DEFAULT_STRAIN if default_strain is None else default_strain,
    )


def load_default(
    *,
    registry: MutableMapping[tuple[str, str], SpeciesPhysiology] | None = None,
    default_strain: MutableMapping[str, str] | None = None,
) -> list[SpeciesPhysiology]:
    """Load the packaged default data file (``data/species_physiology.json``).

    Tolerates an absent file (returns ``[]``) so the store still works if the
    resource is stripped; a present-but-malformed file still raises.
    """
    resource = files("hakase_kernel.pbpk.physiology").joinpath(*DEFAULT_DATA_RESOURCE)
    if not resource.is_file():
        return []
    rows = _parse(resource.read_text(encoding="utf-8"))
    return _register(
        rows,
        SPECIES_PHYSIOLOGY if registry is None else registry,
        DEFAULT_STRAIN if default_strain is None else default_strain,
    )


__all__ = ["load_species_definitions", "load_default"]
