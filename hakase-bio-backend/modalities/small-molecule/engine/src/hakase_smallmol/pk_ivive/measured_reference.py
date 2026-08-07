"""Curated, cited measured-input reference for rat IVIVE.

WHY THIS EXISTS
───────────────
``predict_pk_ivive`` sources its intrinsic clearance from the ADMET endpoint
``Clearance_Hepatocyte_AZ``, which is HUMAN-trained. For *rat* that value is
statistically uninformative (Spearman 0.21 vs observed rat CL — see
``docs/pbpk-s2t5-validation-handoff.md`` §3.4), so a structure→human-ML→rat-IVIVE
path fails the rat clearance gate. We DO, however, have real measured rat
hepatocyte CLint (plus fu and blood:plasma ratio) for a small set of drugs,
curated from primary sources and previously living ONLY in the validation CSVs.

This module lifts that curated, primary-source-traced data into a resource that
production can consult *before* falling back to the human ML value — turning the
validation curation into a real production improvement, without ever fabricating
a number (the no-fallback contract is preserved: a compound not in the reference
simply yields ``None`` and the ML path runs as before).

DATA PROVENANCE (``resources/measured_clint_reference.csv``)
───────────────────────────────────────────────────────────
Every row is rat, with each value traced to a primary table:
  • Naritomi et al. 2003, DMD 31(5):580 (PMID 12695346) — Table 3 rat
    freshly-isolated hepatocyte CLint (reported mL/min/kg ÷ 4.8 hepatocellularity
    → µL/min/10⁶ cells), Table 2 fu (fp) and blood:plasma ratio (RB). The 4.8 is
    rat HPGL 120e6 cells/g × liver 40 g/kg ÷ 1000 — the same 120e6/g the kernel
    physiology store now carries for rat, so the deconvolution here and the IVIVE
    re-scale in pk_ivive.py use one consistent, cited hepatocellularity.
  • Ito & Houston 2004, Pharm. Res. 21(5):785 (PMID 15180335) — Table I rat
    isolated-hepatocyte CLint (already µL/min/10⁶ cells) and fp.
These are the same values the S2-T5 clearance gate is validated on
(``datasets/rat_measured_clint_indomain.csv``); this reference is their
production-facing, structure-keyed twin.

SPECIES AWARENESS
─────────────────
All curated records are rat. ``lookup_measured_reference`` only returns a record
when the requested species matches the record's species, so a human (or any
non-rat) prediction is never silently served rat data.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

_REFERENCE_CSV = Path(__file__).parent / "resources" / "measured_clint_reference.csv"

# The input quantities this reference can supply to compute_ivive. VDss and
# half-life are deliberately absent — the reference targets the clearance path.
_SUPPLIED_KEYS = ("clint_hep_ul_min_1e6", "fu_plasma", "blood_plasma_ratio")


@dataclass(frozen=True)
class MeasuredRecord:
    """One curated, cited measured-input row (rat)."""

    compound_name: str
    canonical_smiles: str
    inchikey: str
    species: str
    clint_hep_ul_min_1e6: float | None
    fu_plasma: float | None
    blood_plasma_ratio: float | None
    source: str
    reference_pmid: str

    def short_citation(self) -> str:
        """A compact author-year tag, e.g. ``Naritomi 2003`` — the leading text
        of ``source`` before its per-table detail."""
        head = self.source.split(" Table", 1)[0].strip()
        return head or self.source.strip()

    def provenance_label(self) -> str:
        """The provenance string surfaced on an input, e.g.
        ``measured (Naritomi 2003, PMID:12695346)``."""
        return f"measured ({self.short_citation()}, PMID:{self.reference_pmid})"

    def value_for(self, key: str) -> float | None:
        return getattr(self, key, None)


def _parse_float(raw: str | None) -> float | None:
    """Parse a CSV cell to a finite float, or None for blank/unparseable."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    # Reject NaN/Inf so a bad cell can never drive an output.
    return v if v == v and v not in (float("inf"), float("-inf")) else None


@lru_cache(maxsize=1)
def _load_reference() -> dict[tuple[str, str], MeasuredRecord]:
    """Load the reference CSV into an ``(inchikey, species)`` → record map.

    Cached for the process; ``load_reference.cache_clear()`` (via
    ``_load_reference``) resets it for tests that patch the file. Missing file →
    empty map (the ML path then runs unchanged), never an exception.
    """
    table: dict[tuple[str, str], MeasuredRecord] = {}
    if not _REFERENCE_CSV.exists():
        return table
    with _REFERENCE_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ikey = (row.get("inchikey") or "").strip()
            species = (row.get("species") or "").strip().lower()
            if not ikey or not species:
                continue
            rec = MeasuredRecord(
                compound_name=(row.get("compound_name") or "").strip(),
                canonical_smiles=(row.get("canonical_smiles") or "").strip(),
                inchikey=ikey,
                species=species,
                clint_hep_ul_min_1e6=_parse_float(row.get("clint_hep_ul_min_1e6")),
                fu_plasma=_parse_float(row.get("fu_plasma")),
                blood_plasma_ratio=_parse_float(row.get("blood_plasma_ratio")),
                source=(row.get("source") or "").strip(),
                reference_pmid=(row.get("reference_pmid") or "").strip(),
            )
            table[(ikey, species)] = rec
    return table


def inchikey_from_smiles(smiles: str | None) -> str | None:
    """Derive an InChIKey from a SMILES via RDKit for exact structural matching.

    Returns None when RDKit is unavailable or the SMILES is invalid — the caller
    then simply falls through to the ML path. Never raises.
    """
    if not smiles:
        return None
    try:
        from rdkit import Chem  # local import; optional dependency
    except Exception:  # noqa: BLE001 — RDKit missing → no reference match
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return Chem.MolToInchiKey(mol) or None
    except Exception:  # noqa: BLE001 — invalid input → no reference match
        return None


def lookup_measured_record(smiles: str, species: str) -> MeasuredRecord | None:
    """Return the curated measured record for this structure + species, or None.

    Matching is by RDKit InChIKey (robust to SMILES form) and is species-aware:
    a rat record is returned only when ``species`` resolves to rat, so a
    non-rat prediction is never served rat data.
    """
    ikey = inchikey_from_smiles(smiles)
    if ikey is None:
        return None
    sp = (species or "").strip().lower()
    return _load_reference().get((ikey, sp))


def lookup_measured_reference(smiles: str, species: str) -> dict[str, Any] | None:
    """Resolve curated measured inputs for a structure, keyed by input name.

    Returns ``{key: {"value", "provenance", "source"}}`` for each of
    ``clint_hep_ul_min_1e6`` / ``fu_plasma`` / ``blood_plasma_ratio`` that the
    record actually carries (a blank cell is omitted, never zero-filled), or
    None when there is no species-matched record. ``provenance`` is always
    ``"measured (<cite>, PMID:<pmid>)"``.
    """
    rec = lookup_measured_record(smiles, species)
    if rec is None:
        return None
    label = rec.provenance_label()
    resolved: dict[str, Any] = {}
    for key in _SUPPLIED_KEYS:
        val = rec.value_for(key)
        if val is not None:
            resolved[key] = {"value": val, "provenance": label, "source": rec.source}
    if not resolved:
        return None
    resolved["_compound"] = rec.compound_name
    return resolved
