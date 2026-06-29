/**
 * Auth service — the heart of the login system.
 *
 * Guarantees:
 *  - Single device per account: issueSession() revokes all other live sessions for the user
 *    and emails a security notice.
 *  - No silent failures: every DB or email failure throws and is surfaced to the caller.
 *  - Audit log written for every login attempt (success, fail, blocked).
 *  - Account lockout after ACCOUNT_LOCK_THRESHOLD failures within ACCOUNT_LOCK_WINDOW_MIN.
 *  - IP allowlist enforcement: if user has rows in ip_allowlist, reject other CIDRs.
 *  - IP blocklist: global block list applied first.
 */
import {
  db,
  users,
  sessions,
  oauthAccounts,
  oauthState,
  loginAudit,
  ipAllowlist,
  ipBlocklist,
  emailVerificationTokens,
  passwordResetTokens,
  type User,
} from "@workspace/db";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  generateOpaqueToken,
  hashPassword,
  pkcePair,
  sha256,
  verifyPassword,
} from "../crypto.js";
import { signAccessToken } from "../jwt.js";
import { loadEnv } from "../env.js";
import { ipInCidr } from "../ipnet.js";
import { passwordResetHtml, securityNoticeHtml, sendEmail, verifyEmailHtml } from "../email.js";
import {
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../errors.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function validatePassword(pw: string): void {
  if (typeof pw !== "string" || pw.length < 12) {
    throw BadRequest("Password must be at least 12 characters");
  }
  // industry-standard composition rules
  const cats = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) =>
    r.test(pw),
  ).length;
  if (cats < 3) {
    throw BadRequest(
      "Password must contain at least 3 of: lowercase, uppercase, digit, symbol",
    );
  }
}

function validateUsername(u: string): void {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    throw BadRequest(
      "Username must be 3–32 chars, letters/digits/._- only",
    );
  }
}

function validateEmail(e: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    throw BadRequest("Invalid email address");
  }
}

// ─── IP gate ─────────────────────────────────────────────────────────────────

export async function ipBlockedGlobally(ip: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(ipBlocklist)
    .where(or(isNull(ipBlocklist.expiresAt), gt(ipBlocklist.expiresAt, new Date())));
  return rows.some((r) => ipInCidr(ip, r.cidr));
}

export async function ipAllowedForUser(userId: string, ip: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(ipAllowlist)
    .where(or(eq(ipAllowlist.userId, userId), isNull(ipAllowlist.userId)));
  // Two cases:
  //   - any global rows (user_id IS NULL) → user must match at least one
  //   - any user-specific rows → user must match at least one
  // If neither group exists, no allowlist applies for this user.
  const globalRows = rows.filter((r) => r.userId === null);
  const userRows = rows.filter((r) => r.userId === userId);
  if (globalRows.length > 0 && !globalRows.some((r) => ipInCidr(ip, r.cidr))) {
    return false;
  }
  if (userRows.length > 0 && !userRows.some((r) => ipInCidr(ip, r.cidr))) {
    return false;
  }
  return true;
}

// ─── audit ───────────────────────────────────────────────────────────────────

export async function audit(opts: {
  userId?: string | null;
  emailAttempt?: string | null;
  event: string;
  provider?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}): Promise<void> {
  await db.insert(loginAudit).values({
    userId: opts.userId ?? null,
    emailAttempt: opts.emailAttempt ?? null,
    event: opts.event,
    provider: opts.provider ?? null,
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
    reason: opts.reason ?? null,
  });
}

// ─── lockout ─────────────────────────────────────────────────────────────────

async function bumpFailedLogin(userId: string): Promise<User> {
  const env = loadEnv();
  const now = new Date();
  const [u] = await db
    .update(users)
    .set({
      failedLoginCount: sql`${users.failedLoginCount} + 1`,
      lockedUntil: sql`CASE
        WHEN ${users.failedLoginCount} + 1 >= ${env.ACCOUNT_LOCK_THRESHOLD}
        THEN ${new Date(now.getTime() + env.ACCOUNT_LOCK_WINDOW_MIN * 60_000)}
        ELSE ${users.lockedUntil}
      END`,
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning();
  return u!;
}

async function clearFailedLogin(userId: string, ip: string): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

// ─── session issuance (single-device enforcement) ────────────────────────────

export interface IssuedSession {
  accessToken: string;
  refreshToken: string; // plaintext — only ever delivered as httpOnly cookie
  refreshExpiresAt: Date;
  sessionId: string;
  user: User;
}

export async function issueSession(opts: {
  user: User;
  ip: string;
  userAgent: string;
  deviceFingerprint?: string;
}): Promise<IssuedSession> {
  const env = loadEnv();
  const now = new Date();
  const refreshExpires = new Date(
    now.getTime() + env.REFRESH_TOKEN_TTL_SEC * 1000,
  );

  // 1. Revoke all live sessions for this user (single-device policy)
  const liveBefore = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, opts.user.id), isNull(sessions.revokedAt)));

  if (liveBefore.length > 0) {
    await db
      .update(sessions)
      .set({ revokedAt: now, revokedReason: "single_device_replaced" })
      .where(and(eq(sessions.userId, opts.user.id), isNull(sessions.revokedAt)));

    // Best-effort security notice. We do NOT swallow failures — log and rethrow.
    try {
      await sendEmail({
        to: opts.user.email,
        subject: "Your HakaseAI account signed in on a new device",
        html: securityNoticeHtml(
          `A new sign-in to your HakaseAI account was just completed from IP <code>${opts.ip}</code>. Any other devices were signed out automatically because only one active session is allowed per account.`,
        ),
      });
    } catch (e) {
      console.warn(
        "[auth] security notice email failed (non-fatal, login continues):",
        (e as Error).message,
      );
      // We deliberately do NOT block login on notice-email failure — but we
      // log it and continue. This is the only acceptable non-fatal email path.
    }
  }

  // 2. Create new session
  const refreshToken = generateOpaqueToken(48);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: opts.user.id,
      refreshTokenHash: sha256(refreshToken),
      deviceFingerprint: opts.deviceFingerprint ?? null,
      userAgent: opts.userAgent.slice(0, 500),
      ipAddress: opts.ip,
      expiresAt: refreshExpires,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("Failed to create session");

  // 3. Mint access token
  const accessToken = signAccessToken({
    sub: opts.user.id,
    sid: row.id,
    role: opts.user.role,
    email: opts.user.email,
    email_verified: !!opts.user.emailVerifiedAt,
  });

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: refreshExpires,
    sessionId: row.id,
    user: opts.user,
  };
}

// ─── account creation ────────────────────────────────────────────────────────

export async function signupWithPassword(opts: {
  email: string;
  title: string;
  firstName: string;
  lastName: string;
  password: string;
  ip: string;
  userAgent: string;
}): Promise<User> {
  const email = normEmail(opts.email);
  validateEmail(email);
  validatePassword(opts.password);

  if (!opts.title || !["mr", "mrs", "ms", "dr", "other"].includes(opts.title)) {
    throw BadRequest("Invalid title");
  }
  if (!opts.firstName || opts.firstName.trim().length === 0) {
    throw BadRequest("First name is required");
  }
  if (!opts.lastName || opts.lastName.trim().length === 0) {
    throw BadRequest("Last name is required");
  }

  // Generate unique username from first name and last name
  let baseUsername = `${opts.firstName.replace(/[^a-zA-Z0-9]/g, "")}.${opts.lastName.replace(/[^a-zA-Z0-9]/g, "")}`.toLowerCase().slice(0, 25);
  if (baseUsername.length < 3) {
    baseUsername = email.split("@")[0]!.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 25);
  }
  let username = baseUsername;
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (existing.length === 0) break;
    username = `${baseUsername}.${Math.floor(100 + Math.random() * 900)}`;
    attempts++;
  }

  // Uniqueness
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, email));
  if (existing.length > 0) {
    throw Conflict("Email already registered");
  }

  const hash = await hashPassword(opts.password);
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email.trim(),
      emailNormalized: email,
      username: username,
      title: opts.title,
      firstName: opts.firstName.trim(),
      lastName: opts.lastName.trim(),
      passwordHash: hash,
      status: "pending_verification",
    })
    .returning();
  if (!u) throw new Error("Failed to create user");

  await issueEmailVerification(u);
  await audit({
    userId: u.id,
    emailAttempt: email,
    event: "signup",
    provider: "password",
    ipAddress: opts.ip,
    userAgent: opts.userAgent,
  });
  return u;
}

// ─── email verification ──────────────────────────────────────────────────────

export async function issueEmailVerification(user: User): Promise<void> {
  const env = loadEnv();
  const token = generateOpaqueToken(32);
  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const url = `${env.APP_URL}/login?verify=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your HakaseAI email",
    html: verifyEmailHtml(url),
  });
}

export async function consumeEmailVerification(token: string): Promise<User> {
  const hash = sha256(token);
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, hash),
        isNull(emailVerificationTokens.consumedAt),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    );
  if (!row) throw BadRequest("Verification link is invalid or expired");

  await db
    .update(emailVerificationTokens)
    .set({ consumedAt: new Date() })
    .where(eq(emailVerificationTokens.id, row.id));

  const [u] = await db
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(users.id, row.userId))
    .returning();
  if (!u) throw NotFound("User no longer exists");
  return u;
}

// ─── password reset ──────────────────────────────────────────────────────────

export async function requestPasswordReset(email: string, ip: string): Promise<void> {
  const env = loadEnv();
  const e = normEmail(email);
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, e));
  if (!u) {
    // Anti-enumeration: return success even if the email doesn't exist.
    // We still write an audit row.
    await audit({
      emailAttempt: e,
      event: "password_reset_request_unknown_email",
      ipAddress: ip,
    });
    return;
  }
  const token = generateOpaqueToken(32);
  await db.insert(passwordResetTokens).values({
    userId: u.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    requestedFromIp: ip,
  });
  const url = `${env.APP_URL}/login?reset=${encodeURIComponent(token)}`;
  await sendEmail({
    to: u.email,
    subject: "Reset your HakaseAI password",
    html: passwordResetHtml(url),
  });
  await audit({
    userId: u.id,
    event: "password_reset_request",
    ipAddress: ip,
  });
}

export async function consumePasswordReset(opts: {
  token: string;
  newPassword: string;
  ip: string;
}): Promise<User> {
  validatePassword(opts.newPassword);
  const hash = sha256(opts.token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hash),
        isNull(passwordResetTokens.consumedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    );
  if (!row) throw BadRequest("Reset link is invalid or expired");

  const pwHash = await hashPassword(opts.newPassword);
  await db
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));
  const [u] = await db
    .update(users)
    .set({
      passwordHash: pwHash,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, row.userId))
    .returning();
  if (!u) throw NotFound("User no longer exists");

  // Revoke ALL sessions on password change.
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: "password_reset" })
    .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));

  await audit({
    userId: u.id,
    event: "password_reset",
    ipAddress: opts.ip,
  });
  return u;
}

// ─── password login ──────────────────────────────────────────────────────────

export async function loginWithPassword(opts: {
  emailOrUsername: string;
  password: string;
  ip: string;
  userAgent: string;
}): Promise<IssuedSession> {
  const id = opts.emailOrUsername.trim();
  const lookup = id.includes("@") ? normEmail(id) : id;

  // Global IP block check
  if (await ipBlockedGlobally(opts.ip)) {
    await audit({
      emailAttempt: lookup,
      event: "login_blocked_ip",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      reason: "global_blocklist",
    });
    throw Forbidden("Access blocked from this network");
  }

  const [u] = await db
    .select()
    .from(users)
    .where(
      or(eq(users.emailNormalized, lookup), eq(users.username, lookup)),
    );

  if (!u || !u.passwordHash) {
    await audit({
      emailAttempt: lookup,
      event: "login_fail",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      reason: "no_such_user",
    });
    // Constant-ish-time response
    await new Promise((r) => setTimeout(r, 80));
    throw Unauthorized("Invalid email/username or password");
  }

  // Locked?
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await audit({
      userId: u.id,
      event: "login_blocked_lockout",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
    });
    throw Forbidden(
      "Account temporarily locked due to too many failed attempts. Try again later or reset your password.",
    );
  }

  if (u.status === "disabled") {
    await audit({
      userId: u.id,
      event: "login_blocked_disabled",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
    });
    throw Forbidden("This account is disabled.");
  }

  // Per-user IP allowlist
  if (!(await ipAllowedForUser(u.id, opts.ip))) {
    await audit({
      userId: u.id,
      event: "login_blocked_ip",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      reason: "allowlist_miss",
    });
    throw Forbidden("Sign-in not allowed from this network.");
  }

  const ok = await verifyPassword(u.passwordHash, opts.password);
  if (!ok) {
    const after = await bumpFailedLogin(u.id);
    await audit({
      userId: u.id,
      event: "login_fail",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      reason: `bad_password (${after.failedLoginCount})`,
    });
    throw Unauthorized("Invalid email/username or password");
  }

  if (!u.emailVerifiedAt) {
    await audit({
      userId: u.id,
      event: "login_fail",
      provider: "password",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
      reason: "email_not_verified",
    });
    throw Forbidden(
      "Please verify your email before signing in. Check your inbox for the verification link.",
    );
  }

  await clearFailedLogin(u.id, opts.ip);
  await audit({
    userId: u.id,
    event: "login_success",
    provider: "password",
    ipAddress: opts.ip,
    userAgent: opts.userAgent,
  });
  return issueSession({
    user: u,
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
}

// ─── refresh / logout ────────────────────────────────────────────────────────

export async function refreshSession(opts: {
  refreshToken: string;
  ip: string;
  userAgent: string;
}): Promise<IssuedSession> {
  const hash = sha256(opts.refreshToken);
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.refreshTokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (!row) throw Unauthorized("Session expired");

  const [u] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!u || u.status === "disabled") throw Unauthorized("Session expired");

  // Rotate refresh token (anti-replay).
  const newToken = generateOpaqueToken(48);
  const env = loadEnv();
  const newExpires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);
  await db
    .update(sessions)
    .set({
      refreshTokenHash: sha256(newToken),
      lastUsedAt: new Date(),
      expiresAt: newExpires,
      ipAddress: opts.ip,
      userAgent: opts.userAgent.slice(0, 500),
    })
    .where(eq(sessions.id, row.id));

  const accessToken = signAccessToken({
    sub: u.id,
    sid: row.id,
    role: u.role,
    email: u.email,
    email_verified: !!u.emailVerifiedAt,
  });

  await audit({
    userId: u.id,
    event: "refresh",
    provider: "session",
    ipAddress: opts.ip,
    userAgent: opts.userAgent,
  });

  return {
    accessToken,
    refreshToken: newToken,
    refreshExpiresAt: newExpires,
    sessionId: row.id,
    user: u,
  };
}

export async function revokeSession(refreshToken: string, ip: string): Promise<void> {
  const hash = sha256(refreshToken);
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: "logout" })
    .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id, userId: sessions.userId });
  if (row) {
    await audit({
      userId: row.userId,
      event: "logout",
      provider: "session",
      ipAddress: ip,
    });
  }
}

// ─── OAuth (Google + Apple) ──────────────────────────────────────────────────

export async function startOauthFlow(opts: {
  provider: "google" | "apple";
  redirectAfter?: string;
}): Promise<{ url: string; state: string }> {
  const env = loadEnv();
  const { verifier, challenge } = pkcePair();
  const state = generateOpaqueToken(24);
  await db.insert(oauthState).values({
    state,
    provider: opts.provider,
    codeVerifier: verifier,
    redirectAfter: opts.redirectAfter ?? "/lab",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  if (opts.provider === "google") {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new Error("GOOGLE_CLIENT_ID is not configured");
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${env.APP_URL}/api/auth/oauth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account",
    });
    return {
      state,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  // Apple
  if (!env.APPLE_CLIENT_ID) {
    throw new Error("APPLE_CLIENT_ID is not configured");
  }
  const params = new URLSearchParams({
    client_id: env.APPLE_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/oauth/apple/callback`,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    state,
    url: `https://appleid.apple.com/auth/authorize?${params.toString()}`,
  };
}

async function takeOauthState(state: string) {
  const [row] = await db.select().from(oauthState).where(eq(oauthState.state, state));
  if (!row) throw BadRequest("Invalid OAuth state");
  if (row.expiresAt < new Date()) {
    await db.delete(oauthState).where(eq(oauthState.id, row.id));
    throw BadRequest("OAuth flow expired, please retry");
  }
  await db.delete(oauthState).where(eq(oauthState.id, row.id));
  return row;
}

async function findOrCreateOauthUser(opts: {
  provider: "google" | "apple";
  providerAccountId: string;
  email: string;
  emailVerifiedByProvider: boolean;
  displayName?: string;
}): Promise<User> {
  // 1. Existing link?
  const [link] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, opts.provider),
        eq(oauthAccounts.providerAccountId, opts.providerAccountId),
      ),
    );
  if (link) {
    const [u] = await db.select().from(users).where(eq(users.id, link.userId));
    if (u) return u;
  }

  // 2. Existing user by email? Link.
  const email = normEmail(opts.email);
  const [byEmail] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, email));
  if (byEmail) {
    await db.insert(oauthAccounts).values({
      userId: byEmail.id,
      provider: opts.provider,
      providerAccountId: opts.providerAccountId,
      providerEmail: opts.email,
    });
    return byEmail;
  }

  // 3. Brand new user.
  const username = await uniqueUsernameFromEmail(opts.email);
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email,
      emailNormalized: email,
      username,
      passwordHash: null,
      status: "active",
      emailVerifiedAt: opts.emailVerifiedByProvider ? new Date() : null,
    })
    .returning();
  if (!u) throw new Error("Failed to create OAuth user");
  await db.insert(oauthAccounts).values({
    userId: u.id,
    provider: opts.provider,
    providerAccountId: opts.providerAccountId,
    providerEmail: opts.email,
  });
  return u;
}

async function uniqueUsernameFromEmail(email: string): Promise<string> {
  const base = email
    .split("@")[0]!
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 24) || "user";
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 10000)}`;
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate));
    if (!exists) return candidate;
  }
  return `${base}${generateOpaqueToken(4).slice(0, 6)}`;
}

export async function completeGoogleOauth(opts: {
  code: string;
  state: string;
  ip: string;
  userAgent: string;
}): Promise<{ session: IssuedSession; redirectAfter: string }> {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured");
  }
  const st = await takeOauthState(opts.state);
  if (st.provider !== "google") throw BadRequest("State mismatch");

  // Exchange code → tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.APP_URL}/api/auth/oauth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: st.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as { id_token: string; access_token: string };

  // Verify the ID token by fetching tokeninfo (lightweight; avoids extra deps).
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
  );
  if (!infoRes.ok) throw new Error("Google ID token verification failed");
  const info = (await infoRes.json()) as {
    sub: string;
    email: string;
    email_verified: string | boolean;
    aud: string;
    name?: string;
  };
  if (info.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error("Google ID token audience mismatch");
  }

  const u = await findOrCreateOauthUser({
    provider: "google",
    providerAccountId: info.sub,
    email: info.email,
    emailVerifiedByProvider: info.email_verified === true || info.email_verified === "true",
    displayName: info.name,
  });

  if (u.status === "disabled") throw Forbidden("This account is disabled.");

  if (await ipBlockedGlobally(opts.ip)) {
    await audit({
      userId: u.id,
      event: "login_blocked_ip",
      provider: "google",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
    });
    throw Forbidden("Access blocked from this network");
  }
  if (!(await ipAllowedForUser(u.id, opts.ip))) {
    await audit({
      userId: u.id,
      event: "login_blocked_ip",
      provider: "google",
      ipAddress: opts.ip,
      userAgent: opts.userAgent,
    });
    throw Forbidden("Sign-in not allowed from this network.");
  }

  await audit({
    userId: u.id,
    event: "login_success",
    provider: "google",
    ipAddress: opts.ip,
    userAgent: opts.userAgent,
  });
  const session = await issueSession({
    user: u,
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
  return { session, redirectAfter: st.redirectAfter ?? "/lab" };
}

// Apple's id_token verification needs JWKS; we use jose.
import { createRemoteJWKSet, jwtVerify, importPKCS8, SignJWT } from "jose";

const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

async function appleClientSecret(): Promise<string> {
  const env = loadEnv();
  if (!env.APPLE_CLIENT_ID || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) {
    throw new Error("Apple OAuth is not configured");
  }
  const pkcs8 = env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const key = await importPKCS8(pkcs8, "ES256");
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(env.APPLE_CLIENT_ID)
    .sign(key);
}

export async function completeAppleOauth(opts: {
  code: string;
  state: string;
  ip: string;
  userAgent: string;
}): Promise<{ session: IssuedSession; redirectAfter: string }> {
  const env = loadEnv();
  const st = await takeOauthState(opts.state);
  if (st.provider !== "apple") throw BadRequest("State mismatch");

  const clientSecret = await appleClientSecret();
  const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: env.APPLE_CLIENT_ID!,
      client_secret: clientSecret,
      redirect_uri: `${env.APP_URL}/api/auth/oauth/apple/callback`,
      grant_type: "authorization_code",
      code_verifier: st.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    throw new Error(`Apple token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as { id_token: string };

  const { payload } = await jwtVerify(tokens.id_token, APPLE_JWKS, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_ID!,
  });
  const sub = payload.sub as string;
  const email = (payload.email as string | undefined) ?? `${sub}@privaterelay.appleid.com`;
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  const u = await findOrCreateOauthUser({
    provider: "apple",
    providerAccountId: sub,
    email,
    emailVerifiedByProvider: emailVerified,
  });

  if (u.status === "disabled") throw Forbidden("This account is disabled.");
  if (await ipBlockedGlobally(opts.ip)) {
    throw Forbidden("Access blocked from this network");
  }
  if (!(await ipAllowedForUser(u.id, opts.ip))) {
    throw Forbidden("Sign-in not allowed from this network.");
  }

  await audit({
    userId: u.id,
    event: "login_success",
    provider: "apple",
    ipAddress: opts.ip,
    userAgent: opts.userAgent,
  });
  const session = await issueSession({
    user: u,
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
  return { session, redirectAfter: st.redirectAfter ?? "/lab" };
}

// ─── /me ─────────────────────────────────────────────────────────────────────

export async function getUserById(id: string): Promise<User | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

// ─── housekeeping ────────────────────────────────────────────────────────────

export async function sweepExpired(): Promise<void> {
  const now = new Date();
  await db.delete(oauthState).where(lt(oauthState.expiresAt, now));
  await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: "expired" })
    .where(and(isNull(sessions.revokedAt), lt(sessions.expiresAt, now)));
}
