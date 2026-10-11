"""Smoke-test a fresh deployment through its web entry point (docs/15 P2.3).

    HOS_BOOTSTRAP_TOKEN=... python scripts/smoke.py http://localhost:8080
    HOS_BOOTSTRAP_TOKEN=... python scripts/smoke.py http://localhost:8000 --api-only

Only for a deployment with no users yet: it creates the first administrator and a scientist
(random passwords, never printed), a programme and a compound, then checks the ledger. Standard
library only, so it runs anywhere Python does.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from typing import Any

CTX = {
    "modality": "small_molecule",
    "indication": "chronic_non_oncology",
    "route": "oral",
    "intended_clinical_duration_days": 365,
    "max_trial_duration_days": 28,
}


def call(
    base: str, method: str, path: str, body: Any = None, token: str | None = None
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(
        base + path, method=method, data=None if body is None else json.dumps(body).encode()
    )
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)


def main(base: str, web: bool = True) -> None:
    base = base.rstrip("/")
    st, _, _ = call(base, "GET", "/api/health")
    check(st == 200, "liveness")
    st, _, b = call(base, "GET", "/api/ready")
    check(st == 200 and json.loads(b)["ready"], f"readiness {b.decode()}")
    if web:
        st, h, b = call(base, "GET", "/")
        headers = {k.lower(): v for k, v in h.items()}
        check(st == 200 and b'id="root"' in b, "web app served")
        check(
            "frame-ancestors 'none'" in headers.get("content-security-policy", ""),
            "security headers",
        )
    st, _, b = call(base, "GET", "/openapi.json")
    check(b'"openapi"' not in b, "API schema not published")
    st, _, b = call(base, "GET", "/api/setup")
    check(st == 200 and json.loads(b) == {"initialised": False}, "fresh deployment")

    admin_pw, sci_pw = secrets.token_urlsafe(18), secrets.token_urlsafe(18)
    st, _, _ = call(
        base,
        "POST",
        "/api/setup",
        {
            "principal_id": "admin",
            "name": "Administrator",
            "password": admin_pw,
            "setup_token": os.environ["HOS_BOOTSTRAP_TOKEN"],
        },
    )
    check(st == 200, "first administrator created with the setup token")
    st, _, b = call(
        base, "POST", "/api/auth/login", {"principal_id": "admin", "password": admin_pw}
    )
    check(st == 200, "administrator signs in")
    adm = json.loads(b)["token"]
    st, _, _ = call(
        base,
        "POST",
        "/api/principals",
        {
            "principal_id": "smoke-sci",
            "name": "Smoke Scientist",
            "kind": "human",
            "roles": ["scientist"],
            "password": sci_pw,
        },
        adm,
    )
    check(st == 200, "scientist added")
    st, _, b = call(
        base, "POST", "/api/auth/login", {"principal_id": "smoke-sci", "password": sci_pw}
    )
    sci = json.loads(b)["token"]
    st, _, b = call(base, "POST", "/api/programs", {"name": "Smoke test", "context": CTX}, sci)
    check(st == 200, "programme created")
    prog = json.loads(b)["id"]
    st, _, b = call(
        base, "POST", f"/api/programs/{prog}/compounds", {"name": "ethanol", "smiles": "CCO"}, sci
    )
    mw = json.loads(b)["profile"]["descriptors"]["molecular_weight"] if st == 200 else {}
    check(
        abs(mw.get("value", 0) - 46.069) < 0.01
        and mw.get("provenance", {}).get("kind") == "computed",
        "compound registered; ethanol MW 46.07 g/mol, computed by RDKit",
    )
    st, _, b = call(base, "GET", "/api/ledger/verify", token=adm)
    report = json.loads(b)
    check(
        st == 200 and report["valid"] and report["anchors"] > 0,
        f"ledger valid, reconciled and anchored ({report['entries']} entries)",
    )
    print("SMOKE TEST PASSED")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else "http://localhost:8080", web="--api-only" not in sys.argv)
