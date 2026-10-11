"""Request size limits (docs/15 P2.5).

Uploads (raw data files, study reports, verification bundles) may be large; every other body is
a small JSON document. Both limits are configurable:

* ``HOS_MAX_UPLOAD_MB`` (default 100) for the upload endpoints in :data:`UPLOAD_PATHS`;
* ``HOS_MAX_JSON_KB`` (default 2048) for everything else.

A declared ``Content-Length`` over the limit is refused before the body is read. A body sent
without one (chunked) is counted as it arrives and refused once it passes the limit. Either way
the answer is 413 and nothing is stored: the endpoint never sees a complete body.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

__all__ = ["UPLOAD_PATHS", "BodyLimit"]

#: Endpoints that take a raw file body.
UPLOAD_PATHS = tuple(re.compile(p) for p in (
    r"^/api/studies/[^/]+/data$",
    r"^/api/programs/[^/]+/imports$",
    r"^/api/studies/[^/]+/import/datasets$",
    r"^/api/verify$",
))


class _TooLarge(Exception):
    pass


class BodyLimit:
    def __init__(self, app: ASGIApp, *, upload_bytes: int | None = None,
                 json_bytes: int | None = None) -> None:
        self.app = app
        self.upload_bytes = upload_bytes or int(
            float(os.environ.get("HOS_MAX_UPLOAD_MB", "100")) * 1024 * 1024)
        self.json_bytes = json_bytes or int(
            float(os.environ.get("HOS_MAX_JSON_KB", "2048")) * 1024)

    def limit_for(self, path: str) -> int:
        return self.upload_bytes if any(p.match(path) for p in UPLOAD_PATHS) else self.json_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.limit_for(scope["path"])
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._refuse(send, limit)
            return
        received = 0
        started = too_big = False

        async def counted() -> Message:
            nonlocal received, too_big
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_big = True
                    raise _TooLarge
            return message

        async def tracked(message: Message) -> None:
            nonlocal started
            if too_big:
                # the endpoint turned the interrupted read into its own error (FastAPI answers
                # 400 for a body it could not parse); answer 413 instead
                if message["type"] == "http.response.start" and not started:
                    started = True
                    await self._refuse(send, limit)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted, tracked)
        except _TooLarge:
            if not started:
                await self._refuse(send, limit)

    @staticmethod
    async def _refuse(send: Send, limit: int) -> None:
        size = (f"{limit / 1024 / 1024:g} MB" if limit >= 1024 * 1024
                else f"{limit / 1024:g} KB")
        body = json.dumps({"error": "PayloadTooLarge",
                           "detail": f"the request body is larger than this endpoint accepts "
                                     f"({size}); nothing was stored"}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
