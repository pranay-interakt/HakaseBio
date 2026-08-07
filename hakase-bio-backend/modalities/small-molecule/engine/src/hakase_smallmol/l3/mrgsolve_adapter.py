"""mrgsolve engine adapter — a real R/mrgsolve whole-body PBPK cohort.

This runs the *same* perfusion-limited whole-body PBPK the kernel runs, but
through **mrgsolve** (Metrum's C++ ODE engine), so L3 offers an independent,
widely-validated simulation backend and a kernel-vs-mrgsolve cross-check.

It consumes the identical disposition (``DispositionParameters``) and species
physiology the kernel uses, marshals them to JSON, invokes ``run_mrgsolve.R``
via ``Rscript``, and returns the cohort in the kernel's output shape (time in
hours, per-organ mean/p05/p95 curves + Cmax/Tmax/AUC/CL/Vss/t½).

If R or mrgsolve is not installed, ``mrgsolve_available()`` returns False and the
caller falls back to the in-house kernel engine — the layer never breaks.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from functools import lru_cache
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
_RUNNER = os.path.join(_HERE, "mrgsolve", "run_mrgsolve.R")

# Common Homebrew location so the service finds Rscript even with a minimal PATH.
_EXTRA_PATH = "/opt/homebrew/bin:/usr/local/bin"

# R snippet that PREPENDS the user library (R_LIBS_USER if set — e.g. the
# Dockerfile's /root/Rlibs — else ~/Rlibs) while KEEPING R's default paths. Using
# a bare `.libPaths(x)` would DROP R_LIBS_USER, so we build the union explicitly.
_LIBPATHS = (
    ".libPaths(c(Sys.getenv('R_LIBS_USER', unset=path.expand('~/Rlibs')), .libPaths())); "
)


def _rscript_path() -> str | None:
    env_path = os.environ.get("PATH", "")
    search = env_path + os.pathsep + _EXTRA_PATH
    for d in search.split(os.pathsep):
        cand = os.path.join(d, "Rscript")
        if d and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return shutil.which("Rscript")


def _r_env() -> dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = env.get("PATH", "") + os.pathsep + _EXTRA_PATH
    # Ensure the user library (where mrgsolve was installed) is visible.
    rlibs = os.path.expanduser("~/Rlibs")
    env["R_LIBS_USER"] = rlibs + (os.pathsep + env["R_LIBS_USER"] if env.get("R_LIBS_USER") else "")
    return env


@lru_cache(maxsize=1)
def mrgsolve_available() -> bool:
    """True iff Rscript runs and the mrgsolve package loads. Cached per process."""
    rs = _rscript_path()
    if not rs or not os.path.isfile(_RUNNER):
        return False
    try:
        proc = subprocess.run(
            [
                rs,
                "-e",
                _LIBPATHS + 'suppressMessages(library(mrgsolve)); cat("OK")',
            ],
            capture_output=True,
            text=True,
            timeout=60,
            env=_r_env(),
        )
        return "OK" in (proc.stdout or "")
    except Exception:  # noqa: BLE001
        return False


def mrgsolve_info() -> dict[str, Any]:
    """Version/availability descriptor for the /contract readiness surface."""
    if not mrgsolve_available():
        return {"available": False, "reason": "R and/or the mrgsolve package are not installed."}
    rs = _rscript_path()
    try:
        proc = subprocess.run(
            [
                rs,
                "-e",
                _LIBPATHS
                + 'suppressMessages(library(mrgsolve)); cat(as.character(packageVersion("mrgsolve")))',
            ],
            capture_output=True,
            text=True,
            timeout=60,
            env=_r_env(),
        )
        return {"available": True, "engine": "mrgsolve", "version": (proc.stdout or "").strip()}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": str(exc)}


def _build_input(
    *,
    disp: Any,
    phys_base: Any,
    arm: Any,
    f_abs: float,
    cohort_size: int,
    seed: int,
    time_h: list[float],
    ka_per_h: float,
    tau_h: float | None,
    n_doses: int,
    bw_cv: float = 0.15,
    cl_gsd: float = 1.0,
) -> dict[str, Any]:
    """Marshal the kernel disposition + physiology into the R runner's JSON."""
    from hakase_kernel.pbpk.model import build_flows, build_volumes

    V = build_volumes(phys_base)  # L, keys use arterial_blood/venous_blood
    Q_min = build_flows(phys_base)  # L/min
    Q = {k: v * 60.0 for k, v in Q_min.items()}  # → L/h

    def _q(name: str) -> float:
        return float(disp.kp[name].value) if (disp.kp and name in disp.kp) else 1.0

    v_out = {
        "art": V["arterial_blood"],
        "ven": V["venous_blood"],
        "lung": V["lung"],
        "liver": V["liver"],
        "kidney": V["kidney"],
        "heart": V["heart"],
        "brain": V["brain"],
        "muscle": V["muscle"],
        "adipose": V["adipose"],
        "skin": V["skin"],
        "gut": V["gut"],
        "spleen": V["spleen"],
        "rest": V["rest"],
    }
    q_out = {
        "total": Q["total"],
        "liver": Q["liver"],
        "hepatic_artery": Q["hepatic_artery"],
        "gut": Q["gut"],
        "spleen": Q["spleen"],
        "kidney": Q["kidney"],
        "heart": Q["heart"],
        "brain": Q["brain"],
        "muscle": Q["muscle"],
        "adipose": Q["adipose"],
        "skin": Q["skin"],
        "rest": Q["rest"],
    }
    kp_out = {
        org: _q(org)
        for org in (
            "lung",
            "liver",
            "kidney",
            "heart",
            "brain",
            "muscle",
            "adipose",
            "skin",
            "gut",
            "spleen",
            "rest",
        )
    }
    return {
        "time_h": list(time_h),
        "n_animals": int(cohort_size),
        "seed": int(seed),
        "bw_cv": bw_cv,
        "bw_kg": float(phys_base.body_weight_kg),
        "route": arm.route.upper(),
        "dose_mg_per_kg": float(arm.dose_mg_per_kg),
        "ka_per_h": float(ka_per_h),
        "f_abs": float(f_abs),
        "infusion_duration_h": arm.infusion_duration_h,
        "tau_h": tau_h,
        "n_doses": int(n_doses),
        "bpr": float(disp.blood_plasma_ratio.value),
        "fu_plasma": float(disp.fu_plasma.value),
        "extraction_ratio": float(disp.extraction_ratio.value),
        "cl_hepatic_ml_min_kg": float(disp.cl_hepatic.value),
        "cl_renal_ml_min_kg": float(disp.cl_renal.value),
        "cl_gsd": float(cl_gsd),
        "V": v_out,
        "Q": q_out,
        "Kp": kp_out,
    }


class MrgsolveError(RuntimeError):
    pass


def run_cohort_mrgsolve(
    *,
    disp: Any,
    phys_base: Any,
    arm: Any,
    f_abs: float,
    cohort_size: int,
    seed: int,
    time_h: list[float],
    ka_per_h: float,
    tau_h: float | None,
    n_doses: int,
    timeout_s: int = 180,
) -> dict[str, Any]:
    """Run the mrgsolve population and return the kernel-shaped cohort dict."""
    rs = _rscript_path()
    if not rs:
        raise MrgsolveError("Rscript not found on PATH.")
    payload = _build_input(
        disp=disp,
        phys_base=phys_base,
        arm=arm,
        f_abs=f_abs,
        cohort_size=cohort_size,
        seed=seed,
        time_h=time_h,
        ka_per_h=ka_per_h,
        tau_h=tau_h,
        n_doses=n_doses,
    )
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh)
        in_path = fh.name
    try:
        proc = subprocess.run(
            [rs, _RUNNER, in_path], capture_output=True, text=True, timeout=timeout_s, env=_r_env()
        )
    finally:
        try:
            os.unlink(in_path)
        except OSError:
            pass
    if proc.returncode != 0:
        raise MrgsolveError(f"mrgsolve run failed: {(proc.stderr or '')[-800:]}")
    out = (proc.stdout or "").strip()
    if not out:
        raise MrgsolveError(f"mrgsolve produced no output. stderr: {(proc.stderr or '')[-400:]}")
    try:
        cohort = json.loads(out)
    except json.JSONDecodeError as exc:
        raise MrgsolveError(f"could not parse mrgsolve JSON: {exc}; head={out[:200]!r}") from exc
    # Alias venous_blood→plasma parity with the kernel output.
    if "plasma" in cohort.get("curves", {}):
        cohort["curves"]["venous_blood"] = cohort["curves"]["plasma"]
        cohort["endpoints"]["venous_blood"] = cohort["endpoints"]["plasma"]
    return cohort


__all__ = [
    "mrgsolve_available",
    "mrgsolve_info",
    "run_cohort_mrgsolve",
    "MrgsolveError",
]
