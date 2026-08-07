"""Remote data provisioning — keeps large reference files OUT of the clone.

Big reference artifacts (the DepMap PRISM snapshot, the Tabula Sapiens atlas)
are no longer committed to the repo. Instead they are fetched at runtime from a
configurable URL (an object store the host controls) into an ephemeral cache
directory on first use. This keeps a `git clone` lean and makes the app
host-anywhere: the operator sets one env var per dataset.

Contract (honest, no fabrication):
  * If the file is already present locally (e.g. a warm cache or a volume mount)
    it is used as-is.
  * Else, if the configured URL env var is set, the file is downloaded once and
    cached.
  * Else, `ensure_local` returns None and the calling model degrades gracefully
    (its existing "data source not configured" envelope) — it never invents
    data.
"""

from __future__ import annotations

import logging
import os
import urllib.request

logger = logging.getLogger(__name__)


def ensure_local(
    local_path: str, url_env_var: str, *, description: str = "data file"
) -> str | None:
    """Return a usable local path for a remote-provisioned data file, or None.

    Args:
        local_path: where the file lives / should be cached (ephemeral cache dir).
        url_env_var: name of the env var holding the download URL.
        description: human label for logs/errors.
    """
    if os.path.exists(local_path):
        return local_path

    url = os.environ.get(url_env_var)
    if not url:
        logger.info(
            "%s not present and %s not set — model will degrade gracefully.",
            description,
            url_env_var,
        )
        return None

    try:
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        tmp = local_path + ".part"
        logger.info("Fetching %s from %s (env %s) → %s", description, url, url_env_var, local_path)
        # Stream to a temp file, then atomic-rename so a partial download is
        # never mistaken for a complete one.
        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:
            while True:
                chunk = resp.read(1 << 20)  # 1 MB
                if not chunk:
                    break
                out.write(chunk)
        os.replace(tmp, local_path)
        return local_path
    except Exception as exc:  # noqa: BLE001 — provisioning failure → caller degrades
        logger.warning("Failed to fetch %s from %s: %s", description, url_env_var, exc)
        try:
            if os.path.exists(local_path + ".part"):
                os.remove(local_path + ".part")
        except OSError:
            pass
        return None
