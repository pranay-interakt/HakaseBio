"""Create the dev/demo principals from scripts/dev_principals.example.json on a running API.

    python scripts/seed_dev.py [http://127.0.0.1:8000]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000") + "/api"
seed = json.loads((Path(__file__).parent / "dev_principals.example.json").read_text())["principals"]
admin = seed[0]
c = httpx.Client(timeout=30)
if not c.get(f"{base}/health").json()["initialised"]:
    c.post(f"{base}/setup", json={k: admin[k] for k in ("principal_id", "name", "password")}).raise_for_status()
tok = c.post(f"{base}/auth/login", json={"principal_id": admin["principal_id"],
                                         "password": admin["password"]}).json()["token"]
h = {"Authorization": f"Bearer {tok}"}
existing = {p["id"] for p in c.get(f"{base}/principals", headers=h).json()}
for p in seed[1:]:
    if p["principal_id"] not in existing:
        c.post(f"{base}/principals", headers=h, json=p).raise_for_status()
print("principals:", sorted(existing | {p["principal_id"] for p in seed}))
