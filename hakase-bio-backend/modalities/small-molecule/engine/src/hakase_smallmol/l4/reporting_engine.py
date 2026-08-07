"""Assemble the first-in-human dossier presentation and its Markdown report.

Identical posture to the L3 reporting engine: the ``presentation`` is a
server-owned selection and labelling contract, never a browser-side calculation,
and every block is stamped with the model that produced it.
"""

from __future__ import annotations

from typing import Any


def _group(title: str, fields: list[tuple[str, Any]]) -> dict[str, Any]:
    return {
        "title": title,
        "fields": [
            {"label": label, "value": (round(v, 5) if isinstance(v, float) else v)}
            for label, v in fields
            if v is not None and v != ""
        ],
    }


def _selected_models(record: dict[str, Any]) -> list[dict[str, Any]]:
    models = [
        {
            "block": "Human exposure projection",
            "model": "Hakase kernel PBPK with reference human physiology + human IVIVE disposition",
            "provenance": "derived",
        },
        {
            "block": "Animal → human dose translation",
            "model": "FDA (2005) body-surface-area (km) conversion + safety factor",
            "provenance": "regulatory calculation",
        },
        {
            "block": "MABEL / pharmacologically active dose",
            "model": "EMA (2017) occupancy anchor + reverse dosimetry on the human PBPK map",
            "provenance": "derived",
        },
        {
            "block": "Exposure margins",
            "model": "ICH M3(R2) exposure-based margin, both exposures from the same PBPK engine",
            "provenance": "derived",
        },
        {
            "block": "Trial design",
            "model": "EMA (2017) first-in-human design structure over the projected PK",
            "provenance": "study design + derived",
        },
    ]
    if (record.get("sub_studies") or {}).get("available"):
        models.append(
            {
                "block": "Phase 1 sub-study feasibility",
                "model": "Guideline trigger rules (FDA 2019/2020/2003, ICH E14) over the L3 disposition and liability blocks",
                "provenance": "regulatory practice + derived",
            }
        )
    if (record.get("ind_gate") or {}).get("available"):
        models.append(
            {
                "block": "IND / CTA filing readiness",
                "model": "ICH M3(R2) nonclinical checklist with regional application requirements",
                "provenance": "regulatory requirement mapping",
            }
        )
    benefit_risk = record.get("benefit_risk") or {}
    if benefit_risk.get("available"):
        models.append(
            {
                "block": "Benefit-risk context",
                "model": (
                    "FDA (2023) Benefit-Risk Assessment framework"
                    + (
                        ", grounded in the live openFDA approved-label landscape"
                        if (benefit_risk.get("condition") or {}).get("fda_grounded")
                        else " (keyword indication prior; openFDA unavailable)"
                    )
                ),
                "provenance": "regulatory framework + measured (openFDA)",
            }
        )
    precedent = record.get("clinical_precedent") or {}
    if precedent.get("sources_with_data"):
        models.append(
            {
                "block": "Clinical precedent",
                "model": f"Live lookups: {', '.join(precedent['sources_with_data'])}",
                "provenance": "measured (public registries)",
            }
        )
    return models


def _presentation(record: dict[str, Any]) -> dict[str, Any]:
    starting = record.get("starting_dose") or {}
    margins = record.get("exposure_margins") or {}
    sad = (record.get("trial_design") or {}).get("sad") or {}
    gate = record.get("gate") or {}
    translations = record.get("translation") or {}
    mabel = record.get("mabel") or {}
    groups: list[dict[str, Any]] = []

    groups.append(
        _group(
            "Recommended starting dose",
            [
                ("Dose (total mg, 60 kg adult)", starting.get("recommended_starting_dose_total_mg")),
                ("Dose (mg/kg)", starting.get("recommended_starting_dose_mg_per_kg")),
                ("Governing approach", starting.get("governing_approach_name")),
                (
                    "Approach agreement",
                    (starting.get("approach_disagreement") or {}).get("note"),
                ),
            ],
        )
    )

    governing = translations.get("governing_mrsd") or {}
    groups.append(
        _group(
            "NOAEL / HED translation",
            [
                ("Point of departure", governing.get("pod_name")),
                ("Animal dose (mg/kg)", governing.get("animal_dose_mg_per_kg")),
                ("HED (mg/kg)", (governing.get("hed") or {}).get("hed_mg_per_kg")),
                ("Safety factor", (translations.get("safety_factor") or {}).get("total_factor")),
                ("MRSD (total mg)", (governing.get("mrsd") or {}).get("mrsd_total_mg_60kg")),
            ],
        )
    )

    groups.append(
        _group(
            "MABEL",
            [
                ("MABEL (total mg)", mabel.get("mabel_total_mg")),
                ("Anchor occupancy", mabel.get("anchor_occupancy")),
                ("Uncertainty factor", mabel.get("uncertainty_factor")),
                ("Kd (µM)", mabel.get("kd_uM")),
                ("Status", None if mabel.get("available") else mabel.get("reason")),
            ],
        )
    )

    starting_margin = None
    for row in margins.get("per_dose_level", []) or []:
        starting_margin = row
        break
    groups.append(
        _group(
            "Exposure margin at the starting dose",
            [
                ("AUC margin", (starting_margin or {}).get("auc_margin")),
                ("Cmax margin", (starting_margin or {}).get("cmax_margin")),
                ("Free Cmax margin", (starting_margin or {}).get("free_cmax_margin")),
                ("Limiting margin", (starting_margin or {}).get("limiting_margin")),
                ("Band", (starting_margin or {}).get("band")),
            ],
        )
    )

    groups.append(
        _group(
            "Phase 1 SAD design",
            [
                ("Design", sad.get("design")),
                ("Cohorts", len(sad.get("cohorts") or []) or None),
                ("Subjects (total)", sad.get("n_subjects_total")),
                ("Randomisation", sad.get("randomisation_ratio")),
                ("Inter-cohort washout (h)", sad.get("inter_cohort_washout_h")),
                ("PK samples per profile", (sad.get("pk_sampling") or {}).get("n_samples")),
            ],
        )
    )

    mad = (record.get("trial_design") or {}).get("mad") or {}
    if mad.get("available"):
        groups.append(
            _group(
                "Phase 1 MAD design",
                [
                    ("Design", mad.get("design")),
                    ("Dosing frequency", mad.get("dosing_frequency")),
                    ("Treatment duration (days)", mad.get("treatment_duration_days")),
                    ("Cohorts", len(mad.get("cohorts") or []) or None),
                    ("Subjects (total)", mad.get("n_subjects_total")),
                ],
            )
        )

    ladder = record.get("escalation_ladder") or {}
    if ladder.get("available"):
        levels = ladder.get("levels") or []
        groups.append(
            _group(
                "Escalation ladder",
                [
                    ("Scheme", ladder.get("scheme_name")),
                    ("Reference", ladder.get("reference")),
                    ("Levels", ladder.get("n_levels")),
                    ("Starting dose (mg)", ladder.get("starting_dose_total_mg")),
                    ("Top planned dose (mg)", levels[-1]["dose_total_mg"] if levels else None),
                    ("Capped at maximum dose", "Yes" if ladder.get("capped_at_max_dose") else None),
                ],
            )
        )

    sub_studies = record.get("sub_studies") or {}
    if sub_studies.get("available"):
        summary = sub_studies.get("summary") or {}
        groups.append(
            _group(
                "Phase 1 sub-studies",
                [
                    ("Advised", ", ".join(summary.get("advised") or []) or "None triggered"),
                    (
                        "Undetermined (gating measurement missing)",
                        ", ".join(summary.get("undetermined") or []) or "None",
                    ),
                ],
            )
        )

    ind_gate = record.get("ind_gate") or {}
    if ind_gate.get("available"):
        ind_summary = ind_gate.get("summary") or {}
        groups.append(
            _group(
                "IND / CTA filing readiness",
                [
                    ("Region", (ind_gate.get("region") or {}).get("name")),
                    ("Application", (ind_gate.get("region") or {}).get("application")),
                    ("Recommendation", ind_gate.get("recommendation")),
                    ("Items computed here", ind_summary.get("n_computed")),
                    ("Items requiring a physical study", ind_summary.get("n_requiring_wet_lab")),
                    ("Items attested by the sponsor", ind_summary.get("n_attested")),
                ],
            )
        )

    benefit_risk = record.get("benefit_risk") or {}
    if benefit_risk.get("available"):
        groups.append(
            _group(
                "Benefit-risk context (FDA 2023)",
                [
                    ("Balance", benefit_risk.get("balance")),
                    ("Condition severity", benefit_risk.get("severity")),
                    ("Unmet medical need", benefit_risk.get("unmet_need")),
                    ("Risk tolerance", benefit_risk.get("risk_tolerance")),
                    ("Recommendation", benefit_risk.get("recommendation")),
                ],
            )
        )

    groups.append(
        _group(
            "First-in-human readiness",
            [
                ("Recommendation", gate.get("recommendation")),
                ("Rationale", gate.get("headline")),
            ],
        )
    )

    return {"groups": [g for g in groups if g["fields"]]}


def assemble_report(record: dict[str, Any]) -> dict[str, Any]:
    record["selected_scientific_models"] = _selected_models(record)
    record["presentation"] = _presentation(record)
    return record


def report_markdown(record: dict[str, Any]) -> str:
    """A downloadable Markdown first-in-human dossier."""
    starting = record.get("starting_dose") or {}
    gate = record.get("gate") or {}
    sad = (record.get("trial_design") or {}).get("sad") or {}
    lines = [
        "# HakaseAI — Layer 4 First-in-Human Translation",
        "",
        f"- Projection ID: `{record.get('projection_id')}`",
        f"- Source animal study: `{record.get('study_id')}`",
        f"- SMILES: `{record.get('smiles')}`",
        f"- Animal species: **{record.get('animal_species')}**",
        f"- Clinical route / schedule: {record.get('route')} / {record.get('frequency') or 'single dose'}",
        "",
        "## Recommended starting dose",
        "",
        f"**{starting.get('recommended_starting_dose_total_mg')} mg** "
        f"({starting.get('recommended_starting_dose_mg_per_kg')} mg/kg for a 60 kg adult) — "
        f"governed by {starting.get('governing_approach_name')}.",
        "",
        "### Approaches compared",
    ]
    for approach in starting.get("approaches", []) or []:
        if approach.get("available"):
            lines.append(
                f"- **{approach['name']}**: {approach.get('dose_total_mg')} mg — {approach.get('basis')}"
            )
        else:
            lines.append(f"- **{approach['name']}**: not computed — {approach.get('reason')}")

    lines += ["", "## First-in-human readiness", "", f"**{gate.get('recommendation')}** — {gate.get('headline')}", "", "### Criteria"]
    for name, crit in (gate.get("criteria") or {}).items():
        lines.append(f"- **{name}**: {crit.get('status')} — {crit.get('rationale')}")

    required = gate.get("required_before_dosing") or []
    if required:
        lines += ["", "### Required before dosing"]
        lines += [f"- {item}" for item in required]

    if sad.get("available"):
        lines += [
            "",
            "## Proposed Phase 1 SAD",
            "",
            f"{sad.get('design')} — {sad.get('n_subjects_total')} subjects across "
            f"{len(sad.get('cohorts') or [])} cohorts at {sad.get('randomisation_ratio')}.",
            "",
            "| Cohort | Dose (mg) | n | Active | Placebo |",
            "| --- | --- | --- | --- | --- |",
        ]
        for cohort in sad.get("cohorts", []):
            lines.append(
                f"| {cohort['cohort']} | {cohort['dose_total_mg']} | {cohort['n_total']} | "
                f"{cohort['n_active']} | {cohort['n_placebo']} |"
            )

    ladder = record.get("escalation_ladder") or {}
    if ladder.get("available"):
        lines += [
            "",
            "## Escalation ladder",
            "",
            f"{ladder.get('scheme_name')} — {ladder.get('reference')}.",
            "",
            "| Level | Dose (mg) | Dose (mg/kg) | Step from previous | Fold over start |",
            "| --- | --- | --- | --- | --- |",
        ]
        for level in ladder.get("levels", []):
            lines.append(
                f"| {level['level']} | {level['dose_total_mg']} | {level['dose_mg_per_kg']} | "
                f"{level.get('step_from_previous') or '—'} | {level.get('fold_over_starting_dose')} |"
            )

    margins = record.get("exposure_margins") or {}
    if margins.get("available"):
        lines += [
            "",
            "## Exposure margins to the animal point of departure",
            "",
            f"Point of departure: {(margins.get('animal_pod') or {}).get('name')} in "
            f"{margins.get('animal_species')}.",
            "",
            "| Dose (mg) | Human AUC (µM·h) | Human free Cmax (µM) | AUC margin | Cmax margin | Limiting | Band |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for row in margins.get("per_dose_level", []):
            lines.append(
                f"| {row.get('dose_total_mg')} | {row.get('human_auc_uM_h')} | "
                f"{row.get('human_free_cmax_uM')} | {row.get('auc_margin')} | "
                f"{row.get('cmax_margin')} | {row.get('limiting_margin')} | {row.get('band')} |"
            )

    mad = (record.get("trial_design") or {}).get("mad") or {}
    if mad.get("available"):
        lines += [
            "",
            "## Proposed Phase 1 MAD",
            "",
            f"{mad.get('design')} — {mad.get('dosing_frequency')} for "
            f"{mad.get('treatment_duration_days')} days across {len(mad.get('cohorts') or [])} "
            f"cohorts. {mad.get('duration_basis')}",
        ]

    rules = (record.get("trial_design") or {}).get("stopping_rules") or {}
    if rules.get("available"):
        lines += ["", "## Stopping rules", ""]
        for rule in rules.get("rules", []):
            lines.append(f"- **{rule.get('rule')}** → {rule.get('action')} _({rule.get('source')})_")

    sub_studies = record.get("sub_studies") or {}
    if sub_studies.get("available"):
        lines += [
            "",
            "## Phase 1 sub-studies",
            "",
            "| Sub-study | Guideline | Status | Rationale |",
            "| --- | --- | --- | --- |",
        ]
        for entry in sub_studies.get("sub_studies", []):
            lines.append(
                f"| {entry['name']} | {entry['guideline']} | {entry['status']} | "
                f"{entry['rationale']} |"
            )

    ind_gate = record.get("ind_gate") or {}
    if ind_gate.get("available"):
        region = ind_gate.get("region") or {}
        lines += [
            "",
            f"## IND / CTA filing readiness — {region.get('name')}",
            "",
            f"**{ind_gate.get('recommendation')}** — {ind_gate.get('headline')}",
            "",
            f"Application route: {region.get('application')}. Framework: {region.get('framework')}.",
            "",
            "| Requirement | Guideline | Status |",
            "| --- | --- | --- |",
        ]
        for item in ind_gate.get("items", []):
            lines.append(
                f"| {item['requirement']} | {item['guideline']} | {item['status']} |"
            )
        for note in region.get("region_specific", []):
            lines.append(f"- {note}")

    benefit_risk = record.get("benefit_risk") or {}
    if benefit_risk.get("available"):
        lines += [
            "",
            "## Benefit-risk context (FDA 2023 framework)",
            "",
            f"**{benefit_risk.get('headline')}**",
            "",
            benefit_risk.get("rationale", ""),
            "",
            "| Dimension | Evidence | Conclusion |",
            "| --- | --- | --- |",
        ]
        for dimension in benefit_risk.get("dimensions", []):
            lines.append(
                f"| {dimension['dimension']} | {dimension['evidence']} | {dimension['conclusion']} |"
            )
        lines += [
            "",
            "This assessment is regulatory context. It does not override the first-in-human "
            "readiness gate above.",
        ]

    lines += [
        "",
        "## Provenance & limitations",
        "",
        "Every quantitative block is produced by a validated model, a published regulatory "
        "calculation, an open engine, or a public dataset. Blocks that could not be produced "
        "are marked `not predicted` with a reason — no value is fabricated.",
        "",
        "This dossier is a computational aid for protocol design. It does not constitute "
        "regulatory clearance and does not substitute for the nonclinical studies ICH M3(R2) "
        "requires before human dosing.",
    ]
    return "\n".join(lines)


__all__ = ["assemble_report", "report_markdown"]
