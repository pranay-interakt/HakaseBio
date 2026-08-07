/**
 * Generic modality mounting.
 *
 * Turns a declarative `ModalityRouteSpec` into Express routes over the shared
 * upstream proxy. Previously every endpoint was a hand-maintained entry in one
 * flat table in this package; now each modality declares its own surface and
 * the gateway just mounts whatever it is handed. Adding a modality touches no
 * file here.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import type { ModalityRouteSpec, WildcardMount } from "@platform/contract";

import { asyncHandler, GatewayTimeout, UpstreamError } from "./lib/errors.js";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8090";
export const UPSTREAM_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 60_000);

type ProxyMethod = "GET" | "POST";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardedHeaders(req: Request, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (Array.isArray(value)) {
      headers[lower] = value.join(", ");
    } else if (value !== undefined) {
      headers[lower] = value;
    }
  }
  if (hasBody && !headers["content-type"]) {
    headers["content-type"] = req.get("content-type") ?? "application/json";
  }
  return headers;
}

function queryString(req: Request): string {
  const queryStart = req.originalUrl.indexOf("?");
  return queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Forward a request upstream verbatim.
 *
 * Errors are never swallowed: upstream non-2xx is passed through as-is, a
 * non-JSON body is returned as text, and a network failure becomes a 502
 * carrying the real cause.
 */
export async function proxy(
  method: ProxyMethod,
  upstreamPath: string,
  req: Request,
  res: Response,
  pathParams?: string[],
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<void> {
  let url = `${AI_SERVICE_URL}${upstreamPath}`;
  for (const p of pathParams ?? []) {
    url += `/${encodeURIComponent(String(req.params[p] ?? ""))}`;
  }
  url += queryString(req);

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  const init: RequestInit = {
    method,
    headers: forwardedHeaders(req, method === "POST"),
    signal: abortController.signal,
  };
  if (method === "POST") {
    init.body = JSON.stringify(req.body ?? {});
  }

  let resp: globalThis.Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    if (isAbortError(e) || abortController.signal.aborted) {
      throw GatewayTimeout(`AI service timed out after ${timeoutMs} ms for ${upstreamPath}`, {
        upstream: AI_SERVICE_URL,
        upstreamPath,
        timeoutMs,
      });
    }
    throw UpstreamError(`AI service unreachable at ${AI_SERVICE_URL}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = await resp.json().catch(() => ({ error: "Malformed JSON from AI service" }));
    res.status(resp.status).json(data);
    return;
  }
  const text = await resp.text();
  res.status(resp.status).type(ct || "text/plain").send(text);
}

/** Build the catch-all handler for one wildcard mount. */
function wildcardHandler(mount: WildcardMount) {
  // Strip any accepted gateway prefix back to the upstream prefix. Use the
  // original URL path so the rewrite is independent of where Express mounted
  // this router (`/api`, root, etc.).
  const gatewayPrefixes = [
    ...mount.mountAt,
    ...mount.mountAt.map((p) => `/api${p}`),
    `/api${mount.upstreamPrefix}`,
    `/ai${mount.upstreamPrefix}`,
    mount.upstreamPrefix,
  ].sort((a, b) => b.length - a.length);

  return async function handle(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rawPath = req.originalUrl.split("?")[0] || "/";
    let upstreamPath = rawPath;
    for (const prefix of gatewayPrefixes) {
      if (rawPath === prefix || rawPath.startsWith(`${prefix}/`)) {
        upstreamPath = `${mount.upstreamPrefix}${rawPath.slice(prefix.length)}`;
        break;
      }
    }
    if (!upstreamPath.startsWith(mount.upstreamPrefix)) {
      upstreamPath = `${mount.upstreamPrefix}${upstreamPath}`;
    }

    const timeoutMs = mount.timeouts?.[upstreamPath] ?? UPSTREAM_TIMEOUT_MS;
    await proxy(req.method as ProxyMethod, upstreamPath, req, res, undefined, timeoutMs);
  };
}

/**
 * Mount one modality's declared surface onto a router.
 *
 * Returns the routers that must be `app.use`d at a prefix (wildcards); simple
 * path routes are registered directly on `target`.
 */
export function mountModality(
  target: IRouter,
  spec: ModalityRouteSpec,
): Array<{ prefix: string; router: IRouter }> {
  for (const [from, to] of Object.entries(spec.posts ?? {})) {
    target.post(
      from,
      asyncHandler((req, res) => proxy("POST", to, req, res)),
    );
  }
  for (const [from, to] of Object.entries(spec.gets ?? {})) {
    target.get(
      from,
      asyncHandler((req, res) => proxy("GET", to, req, res)),
    );
  }
  for (const { from, to, params } of spec.paramGets ?? []) {
    target.get(
      from,
      asyncHandler((req, res) => proxy("GET", to, req, res, params)),
    );
  }

  const mounts: Array<{ prefix: string; router: IRouter }> = [];
  for (const wildcard of spec.wildcards ?? []) {
    const wildcardRouter: IRouter = Router();
    wildcardRouter.all("/{*path}", asyncHandler(wildcardHandler(wildcard)));
    for (const prefix of wildcard.mountAt) {
      mounts.push({ prefix, router: wildcardRouter });
    }
  }
  return mounts;
}
