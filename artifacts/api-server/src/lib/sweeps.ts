import {
  db,
  deploymentsTable,
  deploymentHeartbeatsTable,
  kbSuggestionEventsTable,
  customerEnvironmentsTable,
  healthAlertsTable,
  ticketsTable,
  ticketMessagesTable,
  usersTable,
  organisationsTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { addBusinessDays } from "./businessHours";
import { computeSlaInfo } from "./sla";
import { applyStatusChange } from "./ticketActions";
import { getAgentAndAdminIds, notifyUsers } from "./notify";
import { sweepPushReceipts } from "./push";
import { logger } from "./logger";
import { sendSlackFleetAlert } from "./slack";
import { recordHeartbeat } from "../routes/deployments";

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CLOSE_BUSINESS_DAYS = 5;
const FLEET_POLL_INTERVAL_MS = 5 * 60_000;     // poll each deployment's /healthz every 5 min
const OFFLINE_THRESHOLD_MS = 10 * 60_000; // 10 minutes
const ALERT_COOLDOWN_MS = 30 * 60_000; // don't re-alert within 30 min
const FLEET_POLL_TIMEOUT_MS = 5_000;           // abort /healthz fetch after 5 s

// KB suggestion events are only needed for the deflection dashboard; drafts
// settle within 30 minutes, so anything this old is safe to drop.
const KB_EVENT_RETENTION_MS = 90 * 24 * 3600_000;
// The prune is cheap but there's no point running it every minute.
const KB_EVENT_PRUNE_INTERVAL_MS = 24 * 3600_000;

// Heartbeat rows older than 24 h are pruned globally (all deployments) once
// per hour. The per-heartbeat fast-path in the route covers the active case;
// this sweep covers deployments that have gone permanently silent.
const HEARTBEAT_RETENTION_MS = 24 * 3600_000;
const HEARTBEAT_PRUNE_INTERVAL_MS = 3600_000; // 1 hour

let lastKbEventPruneAt = 0;
let lastHeartbeatPruneAt = 0;
let lastFleetPollAt = 0;
let lastCustomerHeartbeatCheckAt = 0;
const CUSTOMER_HEARTBEAT_CHECK_INTERVAL_MS = 5 * 60_000; // run every 5 min
const CUSTOMER_HEARTBEAT_OFFLINE_MS = 10 * 60_000;       // offline after 10 min silence

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
 * Global heartbeat prune: delete deployment_heartbeats rows older than 24 h
 * across ALL deployments. This covers deployments that have gone permanently
 * silent and therefore never trigger the per-heartbeat fast-path in the route.
 *
 * Exported for unit tests; called internally by runSweep (at most once / hour).
 */
export async function pruneStaleHeartbeats(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - HEARTBEAT_RETENTION_MS);
  const deleted = await db
    .delete(deploymentHeartbeatsTable)
    .where(lt(deploymentHeartbeatsTable.recordedAt, cutoff))
    .returning({ id: deploymentHeartbeatsTable.id });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length }, "pruned stale deployment heartbeats (global sweep)");
  }
  return deleted.length;
}

/**
 * Auto-escalation: assign any open ticket that is ≥75% through its resolution
 * SLA window and has no assigned agent. Picks the agent with fewest currently
 * open assigned tickets. Sends a Slack alert for each escalation.
 *
 * Exported for unit tests; called internally by runSweep.
 */
export async function runAutoEscalation(now: Date): Promise<void> {
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
 * Hub-side fleet poll: for every poll-mode deployment, fetch its /api/healthz
 * and record the result using the same logic as the push heartbeat endpoint.
 *
 * On success: records a heartbeat (updates lastSeenAt + status).
 * On failure (network error, timeout, non-200): logs a warning and does NOT
 * update the deployment — lastSeenAt stays stale. runFleetAlerts will then
 * detect the staleness (lastSeenAt < offlineCutoff) after OFFLINE_THRESHOLD_MS
 * and fire the offline alert, exactly as it does for missed push heartbeats.
 *
 * Runs at most once every FLEET_POLL_INTERVAL_MS (5 min).
 * Exported for unit tests.
 */
export async function runFleetPoll(now: Date): Promise<void> {
  let pollTargets: (typeof deploymentsTable.$inferSelect)[];
  try {
    pollTargets = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.heartbeatMode, "poll"));
  } catch (err) {
    logger.error({ err }, "fleet poll: failed to load poll-mode deployments");
    return;
  }

  for (const dep of pollTargets) {
    try {
      const healthzUrl = dep.url.replace(/\/$/, "") + "/api/healthz";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FLEET_POLL_TIMEOUT_MS);

      let health: Record<string, unknown>;
      try {
        const resp = await fetch(healthzUrl, { signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        health = (await resp.json()) as Record<string, unknown>;
      } finally {
        clearTimeout(timeout);
      }

      await recordHeartbeat(dep, health);
      logger.debug({ deploymentId: dep.id, url: healthzUrl }, "fleet poll: heartbeat recorded");
    } catch (err) {
      // Do NOT record a heartbeat on failure — leave lastSeenAt unchanged so
      // that runFleetAlerts triggers the offline alert via staleness detection.
      logger.warn({ err, deploymentId: dep.id, name: dep.name }, "fleet poll: healthz fetch failed — lastSeenAt left stale");
    }
  }
}

/**
 * Fleet health alerting: check all registered deployments for staleness or
 * degraded status and send Slack + push alerts on transitions.
 *
 * Exported for unit tests; called internally by runSweep.
 */
export async function runFleetAlerts(now: Date): Promise<void> {
  let deployments: (typeof deploymentsTable.$inferSelect)[];
  let adminIds: number[];

  try {
    deployments = await db.select().from(deploymentsTable);
    adminIds = await getAgentAndAdminIds();
  } catch (err) {
    logger.error({ err }, "fleet alerts sweep failed: could not load deployments");
    return;
  }

  const offlineCutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);
  const alertCooloff = new Date(now.getTime() - ALERT_COOLDOWN_MS);

  for (const dep of deployments) {
    try {
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

      // Use per-deployment webhook if set, otherwise fall back to global
      await sendSlackFleetAlert(
        `${emoji} *Fleet alert* — *${dep.name}* is *${targetStatus.toUpperCase()}*\n${dep.url}\n${reason}`,
        dep.slackWebhookUrl,
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
    } catch (err) {
      logger.error({ err, deploymentId: dep.id }, "fleet alert failed for deployment; skipping to next");
    }
  }
}

/**
 * Periodic background sweep:
 * 1. SLA 75% warning notifications for open tickets approaching a deadline.
 * 2. Auto-escalate unassigned tickets at ≥75% of resolution SLA.
 * 3. Auto-close Resolved tickets after 5 business days.
 * 4. Fetch due Expo push delivery receipts from the persisted queue.
 * 5. Fleet health alerting for registered client deployments.
 */
/**
 * Check all push-mode customer environments for missed heartbeats.
 * Any environment that hasn't sent a heartbeat in the last 10 minutes
 * is marked OFFLINE and a MISSED_HEARTBEAT alert is created.
 * Exported for unit tests; called internally by runSweep (every 5 min).
 */
export async function checkCustomerHeartbeats(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - CUSTOMER_HEARTBEAT_OFFLINE_MS);

  const staleEnvs = await db
    .select({
      env: customerEnvironmentsTable,
      orgName: organisationsTable.name,
    })
    .from(customerEnvironmentsTable)
    .leftJoin(organisationsTable, eq(customerEnvironmentsTable.orgId, organisationsTable.id))
    .where(
      and(
        eq(customerEnvironmentsTable.heartbeatMode, "push"),
        eq(customerEnvironmentsTable.active, true),
        not(eq(customerEnvironmentsTable.status, "OFFLINE")),
        or(
          lt(customerEnvironmentsTable.lastSeen, cutoff),
          isNull(customerEnvironmentsTable.lastSeen),
        ),
      ),
    );

  for (const { env, orgName } of staleEnvs) {
    await db
      .update(customerEnvironmentsTable)
      .set({ status: "OFFLINE" })
      .where(eq(customerEnvironmentsTable.id, env.id));

    await db.insert(healthAlertsTable).values({
      environmentId: env.id,
      alertType: "MISSED_HEARTBEAT",
      fromStatus: env.status,
      toStatus: "OFFLINE",
    });

    const lastSeenAgo = env.lastSeen
      ? `${Math.floor((now.getTime() - env.lastSeen.getTime()) / 60_000)} minutes ago`
      : "never";

    logger.warn(
      { envId: env.id, envName: env.name, orgName, lastSeenAgo },
      "customer environment marked OFFLINE: missed heartbeat",
    );

    // Send alert email
    const { sendEmail } = await import("./email");
    const { getPortalUrl } = await import("./systemConfig");
    const portalUrl = (await getPortalUrl()) ?? "https://support.ekai.ai";
    sendEmail({
      to: "support@ekai.ai",
      subject: `[FLEET] Missed heartbeat: ${env.name} (${orgName ?? "unknown org"})`,
      html: `<p>No heartbeat from <strong>${orgName ?? "unknown org"} — ${env.name}</strong> for more than 10 minutes. Last seen: <strong>${lastSeenAgo}</strong>.</p>
        <p><a href="${portalUrl}/agent/health/${env.id}">View fleet dashboard →</a></p>`,
      text: `[FLEET] Missed heartbeat: ${env.name} (${orgName ?? "unknown org"})\nLast seen: ${lastSeenAgo}\nView: ${portalUrl}/agent/health/${env.id}`,
    }).catch((err) => logger.error({ err }, "failed to send missed-heartbeat email"));
  }
}

export async function runSweep(): Promise<void> {
  const now = new Date();

  // --- Prune old settled KB suggestion events (at most once a day) ---
  if (now.getTime() - lastKbEventPruneAt >= KB_EVENT_PRUNE_INTERVAL_MS) {
    lastKbEventPruneAt = now.getTime();
    await pruneOldKbSuggestionEvents(now);
  }

  // --- Global heartbeat prune: covers silent deployments (at most once / hour) ---
  if (now.getTime() - lastHeartbeatPruneAt >= HEARTBEAT_PRUNE_INTERVAL_MS) {
    lastHeartbeatPruneAt = now.getTime();
    await pruneStaleHeartbeats(now);
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

  // --- Hub-side poll: fetch /healthz for each poll-mode deployment ---
  if (now.getTime() - lastFleetPollAt >= FLEET_POLL_INTERVAL_MS) {
    lastFleetPollAt = now.getTime();
    await runFleetPoll(now);
  }

  // --- Fleet health alerting (legacy deploymentsTable-based) ---
  await runFleetAlerts(now);

  // --- Customer fleet environments: missed heartbeat check ---
  if (now.getTime() - lastCustomerHeartbeatCheckAt >= CUSTOMER_HEARTBEAT_CHECK_INTERVAL_MS) {
    lastCustomerHeartbeatCheckAt = now.getTime();
    await checkCustomerHeartbeats(now);
  }
}

export function startSweeps(): void {
  setInterval(() => {
    runSweep().catch((err) => logger.error({ err }, "background sweep failed"));
  }, SWEEP_INTERVAL_MS);
  logger.info("background SLA/auto-close sweeps started");
}
