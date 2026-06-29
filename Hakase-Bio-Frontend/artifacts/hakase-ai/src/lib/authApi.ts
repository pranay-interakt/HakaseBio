/**
 * Frontend auth client.
 *
 * - Talks to /api/auth/*
 * - Stores access token in memory only (NOT localStorage) — refresh token lives
 *   in an httpOnly cookie set by the server.
 * - CSRF: server issues a token in a cookie (hk_csrf) and on /api/auth/csrf.
 *   We read it from the cookie on each state-changing call and echo it in X-CSRF-Token.
 * - On 401 from a protected call, the AuthContext attempts a single /refresh,
 *   then retries.
 */

export interface MeUser {
  id: string;
  email: string;
  username: string;
  role: string;
  emailVerified: boolean;
}

let accessToken: string | null = null;
let accessExpiresAt: number = 0;
let cachedCsrfToken: string | null = null;

export function setAccess(token: string, ttlSec: number) {
  accessToken = token;
  accessExpiresAt = Date.now() + ttlSec * 1000;
}
export function clearAccess() {
  accessToken = null;
  accessExpiresAt = 0;
}
export function getAccess(): string | null {
  if (!accessToken) return null;
  if (Date.now() > accessExpiresAt - 5_000) return null; // treat near-expiry as expired
  return accessToken;
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
  );
  return m ? decodeURIComponent(m[1]!) : null;
}

async function ensureCsrf(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  const r = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!r.ok) throw new Error("Failed to bootstrap CSRF token");
  const j = (await r.json()) as { csrfToken: string };
  cachedCsrfToken = j.csrfToken;
  return j.csrfToken;
}

async function authFetch(
  path: string,
  init: RequestInit = {},
  opts: { csrf?: boolean; auth?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (opts.csrf !== false && init.method && init.method !== "GET") {
    headers.set("X-CSRF-Token", await ensureCsrf());
  }
  if (opts.auth) {
    const tok = getAccess();
    if (tok) headers.set("Authorization", `Bearer ${tok}`);
  }
  return fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
}

async function asJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? `Request failed (${res.status})`;
    const code = parsed?.error?.code ?? "ERROR";
    const err = new Error(msg) as Error & { code: string; status: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return parsed as T;
}

// ─── public api ──────────────────────────────────────────────────────────────

export async function signup(payload: {
  email: string;
  title: string;
  firstName: string;
  lastName: string;
  password: string;
}): Promise<void> {
  await asJson(
    await authFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
}

export async function login(payload: {
  emailOrUsername: string;
  password: string;
}): Promise<MeUser> {
  const r = await asJson<{
    accessToken: string;
    accessTokenExpiresIn: number;
    user: MeUser;
  }>(
    await authFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
  setAccess(r.accessToken, r.accessTokenExpiresIn);
  return r.user;
}

export async function refresh(): Promise<MeUser | null> {
  const res = await authFetch("/api/auth/refresh", { method: "POST" }, { csrf: false });
  if (res.status === 401) return null;
  const r = await asJson<{
    accessToken: string;
    accessTokenExpiresIn: number;
    user: MeUser;
  }>(res);
  setAccess(r.accessToken, r.accessTokenExpiresIn);
  return r.user;
}

export async function logout(): Promise<void> {
  try {
    await authFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearAccess();
    cachedCsrfToken = null;
  }
}

export async function me(): Promise<MeUser> {
  const r = await asJson<{ user: MeUser }>(
    await authFetch("/api/auth/me", { method: "GET" }, { auth: true }),
  );
  return r.user;
}

export async function forgotPassword(email: string): Promise<void> {
  await asJson(
    await authFetch("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await asJson(
    await authFetch("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),
  );
}

export async function verifyEmail(token: string): Promise<void> {
  await asJson(
    await authFetch("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  );
}

export async function resendVerification(email: string): Promise<void> {
  await asJson(
    await authFetch("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  );
}

export function oauthStartUrl(provider: "google" | "apple", redirect = "/lab"): string {
  const q = new URLSearchParams({ redirect });
  return `/api/auth/oauth/${provider}/start?${q.toString()}`;
}
