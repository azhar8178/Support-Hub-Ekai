/**
 * Local (password-based) authentication middleware.
 *
 * Used when AUTH_MODE=local. Provides express-session backed by PostgreSQL
 * so sessions survive server restarts. bcryptjs handles password comparison.
 *
 * connect-pg-simple's `createTableIfMissing` reads a .sql file at runtime
 * which esbuild does not copy to dist/. We create the session table ourselves
 * using the shared pg.Pool before handing the pool to the store.
 */
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { RequestHandler } from "express";
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Augment the session type so TypeScript knows about our userId field.
declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

/** Create the session table if it doesn't already exist. */
async function ensureSessionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid"    varchar        NOT NULL COLLATE "default",
      "sess"   json           NOT NULL,
      "expire" timestamp(6)   NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);
}

/**
 * Build and return the session middleware. Call once in app.ts and mount it
 * before any routes that need the session.
 */
export async function createSessionMiddleware(): Promise<RequestHandler> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required when AUTH_MODE=local. " +
        "Generate one with: openssl rand -hex 32",
    );
  }

  // Ensure the session table exists before connect-pg-simple tries to use it.
  await ensureSessionTable();

  const PgStore = connectPg(session);
  return session({
    store: new PgStore({
      // Pass the shared pool directly — avoids connect-pg-simple trying to
      // open its bundled table.sql file which esbuild strips from dist/.
      pool,
      tableName: "session",
      // Do NOT pass createTableIfMissing — we created the table above.
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Enable secure (HTTPS-only) cookies when:
      //   - Running in production mode, AND
      //   - PORTAL_URL is configured with https:// (meaning HTTPS is actually
      //     available). This prevents the cookie being silently dropped in
      //     self-hosted setups that use plain HTTP (e.g. accessed directly on
      //     a non-standard port without a TLS-terminating proxy in front).
      // If PORTAL_URL is not set, default to secure in production (safe default).
      secure:
        process.env.NODE_ENV === "production" &&
        (process.env.PORTAL_URL
          ? process.env.PORTAL_URL.startsWith("https://")
          : true),
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
