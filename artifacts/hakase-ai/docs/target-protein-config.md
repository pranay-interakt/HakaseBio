# Target Protein Configuration & Molecule-Based Target Suggestions

## Overview

HakaseAI's **Target Protein Configuration** panel and **Molecule-Based Target Suggestions** engine work together to identify the most likely biological target for any input molecule. This system combines two complementary approaches — pharmacophore-based heuristic matching and ChEMBL experimental data — to recommend which protein a compound is most likely to bind, then automatically configures the simulation pipeline around that target.

---

## How It Works: Two-Tier Target Prediction

### Tier 1: Pharmacophore-Based Heuristic Matching (Always Available)

When a molecule is entered, the system immediately analyzes its structure using RDKit to extract:

- **Molecular properties**: MW, LogP, TPSA, HBD, HBA, rotatable bonds, aromatic ring count
- **Pharmacophore profile**: 27+ structural features detected via SMARTS pattern matching — quinazoline scaffolds, sulfonamides, hydroxamic acids, basic amines, Michael acceptors, halogen groups, and more

These features are scored against a **catalog of 29 drug targets** spanning 11 therapeutic areas:

| Therapeutic Area | Targets |
|---|---|
| Oncology | EGFR, CDK4, CDK2, KDR (VEGFR2), AKT1, PIK3CA, RAF1, ABL1, CHEK1, BRD4, MCL1 |
| CNS / Psychiatry | DRD2, HTR2A, CHRM2 |
| Pain | OPRM1, TRPV1 |
| Cardiovascular | ACE |
| Inflammation | PTGS2 (COX-2), MAPK14 (p38α) |
| Immunology | BTK, CHUK (IKKα), PDCD1 (PD-1), CCR5 |
| Endocrinology | AR, ESR1 |
| Metabolic | PPARγ |
| Epigenetics | HDAC2, PARP1 |
| Chaperone | HSP90 |

**Scoring method**: Each target has a custom scoring function that awards points for matching pharmacophore features. For example, EGFR scores highly for quinazoline/pyrimidine scaffolds (+2.5), aromatic nitrogen atoms (+2), aniline groups (+1.5), and MW in the 300–560 Da range (+1.5). The raw score is normalized against an absolute maximum of 12 to produce a confidence percentage.

**Confidence labels**:
- **High** (≥65%): Strong pharmacophore match — multiple structural features align with known inhibitors
- **Medium** (35–64%): Moderate match — some features align but not definitive
- **Low** (<35%): Weak match — the molecule doesn't strongly resemble known inhibitors for any target

### Tier 2: ChEMBL Experimental Data (When Available)

In parallel with heuristic matching, the system queries the ChEMBL database to find real bioactivity data for the compound:

1. The molecule's SMILES is sent to ChEMBL to identify if it matches a known compound
2. If found, the system fetches all recorded target–activity relationships (IC50, Ki, EC50, etc.)
3. These experimental results are converted to target suggestions labeled as **"Experimental"** — the highest confidence tier

**Experimental suggestions always rank above heuristic ones.** When both are available, the final list merges ChEMBL results with heuristic fallbacks (up to 5 total), with ChEMBL targets taking priority and duplicates removed.

---

## Target Protein Configuration Panel

### UniProt ID Field
The UniProt accession (e.g., `P00533` for EGFR) is the primary identifier for the target protein. This field can be set in three ways:

1. **Auto-match mode** (default): The top-ranked target suggestion automatically populates the field. A badge shows the match quality:
   - Green "ChEMBL Verified" — real experimental data
   - Green/Amber/Red "Auto-matched · High/Medium/Low confidence" — heuristic prediction

2. **Quick-select chips**: Click any of the top 4 suggestions shown as clickable chips below the label (e.g., `P00533 (EGFR) 67%`). Each shows the confidence percentage, color-coded by level.

3. **Manual entry**: Type any UniProt ID and click "Fetch" to manually select a target. This switches to manual mode; click "↺ Auto-match" to return to automatic mode.

### Fetch Mechanism
When a UniProt ID is set (via auto-match, quick-select, or the "Use" button), the system:
1. Queries the UniProt REST API for protein metadata (name, gene, organism, sequence, PDB IDs)
2. Fetches AlphaFold predicted structure data
3. Auto-populates the PDB Structure ID field with the first known crystal structure
4. Triggers RCSB PDB lookup for structure details (method, resolution, chains)

### PDB Structure ID
Auto-populated from the protein's known crystal structures (from UniProt). Can be manually changed. The system fetches structure metadata from RCSB PDB (resolution, method, release date) as you type.

### Therapeutic Area Preset
Auto-set based on the top target suggestion's therapeutic area mapping (e.g., EGFR → "Oncology", PTGS2 → "Immunology", DRD2 → "CNS"). Influences downstream simulation parameters.

---

## Molecule-Based Target Suggestions Panel

The expandable "Molecule-Based Target Suggestions" section displays the full ranked list with:

- **Gene name badge**: Color-coded by therapeutic area (violet for oncology kinases, amber for metabolic, etc.)
- **Full protein name**: Complete target designation
- **Confidence badge**: "Experimental", "High Conf.", "Medium Conf.", or "Low Conf."
- **Target class and area**: e.g., "Tyrosine Kinase · Oncology"
- **Confidence bar**: Visual bar + percentage, color-coded (green/amber/red)
- **Rationale bullets**: Specific structural evidence explaining why the molecule matches, e.g.:
  - "Quinazoline/pyrimidine scaffold — core pharmacophore of EGFR inhibitors (erlotinib, gefitinib)"
  - "MW 430 Da within EGFR inhibitor chemical space (300–560 Da)"
  - "Experimental IC50: 12 nM (ChEMBL measured)"
- **"Use" button**: Click to select that target — immediately fetches protein data from UniProt and configures the simulation

---

## Data Flow: From Molecule to Target

```
User enters SMILES → Click "Run"
       │
       ├──→ RDKit extracts molecular properties + pharmacophore profile
       │         │
       │         └──→ suggestTargets() scores against 29-target catalog
       │                    │
       │                    └──→ Heuristic suggestions (ranked, with rationale)
       │
       ├──→ ChEMBL compound lookup (async)
       │         │
       │         └──→ If found: fetch bioactivity data → Experimental suggestions
       │
       └──→ Merge: ChEMBL experimental (priority) + heuristic fallbacks
                    │
                    └──→ Top suggestion auto-populates UniProt ID
                              │
                              ├──→ UniProt API → protein info, PDB IDs
                              ├──→ AlphaFold API → predicted structure
                              ├──→ RCSB PDB → crystal structure metadata
                              └──→ Therapeutic area auto-set
```

---

## Pharmacophore Features Detected

The system detects these structural features via SMARTS pattern matching on the input molecule:

| Feature | Example Relevance |
|---|---|
| Quinazoline / Pyrimidine | EGFR inhibitors (erlotinib, gefitinib) |
| Sulfonamide / Sulfone | COX-2 inhibitors (celecoxib), kinase inhibitors |
| Hydroxamic acid | HDAC inhibitors (vorinostat) |
| Michael acceptor (electrophilic warhead) | Covalent EGFR inhibitors (osimertinib) |
| Basic amine (piperidine, piperazine) | CNS drugs (DRD2, 5-HT2A), CCR5 antagonists |
| Carboxylic acid | ACE inhibitors, NSAIDs |
| Indole | Serotonin receptor ligands |
| Benzimidazole | Kinase inhibitors |
| Urea linkage | BRAF inhibitors, kinase scaffolds |
| Trifluoromethyl (CF₃) | Metabolic stability, CCR5 antagonists |
| Halogen atoms | Kinase selectivity features |
| Aromatic nitrogen count | Hinge-binding pharmacophore for kinases |

---

## Integration with Python AI Service

The Python AI service (`/api/ai/binding`) provides a complementary drug-target prediction using:
- **Morgan fingerprint similarity** (Tanimoto coefficient) against reference drug structures
- **Physicochemical property matching** against preferred ranges per target
- **SMARTS pharmacophore patterns** for scaffold recognition
- Returns estimated pIC50 and IC50 values (nM)

This can be used alongside the browser-based suggestions for cross-validation.

---

## Key Design Decisions

1. **Absolute confidence scoring**: Scores are normalized against a fixed maximum (12), not relative to the top hit. This means if a molecule doesn't strongly match any target, all suggestions will show low confidence — an honest signal rather than an artificially inflated "best match."

2. **Experimental data always wins**: ChEMBL-verified targets override heuristic predictions and are labeled "Experimental" to distinguish real measured activity from computational predictions.

3. **Explicit "Run" button**: Importing a molecule only sets the SMILES — analysis only triggers when the user clicks "Run". This gives the user control over when the computationally intensive target matching + ChEMBL lookup chain fires.

4. **Auto-sync with manual override**: The top suggestion auto-populates the UniProt field by default, but clicking any suggestion chip or typing manually switches to manual mode. Users can always return to auto-match.
