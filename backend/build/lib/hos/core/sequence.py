"""Amino-acid sequences: one-letter codes, FASTA, average mass, and HELM structure.

Sources (docs/research/sequence_entities.md):

* **One-letter codes.** IUPAC-IUB 1983 Table 5 (3AA-21.2): the 20 standard residues, U
  (selenocysteine, a later addition), B (Asx), Z (Glx) and X (unknown). NCBI's BLAST input
  documentation accepts the same letters plus ``*`` (translation stop) and ``-`` (gap), which are
  file conventions, not residues. O (pyrrolysine) is in neither, but ExPASy's mass table carries
  it. Each symbol records the authority that defines it.
* **FASTA.** NCBI: a single-line description beginning with ">", followed by lines of sequence.
* **Average mass.** ExPASy Compute pI/Mw: "the addition of average isotopic masses of amino acids
  in the protein and the average isotopic mass of one water molecule"; the residue masses come
  from the separately versioned table in ``reference_params``. Post-translational
  modifications are not included. B, Z and X have no defined mass.
* **HELM.** HELM Standards Specification 2.04 (Pistoia Alliance), sections 5.2 to 5.5: the four
  "$"-terminated sections, polymer IDs, monomer IDs (bracketed when multi-character),
  monomer lists, repeats, annotations, connections, groups, extended annotation and the "V2.0"
  marker. A HELM string means nothing without the monomer set that resolves its IDs, so no
  mass is computed from HELM here.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from hos.core.methods import method
from hos.core.quantity import Quantity
from hos.core.reference_params import RESIDUE_MASS_TABLE, ReferenceTable

__all__ = [
    "ALPHABET",
    "FastaRecord",
    "HelmConnection",
    "HelmError",
    "HelmMonomer",
    "HelmPolymer",
    "HelmStructure",
    "Residue",
    "average_chain_mass",
    "parse_fasta",
    "parse_helm",
    "sequence_errors",
]

Authority = Literal["IUPAC-IUB 1983", "IUPAC-IUB 1983 (later addendum)", "ExPASy mass table"]


@dataclass(frozen=True, slots=True)
class Residue:
    code: str
    three_letter: str
    name: str
    authority: Authority
    defined_mass: bool


_STANDARD = {
    "A": ("Ala", "alanine"), "C": ("Cys", "cysteine"), "D": ("Asp", "aspartic acid"),
    "E": ("Glu", "glutamic acid"), "F": ("Phe", "phenylalanine"), "G": ("Gly", "glycine"),
    "H": ("His", "histidine"), "I": ("Ile", "isoleucine"), "K": ("Lys", "lysine"),
    "L": ("Leu", "leucine"), "M": ("Met", "methionine"), "N": ("Asn", "asparagine"),
    "P": ("Pro", "proline"), "Q": ("Gln", "glutamine"), "R": ("Arg", "arginine"),
    "S": ("Ser", "serine"), "T": ("Thr", "threonine"), "V": ("Val", "valine"),
    "W": ("Trp", "tryptophan"), "Y": ("Tyr", "tyrosine"),
}
ALPHABET: dict[str, Residue] = {
    **{c: Residue(c, t, n, "IUPAC-IUB 1983", True) for c, (t, n) in _STANDARD.items()},
    "U": Residue("U", "Sec", "selenocysteine", "IUPAC-IUB 1983 (later addendum)", True),
    "B": Residue("B", "Asx", "aspartic acid or asparagine", "IUPAC-IUB 1983", False),
    "Z": Residue("Z", "Glx", "glutamic acid or glutamine", "IUPAC-IUB 1983", False),
    "X": Residue("X", "Xaa", "unknown or other amino acid", "IUPAC-IUB 1983", False),
    "O": Residue("O", "Pyl", "pyrrolysine", "ExPASy mass table", True),
}
_FILE_CONVENTIONS = {"*": "translation stop", "-": "gap"}


def sequence_errors(seq: str) -> list[str]:
    """Problems that stop ``seq`` from describing one defined chain."""
    errs: list[str] = []
    if not seq:
        return ["empty sequence"]
    for i, ch in enumerate(seq, start=1):
        if ch in _FILE_CONVENTIONS:
            errs.append(f"position {i}: '{ch}' ({_FILE_CONVENTIONS[ch]}) is a file convention, "
                        "not a residue")
        elif ch.islower() and ch.upper() in ALPHABET:
            errs.append(f"position {i}: lower-case '{ch}'; the one-letter codes are upper case")
        elif ch not in ALPHABET:
            errs.append(f"position {i}: '{ch}' is not a one-letter amino-acid code")
        if len(errs) >= 10:
            errs.append("further errors not listed")
            break
    return errs


@dataclass(frozen=True, slots=True)
class FastaRecord:
    description: str
    sequence: str


def parse_fasta(text: str) -> tuple[list[FastaRecord], list[str]]:
    """Strict FASTA: each record is a ">" description line then sequence lines. Whitespace
    inside sequence lines is ignored; everything else must be a one-letter code."""
    records: list[FastaRecord] = []
    errors: list[str] = []
    desc: str | None = None
    lines: list[str] = []

    def close() -> None:
        if desc is None:
            return
        seq = "".join("".join(ln.split()) for ln in lines)
        problems = sequence_errors(seq)
        if problems:
            errors.extend(f"record '{desc}': {p}" for p in problems)
        records.append(FastaRecord(desc, seq))

    for n, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip("\r")
        if line.startswith(">"):
            close()
            desc, lines = line[1:].strip(), []
            if not desc:
                errors.append(f"line {n}: a definition line needs a description after '>'")
        elif line.strip():
            if desc is None:
                errors.append(f"line {n}: sequence data before the first '>' definition line")
                continue
            lines.append(line)
    close()
    if not records and not errors:
        errors.append("no FASTA records found")
    return records, errors


def average_chain_mass(seq: str, *, label: str,
                       table: ReferenceTable = RESIDUE_MASS_TABLE) -> Quantity:
    """Average mass of one chain: sum of average residue masses plus one water (ExPASy)."""
    problems = sequence_errors(seq)
    if problems:
        raise ValueError("; ".join(problems))
    undefined = sorted({c for c in seq if not ALPHABET[c].defined_mass})
    if undefined:
        return Quantity.unavailable(
            "g/mol", label=label,
            reason=f"{', '.join(undefined)} ({'; '.join(ALPHABET[c].name for c in undefined)}) "
                   "have no defined residue mass")
    counts = Counter(seq)
    parts = {c: table.quantity(f"residue_mass.average.{c}") for c in sorted(counts)}
    water = table.quantity("water_mass.average")
    total = sum(counts[c] * parts[c].require() for c in counts) + water.require()
    flags = ("selenocysteine_mass_uses_older_selenium_weight",) if "U" in counts else ()
    return Quantity.computed(
        total, "g/mol", method=method("seq.average_mass"), inputs=[*parts.values(), water],
        label=label, qc_flags=flags,
        notes=f"{len(seq)} residues; residue-mass table {table.version}")


# ---------------------------------------------------------------------------------------------
# HELM 2.04
# ---------------------------------------------------------------------------------------------

class HelmError(ValueError):
    def __init__(self, errors: Sequence[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = list(errors)


_POLYMER_ID = re.compile(r"^(PEPTIDE|RNA|CHEM|BLOB)([1-9][0-9]*)$")
_GROUP_ID = re.compile(r"^G[1-9][0-9]*$")
_RESERVED = set("${}|.,-:[]()")


@dataclass(frozen=True, slots=True)
class HelmMonomer:
    text: str
    kind: Literal["id", "inline_smiles", "list", "unknown"]
    ids: tuple[str, ...]
    repeat: str | None = None
    annotation: str | None = None


@dataclass(frozen=True, slots=True)
class HelmPolymer:
    id: str
    type: str
    monomers: tuple[HelmMonomer, ...]
    annotation: str | None = None


@dataclass(frozen=True, slots=True)
class HelmConnection:
    source: str
    target: str
    source_position: str
    source_attachment: str
    target_position: str
    target_attachment: str


@dataclass(frozen=True, slots=True)
class HelmStructure:
    polymers: tuple[HelmPolymer, ...]
    connections: tuple[HelmConnection, ...]
    groups: dict[str, str]
    extended_annotation: Any
    version: str | None
    uses_helm2_features: bool
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def monomer_ids(self) -> set[str]:
        return {i for p in self.polymers for m in p.monomers for i in m.ids}

    def to_dict(self) -> dict[str, Any]:
        return {"polymers": [{"id": p.id, "type": p.type, "monomers": len(p.monomers),
                              "annotation": p.annotation} for p in self.polymers],
                "connections": len(self.connections), "groups": dict(self.groups),
                "version": self.version, "uses_helm2_features": self.uses_helm2_features,
                "monomer_ids": sorted(self.monomer_ids()), "warnings": list(self.warnings)}


def _split_top(text: str, sep: str) -> list[str]:
    """Split on ``sep`` outside brackets, braces, parentheses and double quotes."""
    out: list[str] = []
    cur: list[str] = []
    depth, quoted = 0, False
    for ch in text:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in "[{(":
            depth += 1
        elif not quoted and ch in "]})":
            depth -= 1
        if ch == sep and depth == 0 and not quoted:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


def _sections(text: str) -> list[str]:
    """The text between the "$" terminators (5.3). A "$" inside brackets (in-line cxsmiles),
    braces or quotes is not a terminator."""
    parts = _split_top(text, "$")
    return parts


def _last_top_colon(text: str) -> int | None:
    """Index of the last ":" outside square brackets (in-line SMILES carry ":" in [*:1])."""
    depth, found = 0, None
    for i, ch in enumerate(text):
        depth += ch == "["
        depth -= ch == "]"
        if ch == ":" and depth == 0:
            found = i
    return found


def _unprotected_whitespace(text: str) -> str | None:
    """First whitespace outside brackets and quotes, where names, annotations and in-line
    SMILES may legitimately contain it."""
    depth, quoted = 0, False
    for i, ch in enumerate(text):
        if ch == '"':
            quoted = not quoted
        elif not quoted:
            depth += ch == "["
            depth -= ch == "]"
            if ch.isspace() and depth == 0:
                return f"character {i + 1}"
    return None


def _take_annotation(token: str) -> tuple[str, str | None]:
    m = re.match(r'^(.*?)"([^"]*)"$', token, re.S)
    return (m.group(1), m.group(2)) if m else (token, None)


def _take_repeat(token: str) -> tuple[str, str | None, str | None]:
    m = re.match(r"^(.*)'([0-9]+(?:-[0-9]+)?)'$", token, re.S)
    if not m:
        return token, None, None
    lo_hi = m.group(2).split("-")
    err = None
    if len(lo_hi) == 2 and int(lo_hi[0]) > int(lo_hi[1]):
        err = f"repeat range '{m.group(2)}' has its minimum above its maximum"
    return m.group(1), m.group(2), err


def _monomer(token: str, where: str, errors: list[str]) -> tuple[HelmMonomer, bool]:
    """One monomer or monomer list; returns it and whether it uses HELM 2 features."""
    body, annotation = _take_annotation(token)
    body, repeat, rerr = _take_repeat(body)
    if rerr:
        errors.append(f"{where}: {rerr}")
    v2 = annotation is not None or repeat is not None
    if body.startswith("(") and body.endswith(")"):
        inner = body[1:-1]
        plus, excl = _split_top(inner, "+"), _split_top(inner, ",")
        if len(plus) > 1 and len(excl) > 1:
            errors.append(f"{where}: a monomer list mixes '+' (mixture) and ',' (exclusive or)")
        ids = []
        for el in plus if len(plus) > 1 else excl:
            cut = _last_top_colon(el)
            name, ratio = (el[:cut], el[cut + 1:]) if cut is not None else (el, None)
            if ratio is not None and not re.fullmatch(r"[0-9]+(\.[0-9]+)?", ratio):
                errors.append(f"{where}: ratio '{ratio}' is not a number")
            ids.append(_id(name, where, errors))
        return HelmMonomer(token, "list", tuple(ids), repeat, annotation), True
    if body in ("X", "N", "*"):
        return HelmMonomer(token, "unknown", (body,), repeat, annotation), v2
    if body.startswith("[") and body.endswith("]") and ("*" in body or "|$" in body):
        return HelmMonomer(token, "inline_smiles", (body[1:-1],), repeat, annotation), v2
    return HelmMonomer(token, "id", (_id(body, where, errors),), repeat, annotation), v2


def _id(text: str, where: str, errors: list[str]) -> str:
    """A monomer ID: one character, or several in square brackets (5.2.4)."""
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1]
        if not inner or any(c in _RESERVED or c.isspace() for c in inner):
            errors.append(f"{where}: monomer ID '{inner}' is empty or has reserved characters")
        return inner
    if len(text) != 1 or text in _RESERVED or text.isspace():
        errors.append(f"{where}: '{text}' is not a monomer ID (multi-character IDs go in "
                      "square brackets)")
    return text


def _units(notation: str, where: str, errors: list[str],
           ptype: str) -> tuple[list[HelmMonomer], bool]:
    """Monomers of a simple polymer. "." separates monomer units; within a unit a backbone
    monomer may be followed by a branch monomer in parentheses (5.2.1.1, 5.2.4)."""
    monomers: list[HelmMonomer] = []
    v2 = False
    for unit in _split_top(notation, "."):
        if not unit:
            errors.append(f"{where}: empty monomer unit")
            continue
        tokens, i = [], 0
        while i < len(unit):
            start = i
            if unit[i] in "[(":
                close = {"[": "]", "(": ")"}[unit[i]]
                depth = 0
                while i < len(unit):
                    depth += unit[i] == unit[start]
                    depth -= unit[i] == close
                    i += 1
                    if depth == 0:
                        break
            else:
                i += 1
            while i < len(unit) and unit[i] in "'\"":          # repeat or annotation suffix
                q = unit[i]
                j = unit.find(q, i + 1)
                i = (j + 1) if j != -1 else len(unit)
            tokens.append(unit[start:i])
        if ptype == "PEPTIDE" and len(tokens) > 1:
            errors.append(f"{where}: '{unit}' is more than one monomer; peptide monomers are "
                          "separated by '.' and multi-character IDs go in square brackets")
            continue
        for k, tok in enumerate(tokens):
            branch = k > 0 and tok.startswith("(") and len(tokens) > 1 and \
                not any(s in tok for s in "+,")
            mono, uses = _monomer(tok[1:-1] if branch else tok, f"{where} monomer "
                                  f"{len(monomers) + 1}", errors)
            monomers.append(mono)
            v2 = v2 or uses
    return monomers, v2


def parse_helm(text: str) -> HelmStructure:
    """Validate a HELM string's structure against the specification (sections 5.2 to 5.5)."""
    errors: list[str] = []
    warnings: list[str] = []
    s = text.strip()
    sections = _sections(s)
    if len(sections) != 5:
        raise HelmError([f"a HELM string has four sections each ending in '$' (5.3); found "
                         f"{len(sections) - 1}"])
    polys_s, conns_s, groups_s, annot_s, marker = sections
    version: str | None = marker or None
    loose = _unprotected_whitespace("$".join(sections[:3]))
    if loose:
        errors.append(f"whitespace between notation elements (4.1) at {loose}")
    if version not in (None, "V2.0"):
        errors.append(f"text after the fourth '$' must be 'V2.0' or nothing (5.4), not "
                      f"{version!r}")
    polymers: list[HelmPolymer] = []
    v2 = False
    if not polys_s:
        errors.append("the list of simple polymers is empty")
    for item in _split_top(polys_s, "|") if polys_s else []:
        m = re.match(r"^([A-Za-z]+[0-9]+)\{(.*)\}(?:\"([^\"]*)\")?$", item, re.S)
        if not m:
            errors.append(f"'{item[:40]}' is not PolymerID{{notation}} (5.3.1)")
            continue
        pid, body, annotation = m.group(1).upper(), m.group(2), m.group(3)
        idm = _POLYMER_ID.match(pid)
        if not idm:
            errors.append(f"'{pid}' is not a polymer ID (PEPTIDE, RNA, CHEM or BLOB with an "
                          "integer suffix)")
            continue
        ptype = idm.group(1)
        v2 = v2 or annotation is not None
        if ptype == "BLOB":
            polymers.append(HelmPolymer(pid, ptype, (), annotation))
            continue
        if ptype == "CHEM":
            # one monomer only (5.2.2), so the body is its ID; the specification's own example
            # writes CHEM1{SS3} without brackets
            if not body or _split_top(body, ".")[1:]:
                errors.append(f"{pid}: a CHEM simple polymer contains one monomer (5.2.2)")
            ident = body[1:-1] if body.startswith("[") and body.endswith("]") else body
            kind: Literal["id", "inline_smiles"] = "inline_smiles" if "*" in ident else "id"
            polymers.append(HelmPolymer(pid, ptype, (HelmMonomer(body, kind, (ident,)),),
                                        annotation))
            continue
        monomers, uses = _units(body, pid, errors, ptype)
        v2 = v2 or uses
        polymers.append(HelmPolymer(pid, ptype, tuple(monomers), annotation))
    ids = [p.id for p in polymers]
    if len(set(ids)) != len(ids):
        errors.append("polymer IDs must be unique")

    groups: dict[str, str] = {}
    for item in _split_top(groups_s, "|") if groups_s else []:
        gm = re.match(r"^(G[0-9]+)\((.*)\)(?:\"[^\"]*\")?$", item, re.S)
        if not gm or not _GROUP_ID.match(gm.group(1)):
            errors.append(f"'{item[:40]}' is not a polymer group G#(...) (5.3.3)")
            continue
        groups[gm.group(1)] = gm.group(2)
        v2 = True
    known = set(ids) | set(groups)
    for g, body in groups.items():
        for el in re.split(r"[+,]", body):
            if el.split(":")[0] not in known:
                errors.append(f"group {g}: '{el.split(':')[0]}' is not a polymer or group")

    connections: list[HelmConnection] = []
    sizes = {p.id: len(p.monomers) for p in polymers}
    for item in _split_top(conns_s, "|") if conns_s else []:
        cm = re.match(r"^([A-Za-z]+[0-9]+),([A-Za-z]+[0-9]+),([^:,-]+):([^-,]+)-([^:,-]+):([^,]+)$",
                      item)
        if not cm:
            errors.append(f"'{item[:60]}' is not Source,Target,pos:R#-pos:R# (5.3.2)")
            continue
        src, tgt, sp, sa, tp, ta = (cm.group(i) for i in range(1, 7))
        src, tgt = src.upper(), tgt.upper()
        for pid, pos, att in ((src, sp, sa), (tgt, tp, ta)):
            if pid not in known:
                errors.append(f"connection {item}: '{pid}' is not a polymer or group")
            elif pos.isdigit() and pid in sizes and not 1 <= int(pos) <= sizes[pid]:
                errors.append(f"connection {item}: {pid} has no monomer {pos} "
                              f"({sizes[pid]} monomers)")
            if not re.fullmatch(r"R[0-9]+|\?|pair", att):
                errors.append(f"connection {item}: '{att}' is not an attachment point "
                              "(R#, ? or pair)")
            if not (pos.isdigit() or pos == "?"):
                v2 = True                                  # a monomer ID for an unknown position
        if "?" in (sa, ta, sp, tp):
            v2 = True
        connections.append(HelmConnection(src, tgt, sp, sa, tp, ta))

    extended: Any = None
    if annot_s:
        try:
            extended = json.loads(annot_s)
        except json.JSONDecodeError as exc:
            errors.append(f"the extended annotation is not valid JSON (5.3.4): {exc.msg}")
        v2 = True
    if errors:
        raise HelmError(errors)
    if v2 and version is None:
        warnings.append("uses HELM 2 functionality but lacks 'V2.0' after the fourth '$' (5.4)")
    return HelmStructure(tuple(polymers), tuple(connections), groups, extended, version, v2,
                         tuple(warnings))
