"""Verification bundle and offline verifier (docs/14 P9): a genuine bundle verifies; every
kind of tampering is detected, even when the attacker also rewrites the file manifest."""

import hashlib
import io
import json
import zipfile

import pytest

from hos.ind import assemble_module4
from hos.kernel.attestation import Role, SignatureMeaning
from hos.verify import verify_bundle
from hos.verify.cli import main as hos_verify
from tests.drivers.test_repeat_dose_tox import PARAMS as RD_PARAMS
from tests.ind.test_ind import _approved_metstab, _program
from tests.kernel.test_glp_flow import _lab_file
from tests.kernel.test_imports import REPORT
from tests.kernel.test_kernel import k  # noqa: F401  (fixture)


@pytest.fixture()
def bundle(k):  # noqa: F811
    sci, pid, cid = _program(k)
    sd, qa = k.get_principal("sd"), k.get_principal("qa")
    _approved_metstab(k, sci, pid, cid)
    rd = k.create_study(sci, program_id=pid, compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD_PARAMS)
    k.plan_study(sci, rd)
    k.dispatch_study(sci, rd, {"kind": "external_lab", "laboratory": "GLP CRO"})
    k.receive_data(sci, rd, _lab_file(rd))
    k.analyze_study(sci, rd)
    k.record_determination(sd, rd, key="noael", value=30, unit="mg/kg/day",
                           rationale="adverse liver findings at 100 mg/kg/day")
    k.report_study(sci, rd)
    k.sign_study(sd, rd, role=Role.STUDY_DIRECTOR, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    k.sign_study(qa, rd, role=Role.QUALITY_ASSURANCE, meaning=SignatureMeaning.QA_COMPLIANCE,
                 statement="QA statement")
    k.approve_study(sd, rd)
    imp = k.imports.import_study(sci, program_id=pid, compound_id=cid,
                                 requirement_id="genotox.ames", report=REPORT,
                                 filename="ames.pdf", title="Ames", laboratory="Lab",
                                 report_date="2026-05-01", glp=False)["id"]
    k.imports.add_import_value(sci, imp, key="overall_call", page="5", category="negative")
    k.imports.sign_import(sci, imp, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="")
    k.imports.complete_import(sci, imp)
    pkg = assemble_module4(k, sci, pid)
    return k.files.get(pkg["bundle_sha256"]), pkg


def _rewrite(content: bytes, edits: dict, fix_manifest: bool = True) -> bytes:
    """Return a copy of the bundle with files replaced; optionally forge the file manifest."""
    src = zipfile.ZipFile(io.BytesIO(content))
    files = {n: src.read(n) for n in src.namelist()}
    for name, fn in edits.items():
        files[name] = fn(files[name])
    if fix_manifest:
        man = json.loads(files["m4/MANIFEST.json"])
        for n in man:
            man[n] = hashlib.sha256(files[n]).hexdigest()
        files["m4/MANIFEST.json"] = json.dumps(man).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n, b in files.items():
            z.writestr(n, b)
    return out.getvalue()


def _failed(rep):
    return [c for c in rep.checks if c.status == "fail"]


def test_genuine_bundle_verifies(bundle):
    content, pkg = bundle
    rep = verify_bundle(content)
    assert rep.passed, rep.summary()
    checks = {c.check for c in rep.checks}
    assert "analysis recomputes to the recorded hash" in checks
    assert "report regenerates to the recorded hash" in checks
    assert "import content hash recomputes" in checks
    assert pkg["verification"]["ledger_head"] == rep.manifest["ledger"]["head"]
    # 2 driver-run studies recomputed, 1 import checked
    assert len(rep.manifest["studies"]) == 2 and len(rep.manifest["imports"]) == 1


def test_altered_raw_data_is_detected_even_with_forged_manifest(bundle):
    content, _ = bundle
    vm = json.loads(zipfile.ZipFile(io.BytesIO(content)).read("verification/manifest.json"))
    sid = vm["studies"][0]
    s = json.loads(zipfile.ZipFile(io.BytesIO(content)).read(f"verification/studies/{sid}.json"))
    raw = f"verification/raw/{s['data_file']['sha256']}"
    bad = _rewrite(content, {raw: lambda b: b.replace(b",yes", b",no", 1)
                             if b",yes" in b else b[:-2] + b"9\n"})
    names = {c.check for c in _failed(verify_bundle(bad))}
    assert "raw data file hash" in names or "recomputation" in names


def test_edited_file_without_manifest_is_detected(bundle):
    content, _ = bundle
    bad = _rewrite(content, {"m4/index.md": lambda b: b + b"tampered\n"}, fix_manifest=False)
    assert any("file hashes match" in c.check for c in _failed(verify_bundle(bad)))


def _forge_chain(content: bytes, pick, edit) -> bytes:
    def forge(b: bytes) -> bytes:
        lines = b.splitlines()
        i = next(n for n, line in enumerate(lines) if pick(json.loads(line)))
        e = json.loads(lines[i])
        edit(e)
        lines[i] = json.dumps(e).encode()
        return b"\n".join(lines) + b"\n"
    return _rewrite(content, {"verification/ledger/chain.jsonl": forge})


def test_rewritten_ledger_is_detected(bundle):
    content, _ = bundle
    bad = _forge_chain(content, lambda e: "redacted" not in e and e["seq"] > 1,
                       lambda e: e.update(actor_id="someone-else"))
    assert any(c.subject == "ledger" for c in _failed(verify_bundle(bad)))


def test_other_programmes_are_redacted_but_still_bind_the_chain(bundle, k):  # noqa: F811
    content, _ = bundle
    z = zipfile.ZipFile(io.BytesIO(content))
    chain = [json.loads(line) for line in z.read("verification/ledger/chain.jsonl").splitlines()]
    hidden = [e for e in chain if e.get("redacted")]
    assert hidden and all(set(e) == {"seq", "scheme", "redacted", "prev_hash",
                                     "content_digest", "entry_hash"} for e in hidden)
    text = z.read("verification/ledger/chain.jsonl").decode()
    assert "principal.registered" not in text            # users' records are not shown
    rep = verify_bundle(content)
    assert any("redacted" in c.check for c in rep.checks if c.subject == "ledger")
    forged = _forge_chain(content, lambda e: e.get("redacted"),
                          lambda e: e.update(content_digest="0" * 64))
    assert any(c.subject == "ledger" for c in _failed(verify_bundle(forged)))
    padded = _forge_chain(content, lambda e: e.get("redacted"),
                          lambda e: e.update(actor_id="x"))
    assert any(c.subject == "ledger" for c in _failed(verify_bundle(padded)))


def test_forged_signature_and_report_hash_are_detected(bundle):
    content, _ = bundle
    z = zipfile.ZipFile(io.BytesIO(content))
    vm = json.loads(z.read("verification/manifest.json"))
    sid = next(i for i in vm["studies"]
               if json.loads(z.read(f"verification/studies/{i}.json"))["glp"])
    path = f"verification/studies/{sid}.json"

    def drop_qa(b: bytes) -> bytes:
        s = json.loads(b)
        s["signatures"] = [g for g in s["signatures"] if g["role"] != "quality_assurance"]
        return json.dumps(s).encode()

    def change_report_hash(b: bytes) -> bytes:
        s = json.loads(b)
        s["expected"]["report_hash"] = "0" * 64
        return json.dumps(s).encode()
    assert any("signatures bind the report" in c.check
               for c in _failed(verify_bundle(_rewrite(content, {path: drop_qa}))))
    assert any("report regenerates" in c.check
               for c in _failed(verify_bundle(_rewrite(content, {path: change_report_hash}))))


def test_tampered_import_value_is_detected(bundle):
    content, _ = bundle
    vm = json.loads(zipfile.ZipFile(io.BytesIO(content)).read("verification/manifest.json"))
    path = f"verification/imports/{vm['imports'][0]}.json"

    def flip(b: bytes) -> bytes:
        s = json.loads(b)
        s["import_record"]["values"][0]["category"] = "positive"
        return json.dumps(s).encode()
    assert any("import content hash" in c.check
               for c in _failed(verify_bundle(_rewrite(content, {path: flip}))))


def test_cli_exit_codes(bundle, tmp_path, capsys):
    content, _ = bundle
    good, bad = tmp_path / "good.zip", tmp_path / "bad.zip"
    good.write_bytes(content)
    bad.write_bytes(_rewrite(content, {"m4/index.md": lambda b: b + b"x"}, fix_manifest=False))
    assert hos_verify([str(good)]) == 0
    assert "VERIFIED" in capsys.readouterr().out
    assert hos_verify([str(bad), "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["passed"] is False


def test_not_a_bundle():
    assert not verify_bundle(b"not a zip").passed
