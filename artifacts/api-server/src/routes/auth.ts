import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, invitesTable, organisationsTable, usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  AcceptInviteBody,
  GetCurrentUserResponse,
  PreviewInviteResponse,
} from "@workspace/api-zod";
import { requireAuth, resolvePortalUser } from "../middlewares/requireAuth";
import { serializeUser } from "../lib/serializers";

const router: IRouter = Router();

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

router.get("/invites/preview", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.status(400).json({ message: "Missing invite token" });
    return;
  }
  const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.token, token));
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
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

router.post("/invites/accept", async (req, res): Promise<void> => {
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
  if (!invite || invite.expiresAt < new Date()) {
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
