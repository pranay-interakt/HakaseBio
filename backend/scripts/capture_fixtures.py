"""Record live ChEMBL/PubChem responses as test fixtures (run with network access).

    python scripts/capture_fixtures.py

Requests are made by the real clients through a recording transport, so the fixtures are
exactly the URLs the clients build."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hos.core.provenance import utc_now
from hos.data_sources import CachedHttp, ChEMBLClient, PubChemClient
from hos.data_sources.http import USER_AGENT
from hos.triage.herg import HergParams, screen_herg
from hos.triage.readacross import ReadAcrossParams
from tests.fixtures.transport import fixture_path

#: Dofetilide's canonical SMILES exactly as ChEMBL serves it for CHEMBL473.
DOFETILIDE_SMILES = "CN(CCOc1ccc(NS(C)(=O)=O)cc1)CCc1ccc(NS(C)(=O)=O)cc1"
#: Paracetamol's canonical SMILES as ChEMBL serves it for CHEMBL112.
PARACETAMOL_SMILES = "CC(=O)Nc1ccc(O)cc1"
#: The neighbourhood tests/triage/test_herg.py asserts against.
TRIAGE_PARAMS = HergParams(
    read_across=ReadAcrossParams(min_similarity=0.5, max_analogues=5, min_analogues=3),
    candidate_limit=100,
    max_lookups=60,
)


class Recording(httpx.BaseTransport):
    def __init__(self) -> None:
        self.inner = httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        r = self.inner.handle_request(request)
        body = r.read()
        p = fixture_path(str(request.url))
        p.parent.mkdir(parents=True, exist_ok=True)
        text = body.decode()
        p.write_text(
            json.dumps(
                {
                    "url": str(request.url),
                    "captured_at": utc_now().isoformat(),
                    "status_code": r.status_code,
                    "body": text,
                    "body_sha256": hashlib.sha256(text.encode()).hexdigest(),
                },
                indent=1,
            )
        )
        print(r.status_code, request.url)
        headers = {
            k: v
            for k, v in r.headers.items()
            if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")
        }
        return httpx.Response(r.status_code, content=body, headers=headers)


def main() -> None:
    http = CachedHttp(
        client=httpx.Client(transport=Recording(), headers={"User-Agent": USER_AGENT}, timeout=60)
    )
    pc, ch = PubChemClient(http), ChEMBLClient(http)
    pc.compound_by_inchikey("BSYNRYMUTXBXSQ-UHFFFAOYSA-N")  # aspirin
    pc.compound_by_inchikey("AAAAAAAAAAAAAA-UHFFFAOYSA-N")  # unknown key
    ch.molecule_by_inchikey("BSYNRYMUTXBXSQ-UHFFFAOYSA-N")  # aspirin -> CHEMBL25
    ch.molecule_by_inchikey("AAAAAAAAAAAAAA-UHFFFAOYSA-N")  # unknown key
    ch.molecule_by_inchikey("IXTMWRCNAAVVAI-UHFFFAOYSA-N")  # dofetilide -> CHEMBL473
    ch.herg_ic50("CHEMBL473")  # dofetilide hERG IC50s
    ch.herg_ic50("CHEMBL113")  # caffeine: censored + missing
    ch.herg_ic50("CHEMBL25")  # aspirin (enrichment test)

    # in silico triage, under the neighbourhood tests/triage/test_herg.py asserts against:
    # dofetilide, whose own hERG IC50 is measured and published many times over
    screen_herg(DOFETILIDE_SMILES, ch, TRIAGE_PARAMS, inchikey="IXTMWRCNAAVVAI-UHFFFAOYSA-N")
    # paracetamol: no measured hERG value and no measured analogue near enough, so the
    # screen abstains rather than estimating
    screen_herg(PARACETAMOL_SMILES, ch, TRIAGE_PARAMS, inchikey="RZVAJINKPMORJF-UHFFFAOYSA-N")


if __name__ == "__main__":
    main()
