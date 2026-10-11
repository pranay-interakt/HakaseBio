"""Bioanalysis core against exact cases and the formulas stated in ICH M10."""

import pytest

from hos.core.bioanalysis import (
    M10_CHROMATOGRAPHIC,
    accuracy_percent,
    bias_percent,
    cv_percent,
    fit_calibration,
    isr_percent_difference,
    isr_required_count,
)


def test_exact_linear_curve_recovers_coefficients_and_back_calculates():
    x = [1, 2, 5, 10, 20, 50, 100, 200]
    y = [0.002 + 0.01 * v for v in x]
    for w in ("none", "1/x", "1/x^2"):
        fit = fit_calibration(x, y, model="linear", weighting=w)
        assert fit.coefficients == pytest.approx((0.002, 0.01), rel=1e-9, abs=1e-12)
        assert fit.back_calculate(0.002 + 0.01 * 37.5) == pytest.approx(37.5)


def test_weighted_fit_matches_closed_form_weighted_regression():
    # independent closed form: b = sum w(x-xw)(y-yw) / sum w(x-xw)^2 ; a = yw - b xw
    x, y = [1.0, 2.0, 4.0, 8.0], [1.1, 1.9, 4.2, 7.7]
    w = [1 / v**2 for v in x]
    sw = sum(w)
    xw = sum(wi * xi for wi, xi in zip(w, x, strict=True)) / sw
    yw = sum(wi * yi for wi, yi in zip(w, y, strict=True)) / sw
    b = sum(wi * (xi - xw) * (yi - yw) for wi, xi, yi in zip(w, x, y, strict=True)) / sum(
        wi * (xi - xw) ** 2 for wi, xi in zip(w, x, strict=True)
    )
    a = yw - b * xw
    fit = fit_calibration(x, y, model="linear", weighting="1/x^2")
    assert fit.coefficients == pytest.approx((a, b), rel=1e-10)


def test_quadratic_curve_inverts_on_the_positive_branch():
    x = [1, 2, 5, 10, 20, 50]
    y = [0.01 + 0.2 * v - 0.001 * v * v for v in x]
    fit = fit_calibration(x, y, model="quadratic", weighting="1/x")
    assert fit.back_calculate(0.01 + 0.2 * 30 - 0.001 * 900) == pytest.approx(30.0, rel=1e-8)


def test_accuracy_bias_cv():
    assert accuracy_percent(9.0, 10.0) == pytest.approx(90.0)
    assert bias_percent(11.5, 10.0) == pytest.approx(15.0)
    assert cv_percent([1.0, 2.0, 3.0]) == pytest.approx(50.0)
    assert cv_percent([5.0]) is None


def test_isr_formula_and_sample_count_follow_m10_section_5():
    assert isr_percent_difference(90.0, 110.0) == pytest.approx(20.0)
    assert isr_percent_difference(100.0, 80.0) == pytest.approx(-200 / 9)
    assert isr_required_count(1000) == 100
    assert isr_required_count(1500) == 125  # 100 + 5% of 500
    assert isr_required_count(45) == 5  # 10% rounded up


def test_m10_criteria_table_is_complete_and_sectioned():
    c = M10_CHROMATOGRAPHIC
    assert (c["qc_accuracy"].value, c["qc_accuracy_lloq"].value) == (15, 20)
    assert c["cal_fraction_passing"].value == 75 and c["selectivity_min_sources"].value == 6
    assert c["isr_limit"].value == 20 and c["isr_fraction"].value == pytest.approx(2 / 3)
    assert all(v.section for v in c.values())


def test_too_few_points_rejected():
    with pytest.raises(ValueError):
        fit_calibration([1, 2], [1, 2], model="linear", weighting="none")
