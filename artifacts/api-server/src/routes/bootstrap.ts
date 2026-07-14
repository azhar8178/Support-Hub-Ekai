/**
 * Bootstrap admin endpoint — creates the very first admin invite without
 * requiring an existing authenticated session.
 *
 * Two-layer protection:
 *  1. A one-time in-memory token generated at server startup (logged to the
 *     console — visible only to someone with log/shell access to this server).
 *  2. Self-gating: once any admin user has completed sign-in via Clerk
 *     (their row has clerkUserId set), the endpoint permanently returns 404.
 *
 * The token is never written to disk or committed to source control.
 * It regenerates on every server restart.
 *
 * Usage (operator reads token from server logs, then):
 *   curl -s -X POST https://<host>/api/bootstrap-admin \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"you@yourcompany.com","bootstrapToken":"<token-from-logs>"}'
 *
 * Or via the CLI script (no token required — shell access is itself the auth):
 *   pnpm --filter @workspace/api-server run bootstrap-admin -- --email you@yourcompany.com
 */

import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { db, invitesTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

// Generated once per server process — never persisted to disk or env.
export const BOOTSTRAP_TOKEN = randomBytes(24).toString("base64url");

const router: IRouter = Router();

router.post("/bootstrap-admin", async (req, res): Promise<void> => {
  // Layer 1 (self-gate): permanently disabled once an admin has signed in.
  const [signedInAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.clerkUserId)))
    .limit(1);

  if (signedInAdmin) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  // Layer 2 (bootstrap token): caller must supply the in-memory token.
  const { email, bootstrapToken } = req.body as {
    email?: unknown;
    bootstrapToken?: unknown;
  };

  if (!bootstrapToken || bootstrapToken !== BOOTSTRAP_TOKEN) {
    // Log the current token so the legitimate operator can find it in logs.
    logger.warn(
      { bootstrapToken: BOOTSTRAP_TOKEN },
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

  // Upsert the user row so the invite FK is satisfied and the email is
  // pre-registered as admin. Promote if the row already exists.
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

  // Issue a fresh invite token.
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
      "Admin invite created. Visit the invite URL to complete sign-up. " +
      "This endpoint disables itself once you sign in.",
    email: normalizedEmail,
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
  });
});

export default router;
