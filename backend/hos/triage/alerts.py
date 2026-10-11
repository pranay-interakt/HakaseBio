"""Structural-alert screens over published alert sets.

A screen matches the compound's structure against a set of substructure alerts published
by its authors and distributed with RDKit's filter catalogues. The result is deterministic
and :class:`COMPUTED <hos.core.provenance.ProvenanceKind>`: a match is a fact about the
structure, not a prediction about an animal.

Each set is included for what its authors built it for, and that purpose is carried with
every match (RDKit stores the set's own ``Scope`` and ``Reference`` on each entry, which
are recorded verbatim alongside the registry's verified citation):

* **Brenk 2008** — functionality the authors excluded from screening libraries for
  potential toxicity or unfavourable pharmacokinetics (``doi:10.1002/cmdc.200700139``).
* **Baell & Holloway 2010** — pan-assay interference substructures: a hit in an in vitro
  assay may be an artefact of the compound rather than target activity
  (``doi:10.1021/jm901137j``).
* **Jadhav 2010 (NIH set)** — functional groups associated with aggregation,
  autofluorescence and reactivity artefacts in screening (``doi:10.1021/jm901070c``).

What a match does **not** establish: these sets were derived for triaging screening
libraries, not for regulatory hazard classification, and none of them is a (Q)SAR model.
An alerting structure is a prompt to look, not a finding; a structure with no alert is not
thereby shown to be safe, since the sets cover only the functionality their authors
catalogued. No sensitivity or specificity is claimed for any endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache

from rdkit import Chem
from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams

from hos.core.citations import cite
from hos.core.methods import method
from hos.core.quantity import Quantity
from hos.triage.types import AlertMatch, Outcome, Signal

__all__ = ["ALERT_SETS", "AlertSet", "screen_alerts"]

_METHOD = "triage.structural_alerts"


@dataclass(frozen=True, slots=True)
class AlertSet:
    """One published alert set: what it is, why it is here, and its primary citation."""

    id: str
    catalog: str
    title: str
    purpose: str
    citation_key: str

    def signal_id(self) -> str:
        return f"alerts.{self.id}"


#: The sets screened, in the order they are reported. ``catalog`` names an RDKit
#: ``FilterCatalogParams.FilterCatalogs`` member; the alerts themselves are RDKit's
#: published data, not written here.
ALERT_SETS: tuple[AlertSet, ...] = (
    AlertSet(
        id="brenk",
        catalog="BRENK",
        title="Reactive or otherwise unwanted functionality",
        purpose=(
            "Substructures the authors excluded from screening libraries for potential "
            "toxicity or unfavourable pharmacokinetics. A match is a prompt to look at that "
            "part of the structure, not a finding about this compound."
        ),
        citation_key="brenk2008",
    ),
    AlertSet(
        id="pains",
        catalog="PAINS",
        title="Pan-assay interference substructures",
        purpose=(
            "Substructures that produce apparent activity across unrelated assays. A match "
            "means an in vitro result for this compound may be an assay artefact and is "
            "worth confirming by an orthogonal method."
        ),
        citation_key="baell2010",
    ),
    AlertSet(
        id="nih",
        catalog="NIH",
        title="Functional groups linked to screening artefacts",
        purpose=(
            "Groups associated with aggregation, autofluorescence and reactivity artefacts "
            "in screening collections."
        ),
        citation_key="jadhav2010",
    ),
)

_LIMITS = (
    "the alert sets were derived to triage screening libraries, not to classify hazard",
    "no alert does not mean no hazard: a set covers only the functionality its authors catalogued",
    "a match is a substructure in the structure, not a measurement and not a prediction",
)


@cache
def _catalog(name: str) -> FilterCatalog:
    """Build (once) the RDKit catalogue for an alert set."""
    params = FilterCatalogParams()
    if not params.AddCatalog(getattr(FilterCatalogParams.FilterCatalogs, name)):
        raise ValueError(f"RDKit has no filter catalogue {name!r}")
    return FilterCatalog(params)


def _matches(catalog: FilterCatalog, mol: Chem.Mol) -> tuple[AlertMatch, ...]:
    out: list[AlertMatch] = []
    for entry in catalog.GetMatches(mol):
        atoms: set[int] = set()
        for fm in entry.GetFilterMatches(mol):
            atoms.update(b for _, b in fm.atomPairs)
        props = set(entry.GetPropList())

        def prop(name: str, _props: set[str] = props, _e: object = entry) -> str:
            return str(_e.GetProp(name)) if name in _props else ""  # type: ignore[attr-defined]

        out.append(
            AlertMatch(
                alert=entry.GetDescription(),
                alert_set=prop("FilterSet"),
                scope=prop("Scope"),
                reference=prop("Reference"),
                atom_indices=tuple(sorted(atoms)),
            )
        )
    return tuple(sorted(out, key=lambda a: a.alert))


def screen_alerts(smiles: str) -> tuple[Signal, ...]:
    """Screen one structure against every registered alert set.

    Returns one :class:`~hos.triage.types.Signal` per set, each carrying the matched
    alerts with the atoms they matched and a COMPUTED count. An unparseable structure
    yields NOT_PREDICTABLE signals stating that, rather than an empty "no alert" result
    that would read as a clean screen.
    """
    mol = Chem.MolFromSmiles(smiles) if smiles.strip() else None
    signals: list[Signal] = []
    for s in ALERT_SETS:
        citation = cite(s.citation_key)
        if mol is None:
            signals.append(
                Signal(
                    id=s.signal_id(),
                    title=s.title,
                    outcome=Outcome.NOT_PREDICTABLE,
                    summary="No structure to screen.",
                    limits=_LIMITS,
                    citations=(citation,),
                    reason=(
                        "the compound has no parseable structure, so a substructure screen "
                        "cannot be run"
                    ),
                )
            )
            continue
        matches = _matches(_catalog(s.catalog), mol)
        count = Quantity.computed(
            float(len(matches)),
            "dimensionless",
            method=method(_METHOD),
            label=f"{s.title}: alerts matched",
            notes=f"{s.catalog} alert set screened with RDKit FilterCatalog",
        )
        names = ", ".join(m.alert for m in matches)
        signals.append(
            Signal(
                id=s.signal_id(),
                title=s.title,
                outcome=Outcome.ALERTING if matches else Outcome.NO_ALERT,
                summary=(
                    f"{len(matches)} alert(s) matched: {names}"
                    if matches
                    else "No alert in this set matched this structure."
                ),
                quantity=count,
                alerts=matches,
                limits=_LIMITS,
                citations=(citation,),
            )
        )
    return tuple(signals)
