"""Layer-1 assay bench — the extended in-vitro model catalogue.

Why this module exists
----------------------
The engine exposes roughly twenty focused predictors — permeability,
transporter, phospholipidosis, cytotoxicity, mutagenicity, second-opinion
ADME regressions, the broad in-vitro panel — that the compact Layer-1 contract
does not run.  Each had its own HTTP route and no caller.  Twenty separate
round-trips is also the wrong shape for a browser.

The bench turns them into one server-owned feature: a **catalogue** the UI
renders, and a **run** endpoint that executes a requested subset server-side
and returns one presentation contract per assay.

Design rules
------------
* Adding an assay means adding a registry entry here, not a fetch in React.
* Every adapter's own availability envelope is preserved verbatim. An assay
  that cannot run reports why; it is never replaced with a substitute value.
* One failing assay never fails the batch — it is captured as an error entry
  so the rest of the bench still returns.
* The bench performs no scoring, ranking or aggregation across assays. It is a
  catalogue runner, not a verdict.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from hakase_smallmol.admet.admetlab import (
    predict_bsep_inhibition,
    predict_pampa,
    predict_pgp_substrate,
    predict_phospholipidosis,
)
from hakase_smallmol.admet.bbb_ml import predict_bbb_ml
from hakase_smallmol.admet.bsep import predict_bsep
from hakase_smallmol.admet.caco2_ml import predict_caco2_ml
from hakase_smallmol.admet.cyp_inhibition_ml import predict_cyp_inhibition_ml
from hakase_smallmol.admet.half_life_ml import predict_half_life_ml
from hakase_smallmol.admet.solubility_ml import predict_solubility_ml
from hakase_smallmol.admet.vdss_ml import predict_vdss_ml
from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox
from hakase_smallmol.dili.dili_ml import predict_dili_ml
from hakase_smallmol.drug_lookup import lookup_drug
from hakase_smallmol.ersilia_hub import predict_cytotoxicity
from hakase_smallmol.molecular_properties import predict_properties
from hakase_smallmol.safety.ames_ml import predict_ames_ml
from hakase_smallmol.safety.assay_reliability import assess_assay_reliability
from hakase_smallmol.safety.reactive_metabolites import predict_reactive_metabolites
from hakase_smallmol.safety.tox21_ml import predict_tox21_panel


@dataclass(frozen=True)
class Assay:
    """One runnable bench assay and how to present its output."""

    id: str
    name: str
    group: str
    engine: str
    description: str
    run: Callable[[str], dict[str, Any]]
    # (display label, dotted path into the result) pairs. The path is resolved
    # against the returned envelope; a missing path yields no field rather than
    # a placeholder.
    fields: tuple[tuple[str, str], ...] = field(default_factory=tuple)
    # An assay that reaches a third-party service, so an outage is expected and
    # must be reported as unavailable rather than treated as a model failure.
    remote: bool = False


GROUPS: tuple[dict[str, str], ...] = (
    {
        "id": "permeability",
        "name": "Permeability & transport",
        "description": "Passive permeability, efflux liability and brain penetration.",
    },
    {
        "id": "disposition",
        "name": "Disposition second opinion",
        "description": "Independent regressions for the parameters that drive IVIVE.",
    },
    {
        "id": "metabolism",
        "name": "Metabolism & interaction",
        "description": "CYP inhibition and reactive-metabolite structural liability.",
    },
    {
        "id": "safety",
        "name": "Safety & toxicology",
        "description": "Organ toxicity, mutagenicity and the Tox21 assay panel.",
    },
    {
        "id": "identity",
        "name": "Identity & context",
        "description": "Known-drug lookup, computed properties and structural review.",
    },
)


CATALOGUE: tuple[Assay, ...] = (
    # ── Permeability & transport ──────────────────────────────────────────
    Assay(
        id="pampa",
        name="PAMPA passive permeability",
        group="permeability",
        engine="ADMETlab 3.0",
        description="Parallel artificial membrane permeability, a passive-diffusion surrogate.",
        run=predict_pampa,
        fields=(("Permeability", "value"), ("Class", "class"), ("Units", "unit")),
        remote=True,
    ),
    Assay(
        id="caco2",
        name="Caco-2 apparent permeability",
        group="permeability",
        engine="Caco2-ML (TDC Wang)",
        description="Monolayer apparent permeability regression, log Papp.",
        run=predict_caco2_ml,
        fields=(
            ("log Papp", "prediction.log_papp"),
            ("Permeability class", "prediction.permeability_class"),
        ),
    ),
    Assay(
        id="pgp_substrate",
        name="P-glycoprotein substrate",
        group="permeability",
        engine="ADMETlab 3.0",
        description="Efflux-transporter substrate liability, a common cause of low exposure.",
        run=predict_pgp_substrate,
        fields=(("Probability", "value"), ("Class", "class")),
        remote=True,
    ),
    Assay(
        id="bbb",
        name="Blood-brain barrier penetration",
        group="permeability",
        engine="BBB-ML (TDC Martins)",
        description="CNS penetration classification; relevant to both efficacy and CNS safety.",
        run=predict_bbb_ml,
        fields=(
            ("Probability", "prediction.bbb_probability"),
            ("Penetration class", "prediction.penetration_class"),
        ),
    ),
    # ── Disposition second opinion ────────────────────────────────────────
    Assay(
        id="solubility",
        name="Aqueous solubility",
        group="disposition",
        engine="SolubilityML (TDC AqSolDB)",
        description="log S regression. Low solubility limits both assay validity and oral exposure.",
        run=predict_solubility_ml,
        fields=(
            ("Predicted logS", "prediction.logS_predicted"),
            ("Solubility class", "prediction.solubility_class"),
        ),
    ),
    Assay(
        id="vdss",
        name="Steady-state volume of distribution",
        group="disposition",
        engine="VDss-ML (TDC Lombardo)",
        description="Independent VDss estimate; it is one of the two terms that set half-life.",
        run=predict_vdss_ml,
        fields=(
            ("VDss (L/kg)", "prediction.vdss_l_per_kg"),
            ("Distribution class", "prediction.distribution_class"),
        ),
    ),
    Assay(
        id="half_life",
        name="Plasma half-life",
        group="disposition",
        engine="HalfLife-ML (TDC Obach)",
        description="Direct half-life regression, used as a cross-check on the IVIVE projection.",
        run=predict_half_life_ml,
        fields=(
            ("Half-life (h)", "prediction.half_life_hours"),
            ("Half-life class", "prediction.half_life_class"),
        ),
    ),
    # ── Metabolism & interaction ──────────────────────────────────────────
    Assay(
        id="cyp_inhibition",
        name="CYP isoform inhibition",
        group="metabolism",
        engine="CYP-ML (TDC Veith)",
        description="Per-isoform inhibition probability; the basis of a victim/perpetrator DDI call.",
        run=predict_cyp_inhibition_ml,
        fields=(("Isoforms evaluated", "isoform_count"), ("Highest risk isoform", "highest_risk")),
    ),
    Assay(
        id="reactive_metabolites",
        name="Reactive-metabolite alerts",
        group="metabolism",
        engine="Structural alert set",
        description="Bioactivation substructures associated with idiosyncratic toxicity.",
        run=predict_reactive_metabolites,
        fields=(("Alert class", "rm_class"), ("Alert count", "alert_count")),
    ),
    # ── Safety & toxicology ───────────────────────────────────────────────
    Assay(
        id="tox21",
        name="Tox21 assay panel",
        group="safety",
        engine="Tox21 qHTS heads",
        description="Nuclear-receptor and stress-response panel with per-assay applicability.",
        run=predict_tox21_panel,
        fields=(
            ("Assays evaluated", "summary.n_assays_evaluated"),
            ("In-domain flags", "summary.n_flagged_in_domain"),
            ("Top liability", "summary.top_liability.assay"),
        ),
    ),
    Assay(
        id="ames",
        name="Ames mutagenicity",
        group="safety",
        engine="Ames-ML (TDC Xu)",
        description="Bacterial reverse-mutation probability. A hazard call, not a potency.",
        run=predict_ames_ml,
        fields=(
            ("Mutagenic probability", "prediction.mutagenic_probability"),
            ("Applicability domain", "prediction.applicability_domain"),
        ),
    ),
    Assay(
        id="cardiotox",
        name="hERG cardiotoxicity",
        group="safety",
        engine="CardioTox local model",
        description="hERG blocker probability. Returns a probability band, never an IC50.",
        run=predict_cardiotox,
        fields=(
            ("Blocker probability", "prediction.blocker_probability"),
            ("Risk class", "prediction.risk_class"),
        ),
    ),
    Assay(
        id="dili",
        name="Drug-induced liver injury",
        group="safety",
        engine="DILI-ML (TDC) + conformal veto",
        description="Binary DILI probability with a conformal abstention. No severity class is predicted.",
        run=predict_dili_ml,
        fields=(
            ("DILI probability", "prediction.dili_probability"),
            ("Applicability domain", "prediction.applicability_domain"),
        ),
    ),
    Assay(
        id="bsep",
        name="BSEP inhibition (structural)",
        group="safety",
        engine="Local substructure model",
        description="Bile-salt export pump liability, a cholestatic hepatotoxicity mechanism.",
        run=predict_bsep,
        fields=(("Risk class", "risk_class"), ("Rationale", "rationale")),
    ),
    Assay(
        id="bsep_inhibition_remote",
        name="BSEP inhibition (ADMETlab)",
        group="safety",
        engine="ADMETlab 3.0",
        description="Independent remote BSEP call, used as a second opinion on the local model.",
        run=predict_bsep_inhibition,
        fields=(("Probability", "value"), ("Class", "class")),
        remote=True,
    ),
    Assay(
        id="phospholipidosis",
        name="Phospholipidosis",
        group="safety",
        engine="ADMETlab 3.0",
        description="Cationic amphiphilic drug liability; a common finding in repeat-dose studies.",
        run=predict_phospholipidosis,
        fields=(("Probability", "value"), ("Class", "class")),
        remote=True,
    ),
    Assay(
        id="cytotoxicity",
        name="General cytotoxicity",
        group="safety",
        engine="Ersilia Model Hub",
        description="Cell-viability CC50. The only bench assay that can yield a numeric safety margin.",
        run=predict_cytotoxicity,
        fields=(("CC50", "value"), ("Units", "unit"), ("Source", "source")),
        remote=True,
    ),
    # ── Identity & context ────────────────────────────────────────────────
    Assay(
        id="known_drug",
        name="Known-drug identity lookup",
        group="identity",
        engine="InChIKey / ECFP4 index",
        description="Exact, stereo-variant or near-neighbour match against the indexed drug set.",
        run=lambda smiles: _known_drug_envelope(smiles),
        fields=(
            ("Matched", "matched"),
            ("Name", "name"),
            ("Match type", "match_type"),
            ("Similarity", "similarity"),
        ),
    ),
    Assay(
        id="properties",
        name="Computed molecular properties",
        group="identity",
        engine="RDKit derived",
        description="Estimated pKa, charge state, synthetic accessibility and derived properties.",
        run=predict_properties,
        fields=(
            ("Estimated pKa", "pka"),
            ("Charge at pH 7.4", "charge_at_ph74"),
            ("Synthetic accessibility", "synthetic_accessibility"),
        ),
    ),
    Assay(
        id="assay_reliability",
        name="Structural interference review",
        group="identity",
        engine="PAINS / Brenk alert sets",
        description="Substructures that make a screening readout unreliable. Not measured interference.",
        run=assess_assay_reliability,
        fields=(
            ("Summary", "display_summary"),
            ("Alert level", "overall_alert_level"),
            ("Recommendation", "display_recommendation"),
        ),
    ),
)

_BY_ID: dict[str, Assay] = {assay.id: assay for assay in CATALOGUE}


def _known_drug_envelope(smiles: str) -> dict[str, Any]:
    """Normalise the lookup miss into the same envelope shape as a hit."""
    hit = lookup_drug(smiles)
    if hit is None:
        return {
            "matched": False,
            "available": True,
            "source": "known-drug-index",
            "reason": "No indexed drug matched this structure.",
        }
    return {"matched": True, "available": True, "source": "known-drug-index", **hit}


def _resolve(payload: Any, path: str) -> Any:
    """Read a dotted path out of a result envelope without raising."""
    current: Any = payload
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _availability(envelope: Any) -> tuple[str, str | None]:
    """Classify an adapter's own availability envelope."""
    if not isinstance(envelope, dict):
        return "available", None
    if envelope.get("available") is False or envelope.get("ml_available") is False:
        return "unavailable", str(
            envelope.get("reason") or envelope.get("error") or "The model did not return a prediction."
        )
    if envelope.get("source") in {"fallback", "unavailable", "insufficient-input"}:
        return "unavailable", str(
            envelope.get("reason") or envelope.get("error") or "The model did not return a prediction."
        )
    return "available", None


def _presentation(assay: Assay, envelope: dict[str, Any]) -> dict[str, Any]:
    """Build the display contract from values the adapter already returned."""
    fields = []
    for label, path in assay.fields:
        value = _resolve(envelope, path)
        if value is None or value == "":
            continue
        fields.append({"label": label, "value": round(value, 4) if isinstance(value, float) else value})
    return {"groups": [{"title": assay.name, "fields": fields}] if fields else []}


def assay_catalogue() -> dict[str, Any]:
    """Return the bench catalogue for the workspace to render."""
    return {
        "schema_version": "hakase.small-molecule.l1.assay-bench.v1",
        "owner": "hakase_smallmol.l1.assay_bench",
        "groups": [
            {
                **group,
                "assays": [
                    {
                        "id": assay.id,
                        "name": assay.name,
                        "engine": assay.engine,
                        "description": assay.description,
                        "remote": assay.remote,
                    }
                    for assay in CATALOGUE
                    if assay.group == group["id"]
                ],
            }
            for group in GROUPS
        ],
        "limitations": (
            "These are screening models. A remote assay reports unavailable when "
            "its provider cannot be reached; no substitute value is generated. "
            "The bench performs no aggregation across assays and produces no verdict."
        ),
    }


def run_assay_bench(
    smiles: str,
    *,
    assay_ids: list[str] | None = None,
    group_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Run a requested subset of the bench and return one envelope per assay."""
    if not smiles or not smiles.strip():
        raise ValueError("A SMILES string is required to run the assay bench.")

    selected: list[Assay]
    if assay_ids:
        unknown = [item for item in assay_ids if item not in _BY_ID]
        if unknown:
            raise ValueError(f"Unknown assay id(s): {', '.join(unknown)}")
        selected = [_BY_ID[item] for item in assay_ids]
    elif group_ids:
        known_groups = {group["id"] for group in GROUPS}
        unknown = [item for item in group_ids if item not in known_groups]
        if unknown:
            raise ValueError(f"Unknown assay group(s): {', '.join(unknown)}")
        selected = [assay for assay in CATALOGUE if assay.group in set(group_ids)]
    else:
        selected = list(CATALOGUE)

    results: list[dict[str, Any]] = []
    for assay in selected:
        try:
            envelope = assay.run(smiles)
        except Exception as error:  # noqa: BLE001 — one assay must not fail the bench
            results.append(
                {
                    "id": assay.id,
                    "name": assay.name,
                    "group": assay.group,
                    "engine": assay.engine,
                    "status": "error",
                    "reason": f"{type(error).__name__}: {error}",
                    "presentation": {"groups": []},
                }
            )
            continue
        status, reason = _availability(envelope)
        results.append(
            {
                "id": assay.id,
                "name": assay.name,
                "group": assay.group,
                "engine": assay.engine,
                "remote": assay.remote,
                "status": status,
                "reason": reason,
                "result": envelope,
                "presentation": _presentation(assay, envelope if isinstance(envelope, dict) else {}),
            }
        )

    return {
        "schema_version": "hakase.small-molecule.l1.assay-bench.run.v1",
        "owner": "hakase_smallmol.l1.assay_bench",
        "smiles": smiles,
        "computed_at": datetime.now(UTC).isoformat(),
        "assays": results,
        "summary": {
            "requested": len(selected),
            "available": sum(1 for item in results if item["status"] == "available"),
            "unavailable": sum(1 for item in results if item["status"] == "unavailable"),
            "errored": sum(1 for item in results if item["status"] == "error"),
        },
        "provenance": {"client_contract": "display-only"},
    }
