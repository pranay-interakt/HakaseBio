"""ChEMBL and PubChem clients against responses recorded from the live APIs on 2026-10-11
(tests/fixtures/http: URL, capture time and body SHA-256 in each file), plus failure paths.
``pytest -m live`` re-runs the contract against the live services."""

import httpx
import pytest

from hos.data_sources import CachedHttp, ChEMBLClient, PubChemClient, SourceStatus
from hos.data_sources.http import USER_AGENT
from tests.fixtures.transport import replay_transport

ASPIRIN = "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"
DOFETILIDE = "IXTMWRCNAAVVAI-UHFFFAOYSA-N"
UNKNOWN = "AAAAAAAAAAAAAA-UHFFFAOYSA-N"


def _http(tmp_path=None, transport=None, retries=2):
    return CachedHttp(
        client=httpx.Client(transport=transport or replay_transport()),
        cache_dir=tmp_path,
        retries=retries,
    )


def test_pubchem_aspirin_properties_and_provenance():
    r = PubChemClient(_http()).compound_by_inchikey(ASPIRIN)
    assert r.ok and r.records[0]["cid"] == 2244
    assert r.records[0]["iupac_name"] == "2-acetyloxybenzoic acid"
    mw = r.quantities["MolecularWeight"]
    assert mw.value == pytest.approx(180.16) and mw.kind.value == "literature"
    assert mw.provenance.source_record_id == "CID2244"
    assert "computed by PubChem" in r.quantities["XLogP"].provenance.notes


def test_pubchem_unknown_key_is_not_found_not_a_guess():
    r = PubChemClient(_http()).compound_by_inchikey(UNKNOWN)
    assert r.status is SourceStatus.NOT_FOUND and not r.quantities


def test_chembl_molecule_lookup():
    ch = ChEMBLClient(_http())
    assert ch.molecule_by_inchikey(ASPIRIN).records[0]["chembl_id"] == "CHEMBL25"
    assert ch.molecule_by_inchikey(DOFETILIDE).records[0]["pref_name"] == "DOFETILIDE"
    assert ch.molecule_by_inchikey(UNKNOWN).status is SourceStatus.NOT_FOUND


def test_chembl_herg_activities_are_cited_literature():
    r = ChEMBLClient(_http()).herg_ic50("CHEMBL473")
    assert r.ok and len(r.records) == 23 and len(r.quantities) == 23
    q = next(iter(r.quantities.values()))
    assert q.unit == "nM" and q.kind.value == "literature"
    assert q.provenance.citation.key.startswith("chembl:CHEMBL")
    assert "CC BY-SA" in r.license


def test_chembl_censored_values_are_never_flattened():
    r = ChEMBLClient(_http()).herg_ic50("CHEMBL113")
    bounds = [q for q in r.quantities.values() if "censored_lower_bound" in q.qc_flags]
    assert len(bounds) == 1 and "bound" in bounds[0].label and bounds[0].value == 100000.0
    # a comment-only record is kept as a record but never turned into a number
    assert len(r.records) == 2 and len(r.quantities) == 1
    kept = next(rec for rec in r.records if rec.get("hos_note"))
    assert "Inhibition < 50%" in kept["activity_comment"]


def test_unreachable_source_is_honest():
    def boom(request):
        raise httpx.ConnectError("network down", request=request)

    r = PubChemClient(_http(transport=httpx.MockTransport(boom))).compound_by_inchikey(ASPIRIN)
    assert r.status is SourceStatus.UNREACHABLE and not r.quantities
    assert r.error == "request failed (ConnectError)"  # no raw network text to clients


def test_rate_limit_is_reported_not_retried_forever():
    calls = []

    def limited(request):
        calls.append(1)
        return httpx.Response(429, json={"error": "slow down"})

    r = ChEMBLClient(_http(transport=httpx.MockTransport(limited), retries=0)).molecule_by_inchikey(
        ASPIRIN
    )
    assert r.status is SourceStatus.RATE_LIMITED and len(calls) == 1


def test_cache_keeps_original_retrieval_time(tmp_path):
    http = _http(tmp_path)
    first = PubChemClient(http).compound_by_inchikey(ASPIRIN)
    second = PubChemClient(http).compound_by_inchikey(ASPIRIN)
    assert not first.from_cache and second.from_cache
    assert second.retrieved_at == first.retrieved_at


def test_fixtures_carry_capture_metadata():
    import json

    from tests.fixtures.transport import FIXTURE_DIR

    for f in FIXTURE_DIR.glob("*.json"):
        d = json.loads(f.read_text())
        assert d["url"].startswith("https://") and d["captured_at"] and d["body_sha256"]


@pytest.mark.live
def test_live_contract_pubchem_and_chembl():
    http = CachedHttp(client=httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60))
    assert PubChemClient(http).compound_by_inchikey(ASPIRIN).records[0]["cid"] == 2244
    ch = ChEMBLClient(http)
    assert ch.molecule_by_inchikey(ASPIRIN).records[0]["chembl_id"] == "CHEMBL25"
    assert ch.herg_ic50("CHEMBL473").ok


def test_enrichment_attaches_results_through_the_ledger(tmp_path):
    from hos.core.regulatory import Indication, Modality, ProgramContext, Route
    from hos.data_sources.enrich import enrich_compound
    from hos.db.store import Database, FileStore
    from hos.kernel.attestation import PrincipalKind, Role
    from hos.kernel.kernel import Kernel

    k = Kernel(db=Database(f"sqlite:///{tmp_path / 'e.sqlite3'}"), files=FileStore(tmp_path / "o"))
    a = k.register_principal(
        None,
        principal_id="a",
        name="A",
        kind=PrincipalKind.HUMAN,
        roles=[Role.ADMIN, Role.SCIENTIST],
        password="x" * 12,
    )
    prog = k.create_program(
        a,
        name="P",
        context=ProgramContext(
            modality=Modality.SMALL_MOLECULE,
            indication=Indication.ACUTE_NON_ONCOLOGY,
            route=Route.ORAL,
            intended_clinical_duration_days=7,
            max_trial_duration_days=7,
        ),
    )
    c = k.register_compound(a, prog["id"], name="aspirin", smiles="CC(=O)Oc1ccccc1C(=O)O")
    http = _http()
    v = enrich_compound(k, a, c["id"], pubchem=PubChemClient(http), chembl=ChEMBLClient(http))
    assert v["external"]["pubchem"]["records"][0]["cid"] == 2244
    assert v["external"]["chembl"]["records"][0]["chembl_id"] == "CHEMBL25"
    assert v["external"]["chembl_herg_ic50"]["status"] in ("ok", "not_found")
    assert [e["action"] for e in k.history(c["id"])].count("compound.external_attached") == 3
