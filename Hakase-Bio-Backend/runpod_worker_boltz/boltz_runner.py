"""Run Boltz-2 biomolecular co-folding + binding-affinity prediction.

Boltz-2 is an open, AlphaFold3-class structure model (MIT license — usable in a
commercial product, unlike AlphaFold 3's own weights). It jointly predicts the
3D structure of an arbitrary complex (proteins, peptides, DNA, RNA, small-
molecule ligands, ions, modified residues, covalent bonds) and — uniquely among
the open AF3-class models — a binding-affinity head for ligand binders.

This module is the GPU-side execution unit. It receives a fully-formed Boltz
YAML (built and validated upstream by `artifacts/ai-service/models/cofolding.py`
BEFORE any GPU is paid for), runs the `boltz predict` CLI, and parses every
artifact Boltz emits into the strict JSON contract the upstream expects.

Honesty contract (project-wide):
- NO fabricated structures or confidence. If Boltz fails, raise with the exact
  reason — no surrogate model, no "best-effort" partial output.
- NO silent CPU fallback. Boltz on CPU is unusable for real complexes; if CUDA
  is absent the worker raises so the operator fixes the GPU config.
- NO defaults for required output fields. Either the artifact exists on disk
  or the job fails.

Reference: Passaro et al., "Boltz-2: Towards Accurate and Efficient Binding
Affinity Prediction", bioRxiv 2025.06.14.659707. https://github.com/jwohlwend/boltz
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np


class BoltzRunError(RuntimeError):
    """Honest failure from the Boltz pipeline. Message reaches the user verbatim."""


# Boltz writes IC50-like affinity as log10(IC50 / µM). These are Boltz's own
# documented conversions (boltz repo, affinity docs) — NOT a Hakase invention.
#   IC50 (µM)        = 10 ** affinity_pred_value
#   binding ΔG-like  = (6 - affinity_pred_value) * 1.364  kcal/mol
_KCAL_PER_LOG_UNIT = 1.364


@dataclass
class BoltzInput:
    """Validated input for one co-folding job — mirrors cofolding.py options exactly."""
    yaml_text:            str
    job_name:             str   = "cofold"
    # ── Structure diffusion ───────────────────────────────────────────────
    diffusion_samples:    int   = 1
    recycling_steps:      int   = 3
    sampling_steps:       int   = 200
    step_scale:           float = 1.638   # diffusion temperature (diversity control)
    max_parallel_samples: int   = 5
    # ── MSA ───────────────────────────────────────────────────────────────
    use_msa_server:       bool  = True
    msa_server_url:       str   = "https://api.colabfold.com"
    max_msa_seqs:         int   = 8192
    subsample_msa:        bool  = False
    num_subsampled_msa:   int   = 1024
    # ── Physics / kernels ─────────────────────────────────────────────────
    use_potentials:       bool  = False
    no_kernels:           bool  = False
    # ── Output ────────────────────────────────────────────────────────────
    output_format:        str   = "mmcif"
    write_full_pae:       bool  = False
    write_full_pde:       bool  = False
    max_pae_dim:          int   = 600     # block-average threshold for large PAE matrices
    # ── Affinity ──────────────────────────────────────────────────────────
    affinity_requested:         bool  = False
    affinity_binder_type:       str   = "ligand"   # ligand | peptide | protein
    affinity_mw_correction:     bool  = False
    sampling_steps_affinity:    int   = 200
    diffusion_samples_affinity: int   = 5


# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------

def _gpu_name() -> str:
    """Return the CUDA device name, or raise if no CUDA GPU is visible.

    Per the honesty contract there is no CPU fallback: Boltz-2 on CPU takes
    hours for a trivial complex and would silently degrade every result."""
    try:
        import torch
    except Exception as e:  # noqa: BLE001
        raise BoltzRunError(f"PyTorch import failed inside the worker: {e}") from e
    if not torch.cuda.is_available():
        raise BoltzRunError(
            "No CUDA GPU visible to the Boltz worker. Boltz-2 requires a GPU "
            "(≥24 GB VRAM recommended). Check the RunPod endpoint GPU configuration."
        )
    return torch.cuda.get_device_name(0)


def boltz_version() -> str:
    try:
        import boltz  # noqa: F401
        v = getattr(boltz, "__version__", None)
        if v:
            return str(v)
    except Exception:  # noqa: BLE001
        pass
    # Fall back to the installed-distribution metadata.
    try:
        from importlib.metadata import version
        return version("boltz")
    except Exception:  # noqa: BLE001
        return "unknown"


# ---------------------------------------------------------------------------
# Core run
# ---------------------------------------------------------------------------

def run_cofolding(inp: BoltzInput) -> dict[str, Any]:
    """Run one Boltz-2 prediction and return the parsed output contract.

    Raises BoltzRunError on any failure — the message is surfaced verbatim to
    the user by the upstream poll loop."""
    t0 = time.time()
    gpu = _gpu_name()
    bz_version = boltz_version()

    cache_dir = os.environ.get("BOLTZ_CACHE", "/opt/boltz_cache")
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="boltz_"))
    try:
        out_dir = work / "out"
        out_dir.mkdir()

        # ── Handle template URLs embedded as YAML comments ───────────────
        # cofolding.py serialises template source_url values as YAML comment
        # lines so we can download them here on the GPU worker (where HTTP
        # access is available) rather than piping binary CIF/PDB blobs through
        # the RunPod payload.
        yaml_text_final, template_local_paths = _fetch_templates(inp.yaml_text, work)

        stem = "cofold"
        yaml_path = work / f"{stem}.yaml"
        yaml_path.write_text(yaml_text_final, encoding="utf-8")

        cmd: list[str] = [
            sys.executable, "-m", "boltz", "predict", str(yaml_path),
            "--out_dir", str(out_dir),
            "--cache", cache_dir,
            "--output_format", inp.output_format,
            "--diffusion_samples", str(inp.diffusion_samples),
            "--recycling_steps", str(inp.recycling_steps),
            "--sampling_steps", str(inp.sampling_steps),
            "--step_scale", str(inp.step_scale),
            "--max_parallel_samples", str(inp.max_parallel_samples),
            "--max_msa_seqs", str(inp.max_msa_seqs),
            "--num_workers", "2",
            "--accelerator", "gpu",
            "--devices", "1",
            "--override",
        ]
        if inp.use_msa_server:
            cmd += ["--use_msa_server", "--msa_server_url", inp.msa_server_url]
        if inp.subsample_msa:
            cmd += ["--subsample_msa", "--num_subsampled_msa", str(inp.num_subsampled_msa)]
        if inp.use_potentials:
            cmd += ["--use_potentials"]
        if inp.no_kernels:
            cmd += ["--no_kernels"]
        if inp.write_full_pae:
            cmd += ["--write_full_pae"]
        if inp.write_full_pde:
            cmd += ["--write_full_pde"]
        if inp.affinity_requested:
            cmd += [
                "--sampling_steps_affinity", str(inp.sampling_steps_affinity),
                "--diffusion_samples_affinity", str(inp.diffusion_samples_affinity),
            ]
            if inp.affinity_mw_correction:
                cmd += ["--affinity_mw_correction"]

        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=str(work),
            timeout=_exec_timeout_seconds(),
        )
        if proc.returncode != 0:
            tail_out = (proc.stdout or "")[-2000:]
            tail_err = (proc.stderr or "")[-2500:]
            raise BoltzRunError(
                f"boltz predict exited rc={proc.returncode}.\n"
                f"--- stderr tail ---\n{tail_err}\n--- stdout tail ---\n{tail_out}"
            )

        result = _parse_outputs(out_dir, stem, inp)
        result["boltz_version"] = bz_version
        result["engine"] = "hakase_structural_engine"   # never expose upstream tool name
        result["gpu_name"] = gpu
        result["wallclock_seconds"] = round(time.time() - t0, 1)
        result["msa_source"] = (
            "colabfold_msa_server" if inp.use_msa_server else "single_sequence_or_user_msa"
        )
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _exec_timeout_seconds() -> int:
    """Hard subprocess cap. Defaults to 2 h; override with BOLTZ_EXEC_TIMEOUT_S."""
    raw = os.environ.get("BOLTZ_EXEC_TIMEOUT_S", "7200")
    try:
        return max(300, int(raw))
    except ValueError:
        return 7200


# ---------------------------------------------------------------------------
# Output parsing
# ---------------------------------------------------------------------------

def _parse_outputs(out_dir: Path, stem: str, inp: BoltzInput) -> dict[str, Any]:
    """Locate and parse every Boltz artifact. Raises if the structure is missing."""
    # Boltz writes to: out_dir/boltz_results_<stem>/predictions/<stem>/
    pred_roots = list(out_dir.glob(f"boltz_results_{stem}/predictions/{stem}"))
    if not pred_roots:
        # Fall back to a broad search so a Boltz naming change doesn't break us.
        pred_roots = [p.parent for p in out_dir.rglob("*_model_0.cif")]
    if not pred_roots:
        pred_roots = [p.parent for p in out_dir.rglob("*_model_0.pdb")]
    if not pred_roots:
        raise BoltzRunError(
            "Boltz produced no prediction directory. The run reported success "
            "but no *_model_0 structure was written — treat as a failed job."
        )
    pred_dir = pred_roots[0]

    ext = "cif" if inp.output_format == "mmcif" else "pdb"
    struct_files = sorted(pred_dir.glob(f"*_model_*.{ext}"))
    if not struct_files:
        # Boltz may emit the other extension regardless of the flag — accept either.
        struct_files = sorted(pred_dir.glob("*_model_*.cif")) or sorted(pred_dir.glob("*_model_*.pdb"))
    if not struct_files:
        raise BoltzRunError(
            f"Boltz prediction dir {pred_dir} contains no model structure files."
        )

    warnings: list[str] = []
    models: list[dict[str, Any]] = []
    for sf in struct_files:
        rank = _rank_of(sf.name)
        struct_text = sf.read_text(encoding="utf-8", errors="replace")
        struct_fmt = "mmcif" if sf.suffix == ".cif" else "pdb"
        conf = _read_confidence(pred_dir, sf.name)
        plddt = _read_npz_vector(pred_dir, "plddt", sf.name)
        models.append({
            "rank": rank,
            "structure": struct_text,
            "structure_format": struct_fmt,
            "confidence": conf,
            "per_residue_plddt": plddt,
        })
    models.sort(key=lambda m: m["rank"])

    top = models[0]
    if not top["confidence"]:
        warnings.append(
            "Boltz emitted no confidence JSON for the top model — confidence "
            "metrics are reported as null rather than estimated."
        )

    # PAE for the top model only (the matrix is O(n^2); larger ones are
    # block-averaged so the payload stays transportable — flagged in warnings).
    pae_matrix, pae_note = _read_pae(pred_dir, struct_files[0].name, inp.max_pae_dim)
    if pae_note:
        warnings.append(pae_note)

    pde_matrix, pde_note = _read_pde(pred_dir, struct_files[0].name, inp.max_pae_dim)
    if pde_note:
        warnings.append(pde_note)

    affinity = None
    if inp.affinity_requested:
        affinity = _read_affinity(pred_dir, stem)
        if affinity is None:
            raise BoltzRunError(
                "Affinity prediction was requested but Boltz wrote no affinity_*.json. "
                "Per project policy no affinity number is fabricated — the job fails. "
                "Check that exactly one ligand entity is flagged as the affinity binder."
            )

    n_chains, n_residues = _count_structure(top["structure"], top["structure_format"])

    return {
        "structure":          top["structure"],
        "structure_format":   top["structure_format"],
        "models":             models,
        "n_models":           len(models),
        "confidence":         top["confidence"],
        "per_residue_plddt":  top["per_residue_plddt"],
        "pae_matrix":         pae_matrix,
        "pde_matrix":         pde_matrix,
        "affinity":           affinity,
        "n_chains":           n_chains,
        "n_residues_modeled": n_residues,
        "warnings":           warnings,
    }


def _rank_of(filename: str) -> int:
    """Extract the model rank from a name like 'cofold_model_2.cif'."""
    import re
    m = re.search(r"_model_(\d+)\.", filename)
    return int(m.group(1)) if m else 0


def _read_confidence(pred_dir: Path, struct_name: str) -> dict[str, Any]:
    """Read the confidence JSON that pairs with a given structure file.

    Boltz names it 'confidence_<stem>_model_<rank>.json'. Returns {} if absent
    (caller flags this) — never invents confidence numbers."""
    base = struct_name.rsplit(".", 1)[0]            # e.g. cofold_model_0
    candidates = [
        pred_dir / f"confidence_{base}.json",
        *pred_dir.glob(f"confidence_*{base.split('_model_')[-1]}*.json"),
    ]
    for c in candidates:
        if c.is_file():
            try:
                raw = json.loads(c.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return {}
            # Pass the whole thing through, plus normalize the headline keys so
            # the UI never has to guess which Boltz version produced this.
            return {
                "confidence_score":  raw.get("confidence_score"),
                "ptm":               raw.get("ptm"),
                "iptm":              raw.get("iptm"),
                "ligand_iptm":       raw.get("ligand_iptm"),
                "protein_iptm":      raw.get("protein_iptm"),
                "complex_plddt":     raw.get("complex_plddt"),
                "complex_iplddt":    raw.get("complex_iplddt"),
                "complex_pde":       raw.get("complex_pde"),
                "complex_ipde":      raw.get("complex_ipde"),
                "chains_ptm":        raw.get("chains_ptm"),
                "pair_chains_iptm":  raw.get("pair_chains_iptm"),
                "raw":               raw,
            }
    return {}


def _read_npz_vector(pred_dir: Path, kind: str, struct_name: str) -> Optional[list[float]]:
    """Read a 1-D per-residue array (plddt) from the matching .npz. None if absent."""
    base = struct_name.rsplit(".", 1)[0]
    rank_suffix = base.split("_model_")[-1] if "_model_" in base else "0"
    candidates = [
        pred_dir / f"{kind}_{base}.npz",
        *pred_dir.glob(f"{kind}_*model_{rank_suffix}.npz"),
        *pred_dir.glob(f"{kind}_*.npz"),
    ]
    for c in candidates:
        if c.is_file():
            try:
                with np.load(c) as data:
                    key = kind if kind in data else data.files[0]
                    arr = np.asarray(data[key], dtype=float).reshape(-1)
                return [round(float(x), 4) for x in arr.tolist()]
            except Exception:  # noqa: BLE001
                return None
    return None


def _read_pae(pred_dir: Path, struct_name: str, max_dim: int) -> tuple[Optional[list[list[float]]], Optional[str]]:
    """Read the PAE matrix for the top model. Block-averages matrices larger
    than `max_dim` so the JSON payload stays transportable."""
    base = struct_name.rsplit(".", 1)[0]
    rank_suffix = base.split("_model_")[-1] if "_model_" in base else "0"
    candidates = [
        pred_dir / f"pae_{base}.npz",
        *pred_dir.glob(f"pae_*model_{rank_suffix}.npz"),
        *pred_dir.glob("pae_*.npz"),
    ]
    for c in candidates:
        if c.is_file():
            try:
                with np.load(c) as data:
                    key = "pae" if "pae" in data else data.files[0]
                    mat = np.asarray(data[key], dtype=float)
            except Exception:  # noqa: BLE001
                return None, "PAE matrix file was present but could not be parsed."
            if mat.ndim != 2:
                return None, f"PAE array had unexpected shape {mat.shape}; omitted."
            n = mat.shape[0]
            if n > max_dim:
                factor = int(np.ceil(n / max_dim))
                trimmed = mat[: (n // factor) * factor, : (n // factor) * factor]
                pooled = trimmed.reshape(
                    trimmed.shape[0] // factor, factor,
                    trimmed.shape[1] // factor, factor,
                ).mean(axis=(1, 3))
                note = (
                    f"PAE matrix ({n}×{n}) block-averaged to "
                    f"{pooled.shape[0]}×{pooled.shape[1]} to keep the payload "
                    f"transportable. Per-residue pLDDT is reported at full resolution."
                )
                return [[round(float(x), 2) for x in row] for row in pooled.tolist()], note
            return [[round(float(x), 2) for x in row] for row in mat.tolist()], None
    return None, None


def _read_pde(pred_dir: Path, struct_name: str, max_dim: int) -> tuple[Optional[list[list[float]]], Optional[str]]:
    """Read the PDE (Predicted Distance Error) matrix — new in Boltz-2.

    PDE is in Ångstrom units; lower = more confident. We apply the same
    block-averaging logic as PAE so large matrices don't blow out the payload.
    """
    base = struct_name.rsplit(".", 1)[0]
    rank_suffix = base.split("_model_")[-1] if "_model_" in base else "0"
    candidates = [
        pred_dir / f"pde_{base}.npz",
        *pred_dir.glob(f"pde_*model_{rank_suffix}.npz"),
        *pred_dir.glob("pde_*.npz"),
    ]
    for c in candidates:
        if c.is_file():
            try:
                with np.load(c) as data:
                    key = "pde" if "pde" in data else data.files[0]
                    mat = np.asarray(data[key], dtype=float)
            except Exception:  # noqa: BLE001
                return None, "PDE matrix file present but could not be parsed."
            if mat.ndim != 2:
                return None, f"PDE array had unexpected shape {mat.shape}; omitted."
            n = mat.shape[0]
            if n > max_dim:
                factor = int(np.ceil(n / max_dim))
                trimmed = mat[: (n // factor) * factor, : (n // factor) * factor]
                pooled = trimmed.reshape(
                    trimmed.shape[0] // factor, factor,
                    trimmed.shape[1] // factor, factor,
                ).mean(axis=(1, 3))
                note = (
                    f"PDE matrix ({n}×{n}) block-averaged to "
                    f"{pooled.shape[0]}×{pooled.shape[1]} (Å)."
                )
                return [[round(float(x), 2) for x in row] for row in pooled.tolist()], note
            return [[round(float(x), 2) for x in row] for row in mat.tolist()], None
    return None, None


def _fetch_templates(yaml_text: str, work: Path) -> tuple[str, list[Path]]:
    """Download template CIF/PDB files referenced in YAML comment lines, then
    rewrite the YAML to include a proper `templates:` block with local paths.

    The upstream cofolding.py serialises template definitions as comment lines
    of the form:
        # TEMPLATE url=<URL> fmt=<cif|pdb> [chain_ids=...] [template_ids=...] [force=true] [threshold=N]

    This function:
      1. Parses those comment lines.
      2. Downloads each URL into a temp file in `work/`.
      3. Replaces the comment block with a proper Boltz `templates:` YAML section.
      4. Returns the rewritten YAML and list of downloaded paths (for cleanup audit).
    """
    import re as _re
    import urllib.request as _urlreq

    template_comment_re = _re.compile(
        r"^# TEMPLATE url=(\S+) fmt=(\S+)"
        r"(?:\s+chain_ids=\[([^\]]*)\])?"
        r"(?:\s+template_ids=\[([^\]]*)\])?"
        r"(?:\s+(force=true))?(?:\s+threshold=(\S+))?",
        _re.MULTILINE,
    )

    lines_out: list[str] = []
    local_paths: list[Path] = []
    template_blocks: list[str] = []
    skip_sentinel = False

    for line in yaml_text.splitlines():
        if line.strip() == "# HAKASE_TEMPLATES_FOLLOW":
            skip_sentinel = True
            continue
        m = template_comment_re.match(line)
        if m and skip_sentinel:
            url, fmt, chain_ids_raw, tmpl_ids_raw, force_flag, threshold_raw = m.groups()
            ext = ".pdb" if fmt == "pdb" else ".cif"
            local_file = work / f"tmpl_{len(local_paths)}{ext}"
            try:
                _urlreq.urlretrieve(url, str(local_file))
                local_paths.append(local_file)
            except Exception as e:  # noqa: BLE001
                raise BoltzRunError(
                    f"Failed to download structural template from {url}: {e}. "
                    f"Ensure the URL is publicly accessible from the RunPod environment."
                ) from e

            block = f"  - {fmt}: {local_file}"
            if chain_ids_raw:
                ids = [c.strip() for c in chain_ids_raw.split(",") if c.strip()]
                block += f"\n    chain_id: [{', '.join(ids)}]"
            if tmpl_ids_raw:
                tids = [c.strip() for c in tmpl_ids_raw.split(",") if c.strip()]
                block += f"\n    template_id: [{', '.join(tids)}]"
            if force_flag:
                block += "\n    force: true"
                if threshold_raw:
                    block += f"\n    threshold: {threshold_raw}"
            template_blocks.append(block)
            continue
        lines_out.append(line)

    if template_blocks:
        lines_out.append("templates:")
        lines_out.extend(template_blocks)

    return "\n".join(lines_out) + "\n", local_paths


def _read_affinity(pred_dir: Path, stem: str) -> Optional[dict[str, Any]]:
    """Read and interpret Boltz-2's affinity head output.

    Boltz reports affinity as log10(IC50 / µM). The IC50 and ΔG conversions
    below are Boltz's own documented formulae, not Hakase estimates."""
    candidates = [
        pred_dir / f"affinity_{stem}.json",
        *pred_dir.glob("affinity_*.json"),
    ]
    for c in candidates:
        if c.is_file():
            try:
                raw = json.loads(c.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return None
            pred = raw.get("affinity_pred_value")
            prob = raw.get("affinity_probability_binary")
            out: dict[str, Any] = {
                "affinity_pred_value":          pred,
                "affinity_probability_binary":  prob,
                "affinity_pred_value1":         raw.get("affinity_pred_value1"),
                "affinity_probability_binary1": raw.get("affinity_probability_binary1"),
                "affinity_pred_value2":         raw.get("affinity_pred_value2"),
                "affinity_probability_binary2": raw.get("affinity_probability_binary2"),
                "raw":                          raw,
                "units_note": (
                    "affinity_pred_value is log10(IC50) with IC50 in µM. "
                    "affinity_probability_binary is P(compound is a binder). "
                    "Trained on a mixture of Ki/Kd/IC50 — treat as a ranking-grade "
                    "binding-strength score, not a calibrated assay IC50."
                ),
            }
            if isinstance(pred, (int, float)):
                out["ic50_uM"] = round(float(10.0 ** float(pred)), 6)
                out["binding_dg_kcal_mol"] = round((6.0 - float(pred)) * _KCAL_PER_LOG_UNIT, 3)
            else:
                out["ic50_uM"] = None
                out["binding_dg_kcal_mol"] = None
            return out
    return None


def _count_structure(text: str, fmt: str) -> tuple[int, int]:
    """Count chains and residues from the predicted structure (best effort)."""
    chains: set[str] = set()
    residues: set[tuple[str, str]] = set()
    if fmt == "pdb":
        for line in text.splitlines():
            if line.startswith(("ATOM", "HETATM")) and len(line) >= 26:
                ch = line[21].strip() or "?"
                resseq = line[22:26].strip()
                chains.add(ch)
                residues.add((ch, resseq))
    else:  # mmCIF — parse the _atom_site loop positionally.
        in_loop = False
        cols: list[str] = []
        for line in text.splitlines():
            s = line.strip()
            if s == "loop_":
                in_loop = True
                cols = []
                continue
            if in_loop and s.startswith("_atom_site."):
                cols.append(s)
                continue
            if in_loop and cols and (s.startswith("ATOM") or s.startswith("HETATM")):
                parts = s.split()
                try:
                    ci = cols.index("_atom_site.label_asym_id")
                    ri = cols.index("_atom_site.label_seq_id")
                    ch = parts[ci]
                    chains.add(ch)
                    residues.add((ch, parts[ri]))
                except (ValueError, IndexError):
                    pass
            elif in_loop and cols and s and not s.startswith("_") and s != "#":
                continue
            elif in_loop and (s.startswith("_") and not s.startswith("_atom_site.")):
                in_loop = False
    return len(chains), len(residues)
