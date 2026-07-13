import {
  db,
  deploymentsTable,
  kbSuggestionEventsTable,
  ticketsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { addBusinessDays } from "./businessHours";
import { computeSlaInfo } from "./sla";
import { applyStatusChange } from "./ticketActions";
import { getAgentAndAdminIds, notifyUsers } from "./notify";
import { sweepPushReceipts } from "./push";
import { logger } from "./logger";
import { sendSlackFleetAlert } from "./slack";
import { collectHealthStatus } from "../routes/health";

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CLOSE_BUSINESS_DAYS = 5;
const HEARTBEAT_PUSH_INTERVAL_MS = 5 * 60_000; // 5 minutes
const OFFLINE_THRESHOLD_MS = 10 * 60_000; // 10 minutes
const ALERT_COOLDOWN_MS = 30 * 60_000; // don't re-alert within 30 min

// KB suggestion events are only needed for the deflection dashboard; drafts
// settle within 30 minutes, so anything this old is safe to drop.
const KB_EVENT_RETENTION_MS = 90 * 24 * 3600_000;
// The prune is cheap but there's no point running it every minute.
const KB_EVENT_PRUNE_INTERVAL_MS = 24 * 3600_000;

let lastKbEventPruneAt = 0;
let lastHeartbeatPushAt = 0;

/**
 * Delete KB suggestion events for drafts whose latest activity is older than
 * the retention window. Deleting whole drafts (rather than individual rows)
 * keeps per-draft aggregates consistent for anything still inside the window.
 */
export async function pruneOldKbSuggestionEvents(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - KB_EVENT_RETENTION_MS);
  const staleDrafts = db
    .select({ draftId: kbSuggestionEventsTable.draftId })
    .from(kbSuggestionEventsTable)
    .groupBy(kbSuggestionEventsTable.draftId)
    .having(lt(sql`max(${kbSuggestionEventsTable.createdAt})`, cutoff));
  const deleted = await db
    .delete(kbSuggestionEventsTable)
    .where(inArray(kbSuggestionEventsTable.draftId, staleDrafts))
    .returning({ id: kbSuggestionEventsTable.id });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length }, "pruned old KB suggestion events");
  }
  return deleted.length;
}

/**
 * Auto-escalation: assign any open ticket that is ≥75% through its resolution
 * SLA window and has no assigned agent. Picks the agent with fewest currently
 * open assigned tickets. Sends a Slack alert for each escalation.
 */
async function runAutoEscalation(now: Date): Promise<void> {
  try {
    const openTickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          inArray(ticketsTable.status, ["new", "triaged", "in_progress", "awaiting_customer"]),
          isNull(ticketsTable.assignedToId),
        ),
      );

    const ticketsToEscalate = openTickets.filter((ticket) => {
      if (ticket.slaPausedAt) return false;
      const sla = computeSlaInfo(ticket, now);
      return sla.resolutionPctElapsed != null && sla.resolutionPctElapsed >= 75;
    });

    if (ticketsToEscalate.length === 0) return;

    // Find available agents sorted by open ticket load (fewest first)
    const agents = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.role, ["ekai_agent", "admin"]),
          eq(usersTable.active, true),
        ),
      );

    if (agents.length === 0) return;

    // Count open tickets per agent
    const loadRows = await db
      .select({ assignedToId: ticketsTable.assignedToId, n: count() })
      .from(ticketsTable)
      .where(
        and(
          inArray(ticketsTable.status, ["new", "triaged", "in_progress", "awaiting_customer"]),
          inArray(
            ticketsTable.assignedToId,
            agents.map((a) => a.id),
          ),
        ),
      )
      .groupBy(ticketsTable.assignedToId);

    const loadMap = new Map(loadRows.map((r) => [r.assignedToId, Number(r.n)]));

    // Sort agents by load ascending
    const sortedAgents = [...agents].sort(
      (a, b) => (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0),
    );

    for (const ticket of ticketsToEscalate) {
      const agent = sortedAgents[0]!;
      // Increment their virtual load so subsequent tickets in this sweep
      // are distributed
      loadMap.set(agent.id, (loadMap.get(agent.id) ?? 0) + 1);
      sortedAgents.sort((a, b) => (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0));

      await db
        .update(ticketsTable)
        .set({ assignedToId: agent.id })
        .where(eq(ticketsTable.id, ticket.id));

      logger.info(
        { ticketId: ticket.id, agentId: agent.id, agentName: agent.name },
        "auto-escalated unassigned ticket near SLA breach",
      );

      await sendSlackFleetAlert(
        `⏰ *SLA escalation*: ticket <#${ticket.id}|#${ticket.id} – ${ticket.title}> (${ticket.severity}) was unassigned at 75%+ of resolution SLA and has been auto-assigned to *${agent.name}*.`,
      );

      await notifyUsers([agent.id], {
        type: "sla_warning",
        title: `Ticket #${ticket.id} auto-assigned to you`,
        body: `"${ticket.title}" (${ticket.severity}) is near its SLA breach and was auto-escalated to you.`,
        ticketId: ticket.id,
        meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity, which: "resolution" },
      });
    }
  } catch (err) {
    logger.error({ err }, "auto-escalation sweep failed");
  }
}

/**
 * Fleet health alerting: check all registered deployments for staleness or
 * degraded status and send Slack + push alerts on transitions.
 */
async function runFleetAlerts(now: Date): Promise<void> {
  try {
    const deployments = await db.select().from(deploymentsTable);
    const adminIds = await getAgentAndAdminIds();

    for (const dep of deployments) {
      const offlineCutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);
      const alertCooloff = new Date(now.getTime() - ALERT_COOLDOWN_MS);

      // Determine target status
      let targetStatus: "healthy" | "degraded" | "offline" = dep.status;
      if (!dep.lastSeenAt || dep.lastSeenAt < offlineCutoff) {
        targetStatus = "offline";
      } else if (
        dep.lastHealthJson &&
        typeof dep.lastHealthJson === "object" &&
        (dep.lastHealthJson as Record<string, unknown>)["db"] &&
        ((dep.lastHealthJson as Record<string, unknown>)["db"] as Record<string, unknown>)[
          "status"
        ] === "degraded"
      ) {
        targetStatus = "degraded";
      } else if (dep.lastSeenAt && dep.lastSeenAt >= offlineCutoff) {
        targetStatus = "healthy";
      }

      // Update status if changed
      if (targetStatus !== dep.status) {
        await db
          .update(deploymentsTable)
          .set({ status: targetStatus })
          .where(eq(deploymentsTable.id, dep.id));
      }

      // Alert if status is bad and not recently alerted
      const shouldAlert =
        (targetStatus === "offline" || targetStatus === "degraded") &&
        (!dep.lastAlertedAt || dep.lastAlertedAt < alertCooloff);

      if (!shouldAlert) continue;

      const emoji = targetStatus === "offline" ? "🔴" : "🟡";
      const reason =
        targetStatus === "offline"
          ? `No heartbeat received in the last ${OFFLINE_THRESHOLD_MS / 60_000} minutes.`
          : "Database subsystem is reporting degraded status.";

      await sendSlackFleetAlert(
        `${emoji} *Fleet alert* — *${dep.name}* is *${targetStatus.toUpperCase()}*\n${dep.url}\n${reason}`,
      );

      if (adminIds.length > 0) {
        await notifyUsers(adminIds, {
          type: "sla_warning",
          title: `Deployment ${dep.name} is ${targetStatus}`,
          body: reason,
        });
      }

      await db
        .update(deploymentsTable)
        .set({ lastAlertedAt: now })
        .where(eq(deploymentsTable.id, dep.id));

      logger.warn(
        { deploymentId: dep.id, name: dep.name, targetStatus },
        "fleet alert sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "fleet alerts sweep failed");
  }
}

/**
 * If FLEET_HUB_URL and FLEET_API_KEY are set, push this instance's health
 * to the central hub. Runs at most once every 5 minutes.
 */
async function pushHeartbeatToHub(now: Date): Promise<void> {
  const hubUrl = process.env["FLEET_HUB_URL"];
  const apiKey = process.env["FLEET_API_KEY"];
  if (!hubUrl || !apiKey) return;
  if (now.getTime() - lastHeartbeatPushAt < HEARTBEAT_PUSH_INTERVAL_MS) return;

  lastHeartbeatPushAt = now.getTime();

  try {
    const health = await collectHealthStatus();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const endpoint = hubUrl.replace(/\/$/, "") + "/api/admin/deployments/heartbeat";
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, health }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    logger.debug({ hubUrl }, "heartbeat pushed to fleet hub");
  } catch (err) {
    logger.error({ err, hubUrl }, "failed to push heartbeat to fleet hub");
  }
}

/**
 * Periodic background sweep:
 * 1. SLA 75% warning notifications for open tickets approaching a deadline.
 * 2. Auto-escalate unassigned tickets at ≥75% of resolution SLA.
 * 3. Auto-close Resolved tickets after 5 business days.
 * 4. Fetch due Expo push delivery receipts from the persisted queue.
 * 5. Fleet health alerting for registered client deployments.
 * 6. Heartbeat push to central fleet hub (if configured).
 */
export async function runSweep(): Promise<void> {
  const now = new Date();

  // --- Prune old settled KB suggestion events (at most once a day) ---
  if (now.getTime() - lastKbEventPruneAt >= KB_EVENT_PRUNE_INTERVAL_MS) {
    lastKbEventPruneAt = now.getTime();
    await pruneOldKbSuggestionEvents(now);
  }

  // --- SLA 75% warnings ---
  const openTickets = await db
    .select()
    .from(ticketsTable)
    .where(inArray(ticketsTable.status, ["new", "triaged", "in_progress", "awaiting_customer"]));

  for (const ticket of openTickets) {
    if (ticket.slaWarningNotified || ticket.slaPausedAt) continue;
    const sla = computeSlaInfo(ticket, now);
    const responseAt75 =
      sla.responsePctElapsed != null && sla.responsePctElapsed >= 75 && !sla.responseBreached;
    const resolutionAt75 =
      sla.resolutionPctElapsed != null && sla.resolutionPctElapsed >= 75 && !sla.resolutionBreached;
    if (!responseAt75 && !resolutionAt75) continue;

    const which = responseAt75 ? "first response" : "resolution";
    const recipients = ticket.assignedToId
      ? [ticket.assignedToId]
      : await getAgentAndAdminIds();
    await notifyUsers(recipients, {
      type: "sla_warning",
      title: `SLA warning on ticket #${ticket.id}`,
      body: `75% of the ${which} SLA window has elapsed for "${ticket.title}" (${ticket.severity}).`,
      ticketId: ticket.id,
      meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity, which },
    });
    await db
      .update(ticketsTable)
      .set({ slaWarningNotified: true })
      .where(eq(ticketsTable.id, ticket.id));
  }

  // --- Auto-escalate unassigned tickets near SLA breach ---
  await runAutoEscalation(now);

  // --- Auto-close resolved tickets after 5 business days ---
  const resolvedTickets = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.status, "resolved"));

  for (const ticket of resolvedTickets) {
    if (!ticket.resolvedAt) continue;
    const closeAt = addBusinessDays(ticket.resolvedAt, AUTO_CLOSE_BUSINESS_DAYS);
    if (now >= closeAt) {
      await applyStatusChange(ticket, "closed", null);
      logger.info({ ticketId: ticket.id }, "auto-closed resolved ticket");
    }
  }

  // --- Push delivery receipt checks (persisted queue; survives restarts) ---
  await sweepPushReceipts(now);

  // --- Fleet health alerting ---
  await runFleetAlerts(now);

  // --- Heartbeat push to central hub (if configured) ---
  await pushHeartbeatToHub(now);
}

export function startSweeps(): void {
  setInterval(() => {
    runSweep().catch((err) => logger.error({ err }, "background sweep failed"));
  }, SWEEP_INTERVAL_MS);
  logger.info("background SLA/auto-close sweeps started");
}
