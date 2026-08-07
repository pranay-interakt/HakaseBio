"""Embedding applicability domain — length & compositional OOD (spec §10.2).

A protein-language-model embedding is only as trustworthy as the input's
similarity to what the model was trained on. This module answers a narrow,
honest question for a given sequence: *is it inside the range where the embedding
should be treated as reliable, or is it an extrapolation?* The signals are
deliberately simple and deterministic (no fabricated "OOD score"):

  * **length-appropriateness** — very short peptides carry too little context for
    a PLM to represent well; very long sequences exceed the model's usable window.
  * **compositional OOD** — low-complexity / homopolymeric sequences and any
    non-standard residues fall outside the amino-acid distribution PLMs see.

The result feeds two evidence fields (roadmap M5): the embedding confidence
``embedding_tier`` (in-domain → the caller may keep ``exact``; OOD → ``reduced``)
and ``applicability_domain.extrapolation_flag``.
"""

from __future__ import annotations

from dataclasses import dataclass

_STANDARD_AA = set("ACDEFGHIKLMNPQRSTVWY")

# Length band within which a PLM embedding is treated as in-domain. Below the
# floor there is too little sequence context; above the ceiling the input exceeds
# the ESM2 usable window.
EMB_MIN_LEN = 5
EMB_MAX_LEN = 1024

# A single residue dominating the sequence => low-complexity / homopolymeric,
# outside the compositional distribution a PLM was trained on.
LOW_COMPLEXITY_MAX_FRACTION = 0.8


@dataclass(frozen=True)
class EmbeddingApplicability:
    in_domain: bool
    extrapolation_flag: bool
    reasons: list[str]

    @property
    def note(self) -> str:
        return "; ".join(self.reasons)


def embedding_applicability(sequence: str) -> EmbeddingApplicability:
    seq = sequence.upper()
    n = len(seq)
    reasons: list[str] = []

    if n < EMB_MIN_LEN:
        reasons.append(
            f"Sequence length {n} below the embedding floor {EMB_MIN_LEN}; "
            "too little context for a reliable representation (spec §10.2)."
        )
    elif n > EMB_MAX_LEN:
        reasons.append(
            f"Sequence length {n} above the embedding ceiling {EMB_MAX_LEN}; "
            "exceeds the model's usable window (spec §10.2)."
        )

    non_standard = sorted({a for a in seq} - _STANDARD_AA)
    if non_standard:
        reasons.append(
            "Non-standard residue(s) "
            f"{','.join(non_standard)} outside the training distribution (spec §10.2)."
        )

    if n > 0:
        max_fraction = max(seq.count(a) for a in set(seq)) / n
        if max_fraction > LOW_COMPLEXITY_MAX_FRACTION:
            reasons.append(
                f"Low-complexity composition (dominant residue {max_fraction:.0%} "
                "of sequence); outside typical PLM training distribution (spec §10.2)."
            )

    out_of_domain = bool(reasons)
    return EmbeddingApplicability(
        in_domain=not out_of_domain,
        extrapolation_flag=out_of_domain,
        reasons=reasons,
    )
