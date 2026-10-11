"""Sequence entities (docs/14 P4): peptides and antibodies registered by sequence or HELM,
with isotype, engineered mutations and surrogate links; studies on them verify offline."""

import pytest

from hos.core.regulatory import Indication, Modality, PeptideOrigin, ProgramContext, Route
from hos.ind import assemble_module4
from hos.kernel.attestation import Role, SignatureMeaning
from hos.kernel.errors import KernelError
from hos.verify import verify_bundle
from tests.api.test_api import CTX as API_CTX
from tests.api.test_api import PW as API_PW
from tests.api.test_api import _login, api  # noqa: F401 - fixture
from tests.drivers.test_peptide_stability import PARAMS as PS_PARAMS
from tests.drivers.test_peptide_stability import _file as ps_file
from tests.kernel.test_kernel import k  # noqa: F401 - fixture

GLP1 = "HAEGTFTSDVSSYLEGQAAKEFIAWLVKGRG"      # a 31-residue test sequence
# Truncated antibody-like test sequences (not real products).
HEAVY = "QVQLVQSGAEVKKPGASVKVSCKASGYTFTSYAMHWVRQAPGQRLEWMGWINAGNGNTKYSQKFQGRVTITRDTSASTAYMELSSLRSEDTAVYYCAR"
LIGHT = "DIQMTQSPSSLSASVGDRVTITCRASQSISSYLNWYQQKPGKAPKLLIYAASSLQSGVPSRFSGSGSGTDFTLTISSLQPEDFATYYCQQ"


def _ctx(modality, **kw):
    return ProgramContext(modality=modality, indication=Indication.CHRONIC_NON_ONCOLOGY,
                          route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365,
                          max_trial_duration_days=28, **kw)


def _prog(k, modality, **kw):  # noqa: F811
    sci = k.get_principal("sci")
    return sci, k.create_program(sci, name=f"P-{modality.value}", context=_ctx(modality, **kw))["id"]


def test_an_antibody_by_sequence(k):  # noqa: F811
    sci, pid = _prog(k, Modality.MONOCLONAL_ANTIBODY)
    heavy = HEAVY[:20] + "A" + HEAVY[21:]                  # engineered residue 21 -> A
    v = k.register_biologic(sci, pid, name="mAb-1", entity={
        "format": "sequence", "isotype": "IgG1", "light_chain_type": "kappa",
        "chains": [{"name": "heavy", "role": "heavy_chain", "sequence": heavy, "copies": 2},
                   {"name": "light", "role": "light_chain", "sequence": LIGHT, "copies": 2}],
        "engineered_mutations": [{"chain": "heavy", "position": 21, "from_residue": "S",
                                  "to_residue": "A", "purpose": "test substitution",
                                  "label": "S21A (sequential)"}]})
    d = v["entity"]["derived"]
    assert v["kind"] == "sequence" and v["smiles"] is None
    assert d["amino_acid_chains"] == [len(heavy)] * 2 + [len(LIGHT)] * 2
    assert d["classification"]["outcome"] == "protein"           # each chain is over 40
    h, l_ = (c["average_mass"]["value"] for c in d["chains"])
    assert d["total_mass"]["value"] == pytest.approx(2 * h + 2 * l_, rel=1e-12)
    info = k.compound_info(v["id"])
    assert info.smiles is None and info.molecular_weight.value == d["total_mass"]["value"]
    assert any(e["action"] == "compound.registered" and e["payload"]["kind"] == "sequence"
               for e in k.history(v["id"]))


def test_registration_rules(k):  # noqa: F811
    sci, pid = _prog(k, Modality.MONOCLONAL_ANTIBODY)
    base = {"format": "sequence", "chains": [{"name": "heavy", "role": "heavy_chain",
                                              "sequence": HEAVY, "copies": 2}]}
    with pytest.raises(KernelError, match="not the engineered A"):
        k.register_biologic(sci, pid, name="x", entity={**base, "engineered_mutations": [
            {"chain": "heavy", "position": 21, "from_residue": "S", "to_residue": "A",
             "purpose": "p"}]})
    with pytest.raises(KernelError, match="file convention"):
        k.register_biologic(sci, pid, name="x", entity={**base, "chains": [
            {"name": "h", "role": "heavy_chain", "sequence": "ACD*", "copies": 1}]})
    with pytest.raises(KernelError, match="needs a light chain"):
        k.register_biologic(sci, pid, name="x", entity={**base, "light_chain_type": "kappa"})
    first = k.register_biologic(sci, pid, name="mAb", entity=base)
    with pytest.raises(KernelError, match="already registered"):
        k.register_biologic(sci, pid, name="again", entity=base)
    with pytest.raises(KernelError, match="rationale"):
        k.register_biologic(sci, pid, name="sur", entity={
            "format": "sequence", "surrogate_for": first["id"],
            "chains": [{"name": "h", "role": "heavy_chain", "sequence": LIGHT, "copies": 2}]})
    sur = k.register_biologic(sci, pid, name="rat surrogate", entity={
        "format": "sequence", "surrogate_for": first["id"],
        "surrogate_rationale": "mAb does not bind the rat target",
        "chains": [{"name": "h", "role": "heavy_chain", "sequence": LIGHT, "copies": 2}]})
    assert sur["entity"]["spec"]["surrogate_for"] == first["id"]
    small = _prog(k, Modality.SMALL_MOLECULE)[1]
    with pytest.raises(KernelError, match="registers compounds by structure"):
        k.register_biologic(sci, small, name="x", entity=base)


def test_a_peptide_by_helm_needs_its_monomer_library(k):  # noqa: F811
    sci, pid = _prog(k, Modality.PEPTIDE, peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS)
    helm = "PEPTIDE1{H.[Aib].E.G.T.F.T.S.D}$$$$"
    with pytest.raises(KernelError, match="monomer library"):
        k.register_biologic(sci, pid, name="p", entity={"format": "helm", "helm": helm})
    with pytest.raises(KernelError, match="HELM"):
        k.register_biologic(sci, pid, name="p", entity={
            "format": "helm", "helm": "PEPTIDE1{HAEG}$$$$",
            "monomer_library": {"name": "HELMCoreLibrary", "version": "1", "sha256": "0" * 64}})
    v = k.register_biologic(sci, pid, name="p", entity={
        "format": "helm", "helm": helm,
        "monomer_library": {"name": "HELMCoreLibrary", "version": "1", "sha256": "a" * 64}})
    d = v["entity"]["derived"]
    assert "Aib" in d["helm"]["monomer_ids"] and not d["total_mass"]["available"]
    assert "monomer structures" in d["total_mass"]["provenance"]["reason"]
    assert k.compound_info(v["id"]).molecular_weight is None
    with pytest.raises(KernelError, match="antibody programmes"):
        k.register_biologic(sci, pid, name="q", entity={
            "format": "sequence", "isotype": "IgG1",
            "chains": [{"name": "p", "role": "peptide", "sequence": GLP1, "copies": 1}]})


def test_a_study_on_a_sequence_entity_verifies_offline(k):  # noqa: F811
    sci, pid = _prog(k, Modality.PEPTIDE, peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS)
    cid = k.register_biologic(sci, pid, name="pep-1", entity={
        "format": "sequence",
        "chains": [{"name": "peptide", "role": "peptide", "sequence": GLP1, "copies": 1}]})["id"]
    sid = k.create_study(sci, program_id=pid, compound_id=cid,
                         requirement_id="adme.metabolic_stability")["id"]
    assert k.study_view(sid)["driver_id"] == "peptide_stability"
    k.design_study(sci, sid, PS_PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "Peptide Lab"})
    k.receive_data(sci, sid, ps_file(ref=sid))
    k.analyze_study(sci, sid)
    k.report_study(sci, sid)
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    k.approve_study(sci, sid)
    pkg = assemble_module4(k, sci, pid)
    rep = verify_bundle(k.files.get(pkg["bundle_sha256"]))
    assert rep.passed, rep.summary()
    assert "analysis recomputes to the recorded hash" in {c.check for c in rep.checks}


def test_over_http(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")
    assert c.post("/api/principals", headers=adm, json={
        "principal_id": "sci", "name": "Sam Scientist", "kind": "human",
        "roles": ["scientist"], "password": API_PW}).status_code == 200
    h = _login(c, "sci")
    pid = c.post("/api/programs", headers=h, json={
        "name": "MAB-HTTP", "context": {**API_CTX, "modality": "monoclonal_antibody"}}).json()["id"]
    parsed = c.post("/api/sequence/fasta", headers=h,
                    json={"text": f">heavy\n{HEAVY}\n>light\n{LIGHT}\n"}).json()
    assert [r["residues"] for r in parsed["records"]] == [len(HEAVY), len(LIGHT)]
    assert c.post("/api/sequence/fasta", headers=h, json={"text": ">x\nAB*\n"}).json()["errors"]
    assert c.post("/api/sequence/helm", headers=h,
                  json={"text": "PEPTIDE1{A.C}$$$$"}).json()["structure"]["polymers"]
    assert c.post("/api/sequence/helm", headers=h, json={"text": "x"}).json()["errors"]
    chains = [{"name": r["description"], "role": f"{r['description']}_chain",
               "sequence": r["sequence"], "copies": 2} for r in parsed["records"]]
    r = c.post(f"/api/programs/{pid}/biologics", headers=h, json={
        "name": "mAb", "entity": {"format": "sequence", "chains": chains, "isotype": "IgG4"}})
    assert r.status_code == 200 and r.json()["entity"]["derived"]["total_mass"]["available"]
    bad = c.post(f"/api/programs/{pid}/biologics", headers=h, json={
        "name": "mAb2", "entity": {"format": "sequence", "chains": []}})
    assert bad.status_code == 400 and "at least one chain" in bad.json()["detail"]
    assert c.post(f"/api/compounds/{r.json()['id']}/enrich", headers=h).status_code == 400
