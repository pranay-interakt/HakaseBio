"""Single source of truth for ADMET endpoint units (Python side).

Mirrors `apps/hakase-ai/src/lib/admetUnits.ts`. Used to stamp every
numeric value returned by /predict/* endpoints with its unit, so the front
end never has to guess and CSV/Allotrope exports always carry the SI form.

Convention: any new ADMET key must be added HERE before being returned from
a predictor, so a missing-unit code path becomes a CI-detectable mistake.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class UnitSpec:
    unit: str  # short display
    si_unit: str  # canonical export
    decimals: int  # display precision
    scale: float = 1.0
    description: str = ""


ADMET_UNITS: dict[str, UnitSpec] = {
    # Absorption
    "caco2_papp": UnitSpec("×10⁻⁶ cm/s", "1e-6 cm/s", 1, 1.0, "Caco-2 apparent permeability"),
    "caco2_log_papp": UnitSpec(
        "log cm/s", "log10(cm/s)", 2, 1.0, "Caco-2 log apparent permeability"
    ),
    "hia_probability": UnitSpec("%", "percent", 1, 100.0, "Human intestinal absorption"),
    "bioavailability_F": UnitSpec("%", "percent", 1, 100.0, "Oral bioavailability"),
    "pgp_substrate_prob": UnitSpec("% probability", "percent", 1, 100.0, "P-gp substrate"),
    "pampa_pe": UnitSpec("×10⁻⁶ cm/s", "1e-6 cm/s", 1, 1.0, "PAMPA permeability"),
    "efflux_ratio": UnitSpec("ratio", "dimensionless", 2, 1.0, "Efflux ratio B→A/A→B"),
    # Distribution
    "bbb_probability": UnitSpec("% probability", "percent", 1, 100.0, "BBB penetration"),
    "ppb_percent": UnitSpec("%", "percent bound", 1, 1.0, "Plasma protein binding"),
    "ppb_fu_fraction": UnitSpec("% unbound", "percent", 2, 100.0, "Plasma free fraction"),
    "vd_l_per_kg": UnitSpec("L/kg", "L·kg^-1", 2, 1.0, "Volume of distribution"),
    # Metabolism
    "hepatocyte_clint_ul_min_1e6_cells": UnitSpec(
        "µL/min/10⁶ cells", "µL·min^-1·1e6cells^-1", 1, 1.0, "Hepatocyte CLint"
    ),
    "microsomal_clint_ul_min_mg": UnitSpec(
        "µL/min/mg", "µL·min^-1·mg^-1", 1, 1.0, "Microsomal CLint"
    ),
    "hepatic_clearance": UnitSpec("mL/min/kg", "mL·min^-1·kg^-1", 2, 1.0, "Hepatic CL"),
    "renal_clearance": UnitSpec("mL/min/kg", "mL·min^-1·kg^-1", 2, 1.0, "Renal CL"),
    "cyp_inhibition_prob": UnitSpec(
        "% probability", "percent", 1, 100.0, "CYP inhibitor probability"
    ),
    "cyp_ic50_um": UnitSpec("µM", "µmol/L", 2, 1.0, "CYP inhibitor IC50"),
    # Excretion
    "half_life_h": UnitSpec("h", "hours", 1, 1.0, "Elimination half-life"),
    "half_life_min": UnitSpec("min", "minutes", 0, 1.0, "Elimination half-life"),
    "total_clearance": UnitSpec("mL/min/kg", "mL·min^-1·kg^-1", 2, 1.0, "Total CL"),
    # Toxicity
    "herg_blocker_prob": UnitSpec("% probability", "percent", 1, 100.0, "hERG block probability"),
    "herg_ic50_um": UnitSpec("µM", "µmol/L", 2, 1.0, "hERG IC50"),
    "ames_prob": UnitSpec("% probability", "percent", 1, 100.0, "Ames mutagenicity prob"),
    "dili_prob": UnitSpec("% probability", "percent", 1, 100.0, "DILI probability"),
    "clintox_prob": UnitSpec("% probability", "percent", 1, 100.0, "Clinical-trial tox"),
    "carcinogen_prob": UnitSpec("% probability", "percent", 1, 100.0, "Carcinogenicity"),
    "ld50_mg_kg": UnitSpec("mg/kg", "mg·kg^-1", 0, 1.0, "Oral rat LD50"),
    "ld50_log_mol_kg": UnitSpec("log mol/kg", "log10(mol/kg)", 2, 1.0, "Zhu LD50"),
    "mrdd_mg": UnitSpec("mg/day", "mg·d^-1", 0, 1.0, "Max recommended daily dose"),
    # Potency
    "ic50_nm": UnitSpec("nM", "nmol/L", 1, 1.0, "IC50"),
    "ec50_nm": UnitSpec("nM", "nmol/L", 1, 1.0, "EC50"),
    "ki_nm": UnitSpec("nM", "nmol/L", 1, 1.0, "Ki"),
    "kd_nm": UnitSpec("nM", "nmol/L", 1, 1.0, "Kd"),
    "pkd": UnitSpec("-log10(M)", "pKd", 2, 1.0, "pKd"),
    "pic50": UnitSpec("-log10(M)", "pIC50", 2, 1.0, "pIC50"),
    "cc50_um": UnitSpec("µM", "µmol/L", 2, 1.0, "Cytotoxicity CC50"),
    "therapeutic_index": UnitSpec("× (CC50/IC50)", "dimensionless", 1, 1.0, "Therapeutic index"),
    # Solubility / physchem
    "log_s": UnitSpec("log mol/L", "log10(mol/L)", 2, 1.0, "Aqueous solubility"),
    "solubility_mg_ml": UnitSpec("mg/mL", "mg·mL^-1", 3, 1.0, "Solubility at pH 7.4"),
    "logp": UnitSpec("log P", "log10(Po/w)", 2, 1.0, "LogP"),
    "logd_7_4": UnitSpec("log D", "log10(D7.4)", 2, 1.0, "LogD at pH 7.4"),
    "tpsa": UnitSpec("Å²", "Å²", 1, 1.0, "Topological polar surface area"),
    "mol_weight": UnitSpec("Da", "g·mol^-1", 1, 1.0, "Molecular weight"),
    # Drug-likeness
    "qed": UnitSpec("0–1", "dimensionless", 3, 1.0, "QED drug-likeness"),
    "sa_score": UnitSpec("1–10", "dimensionless", 1, 1.0, "Synthetic accessibility"),
}


def with_unit(key: str, value: float | None) -> dict[str, Any]:
    """Wrap a numeric value into a {value, unit, si_unit, formatted} envelope.

    The standard shape every /predict endpoint should return numerics in:
      {"hepatic_clearance": {"value": 12.4, "unit": "mL/min/kg", ...}}

    Returns {"value": None, ...} for missing measurements so the front end
    can render "—" without conditional null-checking.
    """
    spec = ADMET_UNITS.get(key)
    if spec is None:
        return {
            "value": value,
            "unit": "",
            "si_unit": "",
            "formatted": str(value) if value is not None else "—",
        }
    if value is None or not isinstance(value, (int, float)):
        return {"value": None, "unit": spec.unit, "si_unit": spec.si_unit, "formatted": "—"}
    scaled = float(value) * spec.scale
    return {
        "value": float(value),
        "unit": spec.unit,
        "si_unit": spec.si_unit,
        "decimals": spec.decimals,
        "formatted": f"{scaled:.{spec.decimals}f} {spec.unit}",
        "description": spec.description,
    }


def unit_for(key: str) -> str:
    spec = ADMET_UNITS.get(key)
    return spec.unit if spec else ""


def list_known_endpoints() -> list[str]:
    return list(ADMET_UNITS.keys())
