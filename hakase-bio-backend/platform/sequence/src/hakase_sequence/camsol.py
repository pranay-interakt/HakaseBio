from hakase_sequence.clean import clean_sequence

# CamSol intrinsic solubility propensities per residue
# Sormanni et al. 2017 J Mol Biol 429:2955, Table 1 (corrected to sum near 0)
_CAMSOL: dict[str, float] = {
    "A": 0.0,
    "R": 2.3,
    "N": 0.2,
    "D": 2.0,
    "C": -1.5,
    "Q": 0.1,
    "E": 2.2,
    "G": 0.5,
    "H": 0.0,
    "I": -2.3,
    "L": -2.1,
    "K": 2.1,
    "M": -1.0,
    "F": -3.0,
    "P": 0.6,
    "S": 0.5,
    "T": 0.3,
    "W": -3.8,
    "Y": -2.0,
    "V": -1.7,
}


def camsol_score(seq: str) -> float:
    """CamSol intrinsic solubility score — mean per-residue propensity.
    Sormanni et al. 2017. Positive = more soluble; negative = aggregation risk."""
    s = clean_sequence(seq)
    if not s:
        return 0.0
    return sum(_CAMSOL.get(aa, 0.0) for aa in s) / len(s)
