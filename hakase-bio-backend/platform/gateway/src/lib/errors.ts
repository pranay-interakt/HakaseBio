/**
 * Standard error envelope: { error: { code, message, details? } }
 * Every route MUST throw HttpError on failure — no silent catches, no 200 with mock data.
 */
export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (msg: string, details?: unknown) =>
  new HttpError(400, "BAD_REQUEST", msg, details);
export const Unauthorized = (msg = "Authentication required") =>
  new HttpError(401, "UNAUTHORIZED", msg);
export const Forbidden = (msg = "Forbidden") =>
  new HttpError(403, "FORBIDDEN", msg);
export const NotFound = (msg = "Not found") =>
  new HttpError(404, "NOT_FOUND", msg);
export const Conflict = (msg: string) => new HttpError(409, "CONFLICT", msg);
export const TooManyRequests = (msg = "Rate limit exceeded") =>
  new HttpError(429, "RATE_LIMITED", msg);
export const ServiceUnavailable = (msg: string) =>
  new HttpError(503, "SERVICE_UNAVAILABLE", msg);
export const UpstreamError = (msg: string, details?: unknown) =>
  new HttpError(502, "UPSTREAM_ERROR", msg, details);
export const GatewayTimeout = (msg: string, details?: unknown) =>
  new HttpError(504, "GATEWAY_TIMEOUT", msg, details);

import type { ErrorRequestHandler, RequestHandler } from "express";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

/**
 * Final error handler. Logs full detail server-side, returns sanitized JSON.
 * NEVER swallows — always responds with explicit status + code.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isHttp = err instanceof HttpError || (err && typeof err.status === "number" && typeof err.code === "string");
  const status = isHttp ? err.status : 500;
  const code = isHttp ? err.code : "INTERNAL_ERROR";
  const message = isHttp
    ? err.message
    : "An unexpected server error occurred. Please contact support if this persists.";

  // Server-side log includes full stack & details.
  const logPayload = {
    method: req.method,
    path: req.path,
    ip: req.ip,
    status,
    code,
    message: err?.message,
    stack: err?.stack,
    details: isHttp ? err.details : undefined,
  };
  if (status >= 500 || err?.message === "invalid csrf token") {
    console.error("[api-server] ERROR", {
      ...logPayload,
      cookies: req.cookies,
      signedCookies: req.signedCookies,
      csrfHeader: req.headers["x-csrf-token"],
    });
  } else {
    console.warn("[api-server] WARN", logPayload);
  }

  res.status(status).json({
    error: {
      code,
      message,
      details: isHttp ? err.details : undefined,
    },
  });
};

/**
 * Wrap async handlers so thrown errors propagate to errorHandler.
 * Use this for every async route to avoid silent unhandled-rejection failures.
 */
export const asyncHandler =
  <T extends RequestHandler>(fn: T): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
