"""Mechanistic ground-truth simulators for validating the DSM estimator.

WHY THIS EXISTS
───────────────
Real V0/V1/V2 must run on public wet-lab data (sci-Plex, cardiomyocyte MEA,
Mojtahedi single-cell, DepMap). That data is NOT bundled here (the platform's
no-fabricated-data policy: see experiments/loaders.py for the real contracts).

But we can still *validate the estimator itself* today, against systems whose
ground truth we control. This module provides three such systems, each of which
is a POSITIVE or NEGATIVE control for a specific Phase-4 experiment:

  • toxicant_dose_series   → a system with a genuine fold bifurcation whose
      recovery rate k(dose) → 0 at a tipping dose.  (E0/E1 positive control)
  • safe_dose_series       → a stable system, k(dose) ≈ const.  (E1 negative)
  • cytotoxic_dose_series  → NO change in stability, but the population thins
      and measurement noise grows with dose, so VARIANCE rises while the
      TEMPORAL signature (autocorrelation, recovery time) does NOT.
      (E2 — the decisive death-confound negative control)

If the estimator cannot tell the toxicant from the cytotoxic control, it is
measuring "cells are dying", not "the system is near a bifurcation" — exactly
the failure Phase 1 warned about. These simulators make that testable.

THE PHYSICS (kept deliberately transparent)
───────────────────────────────────────────
Near a stable fixed point the linearised dynamics are Ornstein–Uhlenbeck:

    dx = -k · x · dt + σ · dW        (k = recovery rate = -leading eigenvalue)

Discretised: x_{t+1} = c · x_t + ε,  c = exp(-k·dt),  Var(ε) = σ²(1-c²)/(2k).
Stationary variance = σ²/(2k)  →  diverges as k → 0  (critical slowing down).
Lag-1 autocorrelation = c = exp(-k·dt) → 1 as k → 0.
Recovery time = 1/k → ∞ as k → 0.

For the toxicant, k(u) = k0 · max(k_floor, 1 - u/u_crit): the recovery rate
collapses toward zero as dose u approaches u_crit (a fold bifurcation). For the
safe compound, k(u) = k0 (flat). For the cytotoxic control, k(u) = k0 (flat —
stability is UNCHANGED) but the number of observed cells falls and additive
readout noise grows with dose, inflating variance with no CSD.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

DoseEnsembles = dict  # {dose: np.ndarray of shape (n_cells,) or (n_time,)}


# --------------------------------------------------------------------------- #
# Core OU generator
# --------------------------------------------------------------------------- #


def _ou_series(k: float, sigma: float, n: int, dt: float, rng, x0: float = 0.0) -> np.ndarray:
    """One ordered OU trajectory (a 'live-cell / MEA trace') at fixed k."""
    k = max(k, 1e-6)
    c = np.exp(-k * dt)
    stat_var = sigma**2 / (2 * k)
    eps_sd = np.sqrt(max(stat_var * (1 - c**2), 1e-12))
    x = np.empty(n, dtype=float)
    x[0] = rng.normal(x0, np.sqrt(stat_var))
    for t in range(1, n):
        x[t] = c * x[t - 1] + rng.normal(0.0, eps_sd)
    return x


def _ou_ensemble(k: float, sigma: float, n_cells: int, rng) -> np.ndarray:
    """A snapshot ensemble = independent draws from the stationary distribution."""
    k = max(k, 1e-6)
    stat_var = sigma**2 / (2 * k)
    return rng.normal(0.0, np.sqrt(stat_var), size=n_cells)


@dataclass
class DoseResponse:
    """Bundle carrying, per dose, both a temporal trace and a snapshot ensemble.

    traces[dose]    : ordered 1-D series (for AR1 / recovery time / eig)
    ensembles[dose] : unordered ensemble (for the variance family)
    doses           : sorted dose grid
    kind            : 'toxicant' | 'safe' | 'cytotoxic'
    true_tipping    : ground-truth tipping dose (np.inf if none)
    """

    doses: np.ndarray
    traces: dict
    ensembles: dict
    kind: str
    true_tipping: float


# --------------------------------------------------------------------------- #
# The three controlled systems
# --------------------------------------------------------------------------- #


def toxicant_dose_series(
    *,
    u_crit: float = 1.0,
    k0: float = 1.0,
    sigma: float = 1.0,
    doses=None,
    n_time: int = 400,
    n_cells: int = 400,
    dt: float = 1.0,
    k_floor: float = 0.02,
    seed: int = 0,
) -> DoseResponse:
    """A system approaching a fold bifurcation at u_crit (POSITIVE control)."""
    rng = np.random.default_rng(seed)
    doses = np.linspace(0.0, 0.95 * u_crit, 8) if doses is None else np.asarray(doses, float)
    traces, ens = {}, {}
    for u in doses:
        k = k0 * max(k_floor, 1.0 - u / u_crit)
        traces[float(u)] = _ou_series(k, sigma, n_time, dt, rng)
        ens[float(u)] = _ou_ensemble(k, sigma, n_cells, rng)
    return DoseResponse(doses, traces, ens, "toxicant", float(u_crit))


def safe_dose_series(
    *,
    k0: float = 1.0,
    sigma: float = 1.0,
    doses=None,
    n_time: int = 400,
    n_cells: int = 400,
    dt: float = 1.0,
    seed: int = 1,
) -> DoseResponse:
    """A stable system whose recovery rate does not change with dose (NEGATIVE)."""
    rng = np.random.default_rng(seed)
    doses = np.linspace(0.0, 0.95, 8) if doses is None else np.asarray(doses, float)
    traces, ens = {}, {}
    for u in doses:
        traces[float(u)] = _ou_series(k0, sigma, n_time, dt, rng)
        ens[float(u)] = _ou_ensemble(k0, sigma, n_cells, rng)
    return DoseResponse(doses, traces, ens, "safe", float("inf"))


def cytotoxic_dose_series(
    *,
    k0: float = 1.0,
    sigma: float = 1.0,
    doses=None,
    n_time: int = 400,
    n_cells: int = 400,
    dt: float = 1.0,
    death_rate: float = 0.9,
    noise_growth: float = 2.5,
    seed: int = 2,
) -> DoseResponse:
    """Pure cytotoxicity: stability UNCHANGED, but population thins and readout
    noise grows with dose. Variance rises; temporal CSD does not. (E2 control)

    This is the confound that makes 'variance rose with dose' worthless on its
    own. A correct DSM estimator must NOT call this a tipping point.
    """
    rng = np.random.default_rng(seed)
    doses = np.linspace(0.0, 0.95, 8) if doses is None else np.asarray(doses, float)
    traces, ens = {}, {}
    for u in doses:
        # stability is flat (k0): the temporal correlation structure is unchanged
        base = _ou_series(k0, sigma, n_time, dt, rng)
        # heteroscedastic measurement noise grows with dose (adds WHITE noise:
        # inflates variance, LOWERS autocorrelation — the opposite of CSD)
        meas_sd = sigma * noise_growth * (u / (doses.max() + 1e-9))
        traces[float(u)] = base + rng.normal(0.0, meas_sd, size=n_time)
        # population thinning: fewer surviving cells at higher dose
        n_surv = max(8, int(round(n_cells * (1.0 - death_rate * u / (doses.max() + 1e-9)))))
        e = _ou_ensemble(k0, sigma, n_surv, rng)
        e = e + rng.normal(0.0, meas_sd, size=n_surv)  # same white-noise inflation
        ens[float(u)] = e
    return DoseResponse(doses, traces, ens, "cytotoxic", float("inf"))


# --------------------------------------------------------------------------- #
# Cell-fate positive control (Mojtahedi-style) — high-dimensional CSD
# --------------------------------------------------------------------------- #


def cellfate_critical_transition(
    *,
    n_genes: int = 20,
    n_time: int = 300,
    n_cells: int = 300,
    approach: float = 0.97,
    sigma: float = 1.0,
    dt: float = 1.0,
    seed: int = 3,
) -> DoseResponse:
    """A high-dimensional system whose leading mode's eigenvalue → 1 along
    pseudotime, reproducing the Mojtahedi (2016) single-cell CSD signature
    (rising leading-eigenvalue / variance). Used as the E0 positive control:
    'does our estimator detect CSD where it is KNOWN to exist?'
    """
    rng = np.random.default_rng(seed)
    pseudotimes = np.linspace(0.0, approach, 8)
    traces, ens = {}, {}
    # A FIXED random rotation makes the system genuinely multivariate while
    # keeping every covariance positive-definite by construction (rotation of a
    # positive diagonal). Per gene/mode i the dynamics are AR(1) with coeff c_i;
    # stationary variance = q / (1 - c_i^2). The LEADING mode's c grows toward
    # `approach`, so its stationary variance diverges — the Mojtahedi signature.
    Q, _ = np.linalg.qr(rng.normal(size=(n_genes, n_genes)))
    q = (sigma**2) * 0.01
    for u in pseudotimes:
        c_lead = 0.3 + (approach - 0.3) * (u / approach)  # 0.3 → ~approach
        c = np.full(n_genes, 0.3)
        c[0] = c_lead
        diag_var = q / (1.0 - np.clip(c, 0.0, 0.999) ** 2)  # per-mode stationary var
        L = Q @ np.diag(np.sqrt(diag_var))  # cov = L L^T, PD by construction
        ens[float(u)] = rng.normal(size=(n_cells, n_genes)) @ L.T
        # a leading-mode trace for the temporal indicators
        x = np.zeros(n_time)
        for t in range(1, n_time):
            x[t] = c_lead * x[t - 1] + rng.normal(0.0, np.sqrt(q))
        traces[float(u)] = x
    return DoseResponse(pseudotimes, traces, ens, "cellfate", float("inf"))
