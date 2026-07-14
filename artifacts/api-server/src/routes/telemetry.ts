/**
 * Telemetry ingestion — called by the health agent running inside each
 * customer's cloud environment every 5 minutes.
 *
 * Auth: X-Ekai-API-Key header (bcrypt comparison), NOT session-based.
 * The endpoint is intentionally excluded from session middleware.
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, desc, eq, lt, not, or } from "drizzle-orm";
import {
  db,
  customerEnvironmentsTable,
  healthSnapshotsTable,
  healthAlertsTable,
  ticketsTable,
  organisationsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/email";
import { getPortalUrl } from "../lib/systemConfig";

const router: IRouter = Router();

// In-memory rate-limit map: environmentId → last accepted timestamp (ms)
const lastAccepted = new Map<number, number>();

const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB

/** Normalise status strings to uppercase DB values */
function normaliseStatus(s: string): "HEALTHY" | "DEGRADED" | "DOWN" {
  const u = s.toUpperCase();
  if (u === "HEALTHY" || u === "DEGRADED" || u === "DOWN") return u;
  return "DEGRADED";
}

// ---------------------------------------------------------------------------
// POST /api/telemetry/ingest
// ---------------------------------------------------------------------------
router.post(
  "/telemetry/ingest",
  async (req, res): Promise<void> => {
    // --- payload size guard ---
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ message: "Payload too large (max 50 KB)" });
      return;
    }

    const apiKey = req.headers["x-ekai-api-key"];
    if (!apiKey || typeof apiKey !== "string") {
      res.status(401).json({ message: "Missing X-Ekai-API-Key header" });
      return;
    }

    const body = req.body as {
      customer_id?: unknown;
      timestamp?: unknown;
      environment?: unknown;
      cloud?: unknown;
      region?: unknown;
      agent_version?: unknown;
      overall_status?: unknown;
      services?: unknown;
      platform?: unknown;
    };

    if (
      typeof body.customer_id !== "string" ||
      typeof body.timestamp !== "string" ||
      typeof body.overall_status !== "string"
    ) {
      res.status(400).json({ message: "Missing required fields: customer_id, timestamp, overall_status" });
      return;
    }

    // --- timestamp drift check (±10 minutes) ---
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

    // --- look up ALL active environments, find one whose key matches ---
    // We can't do a direct DB lookup without knowing which env the key belongs to,
    // so we check the hashed prefix approach: look up by a unique index if available,
    // otherwise iterate candidates. Since bcrypt is slow, we limit candidates by
    // filtering on customerId first.
    const orgId = Number(body.customer_id);
    if (isNaN(orgId)) {
      res.status(401).json({ message: "Invalid customer_id" });
      return;
    }

    const candidates = await db
      .select()
      .from(customerEnvironmentsTable)
      .where(
        and(
          eq(customerEnvironmentsTable.orgId, orgId),
          eq(customerEnvironmentsTable.active, true),
        ),
      );

    let matchedEnv: typeof candidates[number] | null = null;
    for (const env of candidates) {
      const ok = await bcrypt.compare(apiKey, env.apiKeyHash);
      if (ok) {
        matchedEnv = env;
        break;
      }
    }

    if (!matchedEnv) {
      res.status(401).json({ message: "Invalid API key" });
      return;
    }

    // --- rate limit: 1 request per 60 seconds per environment ---
    const now = Date.now();
    const lastMs = lastAccepted.get(matchedEnv.id) ?? 0;
    if (now - lastMs < 60_000) {
      res.status(429).json({ message: "Rate limit: wait 60 seconds between pushes" });
      return;
    }
    lastAccepted.set(matchedEnv.id, now);

    // --- fetch previous snapshot to detect status changes ---
    const [prevSnapshot] = await db
      .select({ overallStatus: healthSnapshotsTable.overallStatus })
      .from(healthSnapshotsTable)
      .where(eq(healthSnapshotsTable.environmentId, matchedEnv.id))
      .orderBy(desc(healthSnapshotsTable.createdAt))
      .limit(1);

    const prevStatus = prevSnapshot?.overallStatus ?? "UNKNOWN";
    const newStatus = normaliseStatus(body.overall_status as string);

    // --- write snapshot ---
    await db.insert(healthSnapshotsTable).values({
      environmentId: matchedEnv.id,
      timestamp: agentTs,
      overallStatus: newStatus,
      servicesJson: JSON.stringify(body.services ?? []),
      platformJson: JSON.stringify(body.platform ?? {}),
      agentVersion: String(body.agent_version ?? ""),
    });

    // --- update environment status ---
    await db
      .update(customerEnvironmentsTable)
      .set({
        status: newStatus,
        lastSeen: new Date(),
        agentVersion: String(body.agent_version ?? matchedEnv.agentVersion ?? ""),
      })
      .where(eq(customerEnvironmentsTable.id, matchedEnv.id));

    // --- fetch org name for ticket/email context ---
    const [org] = await db
      .select({ name: organisationsTable.name })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, matchedEnv.orgId))
      .limit(1);
    const orgName = org?.name ?? "Unknown";

    const portalBase = (await getPortalUrl() ?? "").replace(/\/$/, "");
    const envDetailUrl = `${portalBase}/agent/health/${matchedEnv.id}`;

    // --- status change alert ---
    if (prevStatus !== newStatus) {
      let linkedTicketId: number | undefined;

      // Auto-create ticket for DOWN or DEGRADED
      if (newStatus === "DOWN" || newStatus === "DEGRADED") {
        // Find the highest-rank (lowest rank number = most severe) active severity
        // We'll use P1 for DOWN, P2 for DEGRADED by rank ordering
        const { slaConfigTable } = await import("@workspace/db");
        const { asc } = await import("drizzle-orm");
        const severities = await db
          .select({ severityKey: slaConfigTable.severityKey, rank: slaConfigTable.rank })
          .from(slaConfigTable)
          .where(eq(slaConfigTable.active, true))
          .orderBy(asc(slaConfigTable.rank));

        const severity = newStatus === "DOWN"
          ? (severities[0]?.severityKey ?? "P1")
          : (severities[1]?.severityKey ?? severities[0]?.severityKey ?? "P2");

        const title = newStatus === "DOWN"
          ? `[AUTO] Environment down: ${matchedEnv.name} - ${orgName}`
          : `[AUTO] Environment degraded: ${matchedEnv.name} - ${orgName}`;

        const [newTicket] = await db
          .insert(ticketsTable)
          .values({
            title,
            description: `Automated alert: ${matchedEnv.name} (${matchedEnv.cloud}/${matchedEnv.region}) reported status ${newStatus}.\n\nView environment: ${envDetailUrl}`,
            severity,
            status: "new",
            category: "infrastructure",
            environment: matchedEnv.environment,
            orgId: matchedEnv.orgId,
          })
          .returning({ id: ticketsTable.id });

        linkedTicketId = newTicket?.id;
      }

      const [alert] = await db
        .insert(healthAlertsTable)
        .values({
          environmentId: matchedEnv.id,
          alertType: "STATUS_CHANGE",
          fromStatus: prevStatus,
          toStatus: newStatus,
          linkedTicketId: linkedTicketId ?? null,
        })
        .returning({ id: healthAlertsTable.id });

      // If status returned to HEALTHY, resolve open alerts
      if (newStatus === "HEALTHY") {
        await db
          .update(healthAlertsTable)
          .set({ resolvedAt: new Date() })
          .where(
            and(
              eq(healthAlertsTable.environmentId, matchedEnv.id),
              not(eq(healthAlertsTable.alertType, "STATUS_CHANGE")),
            ),
          );
      }

      // Send email notification (fire-and-forget)
      sendHealthAlertEmail({
        newStatus,
        prevStatus,
        envName: matchedEnv.name,
        orgName,
        envDetailUrl,
        linkedTicketId,
      }).catch((err) => logger.error({ err }, "health alert email failed"));
    }

    const nextExpected = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    res.json({ received: true, next_expected: nextExpected });
  },
);

// ---------------------------------------------------------------------------
// GET /api/telemetry/check-heartbeats  (internal cron endpoint)
// ---------------------------------------------------------------------------
router.get(
  "/telemetry/check-heartbeats",
  async (_req, res): Promise<void> => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Environments that haven't reported in 10+ minutes and aren't already DOWN
    const stale = await db
      .select({
        env: customerEnvironmentsTable,
        orgName: organisationsTable.name,
      })
      .from(customerEnvironmentsTable)
      .leftJoin(organisationsTable, eq(customerEnvironmentsTable.orgId, organisationsTable.id))
      .where(
        and(
          eq(customerEnvironmentsTable.active, true),
          not(eq(customerEnvironmentsTable.status, "DOWN")),
          or(
            lt(customerEnvironmentsTable.lastSeen, tenMinutesAgo),
            // Also catch environments that have never reported
            eq(customerEnvironmentsTable.status, "UNKNOWN"),
          ),
        ),
      );

    let processed = 0;
    for (const { env, orgName } of stale) {
      // Skip if already UNKNOWN (prevents spamming on first startup)
      if (env.status === "UNKNOWN" && !env.lastSeen) continue;
      // Skip if lastSeen is recent (race condition guard)
      if (env.lastSeen && env.lastSeen > tenMinutesAgo) continue;

      await db
        .update(customerEnvironmentsTable)
        .set({ status: "UNKNOWN" })
        .where(eq(customerEnvironmentsTable.id, env.id));

      await db.insert(healthAlertsTable).values({
        environmentId: env.id,
        alertType: "MISSED_HEARTBEAT",
        fromStatus: env.status,
        toStatus: "UNKNOWN",
      });

      const portalBase = (await getPortalUrl() ?? "").replace(/\/$/, "");
      const envDetailUrl = `${portalBase}/agent/health/${env.id}`;

      sendHeartbeatMissedEmail({
        envName: env.name,
        orgName: orgName ?? "Unknown",
        lastSeen: env.lastSeen?.toISOString() ?? "never",
        envDetailUrl,
      }).catch((err) => logger.error({ err }, "heartbeat missed email failed"));

      processed++;
    }

    res.json({ checked: stale.length, processed });
  },
);

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

async function sendHealthAlertEmail(opts: {
  newStatus: string;
  prevStatus: string;
  envName: string;
  orgName: string;
  envDetailUrl: string;
  linkedTicketId?: number;
}): Promise<void> {
  const { newStatus, prevStatus, envName, orgName, envDetailUrl, linkedTicketId } = opts;

  let subject: string;
  let bodyHtml: string;
  let bodyText: string;

  if (newStatus === "DOWN") {
    subject = `[P1 ALERT] ${orgName} - ${envName} is DOWN`;
    bodyHtml = `<p><strong>${orgName} - ${envName}</strong> has gone <strong style="color:red">DOWN</strong> (was: ${prevStatus}).</p>
      <p>Previous status: <strong>${prevStatus}</strong></p>
      ${linkedTicketId ? `<p>Auto-created ticket #${linkedTicketId}.</p>` : ""}
      <p><a href="${envDetailUrl}">View environment dashboard →</a></p>`;
    bodyText = `ALERT: ${orgName} - ${envName} is DOWN (was: ${prevStatus}).\n${linkedTicketId ? `Auto-created ticket #${linkedTicketId}.\n` : ""}View: ${envDetailUrl}`;
  } else if (newStatus === "DEGRADED") {
    subject = `[P2 ALERT] ${orgName} - ${envName} is DEGRADED`;
    bodyHtml = `<p><strong>${orgName} - ${envName}</strong> has become <strong style="color:orange">DEGRADED</strong> (was: ${prevStatus}).</p>
      ${linkedTicketId ? `<p>Auto-created ticket #${linkedTicketId}.</p>` : ""}
      <p><a href="${envDetailUrl}">View environment dashboard →</a></p>`;
    bodyText = `ALERT: ${orgName} - ${envName} is DEGRADED (was: ${prevStatus}).\n${linkedTicketId ? `Auto-created ticket #${linkedTicketId}.\n` : ""}View: ${envDetailUrl}`;
  } else if (newStatus === "HEALTHY") {
    subject = `[RESOLVED] ${orgName} - ${envName} is healthy again`;
    bodyHtml = `<p><strong>${orgName} - ${envName}</strong> has returned to <strong style="color:green">HEALTHY</strong> (was: ${prevStatus}).</p>
      <p><a href="${envDetailUrl}">View environment dashboard →</a></p>`;
    bodyText = `RESOLVED: ${orgName} - ${envName} is healthy again (was: ${prevStatus}).\nView: ${envDetailUrl}`;
  } else {
    return;
  }

  await sendEmail({ to: "support@ekai.ai", subject, html: bodyHtml, text: bodyText });
}

async function sendHeartbeatMissedEmail(opts: {
  envName: string;
  orgName: string;
  lastSeen: string;
  envDetailUrl: string;
}): Promise<void> {
  const { envName, orgName, lastSeen, envDetailUrl } = opts;
  const subject = `[WARNING] ${orgName} - ${envName} — no heartbeat for 10+ minutes`;
  const html = `<p>No telemetry received from <strong>${orgName} - ${envName}</strong> for more than 10 minutes.</p>
    <p>Last seen: <strong>${lastSeen}</strong></p>
    <p>This may indicate the health agent is not running or cannot reach the portal.</p>
    <p><a href="${envDetailUrl}">View environment dashboard →</a></p>`;
  const text = `WARNING: No heartbeat from ${orgName} - ${envName} for 10+ minutes.\nLast seen: ${lastSeen}\nView: ${envDetailUrl}`;
  await sendEmail({ to: "support@ekai.ai", subject, html, text });
}

export default router;
