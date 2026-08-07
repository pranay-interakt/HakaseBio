import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  inet,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * users — canonical account record.
 * `email_verified_at` is null until the verification link is consumed.
 * `password_hash` is null only for OAuth-only accounts.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    username: text("username").notNull(),
    title: text("title"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    passwordHash: text("password_hash"),
    // Account state machine
    status: text("status").notNull().default("active"), // active | locked | disabled | pending_verification
    role: text("role").notNull().default("user"), // user | admin
    // Lockout / brute-force
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    // Last activity
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    lastLoginIp: inet("last_login_ip"),
    // MFA
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    // Audit
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    emailNormalizedUx: uniqueIndex("users_email_normalized_ux").on(
      t.emailNormalized,
    ),
    usernameUx: uniqueIndex("users_username_ux").on(t.username),
    statusIx: index("users_status_ix").on(t.status),
  }),
);

/**
 * oauth_accounts — federated identities (google, apple).
 * Composite uniqueness: (provider, provider_account_id).
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'google' | 'apple'
    providerAccountId: text("provider_account_id").notNull(),
    providerEmail: text("provider_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    providerUx: uniqueIndex("oauth_accounts_provider_ux").on(
      t.provider,
      t.providerAccountId,
    ),
    userIx: index("oauth_accounts_user_ix").on(t.userId),
  }),
);

/**
 * sessions — opaque refresh-token bearer records.
 * Single-device enforcement is implemented by revoking all prior sessions
 * for the user when a new one is created (see auth/service.ts).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // refresh token is stored hashed (sha256). The plaintext only ever lives
    // in the http-only cookie on the user's device.
    refreshTokenHash: text("refresh_token_hash").notNull(),
    deviceFingerprint: text("device_fingerprint"),
    userAgent: text("user_agent"),
    ipAddress: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => ({
    refreshHashUx: uniqueIndex("sessions_refresh_hash_ux").on(t.refreshTokenHash),
    userIx: index("sessions_user_ix").on(t.userId),
    expiresIx: index("sessions_expires_ix").on(t.expiresAt),
  }),
);

/**
 * email_verification_tokens — one-shot tokens for verifying email ownership.
 * Token plaintext is only emailed; we store sha256(token).
 */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tokenUx: uniqueIndex("evt_token_ux").on(t.tokenHash),
    userIx: index("evt_user_ix").on(t.userId),
  }),
);

/**
 * password_reset_tokens — short-lived, single-use.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedFromIp: inet("requested_from_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tokenUx: uniqueIndex("prt_token_ux").on(t.tokenHash),
    userIx: index("prt_user_ix").on(t.userId),
  }),
);

/**
 * login_audit — every authentication outcome, success or failure.
 * Used for security analytics, anomaly detection, and user-visible
 * "recent sign-ins" lists.
 */
export const loginAudit = pgTable(
  "login_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    emailAttempt: text("email_attempt"),
    event: text("event").notNull(), // login_success | login_fail | login_blocked_ip | login_blocked_lockout | logout | refresh | password_reset | email_verified | oauth_link
    provider: text("provider"), // password | google | apple
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIx: index("login_audit_user_ix").on(t.userId),
    eventIx: index("login_audit_event_ix").on(t.event),
    createdIx: index("login_audit_created_ix").on(t.createdAt),
  }),
);

/**
 * ip_allowlist — global or per-user IP restrictions.
 * If a user_id has any ip_allowlist row, only those CIDRs may log in for that user.
 * If user_id is null, the entry is a global allow (admin-managed) for the whole app.
 * Empty table = no IP restriction (default).
 */
export const ipAllowlist = pgTable(
  "ip_allowlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    cidr: text("cidr").notNull(), // e.g. "203.0.113.0/24" or "203.0.113.42/32"
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIx: index("ipallow_user_ix").on(t.userId),
  }),
);

/**
 * ip_blocklist — bans by CIDR, e.g. after repeated abuse from a host.
 */
export const ipBlocklist = pgTable(
  "ip_blocklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cidr: text("cidr").notNull().unique(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
);

/**
 * oauth_state — short-lived nonce table for OAuth `state` + PKCE `code_verifier`.
 * Cleaned up by a periodic sweep; entries auto-expire after 10 minutes.
 */
export const oauthState = pgTable(
  "oauth_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull().unique(),
    provider: text("provider").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    redirectAfter: text("redirect_after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
);

/**
 * api_keys — per-user programmatic access tokens, scoped, revocable.
 * Hashed at rest. Only the user sees the plaintext once at creation.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // first 8 chars, shown in UI
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    keyHashUx: uniqueIndex("api_keys_hash_ux").on(t.keyHash),
    userIx: index("api_keys_user_ix").on(t.userId),
  }),
);

// ─── zod schemas / types ─────────────────────────────────────────────────────
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Session = typeof sessions.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type LoginAuditRow = typeof loginAudit.$inferSelect;
export type IpAllowlistRow = typeof ipAllowlist.$inferSelect;
export type IpBlocklistRow = typeof ipBlocklist.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
