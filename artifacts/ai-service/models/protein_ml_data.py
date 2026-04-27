"""Curated UniProt training set for the ESM-2 druggability head.

POSITIVES: well-characterised human proteins that are direct targets of
multiple FDA-approved small-molecule drugs (kinases, GPCRs, NRs, ion
channels, proteases, transporters, metabolic enzymes).

NEGATIVES: human proteins with no known FDA-approved small-molecule
modulator -- typically essential housekeeping (ribosomal subunits, histones,
core spliceosome / nuclear pore / mitochondrial respiratory complex
components, large structural / cytoskeletal scaffolds, generally regarded
"undruggable" transcription factors).

Each tuple is (uniprot_id, label, short_note). Notes are human-readable and
exist purely so a curator can sanity-check why a protein landed in a class.

The lists are intentionally kept around 80 entries each so the offline
training step takes minutes rather than hours on CPU. They are not exhaustive;
they are a defensible, reproducible seed for a binary "is this protein the
sort of thing that small molecules tend to bind well to?" classifier.
"""

from __future__ import annotations

from typing import List, Tuple

# (uniprot_id, label, note)
_Entry = Tuple[str, int, str]

POSITIVES: List[_Entry] = [
    # --- Kinases (broadly drugged target class) ---
    ("P00533", 1, "EGFR — gefitinib, erlotinib, osimertinib"),
    ("P15056", 1, "BRAF — vemurafenib, dabrafenib, encorafenib"),
    ("P00519", 1, "ABL1 — imatinib, dasatinib, nilotinib"),
    ("P10721", 1, "KIT — imatinib, sunitinib, regorafenib"),
    ("P35968", 1, "KDR / VEGFR2 — sunitinib, axitinib, lenvatinib"),
    ("Q02750", 1, "MAP2K1 / MEK1 — trametinib, cobimetinib, binimetinib"),
    ("P11802", 1, "CDK4 — palbociclib, ribociclib, abemaciclib"),
    ("Q00534", 1, "CDK6 — palbociclib, ribociclib, abemaciclib"),
    ("Q06187", 1, "BTK — ibrutinib, acalabrutinib, zanubrutinib"),
    ("P23458", 1, "JAK1 — tofacitinib, baricitinib, upadacitinib"),
    ("O60674", 1, "JAK2 — ruxolitinib, fedratinib, pacritinib"),
    ("Q9UM73", 1, "ALK — crizotinib, alectinib, brigatinib, lorlatinib"),
    ("P08922", 1, "ROS1 — crizotinib, entrectinib, repotrectinib"),
    ("P42345", 1, "MTOR — sirolimus, everolimus, temsirolimus"),
    ("P31749", 1, "AKT1 — capivasertib, miransertib"),
    ("P42336", 1, "PIK3CA — alpelisib, inavolisib"),
    ("P04626", 1, "ERBB2 / HER2 — lapatinib, neratinib, tucatinib"),
    ("P36888", 1, "FLT3 — midostaurin, gilteritinib, quizartinib"),
    ("P08581", 1, "MET — capmatinib, tepotinib, crizotinib"),
    ("P07949", 1, "RET — selpercatinib, pralsetinib"),
    ("Q05655", 1, "PRKCD / PKC — staurosporine analogs, midostaurin"),
    ("P04049", 1, "RAF1 / CRAF — sorafenib, regorafenib"),
    # --- GPCRs ---
    ("P08588", 1, "ADRB1 — metoprolol, atenolol, bisoprolol, carvedilol"),
    ("P07550", 1, "ADRB2 — albuterol, salmeterol, formoterol"),
    ("P14416", 1, "DRD2 — haloperidol, risperidone, olanzapine"),
    ("P35367", 1, "HRH1 — loratadine, cetirizine, diphenhydramine"),
    ("P25021", 1, "HRH2 — cimetidine, ranitidine, famotidine"),
    ("P28223", 1, "HTR2A — clozapine, risperidone, olanzapine"),
    ("P20309", 1, "CHRM3 — tiotropium, ipratropium, oxybutynin"),
    ("P35348", 1, "ADRA1A — tamsulosin, doxazosin, prazosin"),
    ("P30556", 1, "AGTR1 — losartan, valsartan, irbesartan"),
    ("P35372", 1, "OPRM1 — morphine, oxycodone, fentanyl"),
    ("P51681", 1, "CCR5 — maraviroc"),
    ("P08908", 1, "HTR1A — buspirone, vilazodone, vortioxetine"),
    ("P21728", 1, "DRD1 — chlorpromazine, fenoldopam"),
    ("P21554", 1, "CNR1 — rimonabant (historical), nabilone partial"),
    # --- Nuclear receptors ---
    ("P03372", 1, "ESR1 — tamoxifen, raloxifene, fulvestrant"),
    ("P10275", 1, "AR — enzalutamide, apalutamide, bicalutamide"),
    ("P04150", 1, "NR3C1 / GR — dexamethasone, prednisone, hydrocortisone"),
    ("P37231", 1, "PPARG — pioglitazone, rosiglitazone"),
    ("P11473", 1, "VDR — calcitriol, paricalcitol"),
    ("P06401", 1, "PGR — mifepristone, ulipristal, progesterone"),
    # --- Ion channels (broadly drugged) ---
    ("Q12809", 1, "KCNH2 / hERG — many drugs bind (off-target liability)"),
    ("P35498", 1, "SCN1A — lacosamide, oxcarbazepine, eslicarbazepine"),
    ("Q14524", 1, "SCN5A — lidocaine, mexiletine, flecainide"),
    ("Q13936", 1, "CACNA1C — amlodipine, nifedipine, diltiazem"),
    # --- Metabolic / housekeeping enzymes that are drugged ---
    ("P04035", 1, "HMGCR — atorvastatin, simvastatin, rosuvastatin"),
    ("P12821", 1, "ACE — lisinopril, enalapril, ramipril"),
    ("P27487", 1, "DPP4 — sitagliptin, saxagliptin, linagliptin"),
    ("P35354", 1, "PTGS2 / COX2 — celecoxib, etoricoxib, valdecoxib"),
    ("P23219", 1, "PTGS1 / COX1 — aspirin, ibuprofen, naproxen"),
    ("P21397", 1, "MAOA — moclobemide, isocarboxazid, phenelzine"),
    ("P27338", 1, "MAOB — selegiline, rasagiline, safinamide"),
    ("P22303", 1, "ACHE — donepezil, rivastigmine, galantamine"),
    ("P56817", 1, "BACE1 — verubecestat, atabecestat (extensively drugged)"),
    ("O76074", 1, "PDE5A — sildenafil, tadalafil, vardenafil"),
    ("Q08499", 1, "PDE4D — apremilast, roflumilast, crisaborole"),
    ("Q13547", 1, "HDAC1 — vorinostat, romidepsin, panobinostat"),
    ("Q9UBN7", 1, "HDAC6 — ricolinostat, citarinostat"),
    ("P14902", 1, "IDO1 — epacadostat, navoximod"),
    ("P09874", 1, "PARP1 — olaparib, niraparib, talazoparib"),
    ("Q9UGN5", 1, "PARP2 — olaparib, niraparib, talazoparib"),
    ("P00374", 1, "DHFR — methotrexate, pemetrexed, trimethoprim"),
    ("P04818", 1, "TYMS — 5-FU, capecitabine, raltitrexed"),
    ("P12268", 1, "IMPDH2 — mycophenolate, ribavirin"),
    ("P00734", 1, "F2 / thrombin — argatroban, dabigatran, bivalirudin"),
    ("P00742", 1, "F10 / FXa — apixaban, rivaroxaban, edoxaban"),
    ("P00533", 1, "EGFR — duplicate guard (kept once via dedup)"),
    # --- Transporters ---
    ("P31645", 1, "SLC6A4 / SERT — fluoxetine, sertraline, paroxetine"),
    ("P23975", 1, "SLC6A2 / NET — atomoxetine, reboxetine, viloxazine"),
    ("Q01959", 1, "SLC6A3 / DAT — methylphenidate, modafinil"),
    ("Q05940", 1, "SLC18A2 / VMAT2 — tetrabenazine, valbenazine"),
    ("Q96S37", 1, "SLC22A12 / URAT1 — probenecid, lesinurad, dotinurad"),
    # --- Other validated drug targets ---
    ("P07900", 1, "HSP90AA1 — luminespib, ganetespib, retaspimycin"),
    ("Q9H4B7", 1, "TUBB1 — paclitaxel, docetaxel, vinblastine"),
    ("P11387", 1, "TOP1 — topotecan, irinotecan, belotecan"),
    ("P11388", 1, "TOP2A — etoposide, doxorubicin, mitoxantrone"),
    ("P10415", 1, "BCL2 — venetoclax, navitoclax"),
    ("P01116", 1, "KRAS — sotorasib, adagrasib (G12C inhibitors)"),
    ("Q15119", 1, "PDK2 — dichloroacetate-class metabolic modulators"),
    ("P00747", 1, "PLG / plasminogen — tranexamic acid, aminocaproic acid"),
    ("P00797", 1, "REN / renin — aliskiren"),
]

NEGATIVES: List[_Entry] = [
    # --- Ribosomal proteins (essential, no approved small-mol drug) ---
    ("P23396", 0, "RPS3 — small ribosomal subunit"),
    ("P62701", 0, "RPS4X — small ribosomal subunit"),
    ("P62753", 0, "RPS6 — small ribosomal subunit"),
    ("P46781", 0, "RPS9 — small ribosomal subunit"),
    ("P62277", 0, "RPS13 — small ribosomal subunit"),
    ("P62269", 0, "RPS18 — small ribosomal subunit"),
    ("P46777", 0, "RPL5 — large ribosomal subunit"),
    ("P18124", 0, "RPL7 — large ribosomal subunit"),
    ("P27635", 0, "RPL10 — large ribosomal subunit"),
    ("P62913", 0, "RPL11 — large ribosomal subunit"),
    ("P26373", 0, "RPL13 — large ribosomal subunit"),
    ("Q07020", 0, "RPL18 — large ribosomal subunit"),
    ("P61353", 0, "RPL27 — large ribosomal subunit"),
    ("P39023", 0, "RPL3 — large ribosomal subunit"),
    # --- Histones (broadly essential, no small-mol drug at the histone) ---
    ("P07305", 0, "H1.0 — linker histone"),
    ("P16401", 0, "H1.5 / HIST1H1B — linker histone"),
    ("P16104", 0, "H2A.X / H2AFX — core histone variant"),
    ("P62807", 0, "H2B / HIST1H2BC — core histone"),
    ("P84243", 0, "H3.3 / H3F3A — core histone variant"),
    ("P62805", 0, "H4 / HIST1H4A — core histone"),
    # --- Translation factors ---
    ("P47813", 0, "EIF1AX — translation initiation factor"),
    ("P05198", 0, "EIF2S1 — translation initiation factor"),
    ("Q14152", 0, "EIF3A — translation initiation factor"),
    ("P55884", 0, "EIF3B — translation initiation factor"),
    ("P68104", 0, "EEF1A1 — translation elongation factor"),
    ("P13639", 0, "EEF2 — translation elongation factor"),
    # --- Generally undruggable transcription factors ---
    ("P01106", 0, "MYC — paradigmatic 'undruggable' TF"),
    ("P04198", 0, "MYCN — undruggable TF"),
    ("P04637", 0, "TP53 — no approved small-mol drug at p53 itself"),
    ("Q16665", 0, "HIF1A — no approved direct binder"),
    ("O43524", 0, "FOXO3 — TF, no approved drug"),
    ("P35222", 0, "CTNNB1 / beta-catenin — no approved drug"),
    ("P01100", 0, "FOS — TF, no approved drug"),
    ("P05412", 0, "JUN — TF, no approved drug"),
    # --- DNA repair scaffolds ---
    ("P38398", 0, "BRCA1 — scaffold, exploited via PARP synthetic lethality"),
    ("P51587", 0, "BRCA2 — scaffold, exploited via PARP synthetic lethality"),
    ("P43246", 0, "MSH2 — DNA mismatch repair"),
    ("P40692", 0, "MLH1 — DNA mismatch repair"),
    # --- Structural / cytoskeletal scaffolds ---
    ("P60709", 0, "ACTB — beta-actin, broadly essential"),
    ("P08670", 0, "VIM — vimentin"),
    ("P17661", 0, "DES — desmin"),
    ("P12883", 0, "MYH7 — beta cardiac myosin heavy chain"),
    ("P02545", 0, "LMNA — nuclear lamin A/C"),
    ("P05783", 0, "KRT18 — keratin"),
    # --- Spliceosome core ---
    ("O75533", 0, "SF3B1 — spliceosome core"),
    ("Q01081", 0, "U2AF1 — spliceosome"),
    ("Q07955", 0, "SRSF1 — splicing factor"),
    # --- Chromatin / cohesin / chromosomal scaffolds ---
    ("P49711", 0, "CTCF — chromatin organiser"),
    ("Q14683", 0, "SMC1A — cohesin core"),
    ("O60216", 0, "RAD21 — cohesin core"),
    ("P38919", 0, "EIF4A3 / exon junction complex"),
    # --- Mitochondrial respiratory complex subunits ---
    ("P28331", 0, "NDUFS1 — Complex I subunit"),
    ("O75306", 0, "NDUFS2 — Complex I subunit"),
    ("P31040", 0, "SDHA — Complex II subunit"),
    ("P25705", 0, "ATP5F1A — ATP synthase subunit"),
    # --- Nuclear pore complex ---
    ("P52948", 0, "NUP98 — nuclear pore"),
    ("P49790", 0, "NUP153 — nuclear pore"),
    ("P57740", 0, "NUP107 — nuclear pore"),
    # --- Chaperones / housekeeping (no approved drug at these) ---
    ("P11142", 0, "HSPA8 / HSC70 — constitutive chaperone, no approved drug"),
    ("P55072", 0, "VCP / p97 — drugs in trials but none approved"),
    ("P78371", 0, "CCT2 — chaperonin, no approved drug"),
    ("P60953", 0, "CDC42 — small GTPase, no approved drug"),
    ("P63000", 0, "RAC1 — small GTPase, no approved drug"),
    ("P61586", 0, "RHOA — small GTPase, no approved drug"),
    # --- Ubiquitin pathway scaffolds (E3s mostly undruggable directly) ---
    ("Q00987", 0, "MDM2 — degrader / PPI inhibitor in trials, no approved drug"),
    ("Q9UKV3", 0, "ACIN1 — apoptotic chromatin condensation inducer"),
    ("Q9Y6C9", 0, "MTCH2 — mitochondrial scaffold"),
    # --- Misc essential cellular scaffolds ---
    ("P78527", 0, "PRKDC — DNA-PKcs, drugs in trials but none approved"),
    ("P49736", 0, "MCM2 — DNA replication helicase subunit"),
    ("P33991", 0, "MCM4 — DNA replication helicase subunit"),
    ("P33992", 0, "MCM5 — DNA replication helicase subunit"),
    ("Q14566", 0, "MCM6 — DNA replication helicase subunit"),
    ("P33993", 0, "MCM7 — DNA replication helicase subunit"),
    ("P0CG48", 0, "Polyubiquitin C — UBC"),
    ("P62987", 0, "RPL40 / UBA52 — ribosomal-ubiquitin fusion"),
    ("P61981", 0, "YWHAG / 14-3-3 gamma — scaffold"),
    ("P31946", 0, "YWHAB / 14-3-3 beta — scaffold"),
    ("P63104", 0, "YWHAZ / 14-3-3 zeta — scaffold"),
    # --- Misc TFs without approved direct drugs ---
    ("Q01094", 0, "E2F1 — cell-cycle TF"),
    ("P10242", 0, "MYB — TF"),
    ("P01100", 0, "FOS — duplicate guard"),
]


def get_training_set() -> List[_Entry]:
    """Return de-duplicated combined training set (positives + negatives).

    Earlier entries win; we de-duplicate on uniprot_id to avoid the same
    protein appearing twice with conflicting labels.
    """
    seen = set()
    out: List[_Entry] = []
    for entry in POSITIVES + NEGATIVES:
        uid = entry[0]
        if uid in seen:
            continue
        seen.add(uid)
        out.append(entry)
    return out
