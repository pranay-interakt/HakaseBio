"""ABI 1.1: inputs a driver declares only once the data are in (terminal-phase selections)."""

import pytest

from hos.kernel.errors import KernelError
from tests.drivers.test_in_vivo_pk import PARAMS, _file
from tests.kernel.test_kernel import CTX, k  # noqa: F401 - fixture


def test_selection_inputs_are_accepted_only_after_data_and_change_the_analysis(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="PK-1", context=CTX, sponsor="Example Bio")
    cmp_ = k.register_compound(sci, prog["id"], name="paracetamol", smiles="CC(=O)Nc1ccc(O)cc1")
    sid = k.create_study(sci, program_id=prog["id"], compound_id=cmp_["id"],
                         requirement_id="adme.in_vivo_pk")["id"]
    k.design_study(sci, sid, PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "Example CRO"})
    sel = {"terminal_phase_start.IV.M101": {"value": 2, "unit": "h", "kind": "user_supplied"}}
    with pytest.raises(KernelError, match="not an input"):
        k.set_analysis_inputs(sci, sid, sel)
    k.receive_data(sci, sid, _file(ref=sid), filename="pk.csv")
    v = k.study_view(sid)
    assert "terminal_phase_start.PO.M203" in v["expected_inputs"]
    v = k.analyze_study(sci, sid)
    assert v["results"]["quantities"]["profiles.selected"]["value"] == 0
    k.set_analysis_inputs(sci, sid, sel)
    v = k.analyze_study(sci, sid, reason="terminal phase selected for IV/M101")
    assert v["results"]["quantities"]["profiles.selected"]["value"] == 1
    assert v["analysis_inputs"]["terminal_phase_start.IV.M101"]["entered_by"] == "sci"
