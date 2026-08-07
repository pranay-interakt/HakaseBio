"""Per-organ risk rollup — the data behind the target-organ body map.

The animal study already produces two independent per-organ facts:

  exposure   the PBPK tissue:plasma AUC ratio — does drug actually reach the
             organ at the doses studied?
  hazard     the mechanistic toxicology panel's hazard band for the domains
             that score that organ

Neither alone is a target-organ call. An organ is a *concern* only when a
flagged mechanism and meaningful exposure coincide; a flagged mechanism in an
unexposed organ is a weaker hypothesis, and an exposed organ with no flagged
mechanism is exposure without a hazard signal. This module makes that two-axis
combination explicit and names each cell of it, so the map the browser draws is
a rendering of a server-side determination rather than a browser-side one.

Nothing here is a new prediction: every value is read from the toxicology panel
or the biodistribution block that the pipeline already computed.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.biodistribution_engine import ORGAN_LABELS
from hakase_smallmol.l3.toxicology_engine import EXPOSED_TISSUE_RATIO

# Organs the body map can display, in anatomical reporting order. The key is the
# kernel compartment name so it joins directly onto the biodistribution rows.
MAPPED_ORGANS: tuple[str, ...] = (
    "brain",
    "lung",
    "heart",
    "liver",
    "spleen",
    "kidney",
    "gut",
    "muscle",
    "adipose",
    "skin",
)

# Hazard bands, ordered worst-first, for combining several domains on one organ.
_BAND_ORDER = ("high", "moderate", "low", "not_predicted")
_BAND_RANK = {band: index for index, band in enumerate(_BAND_ORDER)}


def _worst_band(bands: list[str]) -> str:
    if not bands:
        return "not_predicted"
    return min(bands, key=lambda b: _BAND_RANK.get(b, len(_BAND_ORDER)))


def _classify(band: str, exposed: bool | None) -> dict[str, str]:
    """The two-axis call: flagged mechanism × meaningful exposure."""
    flagged = band in {"high", "moderate"}
    if flagged and exposed is True:
        return {
            "call": "target_organ_of_concern",
            "call_label": "Target organ of concern",
            "call_basis": (
                "A mechanistic hazard is flagged for this organ and the simulated exposure "
                "reaches it at the doses studied."
            ),
        }
    if flagged and exposed is False:
        return {
            "call": "flagged_but_unexposed",
            "call_label": "Flagged mechanism, limited exposure",
            "call_basis": (
                "A mechanistic hazard is flagged, but simulated tissue exposure stays below the "
                f"{EXPOSED_TISSUE_RATIO:g}× plasma threshold, which weakens the hypothesis "
                "without excluding it."
            ),
        }
    if flagged:
        return {
            "call": "flagged_exposure_unknown",
            "call_label": "Flagged mechanism, exposure unresolved",
            "call_basis": "A mechanistic hazard is flagged but no tissue exposure was simulated for this organ.",
        }
    if exposed is True:
        return {
            "call": "exposed_no_signal",
            "call_label": "Exposed, no hazard signal",
            "call_basis": (
                "The organ is meaningfully exposed but no toxicology domain scoring it reached "
                "the moderate hazard threshold."
            ),
        }
    if band == "not_predicted":
        return {
            "call": "not_predicted",
            "call_label": "Not predicted",
            "call_basis": (
                "No model in the resolved panel scores a domain for this organ, so its hazard "
                "is unresolved rather than negative."
            ),
        }
    return {
        "call": "no_signal",
        "call_label": "No hazard signal",
        "call_basis": "No domain scoring this organ reached the moderate hazard threshold.",
    }


def compute_organ_risk(
    *,
    toxicology: dict[str, Any],
    biodistribution: dict[str, Any],
    safety_pharmacology: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Join the hazard panel and the biodistribution into per-organ rows."""
    domains = (toxicology or {}).get("domains") or []
    if not domains and not (biodistribution or {}).get("available"):
        return {
            "available": False,
            "reason": (
                "The organ map needs either a toxicology panel or a biodistribution simulation; "
                "neither was produced by this study."
            ),
        }

    # Exposure, from the top dose group (the exposure that drives toxicity) and
    # the cross-arm consensus ratio.
    per_arm = (biodistribution or {}).get("per_arm") or []
    top_arm = per_arm[-1] if per_arm else {}
    exposure_by_organ: dict[str, dict[str, Any]] = {}
    for row in (top_arm.get("tissues") or []):
        exposure_by_organ[row["organ"]] = row
    consensus_by_organ = {
        row["organ"]: row
        for row in ((biodistribution or {}).get("consensus_tissue_ranking") or [])
    }

    # Hazard domains, grouped by the organ each one scores.
    domains_by_organ: dict[str, list[dict[str, Any]]] = {}
    for domain in domains:
        organ = domain.get("organ")
        if not organ:
            continue
        domains_by_organ.setdefault(organ, []).append(domain)

    # Safety-pharmacology systems map onto the same figure.
    system_organ = {
        "Cardiovascular": "heart",
        "Central nervous system": "brain",
        "Respiratory": "lung",
    }
    sp_by_organ: dict[str, dict[str, Any]] = {}
    for system in ((safety_pharmacology or {}).get("systems") or []):
        organ = system_organ.get(system.get("system") or "")
        if organ:
            sp_by_organ[organ] = {
                "system": system.get("system"),
                "assessment": system.get("assessment"),
                "rationale": system.get("rationale"),
            }

    organs: list[dict[str, Any]] = []
    for organ in MAPPED_ORGANS:
        organ_domains = domains_by_organ.get(organ, [])
        bands = [d["hazard_call"]["level"] for d in organ_domains if d.get("hazard_call")]
        band = _worst_band(bands)
        exposure = exposure_by_organ.get(organ) or {}
        ratio = exposure.get("tissue_plasma_auc_ratio")
        exposed = None if ratio is None else bool(ratio >= EXPOSED_TISSUE_RATIO)
        classification = _classify(band, exposed)
        driving = max(
            (d for d in organ_domains if d["hazard_call"].get("driving_probability") is not None),
            key=lambda d: d["hazard_call"]["driving_probability"],
            default=None,
        )
        organs.append(
            {
                "organ": organ,
                "label": ORGAN_LABELS.get(organ, organ.title()),
                "hazard_level": band,
                "hazard_probability": (
                    driving["hazard_call"]["driving_probability"] if driving else None
                ),
                "driving_domain": driving["name"] if driving else None,
                "driving_endpoint": (
                    driving["hazard_call"].get("driving_endpoint") if driving else None
                ),
                "domains": [
                    {
                        "id": d.get("id"),
                        "name": d.get("name"),
                        "guideline": d.get("guideline"),
                        "hazard_level": d["hazard_call"]["level"],
                        "probability": d["hazard_call"].get("driving_probability"),
                        "mechanism": d.get("mechanism"),
                    }
                    for d in organ_domains
                ],
                "n_domains": len(organ_domains),
                "n_flagged_domains": sum(
                    1 for d in organ_domains if d["hazard_call"]["level"] in {"high", "moderate"}
                ),
                "exposure": {
                    "available": bool(exposure),
                    "arm": (top_arm.get("arm") or {}).get("label"),
                    "tissue_plasma_auc_ratio": ratio,
                    "consensus_tissue_plasma_ratio": (
                        consensus_by_organ.get(organ, {}).get("mean_tissue_plasma_ratio")
                    ),
                    "c_max_mg_per_l": exposure.get("c_max_median"),
                    "auc_mg_h_per_l": exposure.get("auc_median"),
                    "partitioning": exposure.get("partitioning"),
                    "meaningfully_exposed": exposed,
                    "threshold": EXPOSED_TISSUE_RATIO,
                },
                "safety_pharmacology": sp_by_organ.get(organ),
                **classification,
            }
        )

    concern = [o for o in organs if o["call"] == "target_organ_of_concern"]
    flagged_unexposed = [o for o in organs if o["call"] == "flagged_but_unexposed"]
    exposed_rank = sorted(
        (o for o in organs if o["exposure"]["tissue_plasma_auc_ratio"] is not None),
        key=lambda o: o["exposure"]["tissue_plasma_auc_ratio"],
        reverse=True,
    )

    # Domains that name no organ (genetic toxicology, carcinogenicity,
    # metabolic) still belong in the readout — they are systemic, not absent.
    systemic = [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "guideline": d.get("guideline"),
            "hazard_level": d["hazard_call"]["level"],
            "probability": d["hazard_call"].get("driving_probability"),
            "mechanism": d.get("mechanism"),
        }
        for d in domains
        if not d.get("organ")
    ]

    return {
        "available": True,
        "organs": organs,
        "mapped_organs": list(MAPPED_ORGANS),
        "systemic_domains": systemic,
        "summary": {
            "target_organs_of_concern": [o["label"] for o in concern],
            "flagged_but_unexposed": [o["label"] for o in flagged_unexposed],
            "highest_exposure_organ": exposed_rank[0]["label"] if exposed_rank else None,
            "n_organs_mapped": len(organs),
            "n_concern": len(concern),
            "n_systemic_domains_without_organ": len(systemic),
        },
        "exposure_threshold": EXPOSED_TISSUE_RATIO,
        "legend": [
            {"call": "target_organ_of_concern", "label": "Target organ of concern"},
            {"call": "flagged_but_unexposed", "label": "Flagged mechanism, limited exposure"},
            {"call": "flagged_exposure_unknown", "label": "Flagged mechanism, exposure unresolved"},
            {"call": "exposed_no_signal", "label": "Exposed, no hazard signal"},
            {"call": "no_signal", "label": "No hazard signal"},
            {"call": "not_predicted", "label": "Not predicted"},
        ],
        "model": (
            "Two-axis join of the mechanistic toxicology hazard panel and the PBPK "
            "biodistribution, at the top simulated dose group"
        ),
        "provenance": "derived (no new prediction; a join over existing L3 blocks)",
        "limitations": (
            "An organ shown without a hazard signal is an organ for which no model in the "
            "resolved panel raised one — that is not a demonstration of organ safety. Organs "
            "absent from the PBPK compartment set carry no exposure value and are shown as "
            "unresolved."
        ),
    }


__all__ = ["MAPPED_ORGANS", "compute_organ_risk"]
