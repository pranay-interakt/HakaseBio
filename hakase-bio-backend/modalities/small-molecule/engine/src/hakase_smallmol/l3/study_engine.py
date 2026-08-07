"""Study-design normalisation: user study inputs → validated simulation arms.

The only genuinely-new inputs L3 asks for are study-design choices (species,
strain, sex, route, dose groups, schedule, duration, cohort size). This module
validates them against the kernel physiology catalog and the supported dosing
routes, then expands them into the list of :class:`ArmSpec` the population
engine simulates — one per dose group. It computes nothing pharmacological.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, ArmSpec, parse_frequency_h

SUPPORTED_ROUTES = ("IV", "ORAL", "SC")
SUPPORTED_FREQUENCIES = ("QD", "BID", "TID", "QID", "Q12H", "Q8H", "Q6H", "SINGLE")


def species_catalog() -> list[dict[str, Any]]:
    """Enumerate the (species, strain) rows the physiology store can simulate.

    Sourced live from the kernel store so the UI never hard-codes a species that
    the ODE cannot parameterise.
    """
    from hakase_kernel.pbpk.physiology.store import DEFAULT_STRAIN, SPECIES_PHYSIOLOGY

    rows: list[dict[str, Any]] = []
    for (species, strain), phys in sorted(SPECIES_PHYSIOLOGY.items()):
        if species == "human":
            continue  # L3 is the ANIMAL layer; human PK is the L1/L2 readout
        rows.append(
            {
                "species": species,
                "strain": strain,
                "default_strain": DEFAULT_STRAIN.get(species) == strain,
                "reference_body_weight_kg": getattr(phys, "reference_body_weight_kg", None),
            }
        )
    return rows


class StudyDesignError(ValueError):
    """Raised when a study design cannot be simulated as specified."""


def _validate_animal(animal: AnimalSpec) -> list[str]:
    """Confirm the species/strain resolves in the physiology store."""
    from hakase_kernel.pbpk.physiology.store import get_physiology

    warnings: list[str] = []
    try:
        get_physiology(animal.species, animal.strain)
    except Exception as exc:  # noqa: BLE001
        raise StudyDesignError(str(exc)) from exc
    if not animal.sex:
        warnings.append(
            "Sex not specified; the physiology store uses a sex-averaged reference individual."
        )
    return warnings


def normalize_dose_groups(
    dose_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Validate and order dose groups; default labels Low/Mid/High when absent.

    Each group: ``{label?, dose_mg_per_kg, is_control?}``. A control group
    (dose 0) is allowed and preserved (it produces a null-exposure reference).
    """
    if not dose_groups:
        raise StudyDesignError("At least one dose group is required.")
    active = [g for g in dose_groups if float(g.get("dose_mg_per_kg", 0) or 0) > 0]
    if not active:
        raise StudyDesignError("At least one active (non-zero) dose group is required.")

    # Sort active groups by dose so Low/Mid/High labels are monotone.
    active_sorted = sorted(active, key=lambda g: float(g["dose_mg_per_kg"]))
    default_labels = _default_labels(len(active_sorted))
    normalized: list[dict[str, Any]] = []
    for group in dose_groups:
        dose = float(group.get("dose_mg_per_kg", 0) or 0)
        if dose <= 0:
            normalized.append(
                {
                    "label": group.get("label") or "Control",
                    "dose_mg_per_kg": 0.0,
                    "is_control": True,
                }
            )
    for i, group in enumerate(active_sorted):
        normalized.append(
            {
                "label": group.get("label") or default_labels[i],
                "dose_mg_per_kg": float(group["dose_mg_per_kg"]),
                "is_control": False,
            }
        )
    return normalized


def _default_labels(n: int) -> list[str]:
    if n == 1:
        return ["Dose"]
    if n == 2:
        return ["Low", "High"]
    if n == 3:
        return ["Low", "Mid", "High"]
    return [f"Dose {i + 1}" for i in range(n)]


def build_arms(
    *,
    animal: AnimalSpec,
    dose_groups: list[dict[str, Any]],
    route: str,
    frequency: str | None,
    duration_h: float,
    infusion_duration_h: float | None = None,
) -> tuple[list[ArmSpec], list[str]]:
    """Expand a validated study design into per-dose-group :class:`ArmSpec`s.

    Control (zero-dose) groups are *not* simulated (no drug → null exposure) but
    are recorded by the caller. Returns ``(active_arms, design_warnings)``.
    """
    route_u = (route or "").strip().upper()
    if route_u not in SUPPORTED_ROUTES:
        raise StudyDesignError(
            f"Unsupported route {route!r}; supported: {', '.join(SUPPORTED_ROUTES)}."
        )
    freq = (frequency or "").strip().upper() or None
    if freq in {"SINGLE"}:
        freq = None
    if freq is not None:
        try:
            parse_frequency_h(freq)  # validates the token; value used in the adapter
        except ValueError as exc:
            raise StudyDesignError(
                f"Unsupported dosing frequency {frequency!r}; supported: {', '.join(SUPPORTED_FREQUENCIES)}."
            ) from exc
    if not (duration_h and duration_h > 0):
        raise StudyDesignError("Study duration must be greater than zero hours.")

    warnings = _validate_animal(animal)
    normalized = normalize_dose_groups(dose_groups)

    arms: list[ArmSpec] = []
    for group in normalized:
        if group["is_control"]:
            continue
        arms.append(
            ArmSpec(
                label=group["label"],
                dose_mg_per_kg=group["dose_mg_per_kg"],
                route=route_u,
                frequency=freq,
                duration_h=duration_h,
                infusion_duration_h=infusion_duration_h if route_u == "IV" else None,
                is_control=False,
            )
        )
    if freq is None and duration_h > 48.0:
        warnings.append(
            "A single dose over a long window was requested; specify a dosing frequency "
            "to model repeat-dose accumulation."
        )
    return arms, warnings


__all__ = [
    "SUPPORTED_ROUTES",
    "SUPPORTED_FREQUENCIES",
    "species_catalog",
    "StudyDesignError",
    "normalize_dose_groups",
    "build_arms",
]
