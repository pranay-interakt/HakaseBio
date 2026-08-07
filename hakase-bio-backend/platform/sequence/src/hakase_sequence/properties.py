"""Generic amino-acid science — the shared *sequence* substrate.

Promoted out of the peptide engine so that peptide and antibody (and any future
sequence-based modality) sit on a common substrate rather than one importing the
other. Nothing here is peptide-specific: these are published scales, constant
tables and descriptor functions defined over the 20 standard residues.

Provenance is preserved verbatim from the original implementation —
Kyte & Doolittle (1982), Guruprasad (1990), Ikai (1980), Boman (2003),
Pace et al. (1995), Conchillo-Solé et al. (2007).
"""

from __future__ import annotations

import math
from typing import Any

# ── Standard 1-letter amino acid codes ──────────────────────────────────────
AA_SET = set("ACDEFGHIKLMNPQRSTVWY")

# ── Reference-parameter-set identifiers (spec §14 provenance) ────────────────
# These name the exact empirical scale / constant table behind each descriptor
# so the Physicochemical Evidence Object can record which parameter set produced
# a value (§10.1, §14 reference_parameter_sets). They are surfaced verbatim in
# the return dict under ``reference_parameter_sets`` — never fabricated versions.
REFERENCE_PARAMETER_SETS: dict[str, str] = {
    "hydrophobicity_scale": "Kyte-Doolittle-1982",
    "pKa_set": "in-tree-HH-ladder-v1",  # PKA_NTERM/PKA_CTERM/PKA_SIDE below
    "mass_table_monoisotopic": "in-tree-monoisotopic-v1",
    "mass_table_average": "IUPAC-average-residue-v1",
    "instability_scale": "Guruprasad-1990",
    "aliphatic_index_coeffs": "Ikai-1980",
    "boman_scale": "Boman-2003",
    "helical_periodicity_degrees": "100",  # α-helix, Eisenberg-1984
    "beta_periodicity_degrees": "160",  # β-strand, Eisenberg-1984
}

# Default sliding-window width for the windowed hydrophobicity profile (§6.3:
# "typically 5-9 residues"). 7 is the mid-range convention.
DEFAULT_HYDROPHOBICITY_WINDOW = 7

# ── Kyte–Doolittle hydrophobicity (normalised scale, Kyte & Doolittle 1982) ─
KD: dict[str, float] = {
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

# ── Amino-acid monoisotopic residue masses (Da, no water) ───────────────────
RESIDUE_MASS: dict[str, float] = {
    "A": 71.03711,
    "R": 156.10111,
    "N": 114.04293,
    "D": 115.02694,
    "C": 103.00919,
    "Q": 128.05858,
    "E": 129.04259,
    "G": 57.02146,
    "H": 137.05891,
    "I": 113.08406,
    "L": 113.08406,
    "K": 128.09496,
    "M": 131.04049,
    "F": 147.06841,
    "P": 97.05276,
    "S": 87.03203,
    "T": 101.04768,
    "W": 186.07931,
    "Y": 163.06333,
    "V": 99.06841,
}
WATER_MASS = 18.01056

# ── pKa values for ionisable groups ─────────────────────────────────────────
# [pKa, charge_at_low_pH]
PKA_NTERM = 8.0  # N-terminus NH2
PKA_CTERM = 3.1  # C-terminus COOH
PKA_SIDE: dict[str, float] = {
    "D": 3.9,
    "E": 4.1,
    "H": 6.0,
    "C": 8.3,
    "Y": 10.1,
    "K": 10.5,
    "R": 12.5,
}

# ── Instability index dipeptide weights (Guruprasad et al., 1990) ───────────
# Complete 400-entry DIWV table (identical to the canonical ProtParam table).
# Sourced verbatim from the published Guruprasad matrix; every ordered residue
# pair is present, so the instability index needs no default-to-1.0 fallback.
_DIPW: dict[str, float] = {
    "AA": 1.0,
    "AC": 44.94,
    "AD": -7.49,
    "AE": 1.0,
    "AF": 1.0,
    "AG": 1.0,
    "AH": -7.49,
    "AI": 1.0,
    "AK": 1.0,
    "AL": 1.0,
    "AM": 1.0,
    "AN": 1.0,
    "AP": 20.26,
    "AQ": 1.0,
    "AR": 1.0,
    "AS": 1.0,
    "AT": 1.0,
    "AV": 1.0,
    "AW": 1.0,
    "AY": 1.0,
    "CA": 1.0,
    "CC": 1.0,
    "CD": 20.26,
    "CE": 1.0,
    "CF": 1.0,
    "CG": 1.0,
    "CH": 33.6,
    "CI": 1.0,
    "CK": 1.0,
    "CL": 20.26,
    "CM": 33.6,
    "CN": 1.0,
    "CP": 20.26,
    "CQ": -6.54,
    "CR": 1.0,
    "CS": 1.0,
    "CT": 33.6,
    "CV": -6.54,
    "CW": 24.68,
    "CY": 1.0,
    "DA": 1.0,
    "DC": 1.0,
    "DD": 1.0,
    "DE": 1.0,
    "DF": -6.54,
    "DG": 1.0,
    "DH": 1.0,
    "DI": 1.0,
    "DK": -7.49,
    "DL": 1.0,
    "DM": 1.0,
    "DN": 1.0,
    "DP": 1.0,
    "DQ": 1.0,
    "DR": -6.54,
    "DS": 20.26,
    "DT": -14.03,
    "DV": 1.0,
    "DW": 1.0,
    "DY": 1.0,
    "EA": 1.0,
    "EC": 44.94,
    "ED": 20.26,
    "EE": 33.6,
    "EF": 1.0,
    "EG": 1.0,
    "EH": -6.54,
    "EI": 20.26,
    "EK": 1.0,
    "EL": 1.0,
    "EM": 1.0,
    "EN": 1.0,
    "EP": 20.26,
    "EQ": 20.26,
    "ER": 1.0,
    "ES": 20.26,
    "ET": 1.0,
    "EV": 1.0,
    "EW": -14.03,
    "EY": 1.0,
    "FA": 1.0,
    "FC": 1.0,
    "FD": 13.34,
    "FE": 1.0,
    "FF": 1.0,
    "FG": 1.0,
    "FH": 1.0,
    "FI": 1.0,
    "FK": -14.03,
    "FL": 1.0,
    "FM": 1.0,
    "FN": 1.0,
    "FP": 20.26,
    "FQ": 1.0,
    "FR": 1.0,
    "FS": 1.0,
    "FT": 1.0,
    "FV": 1.0,
    "FW": 1.0,
    "FY": 33.601,
    "GA": -7.49,
    "GC": 1.0,
    "GD": 1.0,
    "GE": -6.54,
    "GF": 1.0,
    "GG": 13.34,
    "GH": 1.0,
    "GI": -7.49,
    "GK": -7.49,
    "GL": 1.0,
    "GM": 1.0,
    "GN": -7.49,
    "GP": 1.0,
    "GQ": 1.0,
    "GR": 1.0,
    "GS": 1.0,
    "GT": -7.49,
    "GV": 1.0,
    "GW": 13.34,
    "GY": -7.49,
    "HA": 1.0,
    "HC": 1.0,
    "HD": 1.0,
    "HE": 1.0,
    "HF": -9.37,
    "HG": -9.37,
    "HH": 1.0,
    "HI": 44.94,
    "HK": 24.68,
    "HL": 1.0,
    "HM": 1.0,
    "HN": 24.68,
    "HP": -1.88,
    "HQ": 1.0,
    "HR": 1.0,
    "HS": 1.0,
    "HT": -6.54,
    "HV": 1.0,
    "HW": -1.88,
    "HY": 44.94,
    "IA": 1.0,
    "IC": 1.0,
    "ID": 1.0,
    "IE": 44.94,
    "IF": 1.0,
    "IG": 1.0,
    "IH": 13.34,
    "II": 1.0,
    "IK": -7.49,
    "IL": 20.26,
    "IM": 1.0,
    "IN": 1.0,
    "IP": -1.88,
    "IQ": 1.0,
    "IR": 1.0,
    "IS": 1.0,
    "IT": 1.0,
    "IV": -7.49,
    "IW": 1.0,
    "IY": 1.0,
    "KA": 1.0,
    "KC": 1.0,
    "KD": 1.0,
    "KE": 1.0,
    "KF": 1.0,
    "KG": -7.49,
    "KH": 1.0,
    "KI": -7.49,
    "KK": 1.0,
    "KL": -7.49,
    "KM": 33.6,
    "KN": 1.0,
    "KP": -6.54,
    "KQ": 24.64,
    "KR": 33.6,
    "KS": 1.0,
    "KT": 1.0,
    "KV": -7.49,
    "KW": 1.0,
    "KY": 1.0,
    "LA": 1.0,
    "LC": 1.0,
    "LD": 1.0,
    "LE": 1.0,
    "LF": 1.0,
    "LG": 1.0,
    "LH": 1.0,
    "LI": 1.0,
    "LK": -7.49,
    "LL": 1.0,
    "LM": 1.0,
    "LN": 1.0,
    "LP": 20.26,
    "LQ": 33.6,
    "LR": 20.26,
    "LS": 1.0,
    "LT": 1.0,
    "LV": 1.0,
    "LW": 24.68,
    "LY": 1.0,
    "MA": 13.34,
    "MC": 1.0,
    "MD": 1.0,
    "ME": 1.0,
    "MF": 1.0,
    "MG": 1.0,
    "MH": 58.28,
    "MI": 1.0,
    "MK": 1.0,
    "ML": 1.0,
    "MM": -1.88,
    "MN": 1.0,
    "MP": 44.94,
    "MQ": -6.54,
    "MR": -6.54,
    "MS": 44.94,
    "MT": -1.88,
    "MV": 1.0,
    "MW": 1.0,
    "MY": 24.68,
    "NA": 1.0,
    "NC": -1.88,
    "ND": 1.0,
    "NE": 1.0,
    "NF": -14.03,
    "NG": -14.03,
    "NH": 1.0,
    "NI": 44.94,
    "NK": 24.68,
    "NL": 1.0,
    "NM": 1.0,
    "NN": 1.0,
    "NP": -1.88,
    "NQ": -6.54,
    "NR": 1.0,
    "NS": 1.0,
    "NT": -7.49,
    "NV": 1.0,
    "NW": -9.37,
    "NY": 1.0,
    "PA": 20.26,
    "PC": -6.54,
    "PD": -6.54,
    "PE": 18.38,
    "PF": 20.26,
    "PG": 1.0,
    "PH": 1.0,
    "PI": 1.0,
    "PK": 1.0,
    "PL": 1.0,
    "PM": -6.54,
    "PN": 1.0,
    "PP": 20.26,
    "PQ": 20.26,
    "PR": -6.54,
    "PS": 20.26,
    "PT": 1.0,
    "PV": 20.26,
    "PW": -1.88,
    "PY": 1.0,
    "QA": 1.0,
    "QC": -6.54,
    "QD": 20.26,
    "QE": 20.26,
    "QF": -6.54,
    "QG": 1.0,
    "QH": 1.0,
    "QI": 1.0,
    "QK": 1.0,
    "QL": 1.0,
    "QM": 1.0,
    "QN": 1.0,
    "QP": 20.26,
    "QQ": 20.26,
    "QR": 1.0,
    "QS": 44.94,
    "QT": 1.0,
    "QV": -6.54,
    "QW": 1.0,
    "QY": -6.54,
    "RA": 1.0,
    "RC": 1.0,
    "RD": 1.0,
    "RE": 1.0,
    "RF": 1.0,
    "RG": -7.49,
    "RH": 20.26,
    "RI": 1.0,
    "RK": 1.0,
    "RL": 1.0,
    "RM": 1.0,
    "RN": 13.34,
    "RP": 20.26,
    "RQ": 20.26,
    "RR": 58.28,
    "RS": 44.94,
    "RT": 1.0,
    "RV": 1.0,
    "RW": 58.28,
    "RY": -6.54,
    "SA": 1.0,
    "SC": 33.6,
    "SD": 1.0,
    "SE": 20.26,
    "SF": 1.0,
    "SG": 1.0,
    "SH": 1.0,
    "SI": 1.0,
    "SK": 1.0,
    "SL": 1.0,
    "SM": 1.0,
    "SN": 1.0,
    "SP": 44.94,
    "SQ": 20.26,
    "SR": 20.26,
    "SS": 20.26,
    "ST": 1.0,
    "SV": 1.0,
    "SW": 1.0,
    "SY": 1.0,
    "TA": 1.0,
    "TC": 1.0,
    "TD": 1.0,
    "TE": 20.26,
    "TF": 13.34,
    "TG": -7.49,
    "TH": 1.0,
    "TI": 1.0,
    "TK": 1.0,
    "TL": 1.0,
    "TM": 1.0,
    "TN": -14.03,
    "TP": 1.0,
    "TQ": -6.54,
    "TR": 1.0,
    "TS": 1.0,
    "TT": 1.0,
    "TV": 1.0,
    "TW": -14.03,
    "TY": 1.0,
    "VA": 1.0,
    "VC": 1.0,
    "VD": -14.03,
    "VE": 1.0,
    "VF": 1.0,
    "VG": -7.49,
    "VH": 1.0,
    "VI": 1.0,
    "VK": -1.88,
    "VL": 1.0,
    "VM": 1.0,
    "VN": 1.0,
    "VP": 20.26,
    "VQ": 1.0,
    "VR": 1.0,
    "VS": 1.0,
    "VT": -7.49,
    "VV": 1.0,
    "VW": 1.0,
    "VY": -6.54,
    "WA": -14.03,
    "WC": 1.0,
    "WD": 1.0,
    "WE": 1.0,
    "WF": 1.0,
    "WG": -9.37,
    "WH": 24.68,
    "WI": 1.0,
    "WK": 1.0,
    "WL": 13.34,
    "WM": 24.68,
    "WN": 13.34,
    "WP": 1.0,
    "WQ": 1.0,
    "WR": 1.0,
    "WS": 1.0,
    "WT": -14.03,
    "WV": -7.49,
    "WW": 1.0,
    "WY": 1.0,
    "YA": 24.68,
    "YC": 1.0,
    "YD": 24.68,
    "YE": -6.54,
    "YF": 1.0,
    "YG": -7.49,
    "YH": 13.34,
    "YI": 1.0,
    "YK": 1.0,
    "YL": 1.0,
    "YM": 44.94,
    "YN": 1.0,
    "YP": 13.34,
    "YQ": 1.0,
    "YR": -15.91,
    "YS": 1.0,
    "YT": -7.49,
    "YV": 1.0,
    "YW": -9.37,
    "YY": 13.34,
}


def _charge_at_ph(
    seq: str,
    ph: float,
    cyclic: bool = False,
    n_term_free: bool | None = None,
    c_term_free: bool | None = None,
) -> float:
    """Net charge via Henderson–Hasselbalch, summing all ionisable groups.

    A head-to-tail cyclic peptide does not expose a free N- or C-terminus —
    those backbone atoms are now an internal amide bond, so the standard
    PKA_NTERM (+1) and PKA_CTERM (-1) contributions are skipped when
    ``cyclic=True``. Without this correction, a cyclic peptide with no
    ionisable side chains was being reported as ~-0.2 charged at pH 7.4
    (and a wrong isoelectric point) — a real bug that biased every
    downstream solubility, aggregation and IVIVE call for cyclics.

    Terminal capping (spec §6.2: "the free N-/C-termini when not capped") is
    handled by the explicit ``n_term_free`` / ``c_term_free`` overrides: an
    N-terminal acetylation removes the +1 amino contribution, a C-terminal
    amidation removes the −1 carboxyl contribution. When the overrides are
    ``None`` they default to ``not cyclic`` — preserving the historical
    behaviour exactly for peptides with no declared terminal caps.
    """
    if n_term_free is None:
        n_term_free = not cyclic
    if c_term_free is None:
        c_term_free = not cyclic

    def hh_frac(pka: float, is_acid: bool) -> float:
        ratio = 10 ** (ph - pka)
        return -ratio / (1 + ratio) if is_acid else 1 / (1 + 10 ** (ph - pka))

    charge = 0.0
    if n_term_free:
        charge += hh_frac(PKA_NTERM, False)
    if c_term_free:
        charge += hh_frac(PKA_CTERM, True)
    for aa in seq:
        if aa in PKA_SIDE:
            pka = PKA_SIDE[aa]
            is_acid = aa in ("D", "E", "C", "Y")
            charge += hh_frac(pka, is_acid)
    return charge


def _isoelectric_point(
    seq: str,
    cyclic: bool = False,
    n_term_free: bool | None = None,
    c_term_free: bool | None = None,
) -> float:
    """Binary search for the pH where net charge ≈ 0.

    Respects ``cyclic`` and terminal-cap overrides so a capped or cyclic peptide
    uses the correct terminus charge profile (otherwise the binary search ends up
    at the wrong pI).
    """
    lo, hi = 0.0, 14.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if (
            _charge_at_ph(seq, mid, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free)
            > 0
        ):
            lo = mid
        else:
            hi = mid
    return round(mid, 2)


def _molecular_weight(seq: str) -> float:
    """Monoisotopic mass (Da) including terminal H2O — for MS workflows."""
    return sum(RESIDUE_MASS.get(aa, 111.1) for aa in seq) + WATER_MASS


# Average residue masses (Da, no water) — convention for biologics / PK work.
# Source: IUPAC average amino-acid masses, no terminal modification.
_AVG_RESIDUE_MASS: dict[str, float] = {
    "A": 71.0788,
    "R": 156.1875,
    "N": 114.1038,
    "D": 115.0886,
    "C": 103.1388,
    "Q": 128.1307,
    "E": 129.1155,
    "G": 57.0519,
    "H": 137.1411,
    "I": 113.1594,
    "L": 113.1594,
    "K": 128.1741,
    "M": 131.1926,
    "F": 147.1766,
    "P": 97.1167,
    "S": 87.0782,
    "T": 101.1051,
    "W": 186.2132,
    "Y": 163.1760,
    "V": 99.1326,
}
_AVG_WATER_MASS = 18.01528


def _average_molecular_weight(seq: str) -> float:
    """Average mass (Da) including terminal H2O — convention for PK / dosing.

    For a 30-mer the average and monoisotopic masses differ by ~1–2 Da;
    for a 150 kDa IgG they differ by ~100 Da. Pharmacology uses the average
    mass when converting between mg/kg and µM, so reporting only the
    monoisotopic mass biases every dose conversion downstream.
    """
    return sum(_AVG_RESIDUE_MASS.get(aa, 110.0) for aa in seq) + _AVG_WATER_MASS


def _gravy(seq: str) -> float:
    """Grand Average of hYdropathicity (Kyte–Doolittle scale)."""
    return sum(KD.get(aa, 0.0) for aa in seq) / len(seq)


def _instability_index(seq: str) -> float:
    """Guruprasad instability index (> 40 = unstable in vitro)."""
    if len(seq) < 2:
        return 0.0
    diwv = sum(_DIPW.get(seq[i] + seq[i + 1], 1.0) for i in range(len(seq) - 1))
    return (10.0 / len(seq)) * diwv


def _aliphatic_index(seq: str) -> float:
    """Ikai aliphatic index — relative volume occupied by aliphatic side chains."""
    n = len(seq)
    fa = seq.count("A") / n
    fv = seq.count("V") / n
    fi = seq.count("I") / n
    fl = seq.count("L") / n
    return 100 * (fa + 2.9 * fv + 3.9 * (fi + fl))


def _boman_index(seq: str) -> float:
    """Boman index — sum of solubility values (proxy for membrane interaction).

    Boman (2003): index > 2.48 → likely protein-binding; > 1 → likely AMP.
    """
    BOMAN: dict[str, float] = {
        "L": -4.92,
        "I": -4.92,
        "V": -4.04,
        "F": -2.98,
        "M": -2.35,
        "W": -2.33,
        "A": -1.81,
        "C": -1.28,
        "G": -0.94,
        "Y": 0.14,
        "T": 2.57,
        "S": 3.40,
        "H": 4.66,
        "Q": 5.54,
        "N": 6.64,
        "E": 6.81,
        "D": 8.72,
        "K": 5.55,
        "R": 14.92,
    }
    return sum(BOMAN.get(aa, 0.0) for aa in seq) / len(seq)


def _aromaticity(seq: str) -> float:
    """Fraction of aromatic residues (F, W, Y) — Lobry & Gautier 1994."""
    return (seq.count("F") + seq.count("W") + seq.count("Y")) / len(seq)


def _extinction_coefficient(seq: str) -> dict[str, Any]:
    """Molar extinction coefficient at 280 nm (Pace et al., Protein Sci. 1995).

    ε₂₈₀ = (nW × 5500) + (nY × 1490) + (nC_disulfide × 125)
    For reduced (no S-S): omit the Cys term.
    Returns both values so the researcher can pick based on reduction state.
    """
    nW = seq.count("W")
    nY = seq.count("Y")
    nC = seq.count("C")
    # Disulfide pairs = floor(nC / 2)
    n_ss = nC // 2
    eps_oxidised = nW * 5500 + nY * 1490 + n_ss * 125
    eps_reduced = nW * 5500 + nY * 1490
    return {
        "extinction_280_oxidised": eps_oxidised,  # M⁻¹ cm⁻¹, disulfides intact
        "extinction_280_reduced": eps_reduced,  # M⁻¹ cm⁻¹, all Cys reduced
        "n_trp": nW,
        "n_tyr": nY,
        "n_cys": nC,
        "n_disulfide_pairs": n_ss,
        "note": (
            "Use oxidised ε if peptide is in native (disulfide) form; "
            "reduced ε for denatured/DTT-treated samples. "
            "If ε=0, use BCA or bicinchoninic acid assay instead."
        ),
    }


# ===========================================================================
# Aggregation — Aggrescan algorithm (real, published, citable)
# ===========================================================================

# Aggrescan intrinsic aggregation-propensity scale (a3v values).
# Conchillo-Solé, de Groot, Avilés, Vendrell, Daura & Ventura,
# "AGGRESCAN: a server for the prediction and evaluation of hot spots of
# aggregation in polypeptides", BMC Bioinformatics 2007, 8:65.
# These per-residue values were derived experimentally from the in-vivo
# aggregation of amyloid-beta point mutants — a published, fixed scale.
A3V: dict[str, float] = {
    "A": -0.036,
    "R": -0.361,
    "N": -0.233,
    "D": -0.371,
    "C": 0.604,
    "Q": -0.230,
    "E": -0.375,
    "G": -0.011,
    "H": -0.012,
    "I": 0.822,
    "L": 0.726,
    "K": -0.931,
    "M": 0.450,
    "F": 1.013,
    "P": -0.334,
    "S": -0.294,
    "T": -0.159,
    "W": 0.913,
    "Y": 0.610,
    "V": 0.569,
}
# Aggrescan Hot-Spot Threshold — a region whose smoothed profile sits above
# this value is an aggregation hot spot (Conchillo-Solé et al. 2007).
_AGGRESCAN_HST = -0.02
# Aggrescan smoothing window radius (centred 5-residue window).
_AGGRESCAN_RADIUS = 2
# Minimum hot-spot length (residues) per the Aggrescan definition.
_AGGRESCAN_MIN_HS = 5


def _aggrescan(
    seq: str,
    ph: float = 7.4,
    ionic_strength: float = 150.0,
    custom_charge: float | None = None,
    pI: float = 7.0,
) -> dict[str, Any]:
    """Aggregation-prone-region detection via the AGGRESCAN algorithm.

    Real, published method — NOT a heuristic:
      1. Map each residue to its intrinsic aggregation propensity a3v
         (fixed experimental scale, Conchillo-Solé et al. 2007).
      2. Smooth with a centred 5-residue window → the a4v profile.
      3. A contiguous stretch (≥ 5 residues) whose a4v profile stays above the
         Hot-Spot Threshold (-0.02) is an aggregation hot spot.

    Returns the hot spots, the mean a3v, and the total hot-spot area. The
    High/Moderate/Low band is a triage label on top of those real numbers.
    """
    n = len(seq)
    if n == 0:
        return {
            "risk": "Low",
            "n_regions": 0,
            "regions": [],
            "mean_a3v": 0.0,
            "hotspot_area": 0.0,
            "method": "AGGRESCAN (Conchillo-Solé et al. 2007).",
            "provenance": "calculated",
        }

    a3v = [A3V.get(c, 0.0) for c in seq]
    # Centred-window smoothing → a4v profile.
    a4v: list[float] = []
    for i in range(n):
        lo, hi = max(0, i - _AGGRESCAN_RADIUS), min(n, i + _AGGRESCAN_RADIUS + 1)
        a4v.append(sum(a3v[lo:hi]) / (hi - lo))

    # Hot-spot detection — contiguous a4v > HST runs of length ≥ 5.
    regions: list[dict[str, Any]] = []
    i = 0
    while i < n:
        if a4v[i] > _AGGRESCAN_HST:
            j = i
            while j < n and a4v[j] > _AGGRESCAN_HST:
                j += 1
            if j - i >= _AGGRESCAN_MIN_HS:
                window = a4v[i:j]
                regions.append(
                    {
                        "start": i + 1,
                        "end": j,
                        "sequence": seq[i:j],
                        "peak_a4v": round(max(window), 3),
                        "area": round(sum(v - _AGGRESCAN_HST for v in window), 3),
                    }
                )
            i = j
        else:
            i += 1

    mean_a3v = sum(a3v) / n
    hotspot_area = round(sum(r["area"] for r in regions), 3)

    if mean_a3v > 0.05:
        base_risk = "High"
    elif mean_a3v > -0.10:
        base_risk = "Moderate"
    else:
        base_risk = "Low"

    risk_score = 2 if base_risk == "High" else 1 if base_risk == "Moderate" else 0
    risk_drivers = []

    active_charge = custom_charge if custom_charge is not None else round(_charge_at_ph(seq, ph), 2)
    abs_charge = abs(active_charge)
    salt_shielding = math.exp(-0.0035 * ionic_strength)
    dp = abs(ph - pI)

    # Adjust for pH near pI
    if dp < 1.2:
        risk_score += 1
        risk_drivers.append(
            f"pH {ph:.1f} is close to pI {pI:.1f} (dp={dp:.1f}) — near-neutral state accelerates self-association."
        )

    # Adjust for salt shielding
    if abs_charge > 1.0 and salt_shielding < 0.5:
        risk_score += 1
        risk_drivers.append(
            f"High salt ({ionic_strength} mM) screens electrostatic repulsion (shielding={100*(1-salt_shielding):.0f}%)."
        )

    adjusted_risk = "High" if risk_score >= 2 else "Moderate" if risk_score >= 1 else "Low"

    return {
        "risk": adjusted_risk,
        "n_regions": len(regions),
        "regions": regions[:8],
        "mean_a3v": round(mean_a3v, 4),
        "hotspot_area": hotspot_area,
        "method": (
            "AGGRESCAN — a3v intrinsic aggregation-propensity scale "
            "(Conchillo-Solé et al., BMC Bioinformatics 2007), smoothed 5-residue "
            "window. Modulated by pH-pI proximity and salt charge screening."
        ),
        "provenance": "calculated",
        "drivers": risk_drivers,
    }
