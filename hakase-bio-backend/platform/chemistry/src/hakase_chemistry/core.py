"""Cheminformatics descriptor engine for modified peptides (Spec §6.1, §8, §9).

The core physicochemical descriptors (§6.1–6.10) are pure sequence sums and need
no chemistry engine. This module handles the *exception*: the mass and molecular
descriptors of non-standard chemistry attached to a peptide — lipid tails, PEG
linkers, exotic caps — which the Descriptor Calculator cannot derive from the
20-letter alphabet (§9 "Cheminformatics descriptor engine"; §8 "ChEMBL / PubChem
… resolving chemical structures of non-standard residues or small-molecule
modifications").

Design rules, straight from the spec and the roadmap:

* **No fabrication.** A mass increment is returned only when it comes from a
  well-defined literature constant (built-in table), an RDKit computation over a
  concrete structure (user SMILES or a structure resolved from ChEMBL/PubChem),
  or is otherwise exactly derivable. Anything else returns ``available=False``
  with an explicit reason code (§11 "Coverage of non-standard chemistry"; §12
  graceful degradation). A polydisperse PEG with no explicit structure is, by
  its nature, not exactly resolvable and is reported unavailable.
* **RDKit is optional.** It is not a hard dependency of the platform; if it is
  absent the engine degrades to the built-in table / database path and, failing
  those, to ``unavailable`` — it never raises on import.
* **Network access only via the Resource Manager** (§8; Architecture Spec §4.6).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# -- Optional RDKit (never a hard dependency) --------------------------------
try:  # pragma: no cover - exercised only where RDKit is installed
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, rdMolDescriptors

    _HAS_RDKIT = True
except Exception:  # noqa: BLE001 - any import failure => engine degrades
    _HAS_RDKIT = False


# ---------------------------------------------------------------------------
# Reason codes
# ---------------------------------------------------------------------------

REASON_RDKIT_ABSENT = "rdkit_absent"
REASON_NOT_FOUND = "chem_structure_not_found"
REASON_NETWORK = "chem_lookup_network_error"
REASON_UNRESOLVABLE = "chem_unresolvable"
REASON_POLYDISPERSE = "polydisperse_no_structure"


@dataclass(frozen=True)
class LinkerResult:
    """Outcome of resolving one modification's appended chemistry.

    ``available`` means an *exact* mass increment was obtained; ``mass_avg`` /
    ``mass_mono`` are the average / monoisotopic increments (Da). ``descriptors``
    carries optional RDKit-derived molecular descriptors (logP, TPSA, HBD, HBA).
    On failure ``available`` is False and ``reason`` names why — never a guessed
    number.
    """

    descriptor: str
    available: bool
    mass_avg: float | None = None
    mass_mono: float | None = None
    source: str = ""
    reason: str | None = None
    descriptors: dict[str, float] = field(default_factory=dict)
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "descriptor": self.descriptor,
            "available": self.available,
            "mass_increment_avg_da": self.mass_avg,
            "mass_increment_mono_da": self.mass_mono,
            "source": self.source,
            "reason": self.reason,
            "molecular_descriptors": self.descriptors or None,
            "note": self.note,
        }


# ---------------------------------------------------------------------------
# Built-in mass increments for well-defined acyl (lipidation) chemistry.
# Increment = fatty-acid mass − H2O (amide-bond condensation). These are exact
# literature constants, not fabricated.
# ---------------------------------------------------------------------------
_LIPID_INCREMENTS: dict[str, tuple[float, float]] = {
    # normalized_key: (avg_da, mono_da)
    "lauroyl": (182.30, 182.16707),  # C12, lauric acid − H2O
    "myristoyl": (210.36, 210.19837),  # C14, myristic acid − H2O
    "palmitoyl": (238.41, 238.22967),  # C16, palmitic acid − H2O
    "stearoyl": (266.46, 266.26097),  # C18, stearic acid − H2O
}
# Synonyms mapped onto the canonical acyl key above.
_LIPID_SYNONYMS: dict[str, str] = {
    "c12": "lauroyl",
    "lauric": "lauroyl",
    "dodecanoyl": "lauroyl",
    "c14": "myristoyl",
    "myristic": "myristoyl",
    "tetradecanoyl": "myristoyl",
    "c16": "palmitoyl",
    "palmitic": "palmitoyl",
    "hexadecanoyl": "palmitoyl",
    "c18": "stearoyl",
    "stearic": "stearoyl",
    "octadecanoyl": "stearoyl",
}

_PEG_RE = re.compile(r"^peg[\s_-]?(\d+)", re.IGNORECASE)


def _normkey(descriptor: str) -> str:
    return re.sub(r"[^a-z0-9]", "", descriptor.strip().lower())


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def resolve_linker(
    descriptor: str,
    *,
    smiles: str | None = None,
    resources: Any = None,
) -> LinkerResult:
    """Resolve an exact mass increment (and optional descriptors) for a linker.

    Resolution order (first exact hit wins):
      1. Built-in acyl/lipid constant table.
      2. RDKit over a user-supplied SMILES.
      3. Structure resolved from ChEMBL/PubChem (via ``resources``) + RDKit.
      4. ``unavailable`` with a reason code (incl. polydisperse PEG w/o structure).

    ``resources`` is a Resource Manager exposing ``fetch_pubchem_by_name`` /
    ``fetch_chembl_by_name``; if ``None`` the database path is skipped.
    """
    descriptor = (descriptor or "").strip()
    key = _normkey(descriptor)

    # 1. Built-in lipid/acyl constants ------------------------------------
    canon = _LIPID_SYNONYMS.get(key, key)
    if canon in _LIPID_INCREMENTS:
        avg, mono = _LIPID_INCREMENTS[canon]
        return LinkerResult(
            descriptor=descriptor,
            available=True,
            mass_avg=avg,
            mass_mono=mono,
            source="builtin_acyl_table",
            note=f"Exact acyl increment for {canon} (fatty acid − H2O).",
        )

    # 2. RDKit over an explicit SMILES ------------------------------------
    if smiles:
        if _HAS_RDKIT:
            res = _from_smiles(descriptor, smiles, source="rdkit_smiles")
            if res is not None:
                return res
            return LinkerResult(
                descriptor=descriptor,
                available=False,
                source="rdkit_smiles",
                reason=REASON_UNRESOLVABLE,
                note=f"RDKit could not parse SMILES '{smiles}'.",
            )
        return LinkerResult(
            descriptor=descriptor,
            available=False,
            source="rdkit_smiles",
            reason=REASON_RDKIT_ABSENT,
            note="SMILES supplied but RDKit is not installed; mass increment unavailable.",
        )

    # 3. Resolve a structure from ChEMBL / PubChem, then RDKit ------------
    if resources is not None:
        resolved = _resolve_from_databases(descriptor, resources)
        if resolved is not None and resolved.get("smiles") and _HAS_RDKIT:
            res = _from_smiles(descriptor, resolved["smiles"], source=resolved["source"])
            if res is not None:
                return res
        if resolved is not None and resolved.get("mass_avg") is not None:
            # DB gave a molecular weight but no usable structure for RDKit — the
            # weight of the isolated molecule is not the *conjugation* increment,
            # so we do NOT treat it as an exact increment (no fabrication).
            return LinkerResult(
                descriptor=descriptor,
                available=False,
                source=resolved["source"],
                reason=REASON_UNRESOLVABLE,
                note=(
                    f"{resolved['source']} returned a molecular weight for "
                    f"'{descriptor}' but no structure usable for an exact "
                    f"conjugation increment."
                ),
            )
        if resolved is None:
            return LinkerResult(
                descriptor=descriptor,
                available=False,
                source="resource_manager",
                reason=REASON_NOT_FOUND,
                note=f"No structure found for '{descriptor}' in ChEMBL/PubChem.",
            )

    # 4. Nothing exact — explicit unavailable -----------------------------
    if _PEG_RE.match(descriptor):
        return LinkerResult(
            descriptor=descriptor,
            available=False,
            source="",
            reason=REASON_POLYDISPERSE,
            note=(
                f"'{descriptor}' denotes a polydisperse PEG; provide an explicit "
                f"structure (SMILES) for an exact mass increment."
            ),
        )
    return LinkerResult(
        descriptor=descriptor,
        available=False,
        source="",
        reason=REASON_RDKIT_ABSENT if not _HAS_RDKIT else REASON_UNRESOLVABLE,
        note=f"No reference parameters for '{descriptor}'; mass increment unavailable.",
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _from_smiles(descriptor: str, smiles: str, *, source: str) -> LinkerResult | None:
    """RDKit descriptors + exact fragment mass from a concrete SMILES.

    Returns ``None`` if the SMILES cannot be parsed. The reported increment is the
    exact mass of the appended fragment as written; callers pass the fragment that
    is actually added (leaving-group already accounted for in the SMILES).
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    mass_avg = float(Descriptors.MolWt(mol))
    mass_mono = float(rdMolDescriptors.CalcExactMolWt(mol))
    descriptors = {
        "logp": round(float(Crippen.MolLogP(mol)), 3),
        "tpsa": round(float(rdMolDescriptors.CalcTPSA(mol)), 3),
        "hbd": int(rdMolDescriptors.CalcNumHBD(mol)),
        "hba": int(rdMolDescriptors.CalcNumHBA(mol)),
    }
    return LinkerResult(
        descriptor=descriptor,
        available=True,
        mass_avg=round(mass_avg, 5),
        mass_mono=round(mass_mono, 5),
        source=source,
        descriptors=descriptors,
        note="Mass and descriptors computed by RDKit from the supplied structure.",
    )


def _resolve_from_databases(descriptor: str, resources: Any) -> dict[str, Any] | None:
    """Try PubChem then ChEMBL via the Resource Manager. Never raises.

    Returns ``{smiles, mass_avg, source}`` on a hit, ``None`` on a clean miss.
    Network failures are swallowed here (graceful degradation, §12) — the caller
    reports ``unavailable`` rather than failing the whole service.
    """
    for fetch_name, source in (
        ("fetch_pubchem_by_name", "pubchem"),
        ("fetch_chembl_by_name", "chembl"),
    ):
        fetch = getattr(resources, fetch_name, None)
        if fetch is None:
            continue
        try:
            hit = fetch(descriptor)
        except Exception:  # noqa: BLE001 - degrade; do not fail the service
            continue
        if hit:
            hit = dict(hit)
            hit["source"] = source
            return hit
    return None
