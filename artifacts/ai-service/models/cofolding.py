"""Biomolecular co-folding — Layer 1 / Layer 2 structural-biology engine.

Full Boltz-2 integration for HakaseAI's digital pre-clinical twin.  Supports
proteins, peptides, DNA, RNA, small-molecule ligands, ions, modified residues,
covalent bonds, structural templates, pocket conditioning, contact constraints,
and the Boltz-2 binding-affinity head — making the twin capable of:

  • Small-molecule drug design (original scope, unchanged)
  • Peptide therapeutics / stapled / cyclic peptides
  • Antibody / bispecific / PROTAC ternary-complex modelling
  • Nucleic-acid modalities (ASO, siRNA, aptamers)
  • Structure-guided hit-discovery (pocket / contact conditioning)
  • Affinity-guided lead-optimisation (Boltz-2 affinity head, FEP-class accuracy)

WHY BOLTZ-2, NOT ALPHAFOLD 3
------------------------------
AlphaFold 3 weights are CC-BY-NC-SA — non-commercial only and gated to
academic requesters.  Boltz-2 is MIT-licensed, commercially usable, and the
first deep-learning model to approach FEP accuracy on binding affinity while
running 1000× faster.  (Passaro et al., bioRxiv 2025.06.14.659707)

ARCHITECTURE
------------
  cofolding.py  (this file, runs inside the AI service, no GPU cost)
    • models every design concept as typed Python dataclasses
    • validates the design thoroughly so a broken job never reaches the GPU
    • builds the Boltz v1 YAML from the validated design
    • dispatches to a RunPod Serverless GPU endpoint and polls until done

  runpod_worker_boltz/  (the GPU side)
    • runs `boltz predict` and parses every output artifact
    • returns the strict JSON contract defined by CoFoldJobResult

Honesty policy (identical to fep_runpod.py):
  - NO fabricated structures / confidence / affinity.
  - NO silent CPU fallback.
  - RunPod / Boltz errors propagate verbatim.

Boltz-2 features fully exposed here:
  Constraints  : bond, pocket (+force), contact (+force)
  Templates    : CIF and PDB files for backbone conditioning
  Options      : diffusion_samples, recycling_steps, sampling_steps,
                 step_scale, max_parallel_samples, use_msa_server,
                 max_msa_seqs, subsample_msa, num_subsampled_msa,
                 use_potentials, no_kernels, output_format,
                 write_full_pae, write_full_pde,
                 affinity_mw_correction, sampling_steps_affinity,
                 diffusion_samples_affinity
  Affinity     : affinity_pred_value + affinity_probability_binary (ensemble)
                 + per-model ensemble member outputs (_1, _2)
  Modifications: proteins, peptides, DNA, RNA
  Confidence   : pLDDT, pTM, ipTM, PDE scores, PAE matrix (full / block-averaged)
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import requests

try:
    from rdkit import Chem
    from rdkit import RDLogger
    RDLogger.DisableLog("rdApp.*")
    _RDKIT = True
except Exception:  # noqa: BLE001
    _RDKIT = False


RUNPOD_BASE = "https://api.runpod.ai/v2"
RUNPOD_TIMEOUT_S = 30
POLL_INTERVAL_S = 15
POLL_DEADLINE_S = 2 * 3600      # 2-hour hard cap

ENGINE = "boltz2"
ENGINE_LABEL = "Boltz-2 (AlphaFold3-class co-folding + affinity, MIT license)"

# ── Alphabets ───────────────────────────────────────────────────────────────
_AA_ALPHABET   = set("ACDEFGHIKLMNPQRSTVWYXUO")   # 20 + X + Sec/Pyl
_DNA_ALPHABET  = set("ACGTN")
_RNA_ALPHABET  = set("ACGUN")

ENTITY_TYPES = ("protein", "peptide", "dna", "rna", "ligand", "ion")

# Practical limits — guard GPU memory and cost before any job is submitted.
MAX_ENTITIES       = 24
MAX_TOTAL_CHAINS   = 32
MAX_PROTEIN_LEN    = 4000
MAX_PEPTIDE_LEN    = 150
MAX_NUCLEIC_LEN    = 2000
MAX_TOTAL_TOKENS   = 5000
# Boltz-2 affinity head: ligands ≤128 atoms (H+heavy via RDKit RemoveHs).
# Recommended practical limit is 56 atoms (model training boundary).
MAX_LIGAND_ATOMS_AFFINITY = 128
PEPTIDE_MSA_DEFAULT       = False


# ===========================================================================
# Configuration probe
# ===========================================================================

def _env(key: str) -> Optional[str]:
    v = os.environ.get(key)
    return v.strip() if v and v.strip() else None


def cofolding_configured() -> tuple[bool, str]:
    """Return (is_configured, reason_if_not). Called before every GPU dispatch."""
    if not _env("RUNPOD_API_KEY"):
        return False, "RUNPOD_API_KEY environment secret is not set"
    if not _env("RUNPOD_BOLTZ_ENDPOINT_ID"):
        return False, "RUNPOD_BOLTZ_ENDPOINT_ID environment secret is not set"
    return True, ""


# ===========================================================================
# Design model — typed dataclasses
# ===========================================================================

@dataclass
class CoFoldEntity:
    """One molecular component of the complex."""
    type: str                              # protein | peptide | dna | rna | ligand | ion
    id: str                                # chain identifier (1-4 chars, A-Z/0-9, starts letter)
    sequence: str = ""                     # AA / nucleotide sequence
    smiles: str = ""                       # SMILES for ligand (exclusive with ccd)
    ccd: str = ""                          # PDB CCD code for ligand/ion
    copies: int = 1                        # stoichiometry
    use_msa: bool = True                   # request server MSA (proteins only)
    cyclic: bool = False                   # cyclic polymer
    modifications: list[dict] = field(default_factory=list)  # [{position, ccd}]


@dataclass
class CoFoldBond:
    """Explicit covalent bond between two atoms in the complex."""
    atom1: dict   # {chain, residue, atom}
    atom2: dict


@dataclass
class CoFoldPocket:
    """Pocket-conditioning constraint (drives the binder toward a binding site)."""
    binder: str           # chain id of the binder
    contacts: list[dict]  # [{chain, residue}]
    max_distance: float = 6.0
    force: bool = False   # apply a potential to enforce the constraint


@dataclass
class CoFoldContact:
    """Contact constraint — two specific residues/atoms should be close."""
    token1: dict          # {chain, residue} or {chain, atom}
    token2: dict
    max_distance: float = 6.0
    force: bool = False


@dataclass
class CoFoldTemplate:
    """Structural template to condition backbone prediction."""
    # Provide either a URL (downloaded by the worker) or inline base64 data.
    source_url: str = ""             # HTTP URL to a CIF or PDB file
    source_format: str = "cif"      # "cif" | "pdb"
    chain_ids: list[str] = field(default_factory=list)      # which chains to template
    template_ids: list[str] = field(default_factory=list)   # matching template chain ids
    force: bool = False              # potential-enforce backbone
    threshold: float = 2.0          # deviation threshold in Å (required when force=True)


@dataclass
class CoFoldDesign:
    """Fully-validated co-folding design — ready to render to Boltz YAML."""
    name: str
    entities: list[CoFoldEntity]
    bonds: list[CoFoldBond] = field(default_factory=list)
    pocket: Optional[CoFoldPocket] = None
    contacts: list[CoFoldContact] = field(default_factory=list)
    templates: list[CoFoldTemplate] = field(default_factory=list)
    affinity_binder: Optional[str] = None
    affinity_binder_type: str = ""   # "ligand" | "peptide" | "protein"
    options: dict = field(default_factory=dict)


class CoFoldValidationError(ValueError):
    """Bad design — message shown verbatim to the user (HTTP 400)."""


# ===========================================================================
# Parsing + validation helpers
# ===========================================================================

def _clean_id(raw: Any, idx: int) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        raise CoFoldValidationError(f"Entity #{idx + 1}: missing chain id.")
    if not re.fullmatch(r"[A-Z][A-Z0-9]{0,3}", s):
        raise CoFoldValidationError(
            f"Entity #{idx + 1}: chain id {s!r} must be 1-4 chars, start with a "
            f"letter, and contain only A-Z / 0-9."
        )
    return s


def _parse_entity(raw: Any, idx: int) -> CoFoldEntity:
    if not isinstance(raw, dict):
        raise CoFoldValidationError(f"Entity #{idx + 1} must be an object.")
    etype = str(raw.get("type") or "").strip().lower()
    if etype not in ENTITY_TYPES:
        raise CoFoldValidationError(
            f"Entity #{idx + 1}: type must be one of {ENTITY_TYPES}, got {etype!r}."
        )
    if "use_msa" in raw and raw.get("use_msa") is not None:
        use_msa = bool(raw.get("use_msa"))
    else:
        use_msa = PEPTIDE_MSA_DEFAULT if etype == "peptide" else True

    return CoFoldEntity(
        type=etype,
        id=_clean_id(raw.get("id"), idx),
        sequence=str(raw.get("sequence") or "").strip().upper().replace(" ", "").replace("\n", ""),
        smiles=str(raw.get("smiles") or "").strip(),
        ccd=str(raw.get("ccd") or "").strip().upper(),
        copies=int(raw.get("copies") or 1),
        use_msa=use_msa,
        cyclic=bool(raw.get("cyclic", False)),
        modifications=list(raw.get("modifications") or []),
    )


def _validate_protein_like(ent: CoFoldEntity) -> int:
    is_peptide = ent.type == "peptide"
    label = "Peptide" if is_peptide else "Protein"
    if not ent.sequence:
        raise CoFoldValidationError(f"{label} {ent.id}: amino-acid sequence is required.")
    bad = sorted(set(ent.sequence) - _AA_ALPHABET)
    if bad:
        raise CoFoldValidationError(
            f"{label} {ent.id}: invalid amino-acid letter(s) {bad}. Non-standard residues "
            f"go in 'modifications', not the sequence string."
        )
    cap = MAX_PEPTIDE_LEN if is_peptide else MAX_PROTEIN_LEN
    if len(ent.sequence) > cap:
        raise CoFoldValidationError(
            f"{label} {ent.id}: length {len(ent.sequence)} exceeds the {cap}-residue limit."
        )
    if is_peptide and len(ent.sequence) < 2:
        raise CoFoldValidationError(f"Peptide {ent.id}: needs at least 2 residues.")
    _validate_modifications(ent, label)
    return len(ent.sequence)


def _validate_nucleic(ent: CoFoldEntity) -> int:
    """Validate a DNA or RNA entity, including optional modifications."""
    alphabet = _DNA_ALPHABET if ent.type == "dna" else _RNA_ALPHABET
    if not ent.sequence:
        raise CoFoldValidationError(f"{ent.type.upper()} {ent.id}: sequence is required.")
    bad = sorted(set(ent.sequence) - alphabet)
    if bad:
        raise CoFoldValidationError(
            f"{ent.type.upper()} {ent.id}: invalid base(s) {bad}. "
            f"{'DNA uses A/C/G/T' if ent.type == 'dna' else 'RNA uses A/C/G/U'} (N allowed)."
        )
    if len(ent.sequence) > MAX_NUCLEIC_LEN:
        raise CoFoldValidationError(
            f"{ent.type.upper()} {ent.id}: length {len(ent.sequence)} exceeds {MAX_NUCLEIC_LEN}."
        )
    # DNA/RNA modifications are supported by Boltz-2 (same CCD mechanism as proteins)
    _validate_modifications(ent, ent.type.upper())
    return len(ent.sequence)


def _validate_modifications(ent: CoFoldEntity, label: str) -> None:
    """Validate post-translational / chemical modifications (proteins, DNA, RNA)."""
    for m in ent.modifications:
        if not isinstance(m, dict):
            raise CoFoldValidationError(f"{label} {ent.id}: each modification must be an object.")
        pos = m.get("position")
        ccd = str(m.get("ccd") or "").strip().upper()
        seq_len = len(ent.sequence)
        if not isinstance(pos, int) or not (1 <= pos <= seq_len):
            raise CoFoldValidationError(
                f"{label} {ent.id}: modification position {pos!r} must be 1..{seq_len}."
            )
        if not re.fullmatch(r"[A-Z0-9]{1,5}", ccd):
            raise CoFoldValidationError(
                f"{label} {ent.id}: modification CCD code {ccd!r} is invalid "
                f"(expected 1-5 chars, e.g. SEP, TPO, PTR for proteins; "
                f"5MC, H2U for RNA)."
            )
        m["position"], m["ccd"] = pos, ccd


def _validate_ligand(ent: CoFoldEntity) -> int:
    """Validate a small-molecule ligand. Returns approximate token count."""
    has_smiles, has_ccd = bool(ent.smiles), bool(ent.ccd)
    if has_smiles == has_ccd:
        raise CoFoldValidationError(
            f"Ligand {ent.id}: provide EXACTLY ONE of 'smiles' or 'ccd'."
        )
    if has_ccd:
        if not re.fullmatch(r"[A-Z0-9]{1,5}", ent.ccd):
            raise CoFoldValidationError(
                f"Ligand {ent.id}: CCD code {ent.ccd!r} is invalid (1-5 chars, e.g. ATP, HEM)."
            )
        return 12
    if not _RDKIT:
        raise CoFoldValidationError(
            f"Ligand {ent.id}: RDKit is unavailable — cannot validate SMILES before GPU submission. "
            f"Supply a CCD code or resolve the RDKit install."
        )
    mol = Chem.MolFromSmiles(ent.smiles)
    if mol is None:
        raise CoFoldValidationError(
            f"Ligand {ent.id}: SMILES {ent.smiles!r} could not be parsed by RDKit."
        )
    heavy = mol.GetNumHeavyAtoms()
    if heavy < 1:
        raise CoFoldValidationError(f"Ligand {ent.id}: SMILES has no heavy atoms.")
    if heavy > 300:
        raise CoFoldValidationError(
            f"Ligand {ent.id}: {heavy} heavy atoms exceeds the small-molecule range. "
            f"Model macromolecules as protein/nucleic entities."
        )
    return heavy


def _validate_ion(ent: CoFoldEntity) -> int:
    if not ent.ccd:
        raise CoFoldValidationError(
            f"Ion {ent.id}: a CCD code is required (e.g. MG, ZN, NA, CA, K, MN, FE, CU)."
        )
    if not re.fullmatch(r"[A-Z0-9]{1,5}", ent.ccd):
        raise CoFoldValidationError(f"Ion {ent.id}: CCD code {ent.ccd!r} is invalid.")
    if ent.smiles:
        raise CoFoldValidationError(f"Ion {ent.id}: use 'ccd', not 'smiles', for ions.")
    return 1


def _expand_ids(ent: CoFoldEntity) -> list[str]:
    """Chain ids after stoichiometry expansion: A×3 → [A, A2, A3]."""
    if ent.copies == 1:
        return [ent.id]
    return [ent.id] + [f"{ent.id}{n}" for n in range(2, ent.copies + 1)]


# ===========================================================================
# Bond, pocket, contact, template validation
# ===========================================================================

def _validate_bonds(raw: Any, id_set: set[str]) -> list[CoFoldBond]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CoFoldValidationError("'bonds' must be a list.")
    out: list[CoFoldBond] = []
    for i, b in enumerate(raw):
        if not isinstance(b, dict):
            raise CoFoldValidationError(f"Bond #{i + 1} must be an object.")
        a1 = _parse_atom_ref(b.get("atom1"), i, 1, id_set)
        a2 = _parse_atom_ref(b.get("atom2"), i, 2, id_set)
        out.append(CoFoldBond(atom1=a1, atom2=a2))
    return out


def _parse_atom_ref(raw: Any, bond_idx: int, which: int, id_set: set[str]) -> dict:
    if not isinstance(raw, dict):
        raise CoFoldValidationError(f"Bond #{bond_idx + 1} atom{which} must be an object.")
    chain = str(raw.get("chain") or "").strip().upper()
    residue = raw.get("residue")
    atom = str(raw.get("atom") or "").strip().upper()
    if chain not in id_set:
        raise CoFoldValidationError(
            f"Bond #{bond_idx + 1} atom{which}: chain {chain!r} not found in this design."
        )
    if not isinstance(residue, int) or residue < 1:
        raise CoFoldValidationError(
            f"Bond #{bond_idx + 1} atom{which}: residue must be a positive integer."
        )
    if not re.fullmatch(r"[A-Z0-9']{1,5}", atom):
        raise CoFoldValidationError(
            f"Bond #{bond_idx + 1} atom{which}: atom name {atom!r} is invalid "
            f"(e.g. SG for cysteine, C1 for a ligand carbon)."
        )
    return {"chain": chain, "residue": residue, "atom": atom}


def _parse_token_ref(raw: Any, label: str, id_set: set[str]) -> dict:
    """Parse a token reference for contact constraints: {chain, residue} or {chain, atom}."""
    if not isinstance(raw, dict):
        raise CoFoldValidationError(f"{label}: token reference must be an object.")
    chain = str(raw.get("chain") or "").strip().upper()
    if chain not in id_set:
        raise CoFoldValidationError(f"{label}: chain {chain!r} not found in this design.")
    residue = raw.get("residue")
    atom = raw.get("atom")
    if residue is None and atom is None:
        raise CoFoldValidationError(f"{label}: provide either 'residue' (int) or 'atom' (str).")
    if residue is not None and not (isinstance(residue, int) and residue >= 1):
        raise CoFoldValidationError(f"{label}: residue must be a positive integer.")
    if atom is not None:
        atom = str(atom).strip().upper()
        if not re.fullmatch(r"[A-Z0-9']{1,5}", atom):
            raise CoFoldValidationError(f"{label}: atom name {atom!r} is invalid.")
    return {k: v for k, v in {"chain": chain, "residue": residue, "atom": atom}.items() if v is not None}


def _validate_pocket(raw: Any, entities: list[CoFoldEntity],
                     base_ids: set[str], id_set: set[str]) -> Optional[CoFoldPocket]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise CoFoldValidationError("'pocket' must be an object.")
    binder = str(raw.get("binder") or "").strip().upper()
    if binder not in base_ids:
        raise CoFoldValidationError(f"pocket.binder {binder!r} not found in entity ids.")
    contacts_raw = raw.get("contacts")
    if not isinstance(contacts_raw, list) or not contacts_raw:
        raise CoFoldValidationError("pocket.contacts must be a non-empty list of {chain, residue}.")
    contacts: list[dict] = []
    for j, c in enumerate(contacts_raw):
        if not isinstance(c, dict):
            raise CoFoldValidationError(f"pocket.contacts[{j}] must be an object.")
        chain = str(c.get("chain") or "").strip().upper()
        residue = c.get("residue")
        if chain not in id_set:
            raise CoFoldValidationError(f"pocket.contacts[{j}]: chain {chain!r} not in design.")
        if not isinstance(residue, int) or residue < 1:
            raise CoFoldValidationError(f"pocket.contacts[{j}]: residue must be a positive integer.")
        contacts.append({"chain": chain, "residue": residue})
    max_dist = raw.get("max_distance", 6.0)
    try:
        max_dist = float(max_dist)
    except (TypeError, ValueError):
        raise CoFoldValidationError("pocket.max_distance must be a number (Angstrom).")
    if not (4.0 <= max_dist <= 20.0):
        raise CoFoldValidationError("pocket.max_distance must be 4-20 Å (Boltz-2 supported range).")
    force = bool(raw.get("force", False))
    return CoFoldPocket(binder=binder, contacts=contacts, max_distance=max_dist, force=force)


def _validate_contacts(raw: Any, id_set: set[str]) -> list[CoFoldContact]:
    """Validate the top-level 'contacts' list (distinct from pocket.contacts)."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CoFoldValidationError("'contacts' must be a list.")
    out: list[CoFoldContact] = []
    for i, c in enumerate(raw):
        if not isinstance(c, dict):
            raise CoFoldValidationError(f"Contact #{i + 1} must be an object.")
        t1 = _parse_token_ref(c.get("token1"), f"Contact #{i + 1} token1", id_set)
        t2 = _parse_token_ref(c.get("token2"), f"Contact #{i + 1} token2", id_set)
        max_dist = c.get("max_distance", 6.0)
        try:
            max_dist = float(max_dist)
        except (TypeError, ValueError):
            raise CoFoldValidationError(f"Contact #{i + 1}: max_distance must be a number.")
        if not (4.0 <= max_dist <= 20.0):
            raise CoFoldValidationError(f"Contact #{i + 1}: max_distance must be 4-20 Å.")
        force = bool(c.get("force", False))
        out.append(CoFoldContact(token1=t1, token2=t2, max_distance=max_dist, force=force))
    return out


def _validate_templates(raw: Any, base_ids: set[str]) -> list[CoFoldTemplate]:
    """Validate structural template definitions.

    Templates allow the user to provide a known (or predicted) structure as a
    backbone reference, guiding Boltz-2 toward a known conformation.  Useful for:
      • Using an AlphaFold DB predicted structure as a starting template
      • Using a crystal structure from the RCSB as a constraint
      • Enforcing a known peptide backbone when docking a new ligand
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CoFoldValidationError("'templates' must be a list.")
    out: list[CoFoldTemplate] = []
    for i, t in enumerate(raw):
        if not isinstance(t, dict):
            raise CoFoldValidationError(f"Template #{i + 1} must be an object.")
        src_url = str(t.get("source_url") or "").strip()
        if not src_url:
            raise CoFoldValidationError(
                f"Template #{i + 1}: 'source_url' is required (HTTP URL to a .cif or .pdb file). "
                f"Use the /alphafold-db or /rcsb-pdb routes to obtain template URLs."
            )
        fmt = str(t.get("source_format") or "cif").lower()
        if fmt not in ("cif", "pdb"):
            raise CoFoldValidationError(f"Template #{i + 1}: source_format must be 'cif' or 'pdb'.")
        chain_ids = [str(c).strip().upper() for c in (t.get("chain_ids") or [])]
        template_ids = [str(c).strip().upper() for c in (t.get("template_ids") or [])]
        if chain_ids and template_ids and len(chain_ids) != len(template_ids):
            raise CoFoldValidationError(
                f"Template #{i + 1}: chain_ids and template_ids must have the same length."
            )
        for cid in chain_ids:
            if cid not in base_ids:
                raise CoFoldValidationError(
                    f"Template #{i + 1}: chain_id {cid!r} not found in entity ids."
                )
        force = bool(t.get("force", False))
        threshold = t.get("threshold", 2.0)
        if force:
            try:
                threshold = float(threshold)
            except (TypeError, ValueError):
                raise CoFoldValidationError(f"Template #{i + 1}: threshold must be a number (Å).")
            if threshold <= 0:
                raise CoFoldValidationError(f"Template #{i + 1}: threshold must be positive.")
        out.append(CoFoldTemplate(
            source_url=src_url, source_format=fmt,
            chain_ids=chain_ids, template_ids=template_ids,
            force=force, threshold=threshold,
        ))
    return out


def _validate_options(raw: Any) -> dict:
    """Parse and validate every Boltz-2 prediction option."""
    raw = raw if isinstance(raw, dict) else {}

    def _int(key: str, default: int, lo: int, hi: int) -> int:
        v = raw.get(key, default)
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise CoFoldValidationError(f"options.{key} must be an integer.")
        if not (lo <= v <= hi):
            raise CoFoldValidationError(f"options.{key} must be {lo}-{hi}, got {v}.")
        return v

    def _float(key: str, default: float, lo: float, hi: float) -> float:
        v = raw.get(key, default)
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise CoFoldValidationError(f"options.{key} must be a number.")
        if not (lo <= v <= hi):
            raise CoFoldValidationError(f"options.{key} must be {lo}-{hi}, got {v}.")
        return v

    fmt = str(raw.get("output_format") or "mmcif").lower()
    if fmt not in ("mmcif", "pdb"):
        raise CoFoldValidationError("options.output_format must be 'mmcif' or 'pdb'.")

    return {
        # Structure diffusion
        "diffusion_samples":    _int("diffusion_samples", 1, 1, 25),
        "recycling_steps":      _int("recycling_steps", 3, 1, 10),
        "sampling_steps":       _int("sampling_steps", 200, 25, 1000),
        "step_scale":           _float("step_scale", 1.638, 0.5, 3.0),
        "max_parallel_samples": _int("max_parallel_samples", 5, 1, 25),
        # MSA
        "use_msa_server":       bool(raw.get("use_msa_server", True)),
        "max_msa_seqs":         _int("max_msa_seqs", 8192, 32, 65536),
        "subsample_msa":        bool(raw.get("subsample_msa", False)),
        "num_subsampled_msa":   _int("num_subsampled_msa", 1024, 32, 8192),
        # Physics / kernels
        "use_potentials":       bool(raw.get("use_potentials", False)),
        "no_kernels":           bool(raw.get("no_kernels", False)),
        # Output
        "output_format":        fmt,
        "write_full_pae":       bool(raw.get("write_full_pae", False)),
        "write_full_pde":       bool(raw.get("write_full_pde", False)),
        # Affinity
        "affinity_mw_correction":      bool(raw.get("affinity_mw_correction", False)),
        "sampling_steps_affinity":     _int("sampling_steps_affinity", 200, 25, 1000),
        "diffusion_samples_affinity":  _int("diffusion_samples_affinity", 5, 1, 25),
    }


# ===========================================================================
# Top-level design validation
# ===========================================================================

def validate_design(raw: Any) -> CoFoldDesign:
    """Parse + fully validate a co-folding request.

    Raises CoFoldValidationError (→ HTTP 400) on any problem.  Runs on CPU
    with no GPU cost — the cheap gate that guarantees a paid GPU is never spent
    on a broken design.
    """
    if not isinstance(raw, dict):
        raise CoFoldValidationError("Request body must be a JSON object.")

    name = re.sub(r"[^A-Za-z0-9_-]+", "-", str(raw.get("name") or "cofold")).strip("-") or "cofold"

    raw_entities = raw.get("entities")
    if not isinstance(raw_entities, list) or not raw_entities:
        raise CoFoldValidationError("At least one entity is required in 'entities'.")
    if len(raw_entities) > MAX_ENTITIES:
        raise CoFoldValidationError(f"Too many entities ({len(raw_entities)}); limit is {MAX_ENTITIES}.")

    entities = [_parse_entity(e, i) for i, e in enumerate(raw_entities)]

    all_chain_ids: list[str] = []
    total_tokens = 0
    n_proteins = n_peptides = 0
    for ent in entities:
        if not (1 <= ent.copies <= MAX_TOTAL_CHAINS):
            raise CoFoldValidationError(
                f"Entity {ent.id}: copies must be 1-{MAX_TOTAL_CHAINS}, got {ent.copies}."
            )
        if ent.type in ("protein", "peptide"):
            per_copy = _validate_protein_like(ent)
            if ent.type == "protein":
                n_proteins += 1
            else:
                n_peptides += 1
        elif ent.type in ("dna", "rna"):
            per_copy = _validate_nucleic(ent)
        elif ent.type == "ligand":
            per_copy = _validate_ligand(ent)
        else:
            per_copy = _validate_ion(ent)
        total_tokens += per_copy * ent.copies
        all_chain_ids.extend(_expand_ids(ent))

    dupes = sorted({c for c in all_chain_ids if all_chain_ids.count(c) > 1})
    if dupes:
        raise CoFoldValidationError(
            f"Chain id collision after copy-expansion: {dupes}. Rename an entity so "
            f"generated copy ids (A → A, A2, A3) do not clash."
        )
    if len(all_chain_ids) > MAX_TOTAL_CHAINS:
        raise CoFoldValidationError(
            f"Total chains after expansion ({len(all_chain_ids)}) exceeds the {MAX_TOTAL_CHAINS}-chain limit."
        )
    if total_tokens > MAX_TOTAL_TOKENS:
        raise CoFoldValidationError(
            f"Estimated complex size ({total_tokens} tokens) exceeds the {MAX_TOTAL_TOKENS}-token "
            f"limit (GPU-memory / cost guard). Trim the design."
        )

    id_set = set(all_chain_ids)
    base_id_set = {e.id for e in entities}

    bonds    = _validate_bonds(raw.get("bonds"), id_set)
    pocket   = _validate_pocket(raw.get("pocket"), entities, base_id_set, id_set)
    contacts = _validate_contacts(raw.get("contacts"), id_set)
    templates = _validate_templates(raw.get("templates"), base_id_set)
    options  = _validate_options(raw.get("options"))

    # ── Affinity binder ─────────────────────────────────────────────────────
    # Boltz-2's affinity head is trained on protein–small-molecule pairs.
    # Protein–peptide and protein–protein affinities are experimentally plausible
    # but less reliable; we support them with a warning rather than a hard block.
    affinity_binder = raw.get("affinity_binder")
    affinity_binder_type = ""
    if affinity_binder:
        affinity_binder = str(affinity_binder).strip().upper()
        binder_ent = next((e for e in entities if e.id == affinity_binder), None)
        if binder_ent is None:
            raise CoFoldValidationError(
                f"affinity_binder {affinity_binder!r} does not match any entity id."
            )
        if binder_ent.type not in ("ligand", "peptide", "protein"):
            raise CoFoldValidationError(
                f"affinity_binder must be a 'ligand', 'peptide', or 'protein' entity — "
                f"got {binder_ent.type!r}."
            )
        if binder_ent.type == "ligand" and _RDKIT and binder_ent.smiles:
            mol = Chem.MolFromSmiles(binder_ent.smiles)
            if mol:
                h_mol = Chem.AddHs(mol)
                n_atoms = h_mol.GetNumAtoms()
                if n_atoms > MAX_LIGAND_ATOMS_AFFINITY:
                    raise CoFoldValidationError(
                        f"Ligand {affinity_binder} has {n_atoms} atoms (including H) — "
                        f"Boltz-2's affinity head supports ≤{MAX_LIGAND_ATOMS_AFFINITY}. "
                        f"Use a smaller fragment or remove the affinity request."
                    )
        if (n_proteins + n_peptides) == 0:
            raise CoFoldValidationError(
                "Affinity prediction needs a receptor: add at least one protein or peptide entity."
            )
        affinity_binder_type = binder_ent.type

    return CoFoldDesign(
        name=name,
        entities=entities,
        bonds=bonds,
        pocket=pocket,
        contacts=contacts,
        templates=templates,
        affinity_binder=affinity_binder or None,
        affinity_binder_type=affinity_binder_type,
        options=options,
    )


# ===========================================================================
# Boltz YAML rendering
# ===========================================================================

def _q(s: str) -> str:
    """Single-quote a YAML scalar (SMILES can contain :, [, ], #, =, etc.)."""
    return "'" + str(s).replace("'", "''") + "'"


def build_boltz_yaml(design: CoFoldDesign) -> tuple[str, bool]:
    """Render a validated design to a Boltz v1 YAML string.

    Returns (yaml_text, needs_msa_server). `needs_msa_server` is True when at
    least one chain requests auto-generated MSA from the ColabFold server.
    """
    use_server = design.options.get("use_msa_server", True)
    lines: list[str] = ["version: 1", "sequences:"]
    needs_msa = False

    for ent in design.entities:
        ids = _expand_ids(ent)
        id_field = ids[0] if len(ids) == 1 else "[" + ", ".join(ids) + "]"

        if ent.type in ("protein", "peptide"):
            lines.append("  - protein:")
            lines.append(f"      id: {id_field}")
            lines.append(f"      sequence: {ent.sequence}")
            if use_server and ent.use_msa:
                needs_msa = True
            else:
                lines.append("      msa: empty")
            if ent.cyclic:
                lines.append("      cyclic: true")
            if ent.modifications:
                lines.append("      modifications:")
                for m in ent.modifications:
                    lines.append(f"        - position: {m['position']}")
                    lines.append(f"          ccd: {m['ccd']}")

        elif ent.type in ("dna", "rna"):
            lines.append(f"  - {ent.type}:")
            lines.append(f"      id: {id_field}")
            lines.append(f"      sequence: {ent.sequence}")
            if ent.cyclic:
                lines.append("      cyclic: true")
            if ent.modifications:
                lines.append("      modifications:")
                for m in ent.modifications:
                    lines.append(f"        - position: {m['position']}")
                    lines.append(f"          ccd: {m['ccd']}")

        elif ent.type == "ligand":
            lines.append("  - ligand:")
            lines.append(f"      id: {id_field}")
            if ent.smiles:
                lines.append(f"      smiles: {_q(ent.smiles)}")
            else:
                lines.append(f"      ccd: {ent.ccd}")

        else:  # ion — modelled as a CCD ligand in Boltz
            lines.append("  - ligand:")
            lines.append(f"      id: {id_field}")
            lines.append(f"      ccd: {ent.ccd}")

    # ── Constraints ──────────────────────────────────────────────────────────
    if design.bonds or design.pocket or design.contacts:
        lines.append("constraints:")
        for b in design.bonds:
            a1, a2 = b.atom1, b.atom2
            lines.append("  - bond:")
            lines.append(f"      atom1: [{a1['chain']}, {a1['residue']}, {a1['atom']}]")
            lines.append(f"      atom2: [{a2['chain']}, {a2['residue']}, {a2['atom']}]")
        if design.pocket:
            p = design.pocket
            contacts_yaml = ", ".join(f"[{c['chain']}, {c['residue']}]" for c in p.contacts)
            lines.append("  - pocket:")
            lines.append(f"      binder: {p.binder}")
            lines.append(f"      contacts: [{contacts_yaml}]")
            lines.append(f"      max_distance: {p.max_distance}")
            if p.force:
                lines.append("      force: true")
        for c in design.contacts:
            t1, t2 = c.token1, c.token2
            # Token ref: prefer [chain, residue], fall back to [chain, atom]
            def _tok_yaml(t: dict) -> str:
                chain = t["chain"]
                if "residue" in t:
                    return f"[{chain}, {t['residue']}]"
                return f"[{chain}, {t['atom']}]"
            lines.append("  - contact:")
            lines.append(f"      token1: {_tok_yaml(t1)}")
            lines.append(f"      token2: {_tok_yaml(t2)}")
            lines.append(f"      max_distance: {c.max_distance}")
            if c.force:
                lines.append("      force: true")

    # ── Templates ────────────────────────────────────────────────────────────
    # NOTE: Templates reference local file paths on the GPU worker.  We embed
    # the source_url in a special comment field so the worker knows where to
    # fetch the file.  The actual `templates:` block is built by the worker
    # after downloading the files.
    if design.templates:
        lines.append("# HAKASE_TEMPLATES_FOLLOW")
        for tmpl in design.templates:
            chain_field = ""
            if tmpl.chain_ids:
                chain_field = " chain_ids=[" + ",".join(tmpl.chain_ids) + "]"
            tid_field = ""
            if tmpl.template_ids:
                tid_field = " template_ids=[" + ",".join(tmpl.template_ids) + "]"
            force_field = " force=true" if tmpl.force else ""
            thresh_field = f" threshold={tmpl.threshold}" if tmpl.force else ""
            lines.append(
                f"# TEMPLATE url={tmpl.source_url} fmt={tmpl.source_format}"
                f"{chain_field}{tid_field}{force_field}{thresh_field}"
            )

    # ── Properties (affinity) ─────────────────────────────────────────────
    if design.affinity_binder:
        lines.append("properties:")
        lines.append("  - affinity:")
        lines.append(f"      binder: {design.affinity_binder}")

    return "\n".join(lines) + "\n", needs_msa


# ===========================================================================
# Design summary (GPU-free cost/runtime estimate)
# ===========================================================================

def summarize_design(design: CoFoldDesign) -> dict[str, Any]:
    """A GPU-free summary: entity breakdown, token estimate, rough runtime/cost.

    Powers the /cofold/validate endpoint so clients can iterate for free before
    spending any GPU budget.
    """
    breakdown: dict[str, int] = {}
    total_tokens = 0
    n_chains = 0
    for ent in design.entities:
        breakdown[ent.type] = breakdown.get(ent.type, 0) + ent.copies
        n_chains += ent.copies
        if ent.type in ("protein", "peptide", "dna", "rna"):
            total_tokens += len(ent.sequence) * ent.copies
        elif ent.type == "ligand" and ent.smiles and _RDKIT:
            m = Chem.MolFromSmiles(ent.smiles)
            total_tokens += (m.GetNumHeavyAtoms() if m else 12) * ent.copies
        else:
            total_tokens += 12 * ent.copies

    affinity = bool(design.affinity_binder)
    opts = design.options
    base_min = 0.6 + total_tokens / 230.0
    base_min *= max(1, opts.get("diffusion_samples", 1)) ** 0.7
    base_min *= opts.get("recycling_steps", 3) / 3.0
    if opts.get("step_scale", 1.638) > 2.0:
        base_min *= 1.1   # longer trajectories at high step scale
    if affinity:
        n_aff = opts.get("diffusion_samples_affinity", 5)
        base_min += 1.5 + n_aff * 0.3
    needs_msa = opts.get("use_msa_server", True) and any(
        e.type in ("protein", "peptide") and e.use_msa for e in design.entities
    )
    if needs_msa:
        base_min += 2.0
    if design.templates:
        base_min += len(design.templates) * 0.5   # template download + preprocessing
    est_min = round(base_min, 1)
    cost_lo = round(est_min / 60.0 * 0.79, 3)
    cost_hi = round(est_min / 60.0 * 2.99, 3)

    warnings: list[str] = []
    if design.affinity_binder_type == "peptide":
        warnings.append(
            "Peptide–protein affinity: Boltz-2's affinity head is trained primarily "
            "on small-molecule data. Peptide affinity outputs are experimental — use "
            "as a relative ranking signal, not an absolute pIC50 value."
        )
    if design.affinity_binder_type == "protein":
        warnings.append(
            "Protein–protein affinity: not reliably supported by Boltz-2's affinity "
            "head. Use for exploratory purposes only; validate with SPR/ITC."
        )
    if design.contacts:
        warnings.append(
            f"{len(design.contacts)} contact constraint(s) applied. Contact constraints "
            "narrow the conformational ensemble — review that the experimental evidence "
            "justifies each constraint."
        )
    if design.templates:
        warnings.append(
            f"{len(design.templates)} structural template(s) will be downloaded by the "
            "GPU worker. Ensure URLs are publicly accessible from the RunPod environment."
        )

    return {
        "n_entities": len(design.entities),
        "n_chains": n_chains,
        "entity_breakdown": breakdown,
        "estimated_tokens": total_tokens,
        "affinity_requested": affinity,
        "affinity_binder_type": design.affinity_binder_type or None,
        "uses_msa_server": needs_msa,
        "has_covalent_bonds": bool(design.bonds),
        "has_pocket_conditioning": bool(design.pocket),
        "has_contact_constraints": bool(design.contacts),
        "has_templates": bool(design.templates),
        "estimated_runtime_minutes": est_min,
        "estimated_cost_usd_range": [cost_lo, cost_hi],
        "design_warnings": warnings,
        "estimate_caveat": (
            "Runtime/cost are rough GPU-class estimates, not a quote. Real time "
            "depends on the RunPod GPU tier, MSA-server queue depth, and cold-start state."
        ),
    }


# ===========================================================================
# Result contract — mirrors the RunPod worker output
# ===========================================================================

@dataclass
class CoFoldJobResult:
    structure: str                    # CIF or PDB text of the top-ranked model
    structure_format: str             # "mmcif" | "pdb"
    confidence: dict                  # full confidence JSON from Boltz
    per_residue_plddt: Optional[list]
    pae_matrix: Optional[list]        # block-averaged PAE (or full if write_full_pae=True)
    pde_matrix: Optional[list]        # Predicted Distance Error matrix (new in Boltz-2)
    affinity: Optional[dict]          # ensemble affinity + per-model affinity_pred_value1/2
    models: list[dict]                # all diffusion_samples ranked by confidence
    n_models: int
    n_chains: int
    n_residues_modeled: int
    engine: str
    boltz_version: str
    gpu_name: str
    msa_source: str
    wallclock_seconds: float
    warnings: list[str]
    runpod_job_id: str
    boltz_yaml: str


@dataclass
class CoFoldJob:
    job_id: str
    status: str = "queued"            # queued | running | done | failed
    name: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
    progress: str = ""
    summary: Optional[dict] = None
    runpod_job_id: Optional[str] = None
    result: Optional[CoFoldJobResult] = None
    error: Optional[str] = None


# ===========================================================================
# Job store + RunPod dispatch
# ===========================================================================

# ===========================================================================
# SQLite-backed job store — survives process restarts, replaces in-memory dict
# ===========================================================================

_DB_DIR = pathlib.Path(os.environ.get("HAKASE_DATA_DIR", ".")).resolve()
_DB_PATH = _DB_DIR / "cofold_jobs.sqlite3"

_JOBS_LOCK = threading.Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="cofold-runpod")


def _db_conn() -> sqlite3.Connection:
    """Thread-local SQLite connection with WAL mode for concurrent reads."""
    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cofold_jobs (
            job_id         TEXT PRIMARY KEY,
            status         TEXT NOT NULL DEFAULT 'queued',
            name           TEXT NOT NULL DEFAULT '',
            started_at     REAL NOT NULL DEFAULT 0.0,
            finished_at    REAL NOT NULL DEFAULT 0.0,
            progress       TEXT NOT NULL DEFAULT '',
            summary_json   TEXT,
            runpod_job_id  TEXT,
            result_json    TEXT,
            error          TEXT,
            created_at     REAL NOT NULL DEFAULT 0.0
        )
    """)
    conn.commit()
    return conn


def _insert_job(job: CoFoldJob) -> None:
    """Insert a new job row."""
    conn = _db_conn()
    try:
        conn.execute(
            """INSERT INTO cofold_jobs
               (job_id, status, name, started_at, finished_at, progress,
                summary_json, runpod_job_id, result_json, error, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job.job_id, job.status, job.name,
                job.started_at, job.finished_at, job.progress,
                json.dumps(job.summary) if job.summary else None,
                job.runpod_job_id,
                json.dumps(asdict(job.result)) if job.result else None,
                job.error,
                time.time(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _set(job_id: str, **fields) -> None:
    """Update arbitrary fields on a job row."""
    if not fields:
        return
    # Map dataclass fields to column names
    col_map = {
        "summary": "summary_json",
        "result":  "result_json",
    }
    sets = []
    vals = []
    for k, v in fields.items():
        col = col_map.get(k, k)
        if col == "summary_json":
            v = json.dumps(v) if v is not None else None
        elif col == "result_json":
            v = json.dumps(asdict(v)) if v is not None else None
        sets.append(f"{col} = ?")
        vals.append(v)
    vals.append(job_id)

    conn = _db_conn()
    try:
        conn.execute(
            f"UPDATE cofold_jobs SET {', '.join(sets)} WHERE job_id = ?",
            vals,
        )
        conn.commit()
    finally:
        conn.close()


def get_job(job_id: str) -> Optional[dict]:
    """Retrieve a job by ID. Returns the same dict shape as the previous in-memory store."""
    conn = _db_conn()
    try:
        row = conn.execute(
            """SELECT job_id, status, name, progress, started_at, finished_at,
                      summary_json, runpod_job_id, error, result_json
               FROM cofold_jobs WHERE job_id = ?""",
            (job_id,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None
    return {
        "job_id":        row[0],
        "status":        row[1],
        "name":          row[2],
        "progress":      row[3],
        "started_at":    row[4],
        "finished_at":   row[5],
        "summary":       json.loads(row[6]) if row[6] else None,
        "runpod_job_id": row[7],
        "error":         row[8],
        "result":        json.loads(row[9]) if row[9] else None,
    }


def list_jobs(limit: int = 50, status: Optional[str] = None) -> list[dict]:
    """List recent jobs, optionally filtered by status."""
    conn = _db_conn()
    try:
        if status:
            rows = conn.execute(
                """SELECT job_id, status, name, progress, started_at, finished_at,
                          summary_json, runpod_job_id, error
                   FROM cofold_jobs WHERE status = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT job_id, status, name, progress, started_at, finished_at,
                          summary_json, runpod_job_id, error
                   FROM cofold_jobs ORDER BY created_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
    finally:
        conn.close()

    return [
        {
            "job_id": r[0], "status": r[1], "name": r[2], "progress": r[3],
            "started_at": r[4], "finished_at": r[5],
            "summary": json.loads(r[6]) if r[6] else None,
            "runpod_job_id": r[7], "error": r[8],
        }
        for r in rows
    ]


def submit_cofold(raw_request: Any) -> dict:
    """Validate a design, build the Boltz YAML, and dispatch a RunPod job.

    Raises CoFoldValidationError (→ 400) for a bad design.
    Raises RuntimeError (→ 503) when the GPU backend is not configured.
    Never fabricates a result.
    """
    design = validate_design(raw_request)
    yaml_text, needs_msa = build_boltz_yaml(design)
    summary = summarize_design(design)

    ok, reason = cofolding_configured()
    if not ok:
        raise RuntimeError(
            f"RunPod is not configured: {reason}. Co-folding requires a Boltz-2 "
            f"RunPod Serverless GPU endpoint. Per project policy, no structure is "
            f"fabricated when the GPU backend is unavailable. The design validated "
            f"successfully — only dispatch is blocked."
        )

    job_id = uuid.uuid4().hex[:12]
    job = CoFoldJob(job_id=job_id, name=design.name, summary=summary)
    _insert_job(job)

    _EXECUTOR.submit(_run_job, job_id, design, yaml_text, needs_msa)
    return {"job_id": job_id, "status": "queued", "summary": summary}


def _run_job(job_id: str, design: CoFoldDesign, yaml_text: str, needs_msa: bool) -> None:
    t0 = time.time()
    _set(job_id, status="running", started_at=t0, progress="submitting to RunPod")
    try:
        api_key     = _env("RUNPOD_API_KEY")
        endpoint_id = _env("RUNPOD_BOLTZ_ENDPOINT_ID")
        if not api_key or not endpoint_id:
            raise RuntimeError("RunPod credentials disappeared between submit and dispatch")

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        opts = design.options

        payload = {
            "input": {
                "boltz_yaml": yaml_text,
                "job_name": design.name,
                # Structure diffusion
                "diffusion_samples":    opts["diffusion_samples"],
                "recycling_steps":      opts["recycling_steps"],
                "sampling_steps":       opts["sampling_steps"],
                "step_scale":           opts["step_scale"],
                "max_parallel_samples": opts["max_parallel_samples"],
                # MSA
                "use_msa_server":       needs_msa,
                "max_msa_seqs":         opts["max_msa_seqs"],
                "subsample_msa":        opts["subsample_msa"],
                "num_subsampled_msa":   opts["num_subsampled_msa"],
                # Physics / kernels
                "use_potentials":       opts["use_potentials"],
                "no_kernels":           opts["no_kernels"],
                # Output
                "output_format":        opts["output_format"],
                "write_full_pae":       opts["write_full_pae"],
                "write_full_pde":       opts["write_full_pde"],
                # Affinity
                "affinity_requested":           bool(design.affinity_binder),
                "affinity_binder_type":         design.affinity_binder_type,
                "affinity_mw_correction":       opts["affinity_mw_correction"],
                "sampling_steps_affinity":      opts["sampling_steps_affinity"],
                "diffusion_samples_affinity":   opts["diffusion_samples_affinity"],
            }
        }

        run_url = f"{RUNPOD_BASE}/{endpoint_id}/run"
        r = requests.post(run_url, headers=headers, json=payload, timeout=RUNPOD_TIMEOUT_S)
        if r.status_code != 200:
            raise RuntimeError(f"RunPod /run failed HTTP {r.status_code}: {r.text[:400]}")
        runpod_job_id = r.json().get("id")
        if not runpod_job_id:
            raise RuntimeError(f"RunPod /run returned no id: {r.json()}")
        _set(job_id, runpod_job_id=runpod_job_id, progress=f"queued on RunPod ({runpod_job_id})")

        status_url = f"{RUNPOD_BASE}/{endpoint_id}/status/{runpod_job_id}"
        deadline = time.time() + POLL_DEADLINE_S
        last_status = ""
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL_S)
            try:
                rs = requests.get(status_url, headers=headers, timeout=RUNPOD_TIMEOUT_S)
            except requests.RequestException as e:
                _set(job_id, progress=f"poll transient error ({type(e).__name__}); retrying")
                continue
            if rs.status_code != 200:
                raise RuntimeError(f"RunPod /status failed HTTP {rs.status_code}: {rs.text[:300]}")
            sdata = rs.json()
            rp_status = sdata.get("status", "UNKNOWN")
            if rp_status != last_status:
                last_status = rp_status
                _set(job_id, progress=f"RunPod status: {rp_status}")
            if rp_status == "COMPLETED":
                output = sdata.get("output")
                if output is None:
                    raise RuntimeError("RunPod COMPLETED but no output payload")
                _store_result(job_id, output, runpod_job_id, yaml_text,
                              bool(design.affinity_binder))
                return
            if rp_status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                err = sdata.get("error") or sdata.get("output") or "no error message"
                raise RuntimeError(f"RunPod job {rp_status}: {err}")

        raise RuntimeError(
            f"RunPod job {runpod_job_id} exceeded the {POLL_DEADLINE_S // 3600} h poll "
            f"window without completing. It may still be running — check the RunPod console."
        )
    except Exception as e:  # noqa: BLE001
        _set(job_id, status="failed", finished_at=time.time(),
             progress="failed", error=f"{type(e).__name__}: {e}")


def _store_result(job_id: str, output: dict, runpod_job_id: str,
                  yaml_text: str, affinity_requested: bool) -> None:
    """Validate the worker output and convert it to CoFoldJobResult.

    Per project policy: missing required fields raise — never substitute defaults.
    """
    if not isinstance(output, dict):
        raise RuntimeError(f"RunPod worker output is not an object: {type(output).__name__}")

    required = ["structure", "structure_format", "confidence", "boltz_version", "engine"]
    missing = [k for k in required if k not in output]
    if missing:
        raise RuntimeError(
            f"RunPod worker output missing required fields {missing}. "
            f"Per project policy, no defaults are substituted. Worker keys: {list(output.keys())}"
        )
    if affinity_requested and not output.get("affinity"):
        raise RuntimeError(
            "Affinity was requested but the worker returned no affinity block. "
            "Per project policy no affinity number is fabricated — the job fails."
        )

    result = CoFoldJobResult(
        structure=str(output["structure"]),
        structure_format=str(output["structure_format"]),
        confidence=dict(output.get("confidence") or {}),
        per_residue_plddt=output.get("per_residue_plddt"),
        pae_matrix=output.get("pae_matrix"),
        pde_matrix=output.get("pde_matrix"),          # NEW: PDE scores from Boltz-2
        affinity=output.get("affinity"),               # includes _1/_2 ensemble members
        models=list(output.get("models") or []),
        n_models=int(output.get("n_models") or len(output.get("models") or []) or 1),
        n_chains=int(output.get("n_chains") or 0),
        n_residues_modeled=int(output.get("n_residues_modeled") or 0),
        engine=str(output["engine"]),
        boltz_version=str(output["boltz_version"]),
        gpu_name=str(output.get("gpu_name") or "unknown"),
        msa_source=str(output.get("msa_source") or "unknown"),
        wallclock_seconds=float(output.get("wallclock_seconds") or 0.0),
        warnings=list(output.get("warnings") or []),
        runpod_job_id=runpod_job_id,
        boltz_yaml=yaml_text,
    )
    _set(job_id, status="done", finished_at=time.time(), progress="complete", result=result)
