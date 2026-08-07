"""Metabolic-clearance applicability guard for the IVIVE path.

WHY THIS EXISTS
───────────────
The IVIVE clearance model (:mod:`pk_ivive.pk_ivive`) is a **well-stirred hepatic
metabolic** model: it scales an in-vitro hepatocyte intrinsic clearance to a
whole-body clearance under the assumption that *metabolism* is the rate-limiting
step. That assumption fails for drugs whose hepatic disposition is governed by
**membrane transporters** — OATP-mediated hepatic uptake and/or biliary efflux —
rather than by enzyme turnover. For those compounds the model is OUT OF DOMAIN:
CLint is not the rate-determining quantity, so the number the well-stirred
equation returns is not a meaningful clearance prediction.

This is a *specific* limitation that the general structural/physchem
applicability domain (``predict_applicability_domain``) does not capture — a
transporter substrate can sit comfortably inside the ADMET model's chemical
space yet still be mechanistically out of domain for *metabolic* clearance. The
S2-T5 validation made the exclusion explicit: troglitazone, rosuvastatin and
bosentan were held out of the metabolic-CL benchmark precisely because their
clearance is transporter-mediated (see ``docs/pbpk-s2t5-validation-handoff.md``
§3.6 and ``data/rat hepatocyte CLint.csv`` notes).

DESIGN — CONSERVATIVE, CURATED, CITED
─────────────────────────────────────
A false "out of domain" (refusing a good prediction) is worse than staying
silent, so the guard is deliberately narrow: it flags only compounds on a
**curated, primary-source-cited list** of known transporter substrates /
non-metabolic-clearance drugs, keyed by InChIKey
(``resources/nonmetabolic_clearance_flags.csv``). Matching is by the InChIKey
**connectivity block** (first 14 chars) so a differently-drawn or differently-
stereo'd form of the same drug still matches, but distinct molecules never
collide.

NO STRUCTURAL/PHYSCHEM HEURISTIC IS SHIPPED (and here is why)
────────────────────────────────────────────────────────────
The obvious heuristic — "flag anionic, highly-bound, low-passive-permeability
acids" — would misclassify drugs that ARE in domain. Diclofenac is an acid with
fu ≈ 0.017 that is metabolically cleared and sits *inside* the validated
metabolic-CL set (``datasets/rat_measured_clint_indomain.csv``); an acid+binding
heuristic would wrongly flag it. Because the task prioritises avoiding false
out-of-domain calls, the physchem heuristic is intentionally omitted; the guard
grows by adding cited rows, not by widening a fuzzy rule. This module is the
single place to add a heuristic later if one is ever cleanly justified.

CONTRACT
────────
:func:`assess_metabolic_clearance_domain` never raises and never fabricates a
verdict from a guess: when the structure cannot be resolved (RDKit missing /
invalid SMILES) it returns ``in_domain = True`` with a note that the check could
not run — i.e. it does not manufacture a false exclusion.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

_FLAGS_CSV = Path(__file__).parent / "resources" / "nonmetabolic_clearance_flags.csv"

# The verdict string surfaced when a compound is a known non-metabolic-CL case.
OUT_OF_DOMAIN_VERDICT = "out-of-domain-for-metabolic-CL"
IN_DOMAIN_VERDICT = "in-domain-for-metabolic-CL"

# Length of the InChIKey connectivity block (the skeleton, before the first '-').
_SKELETON_LEN = 14


@dataclass(frozen=True)
class NonMetabolicFlag:
    """One curated, cited transporter-substrate / non-metabolic-clearance row."""

    compound_name: str
    canonical_smiles: str
    inchikey: str
    mechanism: str
    rationale: str
    reference: str
    reference_pmid: str

    @property
    def inchikey_skeleton(self) -> str:
        return self.inchikey[:_SKELETON_LEN]


@dataclass
class MetabolicDomainVerdict:
    """Result of the metabolic-clearance applicability check for one structure."""

    in_domain: bool
    verdict: str
    rationale: str | None
    compound: str | None = None
    mechanism: str | None = None
    references: list[str] = field(default_factory=list)
    inchikey: str | None = None
    check_ran: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "in_domain": self.in_domain,
            "verdict": self.verdict,
            "flagged": not self.in_domain,
            "compound": self.compound,
            "mechanism": self.mechanism,
            "rationale": self.rationale,
            "references": list(self.references),
            "inchikey": self.inchikey,
            "check_ran": self.check_ran,
            "guard": "metabolic-clearance applicability (curated transporter-substrate list)",
        }


@lru_cache(maxsize=1)
def _load_flags() -> dict[str, NonMetabolicFlag]:
    """Load the curated flag CSV into an ``inchikey_skeleton`` → row map.

    Missing file → empty map (guard then flags nothing), never an exception, so a
    stripped deployment simply gets no metabolic-domain flags rather than a crash.
    """
    table: dict[str, NonMetabolicFlag] = {}
    if not _FLAGS_CSV.exists():
        return table
    with _FLAGS_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ikey = (row.get("inchikey") or "").strip()
            if not ikey:
                continue
            flag = NonMetabolicFlag(
                compound_name=(row.get("compound_name") or "").strip(),
                canonical_smiles=(row.get("canonical_smiles") or "").strip(),
                inchikey=ikey,
                mechanism=(row.get("mechanism") or "").strip(),
                rationale=(row.get("rationale") or "").strip(),
                reference=(row.get("reference") or "").strip(),
                reference_pmid=(row.get("reference_pmid") or "").strip(),
            )
            table[flag.inchikey_skeleton] = flag
    return table


def _inchikey_from_smiles(smiles: str | None) -> str | None:
    """Derive an InChIKey via RDKit, or None when unavailable/invalid. Never raises."""
    if not smiles:
        return None
    try:
        from rdkit import Chem  # local import; optional dependency
    except Exception:  # noqa: BLE001 — RDKit missing → guard cannot run
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return Chem.MolToInchiKey(mol) or None
    except Exception:  # noqa: BLE001 — invalid input → guard cannot run
        return None


def lookup_nonmetabolic_flag(smiles: str) -> NonMetabolicFlag | None:
    """Return the curated non-metabolic-clearance flag for this structure, or None.

    Matching is by InChIKey connectivity block (first 14 chars), so alternate
    SMILES forms / stereo variants of a flagged drug still match while distinct
    molecules do not. Species-agnostic: transporter-substrate status is a property
    of the molecule, not the test species.
    """
    ikey = _inchikey_from_smiles(smiles)
    if ikey is None:
        return None
    return _load_flags().get(ikey[:_SKELETON_LEN])


def assess_metabolic_clearance_domain(smiles: str) -> MetabolicDomainVerdict:
    """Judge whether the metabolic well-stirred IVIVE model is in domain for a drug.

    Returns a :class:`MetabolicDomainVerdict`. A compound on the curated
    transporter-substrate list is ``in_domain = False`` with the concrete
    mechanism and citation; everything else is ``in_domain = True``. When the
    structure cannot be resolved the verdict is in-domain but ``check_ran =
    False`` — the guard never manufactures a false exclusion.
    """
    ikey = _inchikey_from_smiles(smiles)
    if ikey is None:
        return MetabolicDomainVerdict(
            in_domain=True,
            verdict=IN_DOMAIN_VERDICT,
            rationale=None,
            check_ran=False,
        )

    flag = _load_flags().get(ikey[:_SKELETON_LEN])
    if flag is None:
        return MetabolicDomainVerdict(
            in_domain=True,
            verdict=IN_DOMAIN_VERDICT,
            rationale=None,
            inchikey=ikey,
        )

    rationale = (
        f"{flag.compound_name or 'This compound'} is a known non-metabolic-clearance "
        f"case ({flag.mechanism}). The IVIVE clearance model is a well-stirred HEPATIC "
        f"METABOLIC model and is OUT OF DOMAIN here: {flag.rationale} Treat the returned "
        f"clearance / half-life / exposure as unreliable and use measured in-vivo "
        f"clearance instead."
    )
    references = [r for r in (flag.reference, f"PMID:{flag.reference_pmid}") if r]
    return MetabolicDomainVerdict(
        in_domain=False,
        verdict=OUT_OF_DOMAIN_VERDICT,
        rationale=rationale,
        compound=flag.compound_name or None,
        mechanism=flag.mechanism or None,
        references=references,
        inchikey=ikey,
    )


__all__ = [
    "OUT_OF_DOMAIN_VERDICT",
    "IN_DOMAIN_VERDICT",
    "NonMetabolicFlag",
    "MetabolicDomainVerdict",
    "lookup_nonmetabolic_flag",
    "assess_metabolic_clearance_domain",
]
