/**
 * Auth middleware — verifies Bearer access token + checks the session is still alive.
 * If the access token is valid but the session was revoked (logout, password reset,
 * single-device kick), we 401 immediately.
 */
import type { RequestHandler } from "express";
import { db, sessions, users } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Forbidden, Unauthorized } from "../lib/errors.js";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        emailVerified: boolean;
        sessionId: string;
      };
    }
  }
}

function readBearer(req: any): string | null {
  const h = req.headers["authorization"];
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]! : null;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = readBearer(req);
    if (!token) throw Unauthorized();
    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw Unauthorized("Invalid or expired access token");
    }

    // Confirm the session is still alive (revocation check).
    const [s] = await db
      .select({ id: sessions.id, userId: sessions.userId, revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, payload.sid),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    if (!s) throw Unauthorized("Session no longer valid");

    const [u] = await db.select().from(users).where(eq(users.id, payload.sub));
    if (!u || u.status === "disabled") throw Unauthorized("Account disabled");

    req.user = {
      id: u.id,
      email: u.email,
      role: u.role,
      emailVerified: !!u.emailVerifiedAt,
      sessionId: s.id,
    };
    next();
  } catch (e) {
    next(e);
  }
};

export const requireEmailVerified: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(Unauthorized());
  if (!req.user.emailVerified) return next(Forbidden("Email not verified"));
  next();
};

export const requireRole =
  (role: "admin"): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(Unauthorized());
    if (req.user.role !== role) return next(Forbidden("Insufficient role"));
    next();
  };
