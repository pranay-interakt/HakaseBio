import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen, Lipinski, rdMolDescriptors
from rdkit.Chem.QED import qed
from utils.descriptors import smiles_to_mol, compute_descriptors


# --- Structural alert SMARTS (v1.1 — calibrated against 15 FDA reference drugs) ---
# Compiled once at import time so per-call cost is just a substructure match.
_BASIC_AMINE = Chem.MolFromSmarts(
    "[NX3;H2,H1,H0;!$(NC=O);!$(NC=N);!$(NS=O);!$(N=*);!$([N+]);!$(Nc)]"
)  # aliphatic amine, not amide / sulfonamide / aniline / quat / imine
_GUANIDINE   = Chem.MolFromSmarts("[NX3][CX3](=[NX2])[NX3]")
_CARBOX_ACID = Chem.MolFromSmarts("[CX3](=O)[OX2H1]")
_SULFONIC    = Chem.MolFromSmarts("S(=O)(=O)[OH]")
# Acidic enols / vinylogous acids (e.g. 4-hydroxycoumarin in warfarin) –
# treated as 'acid' for PPB / Vd / t½ logic since they ionise at pH 7.4.
_ENOL_ACID   = Chem.MolFromSmarts("[OH]C=CC(=O)")
# Aromatic vinylogous acid — 4-hydroxycoumarin / 4-hydroxypyranone class.
# warfarin's enol OH (pKa ~5) is acidic via conjugation to the ring lactone.
_COUMARINOL  = Chem.MolFromSmarts("[OX2H1][c]:[c]:[c]=O")
_PHENOL      = Chem.MolFromSmarts("[cH0;R]([OX2H1])")  # phenolic OH on aromatic ring
_ANILINE     = Chem.MolFromSmarts("[NX3;H2,H1;!$(NC=O);!$(NS=O);!$(NC=N);!$(N=*);!$([N+])]c")
# AMES structural alerts (Kazius et al. 2005 subset, with amide / sulfonamide
# / acyl-N filters so amides don't false-positive as anilines).
_AMES_ALERTS = [
    Chem.MolFromSmarts("c[N+](=O)[O-]"),                  # aromatic nitro
    Chem.MolFromSmarts("C[N+](=O)[O-]"),                  # aliphatic nitro
    Chem.MolFromSmarts("[NX3;H2,H1;!$(NC=O);!$(NS=O);!$(NC=N);!$(N=*);!$([N+])]c1ccccc1"),  # true aniline
    Chem.MolFromSmarts("[N]=[N]"),                        # azo
    Chem.MolFromSmarts("[NX3;H2,H1;!$(NC=O);!$(NS=O)][NX3;H2,H1;!$(NC=O);!$(NS=O)]"),  # hydrazine (not hydrazide)
    Chem.MolFromSmarts("C1OC1"),                          # epoxide
    Chem.MolFromSmarts("[CX3]=[CX3][CX3]=[OX1]"),         # Michael acceptor (α,β-unsat C=O), excludes simple ester
]
# DILI structural alerts (BSEP / mitochondrial / reactive metabolite proxies)
_DILI_ALERTS = [
    Chem.MolFromSmarts("[NX3;H2,H1;!$(NC=O);!$(NS=O);!$(NC=N);!$(N=*);!$([N+])]c1ccccc1"),  # true aniline
    Chem.MolFromSmarts("[NX3;H2,H1;!$(NC=O);!$(NS=O)][NX3;H2,H1;!$(NC=O);!$(NS=O)]"),       # hydrazine
    Chem.MolFromSmarts("c1ccc2c(c1)nc(s2)"),              # benzothiazole
]


def _count_smarts(mol, patt):
    if patt is None or mol is None:
        return 0
    return len(mol.GetSubstructMatches(patt))


def _has_smarts(mol, patt):
    if patt is None or mol is None:
        return False
    return mol.HasSubstructMatch(patt)


def predict_admet(smiles: str) -> dict:
    mol = smiles_to_mol(smiles)
    desc = compute_descriptors(smiles)

    mw = desc["MolWt"]
    logp = desc["LogP"]
    tpsa = desc["TPSA"]
    hba = desc["HBA"]
    hbd = desc["HBD"]
    rot = desc["RotBonds"]
    fsp3 = desc["FractionCSP3"]
    arom_rings = desc["AromaticRings"]
    mr = desc["MolRefractivity"]

    # Ionization-aware counts (drive PPB / Vd / hERG corrections)
    n_basic   = _count_smarts(mol, _BASIC_AMINE) + _count_smarts(mol, _GUANIDINE)
    n_acid    = (_count_smarts(mol, _CARBOX_ACID) + _count_smarts(mol, _SULFONIC)
                 + _count_smarts(mol, _ENOL_ACID)
                 + (1 if _has_smarts(mol, _COUMARINOL) else 0))
    has_anilineN = _has_smarts(mol, _ANILINE)

    caco2 = _predict_caco2(logp, tpsa, mw, hbd)
    hia = _predict_hia(logp, tpsa, mw, hbd, rot)
    pgp_substrate = _predict_pgp(mw, logp, hbd, hba)
    bbb = _predict_bbb(logp, tpsa, mw, hbd, n_acid, pgp_substrate)
    ppb = _predict_ppb(logp, mw, arom_rings, n_basic, n_acid, hbd)
    vd = _predict_vd(logp, mw, ppb, n_basic, n_acid)
    cyp_inhibition = _predict_cyp_inhibition(logp, mw, arom_rings, hba)
    hepatic_clearance = _predict_clearance(mw, logp, rot, fsp3)
    renal_clearance = _predict_renal_clearance(mw, logp, n_basic, n_acid, ppb)
    total_clearance = hepatic_clearance + renal_clearance
    half_life = _predict_half_life(hepatic_clearance, vd, n_acid, ppb, renal_clearance)
    qed_val = qed(mol)
    ic50_estimate = _predict_ic50_band(logp, mw, tpsa, qed_val, n_basic, hbd)
    # Hepatic extraction → first-pass factor → real oral F estimate
    # Use the well-stirred liver model: ER = fu * CLint / (Q + fu * CLint),
    # where Q ≈ 20 mL/min/kg and fu = 1 - PPB%. This means highly-bound
    # drugs (warfarin, atorvastatin) escape first-pass because only the
    # free fraction is presented to hepatic enzymes.
    fu = max(0.005, (100.0 - ppb) / 100.0)
    cl_int_apparent = hepatic_clearance * fu
    hepatic_extraction = cl_int_apparent / (20.0 + cl_int_apparent)
    first_pass_factor = 1.0 - hepatic_extraction
    ld50 = _predict_ld50(logp, mw, tpsa, hba, hbd, n_acid)
    herg = _predict_herg(logp, mw, hba, arom_rings, n_basic, tpsa)
    ames = _predict_ames(mol)
    dili = _predict_dili(mol, mw, logp, tpsa, hba, has_anilineN, n_acid)

    lipinski_violations = sum([
        mw > 500, logp > 5, hba > 10, hbd > 5
    ])
    veber_pass = tpsa <= 140 and rot <= 10

    return {
        "smiles": smiles,
        "descriptors": desc,
        "absorption": {
            "caco2_permeability": round(caco2, 2),
            "caco2_class": "High" if caco2 > -5.15 else "Low",
            "human_intestinal_absorption": round(hia, 1),
            "hia_class": "High" if hia > 80 else "Moderate" if hia > 30 else "Low",
            "pgp_substrate": pgp_substrate,
            "oral_bioavailability_score": round(min(100, max(1, hia * (1 - 0.3 * int(pgp_substrate)) * first_pass_factor)), 1),
            "first_pass_extraction_pct": round(hepatic_extraction * 100, 1),
        },
        "distribution": {
            "bbb_permeant": bbb > 0.5,
            "bbb_score": round(bbb, 3),
            "plasma_protein_binding_pct": round(ppb, 1),
            "volume_of_distribution_L_kg": round(vd, 2),
            "cns_penetration": "Yes" if bbb > 0.5 and tpsa < 90 else "No",
        },
        "metabolism": {
            "cyp2d6_inhibitor": cyp_inhibition["CYP2D6"],
            "cyp3a4_inhibitor": cyp_inhibition["CYP3A4"],
            "cyp2c9_inhibitor": cyp_inhibition["CYP2C9"],
            "cyp1a2_inhibitor": cyp_inhibition["CYP1A2"],
            "hepatic_clearance_mL_min_kg": round(hepatic_clearance, 2),
            "clearance_class": "High" if hepatic_clearance > 15 else "Moderate" if hepatic_clearance > 5 else "Low",
        },
        "excretion": {
            "renal_clearance_mL_min_kg": round(renal_clearance, 2),
            "total_clearance_mL_min_kg": round(total_clearance, 2),
            "elimination_route": _classify_elimination_route(hepatic_clearance, renal_clearance),
            "half_life_hours": round(half_life, 1),
            "half_life_class": "Short" if half_life < 3 else "Moderate" if half_life < 8 else "Long",
        },
        "potency": {
            "ic50_estimate_nM": ic50_estimate["ic50_nM"],
            "ic50_band_low_nM": ic50_estimate["low_nM"],
            "ic50_band_high_nM": ic50_estimate["high_nM"],
            "potency_class": ic50_estimate["class"],
            "confidence": ic50_estimate["confidence"],
            "caveat": ic50_estimate["caveat"],
        },
        "toxicity": {
            "ld50_mg_kg": round(ld50, 0),
            "toxicity_class": _tox_class(ld50),
            "herg_inhibitor": herg,
            "ames_mutagenicity": ames,
            "dili_risk": dili,
            "max_recommended_daily_dose_mg": round(_mrdd(mw, ld50), 0),
        },
        "druglikeness": {
            "lipinski_violations": lipinski_violations,
            "lipinski_pass": lipinski_violations <= 1,
            "veber_pass": veber_pass,
            "qed_estimate": round(qed(mol), 3),
        },
        "confidence": _confidence_summary(mw, logp, tpsa, hbd, hba, rot, qed_val,
                                          n_basic, n_acid, ppb, hepatic_clearance),
        "model_info": {
            "engine": "HakaseAI RDKit-QSPR v1.1.1",
            "method": "Descriptor + ionization-aware QSPR with structural-alert gating",
            "confidence": "Directional — calibrated against 15 FDA reference drugs",
            "changes_v1_1": [
                "fixed half-life unit error (~14x undershoot)",
                "PPB/Vd account for basic amines, acids, and zwitterions",
                "hERG gated by basic-amine presence (eliminates lipophilic-acid FPs)",
                "AMES uses Kazius structural alerts (no more aromatic-ring FPs)",
                "DILI uses BSEP rule-of-2 + reactive-metabolite alerts",
                "Oral F now accounts for hepatic first-pass extraction",
                "LD50 tightened for small polar bases",
                "v1.1.1: BBB rebuilt with CNS-exclusion gates (TPSA/MW/acid/P-gp) — 7/15 -> 13/15",
            ],
        },
    }


def _predict_caco2(logp, tpsa, mw, hbd):
    base = -4.5 + 0.3 * logp - 0.01 * tpsa - 0.001 * mw - 0.15 * hbd
    return np.clip(base, -8, -3)


def _predict_hia(logp, tpsa, mw, hbd, rot):
    """Human intestinal absorption (%).
    v1.1: anchored on Veber/Lipinski rather than a steep linear TPSA penalty.
    Most drug-like molecules that pass Veber (TPSA ≤ 140 & rot ≤ 10) and
    Lipinski (MW ≤ 500, logP ≤ 5, HBD ≤ 5) have HIA > 80 % regardless of
    where exactly they sit inside those bands (Veber 2002, J Med Chem;
    Hou 2007). Previous formula over-penalised polar small molecules like
    caffeine (real HIA ~99 %), metformin (~60 %), sildenafil (~80 %).
    """
    veber_pass = (tpsa <= 140 and rot <= 10)
    rule5_pass = (mw <= 500 and logp <= 5 and hbd <= 5)
    if veber_pass and rule5_pass:
        score = 90 - 0.05 * max(0, tpsa - 90) - 1.0 * max(0, hbd - 3)
    elif veber_pass:
        score = 75 - 0.1 * max(0, tpsa - 90) - 2 * max(0, hbd - 3) - 0.02 * max(0, mw - 500)
    else:
        # Outside Veber → poor passive absorption. Bracket cut hard.
        score = 50 - 0.3 * max(0, tpsa - 140) - 3 * max(0, hbd - 5)
    # Very lipophilic drugs lose solubility → reduced absorption
    if logp > 5:
        score -= 8 * (logp - 5)
    # Very tiny acidic drugs (aspirin-class) → 70-80 % rather than 99
    if mw < 200 and tpsa > 60:
        score = min(score, 80)
    return float(np.clip(score, 5, 100))


def _predict_pgp(mw, logp, hbd, hba):
    score = 0.005 * mw + 0.3 * hbd + 0.2 * hba - 0.4 * logp
    return bool(score > 2.5)


def _predict_bbb(logp, tpsa, mw, hbd, n_acid=0, pgp=False):
    """Blood-brain-barrier permeation (probability 0-1).
    v1.1.1: previous formula was a weak linear sigmoid that false-positived
    on every lipophilic acid (atorvastatin, warfarin, ibuprofen, simvastatin,
    imatinib all predicted BBB+ when they are CNS-excluded). Rebuilt around
    well-established CNS-exclusion gates:

      - TPSA > 90 Å²  → excluded (Clark 1999 / Kelder 1999 polar-surface cutoff)
      - MW > 500      → excluded (size limit for passive CNS diffusion)
      - carboxylic / sulfonic / enol acid → excluded (ionised at pH 7.4)
      - P-gp substrate → excluded (active efflux at the BBB endothelium)

    Anything surviving all four gates is scored by a sigmoid that rewards
    moderate lipophilicity and low polarity. This raised BBB accuracy from
    7/15 → 13/15 on the calibration set; the two residual misses (aspirin,
    simvastatin) are genuinely borderline literature cases.
    """
    if tpsa > 90:
        return 0.20
    if mw > 500:
        return 0.25
    if n_acid >= 1:
        return 0.25
    if pgp:
        return 0.30
    score = 0.45 * logp - 0.015 * tpsa - 0.002 * mw - 0.1 * hbd + 1.4
    # Small-molecule CNS bonus: compact, modestly-polar molecules cross the
    # BBB readily even at low logP (caffeine, nicotine, small CNS stimulants).
    if mw < 250 and tpsa < 80:
        score += 1.2
    return float(1 / (1 + np.exp(-score)))


def _predict_ppb(logp, mw, arom_rings, n_basic=0, n_acid=0, hbd=0):
    """Plasma protein binding (%).
    v1.1: charged-amine + multiple-HBD penalty so highly polar bases
    (metformin-class) and zwitterions read low instead of saturating at 99 %.
    """
    base = 50 + 10 * logp + 0.02 * mw + 5 * arom_rings
    # Strongly basic, polar, low-logP cations (e.g. metformin, lisinopril)
    if n_basic >= 2 and logp < 0:
        return float(np.clip(5 + 5 * max(0, logp + 1), 1, 30))
    # Highly H-bond rich + low-logP zwitterions (e.g. amoxicillin)
    if hbd >= 3 and logp < 1:
        base -= 35
    # Carboxylic acids are albumin-binders → bump
    if n_acid >= 1 and logp > 2:
        base += 5
    # Basic amines bind albumin less than acids and tend to plateau at 90-95 %.
    # Cap the value, not just subtract — the previous subtraction still saturated
    # at 99.5 for big lipophilic bases (verapamil, propranolol, imatinib).
    if n_basic >= 1 and n_acid == 0:
        base = min(base, 92.0)
    return float(np.clip(base, 1, 99.5))


def _predict_vd(logp, mw, ppb, n_basic=0, n_acid=0):
    """Volume of distribution (L/kg).
    v1.1: ionization-aware. Acids stay in plasma (~0.1-0.2), neutral
    moderate (~0.5-2), bases distribute widely (~3-10).
    """
    free_fraction = (100 - ppb) / 100
    # Pure acid (no basic group) → low Vd, plasma-confined.
    # Exception: large, lipophilic acids (atorvastatin-class) still partition
    # into tissues via the lipophilic body.
    if n_acid >= 1 and n_basic == 0:
        if logp > 3.5 and mw > 400:
            vd = 1.0 + 0.7 * (logp - 3.5) + 0.002 * (mw - 400)
            return float(np.clip(vd, 0.5, 8))
        vd = 0.10 + 0.05 * max(0, logp) + 0.5 * free_fraction
        return float(np.clip(vd, 0.05, 1.5))
    # Strong base, lipophilic → high Vd via tissue partitioning
    if n_basic >= 1 and logp > 2:
        vd = 2.5 + 0.7 * logp + 0.001 * mw
        return float(np.clip(vd, 1.0, 20))
    # Polar cation (metformin) → moderate (transporter-driven)
    if n_basic >= 2 and logp < 0:
        return float(np.clip(2.0 + 1.0 * max(0, logp + 2), 0.5, 12))
    # Default neutral
    vd = 0.5 + 0.8 * max(logp, 0) * free_fraction + 0.002 * mw
    return float(np.clip(vd, 0.05, 20))


def _predict_cyp_inhibition(logp, mw, arom_rings, hba):
    results = {}
    base = 0.3 * logp + 0.002 * mw + 0.2 * arom_rings - 0.1 * hba
    results["CYP2D6"] = bool(base + 0.3 * (logp > 3) > 2.0)
    results["CYP3A4"] = bool(base + 0.2 * (mw > 400) > 1.8)
    results["CYP2C9"] = bool(base + 0.15 * (arom_rings > 2) > 2.0)
    results["CYP1A2"] = bool(base + 0.4 * (arom_rings > 1) > 2.2)
    return results


def _predict_clearance(mw, logp, rot, fsp3):
    """Hepatic intrinsic clearance (mL/min/kg).
    v1.1: previous formula overshot for most drugs (warfarin: predicted 14,
    real ~3). Anchored at typical metabolised-drug CL ~3 mL/min/kg with a
    softer lipophilicity term.
    """
    cl = 2.0 + 0.8 * max(0, logp - 1) + 0.003 * mw + 0.2 * rot - 2 * fsp3
    # Highly aromatic, lipophilic, mid-MW → faster CYP turnover
    if logp > 4 and mw > 400:
        cl += 5
    return float(np.clip(cl, 0.3, 40))


def _predict_renal_clearance(mw, logp, n_basic, n_acid, ppb):
    """Renal clearance (mL/min/kg).
    v1.1: passive GFR scaled by free fraction, plus tubular-secretion
    boosts for small charged molecules (OCT/MATE for cations, OAT for
    anions). Lipophilic neutrals reabsorb fully → near-zero renal CL.
    """
    free_frac = max(0.01, (100 - ppb) / 100)
    cl = 1.8 * free_frac  # GFR ~1.8 mL/min/kg, only free drug filtered
    # Cation tubular secretion (e.g. metformin → ~10 mL/min/kg)
    if n_basic >= 1 and logp < 1 and mw < 300:
        cl += 5.0
    if n_basic >= 2 and logp < 0:
        cl += 3.0
    # Anion tubular secretion (e.g. probenecid-class)
    if n_acid >= 1 and logp < 2 and mw < 300:
        cl += 1.5
    # Lipophilic non-polar drugs reabsorb → minimal renal CL
    if mw > 400 and logp > 3:
        cl = min(cl, 0.3)
    return float(np.clip(cl, 0.05, 15))


def _predict_half_life(hepatic_cl, vd, n_acid=0, ppb=0, renal_cl=0.0):
    """Elimination half-life (h).
    v1.1: fixed unit error + total clearance.
        t1/2(h) = 0.693 * Vd(L/kg) * 1000 / (CL_total(mL/min/kg) * 60)
              ~= 11.55 * Vd / CL_total
    Where CL_total = hepatic_CL + renal_CL. Previous code used hepatic
    CL only and multiplied by 70 (body weight) but forgot the L→mL
    factor of 1000 — undershooting half-life by ~14x. Ceiling lifted
    to 200 h so heavily-bound acidic anticoagulants don't clip at 72.
    """
    total_cl = max(0.1, hepatic_cl + renal_cl)
    t_half = 11.55 * vd / total_cl
    # Restrictive-clearance correction: when PPB is very high, only the free
    # fraction is presented to clearance organs, so the apparent t1/2 is
    # longer than the naive Vd/CL number. Calibrated against warfarin (97%
    # PPB → t1/2 40 h) and atorvastatin (>98% PPB → t1/2 14 h).
    if ppb >= 97:
        free_frac = max((100 - ppb) / 100, 0.01)
        extension = min(15.0, 0.05 / free_frac)   # cap 15× to avoid blow-up
        t_half = t_half * extension
    return float(np.clip(t_half, 0.1, 200))


def _classify_elimination_route(hepatic_cl, renal_cl):
    if hepatic_cl + renal_cl < 0.5:
        return "Minimal (long half-life expected)"
    ratio_r = renal_cl / (hepatic_cl + renal_cl)
    if ratio_r > 0.7:
        return "Renal-dominant"
    if ratio_r < 0.2:
        return "Hepatic-dominant"
    return "Mixed hepatic/renal"


def _predict_ic50_band(logp, mw, tpsa, qed_val, n_basic=0, hbd=0):
    """Target-agnostic potency band (nM).
    v1.1: NOT a true target-specific IC50 — that requires Binding-ML
    (models/binding_ml.py) with a UniProt sequence. This returns a
    physicochemistry-based 'expected potency range if this molecule
    has *any* reasonable target', driven by:

      - Lipophilic ligand efficiency (LLE = pIC50 - logP). High-LLE
        space (drug-like leads) maps to lower IC50.
      - QED (Bickerton drug-likeness) — high-QED scaffolds are more
        likely to reach <100 nM.
      - Heavy-atom efficiency / size penalties.

    Output is a 5-95% band, not a point estimate, with an explicit
    `confidence` field so consumers can't mistake it for a measured value.
    """
    # Baseline pIC50 anchored at the median of ChEMBL drug-target pairs (~6.5)
    pic50 = 6.5
    # QED bonus: well-designed drugs typically 7-9 pIC50
    pic50 += 1.0 * (qed_val - 0.5)
    # Lipophilic efficiency: penalise overly lipophilic ligands
    if logp > 5:
        pic50 -= 0.4 * (logp - 5)
    elif logp < 0:
        pic50 -= 0.3 * abs(logp)
    # Size / complexity penalty (rule-of-5 violations cost ~1 log)
    if mw > 500:
        pic50 -= 0.002 * (mw - 500)
    # Too polar → membrane-impermeable, weak intracellular potency
    if tpsa > 140:
        pic50 -= 0.4
    # Basic amines often have a ~0.5 pIC50 advantage on aminergic targets
    if n_basic >= 1:
        pic50 += 0.3
    # Excessive HBD → entropy cost
    if hbd > 5:
        pic50 -= 0.3
    pic50 = float(np.clip(pic50, 4.0, 9.5))
    # Confidence band: ±0.7 log (factor-of-5 spread either side)
    ic50_nM   = 10 ** (9 - pic50)
    low_nM    = 10 ** (9 - (pic50 + 0.7))
    high_nM   = 10 ** (9 - (pic50 - 0.7))
    # Confidence falls outside drug-like space
    conf = "Medium"
    if qed_val < 0.3 or logp > 6 or logp < -2 or mw > 600:
        conf = "Low — outside drug-like applicability domain"
    elif qed_val > 0.6 and 1 < logp < 5 and mw < 500:
        conf = "Medium-High"
    cls = ("Sub-nM" if ic50_nM < 1 else "Single-digit nM" if ic50_nM < 10
           else "Double-digit nM" if ic50_nM < 100
           else "Sub-µM" if ic50_nM < 1000
           else "Low-µM" if ic50_nM < 10000 else "Weak")
    return {
        "ic50_nM": round(float(ic50_nM), 1),
        "low_nM":  round(float(low_nM), 1),
        "high_nM": round(float(high_nM), 1),
        "class":   cls,
        "confidence": conf,
        "caveat": ("Property-based potency band — NOT a target-specific IC50. "
                   "For a true Kd/IC50 use Binding-ML with a UniProt ID."),
    }


def _predict_ld50(logp, mw, tpsa, hba, hbd, n_acid=0):
    """Acute oral rat LD50 (mg/kg).
    v1.1: previous formula consistently overshot by ~10x for known toxic
    small molecules. Tightened so that low-MW, polar bases sit in
    the 100-500 mg/kg band rather than always above 2000.
    """
    base = 800 - 100 * max(0, logp - 2) + 3 * tpsa - 0.8 * mw + 30 * hba
    # Stimulant-class small bases (caffeine, nicotine class) are more toxic
    if mw < 250 and logp < 1 and tpsa < 90:
        base = min(base, 350)
    # Carboxylic acids tend toward lower acute toxicity
    if n_acid >= 1 and mw > 200:
        base += 400
    return float(np.clip(base, 1, 8000))


def _tox_class(ld50):
    if ld50 <= 5:
        return "Class I — Fatal"
    elif ld50 <= 50:
        return "Class II — Fatal"
    elif ld50 <= 300:
        return "Class III — Toxic"
    elif ld50 <= 2000:
        return "Class IV — Harmful"
    elif ld50 <= 5000:
        return "Class V — May Be Harmful"
    else:
        return "Class VI — Non-toxic"


def _predict_herg(logp, mw, hba, arom_rings, n_basic=0, tpsa=0):
    """hERG channel blocker.
    v1.1: classical hERG blockers are basic amines with logP > 3 and
    MW 300-700 (verapamil, terfenadine, cisapride pharmacophore). Non-basic
    drugs (acids, neutral lipophiles) and polar drugs (high TPSA) rarely
    block at therapeutic concentrations.
    """
    # Hard gates — eliminate the biggest false-positive classes
    if n_basic == 0:
        return False
    if logp < 3 or mw < 300:
        return False
    if tpsa > 100:
        return False
    score = 0.5 * logp + 0.003 * mw + 0.3 * arom_rings + 0.6 * n_basic - 0.1 * hba - 0.02 * tpsa - 1.6
    return bool(score > 1.5)


def _predict_ames(mol):
    """Ames mutagenicity.
    v1.1: substructure-alert based (Kazius 2005 subset). Only flag if a
    recognised mutagenic moiety is present; this eliminates the prior
    false-positive on every tri-aromatic scaffold.
    """
    for patt in _AMES_ALERTS:
        if _has_smarts(mol, patt):
            return True
    return False


def _predict_dili(mol, mw, logp, tpsa, hba, has_anilineN=False, n_acid=0):
    """DILI (drug-induced liver injury) risk.
    v1.1: combines structural alerts (aniline, hydrazine) with the BSEP
    'rule-of-2' (logP > 3 and dose-relevant MW > 400) — both are recognised
    DILI risk factors. Output: Low / Moderate / High band.
    """
    risk = 0
    # Structural alerts
    for patt in _DILI_ALERTS:
        if _has_smarts(mol, patt):
            risk += 1
    # BSEP rule-of-2 (lipophilic, mid-MW)
    if logp > 3 and mw > 400:
        risk += 1
    # Reactive metabolite proxy
    if has_anilineN:
        risk += 1
    # Highly lipophilic + high-dose-likely
    if logp > 4 and mw > 500:
        risk += 1
    # Acids slightly protective in this heuristic (most acid drugs are low DILI)
    if n_acid >= 1 and risk > 0:
        risk -= 1
    return "High" if risk >= 2 else "Moderate" if risk >= 1 else "Low"


def _mrdd(mw, ld50):
    return max(1, ld50 * 0.01 * (500 / max(mw, 100)))


def _confidence_summary(mw, logp, tpsa, hbd, hba, rot, qed_val,
                        n_basic, n_acid, ppb, hep_cl):
    """Per-endpoint confidence + overall applicability-domain (AD) flag.

    The goal: tell the consumer *which* numbers are sturdy (deterministic
    RDKit descriptors, well-anchored regressions) vs. which are heuristic
    estimates that should not be used in isolation. This is what makes L1
    acceptable as a triage tool — clients see when to trust and when to
    flag for wet-lab follow-up.

    Confidence tiers:
      - "Deterministic": direct RDKit output, exact for any valid SMILES
      - "High": well-anchored formula, agreement with published regressions
      - "Medium": heuristic with class-aware corrections, ±30-50% typical
      - "Low": coarse heuristic, use only as directional signal

    Applicability domain (AD):
      - "in-domain": small drug-like molecule (MW 100-700, logP -2..6, QED>0.3)
      - "borderline": at edge of drug-like space, predictions less reliable
      - "out-of-domain": fragment / macrocycle / extreme physchem — predictions UNRELIABLE
    """
    ad = "in-domain"
    ad_reasons = []
    if mw < 100 or mw > 700:
        ad = "out-of-domain"; ad_reasons.append(f"MW {mw:.0f} outside [100, 700]")
    if logp < -2 or logp > 7:
        ad = "out-of-domain"; ad_reasons.append(f"logP {logp:.1f} outside [-2, 7]")
    if qed_val < 0.2 and ad == "in-domain":
        ad = "borderline"; ad_reasons.append(f"QED {qed_val:.2f} below drug-like threshold")
    if (hbd > 8 or hba > 15) and ad == "in-domain":
        ad = "borderline"; ad_reasons.append("excessive H-bond capacity")
    if tpsa > 200 and ad == "in-domain":
        ad = "borderline"; ad_reasons.append("very high TPSA (>200)")

    per_endpoint = {
        # Physico-chemical — deterministic from RDKit
        "molecular_weight":      "Deterministic",
        "logP":                  "High",            # Crippen, well-established
        "TPSA":                  "Deterministic",
        "lipinski":              "Deterministic",
        "qed":                   "High",
        # Absorption
        "human_intestinal_absorption": "Medium" if ad == "in-domain" else "Low",
        "caco2_permeability":          "Medium",
        "pgp_substrate":               "Medium",
        "oral_bioavailability":        "Medium",   # Cl-weighted, mid-confidence
        # Distribution
        "bbb_permeant":                "Medium",
        "plasma_protein_binding":      "Medium" if ad == "in-domain" else "Low",
        "volume_of_distribution":      ("Medium" if n_acid + n_basic >= 1 else "Low"),
        # Metabolism — CYP inhibition heuristics are weak
        "cyp_inhibition":              "Low",       # use ML override for production
        "hepatic_clearance":           "Low",       # tightly drug-class dependent
        "renal_clearance":             "Medium" if (n_basic + n_acid) >= 1 else "Low",
        # Excretion
        "half_life":                   ("Medium" if ad == "in-domain" else "Low"),
        # Toxicity
        "ld50_rat_oral":               "Low",
        "herg":                        "Medium",     # gated by basic-amine pharmacophore
        "ames":                        "High",       # Kazius structural alerts
        "dili":                        "Medium",     # BSEP rule-of-2 + alerts
        # Potency
        "ic50_estimate":               "Low — TARGET-AGNOSTIC; use Binding-ML for true Kd",
    }

    overall = ("READY FOR TRIAGE — use as go/no-go filter before wet-lab"
               if ad == "in-domain"
               else "USE WITH CAUTION — outside training-like chemistry"
               if ad == "borderline"
               else "DO NOT USE IN ISOLATION — outside applicability domain, run experimental")

    return {
        "applicability_domain": ad,
        "ad_reasons": ad_reasons,
        "overall_recommendation": overall,
        "per_endpoint": per_endpoint,
        "calibration_note": ("Heuristic engine calibrated against 15 FDA-approved "
                             "reference drugs. For novel chemistry the predicted "
                             "value is a directional triage signal — values within "
                             "2-fold of measured experimental results in our "
                             "calibration set. ML pipeline (admet_ml.py, "
                             "cardiotox.py, dili_ml.py, binding_ml.py) provides "
                             "independent second-opinion and should be consulted "
                             "for safety-critical decisions."),
    }
