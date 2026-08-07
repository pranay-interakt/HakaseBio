"""The regulatory toxicology outcome panel — one domain per study a lab runs.

A GLP preclinical package is not one number; it is a set of studies, each with a
guideline, a target-organ question, and a defined set of findings. This module
reproduces that structure *as far as real models allow*, and says so plainly
where they do not.

For every domain it reports:

  ``drivers``               the actual model outputs behind the call, each with
                            its own value, model name and provenance
  ``hazard_call``           low / moderate / high / not_predicted, from the
                            driver probabilities against named thresholds
  ``exposure_context``      whether the study doses actually deliver drug to the
                            organ in question, from the PBPK biodistribution
  ``anticipated_findings``  the finding vocabulary a study would score for that
                            mechanism — emitted only when a driver is flagged,
                            and labelled as a mechanism→finding mapping, not a
                            prediction of severity or incidence
  ``guideline``             the OECD/ICH study the domain corresponds to

WHAT THIS IS NOT
    It does not invent numeric clinical-pathology values, organ weights, body-
    weight changes, incidence rates, or severity grades. Those are measurements;
    no model in this platform predicts them, so they are reported as the
    findings a study would *look for*, never as findings it *found*.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.model_panel import ModelPanel, ld50_mg_per_kg

# Named probability thresholds for turning a classifier output into a hazard
# band. Surfaced in the output so nothing is a hidden constant.
HAZARD_THRESHOLDS = {"high": 0.70, "moderate": 0.40}

# Tissue:plasma AUC ratio above which an organ is considered meaningfully
# exposed for the purpose of contextualising an organ-specific hazard.
EXPOSED_TISSUE_RATIO = 0.3


def _band(probability: float | None) -> str:
    if probability is None:
        return "not_predicted"
    if probability >= HAZARD_THRESHOLDS["high"]:
        return "high"
    if probability >= HAZARD_THRESHOLDS["moderate"]:
        return "moderate"
    return "low"


def _driver(
    panel: ModelPanel, endpoint: str, label: str, *, kind: str = "probability"
) -> dict[str, Any] | None:
    """One model output, verbatim, with its provenance — or None if absent.

    ``kind`` distinguishes a classifier probability (which can be banded on the
    shared 0–1 hazard axis) from a regression output such as LD50, which cannot.
    """
    entry = panel.endpoints.get(endpoint)
    if not entry or entry.get("value") is None:
        return None
    return {
        "endpoint": endpoint,
        "label": label,
        "kind": kind,
        "value": round(float(entry["value"]), 4),
        "model": entry.get("model"),
        "provenance": entry.get("provenance"),
        "source": entry.get("source"),
        "flagged": entry.get("flagged"),
        "in_domain": entry.get("in_domain"),
    }


def _worst(drivers: list[dict[str, Any]]) -> float | None:
    """Highest value among the drivers that live on the 0–1 hazard axis."""
    values = [
        d["value"]
        for d in drivers
        if isinstance(d.get("value"), (int, float)) and d.get("kind", "probability") != "regression"
    ]
    return max(values) if values else None


def _organ_exposure(biodistribution: dict[str, Any], organ: str) -> dict[str, Any]:
    """Whether the study doses actually deliver drug to this organ."""
    per_arm = (biodistribution or {}).get("per_arm") or []
    if not per_arm:
        return {"available": False, "reason": "No biodistribution was simulated."}
    # Use the top dose group (last arm) — the exposure that drives toxicity.
    top = per_arm[-1]
    row = next((r for r in top.get("tissues", []) if r["organ"] == organ), None)
    if not row:
        return {
            "available": False,
            "reason": f"The PBPK model has no explicit {organ} compartment.",
        }
    ratio = row.get("tissue_plasma_auc_ratio")
    return {
        "available": True,
        "organ": organ,
        "label": row.get("label"),
        "arm": (top.get("arm") or {}).get("label"),
        "c_max_mg_per_l": row.get("c_max_median"),
        "auc_mg_h_per_l": row.get("auc_median"),
        "tissue_plasma_auc_ratio": ratio,
        "meaningfully_exposed": (ratio is not None and ratio >= EXPOSED_TISSUE_RATIO),
        "note": (
            None
            if ratio is None
            else (
                f"At the top dose the {row.get('label', organ)} sees {ratio:.2g}× the plasma "
                "exposure."
            )
        ),
    }


# ── mechanism → finding vocabulary ────────────────────────────────────────────
# What a study scores when the named mechanism is active. Sourced from standard
# regulatory-toxicology practice (ICH S7A/S8, OECD 407/408/451/471/474, FDA
# non-clinical review vocabulary). These are the endpoints a pathologist would
# look at, NOT predicted findings.
_FINDINGS: dict[str, dict[str, list[str]]] = {
    "hepatotoxicity": {
        "clinical_pathology": [
            "ALT (alanine aminotransferase) — hepatocellular injury marker",
            "AST (aspartate aminotransferase)",
            "ALP (alkaline phosphatase) — cholestatic marker",
            "Total and direct bilirubin",
            "Total bile acids",
            "Albumin and total protein (synthetic function)",
        ],
        "organ_weight": ["Absolute and relative liver weight"],
        "histopathology": [
            "Hepatocellular hypertrophy (centrilobular)",
            "Hepatocellular single-cell / confluent necrosis",
            "Bile-duct hyperplasia and canalicular cholestasis",
            "Kupffer-cell pigment, vacuolation, lipidosis",
        ],
        "in_life": ["Jaundice", "Reduced food consumption", "Body-weight loss"],
    },
    "cardiotoxicity": {
        "clinical_pathology": ["Cardiac troponin I/T", "CK-MB"],
        "organ_weight": ["Absolute and relative heart weight"],
        "histopathology": [
            "Myocardial degeneration / necrosis",
            "Interstitial fibrosis",
            "Vacuolar cardiomyopathy",
        ],
        "in_life": [
            "Telemetry: QTc interval, PR/QRS duration, arrhythmia",
            "Heart rate and arterial blood pressure",
        ],
    },
    "nephrotoxicity": {
        "clinical_pathology": [
            "BUN (blood urea nitrogen) and creatinine",
            "Urinary KIM-1, clusterin, NGAL, albumin",
            "Urine volume, specific gravity, casts",
            "Serum electrolytes (Na⁺, K⁺, Cl⁻, phosphate)",
        ],
        "organ_weight": ["Absolute and relative kidney weight"],
        "histopathology": [
            "Proximal-tubule degeneration / regeneration",
            "Tubular basophilia, casts, dilatation",
            "Papillary necrosis",
            "Glomerular changes",
        ],
        "in_life": ["Polyuria/oliguria", "Dehydration"],
    },
    "hematotoxicity": {
        "clinical_pathology": [
            "Red cell mass (RBC, haemoglobin, haematocrit)",
            "Reticulocyte count",
            "Total and differential white cell count",
            "Platelet count",
            "Coagulation (PT, APTT, fibrinogen)",
        ],
        "organ_weight": ["Spleen weight", "Thymus weight"],
        "histopathology": [
            "Bone-marrow cellularity and myeloid:erythroid ratio",
            "Splenic extramedullary haematopoiesis",
            "Lymphoid depletion (thymus, spleen, lymph nodes)",
        ],
        "in_life": ["Pallor", "Petechiae / bruising"],
    },
    "neurotoxicity": {
        "clinical_pathology": [],
        "organ_weight": ["Brain weight"],
        "histopathology": [
            "Neuronal necrosis / chromatolysis",
            "Gliosis",
            "Peripheral-nerve axonal degeneration",
        ],
        "in_life": [
            "Functional observational battery / modified Irwin screen",
            "Motor activity, gait, tremor, convulsions",
            "Body temperature, pupil size, salivation",
        ],
    },
    "endocrine_reproductive": {
        "clinical_pathology": [
            "Thyroid hormones (T3, T4, TSH)",
            "Sex hormones (testosterone, oestradiol, LH, FSH)",
        ],
        "organ_weight": [
            "Testes and epididymides",
            "Ovaries and uterus",
            "Prostate and seminal vesicles",
            "Adrenal glands",
            "Thyroid gland",
        ],
        "histopathology": [
            "Seminiferous-tubule degeneration; staged spermatogenesis",
            "Ovarian follicle counts; oestrous-cycle staging",
            "Thyroid follicular-cell hypertrophy/hyperplasia",
            "Adrenal cortical hypertrophy / vacuolation",
            "Mammary-gland and uterine changes",
        ],
        "in_life": ["Oestrous cyclicity", "Mating and fertility indices"],
    },
    "genetic_toxicology": {
        "clinical_pathology": [],
        "organ_weight": [],
        "histopathology": [],
        "in_life": [
            "Bacterial reverse mutation (Ames, OECD 471)",
            "In-vitro micronucleus / chromosome aberration (OECD 487/473)",
            "In-vivo rodent bone-marrow micronucleus (OECD 474)",
            "Comet assay in liver and glandular stomach (OECD 489)",
        ],
    },
    "carcinogenicity": {
        "clinical_pathology": [],
        "organ_weight": [],
        "histopathology": [
            "Full tumour incidence tabulation by organ and sex",
            "Pre-neoplastic foci (hepatic altered foci, thyroid hyperplasia)",
        ],
        "in_life": ["Palpable-mass tracking", "Survival analysis"],
    },
    "respiratory": {
        "clinical_pathology": [],
        "organ_weight": ["Lung weight"],
        "histopathology": [
            "Alveolar macrophage accumulation (foamy macrophages)",
            "Interstitial inflammation / fibrosis",
        ],
        "in_life": [
            "Whole-body plethysmography: respiratory rate, tidal volume, minute volume",
            "Respiratory pattern and effort",
        ],
    },
    "immunotoxicity": {
        "clinical_pathology": [
            "Lymphocyte subset immunophenotyping",
            "T-cell-dependent antibody response (TDAR, sheep RBC / KLH)",
        ],
        "organ_weight": ["Thymus", "Spleen", "Lymph nodes"],
        "histopathology": [
            "Thymic cortical lymphoid depletion",
            "Splenic white-pulp / periarteriolar lymphoid sheath depletion",
            "Germinal-centre changes in lymph nodes",
        ],
        "in_life": ["Infection incidence"],
    },
    "dermal_local": {
        "clinical_pathology": [],
        "organ_weight": [],
        "histopathology": ["Epidermal hyperplasia, spongiosis, dermal inflammation"],
        "in_life": [
            "Draize erythema/oedema scoring (OECD 404)",
            "Local lymph-node assay (OECD 429)",
            "Injection-site / gavage-site observations",
        ],
    },
    "metabolic": {
        "clinical_pathology": [
            "Glucose, insulin",
            "Triglycerides, total cholesterol, HDL/LDL",
        ],
        "organ_weight": ["Liver weight", "Adipose depots"],
        "histopathology": ["Hepatic steatosis", "Adipocyte hypertrophy"],
        "in_life": ["Body weight and body-weight gain", "Food consumption"],
    },
    "mitochondrial": {
        "clinical_pathology": ["Lactate", "Creatine kinase"],
        "organ_weight": [],
        "histopathology": [
            "Hepatocellular microvesicular steatosis",
            "Skeletal-muscle myofibre degeneration",
        ],
        "in_life": ["Lethargy", "Reduced activity", "Body-weight loss"],
    },
    "oxidative_proteotoxic": {
        "clinical_pathology": ["Markers of oxidative stress where scheduled"],
        "organ_weight": [],
        "histopathology": ["Portal/centrilobular hepatocellular stress response"],
        "in_life": [],
    },
    "phospholipidosis": {
        "clinical_pathology": [],
        "organ_weight": ["Lung", "Liver", "Spleen", "Lymph nodes"],
        "histopathology": [
            "Foamy macrophages (lung, lymphoid tissue)",
            "Cytoplasmic vacuolation with lamellar bodies on electron microscopy",
        ],
        "in_life": [],
    },
}


def _domain(
    *,
    domain_id: str,
    name: str,
    guideline: str,
    organ: str | None,
    drivers: list[dict[str, Any] | None],
    biodistribution: dict[str, Any],
    findings_key: str | None = None,
    mechanism: str,
    extra: dict[str, Any] | None = None,
    band_override: str | None = None,
    band_basis: str | None = None,
) -> dict[str, Any]:
    """Build one toxicology domain block from real drivers only."""
    live = [d for d in drivers if d]
    worst = _worst(live)
    band = band_override or _band(worst)
    block: dict[str, Any] = {
        "id": domain_id,
        "name": name,
        "guideline": guideline,
        "organ": organ,
        "mechanism": mechanism,
        "drivers": live,
        "hazard_call": {
            "level": band,
            "driving_probability": round(worst, 4) if worst is not None else None,
            "driving_endpoint": (
                max(live, key=lambda d: d["value"])["endpoint"] if live and worst else None
            ),
            "thresholds": HAZARD_THRESHOLDS,
            "basis": band_basis
            or (
                "No model in the resolved panel produces this endpoint; the domain is "
                "reported as not predicted rather than assumed negative."
                if band == "not_predicted"
                else (
                    f"Highest driver probability {worst:.2f} against the named "
                    f"high/moderate thresholds."
                )
            ),
        },
    }
    if organ:
        block["exposure_context"] = _organ_exposure(biodistribution, organ)
    key = findings_key or domain_id
    if band in {"high", "moderate"} and key in _FINDINGS:
        block["anticipated_findings"] = {
            **_FINDINGS[key],
            "note": (
                "The endpoints a study of this type scores for this mechanism (ICH/OECD "
                "practice). This is a mechanism→endpoint mapping, not a prediction that "
                "any finding will occur, and carries no severity or incidence."
            ),
        }
    elif key in _FINDINGS:
        block["anticipated_findings"] = {
            "note": (
                "No driver reached the moderate hazard threshold, so no targeted finding "
                "set is highlighted. Standard study endpoints still apply."
            )
        }
    if extra:
        block.update(extra)
    return block


def _cardiac_margin(
    panel: ModelPanel, arm_results: list[dict[str, Any]]
) -> dict[str, Any]:
    """hERG safety margin from the dedicated cardiotox model's IC50 band.

    The regulatory heuristic (ICH S7B / CiPA practice) is a ≥30-fold margin
    between the hERG IC50 and the free therapeutic Cmax. The in-house cardiotox
    model returns a *band* rather than a point IC50, so the margin is reported
    as a band-derived range and labelled as such — never a single fabricated
    IC50.
    """
    try:
        from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox

        res = predict_cardiotox(panel.smiles)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"Cardiotox model unavailable: {exc}"}
    prediction = (res or {}).get("prediction") or {}
    band = prediction.get("ic50_band") or prediction.get("estimated_ic50_band")
    if res.get("ml_available") is False:
        return {"available": False, "reason": res.get("error") or "hERG model unavailable."}

    # Free plasma Cmax at the top dose (mg/L → µM using MW; free via fu).
    top = next((a for a in reversed(arm_results) if a.get("available")), None)
    free_cmax_uM = None
    if top and panel.mw_g_per_mol:
        ep = ((top.get("cohort") or {}).get("endpoints") or {}).get("plasma") or {}
        c_max = (ep.get("c_max") or {}).get("median")
        fu = (((top.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
        if isinstance(c_max, (int, float)) and isinstance(fu, (int, float)):
            free_cmax_uM = (float(c_max) * float(fu) / panel.mw_g_per_mol) * 1000.0

    out: dict[str, Any] = {
        "available": True,
        "herg_risk_class": prediction.get("risk_class"),
        "herg_blocker_probability": prediction.get("blocker_probability")
        or prediction.get("probability"),
        "herg_ic50_band": band,
        "free_cmax_uM_top_dose": round(free_cmax_uM, 5) if free_cmax_uM is not None else None,
        "regulatory_target_margin": 30.0,
        "model": "Hakase CardioTox (hERG classifier) + PBPK free Cmax",
        "provenance": "ml + derived",
        "limitations": (
            "The hERG model returns a risk class and IC50 band, not a measured IC50, so a "
            "single numeric safety margin is not defensible. A patch-clamp hERG IC50 is "
            "required before an ICH S7B margin can be claimed."
        ),
    }
    if free_cmax_uM is None:
        out["margin_note"] = (
            "Free Cmax could not be computed (missing molecular weight or unbound fraction), "
            "so no exposure-referenced margin is reported."
        )
    else:
        out["margin_note"] = (
            f"Free Cmax at the top dose is {free_cmax_uM:.3g} µM; a ≥30× margin requires a "
            f"hERG IC50 above {free_cmax_uM * 30:.3g} µM."
        )
        out["required_herg_ic50_uM_for_30x"] = round(free_cmax_uM * 30.0, 4)
    return out


def compute_toxicology_panel(
    *,
    panel: ModelPanel,
    arm_results: list[dict[str, Any]],
    biodistribution: dict[str, Any],
) -> dict[str, Any]:
    """The full multi-domain animal toxicology outcome panel."""
    bsep = panel.bsep if isinstance(panel.bsep, dict) else {}
    bsep_block = bsep.get("bsep") or {}
    pl_block = bsep.get("phospholipidosis") or {}
    reactive = panel.reactive_metabolites if isinstance(panel.reactive_metabolites, dict) else {}

    def structural_driver(
        label: str,
        score_0_100: Any,
        model: str,
        endpoint: str,
        *,
        risk_class: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """A 0–100 structural-alert score rescaled to the 0–1 hazard axis.

        The alert models report a composite 0–100 risk score, not a probability.
        Dividing by 100 puts it on the same axis as the classifier probabilities
        so one banding rule applies to the whole panel; the original score is
        kept alongside so nothing is lost in translation.
        """
        if not isinstance(score_0_100, (int, float)) or isinstance(score_0_100, bool):
            return None
        return {
            "endpoint": endpoint,
            "label": label,
            "value": round(float(score_0_100) / 100.0, 4),
            "raw_score_0_100": float(score_0_100),
            "risk_class": risk_class,
            "model": model,
            "provenance": "structural-alert",
            "source": "live_model",
            "scale_note": "Composite 0–100 alert score rescaled to 0–1 for panel banding.",
            **(detail or {}),
        }

    acute = ld50_mg_per_kg(panel)
    domains: list[dict[str, Any]] = []

    # Acute toxicity bands on the published GHS mg/kg cut-offs, not on the raw
    # regression output — a log-scale LD50 has no meaning on the 0–1 axis.
    acute_band, acute_basis = "not_predicted", None
    if acute.get("available"):
        mg_kg = float(acute["ld50_mg_kg"])
        acute_band = "high" if mg_kg <= 300 else ("moderate" if mg_kg <= 2000 else "low")
        acute_basis = (
            f"Predicted rat oral LD50 {mg_kg:,.0f} mg/kg → {acute['ghs_category']} "
            "(UN GHS acute-oral cut-offs)."
        )

    domains.append(
        _domain(
            domain_id="acute_systemic",
            name="Acute systemic toxicity",
            guideline="OECD 420/423/425 — acute oral toxicity",
            organ=None,
            mechanism="Single-dose lethality in the rat, expressed as the oral LD50.",
            drivers=[
                _driver(
                    panel,
                    "LD50_Zhu",
                    "Predicted rat oral LD50 (log 1/(mol/kg))",
                    kind="regression",
                )
            ],
            biodistribution=biodistribution,
            extra={"acute_ld50": acute},
            band_override=acute_band,
            band_basis=acute_basis,
        )
    )

    domains.append(
        _domain(
            domain_id="hepatotoxicity",
            name="Hepatotoxicity",
            guideline="OECD 407/408 — repeat-dose toxicity (liver endpoints)",
            organ="liver",
            mechanism=(
                "Drug-induced liver injury via direct hepatocellular toxicity, bile-salt "
                "export-pump inhibition (cholestasis), reactive-metabolite covalent binding, "
                "or mitochondrial impairment."
            ),
            drivers=[
                _driver(panel, "DILI", "DILI probability"),
                _driver(panel, "SR-MMP", "Mitochondrial membrane-potential disruption"),
                _driver(panel, "SR-ARE", "Oxidative-stress (Nrf2/ARE) response"),
                structural_driver(
                    "BSEP inhibition risk score",
                    bsep_block.get("score"),
                    "Hakase BSEP physicochemical rule model (Köck 2014; Dawson 2012)",
                    "BSEP_inhibition",
                    risk_class=bsep_block.get("risk_class"),
                    detail={
                        "ic50_estimate_uM": bsep_block.get("ic50_estimate_uM"),
                        "recommended_assay": bsep_block.get("recommended_assay"),
                    },
                ),
                structural_driver(
                    "Reactive-metabolite alert burden",
                    reactive.get("rm_score"),
                    "Hakase Reactive-Metabolite Alert Panel (26 curated SMARTS)",
                    "reactive_metabolites",
                    risk_class=reactive.get("rm_class"),
                    detail={
                        "alert_count": reactive.get("alert_count"),
                        "critical_count": reactive.get("critical_count"),
                        "alerts": [
                            a.get("name") for a in (reactive.get("alerts") or [])[:8] if a
                        ],
                    },
                ),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="cardiotoxicity",
            name="Cardiovascular safety",
            guideline="ICH S7A/S7B — safety pharmacology core battery (cardiovascular)",
            organ="heart",
            mechanism=(
                "Delayed repolarisation through hERG (IKr) block, with the associated QT "
                "prolongation and torsadogenic risk; plus direct myocardial injury."
            ),
            drivers=[_driver(panel, "hERG", "hERG blocker probability")],
            biodistribution=biodistribution,
            extra={"herg_margin": _cardiac_margin(panel, arm_results)},
        )
    )

    domains.append(
        _domain(
            domain_id="genetic_toxicology",
            name="Genetic toxicology",
            guideline="ICH S2(R1); OECD 471 / 474 / 487 / 489",
            organ=None,
            mechanism=(
                "Direct DNA reactivity (bacterial reverse mutation) and DNA-damage-response "
                "activation (ATAD5 replication stress, p53 induction)."
            ),
            drivers=[
                _driver(panel, "AMES", "Ames mutagenicity probability"),
                _driver(panel, "SR-ATAD5", "Genotoxic / DNA-damage response (ATAD5)"),
                _driver(panel, "SR-p53", "p53 DNA-damage response"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="carcinogenicity",
            name="Carcinogenicity",
            guideline="ICH S1B; OECD 451/453 — 2-year rodent bioassay",
            organ=None,
            mechanism=(
                "Genotoxic carcinogenesis (mutagenic mechanism) and non-genotoxic "
                "carcinogenesis via sustained nuclear-receptor activation (AhR, ER, AR) "
                "or chronic tissue injury."
            ),
            drivers=[
                _driver(panel, "Carcinogens_Lagunin", "Carcinogenicity probability"),
                _driver(panel, "AMES", "Ames mutagenicity (genotoxic mechanism)"),
                _driver(panel, "NR-AhR", "AhR activation (non-genotoxic mechanism)"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="nephrotoxicity",
            name="Renal toxicity",
            guideline="OECD 407/408 — repeat-dose toxicity (kidney endpoints)",
            organ="kidney",
            mechanism=(
                "Proximal-tubule injury driven by renal concentrating of parent drug or "
                "metabolites; crystalluria at low solubility."
            ),
            drivers=[
                _driver(panel, "SR-ARE", "Oxidative-stress response"),
                _driver(panel, "SR-p53", "p53 damage response"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="neurotoxicity",
            name="CNS / neurotoxicity",
            guideline="ICH S7A — safety pharmacology core battery (CNS); OECD 424",
            organ="brain",
            mechanism=(
                "CNS effects require CNS exposure: the domain is driven by simulated brain "
                "penetration together with the structural blood-brain-barrier call."
            ),
            drivers=[_driver(panel, "BBB_Martins", "Blood-brain-barrier penetration probability")],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="endocrine_reproductive",
            name="Endocrine & reproductive toxicity",
            guideline="ICH S5(R3); OECD 407 endocrine endpoints / 421 / 443",
            organ=None,
            mechanism=(
                "Nuclear-receptor-mediated endocrine disruption: androgen- and oestrogen-"
                "receptor modulation and aromatase (CYP19A1) interference."
            ),
            drivers=[
                _driver(panel, "NR-AR", "Androgen receptor (full)"),
                _driver(panel, "NR-AR-LBD", "Androgen receptor (ligand-binding domain)"),
                _driver(panel, "NR-ER", "Oestrogen receptor (full)"),
                _driver(panel, "NR-ER-LBD", "Oestrogen receptor (ligand-binding domain)"),
                _driver(panel, "NR-Aromatase", "Aromatase (CYP19A1)"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="metabolic",
            name="Metabolic / body-weight effects",
            guideline="OECD 407/408 — body weight, food consumption, clinical chemistry",
            organ="adipose",
            mechanism="PPARγ-mediated adipogenic and lipid-handling effects.",
            drivers=[_driver(panel, "NR-PPAR-gamma", "PPARγ activation")],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="hematotoxicity",
            name="Haematotoxicity",
            guideline="OECD 407/408 — haematology and bone-marrow evaluation",
            organ="spleen",
            mechanism=(
                "Antiproliferative injury to the rapidly dividing bone-marrow compartment, "
                "signalled by replication-stress and p53 pathway activation."
            ),
            drivers=[
                _driver(panel, "SR-ATAD5", "Replication-stress / DNA-damage response"),
                _driver(panel, "SR-p53", "p53 DNA-damage response"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="immunotoxicity",
            name="Immunotoxicity",
            guideline="ICH S8 — immunotoxicity studies for human pharmaceuticals",
            organ="spleen",
            mechanism=(
                "Lymphoid depletion secondary to antiproliferative or cytotoxic action on "
                "lymphoid organs."
            ),
            drivers=[
                _driver(panel, "SR-p53", "p53 DNA-damage response"),
                _driver(panel, "ClinTox", "Clinical-toxicity failure probability"),
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="respiratory",
            name="Respiratory safety",
            guideline="ICH S7A — safety pharmacology core battery (respiratory)",
            organ="lung",
            mechanism=(
                "Pulmonary accumulation of cationic amphiphilic drug with alveolar "
                "macrophage phospholipid loading."
            ),
            drivers=[
                structural_driver(
                    "Phospholipidosis (CAD) risk score",
                    pl_block.get("score"),
                    "Hakase phospholipidosis CAD rule model (Hanumegowda 2010; Reasor 2001)",
                    "phospholipidosis",
                    risk_class=pl_block.get("risk_class"),
                    detail={
                        "cad_positive": pl_block.get("cad_positive"),
                        "recommended_assay": pl_block.get("recommended_assay"),
                    },
                )
            ],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="dermal_local",
            name="Local tolerance / dermal reaction",
            guideline="OECD 404 (irritation) / OECD 429 (skin sensitisation)",
            organ="skin",
            mechanism="Haptenation and local irritant response at the site of contact.",
            drivers=[_driver(panel, "Skin_Reaction", "Skin-reaction probability")],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="mitochondrial",
            name="Mitochondrial toxicity",
            guideline="Mechanistic (supports hepatic and muscular findings)",
            organ="liver",
            mechanism="Loss of mitochondrial membrane potential and impaired oxidative phosphorylation.",
            drivers=[_driver(panel, "SR-MMP", "Mitochondrial membrane potential")],
            biodistribution=biodistribution,
        )
    )

    domains.append(
        _domain(
            domain_id="oxidative_proteotoxic",
            name="Oxidative & proteotoxic stress",
            guideline="Mechanistic (supports target-organ findings)",
            organ=None,
            mechanism="Nrf2/ARE antioxidant response and heat-shock (proteotoxic) response activation.",
            drivers=[
                _driver(panel, "SR-ARE", "Antioxidant-response element (Nrf2)"),
                _driver(panel, "SR-HSE", "Heat-shock response"),
            ],
            biodistribution=biodistribution,
        )
    )

    predicted = [d for d in domains if d["hazard_call"]["level"] != "not_predicted"]
    flagged = [d for d in predicted if d["hazard_call"]["level"] in {"high", "moderate"}]
    high = [d for d in predicted if d["hazard_call"]["level"] == "high"]
    exposed_flagged = [
        d
        for d in flagged
        if (d.get("exposure_context") or {}).get("meaningfully_exposed") is not False
    ]

    return {
        "available": bool(predicted),
        "domains": domains,
        "summary": {
            "n_domains": len(domains),
            "n_predicted": len(predicted),
            "n_not_predicted": len(domains) - len(predicted),
            "n_flagged": len(flagged),
            "n_high": len(high),
            "high_hazard_domains": [d["name"] for d in high],
            "flagged_domains": [d["name"] for d in flagged],
            "target_organs_of_concern": sorted(
                {d["organ"] for d in exposed_flagged if d.get("organ")}
            ),
            "not_predicted_domains": [
                d["name"] for d in domains if d["hazard_call"]["level"] == "not_predicted"
            ],
        },
        "panel_sources": sorted(set(panel.sources)),
        "unresolved_endpoints": sorted(panel.unresolved),
        "model": (
            "Mechanistic hazard panel: ADMET-AI + Tox21-ML + CardioTox + DILI-ML + Ames-ML + "
            "structural-alert models, contextualised by the PBPK organ exposure"
        ),
        "provenance": "ml + structural-alert + derived exposure context",
        "limitations": (
            "Hazard calls are structure-based classifier probabilities, not observed study "
            "outcomes. No clinical-pathology value, organ weight, incidence or severity grade "
            "is predicted — the finding lists name what a study of this type would score for "
            "the flagged mechanism. Domains with no available model are reported as "
            "not-predicted rather than negative."
        ),
    }


__all__ = ["EXPOSED_TISSUE_RATIO", "HAZARD_THRESHOLDS", "compute_toxicology_panel"]
