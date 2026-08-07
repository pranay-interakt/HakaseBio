"""RDKit structural-alert screen for in-vitro assay reliability.

This module intentionally reports only RDKit's built-in PAINS and Brenk
catalogue matches.  It does not turn a substructure match into a biological
claim, and it does not use invented aggregation, fluorescence, or redox rules.
"""

from __future__ import annotations

from typing import Any

from rdkit import Chem, rdBase
from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams


def _create_filter_catalog(catalog_type: FilterCatalogParams.FilterCatalogs) -> FilterCatalog:
    params = FilterCatalogParams()
    params.AddCatalog(catalog_type)
    return FilterCatalog(params)


# Construct these once when the process imports the module, never per request.
PAINS_CATALOG = _create_filter_catalog(FilterCatalogParams.FilterCatalogs.PAINS)
BRENK_CATALOG = _create_filter_catalog(FilterCatalogParams.FilterCatalogs.BRENK)

# Versioned extension point.  It stays deliberately empty until every rule has
# a reviewed SMARTS, source and recommended confirmation experiment.
CUSTOM_ALERTS: list[dict[str, str]] = []
_VALID_SEVERITIES = {"low", "moderate", "high"}


def validate_custom_alerts(alerts: list[dict[str, str]]) -> list[dict[str, str]]:
    """Validate reviewed configuration without allowing improvised alerts."""
    cleaned: list[dict[str, str]] = []
    for alert in alerts:
        required = (
            "id",
            "name",
            "smarts",
            "category",
            "severity",
            "source",
            "source_url",
            "description",
            "recommendation",
        )
        missing = [key for key in required if not str(alert.get(key, "")).strip()]
        if missing:
            raise ValueError(f"Custom alert is missing required fields: {', '.join(missing)}")
        if alert["severity"] not in _VALID_SEVERITIES:
            raise ValueError(
                f"Custom alert {alert['id']} has invalid severity {alert['severity']!r}"
            )
        if Chem.MolFromSmarts(alert["smarts"]) is None:
            raise ValueError(f"Custom alert {alert['id']} contains invalid SMARTS")
        cleaned.append(dict(alert))
    return cleaned


_VALIDATED_CUSTOM_ALERTS = validate_custom_alerts(CUSTOM_ALERTS)


def _catalog_matches(catalog: FilterCatalog, molecule: Chem.Mol) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for entry in catalog.GetMatches(molecule):
        # FilterCatalogEntry is not an RDKit molecule and does not expose
        # HasProp().  GetProp raises for catalogues without FilterSet metadata.
        try:
            catalog_name = entry.GetProp("FilterSet")
        except (KeyError, RuntimeError):
            catalog_name = "RDKit FilterCatalog"
        matches.append({"name": entry.GetDescription(), "catalog": catalog_name})
    return matches


def _custom_matches(molecule: Chem.Mol) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for alert in _VALIDATED_CUSTOM_ALERTS:
        pattern = Chem.MolFromSmarts(alert["smarts"])
        if pattern is not None and molecule.HasSubstructMatch(pattern):
            matches.append({key: value for key, value in alert.items() if key != "smarts"})
    return matches


def assess_assay_reliability(canonical_smiles: str) -> dict[str, Any]:
    """Run an actual local RDKit PAINS/Brenk screen for a validated structure."""
    molecule = Chem.MolFromSmiles(canonical_smiles)
    if molecule is None:
        return {
            "status": "failed",
            "reason": "RDKit could not parse the canonical SMILES for structural-alert screening.",
            "tool": {
                "name": "RDKit FilterCatalog",
                "rdkit_version": rdBase.rdkitVersion,
                "catalogs": ["PAINS", "BRENK"],
            },
        }

    pains = _catalog_matches(PAINS_CATALOG, molecule)
    brenk = _catalog_matches(BRENK_CATALOG, molecule)
    custom = _custom_matches(molecule)
    count = len(pains) + len(brenk) + len(custom)
    level = "low" if count == 0 else "moderate" if count <= 2 else "high"
    interpretation = (
        "No built-in PAINS or Brenk structural alerts were detected."
        if count == 0
        else "RDKit structural alerts were detected; use the listed orthogonal controls before interpreting an in-vitro signal."
    )
    alert_names = [
        str(alert.get("name", "")).lower().replace(" ", "_") for alert in [*pains, *brenk, *custom]
    ]
    controls = (
        []
        if count == 0
        else [
            "Repeat the primary assay with an orthogonal readout.",
            "Include concentration-response and counterscreen controls appropriate to the assay format.",
        ]
    )
    if "phenol_ester" in alert_names:
        controls = [
            "Review chemical stability and hydrolysis under assay conditions.",
            "Run a concentration-response experiment.",
            "Confirm the signal with an orthogonal assay.",
        ]
    return {
        "status": "completed",
        "tool": {
            "name": "RDKit FilterCatalog",
            "rdkit_version": rdBase.rdkitVersion,
            "catalogs": ["PAINS", "BRENK"],
        },
        "overall_alert_level": level,
        "display_summary": (
            f"{count} structural alert" if count == 1 else f"{count} structural alerts"
        ),
        "display_recommendation": (
            "Review recommended" if count else "No structural-alert review triggered"
        ),
        "display_rule": "Application display heuristic: low = 0 alerts; moderate = 1–2; high = more than 2. This is not a validated scientific risk model.",
        "pains": {"count": len(pains), "alerts": pains},
        "brenk": {"count": len(brenk), "alerts": brenk},
        "custom_alerts": {"count": len(custom), "alerts": custom, "configuration_version": "1"},
        "interpretation": interpretation,
        "recommended_controls": controls,
        "limitations": [
            "The absence of structural alerts does not prove that the molecule is free from assay interference or toxicity.",
            "A structural-alert match indicates potential risk and is not experimental confirmation.",
        ],
    }
