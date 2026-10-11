"""Signed programme determination: whether ICH S6(R1) principles apply to a chemically
synthesised peptide (S6(R1) section 1.3)."""

import pytest

from hos.core.regulatory import Indication, Modality, PeptideOrigin, ProgramContext, Route
from hos.kernel.errors import KernelError, PermissionDenied
from tests.api.test_api import PW as API_PW
from tests.api.test_api import _login, api  # noqa: F401 - fixture
from tests.kernel.test_kernel import k  # noqa: F401 - fixture

PEPTIDE = ProgramContext(modality=Modality.PEPTIDE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                         route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365,
                         max_trial_duration_days=28,
                         peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS, amino_acid_chains=(31,))
WHY = "31-mer GLP-1 analogue; target conserved in rat and monkey, so species relevance is shown"


def _status(view, rid):
    return next(r["status"] for r in view["study_set"]["requirements"] if r["id"] == rid)


def test_the_responsible_scientist_signs_and_the_study_set_follows(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="PEP-1", context=PEPTIDE)
    assert _status(prog, "bio.immunogenicity") == "conditional"
    v = k.record_program_determination(sci, prog["id"], key="s6_principles_apply",
                                       applies=True, rationale=WHY)
    assert _status(v, "bio.immunogenicity") == "required"
    det = v["context"]["s6_determination"]
    assert det["applies"] is True and det["signature"]["role"] == "responsible_scientist"
    assert det["signature"]["signer_name"] == "Sam Scientist"
    events = [e for e in k.history(prog["id"]) if e["action"] == "program.determination_recorded"]
    assert events and events[0]["payload"]["determination"]["rationale"] == WHY
    assert k.verify_ledger() > 0


def test_who_may_sign(k):  # noqa: F811
    prog = k.create_program(k.get_principal("sci"), name="PEP-2", context=PEPTIDE)
    for pid in ("sd", "agent"):                     # wrong role; agents never sign
        with pytest.raises(PermissionDenied):
            k.record_program_determination(k.get_principal(pid), prog["id"],
                                           key="s6_principles_apply", applies=True,
                                           rationale=WHY)


def test_it_cannot_be_written_as_a_plain_context_change(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="PEP-3", context=PEPTIDE)
    with pytest.raises(KernelError, match="signed determination"):
        k.update_program_context(sci, prog["id"], {"s6_determination": {
            "applies": False, "rationale": "x", "signature": {"signer_name": "forged"}}},
            reason="shortcut")
    with pytest.raises(KernelError, match="not supplied with it"):
        k.create_program(sci, name="PEP-4", context=ProgramContext.from_dict(
            {**PEPTIDE.to_dict(), "s6_determination": {"applies": True, "rationale": "x",
                                                       "signature": {"signer_name": "x"}}}))


def test_only_for_chemically_synthesised_peptides(k):  # noqa: F811
    sci = k.get_principal("sci")
    rec = k.create_program(sci, name="PEP-5", context=ProgramContext.from_dict(
        {**PEPTIDE.to_dict(), "peptide_origin": "recombinant"}))
    with pytest.raises(KernelError, match="chemically synthesised"):
        k.record_program_determination(sci, rec["id"], key="s6_principles_apply",
                                       applies=True, rationale=WHY)
    with pytest.raises(KernelError, match="unknown programme determination"):
        k.record_program_determination(sci, rec["id"], key="noael", applies=True,
                                       rationale=WHY)


def test_changing_the_origin_withdraws_the_determination_on_the_record(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="PEP-6", context=PEPTIDE)
    k.record_program_determination(sci, prog["id"], key="s6_principles_apply", applies=False,
                                   rationale=WHY)
    v = k.update_program_context(sci, prog["id"], {"peptide_origin": "recombinant"},
                                 reason="the CMC route changed to E. coli expression")
    assert v["context"]["s6_determination"] is None
    assert _status(v, "bio.species_relevance") == "required"        # S6(R1) now governs
    ev = [e for e in k.history(prog["id"]) if e["action"] == "program.context_updated"][-1]
    assert ev["payload"]["withdrawn_determinations"] == ["s6_principles_apply"]


def test_over_http_with_reauthentication(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")
    assert c.post("/api/principals", headers=adm, json={
        "principal_id": "rs", "name": "Rae Scientist", "kind": "human",
        "roles": ["scientist", "responsible_scientist"], "password": API_PW}).status_code == 200
    h = _login(c, "rs")
    prog = c.post("/api/programs", headers=h, json={
        "name": "PEP-API", "context": PEPTIDE.to_dict()}).json()
    assert prog["study_set"]["classification"]["outcome"] == "not_protein"
    body = {"key": "s6_principles_apply", "applies": True, "rationale": WHY}
    assert c.post(f"/api/programs/{prog['id']}/determinations", headers=h,
                  json={**body, "password": "not the password"}).status_code == 403
    r = c.post(f"/api/programs/{prog['id']}/determinations", headers=h,
               json={**body, "password": API_PW})
    assert r.status_code == 200 and r.json()["context"]["s6_determination"]["applies"] is True
    assert c.patch(f"/api/programs/{prog['id']}/context", headers=h, json={
        "changes": {"s6_determination": None}, "reason": "x"}).status_code == 400
