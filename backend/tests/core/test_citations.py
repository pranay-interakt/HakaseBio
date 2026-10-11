"""Citation registry integrity and the guideline section references verified against
the official ICH PDFs (database.ich.org, retrieved 2026-10-11; see docs/09 section 9.4)."""

import pytest

from hos.core.citations import CITATIONS, cite
from hos.core.methods import METHODS
from hos.core.regulatory import Indication, Modality, ProgramContext, Route, derive_study_set
from hos.core.regulatory.engine import RequirementStatus

JOURNAL_KEYS = (
    "wildman1999", "ertl2000", "lipinski2001", "veber2002", "bickerton2012", "obach1999",
    "wilkinson1975", "houston1994", "hallifax2006", "riley2005", "davies1993", "barter2007",
    "delean1978", "redfern2003", "dunnett1955", "gertz2008",
)


def test_required_keys_present():
    for k in ("di_kerns2016", "dunnett1955", "oecd_tg407", "oecd_tg408", "oecd_tg409", "ich_s1a"):
        assert cite(k).text


@pytest.mark.parametrize("key", JOURNAL_KEYS)
def test_journal_citations_carry_a_doi(key):
    assert CITATIONS[key].doi, key


def test_obach_title_matches_crossref():
    # Crossref (DOI 10.1016/S0090-9556(24)14938-0): "...Twenty-Nine Drugs..."
    assert "twenty-nine" in CITATIONS["obach1999"].text


def test_every_ich_citation_links_the_official_document():
    for k, c in CITATIONS.items():
        if k.startswith("ich_"):
            assert c.url and c.url.startswith("https://database.ich.org/"), k


def test_every_method_cites_a_registered_reference():
    for m in METHODS.values():
        for c in m.citations:
            assert c.key in CITATIONS


def _sections(ctx: ProgramContext) -> dict[str, str]:
    return {r.id: r.section for r in derive_study_set(ctx).requirements}


SM = ProgramContext(modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                    route=Route.ORAL, intended_clinical_duration_days=365,
                    max_trial_duration_days=28)


@pytest.mark.parametrize("req_id,expected", [
    ("safety.core_battery", "S7A sections 2.7, 2.10.1"),
    ("safety.herg", "S7B sections 2.3.1, 3.1.2"),
    ("safety.in_vivo_qt", "S7B sections 2.3.2, 3.1.3"),
    ("tox.repeat_dose_rodent", "M3(R2) section 5.1, Table 1"),
    ("genotox.ames", "M3(R2) section 9"),
    ("dart.fertility", "M3(R2) sections 11.1, 11.3"),
    ("tox.local_tolerance", None),  # oral route: not emitted
    ("photo.assessment", "S10 sections 2, 5.1.1"),
    ("immunotox.weight_of_evidence", "S8 sections 2.1, 2.2"),
])
def test_small_molecule_sections_match_verified_text(req_id, expected):
    got = _sections(SM).get(req_id)
    assert got == expected


def test_carcinogenicity_trigger_is_attributed_to_s1a():
    ss = derive_study_set(SM)
    carc = next(r for r in ss.requirements if r.id == "carc.bioassay")
    assert carc.status is RequirementStatus.REQUIRED
    assert carc.citation.key == "ich_s1a" and carc.section.startswith("S1A section 4.1")


def test_s9_sections_match_verified_text():
    s = _sections(ProgramContext(modality=Modality.SMALL_MOLECULE,
                                 indication=Indication.ADVANCED_CANCER, route=Route.ORAL,
                                 intended_clinical_duration_days=90, max_trial_duration_days=28))
    assert s["safety.core_battery"] == "S9 section 2.2"
    assert s["tox.repeat_dose"] == "S9 sections 2.4, 3.3"
    assert s["dart.efd"] == "S9 section 2.5"
    assert s["genotox.battery"] == "S9 section 2.6"
