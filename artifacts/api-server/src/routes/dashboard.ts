import { Router, type IRouter } from "express";
import { db, ticketsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { GetAgentMetricsResponse, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { isStaff, requireAuth, requireRole } from "../middlewares/requireAuth";
import { loadTicketsWhere } from "../lib/serializers";
import { computeSlaInfo } from "../lib/sla";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const scope =
    !isStaff(user) && user.orgId != null ? eq(ticketsTable.orgId, user.orgId) : undefined;
  if (!isStaff(user) && user.orgId == null) {
    res.json(
      GetDashboardSummaryResponse.parse({
        openCount: 0,
        inProgressCount: 0,
        resolvedLast30Days: 0,
        recentTickets: [],
      }),
    );
    return;
  }

  const tickets = await loadTicketsWhere(scope);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const openCount = tickets.filter((t) => t.status === "new" || t.status === "triaged").length;
  const inProgressCount = tickets.filter(
    (t) => t.status === "in_progress" || t.status === "awaiting_customer",
  ).length;
  const resolvedLast30Days = tickets.filter(
    (t) => t.resolvedAt != null && t.resolvedAt >= thirtyDaysAgo,
  ).length;

  res.json(
    GetDashboardSummaryResponse.parse({
      openCount,
      inProgressCount,
      resolvedLast30Days,
      recentTickets: tickets.slice(0, 5),
    }),
  );
});

router.get(
  "/agent/metrics",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const openStatuses = ["new", "triaged", "in_progress", "awaiting_customer"] as const;
    const allOpen = await db
      .select()
      .from(ticketsTable)
      .where(inArray(ticketsTable.status, [...openStatuses]));

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);

    const openP1Count = allOpen.filter((t) => t.severity === "P1").length;
    const unassignedCount = allOpen.filter((t) => t.assignedToId == null).length;

    // Breaches that became overdue today (response or resolution deadline
    // passed today without being met), plus already-breached open tickets today.
    const slaBreachesToday = allOpen.filter((t) => {
      const sla = computeSlaInfo(t, now);
      const responseBreachedToday =
        sla.responseBreached && t.responseDeadline != null && t.responseDeadline >= startOfToday;
      const resolutionBreachedToday =
        sla.resolutionBreached &&
        t.resolutionDeadline != null &&
        t.resolutionDeadline >= startOfToday;
      return responseBreachedToday || resolutionBreachedToday;
    }).length;

    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
    const respondedThisWeek = await db
      .select()
      .from(ticketsTable)
      .where(and(gte(ticketsTable.createdAt, weekAgo)));
    const responseTimes = respondedThisWeek
      .filter((t) => t.firstResponseAt != null)
      .map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 3600_000);
    const avgFirstResponseHoursThisWeek =
      responseTimes.length > 0
        ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
        : null;

    res.json(
      GetAgentMetricsResponse.parse({
        openP1Count,
        slaBreachesToday,
        avgFirstResponseHoursThisWeek,
        openTicketCount: allOpen.length,
        unassignedCount,
      }),
    );
  },
);

export default router;
