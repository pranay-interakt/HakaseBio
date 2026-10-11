"""Regulatory compiler diff (docs/14 P10): expected changes follow from the cited rules."""

from dataclasses import replace

from hos.core.regulatory import ClinicalPopulation, Indication, Modality, ProgramContext, Route
from hos.core.regulatory.diff import diff_contexts

BASE = ProgramContext(modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                      route=Route.ORAL, intended_clinical_duration_days=365,
                      max_trial_duration_days=28)


def _by(d):
    return {(c.requirement_id, c.change): c for c in d.changes}


def test_identical_contexts_have_no_changes():
    assert diff_contexts(BASE, BASE).unchanged


def test_longer_trial_lengthens_repeat_dose_per_m3r2_table1():
    # M3(R2) Table 1: > 6 months -> 6-month rodent, 9-month non-rodent
    d = _by(diff_contexts(BASE, replace(BASE, max_trial_duration_days=200)))
    rod = d[("tox.repeat_dose_rodent", "lengthened")]
    non = d[("tox.repeat_dose_nonrodent", "lengthened")]
    assert (rod.before, rod.after) == (4.0, 26.0) and (non.before, non.after) == (4.0, 39.0)
    assert rod.section_after == "M3(R2) section 5.1, Table 1"


def test_wocbp_retimes_efd():
    d = _by(diff_contexts(BASE, replace(
        BASE, populations=(ClinicalPopulation.WOMEN_OF_CHILDBEARING_POTENTIAL,))))
    c = d[("dart.efd", "retimed")]
    assert (c.before, c.after) == ("before_phase_3", "before_inclusion_of_wocbp")


def test_advanced_cancer_removes_waived_studies_and_cites_s9():
    d = diff_contexts(BASE, replace(BASE, indication=Indication.ADVANCED_CANCER,
                                    intended_clinical_duration_days=90))
    by = _by(d)
    assert ("carc.bioassay", "removed") in by
    assert by[("safety.core_battery", "removed")].section_after == "S9 section 2.2"
    assert ("tox.repeat_dose", "added") in by
    assert d.context_changes["indication"] == ("chronic_non_oncology", "advanced_cancer")


def test_resolving_a_pending_fact_changes_status():
    d = _by(diff_contexts(BASE, replace(BASE, molar_extinction_coefficient_ge_1000=True)))
    c = d[("photo.assessment", "status")]
    assert (c.before, c.after) == ("conditional", "required")
