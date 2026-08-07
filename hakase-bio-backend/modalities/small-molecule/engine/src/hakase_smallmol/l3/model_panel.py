"""One normalised view of every predictor the animal-outcome engines consume.

The L3 outcome engines (toxicology, clinical pathology, safety pharmacology,
DDI) all need the same underlying model outputs. Re-running ADMET-AI, Tox21 and
the CYP panel once per engine would be both slow and — worse — could produce
*different* numbers in different blocks of the same report. This module resolves
each endpoint exactly once, preferring the immutable L1 record over a fresh
inference, and hands every engine the same normalised bundle.

Resolution order per endpoint (never silently swapped):
  1. the persisted L1 analysis record (``admet_ai_endpoints`` / ``safety_assessments``)
  2. a live call to the owning model adapter
  3. ``None`` with a recorded reason — never a substituted value

Every entry carries ``{value, source, model, provenance}`` so a report can state
where each number came from.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# ADMET-AI endpoints the animal-outcome engines read, grouped by what they drive.
ACUTE_ENDPOINT = "LD50_Zhu"
TOX21_ENDPOINTS = (
    "NR-AR",
    "NR-AR-LBD",
    "NR-AhR",
    "NR-Aromatase",
    "NR-ER",
    "NR-ER-LBD",
    "NR-PPAR-gamma",
    "SR-ARE",
    "SR-ATAD5",
    "SR-HSE",
    "SR-MMP",
    "SR-p53",
)
CYP_INHIBITION_ENDPOINTS = (
    "CYP1A2_Veith",
    "CYP2C19_Veith",
    "CYP2C9_Veith",
    "CYP2D6_Veith",
    "CYP3A4_Veith",
)
CYP_SUBSTRATE_ENDPOINTS = (
    "CYP2C9_Substrate_CarbonMangels",
    "CYP2D6_Substrate_CarbonMangels",
    "CYP3A4_Substrate_CarbonMangels",
)
HAZARD_ENDPOINTS = (
    "AMES",
    "hERG",
    "DILI",
    "ClinTox",
    "Carcinogens_Lagunin",
    "Skin_Reaction",
)
DISPOSITION_ENDPOINTS = (
    "BBB_Martins",
    "PPBR_AZ",
    "Pgp_Broccatelli",
    "HIA_Hou",
    "Bioavailability_Ma",
    "Solubility_AqSolDB",
    "Caco2_Wang",
    "Half_Life_Obach",
    "VDss_Lombardo",
    "Clearance_Hepatocyte_AZ",
    "Clearance_Microsome_AZ",
)


@dataclass
class ModelPanel:
    """Normalised predictor bundle shared by every L3 outcome engine."""

    smiles: str
    mw_g_per_mol: float | None = None
    endpoints: dict[str, dict[str, Any]] = field(default_factory=dict)
    bsep: dict[str, Any] | None = None
    reactive_metabolites: dict[str, Any] | None = None
    unresolved: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)

    def value(self, endpoint: str) -> float | None:
        entry = self.endpoints.get(endpoint) or {}
        v = entry.get("value")
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def entry(self, endpoint: str) -> dict[str, Any]:
        return self.endpoints.get(endpoint) or {
            "value": None,
            "available": False,
            "reason": "Endpoint was not produced by any available model.",
        }

    def probability(self, endpoint: str) -> float | None:
        """A classifier endpoint clamped to [0, 1]; None when unavailable."""
        v = self.value(endpoint)
        if v is None or not math.isfinite(v):
            return None
        return max(0.0, min(1.0, v))

    def to_dict(self) -> dict[str, Any]:
        return {
            "mw_g_per_mol": self.mw_g_per_mol,
            "endpoints": self.endpoints,
            "bsep": self.bsep,
            "reactive_metabolites": self.reactive_metabolites,
            "unresolved": sorted(self.unresolved),
            "sources": sorted(set(self.sources)),
        }


ALL_ENDPOINTS: tuple[str, ...] = (
    (ACUTE_ENDPOINT,)
    + TOX21_ENDPOINTS
    + CYP_INHIBITION_ENDPOINTS
    + CYP_SUBSTRATE_ENDPOINTS
    + HAZARD_ENDPOINTS
    + DISPOSITION_ENDPOINTS
)


def _from_l1_record(analysis: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Read every wanted endpoint straight out of the persisted L1 record."""
    out: dict[str, dict[str, Any]] = {}
    stored = analysis.get("admet_ai_endpoints") or {}
    for endpoint in ALL_ENDPOINTS:
        block = stored.get(endpoint)
        if not isinstance(block, dict):
            continue
        value = block.get("model_value")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        out[endpoint] = {
            "value": float(value),
            "available": True,
            "source": "l1_record",
            "model": block.get("source") or "ADMET-AI",
            "provenance": "ml (Layer-1 handoff)",
            "assessment": (block.get("assessment") or {}).get("status"),
        }
    return out


def _live_admet(smiles: str, wanted: list[str]) -> dict[str, dict[str, Any]]:
    """Fill gaps with a single live ADMET-AI inference (one call, not per-endpoint)."""
    if not wanted:
        return {}
    try:
        from hakase_smallmol.admet.admet_ml import predict_admet_ml

        res = predict_admet_ml(smiles)
    except Exception:  # noqa: BLE001
        return {}
    endpoints = (res or {}).get("endpoints") or {}
    out: dict[str, dict[str, Any]] = {}
    for endpoint in wanted:
        value = endpoints.get(endpoint)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[endpoint] = {
                "value": float(value),
                "available": True,
                "source": "live_model",
                "model": "ADMET-AI (Chemprop-RDKit ensemble)",
                "provenance": "ml",
            }
    return out


def _live_tox21(smiles: str, wanted: list[str]) -> dict[str, dict[str, Any]]:
    """Fill remaining Tox21 heads from the in-house calibrated Tox21-ML panel."""
    if not wanted:
        return {}
    try:
        from hakase_smallmol.safety.tox21_ml import predict_tox21_panel

        res = predict_tox21_panel(smiles)
    except Exception:  # noqa: BLE001
        return {}
    by_assay = {
        str(head.get("assay")): head
        for head in ((res or {}).get("panel") or [])
        if isinstance(head, dict)
    }
    out: dict[str, dict[str, Any]] = {}
    for endpoint in wanted:
        block = by_assay.get(endpoint)
        if not isinstance(block, dict):
            continue
        prob = block.get("active_probability")
        if isinstance(prob, (int, float)) and not isinstance(prob, bool):
            out[endpoint] = {
                "value": float(prob),
                "available": True,
                "source": "live_model",
                "model": "Hakase Tox21-ML (calibrated RF + conformal veto)",
                "provenance": "ml",
                "flagged": bool(block.get("active_flag")),
                "pathway": block.get("pathway"),
                "in_domain": (block.get("applicability_domain") or {}).get("ad_in_domain"),
            }
    return out


def _live_cyp(smiles: str, wanted: list[str]) -> dict[str, dict[str, Any]]:
    """Fill CYP2C9/2D6/3A4 inhibition gaps from the dedicated CYP-ML triad."""
    mapping = {
        "CYP2C9_Veith": "CYP2C9",
        "CYP2D6_Veith": "CYP2D6",
        "CYP3A4_Veith": "CYP3A4",
    }
    needed = [e for e in wanted if e in mapping]
    if not needed:
        return {}
    try:
        from hakase_smallmol.admet.cyp_inhibition_ml import predict_cyp_inhibition_ml

        res = predict_cyp_inhibition_ml(smiles)
    except Exception:  # noqa: BLE001
        return {}
    isoforms = (res or {}).get("per_isoform") or {}
    out: dict[str, dict[str, Any]] = {}
    for endpoint in needed:
        envelope = isoforms.get(mapping[endpoint])
        if not isinstance(envelope, dict):
            continue
        block = envelope.get("prediction") or {}
        prob = block.get("inhibitor_probability")
        if isinstance(prob, (int, float)) and not isinstance(prob, bool):
            out[endpoint] = {
                "value": float(prob),
                "available": True,
                "source": "live_model",
                "model": "Hakase CYP-inhibition-ML (TDC Veith RF)",
                "provenance": "ml",
            }
    return out


def collect_panel(
    smiles: str,
    analysis: dict[str, Any] | None = None,
    *,
    allow_live: bool = True,
) -> ModelPanel:
    """Resolve every endpoint the outcome engines need, L1 record first."""
    panel = ModelPanel(smiles=smiles)

    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            panel.mw_g_per_mol = float(Descriptors.MolWt(mol))
    except Exception:  # noqa: BLE001
        panel.mw_g_per_mol = None

    if analysis:
        resolved = _from_l1_record(analysis)
        if resolved:
            panel.sources.append("Layer-1 persisted analysis")
        panel.endpoints.update(resolved)

    if allow_live:
        missing = [e for e in ALL_ENDPOINTS if e not in panel.endpoints]
        for filler, label in (
            (_live_admet, "ADMET-AI (live)"),
            (_live_tox21, "Tox21-ML (live)"),
            (_live_cyp, "CYP-inhibition-ML (live)"),
        ):
            if not missing:
                break
            got = filler(smiles, missing)
            if got:
                panel.sources.append(label)
                panel.endpoints.update(got)
                missing = [e for e in missing if e not in panel.endpoints]
        panel.unresolved = missing

        try:
            from hakase_smallmol.admet.bsep import predict_bsep

            panel.bsep = predict_bsep(smiles)
            panel.sources.append("BSEP / phospholipidosis structural alerts")
        except Exception:  # noqa: BLE001
            panel.bsep = None
        try:
            from hakase_smallmol.safety.reactive_metabolites import predict_reactive_metabolites

            panel.reactive_metabolites = predict_reactive_metabolites(smiles)
            panel.sources.append("Reactive-metabolite structural alerts")
        except Exception:  # noqa: BLE001
            panel.reactive_metabolites = None
    else:
        panel.unresolved = [e for e in ALL_ENDPOINTS if e not in panel.endpoints]

    return panel


def ld50_mg_per_kg(panel: ModelPanel) -> dict[str, Any]:
    """Convert the ADMET-AI LD50_Zhu prediction to mg/kg.

    TDC's ``LD50_Zhu`` regression target is the rat acute oral LD50 expressed as
    ``log10(1 / (mol/kg))``. The mass-basis conversion is therefore

        LD50 [mg/kg] = 10**(-Y) * MW [g/mol] * 1000

    It needs a molecular weight; without one the value is returned unconverted
    rather than guessed.
    """
    y = panel.value(ACUTE_ENDPOINT)
    if y is None:
        return {
            "available": False,
            "reason": "No LD50_Zhu prediction was produced for this structure.",
        }
    mw = panel.mw_g_per_mol
    if not (mw and mw > 0):
        return {
            "available": False,
            "reason": "Molecular weight is required to convert LD50_Zhu to mg/kg.",
            "ld50_log_inv_mol_per_kg": y,
        }
    try:
        mg_kg = (10.0 ** (-y)) * mw * 1000.0
    except OverflowError:
        return {"available": False, "reason": "LD50 conversion overflowed."}
    entry = panel.entry(ACUTE_ENDPOINT)
    return {
        "available": True,
        "ld50_mg_kg": round(mg_kg, 2),
        "ld50_log_inv_mol_per_kg": y,
        "species_route": "rat, oral (the LD50_Zhu training corpus)",
        "ghs_category": _ghs_category(mg_kg),
        "model": entry.get("model") or "ADMET-AI LD50_Zhu",
        "provenance": entry.get("provenance") or "ml",
        "source": entry.get("source"),
        "limitations": (
            "A regression prediction of the rat oral LD50, not a measured value. GHS banding is "
            "the published UN GHS acute-oral classification applied to the predicted number."
        ),
    }


def _ghs_category(mg_kg: float) -> str:
    """UN GHS acute oral toxicity category (published cut-offs)."""
    if mg_kg <= 5:
        return "Category 1 (fatal if swallowed)"
    if mg_kg <= 50:
        return "Category 2 (fatal if swallowed)"
    if mg_kg <= 300:
        return "Category 3 (toxic if swallowed)"
    if mg_kg <= 2000:
        return "Category 4 (harmful if swallowed)"
    if mg_kg <= 5000:
        return "Category 5 (may be harmful if swallowed)"
    return "Not classified (> 5000 mg/kg)"


__all__ = [
    "ACUTE_ENDPOINT",
    "ALL_ENDPOINTS",
    "CYP_INHIBITION_ENDPOINTS",
    "CYP_SUBSTRATE_ENDPOINTS",
    "DISPOSITION_ENDPOINTS",
    "HAZARD_ENDPOINTS",
    "TOX21_ENDPOINTS",
    "ModelPanel",
    "collect_panel",
    "ld50_mg_per_kg",
]
