/**
 * Bootstrap admin endpoint — creates the very first admin account without
 * requiring an existing authenticated session.
 *
 * Three-layer protection:
 *  1. Manual disable: an admin can call POST /admin/bootstrap-rotate to set the
 *     in-memory token to null — the endpoint then returns 404 for any caller.
 *  2. A one-time in-memory token generated at server startup (logged to the
 *     console — visible only to someone with log/shell access to this server).
 *  3. Self-gating: once any admin has completed initial setup (clerkUserId set
 *     in clerk mode, or passwordHash set in local mode), the endpoint returns 404.
 *
 * The token is never written to disk or committed to source control.
 * It regenerates on every server restart.
 *
 * Clerk mode usage:
 *   curl -s -X POST https://<host>/api/bootstrap-admin \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"you@yourcompany.com","bootstrapToken":"<token-from-logs>"}'
 *   # Returns an inviteUrl — visit it to complete sign-up via Clerk.
 *
 * Local mode usage:
 *   curl -s -X POST https://<host>/api/bootstrap-admin \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"you@yourcompany.com","bootstrapToken":"<token-from-logs>"}'
 *   # Returns initialPassword — use it to sign in immediately.
 *   # Change it in Admin → Team after first login.
 *
 * Or via the CLI script (no token required — shell access is itself the auth):
 *   pnpm --filter @workspace/api-server run bootstrap-admin -- --email you@yourcompany.com
 */

import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { db, invitesTable, siteSettingsTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const AUTH_MODE = process.env.AUTH_MODE ?? "clerk";

// Generated once per server process — never persisted to disk or env.
// Mutable so admins can rotate (invalidate) it via the admin API.
// initBootstrap() will set this to null if the DB flag is already set.
let _bootstrapToken: string | null = randomBytes(24).toString("base64url");

/** Read the current bootstrap token (null = already rotated/disabled). */
export function getBootstrapToken(): string | null {
  return _bootstrapToken;
}

/**
 * Disable the in-memory bootstrap token permanently (for this server process).
 * After calling this, `/bootstrap-admin` returns 404 for any caller regardless
 * of what token they supply — the endpoint is completely locked down until the
 * next server restart.
 * Returns the old token value so the caller can log it if needed.
 */
export function rotateBootstrapToken(): string | null {
  const old = _bootstrapToken;
  _bootstrapToken = null; // null = permanently disabled this session
  return old;
}

/**
 * Check the DB bootstrapDisabled flag at startup.
 * If it is set, silently null out the in-memory token so the endpoint never
 * becomes active again — even after a server restart or redeployment.
 * Call this once, early in the startup sequence, before logging the token.
 */
export async function initBootstrap(): Promise<void> {
  try {
    const [row] = await db
      .select({ bootstrapDisabled: siteSettingsTable.bootstrapDisabled })
      .from(siteSettingsTable)
      .limit(1);
    if (row?.bootstrapDisabled) {
      _bootstrapToken = null;
      logger.info("bootstrap: disabled flag found in DB — endpoint suppressed");
    }
  } catch (err) {
    // Non-fatal: if the DB is not yet migrated (column doesn't exist yet), keep
    // the token active. The admin can rotate manually and the column will appear
    // after the next drizzle push.
    logger.warn({ err }, "bootstrap: could not read bootstrapDisabled flag — proceeding with active token");
  }
}

/**
 * Persist the bootstrapDisabled flag to the DB so the decision survives
 * server restarts and redeployments. Call this immediately after
 * rotateBootstrapToken() succeeds.
 */
export async function persistBootstrapDisabled(): Promise<void> {
  await db
    .insert(siteSettingsTable)
    .values({ id: 1, bootstrapDisabled: true })
    .onConflictDoUpdate({
      target: siteSettingsTable.id,
      set: { bootstrapDisabled: true, updatedAt: new Date() },
    });
}

const router: IRouter = Router();

router.post("/bootstrap-admin", async (req, res): Promise<void> => {
  // -------------------------------------------------------------------------
  // Layer 1a (manual disable): check both the in-memory flag AND the persisted
  // DB flag so that rotation survives server restarts / redeployments even if
  // initBootstrap() hasn't completed yet (e.g. very early requests).
  // -------------------------------------------------------------------------
  const currentToken = getBootstrapToken();
  if (currentToken === null) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  // Belt-and-suspenders: also check the persisted DB flag directly.
  try {
    const [settings] = await db
      .select({ bootstrapDisabled: siteSettingsTable.bootstrapDisabled })
      .from(siteSettingsTable)
      .limit(1);
    if (settings?.bootstrapDisabled) {
      _bootstrapToken = null; // sync the in-memory state
      res.status(404).json({ message: "Not found" });
      return;
    }
  } catch {
    // If the column doesn't exist yet (pre-migration), fall through to the
    // other protection layers (self-gate and token check).
  }

  // -------------------------------------------------------------------------
  // Layer 1b (self-gate): permanently disabled once an admin has completed setup.
  //
  //   Clerk mode: any admin whose clerkUserId is set (i.e. has signed in).
  //   Local mode: any admin whose passwordHash is set (i.e. bootstrap ran before).
  // -------------------------------------------------------------------------
  const setupCondition =
    AUTH_MODE === "local"
      ? and(eq(usersTable.role, "admin"), isNotNull(usersTable.passwordHash))
      : and(eq(usersTable.role, "admin"), isNotNull(usersTable.clerkUserId));

  const [setupAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(setupCondition)
    .limit(1);

  if (setupAdmin) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  // -------------------------------------------------------------------------
  // Layer 2 (bootstrap token): caller must supply the in-memory token.
  // -------------------------------------------------------------------------
  const { email, bootstrapToken } = req.body as {
    email?: unknown;
    bootstrapToken?: unknown;
  };

  if (!bootstrapToken || bootstrapToken !== currentToken) {
    // Log the current token so the legitimate operator can find it in logs.
    logger.warn(
      { bootstrapToken: currentToken },
      "bootstrap: invalid token supplied — use the token above to authorize",
    );
    res
      .status(401)
      .json({ message: "Invalid bootstrap token. Check server logs for the current token." });
    return;
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ message: "A valid email address is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // -------------------------------------------------------------------------
  // Upsert admin user
  // -------------------------------------------------------------------------
  let userId: number;
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (existing) {
    userId = existing.id;
    if (existing.role !== "admin") {
      await db
        .update(usersTable)
        .set({ role: "admin", active: true })
        .where(eq(usersTable.id, existing.id));
      logger.info({ email: normalizedEmail }, "bootstrap: promoted existing user to admin");
    } else {
      logger.info({ email: normalizedEmail }, "bootstrap: user already has admin role");
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        name: normalizedEmail.split("@")[0]!,
        role: "admin",
        active: true,
      })
      .returning();
    userId = created!.id;
    logger.info({ email: normalizedEmail, userId }, "bootstrap: created admin user");
  }

  // -------------------------------------------------------------------------
  // Auth-mode-specific: set password (local) or issue invite (clerk)
  // -------------------------------------------------------------------------
  if (AUTH_MODE === "local") {
    // Generate a secure random initial password, hash it, store it.
    const initialPassword = randomBytes(12).toString("base64url");
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(initialPassword, 12);

    await db
      .update(usersTable)
      .set({ passwordHash, active: true })
      .where(eq(usersTable.id, userId));

    const portalUrl = (process.env.PORTAL_URL ?? "").replace(/\/$/, "");
    const loginUrl = portalUrl || "/";

    logger.info(
      { email: normalizedEmail, initialPassword },
      "bootstrap: admin created — SAVE THIS PASSWORD, it is shown only once",
    );

    res.json({
      message:
        "Admin account created. Use the initial password below to sign in. " +
        "This endpoint disables itself after you sign in and set a new password.",
      email: normalizedEmail,
      initialPassword,
      loginUrl,
    });
  } else {
    // Clerk mode: issue an invite token the admin must accept via the portal.
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 24 * 3_600_000);

    await db.insert(invitesTable).values({
      email: normalizedEmail,
      role: "admin",
      token,
      expiresAt,
      createdById: userId,
    });

    const portalUrl = (process.env.PORTAL_URL ?? "").replace(/\/$/, "");
    const invitePath = `/accept-invite?token=${token}`;
    const inviteUrl = portalUrl ? `${portalUrl}${invitePath}` : invitePath;

    logger.info({ email: normalizedEmail }, "bootstrap: admin invite created");

    res.json({
      message:
        "Admin invite created. Visit the invite URL to complete sign-up via Clerk. " +
        "This endpoint disables itself once you sign in.",
      email: normalizedEmail,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
    });
  }
});

export default router;
