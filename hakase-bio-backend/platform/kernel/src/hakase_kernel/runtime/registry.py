"""Open-source data sources, tools and reference corpora used by the
biologic L1/L2 engines — and the ones explicitly flagged as roadmap items
(i.e. NOT used yet, returning ``null`` or ``heuristic`` outputs).

Why this exists
---------------
The biologic engines mix four kinds of evidence: published deterministic
formulae (Kyte–Doolittle, Guruprasad, Eisenberg, Chou–Fasman, AGGRESCAN…),
curated reference values (clinical-peptide anchors, IGHV/IGKV consensus
composition), live REST queries (UniProt, ChEMBL), and optional remote ML
endpoints (ESM-2, AbLang2 — gracefully degrade when offline). A single
registry surfaces all of that for audit, regulatory dossiers and platform
transparency.

The registry is intentionally a plain Python data structure — no I/O at
import time, no network calls — so callers can render it in a panel, emit
it into a sealed L2 confirmation block, or just print it for a citation
audit.
"""

from __future__ import annotations

from typing import Any

# Status vocabulary:
#   "live"      — wired into the engine; outputs depend on it today.
#   "fallback"  — used as an optional ranking-grade fallback (opt-in).
#   "remote"    — optional remote endpoint, gracefully degrades when offline.
#   "roadmap"   — flagged for adoption but NOT used today (null / heuristic).

OPEN_SOURCE_REGISTRY: dict[str, list[dict[str, Any]]] = {
    "peptide_l1": [
        {
            "name": "Kyte & Doolittle hydropathy scale",
            "kind": "scale",
            "status": "live",
            "use": "GRAVY index, hydrophobic moment, MHC-II epitope proxy",
            "citation": "Kyte & Doolittle (1982), J. Mol. Biol. 157, 105–132",
        },
        {
            "name": "Guruprasad dipeptide instability index (DIPW)",
            "kind": "scale",
            "status": "live",
            "use": "In-vitro instability proxy (>40 = unstable)",
            "citation": "Guruprasad et al. (1990), Protein Eng. 4, 155–161",
        },
        {
            "name": "Ikai aliphatic index",
            "kind": "scale",
            "status": "live",
            "use": "Relative volume of aliphatic side chains",
            "citation": "Ikai (1980), J. Biochem. 88, 1895–1898",
        },
        {
            "name": "Boman protein-binding propensity index",
            "kind": "scale",
            "status": "live",
            "use": "Receptor-engagement proxy, AMP triage",
            "citation": "Boman (2003), J. Internal Medicine 254, 197",
        },
        {
            "name": "Chou–Fasman secondary-structure propensity",
            "kind": "scale",
            "status": "live",
            "use": "Helix / sheet / coil fractions, helix-staple targeting",
            "citation": "Chou & Fasman (1978), Adv. Enzymol. 47, 45–148",
        },
        {
            "name": "Eisenberg hydrophobic moment",
            "kind": "scale",
            "status": "live",
            "use": "Amphipathic-helix detection (μH, 100° rotation)",
            "citation": "Eisenberg et al. (1982), Nature 299, 371–374",
        },
        {
            "name": "AGGRESCAN a3v intrinsic aggregation-propensity scale",
            "kind": "algorithm",
            "status": "live",
            "use": "Aggregation-prone-region detection (peptide + antibody)",
            "citation": "Conchillo-Solé et al. (2007), BMC Bioinformatics 8:65",
        },
        {
            "name": "Pace ε₂₈₀ molar extinction formula",
            "kind": "formula",
            "status": "live",
            "use": "A280 absorbance for protein quantitation",
            "citation": "Pace et al. (1995), Protein Sci. 4, 2411",
        },
        {
            "name": "PeptideCutter protease-specificity rules",
            "kind": "rules",
            "status": "live",
            "use": "Trypsin / chymotrypsin / pepsin / Glu-C / thrombin cleavage sites",
            "citation": "Gasteiger et al. (2005), Proteomics Protocols Handbook",
        },
        {
            "name": "APD3 antimicrobial peptide database",
            "kind": "dataset",
            "status": "live",
            "use": "MIC range + spectrum bands for AMP candidates",
            "citation": "Wang et al. (2016), Nucleic Acids Res. 44, D1087 (PMID 25414334)",
            "url": "https://aps.unmc.edu/",
        },
        {
            "name": "Curated clinical-peptide reference set",
            "kind": "dataset",
            "status": "live",
            "use": "Homology-transfer anchors (KD, half-life, Caco-2, CL) — GLP-1, insulin, oxytocin/vasopressin, somatostatin, calcitonin, GnRH, ENaC, GLP-2, cyclosporin classes",
            "citation": "Compiled from individual drug-label and primary-literature references; see CLINICAL_PEPTIDES in peptide_ml.py",
        },
        {
            "name": "UniProtKB REST API",
            "kind": "service",
            "status": "remote",
            "use": "Live target metadata (gene name, tissue, subcellular location)",
            "citation": "The UniProt Consortium (2023), Nucleic Acids Res. 51, D523",
            "url": "https://rest.uniprot.org/",
        },
        {
            "name": "EBI ChEMBL REST API",
            "kind": "service",
            "status": "remote",
            "use": "Live verification of curated clinical-peptide identifiers",
            "citation": "Mendez et al. (2019), Nucleic Acids Res. 47, D930",
            "url": "https://www.ebi.ac.uk/chembl/",
        },
        {
            "name": "ESM-2 / ESMC protein language model",
            "kind": "ml",
            "status": "remote",
            "use": "Optional sequence-embedding signal used by the V3 peptide services",
            "citation": "Lin et al. (2023), Science 379, 1123",
            "url": "https://github.com/facebookresearch/esm",
        },
        {
            "name": "AGGRESCAN3D / Solubis structure-based aggregation",
            "kind": "tool",
            "status": "roadmap",
            "use": "Structure-based aggregation hot-spot grading (Layer 2)",
            "citation": "Zambrano et al. (2015), Nucleic Acids Res. 43, W306",
        },
        {
            "name": "Therapeutic Data Commons — peptide datasets",
            "kind": "dataset",
            "status": "roadmap",
            "use": "Calibration of AMP, hemolysis and MHC-II epitope models",
            "citation": "Huang et al. (2021), Nature Chem. Biol. 18, 1033",
            "url": "https://tdcommons.ai/",
        },
        {
            "name": "BIOPEP-UWM peptide database",
            "kind": "dataset",
            "status": "roadmap",
            "use": "Bioactive-peptide reference for analog screening",
            "citation": "Minkiewicz et al. (2008), Pol. J. Food Nutr. Sci. 58, 7",
        },
        {
            "name": "NetMHCIIpan / IEDB MHC-II PWMs",
            "kind": "ml",
            "status": "roadmap",
            "use": "Calibrated T-cell-epitope load (replacing hydrophobic-window proxy)",
            "citation": "Reynisson et al. (2020), Nucleic Acids Res. 48, W449",
        },
    ],
    "antibody_l1": [
        {
            "name": "Therapeutic Antibody Profiler (TAP)",
            "kind": "rules",
            "status": "live",
            "use": "CDR length / hydrophobicity / charge developability flags",
            "citation": "Raybould et al. (2019), PNAS 116, 4025",
        },
        {
            "name": "Wolf Perez developability liability rules",
            "kind": "rules",
            "status": "live",
            "use": "Deamidation / isomerisation / oxidation / glycosylation motifs",
            "citation": "Wolf Perez et al. (2019), mAbs 11, 1300",
        },
        {
            "name": "Jain surface-hydrophobicity / HIC retention index",
            "kind": "scale",
            "status": "live",
            "use": "CDR-anchored hydrophobic-interaction-chromatography proxy",
            "citation": "Jain et al. (2017), PNAS 114, 944",
        },
        {
            "name": "Shire / Sharma viscosity-vs-concentration model",
            "kind": "rules",
            "status": "live",
            "use": "≥100 mg/mL SC viscosity risk triage",
            "citation": "Shire et al. (2004), J. Pharm. Sci. 93, 1390; Sharma et al. (2014), PNAS 111, 18601",
        },
        {
            "name": "ANARCI — IMGT antibody numbering",
            "kind": "tool",
            "status": "live",
            "use": "Exact IMGT CDR boundaries (falls back to motif-anchored heuristic)",
            "citation": "Dunbar & Deane (2016), Bioinformatics 32, 298",
            "url": "https://github.com/oxpig/ANARCI",
        },
        {
            "name": "IGHV / IGKV / IGLV germline composition (OAS / IMGT GENE-DB)",
            "kind": "dataset",
            "status": "live",
            "use": "Composition-based humanness proxy (replaces null humanness stub)",
            "citation": "Lefranc et al. (2015), Nucleic Acids Res. 43, D413; Olsen et al. (2022) OAS",
            "url": "https://opig.stats.ox.ac.uk/webapps/oas/",
        },
        {
            "name": "Saxena & Wu FcRn biology / Deng et al. pI-vs-half-life",
            "kind": "model",
            "status": "live",
            "use": "pH-switch FcRn proxy from per-chain Henderson–Hasselbalch",
            "citation": "Saxena & Wu (2016), Front. Immunol. 7, 580; Deng et al. (2012), JBC 287, 23739",
        },
        {
            "name": "AbLang2 antibody language model",
            "kind": "ml",
            "status": "remote",
            "use": "Optional antibody-ml endpoint (sequence pseudo-loglik / embedding)",
            "citation": "Olsen et al. (2024), bioRxiv",
            "url": "https://github.com/oxpig/AbLang2",
        },
        {
            "name": "Hu-mAb / Sapiens / BioPhi humanness",
            "kind": "ml",
            "status": "roadmap",
            "use": "Alignment-based calibrated humanness score (replaces composition proxy)",
            "citation": "Marks et al. (2021), Bioinformatics 37, 4041; Prihoda et al. (2022), mAbs 14",
            "url": "https://github.com/Merck/BioPhi",
        },
        {
            "name": "SAbDab — Structural Antibody Database",
            "kind": "dataset",
            "status": "roadmap",
            "use": "Paratope / epitope structural priors for Layer 2 co-folding QC",
            "citation": "Dunbar et al. (2014), Nucleic Acids Res. 42, D1140",
            "url": "https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/sabdab/",
        },
        {
            "name": "IgFold / ImmuneBuilder structure prediction",
            "kind": "ml",
            "status": "roadmap",
            "use": "Local antibody structure prediction (alternative to remote co-folding)",
            "citation": "Ruffolo et al. (2023), Nat. Commun. 14, 2389",
            "url": "https://github.com/Graylab/IgFold",
        },
        {
            "name": "Observed Antibody Space (OAS) repertoire corpus",
            "kind": "dataset",
            "status": "roadmap",
            "use": "Repertoire-derived priors for humanness / liability frequency",
            "citation": "Olsen et al. (2022), Protein Sci. 31, 141",
        },
    ],
    "biologic_l2": [
        {
            "name": "Boltz-2 co-folding (peptide / antibody – target)",
            "kind": "ml",
            "status": "remote",
            "use": "Stage 1 target-engagement co-folding (GPU, opt-in)",
            "citation": "Passaro et al. (2025), Boltz-2 technical report",
            "url": "https://github.com/jwohlwend/boltz",
        },
        {
            "name": "Confidence-gated affinity (ipTM + complex pLDDT)",
            "kind": "rules",
            "status": "live",
            "use": "Stage 2 binding-confidence gating before Ki propagation",
            "citation": "Internal — see confidenceGate.ts",
        },
        {
            "name": "Modality-aware PK class projection",
            "kind": "rules",
            "status": "live",
            "use": "Peptide (renal + proteolysis) vs antibody (FcRn + TMDD) PK regime",
            "citation": "Wang et al. (2008), Clin. Pharmacol. Ther. 84, 548 (mAb PK review)",
        },
        {
            "name": "Open-source PBPK (PK-Sim / Pumas.jl / mrgsolve)",
            "kind": "tool",
            "status": "roadmap",
            "use": "Quantitative PBPK replacing the current class-based projection",
            "citation": "Open Systems Pharmacology (PK-Sim); Pumas.jl",
            "url": "https://github.com/Open-Systems-Pharmacology/PK-Sim",
        },
    ],
}


def get_open_source_registry(modality: str | None = None) -> dict[str, Any]:
    """Return the open-source registry, optionally filtered to one section.

    Parameters
    ----------
    modality : str, optional
        One of ``"peptide_l1"``, ``"antibody_l1"``, ``"biologic_l2"``. If
        omitted, returns the full registry plus a summary count by status.
    """
    if modality is not None:
        items = OPEN_SOURCE_REGISTRY.get(modality, [])
        return {
            "modality": modality,
            "entries": items,
            "count": len(items),
            "by_status": _status_breakdown(items),
        }
    flat = [e for entries in OPEN_SOURCE_REGISTRY.values() for e in entries]
    return {
        "sections": list(OPEN_SOURCE_REGISTRY.keys()),
        "entries": OPEN_SOURCE_REGISTRY,
        "count": len(flat),
        "by_status": _status_breakdown(flat),
        "note": (
            "Single source of truth for the public datasets, tools and "
            "references the biologic engines lean on. `status` = live | "
            "fallback | remote | roadmap. Roadmap items are NOT used today; "
            "their outputs are null / heuristic until the integration ships."
        ),
    }


def _status_breakdown(entries: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in entries:
        s = e.get("status", "unknown")
        out[s] = out.get(s, 0) + 1
    return out
