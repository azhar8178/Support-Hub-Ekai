import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  invitesTable,
  kbArticlesTable,
  kbSuggestionEventsTable,
  organisationsTable,
  slaConfigTable,
  ticketsTable,
  usersTable,
  type SlaConfig,
  type UserRole,
} from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateInviteBody,
  CreateInviteResponse,
  CreateOrgBody,
  CreateOrgResponse,
  GetKbDeflectionStatsResponse,
  GetReportsResponse,
  GetSlaConfigResponse,
  ListInvitesResponse,
  ListOrgsResponse,
  ListUsersResponse,
  UpdateSlaConfigBody,
  UpdateUserBody,
  UpdateUserResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { serializeUser } from "../lib/serializers";
import { notifyUsers } from "../lib/notify";
import { sendEmail, inviteEmail } from "../lib/email";
import { refreshSlaClockCache } from "../lib/sla";
import { logger } from "../lib/logger";

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
    createdAt: invite.createdAt.toISOString(),
  };
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
    res.json(
      ListInvitesResponse.parse(
        rows.map((r) => serializeInvite(r.invite, r.org?.name ?? null, r.invite.usedAt == null)),
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

    // Send the invite email directly (not through the in-app notification pipeline).
    const inviteLink = `/accept-invite?token=${token}`;
    await sendEmail(
      inviteEmail({
        to: email,
        inviteUrl: inviteLink,
        role: parsed.data.role,
        inviterName: req.portalUser!.name ?? "An administrator",
      }),
    );
    // In-app confirmation for the admin who sent the invite.
    await notifyUsers([req.portalUser!.id], {
      type: "invite",
      title: `Invite sent to ${email}`,
      body: `An invitation email has been sent to ${email}. The link expires in 14 days.`,
    });

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
        userCount: sql<number>`(select count(*) from ${usersTable} where ${usersTable.orgId} = ${organisationsTable.id})`,
      })
      .from(organisationsTable)
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

const SEVERITY_ORDER = ["P1", "P2", "P3", "P4"];

function serializeSla(rows: SlaConfig[]): Array<Record<string, unknown>> {
  return [...rows]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .map((r) => ({
      severity: r.severity,
      firstResponseMinutes: r.firstResponseMinutes,
      resolutionMinutes: r.resolutionMinutes,
      use24x7: r.use24x7,
    }));
}

router.get(
  "/admin/sla-config",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(slaConfigTable);
    res.json(GetSlaConfigResponse.parse(serializeSla(rows)));
  },
);

router.put(
  "/admin/sla-config",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateSlaConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    for (const target of parsed.data.targets) {
      await db
        .insert(slaConfigTable)
        .values({
          severity: target.severity as SlaConfig["severity"],
          firstResponseMinutes: target.firstResponseMinutes,
          resolutionMinutes: target.resolutionMinutes,
          use24x7: target.use24x7,
        })
        .onConflictDoUpdate({
          target: slaConfigTable.severity,
          set: {
            firstResponseMinutes: target.firstResponseMinutes,
            resolutionMinutes: target.resolutionMinutes,
            use24x7: target.use24x7,
          },
        });
    }
    await refreshSlaClockCache();
    const rows = await db.select().from(slaConfigTable);
    res.json(GetSlaConfigResponse.parse(serializeSla(rows)));
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
    const events = await db.select().from(kbSuggestionEventsTable);
    const now = Date.now();

    type DraftAgg = { impressions: boolean; clicked: boolean; filed: boolean; lastEventAt: number };
    const drafts = new Map<string, DraftAgg>();
    const perArticle = new Map<number, { impressionDrafts: Set<string>; clickDrafts: Set<string> }>();

    for (const e of events) {
      let d = drafts.get(e.draftId);
      if (!d) {
        d = { impressions: false, clicked: false, filed: false, lastEventAt: 0 };
        drafts.set(e.draftId, d);
      }
      if (e.eventType === "impression") d.impressions = true;
      if (e.eventType === "click") d.clicked = true;
      if (e.eventType === "ticket_filed") d.filed = true;
      d.lastEventAt = Math.max(d.lastEventAt, e.createdAt.getTime());

      if (e.articleId != null && e.eventType !== "ticket_filed") {
        let a = perArticle.get(e.articleId);
        if (!a) {
          a = { impressionDrafts: new Set(), clickDrafts: new Set() };
          perArticle.set(e.articleId, a);
        }
        if (e.eventType === "impression") a.impressionDrafts.add(e.draftId);
        if (e.eventType === "click") a.clickDrafts.add(e.draftId);
      }
    }

    let draftsWithSuggestions = 0;
    let draftsWithClicks = 0;
    let ticketsFiledAfterSuggestions = 0;
    let ticketsFiledAfterClick = 0;
    let draftsAbandonedAfterClick = 0;

    for (const d of drafts.values()) {
      if (!d.impressions) continue; // ticket_filed-only drafts shouldn't happen, but be safe
      draftsWithSuggestions++;
      if (d.filed) ticketsFiledAfterSuggestions++;
      if (d.clicked) {
        draftsWithClicks++;
        if (d.filed) ticketsFiledAfterClick++;
        else if (now - d.lastEventAt > DRAFT_SETTLE_MS) draftsAbandonedAfterClick++;
      }
    }

    const settledClicked = draftsAbandonedAfterClick + ticketsFiledAfterClick;
    const deflectionRatePct =
      settledClicked > 0
        ? Math.round((draftsAbandonedAfterClick / settledClicked) * 1000) / 10
        : null;

    const articleIds = [...perArticle.keys()];
    const titles = articleIds.length
      ? await db
          .select({ id: kbArticlesTable.id, title: kbArticlesTable.title })
          .from(kbArticlesTable)
          .where(inArray(kbArticlesTable.id, articleIds))
      : [];
    const titleById = new Map(titles.map((t) => [t.id, t.title]));

    const topArticles = articleIds
      .map((id) => ({
        articleId: id,
        title: titleById.get(id) ?? "Deleted article",
        impressions: perArticle.get(id)!.impressionDrafts.size,
        clicks: perArticle.get(id)!.clickDrafts.size,
      }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 5);

    res.json(
      GetKbDeflectionStatsResponse.parse({
        draftsWithSuggestions,
        draftsWithClicks,
        ticketsFiledAfterSuggestions,
        ticketsFiledAfterClick,
        draftsAbandonedAfterClick,
        deflectionRatePct,
        topArticles,
      }),
    );
  },
);

export default router;
