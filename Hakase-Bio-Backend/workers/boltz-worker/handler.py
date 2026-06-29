"""
Hakase BioTwin — Boltz-2 Co-folding RunPod Serverless Worker
=============================================================
Runs Boltz-2 protein-ligand co-folding + optional binding affinity prediction.

Input JSON (job["input"]):
  {
    "boltz_yaml":               str,    # full Boltz v1 YAML spec
    "job_name":                 str,
    "diffusion_samples":        int,    # default 1
    "recycling_steps":          int,    # default 3
    "sampling_steps":           int,    # default 200
    "step_scale":               float,  # default 1.638
    "max_parallel_samples":     int,    # default 1
    "use_msa_server":           bool,   # default false
    "max_msa_seqs":             int,    # default 4096
    "subsample_msa":            bool,   # default true
    "num_subsampled_msa":       int,    # default 512
    "use_potentials":           bool,   # default false
    "no_kernels":               bool,   # default false
    "output_format":            str,    # "pdb" | "mmcif"
    "write_full_pae":           bool,   # default false
    "write_full_pde":           bool,   # default false
    "affinity_requested":       bool,
    "affinity_binder_type":     str | null,
    "affinity_mw_correction":   bool,
    "sampling_steps_affinity":  int,
    "diffusion_samples_affinity": int
  }

Output JSON:
  {
    "structure_pdb":       str,   # PDB/mmCIF text of best model
    "plddt":               float, # mean pLDDT (0-100)
    "ptm":                 float,
    "iptm":                float,
    "pde":                 float | null,
    "pae_summary":         { "mean": float, "max": float },
    "affinity_kcal_mol":   float | null,
    "affinity_probability_binary": float | null,
    "confidence_json":     str,   # full confidence JSON
    "engine_version":      str,
    "warnings":            list[str]
  }
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

import runpod

ENGINE_VERSION = "Boltz-2 (MIT) — Passaro et al. 2025"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _flag(name: str, val) -> list[str]:
    """Return CLI flag(s) if val is truthy / non-default."""
    if isinstance(val, bool):
        return [f"--{name}"] if val else []
    if val is not None:
        return [f"--{name}", str(val)]
    return []


def build_boltz_cmd(inp: dict, yaml_path: Path, out_dir: Path) -> list[str]:
    """Build the `boltz predict` command from the input dict."""
    cmd = [
        "boltz", "predict", str(yaml_path),
        "--out_dir", str(out_dir),
        "--cache", "/root/.boltz",   # model weights cached in container layer
        "--recycling_steps",    str(inp.get("recycling_steps",    3)),
        "--sampling_steps",     str(inp.get("sampling_steps",     200)),
        "--diffusion_samples",  str(inp.get("diffusion_samples",  1)),
        "--step_scale",         str(inp.get("step_scale",         1.638)),
        "--max_parallel_samples", str(inp.get("max_parallel_samples", 1)),
        "--output_format", inp.get("output_format", "pdb"),
    ]

    if inp.get("use_msa_server"):
        cmd += ["--use_msa_server",
                "--max_msa_seqs", str(inp.get("max_msa_seqs", 4096))]
        if inp.get("subsample_msa"):
            cmd += ["--subsample_msa",
                    "--num_subsampled_msa", str(inp.get("num_subsampled_msa", 512))]

    if inp.get("use_potentials"):
        cmd.append("--use_potentials")
    if inp.get("no_kernels"):
        cmd.append("--no_kernels")
    if inp.get("write_full_pae"):
        cmd.append("--write_full_pae")
    if inp.get("write_full_pde"):
        cmd.append("--write_full_pde")

    if inp.get("affinity_requested"):
        cmd += [
            "--predict_affinity",
            "--sampling_steps_affinity",   str(inp.get("sampling_steps_affinity", 200)),
            "--diffusion_samples_affinity", str(inp.get("diffusion_samples_affinity", 5)),
        ]
        if inp.get("affinity_mw_correction"):
            cmd.append("--affinity_mw_correction")

    return cmd


def parse_boltz_output(out_dir: Path, job_name: str, fmt: str, affinity_requested: bool) -> dict:
    """
    Walk Boltz-2 output directory and extract:
      - best structure (model_0)
      - confidence JSON (pLDDT, pTM, ipTM, PAE, PDE)
      - affinity (if requested)
    """
    warnings: list[str] = []

    # Boltz outputs to: out_dir/<job_name>/
    job_out = out_dir / job_name
    if not job_out.exists():
        # Try with boltz_ prefix Boltz sometimes adds
        candidates = list(out_dir.glob("*"))
        job_out = candidates[0] if candidates else out_dir

    # ── Structure ──────────────────────────────────────────────────────────
    ext = "pdb" if fmt == "pdb" else "cif"
    struct_files = sorted(job_out.glob(f"**/*model_0*.{ext}"))
    if not struct_files:
        struct_files = sorted(job_out.glob(f"**/*.{ext}"))
    if not struct_files:
        raise RuntimeError(
            f"Boltz produced no .{ext} output in {job_out}. "
            f"Directory contents: {list(job_out.rglob('*'))}"
        )
    structure_text = struct_files[0].read_text()

    # ── Confidence ─────────────────────────────────────────────────────────
    conf_files = sorted(job_out.glob("**/confidence_model_0*.json"))
    if not conf_files:
        conf_files = sorted(job_out.glob("**/*confidence*.json"))

    plddt = ptm = iptm = pde = None
    pae_mean = pae_max = None
    confidence_json = "{}"

    if conf_files:
        conf = json.loads(conf_files[0].read_text())
        confidence_json = conf_files[0].read_text()
        plddt = conf.get("plddt", conf.get("mean_plddt"))
        ptm   = conf.get("ptm")
        iptm  = conf.get("iptm")
        pde   = conf.get("pde", conf.get("mean_pde"))

        pae_data = conf.get("pae")
        if pae_data and isinstance(pae_data, list):
            flat = [v for row in pae_data for v in row]
            if flat:
                pae_mean = sum(flat) / len(flat)
                pae_max  = max(flat)
    else:
        warnings.append("No confidence JSON found — confidence scores unavailable")

    # ── Affinity ───────────────────────────────────────────────────────────
    affinity_kcal = None
    affinity_prob  = None

    if affinity_requested:
        aff_files = sorted(job_out.glob("**/*affinity*.json"))
        if aff_files:
            aff = json.loads(aff_files[0].read_text())
            affinity_kcal = aff.get("affinity_pred_value", aff.get("affinity_kcal_mol"))
            affinity_prob  = aff.get("affinity_probability_binary",
                                     aff.get("affinity_probability"))
        else:
            warnings.append("Affinity was requested but Boltz produced no affinity output file")

    return {
        "structure_pdb":                struct_files[0].read_text(),
        "plddt":                        plddt,
        "ptm":                          ptm,
        "iptm":                         iptm,
        "pde":                          pde,
        "pae_summary":                  {"mean": pae_mean, "max": pae_max},
        "affinity_kcal_mol":            affinity_kcal,
        "affinity_probability_binary":  affinity_prob,
        "confidence_json":              confidence_json,
        "engine_version":               ENGINE_VERSION,
        "warnings":                     warnings,
    }


# ── RunPod handler ────────────────────────────────────────────────────────────

def handler(job: dict) -> dict:
    inp = job.get("input", {})

    boltz_yaml       = inp["boltz_yaml"]
    job_name         = inp.get("job_name", "hakase_cofold")
    out_fmt          = inp.get("output_format", "pdb")
    affinity_req     = bool(inp.get("affinity_requested", False))

    with tempfile.TemporaryDirectory() as tmp:
        workdir  = Path(tmp)
        yaml_path = workdir / f"{job_name}.yaml"
        out_dir   = workdir / "output"
        out_dir.mkdir()

        yaml_path.write_text(boltz_yaml)

        cmd = build_boltz_cmd(inp, yaml_path, out_dir)

        t0 = time.time()
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=7200,   # 2 h hard cap (matches POLL_DEADLINE_S)
                cwd=str(workdir),
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("Boltz-2 timed out after 2 hours — try fewer diffusion_samples")

        elapsed_min = (time.time() - t0) / 60.0

        if result.returncode != 0:
            stderr_tail = result.stderr[-3000:] if result.stderr else ""
            raise RuntimeError(
                f"boltz predict exited {result.returncode}:\n{stderr_tail}"
            )

        output = parse_boltz_output(out_dir, job_name, out_fmt, affinity_req)
        output["wallclock_minutes"] = elapsed_min
        return output


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
