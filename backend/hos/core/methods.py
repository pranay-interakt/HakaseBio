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
        _m("adme.clint_invitro", "Apparent in vitro intrinsic clearance from depletion half-life",
           ("obach1999", "houston1994"),
           assumptions=("first-order depletion", "no significant non-specific binding unless corrected"),
           limits=("scaled per mg microsomal protein; hepatocyte data require a different scalar",)),
        _m("adme.fu_mic_predicted", "Predicted microsomal unbound fraction from lipophilicity",
           ("hallifax2006",),
           assumptions=("binding is driven by lipophilicity at the stated microsomal concentration",),
           limits=("a regression model; outside its fitted logP range the estimate is unreliable",)),
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
