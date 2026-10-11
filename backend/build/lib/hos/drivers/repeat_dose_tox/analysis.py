"""Dose-group comparison with the concurrent control, shared by the repeat-dose and
dose range-finding drivers.

For every endpoint x sex x phase x timepoint: group mean and SD, % difference from the control
mean and, when the protocol states a significance level, Dunnett's two-sided many-to-one test
of each dose group against control (Dunnett 1955; ``scipy.stats.dunnett`` with a fixed
quasi-Monte-Carlo seed so p-values reproduce).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import scipy
from scipy import stats

from hos.core import units as U
from hos.core.methods import method
from hos.core.provenance import Uncertainty
from hos.core.quantity import Quantity

__all__ = ["DUNNETT_QMC_SEED", "SOFTWARE", "GroupComparison", "compare_groups", "dose_eq"]

SOFTWARE = {"scipy": scipy.__version__, "numpy": np.__version__}
#: scipy.stats.dunnett integrates the multivariate t distribution by randomised quasi-Monte
#: Carlo; a fixed seed makes p-values reproducible to the last digit (determinism rule).
DUNNETT_QMC_SEED = 0


def dose_eq(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(b))


@dataclass
class GroupComparison:
    rows: list[tuple[Any, ...]] = field(default_factory=list)
    quantities: dict[str, Quantity] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    n_significant: int = 0


def compare_groups(records: Sequence[Mapping[str, Any]], *, endpoint_unit: Callable[[str], str],
                   groups: Sequence[float], alpha: float | None, prov_note: str,
                   dose_unit: str = "mg/kg/day") -> GroupComparison:
    """Compare each dose group with the control (dose 0) per endpoint x sex x phase x timepoint.

    ``alpha=None`` means the protocol states no statistical test: groups are summarised and
    compared descriptively only."""
    summ_m, dun_m = method("stats.group_summary"), method("stats.dunnett")
    cells: dict[tuple[str, str, str, str], dict[float, list[float]]] = defaultdict(
        lambda: defaultdict(list))
    for r in records:
        unit = endpoint_unit(r["endpoint"])
        v = U.convert(r["value"], r["unit"], unit) if r["unit"] != unit else r["value"]
        dose = next(d for d in groups if dose_eq(d, r["dose"]))
        cells[(r["endpoint"], r["sex"], r["phase"], r["timepoint"])][dose].append(float(v))

    out = GroupComparison()
    for key in sorted(cells):
        endpoint, sex, phase, tp = key
        unit = endpoint_unit(endpoint)
        groups_ = cells[key]
        ctrl = groups_.get(0.0, [])
        pvals: dict[float, float | None] = {}
        if alpha is not None:
            treated = [d for d in sorted(groups_) if d > 0 and len(groups_[d]) >= 2]
            skipped = [d for d in sorted(groups_) if d > 0 and len(groups_[d]) < 2]
            if skipped:
                out.notes.append(f"{endpoint}/{sex}/{phase}/{tp}: groups {skipped} have n < 2, "
                                 "not tested")
            if len(ctrl) < 2 or not treated:
                out.notes.append(f"{endpoint}/{sex}/{phase}/{tp}: control n < 2 or no testable "
                                 "group; no comparison")
            else:
                res = stats.dunnett(*[np.asarray(groups_[d]) for d in treated],
                                    control=np.asarray(ctrl), alternative="two-sided",
                                    rng=np.random.default_rng(DUNNETT_QMC_SEED))
                pvals = {d: float(pv) for d, pv in zip(treated, res.pvalue, strict=True)}
        cmean = float(np.mean(ctrl)) if ctrl else None
        label = f"{endpoint} ({sex}, {phase}, {tp})"
        for d in sorted(groups_):
            vals = groups_[d]
            mean = Quantity.computed(
                float(np.mean(vals)), unit, method=summ_m, software=SOFTWARE,
                uncertainty=Uncertainty(kind="sd", sd=float(np.std(vals, ddof=1)), n=len(vals))
                if len(vals) > 1 else None,
                label=f"{label} mean at {d:g} {dose_unit}", notes=prov_note)
            dose_q = Quantity.user_supplied(d, dose_unit, actor="study protocol", label="dose")
            if d == 0:
                out.rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, "control",
                                 "control", "control"))
                continue
            pct: Any = "n/a"
            if cmean not in (None, 0.0):
                assert cmean is not None
                pct = Quantity.computed(100.0 * (mean.require() - cmean) / abs(cmean),
                                        "percent", method=summ_m, software=SOFTWARE,
                                        label=f"{label} % vs control at {d:g}")
            pv = pvals.get(d)
            if pv is None:
                out.rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, pct,
                                 "not tested", "-"))
                if alpha is None and isinstance(pct, Quantity):
                    out.quantities[f"group|{endpoint}|{sex}|{phase}|{tp}|{d:g}|pct_vs_control"] = pct
                continue
            assert alpha is not None
            pq = Quantity.computed(pv, "dimensionless", method=dun_m, software=SOFTWARE,
                                   label=f"{label} Dunnett p at {d:g}",
                                   notes=f"two-sided; {len(pvals)} groups vs control; "
                                         f"QMC seed {DUNNETT_QMC_SEED}")
            sig = pv < alpha
            out.rows.append((endpoint, sex, phase, tp, dose_q, len(vals), mean, pct, pq,
                             "yes" if sig else "no"))
            if sig:
                out.n_significant += 1
                base = f"finding|{endpoint}|{sex}|{phase}|{tp}|{d:g}"
                out.quantities[f"{base}|p"] = pq
                out.quantities[f"{base}|mean"] = mean
                if isinstance(pct, Quantity):
                    out.quantities[f"{base}|pct_vs_control"] = pct
    return out
