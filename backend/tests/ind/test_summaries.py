"""CTD Module 2 nonclinical summaries (docs/14 P6): drafted from approved and imported studies
in the ICH M4S(R2) structure, every number sourced, interpretation left to a named author who
signs a fixed version."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from hos.api import create_app
from hos.ind.summaries import SECTIONS, TABLES, build_summaries
from hos.kernel.attestation import PrincipalKind, Role, SignatureMeaning
from hos.kernel.errors import KernelError, PermissionDenied
from tests.api.test_api import PW, SETUP, _login
from tests.drivers.test_repeat_dose_tox import PARAMS as RD
from tests.kernel.test_glp_flow import _lab_file
from tests.kernel.test_imports import REPORT
from tests.kernel.test_kernel import CTX, FU, HL, PARAMS, _measured_csv, k  # noqa: F401


def _programme(k):  # noqa: F811
    """An approved metabolic stability study, an approved GLP repeat-dose study with a signed
    NOAEL, a completed Ames import, and one study that is only analysed."""
    sci, sd, qa = (k.get_principal(x) for x in ("sci", "sd", "qa"))
    prog = k.create_program(sci, name="M2", context=CTX)["id"]
    cid = k.register_compound(sci, prog, name="paracetamol", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    ms = k.create_study(
        sci, program_id=prog, compound_id=cid, requirement_id="adme.metabolic_stability"
    )["id"]
    k.design_study(sci, ms, PARAMS)
    k.plan_study(sci, ms)
    k.dispatch_study(sci, ms, {"kind": "external_lab", "laboratory": "ADME CRO"})
    k.receive_data(sci, ms, _measured_csv(HL, ref=ms))
    k.set_analysis_inputs(sci, ms, FU)
    k.analyze_study(sci, ms)
    k.report_study(sci, ms)
    k.sign_study(
        sci,
        ms,
        role=Role.RESPONSIBLE_SCIENTIST,
        meaning=SignatureMeaning.APPROVAL,
        statement="approve",
    )
    k.approve_study(sci, ms)

    rd = k.create_study(
        sci, program_id=prog, compound_id=cid, requirement_id="tox.repeat_dose_rodent"
    )["id"]
    k.design_study(sci, rd, RD)
    k.plan_study(sci, rd)
    k.dispatch_study(
        sci, rd, {"kind": "external_lab", "laboratory": "GLP CRO", "glp_certified": True}
    )
    k.receive_data(sci, rd, _lab_file(rd))
    k.analyze_study(sci, rd)
    k.record_determination(
        sd,
        rd,
        key="noael",
        value=30,
        unit="mg/kg/day",
        rationale="liver findings at 100 mg/kg/day judged adverse",
    )
    k.report_study(sci, rd)
    k.sign_study(
        sd,
        rd,
        role=Role.STUDY_DIRECTOR,
        meaning=SignatureMeaning.APPROVAL,
        statement="I approve this report.",
    )
    k.sign_study(
        qa,
        rd,
        role=Role.QUALITY_ASSURANCE,
        meaning=SignatureMeaning.QA_COMPLIANCE,
        statement="QA statement.",
    )
    k.approve_study(sd, rd)

    imp = k.imports.import_study(
        sci,
        program_id=prog,
        compound_id=cid,
        requirement_id="genotox.ames",
        report=REPORT,
        filename="ames.pdf",
        title="Ames assay",
        laboratory="Geno Lab",
        report_date="2026-05-01",
        glp=False,
    )["id"]
    k.imports.add_import_value(sci, imp, key="overall_call", page="5", category="negative")
    k.imports.sign_import(
        sci, imp, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL, statement=""
    )
    k.imports.complete_import(sci, imp)

    open_ = k.create_study(
        sci, program_id=prog, compound_id=cid, requirement_id="adme.metabolic_stability"
    )["id"]
    return {"prog": prog, "ms": ms, "rd": rd, "imp": imp, "open": open_}


def _cells(obj):
    """Every value cell anywhere in the content."""
    if isinstance(obj, dict):
        if (
            ("quantity" in obj and "source" in obj)
            or isinstance(obj.get("determination"), dict)
            or isinstance(obj.get("imported"), dict)
        ):
            yield obj
        for v in obj.values():
            yield from _cells(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _cells(v)


def test_the_summaries_follow_m4s_and_use_only_admissible_studies(k):  # noqa: F811
    w = _programme(k)
    c = build_summaries(k, w["prog"])
    assert [s["id"] for s in c["sections"]] == [s[0] for s in SECTIONS]
    assert {s["study_id"] for s in c["studies"]} == {w["ms"], w["rd"], w["imp"]}
    assert {e["study_id"]: e["reason"] for e in c["excluded"]} == {w["open"]: "not approved"}
    numbers = {t["number"] for t in c["tables"]}
    assert {"2.6.5.1", "2.6.5.10", "2.6.7.1", "2.6.7.7", "2.6.7.8"} <= numbers
    assert numbers <= set(TABLES)
    tox = next(t for t in c["tables"] if t["number"] == "2.6.7.1")
    assert len(tox["rows"]) == 2  # the repeat-dose study and the Ames import
    assert build_summaries(k, w["prog"]) == c  # deterministic


def test_every_number_is_sourced(k):  # noqa: F811
    w = _programme(k)
    c = build_summaries(k, w["prog"])
    cells = list(_cells(c))
    assert cells
    for cell in cells:
        sid = cell["source"]["study_id"]
        row = k.repo.study(sid)
        if "quantity" in cell:
            assert cell["quantity"] == row.results["quantities"][cell["source"]["key"]]
            assert cell["quantity"]["provenance"]["kind"] in ("computed", "measured", "unavailable")
        elif "imported" in cell:
            assert cell["source"]["page"] == "5"
        else:
            det = cell["determination"]
            assert det["key"] in {d["key"] for d in row.determinations}
    noael = [c_ for c_ in cells if "determination" in c_ and c_["determination"]["key"] == "noael"]
    assert noael and noael[0]["determination"]["role"] == "study_director"
    # the drafted text cites "(Table X.X, Study/Report Number)" as M4S(R2) asks
    rd_text = json.dumps(next(s for s in c["sections"] if s["id"] == "2.6.6.3"))
    assert f"(Table 2.6.7.7, Study {w['rd']})" in rd_text


def test_a_named_author_writes_the_interpretation_and_signs(k):  # noqa: F811
    w = _programme(k)
    sci = k.get_principal("sci")
    v1 = k.summaries.draft(sci, w["prog"])
    assert v1["version"] == 1 and v1["status"] == "draft"
    required = [s["id"] for s in v1["content"]["sections"] if s["author_required"]]
    assert "2.4.integrated" in required and "2.6.6.9" in required
    with pytest.raises(KernelError, match="still missing"):
        k.summaries.sign(
            sci,
            w["prog"],
            1,
            role=Role.RESPONSIBLE_SCIENTIST,
            meaning=SignatureMeaning.AUTHORSHIP,
            statement="I am the author.",
        )
    version = 1
    for sid in required:
        version = k.summaries.revise(sci, w["prog"], version, sid, f"Author text for {sid}.")[
            "version"
        ]
    with pytest.raises(KernelError, match="latest"):
        k.summaries.revise(sci, w["prog"], 1, required[0], "stale")
    # a new draft from the studies keeps the author's text
    redraft = k.summaries.draft(sci, w["prog"], reason="studies refreshed")
    assert redraft["missing_author_sections"] == []
    signed = k.summaries.sign(
        sci,
        w["prog"],
        redraft["version"],
        role=Role.RESPONSIBLE_SCIENTIST,
        meaning=SignatureMeaning.AUTHORSHIP,
        statement="I wrote and approve these summaries.",
    )
    assert signed["status"] == "signed" and signed["signatures"][0]["signer_id"] == "sci"
    with pytest.raises(KernelError, match="signed version"):
        k.summaries.revise(sci, w["prog"], signed["version"], required[0], "late edit")
    assert k.integrity()["valid"]
    actions = [e["action"] for e in k.history(w["prog"])]
    assert actions.count("program.summary_signed") == 1
    assert actions.count("program.summary_drafted") == 2


def test_an_agent_drafts_but_never_signs(k):  # noqa: F811
    w = _programme(k)
    adm = k.get_principal("admin")
    bot = k.register_principal(
        adm,
        principal_id="bot",
        name="Drafting agent",
        kind=PrincipalKind.AGENT,
        roles=[Role.SCIENTIST],
    )
    v = k.summaries.draft(bot, w["prog"])
    assert v["created_by"] == "bot"
    with pytest.raises(PermissionDenied):
        k.summaries.sign(
            bot,
            w["prog"],
            v["version"],
            role=Role.RESPONSIBLE_SCIENTIST,
            meaning=SignatureMeaning.APPROVAL,
            statement="x",
        )
    sd = k.get_principal("sd")
    with pytest.raises(PermissionDenied, match="Responsible Scientist or Programme Lead"):
        k.summaries.sign(
            sd,
            w["prog"],
            v["version"],
            role=Role.STUDY_DIRECTOR,
            meaning=SignatureMeaning.APPROVAL,
            statement="x",
        )


def test_an_edited_document_is_detected(k):  # noqa: F811
    w = _programme(k)
    sci = k.get_principal("sci")
    k.summaries.draft(sci, w["prog"])
    with k.db.session() as s:
        row = s.execute(text("SELECT id, content FROM program_documents")).one()
        content = json.loads(row.content) if isinstance(row.content, str) else row.content
        content["sections"][0]["author_text"] = "inserted afterwards"
        s.execute(
            text("UPDATE program_documents SET content=:c WHERE id=:i"),
            {"c": json.dumps(content), "i": row.id},
        )
    checks = {f["check"] for f in k.integrity()["findings"]}
    assert "document matches its event and recomputes" in checks


def test_markdown_follows_the_guideline_order(k):  # noqa: F811
    w = _programme(k)
    v = k.summaries.draft(k.get_principal("sci"), w["prog"])
    md = k.summaries.markdown(w["prog"], v["version"])
    order = [
        "2.4 Nonclinical Overview",
        "2.6.1 Introduction",
        "2.6.2 Pharmacology Written",
        "2.6.3 Pharmacology Tabulated",
        "2.6.4 Pharmacokinetics Written",
        "2.6.5 Pharmacokinetics Tabulated",
        "2.6.6 Toxicology Written",
        "2.6.7 Toxicology Tabulated",
    ]
    positions = [md.index(h) for h in order]
    assert positions == sorted(positions)
    assert "Table 2.6.7.7" in md and "*Author's text not yet written.*" in md
    assert "(signed, Dana Director)" in md


def test_the_api(tmp_path):
    from hos.db.store import Database, FileStore
    from hos.kernel.kernel import Kernel

    kern = Kernel(
        db=Database(f"sqlite:///{tmp_path / 'm2.sqlite3'}"), files=FileStore(tmp_path / "objects")
    )
    c = TestClient(create_app(kern, bootstrap_token=SETUP))
    c.post(
        "/api/setup",
        json={"principal_id": "admin", "name": "Ada Admin", "password": PW, "setup_token": SETUP},
    )
    adm = _login(c, "admin")
    for pid, roles in (
        ("sci", ["scientist", "responsible_scientist"]),
        ("sd", ["study_director"]),
        ("qa", ["quality_assurance"]),
    ):
        c.post(
            "/api/principals",
            headers=adm,
            json={
                "principal_id": pid,
                "name": pid.upper(),
                "kind": "human",
                "roles": roles,
                "password": PW,
            },
        )
    w = _programme(kern)
    sci = _login(c, "sci")
    base = f"/api/programs/{w['prog']}/summaries"
    assert c.get(base, headers=sci).json() == {"versions": [], "latest": None}
    v = c.post(base, headers=sci, json={}).json()
    for s in v["content"]["sections"]:
        if s["author_required"]:
            v = c.put(
                f"{base}/{v['version']}/sections/{s['id']}",
                headers=sci,
                json={"text": "Written by the author."},
            ).json()
    r = c.post(
        f"{base}/{v['version']}/sign",
        headers=sci,
        json={
            "role": "responsible_scientist",
            "meaning": "authorship",
            "statement": "Mine.",
            "password": "wrong password!",
        },
    )
    assert r.status_code == 403
    r = c.post(
        f"{base}/{v['version']}/sign",
        headers=sci,
        json={
            "role": "responsible_scientist",
            "meaning": "authorship",
            "statement": "Mine.",
            "password": PW,
        },
    )
    assert r.status_code == 200 and r.json()["status"] == "signed"
    md = c.get(f"{base}/{v['version']}/markdown", headers=sci)
    assert md.status_code == 200 and md.text.startswith("# Nonclinical overview and summaries")
    listing = c.get(base, headers=sci).json()
    assert [x["status"] for x in listing["versions"]][-1] == "signed"
