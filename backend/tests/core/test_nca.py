"""Non-compartmental exposure analysis: hand-calculated and analytically exact values."""

import math

import pytest

from hos.core.nca import apply_blq_rule, auc, auc_segment, exposure_nca


def test_linear_trapezoid_hand_calculation():
    # 0.5*(0+10)*1 + 0.5*(10+8)*1 + 0.5*(8+4)*2 = 5 + 9 + 12
    assert auc([0, 1, 2, 4], [0, 10, 8, 4], "linear") == pytest.approx(26.0, rel=1e-12)


def test_linear_trapezoid_is_exact_for_a_straight_line():
    t = [0, 0.5, 1.5, 4]
    assert auc(t, [3 * x for x in t], "linear") == pytest.approx(24.0, rel=1e-12)


def test_log_down_is_exact_for_exponential_decline():
    # C = 100 exp(-0.2 t); integral 0-8 = 500 (1 - exp(-1.6))
    t = [0, 1, 2, 4, 8]
    c = [100 * math.exp(-0.2 * x) for x in t]
    exact = 500 * (1 - math.exp(-1.6))
    assert auc(t, c, "linear_up_log_down") == pytest.approx(exact, rel=1e-12)
    assert auc(t, c, "linear") > exact  # the linear rule overestimates a convex decline


def test_log_segment_formula_and_fallbacks():
    assert auc_segment(2, 8, 4, 4, "linear_up_log_down") == pytest.approx(8 / math.log(2), rel=1e-12)
    # rising, equal, or falling to zero: linear trapezoid
    assert auc_segment(0, 0, 1, 10, "linear_up_log_down") == 5
    assert auc_segment(0, 5, 1, 5, "linear_up_log_down") == 5
    assert auc_segment(0, 4, 2, 0, "linear_up_log_down") == 4
    with pytest.raises(ValueError):
        auc_segment(1, 1, 1, 2, "linear")


def test_blq_rule_leading_zero_then_excluded():
    t, c = apply_blq_rule([0, 0.5, 1, 2, 4, 8, 24], [None, None, 5, 10, 6, None, None])
    assert t == [0, 0.5, 1, 2, 4] and c == [0, 0, 5, 10, 6]
    t, c = apply_blq_rule([0, 1, 2, 4], [0.0, 10, None, 4])
    assert t == [0, 1, 4] and c == [0, 10, 4]


def test_exposure_parameters_from_a_profile_with_blq():
    r = exposure_nca([0, 0.5, 1, 2, 4, 8, 24], [None, None, 5, 10, 6, None, None],
                     method="linear", tau_nominal_index=6)
    assert (r.cmax, r.tmax, r.clast, r.tlast) == (10, 2, 6, 4)
    assert r.auc_last == pytest.approx(0 + 1.25 + 7.5 + 16)
    assert r.auc_tau is None and "BLQ" in r.reasons["auc_tau"]
    assert (r.n_samples, r.n_quantifiable) == (7, 3)


def test_auc_tau_uses_the_end_of_interval_sample():
    r = exposure_nca([0, 1, 2, 4, 24], [0, 10, 8, 4, 1], method="linear", tau_nominal_index=4)
    assert r.auc_tau == pytest.approx(26 + 0.5 * (4 + 1) * 20)
    assert r.auc_tau == r.auc_last


def test_tmax_is_the_first_occurrence_of_a_tied_maximum():
    r = exposure_nca([0, 1, 2], [0, 7, 7], method="linear")
    assert r.tmax == 1


def test_no_time_zero_sample_means_no_auc():
    r = exposure_nca([0.5, 1, 2], [3, 4, 2], method="linear")
    assert r.cmax == 4 and r.auc_last is None and "time-zero" in r.reasons["auc_last"]


def test_monitoring_design_reports_concentrations_only():
    r = exposure_nca([0, 2, 24], [0, 7, 1], method="linear", auc_estimable=False)
    assert r.cmax == 7 and r.auc_last is None and "S3A Note 1" in r.reasons["auc_last"]


def test_all_blq_profile_has_no_exposure_parameters():
    r = exposure_nca([0, 1, 2], [None, None, None], method="linear")
    assert r.cmax is None and r.auc_last is None and "BLQ" in r.reasons["cmax"]


def test_times_must_increase():
    with pytest.raises(ValueError):
        exposure_nca([0, 2, 1], [0, 1, 2], method="linear")
