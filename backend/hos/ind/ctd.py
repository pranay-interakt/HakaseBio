"""CTD Module 4 (nonclinical study reports) structure, ICH M4S(R2) section 4 (Step 4,
20 December 2002), transcribed from the official guideline."""

from __future__ import annotations

__all__ = ["MODULE4", "ctd_title", "ctd_sort_key"]

MODULE4: tuple[tuple[str, str], ...] = (
    ("4.1", "Table of Contents of Module 4"),
    ("4.2", "Study Reports"),
    ("4.2.1", "Pharmacology"),
    ("4.2.1.1", "Primary Pharmacodynamics"),
    ("4.2.1.2", "Secondary Pharmacodynamics"),
    ("4.2.1.3", "Safety Pharmacology"),
    ("4.2.1.4", "Pharmacodynamic Drug Interactions"),
    ("4.2.2", "Pharmacokinetics"),
    ("4.2.2.1", "Analytical Methods and Validation Reports"),
    ("4.2.2.2", "Absorption"),
    ("4.2.2.3", "Distribution"),
    ("4.2.2.4", "Metabolism"),
    ("4.2.2.5", "Excretion"),
    ("4.2.2.6", "Pharmacokinetic Drug Interactions (nonclinical)"),
    ("4.2.2.7", "Other Pharmacokinetic Studies"),
    ("4.2.3", "Toxicology"),
    ("4.2.3.1", "Single-Dose Toxicity"),
    ("4.2.3.2", "Repeat-Dose Toxicity"),
    ("4.2.3.3", "Genotoxicity"),
    ("4.2.3.3.1", "In vitro"),
    ("4.2.3.3.2", "In vivo"),
    ("4.2.3.4", "Carcinogenicity"),
    ("4.2.3.4.1", "Long-term studies"),
    ("4.2.3.4.2", "Short- or medium-term studies"),
    ("4.2.3.4.3", "Other studies"),
    ("4.2.3.5", "Reproductive and Developmental Toxicity"),
    ("4.2.3.5.1", "Fertility and early embryonic development"),
    ("4.2.3.5.2", "Embryo-fetal development"),
    ("4.2.3.5.3", "Prenatal and postnatal development, including maternal function"),
    ("4.2.3.5.4", "Studies in which the offspring (juvenile animals) are dosed and/or further "
                  "evaluated"),
    ("4.2.3.6", "Local Tolerance"),
    ("4.2.3.7", "Other Toxicity Studies"),
    ("4.2.3.7.1", "Antigenicity"),
    ("4.2.3.7.2", "Immunotoxicity"),
    ("4.2.3.7.3", "Mechanistic studies"),
    ("4.2.3.7.4", "Dependence"),
    ("4.2.3.7.5", "Metabolites"),
    ("4.2.3.7.6", "Impurities"),
    ("4.2.3.7.7", "Other"),
    ("4.3", "Literature References"),
)
_TITLES = dict(MODULE4)


def ctd_title(section: str) -> str:
    try:
        return _TITLES[section]
    except KeyError:
        raise KeyError(f"{section!r} is not a CTD Module 4 section (ICH M4S(R2))") from None


def ctd_sort_key(section: str) -> tuple[int, ...]:
    return tuple(int(x) for x in section.split("."))
