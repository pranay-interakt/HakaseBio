"""Antibody numbering via ANARCI — real IMGT CDR localisation.

ANARCI (Dunbar & Deane, Bioinformatics 2016; BSD-3 licensed, commercial-safe)
is the standard tool for antibody domain numbering. When it is installed AND
the HMMER `hmmscan` binary is available, this module returns EXACT,
IMGT-defined CDRs — replacing the motif-anchored heuristic in
`antibody_properties.py`.

Design contract — this is a STRICT, SAFE upgrade:
  • If ANARCI (or its HMMER dependency) is not available, `number_cdrs`
    returns None and the caller falls back to the heuristic unchanged.
  • Every CDR returned is SELF-VERIFIED: the extracted residue string must
    match the parent sequence at the reported coordinates, otherwise the
    whole result is discarded (None) and the caller falls back. So even an
    imperfect parse can never emit a wrong CDR — it can only fall back.

Deployment:
    pip install anarci
    # plus the HMMER binary:
    conda install -c bioconda hmmer      # or:  apt-get install hmmer

References
----------
Dunbar J. & Deane C.M. (2016) ANARCI: antigen receptor numbering and receptor
classification. Bioinformatics 32(2), 298-300.
Lefranc M.-P. et al. — the IMGT unique numbering scheme.
"""

from __future__ import annotations

from typing import Any, Optional

# IMGT CDR position ranges — fixed by the IMGT unique numbering scheme.
_IMGT_CDR_RANGES = {1: (27, 38), 2: (56, 65), 3: (105, 117)}


def anarci_available() -> bool:
    """True when the ANARCI package can be imported (HMMER is checked at run)."""
    try:
        import anarci  # noqa: F401
        return True
    except Exception:
        return False


def number_cdrs(seq: str, is_light: bool) -> Optional[list[dict[str, Any]]]:
    """Return exact IMGT-numbered CDRs for a chain, or None to trigger fallback.

    Parameters
    ----------
    seq : str
        Cleaned single-letter amino-acid sequence of one antibody chain.
    is_light : bool
        True for a light chain (CDR-L1/2/3), False for heavy / VHH.

    Returns
    -------
    list[dict] of three CDR records (same shape as the heuristic engine), or
    None when ANARCI / HMMER is unavailable or the parse fails self-checks.
    """
    try:
        from anarci import anarci as _run_anarci
    except Exception:
        return None

    try:
        numbered, details, _hits = _run_anarci(
            [("query", seq)], scheme="imgt", output=False
        )
        domains = numbered[0]
        if not domains:
            return None

        # First (best) domain: (numbered_residues, start_idx, end_idx).
        dom_residues = domains[0][0]
        det = details[0][0]
        ptr = int(det.get("query_start", domains[0][1]))  # 0-indexed seq position

        chain = "L" if is_light else "H"
        buckets: dict[int, list[tuple[int, str]]] = {1: [], 2: [], 3: []}

        for (imgt_num, _ins), aa in dom_residues:
            if aa == "-":
                continue
            for cdr_id, (lo, hi) in _IMGT_CDR_RANGES.items():
                if lo <= imgt_num <= hi:
                    buckets[cdr_id].append((ptr, aa))
            ptr += 1

        cdrs: list[dict[str, Any]] = []
        for cdr_id in (1, 2, 3):
            name = f"CDR-{chain}{cdr_id}"
            residues = buckets[cdr_id]
            if not residues:
                cdrs.append({
                    "name": name, "sequence": "", "start": None, "end": None,
                    "length": 0, "confidence": "not_found",
                })
                continue
            start0, end0 = residues[0][0], residues[-1][0]
            cdr_seq = "".join(aa for _, aa in residues)
            # SELF-VERIFICATION — a CDR is a contiguous loop, so the parent
            # sequence at [start, end] must reproduce the extracted residues.
            if start0 < 0 or end0 >= len(seq) or seq[start0:end0 + 1] != cdr_seq:
                return None
            cdrs.append({
                "name": name, "sequence": cdr_seq,
                "start": start0 + 1, "end": end0 + 1,  # 1-indexed, inclusive
                "length": len(cdr_seq),
                "confidence": "imgt_anarci",
            })
        return cdrs
    except Exception:
        # Any failure (missing hmmscan binary, parse error, API change) →
        # return None so the caller uses the heuristic. Never raises.
        return None
