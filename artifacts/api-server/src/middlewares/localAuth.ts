/**
 * Local (password-based) authentication middleware.
 *
 * Used when AUTH_MODE=local. Provides express-session backed by PostgreSQL
 * so sessions survive server restarts. bcryptjs handles password comparison.
 *
 * Session table (`session`) is created automatically by connect-pg-simple on
 * first startup — no manual migration needed.
 */
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { RequestHandler } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Augment the session type so TypeScript knows about our userId field.
declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

/**
 * Build and return the session middleware. Call once in app.ts and mount it
 * before any routes that need the session.
 */
export function createSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required when AUTH_MODE=local. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const PgStore = connectPg(session);
  return session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // In production, cookies must be sent over HTTPS only.
      // When behind a reverse proxy (nginx/Caddy) set trust proxy too.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    name: "ekai_session",
  });
}

/** requireAuth equivalent for local auth mode. */
export const requireLocalAuth: RequestHandler = async (req, res, next): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ message: "Not signed in" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ message: "Session expired — please sign in again." });
    return;
  }
  if (!user.active) {
    res.status(403).json({ message: "Your account has been deactivated.", code: "deactivated" });
    return;
  }

  req.portalUser = user;
  next();
};
