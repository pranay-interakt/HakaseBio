import math
from typing import Any, Protocol

# ── Formulation and BCS Module (Copied from animal_sim.py) ──


def Delaney_esol(logP: float, mw: float, num_ar_rings: int, rot_bonds: int) -> float:
    return 0.16 - 0.638 * logP - 0.0062 * mw + 0.066 * num_ar_rings - 0.74 * (rot_bonds / 10.0)


def is_high_permeability(logP: float, tpsa: float, mw: float, hbd: int) -> bool:
    return logP > 1.0 and tpsa < 120.0 and mw < 500.0 and hbd <= 5


def classify_bcs(
    logP: float, tpsa: float, mw: float, hbd: int, num_ar_rings: int, rot_bonds: int
) -> dict[str, Any]:
    logS = Delaney_esol(logP, mw, num_ar_rings, rot_bonds)
    sol_threshold = -4.0 + math.log10(250.0 / max(mw, 100.0))
    high_sol = logS > sol_threshold
    high_perm = is_high_permeability(logP, tpsa, mw, hbd)

    if high_sol and high_perm:
        cls = "I"
        label = "Class I — High Solubility / High Permeability"
        challenge = "Formulation-independent absorption; plain tablet appropriate"
        strategy = "Immediate-release tablet or hard gelatin capsule"
    elif not high_sol and high_perm:
        cls = "II"
        label = "Class II — Low Solubility / High Permeability"
        challenge = "Dissolution-rate limited; formulation is the key driver of bioavailability"
        strategy = (
            "Lipid-based LBDDS/SMEDDS, amorphous solid dispersion, or nanosuspension recommended"
        )
    elif high_sol and not high_perm:
        cls = "III"
        label = "Class III — High Solubility / Low Permeability"
        challenge = "Permeability-limited; rapid dissolution but poor membrane crossing"
        strategy = "Permeation enhancers, prodrug strategy, or modified release"
    else:
        cls = "IV"
        label = "Class IV — Low Solubility / Low Permeability"
        challenge = "Both solubility and permeability limited — challenging candidate"
        strategy = "SMEDDS, lipid nanoparticles, or formulation combination strategy"

    return {
        "class": cls,
        "label": label,
        "solubility": "High" if high_sol else "Low",
        "permeability": "High" if high_perm else "Low",
        "logS": round(logS, 4),
        "challenge": challenge,
        "strategy": strategy,
    }


FORMULATION_MULTIPLIERS = {
    "plain": {
        "I": 1.0,
        "II": 1.0,
        "III": 1.0,
        "IV": 1.0,
        "fAbsMax": 0.95,
        "label": "Plain Tablet / Capsule",
        "excipients": [
            "MCC PH102 (microcrystalline cellulose)",
            "Lactose monohydrate",
            "Croscarmellose sodium",
            "Magnesium stearate",
        ],
    },
    "lipid": {
        "I": 1.1,
        "II": 3.2,
        "III": 1.4,
        "IV": 2.4,
        "fAbsMax": 0.90,
        "label": "Lipid-Based LBDDS / SMEDDS",
        "excipients": [
            "Labrasol (PEG-8 caprylic/capric glycerides)",
            "Labrafac Lipophile WL 1349 (caprylic/capric triglycerides)",
            "Cremophor EL (PEG-35 castor oil)",
            "Capmul MCM (glyceryl caprylate)",
        ],
    },
    "amorphous": {
        "I": 1.05,
        "II": 2.8,
        "III": 1.2,
        "IV": 2.0,
        "fAbsMax": 0.85,
        "label": "Amorphous Solid Dispersion (ASD)",
        "excipients": [
            "HPMC-AS (Hypromellose acetate succinate)",
            "PVP-VA (Povidone-vinyl acetate 64)",
            "Soluplus (PEG-PCL-PVAc graft polymer)",
            "Aerosil 200 (colloidal silica)",
        ],
    },
    "nanoparticle": {
        "I": 1.05,
        "II": 2.2,
        "III": 1.1,
        "IV": 1.7,
        "fAbsMax": 0.85,
        "label": "Nanosuspension / Nanoparticle",
        "excipients": [
            "Polysorbate 80 (Tween 80)",
            "HPMC E5 (Hypromellose 5cP)",
            "Lutrol F68 (Poloxamer 188)",
            "D-α-Tocopherol PEG 1000 succinate (TPGS)",
        ],
    },
    "cyclodextrin": {
        "I": 1.1,
        "II": 1.9,
        "III": 1.3,
        "IV": 1.5,
        "fAbsMax": 0.80,
        "label": "Cyclodextrin Inclusion Complex",
        "excipients": [
            "HP-β-CD (Hydroxypropyl-beta-cyclodextrin)",
            "SBE-β-CD (Sulfobutylether-beta-cyclodextrin, Captisol)",
        ],
    },
    "enteric": {
        "I": 1.0,
        "II": 1.3,
        "III": 1.1,
        "IV": 1.2,
        "fAbsMax": 0.90,
        "label": "Enteric-Coated / pH-Modified",
        "excipients": [
            "Eudragit L100-55 (methacrylic acid copolymer)",
            "HPMCP (Hydroxypropyl methylcellulose phthalate)",
            "MCC PH102 (microcrystalline cellulose)",
            "Lactose monohydrate",
        ],
    },
}


def compute_formulation_impact(
    logP: float,
    tpsa: float,
    mw: float,
    hbd: int,
    num_ar_rings: int,
    rot_bonds: int,
    baseF: float,
    formulation_type: str,
) -> dict[str, Any]:
    bcs = classify_bcs(logP, tpsa, mw, hbd, num_ar_rings, rot_bonds)
    f_def = FORMULATION_MULTIPLIERS.get(formulation_type, FORMULATION_MULTIPLIERS["plain"])
    mult = f_def.get(bcs["class"], 1.0)
    raw_F = min(baseF * mult, f_def["fAbsMax"])
    formulated_F = min(raw_F, 0.99)
    enhancement = formulated_F / max(baseF, 0.01)

    if enhancement >= 3.0:
        impact = f"Very High ({enhancement:.1f}x improvement)"
    elif enhancement >= 2.0:
        impact = f"High ({enhancement:.1f}x improvement)"
    elif enhancement >= 1.3:
        impact = f"Moderate ({enhancement:.1f}x improvement)"
    elif enhancement >= 1.05:
        impact = f"Low ({enhancement:.1f}x improvement)"
    else:
        impact = "None (plain appropriate)"

    return {
        "bcs": bcs,
        "formulation": {
            "id": formulation_type,
            "label": f_def["label"],
            "description": f"Formulation using {f_def['label']} technology.",
            "keyExcipients": f_def["excipients"],
            "multiplier": {k: f_def[k] for k in ["I", "II", "III", "IV"]},
            "enhancement": round(enhancement, 2),
            "impactCategory": impact,
        },
        "F_abs_formulated": round(formulated_F, 3),
    }


# ── Forcing Functions (Input Models) ──


class DosingModel(Protocol):
    def get_initial_amounts(self) -> dict[str, float]:
        """Return the dose mass injected instantly at t=0 (e.g. bolus)."""
        ...

    def get_input_rate(self, t: float) -> dict[str, float]:
        """Return the rate of input (mass/time) per compartment at time t."""
        ...


class IVBolus:
    """Intravenous bolus injection directly to venous blood."""

    def __init__(self, dose: float):
        self.dose = dose

    def get_initial_amounts(self) -> dict[str, float]:
        return {"venous_blood": self.dose}

    def get_input_rate(self, t: float) -> dict[str, float]:
        return {}


class IVInfusion:
    """Constant rate intravenous infusion to venous blood."""

    def __init__(self, dose: float, duration: float):
        self.dose = dose
        self.duration = duration

    def get_initial_amounts(self) -> dict[str, float]:
        return {}

    def get_input_rate(self, t: float) -> dict[str, float]:
        if self.duration > 0 and t <= self.duration:
            return {"venous_blood": self.dose / self.duration}
        return {}


class SCDepot:
    """First-order subcutaneous depot absorption into venous blood."""

    def __init__(self, dose: float, ka: float, f_abs: float = 1.0):
        self.dose = dose
        self.ka = ka
        self.f_abs = f_abs

    def get_initial_amounts(self) -> dict[str, float]:
        return {}

    def get_input_rate(self, t: float) -> dict[str, float]:
        rate = self.ka * self.f_abs * self.dose * math.exp(-self.ka * t)
        return {"venous_blood": rate}


class Oral:
    """
    First-order oral absorption into gut tissue (which flows to liver via portal).
    The ODE's gut and liver components handle the extraction ratio and first-pass effect.
    """

    def __init__(self, dose: float, ka: float, f_abs: float = 1.0):
        self.dose = dose
        self.ka = ka
        self.f_abs = f_abs

    def get_initial_amounts(self) -> dict[str, float]:
        return {}

    def get_input_rate(self, t: float) -> dict[str, float]:
        rate = self.ka * self.f_abs * self.dose * math.exp(-self.ka * t)
        return {"gut": rate}


class RepeatDose:
    """
    Periodic forcing function wrapping any first-order kinetic absorption model
    (like Oral or SCDepot) to simulate repeated doses.
    """

    def __init__(self, dose: float, ka: float, f_abs: float, tau: float, compartment: str):
        self.dose = dose
        self.ka = ka
        self.f_abs = f_abs
        self.tau = tau
        self.compartment = compartment

    def get_initial_amounts(self) -> dict[str, float]:
        return {}

    def get_input_rate(self, t: float) -> dict[str, float]:
        rate = 0.0
        # Determine number of doses administered so far
        n_doses = int(t // self.tau)
        for i in range(n_doses + 1):
            t_dose = t - i * self.tau
            rate += self.ka * self.f_abs * self.dose * math.exp(-self.ka * t_dose)
        return {self.compartment: rate}
