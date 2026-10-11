"""US classification of an amino-acid polymer: protein or not (21 CFR 600.3(h)(6)).

21 CFR 600.3(h)(6), verbatim: "A protein is any alpha amino acid polymer with a specific,
defined sequence that is greater than 40 amino acids in size. When two or more amino acid chains
in an amino acid polymer are associated with each other in a manner that occurs in nature, the
size of the amino acid polymer for purposes of this paragraph (h)(6) will be based on the total
number of amino acids in those chains, and will not be limited to the number of amino acids in a
contiguous sequence."

A protein is a biological product (21 CFR 600.3(h)), licensed under 21 CFR 601. The final rule
(85 FR 10057, effective 23 March 2020) states that the term protein "is distinct from and
excludes the term 'peptide'" and counts amino acids "irrespective of the method of manufacture".
FDA's draft peptide guidance (December 2023) defines a peptide, for its purposes, as "any polymer
composed of 40 or fewer amino acids". Worked example from the final rule: insulin, two chains of
21 and 30 amino acids associated as in nature, is 51 amino acids and so a protein.

Inputs: residues per chain (integers) and whether multiple chains are associated as they occur
in nature. Output: protein, not a protein, or pending with the missing fact named. The rule sums
the chains only for natural association; for chains joined otherwise it states nothing, so a
product whose longest chain is 40 or fewer but whose total exceeds 40 stays pending.

This classification decides the US application route (drug or biological product). It does not
decide the ICH nonclinical guideline: ICH S6(R1) scopes by biotechnology origin, not by length
(see ``engine``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from hos.core.citations import cite
from hos.core.provenance import Citation

__all__ = ["PROTEIN_THRESHOLD_AMINO_ACIDS", "ProteinClassification", "us_protein_classification"]

#: 21 CFR 600.3(h)(6): a protein is "greater than 40 amino acids in size".
PROTEIN_THRESHOLD_AMINO_ACIDS = 40

Outcome = Literal["protein", "not_protein", "pending"]


@dataclass(frozen=True, slots=True)
class ProteinClassification:
    outcome: Outcome
    amino_acids: int | None
    """The size the rule uses: one chain, or the total of naturally associated chains."""
    counted: str
    statement: str
    pending_fact: str | None
    citations: tuple[Citation, ...]
    section: str = "21 CFR 600.3(h)(6)"

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome,
            "amino_acids": self.amino_acids,
            "counted": self.counted,
            "statement": self.statement,
            "pending_fact": self.pending_fact,
            "section": self.section,
            "citations": [c.to_dict() for c in self.citations],
        }


def _result(
    outcome: Outcome, n: int | None, counted: str, pending: str | None = None
) -> ProteinClassification:
    cites: tuple[Citation, ...] = (cite("cfr21_600_3"), cite("fda_biological_product_rule_2020"))
    if outcome == "protein":
        statement = (
            f"{n} amino acids ({counted}): greater than 40, so a protein under 21 CFR "
            "600.3(h)(6) and therefore a biological product (21 CFR 600.3(h)); "
            "biologics licences are applied for under 21 CFR 601."
        )
        cites += (cite("cfr21_601_2"),)
    elif outcome == "not_protein":
        statement = (
            f"{n} amino acids ({counted}): 40 or fewer, so not a protein under 21 CFR "
            "600.3(h)(6). FDA's draft peptide guidance (December 2023) calls such a "
            "polymer a peptide, regulated as a drug unless it meets another "
            "biological-product or device definition."
        )
        cites += (cite("fda_peptide_clinpharm_draft_2023"),)
    else:
        statement = f"Classification under 21 CFR 600.3(h)(6) pending: {pending}."
    return ProteinClassification(outcome, n, counted, statement, pending, cites)


def us_protein_classification(
    chains: Sequence[int], naturally_associated: bool | None
) -> ProteinClassification:
    """Classify an amino-acid polymer from its residues per chain.

    ``naturally_associated`` is whether multiple chains are "associated with each other in a
    manner that occurs in nature"; it is not needed for a single chain.
    """
    if any(isinstance(c, bool) or not isinstance(c, int) or c <= 0 for c in chains):
        raise ValueError("amino acids per chain must be positive integers")
    limit = PROTEIN_THRESHOLD_AMINO_ACIDS
    if not chains:
        return _result(
            "pending", None, "no chains given", "the number of amino acids in each chain"
        )
    if len(chains) == 1:
        n = chains[0]
        return _result("protein" if n > limit else "not_protein", n, "one chain")
    total, longest = sum(chains), max(chains)
    parts = " + ".join(str(c) for c in chains)
    if naturally_associated:
        return _result(
            "protein" if total > limit else "not_protein",
            total,
            f"{parts}, chains associated as in nature, counted together",
        )
    if longest > limit:
        return _result("protein", longest, f"longest chain of {parts}")
    if total <= limit:
        return _result("not_protein", total, f"{parts}, even counted together")
    if naturally_associated is None:
        return _result(
            "pending",
            None,
            parts,
            "whether the chains are associated with each other as they occur in "
            "nature (counted together they exceed 40, each alone does not)",
        )
    return _result(
        "pending",
        None,
        parts,
        "FDA's reading for chains not associated as they occur in nature: 21 CFR "
        "600.3(h)(6) states the counting only for natural association, and each "
        "chain alone is 40 or fewer while together they exceed 40",
    )
