"""Small-molecule modality engine: ADMET, tox, PK, binding.

Importing this package registers what the modality owns with the platform
kernel. `platform/` may not import `modalities/` (RESTRUCTURE.md), so the
direction is inverted here: the modality hands the kernel its dataset location
and its explainable models, and the kernel holds only what it is given.

Everything registered below is cheap — a path and three dotted strings. The
model modules themselves are imported on first use, so pulling in this package
does not drag sklearn, rdkit or torch into the process.
"""

from pathlib import Path

from hakase_kernel.runtime.paths import register_dataset_dir
from hakase_kernel.uncertainty import explain as _explain

# Vendored TDC .tab tables shipped with this modality; `base.load_tdc_tab`
# searches registered directories by filename.
register_dataset_dir(Path(__file__).parent / "data")

# Tree-based models the SHAP layer can explain. Descriptor names are read from
# each module's DESCRIPTOR_NAMES so the labels track its featurizer.
_explain.register_model(
    "cardiotox",
    "hakase_smallmol.cardiotox.cardiotox",
    label="hERG blocker probability",
    kind="classifier",
    positive_class=1,
)
_explain.register_model(
    "dili",
    "hakase_smallmol.dili.dili_ml",
    label="DILI probability",
    kind="classifier",
    positive_class=1,
)
_explain.register_model(
    "solubility",
    "hakase_smallmol.admet.solubility_ml",
    label="log solubility (logS)",
    kind="regressor",
)
