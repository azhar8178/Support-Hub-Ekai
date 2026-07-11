import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  invitesTable,
  kbArticlesTable,
  kbSearchLogTable,
  kbSuggestionEventsTable,
  organisationsTable,
  slaConfigTable,
  ticketsTable,
  usersTable,
  type SlaConfig,
  type UserRole,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
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

export default router;
