"""IND-enabling readiness — the nonclinical checklist a regulator expects.

The first-in-human readiness gate in ``decision_engine`` answers a scientific
question: is the dose defensible and the margin adequate? This module answers
the *regulatory filing* question that sits beside it: has the nonclinical
package ICH M3(R2) requires actually been generated?

The distinction matters and is kept sharp. This platform simulates studies; it
does not run them. Every item below that requires an in-vivo GLP study is
therefore reported as **not satisfied by simulation**, with the simulated
evidence listed as supporting context rather than as a substitute. A checklist
that quietly marked a simulated study as "complete" would be the single most
dangerous thing this layer could do.

Regional variation is real and is encoded, not glossed: the four regions differ
in what they expect at the time of the first clinical-trial application.

  FDA    IND under 21 CFR 312; ICH M3(R2) nonclinical package
  EMA    CTA under Regulation (EU) 536/2014; EMA (2017) FIH guideline applies
         its own integrated risk assessment on top of M3(R2)
  PMDA   CTN under the Pharmaceuticals and Medical Devices Act; ICH M3(R2)
         adopted, with a Japanese-subject bridging expectation
  CDSCO  CT-NOC under the New Drugs and Clinical Trials Rules 2019, Schedule Y
         lineage; local nonclinical and, for imported new drugs, a local
         Phase-1 expectation
"""

from __future__ import annotations

from typing import Any

REGIONS: dict[str, dict[str, Any]] = {
    "FDA": {
        "id": "FDA",
        "name": "United States FDA",
        "application": "Investigational New Drug application (21 CFR 312)",
        "framework": "ICH M3(R2) nonclinical package; FDA (2005) starting-dose guidance",
        "region_specific": [
            "A 30-day IND review clock; dosing may begin if FDA does not place a clinical hold.",
            "Starting dose justified against the FDA (2005) HED/MRSD calculation.",
        ],
    },
    "EMA": {
        "id": "EMA",
        "name": "European Medicines Agency / national competent authorities",
        "application": "Clinical Trial Application under Regulation (EU) 536/2014 (CTIS)",
        "framework": "ICH M3(R2) plus EMA/CHMP/SWP/28367/07 Rev.1 (2017)",
        "region_specific": [
            "An integrated risk assessment covering mode of action, target and molecule is "
            "required in the protocol.",
            "MABEL must be derived independently of the NOAEL route and the lower value governs.",
            "Sentinel dosing and defined stopping rules are explicit protocol requirements.",
        ],
    },
    "PMDA": {
        "id": "PMDA",
        "name": "Japan PMDA",
        "application": "Clinical Trial Notification under the Pharmaceuticals and Medical Devices Act",
        "framework": "ICH M3(R2) as adopted in Japan",
        "region_specific": [
            "A 30-day CTN waiting period before first dosing.",
            "Ethnic-factor considerations (ICH E5) shape whether Japanese-subject data is "
            "expected in the first-in-human programme or bridged later.",
        ],
    },
    "CDSCO": {
        "id": "CDSCO",
        "name": "India CDSCO",
        "application": "Clinical trial permission under the New Drugs and Clinical Trials Rules, 2019",
        "framework": "ICH M3(R2) aligned; Schedule Y lineage nonclinical expectations",
        "region_specific": [
            "Nonclinical data expectations follow the New Drugs and Clinical Trials Rules 2019 "
            "schedules.",
            "For a new drug already approved elsewhere, a local Phase-1 study may be required "
            "unless waived.",
        ],
    },
}

# Each item states what the regulator expects and, separately, what this
# platform can and cannot contribute toward it.
CHECKLIST: tuple[dict[str, Any], ...] = (
    {
        "id": "repeat_dose_toxicity",
        "requirement": "GLP repeat-dose toxicity in one rodent and one non-rodent species, of at least the intended clinical duration",
        "guideline": "ICH M3(R2) §4",
        "satisfiable_by_simulation": False,
        "contribution": "The virtual study projects exposure and predicts hazard mechanisms for the design; it observes no findings.",
    },
    {
        "id": "toxicokinetics",
        "requirement": "Toxicokinetic exposure data at every dose level in the pivotal toxicity studies",
        "guideline": "ICH S3A",
        "satisfiable_by_simulation": False,
        "contribution": "A simulated TK table in the ICH S3A structure is produced, which pre-specifies the sampling and the exposure the study must confirm.",
    },
    {
        "id": "safety_pharmacology",
        "requirement": "Safety-pharmacology core battery: cardiovascular, central nervous and respiratory",
        "guideline": "ICH S7A",
        "satisfiable_by_simulation": False,
        "contribution": "The core battery is risk-assessed against simulated free exposure, which prioritises the in-vivo battery; it does not replace it.",
    },
    {
        "id": "herg_ic50",
        "requirement": "In-vitro IKr (hERG) assay with a measured IC50",
        "guideline": "ICH S7B",
        "satisfiable_by_simulation": False,
        "contribution": "The platform returns a hERG liability class and the IC50 each clinical dose would need to clear the 30× margin — a testable threshold, not a measurement.",
    },
    {
        "id": "genetic_toxicology",
        "requirement": "Genotoxicity battery: bacterial reverse mutation plus an in-vitro or in-vivo chromosomal-damage assay",
        "guideline": "ICH S2(R1)",
        "satisfiable_by_simulation": False,
        "contribution": "Ames and DNA-damage-response classifier outputs are reported as hazard signals for study prioritisation.",
    },
    {
        "id": "in_vitro_ddi",
        "requirement": "In-vitro CYP inhibition (reversible and time-dependent), induction, reaction phenotyping and a transporter panel",
        "guideline": "FDA (2020) In Vitro Drug Interaction Studies; EMA (2012)",
        "satisfiable_by_simulation": False,
        "contribution": "Isoform inhibitor/substrate calls and the required-Ki threshold at the simulated exposure are produced; potencies are not.",
    },
    {
        "id": "gmp_material",
        "requirement": "GMP-manufactured clinical trial material with a released specification and stability data",
        "guideline": "ICH Q7 / Q1A(R2)",
        "satisfiable_by_simulation": False,
        "contribution": "Outside this platform's scope entirely — no computational contribution.",
    },
    {
        "id": "starting_dose_justification",
        "requirement": "A justified starting dose derived from the nonclinical package",
        "guideline": "FDA (2005); EMA (2017)",
        "satisfiable_by_simulation": True,
        "contribution": "Computed here from both the NOAEL/HED route and MABEL, with the lower value governing.",
    },
    {
        "id": "exposure_margin",
        "requirement": "An exposure-based safety margin between the clinical starting dose and the animal point of departure",
        "guideline": "ICH M3(R2); EMA (2017)",
        "satisfiable_by_simulation": True,
        "contribution": "Computed here, with both exposures produced by the same PBPK engine.",
    },
    {
        "id": "escalation_and_stopping",
        "requirement": "A defined escalation scheme with explicit stopping rules and sentinel dosing",
        "guideline": "EMA (2017) §5",
        "satisfiable_by_simulation": True,
        "contribution": "The ladder, sentinel cohort and stopping-rule set are produced here as a protocol draft.",
    },
)


def _item_status(
    item: dict[str, Any], record: dict[str, Any]
) -> tuple[str, str]:
    """Resolve one checklist item against what this projection actually produced."""
    if not item["satisfiable_by_simulation"]:
        return (
            "requires_wet_lab",
            "This requirement can only be met by a physical study or manufacturing record. "
            "Nothing in this projection satisfies it.",
        )

    if item["id"] == "starting_dose_justification":
        starting = record.get("starting_dose") or {}
        if not starting.get("available"):
            return "not_met", starting.get("reason") or "No starting dose could be derived."
        approaches = {
            a["id"] for a in starting.get("approaches", []) if a.get("available")
        }
        if {"noael_hed", "mabel"} <= approaches:
            return (
                "computed",
                "Both the NOAEL/HED route and MABEL were derived independently and the lower "
                "value governs, as EMA guidance requires.",
            )
        return (
            "partially_computed",
            "Only one starting-dose approach could be computed; the regulator expects both to be "
            "derived and reconciled.",
        )

    if item["id"] == "exposure_margin":
        margins = record.get("exposure_margins") or {}
        if not margins.get("available"):
            return "not_met", margins.get("reason") or "No exposure margin could be computed."
        rows = margins.get("per_dose_level") or []
        first = rows[0] if rows else {}
        band = first.get("band")
        return (
            ("computed" if band in {"comfortable", "modest"} else "partially_computed"),
            f"The starting dose carries a {first.get('limiting_margin')}× limiting margin "
            f"({band}) to the animal point of departure — computed against a projected, not a "
            "measured, animal exposure.",
        )

    trial_design = record.get("trial_design") or {}
    sad = trial_design.get("sad") or {}
    rules = trial_design.get("stopping_rules") or {}
    if sad.get("available") and rules.get("available"):
        return (
            "computed",
            f"A {len(sad.get('cohorts') or [])}-cohort escalation with sentinel dosing and "
            f"{len(rules.get('rules') or [])} stopping rules was drafted.",
        )
    return "not_met", "No escalation design or stopping-rule set was produced."


def evaluate_ind_gate(
    record: dict[str, Any],
    *,
    region: str = "FDA",
    declared_complete: dict[str, bool] | None = None,
    override_justification: str | None = None,
) -> dict[str, Any]:
    """The IND/CTA-enabling checklist for this projection, in one region.

    ``declared_complete`` lets a sponsor attest that a wet-lab item has been
    generated outside this platform. An attestation is recorded as an
    attestation — it is stamped with its origin and never presented as evidence
    the platform produced.
    """
    region_key = (region or "FDA").strip().upper()
    if region_key not in REGIONS:
        raise ValueError(
            f"region must be one of {', '.join(REGIONS)}; received {region!r}."
        )
    spec = REGIONS[region_key]
    declared = {k: bool(v) for k, v in (declared_complete or {}).items()}

    items: list[dict[str, Any]] = []
    for item in CHECKLIST:
        status, rationale = _item_status(item, record)
        attested = declared.get(item["id"], False)
        if attested and status == "requires_wet_lab":
            status = "attested_complete"
            rationale = (
                "The sponsor has attested that this study exists outside this platform. The "
                "attestation is recorded; no data supporting it has been verified here."
            )
        items.append(
            {
                **item,
                "status": status,
                "rationale": rationale,
                "sponsor_attested": attested,
            }
        )

    outstanding = [i for i in items if i["status"] in {"requires_wet_lab", "not_met"}]
    partial = [i for i in items if i["status"] == "partially_computed"]
    wet_lab_outstanding = [i for i in outstanding if i["status"] == "requires_wet_lab"]

    justification = (override_justification or "").strip()
    override_valid = bool(justification) and len(justification) >= 20

    if not outstanding and not partial:
        recommendation = "PACKAGE-COMPLETE-AS-ATTESTED"
        headline = (
            "Every checklist item is either computed here or attested complete by the sponsor. "
            "The attested items have not been verified by this platform."
        )
    elif wet_lab_outstanding:
        recommendation = "NOT-FILEABLE"
        headline = (
            f"{len(wet_lab_outstanding)} nonclinical requirement(s) can only be met by a physical "
            f"study and are neither generated nor attested. A {spec['application']} cannot be "
            "assembled from simulation alone."
        )
    elif outstanding:
        recommendation = "NOT-FILEABLE"
        headline = (
            f"{len(outstanding)} computable requirement(s) could not be produced by this "
            "projection."
        )
    else:
        recommendation = "COMPUTED-ITEMS-CONDITIONAL"
        headline = (
            f"{len(partial)} computed item(s) are weaker than the guideline expects and must be "
            "strengthened before filing."
        )

    return {
        "available": True,
        "region": spec,
        "recommendation": recommendation,
        "headline": headline,
        "items": items,
        "summary": {
            "n_items": len(items),
            "n_computed": sum(1 for i in items if i["status"] == "computed"),
            "n_partially_computed": len(partial),
            "n_attested": sum(1 for i in items if i["status"] == "attested_complete"),
            "n_requiring_wet_lab": len(wet_lab_outstanding),
            "outstanding": [i["requirement"] for i in outstanding],
        },
        "override": {
            "supplied": bool(justification),
            "valid": override_valid,
            "justification": justification or None,
            "effect": (
                "None. An override records a sponsor's rationale for proceeding; it cannot make "
                "an ungenerated nonclinical study exist, and it does not change the "
                "recommendation."
            ),
            "note": (
                None
                if not justification or override_valid
                else "An override justification must be at least 20 characters to be recorded."
            ),
        },
        "model": "ICH M3(R2) nonclinical checklist with regional application requirements",
        "provenance": "regulatory requirement mapping over the projection record",
        "limitations": (
            "A completeness checklist, not a regulatory opinion. It reflects what this projection "
            "generated and what a sponsor attested; it does not review study quality, GLP status, "
            "or data integrity, and it is not a substitute for regulatory advice."
        ),
    }


__all__ = ["CHECKLIST", "REGIONS", "evaluate_ind_gate"]
