"""Assemble the scientific report and the display-only presentation contract.

The report follows the simulation sequence and stamps every block with its
model, confidence, limitations, and provenance. The ``presentation`` is a
server-owned selection/labelling contract (never a browser-side calculation),
identical in spirit to the L2 presentation groups.
"""

from __future__ import annotations

from typing import Any


def _selected_models(
    arm_results: list[dict[str, Any]], evidence: dict[str, Any]
) -> list[dict[str, Any]]:
    """The 'Selected Scientific Models' output — what actually produced numbers."""
    models = [
        {
            "block": "Disposition (PK inputs)",
            "model": "Hakase IVIVE (well-stirred liver; Rowland/Wilkinson; Houston scale-up)",
            "provenance": "ml / measured (L1 ADMET handoff)",
        },
        {
            "block": "Tissue partitioning",
            "model": "Rodgers & Rowland mechanistic Kp",
            "provenance": "derived",
        },
        {
            "block": "Exposure (plasma + tissue)",
            "model": "Hakase kernel PBPK — 13-compartment perfusion-limited ODE, virtual cohort",
            "provenance": "derived",
        },
        {
            "block": "Target coverage",
            "model": "1:1 mass-action receptor occupancy from free drug + BindingML Kd",
            "provenance": "derived (ml Kd)",
        },
        {
            "block": "Safety anchors",
            "model": "EPA CCTE/ToxRefDB NOAEL + PubChem LD50 + FDA km allometry",
            "provenance": "measured + derived",
        },
    ]
    if evidence.get("sources_with_data"):
        models.append(
            {
                "block": "Public evidence",
                "model": f"Live lookups: {', '.join(evidence['sources_with_data'])}",
                "provenance": "measured (public datasets)",
            }
        )
    return models


def _group(title: str, fields: list[tuple[str, Any]]) -> dict[str, Any]:
    return {
        "title": title,
        "fields": [
            {"label": label, "value": (round(v, 4) if isinstance(v, float) else v)}
            for label, v in fields
            if v is not None and v != ""
        ],
    }


def _presentation(record: dict[str, Any]) -> dict[str, Any]:
    """Ordered display cards mirroring the output sequence."""
    study = record.get("study_summary") or {}
    arms = record.get("arms") or []
    pkpd = record.get("pkpd") or {}
    safety = record.get("safety") or {}
    decision = record.get("stage_gate") or {}
    dose_prop = pkpd.get("dose_proportionality") or {}

    groups: list[dict[str, Any]] = []
    groups.append(
        _group(
            "Study summary",
            [
                ("Species", study.get("species")),
                ("Strain", study.get("strain")),
                ("Sex", study.get("sex")),
                ("Route", study.get("route")),
                ("Dose groups", ", ".join(str(d) for d in study.get("dose_groups_mg_kg", []))),
                ("Schedule", study.get("frequency") or "single dose"),
                ("Duration (h)", study.get("duration_h")),
                ("Cohort size / arm", study.get("cohort_size")),
            ],
        )
    )

    # Per-arm PK headline (plasma).
    for arm in pkpd.get("per_arm") or []:
        if not arm.get("pk_metrics", {}).get("available"):
            continue
        plasma = (arm["pk_metrics"]["tissues"] or {}).get("plasma") or {}
        tc = arm.get("target_coverage") or {}
        label = (arm.get("arm") or {}).get("label")
        groups.append(
            _group(
                f"PK & coverage — {label} arm",
                [
                    ("Plasma Cmax (mg/L)", (plasma.get("c_max") or {}).get("median")),
                    ("Plasma AUC (mg·h/L)", (plasma.get("auc") or {}).get("median")),
                    ("Half-life (h)", (plasma.get("t_half") or {}).get("median")),
                    (
                        "Avg target occupancy",
                        tc.get("average_occupancy") if tc.get("available") else "not predicted",
                    ),
                    ("Peak occupancy", tc.get("peak_occupancy") if tc.get("available") else None),
                ],
            )
        )

    if dose_prop.get("available"):
        groups.append(
            _group(
                "Dose comparison",
                [
                    ("Dose-proportionality slope β", dose_prop.get("beta_slope")),
                    ("Classification", dose_prop.get("classification")),
                ],
            )
        )

    allo = (safety.get("anchors") or {}).get("allometric_mtd_noael") or {}
    ev_noael = (safety.get("anchors") or {}).get("evidence_noael") or {}
    groups.append(
        _group(
            "Safety margins",
            [
                ("Evidence NOAEL (mg/kg/day)", ev_noael.get("value_mg_kg_day")),
                (
                    "Allometric NOAEL (mg/kg)",
                    (
                        allo.get("estimated_noael_mg_kg_study_species")
                        if allo.get("available")
                        else "not predicted"
                    ),
                ),
                (
                    "Allometric confidence",
                    allo.get("confidence") if allo.get("available") else None,
                ),
            ],
        )
    )

    groups.extend(_outcome_groups(record))

    groups.append(
        _group(
            "Stage-gate recommendation",
            [
                ("Recommendation", decision.get("recommendation")),
                ("Rationale", decision.get("headline")),
            ],
        )
    )

    return {"groups": [g for g in groups if g["fields"]]}


def _join(values: Any, empty: str | None = None) -> str | None:
    """Render a list of labels for a presentation field, or a stated absence."""
    if isinstance(values, (list, tuple)):
        return ", ".join(str(v) for v in values) if values else empty
    return None


def _outcome_groups(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Presentation cards for the study-level outcome panel.

    These blocks are computed in full by their own engines; the presentation
    contract selects the headline of each so a reader sees every section of the
    package, with the detail tables rendered from the same record beneath.
    """
    groups: list[dict[str, Any]] = []

    tk = record.get("toxicokinetics") or {}
    if tk.get("available"):
        linearity = tk.get("exposure_linearity") or {}
        schedule = tk.get("schedule") or {}
        groups.append(
            _group(
                "Toxicokinetics (ICH S3A)",
                [
                    ("Dose groups with exposure", len(tk.get("per_arm") or []) or None),
                    ("Schedule", schedule.get("frequency")),
                    ("Doses administered", schedule.get("n_doses")),
                    (
                        "Exposure linearity",
                        (
                            ("Linear across dose groups" if linearity.get("linear") else "Non-linear across dose groups")
                            if linearity.get("available")
                            else linearity.get("reason")
                        ),
                    ),
                    ("Dose-normalised AUC spread", linearity.get("relative_spread")),
                ],
            )
        )

    bio = record.get("biodistribution") or {}
    if bio.get("available"):
        per_arm = bio.get("per_arm") or []
        top = per_arm[-1] if per_arm else {}
        cns = top.get("cns_penetration") or {}
        consensus = bio.get("consensus_tissue_ranking") or []
        groups.append(
            _group(
                "Biodistribution",
                [
                    ("Highest-exposure tissue", top.get("highest_exposure_tissue")),
                    (
                        "Tissue ranking (by tissue:plasma AUC)",
                        _join([r.get("label") for r in consensus[:5]]),
                    ),
                    ("CNS penetration", cns.get("classification")),
                    ("Brain:plasma AUC ratio", cns.get("brain_plasma_auc_ratio")),
                    (
                        "Dose-dependent distribution",
                        "Yes" if bio.get("dose_dependent_distribution") else "No",
                    ),
                ],
            )
        )

    tox = record.get("toxicology") or {}
    tox_summary = tox.get("summary") or {}
    if tox.get("available"):
        groups.append(
            _group(
                "Regulatory toxicology panel",
                [
                    ("Domains assessed", tox_summary.get("n_domains")),
                    ("Domains predicted", tox_summary.get("n_predicted")),
                    ("Domains flagged", tox_summary.get("n_flagged")),
                    (
                        "High-hazard domains",
                        _join(tox_summary.get("high_hazard_domains"), "None reached the high band"),
                    ),
                    (
                        "Target organs of concern",
                        _join(
                            tox_summary.get("target_organs_of_concern"),
                            "No organ combined a flagged mechanism with meaningful exposure",
                        ),
                    ),
                    (
                        "Not predicted",
                        _join(tox_summary.get("not_predicted_domains"), "None"),
                    ),
                ],
            )
        )

    organ_risk = record.get("organ_risk") or {}
    if organ_risk.get("available"):
        organ_summary = organ_risk.get("summary") or {}
        groups.append(
            _group(
                "Target-organ map",
                [
                    ("Organs mapped", organ_summary.get("n_organs_mapped")),
                    (
                        "Organs of concern",
                        _join(organ_summary.get("target_organs_of_concern"), "None"),
                    ),
                    (
                        "Flagged but not meaningfully exposed",
                        _join(organ_summary.get("flagged_but_unexposed"), "None"),
                    ),
                    ("Highest-exposure organ", organ_summary.get("highest_exposure_organ")),
                    (
                        "Systemic domains without a target organ",
                        organ_summary.get("n_systemic_domains_without_organ"),
                    ),
                ],
            )
        )

    sp = record.get("safety_pharmacology") or {}
    if sp.get("available"):
        sp_summary = sp.get("summary") or {}
        groups.append(
            _group(
                "Safety pharmacology (ICH S7A/S7B)",
                [
                    ("Reference dose group", sp.get("reference_arm")),
                    ("Overall", sp_summary.get("overall")),
                    ("Systems of concern", _join(sp_summary.get("systems_of_concern"), "None")),
                    ("Systems to monitor", _join(sp_summary.get("systems_to_monitor"), "None")),
                ],
            )
        )

    ddi = record.get("ddi") or {}
    if ddi.get("available"):
        perpetrator = ddi.get("perpetrator") or {}
        victim = ddi.get("victim") or {}
        groups.append(
            _group(
                "Drug–drug interaction (FDA 2020)",
                [
                    ("Reference dose group", ddi.get("reference_arm")),
                    (
                        "Isoforms flagged as perpetrator",
                        _join(perpetrator.get("flagged_isoforms"), "None above the 0.5 call"),
                    ),
                    ("Highest perpetrator risk", perpetrator.get("highest_risk")),
                    ("Victim risk", victim.get("risk")),
                    ("Fraction cleared hepatically", victim.get("fraction_cleared_hepatically")),
                ],
            )
        )

    pod = record.get("points_of_departure") or {}
    if pod.get("available"):
        preferred = pod.get("preferred_pod") or {}
        exposure = pod.get("preferred_pod_exposure") or {}
        groups.append(
            _group(
                "Points of departure",
                [
                    ("Candidates derived", len(pod.get("candidates") or []) or None),
                    ("Preferred point of departure", preferred.get("name")),
                    ("Preferred POD dose (mg/kg)", preferred.get("dose_mg_per_kg")),
                    ("Strength", preferred.get("strength")),
                    ("Free Cmax at the POD (µM)", exposure.get("free_cmax_uM")),
                    ("AUC at the POD (µM·h)", exposure.get("auc_uM_h")),
                    (
                        "NOAEL determined",
                        "No — a NOAEL is an observed quantity; candidate PODs are reported instead",
                    ),
                ],
            )
        )

    outcomes = record.get("study_outcomes") or {}
    if outcomes.get("available"):
        conformance = outcomes.get("design_conformance") or {}
        outcome_summary = outcomes.get("summary") or {}
        groups.append(
            _group(
                "Study-report rollup & design conformance",
                [
                    ("Procedures covered", outcome_summary.get("n_sections")),
                    (
                        "Under heightened scrutiny",
                        outcome_summary.get("n_under_heightened_scrutiny"),
                    ),
                    ("Sections to watch", _join(outcome_summary.get("sections_to_watch"), "None")),
                    ("Closest guideline", conformance.get("closest_guideline")),
                    (
                        "Design conformant",
                        (
                            "Yes"
                            if conformance.get("conformant")
                            else f"No — {len(conformance.get('gaps') or [])} gap(s)"
                        ),
                    ),
                ],
            )
        )

    panel = record.get("model_panel") or {}
    if panel:
        groups.append(
            _group(
                "Predictor provenance",
                [
                    ("Endpoints resolved", len(panel.get("endpoints") or {}) or None),
                    ("Sources", _join(panel.get("sources"))),
                    ("Unresolved endpoints", _join(panel.get("unresolved"), "None")),
                    ("Molecular weight (g/mol)", panel.get("mw_g_per_mol")),
                ],
            )
        )

    return groups


def assemble_report(record: dict[str, Any]) -> dict[str, Any]:
    """Attach 'Selected Scientific Models' + the presentation to the study record."""
    record["selected_scientific_models"] = _selected_models(
        record.get("arms") or [], record.get("evidence") or {}
    )
    record["presentation"] = _presentation(record)
    return record


def report_markdown(record: dict[str, Any]) -> str:
    """A downloadable Markdown scientific report of the virtual study."""
    study = record.get("study_summary") or {}
    decision = record.get("stage_gate") or {}
    lines = [
        "# HakaseAI — Layer 3 Virtual Preclinical Study (Animal Cohort)",
        "",
        f"- Study ID: `{record.get('study_id')}`",
        f"- Analysis ID: `{record.get('analysis_id')}`",
        f"- SMILES: `{record.get('smiles')}`",
        f"- Species / strain: **{study.get('species')} / {study.get('strain')}**",
        f"- Route / schedule: {study.get('route')} / {study.get('frequency') or 'single dose'}",
        f"- Dose groups (mg/kg): {', '.join(str(d) for d in study.get('dose_groups_mg_kg', []))}",
        f"- Cohort size per arm: {study.get('cohort_size')}",
        f"- Simulation engine: {study.get('simulation_engine')}",
        "",
    ]

    # A per-arm engine fallback is invisible unless the reader opens each arm.
    # Reported here because it changes what the study can claim: without the
    # requested engine there is no independent ODE cross-check.
    fidelity = record.get("engine_fidelity") or {}
    if fidelity.get("notice"):
        lines += [
            "> **Engine fidelity notice** — "
            + str(fidelity["notice"])
            + f" Requested: `{fidelity.get('requested')}`; actually used: "
            + f"`{', '.join(str(item) for item in fidelity.get('used') or []) or 'none'}`.",
            "",
        ]

    lines += [
        "## Stage-gate recommendation",
        "",
        f"**{decision.get('recommendation')}** — {decision.get('headline')}",
        "",
        "### Criteria",
    ]
    for name, crit in (decision.get("criteria") or {}).items():
        lines.append(f"- **{name}**: {crit.get('status')} — {crit.get('rationale')}")
    voi = decision.get("value_of_information") or []
    if voi:
        lines += ["", "### Value of information (recommended next measurements)"]
        lines += [f"- {n}" for n in voi]

    lines += _markdown_outcome_sections(record)

    lines += [
        "",
        "## Provenance & limitations",
        "",
        "Every quantitative block is produced by a validated model, a mechanistic calculation, an "
        "open engine, or a public dataset. Blocks that could not be produced are marked "
        "`not predicted` with a reason — no value is fabricated.",
    ]
    return "\n".join(lines)


def _markdown_outcome_sections(record: dict[str, Any]) -> list[str]:
    """Toxicokinetics, biodistribution, toxicology, safety pharmacology, DDI, PODs."""
    lines: list[str] = []

    tk = record.get("toxicokinetics") or {}
    if tk.get("available"):
        lines += [
            "",
            "## Toxicokinetics (ICH S3A)",
            "",
            "| Dose group | Dose (mg/kg) | Cmax (mg/L) | AUC (mg·h/L) | t½ (h) | Dose-normalised AUC | CV% (AUC) |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for row in tk.get("per_arm", []):
            lines.append(
                f"| {row.get('arm')} | {row.get('dose_mg_per_kg')} | {row.get('c_max_mg_per_l')} | "
                f"{row.get('auc_mg_h_per_l')} | {row.get('t_half_h')} | "
                f"{row.get('dose_normalised_auc')} | {row.get('auc_cv_percent')} |"
            )
        linearity = tk.get("exposure_linearity") or {}
        if linearity.get("available"):
            lines += ["", linearity.get("interpretation", "")]

    bio = record.get("biodistribution") or {}
    if bio.get("available"):
        per_arm = bio.get("per_arm") or []
        top = per_arm[-1] if per_arm else {}
        lines += [
            "",
            "## Biodistribution",
            "",
            f"Reference dose group: **{(top.get('arm') or {}).get('label')}**.",
            "",
            "| Tissue | Cmax (mg/L) | AUC (mg·h/L) | Tissue:plasma AUC | Kp | Partitioning |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for row in top.get("tissues", []):
            lines.append(
                f"| {row.get('label')} | {row.get('c_max_median')} | {row.get('auc_median')} | "
                f"{row.get('tissue_plasma_auc_ratio')} | {row.get('kp')} | {row.get('partitioning')} |"
            )
        cns = top.get("cns_penetration") or {}
        if cns.get("classification"):
            lines += ["", f"CNS: {cns['classification']}."]

    tox = record.get("toxicology") or {}
    if tox.get("available"):
        lines += [
            "",
            "## Regulatory toxicology panel",
            "",
            "| Domain | Guideline | Hazard | Driving endpoint | Target organ |",
            "| --- | --- | --- | --- | --- |",
        ]
        for domain in tox.get("domains", []):
            call = domain.get("hazard_call") or {}
            lines.append(
                f"| {domain.get('name')} | {domain.get('guideline')} | {call.get('level')} | "
                f"{call.get('driving_endpoint') or '—'} | {domain.get('organ') or 'systemic'} |"
            )
        unresolved = tox.get("unresolved_endpoints") or []
        if unresolved:
            lines += ["", f"Unresolved endpoints: {', '.join(unresolved)}."]

    organ_risk = record.get("organ_risk") or {}
    if organ_risk.get("available"):
        lines += [
            "",
            "## Target-organ map",
            "",
            "| Organ | Call | Hazard band | Tissue:plasma AUC | Driving domain |",
            "| --- | --- | --- | --- | --- |",
        ]
        for organ in organ_risk.get("organs", []):
            lines.append(
                f"| {organ.get('label')} | {organ.get('call_label')} "
                f"| {organ.get('hazard_level')} | "
                f"{(organ.get('exposure') or {}).get('tissue_plasma_auc_ratio')} | "
                f"{organ.get('driving_domain') or '—'} |"
            )

    sp = record.get("safety_pharmacology") or {}
    if sp.get("available"):
        lines += ["", "## Safety pharmacology (ICH S7A/S7B)", ""]
        for system in sp.get("systems", []):
            lines.append(
                f"- **{system.get('system')}** ({system.get('guideline')}): "
                f"{system.get('assessment')} — {system.get('rationale')}"
            )

    ddi = record.get("ddi") or {}
    if ddi.get("available"):
        perpetrator = ddi.get("perpetrator") or {}
        victim = ddi.get("victim") or {}
        lines += [
            "",
            "## Drug–drug interaction",
            "",
            f"Perpetrator: flagged isoforms {', '.join(perpetrator.get('flagged_isoforms') or []) or 'none'}.",
            f"Victim: {victim.get('risk')} — {victim.get('rationale')}",
        ]

    pod = record.get("points_of_departure") or {}
    if pod.get("available"):
        lines += [
            "",
            "## Points of departure",
            "",
            "| Anchor | Dose (mg/kg) | Strength | Provenance |",
            "| --- | --- | --- | --- |",
        ]
        for candidate in pod.get("candidates", []):
            lines.append(
                f"| {candidate.get('name')} | {candidate.get('dose_mg_per_kg')} | "
                f"{candidate.get('strength')} | {candidate.get('provenance')} |"
            )
        determination = pod.get("noael_determination") or {}
        if determination.get("reason"):
            lines += ["", determination["reason"]]

    outcomes = record.get("study_outcomes") or {}
    conformance = (outcomes or {}).get("design_conformance") or {}
    if conformance:
        lines += [
            "",
            "## Design conformance",
            "",
            f"Closest guideline: **{conformance.get('closest_guideline')}** — "
            + ("conformant." if conformance.get("conformant") else "gaps identified:"),
        ]
        lines += [f"- {gap}" for gap in conformance.get("gaps", [])]

    return lines


__all__ = ["assemble_report", "report_markdown"]
