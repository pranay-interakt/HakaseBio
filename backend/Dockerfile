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
COPY --from=build /wheels /wheels
RUN pip install "$(ls /wheels/*.whl)[api,db,pg]" && rm -rf /wheels
USER hos
WORKDIR /var/lib/hos
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]
# Behind the web proxy: client addresses come from X-Forwarded-For only from the addresses in
# FORWARDED_ALLOW_IPS (uvicorn's setting; default 127.0.0.1).
CMD ["uvicorn", "hos.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
