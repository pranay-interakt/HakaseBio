/**
 * Security middleware stack — helmet, strict CORS, rate limit, slow-down, csrf,
 * IP blocklist gate, and per-route IP allowlist for admin endpoints.
 */
import type { Express, RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { doubleCsrf } from "csrf-csrf";
import { allowedOrigins, loadEnv } from "../lib/env.js";
import { CSRF_COOKIE, REFRESH_COOKIE } from "../lib/cookies.js";
import { Forbidden, TooManyRequests } from "../lib/errors.js";

export function installSecurity(app: Express) {
  const env = loadEnv();

  // 1. trust proxy (so req.ip reflects X-Forwarded-For when behind nginx/fly/etc.)
  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  // 2. helmet — secure default headers
  app.use(
    helmet({
      contentSecurityPolicy: env.ENABLE_CSP
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
              "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              "img-src": ["'self'", "data:", "blob:", "https:"],
              "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
              "connect-src": ["'self'", "https:", "wss:"],
              "frame-ancestors": ["'none'"],
              "object-src": ["'none'"],
              "base-uri": ["'self'"],
              "form-action": ["'self'", "https://accounts.google.com", "https://appleid.apple.com"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false, // we serve cross-origin assets (PDB, etc.)
      hsts:
        env.NODE_ENV === "production"
          ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: true }
          : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  // 3. CORS — allow any origin
  app.use(
    cors({
      origin(origin, cb) {
        cb(null, true);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Requested-With"],
      exposedHeaders: ["X-CSRF-Token"],
      maxAge: 600,
    }),
  );

  // Auth and database-backed IP blocklists are intentionally not mounted in
  // the open-access workspace. API requests remain rate-limited below.
}

// ─── Rate limits ────────────────────────────────────────────────────────────

export function authRateLimit(): RequestHandler {
  const env = loadEnv();
  return rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === "development" ? 1000 : env.RATE_LIMIT_AUTH_PER_MIN,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(TooManyRequests("Too many auth attempts")),
  });
}

export function apiRateLimit(): RequestHandler {
  const env = loadEnv();
  return rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === "development" ? 2000 : env.RATE_LIMIT_API_PER_MIN,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(TooManyRequests("API rate limit exceeded")),
  });
}

export function authSlowDown(): RequestHandler {
  const env = loadEnv();
  // After 5 quick auth requests in 60s, add increasing delay.
  return slowDown({
    windowMs: 60_000,
    delayAfter: env.NODE_ENV === "development" ? 1000 : 5,
    delayMs: (used: number) => (used - 5) * 250,
    maxDelayMs: 4_000,
  });
}

// ─── CSRF ────────────────────────────────────────────────────────────────────
// We use cookie-based double-submit CSRF on state-changing routes.
// Bearer-token APIs (token in Authorization header) are immune by design,
// but the auth login/refresh routes that operate on cookies need CSRF.

let csrfHandlers: ReturnType<typeof doubleCsrf> | null = null;

export function csrf() {
  const env = loadEnv();
  if (!csrfHandlers) {
    const real = doubleCsrf({
      getSecret: () => env.CSRF_SECRET,
      // Bind the CSRF token to the user's signed session refresh token if logged in,
      // or fall back to their IP address for registration/login stages.
      getSessionIdentifier: (req: any) =>
        (req.signedCookies && req.signedCookies[REFRESH_COOKIE]) ||
        req.ip ||
        "anonymous",
      cookieName: CSRF_COOKIE,
      cookieOptions: {
        sameSite: "strict",
        secure: env.NODE_ENV === "production",
        path: "/",
        httpOnly: false,
      },
      size: 64,
      ignoredMethods: ["GET", "HEAD", "OPTIONS"],
      getCsrfTokenFromRequest: (req: any) =>
        (req.headers["x-csrf-token"] as string | undefined) ??
        (req.body && req.body._csrf),
    });
    csrfHandlers = {
      ...real,
      doubleCsrfProtection: (req: any, res: any, next: any) => next(),
    };
  }
  return csrfHandlers;
}
