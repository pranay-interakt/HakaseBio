"""Study-set derivation against the ICH guideline tables."""

import pytest

from hos.core.regulatory import (
    ClinicalPopulation,
    Indication,
    Modality,
    ProgramContext,
    Route,
    Timing,
    derive_study_set,
)
from hos.core.regulatory.engine import (
    RequirementStatus,
    m3r2_marketing_duration,
    m3r2_trial_support_duration,
)


@pytest.mark.parametrize(
    "days,rodent,nonrodent",
    [
        (7, 2, 2),
        (14, 2, 2),
        (28, 4, 4),
        (182, 26, 26),
        (365, 26, 39),
    ],
)
def test_m3r2_table1(days, rodent, nonrodent):
    r, n, _ = m3r2_trial_support_duration(days)
    assert (r, n) == pytest.approx((rodent, nonrodent))


@pytest.mark.parametrize(
    "days,weeks", [(10, (4, 4)), (30, (13, 13)), (90, (26, 26)), (365, (26, 39))]
)
def test_m3r2_table2(days, weeks):
    r, n, _ = m3r2_marketing_duration(days)
    assert (r, n) == pytest.approx(weeks)


def _sm(indication=Indication.CHRONIC_NON_ONCOLOGY, **kw):
    base = dict(
        modality=Modality.SMALL_MOLECULE,
        indication=indication,
        route=Route.ORAL,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    base.update(kw)
    return derive_study_set(ProgramContext(**base))


def _ids(ss, status=RequirementStatus.REQUIRED):
    return {r.id for r in ss.requirements if r.status is status}


def test_small_molecule_fih_core():
    ss = _sm()
    fih = {r.id for r in ss.due_by(Timing.BEFORE_FIRST_IN_HUMAN)}
    for need in (
        "safety.core_battery",
        "safety.herg",
        "tox.repeat_dose_rodent",
        "tox.repeat_dose_nonrodent",
        "genotox.ames",
        "adme.metabolic_stability",
    ):
        assert need in fih


def test_chronic_use_triggers_carcinogenicity():
    assert "carc.bioassay" in _ids(_sm())
    assert "carc.bioassay" in _ids(
        _sm(intended_clinical_duration_days=60), RequirementStatus.NOT_REQUIRED
    )


def test_s9_waivers():
    ss = _sm(indication=Indication.ADVANCED_CANCER)
    waived = _ids(ss, RequirementStatus.NOT_REQUIRED)
    assert {"safety.core_battery", "carc.bioassay"} <= waived
    geno = next(r for r in ss.requirements if r.id == "genotox.battery")
    assert geno.timing is Timing.MARKETING


def test_wocbp_moves_efd_earlier():
    ss = _sm(populations=(ClinicalPopulation.WOMEN_OF_CHILDBEARING_POTENTIAL,))
    efd = next(r for r in ss.requirements if r.id == "dart.efd")
    assert efd.timing is Timing.BEFORE_WOCBP


def test_unknown_absorbance_is_conditional_not_dropped():
    ss = _sm()
    photo = next(r for r in ss.requirements if r.id == "photo.assessment")
    assert photo.status is RequirementStatus.CONDITIONAL and photo.pending_fact


def test_mab_follows_s6():
    ss = derive_study_set(
        ProgramContext(
            modality=Modality.MONOCLONAL_ANTIBODY,
            indication=Indication.CHRONIC_NON_ONCOLOGY,
            route=Route.SUBCUTANEOUS,
            intended_clinical_duration_days=365,
            max_trial_duration_days=84,
            pharmacologically_relevant_species=("cynomolgus monkey",),
        )
    )
    assert "genotox.battery" in _ids(ss, RequirementStatus.NOT_REQUIRED)
    assert "bio.tissue_cross_reactivity" in _ids(ss)


def test_cell_therapy_cites_cber():
    ss = derive_study_set(
        ProgramContext(
            modality=Modality.CELL_THERAPY,
            indication=Indication.ADVANCED_CANCER,
            route=Route.INTRAVENOUS,
            intended_clinical_duration_days=1,
            max_trial_duration_days=1,
        )
    )
    assert all(r.citation.key == "fda_cber_cgt_2013" for r in ss.requirements)


def test_every_requirement_is_cited():
    for ss in (_sm(), _sm(indication=Indication.ADVANCED_CANCER)):
        for r in ss.requirements:
            assert r.citation.text and r.section and r.rationale


# ---- a duration the guideline does not state is not invented ---------------------------


def _ctx(**kw):
    base = dict(
        modality=Modality.SMALL_MOLECULE,
        indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    return ProgramContext(**{**base, **kw})


def _req(ctx, rid):
    return next((r for r in derive_study_set(ctx).requirements if r.id == rid), None)


def test_s9_repeat_dose_follows_the_clinical_schedule_with_no_invented_floor():
    """ICH S9 scopes the study to the clinical schedule and states no minimum duration."""
    short = _req(
        _ctx(indication=Indication.ADVANCED_CANCER, max_trial_duration_days=7), "tox.repeat_dose"
    )
    assert short is not None and short.duration_weeks == pytest.approx(1.0)
    longer = _req(
        _ctx(indication=Indication.ADVANCED_CANCER, max_trial_duration_days=56), "tox.repeat_dose"
    )
    assert longer is not None and longer.duration_weeks == pytest.approx(8.0)
    assert "S9 sections 2.4 and 3.3" in short.rationale


def test_s6_biologic_duration_is_left_to_the_programme():
    """S6(R1) gives a range, not a threshold, so no single duration is asserted under it."""
    r = _req(
        _ctx(
            modality=Modality.MONOCLONAL_ANTIBODY,
            route=Route.INTRAVENOUS,
            pharmacologically_relevant_species=("cynomolgus monkey",),
        ),
        "tox.repeat_dose",
    )
    assert r is not None
    assert r.duration_weeks is None
    assert "set by the programme" in r.rationale
    assert r.citation.key == "ich_s6r1"
