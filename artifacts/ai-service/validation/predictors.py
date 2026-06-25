"""Predictors under test — real model calls, no fabrication.

DeterministicChemistryPredictor
  The L1 "deterministic floor": the hard, model-free chemistry gates that can
  fire a NO-GO even with the ML stack offline — reactive-metabolite SMARTS
  (models.reactive_metabolites, the real production module) + Lipinski Ro5
  (RDKit). This subset is what we can validate end-to-end right now without the
  ADMET-AI weights. (The TS pipeline adds Brenk/BMS structural-alert rejects on
  top; those are not in this Python floor and are noted as such in the report.)

MlServiceEndpointPredictor
  Calls the live ai-service ADMET-AI endpoint for a given endpoint's probability.
  Returns None when the service / model is unavailable — the harness then marks
  that endpoint PENDING rather than inventing a number.
"""
from __future__ import annotations

from typing import Optional

from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski

from models.reactive_metabolites import predict_reactive_metabolites


class DeterministicChemistryPredictor:
    """smiles -> {'advance': 0/1, 'halt_reasons': [...]}. Halt (0) iff a real
    deterministic liability fires. Mirrors the scorecard's model-free hard gates."""

    name = "deterministic-chemistry-floor (reactive-metabolite SMARTS + Ro5)"

    def predict(self, smiles: str) -> dict:
        reasons: list[str] = []
        mol = Chem.MolFromSmiles(smiles or "")
        if mol is None:
            return {"advance": None, "halt_reasons": ["invalid_smiles"]}  # excluded from metrics
        # Reactive-metabolite alert — CORROBORATION-GATED, mirroring l1Scorecard.ts:
        # a lone critical motif is a monitor signal, not a hard veto (validation
        # showed it fires on ~16% of approved drugs without discriminating). The
        # model-free floor has no DILI/genotoxic corroboration available, so the
        # only corroboration it can apply is multiplicity (≥2 independent critical
        # motifs — e.g. troglitazone-like). Single critical → WATCH (not a halt).
        try:
            rm = predict_reactive_metabolites(smiles)
            n_crit = int(rm.get("critical_count", 0))
            if n_crit >= 2:
                reasons.append(f"reactive_metabolite_critical_x{n_crit}")
        except Exception:
            pass
        # Lipinski Ro5 gross failure (classic small molecule, MW < 700 → not bRo5).
        mw = Descriptors.MolWt(mol)
        viol = (int(mw > 500) + int(Descriptors.MolLogP(mol) > 5)
                + int(Lipinski.NumHDonors(mol) > 5) + int(Lipinski.NumHAcceptors(mol) > 10))
        if viol >= 3 and mw < 700:
            reasons.append(f"ro5_violations({viol})")
        return {"advance": 0 if reasons else 1, "halt_reasons": reasons}


class MlServiceEndpointPredictor:
    """Probability for one ADMET-AI endpoint via the live ai-service. Returns
    None on any unavailability — never a fabricated probability."""

    def __init__(self, endpoint_key: str, base_url: str = "http://localhost:8090"):
        self.endpoint_key = endpoint_key   # e.g. 'hERG', 'DILI', 'AMES'
        self.base_url = base_url.rstrip("/")
        self.name = f"ai-service ADMET-AI[{endpoint_key}]"

    def predict_prob(self, smiles: str) -> Optional[float]:
        import json
        import urllib.request
        try:
            req = urllib.request.Request(
                f"{self.base_url}/predict/admet-ml",
                data=json.dumps({"smiles": smiles}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                payload = json.loads(r.read().decode())
        except Exception:
            return None
        if not payload.get("ml_available"):
            return None
        v = (payload.get("endpoints") or {}).get(self.endpoint_key)
        return float(v) if isinstance(v, (int, float)) else None
