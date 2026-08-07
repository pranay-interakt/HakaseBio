"""The canonical Target domain object (doc 03 "Target").

Represents the biological target a peptide is intended to engage. Optional for
target-agnostic modalities (e.g. antimicrobial peptides), required for targeted
binders. A target may be specified by a UniProt accession, a PDB id, and/or a
raw receptor sequence — all real, resolvable references (no fabricated data).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .ids import deterministic_id
from .peptide import KNOWN_NONSTANDARD, STANDARD_AA


class TargetValidationError(ValueError):
    pass


_UNIPROT_RE = re.compile(
    r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$"
)
_PDB_RE = re.compile(r"^[0-9][A-Za-z0-9]{3}$")
_CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,4}$")


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


@dataclass(frozen=True)
class Target:
    name: str | None = None
    uniprot_accession: str | None = None
    pdb_id: str | None = None
    chain_id: str | None = None
    sequence: str | None = None
    organism: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        *,
        name: str | None = None,
        uniprot_accession: str | None = None,
        pdb_id: str | None = None,
        chain_id: str | None = None,
        sequence: str | None = None,
        organism: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Target:
        nm = _clean_optional_text(name)

        acc = _clean_optional_text(uniprot_accession)
        acc = acc.upper() if acc else None
        if acc and not _UNIPROT_RE.match(acc):
            raise TargetValidationError(f"'{acc}' is not a valid UniProt accession.")

        pdb = _clean_optional_text(pdb_id)
        if pdb and not _PDB_RE.match(pdb):
            raise TargetValidationError(
                f"'{pdb}' is not a valid PDB id (expected 4 chars, e.g. 1ABC)."
            )

        chain = _clean_optional_text(chain_id)
        if chain and not pdb:
            raise TargetValidationError("Target chain_id requires pdb_id.")
        if chain and not _CHAIN_RE.match(chain):
            raise TargetValidationError(
                f"'{chain}' is not a valid PDB chain id (expected 1-4 alphanumeric chars)."
            )

        seq = None
        if sequence is not None:
            seq = re.sub(r"\s+", "", str(sequence)).upper()
            if not seq:
                seq = None
        if seq:
            # Match the peptide domain convention: target sequences accept only
            # the 20 standard amino acids; ambiguous/non-standard B/Z/X/J/U/O
            # are rejected with an explicit validation error.
            bad = sorted({c for c in seq if c not in STANDARD_AA})
            if bad:
                nonstd = [c for c in bad if c in KNOWN_NONSTANDARD]
                hint = (
                    f" Ambiguous/non-standard target residues are not supported: {nonstd}."
                    if nonstd
                    else ""
                )
                raise TargetValidationError(
                    f"Target sequence contains invalid residues {bad}. "
                    f"Only the 20 standard amino acids are accepted.{hint}"
                )

        org = _clean_optional_text(organism)
        if not any([nm, acc, seq, pdb]):
            raise TargetValidationError(
                "Target must include at least one of: name, uniprot_accession, sequence, or pdb_id."
            )

        return cls(
            name=nm,
            uniprot_accession=acc,
            pdb_id=pdb.upper() if pdb else None,
            chain_id=chain,
            sequence=seq,
            organism=org,
            metadata=dict(metadata or {}),
        )

    @property
    def is_specified(self) -> bool:
        return any([self.uniprot_accession, self.pdb_id, self.sequence, self.name])

    @property
    def target_id(self) -> str | None:
        if not self.is_specified:
            return None
        return deterministic_id(
            "target",
            self.uniprot_accession or "",
            self.pdb_id or "",
            self.chain_id or "",
            self.sequence or "",
            self.name or "",
            self.organism or "",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_id": self.target_id,
            "name": self.name,
            "uniprot_accession": self.uniprot_accession,
            "pdb_id": self.pdb_id,
            "chain_id": self.chain_id,
            "sequence": self.sequence,
            "sequence_length": len(self.sequence) if self.sequence else None,
            "organism": self.organism,
            "metadata": self.metadata,
        }
