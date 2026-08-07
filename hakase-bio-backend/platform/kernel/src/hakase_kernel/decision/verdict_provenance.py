"""Provenance registry for every constant, threshold, and score in the safety verdict.

WHY THIS EXISTS (implementation, not documentation)
────────────────────────────────────────────────────
The mandate: no arbitrary constant or unexplained heuristic may remain in the reasoning
pipeline; every threshold must come from published literature, be learned from data, or be
experimentally justified. This module makes that *enforceable* rather than aspirational:
every number the verdict depends on is registered here with

  • a mathematical definition,
  • a source_type ∈ {literature, learned_from_data, experimental, structural, heuristic},
  • a citation or derivation,
  • a status ∈ {keep, justified, improve, replace, remove},
  • the honest limitation.

`audit()` fails if any registered item lacks a definition/source/citation, and lists every
remaining heuristic. The verdict layer looks up provenance here so the API (and the UI) can
show, for any number it displays, exactly where that number came from. A grep for a magic
constant in the pipeline should always resolve to an entry here.

This is a *catalogue of the real pipeline as audited*, not an aspiration. Where a component
is only a heuristic, it says so — it does not pretend otherwise.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

__all__ = ["Provenance", "REGISTRY", "get", "audit", "heuristics", "as_table"]


@dataclass(frozen=True)
class Provenance:
    key: str
    value: Any  # numeric value, or "learned_per_endpoint" / "per_query"
    definition: str  # the mathematics
    source_type: str  # literature | learned_from_data | experimental | structural | heuristic
    citation: str  # paper / derivation / dataset
    status: str  # keep | justified | improve | replace | remove
    limitation: str

    def as_dict(self) -> dict:
        return asdict(self)


_ITEMS = [
    # ── Conformal veto gate (the hard-ALERT trigger) ──────────────────────────────────
    Provenance(
        key="veto_alpha",
        value=0.05,
        definition="Veto threshold t = (1-α) split-conformal quantile of held-out APPROVED-drug "
        "liability scores ⇒ P(veto | approved) ≤ α. Fires iff served prob > t (strict).",
        source_type="literature",
        citation="Vovk et al. 2005 (conformal); Lei et al. 2018 JASA; α=0.05 is the conventional "
        "false-positive rate. Threshold itself is LEARNED per endpoint from approved drugs.",
        status="keep",
        limitation="Marginal coverage; assumes exchangeability of approved-drug calibration set with "
        "queries. High specificity ⇒ low recall (~2-7%); a clear veto is not a full tox screen.",
    ),
    # ── Sensitivity screen (WATCH escalation) ─────────────────────────────────────────
    Provenance(
        key="screen_threshold",
        value="learned_per_endpoint",
        definition="Youden-J optimal operating point J = max(TPR - FPR) on the real ChEMBL "
        "approved/withdrawn hold-out; or an FPR-target quantile.",
        source_type="learned_from_data",
        citation="Youden 1950 (Cancer 3:32); fitted in models/live_calibration.py on approved/withdrawn.",
        status="keep",
        limitation="Higher recall, higher FPR than the veto by construction; escalates to MONITOR, "
        "never a unilateral NO-GO. Depends on the approved/withdrawn label quality.",
    ),
    # ── Applicability domain cutoff ───────────────────────────────────────────────────
    Provenance(
        key="AD_THRESHOLD",
        value=0.4,
        definition="in_domain := (max Tanimoto to any training molecule ≥ 0.4) over Morgan-1024 bits.",
        source_type="heuristic",
        citation="0.4 is a commonly-cited Tanimoto cutoff but is NOT derived from this model's own "
        "training-similarity distribution. Literature prescribes a data-derived cutoff: "
        "Sahigara et al. 2012 (Molecules 17:4791); Klingspohn et al. 2017 (J Cheminform).",
        status="replace",
        limitation="A single global constant ignores that different training sets have different "
        "internal density. models/ad_threshold.py derives a per-endpoint cutoff from the "
        "training kNN-similarity distribution; the reasoning layer uses that and reports both.",
    ),
    # ── Tox21 family-wise error control ───────────────────────────────────────────────
    Provenance(
        key="TOX21_FWER_MIN_FLAGS",
        value=2,
        definition="Escalate on the 12-assay Tox21 panel only when ≥2 in-domain conformal vetoes fire.",
        source_type="experimental",
        citation="Family-wise error control: 12 independent α=0.05 vetoes ⇒ E[false flags]≈0.6, "
        "P(≥1)≈30-46%; requiring ≥2 brings family-wise false-escalation ≈5% (matches per-test α). "
        "Derived in safety_triage.py; cf. Bonferroni/FWER (Dunn 1961).",
        status="justified",
        limitation="Assumes approximate independence across assays; shared chemistry induces some "
        "positive dependence, making this mildly conservative (acceptable for a safety gate).",
    ),
    # ── DILI mechanism fusion corroboration ───────────────────────────────────────────
    Provenance(
        key="QSAR_CORROBORATES",
        value=0.50,
        definition="An in-domain QSAR DILI probability ≥ 0.50 corroborates a reactive-metabolite alert.",
        source_type="structural",
        citation="0.50 is the decision boundary of a CALIBRATED probability: P(active) ≥ 0.5 means "
        "'more likely active than not'. Not arbitrary once the probability is isotonic-calibrated.",
        status="justified",
        limitation="Only meaningful because the DILI head is calibrated (isotonic) and AD-gated; on an "
        "uncalibrated score 0.5 would be arbitrary.",
    ),
    # ── Probability calibration ───────────────────────────────────────────────────────
    Provenance(
        key="calibration_method",
        value="isotonic",
        definition="Post-hoc monotone map from raw model score to probability, fit on held-out data; "
        "quality stored per bundle as ece_test / brier_test (raw vs calibrated).",
        source_type="literature",
        citation="Zadrozny & Elkan 2002 (isotonic); Guo et al. 2017 (calibration); Niculescu-Mizil & "
        "Caruana 2005. Measured with ECE (Naeini 2015).",
        status="keep",
        limitation="Calibration is marginal and in-distribution; degrades under covariate shift "
        "(guarded by the shift block). ECE is a biased, binning-dependent estimator (Kumar 2019).",
    ),
    # ── Ensemble-dispersion 'confidence' (invitro panel) — the audited heuristic ───────
    Provenance(
        key="classifier_confidence_0.35",
        value=0.35,
        definition="conf = clip(1 - ensemble_std/0.35, 0, 1); reliability band from conf.",
        source_type="heuristic",
        citation="Hand-picked constant. Audited on real Ames/Tox21 (reasoning-engine RESULTS.md): "
        "ECE 0.39-0.61 — does NOT track P(correct).",
        status="replace",
        limitation="Ensemble dispersion is a real signal, but the map to a shown 'confidence' is "
        "uncalibrated. Replace with reasoning.reliability.CalibratedReliability fit on held-out "
        "correctness, or report 'not estimable'. Applies to invitro_panel only, NOT the core "
        "safety classifiers (which use calibrated probabilities + conformal gates).",
    ),
    Provenance(
        key="regressor_confidence_0.5",
        value=0.5,
        definition="conf = clip(1 - (std/|mean|)/0.5, 0, 1) for regression endpoints.",
        source_type="heuristic",
        citation="Hand-picked relative-spread constant; no coverage guarantee.",
        status="replace",
        limitation="Prefer a conformal prediction interval with a coverage guarantee "
        "(models/conformal.py ConformalRegressor); report reliability as 'not estimable' absent "
        "a calibration set.",
    ),
    # ── Reliability band cutpoints (reasoning layer) ──────────────────────────────────
    Provenance(
        key="reliability_bands",
        value="High≥0.85, Medium≥0.6, Low<0.6",
        definition="Bands over a CALIBRATED probability-of-correctness (so the cutpoints denote actual "
        "chance-of-correct), not over a heuristic score.",
        source_type="structural",
        citation="Cutpoints are presentational; their meaning is anchored because the underlying number "
        "is a calibrated P(correct) (reasoning/reliability.py).",
        status="keep",
        limitation="Band boundaries are a UI convenience; the defensible object is the continuous "
        "calibrated probability, always shown alongside.",
    ),
    # ── Selective abstention guarantee ────────────────────────────────────────────────
    Provenance(
        key="selective_risk_delta",
        value=0.05,
        definition="Distribution-free (1-δ) upper bound on selective risk at a chosen coverage "
        "(Hoeffding + Bonferroni over candidate thresholds).",
        source_type="literature",
        citation="Geifman & El-Yaniv 2017 (SGR); Hoeffding 1963; Angelopoulos & Bates 2021.",
        status="keep",
        limitation="Conservative (Hoeffding); needs enough calibration points to be feasible, else the "
        "honest result is to abstain on all.",
    ),
    # ── Scaffold split (the honesty of every held-out metric) ─────────────────────────
    Provenance(
        key="scaffold_split",
        value="Bemis-Murcko",
        definition="Train/cal/test are disjoint by Bemis-Murcko scaffold ⇒ held-out metrics reflect "
        "generalisation to NOVEL chemistry (a real covariate shift), not memorisation.",
        source_type="literature",
        citation="Bemis & Murcko 1996 (J Med Chem 39:2887); standard QSAR practice (Sheridan 2013).",
        status="keep",
        limitation="Scaffold splits induce train→test shift by design; the reported metrics are the "
        "honest lower bound, and per-query shift is still checked at inference.",
    ),
]

REGISTRY: dict[str, Provenance] = {p.key: p for p in _ITEMS}


def get(key: str) -> Provenance | None:
    """Provenance for a registered constant/score, or None if not registered."""
    return REGISTRY.get(key)


def heuristics() -> list[Provenance]:
    """Every remaining heuristic (source_type == 'heuristic'), for the audit surface."""
    return [p for p in REGISTRY.values() if p.source_type == "heuristic"]


def audit() -> dict[str, Any]:
    """Structural completeness check: every entry must carry a definition, a source, a
    citation, and a status. Returns the audit summary; raises if any entry is unexplained."""
    problems = []
    valid_sources = {"literature", "learned_from_data", "experimental", "structural", "heuristic"}
    valid_status = {"keep", "justified", "improve", "replace", "remove"}
    for k, p in REGISTRY.items():
        if not p.definition.strip():
            problems.append(f"{k}: missing definition")
        if p.source_type not in valid_sources:
            problems.append(f"{k}: invalid source_type {p.source_type!r}")
        if not p.citation.strip():
            problems.append(f"{k}: missing citation/derivation")
        if p.status not in valid_status:
            problems.append(f"{k}: invalid status {p.status!r}")
        if not p.limitation.strip():
            problems.append(f"{k}: missing limitation")
    if problems:
        raise AssertionError("verdict_provenance registry incomplete:\n  " + "\n  ".join(problems))
    by_status: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for p in REGISTRY.values():
        by_status[p.status] = by_status.get(p.status, 0) + 1
        by_source[p.source_type] = by_source.get(p.source_type, 0) + 1
    return {
        "n_registered": len(REGISTRY),
        "by_source_type": by_source,
        "by_status": by_status,
        "remaining_heuristics": [p.key for p in heuristics()],
        "heuristics_flagged_for_replacement": [
            p.key for p in heuristics() if p.status in ("replace", "remove")
        ],
    }


def as_table() -> list[dict]:
    """The full registry as a list of dicts (for API/UI surfacing)."""
    return [p.as_dict() for p in REGISTRY.values()]
