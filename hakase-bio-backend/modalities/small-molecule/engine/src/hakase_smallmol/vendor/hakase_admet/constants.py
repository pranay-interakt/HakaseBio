"""Contains constants used throughout Hakase ADMET."""

from importlib import resources

# Paths to data and models
with resources.path(__package__, "resources") as resources_dir:
    DEFAULT_ADMET_PATH = resources_dir / "data" / "admet.csv"
    DEFAULT_DRUGBANK_PATH = resources_dir / "data" / "drugbank_approved.csv"
    DEFAULT_MODELS_DIR = resources_dir / "models"

# DrugBank columns
DRUGBANK_ID_COLUMN = "id"
DRUGBANK_NAME_COLUMN = "name"
DRUGBANK_SMILES_COLUMN = "smiles"
DRUGBANK_ATC_PREFIX = "atc"
DRUGBANK_ATC_NAME_PREFIX = "atc_name"
DRUGBANK_ATC_CODE_COLUMN = DRUGBANK_ATC_PREFIX
DRUGBANK_DELIMITER = ";"
