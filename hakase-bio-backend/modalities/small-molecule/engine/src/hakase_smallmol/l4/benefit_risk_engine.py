"""FDA Benefit-Risk Framework — the regulatory context around a safety call.

Implements the structured framework in FDA's final guidance *Benefit-Risk
Assessment for New Drug and Biological Products* (October 2023, developed under
PDUFA VI and the 21st Century Cures Act). The principle it encodes is that the
acceptable level of RISK is weighed against the severity of the CONDITION and
the UNMET MEDICAL NEED: a liability that sinks a candidate for a mild condition
can be acceptable for a life-threatening disease with no alternatives.

The framework assesses five dimensions:
  1. Analysis of Condition       severity / seriousness of the disease
  2. Current Treatment Options   what already exists (unmet need)
  3. Benefit                     magnitude and importance of the effect
  4. Risk                        nature, severity, reversibility of harms
  5. Risk Management             whether the risk can be mitigated

**This does not overturn a safety determination.** A first-in-human NOT-READY
gate, a failed exposure margin, or a high-hazard toxicology domain still stands.
What this adds is regulatory *context*: for a severe, high-unmet-need indication
a flagged liability is reframed as "potentially acceptable with a risk-management
strategy — escalate to a benefit-risk committee", not as an automatic advance.
For a non-serious indication the same liability reads as "not justified by the
benefit". The L4 readiness gate remains the source of truth for go/no-go.

Honesty contract
  • The indication classification is a keyword prior over the 21 CFR 312.300(b)
    definition of a serious condition. It is a coarse instrument and is labelled
    as one; the classifier's inputs are user-supplied, never inferred from the
    structure.
  • The prior is refined by live openFDA label counts where available — a real
    treatment-landscape measurement. When openFDA is unreachable the prior is
    used unchanged and the output says so.
  • No number here is a clinical efficacy estimate. The benefit term is a
    preclinical surrogate built from this molecule's own predicted dimensions.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import SourceUnavailable, get_json

OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"

# 21 CFR 312.300(b) "serious condition" vocabulary, split by severity band.
LIFE_THREATENING = (
    "cancer", "carcinoma", "oncology", "tumor", "tumour", "leukemia", "leukaemia",
    "lymphoma", "melanoma", "glioblastoma", "metasta", "sarcoma", "myeloma",
    "als", "amyotrophic", "sepsis", "septic", "ebola", "hiv", "aids",
    "pulmonary arterial hypertension", "cystic fibrosis", "duchenne",
)
SERIOUS = (
    "alzheimer", "parkinson", "multiple sclerosis", "huntington", "epilep",
    "heart failure", "myocardial", "stroke", "cirrhosis", "hepatitis",
    "copd", "pulmonary fibrosis", "renal failure", "kidney disease",
    "rheumatoid", "lupus", "crohn", "ulcerative colitis", "schizophren",
    "rare disease", "orphan", "genetic disorder", "immunodeficien", "anemia",
    "diabetes type 1", "tuberculosis", "severe",
)
MODERATE = (
    "diabetes", "hypertension", "asthma", "depression", "anxiety", "migraine",
    "osteoporosis", "psoriasis", "eczema", "obesity", "gout", "hypothyroid",
    "gerd", "ibs", "adhd", "chronic pain",
)
NON_SERIOUS = (
    "cosmetic", "wrinkle", "aesthetic", "hair loss", "alopecia", "acne",
    "allergic rhinitis", "seasonal allergy", "dandruff", "athlete's foot",
    "mild", "common cold", "halitosis",
)
HIGH_UNMET = (
    "rare disease", "orphan", "refractory", "relapsed", "metasta",
    "glioblastoma", "als", "duchenne",
)
WELL_SERVED = ("hypertension", "gerd", "allergic rhinitis", "acne")

# Risk tolerance is severity-weighted; FDA weighs the condition itself slightly
# above the treatment landscape, which is what these weights encode.
SEVERITY_WEIGHT = 0.55
UNMET_WEIGHT = 0.45
# When openFDA returns data it dominates the keyword prior, because it is a
# measurement of the actual approved-treatment landscape.
FDA_SEVERITY_WEIGHT = 0.65
FDA_UNMET_WEIGHT = 0.70
# A candidate is favourable when benefit plus condition-driven tolerance clears
# the risk level by this margin.
FAVOURABLE_MARGIN = 0.20

_SEVERITY_LABEL = (
    (0.88, "life-threatening"),
    (0.62, "serious"),
    (0.38, "moderate"),
)
_UNMET_LABEL = ((0.70, "high"), (0.45, "moderate"))


def _matches(text: str, keys: tuple[str, ...]) -> bool:
    return any(key in text for key in keys)


def _band(score: float, table: tuple[tuple[float, str], ...], floor: str) -> str:
    for threshold, label in table:
        if score >= threshold:
            return label
    return floor


def classify_condition(indication: str | None, therapeutic_area: str | None = None) -> dict[str, Any]:
    """Coarse severity / unmet-need prior from the stated indication."""
    text = f"{indication or ''} {therapeutic_area or ''}".strip().lower()
    if not text:
        return {
            "severity": "unknown",
            "unmet_need": "unknown",
            "severity_score": 0.5,
            "unmet_score": 0.5,
            "rationale": (
                "No indication was supplied, so the benefit-risk assessment uses a neutral "
                "midpoint. Set the indication for a calibrated assessment."
            ),
            "classifier_inputs": {"indication": indication, "therapeutic_area": therapeutic_area},
        }

    if _matches(text, LIFE_THREATENING):
        severity, severity_score = "life-threatening", 1.0
    elif _matches(text, SERIOUS):
        severity, severity_score = "serious", 0.78
    elif _matches(text, NON_SERIOUS):
        severity, severity_score = "non-serious", 0.22
    elif _matches(text, MODERATE):
        severity, severity_score = "moderate", 0.5
    else:
        severity, severity_score = "unknown", 0.5

    if severity == "life-threatening" or _matches(text, HIGH_UNMET):
        unmet, unmet_score = "high", 0.9
    elif severity == "serious":
        unmet, unmet_score = "moderate", 0.6
    elif severity == "non-serious" or _matches(text, WELL_SERVED):
        unmet, unmet_score = "low", 0.25
    else:
        unmet, unmet_score = "unknown", 0.5

    return {
        "severity": severity,
        "unmet_need": unmet,
        "severity_score": severity_score,
        "unmet_score": unmet_score,
        "rationale": (
            f"Indication {indication or therapeutic_area or '—'!r} classified as {severity} "
            f"(severity {severity_score * 100:.0f}/100) with {unmet} unmet medical need "
            f"({unmet_score * 100:.0f}/100). Under the FDA framework, acceptable risk rises "
            "with both."
        ),
        "classifier_inputs": {"indication": indication, "therapeutic_area": therapeutic_area},
        "method": (
            "Keyword prior over the 21 CFR 312.300(b) serious-condition vocabulary. The inputs "
            "are user-supplied; nothing is inferred from the molecular structure."
        ),
    }


def fetch_fda_condition_context(
    indication: str | None, therapeutic_area: str | None = None
) -> dict[str, Any]:
    """Approved-label landscape for an indication, from openFDA.

    There is no API that returns "disease severity" or "unmet need", so two
    defensible proxies are measured instead:

      approved label count   how many approved products list this indication —
                             the FDA framework's *Current Treatment Options*
                             dimension, measured rather than assumed
      boxed-warning fraction what share of them carry a boxed warning — revealed
                             regulatory risk tolerance for the condition
    """
    term = (indication or therapeutic_area or "").strip().replace('"', "").replace("\\", "")
    if not term:
        return {
            "status": "skipped",
            "reason": "No indication was supplied, so openFDA was not queried.",
        }
    phrase = f'"{term}"'
    try:
        total_payload = get_json(
            OPENFDA_LABEL,
            params={"search": f"indications_and_usage:{phrase}", "limit": 1},
            timeout=12.0,
        )
        boxed_payload = get_json(
            OPENFDA_LABEL,
            params={
                "search": f"indications_and_usage:{phrase} AND _exists_:boxed_warning",
                "limit": 1,
            },
            timeout=12.0,
        )
    except SourceUnavailable as exc:
        return {
            "status": "unavailable",
            "reason": str(exc),
            "note": "openFDA was unreachable; the keyword prior is used unchanged.",
        }

    total = (((total_payload or {}).get("meta") or {}).get("results") or {}).get("total", 0)
    boxed = (((boxed_payload or {}).get("meta") or {}).get("results") or {}).get("total", 0)
    fraction = round(boxed / total, 3) if total else None
    return {
        "status": "live",
        "source": "openFDA drug/label",
        "term": term,
        "approved_label_count": total,
        "boxed_warning_count": boxed,
        "boxed_warning_fraction": fraction,
        "note": (
            "No approved drug label lists this exact indication phrase, so it is treated as a "
            "high-unmet-need or novel indication."
            if not total
            else (
                f"{total} approved label(s) list this indication; {boxed} carry a boxed warning"
                + (f" ({fraction * 100:.0f}%)." if fraction is not None else ".")
            )
        ),
        "limitations": (
            "openFDA indexes label text, so the count depends on exact phrasing. It measures "
            "the labelled treatment landscape, not clinical adequacy of those treatments."
        ),
    }


def _refine_with_fda(prior: dict[str, Any], fda: dict[str, Any] | None) -> dict[str, Any]:
    """Blend the keyword prior with the measured openFDA landscape."""
    if not fda or fda.get("status") != "live":
        return {**prior, "fda_grounded": False}
    total = fda.get("approved_label_count") or 0
    # Fewer approved therapies ⇒ higher unmet need.
    unmet_from_fda = (
        0.90 if total == 0 else 0.82 if total < 10 else 0.62 if total < 50 else 0.45 if total < 200 else 0.22
    )
    fraction = fda.get("boxed_warning_fraction")
    severity_from_fda = (
        prior["severity_score"]
        if fraction is None
        else max(0.0, min(1.0, 0.40 + fraction * 0.60))
    )
    severity_score = round(
        (1 - FDA_SEVERITY_WEIGHT) * prior["severity_score"] + FDA_SEVERITY_WEIGHT * severity_from_fda,
        3,
    )
    unmet_score = round(
        (1 - FDA_UNMET_WEIGHT) * prior["unmet_score"] + FDA_UNMET_WEIGHT * unmet_from_fda, 3
    )
    severity = _band(severity_score, _SEVERITY_LABEL, "non-serious")
    unmet = _band(unmet_score, _UNMET_LABEL, "low")
    # State the *refined* scores as the operative ones. Quoting the keyword
    # prior's numbers and then silently overriding them reads as though the
    # prior still governs, which it does not once openFDA answers.
    rationale = (
        f"Indication {prior['classifier_inputs'].get('indication') or prior['classifier_inputs'].get('therapeutic_area') or '—'!r} "
        f"assessed as {severity} (severity {severity_score * 100:.0f}/100) with {unmet} unmet "
        f"medical need ({unmet_score * 100:.0f}/100). These are the keyword prior "
        f"({prior['severity']} / {prior['unmet_need']}) re-weighted against the measured openFDA "
        f"treatment landscape, which governs at {FDA_SEVERITY_WEIGHT:.0%} for severity and "
        f"{FDA_UNMET_WEIGHT:.0%} for unmet need: {fda.get('note')}"
    )
    return {
        **prior,
        "severity": severity,
        "unmet_need": unmet,
        "severity_score": severity_score,
        "unmet_score": unmet_score,
        "prior": {
            "severity": prior["severity"],
            "unmet_need": prior["unmet_need"],
            "severity_score": prior["severity_score"],
            "unmet_score": prior["unmet_score"],
            "rationale": prior["rationale"],
        },
        "rationale": rationale,
        "fda_grounded": True,
    }


def _risk_from_gate(gate: dict[str, Any], toxicology_summary: dict[str, Any]) -> dict[str, Any]:
    """Map the first-in-human readiness gate onto a 0–1 risk level."""
    recommendation = (gate or {}).get("recommendation")
    high_hazard = (toxicology_summary or {}).get("high_hazard_domains") or []
    flagged = (toxicology_summary or {}).get("flagged_domains") or []
    if recommendation == "NOT-READY":
        return {
            "level": 0.90,
            "label": "high",
            "hard_stop": True,
            "basis": "The first-in-human readiness gate returned NOT-READY.",
        }
    if recommendation == "CONDITIONAL" or high_hazard:
        return {
            "level": 0.55,
            "label": "moderate",
            "hard_stop": False,
            "basis": (
                "The readiness gate is CONDITIONAL"
                + (f" and the preclinical panel flags {', '.join(high_hazard)} at high hazard." if high_hazard else ".")
            ),
        }
    if flagged:
        return {
            "level": 0.35,
            "label": "moderate-low",
            "hard_stop": False,
            "basis": f"Moderate hazards flagged: {', '.join(flagged)}.",
        }
    return {
        "level": 0.20,
        "label": "low",
        "hard_stop": False,
        "basis": "The readiness gate is READY and no toxicology domain reached the high band.",
    }


def _benefit(
    *,
    target_precedented: bool | None,
    starting_dose: dict[str, Any],
    pad: dict[str, Any],
    benefit_score: float | None,
) -> dict[str, Any]:
    """A preclinical benefit surrogate — explicitly not an efficacy estimate."""
    if benefit_score is not None:
        value = max(0.0, min(1.0, float(benefit_score) / 100.0))
        return {
            "score": round(value, 3),
            "basis": "Supplied by the reviewer.",
            "factors": ["user-supplied benefit score"],
            "is_efficacy_estimate": False,
        }

    factors: list[str] = []
    components: list[float] = []

    # Demonstrable target engagement at a dose below the projected safety
    # ceiling is the strongest preclinical benefit signal available here.
    if pad.get("available") and starting_dose.get("available"):
        pad_dose = pad.get("pad_total_mg")
        start_dose = starting_dose.get("recommended_starting_dose_total_mg")
        if pad_dose and start_dose:
            ratio = pad_dose / start_dose
            reachable = ratio <= 100
            components.append(0.75 if reachable else 0.35)
            factors.append(
                f"the pharmacologically active dose is {ratio:.0f}× the starting dose "
                + ("— reachable within a conventional escalation" if reachable else "— a long escalation")
            )
    elif pad.get("available"):
        components.append(0.6)
        factors.append("a pharmacologically active dose was derivable")
    else:
        factors.append("no pharmacologically active dose could be derived (no measured potency)")

    if target_precedented is True:
        components.append(0.85)
        factors.append("the target is clinically precedented (an approved compound exists)")
    elif target_precedented is False:
        components.append(0.45)
        factors.append("no approved compound against this target was located")

    if not components:
        return {
            "score": None,
            "basis": (
                "No molecule-specific benefit factor was derivable, so the benefit term is left "
                "unresolved rather than assumed."
            ),
            "factors": factors,
            "is_efficacy_estimate": False,
        }
    value = sum(components) / len(components)
    return {
        "score": round(value, 3),
        "basis": "Mean of the derivable preclinical benefit factors: " + "; ".join(factors) + ".",
        "factors": factors,
        "is_efficacy_estimate": False,
    }


def assess_benefit_risk(
    *,
    indication: str | None,
    therapeutic_area: str | None = None,
    gate: dict[str, Any],
    toxicology_summary: dict[str, Any] | None = None,
    starting_dose: dict[str, Any] | None = None,
    pharmacologically_active_dose: dict[str, Any] | None = None,
    margins: dict[str, Any] | None = None,
    clinical_precedent: dict[str, Any] | None = None,
    benefit_score: float | None = None,
    query_openfda: bool = True,
) -> dict[str, Any]:
    """The five-dimension FDA benefit-risk assessment for this candidate."""
    tox_summary = toxicology_summary or {}
    starting = starting_dose or {}
    pad = pharmacologically_active_dose or {}
    precedent = clinical_precedent or {}

    fda_context = (
        fetch_fda_condition_context(indication, therapeutic_area)
        if query_openfda
        else {"status": "skipped", "reason": "openFDA lookup was disabled for this run."}
    )
    condition = _refine_with_fda(classify_condition(indication, therapeutic_area), fda_context)
    risk = _risk_from_gate(gate, tox_summary)
    precedented = precedent.get("target_precedented") if precedent.get("available") else None
    benefit = _benefit(
        target_precedented=precedented,
        starting_dose=starting,
        pad=pad,
        benefit_score=benefit_score,
    )

    risk_tolerance = round(
        SEVERITY_WEIGHT * condition["severity_score"] + UNMET_WEIGHT * condition["unmet_score"], 3
    )

    # ── Balance ──────────────────────────────────────────────────────────────
    # A safety stop is sovereign: it can reach "conditional" (mitigation plus a
    # committee review) but never "favourable" on benefit-risk grounds alone.
    benefit_value = benefit["score"]
    if risk["hard_stop"]:
        balance = "conditional" if risk_tolerance >= 0.70 else "unfavorable"
        margin = None
    elif benefit_value is None:
        balance = "indeterminate"
        margin = None
    else:
        margin = round(benefit_value * 0.40 + risk_tolerance * 0.60 - risk["level"], 3)
        balance = (
            "favorable"
            if margin >= FAVOURABLE_MARGIN
            else "borderline"
            if margin >= 0.0
            else "unfavorable"
        )

    diverges = balance == "conditional" or (
        (gate or {}).get("recommendation") == "CONDITIONAL" and balance == "favorable"
    )

    high_hazard = tox_summary.get("high_hazard_domains") or []
    flagged = tox_summary.get("flagged_domains") or []
    margin_row = ((margins or {}).get("per_dose_level") or [{}])[0]

    dimensions = [
        {
            "dimension": "Analysis of Condition",
            "evidence": condition["rationale"],
            "conclusion": {
                "life-threatening": "Life-threatening condition — a high tolerance for serious risk is appropriate.",
                "serious": "Serious condition — elevated risk may be acceptable for meaningful benefit.",
                "moderate": "Moderate condition — risk must be proportionate to a clear benefit.",
                "non-serious": "Non-serious condition — only a low risk burden is acceptable.",
            }.get(condition["severity"], "Condition severity unspecified — a neutral midpoint is used."),
        },
        {
            "dimension": "Current Treatment Options",
            "evidence": (
                {
                    "high": "Few or no adequate therapies, or a refractory population — high unmet need.",
                    "moderate": "Therapies exist but with meaningful limitations.",
                    "low": "Multiple effective therapies are already available.",
                }.get(condition["unmet_need"], "Treatment landscape not specified.")
                + " "
                + (
                    fda_context.get("note") or ""
                    if fda_context.get("status") == "live"
                    else f"(openFDA {fda_context.get('status')} — the indication prior is used unchanged.)"
                )
            ),
            "conclusion": (
                "High unmet need raises the acceptable-risk ceiling."
                if condition["unmet_score"] >= 0.70
                else "Well-served indication — a new entrant must clear a higher safety bar."
                if condition["unmet_score"] <= 0.30
                else "Unmet need is intermediate."
            ),
        },
        {
            "dimension": "Benefit",
            "evidence": (
                benefit["basis"]
                + (
                    f" Composite preclinical benefit surrogate ≈ {benefit_value * 100:.0f}/100."
                    if benefit_value is not None
                    else ""
                )
                + " This is a preclinical surrogate derived from this molecule's own projections;"
                " it is not a clinical efficacy endpoint."
            ),
            "conclusion": (
                "Benefit could not be quantified from the available preclinical evidence."
                if benefit_value is None
                else "Strong predicted benefit signal."
                if benefit_value >= 0.80
                else "Moderate predicted benefit."
                if benefit_value >= 0.50
                else "Weak predicted benefit — this limits the acceptable risk."
            ),
        },
        {
            "dimension": "Risk",
            "evidence": (
                risk["basis"]
                + (f" High-hazard domains: {', '.join(high_hazard)}." if high_hazard else "")
                + (
                    f" Exposure margin at the starting dose: {margin_row.get('limiting_margin')}× "
                    f"({margin_row.get('band')})."
                    if margin_row.get("limiting_margin") is not None
                    else " No exposure-based margin to the animal point of departure was computable."
                )
            ),
            "conclusion": (
                "Serious predicted liability — development would normally stop absent mitigation."
                if risk["hard_stop"]
                else "Manageable risk signals requiring defined monitoring."
                if flagged
                else "Low predicted risk at this stage."
            ),
        },
        {
            "dimension": "Risk Management",
            "evidence": (
                "Mitigation options: structural redesign to remove the liability, a qualified "
                "control strategy, intensive clinical monitoring with a defined stopping "
                "threshold, or a restricted-use programme."
                if risk["hard_stop"]
                else "Protocol-level monitoring with an explicit stopping threshold for each "
                "flagged preclinical hazard, plus the orthogonal in-vitro confirmation the "
                "readiness gate requires."
                if flagged
                else "Routine pharmacovigilance is expected to suffice."
            ),
            "conclusion": (
                "For this severity and unmet need, a risk-management strategy may render the "
                "liability acceptable — escalate to a benefit-risk committee."
                if risk["hard_stop"] and risk_tolerance >= 0.70
                else "Mitigation is required before the candidate is viable; the benefit does not "
                "currently justify the risk for this indication."
                if risk["hard_stop"]
                else "Risks appear manageable with standard measures."
            ),
        },
    ]

    headline = (
        "Benefit-risk: CONDITIONAL — the liability may be acceptable for this "
        f"{condition['severity']} indication with a risk-management strategy"
        if balance == "conditional"
        else "Benefit-risk: INDETERMINATE — the benefit term could not be quantified"
        if balance == "indeterminate"
        else f"Benefit-risk: {balance.upper()} for a {condition['severity']} indication "
        f"(risk tolerance {risk_tolerance * 100:.0f}/100)"
    )

    rationale = {
        "conditional": (
            f"The first-in-human readiness gate is {(gate or {}).get('recommendation')}, but under the FDA "
            f"Benefit-Risk Framework the severity and unmet need of this indication (risk "
            f"tolerance {risk_tolerance * 100:.0f}/100) mean the flagged liability is not "
            "automatically disqualifying. Approval precedent exists for serious diseases where a "
            "meaningful benefit is paired with a robust risk-management strategy. This is not an "
            "automatic advance: it requires the liability to be mitigated and the trade-off "
            "reviewed by a benefit-risk committee."
        ),
        "favorable": (
            f"The predicted benefit and the condition's risk tolerance ({risk_tolerance * 100:.0f}/100) "
            "outweigh the assessed risk level. The benefit-risk balance supports proceeding, "
            f"consistent with the readiness gate ({(gate or {}).get('recommendation')})."
        ),
        "unfavorable": (
            f"The predicted risk is not justified by the benefit for a {condition['severity']} "
            f"indication with {condition['unmet_need']} unmet need. Deprioritise unless the "
            "liability is removed or a higher-severity indication applies."
        ),
        "borderline": (
            f"Benefit and risk are finely balanced for this {condition['severity']} indication. "
            "Proceed only with the flagged endpoints de-risked; the trade-off is sensitive to the "
            "eventual clinical efficacy."
        ),
        "indeterminate": (
            "No molecule-specific benefit factor was derivable, so no balance is asserted. A "
            "measured target affinity and functional potency would make this assessable."
        ),
    }[balance]

    recommendation = {
        "conditional": "Escalate to benefit-risk review: define a risk-management strategy before any clinical commitment.",
        "favorable": "Benefit-risk supports progressing to first-in-human planning.",
        "unfavorable": "Benefit-risk does not support progression for this indication as it stands.",
        "borderline": "Progress only after de-risking the flagged endpoints; revisit with clinical efficacy data.",
        "indeterminate": "Obtain a measured target potency so the benefit term can be quantified.",
    }[balance]

    return {
        "available": True,
        "balance": balance,
        "headline": headline,
        "rationale": rationale,
        "recommendation": recommendation,
        "risk_tolerance": risk_tolerance,
        "severity": condition["severity"],
        "unmet_need": condition["unmet_need"],
        "condition": condition,
        "fda_context": fda_context,
        "benefit": benefit,
        "risk": risk,
        "balance_margin": margin,
        "diverges_from_readiness_gate": diverges,
        "dimensions": dimensions,
        "weights": {
            "severity": SEVERITY_WEIGHT,
            "unmet_need": UNMET_WEIGHT,
            "favourable_margin": FAVOURABLE_MARGIN,
        },
        "model": "FDA (2023) Benefit-Risk Assessment framework, five-dimension structure",
        "provenance": "regulatory framework over derived inputs + measured openFDA landscape",
        "limitations": (
            "Preclinical benefit-risk CONTEXT, not a regulatory determination. It informs "
            "prioritisation and does not override the first-in-human readiness gate or any "
            "safety stop. The condition classifier is a keyword prior over user-supplied text; "
            "an indication it does not recognise falls back to a neutral midpoint."
        ),
    }


__all__ = [
    "assess_benefit_risk",
    "classify_condition",
    "fetch_fda_condition_context",
]
