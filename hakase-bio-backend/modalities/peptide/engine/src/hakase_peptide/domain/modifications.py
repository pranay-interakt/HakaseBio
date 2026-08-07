"""Structured modification model (Physicochemical Service Spec §5.1, §6, §12).

The Sequence Validation and Canonicalization Module (§5.1) is responsible for
turning free-text modification annotations — terminal capping, backbone/side-chain
cyclization, D-stereochemistry, lipidation, PEGylation — into a *structured*
representation that later modules consume without re-parsing free text. This
module is that representation.

Two hard rules, both from the spec:

* **Never fabricate parameters** (roadmap "Guiding constraint"; §11 "Coverage of
  non-standard chemistry"). A cap/linker whose mass increment is a well-known
  literature constant is applied exactly; anything else is left *unresolved*
  (``mass_avg is None``) so a downstream descriptor can be marked ``unavailable``
  rather than silently approximated.
* **Reject conflicting annotations at Stage 1** (§5.1, §12). Mutually inconsistent
  metadata — e.g. a terminus that is both consumed by a head-to-tail ring and
  separately capped or asserted free — raises :class:`ModificationConflictError`
  during canonicalization, which the Peptide domain object re-raises as a
  ``PeptideValidationError`` so the Workflow Orchestrator gets a validation
  failure instead of a partial Evidence Object.

This module performs no predictive computation; it is deterministic parsing,
normalization and constant lookup, consistent with the "Deterministic Algorithms"
category (Architecture Spec §1.6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# ---------------------------------------------------------------------------
# Reason codes (surfaced verbatim in evidence so downstream layers can branch)
# ---------------------------------------------------------------------------

REASON_UNKNOWN_CHEMISTRY = "unknown_modification_chemistry"


class ModificationConflictError(ValueError):
    """Raised when modification annotations are mutually inconsistent (§5.1/§12).

    Re-raised by :meth:`Peptide.create` as ``PeptideValidationError`` so the
    conflict is rejected at Stage 1 rather than guessed at.
    """


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------


class ModType(str, Enum):
    """Canonical modification categories the descriptor modules understand."""

    N_TERM_ACETYL = "n_term_acetyl"  # N-terminal acetylation (known mass)
    N_TERM_CAP = "n_term_cap"  # other N-terminal cap (mass via table)
    C_TERM_AMIDE = "c_term_amide"  # C-terminal amidation (known mass)
    C_TERM_CAP = "c_term_cap"  # other C-terminal cap (mass via table)
    CYCLIZATION_HEAD_TO_TAIL = "cyclization_head_to_tail"
    CYCLIZATION_SIDE_CHAIN = "cyclization_side_chain"
    DISULFIDE = "disulfide"  # recorded; geometry handled by bridges
    D_AMINO_ACID = "d_amino_acid"  # D-stereochemistry at a position
    PEGYLATION = "pegylation"  # PEG linker (mass via cheminformatics)
    LIPIDATION = "lipidation"  # lipid/acyl tail (mass via cheminformatics)
    UNKNOWN = "unknown"  # declared but uncategorised


# Terminus sentinels used in place of a 1-based residue index.
N_TERMINUS = "N"
C_TERMINUS = "C"

# String tokens that map onto a canonical cap. Everything else on a terminus is
# an *other* cap whose mass must be resolved (or left unavailable).
_N_TERM_ACETYL_TOKENS = {"acetyl", "acetylation", "ac", "n-acetyl", "ace"}
_C_TERM_AMIDE_TOKENS = {"amide", "amidation", "amidated", "nh2", "-nh2", "conh2"}
_FREE_TOKENS = {"free", "none", "h", "oh", "unmodified", ""}
_HEAD_TO_TAIL_TOKENS = {
    "head_to_tail",
    "head-to-tail",
    "headtotail",
    "backbone",
    "n_to_c",
    "n-to-c",
    "cyclic",
    "true",
}
_SIDE_CHAIN_TOKENS = {"side_chain", "sidechain", "side-chain", "lactam", "sidechain_bridge"}
_DISULFIDE_TOKENS = {"disulfide", "ss", "s-s", "cystine"}


# ---------------------------------------------------------------------------
# Structured modification record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Modification:
    """One canonicalized modification.

    Attributes
    ----------
    mod_type : ModType
        Canonical category.
    site : str | int
        ``"N"`` / ``"C"`` for a terminus, otherwise a 1-based residue index. For
        whole-molecule cyclization the site is ``0``.
    descriptor : str | None
        The original label (e.g. ``"PEG2000"``, ``"palmitoyl"``, ``"C18-diacid"``)
        carried forward so the cheminformatics engine can resolve a mass.
    mass_avg : float | None
        Average-mass increment (Da) if it is a *known* literature constant;
        ``None`` when it must be resolved elsewhere or is genuinely unknown.
    mass_mono : float | None
        Monoisotopic-mass increment (Da), same availability rule as ``mass_avg``.
    smiles : str | None
        Optional user-supplied SMILES for the appended chemistry.
    note : str | None
        Human-readable annotation (never a fabricated number).
    """

    mod_type: ModType
    site: Any = 0
    descriptor: str | None = None
    mass_avg: float | None = None
    mass_mono: float | None = None
    smiles: str | None = None
    note: str | None = None

    @property
    def mass_resolved(self) -> bool:
        return self.mass_avg is not None and self.mass_mono is not None

    def canonical_tuple(self) -> tuple[Any, ...]:
        """Deterministic, hashable identity for caching / subject_id."""
        return (
            self.mod_type.value,
            str(self.site),
            self.descriptor or "",
            self.smiles or "",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.mod_type.value,
            "site": self.site,
            "descriptor": self.descriptor,
            "mass_increment_avg_da": self.mass_avg,
            "mass_increment_mono_da": self.mass_mono,
            "smiles": self.smiles,
            "mass_resolved": self.mass_resolved,
            "note": self.note,
        }


# ---------------------------------------------------------------------------
# Known terminal-cap mass increments (Da) — established literature constants.
# ---------------------------------------------------------------------------
# Increments are relative to the FREE (uncapped) terminus. Sources noted; these
# are canonical Unimod values, not fabricated.
_N_CAP_INCREMENTS_AVG: dict[str, float] = {
    "acetyl": 42.0367,  # +C2H2O   (Unimod:1, Acetyl)
    "formyl": 28.0101,  # +CO      (Unimod:122, Formyl)
    "methyl": 14.0266,  # +CH2     (Unimod:34, Methyl)
}
_N_CAP_INCREMENTS_MONO: dict[str, float] = {
    "acetyl": 42.01057,
    "formyl": 27.99491,
    "methyl": 14.01565,
}
_C_CAP_INCREMENTS_AVG: dict[str, float] = {
    "amide": -0.9847,  # -OH +NH2 (Unimod:2, Amidated)
    "methyl": 14.0266,  # methyl ester +CH2
}
_C_CAP_INCREMENTS_MONO: dict[str, float] = {
    "amide": -0.98402,
    "methyl": 14.01565,
}


# ---------------------------------------------------------------------------
# ModificationSet
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModificationSet:
    """The canonicalized set of modifications for a peptide.

    Built via :meth:`from_raw`, which normalizes the free-form user dict and
    rejects conflicts (§5.1/§12). An empty set is the common case and is byte-
    for-byte inert: it contributes nothing to identity or descriptors, so
    unmodified peptides behave exactly as before.
    """

    modifications: tuple[Modification, ...] = field(default_factory=tuple)
    head_to_tail_cyclic: bool = False
    n_terminus_capped: bool = False
    c_terminus_capped: bool = False
    warnings: tuple[str, ...] = field(default_factory=tuple)

    # -- predicates the descriptor engine asks about ------------------------
    @property
    def is_empty(self) -> bool:
        return not self.modifications

    @property
    def n_terminus_free(self) -> bool:
        """N-terminus exposes a free amino group (charge-bearing)."""
        return not (self.head_to_tail_cyclic or self.n_terminus_capped)

    @property
    def c_terminus_free(self) -> bool:
        """C-terminus exposes a free carboxyl group (charge-bearing)."""
        return not (self.head_to_tail_cyclic or self.c_terminus_capped)

    def d_positions(self) -> list[int]:
        return sorted(int(m.site) for m in self.modifications if m.mod_type is ModType.D_AMINO_ACID)

    def linkers(self) -> list[Modification]:
        """PEG / lipid / unknown chemistry that needs a cheminformatics mass."""
        return [
            m
            for m in self.modifications
            if m.mod_type
            in (
                ModType.PEGYLATION,
                ModType.LIPIDATION,
                ModType.UNKNOWN,
                ModType.N_TERM_CAP,
                ModType.C_TERM_CAP,
            )
        ]

    def canonical_key(self) -> tuple[Any, ...]:
        """Deterministic identity for subject_id / lru_cache (empty when inert)."""
        if self.is_empty:
            return ()
        return tuple(sorted(m.canonical_tuple() for m in self.modifications))

    def to_list(self) -> list[dict[str, Any]]:
        return [m.to_dict() for m in self.modifications]

    # -- construction -------------------------------------------------------
    @classmethod
    def from_raw(
        cls,
        raw: dict[str, Any] | None,
        *,
        sequence: str,
        cyclic: bool = False,
        disulfide_bridges: tuple[tuple[int, int], ...] = (),
    ) -> ModificationSet:
        """Normalize a free-form modification dict into a validated set.

        Raises
        ------
        ModificationConflictError
            On mutually inconsistent annotations (§5.1/§12).
        """
        raw = dict(raw or {})
        n = len(sequence)
        mods: list[Modification] = []
        warnings: list[str] = []

        n_capped = False
        c_capped = False
        head_to_tail = bool(cyclic)
        side_chain_cyclic = False
        # Track whether the user *explicitly* asserted a free terminus, so we can
        # catch "free terminus + cyclized" (the spec's canonical conflict).
        n_asserted_free = False
        c_asserted_free = False

        def _norm(v: Any) -> str:
            return str(v).strip().lower()

        # -- N-terminus --------------------------------------------------------
        for key in ("n_terminus", "n_term", "n_terminal", "nterm"):
            if key in raw and raw[key] is not None:
                token = _norm(raw[key])
                if token in _FREE_TOKENS:
                    n_asserted_free = True
                elif token in _N_TERM_ACETYL_TOKENS:
                    n_capped = True
                    mods.append(
                        Modification(
                            ModType.N_TERM_ACETYL,
                            site=N_TERMINUS,
                            descriptor="acetyl",
                            mass_avg=_N_CAP_INCREMENTS_AVG["acetyl"],
                            mass_mono=_N_CAP_INCREMENTS_MONO["acetyl"],
                            note="N-terminal acetylation (Unimod:1).",
                        )
                    )
                else:
                    n_capped = True
                    avg = _N_CAP_INCREMENTS_AVG.get(token)
                    mono = _N_CAP_INCREMENTS_MONO.get(token)
                    mods.append(
                        Modification(
                            ModType.N_TERM_CAP,
                            site=N_TERMINUS,
                            descriptor=str(raw[key]),
                            mass_avg=avg,
                            mass_mono=mono,
                            note=(
                                f"N-terminal cap '{raw[key]}'."
                                + ("" if avg is not None else " Mass increment unresolved.")
                            ),
                        )
                    )
                break

        # -- C-terminus --------------------------------------------------------
        for key in ("c_terminus", "c_term", "c_terminal", "cterm"):
            if key in raw and raw[key] is not None:
                token = _norm(raw[key])
                if token in _FREE_TOKENS:
                    c_asserted_free = True
                elif token in _C_TERM_AMIDE_TOKENS:
                    c_capped = True
                    mods.append(
                        Modification(
                            ModType.C_TERM_AMIDE,
                            site=C_TERMINUS,
                            descriptor="amide",
                            mass_avg=_C_CAP_INCREMENTS_AVG["amide"],
                            mass_mono=_C_CAP_INCREMENTS_MONO["amide"],
                            note="C-terminal amidation (Unimod:2).",
                        )
                    )
                else:
                    c_capped = True
                    avg = _C_CAP_INCREMENTS_AVG.get(token)
                    mono = _C_CAP_INCREMENTS_MONO.get(token)
                    mods.append(
                        Modification(
                            ModType.C_TERM_CAP,
                            site=C_TERMINUS,
                            descriptor=str(raw[key]),
                            mass_avg=avg,
                            mass_mono=mono,
                            note=(
                                f"C-terminal cap '{raw[key]}'."
                                + ("" if avg is not None else " Mass increment unresolved.")
                            ),
                        )
                    )
                break

        # -- Cyclization -------------------------------------------------------
        for key in ("cyclization", "cyclisation", "cyclic_type"):
            if key in raw and raw[key] is not None:
                token = _norm(raw[key])
                if token in _FREE_TOKENS or token in ("false", "linear"):
                    pass  # explicitly linear; leave head_to_tail as the `cyclic` flag
                elif token in _HEAD_TO_TAIL_TOKENS:
                    head_to_tail = True
                    mods.append(
                        Modification(
                            ModType.CYCLIZATION_HEAD_TO_TAIL,
                            site=0,
                            descriptor=str(raw[key]),
                            mass_avg=0.0,
                            mass_mono=0.0,
                            note="Head-to-tail backbone cyclization (condensation, no net mass change beyond the peptide bond already modeled).",
                        )
                    )
                elif token in _SIDE_CHAIN_TOKENS:
                    side_chain_cyclic = True
                    mods.append(
                        Modification(
                            ModType.CYCLIZATION_SIDE_CHAIN,
                            site=0,
                            descriptor=str(raw[key]),
                            mass_avg=None,
                            mass_mono=None,
                            note="Side-chain cyclization declared; exact linker mass depends on the bridge chemistry.",
                        )
                    )
                elif token in _DISULFIDE_TOKENS:
                    mods.append(
                        Modification(
                            ModType.DISULFIDE,
                            site=0,
                            descriptor=str(raw[key]),
                            mass_avg=-2.0159,
                            mass_mono=-2.01565,  # -2H per S-S bond (per bond)
                            note="Disulfide cyclization; bridge geometry carried by disulfide_bridges.",
                        )
                    )
                else:
                    warnings.append(f"Unrecognised cyclization type '{raw[key]}'.")
                break

        # -- D-amino acids -----------------------------------------------------
        for key in ("d_residues", "d_amino_acids", "d_positions", "d_aa"):
            if key in raw and raw[key] is not None:
                for pos in _as_int_list(raw[key], key):
                    if not (1 <= pos <= n):
                        raise ModificationConflictError(
                            f"D-amino-acid position {pos} out of range for length {n}."
                        )
                    mods.append(
                        Modification(
                            ModType.D_AMINO_ACID,
                            site=pos,
                            descriptor=f"D-{sequence[pos-1]}",
                            mass_avg=0.0,
                            mass_mono=0.0,  # stereochemistry: no mass change
                            note=f"D-stereochemistry at position {pos} ({sequence[pos-1]}); no mass change, but proteolytic descriptors change.",
                        )
                    )
                break

        # -- PEGylation --------------------------------------------------------
        for key in ("pegylation", "peg", "pegs"):
            if key in raw and raw[key] is not None:
                for entry in _as_entry_list(raw[key]):
                    site = _resolve_site(entry, sequence, default=N_TERMINUS)
                    descriptor = _entry_descriptor(entry, default="PEG")
                    mods.append(
                        Modification(
                            ModType.PEGYLATION,
                            site=site,
                            descriptor=descriptor,
                            smiles=_entry_smiles(entry),
                            mass_avg=None,
                            mass_mono=None,  # resolved by cheminformatics
                            note=f"PEGylation '{descriptor}' at site {site}; mass via cheminformatics engine.",
                        )
                    )
                break

        # -- Lipidation --------------------------------------------------------
        for key in ("lipidation", "lipid", "acylation"):
            if key in raw and raw[key] is not None:
                for entry in _as_entry_list(raw[key]):
                    site = _resolve_site(entry, sequence, default=N_TERMINUS)
                    descriptor = _entry_descriptor(entry, default="lipid")
                    mods.append(
                        Modification(
                            ModType.LIPIDATION,
                            site=site,
                            descriptor=descriptor,
                            smiles=_entry_smiles(entry),
                            mass_avg=None,
                            mass_mono=None,  # resolved by cheminformatics
                            note=f"Lipidation '{descriptor}' at site {site}; mass via cheminformatics engine.",
                        )
                    )
                break

        # -- Generic / custom list --------------------------------------------
        for key in ("other", "custom", "modifications"):
            if key in raw and raw[key] is not None:
                for entry in _as_entry_list(raw[key]):
                    site = _resolve_site(entry, sequence, default=0)
                    descriptor = _entry_descriptor(entry, default="modification")
                    mods.append(
                        Modification(
                            ModType.UNKNOWN,
                            site=site,
                            descriptor=descriptor,
                            smiles=_entry_smiles(entry),
                            mass_avg=None,
                            mass_mono=None,
                            note=f"Uncategorised modification '{descriptor}'; mass via cheminformatics engine or unavailable.",
                        )
                    )
                break

        # -- Range validation for linker sites --------------------------------
        for m in mods:
            if isinstance(m.site, int) and m.site > 0 and not (1 <= m.site <= n):
                raise ModificationConflictError(
                    f"Modification '{m.descriptor or m.mod_type.value}' at position "
                    f"{m.site} is out of range for length {n}."
                )

        # -- Conflict detection (§5.1 / §12) ----------------------------------
        cls._check_conflicts(
            head_to_tail=head_to_tail,
            side_chain_cyclic=side_chain_cyclic,
            n_capped=n_capped,
            c_capped=c_capped,
            n_asserted_free=n_asserted_free,
            c_asserted_free=c_asserted_free,
            mods=mods,
        )

        return cls(
            modifications=tuple(mods),
            head_to_tail_cyclic=head_to_tail,
            n_terminus_capped=n_capped,
            c_terminus_capped=c_capped,
            warnings=tuple(warnings),
        )

    # -- conflict rules -----------------------------------------------------
    @staticmethod
    def _check_conflicts(
        *,
        head_to_tail: bool,
        side_chain_cyclic: bool,
        n_capped: bool,
        c_capped: bool,
        n_asserted_free: bool,
        c_asserted_free: bool,
        mods: list[Modification],
    ) -> None:
        # A head-to-tail ring consumes BOTH termini into a backbone amide, so
        # neither can also be capped or asserted free (spec's canonical example:
        # "a residue marked both cyclized and having a free terminus").
        if head_to_tail and n_capped:
            raise ModificationConflictError(
                "N-terminal cap conflicts with head-to-tail cyclization: the "
                "N-terminus is consumed by the backbone ring and cannot also be capped."
            )
        if head_to_tail and c_capped:
            raise ModificationConflictError(
                "C-terminal cap conflicts with head-to-tail cyclization: the "
                "C-terminus is consumed by the backbone ring and cannot also be capped."
            )
        if head_to_tail and n_asserted_free:
            raise ModificationConflictError(
                "Free N-terminus asserted alongside head-to-tail cyclization: the "
                "N-terminus is consumed by the backbone ring and cannot be free."
            )
        if head_to_tail and c_asserted_free:
            raise ModificationConflictError(
                "Free C-terminus asserted alongside head-to-tail cyclization: the "
                "C-terminus is consumed by the backbone ring and cannot be free."
            )

        # Two different caps declared on the same terminus.
        n_caps = [m for m in mods if m.mod_type in (ModType.N_TERM_ACETYL, ModType.N_TERM_CAP)]
        c_caps = [m for m in mods if m.mod_type in (ModType.C_TERM_AMIDE, ModType.C_TERM_CAP)]
        if len(n_caps) > 1:
            raise ModificationConflictError(
                "Multiple conflicting N-terminal caps declared: "
                f"{[m.descriptor for m in n_caps]}."
            )
        if len(c_caps) > 1:
            raise ModificationConflictError(
                "Multiple conflicting C-terminal caps declared: "
                f"{[m.descriptor for m in c_caps]}."
            )

        # Same residue declared as both a PEG and a lipid site, etc. — a residue
        # cannot carry two different side-chain conjugations at one attachment.
        by_site: dict[Any, list[Modification]] = {}
        for m in mods:
            if (
                m.mod_type in (ModType.PEGYLATION, ModType.LIPIDATION)
                and isinstance(m.site, int)
                and m.site > 0
            ):
                by_site.setdefault(m.site, []).append(m)
        for site, group in by_site.items():
            kinds = {m.mod_type for m in group}
            if len(kinds) > 1:
                raise ModificationConflictError(
                    f"Position {site} carries conflicting conjugations "
                    f"({sorted(k.value for k in kinds)}); one attachment site cannot hold both."
                )


# ---------------------------------------------------------------------------
# Small parsing helpers (kept private; deterministic, no fabrication)
# ---------------------------------------------------------------------------


def _as_int_list(value: Any, key: str) -> list[int]:
    if isinstance(value, (list, tuple)):
        items = value
    else:
        items = [value]
    out: list[int] = []
    for it in items:
        try:
            out.append(int(it))
        except (TypeError, ValueError):
            raise ModificationConflictError(
                f"Invalid position '{it}' in '{key}'; expected 1-based integer(s)."
            )
    return out


def _as_entry_list(value: Any) -> list[Any]:
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _resolve_site(entry: Any, sequence: str, *, default: Any) -> Any:
    if isinstance(entry, dict):
        for k in ("position", "site", "pos", "residue"):
            if k in entry and entry[k] is not None:
                v = entry[k]
                if isinstance(v, str) and v.strip().upper() in (N_TERMINUS, C_TERMINUS):
                    return v.strip().upper()
                try:
                    return int(v)
                except (TypeError, ValueError):
                    raise ModificationConflictError(f"Invalid modification site '{v}'.")
        return default
    # A bare string like "PEG2000@5" -> site 5.
    if isinstance(entry, str) and "@" in entry:
        _, _, tail = entry.partition("@")
        tail = tail.strip()
        if tail.upper() in (N_TERMINUS, C_TERMINUS):
            return tail.upper()
        try:
            return int(tail)
        except ValueError:
            raise ModificationConflictError(f"Invalid site in '{entry}'.")
    return default


def _entry_descriptor(entry: Any, *, default: str) -> str:
    if isinstance(entry, dict):
        for k in ("descriptor", "name", "type", "label", "chain", "size"):
            if k in entry and entry[k]:
                return str(entry[k])
        return default
    if isinstance(entry, str):
        return entry.partition("@")[0].strip() or default
    return default


def _entry_smiles(entry: Any) -> str | None:
    if isinstance(entry, dict):
        v = entry.get("smiles") or entry.get("SMILES")
        return str(v) if v else None
    return None
