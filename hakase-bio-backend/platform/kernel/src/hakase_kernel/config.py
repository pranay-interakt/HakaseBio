"""Platform configuration — resolved once from the environment (doc 06 governance).

All provider selection, endpoints, timeouts and credential *names* are read from
environment variables so the same code runs unchanged across dev / staging /
prod. Credentials themselves are never hard-coded and never logged.

Default posture (per the user's cost constraint): the platform runs fully on
open-source, CPU/API tooling with **no key and no GPU**:

  * Structure     -> ESMFold via the ESM Atlas public API (no key, no GPU).
  * Embeddings    -> deterministic sequence descriptors (no key).
  * Conformation  -> Boltz-2, OPTIONAL, only when a GPU provider is configured.

Setting NVIDIA_API_KEY upgrades embeddings (ESM2-650M) and unlocks the NVIDIA
NIM ESMFold structure provider. Absence of a key never causes fabrication — it
simply keeps the open-source defaults or yields a structured ``unavailable``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


def _env_bool(name: str, default: bool = False) -> bool:
    v = _env(name)
    if v is None:
        return default
    return v.lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    v = _env(name)
    try:
        return float(v) if v is not None else default
    except ValueError:
        return default


@dataclass(frozen=True)
class PlatformConfig:
    # ---- structure (default: GPU-free ESMFold public API) -------------------
    structure_provider: str  # "esmfold_esmatlas" | "nvidia_esmfold"
    esmatlas_fold_url: str
    esmatlas_max_length: int
    esmatlas_timeout_s: float
    esmatlas_max_attempts: int
    esmatlas_retry_delay_s: float
    nvidia_api_key: str | None
    nvidia_esmfold_url: str
    nvidia_esm2_url: str
    structure_timeout_s: float
    structure_max_retries: int

    # ---- embeddings (default: deterministic descriptors, no key) -----------
    embedding_provider: str  # "descriptors" | "nvidia_esm2"

    # ---- embedding artifact storage (store large vectors by reference) ------
    embedding_storage_backend: str  # "local_fs" (only backend today)
    embedding_storage_dir: str | None  # None => <tempdir>/hakase-embeddings/

    # ---- conformation layer (optional, GPU) --------------------------------
    gpu_provider: str | None  # reuse existing GPU_PROVIDER; None => layer disabled

    # ---- external resource databases ---------------------------------------
    uniprot_base_url: str
    rcsb_base_url: str
    pubchem_base_url: str
    chembl_base_url: str
    resource_timeout_s: float

    # ---- governance ---------------------------------------------------------
    strict_ml: bool
    http_user_agent: str

    @property
    def nvidia_enabled(self) -> bool:
        return bool(self.nvidia_api_key)

    @property
    def conformation_layer_enabled(self) -> bool:
        return bool(self.gpu_provider)


@lru_cache(maxsize=1)
def get_config() -> PlatformConfig:
    return PlatformConfig(
        structure_provider=_env("STRUCTURE_PROVIDER", "esmfold_esmatlas"),
        esmatlas_fold_url=_env(
            "ESMATLAS_FOLD_URL", "https://api.esmatlas.com/foldSequence/v1/pdb/"
        ),
        esmatlas_max_length=int(_env("ESMATLAS_MAX_LENGTH", "400")),
        esmatlas_timeout_s=_env_float("ESMATLAS_TIMEOUT_S", 60.0),
        esmatlas_max_attempts=int(_env("ESMATLAS_MAX_ATTEMPTS", "2")),
        esmatlas_retry_delay_s=_env_float("ESMATLAS_RETRY_DELAY_S", 0.5),
        nvidia_api_key=_env("NVIDIA_API_KEY"),
        nvidia_esmfold_url=_env(
            "NVIDIA_ESMFOLD_URL",
            "https://health.api.nvidia.com/v1/biology/nvidia/esmfold",
        ),
        nvidia_esm2_url=_env(
            "NVIDIA_ESM2_URL",
            "https://health.api.nvidia.com/v1/biology/meta/esm2-650m",
        ),
        structure_timeout_s=_env_float("STRUCTURE_TIMEOUT_S", 120.0),
        structure_max_retries=int(_env("STRUCTURE_MAX_RETRIES", "2")),
        embedding_provider=_env("EMBEDDING_PROVIDER", "descriptors"),
        embedding_storage_backend=_env("EMBEDDING_STORAGE_BACKEND", "local_fs"),
        embedding_storage_dir=_env("EMBEDDING_STORAGE_DIR"),
        gpu_provider=(
            _env("GPU_PROVIDER")
            if _env("ENABLE_CONFORMATION_LAYER", "0") in ("1", "true", "True")
            else None
        ),
        uniprot_base_url=_env("UNIPROT_BASE_URL", "https://rest.uniprot.org"),
        rcsb_base_url=_env("RCSB_BASE_URL", "https://files.rcsb.org"),
        pubchem_base_url=_env("PUBCHEM_BASE_URL", "https://pubchem.ncbi.nlm.nih.gov/rest/pug"),
        chembl_base_url=_env("CHEMBL_BASE_URL", "https://www.ebi.ac.uk/chembl/api/data"),
        resource_timeout_s=_env_float("RESOURCE_TIMEOUT_S", 30.0),
        strict_ml=_env_bool("STRICT_ML", False),
        http_user_agent=_env("HAKASE_HTTP_UA", "HakaseAI-Peptide-V3/3.0 (+https://hakase.ai)"),
    )
