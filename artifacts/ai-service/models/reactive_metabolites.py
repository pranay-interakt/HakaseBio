"""Reactive metabolite structural alert scanner.

Screens a molecule against a panel of 25 literature-curated structural alerts
that are known precursors to reactive, protein-binding metabolites — the
leading mechanistic explanation for idiosyncratic drug-induced liver injury
(iDILI) and immune-mediated adverse reactions.

References
----------
- Kalgutkar & Didiuk (2009) Chem Biodiversity 6:2115
- Stepan et al. (2011) J Med Chem 54:7772
- Baell & Holloway (2010) J Med Chem 53:2719  (PAINS overlap)
- FDA Nitrosamine Impurity Guidance (2021)
- Monks & Jones (1992) Chem Res Toxicol — quinones
- Dalvie et al. (2002) Chem Res Toxicol — furans
"""

from __future__ import annotations
from typing import Any
from rdkit import Chem

# ---------------------------------------------------------------------------
# SMARTS alert panel
# ---------------------------------------------------------------------------
# Each entry: (id, name, smarts_str, severity, mechanism, examples, mitigation, reference)
# Severity: "critical" | "high" | "moderate"

_PANEL_RAW: list[tuple[str, str, str, str, str, str, str, str]] = [
    # ── QUINONE-FORMING ────────────────────────────────────────────────────
    (
        "RM001", "Primary aromatic amine (aniline)",
        "[NH2;!$(NC=O);!$(NS=O);!$(NC=N);!$(N=*)]c",
        # Recalibrated critical→high (2026-06): validation on a 1,183-drug ChEMBL
        # hold-out showed this motif fires on 8.8% of APPROVED vs 7.7% of withdrawn
        # drugs — non-discriminating, so it must flag-to-monitor, not auto-veto. It
        # is present in hundreds of approved drugs (sulfonamides, procainamide, …).
        "high",
        "N-Hydroxylation by CYP1A2/3A4 → hydroxylamine → nitroso → protein adducts; quinone imine metabolites cause idiosyncratic hepatotoxicity",
        "Acetaminophen (via NAPQI), sulfanilamide, amodiaquine",
        "N-Acylation; switch to tetrazole/sulfonamide bioisostere; introduce steric block at N",
        "Kalgutkar 2009; Stepan 2011",
    ),
    (
        "RM002", "Secondary aromatic amine",
        "[NH1;!$(NC=O);!$(NS=O);!$(NC=N);!$(N=*)]c",
        "moderate",
        "Less efficient N-hydroxylation than primary aniline; CYP1A2 substrate; associated with dapsone hydroxylamine",
        "Diphenylamine, N-methylaniline, dapsone",
        "N-Acylation; add steric bulk α to N",
        "Kalgutkar 2009",
    ),
    (
        "RM003", "Catechol (o-dihydroxybenzene)",
        "Oc1ccccc1O",
        "high",
        "2-Electron oxidation → reactive o-quinone; alkylates Cys/Lys; redox cycling generates ROS; associated with dopaminergic neurotoxicity",
        "Catecholamines (dopamine, norepinephrine), catechol estrogens, levodopa",
        "O-Methylation at one hydroxyl; introduce meta-substituent to block oxidation",
        "Monks & Jones 1992",
    ),
    (
        "RM004", "Hydroquinone (p-dihydroxybenzene)",
        "Oc1ccc(O)cc1",
        "high",
        "2-Electron oxidation → p-benzoquinone; Michael acceptor; topoisomerase II inhibitor; benzene carcinogenicity pathway",
        "Benzene → hydroquinone → quinone; acetaminophen p-aminophenol metabolite",
        "Block C1/C4 oxidation with methyl/fluoro substituents",
        "Barratt 2011",
    ),
    (
        "RM005", "o-Aminophenol",
        "[NH2;!$(NC=O)]c1ccccc1O",
        "high",
        "CYP oxidation → o-quinone imine; more reactive than catechol; idiosyncratic hepatotoxicity",
        "Amodiaquine metabolite, 4-aminophenol (paracetamol metabolite)",
        "Block ortho-OH with methyl ether; replace aromatic amine",
        "Kalgutkar 2009",
    ),
    (
        "RM006", "p-Aminophenol",
        "[NH2;!$(NC=O)]c1ccc(O)cc1",
        "high",
        "Oxidation → N-acetyl-p-benzoquinone imine (NAPQI analog); nephrotoxic; forms methemoglobin",
        "4-Aminophenol, acetaminophen analog",
        "N-Acylation; block para-OH",
        "Kalgutkar 2009",
    ),
    (
        "RM007", "Quinone (direct)",
        "O=C1C=CC(=O)C=C1",
        "critical",
        "Direct Michael acceptor; redox cycling → ROS; alkylates GSH/Cys/Lys; BSEP inhibitor; NAPQI is the canonical hepatotoxic quinone imine",
        "p-Benzoquinone, NAPQI (acetaminophen metabolite), mitomycin C",
        "Reduce to hydroquinone for delivery; protect positions with methyl groups",
        "Monks 1992; Pumford 1997",
    ),
    (
        "RM007b", "para-Hydroxy acetanilide (NAPQI precursor)",
        "Oc1ccc(NC(=O))cc1",
        "high",
        "CYP2E1/CYP3A4 oxidation → N-acetyl-p-benzoquinone imine (NAPQI); depletes hepatic GSH at supratherapeutic doses; canonical dose-dependent hepatotoxin; dose-dependent iDILI",
        "Acetaminophen (paracetamol), phenacetin metabolite",
        "Replace phenol with N-acetyl group; move OH to meta position; block C1 para carbon with F",
        "Pumford 1997 J Pharmacol Exp Ther; Jollow 1973 Pharmacology",
    ),
    # ── FURAN / THIOPHENE ──────────────────────────────────────────────────
    (
        "RM008", "Furan ring",
        "c1ccoc1",
        "critical",
        "CYP3A4 epoxidation → cis-2-en-1,4-dione (enedione); alkylates Lys ε-amino groups; associated with hepatotoxicity of furosemide, ipomeanine, menthofuran",
        "Furosemide, nitrofurantoin, menthofuran (pulegone metabolite), furantoin",
        "Saturate ring → tetrahydrofuran; replace O with N (pyrrole bioisostere); methyl-block C2 and C5",
        "Dalvie 2002; Peterson 1992",
    ),
    (
        "RM009", "Thiophene ring",
        "c1ccsc1",
        "high",
        "CYP2C8/3A4 oxidation → thiophene S-oxide or 2,3-epoxide; protein adduction; agranulocytosis (ticlopidine) and hepatotoxicity (tienilic acid)",
        "Ticlopidine, tienilic acid, methapyrilene, clopidogrel",
        "Fluoro/methyl C2-substitution reduces ring oxidation; replace with phenyl or pyridine",
        "Dansette 1998; Mansuy 1991",
    ),
    # ── MICHAEL ACCEPTORS ──────────────────────────────────────────────────
    (
        "RM010", "α,β-Unsaturated carbonyl (Michael acceptor)",
        "[CX3]=[CX3][CX3]=[OX1]",
        # Recalibrated critical→high (2026-06): fires on 6.4% of APPROVED vs 5.9%
        # of withdrawn on the validation hold-out — non-discriminating. Michael
        # acceptors are the INTENTIONAL warhead of approved covalent drugs
        # (afatinib, neratinib, …), so this is a confirm-selectivity flag, not an
        # auto-veto. The scorecard's covalent-intent logic handles it downstream.
        "high",
        "1,4-Conjugate addition of biological nucleophiles (GSH, protein Cys, Lys, His); depletes cellular glutathione; NAPQI mechanism; parthenolide class",
        "Acrolein, methyl vinyl ketone, NAPQI, parthenolide, α-methylene lactones",
        "Reduce C=C bond; add α-methyl group; use saturated analog",
        "Enoch 2008; Schultz 2005",
    ),
    (
        "RM011", "Maleimide",
        "N1C(=O)[CH]=[CH]C1=O",
        "critical",
        "Potent Michael acceptor ring; highly efficient thiol alkylator (used intentionally in ADC linkers); pan-reactive at systemic doses",
        "N-Ethylmaleimide (NEM), maleimide ADC linkers",
        "Saturate ring; use only as targeted covalent warhead",
        "Meng 2004",
    ),
    (
        "RM012", "Vinyl sulfone",
        "[CX3]=[CX3]S(=O)(=O)",
        "critical",
        "Potent irreversible Cys alkylator; stronger Michael acceptor than α,β-unsaturated ketone; used as covalent probe but pan-reactive systemically",
        "Vinyl sulfone cysteine protease inhibitors",
        "Attenuate electrophilicity with α-substituents; restrict to targeted covalent use",
        "Brouwer 2014",
    ),
    (
        "RM013", "Acrylate / acrylamide",
        "[CH2]=[CX3]C(=O)[OX2,NX3]",
        "high",
        "Weaker Michael acceptor; acrylamide alkylates Hb-Val and protein Cys; associated with neuropathy; acrylates sensitise skin",
        "Acrylamide, methyl acrylate, acryloyl chloride",
        "α-Methyl substitution reduces reactivity substantially; fully saturate C=C",
        "Schultz 2005; Tanii 1988",
    ),
    # ── DIRECT ALKYLATING AGENTS ───────────────────────────────────────────
    (
        "RM014", "Epoxide (direct)",
        "C1OC1",
        "critical",
        "SN2 alkylation of DNA N7-guanine and protein Cys/His/Lys; potent mutagen and carcinogen; EH is protective but saturable at high doses",
        "Styrene oxide, carbamazepine-10,11-epoxide, benzo[a]pyrene-7,8-epoxide",
        "Avoid entirely; verify epoxide hydrolase turnover if essential; use hydrate prodrug",
        "Kadlubar 1980; Sohl 1994",
    ),
    (
        "RM015", "Acyl halide",
        "[CX3](=O)[F,Cl,Br,I]",
        "critical",
        "Extreme electrophilicity; instantaneous acylation of Ser, Lys, His, Tyr in proteins; haptenation → immune-mediated ADRs",
        "Acid chlorides, acyl fluorides, phosgene (chloroform metabolite)",
        "Avoid in systemic drugs; hydrolyse to carboxylic acid; use NHS-ester for targeted delivery",
        "Baillie 2006",
    ),
    (
        "RM016", "Anhydride",
        "[CX3](=O)O[CX3](=O)",
        "high",
        "Rapid acylation of biological nucleophiles; protein haptenation; respiratory sensitisation at low concentrations (OSHA classification)",
        "Maleic anhydride, acetic anhydride, phthalic anhydride",
        "Use corresponding diacid; employ ester prodrug strategy",
        "Aptula 2008",
    ),
    (
        "RM017", "α-Haloketone / α-haloester",
        "[CX4;H2,H1]([F,Cl,Br,I])[CX3]=[OX1]",
        "critical",
        "SN2 alkylation of nucleophiles; bis-alkylating if gem-dihalo; genotoxic in Ames test; associated with nitrogen mustard class toxicity",
        "Chloroacetone, chloroacetaldehyde (vinyl chloride metabolite), iodoacetamide",
        "Remove halogen; use equivalent ketone without α-halo",
        "Enoch 2011",
    ),
    (
        "RM018", "Aziridine",
        "N1CC1",
        "critical",
        "Highly strained 3-membered N ring; ring-opening SN2 with DNA N7-guanine; alkylating agent; used as cytotoxic warhead in oncology",
        "Mitomycin C, thiotepa, ethyleneimine",
        "Prodrug activation; restrict to oncology with clear therapeutic window",
        "Colvin 1988",
    ),
    (
        "RM019", "β-Propiolactone / β-lactone",
        "O=C1CCO1",
        "critical",
        "Strained ring SN2 alkylator; IARC Group 2B carcinogen; not used therapeutically; may appear as synthetic impurity",
        "β-Propiolactone, β-butyrolactone",
        "Eliminate from synthesis; not acceptable in drug products",
        "IARC 1974",
    ),
    # ── HYDRAZINE / NITROSO / NITRO ────────────────────────────────────────
    (
        "RM020", "Hydrazine / hydrazide",
        "[NX3;H2,H1;!$(NC=O)][NX3;H2,H1]",
        "critical",
        "MAO / CYP oxidation → diazene → free radical or carbocation; DNA methylation; isoniazid hepatotoxicity, hydralazine-induced lupus; CYP2E1 induction",
        "Isoniazid (hydrazide), hydralazine, procarbazine",
        "Replace N-N with stable bioisostere; use amide instead of hydrazide; add blocking acyl group",
        "Hein 1988; Timbrell 1980",
    ),
    (
        "RM021", "Aromatic nitro group",
        "[c][N+](=O)[O-]",
        "high",
        "Nitroreduction (gut bacteria / xanthine oxidase / NQO1) → hydroxylamine → nitroso → DNA adducts; potential aromatic amine carcinogenicity pathway",
        "Nitrofurantoin, chloramphenicol, metronidazole (5-nitroimidazole class)",
        "Replace with CN, CF3, F bioisostere; use nitroimidazole only when anaerobic activation is the mechanism",
        "Kalgutkar 2009; Mason 1979",
    ),
    (
        "RM022", "Aliphatic nitro group",
        "[CX4][N+](=O)[O-]",
        "high",
        "Nitroreduction to hydroxylamine; Ames-positive; genotoxic; 2-nitropropane is a hepatocarcinogen",
        "2-Nitropropane, nitromethane",
        "Avoid aliphatic nitro; substitute with sulfone or equivalent EWG",
        "Kalgutkar 2009",
    ),
    (
        "RM023", "Nitrosamine",
        "[N;!$(NC=O);!$(N=O);!$(N[N])][NX2]=O",
        "critical",
        "Direct alkylating agent after α-hydroxylation → carbonium ion; IARC 2A/2B carcinogens; FDA mandated nitrosamine impurity programme since 2019",
        "NDMA (valsartan impurity), NDEA, nitrosodiethanolamine",
        "Eliminate N-N=O from structure and synthesis; remove nitrous acid steps; use ICH M7 mutagenic impurity controls",
        "IARC Monograph 17; FDA Nitrosamine Guidance 2021",
    ),
    # ── ALDEHYDE ───────────────────────────────────────────────────────────
    (
        "RM024", "Aldehyde",
        "[CX3H1](=O)",
        "high",
        "Schiff base with Lys ε-amino; reversible but accumulates on long-lived proteins; oxidative stress; most are metabolites (acetaldehyde, formaldehyde from N-demethylation)",
        "Formaldehyde, acetaldehyde, malondialdehyde, 4-hydroxynonenal",
        "Oxidise to acid; use acetal prodrug; avoid N-demethylation pathways that release formaldehyde",
        "LoPachin 2009; Esterbauer 1991",
    ),
    # ── OTHER ELECTROPHILES ─────────────────────────────────────────────────
    (
        "RM025", "Isocyanate",
        "[NX2]=[CX2]=[OX1]",
        "critical",
        "Rapid carbamylation of Ser, Lys, Tyr; skin and respiratory sensitiser; TDI is OSHA carcinogen; methyl isocyanate (Bhopal disaster)",
        "TDI, MDI, methyl isocyanate",
        "Block as carbamate (reacts with alcohol); not usable in systemic oral drugs",
        "Wisnewski 2011",
    ),
    (
        "RM026", "Gem-dihaloalkyl (potential bis-alkylator)",
        "[CX4]([F,Cl,Br,I])[F,Cl,Br,I]",
        "moderate",
        "Sequential SN2 cross-linking; mutagenic; gemcitabine (2,2-difluoro) is therapeutically useful but only because of high selectivity for ribonucleotide reductase",
        "Gemcitabine (therapeutic), dichloromethane",
        "Avoid unless intended covalent warhead with validated selectivity",
        "Plunkett 1995",
    ),
]


# ---------------------------------------------------------------------------
# Compile SMARTS at import time
# ---------------------------------------------------------------------------
_PANEL: list[dict[str, Any]] = []
for (_id, _name, _sma, _sev, _mech, _ex, _mit, _ref) in _PANEL_RAW:
    pat = Chem.MolFromSmarts(_sma)
    if pat is not None:
        _PANEL.append({
            "id": _id,
            "name": _name,
            "smarts": _sma,
            "pattern": pat,
            "severity": _sev,
            "mechanism": _mech,
            "examples": _ex,
            "mitigation": _mit,
            "reference": _ref,
        })

# Severity rank for sorting
_SEV_RANK = {"critical": 3, "high": 2, "moderate": 1}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_reactive_metabolites(smiles: str) -> dict[str, Any]:
    """Screen a molecule for reactive-metabolite structural alerts.

    Returns
    -------
    dict with keys:
      smiles          — input (and canonicalised) SMILES
      alerts          — list of triggered alerts sorted by severity
      alert_count     — total number of triggered alerts
      critical_count  — number of critical-severity alerts
      high_count      — number of high-severity alerts
      rm_score        — composite risk score 0–100
      rm_class        — "High Risk" | "Moderate Risk" | "Low Risk" | "Negligible"
      in_domain       — always True (rule-based, universal coverage)
      model_info      — provenance
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    # Canonicalise
    try:
        mol = Chem.MolFromSmiles(smiles.strip())
        if mol is None:
            raise ValueError(f"Invalid SMILES: {smiles!r}")
        smiles = Chem.MolToSmiles(mol, canonical=True)
    except Exception as exc:
        raise ValueError(f"SMILES parse failed: {exc}") from exc

    mol = Chem.MolFromSmiles(smiles)

    # Screen all alerts
    triggered: list[dict[str, Any]] = []
    for entry in _PANEL:
        matches = mol.GetSubstructMatches(entry["pattern"])
        if matches:
            triggered.append({
                "id": entry["id"],
                "name": entry["name"],
                "smarts": entry["smarts"],
                "severity": entry["severity"],
                "match_count": len(matches),
                "mechanism": entry["mechanism"],
                "examples": entry["examples"],
                "mitigation": entry["mitigation"],
                "reference": entry["reference"],
            })

    # Sort: critical → high → moderate, then by id
    triggered.sort(key=lambda a: (-_SEV_RANK[a["severity"]], a["id"]))

    # Composite score
    # Critical alert: 35 pts each (capped at 100); High: 15 pts; Moderate: 5 pts
    raw_score = 0
    for a in triggered:
        raw_score += {"critical": 35, "high": 15, "moderate": 5}[a["severity"]]
    rm_score = min(100, raw_score)

    # Classification
    n_crit = sum(1 for a in triggered if a["severity"] == "critical")
    n_high = sum(1 for a in triggered if a["severity"] == "high")

    if n_crit >= 1:
        rm_class = "High Risk"
    elif n_high >= 2 or rm_score >= 30:
        rm_class = "Moderate Risk"
    elif len(triggered) > 0:
        rm_class = "Low Risk"
    else:
        rm_class = "Negligible"

    return {
        "smiles": smiles,
        "alerts": triggered,
        "alert_count": len(triggered),
        "critical_count": n_crit,
        "high_count": n_high,
        "moderate_count": sum(1 for a in triggered if a["severity"] == "moderate"),
        "rm_score": rm_score,
        "rm_class": rm_class,
        "in_domain": True,  # structural rules apply universally
        "model_info": {
            "engine": "HakaseAI Reactive Metabolite Alert Panel v1.0",
            "method": "Structural alert SMARTS screening (26 patterns, literature-curated)",
            "alert_count_in_panel": len(_PANEL),
            "references": [
                "Kalgutkar & Didiuk (2009) Chem Biodiversity 6:2115",
                "Stepan et al. (2011) J Med Chem 54:7772",
                "Dalvie et al. (2002) Chem Res Toxicol",
                "FDA Nitrosamine Impurity Guidance (2021)",
            ],
        },
    }
