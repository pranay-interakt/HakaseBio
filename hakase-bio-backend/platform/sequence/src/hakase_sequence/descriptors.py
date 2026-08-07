import math

import numpy as np

from hakase_sequence.clean import VALID_AAS, clean_sequence

# Kyte–Doolittle hydropathy
_KD: dict[str, float] = {
    "A": 1.8,
    "R": -4.5,
    "N": -3.5,
    "D": -3.5,
    "C": 2.5,
    "Q": -3.5,
    "E": -3.5,
    "G": -0.4,
    "H": -3.2,
    "I": 4.5,
    "L": 3.8,
    "K": -3.9,
    "M": 1.9,
    "F": 2.8,
    "P": -1.6,
    "S": -0.8,
    "T": -0.7,
    "W": -0.9,
    "Y": -1.3,
    "V": 4.2,
}

# Eisenberg consensus hydrophobicity (for moment)
_EIS: dict[str, float] = {
    "A": 0.62,
    "R": -2.53,
    "N": -0.78,
    "D": -0.90,
    "C": 0.29,
    "Q": -0.85,
    "E": -0.74,
    "G": 0.48,
    "H": -0.40,
    "I": 1.38,
    "L": 1.06,
    "K": -1.50,
    "M": 0.64,
    "F": 1.19,
    "P": 0.12,
    "S": -0.18,
    "T": -0.05,
    "W": 0.81,
    "Y": 0.26,
    "V": 1.08,
}

# Side-chain pKa (Cantor–Schimmel)
_PKA: dict[str, float] = {
    "D": 3.65,
    "E": 4.25,
    "C": 8.33,
    "Y": 10.07,
    "K": 10.53,
    "R": 12.48,
    "H": 6.00,
}
_N_TERM_PKA = 9.69
_C_TERM_PKA = 2.34


def aac(seq: str) -> np.ndarray:
    """20-element amino acid composition fraction vector."""
    n = max(len(seq), 1)
    return np.array([(seq.count(aa) / n) for aa in VALID_AAS], dtype=np.float32)


def charge_at_74(seq: str) -> float:
    pH = 7.4
    q = 1 / (1 + 10 ** (pH - _N_TERM_PKA)) - 1 / (1 + 10 ** (_C_TERM_PKA - pH))
    for aa in seq:
        if aa in ("K", "R", "H"):
            q += 1 / (1 + 10 ** (pH - _PKA[aa]))
        elif aa in ("D", "E", "C", "Y"):
            q -= 1 / (1 + 10 ** (_PKA[aa] - pH))
    return q


def gravy(seq: str) -> float:
    if not seq:
        return 0.0
    return sum(_KD.get(aa, 0.0) for aa in seq) / len(seq)


def moment(seq: str, angle: float = 100.0) -> float:
    """Eisenberg hydrophobic moment (helical projection)."""
    if not seq:
        return 0.0
    rad = math.pi * angle / 180.0
    sumx = sum(_EIS.get(aa, 0.0) * math.cos(i * rad) for i, aa in enumerate(seq))
    sumy = sum(_EIS.get(aa, 0.0) * math.sin(i * rad) for i, aa in enumerate(seq))
    return math.sqrt(sumx**2 + sumy**2) / len(seq)


def extract_features(seq: str) -> np.ndarray:
    """26-element feature vector: AAC (20) + 6 physicochemical."""
    s = clean_sequence(seq)
    if not s:
        return np.zeros(26, dtype=np.float32)
    n = max(len(s), 1)
    c_aac = aac(s)
    c_charge = charge_at_74(s)
    c_gravy = gravy(s)
    c_mom = moment(s)
    pos_frac = (s.count("K") + s.count("R")) / n
    aro_frac = (s.count("F") + s.count("Y") + s.count("W")) / n
    len_norm = math.log10(max(n, 1))
    physico = np.array([c_charge, c_gravy, c_mom, pos_frac, aro_frac, len_norm], dtype=np.float32)
    return np.concatenate([c_aac, physico])
