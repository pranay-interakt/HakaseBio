"""Antibody-native developability engine — Layer 1 expansion for biologics.

Small-molecule ADMET tooling (Lipinski, ADMET-AI, ECFP fingerprints) and even
the peptide engine are meaningless for antibodies: a VH domain is ~120 residues,
a full IgG ~1 320 residues, and the questions that decide whether an antibody is
developable are not "is it drug-like" but "will it express, fold, stay monomeric,
resist chemical degradation, and avoid immunogenicity". This module computes the
antibody-specific Layer-1 readouts that actually drive those decisions:

  Sequence & architecture
    • Chain-type detection (heavy / kappa / lambda / VHH-nanobody / scFv)
    • CDR localisation — CDR-H3 / L3 anchored on conserved Cys...WGxG / FGxG
      motifs; CDR-H1/H2/L1/L2 estimated from framework anchors
    • Therapeutic-format inference (isolated Fv domain, scFv, Fab-class, full chain)

  Physicochemistry  (shared formulae with the peptide engine)
    • Molecular weight, theoretical pI, net charge at pH 7.4, GRAVY, aromaticity
    • Molar extinction coefficient (A280), disulfide pairing

  CDR liability scan  (deterministic motif search — the developability core)
    • N-linked glycosylation sequons      N-X-[S/T], X != P
    • Asn deamidation hotspots            NG > NS/NT/NH/NN
    • Asp isomerisation hotspots          DG/DS/DT/DD/DH
    • Asp-Pro acid-labile hydrolysis      DP
    • Met / Trp oxidation                 (weighted up inside CDRs)
    • Unpaired (free-thiol) cysteine      odd Cys count
    • N-terminal pyroglutamate            leading Q/E
    • Integrin RGD motif                  RGD
    Each hit is tagged CDR-H3/L3 (high), other-CDR (moderate) or framework (low).

  Developability  (Therapeutic-Antibody-Profiler-style metrics, re-implemented
                   from the published method — no academic-server dependency)
    • Total CDR length flag
    • CDR-region mean hydrophobicity flag (poly-reactivity / aggregation proxy)
    • CDR-region net-charge flag
    • Whole-molecule pI band flag (PK / clearance proxy)

  Aggregation & stability
    • Aggregation-prone regions (sliding hydrophobic-window scan)
    • Guruprasad instability index, aliphatic index, disulfide count

  Immunogenicity  (coarse screen — honestly scoped)
    • Candidate MHC-II agretope count (hydrophobic 15-mer window proxy)
    • Humanness is reported as `unavailable`: a calibrated humanness score needs a
      germline / OAS reference dataset (flagged roadmap item) — never fabricated.

All computation is pure Python + numpy — no GPU, no external API — so it runs
instantly on every Layer-1 request. No fabrication: every value is derived from
the input sequence via published, citable rules, and anything that cannot be
computed honestly is returned as null with an explicit note.

References
----------
Kabat & Wu (1991)            Sequences of Proteins of Immunological Interest
Raybould et al. (2019)       PNAS 116, 4025  (Therapeutic Antibody Profiler)
Wolf Perez et al. (2019)     mAbs 11, 1300   (developability liability motifs)
Guruprasad et al. (1990)     Protein Eng. 4, 155            (instability index)
Kyte & Doolittle (1982)      J. Mol. Biol. 157, 105         (hydrophobicity)
"""

from __future__ import annotations

import re
from typing import Any, Optional

from .peptide_properties import (
    AA_SET, KD,
    _aggrescan,
    _aliphatic_index, _aromaticity, _charge_at_ph, _extinction_coefficient,
    _gravy, _instability_index, _isoelectric_point, _molecular_weight,
)
from .antibody_numbering import number_cdrs

ENGINE = "antibody_engine_v1"

# Gly/Ser linker used to tether VH–VL in an scFv construct.
_SCFV_LINKER = re.compile(r"(?:G{2,5}S){2,}", re.I)

# Conserved framework anchors (Kabat numbering landmarks).
_FR2_HEAVY = re.compile(r"W[VIASTFG][RKQNH]Q")     # WxRQ — heavy FR2 start (~Kabat 36)
_H3_FLANK  = re.compile(r"WG[A-Z]G")                # WGxG — heavy FR4 start (~Kabat 103)
_L3_FLANK  = re.compile(r"FG[A-Z]G")               # FGxG — light FR4 start (~Kabat 98)


# ===========================================================================
# Input handling
# ===========================================================================

def _clean_chain(seq: str, label: str) -> str:
    clean = re.sub(r"[^A-Z]", "", (seq or "").upper())
    bad = sorted(set(clean) - AA_SET)
    if bad:
        raise ValueError(
            f"{label} contains non-standard amino acids: {bad}. Use the 20 "
            f"standard one-letter codes; strip any tags or non-canonical residues."
        )
    if len(clean) < 70:
        raise ValueError(
            f"{label} is only {len(clean)} residues — too short for an antibody "
            f"variable domain (a VH/VL domain is ~110-130 residues). If this is a "
            f"peptide, use the peptide engine instead."
        )
    if len(clean) > 1500:
        raise ValueError(f"{label} exceeds 1500 residues — not a single antibody chain.")
    return clean


# ===========================================================================
# Architecture detection
# ===========================================================================

def _detect_chain_type(seq: str) -> dict[str, Any]:
    """Best-effort chain-type call from sequence length and motif content."""
    n = len(seq)
    linker = _SCFV_LINKER.search(seq)
    if linker and n >= 200:
        return {
            "chain_type": "scFv",
            "confidence": "moderate",
            "note": (
                f"Gly/Ser linker ({linker.group(0)}) detected — single-chain "
                f"variable fragment (VH-linker-VL)."
            ),
        }
    if n >= 400:
        return {
            "chain_type": "full_chain",
            "confidence": "moderate",
            "note": f"{n}-residue chain — likely a full heavy or light chain (Fab/IgG class).",
        }
    if 90 <= n <= 145:
        return {
            "chain_type": "variable_domain",
            "confidence": "high",
            "note": f"{n}-residue chain — an isolated variable domain (VH, VL, or VHH/nanobody).",
        }
    return {
        "chain_type": "variable_domain",
        "confidence": "low",
        "note": f"{n}-residue chain — treated as a variable domain; confirm the construct.",
    }


def _looks_light(seq: str) -> bool:
    """Heuristic: a light chain ends its variable domain with an FGxG motif."""
    return _L3_FLANK.search(seq) is not None and _FR2_HEAVY.search(seq[:60]) is None


# ===========================================================================
# CDR localisation
# ===========================================================================

def _cdr(seq: str, start: int, end: int, name: str, confidence: str) -> dict[str, Any]:
    start = max(0, start)
    end = min(len(seq), end)
    region = seq[start:end] if end > start else ""
    return {
        "name": name,
        "sequence": region,
        "start": start + 1 if region else None,   # 1-indexed, inclusive
        "end": end if region else None,
        "length": len(region),
        "confidence": confidence if region else "not_found",
    }


def _extract_heavy_cdrs(seq: str) -> list[dict[str, Any]]:
    """CDR-H1/H2/H3. H3 is anchored on Cys...WGxG; H1/H2 are framework-estimated."""
    cdrs: list[dict[str, Any]] = []
    first_cys = seq.find("C")
    fr2 = _FR2_HEAVY.search(seq)

    # CDR-H1 — between the conserved Cys (~22) and the FR2 Trp (~36).
    if first_cys != -1 and fr2 and fr2.start() > first_cys + 8:
        cdrs.append(_cdr(seq, first_cys + 4, fr2.start(), "CDR-H1", "approximate"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-H1", "approximate"))

    # CDR-H2 — a ~17-residue window after the 14-residue FR2.
    if fr2:
        h2_start = fr2.end() + 10
        cdrs.append(_cdr(seq, h2_start, h2_start + 17, "CDR-H2", "approximate"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-H2", "approximate"))

    # CDR-H3 — anchored: last Cys before the WGxG motif.
    h3 = _H3_FLANK.search(seq)
    if h3:
        cys = seq.rfind("C", 0, h3.start())
        if cys != -1 and 0 < h3.start() - cys <= 35:
            cdrs.append(_cdr(seq, cys + 1, h3.start(), "CDR-H3", "anchored"))
        else:
            cdrs.append(_cdr(seq, 0, 0, "CDR-H3", "anchored"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-H3", "anchored"))
    return cdrs


def _extract_light_cdrs(seq: str) -> list[dict[str, Any]]:
    """CDR-L1/L2/L3. L3 is anchored on Cys...FGxG; L1/L2 are framework-estimated."""
    cdrs: list[dict[str, Any]] = []
    first_cys = seq.find("C")

    # CDR-L1 — Kabat ~24-34, after the conserved Cys (~23).
    if first_cys != -1:
        cdrs.append(_cdr(seq, first_cys + 2, first_cys + 14, "CDR-L1", "approximate"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-L1", "approximate"))

    # CDR-L2 — Kabat ~50-56, a short window ~15 residues after CDR-L1.
    if first_cys != -1:
        l2_start = first_cys + 14 + 15
        cdrs.append(_cdr(seq, l2_start, l2_start + 7, "CDR-L2", "approximate"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-L2", "approximate"))

    # CDR-L3 — anchored: last Cys before the FGxG motif.
    l3 = _L3_FLANK.search(seq)
    if l3:
        cys = seq.rfind("C", 0, l3.start())
        if cys != -1 and 0 < l3.start() - cys <= 20:
            cdrs.append(_cdr(seq, cys + 1, l3.start(), "CDR-L3", "anchored"))
        else:
            cdrs.append(_cdr(seq, 0, 0, "CDR-L3", "anchored"))
    else:
        cdrs.append(_cdr(seq, 0, 0, "CDR-L3", "anchored"))
    return cdrs


def _in_any_cdr(pos: int, cdrs: list[dict[str, Any]]) -> Optional[str]:
    """Return the CDR name containing 1-indexed position `pos`, else None."""
    for c in cdrs:
        if c["start"] and c["end"] and c["start"] <= pos <= c["end"]:
            return c["name"]
    return None


# ===========================================================================
# Liability scan
# ===========================================================================

_LIABILITY_RULES: list[tuple[str, str, str, str]] = [
    # (type, regex, base_severity, note)
    ("N-glycosylation sequon", r"N[^P][ST]", "moderate",
     "N-X-[S/T] sequon — risk of N-linked glycosylation causing heterogeneity; critical if in a CDR."),
    ("Asn deamidation (high)", r"N[GN]", "moderate",
     "NG/NN motif — high Asn deamidation rate; introduces charge variants on storage."),
    ("Asn deamidation", r"N[STH]", "low",
     "NS/NT/NH motif — moderate Asn deamidation susceptibility."),
    ("Asp isomerisation", r"D[GSTDH]", "moderate",
     "DG/DS/DT/DD/DH motif — Asp isomerisation to iso-Asp; backbone kink, potency loss in CDRs."),
    ("Asp-Pro hydrolysis", r"DP", "low",
     "DP motif — acid-labile peptide bond; fragmentation risk at low pH."),
    ("Integrin RGD motif", r"RGD", "moderate",
     "RGD motif — potential integrin binding / off-target adhesion."),
]


def _scan_liabilities(seq: str, cdrs: list[dict[str, Any]], chain_label: str) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    high_cdrs = {"CDR-H3", "CDR-L3"}

    for ltype, pattern, base_sev, note in _LIABILITY_RULES:
        for m in re.finditer(pattern, seq):
            pos = m.start() + 1
            cdr = _in_any_cdr(pos, cdrs)
            if cdr in high_cdrs:
                severity, loc = "high", cdr
            elif cdr:
                severity, loc = ("high" if base_sev == "moderate" else "moderate"), cdr
            else:
                severity, loc = ("moderate" if base_sev == "moderate" else "low"), "framework"
            hits.append({
                "type": ltype, "chain": chain_label, "motif": m.group(0),
                "position": pos, "location": loc, "severity": severity, "note": note,
            })

    # Met / Trp oxidation — residue-level, weighted up inside CDRs.
    for i, aa in enumerate(seq):
        if aa in ("M", "W"):
            pos = i + 1
            cdr = _in_any_cdr(pos, cdrs)
            sev = "high" if cdr in {"CDR-H3", "CDR-L3"} else "moderate" if cdr else "low"
            if cdr or aa == "W":
                hits.append({
                    "type": f"{'Met' if aa == 'M' else 'Trp'} oxidation",
                    "chain": chain_label, "motif": aa, "position": pos,
                    "location": cdr or "framework", "severity": sev,
                    "note": ("Oxidation-prone residue — surface-exposed Met/Trp oxidise on "
                             "storage; critical in CDRs where it affects binding."),
                })

    # N-terminal pyroglutamate.
    if seq[:1] in ("Q", "E"):
        hits.append({
            "type": "N-terminal pyroglutamate", "chain": chain_label, "motif": seq[0],
            "position": 1, "location": "framework", "severity": "low",
            "note": "Leading Gln/Glu cyclises to pyroglutamate — a known, usually benign charge variant.",
        })

    # Unpaired cysteine (free thiol).
    n_cys = seq.count("C")
    if n_cys % 2 == 1:
        hits.append({
            "type": "Unpaired cysteine", "chain": chain_label, "motif": "C",
            "position": seq.rfind("C") + 1, "location": "chain-level", "severity": "high",
            "note": (f"Odd cysteine count ({n_cys}) — a free thiol drives covalent "
                     f"aggregation and disulfide scrambling. Verify the pairing."),
        })
    return hits


# ===========================================================================
# Developability (Therapeutic-Antibody-Profiler-style)
# ===========================================================================

def _developability(cdrs: list[dict[str, Any]], whole_pi: float) -> dict[str, Any]:
    cdr_seq = "".join(c["sequence"] for c in cdrs)
    total_cdr_len = len(cdr_seq)
    flags: list[dict[str, str]] = []

    def flag(metric: str, value: str, level: str, note: str) -> None:
        flags.append({"metric": metric, "value": value, "level": level, "note": note})

    # Total CDR length — TAP flags unusually long combined CDRs.
    if total_cdr_len == 0:
        flag("Total CDR length", "n/a", "amber",
             "CDRs could not be localised — provide both chains or verify the sequence.")
    elif total_cdr_len > 75:
        flag("Total CDR length", str(total_cdr_len), "red",
             "Combined CDR length is long — elevated aggregation / poly-reactivity risk.")
    elif total_cdr_len > 62:
        flag("Total CDR length", str(total_cdr_len), "amber",
             "Combined CDR length is above the typical band — monitor aggregation.")
    else:
        flag("Total CDR length", str(total_cdr_len), "green", "Within the typical range.")

    # CDR mean hydrophobicity — poly-reactivity / aggregation proxy.
    if cdr_seq:
        cdr_gravy = sum(KD.get(a, 0.0) for a in cdr_seq) / len(cdr_seq)
        if cdr_gravy > 0.30:
            flag("CDR hydrophobicity (GRAVY)", f"{cdr_gravy:.2f}", "red",
                 "Hydrophobic CDRs — raised aggregation and non-specific-binding risk.")
        elif cdr_gravy > 0.0:
            flag("CDR hydrophobicity (GRAVY)", f"{cdr_gravy:.2f}", "amber",
                 "Mildly hydrophobic CDRs — acceptable but worth a poly-reactivity check.")
        else:
            flag("CDR hydrophobicity (GRAVY)", f"{cdr_gravy:.2f}", "green", "Hydrophilic CDRs.")

        # CDR net charge.
        cdr_charge = _charge_at_ph(cdr_seq, 7.4)
        if abs(cdr_charge) > 4.0:
            flag("CDR net charge (pH 7.4)", f"{cdr_charge:+.1f}", "red",
                 "Strongly charged CDRs — poly-specificity and PK risk.")
        elif abs(cdr_charge) > 2.0:
            flag("CDR net charge (pH 7.4)", f"{cdr_charge:+.1f}", "amber",
                 "Moderately charged CDRs — monitor non-specific binding.")
        else:
            flag("CDR net charge (pH 7.4)", f"{cdr_charge:+.1f}", "green", "Balanced CDR charge.")

    # Whole-molecule pI band — PK / clearance proxy.
    if whole_pi < 6.0 or whole_pi > 9.0:
        flag("Isoelectric point", f"{whole_pi:.1f}", "amber",
             "pI outside the 6-9 band — can shift clearance and formulation behaviour.")
    else:
        flag("Isoelectric point", f"{whole_pi:.1f}", "green", "pI within the favourable band.")

    levels = [f["level"] for f in flags]
    tier = "Red — developability concerns" if "red" in levels else \
           "Amber — review flagged metrics" if "amber" in levels else \
           "Green — no developability flags"
    return {"tier": tier, "total_cdr_length": total_cdr_len, "flags": flags}


# ===========================================================================
# Aggregation & immunogenicity
# ===========================================================================

def _aggregation_prone_regions(seq: str, cdrs: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregation-prone regions via the AGGRESCAN algorithm, CDR-aware.

    Uses the shared `_aggrescan` implementation (published a3v scale,
    Conchillo-Solé et al. 2007). For a FOLDED domain a raw sequence scan
    over-reports, because the buried hydrophobic β-sandwich core is hydrophobic
    by design and is not a developability liability. So the developability
    `risk` is keyed ONLY to hot spots that overlap a CDR — CDRs are
    solvent-exposed, so a hydrophobic patch there is a genuine aggregation /
    poly-reactivity liability, whereas a framework hot spot is the expected
    buried core.
    """
    agg = _aggrescan(seq)
    # Reliable CDRs: every CDR when ANARCI/IMGT numbering was used; otherwise
    # only the motif-anchored CDR-H3/L3 (CDR-H1/H2/L1/L2 are too loosely bounded
    # by the heuristic to gate a verdict on).
    anchored = {
        c["name"] for c in cdrs
        if c.get("confidence") in ("anchored", "imgt_anarci")
    }
    cdr_hotspots = 0
    anchored_hotspots = 0
    for r in agg["regions"]:
        loc = "framework"
        for c in cdrs:
            if c["start"] and c["end"] and not (r["end"] < c["start"] or r["start"] > c["end"]):
                loc = c["name"]
                break
        r["location"] = loc
        if loc != "framework":
            cdr_hotspots += 1
            if loc in anchored:
                anchored_hotspots += 1
    # No graded developability verdict is emitted from L1 sequence. Testing
    # confirmed that a sequence-only scan cannot cleanly separate an exposed
    # CDR patch from the adjacent buried framework β-strands — every attempt to
    # grade it either over-flags well-behaved approved antibodies or requires
    # curve-fitting the threshold. The hot-spot DATA below is real (AGGRESCAN);
    # the *graded* aggregation risk is a Layer-2 structure-based output.
    agg["risk"] = "ungraded"
    agg["cdr_hotspots"] = cdr_hotspots
    agg["anchored_cdr_hotspots"] = anchored_hotspots
    agg["note"] = (
        "Hot spots are real (AGGRESCAN). A graded aggregation risk is NOT emitted "
        "at Layer 1: a sequence-only scan cannot separate an exposed CDR patch "
        "from the buried framework core. The developability-grade verdict is the "
        "structure-based surface scan on the Layer-2 co-folded Fv. Hot spots "
        "overlapping an anchored CDR-H3/L3 are the most informative early signal."
    )
    return agg


def _immunogenicity_screen(seq: str) -> dict[str, Any]:
    """Coarse T-cell-epitope screen: hydrophobic 15-mer windows are candidate
    MHC-II agretopes. This is a directional flag, NOT a calibrated score."""
    window = 15
    hot = 0
    if len(seq) >= window:
        for i in range(len(seq) - window + 1):
            seg = seq[i:i + window]
            if sum(KD.get(a, 0.0) for a in seg) / window > 1.5:
                hot += 1
    band = "Elevated" if hot >= 6 else "Moderate" if hot >= 2 else "Low"
    return {
        "candidate_agretope_windows": hot,
        "band": band,
        "method": "Hydrophobic 15-mer window proxy for MHC-II agretopes.",
        "humanness": None,
        "caveat": (
            "Coarse directional screen only. A calibrated immunogenicity / humanness "
            "score requires an MHC-II model trained on IEDB epitope data and a "
            "germline (OAS/OGRDB) humanness reference — flagged roadmap items. "
            "Humanness is reported as unavailable rather than fabricated."
        ),
    }


# ===========================================================================
# Per-chain analysis
# ===========================================================================

def _analyse_chain(seq: str, label: str, is_light: bool) -> dict[str, Any]:
    # Real IMGT numbering via ANARCI when available; otherwise the
    # motif-anchored heuristic. `number_cdrs` self-verifies and returns None
    # on any failure, so this is a strict, safe upgrade with no regression.
    cdrs = number_cdrs(seq, is_light) or (
        _extract_light_cdrs(seq) if is_light else _extract_heavy_cdrs(seq)
    )
    ext = _extinction_coefficient(seq)
    pi = _isoelectric_point(seq)
    instability = round(_instability_index(seq), 2)
    return {
        "label": label,
        "length": len(seq),
        "architecture": _detect_chain_type(seq),
        "physicochemical": {
            "molecular_weight_da": round(_molecular_weight(seq), 1),
            "isoelectric_point": pi,
            "net_charge_pH7": round(_charge_at_ph(seq, 7.4), 2),
            "gravy": round(_gravy(seq), 3),
            "aromaticity": round(_aromaticity(seq), 3),
            "aliphatic_index": round(_aliphatic_index(seq), 1),
            "instability_index": instability,
            "instability_class": "Stable" if instability <= 40 else "Unstable",
            "extinction_280_oxidised": ext["extinction_280_oxidised"],
            "n_disulfide_pairs": ext["n_disulfide_pairs"],
            "cysteine_count": seq.count("C"),
        },
        "cdrs": cdrs,
        "liabilities": _scan_liabilities(seq, cdrs, label),
        "developability": _developability(cdrs, pi),
        "aggregation": _aggregation_prone_regions(seq, cdrs),
        "immunogenicity": _immunogenicity_screen(seq),
    }


# ===========================================================================
# Conformational stability  (honest sequence-level assessment)
# ===========================================================================

def _stability_assessment(chains: list[dict[str, Any]]) -> dict[str, Any]:
    """Sequence-level conformational-stability assessment.

    IMPORTANT — honesty contract: a numeric melting temperature (Tm) CANNOT be
    predicted from sequence alone with drug-discovery-grade reliability. This
    function therefore does NOT return a fabricated Tm (`tm_numeric_c` is null).

    It returns a qualitative outlook built ONLY from signals that are genuinely
    computable from sequence:
      • Guruprasad instability index — a published, validated in-vitro
        instability indicator (Guruprasad et al. 1990).
      • Disulfide bookkeeping — each Ig variable domain carries one canonical
        intra-domain disulfide; an even, ≥2 cysteine count is consistent with it,
        an odd count means a destabilising free thiol.

    A numeric Tm must come from a wet-lab measurement (DSF / nanoDSF / DSC) or a
    structure-based free-energy calculation on the co-folded Fv (Layer 2). The
    UI surfaces this as `tm_numeric_c: null` with `assay_required` set.
    """
    signals: list[dict[str, Any]] = []
    concern = 0
    watch = 0
    for c in chains:
        pc = c["physicochemical"]

        # Guruprasad instability index — real, validated.
        if pc["instability_class"] == "Unstable":
            concern += 1
            signals.append({
                "chain": c["label"], "signal": "Guruprasad instability index > 40",
                "value": str(pc["instability_index"]), "level": "concern",
                "detail": "Sequence flagged unstable in vitro by the Guruprasad index.",
            })
        else:
            signals.append({
                "chain": c["label"], "signal": "Guruprasad instability index ≤ 40",
                "value": str(pc["instability_index"]), "level": "ok",
                "detail": "Sequence is within the in-vitro-stable band on the Guruprasad index.",
            })

        # Disulfide bookkeeping — real, deterministic.
        if pc["cysteine_count"] % 2 == 1:
            concern += 1
            signals.append({
                "chain": c["label"], "signal": "Unpaired cysteine (free thiol)",
                "value": f"{pc['cysteine_count']} Cys", "level": "concern",
                "detail": "Odd cysteine count — a free thiol is a real destabiliser and aggregation driver.",
            })
        elif pc["n_disulfide_pairs"] >= 1:
            signals.append({
                "chain": c["label"], "signal": "Canonical disulfide present",
                "value": f"{pc['n_disulfide_pairs']} pair(s)", "level": "ok",
                "detail": "Even cysteine count consistent with the canonical intra-domain disulfide.",
            })
        else:
            watch += 1
            signals.append({
                "chain": c["label"], "signal": "No cysteine pair detected",
                "value": "0 pairs", "level": "watch",
                "detail": "An Ig variable domain normally carries one conserved disulfide — verify the construct.",
            })

    outlook = "Concern" if concern >= 2 else "Monitor" if (concern == 1 or watch >= 1) else "Favourable"
    return {
        "tm_numeric_c": None,                  # never fabricated — see docstring
        "assay_required": "DSF / nanoDSF / DSC for a measured Tm; or a structure-based ΔG on the Layer-2 co-folded Fv.",
        "outlook": outlook,
        "signals": signals,
        "provenance": "rule-based",
        "method": "Sequence-level stability signals (Guruprasad instability index + disulfide bookkeeping). No Tm is predicted from sequence.",
        "caveat": (
            "A numeric melting temperature is NOT reported because it cannot be predicted "
            "from sequence alone with drug-discovery-grade reliability. This is a qualitative "
            "triage from genuinely-computable signals only."
        ),
    }


# ===========================================================================
# Manufacturability  (expression / titer triage)
# ===========================================================================

def _manufacturability(
    chains: list[dict[str, Any]], all_liabilities: list[dict[str, Any]]
) -> dict[str, Any]:
    """Expression / manufacturability triage from sequence liabilities.

    Flags the features that depress transient-expression titer or complicate
    purification: framework instability, free thiols, aggregation-prone
    regions, extreme pI and glycan heterogeneity.
    """
    score = 0
    factors: list[str] = []
    for c in chains:
        pc = c["physicochemical"]
        if pc["instability_class"] == "Unstable":
            score += 2
            factors.append(f"{c['label']} chain is unstable (instability index {pc['instability_index']}).")
        if pc["cysteine_count"] % 2 == 1:
            score += 2
            factors.append(f"{c['label']} chain has a free thiol — covalent aggregation in culture.")
        anc_hs = c["aggregation"].get("anchored_cdr_hotspots", 0)
        if anc_hs >= 2:
            score += 2
            factors.append(f"{c['label']} chain has {anc_hs} aggregation hot spots in an anchored CDR (H3/L3).")
        elif anc_hs == 1:
            score += 1
            factors.append(f"{c['label']} chain has 1 aggregation hot spot in an anchored CDR (H3/L3).")
        pi = pc["isoelectric_point"]
        if pi < 6.0 or pi > 9.0:
            score += 1
            factors.append(f"{c['label']} chain pI {pi} is outside 6-9 — harder formulation / purification.")
    n_glyco = sum(1 for lia in all_liabilities if lia["type"] == "N-glycosylation sequon")
    if n_glyco:
        score += 1
        factors.append(f"{n_glyco} N-glycosylation sequon(s) — glycan heterogeneity across the batch.")
    outlook = (
        "Favourable — routine expression expected" if score <= 1 else
        "Moderate — monitor titer and monomer %" if score <= 4 else
        "Challenging — engineering likely needed"
    )
    if not factors:
        factors.append("No notable expression / manufacturability risk features detected.")
    return {
        "expression_outlook": outlook,
        "risk_score": score,
        "factors": factors,
        "provenance": "rule-based",
        "note": (
            "Transparent tally of named sequence-liability risk factors — not a tuned "
            "score. Confirm with a transient-expression titer and a SEC-HPLC monomer "
            "check; real titer also depends on host cell line, vector and process."
        ),
    }


# ===========================================================================
# Public entry point
# ===========================================================================

def predict_antibody_properties(
    heavy_chain: str,
    light_chain: Optional[str] = None,
    format_hint: Optional[str] = None,
) -> dict[str, Any]:
    """Layer-1 antibody developability profile.

    Parameters
    ----------
    heavy_chain : str
        Heavy-chain (or VHH / single-domain, or scFv) amino-acid sequence.
    light_chain : str, optional
        Light-chain sequence. Omit for a nanobody / VHH / single-domain construct.
    format_hint : str, optional
        Optional user-supplied format label, surfaced back for traceability.

    Returns
    -------
    dict  — structured developability profile; honest nulls where a value
            cannot be derived without reference data.
    """
    heavy = _clean_chain(heavy_chain, "Heavy chain")
    light = _clean_chain(light_chain, "Light chain") if light_chain else None

    chains = [_analyse_chain(heavy, "Heavy / VHH", is_light=False)]
    if light:
        chains.append(_analyse_chain(light, "Light", is_light=True))

    # Roll liabilities and the worst developability tier up to the molecule level.
    all_liabilities = [lia for c in chains for lia in c["liabilities"]]
    n_high = sum(1 for lia in all_liabilities if lia["severity"] == "high")
    n_mod = sum(1 for lia in all_liabilities if lia["severity"] == "moderate")

    tier_rank = {"Red": 2, "Amber": 1, "Green": 0}
    worst = max(chains, key=lambda c: tier_rank.get(c["developability"]["tier"].split(" ")[0], 0))
    # Aggregation is reported as hot-spot DATA at L1; the graded risk is an L2
    # (structure-based) output — so the summary states the hot-spot count, not
    # a verdict, to stay honest.
    total_anchored_hs = sum(c["aggregation"].get("anchored_cdr_hotspots", 0) for c in chains)
    aggregation_summary = f"{total_anchored_hs} CDR-H3/L3 hot spot(s) — graded in L2"

    if n_high > 0 or worst["developability"]["tier"].startswith("Red"):
        verdict = "WATCH — high-severity liabilities or developability flags present"
    elif n_mod > 2 or worst["developability"]["tier"].startswith("Amber"):
        verdict = "REVIEW — moderate liabilities; engineering review recommended"
    else:
        verdict = "PASS — no high-severity developability liabilities detected"

    is_nanobody = light is None and chains[0]["architecture"]["chain_type"] == "variable_domain"

    # Numbering provenance — exact (ANARCI/IMGT) vs motif-anchored heuristic.
    used_anarci = any(
        c.get("confidence") == "imgt_anarci"
        for chain in chains for c in chain["cdrs"]
    )
    numbering_method = (
        "ANARCI · IMGT scheme — exact CDR numbering"
        if used_anarci else
        "Motif-anchored heuristic — CDR-H3/L3 anchored; CDR-H1/H2/L1/L2 approximate"
    )

    # ── Expanded Layer-1 readouts ────────────────────────────────────────────
    stability         = _stability_assessment(chains)
    manufacturability = _manufacturability(chains, all_liabilities)

    # Developability flag tally — TRANSPARENT, not a weighted/tuned score.
    # We simply count the red/amber/green TAP-style flags that the per-chain
    # `_developability` analysis already produced. No invented 0-100 number,
    # no tuned weights: the tally is exactly what was flagged, nothing more.
    dev_flags = [f for c in chains for f in c["developability"]["flags"]]
    developability_flags = {
        "red":   sum(1 for f in dev_flags if f["level"] == "red"),
        "amber": sum(1 for f in dev_flags if f["level"] == "amber"),
        "green": sum(1 for f in dev_flags if f["level"] == "green"),
    }

    return {
        "engine": ENGINE,
        "modality": "antibody",
        "format_hint": format_hint or None,
        "inferred_format": (
            "VHH / single-domain antibody (nanobody)" if is_nanobody
            else "scFv" if chains[0]["architecture"]["chain_type"] == "scFv"
            else "Paired Fv / Fab-class (heavy + light)" if light
            else "Single chain provided — supply the light chain for a paired analysis"
        ),
        "chains": chains,
        "numbering_method": numbering_method,
        "stability": stability,
        "manufacturability": manufacturability,
        "summary": {
            "verdict": verdict,
            "developability_tier": worst["developability"]["tier"],
            "developability_flags": developability_flags,
            "aggregation_risk": aggregation_summary,
            "stability_outlook": stability["outlook"],
            "expression_outlook": manufacturability["expression_outlook"],
            "n_liabilities_high": n_high,
            "n_liabilities_moderate": n_mod,
            "n_liabilities_total": len(all_liabilities),
        },
        "limitations": (
            (
                "CDRs are numbered with ANARCI on the IMGT scheme — exact boundaries. "
                if used_anarci else
                "CDR-H3/L3 are anchored on conserved motifs (reliable); CDR-H1/H2/L1/L2 "
                "boundaries are framework-estimated and approximate — install ANARCI for "
                "exact IMGT numbering. "
            )
            + "Immunogenicity is a coarse screen and humanness is not scored without a "
            "germline reference dataset. This is a triage-grade Layer-1 developability "
            "profile, not a substitute for wet-lab developability assays."
        ),
    }
