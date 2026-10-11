"""The hERG triage screen against ChEMBL responses recorded on 2026-10-11.

Two real cases: a compound whose hERG IC50 is published many times over (dofetilide, a
class III antiarrhythmic), and one with no measurement and no measured analogue near
enough to read across (paracetamol). The second case is the one that matters most — the
screen must say it cannot answer rather than produce a number.
"""

import httpx
import pytest

from hos.core.provenance import ProvenanceKind
from hos.data_sources import CachedHttp, ChEMBLClient, SourceStatus
from hos.triage.herg import HergParams, screen_herg
from hos.triage.readacross import ReadAcrossParams
from hos.triage.types import Outcome
from tests.fixtures.transport import replay_transport

DOFETILIDE = "CN(CCOc1ccc(NS(C)(=O)=O)cc1)CCc1ccc(NS(C)(=O)=O)cc1"
DOFETILIDE_KEY = "IXTMWRCNAAVVAI-UHFFFAOYSA-N"
PARACETAMOL = "CC(=O)Nc1ccc(O)cc1"
PARACETAMOL_KEY = "RZVAJINKPMORJF-UHFFFAOYSA-N"

PARAMS = HergParams(
    read_across=ReadAcrossParams(min_similarity=0.5, max_analogues=5, min_analogues=3),
    candidate_limit=100,
    max_lookups=60,
)


def _chembl(transport=None):
    return ChEMBLClient(CachedHttp(client=httpx.Client(transport=transport or replay_transport())))


def test_a_measured_compound_is_reported_not_estimated():
    s = screen_herg(DOFETILIDE, _chembl(), PARAMS, inchikey=DOFETILIDE_KEY)
    assert s.outcome is Outcome.MEASURED
    q = s.quantity
    assert q.kind is ProvenanceKind.LITERATURE  # a published measurement, not a prediction
    assert q.unit == "nM"
    # dofetilide is a potent hERG blocker; published IC50s sit in the low nanomolar range
    assert 1.0 < q.value < 100.0
    assert q.provenance.source_name == "ChEMBL"
    assert q.provenance.source_record_id == "CHEMBL473"
    assert q.uncertainty.kind == "range" and q.uncertainty.n > 1
    assert s.analogues == ()  # nothing was read across


def test_a_compound_without_measured_analogues_abstains():
    s = screen_herg(PARACETAMOL, _chembl(), PARAMS, inchikey=PARACETAMOL_KEY)
    assert s.outcome is Outcome.NOT_PREDICTABLE
    assert s.quantity.kind is ProvenanceKind.UNAVAILABLE
    assert s.quantity.value is None
    assert "3 are required" in s.reason
    assert s.analogues == ()


def test_an_unparseable_structure_abstains_without_calling_the_source():
    def refuse(request):  # pragma: no cover - must never be reached
        raise AssertionError(f"no request should be made, got {request.url}")

    s = screen_herg("not-a-structure", _chembl(httpx.MockTransport(refuse)), PARAMS)
    assert s.outcome is Outcome.NOT_PREDICTABLE
    assert "no parseable structure" in s.reason


def test_an_unreachable_source_abstains_rather_than_estimating():
    def down(request):
        raise httpx.ConnectError("network down")

    s = screen_herg(PARACETAMOL, _chembl(httpx.MockTransport(down)), PARAMS)
    assert s.outcome is Outcome.NOT_PREDICTABLE
    assert SourceStatus.UNREACHABLE.value in s.reason
    assert s.quantity.value is None


def test_the_limits_travel_with_every_answer():
    for s in (
        screen_herg(DOFETILIDE, _chembl(), PARAMS, inchikey=DOFETILIDE_KEY),
        screen_herg(PARACETAMOL, _chembl(), PARAMS, inchikey=PARACETAMOL_KEY),
    ):
        assert any("margin" in limit for limit in s.limits)
        assert s.to_dict()["limits"]


@pytest.mark.live
def test_live_chembl_still_answers_the_same_shape():
    """Schema drift check against the live service (``pytest -m live``)."""
    s = screen_herg(DOFETILIDE, ChEMBLClient(), PARAMS, inchikey=DOFETILIDE_KEY)
    assert s.outcome is Outcome.MEASURED and 1.0 < s.quantity.value < 100.0
