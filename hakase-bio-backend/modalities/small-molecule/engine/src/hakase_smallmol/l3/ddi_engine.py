"""Drug–drug interaction risk: the compound as perpetrator and as victim.

FDA's 2020 in-vitro DDI guidance turns CYP inhibition into a clinical question
through the basic model ``R1 = 1 + [I]/Ki`` — an interaction is worth studying
when R1 ≥ 1.02 for a hepatic interaction, or when the gut concentration is large
relative to the inhibition constant for an intestinal one.

This module can supply ``[I]`` honestly, because the PBPK cohort produces the
unbound hepatic-inlet and systemic concentrations. It cannot supply ``Ki``: the
CYP models in this platform are qHTS *classifiers* trained on a binary
inhibitor call at 10 µM, not potency regressions. So the module reports:

  • the per-isoform inhibitor probability with its provenance (perpetrator risk)
  • the unbound concentrations that would enter the basic model
  • the Ki that would be needed for the interaction to clear the R1 cut-off —
    the exact number the follow-up in-vitro study has to beat
  • the victim-side exposure risk from the substrate calls and the modelled
    fraction of clearance that is hepatic

No R1 value is reported without a real Ki, and no Ki is invented.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.model_panel import (
    CYP_INHIBITION_ENDPOINTS,
    CYP_SUBSTRATE_ENDPOINTS,
    ModelPanel,
)

# FDA (2020) In Vitro Drug Interaction Studies — basic-model cut-offs.
R1_CUTOFF = 1.02  # hepatic reversible inhibition
R1_GUT_CUTOFF = 11.0  # intestinal CYP3A reversible inhibition
INHIBITOR_PROBABILITY_THRESHOLD = 0.5

ISOFORM_CONTEXT: dict[str, dict[str, str]] = {
    "CYP1A2_Veith": {
        "isoform": "CYP1A2",
        "clinical_note": "Substrates include theophylline, tizanidine, duloxetine, clozapine.",
    },
    "CYP2C19_Veith": {
        "isoform": "CYP2C19",
        "clinical_note": "Substrates include omeprazole, clopidogrel (prodrug), voriconazole.",
    },
    "CYP2C9_Veith": {
        "isoform": "CYP2C9",
        "clinical_note": "Substrates include S-warfarin, phenytoin, NSAIDs — narrow therapeutic index.",
    },
    "CYP2D6_Veith": {
        "isoform": "CYP2D6",
        "clinical_note": "Substrates include metoprolol, codeine (prodrug), many antidepressants; polymorphic.",
    },
    "CYP3A4_Veith": {
        "isoform": "CYP3A4",
        "clinical_note": "Metabolises roughly half of marketed drugs — the broadest DDI exposure.",
    },
}

SUBSTRATE_CONTEXT: dict[str, str] = {
    "CYP2C9_Substrate_CarbonMangels": "CYP2C9",
    "CYP2D6_Substrate_CarbonMangels": "CYP2D6",
    "CYP3A4_Substrate_CarbonMangels": "CYP3A4",
}


def _unbound_concentrations(
    arm_result: dict[str, Any], mw_g_per_mol: float | None
) -> dict[str, Any]:
    """Unbound systemic and hepatic concentrations in µM, from the cohort."""
    if not (mw_g_per_mol and mw_g_per_mol > 0):
        return {"available": False, "reason": "Molecular weight is required for µM conversion."}
    endpoints = ((arm_result.get("cohort") or {}).get("endpoints") or {})
    plasma = endpoints.get("plasma") or {}
    liver = endpoints.get("liver") or {}
    gut = endpoints.get("gut") or {}
    fu = (((arm_result.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
    c_max = (plasma.get("c_max") or {}).get("median")
    if not isinstance(c_max, (int, float)) or not isinstance(fu, (int, float)):
        return {
            "available": False,
            "reason": "The arm did not return both a plasma Cmax and an unbound fraction.",
        }
    to_uM = 1000.0 / mw_g_per_mol

    def free_uM(block: Any) -> float | None:
        v = (block or {}).get("c_max", {}).get("median")
        if isinstance(v, (int, float)):
            return round(float(v) * float(fu) * to_uM, 6)
        return None

    return {
        "available": True,
        "fu_plasma": round(float(fu), 5),
        "systemic_unbound_cmax_uM": round(float(c_max) * float(fu) * to_uM, 6),
        "hepatic_unbound_cmax_uM": free_uM(liver),
        "gut_unbound_cmax_uM": free_uM(gut),
        "note": (
            "Unbound concentrations from the PBPK cohort at the reference arm. The hepatic "
            "value is the liver-compartment concentration corrected by the plasma unbound "
            "fraction — it is not the hepatic inlet concentration used by the FDA static "
            "model, which additionally requires the absorption rate and portal blood flow."
        ),
    }


def _perpetrator(panel: ModelPanel, concentrations: dict[str, Any]) -> list[dict[str, Any]]:
    """Per-isoform inhibition risk with the Ki that would matter clinically."""
    i_uM = concentrations.get("systemic_unbound_cmax_uM")
    rows: list[dict[str, Any]] = []
    for endpoint in CYP_INHIBITION_ENDPOINTS:
        entry = panel.endpoints.get(endpoint)
        context = ISOFORM_CONTEXT.get(endpoint, {})
        if not entry or entry.get("value") is None:
            rows.append(
                {
                    "isoform": context.get("isoform", endpoint),
                    "endpoint": endpoint,
                    "available": False,
                    "reason": "No inhibition model output was available for this isoform.",
                }
            )
            continue
        prob = max(0.0, min(1.0, float(entry["value"])))
        row: dict[str, Any] = {
            "isoform": context.get("isoform", endpoint),
            "endpoint": endpoint,
            "available": True,
            "inhibitor_probability": round(prob, 4),
            "call": "likely inhibitor" if prob >= INHIBITOR_PROBABILITY_THRESHOLD else "unlikely inhibitor",
            "risk": "high" if prob >= 0.7 else ("moderate" if prob >= 0.4 else "low"),
            "model": entry.get("model"),
            "provenance": entry.get("provenance"),
            "source": entry.get("source"),
            "clinical_note": context.get("clinical_note"),
            "assay_cutoff": "Binary inhibitor call at 10 µM (TDC/PubChem Veith qHTS).",
        }
        if isinstance(i_uM, (int, float)) and i_uM > 0:
            # R1 = 1 + [I]/Ki ≥ cutoff  ⇔  Ki ≤ [I] / (cutoff − 1)
            row["ki_threshold_uM_for_r1_cutoff"] = round(i_uM / (R1_CUTOFF - 1.0), 4)
            row["basic_model_statement"] = (
                f"With unbound [I] = {i_uM:.3g} µM, the FDA basic model flags a hepatic "
                f"interaction (R1 ≥ {R1_CUTOFF}) for any measured Ki below "
                f"{i_uM / (R1_CUTOFF - 1.0):.3g} µM."
            )
        rows.append(row)
    return rows


def _victim(panel: ModelPanel, arm_result: dict[str, Any]) -> dict[str, Any]:
    """Exposure risk when a co-medication perturbs this compound's clearance."""
    substrates = []
    for endpoint in CYP_SUBSTRATE_ENDPOINTS:
        entry = panel.endpoints.get(endpoint)
        isoform = SUBSTRATE_CONTEXT.get(endpoint, endpoint)
        if not entry or entry.get("value") is None:
            substrates.append(
                {"isoform": isoform, "available": False, "reason": "No substrate model output."}
            )
            continue
        prob = max(0.0, min(1.0, float(entry["value"])))
        substrates.append(
            {
                "isoform": isoform,
                "available": True,
                "substrate_probability": round(prob, 4),
                "call": "likely substrate" if prob >= 0.5 else "unlikely substrate",
                "model": entry.get("model"),
                "provenance": entry.get("provenance"),
            }
        )
    disposition = arm_result.get("disposition") or {}

    def q(name: str) -> float | None:
        v = (disposition.get(name) or {}).get("value")
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    hepatic, total = q("cl_hepatic"), q("cl_total")
    fm_hepatic = (hepatic / total) if (hepatic is not None and total) else None
    block: dict[str, Any] = {
        "substrate_calls": substrates,
        "fraction_cleared_hepatically": round(fm_hepatic, 4) if fm_hepatic is not None else None,
        "extraction_ratio": q("extraction_ratio"),
        "hepatic_first_pass": q("hepatic_first_pass"),
        "provenance": "ml + derived",
    }
    likely = [s for s in substrates if s.get("call") == "likely substrate"]
    if fm_hepatic is not None and fm_hepatic >= 0.7 and likely:
        block["risk"] = "high"
        block["rationale"] = (
            f"{fm_hepatic:.0%} of clearance is hepatic and the compound is called a substrate of "
            f"{', '.join(s['isoform'] for s in likely)}; a strong inhibitor of that isoform could "
            "raise exposure substantially."
        )
    elif likely:
        block["risk"] = "moderate"
        block["rationale"] = (
            f"Called a substrate of {', '.join(s['isoform'] for s in likely)}, but hepatic "
            "metabolism is not the dominant clearance route, which limits the interaction."
        )
    elif any(s.get("available") for s in substrates):
        block["risk"] = "low"
        block["rationale"] = "No CYP substrate call reached the 0.5 threshold."
    else:
        block["risk"] = "not_predicted"
        block["rationale"] = "No CYP substrate model output was available."
    block["limitation"] = (
        "fm,CYP — the fraction of clearance carried by an individual isoform — is not modelled. "
        "Reaction phenotyping in human hepatocytes with selective inhibitors is required before "
        "a quantitative victim-DDI prediction can be made."
    )
    return block


def compute_ddi(
    *,
    panel: ModelPanel,
    arm_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Perpetrator and victim DDI assessment at the top simulated exposure."""
    top = next((a for a in reversed(arm_results) if a.get("available")), None)
    if not top:
        return {
            "available": False,
            "reason": "No dose group produced an exposure simulation to reference.",
        }
    concentrations = _unbound_concentrations(top, panel.mw_g_per_mol)
    perpetrator = _perpetrator(panel, concentrations)
    victim = _victim(panel, top)
    flagged = [
        r for r in perpetrator if r.get("available") and r["inhibitor_probability"] >= 0.5
    ]
    return {
        "available": True,
        "reference_arm": (top.get("arm") or {}).get("label"),
        "concentrations": concentrations,
        "perpetrator": {
            "isoforms": perpetrator,
            "flagged_isoforms": [r["isoform"] for r in flagged],
            "highest_risk": (
                max(
                    (r for r in perpetrator if r.get("available")),
                    key=lambda r: r["inhibitor_probability"],
                    default={},
                ).get("isoform")
            ),
            "cutoffs": {"hepatic_R1": R1_CUTOFF, "intestinal_R1_CYP3A": R1_GUT_CUTOFF},
        },
        "victim": victim,
        "transporters": {
            "pgp_substrate_probability": panel.probability("Pgp_Broccatelli"),
            "note": (
                "P-gp substrate status is predicted; OATP1B1/1B3, BCRP, OAT/OCT and MATE "
                "interactions are not modelled and require the standard in-vitro transporter "
                "panel under FDA 2020 / EMA 2012 guidance."
            ),
        },
        "recommended_studies": [
            "Reversible and time-dependent CYP inhibition (Ki, KI/kinact) across the seven-isoform panel",
            "CYP induction in cryopreserved human hepatocytes (mRNA for CYP1A2, 2B6, 3A4)",
            "Reaction phenotyping to establish fm,CYP",
            "Transporter substrate and inhibition panel (P-gp, BCRP, OATP1B1/1B3, OAT1/3, OCT2, MATE1/2-K)",
        ],
        "model": "FDA (2020) In Vitro Drug Interaction Studies basic model, over PBPK unbound exposure",
        "provenance": "ml (classifier calls) + derived (exposure)",
        "limitations": (
            "The CYP models return a binary inhibitor call at a 10 µM qHTS cut-off, not a Ki, so "
            "no R1 value is computed. The module instead reports the Ki threshold that would "
            "trigger the regulatory cut-off at the simulated exposure — the number the in-vitro "
            "study must resolve. Time-dependent inhibition and induction are not predicted."
        ),
    }


__all__ = ["R1_CUTOFF", "R1_GUT_CUTOFF", "compute_ddi"]
