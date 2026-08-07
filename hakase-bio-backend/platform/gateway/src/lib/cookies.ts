/**
 * Cookie helpers — refresh-token cookie + CSRF cookie.
 * Refresh cookie: httpOnly + secure + SameSite=Lax (Strict would break OAuth redirects).
 * CSRF cookie:    not httpOnly, SameSite=Strict. Frontend reads it and echoes value in X-CSRF-Token header.
 */
import type { Response } from "express";
import { loadEnv } from "./env.js";

export const REFRESH_COOKIE = "hk_rt";
export const CSRF_COOKIE = "hk_csrf";

export function setRefreshCookie(res: Response, token: string, maxAgeSec: number) {
  const env = loadEnv();
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: maxAgeSec * 1000,
    signed: true,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth", signed: true });
}

export function setCsrfCookie(res: Response, token: string) {
  const env = loadEnv();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // frontend reads it
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 1000, // 24h
  });
}
