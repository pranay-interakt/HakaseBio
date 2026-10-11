"""First-in-human dose projection.

Implements the procedure of the FDA guidance *Estimating the Maximum Safe
Starting Dose in Initial Clinical Trials for Therapeutics in Adult Healthy
Volunteers* (CDER, 2005):

1. determine the NOAEL in each species tested
2. convert each NOAEL to a human equivalent dose by body-surface-area scaling
3. select the most sensitive species (the lowest HED) unless there is a
   documented reason to do otherwise
4. divide by a safety factor (default 10) to obtain the MRSD (Section VII)
5. compare the MRSD with an HED derived from the pharmacologically active dose; if that is
   lower, "it may be appropriate to decrease the clinical starting dose" (Section VIII). That
   is a judgement for the responsible clinician/toxicologist, so the comparison is reported
   and flagged, never applied automatically.

For biologics and immune agonists the MABEL approach of the EMA first-in-human
guideline applies and generally governs; for anticancer pharmaceuticals ICH S9
substitutes STD10/HNSTD for the NOAEL. Those routes are represented explicitly
rather than silently folded into the BSA calculation.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Any

from hos.core.methods import method
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import Quantity, QuantityError
from hos.core.reference_params import ReferenceParameterSet

__all__ = [
    "SAFETY_FACTOR_TRIGGERS",
    "DoseBasis",
    "DoseProjection",
    "SpeciesHED",
    "human_equivalent_dose",
    "project_starting_dose",
]


class DoseBasis(str, Enum):
    """Which regulatory route produced the starting dose."""

    NOAEL_BSA = "noael_bsa"          # FDA 2005 default route
    PAD = "pharmacologically_active_dose"
    MABEL = "mabel"                  # EMA FIH guideline, biologics/immune agonists
    ICH_S9_STD10 = "ich_s9_std10"    # oncology, rodent
    ICH_S9_HNSTD = "ich_s9_hnstd"    # oncology, non-rodent


#: FDA 2005 Section VII.A (pp. 10-11): considerations that "might warrant increasing the
#: safety factor" above the default of 10.
SAFETY_FACTOR_TRIGGERS: tuple[str, ...] = (
    "Steep dose response curve",
    "Severe toxicities",
    "Nonmonitorable toxicity",
    "Toxicities without premonitory signs",
    "Variable bioavailability",
    "Irreversible toxicity",
    "Unexplained mortality",
    "Large variability in doses or plasma drug levels eliciting effect",
    "Nonlinear pharmacokinetics",
    "Inadequate dose-response data",
    "Novel therapeutic targets",
    "Animal models with limited utility",
)


@dataclass(frozen=True, slots=True)
class SpeciesHED:
    """A NOAEL in one species and its human equivalent dose."""

    species: str
    noael: Quantity
    km_animal: Quantity
    km_human: Quantity
    hed: Quantity

    def to_dict(self) -> dict[str, Any]:
        return {
            "species": self.species,
            "noael": self.noael.to_dict(),
            "km_animal": self.km_animal.to_dict(),
            "km_human": self.km_human.to_dict(),
            "hed": self.hed.to_dict(),
        }


def human_equivalent_dose(
    noael: Quantity,
    species: str,
    *,
    params: ReferenceParameterSet | None = None,
) -> SpeciesHED:
    """Convert an animal NOAEL (mg/kg) to a human equivalent dose by BSA scaling.

    ``HED (mg/kg) = animal NOAEL (mg/kg) x (Km_animal / Km_human)``

    where ``Km = body weight / body surface area`` (FDA 2005, Table 1). This is
    algebraically identical to the ``(W_animal/W_human)^0.33`` form.
    """
    params = params or ReferenceParameterSet()
    km_a = params.for_species("km", species)
    km_h = params.quantity("km.human")

    if not noael.is_available:
        return SpeciesHED(
            species=species,
            noael=noael,
            km_animal=km_a,
            km_human=km_h,
            hed=Quantity.unavailable(
                "mg/kg", reason=f"no NOAEL for {species}: {noael.provenance.reason}",
                label=f"HED from {species}",
            ),
        )

    noael_mgkg = noael.magnitude_in("mg/kg")
    factor = km_a.require() / km_h.require()
    hed = Quantity.computed(
        noael_mgkg * factor,
        "mg/kg",
        method=method("dose.hed_bsa"),
        inputs=[noael, km_a, km_h],
        parameter_set_version=params.version,
        label=f"HED from {species}",
        qc_flags=tuple(dict.fromkeys(list(noael.qc_flags) + list(km_a.qc_flags))),
        notes=f"BSA scaling: {noael_mgkg:g} mg/kg x ({km_a.require():g}/{km_h.require():g})"
              f" = {noael_mgkg*factor:.4g} mg/kg",
    )
    return SpeciesHED(species=species, noael=noael, km_animal=km_a, km_human=km_h, hed=hed)


@dataclass(frozen=True, slots=True)
class DoseProjection:
    """The full, auditable derivation of a first-in-human starting dose."""

    basis: DoseBasis
    species_heds: tuple[SpeciesHED, ...]
    most_sensitive_species: str | None
    governing_hed: Quantity
    safety_factor: Quantity
    mrsd_per_kg: Quantity
    mrsd_total: Quantity
    reference_body_weight: Quantity
    pad: Quantity | None
    pad_below_mrsd: bool
    safety_factor_justification: tuple[str, ...]
    qc: QCVerdict

    def derivation_steps(self) -> list[str]:
        """Human-readable derivation, every step traceable to a cited input."""
        steps: list[str] = []
        for s in self.species_heds:
            if s.hed.is_available:
                steps.append(
                    f"{s.species}: NOAEL {s.noael.value:g} {s.noael.unit} x "
                    f"(Km {s.km_animal.value:g} / Km human {s.km_human.value:g}) "
                    f"= HED {s.hed.value:.4g} mg/kg"
                )
            else:
                steps.append(f"{s.species}: HED unavailable ({s.hed.provenance.reason})")
        if self.most_sensitive_species:
            steps.append(
                f"most sensitive species = {self.most_sensitive_species} "
                f"(lowest HED = {self.governing_hed.value:.4g} mg/kg)"
            )
        steps.append(
            f"MRSD = governing HED {self.governing_hed.value:.4g} mg/kg / "
            f"safety factor {self.safety_factor.value:g} = {self.mrsd_per_kg.value:.4g} mg/kg"
        )
        steps.append(
            f"for a {self.reference_body_weight.value:g} kg adult: "
            f"MRSD = {self.mrsd_total.value:.4g} mg total"
        )
        if self.pad_below_mrsd and self.pad is not None:
            steps.append(
                f"PAD-derived HED ({self.pad.value:.4g} {self.pad.unit}) is below the MRSD; per "
                "FDA 2005 Section VIII it may be appropriate to decrease the starting dose "
                "(decision for the responsible scientist, not made by the system)"
            )
        return steps

    def to_dict(self) -> dict[str, Any]:
        return {
            "basis": self.basis.value,
            "species_heds": [s.to_dict() for s in self.species_heds],
            "most_sensitive_species": self.most_sensitive_species,
            "governing_hed": self.governing_hed.to_dict(),
            "safety_factor": self.safety_factor.to_dict(),
            "mrsd_per_kg": self.mrsd_per_kg.to_dict(),
            "mrsd_total": self.mrsd_total.to_dict(),
            "reference_body_weight": self.reference_body_weight.to_dict(),
            "pad": self.pad.to_dict() if self.pad else None,
            "pad_below_mrsd": self.pad_below_mrsd,
            "safety_factor_justification": list(self.safety_factor_justification),
            "derivation": self.derivation_steps(),
            "qc": self.qc.to_dict(),
        }


def project_starting_dose(
    noaels: Mapping[str, Quantity],
    *,
    safety_factor: float | None = None,
    safety_factor_justification: Sequence[str] = (),
    pad: Quantity | None = None,
    override_species: str | None = None,
    override_reason: str | None = None,
    params: ReferenceParameterSet | None = None,
) -> DoseProjection:
    """Derive the maximum recommended starting dose from species NOAELs.

    ``noaels`` maps species name to the NOAEL in that species. ``pad`` is an HED derived
    from the pharmacologically active dose (FDA 2005 Section VIII); it is compared with the
    MRSD and a lower PAD is flagged for the responsible scientist, not applied.
    """
    params = params or ReferenceParameterSet()
    if not noaels:
        raise QuantityError("at least one species NOAEL is required to project a starting dose")

    species_heds = tuple(
        human_equivalent_dose(noael, sp, params=params) for sp, noael in noaels.items()
    )
    usable = [s for s in species_heds if s.hed.is_available]
    findings: list[QCFinding] = []

    if not usable:
        reason = "; ".join(s.hed.provenance.reason or "" for s in species_heds)
        unavailable = Quantity.unavailable("mg/kg", reason=reason, label="MRSD")
        return DoseProjection(
            basis=DoseBasis.NOAEL_BSA,
            species_heds=species_heds,
            most_sensitive_species=None,
            governing_hed=unavailable,
            safety_factor=params.quantity("mrsd.default_safety_factor"),
            mrsd_per_kg=unavailable,
            mrsd_total=Quantity.unavailable("mg", reason=reason, label="MRSD (total)"),
            reference_body_weight=params.quantity("bw.human"),
            pad=pad,
            pad_below_mrsd=False,
            safety_factor_justification=tuple(safety_factor_justification),
            qc=QCVerdict.of(
                [QCFinding(code="no_usable_noael", status=QCStatus.FAIL,
                           message="no species produced a usable HED", observed=reason)]
            ),
        )

    if len(usable) == 1:
        findings.append(
            QCFinding(
                code="single_species_only",
                status=QCStatus.WARN,
                message="only one species contributed a NOAEL; ICH M3(R2) expects a rodent "
                        "and a non-rodent species for most small-molecule programmes",
                observed=usable[0].species,
            )
        )

    if override_species is not None:
        chosen = next((s for s in usable if s.species == override_species), None)
        if chosen is None:
            raise QuantityError(f"override species {override_species!r} has no usable HED")
        if not override_reason:
            raise QuantityError(
                "selecting a species other than the most sensitive requires a documented reason"
            )
        findings.append(
            QCFinding(
                code="most_sensitive_species_overridden",
                status=QCStatus.WARN,
                message=f"most sensitive species not used; justification: {override_reason}",
                observed=override_species,
            )
        )
    else:
        chosen = min(usable, key=lambda s: s.hed.require())

    governing_hed = chosen.hed
    basis = DoseBasis.NOAEL_BSA

    sf_q = params.quantity("mrsd.default_safety_factor")
    if safety_factor is not None:
        if safety_factor <= 0:
            raise QuantityError("safety factor must be positive")
        if safety_factor < sf_q.require() and not safety_factor_justification:
            raise QuantityError(
                "a safety factor below the default of 10 requires a documented justification"
            )
        if safety_factor > sf_q.require() and not safety_factor_justification:
            findings.append(
                QCFinding(
                    code="increased_safety_factor_unjustified",
                    status=QCStatus.WARN,
                    message="an increased safety factor was applied without recording which "
                            "FDA 2005 trigger prompted it",
                    observed=safety_factor,
                )
            )
        sf_q = Quantity.user_supplied(
            safety_factor, "dimensionless", actor="study_director",
            label="Safety factor",
            notes="; ".join(safety_factor_justification) or None,
        )

    m = method("dose.mrsd")
    mrsd_per_kg = Quantity.computed(
        governing_hed.require() / sf_q.require(),
        "mg/kg",
        method=m,
        inputs=[governing_hed, sf_q],
        parameter_set_version=params.version,
        label="MRSD",
        qc_flags=tuple(dict.fromkeys(list(governing_hed.qc_flags) + [f.code for f in findings])),
    )
    pad_below_mrsd = False
    if pad is not None and pad.is_available:
        pad_mgkg = pad.magnitude_in("mg/kg")
        if pad_mgkg < mrsd_per_kg.require():
            pad_below_mrsd = True
            findings.append(
                QCFinding(
                    code="pad_below_mrsd",
                    status=QCStatus.WARN,
                    message="the HED derived from the pharmacologically active dose is below the "
                            "MRSD; FDA 2005 Section VIII: it may be appropriate to decrease the "
                            "clinical starting dose",
                    observed=pad_mgkg,
                    threshold=mrsd_per_kg.require(),
                )
            )
            mrsd_per_kg = mrsd_per_kg.with_flags("pad_below_mrsd")

    bw = params.quantity("bw.human")
    mrsd_total = Quantity.computed(
        mrsd_per_kg.require() * bw.require(),
        "mg",
        method=m,
        inputs=[mrsd_per_kg, bw],
        parameter_set_version=params.version,
        label=f"MRSD (total, {bw.require():g} kg adult)",
        qc_flags=mrsd_per_kg.qc_flags,
    )

    return DoseProjection(
        basis=basis,
        species_heds=species_heds,
        most_sensitive_species=chosen.species,
        governing_hed=governing_hed,
        safety_factor=sf_q,
        mrsd_per_kg=mrsd_per_kg,
        mrsd_total=mrsd_total,
        reference_body_weight=bw,
        pad=pad,
        pad_below_mrsd=pad_below_mrsd,
        safety_factor_justification=tuple(safety_factor_justification),
        qc=QCVerdict.of(findings),
    )
