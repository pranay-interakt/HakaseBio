"""The end-to-end demo script runs to completion and the integrity rules fire."""

import subprocess
import sys
from pathlib import Path


def test_demo_runs_end_to_end(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "demo.py"
    r = subprocess.run([sys.executable, str(script), "--out", str(tmp_path)],
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr
    assert "approval refused, as designed" in r.stdout
    assert "simulated_only" in r.stdout and "hash chain verified" in r.stdout
    assert (tmp_path / "module4.zip").exists()
    reports = list(tmp_path.glob("*_report.md"))
    assert len(reports) == 3
    assert all("THIS REPORT CONTAINS SIMULATED DATA" in p.read_text() for p in reports)
