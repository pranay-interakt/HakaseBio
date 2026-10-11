"""Every citation resolves to what it says it is (docs/15 P3; CLAUDE.md rule 3).

Live: run with ``pytest -m live``. Each DOI must resolve on Crossref with the cited year among
its issue and publication years, and the first author (or, for a corporate or unlisted author,
the title) must match the citation text. Each URL must answer 200.
"""

import unicodedata

import httpx
import pytest

from hos.core.citations import CITATIONS

pytestmark = pytest.mark.live

UA = {"User-Agent": "hakase-os/0.1 (+https://hakase.ai)"}

#: Checked by hand: why Crossref's year differs from the cited one. Pinned to what Crossref
#: says now, so any further change to the record fails the test and is checked again.
EXPLAINED_YEARS = {
    # OECD re-deposited both records on 2025-06-25. The DOIs still serve the editions cited:
    # the PDF linked from each publication page is filed under reports/2008/10 (TG 407) and
    # reports/2018/06 (TG 408). Checked 2026-10-11.
    "oecd_tg407": {2025},
    "oecd_tg408": {2025},
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if c.isalnum() and not unicodedata.combining(c)).casefold()


@pytest.fixture(scope="module")
def http():
    with httpx.Client(headers=UA, timeout=30, follow_redirects=True) as c:
        yield c


@pytest.mark.parametrize("key", [k for k, c in CITATIONS.items() if c.doi])
def test_doi_resolves_to_the_cited_work(http, key):
    cite = CITATIONS[key]
    r = http.get(f"https://api.crossref.org/works/{cite.doi}")
    assert r.status_code == 200, f"{key}: {cite.doi} not on Crossref ({r.status_code})"
    m = r.json()["message"]
    years = {
        (m.get(f) or {}).get("date-parts", [[None]])[0][0]
        for f in ("issued", "published-print", "published-online", "published")
    } - {None}
    if key in EXPLAINED_YEARS:
        assert years == EXPLAINED_YEARS[key], f"{key}: Crossref years changed to {years}"
    else:
        assert cite.year in years, f"{key}: cited {cite.year}, Crossref {sorted(years)}"
    people = [a for a in m.get("author", []) if a.get("family") or a.get("name")]
    if people:
        first = _norm(people[0].get("family") or people[0]["name"])
        cited = _norm(cite.text.split()[0])
        assert cited in first or first in cited, f"{key}: first author {first!r} vs {cited!r}"
    else:
        title = _norm((m.get("title") or [""])[0])[:40]
        assert title and title in _norm(cite.text), f"{key}: title not in the citation"


@pytest.mark.parametrize("key", [k for k, c in CITATIONS.items() if c.url])
def test_url_resolves(http, key):
    r = http.get(CITATIONS[key].url)
    assert r.status_code == 200, f"{key}: {CITATIONS[key].url} answered {r.status_code}"
