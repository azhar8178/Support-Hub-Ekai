/**
 * Fleet heartbeat ingestion — called by the Ekai Fleet Agent running inside
 * each customer's cloud environment every FLEET_INTERVAL seconds.
 *
 * Auth: X-Fleet-API-Key header (bcrypt comparison), NOT session-based.
 * This router is intentionally excluded from session middleware.
 *
 * Endpoints:
 *   POST /fleet/heartbeat          – receive a heartbeat push from an agent
 *   GET  /fleet/check-heartbeats   – cron endpoint (CRON_SECRET protected)
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, desc, eq, isNull, lt, not, or } from "drizzle-orm";
import {
  db,
  customerEnvironmentsTable,
  healthSnapshotsTable,
  healthAlertsTable,
  ticketsTable,
  ticketMessagesTable,
  organisationsTable,
  usersTable,
  slaConfigTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/email";
import { getPortalUrl, getAlertFlags } from "../lib/systemConfig";

const router: IRouter = Router();

// In-memory rate-limit map: environmentId → last accepted timestamp (ms)
const lastAccepted = new Map<number, number>();

const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Normalise lowercase status strings from agent to uppercase DB values */
function normaliseStatus(s: string): "HEALTHY" | "DEGRADED" | "DOWN" {
  const u = s.toUpperCase();
  if (u === "HEALTHY" || u === "DEGRADED" || u === "DOWN") return u;
  return "DEGRADED";
}

// ---------------------------------------------------------------------------
// POST /fleet/heartbeat
// ---------------------------------------------------------------------------
router.post("/fleet/heartbeat", async (req, res): Promise<void> => {
  // Payload size guard
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    res.status(413).json({ message: "Payload too large (max 50 KB)" });
    return;
  }

  const apiKey = req.headers["x-fleet-api-key"];
  if (!apiKey || typeof apiKey !== "string") {
    res.status(401).json({ message: "Missing X-Fleet-API-Key header" });
    return;
  }

  const body = req.body as {
    timestamp?: unknown;
    status?: unknown;
    version?: unknown;
    services?: unknown;
    platform?: unknown;
  };

  if (
    typeof body.timestamp !== "string" ||
    typeof body.status !== "string"
  ) {
    res.status(400).json({ message: "Missing required fields: timestamp, status" });
    return;
  }

  // Timestamp drift check (±10 minutes)
  const agentTs = new Date(body.timestamp);
  if (isNaN(agentTs.getTime())) {
    res.status(400).json({ message: "Invalid timestamp" });
    return;
  }
  const driftMs = Math.abs(Date.now() - agentTs.getTime());
  if (driftMs > 10 * 60 * 1000) {
    res.status(400).json({ message: "Timestamp is more than 10 minutes from server time" });
    return;
  }

  // Narrow candidates by API key prefix (first 12 chars) to limit bcrypt calls
  const keyPrefix = apiKey.substring(0, 12);
  const candidates = await db
    .select()
    .from(customerEnvironmentsTable)
    .where(
      and(
        eq(customerEnvironmentsTable.apiKeyPrefix, keyPrefix),
        eq(customerEnvironmentsTable.heartbeatMode, "push"),
        eq(customerEnvironmentsTable.active, true),
      ),
    );

  let matchedEnv: typeof candidates[number] | null = null;
  for (const env of candidates) {
    const ok = await bcrypt.compare(apiKey, env.apiKeyHash);
    if (ok) { matchedEnv = env; break; }
  }

  if (!matchedEnv) {
    res.status(401).json({ message: "Invalid API key" });
    return;
  }

  // Rate limit: reject if same environment posted within 60 seconds
  const last = lastAccepted.get(matchedEnv.id);
  const now = Date.now();
  if (last && now - last < 60_000) {
    res.status(429).json({ message: "Rate limit: one push per 60 seconds" });
    return;
  }
  lastAccepted.set(matchedEnv.id, now);

  const newStatus = normaliseStatus(body.status as string);
  const prevStatus = matchedEnv.status as string;
  const services = Array.isArray(body.services) ? body.services : [];
  const platform = typeof body.platform === "object" && body.platform !== null ? body.platform : {};
  const agentVersion = typeof body.version === "string" ? body.version : "unknown";

  // Write heartbeat to health_snapshots
  await db.insert(healthSnapshotsTable).values({
    environmentId: matchedEnv.id,
    timestamp: agentTs,
    overallStatus: newStatus,
    servicesJson: JSON.stringify(services),
    platformJson: JSON.stringify(platform),
    agentVersion,
  });

  // Update environment status + lastSeen
  await db
    .update(customerEnvironmentsTable)
    .set({ status: newStatus, lastSeen: agentTs, agentVersion })
    .where(eq(customerEnvironmentsTable.id, matchedEnv.id));

  // Trigger alert logic if status changed
  if (newStatus !== prevStatus) {
    await handleStatusChange({
      env: matchedEnv,
      prevStatus,
      newStatus,
      agentTs,
      services,
    });
  }

  res.json({ received: true, interval_seconds: 300 });
});

// ---------------------------------------------------------------------------
// GET /fleet/check-heartbeats — cron endpoint
// ---------------------------------------------------------------------------
router.get("/fleet/check-heartbeats", async (req, res): Promise<void> => {
  const cronSecret = req.headers["x-cron-secret"];
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || cronSecret !== expectedSecret) {
    res.status(401).json({ message: "Invalid or missing CRON_SECRET" });
    return;
  }

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  // Find push-mode envs with stale heartbeat that are not already OFFLINE
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

  const flags = await getAlertFlags();
  let marked = 0;
  for (const { env, orgName } of staleEnvs) {
    // Always update status to OFFLINE so the dashboard reflects reality
    await db
      .update(customerEnvironmentsTable)
      .set({ status: "OFFLINE" })
      .where(eq(customerEnvironmentsTable.id, env.id));

    // Skip alert record + email if fleet alerts are disabled globally or per-env
    if (!flags.fleetAlertsEnabled || !env.alertsEnabled) {
      marked++;
      continue;
    }

    // Create MISSED_HEARTBEAT alert
    await db.insert(healthAlertsTable).values({
      environmentId: env.id,
      alertType: "MISSED_HEARTBEAT",
      fromStatus: env.status,
      toStatus: "OFFLINE",
    });

    if (flags.emailAlertsEnabled) {
      const lastSeen = env.lastSeen
        ? `${Math.floor((Date.now() - env.lastSeen.getTime()) / 60_000)} minutes ago`
        : "never";
      const portalUrl = (await getPortalUrl()) ?? "https://support.ekai.ai";
      const envDetailUrl = `${portalUrl}/agent/health/${env.id}`;

      sendEmail({
        to: "support@ekai.ai",
        subject: `[FLEET] Missed heartbeat: ${env.name} (${orgName ?? "unknown org"})`,
        html: `<p>No heartbeat received from <strong>${orgName ?? "unknown org"} — ${env.name}</strong> for more than 10 minutes.</p>
        <p>Last seen: <strong>${lastSeen}</strong></p>
        <p>Environment: ${env.cloud.toUpperCase()} / ${env.region} / ${env.environment}</p>
        <p><a href="${envDetailUrl}">View fleet dashboard →</a></p>`,
        text: `[FLEET] Missed heartbeat: ${env.name} (${orgName ?? "unknown org"})\nLast seen: ${lastSeen}\nView: ${envDetailUrl}`,
      }).catch((err) => logger.error({ err }, "Failed to send missed-heartbeat email"));
    }

    marked++;
  }

  res.json({ checked: staleEnvs.length, markedOffline: marked });
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function handleStatusChange(opts: {
  env: typeof customerEnvironmentsTable.$inferSelect;
  prevStatus: string;
  newStatus: "HEALTHY" | "DEGRADED" | "DOWN";
  agentTs: Date;
  services: unknown[];
}): Promise<void> {
  const { env, prevStatus, newStatus, agentTs, services } = opts;

  // Check global + per-environment alert flags before doing anything
  const flags = await getAlertFlags();
  if (!flags.fleetAlertsEnabled || !env.alertsEnabled) {
    logger.debug(
      { envId: env.id, fleetAlertsEnabled: flags.fleetAlertsEnabled, envAlertsEnabled: env.alertsEnabled },
      "handleStatusChange: alerts suppressed — skipping alert creation",
    );
    return;
  }

  // Look up org name for emails
  const [orgRow] = await db
    .select({ name: organisationsTable.name })
    .from(organisationsTable)
    .where(eq(organisationsTable.id, env.orgId))
    .limit(1);
  const orgName = orgRow?.name ?? "Unknown org";

  const portalUrl = (await getPortalUrl()) ?? "https://support.ekai.ai";
  const envDetailUrl = `${portalUrl}/agent/health/${env.id}`;

  // Find the most recent open alert for this env (to link resolved alert to ticket)
  const [existingAlert] = await db
    .select()
    .from(healthAlertsTable)
    .where(
      and(
        eq(healthAlertsTable.environmentId, env.id),
        isNull(healthAlertsTable.resolvedAt),
        not(eq(healthAlertsTable.alertType, "MISSED_HEARTBEAT")),
      ),
    )
    .orderBy(desc(healthAlertsTable.triggeredAt))
    .limit(1);

  let linkedTicketId: number | undefined;

  if (newStatus === "DOWN" || newStatus === "DEGRADED") {
    // Auto-create a ticket
    const downServices = (services as Array<{ name?: string; status?: string }>)
      .filter((s) => s.status?.toUpperCase() !== "HEALTHY")
      .map((s) => s.name ?? "unknown")
      .join(", ");

    // Determine priority from SLA config (lowest rank = P1)
    const slaRows = await db
      .select()
      .from(slaConfigTable)
      .orderBy(slaConfigTable.rank)
      .limit(2);

    const p1Severity = slaRows[0];
    const p2Severity = slaRows[1];
    const severityName = newStatus === "DOWN"
      ? (p1Severity?.severity ?? "P1")
      : (p2Severity?.severity ?? "P2");

    // Find an available ekai_agent to assign
    const [agent] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "ekai_agent"))
      .limit(1);

    const title = `[FLEET] ${env.name} is ${newStatus} — ${orgName}`;
    const internalNote = `Auto-created from fleet health alert.\nLast heartbeat: ${agentTs.toISOString()}.\nAffected services: ${downServices || "all"}`;

    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        orgId: env.orgId,
        title,
        description: internalNote,
        status: "new" as const,
        severity: severityName,
        category: "Infrastructure",
        environment: env.environment,
        raisedById: null,
        assignedToId: agent?.id ?? null,
      })
      .returning({ id: ticketsTable.id });

    if (ticket) {
      linkedTicketId = ticket.id;
      // Add internal note as first message
      await db.insert(ticketMessagesTable).values({
        ticketId: ticket.id,
        authorId: null,
        content: internalNote,
        isInternal: true,
      });
    }

    // Create STATUS_CHANGE alert
    const [alert] = await db
      .insert(healthAlertsTable)
      .values({
        environmentId: env.id,
        alertType: "STATUS_CHANGE",
        fromStatus: prevStatus,
        toStatus: newStatus,
        linkedTicketId: linkedTicketId ?? null,
      })
      .returning({ id: healthAlertsTable.id });

    // Send email (only when email alerts are also enabled)
    if (flags.emailAlertsEnabled) {
      sendEmail({
        to: "support@ekai.ai",
        subject: `[${newStatus === "DOWN" ? "P1" : "P2"} ALERT] ${orgName} — ${env.name} is ${newStatus}`,
        html: `<p><strong>${orgName} — ${env.name}</strong> status changed to <strong style="color:${newStatus === "DOWN" ? "red" : "orange"}">${newStatus}</strong> (was: ${prevStatus}).</p>
        ${linkedTicketId ? `<p>Auto-created ticket <a href="${portalUrl}/tickets/${linkedTicketId}">#${linkedTicketId}</a>.</p>` : ""}
        ${downServices ? `<p>Affected services: ${downServices}</p>` : ""}
        <p><a href="${envDetailUrl}">View fleet dashboard →</a></p>`,
        text: `FLEET ALERT: ${orgName} — ${env.name} is ${newStatus} (was: ${prevStatus}).\n${linkedTicketId ? `Ticket #${linkedTicketId}.\n` : ""}${downServices ? `Affected: ${downServices}\n` : ""}View: ${envDetailUrl}`,
      }).catch((err) => logger.error({ err }, "Failed to send status-change alert email"));
    }

  } else if (newStatus === "HEALTHY" && existingAlert) {
    // Mark existing alert resolved
    await db
      .update(healthAlertsTable)
      .set({ resolvedAt: new Date() })
      .where(eq(healthAlertsTable.id, existingAlert.id));

    // If there was a linked ticket, add resolution message and close it
    if (existingAlert.linkedTicketId) {
      const minutesDown = existingAlert.triggeredAt
        ? Math.floor((Date.now() - existingAlert.triggeredAt.getTime()) / 60_000)
        : 0;

      await db.insert(ticketMessagesTable).values({
        ticketId: existingAlert.linkedTicketId,
        authorId: null,
        content: `Environment returned to HEALTHY status at ${new Date().toISOString()}.\nTotal downtime: ${minutesDown} minutes.`,
        isInternal: true,
      });

      await db
        .update(ticketsTable)
        .set({ status: "resolved" })
        .where(eq(ticketsTable.id, existingAlert.linkedTicketId));
    }

    // Create resolved STATUS_CHANGE alert
    await db.insert(healthAlertsTable).values({
      environmentId: env.id,
      alertType: "STATUS_CHANGE",
      fromStatus: prevStatus,
      toStatus: "HEALTHY",
      resolvedAt: new Date(),
    });

    // Send resolution email (only when email alerts are also enabled)
    if (flags.emailAlertsEnabled) {
      sendEmail({
        to: "support@ekai.ai",
        subject: `[RESOLVED] ${orgName} — ${env.name} is healthy again`,
        html: `<p><strong>${orgName} — ${env.name}</strong> has returned to <strong style="color:green">HEALTHY</strong> (was: ${prevStatus}).</p>
        <p><a href="${envDetailUrl}">View fleet dashboard →</a></p>`,
        text: `RESOLVED: ${orgName} — ${env.name} is healthy again (was: ${prevStatus}).\nView: ${envDetailUrl}`,
      }).catch((err) => logger.error({ err }, "Failed to send resolution email"));
    }
  }
}

export default router;
