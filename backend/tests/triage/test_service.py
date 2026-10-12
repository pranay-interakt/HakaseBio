"""Running and recording triage, and the boundary it must not cross.

The boundary tests matter most: a triage report is decision support, so running one must
leave studies, readiness and the Module 4 package exactly as they were.
"""

import httpx
import pytest

from hos.data_sources import CachedHttp, ChEMBLClient
from hos.db.repository import content_hash
from hos.ind import assemble_module4, readiness_report
from hos.kernel.errors import NotFound, PermissionDenied
from hos.triage.service import ACTION
from hos.triage.types import Outcome
from tests.fixtures.transport import replay_transport
from tests.kernel.test_kernel import CTX, k  # noqa: F401

NITROFLUORENE = "O=[N+]([O-])c1ccc2c(c1)Cc1ccccc1-2"
#: paracetamol, the compound the recorded ChEMBL fixtures cover
PARACETAMOL = "CC(=O)Nc1ccc(O)cc1"


def _chembl():
    return ChEMBLClient(CachedHttp(client=httpx.Client(transport=replay_transport())))


def _compound(k, smiles=NITROFLUORENE, name="2-nitrofluorene"):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="HOS-TR1", context=CTX)
    cmp_ = k.register_compound(sci, prog["id"], name=name, smiles=smiles)
    return sci, prog["id"], cmp_["id"]


def test_a_run_is_stored_as_a_version_and_recorded(k):  # noqa: F811
    sci, _, cid = _compound(k)
    assert k.triage.view(cid) is None  # nothing until it is run

    report = k.triage.run(sci, cid)
    assert report["version"] == 1 and report["created_by"] == "sci"
    # every screen answers, including the one that cannot reach a source: a missing signal
    # would leave the report silently short rather than saying why
    assert [s["id"] for s in report["signals"]] == [
        "alerts.brenk",
        "alerts.pains",
        "alerts.nih",
        "herg.read_across",
    ]
    herg = report["signals"][-1]
    assert herg["outcome"] == "not_predictable"
    assert "no reference set" in herg["reason"]
    assert (
        content_hash(
            {
                kk: report[kk]
                for kk in ("compound_id", "program_id", "canonical_smiles", "signals", "limitation")
            }
        )
        == report["content_hash"]
    )

    events = [e for e in k.history(cid) if e["action"] == ACTION]
    assert len(events) == 1
    assert events[0]["payload"]["content_hash"] == report["content_hash"]
    assert events[0]["payload"]["outcomes"]["alerts.brenk"] == Outcome.ALERTING.value


def test_rerunning_adds_a_version_and_keeps_the_first(k):  # noqa: F811
    sci, _, cid = _compound(k)
    first = k.triage.run(sci, cid)
    second = k.triage.run(sci, cid)
    assert (first["version"], second["version"]) == (1, 2)
    assert k.triage.view(cid)["version"] == 2
    assert k.triage.view(cid, 1)["content_hash"] == first["content_hash"]
    assert [v["version"] for v in k.triage.versions(cid)] == [1, 2]
    with pytest.raises(NotFound):
        k.triage.view(cid, 9)


def test_the_standing_limitation_is_part_of_every_report(k):  # noqa: F811
    sci, _, cid = _compound(k)
    report = k.triage.run(sci, cid)
    assert "never part of a study record" in report["limitation"]


def test_an_actor_without_a_working_role_cannot_run_one(k):  # noqa: F811
    _, _, cid = _compound(k)
    with pytest.raises(PermissionDenied):
        k.triage.run(k.get_principal("qa"), cid)


def test_triage_never_enters_a_study_readiness_or_module_4(k):  # noqa: F811
    """The boundary: a triage run changes nothing a submission is built from."""
    sci, pid, cid = _compound(k, PARACETAMOL, "paracetamol")
    before_readiness = readiness_report(k, pid)
    before_studies = [s.id for s in k.repo.studies(pid)]
    before_pkg = assemble_module4(k, sci, pid)

    k.triage.run(sci, cid, chembl=_chembl())

    assert readiness_report(k, pid)["summary"] == before_readiness["summary"]
    assert [s.id for s in k.repo.studies(pid)] == before_studies
    after_pkg = assemble_module4(k, sci, pid)
    # the package's verification manifest pins the ledger head, which any recorded action
    # moves; everything the submission is actually built from must be identical
    content = (
        "toc",
        "included_studies",
        "imported_studies",
        "refused_studies",
        "dose_projection",
        "readiness",
        "literature_references",
    )
    assert {kk: after_pkg[kk] for kk in content} == {kk: before_pkg[kk] for kk in content}
    assert "triage" not in str(after_pkg).lower()


def test_a_report_carries_no_value_that_could_pass_as_a_study_result(k):  # noqa: F811
    """Every number in a report is computed, literature or unavailable — never MEASURED,
    which in this system means an observation made in a study."""
    sci, _, cid = _compound(k, PARACETAMOL, "paracetamol")
    report = k.triage.run(sci, cid, chembl=_chembl())
    kinds = {
        s["quantity"]["provenance"]["kind"] for s in report["signals"] if s["quantity"] is not None
    }
    assert kinds and kinds <= {"computed", "predicted", "literature", "unavailable"}
    assert "measured" not in kinds
    assert "simulated" not in kinds


def test_the_integrity_check_reconciles_stored_reports(k):  # noqa: F811
    sci, _, cid = _compound(k)
    k.triage.run(sci, cid)
    assert k.integrity()["valid"]


def test_an_edited_report_is_caught_by_the_integrity_check(k):  # noqa: F811
    sci, _, cid = _compound(k)
    k.triage.run(sci, cid)
    with k.db.session() as s:
        row = k.repo.triage_reports(cid)[0]
        stored = s.get(type(row), row.id)
        content = dict(stored.content)
        content["signals"] = []
        stored.content = content
    report = k.integrity()
    assert not report["valid"]
    assert any("triage" in f["subject"] for f in report["findings"])


def test_a_programme_view_gives_the_latest_per_compound(k):  # noqa: F811
    sci, pid, cid = _compound(k)
    k.triage.run(sci, cid)
    k.triage.run(sci, cid)
    other = k.register_compound(sci, pid, name="caffeine", smiles="Cn1cnc2c1c(=O)n(C)c(=O)n2C")
    k.triage.run(sci, other["id"])
    latest = k.triage.program_latest(pid)
    assert set(latest) == {cid, other["id"]}
    assert latest[cid]["version"] == 2


def test_an_installed_reference_set_is_used_and_recorded(k):  # noqa: F811
    """A set installed under the kernel's data directory is what the endpoint screens read,
    and the snapshot id it used is part of the stored report."""
    import httpx

    from hos.triage.reference import build_herg_reference, save_reference

    ch = ChEMBLClient(CachedHttp(client=httpx.Client(transport=replay_transport())))
    reference = build_herg_reference(ch, page_size=300, max_pages=1).reference
    save_reference(reference, k.files.root.parent)

    sci, _, cid = _compound(k, PARACETAMOL, "paracetamol")
    report = k.triage.run(sci, cid)  # no client passed: the set makes the screen offline
    herg = next(s for s in report["signals"] if s["id"] == "herg.read_across")
    assert herg["outcome"] == "not_predictable"  # paracetamol has no near measured analogue
    assert reference.snapshot_id in herg["quantity"]["provenance"]["reason"]
