"""Deterministic descriptor embedding — the default, key-free representation.

A real, reproducible feature vector built from first-principles biochemistry:
  * 20-dim amino-acid composition (fractions, sum to 1)
  * mean Kyte–Doolittle hydropathy (GRAVY)
  * Eisenberg hydrophobic moment (helical, 100°/residue)
  * net charge at pH 7.4 (Henderson–Hasselbalch)
  * fraction positive (K+R), fraction aromatic (F+Y+W)
  * log10(length)

No training, no randomness — identical input always yields an identical vector.
Useful as ML input and for nearest-neighbour similarity to reference peptides.
"""

from __future__ import annotations

import math

from .base import EmbeddingProvider, EmbeddingResult

_AAS = "ACDEFGHIKLMNPQRSTVWY"

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
# Eisenberg consensus hydrophobicity scale (for the hydrophobic moment).
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
# Side-chain pKa for Henderson–Hasselbalch net charge.
_POS_PKA = {"K": 10.53, "R": 12.48, "H": 6.0}
_NEG_PKA = {"D": 3.65, "E": 4.25, "C": 8.3, "Y": 10.07}
_N_TERM_PKA, _C_TERM_PKA = 9.69, 2.34


def _net_charge(seq: str, ph: float = 7.4) -> float:
    pos = 1.0 / (1.0 + 10 ** (ph - _N_TERM_PKA))
    for aa, pka in _POS_PKA.items():
        pos += seq.count(aa) * (1.0 / (1.0 + 10 ** (ph - pka)))
    neg = 1.0 / (1.0 + 10 ** (_C_TERM_PKA - ph))
    for aa, pka in _NEG_PKA.items():
        neg += seq.count(aa) * (1.0 / (1.0 + 10 ** (pka - ph)))
    return pos - neg


def _hydrophobic_moment(seq: str, angle_deg: float = 100.0) -> float:
    ang = math.radians(angle_deg)
    sx = sum(_EIS.get(a, 0.0) * math.cos(i * ang) for i, a in enumerate(seq))
    sy = sum(_EIS.get(a, 0.0) * math.sin(i * ang) for i, a in enumerate(seq))
    return math.sqrt(sx * sx + sy * sy) / max(1, len(seq))


class DescriptorEmbeddingProvider(EmbeddingProvider):
    name = "descriptors"
    model_id = "peptide_biochem_engine"
    model_version = "1.0.0"
    dim = 26
    is_plm = False  # deterministic surrogate, not a learned PLM embedding

    def embed(self, sequence: str) -> EmbeddingResult:
        seq = sequence.upper()
        n = len(seq)
        if n == 0:
            raise ValueError("Cannot embed an empty sequence.")
        aac = [seq.count(a) / n for a in _AAS]
        gravy = sum(_KD.get(a, 0.0) for a in seq) / n
        mu_h = _hydrophobic_moment(seq)
        charge = _net_charge(seq)
        pos_frac = sum(seq.count(a) for a in "KR") / n
        arom_frac = sum(seq.count(a) for a in "FYW") / n
        length_feat = math.log10(n)
        vec = aac + [gravy, mu_h, charge, pos_frac, arom_frac, length_feat]
        return EmbeddingResult(
            sequence=seq,
            mean_vector=[float(x) for x in vec],
            dim=len(vec),
            model_id=self.model_id,
            model_version=self.model_version,
            provider=self.name,
            metadata={"feature_layout": "AAC[20]+gravy+mu_h+charge74+posfrac+aromfrac+log10len"},
        )
