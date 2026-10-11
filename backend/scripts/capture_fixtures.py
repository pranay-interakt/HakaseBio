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
from tests.fixtures.transport import fixture_path


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


if __name__ == "__main__":
    main()
