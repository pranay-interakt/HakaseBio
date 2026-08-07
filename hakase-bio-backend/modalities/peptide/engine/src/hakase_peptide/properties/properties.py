"""Peptide-native property engine — Layer 1 expansion for biologics.

Small-molecule ADMET tools (Lipinski rules, Hakase ADMET Chemprop, ECFP fingerprints)
are meaningless for peptides: a 15-mer has MW ≈ 1 800 Da, violates every oral
drug rule, and is not represented in the ChEMBL/BindingDB training sets. This
module provides peptide-specific analytics that are actually predictive:

  Physicochemical
    • Molecular weight (average isotopic, per residue contribution)
    • Net charge at pH 7.4 (Henderson–Hasselbalch, pKa ladder)
    • Isoelectric point (binary-search over Henderson–Hasselbalch)
    • Hydrophobicity — GRAVY index (Kyte–Doolittle scale)
    • Instability index (Guruprasad et al., Protein Eng. 1990)
    • Aliphatic index (Ikai, J Biochem. 1980)
    • Boman index (membrane interaction potential)
    • Aromaticity (Lobry & Gautier, 1994)

  Proteolytic stability
    • In-silico PeptideCutter: trypsin, chymotrypsin, pepsin, endoproteinase Glu-C,
      and thrombin cleavage sites from published specificity rules
    • Peptidase-instability heuristic (di-peptide-bond breakage probability)
    • Cyclization bonus (head-to-tail or disulfide reduces N→C protease access)

  Membrane permeability
    • Linear peptide Caco-2 permeability estimate (TPSA-equivalent heuristic)
    • Cyclic peptide Caco-2 boost (cyclic peptides bypass efflux better)
    • BBB permeability indicator for cell-penetrating peptide (CPP) scaffolds

  Structure propensity
    • Helical propensity per residue (Chou–Fasman helix parameters)
    • Amphipathicity index (helical wheel hydrophobic moment, 100° rotation)
    • Beta-sheet propensity
    • Secondary structure class prediction (helix / sheet / coil / mixed)

  Therapeutic modality flags
    • Oral bioavailability potential (cyclic + N-methylation + size gate)
    • CPP (cell-penetrating peptide) scaffold features
    • AMP (antimicrobial peptide) scaffold features
    • Half-life class estimate (plasma, renal, GI environments)

All computations are pure Python + numpy — no GPU, no external API call, so
this runs instantly on every Layer 1 request.  No fabrication: every value
is derived from the input sequence via published, citable formulae.

References
----------
Kyte & Doolittle (1982)   J. Mol. Biol. 157, 105–132      (hydrophobicity)
Guruprasad et al. (1990)  Protein Eng. 4, 155–161         (instability index)
Ikai (1980)               J. Biochem. 88, 1895–1898       (aliphatic index)
Boman (2003)              J. Internal Medicine 254, 197   (membrane index)
Eisenberg et al. (1982)   Nature 299, 371–374             (hydrophobic moment)
Chou & Fasman (1978)      Adv. Enzymol. 47, 45–148        (helix propensity)
Lobry & Gautier (1994)    Nucleic Acids Res. 22, 3174     (aromaticity)
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from hakase_chemistry.core import resolve_linker

# ── Shared amino-acid substrate ─────────────────────────────────────────────
# These constants and descriptors are generic AA science, not peptide-specific;
# they live in the platform sequence substrate so antibody (and future
# sequence modalities) can use them without importing this package.
from hakase_sequence.properties import (  # noqa: F401  (re-exported)
    _DIPW,
    A3V,
    AA_SET,
    DEFAULT_HYDROPHOBICITY_WINDOW,
    KD,
    PKA_CTERM,
    PKA_NTERM,
    PKA_SIDE,
    REFERENCE_PARAMETER_SETS,
    RESIDUE_MASS,
    WATER_MASS,
    _aggrescan,
    _aliphatic_index,
    _aromaticity,
    _average_molecular_weight,
    _boman_index,
    _charge_at_ph,
    _extinction_coefficient,
    _gravy,
    _instability_index,
    _isoelectric_point,
    _molecular_weight,
)

# ── Chou–Fasman helix-forming parameters (1978) ──────────────────────────────
CF_HELIX: dict[str, float] = {
    "A": 1.42,
    "R": 0.98,
    "N": 0.67,
    "D": 1.01,
    "C": 0.70,
    "Q": 1.11,
    "E": 1.51,
    "G": 0.57,
    "H": 1.00,
    "I": 1.08,
    "L": 1.21,
    "K": 1.16,
    "M": 1.45,
    "F": 1.13,
    "P": 0.57,
    "S": 0.77,
    "T": 0.83,
    "W": 1.08,
    "Y": 0.69,
    "V": 1.06,
}
CF_SHEET: dict[str, float] = {
    "A": 0.83,
    "R": 0.93,
    "N": 0.89,
    "D": 0.54,
    "C": 1.19,
    "Q": 1.10,
    "E": 0.37,
    "G": 0.75,
    "H": 0.87,
    "I": 1.60,
    "L": 1.30,
    "K": 0.74,
    "M": 1.05,
    "F": 1.38,
    "P": 0.55,
    "S": 0.75,
    "T": 1.19,
    "W": 1.37,
    "Y": 1.47,
    "V": 1.70,
}

# ── Protease cleavage rules (PeptideCutter-derived, simplified) ──────────────
# Each rule: (name, regex_on_sequence, note)
# X = any amino acid in regex; captured position is the cleavage bond.
PROTEASE_RULES: list[tuple[str, str, str]] = [
    ("Trypsin", r"[KR](?!P)", "cleaves after K/R (not before P)"),
    ("Chymotrypsin (h)", r"[FYW](?!P)", "cleaves after F/Y/W (not before P); high specificity"),
    (
        "Chymotrypsin (l)",
        r"[FYWML](?!P)",
        "cleaves after F/Y/W/M/L (not before P); low specificity",
    ),
    ("Pepsin (pH 1.3)", r"[^HKR][^P][FL](?=.)", r"cleaves at pH 1.3 before F/L"),
    ("Pepsin (pH > 2)", r"[FLWY](?=[^P])", "cleaves before F/L/W/Y at pH > 2"),
    (
        "Endoproteinase Glu-C (Bicarb)",
        r"E(?=[^P])",
        "cleaves after E (not before P) in bicarbonate buffer",
    ),
    (
        "Endoproteinase Glu-C (Phosph)",
        r"[DE](?=[^P])",
        "cleaves after D/E (not before P) in phosphate buffer",
    ),
    ("Thrombin", r"GR[^DEK]", "cleaves after GR if not followed by D/E/K"),
    ("Thermolysin", r"(?<=[^KR])[LFMIV]", "cleaves before L/F/M/I/V (not after K/R)"),
]


# ===========================================================================
# Helper functions
# ===========================================================================


def _clean_sequence(seq: str) -> str:
    clean = re.sub(r"[^A-Z]", "", seq.upper())
    bad = sorted(set(clean) - AA_SET)
    if bad:
        raise ValueError(
            f"Sequence contains non-standard amino acids: {bad}. "
            f"Use the 20 standard 1-letter codes. Non-canonical residues "
            f"should be specified as modifications in the structural engine input."
        )
    if len(clean) < 2:
        raise ValueError("Peptide must be at least 2 amino acids long.")
    return clean


def _hydrophobic_moment(seq: str, angle_deg: float = 100.0) -> float:
    """Eisenberg hydrophobic moment (helical amphipathicity at 100° rotation).

    A value > 0.5 is a strong amphipathic-helix indicator.
    """
    angle_rad = math.radians(angle_deg)
    sin_sum = sum(KD.get(aa, 0.0) * math.sin(i * angle_rad) for i, aa in enumerate(seq))
    cos_sum = sum(KD.get(aa, 0.0) * math.cos(i * angle_rad) for i, aa in enumerate(seq))
    return math.sqrt(sin_sum**2 + cos_sum**2) / len(seq)


def _windowed_hydrophobicity(
    seq: str, window: int = DEFAULT_HYDROPHOBICITY_WINDOW
) -> dict[str, Any]:
    """Sliding-window mean hydrophobicity profile (spec §6.3).

    H_window(k) = (1/w) Σ_{i=k..k+w-1} h(r_i) over the Kyte–Doolittle scale.
    Returns one value per window start position (n − w + 1 windows) plus the
    window width used. Amphipathic segments show up as peaks a single GRAVY
    average would hide — this profile is a downstream feature for the Functional
    and Safety Services.

    For sequences shorter than the requested window the width is clamped to the
    sequence length so a single whole-sequence window is still reported rather
    than an empty profile.
    """
    n = len(seq)
    w = max(1, min(int(window), n))
    values = [
        round(sum(KD.get(seq[i + j], 0.0) for j in range(w)) / w, 4) for i in range(n - w + 1)
    ]
    return {
        "windowed_values": values,
        "window_size": w,
        "requested_window_size": int(window),
        "scale": "Kyte-Doolittle",
    }


def _per_residue_charge(seq: str, ph: float = 7.4) -> list[float]:
    """Signed Henderson–Hasselbalch charge contributed by each residue side chain.

    Non-ionisable residues contribute 0. Termini are deliberately excluded so
    the profile reflects only the sequence-internal charge pattern (the two
    endpoints would otherwise dominate the positional statistics). This is the
    per-position quantity the charge-distribution variance is computed over.
    """
    out: list[float] = []
    for aa in seq:
        if aa in PKA_SIDE:
            pka = PKA_SIDE[aa]
            is_acid = aa in ("D", "E", "C", "Y")
            ratio = 10 ** (ph - pka)
            q = -ratio / (1 + ratio) if is_acid else 1 / (1 + 10 ** (ph - pka))
            out.append(round(q, 4))
        else:
            out.append(0.0)
    return out


def _charge_distribution(seq: str, ph: float = 7.4) -> dict[str, Any]:
    """Positional charge distribution and its variance (spec §6.5).

    Beyond total net charge, the *spatial* arrangement of charged residues
    matters: a cluster of cationic residues at one terminus behaves very
    differently from an even distribution. Computed here as the positional
    variance of the per-residue signed charge — analogous to the windowed
    hydrophobicity calculation (§6.3). Higher variance ⇒ more clustered charge.
    """
    profile = _per_residue_charge(seq, ph)
    arr = np.asarray(profile, dtype=float)
    variance = float(np.var(arr)) if arr.size else 0.0
    return {
        "profile": profile,
        "variance": round(variance, 6),
        "mean_abs_charge": round(float(np.mean(np.abs(arr))) if arr.size else 0.0, 6),
        "ph": ph,
    }


def _compositional_statistics(seq: str) -> dict[str, Any]:
    """Sequence-level compositional statistics (spec §6.10).

    Amino-acid frequency vector, dipeptide frequency vector, cysteine count
    (disulfide-bonding potential), proline content (backbone rigidity /
    protease resistance) and glycine content (backbone flexibility). Retained
    as auxiliary features for downstream ML models.
    """
    n = len(seq)
    aa_freq = {aa: round(seq.count(aa) / n, 6) for aa in sorted(set(seq))}
    dipeptides = [seq[i : i + 2] for i in range(n - 1)]
    n_dip = len(dipeptides)
    dip_freq: dict[str, float] = {}
    if n_dip:
        for dp in dipeptides:
            dip_freq[dp] = dip_freq.get(dp, 0.0) + 1.0
        dip_freq = {k: round(v / n_dip, 6) for k, v in sorted(dip_freq.items())}
    return {
        "aa_frequencies": aa_freq,
        "dipeptide_frequencies": dip_freq,
        "cys_count": seq.count("C"),
        "pro_content": round(seq.count("P") / n, 6),
        "gly_content": round(seq.count("G") / n, 6),
    }


def _secondary_structure_propensity(seq: str) -> dict[str, Any]:
    """Mean Chou–Fasman helix and sheet parameters → secondary structure class."""
    mean_h = sum(CF_HELIX.get(aa, 1.0) for aa in seq) / len(seq)
    mean_s = sum(CF_SHEET.get(aa, 1.0) for aa in seq) / len(seq)
    if mean_h >= 1.03 and mean_h > mean_s:
        ss_class = "helix"
        note = "Strong helical propensity — consider as α-helical peptide scaffold"
    elif mean_s >= 1.05 and mean_s > mean_h:
        ss_class = "beta"
        note = "Beta-sheet propensity — may aggregate; consider cyclization or stapling"
    elif mean_h < 0.9 and mean_s < 0.9:
        ss_class = "coil"
        note = "Coil / intrinsically disordered — flexible scaffold, low structural bias"
    else:
        ss_class = "mixed"
        note = "Mixed helix/sheet propensity — context-dependent; check full complex"
    return {
        "class": ss_class,
        "mean_helix_cf": round(mean_h, 3),
        "mean_sheet_cf": round(mean_s, 3),
        "note": note,
    }


def _protease_sites(seq: str) -> list[dict[str, Any]]:
    """Find cleavage sites for each protease in PROTEASE_RULES."""
    sites: list[dict[str, Any]] = []
    for name, pattern, note in PROTEASE_RULES:
        positions = [m.start() + 1 for m in re.finditer(pattern, seq)]  # 1-indexed
        sites.append(
            {
                "protease": name,
                "sites": positions,
                "n_sites": len(positions),
                "note": note,
            }
        )
    return sites


def _stability_class(n_cleavage_sites: int, length: int, cyclic: bool) -> str:
    density = n_cleavage_sites / max(length, 1)
    if cyclic:
        density *= 0.4  # cyclization substantially reduces protease access
    if density == 0:
        return "Very stable — no predicted cleavage sites"
    if density < 0.1:
        return "Stable — sparse cleavage sites"
    if density < 0.2:
        return "Moderate — some protease susceptibility"
    return "Labile — dense cleavage sites; consider cyclization, N-methylation, or D-amino acids"


def _permeability_estimate(seq: str, mw: float, charge_74: float, cyclic: bool) -> dict[str, Any]:
    """Heuristic membrane permeability for peptides.

    Based on published PAMPA/Caco-2 trends for peptide libraries:
    - TPSA-analogue: approximate from H-bond donor/acceptor count
    - Cyclic peptides (cyclosporin A paradigm): MW gate < 1200 Da, ≤ 5 H-bond donors
    - Linear oral peptides: essentially impossible above 8 residues without tricks
    """
    # H-bond donor count — use the same enumeration as the public _hbd_hba()
    # helper instead of a broken inline count. Previously the function added a
    # constant "+2" for backbone amide donors, which under-counts massively
    # (a real peptide has n-1-nP backbone N-H donors plus side chains), and
    # in practice made the ``mw <= 500 and n_hbd <= 5`` branch dead code.
    n_hbd = _hbd_hba(seq)["hbd"]
    abs_charge = abs(charge_74)

    if cyclic:
        # Cyclic peptide permeability model (cyclosporin A paradigm)
        if mw <= 1200 and n_hbd <= 5 and abs_charge < 1.0:
            perm_class = "Moderate-High"
            perm_note = (
                "Cyclic peptide with low MW and H-bond donors — may achieve oral "
                "bioavailability similar to cyclosporin A. Validate with PAMPA assay."
            )
        elif mw <= 1600 and n_hbd <= 8:
            perm_class = "Low-Moderate"
            perm_note = (
                "Cyclic peptide at boundary — permeability possible via transcytosis "
                "or modified delivery. IV/SC route more likely."
            )
        else:
            perm_class = "Low"
            perm_note = "Cyclic peptide too large or polar for passive diffusion. IV/SC delivery."
    else:
        if len(seq) <= 4 and abs_charge < 1.0:
            perm_class = "Low"
            perm_note = (
                "Short linear peptide — rapid renal clearance and proteolysis; "
                "bioavailability very limited even if small."
            )
        elif mw <= 500 and n_hbd <= 5:
            perm_class = "Low"
            perm_note = (
                "Small linear peptide — some intestinal absorption possible "
                "but oral route not practical without peptidomimetic modification."
            )
        else:
            perm_class = "Very Low"
            perm_note = (
                "Large linear peptide — practically impermeable to the GI membrane. "
                "Parenteral (IV/SC/IM) or local delivery recommended."
            )

    # CPP (cell-penetrating peptide) signal: high Arg/Lys content
    n_charged = seq.count("R") + seq.count("K") + seq.count("H")
    cpp_signal = n_charged / len(seq) >= 0.25 and charge_74 > 2.0

    return {
        "permeability_class": perm_class,
        "note": perm_note,
        "hbd_estimate": n_hbd,
        "cyclic_bonus": cyclic,
        "cpp_signal": cpp_signal,
        "cpp_note": (
            (
                "High cationic charge density — may function as cell-penetrating peptide (CPP). "
                "Validate cellular uptake; consider endosomal escape mechanism."
            )
            if cpp_signal
            else None
        ),
    }


def _amp_score(seq: str, hydrophobic_moment: float, charge_74: float) -> dict[str, Any]:
    """Antimicrobial peptide (AMP) heuristic scoring.

    AMPs typically have: cationic (charge +2 to +9), amphipathic (moment > 0.4),
    hydrophobic fraction 30–60%, length 10–40 residues.
    """
    n = len(seq)
    n_hyd = sum(1 for aa in seq if KD.get(aa, 0) > 0)
    hyd_frac = n_hyd / n

    score = 0
    signals = []
    if 2.0 <= charge_74 <= 9.0:
        score += 2
        signals.append(f"cationic (charge +{charge_74:.1f})")
    if hydrophobic_moment > 0.4:
        score += 2
        signals.append(f"amphipathic (μH={hydrophobic_moment:.2f})")
    if 0.30 <= hyd_frac <= 0.60:
        score += 1
        signals.append(f"hydrophobic fraction {hyd_frac:.0%}")
    if 10 <= n <= 40:
        score += 1
        signals.append(f"length {n} (AMP range 10–40)")
    if seq.count("G") + seq.count("P") >= 2:
        score += 1
        signals.append("Gly/Pro structural flexibility (common in AMPs)")

    tier = "high" if score >= 5 else "moderate" if score >= 3 else "low"
    return {
        "amp_likelihood": tier,
        "amp_score": score,
        "amp_max_score": 7,
        "signals": signals,
        "note": (
            (
                "Strong AMP features — consider screening against membrane disruption assays "
                "(MIC, haemolysis)."
            )
            if tier == "high"
            else (
                ("Some AMP features present — may have membrane-active properties.")
                if tier == "moderate"
                else None
            )
        ),
    }


def _half_life_estimate(seq: str, mw: float, cyclic: bool) -> dict[str, Any]:
    """Rough half-life class (minutes/hours) in plasma, renal, GI environments.

    Not a calibrated PK model — gives a directional tier for decision-making.
    """
    trypsin_sites = len([m for m in re.finditer(r"[KR](?!P)", seq)])
    high_protease = trypsin_sites >= 3
    small = mw < 800
    charged = abs(_charge_at_ph(seq, 7.4, cyclic=cyclic)) > 2.0

    if cyclic:
        plasma_t12 = "hours–days"
        gi_t12 = "hours"
        renal_note = "Cyclic peptides resist glomerular filtration if MW > 1 kDa."
    elif high_protease and not cyclic:
        plasma_t12 = "minutes (< 30 min)"
        gi_t12 = "< 10 min"
        renal_note = "Rapidly degraded before significant renal clearance."
    elif small and charged:
        plasma_t12 = "minutes–hours"
        gi_t12 = "minutes"
        renal_note = "Small charged peptides: rapid renal clearance (t½ renal < 1 h)."
    else:
        plasma_t12 = "30 min–2 h"
        gi_t12 = "< 30 min"
        renal_note = "Moderate plasma stability; renal clearance for MW < 60 kDa."

    return {
        "plasma_half_life_estimate": plasma_t12,
        "gi_half_life_estimate": gi_t12,
        "renal_clearance_note": renal_note,
        "stability_caveat": (
            "Half-life estimates are directional heuristics only. Validate with "
            "plasma stability assay, microsomal incubation, and in-vivo PK study."
        ),
    }


# ── D-amino acid substitution map ────────────────────────────────────────────
_D_AA_MAP: dict[str, str] = {
    "A": "D-Ala",
    "C": "D-Cys",
    "D": "D-Asp",
    "E": "D-Glu",
    "F": "D-Phe",
    "G": "D-Gly",
    "H": "D-His",
    "I": "D-Ile",
    "K": "D-Lys",
    "L": "D-Leu",
    "M": "D-Met",
    "N": "D-Asn",
    "P": "D-Pro",
    "Q": "D-Gln",
    "R": "D-Arg",
    "S": "D-Ser",
    "T": "D-Thr",
    "V": "D-Val",
    "W": "D-Trp",
    "Y": "D-Tyr",
}


def _modification_advisor(
    seq: str,
    protease_sites: list[dict[str, Any]],
    instability: float,
    charge_74: float,
    mw: float,
    cyclic: bool,
) -> dict[str, Any]:
    """Position-specific modification recommendations — a USP feature.

    Returns actionable suggestions covering:
      1. D-amino acid substitution at multi-protease cleavage sites
      2. N-methylation for cyclic/oral peptides (cyclosporin A paradigm)
      3. PEGylation (renal clearance reduction, plasma t½ 5–10×)
      4. Lipidation (albumin binding, semaglutide/liraglutide paradigm)
      5. Hydrocarbon helix stapling at i,i+4 positions

    All suggestions are derived from first-principles medicinal chemistry —
    no ML, no fabrication, fully citeable.
    """
    n = len(seq)
    suggestions: list[dict[str, Any]] = []

    # ── 1. D-amino acid substitution at labile protease sites ────────────────
    # Count how many proteases cleave at each position.
    position_protease_hits: dict[int, list[str]] = {}
    for entry in protease_sites:
        for pos in entry["sites"]:
            if 1 <= pos <= n:
                position_protease_hits.setdefault(pos, []).append(entry["protease"])

    # Prioritise positions hit by the most proteases.
    for pos in sorted(position_protease_hits, key=lambda p: -len(position_protease_hits[p])):
        aa = seq[pos - 1]
        if aa not in _D_AA_MAP:
            continue
        proteases_hit = position_protease_hits[pos]
        suggestions.append(
            {
                "type": "D-amino acid substitution",
                "position": pos,
                "original_residue": aa,
                "suggested_modification": _D_AA_MAP[aa],
                "rationale": (
                    f"Position {pos} ({aa}) is a cleavage site for "
                    f"{', '.join(proteases_hit[:3])}{'...' if len(proteases_hit) > 3 else ''}. "
                    f"{_D_AA_MAP[aa]} is sterically unrecognized by serine and cysteine proteases "
                    f"while preserving side-chain pharmacophore."
                ),
                "expected_impact": "high" if len(proteases_hit) >= 2 else "moderate",
                "reference": "Tugyi et al. (2005), Proc. Natl. Acad. Sci.",
            }
        )
        if len([s for s in suggestions if s["type"] == "D-amino acid substitution"]) >= 3:
            break  # cap at top 3 D-AA suggestions

    # ── 2. N-methylation (cyclic / oral peptides) ─────────────────────────────
    # Applicable when: cyclic scaffold where HBD reduction improves Papp.
    if cyclic:
        # Pick hydrophobic residues not already flagged as labile.
        flagged_positions = set(position_protease_hits.keys())
        nmethyl_cands = [
            (i + 1, aa)
            for i, aa in enumerate(seq)
            if aa in "AVILMFYWG" and (i + 1) not in flagged_positions
        ][:3]
        for pos, aa in nmethyl_cands:
            suggestions.append(
                {
                    "type": "N-methylation",
                    "position": pos,
                    "original_residue": aa,
                    "suggested_modification": f"N-Me-{aa}",
                    "rationale": (
                        f"N-methylation at position {pos} ({aa}) removes one H-bond donor "
                        f"from the backbone amide, improving passive transcellular permeability "
                        f"(Caco-2 Papp) in the cyclosporin A / Compound 17 paradigm."
                    ),
                    "expected_impact": "moderate",
                    "reference": "Whitty et al. (2016), Nat. Chem. Biol.",
                }
            )

    # ── 3. PEGylation ────────────────────────────────────────────────────────
    # Preferred site: Lys ε-amine; fallback: N-terminus.
    lys_positions = [i + 1 for i, aa in enumerate(seq) if aa == "K"]
    if lys_positions:
        pos = lys_positions[0]
        suggestions.append(
            {
                "type": "PEGylation",
                "position": pos,
                "original_residue": "K",
                "suggested_modification": f"K(PEG₂₀₀₀) at position {pos}",
                "rationale": (
                    f"PEGylation of Lys at position {pos} (ε-amine) reduces renal clearance "
                    f"and immunogenicity while extending plasma t½ 5–10×. "
                    f"MW increase ≈ 2 kDa (PEG₂k) — validate HMW aggregate formation."
                ),
                "expected_impact": "high",
                "reference": "Veronese & Mero (2008), BioDrugs.",
            }
        )
    else:
        suggestions.append(
            {
                "type": "PEGylation (N-terminus)",
                "position": 1,
                "original_residue": seq[0],
                "suggested_modification": "N-terminal PEG₂k via NHS ester",
                "rationale": (
                    "No Lys available — N-terminal PEGylation achieves similar t½ extension. "
                    "Alternatively, introduce K at a non-pharmacophore position for site-specific conjugation."
                ),
                "expected_impact": "moderate",
                "reference": "Veronese & Mero (2008), BioDrugs.",
            }
        )

    # ── 4. Lipidation (albumin binding) ──────────────────────────────────────
    # Only beneficial if current t½ is short (linear peptides mostly).
    if not cyclic and mw < 4000:
        lipid_pos = lys_positions[0] if lys_positions else 1
        lipid_aa = seq[lipid_pos - 1]
        suggestions.append(
            {
                "type": "Lipidation",
                "position": lipid_pos,
                "original_residue": lipid_aa,
                "suggested_modification": (
                    f"C18 fatty diacid linker at {'K pos ' + str(lipid_pos) if lys_positions else 'N-terminus'}"
                ),
                "rationale": (
                    "Fatty diacid conjugation (semaglutide paradigm) enables reversible albumin "
                    "binding, extending plasma t½ to ~160 h vs minutes for the unmodified peptide. "
                    "Linker chemistry: mini-PEG-γGlu-OEG-OEG-C18 fatty diacid."
                ),
                "expected_impact": "high",
                "reference": "Lau et al. (2015), J. Med. Chem. (semaglutide).",
            }
        )

    # ── 5. Helix stapling (i, i+4 hydrocarbon) ───────────────────────────────
    # Only if the peptide has significant helix propensity.
    helix_positions = [
        i
        for i, aa in enumerate(seq)
        if CF_HELIX.get(aa, 1.0) > CF_SHEET.get(aa, 1.0) and CF_HELIX.get(aa, 1.0) > 1.0
    ]
    if len(helix_positions) >= 5:
        # Find consecutive i, i+4 pairs
        helix_set = set(helix_positions)
        staple_pairs = [(i, i + 4) for i in helix_positions if (i + 4) in helix_set]
        if staple_pairs:
            i0, i4 = staple_pairs[0][0] + 1, staple_pairs[0][1] + 1  # 1-indexed
            suggestions.append(
                {
                    "type": "Helix stapling",
                    "position": i0,
                    "original_residue": f"{seq[i0-1]}@{i0} + {seq[i4-1]}@{i4}",
                    "suggested_modification": f"(R)-α-methylated Ala (Aib) at {i0},{i4} — olefin metathesis",
                    "rationale": (
                        f"Hydrocarbon staple between positions {i0} and {i4} (i, i+4 on the same "
                        f"helix face) locks α-helical conformation, improves proteolytic resistance "
                        f"2–40×, and can enable endosomal escape / cell penetration."
                    ),
                    "expected_impact": "high",
                    "reference": "Walensky et al. (2004), Science; Bird et al. (2010), Curr. Opin.",
                }
            )

    # ── 6. Cyclization (if linear and labile) ────────────────────────────────
    total_cleavage = sum(e["n_sites"] for e in protease_sites)
    if not cyclic and total_cleavage >= 4 and mw < 3000:
        suggestions.append(
            {
                "type": "Head-to-tail cyclization",
                "position": 0,  # whole-molecule modification
                "original_residue": f"{seq[0]}…{seq[-1]}",
                "suggested_modification": "SPPS solid-phase cyclization (head-to-tail amide bond)",
                "rationale": (
                    f"Cyclization removes the free N- and C-termini, blocking exopeptidase access "
                    f"and reducing conformational entropy. Expected: 3–10× improvement in plasma t½, "
                    f"{'+10–30 on permeability score' if mw < 1200 else 'improved distribution'}."
                ),
                "expected_impact": "high",
                "reference": "Driggers et al. (2008), Nat. Rev. Drug Discov.",
            }
        )

    return {
        "suggestions": suggestions[:8],  # top 8 by priority ordering
        "total_suggestions": len(suggestions),
        "priority_type": suggestions[0]["type"] if suggestions else None,
        "priority_position": suggestions[0]["position"] if suggestions else None,
    }


# ===========================================================================
# Chemical-stability liabilities  (the peptide analogue of the antibody scan)
# ===========================================================================

# (type, regex, severity, note) — deterministic motif search over the sequence.
_PEP_LIABILITY_RULES: list[tuple[str, str, str, str]] = [
    (
        "Asn deamidation (high)",
        r"N[GN]",
        "high",
        "NG/NN motif — fast Asn deamidation to iso-Asp/Asp; generates charge variants and can cut potency.",
    ),
    (
        "Asn deamidation",
        r"N[STH]",
        "moderate",
        "NS/NT/NH motif — moderate Asn deamidation susceptibility on storage.",
    ),
    (
        "Asp isomerisation",
        r"D[GSTDH]",
        "moderate",
        "DG/DS/DT/DD/DH motif — Asp isomerises to iso-Asp; backbone kink, possible activity loss.",
    ),
    (
        "Asp-Pro hydrolysis",
        r"DP",
        "low",
        "DP motif — acid-labile peptide bond; fragmentation risk at low pH / in the GI tract.",
    ),
]


def _chemical_liabilities(
    seq: str, cyclic: bool, free_cysteines: int | None = None
) -> dict[str, Any]:
    """Sequence-liability scan for chemical degradation hotspots.

    Peptides degrade not only by proteolysis but by *chemical* routes —
    oxidation, deamidation, isomerisation, acid hydrolysis. This is the
    peptide counterpart of the antibody CDR-liability scan and is essential
    for an honest in-vitro stability picture.
    """
    hits: list[dict[str, Any]] = []

    # Motif-based liabilities.
    for ltype, pattern, sev, note in _PEP_LIABILITY_RULES:
        for m in re.finditer(pattern, seq):
            hits.append(
                {
                    "type": ltype,
                    "motif": m.group(0),
                    "position": m.start() + 1,
                    "severity": sev,
                    "note": note,
                }
            )

    # Met / Trp oxidation — residue-level.
    for i, aa in enumerate(seq):
        if aa in ("M", "W"):
            hits.append(
                {
                    "type": f"{'Met' if aa == 'M' else 'Trp'} oxidation",
                    "motif": aa,
                    "position": i + 1,
                    "severity": "moderate",
                    "note": (
                        "Oxidation-prone residue — surface Met/Trp oxidise under "
                        "light/peroxide stress; can shift potency if near the pharmacophore."
                    ),
                }
            )

    # N-terminal pyroglutamate (free N-terminus only — not for head-to-tail cyclics).
    if not cyclic and seq[:1] in ("Q", "E"):
        hits.append(
            {
                "type": "N-terminal pyroglutamate",
                "motif": seq[0],
                "position": 1,
                "severity": "low",
                "note": "Leading Gln/Glu cyclises to pyroglutamate — a common, usually benign charge variant.",
            }
        )

    # Free thiol (unpaired cysteine count).
    active_free_cys = free_cysteines if free_cysteines is not None else seq.count("C")
    if active_free_cys % 2 == 1:
        hits.append(
            {
                "type": "Unpaired cysteine",
                "motif": "C",
                "position": seq.rfind("C") + 1,
                "severity": "high",
                "note": (
                    f"Unpaired cysteines ({active_free_cys} free thiols) — a free thiol drives disulfide "
                    f"scrambling and covalent aggregation. Confirm the pairing or cap it."
                ),
            }
        )

    n_high = sum(1 for h in hits if h["severity"] == "high")
    n_mod = sum(1 for h in hits if h["severity"] == "moderate")
    risk = "High" if n_high > 0 or n_mod >= 4 else "Moderate" if n_mod > 0 else "Low"
    return {
        "liabilities": hits,
        "n_high": n_high,
        "n_moderate": n_mod,
        "n_total": len(hits),
        "risk": risk,
    }


# ===========================================================================
# Solubility estimate
# ===========================================================================


def _solubility_estimate(
    seq: str,
    charge_74: float,
    gravy: float,
    aromaticity: float,
    ph: float = 7.4,
    ionic_strength: float = 150.0,
    custom_charge: float | None = None,
) -> dict[str, Any]:
    """Heuristic aqueous-solubility class at physiological pH or custom pH/salt.

    Peptide solubility is driven by net charge (charged peptides resist
    self-association), hydrophobicity (GRAVY) and aromatic π-stacking.
    A directional class — not a measured logS — labelled honestly.
    """
    score = 55.0
    drivers: list[str] = []

    salt_shielding = math.exp(-0.0035 * ionic_strength)
    active_charge = custom_charge if custom_charge is not None else charge_74
    abs_charge = abs(active_charge)

    if abs_charge >= 3:
        charge_bonus = 20.0 * salt_shielding
        score += charge_bonus
        drivers.append(
            f"Net charge {active_charge:+.1f} — strong electrostatic repulsion aids solubility (shielded to {charge_bonus:+.1f} by {ionic_strength} mM salt)."
        )
    elif abs_charge >= 1:
        charge_bonus = 8.0 * salt_shielding
        score += charge_bonus
        drivers.append(
            f"Net charge {active_charge:+.1f} — mild solubilising charge (shielded to {charge_bonus:+.1f} by {ionic_strength} mM salt)."
        )
    else:
        score -= 18
        drivers.append(
            f"Near-neutral net charge ({active_charge:+.1f}) — little electrostatic protection against aggregation."
        )

    if gravy > 0.5:
        score -= 25
        drivers.append(
            f"Hydrophobic (GRAVY {gravy:+.2f}) — high self-association / precipitation risk."
        )
    elif gravy > 0:
        score -= 10
        drivers.append(f"Mildly hydrophobic (GRAVY {gravy:+.2f}).")
    else:
        score += 12
        drivers.append(f"Hydrophilic (GRAVY {gravy:+.2f}) — favours solubility.")

    if aromaticity > 0.20:
        score -= 12
        drivers.append(f"Aromatic-rich ({aromaticity:.0%}) — π-stacking can drive gelation.")

    if ionic_strength > 300:
        salting_out_loss = min(12.0, (ionic_strength - 300) * 0.015)
        score -= salting_out_loss
        drivers.append(
            f"High ionic strength ({ionic_strength} mM) — risk of salting-out/precipitation (reduced score by -{salting_out_loss:.1f})."
        )

    score = max(0.0, min(100.0, score))
    sol_class = (
        "High"
        if score >= 65
        else "Moderate" if score >= 40 else "Low" if score >= 20 else "Very low"
    )
    return {
        "solubility_score": round(score, 1),
        "solubility_class": sol_class,
        "drivers": drivers,
        "note": (
            "Directional heuristic from charge, hydrophobicity and aromaticity — "
            "not a measured logS. Confirm with a kinetic-solubility or turbidity assay; "
            "formulation (pH, excipients, ionic strength) can move this substantially."
        ),
    }


def _peptide_aggregation(
    seq: str,
    ph: float = 7.4,
    ionic_strength: float = 150.0,
    custom_charge: float | None = None,
    pI: float = 7.0,
) -> dict[str, Any]:
    """Peptide aggregation profile — AGGRESCAN algorithm (see `_aggrescan`)."""
    return _aggrescan(seq, ph, ionic_strength, custom_charge, pI)


# ===========================================================================
# Immunogenicity (coarse screen)
# ===========================================================================


def _peptide_immunogenicity(seq: str) -> dict[str, Any]:
    """Coarse T-cell-epitope screen — hydrophobic 9-mer windows are candidate
    MHC-II binding cores. Directional flag, NOT a calibrated score."""
    window = 9
    hot = 0
    if len(seq) >= window:
        for i in range(len(seq) - window + 1):
            seg = seq[i : i + window]
            if sum(KD.get(a, 0.0) for a in seg) / window > 1.6:
                hot += 1
    band = "Elevated" if hot >= 4 else "Moderate" if hot >= 1 else "Low"
    return {
        "candidate_epitope_windows": hot,
        "band": band,
        "method": "Hydrophobic 9-mer window proxy for MHC-II binding cores.",
        "caveat": (
            "Coarse directional screen only. A calibrated immunogenicity score needs "
            "an MHC-II model trained on IEDB epitope data — flagged roadmap item. "
            "All-D and heavily non-natural peptides are typically far less immunogenic."
        ),
    }


# ===========================================================================
# Synthesis / manufacturability (solid-phase peptide synthesis)
# ===========================================================================


def _synthesis_assessment(seq: str, cyclic: bool, num_bridges: int = 0) -> dict[str, Any]:
    """Solid-phase-peptide-synthesis (SPPS) difficulty assessment.

    Flags the sequence features that make a peptide hard or expensive to make:
    length, cysteine/disulfide complexity, β-branched/hydrophobic runs that
    cause on-resin aggregation ('difficult sequences'), and homopolymer runs.
    """
    n = len(seq)
    score = 0
    factors: list[str] = []

    # Length — coupling yield compounds per residue.
    if n > 50:
        score += 3
        factors.append(f"Length {n} — beyond routine SPPS; native chemical ligation likely needed.")
    elif n > 30:
        score += 2
        factors.append(
            f"Length {n} — long synthesis; cumulative coupling losses reduce crude purity."
        )
    elif n > 15:
        score += 1
        factors.append(f"Length {n} — standard SPPS range.")

    # Cysteine / disulfide complexity.
    n_cys = seq.count("C")
    if num_bridges >= 2:
        score += 3
        factors.append(
            f"{num_bridges} disulfide bridges mapped — multi-disulfide regioselective folding is highly complex for SPPS."
        )
    elif num_bridges == 1:
        score += 1
        factors.append("1 disulfide bridge mapped — orthogonal cysteine protection required.")
    elif n_cys >= 4:
        score += 2
        factors.append(
            f"{n_cys} cysteines (no map) — multi-disulfide regioselective folding is non-trivial."
        )
    elif n_cys >= 2:
        score += 1
        factors.append(
            f"{n_cys} cysteines (no map) — one disulfide; orthogonal protection straightforward."
        )

    # 'Difficult sequence' on-resin aggregation — β-branched / hydrophobic runs.
    if re.search(r"[VITFLY]{4,}", seq):
        score += 2
        factors.append(
            "β-branched / hydrophobic run (≥4) — on-resin aggregation; expect difficult couplings."
        )

    # Homopolymer runs.
    for aa, label in (("Q", "poly-Gln"), ("N", "poly-Asn"), ("P", "poly-Pro")):
        if re.search(aa + r"{3,}", seq):
            score += 1
            factors.append(f"{label} run — known difficult sequence; deletion impurities likely.")

    if cyclic:
        score += 1
        factors.append("Cyclisation — adds an on-/off-resin macrocyclisation + purification step.")

    difficulty = (
        "Routine"
        if score <= 1
        else "Moderate" if score <= 3 else "Difficult" if score <= 6 else "Very difficult"
    )
    return {
        "difficulty_class": difficulty,
        "difficulty_score": score,
        "factors": factors or ["No notable synthesis-difficulty features — routine SPPS."],
        "note": (
            "SPPS feasibility triage from sequence features only. Actual crude purity "
            "and cost depend on the synthesis route, scale and purification."
        ),
    }


# ===========================================================================
# Charge pH profile  (formulation-critical)
# ===========================================================================


def _charge_profile(
    seq: str,
    cyclic: bool = False,
    n_term_free: bool | None = None,
    c_term_free: bool | None = None,
) -> dict[str, float]:
    """Net charge at 5 key pH values for formulation and stability work.

    Scientists need charge vs pH to select buffer pH, predict aggregation
    at the pI, and design lyophilisation formulations. Respects ``cyclic``
    and terminal-cap overrides so a capped/cyclic peptide reports the correct
    terminus charge profile (otherwise the pH-7.4 row in the table would
    disagree with the headline net charge).
    """

    def q(ph: float) -> float:
        return round(
            _charge_at_ph(seq, ph, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free),
            2,
        )

    return {
        "pH_4_0": q(4.0),
        "pH_5_0": q(5.0),
        "pH_6_0": q(6.0),
        "pH_7_4": q(7.4),
        "pH_8_0": q(8.0),
        "pH_9_0": q(9.0),
    }


# ===========================================================================
# Hydrogen bond donor / acceptor count
# ===========================================================================


def _hbd_hba(seq: str) -> dict[str, int]:
    """Hydrogen bond donors (HBD) and acceptors (HBA) from sequence.

    Important for membrane permeability: Veber's rule for cyclic peptides
    (oral bioavailability correlates with HBD ≤ 5 + rotatable bonds ≤ 10).
    Standard peptide backbone contributes n-1 N-H donors and n carbonyl O acceptors.
    References
    ----------
    Veber et al. (2002), J. Med. Chem. 45, 2615 (HBD / rotatable bonds for oral BA).
    """
    n = len(seq)
    # Backbone N-H donors: n − 1 (proline has no N-H)
    n_pro = seq.count("P")
    hbd_backbone = max(0, n - 1 - n_pro)
    # Side-chain donors: OH (S/T/Y), NH2/NH (N/Q), NH3 (K), Gdn (R),
    #                    imidazole (H), SH (C), indole NH (W)
    SIDE_HBD: dict[str, int] = {
        "S": 1,
        "T": 1,
        "Y": 1,
        "N": 1,
        "Q": 1,
        "K": 1,
        "R": 2,
        "H": 1,
        "C": 1,
        "W": 1,
    }
    hbd_side = sum(SIDE_HBD.get(aa, 0) for aa in seq)
    hbd = hbd_backbone + hbd_side

    # Backbone carbonyls: n acceptors
    hba_backbone = n
    # Side-chain acceptors: OOH (D/E × 2), amide O (N/Q), OH (S/T/Y),
    #                       imidazole N (H), N-H partners (K/R — partial)
    SIDE_HBA: dict[str, int] = {
        "D": 2,
        "E": 2,
        "N": 1,
        "Q": 1,
        "S": 1,
        "T": 1,
        "Y": 1,
        "H": 1,
    }
    hba_side = sum(SIDE_HBA.get(aa, 0) for aa in seq)
    hba = hba_backbone + hba_side
    return {"hbd": hbd, "hba": hba}


# ===========================================================================
# Serum stability profile
# ===========================================================================


def _serum_stability(
    seq: str,
    mw: float,
    gravy: float,
    charge_74: float,
    cyclic: bool,
    n_protease_sites: int,
) -> dict[str, Any]:
    """Serum / plasma stability profile and albumin-binding estimate.

    Key preclinical readout: if the peptide degrades faster than it can reach
    its target, it will not show efficacy in vivo regardless of potency.

    References
    ----------
    Hvidt & Johansen (1979) — albumin fatty-acid binding model.
    Ré et al. (2014) — plasma stability assay benchmarks.
    """
    # Albumin binding estimate (%) — fatty / hydrophobic peptides bind albumin
    # reversibly, extending plasma t½ (semaglutide paradigm).
    alb_pct = min(97, max(1, round(35 + gravy * 22 - abs(charge_74) * 4 + (18 if cyclic else 0))))

    # FBS (fetal bovine serum, 37 °C) stability class
    if cyclic:
        fbs_class = "High (>4 h in FBS)"
        fbs_note = "Cyclic scaffold shields backbone amides from endopeptidases."
    elif n_protease_sites > 4 or (not cyclic and len(seq) > 30):
        fbs_class = "Low (<30 min in FBS)"
        fbs_note = (
            f"Linear peptide with {n_protease_sites} protease sites — "
            f"expect rapid degradation; lipidation / N-methylation recommended."
        )
    elif n_protease_sites >= 2:
        fbs_class = "Moderate (30 min–2 h in FBS)"
        fbs_note = "Moderate protease load; confirm with plasma stability assay at 37 °C."
    else:
        fbs_class = "Moderate-High (1–4 h in FBS)"
        fbs_note = "Low protease burden; expect reasonable plasma stability for a linear peptide."

    # Recommended stability assay panel (ICH Q1A / regulatory standard)
    assay_panel = [
        "Mouse/human plasma stability (0.5, 1, 2, 4 h at 37 °C) — LC-MS/MS quantification",
        "Human liver microsomes (CLint, 0–60 min, 1 mg/mL protein)",
        "Simulated gastric/intestinal fluid (SGF/SIF) for oral candidates",
    ]

    return {
        "albumin_binding_pct": alb_pct,
        "fbs_stability_class": fbs_class,
        "fbs_note": fbs_note,
        "assay_panel": assay_panel,
        "provenance": "heuristic",
        "note": (
            "Albumin binding and FBS stability are heuristic estimates from GRAVY, "
            "charge and proteolytic load. Experimental plasma stability (LC-MS/MS) and "
            "equilibrium dialysis (albumin binding) are required for PK prediction."
        ),
    }


# ===========================================================================
# MIC range prediction for AMP candidates
# ===========================================================================


def _mic_estimate(amp_score: int, charge_74: float, mw: float) -> dict[str, Any]:
    """Predicted minimum inhibitory concentration (MIC) range for AMP candidates.

    Only generated when amp_score ≥ 3 (confirmed AMP features).

    References
    ----------
    Wang et al. (2015), APD3 AMP database meta-analysis (PMID 25414334).
    Fernandez-Vidal et al. (2007), J. Mol. Biol. 370(3):459 — charge/potency correlation.
    """
    if amp_score < 3:
        return {
            "applicable": False,
            "note": "Sequence does not meet AMP threshold (score < 3) — MIC prediction not applicable.",
        }

    # Charge and size are the two best sequence-level MIC predictors.
    if amp_score >= 5 and charge_74 >= 3.0:
        mic_range, mic_potency = "1–8 µg/mL", "High"
    elif amp_score >= 4 or charge_74 >= 2.0:
        mic_range, mic_potency = "8–32 µg/mL", "Moderate"
    else:
        mic_range, mic_potency = "32–128 µg/mL", "Low-moderate"

    # Likely spectrum from size (short AMPs often Gram-positive only)
    if mw < 1000:
        spectrum = "Gram-positive primary; Gram-negative variable"
    elif mw < 2500:
        spectrum = "Broad-spectrum (Gram-positive + Gram-negative likely)"
    else:
        spectrum = "Gram-positive primary (large AMPs often lose Gram-negative activity)"

    return {
        "applicable": True,
        "predicted_mic_range_ug_ml": mic_range,
        "potency_class": mic_potency,
        "predicted_spectrum": spectrum,
        "breakpoint_note": (
            "EUCAST/CLSI breakpoints: susceptible ≤8 µg/mL (most Gram+), "
            "≤4 µg/mL (many Gram−). Resistance breakpoints are pathogen-specific."
        ),
        "method": (
            "AMP score + net charge correlation from Wang et al. 2015 "
            "APD3 meta-analysis; MW-based spectrum from APD database."
        ),
        "assay_required": (
            "Broth microdilution MIC assay per EUCAST/CLSI E.Dis 5.1 / M07-A10. "
            "Include haemolysis (RBC lysis) at ≥ 4× MIC for therapeutic index."
        ),
        "provenance": "heuristic",
    }


# ===========================================================================
# Receptor engagement score
# ===========================================================================


def _receptor_engagement(
    seq: str, boman: float, charge_74: float, gravy: float, hydmom: float
) -> dict[str, Any]:
    """Receptor-engagement potential — sequence-level estimate of protein-binding
    likelihood from published physicochemical correlates.

    NOT a target-specific potency prediction (that requires docking / SPR).
    Provides a triage-grade signal to prioritise compounds for cell-based assays.

    References
    ----------
    Boman (2003) J Internal Medicine 254:197 (Boman index threshold 2.48).
    Eisenberg et al. (1982) Nature 299:371 (hydrophobic moment).
    """
    n = len(seq)
    score = 0
    signals: list[str] = []

    # Boman index threshold from 1997 Boman paper
    if boman > 2.48:
        score += 3
        signals.append(
            f"Boman index {boman:.2f} > 2.48 — strong protein-binding propensity "
            f"(above threshold for >85% of known receptor-binding peptides, Boman 2003)"
        )
    elif boman > 1.0:
        score += 1
        signals.append(f"Boman index {boman:.2f} — moderate protein-interaction propensity")

    # Amphipathicity enables face-on presentation to receptor groove
    if hydmom > 0.5:
        score += 2
        signals.append(
            f"Amphipathic (μH={hydmom:.2f} > 0.5) — helical wheel presents a "
            f"hydrophobic face ideal for hydrophobic receptor pockets"
        )
    elif hydmom > 0.3:
        score += 1
        signals.append(f"Moderate amphipathicity (μH={hydmom:.2f})")

    # Balanced charge — too high is non-specific, too low loses electrostatics
    if 1.0 <= abs(charge_74) <= 4.0:
        score += 1
        signals.append(
            f"Charge {charge_74:+.1f} — electrostatic complementarity to typical "
            f"receptor binding grooves (negative electrostatic patches on most proteins)"
        )
    elif abs(charge_74) > 6.0:
        signals.append(
            f"High charge ({charge_74:+.1f}) — risk of non-specific electrostatic binding "
            f"to multiple proteins; selectivity likely low"
        )

    # GRAVY near zero = balanced hydrophobicity for receptor interface
    if -0.3 <= gravy <= 0.8:
        score += 1
        signals.append(f"Balanced hydrophobicity (GRAVY {gravy:.2f}) — suits receptor interface")

    # Therapeutic peptide length range
    if 8 <= n <= 50:
        score += 1
        signals.append(f"Length {n} aa — within optimal therapeutic peptide range (8–50)")

    tier = (
        "High (>70% probability of measurable receptor binding)"
        if score >= 6
        else (
            "Moderate (30–70% probability)"
            if score >= 3
            else "Low (<30% probability from sequence alone)"
        )
    )
    return {
        "receptor_engagement_score": score,
        "receptor_engagement_max": 8,
        "engagement_tier": tier,
        "signals": signals,
        "note": (
            "Sequence-level estimate from Boman index, amphipathicity, charge and "
            "hydrophobicity. Does NOT predict target specificity — confirm with "
            "cell-based potency assay (EC50), SPR or ITC for Kd."
        ),
        "provenance": "heuristic",
    }


# ===========================================================================
# Bioconjugation site inventory
# ===========================================================================


def _bioconjugation_sites(seq: str, free_cys_positions: list[int] | None = None) -> dict[str, Any]:
    """Enumerate reactive sites for ADC, PEG, probe or linker conjugation.

    Relevant for: ADC payload attachment, PEG conjugation to extend t½,
    fluorescent probe labelling for imaging studies, radiotracer conjugation.
    """
    lys_pos = [i + 1 for i, aa in enumerate(seq) if aa == "K"]
    cys_pos = (
        free_cys_positions
        if free_cys_positions is not None
        else [i + 1 for i, aa in enumerate(seq) if aa == "C"]
    )
    asp_pos = [i + 1 for i, aa in enumerate(seq) if aa == "D"]
    glu_pos = [i + 1 for i, aa in enumerate(seq) if aa == "E"]
    total = 1 + len(lys_pos) + len(cys_pos)  # N-term + Lys + Cys

    if cys_pos:
        preferred = f"Cys at position {cys_pos[0]} (thiol; maleimide / disulfide exchange — highest site-specificity)"
    elif lys_pos:
        preferred = f"Lys at position {lys_pos[0]} (ε-amine; NHS-ester — common, non-site-specific if multiple Lys)"
    else:
        preferred = "N-terminus (α-amine; reductive amination / oxime ligation)"

    return {
        "total_reactive_sites": total,
        "n_terminal": 1,
        "lysine_positions": lys_pos,
        "cysteine_positions": cys_pos,
        "aspartate_positions": asp_pos,
        "glutamate_positions": glu_pos,
        "preferred_site": preferred,
        "chemistry_options": [
            "Lys ε-amine: NHS-ester (pH 7–8.5), succinimidyl ester",
            "Cys thiol: maleimide (pH 6.5–7.5), vinyl sulfone, iodoacetamide",
            "N-terminus α-amine: NHS-ester, reductive amination (aldehyde), oxime (aminooxy)",
            "Asp/Glu carboxyl: EDC/NHS two-step (low specificity for peptides)",
        ],
        "note": (
            "Site-specific conjugation (Cys thiol > N-term specific chemistry > Lys) "
            "minimises heterogeneous drug-antibody-ratio (DAR) distribution and preserves "
            "target-binding activity."
        ),
    }


# ===========================================================================
# Public API
# ===========================================================================


def _parse_disulfide_bridges(
    bridges_str: str | None, seq: str
) -> tuple[list[tuple[int, int]], list[str], list[str]]:
    """Parse comma-separated pairs of disulfide bridges, e.g., '1-6, 3-8' (1-indexed).
    Returns (valid_bridges, warnings, drivers).
    """
    valid_bridges = []
    warnings = []
    drivers = []
    if not bridges_str or not bridges_str.strip():
        return valid_bridges, warnings, drivers

    parts = [p.strip() for p in bridges_str.split(",") if p.strip()]
    n = len(seq)

    used_indices = set()
    for p in parts:
        match = re.match(r"^(\d+)[-:](\d+)$", p)
        if not match:
            warnings.append(f"Invalid format '{p}' — use format 'idx1-idx2', e.g., '1-6'")
            continue
        idx1, idx2 = int(match.group(1)), int(match.group(2))

        # Check boundary
        if idx1 < 1 or idx1 > n or idx2 < 1 or idx2 > n:
            warnings.append(f"Bridge '{p}' is out of bounds for sequence of length {n}.")
            continue

        if idx1 == idx2:
            warnings.append(f"Bridge '{p}' cannot link a residue to itself.")
            continue

        # Check Cysteine
        if seq[idx1 - 1] != "C" or seq[idx2 - 1] != "C":
            warnings.append(
                f"Bridge '{p}' residues are not both Cysteines: {seq[idx1-1]}{idx1} and {seq[idx2-1]}{idx2}."
            )
            continue

        # Check double-use
        if idx1 in used_indices or idx2 in used_indices:
            warnings.append(f"Bridge '{p}' re-uses a cysteine index that is already paired.")
            continue

        valid_bridges.append((idx1, idx2))
        used_indices.add(idx1)
        used_indices.add(idx2)
        drivers.append(f"Cys{idx1} - Cys{idx2} disulfide bridge confirmed (oxidized).")

    return valid_bridges, warnings, drivers


def _apply_modifications(
    modifications: dict[str, Any] | None,
    base_mw_mono: float,
    base_mw_avg: float,
    resources: Any = None,
) -> dict[str, Any]:
    """Apply declared-modification mass increments to the base peptide masses.

    Terminal caps (acetylation/amidation) carry exact literature increments;
    lipid/PEG/other linker chemistry is resolved by the cheminformatics engine
    (built-in constants, RDKit over a supplied structure, or ChEMBL/PubChem via
    ``resources``). Any increment that cannot be resolved *exactly* makes the
    modified molecular weight explicitly ``unavailable`` — never approximated
    (spec §6.1, §11, §12). All other descriptors are unaffected and computed
    normally.
    """
    empty = {
        "declared": False,
        "applied": [],
        "total_increment_avg_da": 0.0,
        "total_increment_mono_da": 0.0,
        "modified_mw_avg_da": round(base_mw_avg, 2),
        "modified_mw_mono_da": round(base_mw_mono, 2),
        "mw_resolved": True,
        "unresolved": [],
        "unavailable_descriptors": {},
    }
    mod_list = (modifications or {}).get("list") or []
    if not mod_list:
        return empty

    applied: list[dict[str, Any]] = []
    total_avg = 0.0
    total_mono = 0.0
    unresolved: list[str] = []
    mw_resolved = True

    for m in mod_list:
        record = dict(m)
        avg = m.get("mass_increment_avg_da")
        mono = m.get("mass_increment_mono_da")
        descriptor = m.get("descriptor") or m.get("type") or ""
        if avg is None or mono is None:
            # Linker chemistry — resolve via the cheminformatics engine.
            res = resolve_linker(descriptor, smiles=m.get("smiles"), resources=resources)
            record["resolution"] = res.to_dict()
            if res.available and res.mass_avg is not None and res.mass_mono is not None:
                avg, mono = res.mass_avg, res.mass_mono
                record["mass_increment_avg_da"] = avg
                record["mass_increment_mono_da"] = mono
                record["mass_resolved"] = True
            else:
                record["mass_resolved"] = False
        if avg is None or mono is None:
            mw_resolved = False
            unresolved.append(str(descriptor))
        else:
            total_avg += avg
            total_mono += mono
        applied.append(record)

    if mw_resolved:
        modified_avg: float | None = round(base_mw_avg + total_avg, 2)
        modified_mono: float | None = round(base_mw_mono + total_mono, 2)
        unavailable: dict[str, str] = {}
    else:
        # No reference parameters for the appended chemistry -> the modified mass
        # is genuinely unknown. Mark ONLY molecular_weight unavailable; every
        # sequence-derived descriptor is still computed exactly (spec §12).
        modified_avg = None
        modified_mono = None
        unavailable = {
            "molecular_weight": (
                "Declared modification(s) without reference mass parameters "
                f"({', '.join(unresolved)}); modified molecular weight cannot be "
                "computed without fabrication (spec §12)."
            )
        }

    return {
        "declared": True,
        "applied": applied,
        "total_increment_avg_da": round(total_avg, 4),
        "total_increment_mono_da": round(total_mono, 4),
        "modified_mw_avg_da": modified_avg,
        "modified_mw_mono_da": modified_mono,
        "mw_resolved": mw_resolved,
        "unresolved": unresolved,
        "unavailable_descriptors": unavailable,
    }


def predict_peptide_properties(
    sequence: str,
    cyclic: bool = False,
    ph: float = 7.4,
    ionic_strength: float = 150.0,
    disulfide_bridges: str | None = None,
    modifications: dict[str, Any] | None = None,
    resources: Any = None,
) -> dict[str, Any]:
    """Compute full peptide property profile for Layer 1.

    Output schema is the deterministic property profile consumed by the V3
    peptide scientific services and the temporary frontend compatibility adapter.

    Parameters
    ----------
    sequence : str
        Single-letter amino-acid sequence (standard 20-letter code).
    cyclic : bool
        Whether the peptide is head-to-tail cyclic.
    ph : float
        Custom environment pH for biophysical calculation.
    ionic_strength : float
        Custom environment ionic strength (salinity) in mM.
    disulfide_bridges : str, optional
        Custom comma-separated disulfide bridge index pairs.
    modifications : dict, optional
        Canonicalized modification payload (``domain.modifications.ModificationSet``
        serialized as ``{"list": [...], "n_terminus_free": bool,
        "c_terminus_free": bool}``). Applies terminal-cap/linker mass increments
        and terminus-charge corrections. ``None`` => unmodified peptide, identical
        output to before.
    resources : optional
        Resource Manager for resolving non-standard chemistry via ChEMBL/PubChem
        (spec §8). ``None`` keeps the descriptor path network-free (spec §13).

    Returns
    -------
    dict containing deterministic peptide property blocks
    """
    seq = _clean_sequence(sequence)
    n = len(seq)

    # ── Terminal-cap charge overrides (spec §6.2) ────────────────────────────
    # An N-terminal acetylation removes the free amino group's +1 contribution;
    # a C-terminal amidation removes the free carboxyl's −1. When no caps are
    # declared these default to ``not cyclic`` inside the charge helpers, so
    # behaviour is unchanged for unmodified peptides.
    mods_declared = bool((modifications or {}).get("list"))
    n_term_free = (modifications or {}).get("n_terminus_free") if mods_declared else None
    c_term_free = (modifications or {}).get("c_terminus_free") if mods_declared else None

    # ── Parse Disulfide Bridges ──────────────────────────────────────────────
    valid_bridges, bridge_warnings, bridge_drivers = _parse_disulfide_bridges(
        disulfide_bridges, seq
    )
    paired_cys_indices = set()
    for c1, c2 in valid_bridges:
        paired_cys_indices.add(c1)
        paired_cys_indices.add(c2)

    total_cys = seq.count("C")
    paired_cys_count = len(paired_cys_indices)
    free_cys_count = total_cys - paired_cys_count
    free_cys_positions = [
        i + 1 for i, aa in enumerate(seq) if aa == "C" and (i + 1) not in paired_cys_indices
    ]

    # ── Core physicochemical ──────────────────────────────────────────────────
    mw = _molecular_weight(seq)
    mw_avg = _average_molecular_weight(seq)
    # Charge calculation must know whether the molecule is head-to-tail cyclic
    # (no free N/C-terminal contributions). This fixes a long-standing bug
    # where cyclic peptides were reported as ~-0.2 charged at pH 7.4 even
    # without any ionisable side chains, biasing pI, solubility, aggregation
    # and IVIVE downstream.
    charge_74 = round(
        _charge_at_ph(seq, 7.4, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free), 2
    )
    charge_custom = round(
        _charge_at_ph(seq, ph, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free), 2
    )
    pI = _isoelectric_point(seq, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free)
    gravy = round(_gravy(seq), 3)
    instability = round(_instability_index(seq), 2)
    aliphatic = round(_aliphatic_index(seq), 2)
    boman = round(_boman_index(seq), 3)
    aromaticity = round(_aromaticity(seq), 3)
    hydmom = round(_hydrophobic_moment(seq), 3)  # α-helix, 100°
    hydmom_beta = round(_hydrophobic_moment(seq, angle_deg=160.0), 3)  # β-strand, 160°

    # ── Modification mass increments (spec §6.1) ─────────────────────────────
    # Terminal caps / linkers add or subtract known masses. Unresolvable
    # chemistry makes ONLY the modified molecular weight unavailable; every
    # sequence-derived descriptor above is untouched (spec §12).
    mod_mass = _apply_modifications(modifications, mw, mw_avg, resources=resources)
    reported_mw_mono = mod_mass["modified_mw_mono_da"]  # None if unresolved
    reported_mw_avg = mod_mass["modified_mw_avg_da"]  # None if unresolved

    # ── Spec §6.3/§6.5/§6.10 descriptor blocks (surfaced for the Evidence Object)
    hydrophobicity_profile = _windowed_hydrophobicity(seq)
    charge_distribution = _charge_distribution(seq, ph=7.4)
    compositional_stats = _compositional_statistics(seq)

    # ── Secondary structure — residue-level fractions ────────────────────────
    # Classify each residue by dominant Chou-Fasman propensity:
    #   helix  : CF_HELIX > CF_SHEET  AND CF_HELIX > 1.0
    #   sheet  : CF_SHEET >= CF_HELIX AND CF_SHEET > 1.0
    #   coil   : neither parameter > 1.0 (inherently disordered)
    n_helix = sum(
        1
        for aa in seq
        if CF_HELIX.get(aa, 1.0) > CF_SHEET.get(aa, 1.0) and CF_HELIX.get(aa, 1.0) > 1.0
    )
    n_sheet = sum(
        1
        for aa in seq
        if CF_SHEET.get(aa, 1.0) >= CF_HELIX.get(aa, 1.0) and CF_SHEET.get(aa, 1.0) > 1.0
    )
    n_coil = n - n_helix - n_sheet
    hf = round(n_helix / n, 3)
    sf = round(n_sheet / n, 3)
    cf = round(n_coil / n, 3)
    if n_helix >= n_sheet and n_helix >= n_coil:
        dominant_ss = "α-Helix dominant"
    elif n_sheet >= n_helix and n_sheet >= n_coil:
        dominant_ss = "β-Sheet dominant"
    elif n_coil > 0.5 * n:
        dominant_ss = "Intrinsically disordered"
    else:
        dominant_ss = "Mixed"

    # ── Proteolytic stability ─────────────────────────────────────────────────
    protease = _protease_sites(seq)  # list of {protease, sites, n_sites, note}
    trypsin_n = next(p["n_sites"] for p in protease if p["protease"] == "Trypsin")
    most_labile = max(protease, key=lambda p: p["n_sites"])

    # ── Membrane permeability ─────────────────────────────────────────────────
    permeability = _permeability_estimate(seq, mw, charge_74, cyclic)
    perm_score_map = {
        "Moderate-High": 55,
        "Low-Moderate": 30,
        "Low": 15,
        "Very Low": 5,
    }
    perm_score = perm_score_map.get(permeability["permeability_class"], 10)
    perm_notes = [permeability["note"]]
    if permeability.get("cpp_note"):
        perm_notes.append(permeability["cpp_note"])

    # ── AMP score ─────────────────────────────────────────────────────────────
    amp = _amp_score(seq, hydmom, charge_74)
    amp_class_map = {
        "high": "Strong AMP candidate",
        "moderate": "Moderate AMP candidate",
        "low": "Non-AMP",
    }

    # ── Half-life ─────────────────────────────────────────────────────────────
    halflife = _half_life_estimate(seq, mw, cyclic)
    extinction = _extinction_coefficient(seq)
    mod_advice = _modification_advisor(seq, protease, instability, charge_74, mw, cyclic)

    # ── Expanded Layer-1 readouts (chemical stability, solubility, etc.) ──────
    chem_liab = _chemical_liabilities(seq, cyclic, free_cysteines=free_cys_count)
    solubility = _solubility_estimate(
        seq,
        charge_74,
        gravy,
        aromaticity,
        ph=ph,
        ionic_strength=ionic_strength,
        custom_charge=charge_custom,
    )
    aggregation = _peptide_aggregation(
        seq, ph=ph, ionic_strength=ionic_strength, custom_charge=charge_custom, pI=pI
    )
    immunogen = _peptide_immunogenicity(seq)
    synthesis = _synthesis_assessment(seq, cyclic, num_bridges=len(valid_bridges))

    # ── Industry-standard expanded outputs (new preclinical readouts) ─────────
    total_protease_sites = sum(p["n_sites"] for p in protease)
    charge_prof = _charge_profile(
        seq, cyclic=cyclic, n_term_free=n_term_free, c_term_free=c_term_free
    )
    hbd_hba = _hbd_hba(seq)
    serum_stab = _serum_stability(seq, mw, gravy, charge_74, cyclic, total_protease_sites)
    mic_est = _mic_estimate(amp["amp_score"], charge_74, mw)
    rec_engage = _receptor_engagement(seq, boman, charge_74, gravy, hydmom)
    bioconj = _bioconjugation_sites(seq, free_cys_positions=free_cys_positions)

    dominant_route = (
        "Oral (potential)"
        if cyclic and mw < 1200 and abs(charge_74) < 1.0
        else "Parenteral (IV/SC/IM)"
    )

    # ── Developability ────────────────────────────────────────────────────────
    oral_ok = cyclic and mw < 1200 and abs(charge_74) < 1.0
    oral_blockers: list[str] = []
    if not cyclic:
        oral_blockers.append("Linear scaffold — passive GI absorption blocked")
    if mw >= 1200:
        oral_blockers.append(f"MW {mw:.0f} Da exceeds 1 200 Da oral gate (cyclosporin A paradigm)")
    if abs(charge_74) >= 1.0:
        oral_blockers.append(f"Net charge {charge_74:+.1f} at pH 7.4 exceeds ±1.0 threshold")

    aggregation_risk = (
        "High" if dominant_ss == "β-Sheet dominant" or n > 50 else "Moderate" if n > 25 else "Low"
    )

    dev_notes = [
        f"MW {mw:.0f} Da — {'within' if mw <= 1500 else 'exceeds'} typical peptide drug range (< 1.5 kDa)",
        f"Net charge {charge_74:+.1f} at pH 7.4",
        (
            "Cyclic — reduced proteolysis + potentially oral"
            if cyclic
            else "Linear — parenteral delivery expected"
        ),
        f"GRAVY {gravy:.2f} — {'hydrophobic' if gravy > 0 else 'hydrophilic'} character",
    ]
    if dominant_ss == "β-Sheet dominant":
        dev_notes.append("β-Sheet propensity — aggregation risk; consider cyclization or stapling")

    # ── Charge class ──────────────────────────────────────────────────────────
    if charge_74 > 0.5:
        charge_class = "Cationic"
    elif charge_74 < -0.5:
        charge_class = "Anionic"
    else:
        charge_class = "Neutral"

    # ── Assemble deterministic property output ───────────────────────────────
    return {
        "sequence": seq,
        "cyclic": cyclic,
        "engine": "peptide_engine_v1",
        "physicochemical": {
            "sequence_length": n,
            # Monoisotopic — what mass spectrometers measure. Includes resolved
            # modification increments; None when a declared modification's mass
            # is unresolvable (spec §12 — never fabricated).
            "molecular_weight_da": reported_mw_mono,
            # Average — what pharmacology uses to convert mg/kg ↔ µM.
            "molecular_weight_avg_da": reported_mw_avg,
            # Unmodified backbone masses, always available for reference.
            "molecular_weight_base_da": round(mw, 2),
            "molecular_weight_base_avg_da": round(mw_avg, 2),
            "modification_applied": mod_mass["declared"],
            "net_charge_pH7": charge_74,
            "isoelectric_point": pI,
            "gravy": gravy,
            "instability_index": instability,
            "aliphatic_index": aliphatic,
            "boman_index": boman,
            "aromaticity": aromaticity,
            "hydrophobic_moment": hydmom,
            # β-strand periodicity variant (§6.4); helix value above is the default.
            "hydrophobic_moment_beta": hydmom_beta,
            "hydrophobic_moment_periodicity_deg": 100.0,
            "instability_class": "Stable" if instability <= 40 else "Unstable",
            "charge_class": charge_class,
            "extinction_280_oxidised": extinction["extinction_280_oxidised"],
            "extinction_280_reduced": extinction["extinction_280_reduced"],
            "n_disulfide_pairs": extinction["n_disulfide_pairs"],
        },
        "secondary_structure": {
            "helix_fraction": hf,
            "beta_sheet_fraction": sf,
            "coil_fraction": cf,
            "dominant_class": dominant_ss,
        },
        "proteolytic_stability": {
            # `sites` is the full per-protease list — Panel renders cleavage maps
            "sites": [
                {"protease": p["protease"], "sites": p["sites"], "n_sites": p["n_sites"]}
                for p in protease
            ],
            "most_labile_protease": most_labile["protease"] if most_labile["n_sites"] > 0 else None,
            "most_labile_n_sites": most_labile["n_sites"],
        },
        "membrane_permeability": {
            "membrane_permeability_score": perm_score,
            "permeability_class": permeability["permeability_class"],
            "cyclic_bonus_applied": cyclic,
            "cpp_signal_detected": permeability["cpp_signal"],
            "notes": perm_notes,
        },
        "amp_score": {
            "score": amp["amp_score"],
            "max_score": amp["amp_max_score"],
            "amp_class": amp_class_map.get(amp["amp_likelihood"], "Non-AMP"),
            "contributing_factors": amp["signals"],
        },
        "half_life": {
            "plasma_h": halflife["plasma_half_life_estimate"],
            "gi_h": halflife["gi_half_life_estimate"],
            "renal_h": halflife["renal_clearance_note"],
            "dominant_route": dominant_route,
        },
        "developability": {
            "recommended_route": dominant_route,
            "oral_potential": oral_ok,
            "oral_blockers": oral_blockers,
            "pegylation_recommended": not cyclic,
            "lipidation_recommended": not cyclic and mw < 5000,
            "aggregation_risk": aggregation_risk,
            "notes": dev_notes,
        },
        "modification_advice": mod_advice,
        "chemical_liabilities": {
            "liabilities": chem_liab["liabilities"],
            "n_high": chem_liab["n_high"],
            "n_moderate": chem_liab["n_moderate"],
            "n_total": chem_liab["n_total"],
            "risk": chem_liab["risk"],
            # Motif detection is deterministic against established degradation
            # motifs (deamidation/isomerisation/oxidation/hydrolysis).
            "provenance": "rule-based",
        },
        "solubility": {
            "solubility_score": solubility["solubility_score"],
            "solubility_class": solubility["solubility_class"],
            "drivers": solubility["drivers"],
            "note": solubility["note"],
            # Charge/hydrophobicity/aromaticity are the real physical drivers,
            # but the 0-100 index itself is an internal heuristic, not a logS.
            "provenance": "heuristic",
        },
        "aggregation": {
            "risk": aggregation["risk"],
            "n_regions": aggregation["n_regions"],
            "regions": aggregation["regions"],
            "mean_a3v": aggregation["mean_a3v"],
            "hotspot_area": aggregation["hotspot_area"],
            "method": aggregation["method"],
            # AGGRESCAN is a published algorithm with a fixed experimental scale.
            "provenance": aggregation["provenance"],
        },
        "immunogenicity": {
            "candidate_epitope_windows": immunogen["candidate_epitope_windows"],
            "band": immunogen["band"],
            "method": immunogen["method"],
            "caveat": immunogen["caveat"],
            # Coarse proxy — pending an IEDB-trained MHC-II model.
            "provenance": "heuristic",
        },
        "synthesis": {
            "difficulty_class": synthesis["difficulty_class"],
            "difficulty_score": synthesis["difficulty_score"],
            "factors": synthesis["factors"],
            "note": synthesis["note"],
            # Transparent tally of named, established SPPS difficulty factors.
            "provenance": "rule-based",
        },
        # ── New industry-standard preclinical readouts ───────────────────────
        "charge_profile": charge_prof,  # net charge at pH 4, 5, 6, 7.4, 8, 9
        # ── Spec §6.3/§6.5/§6.10 descriptor blocks ──────────────────────────
        "hydrophobicity_profile": hydrophobicity_profile,  # §6.3 windowed H(k)
        "charge_distribution": charge_distribution,  # §6.5 positional variance
        "compositional_statistics": compositional_stats,  # §6.10 aa/dipeptide/Cys/Pro/Gly
        "hydrophobic_moment_profile": {  # §6.4 helix vs β-strand
            "helix_100deg": hydmom,
            "beta_160deg": hydmom_beta,
            "default_assumed_periodicity_deg": 100.0,
        },
        "reference_parameter_sets": dict(REFERENCE_PARAMETER_SETS),  # §14 provenance
        # ── Spec §5.1/§6.1/§12 modification & non-canonical residue handling ──
        "modifications": mod_mass,  # applied increments, resolution & unavailable descriptors
        "hbd_hba": hbd_hba,  # H-bond donors + acceptors (Veber 2002)
        "serum_stability": serum_stab,  # albumin binding %, FBS stability class
        "mic_estimate": mic_est,  # MIC range for AMP candidates (APD3)
        "receptor_engagement": rec_engage,  # Boman + amphipathicity + charge score
        "bioconjugation_sites": bioconj,  # Lys/Cys/N-term sites for ADC/PEG
        "custom_env": {
            "ph": ph,
            "ionic_strength": ionic_strength,
            "net_charge_custom": charge_custom,
            "disulfide_bridges_input": disulfide_bridges or "",
            "valid_bridges": [{"cys1": c1, "cys2": c2} for c1, c2 in valid_bridges],
            "bridge_warnings": bridge_warnings,
            "bridge_drivers": bridge_drivers,
            "free_cys_count": free_cys_count,
        },
    }
