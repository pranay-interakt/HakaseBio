# Hakase API (docs/15 P2.3). Non-root, base pinned by digest; build from backend/.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS build
WORKDIR /src
COPY pyproject.toml ./
COPY hos ./hos
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels .

FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HOS_DATA_DIR=/var/lib/hos HOS_ANCHOR_DIR=/var/lib/hos-anchors
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin hos \
 && mkdir -p /var/lib/hos /var/lib/hos-anchors \
 && chown hos:hos /var/lib/hos /var/lib/hos-anchors
# the locked, hash-checked dependency set (docs/15 P2.4), then the application itself
COPY requirements.lock /tmp/requirements.lock
RUN pip install --require-hashes -r /tmp/requirements.lock && rm /tmp/requirements.lock
COPY --from=build /wheels /wheels
RUN pip install --no-deps /wheels/*.whl && rm -rf /wheels && pip check
USER hos
WORKDIR /var/lib/hos
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]
# Behind the web proxy: client addresses come from X-Forwarded-For only from the addresses in
# FORWARDED_ALLOW_IPS (uvicorn's setting; default 127.0.0.1).
# The API logs one structured line per request itself (docs/15 P2.7), so uvicorn's access log,
# which would also record query strings, is off.
CMD ["uvicorn", "hos.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", \
     "--no-access-log"]
