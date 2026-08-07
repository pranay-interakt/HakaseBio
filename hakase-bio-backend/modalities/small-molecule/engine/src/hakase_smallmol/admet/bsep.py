"""BSEP inhibition and phospholipidosis risk predictor.

BSEP (Bile Salt Export Pump, ABCB11) — the dominant canalicular bile acid
transporter. Inhibition causes intracellular bile acid accumulation → cholestatic
hepatotoxicity. BSEP inhibition is the #2 transporter-mediated DILI mechanism
after CYP-reactive metabolites, and is associated with post-market withdrawals
of troglitazone, bosentan, and several statins.

Phospholipidosis (DIPL) — lysosomal accumulation of drug-phospholipid complexes.
Cationic amphiphilic drugs (CADs) partition into lysosomal membranes and interfere
with phospholipase A2. A morphological finding in preclinical toxicology, but
reversible on drug withdrawal.

References
----------
- Köck et al. (2014) Chem Res Toxicol 27:1752    — BSEP pharmacophore
- Dawson et al. (2012) Drug Metab Dispos 40:130   — BSEP IC50 dataset
- Kiiski et al. (2012) Mol Pharm 9:2224           — BSEP inhibition physicochemical
- Pelkonen et al. (2013) Arch Toxicol              — BSEP and DILI
- Reasor & Kacew (2001) Ann Pharmacother          — phospholipidosis review
- Hanumegowda et al. (2010) Tox Sci               — CAD structural alerts
"""

from __future__ import annotations

from typing import Any

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, rdMolDescriptors

# ---------------------------------------------------------------------------
# BSEP pharmacophore SMARTS (Köck 2014)
# ---------------------------------------------------------------------------
# Key structural features of BSEP substrates / inhibitors:
#   – Basic nitrogen (protonated at bile duct pH ≈ 7.4 → ionic interaction with
#     ABCB11 Glu297 / Asp1348 residues)
#   – Hydrophobic domain (interaction with multiple aromatic/aliphatic binding pockets)
#   – MW > 300 and logP > 2 (structural prerequisite for bile acid mimic)

_BASIC_AMINE = Chem.MolFromSmarts("[NX3;H0,H1,H2;!$(NC=O);!$(NS=O);!$(N=*);!$([N+]);!$(Nc)]")
_QUAT_N = Chem.MolFromSmarts("[NX4+]")
_GUANIDINE = Chem.MolFromSmarts("[NX3][CX3](=[NX2])[NX3]")
_AMIDINE = Chem.MolFromSmarts("[NX3][CX3]=[NX2]")
_STEROID_CORE = Chem.MolFromSmarts(
    "[C@@H]1CC[C@H]2[C@@H]1CC[C@@H]3[C@H]2CC[C@@H]4C[C@@H](O)CC[C@]34C"
)
_MACROLIDE_RING = Chem.MolFromSmarts("O=C1OCCCCCCCCC1")  # simplified macrolactone ≥10-membered
_BILE_ACID_LIKE = Chem.MolFromSmarts("C1CC2CCCC3CCCC(CC3)C2C1")  # tetracyclic steroid skeleton

# CAD (cationic amphiphile) patterns
_TERTIARY_AMINE = Chem.MolFromSmarts("[NX3;H0;!$(NC=O);!$(NS=O);!$(N=*);!$([N+])]")
_PIPERIDINE = Chem.MolFromSmarts("N1CCCCC1")
_PIPERAZINE = Chem.MolFromSmarts("N1CCNCC1")
_PYRROLIDINE = Chem.MolFromSmarts("N1CCCC1")


def _has(mol, patt) -> bool:
    return mol.HasSubstructMatch(patt) if patt is not None else False


def _count(mol, patt) -> int:
    if patt is None or mol is None:
        return 0
    return len(mol.GetSubstructMatches(patt))


# ---------------------------------------------------------------------------
# BSEP risk scorer
# ---------------------------------------------------------------------------


def _bsep_risk_score(
    mol, mw: float, logp: float, tpsa: float, hba: int, n_basic: int
) -> tuple[int, list[str]]:
    """Return (raw_risk_score 0-100, [explanatory factor strings])."""
    score = 0
    factors: list[str] = []

    # ── Physicochemical gates (from Dawson 2012, Kiiski 2012) ────────────
    # MW > 400: bile acid mimics are large (CDCA=392, UDCA=392, TCA=515)
    if mw > 500:
        score += 20
        factors.append(f"MW {mw:.0f} Da (>500: bile acid mimic range)")
    elif mw > 400:
        score += 12
        factors.append(f"MW {mw:.0f} Da (>400: moderate size risk)")

    # logP > 2: lipophilic molecules partition into canalicular membrane
    if logp > 5:
        score += 20
        factors.append(f"logP {logp:.1f} (>5: high membrane partitioning)")
    elif logp > 3:
        score += 12
        factors.append(f"logP {logp:.1f} (>3: moderate lipophilicity risk)")
    elif logp > 2:
        score += 5
        factors.append(f"logP {logp:.1f} (>2: low lipophilicity risk)")

    # Basic nitrogen: ionic interaction with BSEP binding pocket Asp/Glu
    if n_basic >= 2:
        score += 18
        factors.append(f"{n_basic} basic nitrogens (dual cation, high BSEP affinity)")
    elif n_basic == 1:
        score += 10
        factors.append("1 basic nitrogen (ionic interaction with BSEP pocket)")

    # Quaternary N / permanently charged — can still inhibit at apical membrane
    if _has(mol, _QUAT_N):
        score += 8
        factors.append("Quaternary nitrogen (permanent cation)")

    # HBA ≥ 5: multiple H-bond acceptors mimic bile acid OH/SO3 groups
    if hba >= 6:
        score += 8
        factors.append(f"{hba} H-bond acceptors (bile-acid-like polar surface)")
    elif hba >= 4:
        score += 4
        factors.append(f"{hba} H-bond acceptors (moderate bile acid mimic)")

    # ── Structural pharmacophore features ────────────────────────────────
    # Steroid/bile-acid skeleton: direct structural mimic
    if _has(mol, _steroid_patt := _BILE_ACID_LIKE):
        score += 25
        factors.append("Tetracyclic (steroid-like) scaffold — direct bile acid mimic")
    elif _has(mol, _STEROID_CORE):
        score += 30
        factors.append("Steroidal core detected — very high BSEP substrate probability")

    # Macrolide ring: known BSEP inhibitors (erythromycin, cyclosporin A)
    if _has(mol, _MACROLIDE_RING):
        score += 15
        factors.append("Macrolide ring (≥10-membered lactone) — erythromycin class BSEP inhibitor")

    # Guanidine / amidine: strong basic groups known to inhibit BSEP
    if _has(mol, _GUANIDINE):
        score += 10
        factors.append("Guanidine group (strong base, BSEP pocket interaction)")
    if _has(mol, _AMIDINE):
        score += 8
        factors.append("Amidine group (strong base)")

    # TPSA < 100 + MW > 400 + logP > 2: classic BSEP inhibitor profile
    if tpsa < 100 and mw > 400 and logp > 2:
        score += 8
        factors.append(
            f"TPSA {tpsa:.0f} Å² with large lipophilic scaffold — BSEP inhibitor profile"
        )

    return min(100, score), factors


# ---------------------------------------------------------------------------
# Phospholipidosis (CAD) risk
# ---------------------------------------------------------------------------


def _phospholipidosis_risk(mol, logp: float, mw: float) -> tuple[str, str, int, list[str]]:
    """Assess drug-induced phospholipidosis (DIPL) risk.

    Returns (risk_class, rationale, score_0_100, [factors])
    Canonical CAD rule: pKa_basic > 6.5 AND logD_7.4 > 0 (lysosomal trapping).
    We approximate using structural proxy: basic amine + logP + aromatic rings.
    Reference: Reasor & Kacew 2001; Hanumegowda 2010; Daniel 2012.
    """
    factors: list[str] = []
    score = 0

    # Count basic amines (key CAD feature)
    n_tertiary = _count(mol, _TERTIARY_AMINE)
    n_piperidine = _count(mol, _PIPERIDINE)
    n_piperazine = _count(mol, _PIPERAZINE)
    n_pyrrolidine = _count(mol, _PYRROLIDINE)
    n_basic = _count(mol, _BASIC_AMINE)

    # CAD criterion 1: has basic amine (pKa proxy)
    has_basic = n_basic > 0 or n_tertiary > 0
    if n_piperidine or n_piperazine or n_pyrrolidine:
        score += 15
        ring_names = []
        if n_piperidine:
            ring_names.append("piperidine")
        if n_piperazine:
            ring_names.append("piperazine")
        if n_pyrrolidine:
            ring_names.append("pyrrolidine")
        factors.append(
            f"N-containing saturated ring(s): {', '.join(ring_names)} (lysosomal trapping)"
        )
    elif has_basic:
        score += 10
        factors.append("Basic amine (lysosomal trapping via protonation at pH 5)")

    # CAD criterion 2: logP > 2 (membrane partitioning)
    if logp > 4:
        score += 25
        factors.append(f"logP {logp:.1f} (>4: strong membrane partition coefficient)")
    elif logp > 2:
        score += 12
        factors.append(f"logP {logp:.1f} (>2: moderate membrane partition coefficient)")

    # CAD criterion 3: molecular weight
    if mw < 1000:
        score += 5  # small enough to cross membranes
        factors.append(f"MW {mw:.0f} Da (accessible molecular size)")

    # Aromatic content amplifies phospholipid binding
    n_arom = rdMolDescriptors.CalcNumAromaticRings(mol)
    if n_arom >= 3:
        score += 10
        factors.append(f"{n_arom} aromatic rings (high pi-stacking with phospholipid heads)")
    elif n_arom >= 2:
        score += 5
        factors.append(f"{n_arom} aromatic rings")

    if not has_basic:
        # Non-CAD: cannot cause DIPL through lysosomal trapping
        score = max(0, score - 20)
        if score < 10:
            factors = ["No basic amine — lysosomal trapping mechanism unlikely"]
            score = 5

    score = min(100, score)

    if score >= 50 and has_basic and logp > 2:
        risk_class = "High"
        rationale = "Classic cationic amphiphile drug (CAD): basic amine + high logP → lysosomal trapping and phospholipidosis likely in 28-day repeat-dose studies"
    elif score >= 25:
        risk_class = "Moderate"
        rationale = "Partial CAD features; phospholipidosis possible in higher-dose or longer-duration studies"
    else:
        risk_class = "Low"
        rationale = "Insufficient cationic amphiphile character; phospholipidosis unlikely at therapeutic doses"

    return risk_class, rationale, score, factors


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def predict_bsep(smiles: str) -> dict[str, Any]:
    """Predict BSEP inhibition risk and phospholipidosis liability.

    Returns
    -------
    dict with:
      bsep.risk_class       — "High" | "Moderate" | "Low" | "Negligible"
      bsep.score            — 0–100 composite BSEP inhibition risk
      bsep.factors          — list of contributing risk factor descriptions
      bsep.ic50_estimate_uM — rough IC50 band (None if insufficient data)
      phospholipidosis.*    — CAD-based DIPL risk
      model_info            — provenance
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    # Canonicalise
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise ValueError(f"Invalid SMILES: {smiles!r}")
    smiles = Chem.MolToSmiles(mol, canonical=True)
    mol = Chem.MolFromSmiles(smiles)

    # RDKit descriptors
    mw = Descriptors.ExactMolWt(mol)
    logp = Crippen.MolLogP(mol)
    tpsa = Descriptors.TPSA(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)
    n_basic = _count(mol, _BASIC_AMINE) + _count(mol, _GUANIDINE)

    # ── BSEP ────────────────────────────────────────────────────────────
    bsep_score, bsep_factors = _bsep_risk_score(mol, mw, logp, tpsa, hba, n_basic)

    if bsep_score >= 55:
        bsep_class = "High"
        bsep_rationale = "High probability of BSEP inhibition; cholestatic DILI risk; recommend in vitro vesicular transport assay (FDA/EMA guidance)"
        ic50_band = "<10 µM (estimated)"
    elif bsep_score >= 30:
        bsep_class = "Moderate"
        bsep_rationale = "Moderate BSEP inhibition probability; further evaluation recommended in sandwich-cultured hepatocyte (SCH) assay"
        ic50_band = "10–100 µM (estimated)"
    elif bsep_score >= 12:
        bsep_class = "Low"
        bsep_rationale = (
            "Low BSEP inhibition probability; monitoring in chronic repeat-dose studies"
        )
        ic50_band = ">100 µM (estimated)"
    else:
        bsep_class = "Negligible"
        bsep_rationale = "Physicochemical profile inconsistent with BSEP inhibition; no major risk factors present"
        ic50_band = None

    # ── Phospholipidosis ─────────────────────────────────────────────────
    pl_class, pl_rationale, pl_score, pl_factors = _phospholipidosis_risk(mol, logp, mw)

    return {
        "smiles": smiles,
        "bsep": {
            "risk_class": bsep_class,
            "score": bsep_score,
            "rationale": bsep_rationale,
            "factors": bsep_factors,
            "ic50_estimate_uM": ic50_band,
            "recommended_assay": (
                "Vesicular transport assay (membrane vesicles expressing human BSEP) per FDA Draft Guidance 2017"
                if bsep_class in ("High", "Moderate")
                else "Routine DILI monitoring in chronic studies"
            ),
        },
        "phospholipidosis": {
            "risk_class": pl_class,
            "score": pl_score,
            "rationale": pl_rationale,
            "factors": pl_factors,
            "cad_positive": pl_class == "High",
            "recommended_assay": (
                "Nile red staining in macrophages (HepG2 or NR8383 cells) per EMA/CHMP/SWP/169215/2011"
                if pl_class in ("High", "Moderate")
                else "Not indicated at standard doses"
            ),
        },
        "model_info": {
            "engine": "HakaseAI BSEP + Phospholipidosis Risk v1.0",
            "method": "Physicochemical rule-based pharmacophore model",
            "references": [
                "Köck et al. (2014) Chem Res Toxicol 27:1752",
                "Dawson et al. (2012) Drug Metab Dispos 40:130",
                "Kiiski et al. (2012) Mol Pharm 9:2224",
                "Hanumegowda et al. (2010) Toxicol Sci 113:351",
                "Reasor & Kacew (2001) Ann Pharmacother 35:910",
            ],
            "note": "Rule-based model; confirm with vesicular transport assay for BSEP IC50 < 300 µM",
        },
    }
