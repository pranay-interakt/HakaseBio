"""Wet-lab reference ranges + good/borderline/poor assessment for L1 readouts.

This is the "is this value good?" ruler that turns a raw model prediction into an
*actual-lab-result*-style line: value + unit + status + the reference range it was
judged against + the literature basis for that range. It does NOT invent values —
it only classifies REAL predictions the models produced. When a readout is missing
(model unavailable) it is reported as `unavailable`, never as a fabricated number.

Two things live here:
  • REFERENCE — per-readout unit, direction, reference range, and citation basis.
  • assess()  — classify one real value against its reference.
  • build_wetlab_sections() — group every assessed readout into clean UI sections.

Design rules:
  • No fabricated values. Missing input → status "unavailable".
  • The three calibrated safety endpoints (hERG/DILI/Ames) use the LIVE-fitted
    thresholds from hakase_kernel.uncertainty.live_calibration when available (falling back to the
    documented literature operating points, clearly labelled) — never a hardcoded
    "calibrated" number dressed up as fitted.
"""

from __future__ import annotations

import json
from typing import Any

from hakase_kernel.runtime.paths import resolve_artifact

# Status vocabulary (ordered best → worst; "unavailable"/"info" are non-scored).
GOOD, BORDERLINE, POOR = "good", "borderline", "poor"
INFO, NA = "info", "unavailable"


# --------------------------------------------------------------------------- #
# Reference table
# --------------------------------------------------------------------------- #
# kind:
#   prob_bad        — probability where HIGH is bad (hERG, DILI, CYP inhibition…)
#   prob_good       — probability where HIGH is good (HIA, bioavailability, PAMPA)
#   cont_high       — continuous where HIGHER is better (Caco-2, solubility logS)
#   cont_low        — continuous where LOWER is better (clearance)
#   cont_window     — continuous with a target window [good_lo, good_hi]
#   info            — contextual, no good/bad judgement (BBB, LD50 native units…)
# thresholds: (good_cut, borderline_cut) for prob/cont_high/cont_low, or
#             {"good": [lo,hi], "ok": [lo,hi]} for cont_window.

REFERENCE: dict[str, dict[str, Any]] = {
    # ── Physicochemical / drug-likeness ──────────────────────────────────
    "mw": {
        "label": "Molecular weight",
        "unit": "g/mol",
        "kind": "cont_window",
        "window": {"good": [150, 500], "ok": [100, 600]},
        "basis": "Lipinski Ro5 MW ≤ 500; >600 disfavoured (Lipinski 2001)",
    },
    "logp": {
        "label": "cLogP",
        "unit": "logP",
        "kind": "cont_window",
        "window": {"good": [1, 3], "ok": [-0.4, 5]},
        "basis": "Ro5 logP ≤ 5; optimal 1–3 (Ghose 1999)",
    },
    "logd": {
        "label": "LogD₇.₄",
        "unit": "logD",
        "kind": "cont_window",
        "window": {"good": [1, 3], "ok": [0, 5]},
        "basis": "Optimal oral logD 1–3; >5 clearance/tox risk (Waring 2010)",
    },
    "qed": {
        "label": "QED drug-likeness",
        "unit": "score 0–1",
        "kind": "prob_good",
        "thresholds": (0.67, 0.35),
        "basis": "QED > 0.67 attractive; < 0.35 poor (Bickerton 2012)",
    },
    "lipinski": {
        "label": "Lipinski violations",
        "unit": "count",
        "kind": "cont_low",
        "thresholds": (0, 1),
        "basis": "≤1 violation drug-like; ≥3 poor oral prospects (Ro5)",
    },
    "tpsa": {
        "label": "TPSA",
        "unit": "Å²",
        "kind": "cont_window",
        "window": {"good": [20, 90], "ok": [0, 140]},
        "basis": "TPSA ≤ 140 Å² for oral absorption; ≤ 90 for CNS (Veber 2002)",
    },
    # ── Absorption ───────────────────────────────────────────────────────
    "caco2_papp": {
        "label": "Caco-2 permeability (Papp)",
        "unit": "×10⁻⁶ cm/s",
        "kind": "cont_high",
        "thresholds": (8, 2),
        "basis": "Papp > 8 high, < 2 low permeability (Hubatsch 2007)",
    },
    "pampa_pe": {
        "label": "PAMPA permeability",
        "unit": "×10⁻⁶ cm/s",
        "kind": "cont_high",
        "thresholds": (5, 1),
        "basis": "PAMPA Pe > 5 high passive permeability (Kansy 1998)",
    },
    "hia_prob": {
        "label": "Human intestinal absorption",
        "unit": "P(absorbed)",
        "kind": "prob_good",
        "thresholds": (0.7, 0.3),
        "basis": "HIA > 70% good oral absorption (Hou 2007)",
    },
    "pgp_substrate_prob": {
        "label": "P-gp substrate",
        "unit": "P(substrate)",
        "kind": "prob_bad",
        "thresholds": (0.7, 0.9),
        "basis": "High P-gp efflux limits absorption/CNS (Broccatelli 2011)",
    },
    "pampa_prob": {
        "label": "PAMPA passive permeability",
        "unit": "P(permeable)",
        "kind": "prob_good",
        "thresholds": (0.7, 0.3),
        "basis": "High PAMPA = good passive permeability (NCATS)",
    },
    "bioavailability_prob": {
        "label": "Oral bioavailability > 20%",
        "unit": "P(F>20%)",
        "kind": "prob_good",
        "thresholds": (0.5, 0.3),
        "basis": "F > 20% threshold (Ma 2008)",
    },
    "solubility_logS": {
        "label": "Aqueous solubility (logS)",
        "unit": "log mol/L",
        "kind": "cont_high",
        "thresholds": (-4, -6),
        "basis": "logS > −4 soluble; < −6 poorly soluble (AqSolDB)",
    },
    "solubility_mg_ml": {
        "label": "Aqueous solubility",
        "unit": "mg/mL",
        "kind": "cont_high",
        "thresholds": (0.06, 0.001),
        "basis": "> 0.06 mg/mL adequate; < 0.001 poorly soluble (Ro5 context)",
    },
    # ── Distribution ─────────────────────────────────────────────────────
    "plasma_fu_percent": {
        "label": "Plasma fraction unbound",
        "unit": "% unbound",
        "kind": "cont_window",
        "window": {"good": [1, 100], "ok": [0.5, 100]},
        "basis": "Very high binding (fu < 1%) limits free drug (Obach 2008)",
    },
    "vdss": {
        "label": "Volume of distribution (Vdss)",
        "unit": "L/kg",
        "kind": "cont_window",
        "window": {"good": [0.5, 20], "ok": [0.1, 30]},
        "basis": "Typical Vdss 0.5–20 L/kg; extremes flag distribution issues (Lombardo 2016)",
    },
    "bbb_prob": {
        "label": "Blood-brain barrier penetration",
        "unit": "P(BBB+)",
        "kind": "info",
        "basis": "Indication-dependent — desirable for CNS, avoided otherwise (Martins 2012)",
    },
    # ── Metabolism (CYP inhibition — DDI risk; high = bad) ────────────────
    "cyp_inhibition": {
        "label": "CYP inhibition",
        "unit": "P(inhibitor)",
        "kind": "prob_bad",
        "thresholds": (0.5, 0.7),
        "basis": "High CYP inhibition → DDI risk (Veith 2009)",
    },
    "cyp_substrate": {
        "label": "CYP substrate",
        "unit": "P(substrate)",
        "kind": "info",
        "basis": "Metabolic fate — informational, not a liability alone (CarbonMangels 2011)",
    },
    # ── Excretion / stability ────────────────────────────────────────────
    "hepatocyte_clint": {
        "label": "Hepatocyte intrinsic clearance",
        "unit": "mL/min/kg",
        "kind": "cont_low",
        "thresholds": (15, 70),
        "basis": "CLint < 15 stable; > 70 rapid first-pass metabolism (AZ)",
    },
    "microsome_clint": {
        "label": "Microsomal intrinsic clearance",
        "unit": "mL/min/kg",
        "kind": "cont_low",
        "thresholds": (15, 70),
        "basis": "Metabolic-stability cross-check (AZ)",
    },
    "half_life_h": {
        "label": "Half-life (t½)",
        "unit": "hours",
        "kind": "cont_window",
        "window": {"good": [3, 24], "ok": [1, 48]},
        "basis": "t½ 3–24 h supports QD/BID dosing (Obach 2008)",
    },
    # ── Safety / toxicity ────────────────────────────────────────────────
    "herg": {
        "label": "hERG blockade",
        "unit": "P(blocker)",
        "kind": "prob_bad",
        "calibrated_key": "herg",
        "thresholds": (0.35, 0.75),
        "basis": "Cardiac K⁺ channel block → QT prolongation; live-calibrated veto/screen",
    },
    "dili": {
        "label": "Drug-induced liver injury",
        "unit": "P(DILI)",
        "kind": "prob_bad",
        "calibrated_key": "dili",
        "thresholds": (0.40, 0.85),
        "basis": "Hepatotoxicity; live-calibrated on ChEMBL approved/withdrawn",
    },
    "ames": {
        "label": "Ames mutagenicity",
        "unit": "P(mutagenic)",
        "kind": "prob_bad",
        "calibrated_key": "ames",
        "thresholds": (0.45, 0.75),
        "basis": "Bacterial reverse-mutation genotoxicity; live-calibrated",
    },
    "clintox": {
        "label": "Clinical toxicity",
        "unit": "P(tox)",
        "kind": "prob_bad",
        "thresholds": (0.45, 0.75),
        "basis": "Clinical-trial toxicity/failure (ClinTox)",
    },
    "carcinogenicity": {
        "label": "Carcinogenicity",
        "unit": "P(carcinogen)",
        "kind": "prob_bad",
        "thresholds": (0.45, 0.75),
        "basis": "Rodent carcinogenicity (Lagunin 2009)",
    },
    "skin_sensitization": {
        "label": "Skin sensitization",
        "unit": "P(sensitizer)",
        "kind": "prob_bad",
        "thresholds": (0.6, 0.85),
        "basis": "Skin sensitization hazard",
    },
    "bsep_cholestasis": {
        "label": "BSEP inhibition / cholestasis",
        "unit": "risk class",
        "kind": "class",
        "basis": "Bile-salt export pump inhibition → cholestatic DILI (Warner 2012)",
    },
    "phospholipidosis": {
        "label": "Phospholipidosis (CAD)",
        "unit": "risk class",
        "kind": "class",
        "basis": "Cationic amphiphilic drug phospholipidosis (Przybyla 2020)",
    },
    "cytotoxicity": {
        "label": "Cytotoxicity",
        "unit": "P(cytotoxic)",
        "kind": "prob_bad",
        "thresholds": (0.4, 0.7),
        "basis": "General cellular cytotoxicity (Ersilia)",
    },
    "ld50": {
        "label": "Acute toxicity (LD50)",
        "unit": "log mol/kg",
        "kind": "info",
        "basis": "Model-native units; not converted to mg/kg to avoid false precision (Zhu 2009)",
    },
    # ── Potency (only when a target is supplied) ─────────────────────────
    "pkd": {
        "label": "Predicted binding affinity (pKd)",
        "unit": "pKd (−log M)",
        "kind": "cont_high",
        "thresholds": (7, 6),
        "basis": "pKd ≥ 7 (Kd ≤ 100 nM) potent; < 6 weak (DeepDTA)",
    },
    "druggability": {
        "label": "Target druggability",
        "unit": "P(druggable)",
        "kind": "prob_good",
        "thresholds": (0.65, 0.40),
        "basis": "ESM-2 target druggability (< 0.40 undruggable)",
    },
}

_CLASS_STATUS = {"Low": GOOD, "Moderate": BORDERLINE, "High": POOR, None: NA}


def _live_thresholds(
    calibrated_key: str, default_good: float, default_bad: float
) -> tuple[float, float, str]:
    """(good_cut, bad_cut, basis) — prefer live-fitted safety thresholds."""
    try:
        from ..uncertainty import live_calibration as lc

        watch, nogo, basis = lc.thresholds(calibrated_key, default_good, default_bad)
        return watch, nogo, basis
    except Exception:  # noqa: BLE001
        return default_good, default_bad, "documented default"


def assess(key: str, value: float | None, *, risk_class: str | None = None) -> dict[str, Any]:
    """Classify one REAL readout against its reference. Never fabricates a value:
    a missing value returns status `unavailable`."""
    spec = REFERENCE.get(key)
    if spec is None:
        return {"status": NA, "reason": "no reference range defined"}
    kind = spec["kind"]
    unit = spec["unit"]
    basis = spec["basis"]

    # Class-valued (risk_class) endpoints.
    if kind == "class":
        return {
            "status": _CLASS_STATUS.get(risk_class, NA),
            "value": risk_class,
            "unit": unit,
            "label": spec["label"],
            "reference": "Low / Moderate / High",
            "basis": basis,
        }

    if value is None:
        return {
            "status": NA,
            "label": spec["label"],
            "unit": unit,
            "reason": "model prediction unavailable",
            "basis": basis,
        }

    v = float(value)
    ref = ""
    status = INFO

    if kind == "info":
        status = INFO
        ref = "contextual"
    elif kind in ("prob_bad", "cont_low"):
        good, bad = spec["thresholds"]
        if "calibrated_key" in spec:
            good, bad, cb = _live_thresholds(spec["calibrated_key"], good, bad)
            basis = f"{basis} — {cb}"
        status = GOOD if v < good else (BORDERLINE if v < bad else POOR)
        ref = f"good < {good:g} · poor ≥ {bad:g}"
    elif kind in ("prob_good", "cont_high"):
        good, bad = spec["thresholds"]
        status = GOOD if v >= good else (BORDERLINE if v >= bad else POOR)
        ref = f"good ≥ {good:g} · poor < {bad:g}"
    elif kind == "cont_window":
        w = spec["window"]
        glo, ghi = w["good"]
        olo, ohi = w.get("ok", w["good"])
        if glo <= v <= ghi:
            status = GOOD
        elif olo <= v <= ohi:
            status = BORDERLINE
        else:
            status = POOR
        ref = f"good {glo:g}–{ghi:g} · ok {olo:g}–{ohi:g}"

    return {
        "status": status,
        "value": round(v, 4),
        "unit": unit,
        "label": spec["label"],
        "reference": ref,
        "basis": basis,
    }


# --------------------------------------------------------------------------- #
# Sectioned wet-lab panel — every real readout, grouped for a clean UI
# --------------------------------------------------------------------------- #


def _ro(node: dict[str, Any] | None, field: str = "value") -> float | None:
    """Pull a real value out of a readout node; None if absent (never fabricates)."""
    if not isinstance(node, dict):
        return None
    v = node.get(field)
    return float(v) if isinstance(v, (int, float)) else None


def _item(
    key: str, node: dict[str, Any] | None, field: str = "value", *, risk_class: str | None = None
) -> dict[str, Any]:
    a = assess(key, _ro(node, field), risk_class=risk_class)
    a["key"] = key
    if isinstance(node, dict) and node.get("source"):
        a["source"] = node["source"]
    # Surface live per-endpoint model uncertainty when the model provided it.
    if isinstance(node, dict) and isinstance(node.get("uncertainty"), dict):
        u = node["uncertainty"]
        a["confidence"] = u.get("confidence")
        a["reliability"] = u.get("reliability")
    return a


_TOX21_CALIB_PATH = str(resolve_artifact("tox21_calibration.json"))
_tox21_veto_cache: dict[str, float] | None = None


def _tox21_veto_thresholds() -> dict[str, float]:
    """{assay label -> calibrated conformal veto threshold} from the shipped Tox21
    calibration artifact, so each Tox21 row can show the SAME reference range every
    other readout shows. Empty dict if the artifact is absent (row then omits the
    range rather than inventing one)."""
    global _tox21_veto_cache
    if _tox21_veto_cache is None:
        try:
            with open(_TOX21_CALIB_PATH) as f:
                heads = json.load(f).get("heads") or {}
            _tox21_veto_cache = {
                h.get("label"): h.get("veto_threshold")
                for h in heads.values()
                if h.get("label") and isinstance(h.get("veto_threshold"), (int, float))
            }
        except Exception:  # noqa: BLE001 — presentation detail; never break the panel
            _tox21_veto_cache = {}
    return _tox21_veto_cache


def _tox21_items(result: dict[str, Any]) -> list[dict[str, Any]]:
    """One readout per Tox21 reporter assay (12 heads: nuclear-receptor + stress
    response). These already drive the verdict via the safety-triage stack; surfacing
    each individually means the wet-lab output shows EVERY assay we simulate rather
    than a rolled-up count.

    Emits the full WetLabItem contract (value + unit + status + reference range +
    citation + model + applicability-domain reliability), identical to every other
    readout, so the UI renders these rows with no special-casing.

    Status maps the assay's own calibrated call:
      poor = calibrated active flag (conformal veto trip, in-domain)
      good = below threshold and in-domain (reliable clear)
      info = out-of-domain (score is an extrapolation — no pass/fail asserted)
    """
    panel = (((result.get("safety_liabilities") or {}).get("tox21") or {}).get("panel")) or []
    vetoes = _tox21_veto_thresholds()
    items: list[dict[str, Any]] = []
    for h in panel:
        assay = h.get("assay")
        p = h.get("active_probability")
        in_domain = h.get("in_domain")
        if p is None:
            status = NA
        elif h.get("active_flag"):
            status = POOR
        elif in_domain is False:
            status = INFO
        else:
            status = GOOD

        thr = vetoes.get(assay)
        reference = (
            f"active ≥ {thr:.3f} (conformal veto, α=0.05)"
            if isinstance(thr, (int, float))
            else None
        )

        auroc = h.get("test_auroc")
        basis_bits = [
            "Tox21 qHTS panel (NCATS/EPA/NIH) — RF + isotonic calibration, split-conformal veto α=0.05"
        ]
        if isinstance(auroc, (int, float)):
            basis_bits.append(f"held-out AUROC {auroc:.2f}")
        if h.get("mechanistic_meaning"):
            basis_bits.append(str(h["mechanistic_meaning"]))
        item: dict[str, Any] = {
            "key": f"tox21_{assay}",
            "label": f"{assay} — {h.get('pathway')}" if h.get("pathway") else str(assay),
            "value": None if p is None else round(float(p), 4),
            "unit": "P(active)",
            "status": status,
            "source": "Tox21-ML (per-assay RF)",
            "basis": " · ".join(basis_bits),
        }
        if reference:
            item["reference"] = reference
        if in_domain is not None:
            item["reliability"] = "in-domain" if in_domain else "out-of-domain (extrapolated)"
        tan = h.get("ad_tanimoto_nearest")
        if isinstance(tan, (int, float)):
            item["confidence"] = round(float(tan), 3)
        if status == NA:
            item["reason"] = "Tox21 head unavailable for this molecule"
        items.append(item)
    return items


def _structural_alert_items(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Reactive-metabolite structural-alert screen (literature-curated SMARTS panel) —
    the mechanism-based bioactivation liability readout. Rule-based by design: structural
    alerts are the domain-standard reactive-metabolite screen (the same basis expert
    systems use), so this row is deterministic rather than a probabilistic model."""
    rm = (result.get("safety_liabilities") or {}).get("reactive_metabolites") or {}
    n = rm.get("alert_count")
    if n is None:
        return []
    n = int(n)
    severity = rm.get("severity")
    if n == 0:
        status = GOOD
    elif severity in ("High Risk", "High"):
        status = POOR
    else:
        status = BORDERLINE
    drivers = rm.get("drivers") or []
    return [
        {
            "key": "reactive_metabolite_alerts",
            "label": "Reactive-metabolite structural alerts",
            "value": n,
            "unit": "alerts",
            "status": status,
            "reference": "good = 0 alerts · poor = alert(s) at High severity",
            "basis": (
                "Literature-curated reactive-metabolite/bioactivation SMARTS panel — "
                "structural alerts are the domain-standard mechanism-based screen"
                + (f" · severity: {severity}" if severity else "")
                + (f" · {'; '.join(str(d) for d in drivers)}" if drivers else "")
            ),
            "source": "Structural-alert SMARTS panel",
            "reliability": "deterministic (rule-based)",
        }
    ]


def build_wetlab_sections(result: dict[str, Any]) -> dict[str, Any]:
    """Group every REAL readout the panel produced into clean UI sections, each item
    assessed (value + unit + good/borderline/poor + reference range + basis). No value
    is fabricated: a down model yields an `unavailable` item, not a fake number."""
    panel = result.get("panel", {}) or {}
    absb = panel.get("absorption", {}) or {}
    dist = panel.get("distribution", {}) or {}
    metab = panel.get("metabolism", {}) or {}
    exc = panel.get("excretion", {}) or {}
    tox = panel.get("toxicity", {}) or {}
    sx = panel.get("safety_extended", {}) or {}
    binding = panel.get("binding") or {}
    lip = result.get("lipinski", {}) or {}

    sections: list[dict[str, Any]] = []

    # Physicochemical / drug-likeness
    phys = []
    if lip.get("mw") is not None:
        phys.append(_item("mw", {"value": lip.get("mw"), "source": "RDKit"}))
    if lip.get("logp") is not None:
        phys.append(_item("logp", {"value": lip.get("logp"), "source": "RDKit/Crippen"}))
    phys.append(_item("logd", absb.get("logD")))
    if result.get("qed") is not None:
        phys.append(_item("qed", {"value": result.get("qed"), "source": "RDKit QED"}))
    phys.append(_item("lipinski", {"value": lip.get("violations"), "source": "RDKit Lipinski Ro5"}))
    sections.append(
        {
            "id": "physicochemical",
            "title": "Physicochemical & Drug-likeness",
            "icon": "beaker",
            "items": [p for p in phys if p],
        }
    )

    # Absorption
    sol_node = absb.get("solubility_consensus_logS") or absb.get("logS")
    sol_mg = absb.get("solubility_consensus_mg_ml") or absb.get("solubility_mg_ml")
    absorption = [
        _item("caco2_papp", absb.get("caco2_papp")),
        _item("solubility_logS", sol_node),
        _item("solubility_mg_ml", sol_mg),
        _item("hia_prob", absb.get("hia_prob"), "probability"),
        _item("pampa_prob", absb.get("pampa_prob"), "probability"),
        _item("pgp_substrate_prob", absb.get("pgp_substrate_prob"), "probability"),
        _item("bioavailability_prob", absb.get("bioavailability_prob"), "probability"),
    ]
    sections.append(
        {
            "id": "absorption",
            "title": "Absorption & Permeability",
            "icon": "arrow-down-to-line",
            "items": absorption,
        }
    )

    # Distribution
    sections.append(
        {
            "id": "distribution",
            "title": "Distribution",
            "icon": "share-2",
            "items": [
                _item("plasma_fu_percent", dist.get("plasma_fu_percent")),
                _item("vdss", dist.get("vdss")),
                _item("bbb_prob", dist.get("bbb_prob"), "probability"),
            ],
        }
    )

    # Metabolism (CYP inhibition panel + substrate fate)
    cyp_items = []
    for iso, node in (metab.get("cyp_panel", {}) or {}).items():
        it = _item("cyp_inhibition", node, "probability")
        it["label"] = f"{iso} inhibition"
        cyp_items.append(it)
    for iso, node in (metab.get("cyp_substrate", {}) or {}).items():
        it = _item("cyp_substrate", node, "probability")
        it["label"] = f"{iso} substrate"
        cyp_items.append(it)
    sections.append(
        {
            "id": "metabolism",
            "title": "Metabolism (CYP450 · DDI)",
            "icon": "flame",
            "items": cyp_items,
        }
    )

    # Excretion / stability
    sections.append(
        {
            "id": "excretion",
            "title": "Excretion & Metabolic Stability",
            "icon": "timer",
            "items": [
                _item("hepatocyte_clint", exc.get("hepatocyte_clint")),
                _item("microsome_clint", exc.get("microsome_clint")),
                _item("half_life_h", exc.get("half_life_h")),
            ],
        }
    )

    # Safety / toxicity (incl. dedicated extended liabilities)
    safety = [
        _item("herg", tox.get("herg"), "probability"),
        _item("dili", tox.get("dili"), "probability"),
        _item("ames", tox.get("ames"), "probability"),
        _item("clintox", tox.get("clintox"), "probability"),
        _item("carcinogenicity", tox.get("carcinogenicity"), "probability"),
        _item("skin_sensitization", tox.get("skin_sensitization"), "probability"),
        _item(
            "bsep_cholestasis",
            None,
            risk_class=(sx.get("bsep_cholestasis") or {}).get("risk_class"),
        ),
        _item(
            "phospholipidosis",
            None,
            risk_class=(sx.get("phospholipidosis") or {}).get("risk_class"),
        ),
        _item("cytotoxicity", sx.get("cytotoxicity"), "probability"),
        _item("ld50", tox.get("ld50")),
    ]
    sections.append(
        {"id": "safety", "title": "Safety & Toxicology", "icon": "shield-alert", "items": safety}
    )

    # Tox21 mechanistic pathway panel — 12 reporter assays that already feed the
    # verdict. Surfaced per-assay so the wet-lab output shows every simulated assay.
    tox21_items = _tox21_items(result)
    if tox21_items:
        sections.append(
            {
                "id": "tox21",
                "title": "Tox21 Mechanistic Pathways",
                "icon": "activity",
                "items": tox21_items,
            }
        )

    # Reactive-metabolite structural-alert screen (bioactivation liability).
    alert_items = _structural_alert_items(result)
    if alert_items:
        sections.append(
            {
                "id": "structural_alerts",
                "title": "Reactive-Metabolite Structural Alerts",
                "icon": "alert-triangle",
                "items": alert_items,
            }
        )

    # Potency (only when a target was supplied — never fabricated otherwise)
    if binding and binding.get("pkd"):
        sections.append(
            {
                "id": "potency",
                "title": "Target Potency",
                "icon": "target",
                "items": [
                    _item("pkd", binding.get("pkd")),
                ],
            }
        )

    # Summary counts — how much of the panel is real vs unavailable.
    counts = {GOOD: 0, BORDERLINE: 0, POOR: 0, INFO: 0, NA: 0}
    total_real = 0
    for s in sections:
        for it in s["items"]:
            st = it.get("status", NA)
            counts[st] = counts.get(st, 0) + 1
            if st in (GOOD, BORDERLINE, POOR, INFO):
                total_real += 1
    total = sum(counts.values())
    return {
        "sections": sections,
        "summary": {
            "counts_by_status": counts,
            "n_readouts": total,
            "n_real_predictions": total_real,
            "n_unavailable": counts.get(NA, 0),
            "coverage": round(total_real / total, 3) if total else 0.0,
        },
        "legend": {
            GOOD: "within favourable lab range",
            BORDERLINE: "marginal — monitor",
            POOR: "outside acceptable range",
            INFO: "contextual (no pass/fail)",
            NA: "model prediction unavailable",
        },
    }
