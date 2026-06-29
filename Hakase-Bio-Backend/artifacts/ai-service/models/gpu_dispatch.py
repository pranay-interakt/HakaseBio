"""
GPU job dispatcher — provider-agnostic submit / poll layer.

All GPU-intensive jobs (FEP, Boltz-2 co-folding) go through this module.
Pick your provider by setting ONE env var:

    GPU_PROVIDER=local     # run directly on this machine's GPU (RunPod Pod, any GPU server)
    GPU_PROVIDER=runpod    # RunPod Serverless API (separate worker endpoint)
    GPU_PROVIDER=aws       # AWS SageMaker Async Inference
    GPU_PROVIDER=azure     # Azure ML Managed Online Endpoint

The *payload* sent to the worker and the *output contract* are IDENTICAL
across providers.  Only the transport layer (how you submit + poll) changes.
Your worker container is the same Docker image regardless of provider.

See .env.example at the repo root for every variable you need to set.
"""

from __future__ import annotations

import os
import time
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Provider selection
# ---------------------------------------------------------------------------

# Auto-detect if CUDA/local GPU is available
def has_local_gpu() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False

GPU_PROVIDER: str = os.environ.get("GPU_PROVIDER", "local" if has_local_gpu() else "runpod").lower()
HTTP_TIMEOUT: int = 30  # seconds per individual HTTP call

# NOTE: dummy / bypass mode has been intentionally removed.
# Per project policy: NO silent fallbacks. If the active GPU provider isn't
# configured, every L2 endpoint MUST fail loud with a 503 + actionable message.

# Map provider_key ("fep" | "boltz") → the env var that holds the endpoint
_ENDPOINT_ENV: dict[str, dict[str, str]] = {
    "runpod": {
        "fep":   "RUNPOD_FEP_ENDPOINT_ID",
        "boltz": "RUNPOD_BOLTZ_ENDPOINT_ID",
    },
    "aws": {
        "fep":   "AWS_SAGEMAKER_FEP_ENDPOINT",
        "boltz": "AWS_SAGEMAKER_BOLTZ_ENDPOINT",
    },
    "azure": {
        "fep":   "AZURE_ML_FEP_ENDPOINT_URL",
        "boltz": "AZURE_ML_BOLTZ_ENDPOINT_URL",
    },
}

# Credentials required per provider (checked in is_configured)
_CRED_ENV: dict[str, list[str]] = {
    "runpod": ["RUNPOD_API_KEY"],
    "aws":    ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION",
                "AWS_SAGEMAKER_OUTPUT_BUCKET"],
    "azure":  ["AZURE_ML_API_KEY"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _env(key: str) -> Optional[str]:
    v = os.environ.get(key)
    return v.strip() if v and v.strip() else None


class ProviderNotConfigured(RuntimeError):
    """Raised when required env vars are missing.
    The message is shown verbatim to the user — keep it actionable."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def is_configured(provider_key: str) -> tuple[bool, str]:
    """
    Check whether credentials + endpoint are present for the active provider.

    Args:
        provider_key: "fep" or "boltz"

    Returns:
        (True, "") if ready, or (False, human-readable reason) if not.
    """
    # local: no credentials needed — just needs GPU on the machine
    if GPU_PROVIDER == "local":
        if not has_local_gpu():
            return False, "Local CUDA/GPU is not available on this machine."
        return True, ""

    if GPU_PROVIDER not in _CRED_ENV:
        return False, (
            f"GPU_PROVIDER={GPU_PROVIDER!r} is not recognised. "
            f"Valid values: runpod | aws | azure"
        )

    for var in _CRED_ENV[GPU_PROVIDER]:
        if not _env(var):
            return False, (
                f"{var} is not set — required when GPU_PROVIDER={GPU_PROVIDER}. "
                f"See .env.example for the full list."
            )

    endpoint_var = _ENDPOINT_ENV[GPU_PROVIDER][provider_key]
    if not _env(endpoint_var):
        return False, (
            f"{endpoint_var} is not set — required when GPU_PROVIDER={GPU_PROVIDER}. "
            f"See .env.example for the full list."
        )

    return True, ""


def submit(payload: dict, provider_key: str) -> str:
    """
    Submit a GPU job and return an opaque provider_job_id string.

    Args:
        payload:      The scientific input dict (SMILES, Boltz YAML, etc.).
                      Content is identical regardless of provider.
        provider_key: "fep" or "boltz"

    Returns:
        provider_job_id — pass this to poll() to track progress.

    Raises:
        ProviderNotConfigured: env vars are missing.
        RuntimeError: the provider API returned an error.
    """
    ok, reason = is_configured(provider_key)
    if not ok:
        raise ProviderNotConfigured(reason)

    if GPU_PROVIDER == "runpod":
        return _runpod_submit(payload, provider_key)
    if GPU_PROVIDER == "aws":
        return _aws_submit(payload, provider_key)
    if GPU_PROVIDER == "azure":
        return _azure_submit(payload, provider_key)

    raise ProviderNotConfigured(f"GPU_PROVIDER={GPU_PROVIDER!r} is not recognised")


def poll(provider_job_id: str, provider_key: str) -> tuple[str, Optional[dict], str]:
    """
    Poll once for the status of a running job.

    Args:
        provider_job_id: The opaque ID returned by submit().
        provider_key:    "fep" or "boltz"

    Returns:
        (status, output, progress_message)
        - status:   "running" | "done" | "failed"
        - output:   The worker's output dict when status=="done", else None.
        - progress: Human-readable status string for the UI.

    Raises:
        RuntimeError: unrecoverable provider error (job failed/cancelled, bad HTTP).
    """
    if GPU_PROVIDER == "runpod":
        return _runpod_poll(provider_job_id, provider_key)
    if GPU_PROVIDER == "aws":
        return _aws_poll(provider_job_id, provider_key)
    if GPU_PROVIDER == "azure":
        return _azure_poll(provider_job_id, provider_key)

    raise RuntimeError(f"GPU_PROVIDER={GPU_PROVIDER!r} is not recognised")


# ===========================================================================
# Provider: RunPod Serverless
# ===========================================================================
#
# Env vars:
#   RUNPOD_API_KEY            — your RunPod API key
#   RUNPOD_FEP_ENDPOINT_ID    — serverless endpoint ID for the FEP worker
#   RUNPOD_BOLTZ_ENDPOINT_ID  — serverless endpoint ID for the Boltz-2 worker
#
# How RunPod Serverless works:
#   POST  /v2/{endpoint_id}/run            → {"id": "<job_id>"}
#   GET   /v2/{endpoint_id}/status/{id}    → {"status": "IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED", "output": {...}}
# ===========================================================================

_RUNPOD_BASE = "https://api.runpod.ai/v2"


def _runpod_submit(payload: dict, provider_key: str) -> str:
    api_key     = _env("RUNPOD_API_KEY")
    endpoint_id = _env(_ENDPOINT_ENV["runpod"][provider_key])
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    r = requests.post(
        f"{_RUNPOD_BASE}/{endpoint_id}/run",
        headers=headers,
        json={"input": payload},
        timeout=HTTP_TIMEOUT,
    )
    if r.status_code != 200:
        raise RuntimeError(
            f"RunPod /run failed HTTP {r.status_code}: {r.text[:300]}"
        )
    job_id = r.json().get("id")
    if not job_id:
        raise RuntimeError(f"RunPod /run returned no id: {r.json()}")
    return job_id


def _runpod_poll(
    provider_job_id: str, provider_key: str
) -> tuple[str, Optional[dict], str]:
    api_key     = _env("RUNPOD_API_KEY")
    endpoint_id = _env(_ENDPOINT_ENV["runpod"][provider_key])
    headers = {"Authorization": f"Bearer {api_key}"}
    r = requests.get(
        f"{_RUNPOD_BASE}/{endpoint_id}/status/{provider_job_id}",
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )
    if r.status_code != 200:
        raise RuntimeError(
            f"RunPod /status failed HTTP {r.status_code}: {r.text[:300]}"
        )
    data = r.json()
    rp_status = data.get("status", "UNKNOWN")

    if rp_status == "COMPLETED":
        output = data.get("output")
        if output is None:
            raise RuntimeError("RunPod COMPLETED but output payload is empty")
        return "done", output, f"RunPod: {rp_status}"

    if rp_status in ("FAILED", "CANCELLED", "TIMED_OUT"):
        err = data.get("error") or data.get("output") or "no error message from worker"
        raise RuntimeError(f"RunPod job {rp_status}: {err}")

    # IN_QUEUE / IN_PROGRESS
    return "running", None, f"RunPod: {rp_status}"


# ===========================================================================
# Provider: AWS SageMaker Async Inference
# ===========================================================================
#
# Env vars:
#   AWS_ACCESS_KEY_ID              — IAM key ID
#   AWS_SECRET_ACCESS_KEY          — IAM secret
#   AWS_REGION                     — e.g. us-east-1
#   AWS_SAGEMAKER_OUTPUT_BUCKET    — S3 bucket for async input/output
#   AWS_SAGEMAKER_FEP_ENDPOINT     — SageMaker endpoint name for FEP
#   AWS_SAGEMAKER_BOLTZ_ENDPOINT   — SageMaker endpoint name for Boltz-2
#
# How SageMaker Async Inference works:
#   1. Upload the payload JSON to S3 as the "input object"
#   2. Call invoke_endpoint_async() → returns an S3 output URI
#   3. Poll S3: output URI appears when done; a .failure file appears on error
#
# Requires: boto3  (pip install boto3)
# ===========================================================================

def _aws_submit(payload: dict, provider_key: str) -> str:
    try:
        import boto3
        import json as _json
        import uuid as _uuid
    except ImportError:
        raise RuntimeError(
            "boto3 is required for GPU_PROVIDER=aws. "
            "Install it: pip install boto3"
        )

    region   = _env("AWS_REGION")
    endpoint = _env(_ENDPOINT_ENV["aws"][provider_key])
    bucket   = _env("AWS_SAGEMAKER_OUTPUT_BUCKET")

    # 1. Upload payload to S3 so SageMaker can read it asynchronously
    s3        = boto3.client("s3", region_name=region)
    input_key = f"hakase/gpu-inputs/{provider_key}/{_uuid.uuid4().hex}.json"
    s3.put_object(
        Bucket=bucket,
        Key=input_key,
        Body=_json.dumps(payload).encode(),
        ContentType="application/json",
    )

    # 2. Invoke async endpoint — returns immediately with an output S3 URI
    sm = boto3.client("sagemaker-runtime", region_name=region)
    resp = sm.invoke_endpoint_async(
        EndpointName=endpoint,
        InputLocation=f"s3://{bucket}/{input_key}",
        ContentType="application/json",
        Accept="application/json",
    )

    # OutputLocation is the S3 URI where the result will appear.
    # We use it as the opaque provider_job_id for polling.
    output_location: str = resp["OutputLocation"]
    return output_location


def _aws_poll(
    provider_job_id: str, provider_key: str
) -> tuple[str, Optional[dict], str]:
    """
    provider_job_id is the S3 output URI returned by invoke_endpoint_async,
    e.g. s3://my-bucket/hakase/gpu-outputs/xxx.out.
    SageMaker writes a .failure object on error and the output object on success.
    """
    try:
        import boto3
        import json as _json
        from botocore.exceptions import ClientError
    except ImportError:
        raise RuntimeError("boto3 is required for GPU_PROVIDER=aws")

    region = _env("AWS_REGION")

    # Parse s3://bucket/key
    assert provider_job_id.startswith("s3://"), (
        f"Unexpected AWS job ID format (expected s3:// URI): {provider_job_id!r}"
    )
    without_scheme = provider_job_id[5:]
    bucket, key = without_scheme.split("/", 1)

    s3 = boto3.client("s3", region_name=region)

    # SageMaker async writes a .failure sidecar on error
    failure_key = key.rsplit(".", 1)[0] + ".failure"
    try:
        obj = s3.get_object(Bucket=bucket, Key=failure_key)
        err = obj["Body"].read().decode(errors="replace")
        raise RuntimeError(f"SageMaker async job failed: {err[:400]}")
    except ClientError as e:
        if e.response["Error"]["Code"] != "NoSuchKey":
            raise  # unexpected S3 error — propagate

    # Check for the success output object
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        output = _json.loads(obj["Body"].read())
        return "done", output, "SageMaker: COMPLETED"
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            return "running", None, "SageMaker: IN_PROGRESS"
        raise


# ===========================================================================
# Provider: Azure ML Managed Online Endpoint
# ===========================================================================
#
# Env vars:
#   AZURE_ML_API_KEY               — endpoint primary/secondary key
#   AZURE_ML_FEP_ENDPOINT_URL      — scoring URI for the FEP endpoint
#   AZURE_ML_BOLTZ_ENDPOINT_URL    — scoring URI for the Boltz-2 endpoint
#   AZURE_ML_DEPLOYMENT_NAME       — (optional) deployment name, default "default"
#
# How this works:
#   Your worker container must implement the SAME async job pattern as the
#   RunPod worker: accept a POST → return {"job_id": "..."} immediately, and
#   expose GET /status/{job_id} on the same base URL.
#   This means the same Docker image can run on RunPod OR on Azure Container
#   Instances behind an Azure ML endpoint — no code changes in the worker.
#
# Scoring URI format (from Azure ML Studio → Endpoints → Consume):
#   https://<endpoint>.<region>.inference.ml.azure.com/score
# ===========================================================================

def _azure_submit(payload: dict, provider_key: str) -> str:
    endpoint_url = _env(_ENDPOINT_ENV["azure"][provider_key])
    api_key      = _env("AZURE_ML_API_KEY")
    deployment   = _env("AZURE_ML_DEPLOYMENT_NAME") or "default"

    headers = {
        "Authorization":              f"Bearer {api_key}",
        "Content-Type":               "application/json",
        "azureml-model-deployment":   deployment,
    }
    r = requests.post(
        endpoint_url,
        headers=headers,
        json={"input": payload},
        timeout=HTTP_TIMEOUT,
    )
    if r.status_code not in (200, 202):
        raise RuntimeError(
            f"Azure ML endpoint failed HTTP {r.status_code}: {r.text[:300]}"
        )
    data = r.json()
    job_id = data.get("job_id") or data.get("id")
    if not job_id:
        raise RuntimeError(
            f"Azure ML endpoint returned no job_id. "
            f"Make sure your worker container returns {{\"job_id\": \"...\"}} "
            f"on POST. Response was: {data}"
        )
    return str(job_id)


def _azure_poll(
    provider_job_id: str, provider_key: str
) -> tuple[str, Optional[dict], str]:
    """
    Poll the worker's /status/{job_id} path.
    Derived from the scoring URI by replacing /score with /status/{job_id}.
    """
    endpoint_url = _env(_ENDPOINT_ENV["azure"][provider_key])
    api_key      = _env("AZURE_ML_API_KEY")
    deployment   = _env("AZURE_ML_DEPLOYMENT_NAME") or "default"

    # Build status URL from scoring URI
    # e.g. https://foo.eastus.inference.ml.azure.com/score
    #   →  https://foo.eastus.inference.ml.azure.com/status/<job_id>
    status_url = endpoint_url.rstrip("/").removesuffix("/score") + f"/status/{provider_job_id}"

    headers = {
        "Authorization":            f"Bearer {api_key}",
        "azureml-model-deployment": deployment,
    }
    r = requests.get(status_url, headers=headers, timeout=HTTP_TIMEOUT)
    if r.status_code != 200:
        raise RuntimeError(
            f"Azure ML /status failed HTTP {r.status_code}: {r.text[:300]}"
        )
    data       = r.json()
    az_status  = str(data.get("status", "UNKNOWN")).upper()

    if az_status == "COMPLETED":
        output = data.get("output")
        if output is None:
            raise RuntimeError("Azure ML job COMPLETED but output payload is empty")
        return "done", output, f"Azure ML: {az_status}"

    if az_status in ("FAILED", "CANCELLED"):
        err = data.get("error") or "no error message from worker"
        raise RuntimeError(f"Azure ML job {az_status}: {err}")

    return "running", None, f"Azure ML: {az_status}"
