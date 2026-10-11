"""Structural-alert screens: known-structure matches, and what a clean screen means.

The positive controls are structures whose alerting group is unambiguous (an aromatic
nitro, a three-membered heterocycle), so the test states a chemical fact rather than
pinning whatever the catalogue happens to return.
"""

from hos.core.provenance import ProvenanceKind
from hos.triage.alerts import ALERT_SETS, screen_alerts
from hos.triage.types import Outcome

# 2-nitrofluorene: an aromatic nitro compound (a classic bacterial-mutagenicity positive)
NITROFLUORENE = "O=[N+]([O-])c1ccc2c(c1)Cc1ccccc1-2"
ETHYLENE_OXIDE = "C1CO1"
CAFFEINE = "Cn1cnc2c1c(=O)n(C)c(=O)n2C"


def _by_id(signals):
    return {s.id: s for s in signals}


def test_every_registered_set_is_reported_once():
    signals = screen_alerts(CAFFEINE)
    assert [s.id for s in signals] == [f"alerts.{s.id}" for s in ALERT_SETS]


def test_an_aromatic_nitro_group_is_matched_with_the_atoms_that_matched():
    brenk = _by_id(screen_alerts(NITROFLUORENE))["alerts.brenk"]
    assert brenk.outcome is Outcome.ALERTING
    names = {a.alert for a in brenk.alerts}
    assert "nitro_group" in names
    nitro = next(a for a in brenk.alerts if a.alert == "nitro_group")
    assert len(nitro.atom_indices) == 3  # N and both oxygens
    assert nitro.alert_set == "Brenk"
    assert "doi:10.1002/cmdc.200700139" in nitro.reference


def test_a_strained_three_membered_ring_is_matched():
    brenk = _by_id(screen_alerts(ETHYLENE_OXIDE))["alerts.brenk"]
    assert brenk.outcome is Outcome.ALERTING
    assert any("Three-membered" in a.alert for a in brenk.alerts)


def test_a_clean_structure_is_reported_as_no_alert_not_as_safe():
    brenk = _by_id(screen_alerts(CAFFEINE))["alerts.brenk"]
    assert brenk.outcome is Outcome.NO_ALERT
    assert brenk.alerts == ()
    assert brenk.quantity.value == 0.0
    assert any("no hazard" in limit for limit in brenk.limits)


def test_the_match_count_is_computed_with_its_cited_method():
    brenk = _by_id(screen_alerts(NITROFLUORENE))["alerts.brenk"]
    q = brenk.quantity
    assert q.kind is ProvenanceKind.COMPUTED
    assert q.value == float(len(brenk.alerts))
    assert q.provenance.method.id == "triage.structural_alerts"
    assert {c.key for c in q.provenance.method.citations} >= {"brenk2008", "baell2010"}


def test_each_set_carries_its_own_primary_citation():
    keys = {s.id: {c.key for c in s.citations} for s in screen_alerts(CAFFEINE)}
    assert keys["alerts.brenk"] == {"brenk2008"}
    assert keys["alerts.pains"] == {"baell2010"}
    assert keys["alerts.nih"] == {"jadhav2010"}


def test_an_unparseable_structure_is_not_a_clean_screen():
    for signal in screen_alerts("not-a-structure"):
        assert signal.outcome is Outcome.NOT_PREDICTABLE
        assert "no parseable structure" in signal.reason
        assert signal.quantity is None


def test_the_screen_is_deterministic():
    first = [s.to_dict() for s in screen_alerts(NITROFLUORENE)]
    second = [s.to_dict() for s in screen_alerts(NITROFLUORENE)]
    for a, b in zip(first, second, strict=True):
        a.pop("quantity"), b.pop("quantity")  # timestamps differ by construction
        assert a == b
