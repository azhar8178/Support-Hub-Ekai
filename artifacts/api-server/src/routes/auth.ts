import { Router, type IRouter } from "express";
import { db, invitesTable, organisationsTable, usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  AcceptInviteBody,
  GetCurrentUserResponse,
  PreviewInviteResponse,
} from "@workspace/api-zod";
import { requireAuth, resolvePortalUser } from "../middlewares/requireAuth";
import { serializeUser } from "../lib/serializers";

const AUTH_MODE = process.env.AUTH_MODE ?? "clerk";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/auth/me — works for both auth modes
// ---------------------------------------------------------------------------

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  let orgName: string | null = null;
  if (user.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, user.orgId));
    orgName = org?.name ?? null;
  }
  res.json(GetCurrentUserResponse.parse(serializeUser(user, orgName)));
});

// ---------------------------------------------------------------------------
// POST /api/auth/wizard-dismissed — mark the setup wizard as dismissed
// ---------------------------------------------------------------------------

router.post("/auth/wizard-dismissed", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const [updated] = await db
    .update(usersTable)
    .set({ setupWizardDismissed: true })
    .where(eq(usersTable.id, user.id))
    .returning();
  let orgName: string | null = null;
  if (updated && updated.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, updated.orgId));
    orgName = org?.name ?? null;
  }
  res.json(GetCurrentUserResponse.parse(serializeUser(updated ?? user, orgName)));
});

// ---------------------------------------------------------------------------
// Local auth mode: login + logout
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/login
 * Body: { email: string; password: string }
 * Sets an HttpOnly session cookie on success.
 */
router.post("/auth/login", async (req, res): Promise<void> => {
  if (AUTH_MODE !== "local") {
    res.status(404).json({ message: "Not found" });
    return;
  }

  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user || !user.passwordHash) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  if (!user.active) {
    res.status(403).json({ message: "Your account has been deactivated.", code: "deactivated" });
    return;
  }

  // Verify password — lazy import so bcryptjs is not loaded in clerk mode
  const bcrypt = await import("bcryptjs");
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  // Establish session
  req.session.userId = user.id;
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  let orgName: string | null = null;
  if (user.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, user.orgId));
    orgName = org?.name ?? null;
  }

  res.json(GetCurrentUserResponse.parse(serializeUser(user, orgName)));
});

/**
 * POST /api/auth/logout
 * Destroys the session cookie.
 */
router.post("/auth/logout", (req, res): void => {
  if (AUTH_MODE !== "local") {
    res.status(404).json({ message: "Not found" });
    return;
  }
  req.session.destroy(() => {
    res.clearCookie("ekai_session");
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Clerk-only routes: invite preview + accept
// ---------------------------------------------------------------------------

router.get("/invites/preview", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.status(400).json({ message: "Missing invite token" });
    return;
  }
  const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.token, token));
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()) {
    res.status(400).json({ message: "This invite link is invalid or has expired." });
    return;
  }
  let orgName: string | null = null;
  if (invite.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, invite.orgId));
    orgName = org?.name ?? null;
  }
  res.json(
    PreviewInviteResponse.parse({
      email: invite.email,
      role: invite.role,
      orgName,
      expiresAt: invite.expiresAt.toISOString(),
    }),
  );
});

/**
 * POST /api/invites/accept-local
 * Local-auth-mode only.  Creates a new portal user from an invite (or links an
 * existing one) and starts a session — all in one step.
 * Body: { token: string; name?: string; password: string }
 */
router.post("/invites/accept-local", async (req, res): Promise<void> => {
  if (AUTH_MODE !== "local") {
    res.status(404).json({ message: "Not found" });
    return;
  }

  const { token, name, password } = req.body as {
    token?: unknown;
    name?: unknown;
    password?: unknown;
  };

  if (!token || typeof token !== "string") {
    res.status(400).json({ message: "Missing invite token." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters." });
    return;
  }

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.token, token), isNull(invitesTable.usedAt)));

  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) {
    res.status(400).json({ message: "This invite link is invalid or has expired." });
    return;
  }

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 12);
  const email = invite.email.toLowerCase();
  const displayName =
    typeof name === "string" && name.trim()
      ? name.trim()
      : email.split("@")[0]!;

  // Create user or update existing one (e.g. pre-seeded agent/admin)
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  let user;
  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({
        passwordHash,
        role: invite.role as (typeof usersTable.$inferInsert)["role"],
        orgId: invite.orgId,
        active: true,
        name: existing.name || displayName,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
    user = updated!;
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email,
        name: displayName,
        passwordHash,
        role: invite.role as (typeof usersTable.$inferInsert)["role"],
        orgId: invite.orgId,
        active: true,
        lastLogin: new Date(),
      })
      .returning();
    user = created!;
  }

  await db.update(invitesTable).set({ usedAt: new Date() }).where(eq(invitesTable.id, invite.id));

  // Start session so the client is immediately authenticated
  req.session.userId = user.id;
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  let orgName: string | null = null;
  if (user.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, user.orgId));
    orgName = org?.name ?? null;
  }
  res.json(GetCurrentUserResponse.parse(serializeUser(user, orgName)));
});

router.post("/invites/accept", async (req, res): Promise<void> => {
  if (AUTH_MODE !== "clerk") {
    res.status(404).json({ message: "Not found" });
    return;
  }

  const { getAuth, clerkClient } = await import("@clerk/express");
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ message: "Sign in first, then accept the invite." });
    return;
  }
  const parsed = AcceptInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.token, parsed.data.token), isNull(invitesTable.usedAt)));
  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) {
    res.status(400).json({ message: "This invite link is invalid or has expired." });
    return;
  }

  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const email = (
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    ""
  ).toLowerCase();

  if (email !== invite.email.toLowerCase()) {
    res.status(400).json({
      message: `This invite was issued for ${invite.email}. You are signed in as ${email}.`,
    });
    return;
  }

  // If the user already exists (e.g. seeded), just link; otherwise create.
  const existing = await resolvePortalUser(req);
  let user = existing;
  if (!user) {
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email.split("@")[0]!;
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkUserId: auth.userId,
        email,
        name,
        role: invite.role,
        orgId: invite.orgId,
        active: true,
        lastLogin: new Date(),
      })
      .returning();
    user = created!;
  }

  await db.update(invitesTable).set({ usedAt: new Date() }).where(eq(invitesTable.id, invite.id));

  let orgName: string | null = null;
  if (user.orgId != null) {
    const [org] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, user.orgId));
    orgName = org?.name ?? null;
  }
  res.json(GetCurrentUserResponse.parse(serializeUser(user, orgName)));
});

export default router;
