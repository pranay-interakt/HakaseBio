"""Modality-native compound entities (docs/14 P4): peptides and monoclonal antibodies as
sequences, with HELM for non-natural chemistry, isotype, engineered mutations, and the link
from a surrogate molecule to its clinical candidate.

Scope follows the build brief (small molecules, synthetic peptides, monoclonal antibodies):
composite substances (ADCs, LNPs), vectors and cell products are not built.

The sequence is the registered fact; everything derived from it (residue counts, average
masses, the HELM structure summary) is computed here by pure functions so that the kernel and
the offline verifier produce identical results.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from hos.core.methods import method
from hos.core.quantity import Quantity
from hos.core.regulatory import us_protein_classification
from hos.core.sequence import (
    ALPHABET,
    HelmError,
    average_chain_mass,
    parse_helm,
    sequence_errors,
)
from hos.drivers.base import CompoundInfo

__all__ = [
    "Chain",
    "EngineeredMutation",
    "MonomerLibrary",
    "SequenceEntity",
    "biologic_compound_info",
    "derive",
]

_RESIDUES = "".join(c for c, r in ALPHABET.items() if r.defined_mass)


class Chain(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    role: Literal["peptide", "heavy_chain", "light_chain", "other"]
    sequence: str = Field(min_length=1, description="one-letter codes, N to C terminus")
    copies: int = Field(ge=1, description="copies of this chain in one molecule")


class EngineeredMutation(BaseModel):
    """A deliberate change from the parent sequence. ``position`` counts residues from 1 in the
    registered chain; ``label`` keeps the sponsor's own notation (e.g. an EU-numbered name),
    which is not converted."""

    chain: str
    position: int = Field(ge=1)
    from_residue: str = Field(min_length=1, max_length=1)
    to_residue: str = Field(min_length=1, max_length=1)
    purpose: str = Field(min_length=1)
    label: str | None = None


class MonomerLibrary(BaseModel):
    """The monomer set that resolves a HELM string's IDs (HELM 2.04, 5.1); without it the
    string does not define a molecule."""

    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SequenceEntity(BaseModel):
    format: Literal["sequence", "helm"]
    chains: list[Chain] = Field(default_factory=list)
    helm: str | None = None
    monomer_library: MonomerLibrary | None = None
    isotype: str | None = Field(default=None, description="antibodies, e.g. IgG1")
    light_chain_type: Literal["kappa", "lambda"] | None = None
    engineered_mutations: list[EngineeredMutation] = Field(default_factory=list)
    surrogate_for: str | None = Field(
        default=None,
        description="compound id of the clinical candidate this molecule stands in for",
    )
    surrogate_rationale: str | None = None

    @model_validator(mode="after")
    def _check(self) -> SequenceEntity:
        errs: list[str] = []
        if self.format == "sequence":
            if not self.chains:
                errs.append("give at least one chain")
            if self.helm or self.monomer_library:
                errs.append("a sequence entity has no HELM string or monomer library")
            names = [c.name for c in self.chains]
            if len(set(names)) != len(names):
                errs.append("chain names must be unique")
            for ch in self.chains:
                errs += [f"chain {ch.name}: {e}" for e in sequence_errors(ch.sequence)]
        else:
            if self.chains:
                errs.append("a HELM entity carries its chains in the HELM string")
            if not self.helm or self.monomer_library is None:
                errs.append(
                    "a HELM entity needs the HELM string and its monomer library "
                    "(name, version, SHA-256)"
                )
            elif problems := _helm_errors(self.helm):
                errs += [f"HELM: {p}" for p in problems]
            if self.engineered_mutations:
                errs.append(
                    "engineered mutations are recorded on sequence entities; in HELM "
                    "the modified monomers are part of the notation"
                )
        by_name = {c.name: c for c in self.chains}
        for m in self.engineered_mutations:
            c = by_name.get(m.chain)
            if c is None:
                errs.append(f"mutation {m.label or m.position}: no chain {m.chain!r}")
                continue
            if m.from_residue not in _RESIDUES or m.to_residue not in _RESIDUES:
                errs.append(
                    f"mutation {m.label or m.position}: residues are one-letter codes "
                    "with a defined residue"
                )
            elif m.from_residue == m.to_residue:
                errs.append(f"mutation {m.label or m.position}: from and to are the same")
            elif m.position > len(c.sequence):
                errs.append(
                    f"mutation {m.label or m.position}: chain {c.name} has "
                    f"{len(c.sequence)} residues"
                )
            elif c.sequence[m.position - 1] != m.to_residue:
                errs.append(
                    f"mutation {m.label or m.position}: the registered {c.name} has "
                    f"{c.sequence[m.position - 1]} at {m.position}, not the engineered "
                    f"{m.to_residue}"
                )
        if self.surrogate_for and not (self.surrogate_rationale or "").strip():
            errs.append(
                "a surrogate needs its rationale (e.g. the candidate does not bind the "
                "toxicology species' target)"
            )
        if self.light_chain_type and not any(c.role == "light_chain" for c in self.chains):
            errs.append("a light-chain type needs a light chain")
        if errs:
            raise ValueError("; ".join(errs))
        return self


def _helm_errors(text: str) -> list[str]:
    try:
        parse_helm(text)
    except HelmError as exc:
        return exc.errors
    return []


def _total_mass(entity: SequenceEntity) -> tuple[list[dict[str, Any]], Quantity]:
    """Per-chain facts and the sum of polypeptide chains (average masses, ExPASy method)."""
    if entity.format == "helm":
        assert entity.monomer_library is not None
        return [], Quantity.unavailable(
            "g/mol",
            label="Average molecular mass",
            reason="a HELM molecule's mass needs the monomer structures of "
            f"{entity.monomer_library.name} {entity.monomer_library.version}, which "
            "are not read here",
        )
    chains = []
    masses: list[tuple[int, Quantity]] = []
    for c in entity.chains:
        q = average_chain_mass(c.sequence, label=f"Average mass, {c.name}")
        masses.append((c.copies, q))
        chains.append(
            {
                "name": c.name,
                "role": c.role,
                "copies": c.copies,
                "residues": len(c.sequence),
                "average_mass": q.to_dict(),
            }
        )
    if all(q.is_available for _, q in masses):
        return chains, Quantity.computed(
            sum(n * q.require() for n, q in masses),
            "g/mol",
            method=method("seq.average_mass"),
            inputs=[q for _, q in masses],
            label="Sum of polypeptide chains (no disulfide, glycan or other modification)",
            notes=" + ".join(
                f"{n} x {c.name}" for (n, _), c in zip(masses, entity.chains, strict=True)
            ),
        )
    missing = [
        c.name for (_, q), c in zip(masses, entity.chains, strict=True) if not q.is_available
    ]
    return chains, Quantity.unavailable(
        "g/mol", label="Sum of polypeptide chains", reason=f"no mass for {', '.join(missing)}"
    )


def derive(entity: SequenceEntity) -> dict[str, Any]:
    """Facts computed from the registered sequence."""
    chains, total = _total_mass(entity)
    if entity.format == "helm":
        assert entity.helm is not None
        return {
            "helm": parse_helm(entity.helm).to_dict(),
            "chains": [],
            "total_mass": total.to_dict(),
            "amino_acid_chains": [],
            "classification": None,
        }
    aa = [len(c.sequence) for c in entity.chains for _ in range(c.copies)]
    return {
        "helm": None,
        "chains": chains,
        "total_mass": total.to_dict(),
        "amino_acid_chains": aa,
        "classification": us_protein_classification(aa, None).to_dict(),
    }


def biologic_compound_info(compound_id: str, name: str, entity: SequenceEntity) -> CompoundInfo:
    """What drivers see for a sequence entity: no SMILES, and the average mass when one is
    defined (None otherwise, which drivers already handle)."""
    _, total = _total_mass(entity)
    return CompoundInfo(
        id=compound_id,
        name=name,
        smiles=None,
        inchikey=None,
        molecular_weight=total if total.is_available else None,
        clogp=None,
    )
