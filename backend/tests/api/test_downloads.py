"""Download filenames come from users; the header must stay well-formed (docs/15 P3)."""

from urllib.parse import unquote

import pytest

from hos.api.app import attachment
from tests.api.test_api import CTX, _login
from tests.api.test_identity import _app


@pytest.mark.parametrize(
    "name",
    [
        'Bericht "final"; für Studie.pdf',
        "../../etc/passwd",
        "report\r\nSet-Cookie: a=b.pdf",
        "毒性試験報告書.pdf",
        "",
    ],
)
def test_the_header_is_safe_and_keeps_the_exact_name(name):
    h = attachment(name)
    fallback = h.split('filename="', 1)[1].split('"', 1)[0]
    assert h.isascii() and "\r" not in h and "\n" not in h
    assert set(fallback) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._ -"
    )
    exact = unquote(h.split("filename*=UTF-8''", 1)[1])
    assert exact == (name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "download")


def test_a_report_with_a_non_ascii_name_downloads(tmp_path):
    c, _, _ = _app(tmp_path)
    sci = _login(c, "sci")
    prog = c.post("/api/programs", headers=sci, json={"name": "D", "context": CTX}).json()["id"]
    cid = c.post(
        f"/api/programs/{prog}/compounds", headers=sci, json={"name": "c", "smiles": "CCO"}
    ).json()["id"]
    name = 'Bericht "final" für Studie.pdf'
    sid = c.post(
        f"/api/programs/{prog}/imports",
        headers=sci,
        content=b"%PDF-1.4 report",
        params={
            "compound_id": cid,
            "requirement_id": "genotox.ames",
            "filename": name,
            "title": "Ames",
            "laboratory": "Lab",
            "report_date": "2026-05-01",
            "glp": "false",
        },
    ).json()["id"]
    r = c.get(f"/api/studies/{sid}/import/report", headers=sci)
    assert r.status_code == 200 and r.content == b"%PDF-1.4 report"
    cd = r.headers["Content-Disposition"]
    assert cd.startswith('attachment; filename="Bericht _final_ f_r Studie.pdf"')
    assert unquote(cd.split("filename*=UTF-8''", 1)[1]) == name
