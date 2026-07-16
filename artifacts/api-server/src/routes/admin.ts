import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  invitesTable,
  kbArticlesTable,
  kbSearchLogTable,
  kbSuggestionEventsTable,
  organisationsTable,
  siteSettingsTable,
  slaConfigTable,
  ticketCategoriesTable,
  ticketEnvironmentsTable,
  ticketsTable,
  usersTable,
  type SlaConfig,
  type TicketCategoryRow,
  type TicketEnvironmentRow,
  type UserRole,
} from "@workspace/db";
const AUTH_MODE = process.env.AUTH_MODE ?? "clerk";
import { and, asc, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  CreateCategoryBody,
  CreateCategoryResponse,
  CreateEnvironmentBody,
  CreateEnvironmentResponse,
  CreateInviteBody,
  CreateInviteResponse,
  CreateOrgBody,
  CreateOrgResponse,
  CreateSeverityBody,
  CreateSeverityResponse,
  GetKbDeflectionStatsResponse,
  GetReportsResponse,
  GetTaxonomyUsageParams,
  GetTaxonomyUsageResponse,
  ListCategoriesResponse,
  ListEnvironmentsResponse,
  ListInvitesResponse,
  ListOrgsResponse,
  ListSeveritiesResponse,
  ListUsersResponse,
  ResendInviteResponse,
  RevokeInviteResponse,
  UpdateCategoryBody,
  UpdateCategoryResponse,
  UpdateEnvironmentBody,
  UpdateEnvironmentResponse,
  UpdateOrgBody,
  UpdateOrgResponse,
  UpdateSeverityBody,
  UpdateSeverityResponse,
  UpdateUserBody,
  UpdateUserResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { serializeUser } from "../lib/serializers";
import { notifyUsers } from "../lib/notify";
import { sendEmail, inviteEmail } from "../lib/email";
import { refreshSlaClockCache } from "../lib/sla";
import { logger } from "../lib/logger";
import { getBootstrapToken, rotateBootstrapToken, persistBootstrapDisabled } from "./bootstrap";

const router: IRouter = Router();

function parseId(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return parseInt(raw ?? "", 10);
}

router.get("/admin/users", requireAuth, requireRole("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({ user: usersTable, org: organisationsTable })
    .from(usersTable)
    .leftJoin(organisationsTable, eq(usersTable.orgId, organisationsTable.id))
    .orderBy(usersTable.name);
  res.json(ListUsersResponse.parse(rows.map((r) => serializeUser(r.user, r.org?.name ?? null))));
});

router.patch(
  "/admin/users/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    if (id === req.portalUser!.id && parsed.data.active === false) {
      res.status(400).json({ message: "You cannot deactivate your own account." });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.role !== undefined) updates.role = parsed.data.role;
    if (parsed.data.orgId !== undefined) updates.orgId = parsed.data.orgId;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    let orgName: string | null = null;
    if (updated.orgId != null) {
      const [org] = await db
        .select()
        .from(organisationsTable)
        .where(eq(organisationsTable.id, updated.orgId));
      orgName = org?.name ?? null;
    }
    res.json(UpdateUserResponse.parse(serializeUser(updated, orgName)));
  },
);

router.post(
  "/admin/users/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    if (AUTH_MODE !== "local") {
      res.status(400).json({ message: "Password reset is only available in local auth mode." });
      return;
    }
    const id = parseId(req);
    const { password } = req.body as { password?: string };
    if (!password || typeof password !== "string" || password.length < 8) {
      res.status(400).json({ message: "Password must be at least 8 characters." });
      return;
    }
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 12);
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    if (!updated) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(204).end();
  },
);

function serializeInvite(
  invite: typeof invitesTable.$inferSelect,
  orgName: string | null,
  includeToken: boolean,
): Record<string, unknown> {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    orgId: invite.orgId,
    orgName,
    token: includeToken ? invite.token : null,
    inviteUrl: includeToken ? `/accept-invite?token=${invite.token}` : null,
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
  };
}

async function orgNameFor(orgId: number | null): Promise<string | null> {
  if (orgId == null) return null;
  const [org] = await db
    .select()
    .from(organisationsTable)
    .where(eq(organisationsTable.id, orgId));
  return org?.name ?? null;
}

router.get(
  "/admin/invites",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({ invite: invitesTable, org: organisationsTable })
      .from(invitesTable)
      .leftJoin(organisationsTable, eq(invitesTable.orgId, organisationsTable.id))
      .orderBy(desc(invitesTable.createdAt));
    // Pending invites keep their token visible so admins can re-copy the link.
    // Accepted or revoked invites hide the (now-dead) token.
    res.json(
      ListInvitesResponse.parse(
        rows.map((r) =>
          serializeInvite(
            r.invite,
            r.org?.name ?? null,
            r.invite.usedAt == null && r.invite.revokedAt == null,
          ),
        ),
      ),
    );
  },
);

router.post(
  "/admin/invites",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const email = parsed.data.email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existingUser) {
      res.status(400).json({ message: "A user with this email already exists." });
      return;
    }
    if (parsed.data.role === "customer" && parsed.data.orgId == null) {
      res.status(400).json({ message: "Customer invites must be linked to an organisation." });
      return;
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 24 * 3600_000);
    const [invite] = await db
      .insert(invitesTable)
      .values({
        email,
        role: parsed.data.role as UserRole,
        orgId: parsed.data.orgId ?? null,
        token,
        expiresAt,
        createdById: req.portalUser!.id,
      })
      .returning();

    // Send the invite email and in-app notification — both are best-effort;
    // failures must never prevent the invite from being returned to the caller.
    const inviteLink = `/accept-invite?token=${token}`;
    try {
      await sendEmail(
        await inviteEmail({
          to: email,
          inviteUrl: inviteLink,
          role: parsed.data.role,
          inviterName: req.portalUser!.name ?? "An administrator",
        }),
      );
    } catch (err) {
      logger.warn({ err, to: email }, "invite email send failed — continuing");
    }
    try {
      await notifyUsers([req.portalUser!.id], {
        type: "invite",
        title: `Invite sent to ${email}`,
        body: `Invitation link generated for ${email}. The link expires in 14 days.`,
      });
    } catch (err) {
      logger.warn({ err, adminId: req.portalUser!.id }, "invite notification failed — continuing");
    }

    let orgName: string | null = null;
    if (invite!.orgId != null) {
      const [org] = await db
        .select()
        .from(organisationsTable)
        .where(eq(organisationsTable.id, invite!.orgId));
      orgName = org?.name ?? null;
    }
    res.status(201).json(CreateInviteResponse.parse(serializeInvite(invite!, orgName, true)));
  },
);

router.get(
  "/admin/orgs",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        org: organisationsTable,
        userCount: sql<number>`count(${usersTable.id})`,
      })
      .from(organisationsTable)
      .leftJoin(usersTable, eq(usersTable.orgId, organisationsTable.id))
      .groupBy(organisationsTable.id)
      .orderBy(organisationsTable.name);
    res.json(
      ListOrgsResponse.parse(
        rows.map((r) => ({
          id: r.org.id,
          name: r.org.name,
          domain: r.org.domain,
          createdAt: r.org.createdAt.toISOString(),
          userCount: Number(r.userCount),
        })),
      ),
    );
  },
);

router.post(
  "/admin/orgs",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateOrgBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [org] = await db
      .insert(organisationsTable)
      .values({ name: parsed.data.name, domain: parsed.data.domain ?? null })
      .returning();
    res.status(201).json(
      CreateOrgResponse.parse({
        id: org!.id,
        name: org!.name,
        domain: org!.domain,
        createdAt: org!.createdAt.toISOString(),
        userCount: 0,
      }),
    );
  },
);

// --- Organisation rename ---

router.patch(
  "/admin/orgs/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateOrgBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.domain !== undefined) updates.domain = parsed.data.domain?.trim() || null;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No changes provided." });
      return;
    }
    const [org] = await db
      .update(organisationsTable)
      .set(updates)
      .where(eq(organisationsTable.id, id))
      .returning();
    if (!org) {
      res.status(404).json({ message: "Organisation not found" });
      return;
    }
    const [count] = await db
      .select({ n: sql<number>`count(*)` })
      .from(usersTable)
      .where(eq(usersTable.orgId, org.id));
    res.json(
      UpdateOrgResponse.parse({
        id: org.id,
        name: org.name,
        domain: org.domain,
        createdAt: org.createdAt.toISOString(),
        userCount: Number(count?.n ?? 0),
      }),
    );
  },
);

// --- Invite revoke / resend ---

router.post(
  "/admin/invites/:id/revoke",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.id, id));
    if (!invite) {
      res.status(404).json({ message: "Invite not found" });
      return;
    }
    if (invite.usedAt) {
      res.status(400).json({ message: "This invite has already been accepted." });
      return;
    }
    const [updated] = await db
      .update(invitesTable)
      .set({ revokedAt: new Date() })
      .where(eq(invitesTable.id, id))
      .returning();
    res.json(
      RevokeInviteResponse.parse(
        serializeInvite(updated!, await orgNameFor(updated!.orgId), false),
      ),
    );
  },
);

router.post(
  "/admin/invites/:id/resend",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.id, id));
    if (!invite) {
      res.status(404).json({ message: "Invite not found" });
      return;
    }
    if (invite.usedAt) {
      res.status(400).json({ message: "This invite has already been accepted." });
      return;
    }
    // A fresh token invalidates any previously shared link and clears revocation.
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 24 * 3600_000);
    const [updated] = await db
      .update(invitesTable)
      .set({ token, expiresAt, revokedAt: null })
      .where(eq(invitesTable.id, id))
      .returning();
    const inviteLink = `/accept-invite?token=${token}`;
    try {
      await sendEmail(
        await inviteEmail({
          to: updated!.email,
          inviteUrl: inviteLink,
          role: updated!.role,
          inviterName: req.portalUser!.name ?? "An administrator",
        }),
      );
    } catch (err) {
      logger.warn({ err, to: updated!.email }, "resend invite email failed — continuing");
    }
    res.json(
      ResendInviteResponse.parse(
        serializeInvite(updated!, await orgNameFor(updated!.orgId), true),
      ),
    );
  },
);

// --- Ticket taxonomy: categories & environments ---

function serializeTaxonomy(row: TicketCategoryRow | TicketEnvironmentRow): Record<string, unknown> {
  return { id: row.id, key: row.key, label: row.label, sortOrder: row.sortOrder, active: row.active };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
  );
}

router.get(
  "/admin/categories",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(ticketCategoriesTable)
      .orderBy(asc(ticketCategoriesTable.sortOrder), asc(ticketCategoriesTable.label));
    res.json(ListCategoriesResponse.parse(rows.map(serializeTaxonomy)));
  },
);

router.post(
  "/admin/categories",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const label = parsed.data.label.trim();
    const base = slugify(parsed.data.key ?? label);
    if (!base) {
      res.status(400).json({ message: "Enter a label with letters or numbers." });
      return;
    }
    const existing = await db.select().from(ticketCategoriesTable);
    const taken = new Set(existing.map((e) => e.key));
    if (taken.has(base) && parsed.data.key) {
      res.status(400).json({ message: `The key "${base}" is already in use.` });
      return;
    }
    const key = uniqueKey(base, taken);
    const nextSort = existing.reduce((max, e) => Math.max(max, e.sortOrder), 0) + 1;
    try {
      const [row] = await db
        .insert(ticketCategoriesTable)
        .values({ key, label, sortOrder: nextSort, active: true })
        .returning();
      res.status(201).json(CreateCategoryResponse.parse(serializeTaxonomy(row!)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ message: `The key "${key}" is already in use.` });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/admin/categories/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label.trim();
    if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No changes provided." });
      return;
    }
    const [row] = await db
      .update(ticketCategoriesTable)
      .set(updates)
      .where(eq(ticketCategoriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Category not found" });
      return;
    }
    res.json(UpdateCategoryResponse.parse(serializeTaxonomy(row)));
  },
);

router.get(
  "/admin/environments",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(ticketEnvironmentsTable)
      .orderBy(asc(ticketEnvironmentsTable.sortOrder), asc(ticketEnvironmentsTable.label));
    res.json(ListEnvironmentsResponse.parse(rows.map(serializeTaxonomy)));
  },
);

router.post(
  "/admin/environments",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateEnvironmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const label = parsed.data.label.trim();
    const base = slugify(parsed.data.key ?? label);
    if (!base) {
      res.status(400).json({ message: "Enter a label with letters or numbers." });
      return;
    }
    const existing = await db.select().from(ticketEnvironmentsTable);
    const taken = new Set(existing.map((e) => e.key));
    if (taken.has(base) && parsed.data.key) {
      res.status(400).json({ message: `The key "${base}" is already in use.` });
      return;
    }
    const key = uniqueKey(base, taken);
    const nextSort = existing.reduce((max, e) => Math.max(max, e.sortOrder), 0) + 1;
    try {
      const [row] = await db
        .insert(ticketEnvironmentsTable)
        .values({ key, label, sortOrder: nextSort, active: true })
        .returning();
      res.status(201).json(CreateEnvironmentResponse.parse(serializeTaxonomy(row!)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ message: `The key "${key}" is already in use.` });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/admin/environments/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateEnvironmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label.trim();
    if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No changes provided." });
      return;
    }
    const [row] = await db
      .update(ticketEnvironmentsTable)
      .set(updates)
      .where(eq(ticketEnvironmentsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Environment not found" });
      return;
    }
    res.json(UpdateEnvironmentResponse.parse(serializeTaxonomy(row)));
  },
);

// Tickets in these statuses are considered "closed out" and safe to ignore when
// warning about retiring a taxonomy option; everything else counts as open.
const CLOSED_OUT_STATUSES = ["resolved", "closed"] as const;

// How many open (non-resolved, non-closed) tickets still reference a taxonomy
// option, so admins can make an informed choice before retiring it.
router.get(
  "/admin/taxonomy-usage/:type/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = GetTaxonomyUsageParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const { type, id } = parsed.data;

    let key: string | undefined;
    let column;
    if (type === "category") {
      const [row] = await db
        .select()
        .from(ticketCategoriesTable)
        .where(eq(ticketCategoriesTable.id, id));
      key = row?.key;
      column = ticketsTable.category;
    } else if (type === "environment") {
      const [row] = await db
        .select()
        .from(ticketEnvironmentsTable)
        .where(eq(ticketEnvironmentsTable.id, id));
      key = row?.key;
      column = ticketsTable.environment;
    } else {
      const [row] = await db.select().from(slaConfigTable).where(eq(slaConfigTable.id, id));
      key = row?.severity;
      column = ticketsTable.severity;
    }

    if (key === undefined) {
      res.status(404).json({ message: "Taxonomy option not found" });
      return;
    }

    const [count] = await db
      .select({ n: sql<number>`count(*)` })
      .from(ticketsTable)
      .where(and(eq(column, key), notInArray(ticketsTable.status, [...CLOSED_OUT_STATUSES])));

    res.json(GetTaxonomyUsageResponse.parse({ openTicketCount: Number(count?.n ?? 0) }));
  },
);

// --- Severities (taxonomy + SLA targets) ---

function serializeSeverity(r: SlaConfig): Record<string, unknown> {
  return {
    id: r.id,
    key: r.severity,
    label: r.label,
    rank: r.rank,
    isUrgent: r.isUrgent,
    resolutionOptional: r.resolutionOptional,
    firstResponseMinutes: r.firstResponseMinutes,
    resolutionMinutes: r.resolutionMinutes,
    use24x7: r.use24x7,
    active: r.active,
  };
}

router.get(
  "/admin/severities",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(slaConfigTable).orderBy(asc(slaConfigTable.rank));
    res.json(ListSeveritiesResponse.parse(rows.map(serializeSeverity)));
  },
);

router.post(
  "/admin/severities",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateSeverityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const label = parsed.data.label.trim();
    const base = slugify(parsed.data.key ?? label);
    if (!base) {
      res.status(400).json({ message: "Enter a label with letters or numbers." });
      return;
    }
    const existing = await db.select().from(slaConfigTable);
    const taken = new Set(existing.map((e) => e.severity));
    if (taken.has(base) && parsed.data.key) {
      res.status(400).json({ message: `The key "${base}" is already in use.` });
      return;
    }
    const key = uniqueKey(base, taken);
    const nextRank =
      parsed.data.rank ?? existing.reduce((max, e) => Math.max(max, e.rank), 0) + 1;
    let row;
    try {
      [row] = await db
        .insert(slaConfigTable)
        .values({
          severity: key,
          label,
          rank: nextRank,
          isUrgent: parsed.data.isUrgent,
          resolutionOptional: parsed.data.resolutionOptional,
          firstResponseMinutes: parsed.data.firstResponseMinutes,
          resolutionMinutes: parsed.data.resolutionMinutes ?? null,
          use24x7: parsed.data.use24x7,
          active: true,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ message: `The key "${key}" is already in use.` });
        return;
      }
      throw err;
    }
    await refreshSlaClockCache();
    res.status(201).json(CreateSeverityResponse.parse(serializeSeverity(row!)));
  },
);

router.patch(
  "/admin/severities/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateSeverityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label.trim();
    if (parsed.data.rank !== undefined) updates.rank = parsed.data.rank;
    if (parsed.data.isUrgent !== undefined) updates.isUrgent = parsed.data.isUrgent;
    if (parsed.data.resolutionOptional !== undefined)
      updates.resolutionOptional = parsed.data.resolutionOptional;
    if (parsed.data.firstResponseMinutes !== undefined)
      updates.firstResponseMinutes = parsed.data.firstResponseMinutes;
    if (parsed.data.resolutionMinutes !== undefined)
      updates.resolutionMinutes = parsed.data.resolutionMinutes;
    if (parsed.data.use24x7 !== undefined) updates.use24x7 = parsed.data.use24x7;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No changes provided." });
      return;
    }
    const [row] = await db
      .update(slaConfigTable)
      .set(updates)
      .where(eq(slaConfigTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Severity not found" });
      return;
    }
    await refreshSlaClockCache();
    res.json(UpdateSeverityResponse.parse(serializeSeverity(row)));
  },
);

router.get(
  "/admin/reports",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const tickets = await db.select().from(ticketsTable);
    const now = new Date();

    // Last 8 weeks of volume.
    const weeklyVolume: Array<{ weekStart: string; created: number; resolved: number }> = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 3600_000);
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 3600_000);
      weeklyVolume.push({
        weekStart: weekStart.toISOString().slice(0, 10),
        created: tickets.filter((t) => t.createdAt >= weekStart && t.createdAt < weekEnd).length,
        resolved: tickets.filter(
          (t) => t.resolvedAt != null && t.resolvedAt >= weekStart && t.resolvedAt < weekEnd,
        ).length,
      });
    }

    const resolved = tickets.filter((t) => t.resolvedAt != null);
    const avgResolutionHours =
      resolved.length > 0
        ? Math.round(
            (resolved.reduce(
              (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600_000,
              0,
            ) /
              resolved.length) *
              10,
          ) / 10
        : null;

    const withResponseDeadline = tickets.filter(
      (t) => t.responseDeadline != null && (t.firstResponseAt != null || now > t.responseDeadline),
    );
    const responseCompliant = withResponseDeadline.filter(
      (t) => t.firstResponseAt != null && t.firstResponseAt <= t.responseDeadline!,
    );
    const slaResponseCompliancePct =
      withResponseDeadline.length > 0
        ? Math.round((responseCompliant.length / withResponseDeadline.length) * 1000) / 10
        : null;

    const withResolutionDeadline = tickets.filter(
      (t) => t.resolutionDeadline != null && (t.resolvedAt != null || now > t.resolutionDeadline),
    );
    const resolutionCompliant = withResolutionDeadline.filter(
      (t) => t.resolvedAt != null && t.resolvedAt <= t.resolutionDeadline!,
    );
    const slaResolutionCompliancePct =
      withResolutionDeadline.length > 0
        ? Math.round((resolutionCompliant.length / withResolutionDeadline.length) * 1000) / 10
        : null;

    const openStatuses = ["new", "triaged", "in_progress", "awaiting_customer"];
    res.json(
      GetReportsResponse.parse({
        weeklyVolume,
        avgResolutionHours,
        slaResponseCompliancePct,
        slaResolutionCompliancePct,
        totalTickets: tickets.length,
        openTickets: tickets.filter((t) => openStatuses.includes(t.status)).length,
      }),
    );
  },
);

// A draft is "settled" once it filed a ticket or has been inactive for 30 minutes.
const DRAFT_SETTLE_MS = 30 * 60 * 1000;

router.get(
  "/admin/kb-deflection",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const settleCutoff = new Date(Date.now() - DRAFT_SETTLE_MS);

    // Per-draft rollup done in SQL so we never load the raw event table.
    const perDraft = db
      .select({
        draftId: kbSuggestionEventsTable.draftId,
        hasImpression: sql<boolean>`bool_or(${kbSuggestionEventsTable.eventType} = 'impression')`.as(
          "has_impression",
        ),
        hasClick: sql<boolean>`bool_or(${kbSuggestionEventsTable.eventType} = 'click')`.as(
          "has_click",
        ),
        hasFiled: sql<boolean>`bool_or(${kbSuggestionEventsTable.eventType} = 'ticket_filed')`.as(
          "has_filed",
        ),
        lastEventAt: sql<Date>`max(${kbSuggestionEventsTable.createdAt})`.as("last_event_at"),
      })
      .from(kbSuggestionEventsTable)
      .groupBy(kbSuggestionEventsTable.draftId)
      .as("d");

    const [totals] = await db
      .select({
        draftsWithSuggestions: sql<number>`count(*)`,
        draftsWithClicks: sql<number>`count(*) filter (where ${perDraft.hasClick})`,
        ticketsFiledAfterSuggestions: sql<number>`count(*) filter (where ${perDraft.hasFiled})`,
        ticketsFiledAfterClick: sql<number>`count(*) filter (where ${perDraft.hasClick} and ${perDraft.hasFiled})`,
        draftsAbandonedAfterClick: sql<number>`count(*) filter (where ${perDraft.hasClick} and not ${perDraft.hasFiled} and ${perDraft.lastEventAt} < ${settleCutoff})`,
      })
      .from(perDraft)
      // ticket_filed-only drafts shouldn't happen, but be safe
      .where(sql`${perDraft.hasImpression}`);

    const draftsWithSuggestions = Number(totals?.draftsWithSuggestions ?? 0);
    const draftsWithClicks = Number(totals?.draftsWithClicks ?? 0);
    const ticketsFiledAfterSuggestions = Number(totals?.ticketsFiledAfterSuggestions ?? 0);
    const ticketsFiledAfterClick = Number(totals?.ticketsFiledAfterClick ?? 0);
    const draftsAbandonedAfterClick = Number(totals?.draftsAbandonedAfterClick ?? 0);

    const settledClicked = draftsAbandonedAfterClick + ticketsFiledAfterClick;
    const deflectionRatePct =
      settledClicked > 0
        ? Math.round((draftsAbandonedAfterClick / settledClicked) * 1000) / 10
        : null;

    // Per-article rollup: distinct drafts per event type, top 5 by clicks then impressions.
    const topRows = await db
      .select({
        articleId: kbSuggestionEventsTable.articleId,
        title: kbArticlesTable.title,
        impressions:
          sql<number>`count(distinct ${kbSuggestionEventsTable.draftId}) filter (where ${kbSuggestionEventsTable.eventType} = 'impression')`.as(
            "impressions",
          ),
        clicks:
          sql<number>`count(distinct ${kbSuggestionEventsTable.draftId}) filter (where ${kbSuggestionEventsTable.eventType} = 'click')`.as(
            "clicks",
          ),
      })
      .from(kbSuggestionEventsTable)
      .leftJoin(kbArticlesTable, eq(kbSuggestionEventsTable.articleId, kbArticlesTable.id))
      .where(
        sql`${kbSuggestionEventsTable.articleId} is not null and ${kbSuggestionEventsTable.eventType} != 'ticket_filed'`,
      )
      .groupBy(kbSuggestionEventsTable.articleId, kbArticlesTable.title)
      .orderBy(sql`clicks desc, impressions desc`)
      .limit(5);

    // Content gaps: settled drafts whose last search never led to an opened
    // article — either no suggestions appeared at all, or nobody clicked them.
    // Done in SQL against the same per-draft rollup so the raw tables never
    // get loaded into memory.
    const uncoveredRows = await db
      .select({
        queryKey: sql<string>`lower(trim(${kbSearchLogTable.query}))`.as("query_key"),
        display: sql<string>`max(trim(${kbSearchLogTable.query}))`.as("display"),
        drafts: sql<number>`count(*)`.as("drafts"),
        zeroResultDrafts:
          sql<number>`count(*) filter (where ${kbSearchLogTable.resultCount} = 0)`.as(
            "zero_result_drafts",
          ),
        lastSearchedAt: sql<string>`max(${kbSearchLogTable.updatedAt})`.as("last_searched_at"),
      })
      .from(kbSearchLogTable)
      .leftJoin(perDraft, eq(kbSearchLogTable.draftId, perDraft.draftId))
      .where(
        sql`coalesce(${perDraft.hasClick}, false) = false
            and trim(${kbSearchLogTable.query}) <> ''
            and (
              coalesce(${perDraft.hasFiled}, false)
              or greatest(
                ${kbSearchLogTable.updatedAt},
                coalesce(${perDraft.lastEventAt}, ${kbSearchLogTable.updatedAt})
              ) < ${settleCutoff}
            )`,
      )
      .groupBy(sql`query_key`)
      .orderBy(sql`drafts desc, zero_result_drafts desc, last_searched_at desc`)
      .limit(10);

    const uncoveredQueries = uncoveredRows.map((r) => ({
      query: r.display,
      drafts: Number(r.drafts),
      zeroResultDrafts: Number(r.zeroResultDrafts),
      lastSearchedAt: new Date(r.lastSearchedAt).toISOString(),
    }));

    const topArticles = topRows.map((r) => ({
      articleId: r.articleId!,
      title: r.title ?? "Deleted article",
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
    }));

    res.json(
      GetKbDeflectionStatsResponse.parse({
        draftsWithSuggestions,
        draftsWithClicks,
        ticketsFiledAfterSuggestions,
        ticketsFiledAfterClick,
        draftsAbandonedAfterClick,
        deflectionRatePct,
        topArticles,
        uncoveredQueries,
      }),
    );
  },
);

// ─── Bootstrap security endpoints ────────────────────────────────────────────

router.get(
  "/admin/bootstrap-status",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const [signedInAdmin] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.clerkUserId)))
      .limit(1);

    const hasSignedInAdmin = !!signedInAdmin;

    // Check both in-memory token (rotated this session) AND the DB persisted flag
    // (rotated in a previous session / deployment).
    const [settings] = await db
      .select({ bootstrapDisabled: siteSettingsTable.bootstrapDisabled })
      .from(siteSettingsTable)
      .limit(1);
    const tokenRotated = getBootstrapToken() === null || (settings?.bootstrapDisabled ?? false);

    // "active" means the token exists and has not been revoked — show the banner.
    const active = !tokenRotated;

    res.json({ active, hasSignedInAdmin, tokenRotated });
  },
);

/**
 * POST /admin/test-email
 * Sends a test email to the calling admin so they can verify SMTP is working.
 * Returns {ok, message} — always 200 so the client can display the result.
 */
router.post(
  "/admin/test-email",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const to = req.portalUser!.email;
    const smtpConfigured = !!(
      process.env["SMTP_HOST"] &&
      process.env["SMTP_USER"] &&
      process.env["SMTP_PASS"]
    );
    const emailFromConfigured = !!(process.env["EMAIL_FROM"]);

    if (!smtpConfigured) {
      res.json({
        ok: false,
        message:
          "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables, then restart the api-server container.",
      });
      return;
    }
    if (!emailFromConfigured) {
      res.json({
        ok: false,
        message:
          "EMAIL_FROM is not set. Add EMAIL_FROM=support@ekai.ai to your .env and restart the api-server container.",
      });
      return;
    }

    try {
      await sendEmail({
        to,
        subject: "Ekai Support — SMTP test",
        html: `<p>This is a test email sent from the Ekai Support Portal to confirm that SMTP delivery is working correctly.</p><p>If you received this, email is configured correctly.</p>`,
        text: `This is a test email sent from the Ekai Support Portal. If you received this, email is configured correctly.`,
      });
      logger.info({ to }, "test email sent successfully");
      res.json({ ok: true, message: `Test email sent to ${to}. Check your inbox.` });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, to }, "test email failed");
      res.json({
        ok: false,
        message: `SMTP send failed: ${errMsg}. Check your SMTP credentials and that the SES SMTP password is correct.`,
      });
    }
  },
);

router.post(
  "/admin/bootstrap-rotate",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const old = rotateBootstrapToken();
    // Persist the disabled flag to the DB so it survives server restarts.
    await persistBootstrapDisabled();
    logger.info({ hadToken: old !== null }, "bootstrap: token rotated by admin — endpoint permanently disabled");
    res.json({ message: "Bootstrap token rotated. The bootstrap-admin endpoint is now permanently inaccessible." });
  },
);

export default router;
