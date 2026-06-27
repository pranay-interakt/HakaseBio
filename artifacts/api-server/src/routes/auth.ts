/**
 * /api/auth — authentication endpoints.
 *
 *   POST   /signup                       email + username + password
 *   POST   /login                        email-or-username + password → tokens
 *   POST   /refresh                      uses refresh cookie → new access + rotated refresh
 *   POST   /logout                       revokes the current session
 *   GET    /me                           returns the authenticated user
 *   POST   /resend-verification          send a fresh verify-email link
 *   POST   /verify-email                 consume verification token
 *   POST   /forgot-password              kicks off password reset (anti-enumeration)
 *   POST   /reset-password               consumes reset token + new password
 *   POST   /change-password              authenticated rotation
 *   GET    /oauth/:provider/start        302 to provider (PKCE state)
 *   GET    /oauth/:provider/callback     handles code exchange (Apple uses POST too)
 *   POST   /oauth/apple/callback         Apple posts form_post on the callback
 *   GET    /sessions                     list user's active sessions
 *   DELETE /sessions/:id                 revoke a specific session
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler, BadRequest, Unauthorized } from "../lib/errors.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from "../lib/cookies.js";
import { clientIp } from "../lib/ipnet.js";
import {
  audit,
  completeAppleOauth,
  completeGoogleOauth,
  consumeEmailVerification,
  consumePasswordReset,
  getUserById,
  issueEmailVerification,
  loginWithPassword,
  refreshSession,
  requestPasswordReset,
  revokeSession,
  signupWithPassword,
  startOauthFlow,
} from "../lib/auth/service.js";
import { authRateLimit, authSlowDown, csrf } from "../middlewares/security.js";
import { requireAuth } from "../middlewares/auth.js";
import { loadEnv } from "../lib/env.js";
import { db, sessions, users } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { verifyPassword, hashPassword } from "../lib/crypto.js";

const router: IRouter = Router();
const env = () => loadEnv();

// Apply per-route rate limit + slow-down to the whole auth surface
router.use(authRateLimit(), authSlowDown());

// CSRF protection on cookie-bearing state-changing routes (login/refresh/logout/etc.)
const { doubleCsrfProtection } = csrf();

// ─── Public bootstrap: hand out a CSRF token & confirm session state ────────
router.get(
  "/csrf",
  asyncHandler(async (_req, res) => {
    const { generateCsrfToken } = csrf();
    const token = generateCsrfToken(_req as any, res as any);
    res.json({ csrfToken: token });
  }),
);

// ─── Signup ──────────────────────────────────────────────────────────────────
const SignupSchema = z.object({
  email: z.string().email().max(254),
  title: z.enum(["mr", "mrs", "ms", "dr", "other"]),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  password: z.string().min(12).max(256),
});

router.post(
  "/signup",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const body = SignupSchema.parse(req.body);
    const ip = clientIp(req);
    const ua = (req.headers["user-agent"] as string) ?? "";
    const u = await signupWithPassword({
      email: body.email,
      title: body.title,
      firstName: body.firstName,
      lastName: body.lastName,
      password: body.password,
      ip,
      userAgent: ua,
    });
    res.status(201).json({
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
        emailVerified: !!u.emailVerifiedAt,
      },
      message: "Account created. Check your email for a verification link.",
    });
  }),
);

// ─── Login ───────────────────────────────────────────────────────────────────
const LoginSchema = z.object({
  emailOrUsername: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
});

router.post(
  "/login",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const body = LoginSchema.parse(req.body);
    const ip = clientIp(req);
    const ua = (req.headers["user-agent"] as string) ?? "";
    const issued = await loginWithPassword({
      emailOrUsername: body.emailOrUsername,
      password: body.password,
      ip,
      userAgent: ua,
    });
    setRefreshCookie(res, issued.refreshToken, env().REFRESH_TOKEN_TTL_SEC);
    res.json({
      accessToken: issued.accessToken,
      accessTokenExpiresIn: env().ACCESS_TOKEN_TTL_SEC,
      user: {
        id: issued.user.id,
        email: issued.user.email,
        username: issued.user.username,
        role: issued.user.role,
        emailVerified: !!issued.user.emailVerifiedAt,
      },
    });
  }),
);

// ─── Refresh ─────────────────────────────────────────────────────────────────
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const rt = (req.signedCookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!rt) throw Unauthorized("No refresh cookie");
    const ip = clientIp(req);
    const ua = (req.headers["user-agent"] as string) ?? "";
    const issued = await refreshSession({ refreshToken: rt, ip, userAgent: ua });
    setRefreshCookie(res, issued.refreshToken, env().REFRESH_TOKEN_TTL_SEC);
    res.json({
      accessToken: issued.accessToken,
      accessTokenExpiresIn: env().ACCESS_TOKEN_TTL_SEC,
      user: {
        id: issued.user.id,
        email: issued.user.email,
        username: issued.user.username,
        role: issued.user.role,
        emailVerified: !!issued.user.emailVerifiedAt,
      },
    });
  }),
);

// ─── Logout ──────────────────────────────────────────────────────────────────
router.post(
  "/logout",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const rt = (req.signedCookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (rt) {
      await revokeSession(rt, clientIp(req));
    }
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

// ─── /me ─────────────────────────────────────────────────────────────────────
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const u = await getUserById(req.user!.id);
    if (!u) throw Unauthorized();
    res.json({
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        emailVerified: !!u.emailVerifiedAt,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      },
    });
  }),
);

// ─── Email verification ──────────────────────────────────────────────────────
const TokenOnly = z.object({ token: z.string().min(16).max(256) });

router.post(
  "/verify-email",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const { token } = TokenOnly.parse(req.body);
    const u = await consumeEmailVerification(token);
    await audit({
      userId: u.id,
      event: "email_verified",
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

router.post(
  "/resend-verification",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const Schema = z.object({ email: z.string().email() });
    const { email } = Schema.parse(req.body);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, email.toLowerCase().trim()));
    if (u && !u.emailVerifiedAt) {
      await issueEmailVerification(u);
    }
    // Always return ok (anti-enumeration)
    res.json({ ok: true });
  }),
);

// ─── Password reset ──────────────────────────────────────────────────────────
router.post(
  "/forgot-password",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const Schema = z.object({ email: z.string().email() });
    const { email } = Schema.parse(req.body);
    await requestPasswordReset(email, clientIp(req));
    res.json({ ok: true });
  }),
);

router.post(
  "/reset-password",
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const Schema = z.object({
      token: z.string().min(16).max(256),
      newPassword: z.string().min(12).max(256),
    });
    const body = Schema.parse(req.body);
    await consumePasswordReset({
      token: body.token,
      newPassword: body.newPassword,
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

router.post(
  "/change-password",
  requireAuth,
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const Schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12).max(256),
    });
    const body = Schema.parse(req.body);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user!.id));
    if (!u || !u.passwordHash) throw BadRequest("No password set on this account");
    if (!(await verifyPassword(u.passwordHash, body.currentPassword))) {
      throw BadRequest("Current password is incorrect");
    }
    const hash = await hashPassword(body.newPassword);
    await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, u.id));
    // Revoke every session except the current one.
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: "password_change" })
      .where(
        and(
          eq(sessions.userId, u.id),
          isNull(sessions.revokedAt),
        ),
      );
    await audit({
      userId: u.id,
      event: "password_change",
      ipAddress: clientIp(req),
    });
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

// ─── Sessions management ─────────────────────────────────────────────────────
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        revokedReason: sessions.revokedReason,
      })
      .from(sessions)
      .where(eq(sessions.userId, req.user!.id))
      .orderBy(desc(sessions.createdAt))
      .limit(20);
    res.json({
      sessions: rows.map((r) => ({
        ...r,
        current: r.id === req.user!.sessionId,
      })),
    });
  }),
);

router.delete(
  "/sessions/:id",
  requireAuth,
  doubleCsrfProtection,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: "user_revoked" })
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.user!.id)));
    if (id === req.user!.sessionId) clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

// ─── OAuth: start ────────────────────────────────────────────────────────────
router.get(
  "/oauth/:provider/start",
  asyncHandler(async (req, res) => {
    const provider = req.params.provider;
    if (provider !== "google" && provider !== "apple") {
      throw BadRequest("Unsupported provider");
    }
    const redirectAfter =
      typeof req.query.redirect === "string" ? req.query.redirect : "/dashboard";
    const { url } = await startOauthFlow({ provider, redirectAfter });
    res.redirect(url);
  }),
);

// ─── OAuth: Google callback (GET) ────────────────────────────────────────────
router.get(
  "/oauth/google/callback",
  asyncHandler(async (req, res) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) throw BadRequest("Missing code/state");
    const { session, redirectAfter } = await completeGoogleOauth({
      code,
      state,
      ip: clientIp(req),
      userAgent: (req.headers["user-agent"] as string) ?? "",
    });
    setRefreshCookie(res, session.refreshToken, env().REFRESH_TOKEN_TTL_SEC);
    const url = new URL(redirectAfter, env().APP_URL);
    url.searchParams.set("oauth", "success");
    url.searchParams.set("access_token", session.accessToken);
    res.redirect(url.toString());
  }),
);

// ─── OAuth: Apple callback (POST form_post + GET fallback) ───────────────────
const handleAppleCallback = asyncHandler(async (req, res) => {
  const source = (req.method === "POST" ? req.body : req.query) ?? {};
  const code = String((source as any).code ?? "");
  const state = String((source as any).state ?? "");
  if (!code || !state) throw BadRequest("Missing code/state");
  const { session, redirectAfter } = await completeAppleOauth({
    code,
    state,
    ip: clientIp(req),
    userAgent: (req.headers["user-agent"] as string) ?? "",
  });
  setRefreshCookie(res, session.refreshToken, env().REFRESH_TOKEN_TTL_SEC);
  const url = new URL(redirectAfter, env().APP_URL);
  url.searchParams.set("oauth", "success");
  url.searchParams.set("access_token", session.accessToken);
  res.redirect(url.toString());
});
router.post("/oauth/apple/callback", handleAppleCallback);
router.get("/oauth/apple/callback", handleAppleCallback);

export default router;
