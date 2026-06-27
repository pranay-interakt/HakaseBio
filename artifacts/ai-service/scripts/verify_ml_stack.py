#!/usr/bin/env python3
"""Preflight: is the ADMET-AI ML stack installed, loaded, and SERVING ML?

Run this against a RUNNING ai-service (not in CI) before letting a client touch
the app. It is the definitive check for "are the weights installed and is the
service refusing heuristic fallback". Pure stdlib — no ADMET-AI needed to run the
checker itself.

  python3 scripts/verify_ml_stack.py                       # default localhost:8090
  AI_SERVICE_URL=http://host:8090 python3 scripts/verify_ml_stack.py
  python3 scripts/verify_ml_stack.py --url http://host:8090

Exit code 0 only when ADMET-AI is loaded AND a real prediction returns ml.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O"
KEY_ENDPOINTS = ["hERG", "DILI", "AMES", "Caco2_Wang", "CYP3A4_Veith"]


def _get(url: str, timeout: float = 30.0):
    with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def _post(url: str, body: dict, timeout: float = 120.0):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("AI_SERVICE_URL", "http://localhost:8090"))
    args = ap.parse_args()
    base = args.url.rstrip("/")
    ok = True

    def line(good, label, detail=""):
        nonlocal ok
        ok = ok and good
        print(("  ✅ " if good else "  ❌ ") + label + (f" — {detail}" if detail else ""))

    print(f"Verifying ADMET-AI ML stack at {base}\n" + "=" * 60)

    # 1) service reachable
    try:
        _, h = _get(f"{base}/health")
        line(h.get("status") == "ok", "ai-service reachable (/health)", h.get("service", ""))
    except Exception as e:  # noqa: BLE001
        line(False, "ai-service reachable (/health)", f"{type(e).__name__}: {e}")
        print("\n→ Service is down. Start it (STRICT_ML=1) before continuing.")
        return 1

    # 2) model load status
    try:
        _, st = _get(f"{base}/models/status")
        a = st.get("admet_ml", {})
        line(a.get("installed") is True, "admet_ai package installed", "" if a.get("installed") else "pip install admet_ai")
        line(bool(a.get("strict_ml")), "STRICT_ML=1 (refuses heuristic fallback)",
             "" if a.get("strict_ml") else "set STRICT_ML=1 so the service fails loud, not silent")
        line(a.get("loaded") is True, "ADMET-AI weights LOADED", a.get("error") or f"load_time={a.get('load_time_s')}s")
        for k in ("cardiotox", "dili_ml"):
            line((st.get(k) or {}).get("loaded") is True, f"{k} loaded", (st.get(k) or {}).get("error") or "")
    except Exception as e:  # noqa: BLE001
        line(False, "models/status readable", f"{type(e).__name__}: {e}")

    # 3) real prediction must be ml (not fallback)
    try:
        _, p = _post(f"{base}/predict/admet-ml", {"smiles": ASPIRIN})
        line(p.get("ml_available") is True, "live prediction ml_available=true")
        line(p.get("source") == "ml", "live prediction source='ml' (NOT 'fallback')", p.get("source", ""))
        eps = p.get("endpoints") or {}
        present = [k for k in KEY_ENDPOINTS if isinstance(eps.get(k), (int, float))]
        line(len(present) == len(KEY_ENDPOINTS), f"key endpoints returned ({len(present)}/{len(KEY_ENDPOINTS)})",
             ", ".join(present))
    except Exception as e:  # noqa: BLE001
        line(False, "live ADMET-AI prediction", f"{type(e).__name__}: {e}")

    print("=" * 60)
    if ok:
        print("✅ PASS — ADMET-AI is installed, loaded, and serving real ML. "
              "Verdicts will be calibrated, not INSUFFICIENT-EVIDENCE.")
        return 0
    print("❌ FAIL — the ML stack is NOT fully serving. With STRICT_ML=1 the service "
          "should refuse to start in this state; if it started, STRICT_ML is OFF and "
          "the app may be silently degraded. Fix: `pip install admet_ai`, set "
          "`STRICT_ML=1`, restart, then `curl -XPOST {base}/models/warmup`.".replace("{base}", base))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
