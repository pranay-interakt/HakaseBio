"""Neutral-logP resolver for the Rodgers & Rowland Kp path (S2-T5 follow-up).

The Kp model (:mod:`kp`) is correct when fed an accurate *neutral* octanol:water
logP: the failure that motivated this module is purely an input-quality problem.
RDKit's Crippen logP over-estimates the neutral logP of **lipophilic fused-azole
bases** (imidazo-/triazolo-benzodiazepines) by ~1–1.5 log units, and the adipose
term ``P·fNL`` amplifies that error into a large tissue-Kp over-prediction
(midazolam ~7×, alprazolam/triazolam ~11× median tissue-Kpu over-prediction vs
the Rodgers 2006 in-vivo experimental Kpu).

Crippen is otherwise good — within ~0.3–0.8 of literature for most drugs, and
*accurate* for moderate-to-strong bases (chlorpromazine, propranolol, imipramine).
So the fix must be surgical: improve the fused-azole bases **without** perturbing
the compounds that already validate.

Why the obvious global fix fails (a documented prior attempt)
-------------------------------------------------------------
A logD-based reconstruction uses the thermodynamic identity

    logP = logD(pH) + log10 R(pH)      with   R(pH) = [total] / [neutral]

to recover the neutral logP from a measured/predicted distribution coefficient
``logD7.4`` (the ML ``Lipophilicity_AstraZeneca`` endpoint). This is exact when
the pKa is exact, but its error inherits the *full* ``log10 R`` term:

  * for a **weakly** ionised species (R≈1) the correction is tiny and robust —
    ``logD7.4`` is essentially a direct measurement of the neutral logP;
  * for a **strongly** ionised species (R large) the correction is big, ``logD``
    is a small residual, and any pKa error is amplified straight into logP.

Applying the reconstruction *globally* therefore over-corrected the strong bases
(chlorpromazine 5.19 → 6.31) and disturbed the diazepam anchor — it traded errors
rather than fixing them, and was reverted.

This resolver: a reliability-gated, one-directional cap
-------------------------------------------------------
We use the logD reconstruction only where it is trustworthy, and only to *lower*
Crippen (the documented failure is one-directional over-estimation):

  1. Default to Crippen logP.
  2. Consider a correction only for the **base** regime (:func:`kp.classify_regime`)
     — the class where Crippen's over-estimation bites and where lipids dominate
     the Kp (bases partition into tissue neutral lipid via ``P·fNL``).
  3. Require the ionisation correction to be **small** — ``log10 R(7.4) ≤``
     :data:`MAX_LOG10R_FOR_LOGD` — so the reconstruction is robust to pKa error.
     This is what separates the fused-azole *weak* bases (``log10 R`` ≈ 0.15–0.3)
     from the moderate/strong bases (``log10 R`` ≥ 1.5), which stay on Crippen.
  4. Only ever cap **downward**: use the reconstruction iff it is *below* Crippen,
     never above. Bases that Crippen already reads low are left untouched, so the
     correction can never inflate a logP the way the reverted global swap did.

Net effect on the S2-T5 gates: every Vss-gate base (chlorpromazine, pentazocine)
has ``log10 R`` ≫ threshold and is left on Crippen, so the Vss gate is unchanged;
the fused-azole bases (midazolam, alprazolam, triazolam) are corrected onto their
experimental logP (midazolam 4.32→3.20 vs exp 3.1; alprazolam 3.58→2.32 vs 2.3;
triazolam 4.23→2.75 vs 2.4) and their tissue-Kpu fold-error drops ~3–8×.

Modality file — RDKit (Crippen) and the ML ADMET logD endpoint are both allowed
here; nothing kernel-forbidden is imported.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from hakase_smallmol.pk_ivive.kp import classify_regime, total_to_neutral_ratio
from hakase_smallmol.pk_ivive.pka import PLASMA_PH, PkaResult

# The logD→logP reconstruction is trusted only when the plasma-pH ionisation
# correction log10 R(7.4) is at or below this. log10 R = 1.0 corresponds to a
# species ~91% ionised at pH 7.4; beyond it the reconstructed neutral logP is
# dominated by the (pKa-sensitive) correction term and is no longer reliable.
# Empirically this cleanly separates the fused-azole weak bases (log10 R ≤ ~0.3)
# from the moderate/strong bases (log10 R ≥ ~1.5) that Crippen already gets right.
MAX_LOG10R_FOR_LOGD = 1.0

# The ML endpoint that provides a predicted logD at pH 7.4 (AstraZeneca assay).
LOGD_ENDPOINT = "Lipophilicity_AstraZeneca"


@dataclass(frozen=True)
class LogPResolution:
    """Outcome of :func:`resolve_neutral_logp` — the value plus an audit trail."""

    logp: float  # the neutral octanol:water logP to feed the Kp model
    crippen_logp: float
    source: str  # "crippen" | "logd-capped"
    note: str
    logd_7_4: float | None = None
    log10_r_plasma: float | None = None


def resolve_neutral_logp(
    crippen_logp: float,
    pka_result: PkaResult,
    logd_7_4: float | None,
    *,
    max_log10r: float = MAX_LOG10R_FOR_LOGD,
) -> LogPResolution:
    """Resolve a neutral logP for the Kp path (reliability-gated one-directional cap).

    ``crippen_logp`` is RDKit's ``Crippen.MolLogP`` (the default). ``pka_result``
    is the pipeline's :class:`pka.PkaResult` (drives the regime and R). ``logd_7_4``
    is a predicted/measured logD at pH 7.4 (the ML ``Lipophilicity_AstraZeneca``
    endpoint) or ``None`` when unavailable — in which case Crippen is returned
    unchanged. Returns a :class:`LogPResolution` with the chosen value and why.

    Pure function: no I/O, no model calls. See the module docstring for the design.
    """
    if logd_7_4 is None:
        return LogPResolution(
            logp=crippen_logp,
            crippen_logp=crippen_logp,
            source="crippen",
            note="no logD available (ML offline) — Crippen unchanged",
        )

    regime = classify_regime(pka_result)
    if regime.kind != "base":
        return LogPResolution(
            logp=crippen_logp,
            crippen_logp=crippen_logp,
            source="crippen",
            note=f"regime is {regime.kind!r}, not base — Crippen unchanged",
            logd_7_4=logd_7_4,
        )

    r_plasma = total_to_neutral_ratio(pka_result, PLASMA_PH)
    log10_r = math.log10(r_plasma)
    if log10_r > max_log10r:
        return LogPResolution(
            logp=crippen_logp,
            crippen_logp=crippen_logp,
            source="crippen",
            note=(
                f"strongly ionised base (log10 R={log10_r:.2f} > {max_log10r:.2f}); "
                "logD reconstruction unreliable — Crippen unchanged"
            ),
            logd_7_4=logd_7_4,
            log10_r_plasma=log10_r,
        )

    reconstructed = logd_7_4 + log10_r
    if reconstructed >= crippen_logp:
        return LogPResolution(
            logp=crippen_logp,
            crippen_logp=crippen_logp,
            source="crippen",
            note=(
                f"reconstruction {reconstructed:.2f} ≥ Crippen {crippen_logp:.2f}; "
                "cap is downward-only — Crippen unchanged"
            ),
            logd_7_4=logd_7_4,
            log10_r_plasma=log10_r,
        )

    return LogPResolution(
        logp=reconstructed,
        crippen_logp=crippen_logp,
        source="logd-capped",
        note=(
            f"weak base (log10 R={log10_r:.2f} ≤ {max_log10r:.2f}); Crippen "
            f"{crippen_logp:.2f} over-estimates — capped to logD+log10R={reconstructed:.2f}"
        ),
        logd_7_4=logd_7_4,
        log10_r_plasma=log10_r,
    )


def fetch_logd_7_4(smiles: str) -> float | None:
    """Best-effort predicted logD7.4 from the Hakase ADMET ML ensemble.

    Returns ``None`` (rather than raising) whenever the ML stack is offline or the
    endpoint is absent, so the resolver degrades cleanly to Crippen. The import is
    deferred so importing this module stays cheap (matching :mod:`pka`).
    """
    try:
        try:
            from hakase_smallmol.admet.admet_ml import predict_admet_ml
        except Exception:
            from admet_ml import predict_admet_ml  # type: ignore

        res = predict_admet_ml(smiles)
        if not res.get("ml_available"):
            return None
        val = (res.get("endpoints") or {}).get(LOGD_ENDPOINT)
        return float(val) if val is not None else None
    except Exception:
        return None


def neutral_logp_for_smiles(
    smiles: str,
    pka_result: PkaResult,
    *,
    crippen_logp: float | None = None,
    logd_7_4: float | None = None,
) -> LogPResolution:
    """Convenience wrapper: resolve the neutral logP straight from a SMILES.

    Computes Crippen from ``smiles`` when not supplied, fetches logD7.4 via the ML
    ensemble when not supplied (best-effort — ``None`` if offline), then applies
    :func:`resolve_neutral_logp`.
    """
    if crippen_logp is None:
        from rdkit import Chem
        from rdkit.Chem import Crippen

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            raise ValueError(f"invalid SMILES: {smiles!r}")
        crippen_logp = float(Crippen.MolLogP(mol))
    if logd_7_4 is None:
        logd_7_4 = fetch_logd_7_4(smiles)
    return resolve_neutral_logp(crippen_logp, pka_result, logd_7_4)


__all__ = [
    "MAX_LOG10R_FOR_LOGD",
    "LOGD_ENDPOINT",
    "LogPResolution",
    "resolve_neutral_logp",
    "fetch_logd_7_4",
    "neutral_logp_for_smiles",
]
