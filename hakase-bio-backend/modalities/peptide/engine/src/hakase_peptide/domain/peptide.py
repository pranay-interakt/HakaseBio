"""The canonical Peptide domain object (doc 03 §5 "Peptide").

A validated, standardized representation of a peptide candidate that every
Scientific Service consumes. Construction performs real sequence validation;
an invalid sequence raises ``PeptideValidationError`` rather than being silently
coerced.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .ids import deterministic_id
from .modifications import ModificationConflictError, ModificationSet

# The 20 standard proteinogenic amino acids (single-letter IUPAC).
STANDARD_AA = set("ACDEFGHIKLMNPQRSTVWY")

# Ambiguity / non-standard codes we recognise well enough to reject with a clear
# message (B=Asx, Z=Glx, J=Leu/Ile, X=any, U=Sec, O=Pyl, * stop, - gap).
KNOWN_NONSTANDARD = set("BZJXUO*-")


class PeptideValidationError(ValueError):
    """Raised when a sequence or modification set cannot be validated."""


DisulfideBridgeSpec = str | list[list[int]] | list[tuple[int, int]] | tuple[tuple[int, int], ...]


def _parse_disulfides(spec: DisulfideBridgeSpec | None, seq_len: int) -> list[tuple[int, int]]:
    """Parse disulfide bridges into 1-based pairs.

    Positions are validated against the sequence length. No silent clamping.
    """
    if not spec:
        return []
    if isinstance(spec, (list, tuple)):
        return [_validate_disulfide_pair(pair, seq_len) for pair in spec]
    pairs: list[tuple[int, int]] = []
    for token in re.split(r"[;,]", spec.strip()):
        token = token.strip()
        if not token:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", token)
        if not m:
            raise PeptideValidationError(
                f"Invalid disulfide-bridge token '{token}'. Expected 'i-j' (1-based)."
            )
        pairs.append(_validate_disulfide_pair((int(m.group(1)), int(m.group(2))), seq_len))
    return pairs


def _validate_disulfide_pair(pair: object, seq_len: int) -> tuple[int, int]:
    if not isinstance(pair, (list, tuple)) or len(pair) != 2:
        raise PeptideValidationError(
            "Invalid disulfide bridge. Expected a 1-based pair like [i, j]."
        )
    try:
        i, j = int(pair[0]), int(pair[1])
    except (TypeError, ValueError) as exc:
        raise PeptideValidationError(
            "Invalid disulfide bridge. Positions must be integers."
        ) from exc
    if not (1 <= i <= seq_len and 1 <= j <= seq_len):
        raise PeptideValidationError(f"Disulfide bridge {i}-{j} out of range for length {seq_len}.")
    if i == j:
        raise PeptideValidationError(f"Disulfide bridge cannot pair a residue with itself ({i}).")
    return (min(i, j), max(i, j))


@dataclass(frozen=True)
class Peptide:
    """Immutable, validated peptide candidate.

    Attributes
    ----------
    sequence : str
        Cleaned single-letter sequence (upper-case, standard 20 AAs only).
    cyclic : bool
        Head-to-tail cyclisation flag.
    ph : float
        Environment pH used by pH-dependent physicochemical calculations.
    ionic_strength_mM : float
        Environment ionic strength in millimolar.
    disulfide_bridges : tuple
        1-based (i, j) cysteine pairs.
    modifications : dict
        Free-form user-declared modifications (e.g. N-terminal acetylation).
    mod_set : ModificationSet
        Canonicalized, conflict-checked structured view of ``modifications``
        (Physicochemical Service Spec §5.1). Empty and inert for unmodified
        peptides, so their identity and descriptors are unchanged.
    """

    sequence: str
    cyclic: bool = False
    ph: float = 7.4
    ionic_strength_mM: float = 150.0
    disulfide_bridges: tuple[tuple[int, int], ...] = field(default_factory=tuple)
    modifications: dict[str, Any] = field(default_factory=dict)
    mod_set: ModificationSet = field(default_factory=ModificationSet)

    # ---- construction -------------------------------------------------------
    @classmethod
    def create(
        cls,
        sequence: str,
        *,
        cyclic: bool = False,
        ph: float = 7.4,
        ionic_strength_mM: float = 150.0,
        disulfide_bridges: DisulfideBridgeSpec | None = None,
        modifications: dict[str, Any] | None = None,
    ) -> Peptide:
        if sequence is None:
            raise PeptideValidationError("Sequence is required.")
        cleaned = re.sub(r"\s+", "", str(sequence)).upper()
        if not cleaned:
            raise PeptideValidationError("Sequence is empty after whitespace removal.")

        bad = sorted({c for c in cleaned if c not in STANDARD_AA})
        if bad:
            nonstd = [c for c in bad if c in KNOWN_NONSTANDARD]
            hint = f" Non-standard/ambiguous codes are not supported: {nonstd}." if nonstd else ""
            raise PeptideValidationError(
                f"Sequence contains invalid residues {bad}. "
                f"Only the 20 standard amino acids are accepted.{hint}"
            )

        if not (0.0 <= ph <= 14.0):
            raise PeptideValidationError(f"pH {ph} out of range [0, 14].")
        if ionic_strength_mM < 0:
            raise PeptideValidationError("Ionic strength must be non-negative.")

        bridges = _parse_disulfides(disulfide_bridges, len(cleaned))
        for i, j in bridges:
            if cleaned[i - 1] != "C" or cleaned[j - 1] != "C":
                raise PeptideValidationError(
                    f"Disulfide bridge {i}-{j} does not connect two cysteines "
                    f"(found {cleaned[i-1]} and {cleaned[j-1]})."
                )

        # Stage-1 canonicalization of modification annotations (spec §5.1).
        # Conflicting/inconsistent metadata is rejected here rather than guessed
        # at (spec §12 "Conflicting modification annotations" -> reject at Stage 1).
        try:
            mod_set = ModificationSet.from_raw(
                modifications,
                sequence=cleaned,
                cyclic=bool(cyclic),
                disulfide_bridges=tuple(bridges),
            )
        except ModificationConflictError as exc:
            raise PeptideValidationError(str(exc)) from exc

        return cls(
            sequence=cleaned,
            # A head-to-tail cyclization declared purely via modifications must
            # still flip the peptide-level ``cyclic`` flag the descriptors read.
            cyclic=bool(cyclic) or mod_set.head_to_tail_cyclic,
            ph=float(ph),
            ionic_strength_mM=float(ionic_strength_mM),
            disulfide_bridges=tuple(bridges),
            modifications=dict(modifications or {}),
            mod_set=mod_set,
        )

    # ---- derived ------------------------------------------------------------
    @property
    def length(self) -> int:
        return len(self.sequence)

    @property
    def subject_id(self) -> str:
        """Reproducible identity: same peptide + environment => same id (doc 03 §3.2).

        The modification set participates in identity only when it is non-empty,
        so unmodified peptides keep their historical, byte-identical subject_id.
        """
        parts = [
            "peptide",
            self.sequence,
            int(self.cyclic),
            round(self.ph, 3),
            round(self.ionic_strength_mM, 3),
            self.disulfide_bridges,
        ]
        mod_key = self.mod_set.canonical_key()
        if mod_key:
            parts.append(mod_key)
        return deterministic_id(*parts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "sequence": self.sequence,
            "length": self.length,
            "cyclic": self.cyclic,
            "ph": self.ph,
            "ionic_strength_mM": self.ionic_strength_mM,
            "disulfide_bridges": [list(b) for b in self.disulfide_bridges],
            "modifications": self.modifications,
            "canonical_modifications": self.mod_set.to_list(),
        }
