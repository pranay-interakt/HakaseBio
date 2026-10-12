"""The operator command that builds and inspects reference sets.

The command reaches a public API, so the build here runs against ChEMBL responses recorded
on 2026-10-11 and writes to a temporary data directory.
"""

import json

import httpx
import pytest

from hos.data_sources import CachedHttp, ChEMBLClient
from hos.triage import cli
from hos.triage.reference import build_herg_reference, reference_path, save_reference
from tests.fixtures.transport import replay_transport


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("HOS_DATA_DIR", str(tmp_path))
    return tmp_path


def test_show_reports_an_installed_set(data_dir, capsys):
    ch = ChEMBLClient(CachedHttp(client=httpx.Client(transport=replay_transport())))
    reference = build_herg_reference(ch, page_size=300, max_pages=1).reference
    save_reference(reference, data_dir)

    assert cli.main(["show", "herg"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["snapshot_id"] == reference.snapshot_id
    assert out["compounds"] == len(reference.compounds)
    assert "CC BY-SA" in out["licence"]  # the source's terms are reported, not hidden
    assert out["path"] == str(reference_path("herg_ic50", data_dir))


def test_show_exits_non_zero_when_nothing_is_installed(data_dir, capsys):
    """An operator script must be able to tell that no set is installed."""
    assert cli.main(["show", "herg"]) == 1
    assert "no herg_ic50 reference set installed" in capsys.readouterr().out


def test_an_unknown_endpoint_is_refused(data_dir):
    with pytest.raises(SystemExit):
        cli.main(["show", "not-an-endpoint"])


def test_an_unknown_command_is_refused(data_dir):
    with pytest.raises(SystemExit):
        cli.main(["demolish", "herg"])
