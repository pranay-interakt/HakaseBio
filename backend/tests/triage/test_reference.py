"""Reference sets: building one from the source's own records, and reading across it.

The set under test is built by the real builder from one page of ChEMBL hERG records
recorded on 2026-10-11, so the values are the source's, never typed by hand.
"""

import json

import httpx
import pytest

from hos.core.provenance import ProvenanceKind
from hos.data_sources import CachedHttp, ChEMBLClient
from hos.triage.herg import HergParams, screen_herg
from hos.triage.readacross import ReadAcrossParams
from hos.triage.reference import (
    BUILD_VERSION,
    ReferenceSet,
    build_herg_reference,
    load_reference,
    reference_path,
    save_reference,
)
from hos.triage.types import Outcome
from tests.fixtures.transport import replay_transport

PAGE = 300
#: a compound in the recorded page that has near analogues in it, so removing it leaves a
#: genuine read-across case
WITH_ANALOGUES = "CHEMBL12186"
PARACETAMOL = "CC(=O)Nc1ccc(O)cc1"


@pytest.fixture(scope="module")
def built():
    ch = ChEMBLClient(CachedHttp(client=httpx.Client(transport=replay_transport())))
    return build_herg_reference(ch, page_size=PAGE, max_pages=1)


def test_a_build_aggregates_the_sources_records(built):
    r = built.reference
    assert built.records == PAGE
    assert r.endpoint == "herg_ic50" and r.unit == "nM" and r.scale == "pIC50"
    assert "CC BY-SA" in r.licence  # ChEMBL's terms travel with the set
    assert 0 < len(r.compounds) < PAGE  # several records per compound
    assert sum(c.n_measurements for c in r.compounds) + sum(r.excluded.values()) == PAGE


def test_records_the_source_flags_as_doubtful_are_excluded(built):
    assert built.reference.excluded["flagged_by_source"] > 0


def test_every_compound_carries_its_structure_and_a_count(built):
    for c in built.reference.compounds:
        assert c.identifier.startswith("CHEMBL")
        assert c.smiles and c.inchikey and len(c.inchikey) == 27
        assert c.n_measurements >= 1
        assert 0.0 < c.value < 15.0  # a pIC50, not a concentration


def test_the_snapshot_id_covers_the_contents_and_the_build_logic(built):
    r = built.reference
    assert r.snapshot_id.startswith("ref_")
    assert r.build_version == BUILD_VERSION
    same = ReferenceSet.from_dict(json.loads(json.dumps(r.to_dict())))
    assert same.snapshot_id == r.snapshot_id  # a round trip does not change it
    changed = ReferenceSet.from_dict({**r.to_dict(), "compounds": r.to_dict()["compounds"][:-1]})
    assert changed.snapshot_id != r.snapshot_id


def test_a_set_round_trips_through_the_data_directory(built, tmp_path):
    path = save_reference(built.reference, tmp_path)
    assert path == reference_path("herg_ic50", tmp_path)
    loaded = load_reference("herg_ic50", tmp_path)
    assert loaded is not None and loaded.snapshot_id == built.reference.snapshot_id
    assert load_reference("herg_ic50", tmp_path / "elsewhere") is None


def test_a_compound_in_the_set_is_reported_as_measured(built):
    r = built.reference
    target = next(c for c in r.compounds if c.identifier == WITH_ANALOGUES)
    s = screen_herg(target.smiles, None, reference=r)
    assert s.outcome is Outcome.MEASURED
    assert s.quantity.kind is ProvenanceKind.LITERATURE
    assert s.quantity.provenance.source_record_id == WITH_ANALOGUES
    assert r.snapshot_id in s.quantity.provenance.notes
    assert s.analogues == ()


def test_a_compound_outside_the_set_is_read_across_its_analogues(built):
    """Hide a compound from its own set: the estimate must come from its neighbours."""
    r = built.reference
    target = next(c for c in r.compounds if c.identifier == WITH_ANALOGUES)
    without = ReferenceSet.from_dict(
        {
            **r.to_dict(),
            "compounds": [c.to_dict() for c in r.compounds if c.identifier != target.identifier],
        }
    )
    s = screen_herg(target.smiles, None, reference=without)
    assert s.outcome is Outcome.PREDICTED
    q = s.quantity
    assert q.kind is ProvenanceKind.PREDICTED
    assert q.provenance.applicability.in_domain
    assert q.provenance.applicability.distance_metric.startswith("ECFP4")
    assert q.provenance.software["reference_set"] == without.snapshot_id
    assert len(s.analogues) >= 3
    assert all(a.similarity >= 0.5 for a in s.analogues)
    assert q.uncertainty.lower <= q.value <= q.uncertainty.upper
    assert target.identifier not in {a.identifier for a in s.analogues}  # never from itself


def test_a_compound_far_from_the_set_abstains(built):
    s = screen_herg(PARACETAMOL, None, reference=built.reference)
    assert s.outcome is Outcome.NOT_PREDICTABLE
    assert "3 are required" in s.reason
    assert built.reference.snapshot_id in s.quantity.provenance.reason


def test_without_a_set_or_a_source_the_screen_abstains():
    s = screen_herg(PARACETAMOL, None, HergParams(read_across=ReadAcrossParams()))
    assert s.outcome is Outcome.NOT_PREDICTABLE
    assert "no reference set" in s.reason
