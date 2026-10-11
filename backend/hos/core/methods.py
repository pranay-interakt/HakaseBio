"""Method registry.

Every computation in the scientific core names the :class:`~hos.core.provenance.Method`
that produced it, and every method carries its primary citation, assumptions and
limits. These travel with the resulting value, so a reviewer can see the
conditions under which a number is valid without reading the implementation.
"""

from __future__ import annotations

from typing import Final

from hos.core.citations import cite
from hos.core.provenance import Method

__all__ = ["METHODS", "method"]


def _m(
    id: str,
    name: str,
    citation_keys: tuple[str, ...],
    version: str = "1.0.0",
    assumptions: tuple[str, ...] = (),
    limits: tuple[str, ...] = (),
) -> tuple[str, Method]:
    return id, Method(
        id=id,
        version=version,
        name=name,
        citations=tuple(cite(k) for k in citation_keys),
        assumptions=assumptions,
        limits=limits,
    )


METHODS: Final[dict[str, Method]] = dict(
    [
        # ---- molecular descriptors -----------------------------------------
        _m("descr.mw", "Molecular weight (RDKit)", ("rdkit",)),
        _m("descr.clogp", "Crippen octanol/water logP", ("wildman1999", "rdkit"),
           assumptions=("atom-contribution model fitted to a neutral-species training set",),
           limits=("not a measured logD; ionisation at physiological pH is not modelled",)),
        _m("descr.tpsa", "Topological polar surface area", ("ertl2000", "rdkit"),
           limits=("fragment-based 2D estimate; conformation-independent",)),
        _m("descr.hbd", "Hydrogen-bond donor count (Lipinski)", ("lipinski2001", "rdkit")),
        _m("descr.hba", "Hydrogen-bond acceptor count (Lipinski)", ("lipinski2001", "rdkit")),
        _m("descr.rotb", "Rotatable bond count", ("veber2002", "rdkit")),
        _m("descr.mr", "Molar refractivity (Crippen)", ("wildman1999", "rdkit")),
        _m("descr.qed", "Quantitative estimate of drug-likeness", ("bickerton2012", "rdkit"),
           limits=("a desirability score trained on oral drugs; not a potency or safety measure",)),
        _m("descr.fsp3", "Fraction of sp3-hybridised carbons", ("rdkit",)),
        _m("descr.rings", "Ring count", ("rdkit",)),
        _m("descr.heavy_atoms", "Heavy atom count", ("rdkit",)),
        _m("descr.aromatic_rings", "Aromatic ring count", ("rdkit",)),
        _m("rule.lipinski_ro5", "Lipinski rule-of-five violation count", ("lipinski2001",),
           limits=("an oral-absorption heuristic from a 1997 dataset; not a pass/fail gate",)),
        _m("rule.veber", "Veber oral bioavailability criteria", ("veber2002",),
           limits=("derived from rat oral bioavailability data",)),
        # ---- DMPK / IVIVE ----------------------------------------------------
        _m("adme.depletion_fit", "First-order substrate depletion fit (ln-linear regression)",
           ("obach1999",),
           assumptions=(
               "substrate concentration is well below Km so depletion is first-order",
               "only the linear region of ln(fraction remaining) vs time is fitted",
           ),
           limits=(
               "an R-squared below the configured threshold, or total depletion under "
               "about 20%, makes the rate constant poorly estimable",
           )),
        _m("adme.percent_remaining", "Parent remaining relative to the zero-time sample",
           ("obach1999",),
           assumptions=("response is proportional to concentration over the measured range",),
           limits=("a ratio of instrument responses; requires a common internal standard",)),
        _m("adme.clint_invitro", "Apparent in vitro intrinsic clearance from depletion half-life",
           ("obach1999", "houston1994"),
           assumptions=("first-order depletion", "no significant non-specific binding unless corrected"),
           limits=("scaled per mg microsomal protein; hepatocyte data require a different scalar",)),
        _m("adme.fu_mic_predicted", "Predicted microsomal unbound fraction from lipophilicity",
           ("hallifax2006", "gertz2008"),
           assumptions=("binding is driven by lipophilicity at the stated microsomal concentration",),
           limits=("reliable for logP/D 0-3 (below 5 at <= 0.1 mg/mL protein) per Gertz 2008; "
                   "outside that range fu,mic should be measured",)),
        _m("adme.clint_invivo", "Scaling of in vitro intrinsic clearance to the whole liver",
           ("obach1999", "barter2007", "houston1994"),
           assumptions=("microsomal protein per gram liver and liver weight are population means",)),
        _m("adme.clh_well_stirred", "Hepatic clearance by the well-stirred (venous equilibrium) model",
           ("wilkinson1975", "obach1999"),
           assumptions=(
               "the liver is a single well-mixed compartment",
               "only unbound drug is available for metabolism",
               "hepatic metabolism is the dominant clearance route",
           ),
           limits=(
               "ignores permeability limitation and transporter-mediated uptake",
               "population-mean blood flow and binding; no inter-individual variability",
           )),
        _m("adme.extraction_ratio", "Hepatic extraction ratio and predicted hepatic availability",
           ("wilkinson1975",),
           limits=("hepatic first pass only; gut-wall extraction is not included",)),
        _m("adme.fu_blood", "Unbound fraction in blood from plasma binding and blood:plasma ratio",
           ("obach1999",)),
        # ---- pharmacology ----------------------------------------------------
        _m("pharm.hill_4pl", "Four-parameter logistic (Hill) concentration-response fit",
           ("delean1978",),
           assumptions=("a single sigmoidal transition between two asymptotes",),
           limits=(
               "an inflection point outside the tested concentration range yields an "
               "extrapolated potency which is flagged rather than reported as measured",
           )),
        _m("safety.herg_margin", "hERG safety margin over free therapeutic exposure",
           ("redfern2003", "ich_s7b", "ich_e14_s7b_qa"),
           limits=("a single-channel in vitro margin; it is not a proarrhythmia prediction",)),
        _m("pharm.percent_inhibition",
           "Per-cell fractional current inhibition with background subtraction",
           ("ich_e14_s7b_qa", "ridder2020"),
           assumptions=("residual current after a saturating selective blocker is "
                        "non-hERG background (E14/S7B Q&A 2.1 item 2)",
                        "drug effect measured at steady state"),
           limits=("rundown during the recording is not corrected; vehicle controls show its "
                   "magnitude",)),
        _m("pharm.molar_to_mass_concentration", "Molar to mass concentration (IC50 in ng/mL)",
           ("ich_e14_s7b_qa",),
           assumptions=("molecular weight of the registered structure (free form, not a salt)",)),
        _m("safety.free_cmax_qa12",
           "Free high clinical exposure with the 1% unbound-fraction floor",
           ("ich_e14_s7b_qa",),
           assumptions=("fu,p below 1% is set to 1% because of protein-binding measurement "
                        "uncertainty (S7B Q&A 1.2)",),
           limits=("the clinical Cmax,ss is an input; its uncertainty is not propagated",)),
        _m("stats.group_summary", "Group mean and standard deviation per dose level",
           ("oecd_tg408",),
           limits=("descriptive only",)),
        _m("stats.dunnett", "Dunnett many-to-one comparison of each dose group with control",
           ("dunnett1955", "jaki2013"),
           assumptions=("approximately normal residuals within groups",
                        "homogeneous variances across groups"),
           limits=("statistical significance is not adversity; biologically significant "
                   "effects can be non-significant (FDA 2005 glossary, NOAEL)",
                   "no transformation or non-parametric alternative is applied",)),
        _m("bioanalysis.calibration",
           "Calibration curve by (weighted) least squares, model and weighting per procedure",
           ("ich_m10",),
           assumptions=("the regression model and weighting were fixed during method validation "
                        "by written procedure (M10 3.2.4)",),
           limits=("blank and zero samples are excluded from the regression (M10 3.2.4)",)),
        _m("bioanalysis.back_calculation", "Back-calculated concentration from the run's curve",
           ("ich_m10",)),
        _m("bioanalysis.accuracy_precision",
           "Accuracy (% of nominal) and precision (%CV) within and between runs", ("ich_m10",),
           assumptions=("between-run values combine the data from all accepted runs "
                        "(M10 3.2.5.2)",)),
        _m("bioanalysis.interference",
           "Interfering response as a percentage of the LLOQ analyte or IS response",
           ("ich_m10",)),
        _m("bioanalysis.isr", "Incurred sample reanalysis percent difference", ("ich_m10",),
           assumptions=("% difference relative to the mean of the initial and repeat values "
                        "(M10 section 5)",)),
        # ---- non-compartmental exposure / toxicokinetics -----------------------
        _m("nca.cmax_tmax", "Maximum observed concentration and its time",
           ("fda_ba_2022", "cdisc_pk_terms"),
           assumptions=("taken directly from the data without interpolation (FDA 2022 "
                        "III.A.9.a); the first occurrence is used when the maximum is tied",),
           limits=("with a monitoring design (1-3 samples per interval) the observed maximum "
                   "estimates Cmax only roughly (ICH S3A Note 1)",)),
        _m("nca.auc_last",
           "AUC from time zero to the last measurable concentration (trapezoidal rule as stated)",
           ("fda_ba_2022", "ich_m13a", "certara_phoenix_nca", "purves1992"),
           assumptions=("actual sampling times (ICH M13A 2.2.2.2)",
                        "BLQ at or before the first quantifiable concentration = 0; later BLQ "
                        "excluded",),
           limits=("no extrapolation beyond the last measurable concentration",
                   "a profile without a time-zero sample has no AUC(0-t)",)),
        _m("nca.auc_tau", "AUC over the dosing interval, from a quantifiable end-of-interval "
           "sample", ("fda_ba_2022", "certara_phoenix_nca", "cdisc_pk_terms"),
           limits=("not reported when the end-of-interval sample is BLQ (no extrapolation)",)),
        _m("nca.c0_back_extrapolation",
           "IV bolus concentration at dose time by log-linear back-extrapolation of the first two "
           "quantifiable points", ("certara_phoenix_nca",),
           limits=("unavailable when the first two points do not decline (no substitution)",)),
        _m("nca.lambda_z",
           "Terminal rate constant by least squares of ln C on t over the selected terminal points",
           ("fda_ba_2022", "ich_m13a", "certara_phoenix_nca"),
           assumptions=("the terminal phase is selected by the scientist (start time); at least "
                        "three declining points (FDA 2022 Appendix A; ICH M13A 2.1.8)",),
           limits=("the vendor 'best fit' (largest adjusted R-squared) is shown as a "
                   "suggestion only",)),
        _m("nca.half_life", "Terminal half-life ln2/lambda_z", ("certara_phoenix_nca",
                                                                "cdisc_pk_terms")),
        _m("nca.auc_inf", "AUC extrapolated to infinity, AUC(0-t) + Clast/lambda_z (observed "
           "Clast)", ("fda_ba_2022", "cdisc_pk_terms"),
           limits=("depends on the selected terminal phase",)),
        _m("nca.auc_pct_extrap", "Percentage of AUCinf extrapolated beyond Tlast",
           ("ema_be_2010", "certara_phoenix_nca")),
        _m("nca.moments",
           "AUMC by the stated trapezoidal rule, AUMCinf and MRTinf (minus half the infusion time "
           "for an infusion)", ("certara_phoenix_nca", "benet2012"),
           assumptions=("linear disposition",)),
        _m("nca.clearance", "Clearance Dose/AUCinf (CL/F after extravascular dosing)",
           ("certara_phoenix_nca", "benet2012", "cdisc_pk_terms"),
           assumptions=("linear disposition; complete dose delivered",),
           limits=("after extravascular dosing this is apparent clearance CL/F",)),
        _m("nca.volume_z", "Terminal-phase volume Dose/(lambda_z AUCinf) (Vz/F extravascular)",
           ("certara_phoenix_nca",)),
        _m("nca.vss", "Steady-state volume CL x MRTinf, intravenous dosing only",
           ("certara_phoenix_nca", "benet2012"),
           assumptions=("linear disposition with elimination from the sampled compartment "
                        "(Benet 2012)",),
           limits=("not computed after extravascular dosing: MRT then includes absorption",)),
        _m("nca.bioavailability",
           "Absolute bioavailability from dose-normalised group mean AUCinf, extravascular / "
           "intravenous", ("shang2022", "cdisc_pk_terms"),
           assumptions=("linear pharmacokinetics between the two doses when they differ",)),
        _m("sim.pk_declared_profile",
           "Simulated single-dose concentrations from declared true group profiles with "
           "log-normal between-animal and residual variability", ("fda_ba_2022",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("ppb.fraction_unbound",
           "Fraction unbound by equilibrium dialysis: buffer-chamber / plasma-chamber "
           "concentration at equilibrium; replicate mean and SD",
           ("thermo_red_2023", "waters2008"),
           assumptions=("equilibrium was reached at the stated incubation time",
                        "buffer and plasma samples are matrix-matched before analysis",),
           limits=("no volume-shift correction",
                   "a buffer concentration below the LLOQ bounds fu from above only",)),
        _m("ppb.positive_control_m12",
           "In-study positive control within 3-fold of the mean fu,p from assay qualification",
           ("ich_m12",),
           assumptions=("the qualified mean fu,p comes from the laboratory's assay "
                        "qualification",),
           limits=("ICH M12 states the rule for human plasma in drug-interaction work; it is "
                   "applied to any species for which the protocol declares a positive control",)),
        _m("sim.ppb_declared_fu",
           "Simulated equilibrium-dialysis chamber concentrations from declared true fu values "
           "with log-normal analytical variability", ("thermo_red_2023",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("genetox.revertant_summary",
           "Revertant colonies per plate: mean and SD per strain, metabolic activation and "
           "concentration (OECD TG 471 paragraphs 32-33)", ("oecd_tg471",)),
        _m("genetox.fold_over_vehicle",
           "Mean revertants divided by the concurrent vehicle-control mean", ("oecd_tg471",),
           limits=("displayed for information: neither OECD TG 471 nor ICH S2(R1) sets a fold "
                   "threshold for a positive result",)),
        _m("sim.ames_counts",
           "Simulated revertant counts from declared expected values per strain, activation and "
           "concentration (exact or Poisson-sampled)", ("oecd_tg471",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("tk.dose_normalised", "Exposure divided by the administered dose",
           ("ich_s3a", "cdisc_pk_terms")),
        _m("tk.group_summary",
           "Group mean, SD, median and range of individual exposure parameters", ("ich_s3a",),
           assumptions=("descriptive statistics per dose, sex and day (ICH S3A 3.9)",),
           limits=("small groups give low precision; individual data may be more informative "
                   "(ICH S3A 3.9)",)),
        _m("tk.dose_proportionality_power",
           "Power-model slope with a confidence interval against a pre-stated acceptance interval",
           ("smith2000", "hummel2009", "braeckman2022", "shang2022"),
           assumptions=("PK = beta0 * Dose^beta1, fitted on ln-ln scale by least squares over "
                        "individual animals (parallel groups)",
                        "the acceptance limits theta_L/theta_H and confidence level are stated "
                        "before analysis",),
           limits=("control animals and unquantifiable exposure are excluded (log of zero)",
                   "the interval form is the exact algebraic consequence of the power model; "
                   "Smith 2000 is cited from its abstract",)),
        _m("tk.exposure_ratio_days",
           "Observed ratio of group mean exposure on a later profile day to the first",
           ("cdisc_pk_terms", "ich_s3a"),
           limits=("an observed ratio; it is an accumulation ratio at steady state only if "
                   "steady state is established, which is a judgement (CDISC ARAUC)",)),
        _m("tk.exposure_multiple",
           "Animal exposure divided by the stated human exposure", ("ich_s3a",),
           assumptions=("the human exposure is an input with its own provenance (measured or "
                        "predicted) and the same matrix and analyte",),
           limits=("total, not unbound, exposure unless both inputs are unbound "
                   "(ICH S3A section 2)",)),
        _m("sim.tk_power_profile",
           "Simulated concentrations from a declared reference profile scaled by the power "
           "model, with declared day and sex factors and log-normal variability",
           ("smith2000",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("sim.bioanalytical_runs",
           "Simulated chromatographic responses from a declared linear response model with "
           "multiplicative noise", ("ich_m10",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        # ---- verification data generators ------------------------------------
        _m("sim.first_order_depletion",
           "Simulated microsomal depletion from a declared first-order model with "
           "multiplicative analytical noise",
           ("obach1999",),
           assumptions=("first-order depletion at the declared half-life",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("sim.four_parameter_logistic",
           "Simulated concentration-response from a declared 4PL model with additive noise",
           ("delean1978",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        _m("sim.repeat_dose_normal",
           "Simulated individual-animal endpoint values from declared normal distributions",
           ("dunnett1955",),
           limits=("for software verification and workflow demonstration only; "
                   "never admissible as evidence",)),
        # ---- dose projection -------------------------------------------------
        _m("dose.hed_bsa", "Human equivalent dose by body-surface-area scaling",
           ("fda_mrsd_2005",),
           assumptions=("systemic exposure scales with body surface area across species",),
           limits=(
               "not applicable where the FDA guidance directs mg/kg or exposure-based "
               "scaling, nor to biologics dosed on a MABEL basis",
           )),
        _m("dose.mrsd", "Maximum recommended starting dose from the most sensitive species",
           ("fda_mrsd_2005", "ema_fih_2017"),
           assumptions=("the NOAEL-derived HED of the most sensitive relevant species governs",),
           limits=(
               "must be compared against the pharmacologically active dose and, for "
               "immune agonists and biologics, against MABEL; the lowest value governs",
           )),
    ]
)


def method(method_id: str) -> Method:
    """Look up a method definition, raising a clear error if it is not registered."""
    try:
        return METHODS[method_id]
    except KeyError:
        raise KeyError(
            f"unknown method {method_id!r}. Register it in hos/core/methods.py with its "
            "primary citation, assumptions and limits before using it."
        ) from None
