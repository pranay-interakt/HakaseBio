"""hERG inhibition triage by read-across from measured analogue potencies.

Before a cardiac study is commissioned, this estimates the compound's hERG IC50 from the
**measured** IC50 values of its nearest structural analogues in ChEMBL (target CHEMBL240,
human KCNH2). Nothing is modelled about the compound itself: the number is a
similarity-weighted average of real measurements on real analogues, and every analogue
that supported it travels with the result.

How a measurement qualifies (anything else is excluded, and the exclusions are counted):

* the activity is an IC50 against CHEMBL240 with a usable unit;
* it is an exact value — a result reported as ``>`` or ``<`` a concentration is a bound,
  not a measurement, and is never flattened into a number;
* ChEMBL attaches no data-validity warning to it.

Potencies are averaged on the logarithmic scale (pIC50 = 9 - log10(IC50 in nM)), as
potency is log-normally distributed across assays; an analogue measured several times
contributes the median of its own pIC50 values, so a heavily assayed compound does not
dominate. The estimate is converted back to an IC50 in nM for display.

The applicability domain is enforced by :mod:`hos.triage.readacross`: without the required
number of analogues above the similarity threshold, the screen returns UNAVAILABLE with
the reason and no number.

What this is not: it is not an assay, not a safety margin, and not a verdict. A margin
against clinical exposure (ICH S7B; Redfern 2003) needs a clinical Cmax, which does not
exist at triage, so none is computed here. No accuracy is claimed until a pre-registered,
held-out validation is published for this endpoint.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

from rdkit import Chem

from hos.core.citations import cite
from hos.core.methods import method
from hos.core.provenance import ApplicabilityCheck, Uncertainty
from hos.core.quantity import Quantity
from hos.data_sources.base import SourceStatus
from hos.data_sources.chembl import HERG_TARGET, ChEMBLClient
from hos.triage.readacross import ReadAcrossParams, fingerprint, read_across, tanimoto
from hos.triage.types import Analogue, Outcome, Signal

__all__ = ["SIGNAL_ID", "HergParams", "screen_herg"]

SIGNAL_ID = "herg.read_across"
_TITLE = "hERG inhibition (IC50), read across measured analogues"
_METHOD = "triage.read_across"
_UNIT = "nM"

_LIMITS = (
    "an estimate from analogues, not a measurement of this compound",
    "bounded results (reported as > or < a concentration) and records ChEMBL flags as "
    "doubtful are excluded, so a compound with only such records contributes nothing",
    "analogue values come from different assays and laboratories; inter-assay variation is "
    "visible in the range shown, not corrected for",
    "no safety margin is implied: a margin needs a clinical exposure, which does not exist "
    "at triage",
    "no accuracy is claimed until a pre-registered, held-out validation is published",
)


@dataclass(frozen=True, slots=True)
class HergParams:
    """Retrieval limits for this screen, on top of the read-across neighbourhood."""

    read_across: ReadAcrossParams = field(default_factory=ReadAcrossParams)
    #: how many candidate structures to ask ChEMBL for
    candidate_limit: int = 100
    #: how many of them, most similar first, to look measured activities up for. They are
    #: looked up in one query, so this bounds the work without costing a request each.
    max_lookups: int = 60


def _pic50_nM(q: Quantity) -> float | None:
    """pIC50 from an IC50 quantity, or None if it cannot be expressed in nM."""
    try:
        nm = q.magnitude_in(_UNIT)
    except Exception:  # noqa: BLE001 - an unconvertible unit is simply not usable here
        return None
    if nm <= 0:
        return None
    return 9.0 - math.log10(nm)


def _usable(q: Quantity) -> bool:
    """An exact, unflagged IC50 measurement."""
    if not q.is_available:
        return False
    return not any(
        f.startswith("censored_") or f.startswith("chembl_validity:") for f in q.qc_flags
    )


def _unavailable(reason: str) -> Signal:
    return Signal(
        id=SIGNAL_ID,
        title=_TITLE,
        outcome=Outcome.NOT_PREDICTABLE,
        summary="No estimate: " + reason,
        quantity=Quantity.unavailable(_UNIT, reason=reason, label="hERG IC50 (not predicted)"),
        limits=_LIMITS,
        citations=(cite("shah2016"), cite("helman2019"), cite("rogers2010"), cite("davies2015")),
        reason=reason,
    )


def _measured_signal(cid: str, pic50s: list[float], name: str | None) -> Signal:
    """The compound's own measured hERG IC50: reported, not estimated."""
    mid = median(pic50s)
    value = 10.0 ** (9.0 - mid)
    low = 10.0 ** (9.0 - max(pic50s))
    high = 10.0 ** (9.0 - min(pic50s))
    quantity = Quantity.literature(
        value,
        _UNIT,
        source_name="ChEMBL",
        citation=cite("davies2015"),
        source_record_id=cid,
        source_url=f"https://www.ebi.ac.uk/chembl/compound_report_card/{cid}/",
        uncertainty=Uncertainty(kind="range", lower=low, upper=high, n=len(pic50s)),
        label=f"hERG IC50 ({HERG_TARGET}), median of {len(pic50s)} measurement(s)",
        notes=(
            "median of the exact, unflagged IC50 values ChEMBL holds for this structure, "
            "taken on the pIC50 scale; assays and laboratories differ, and the range shown "
            "is that spread, not an experimental error"
        ),
    )
    return Signal(
        id=SIGNAL_ID,
        title=_TITLE,
        outcome=Outcome.MEASURED,
        summary=(
            f"Already measured: {len(pic50s)} hERG IC50 value(s) published for this "
            f"structure, median {value:,.0f} nM. No estimate is needed."
        ),
        quantity=quantity,
        limits=(
            "published measurements for this structure, not a study run here",
            "assay format, cell line and temperature differ between publications",
            "no safety margin is implied: a margin needs a clinical exposure",
        ),
        citations=(cite("davies2015"),),
    )


def _own_measurements(
    chembl: ChEMBLClient, inchikey: str
) -> tuple[str, list[float], str | None] | None:
    """The compound's own usable hERG IC50 values, if ChEMBL holds the structure."""
    if not inchikey:
        return None
    found = chembl.molecule_by_inchikey(inchikey)
    if not found.ok or not found.records:
        return None
    cid = found.records[0].get("chembl_id")
    if not isinstance(cid, str):
        return None
    acts = chembl.herg_ic50(cid)
    if not acts.ok:
        return None
    values = [v for q in acts.quantities.values() if _usable(q) and (v := _pic50_nM(q)) is not None]
    if not values:
        return None
    name = found.records[0].get("pref_name")
    return cid, values, name if isinstance(name, str) else None


def screen_herg(
    smiles: str, chembl: ChEMBLClient, params: HergParams | None = None, *, inchikey: str = ""
) -> Signal:
    """Report a measured hERG IC50 if one exists, else read across measured analogues.

    The order matters: a compound that has been measured is reported as measured, and
    nothing is estimated for it. Only when no measurement exists is an estimate attempted,
    and only when enough near analogues carry measured values.
    """
    p = params or HergParams()
    ra = p.read_across
    mol = Chem.MolFromSmiles(smiles) if smiles.strip() else None
    if mol is None:
        return _unavailable("the compound has no parseable structure to find analogues for")

    own = _own_measurements(chembl, inchikey)
    if own is not None:
        return _measured_signal(*own)

    query_fp = fingerprint(mol)

    found = chembl.similar_molecules(
        smiles, threshold=int(ra.min_similarity * 100), limit=p.candidate_limit
    )
    if found.status is SourceStatus.NOT_FOUND:
        return _unavailable(
            f"ChEMBL holds no structure at or above {ra.min_similarity:g} similarity to this one"
        )
    if not found.ok:
        return _unavailable(
            f"the analogue search could not be completed ({found.status.value}); "
            "no estimate is made from an incomplete search"
        )

    # recompute similarity locally, so the weighting is this system's own computation
    candidates: list[tuple[float, dict[str, object]]] = []
    for rec in found.records:
        smi = rec.get("canonical_smiles")
        cid = rec.get("chembl_id")
        if not isinstance(smi, str) or not isinstance(cid, str):
            continue
        if inchikey and rec.get("standard_inchi_key") == inchikey:
            continue  # never predict a compound from itself
        cand = Chem.MolFromSmiles(smi)
        if cand is None:
            continue
        sim = tanimoto(query_fp, fingerprint(cand))
        if sim >= ra.min_similarity:
            candidates.append((sim, dict(rec)))
    candidates.sort(key=lambda c: (-c[0], str(c[1].get("chembl_id"))))

    if not candidates:
        return _unavailable(
            f"no retrieved structure reached Tanimoto {ra.min_similarity:g} to this one"
        )

    # one query for every candidate's measured hERG activity, rather than one each
    looked_up = candidates[: p.max_lookups]
    by_id = {str(rec["chembl_id"]): (sim, rec) for sim, rec in looked_up}
    acts = chembl.activities_for(
        by_id, target_chembl_id=HERG_TARGET, standard_types=("IC50",), refresh=False
    )
    if acts.status is SourceStatus.NOT_FOUND:
        return _unavailable(
            f"none of the {len(by_id)} structure(s) retrieved for this one has a measured "
            f"hERG IC50 in ChEMBL"
        )
    if not acts.ok:
        return _unavailable(
            f"the measured-activity lookup could not be completed ({acts.status.value}); "
            "no estimate is made from an incomplete lookup"
        )

    pic50s: dict[str, list[float]] = {}
    excluded = 0
    for rec in acts.records:
        cid = rec.get("molecule_chembl_id")
        if not isinstance(cid, str) or cid not in by_id:
            continue
        q = acts.quantities.get(f"activity:{rec.get('activity_id')}")
        if q is None or not _usable(q):
            excluded += 1
            continue
        v = _pic50_nM(q)
        if v is None:
            excluded += 1
            continue
        pic50s.setdefault(cid, []).append(v)

    analogues: list[Analogue] = []
    for cid, values in sorted(pic50s.items(), key=lambda kv: (-by_id[kv[0]][0], kv[0])):
        if len(analogues) >= ra.max_analogues:
            break
        sim, rec = by_id[cid]
        mid = median(values)
        name = rec.get("pref_name")
        analogues.append(
            Analogue(
                identifier=cid,
                name=name if isinstance(name, str) else None,
                smiles=str(rec.get("canonical_smiles") or ""),
                similarity=sim,
                value=Quantity.literature(
                    10.0 ** (9.0 - mid),
                    _UNIT,
                    citation=cite("davies2015"),
                    source_name="ChEMBL",
                    source_record_id=cid,
                    label=f"hERG IC50 ({HERG_TARGET}), median of {len(values)} measurement(s)",
                ),
                n_measurements=len(values),
                source_url=f"https://www.ebi.ac.uk/chembl/compound_report_card/{cid}/",
            )
        )

    sims = [a.similarity for a in analogues]
    pics = [9.0 - math.log10(a.value.require()) for a in analogues]
    result = read_across(sims, pics, ra)
    if result.value is None:
        assert result.reason is not None
        return _unavailable(result.reason)

    used = [analogues[i] for i in result.used]
    assert result.low is not None and result.high is not None
    estimate = 10.0 ** (9.0 - result.value)
    quantity = Quantity.predicted(
        estimate,
        _UNIT,
        method=method(_METHOD),
        applicability=ApplicabilityCheck(
            in_domain=True,
            descriptor_ranges_checked=("ECFP4 Tanimoto similarity to measured analogues",),
            distance_metric="ECFP4 Tanimoto, nearest analogue",
            distance_value=result.nearest_similarity,
        ),
        inputs=[a.value for a in used],
        uncertainty=Uncertainty(
            kind="range",
            # a higher pIC50 is a lower IC50, so the bounds swap on conversion
            lower=10.0 ** (9.0 - result.high),
            upper=10.0 ** (9.0 - result.low),
            n=len(used),
        ),
        label="hERG IC50, read across measured analogues",
        notes=(
            f"similarity-weighted over {len(used)} analogue(s) from ChEMBL target "
            f"{HERG_TARGET}; averaged as pIC50; "
            f"{excluded} measurement(s) excluded as bounded, flagged or unconvertible; "
            f"neighbourhood {ra.to_dict()}"
        ),
        software={"chembl_retrieved_at": found.retrieved_at or ""},
    )
    return Signal(
        id=SIGNAL_ID,
        title=_TITLE,
        outcome=Outcome.PREDICTED,
        summary=(
            f"Estimated hERG IC50 {estimate:,.0f} nM from {len(used)} measured analogue(s) "
            f"(nearest similarity {result.nearest_similarity:.2f})."
        ),
        quantity=quantity,
        analogues=tuple(used),
        limits=_LIMITS,
        citations=(cite("shah2016"), cite("helman2019"), cite("rogers2010"), cite("davies2015")),
    )
