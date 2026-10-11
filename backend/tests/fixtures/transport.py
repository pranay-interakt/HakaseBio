"""Replay of HTTP responses recorded from the live APIs (see scripts/capture_fixtures.py).

Each fixture file records the request URL, capture time, HTTP status, body and the body's
SHA-256, which is re-checked on load so a hand-edited fixture fails loudly."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import httpx

FIXTURE_DIR = Path(__file__).parent / "http"


def fixture_path(url: str) -> Path:
    return FIXTURE_DIR / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".json")


def replay_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        p = fixture_path(str(request.url))
        if not p.exists():
            raise AssertionError(f"no recorded fixture for {request.url}")
        f = json.loads(p.read_text())
        body = f["body"].encode()
        if hashlib.sha256(body).hexdigest() != f["body_sha256"]:
            raise AssertionError(f"fixture {p.name} was modified after capture")
        return httpx.Response(
            f["status_code"], content=body, headers={"content-type": "application/json"}
        )

    return httpx.MockTransport(handler)
