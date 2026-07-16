/**
 * Customer environment management — admin registers environments, generates
 * API keys, and views health data. Customers see their own environments.
 */

import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  customerEnvironmentsTable,
  healthSnapshotsTable,
  healthAlertsTable,
  organisationsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { testSlackWebhook } from "../lib/slack";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

function serializeEnv(
  row: typeof customerEnvironmentsTable.$inferSelect & { orgName?: string },
) {
  return {
    id: row.id,
    orgId: row.orgId,
    orgName: (row as any).orgName ?? null,
    name: row.name,
    cloud: row.cloud,
    region: row.region,
    runtime: row.runtime,
    apiKeyPrefix: row.apiKeyPrefix,
    heartbeatMode: row.heartbeatMode ?? "push",
    environment: row.environment,
    status: row.status,
    lastSeen: row.lastSeen?.toISOString() ?? null,
    agentVersion: row.agentVersion ?? null,
    active: row.active,
    alertsEnabled: row.alertsEnabled,
    slackWebhookUrl: row.slackWebhookUrl ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeSnapshot(row: typeof healthSnapshotsTable.$inferSelect) {
  return {
    id: row.id,
    environmentId: row.environmentId,
    timestamp: row.timestamp.toISOString(),
    overallStatus: row.overallStatus,
    services: JSON.parse(row.servicesJson) as unknown[],
    platformJson: row.platformJson,
    agentVersion: row.agentVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeAlert(
  row: typeof healthAlertsTable.$inferSelect & { envName?: string; orgName?: string },
) {
  return {
    id: row.id,
    environmentId: row.environmentId,
    envName: (row as any).envName ?? null,
    orgName: (row as any).orgName ?? null,
    alertType: row.alertType,
    fromStatus: row.fromStatus ?? null,
    toStatus: row.toStatus ?? null,
    triggeredAt: row.triggeredAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    linkedTicketId: row.linkedTicketId ?? null,
    acknowledged: row.acknowledged,
  };
}

// ---------------------------------------------------------------------------
// ADMIN: List all environments
// ---------------------------------------------------------------------------
router.get(
  "/admin/fleet/environments",
  requireAuth,
  requireRole("admin", "ekai_agent"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        env: customerEnvironmentsTable,
        orgName: organisationsTable.name,
      })
      .from(customerEnvironmentsTable)
      .leftJoin(organisationsTable, eq(customerEnvironmentsTable.orgId, organisationsTable.id))
      .where(eq(customerEnvironmentsTable.active, true))
      .orderBy(organisationsTable.name, customerEnvironmentsTable.name);

    res.json(rows.map(({ env, orgName }) => serializeEnv({ ...env, orgName: orgName ?? undefined })));
  },
);

// ---------------------------------------------------------------------------
// ADMIN: Register new environment
// ---------------------------------------------------------------------------
router.post(
  "/admin/fleet/environments",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const { orgId, name, cloud, region, runtime, environment } = req.body as {
      orgId?: number;
      name?: string;
      cloud?: string;
      region?: string;
      runtime?: string;
      environment?: string;
      heartbeatMode?: string;
    };

    if (!orgId || !name?.trim() || !cloud?.trim() || !region?.trim() || !runtime?.trim() || !environment?.trim()) {
      res.status(400).json({ message: "orgId, name, cloud, region, runtime, environment are required" });
      return;
    }

    // Validate org exists
    const [org] = await db
      .select({ id: organisationsTable.id })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId))
      .limit(1);

    if (!org) {
      res.status(400).json({ message: "Organisation not found" });
      return;
    }

    // Generate API key: ek_fleet_ + 32 random hex chars
    const randomPart = randomBytes(16).toString("hex"); // 32 hex chars
    const plainKey = `ek_fleet_${randomPart}`;
    // Store first 12 chars as prefix for fast lookup + display ("ek_fleet_xxx")
    const apiKeyPrefix = plainKey.substring(0, 12);
    const apiKeyHash = await bcrypt.hash(plainKey, 12);

    const heartbeatMode = (req.body as any).heartbeatMode === "poll" ? "poll" : "push";

    const [row] = await db
      .insert(customerEnvironmentsTable)
      .values({
        orgId,
        name: name.trim(),
        cloud: cloud.trim(),
        region: region.trim(),
        runtime: runtime.trim(),
        environment: environment.trim(),
        heartbeatMode,
        apiKeyHash,
        apiKeyPrefix,
      })
      .returning();

    res.status(201).json({
      environment: serializeEnv(row),
      /** Shown ONCE — not stored in DB */
      apiKey: plainKey,
    });
  },
);

// ---------------------------------------------------------------------------
// ADMIN: Update environment settings
// ---------------------------------------------------------------------------
router.patch(
  "/admin/fleet/environments/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const { orgId, name, cloud, region, runtime, environment, heartbeatMode } = req.body as {
      orgId?: number;
      name?: string;
      cloud?: string;
      region?: string;
      runtime?: string;
      environment?: string;
      heartbeatMode?: string;
    };

    const updates: Partial<typeof customerEnvironmentsTable.$inferInsert> = {};
    if (orgId !== undefined) {
      const [org] = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1);
      if (!org) { res.status(400).json({ message: "Organisation not found" }); return; }
      updates.orgId = orgId;
    }
    if (name !== undefined) updates.name = name.trim();
    if (cloud !== undefined) updates.cloud = cloud.trim();
    if (region !== undefined) updates.region = region.trim();
    if (runtime !== undefined) updates.runtime = runtime.trim();
    if (environment !== undefined) updates.environment = environment.trim();
    if (heartbeatMode === "poll" || heartbeatMode === "push") updates.heartbeatMode = heartbeatMode;
    const alertsEnabledRaw = (req.body as any).alertsEnabled;
    if (typeof alertsEnabledRaw === "boolean") updates.alertsEnabled = alertsEnabledRaw;
    const slackWebhookUrlRaw = (req.body as any).slackWebhookUrl;
    if (slackWebhookUrlRaw !== undefined) {
      updates.slackWebhookUrl = typeof slackWebhookUrlRaw === "string" && slackWebhookUrlRaw.trim() !== ""
        ? slackWebhookUrlRaw.trim()
        : null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(customerEnvironmentsTable)
      .set(updates)
      .where(and(eq(customerEnvironmentsTable.id, id), eq(customerEnvironmentsTable.active, true)))
      .returning();

    if (!row) { res.status(404).json({ message: "Environment not found" }); return; }

    const [orgRow] = await db
      .select({ name: organisationsTable.name })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, row.orgId))
      .limit(1);

    res.json(serializeEnv({ ...row, orgName: orgRow?.name }));
  },
);

// ---------------------------------------------------------------------------
// ADMIN: Test Slack webhook (pre-save or saved)
// ---------------------------------------------------------------------------
router.post(
  "/admin/fleet/environments/:id/test-slack",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    // Prefer the URL provided in the request body (pre-save test), fall back to DB value.
    const bodyUrl = (req.body as any).webhookUrl;
    let webhookUrl: string | null = typeof bodyUrl === "string" && bodyUrl.trim() !== "" ? bodyUrl.trim() : null;

    if (!webhookUrl) {
      const [env] = await db
        .select({ slackWebhookUrl: customerEnvironmentsTable.slackWebhookUrl })
        .from(customerEnvironmentsTable)
        .where(and(eq(customerEnvironmentsTable.id, id), eq(customerEnvironmentsTable.active, true)))
        .limit(1);
      if (!env) { res.status(404).json({ message: "Environment not found" }); return; }
      webhookUrl = env.slackWebhookUrl ?? null;
    }

    if (!webhookUrl) {
      res.status(400).json({ message: "No Slack webhook URL configured for this environment" });
      return;
    }

    const result = await testSlackWebhook(webhookUrl);
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// ADMIN: Regenerate API key
// ---------------------------------------------------------------------------
router.post(
  "/admin/fleet/environments/:id/regenerate-key",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const randomPart = randomBytes(16).toString("hex");
    const plainKey = `ek_fleet_${randomPart}`;
    const apiKeyPrefix = plainKey.substring(0, 12);
    const apiKeyHash = await bcrypt.hash(plainKey, 12);

    const [row] = await db
      .update(customerEnvironmentsTable)
      .set({ apiKeyHash, apiKeyPrefix })
      .where(and(eq(customerEnvironmentsTable.id, id), eq(customerEnvironmentsTable.active, true)))
      .returning();

    if (!row) { res.status(404).json({ message: "Environment not found" }); return; }

    res.json({ apiKey: plainKey, apiKeyPrefix });
  },
);

// ---------------------------------------------------------------------------
// ADMIN: Soft-delete environment
// ---------------------------------------------------------------------------
router.delete(
  "/admin/fleet/environments/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const [row] = await db
      .update(customerEnvironmentsTable)
      .set({ active: false })
      .where(eq(customerEnvironmentsTable.id, id))
      .returning({ id: customerEnvironmentsTable.id });

    if (!row) { res.status(404).json({ message: "Environment not found" }); return; }
    res.json({ deleted: true });
  },
);

// ---------------------------------------------------------------------------
// ADMIN/AGENT: Get snapshots for an environment (last 7 days)
// ---------------------------------------------------------------------------
router.get(
  "/admin/fleet/environments/:id/snapshots",
  requireAuth,
  requireRole("admin", "ekai_agent"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(healthSnapshotsTable)
      .where(
        and(
          eq(healthSnapshotsTable.environmentId, id),
          gte(healthSnapshotsTable.createdAt, since),
        ),
      )
      .orderBy(desc(healthSnapshotsTable.createdAt))
      .limit(2000);

    res.json(rows.map(serializeSnapshot));
  },
);

// ---------------------------------------------------------------------------
// ADMIN/AGENT: Get alerts for an environment
// ---------------------------------------------------------------------------
router.get(
  "/admin/fleet/environments/:id/alerts",
  requireAuth,
  requireRole("admin", "ekai_agent"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const rows = await db
      .select()
      .from(healthAlertsTable)
      .where(eq(healthAlertsTable.environmentId, id))
      .orderBy(desc(healthAlertsTable.triggeredAt))
      .limit(100);

    res.json(rows.map(serializeAlert));
  },
);

// ---------------------------------------------------------------------------
// ADMIN/AGENT: List all health alerts (across all environments)
// ---------------------------------------------------------------------------
router.get(
  "/admin/fleet/health-alerts",
  requireAuth,
  requireRole("admin", "ekai_agent"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        alert: healthAlertsTable,
        envName: customerEnvironmentsTable.name,
        orgName: organisationsTable.name,
      })
      .from(healthAlertsTable)
      .leftJoin(customerEnvironmentsTable, eq(healthAlertsTable.environmentId, customerEnvironmentsTable.id))
      .leftJoin(organisationsTable, eq(customerEnvironmentsTable.orgId, organisationsTable.id))
      .orderBy(desc(healthAlertsTable.triggeredAt))
      .limit(100);

    res.json(
      rows.map(({ alert, envName, orgName }) =>
        serializeAlert({ ...alert, envName: envName ?? undefined, orgName: orgName ?? undefined }),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// ADMIN/AGENT: Acknowledge an alert
// ---------------------------------------------------------------------------
router.post(
  "/admin/fleet/health-alerts/:id/acknowledge",
  requireAuth,
  requireRole("admin", "ekai_agent"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const userId = (req as any).localUser?.id ?? (req as any).auth?.userId;
    const [dbUser] = userId
      ? await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, Number(userId))).limit(1)
      : [];

    const [row] = await db
      .update(healthAlertsTable)
      .set({
        acknowledged: true,
        acknowledgedByUserId: dbUser?.id ?? null,
      })
      .where(eq(healthAlertsTable.id, id))
      .returning({ id: healthAlertsTable.id });

    if (!row) { res.status(404).json({ message: "Alert not found" }); return; }
    res.json({ acknowledged: true });
  },
);

// ---------------------------------------------------------------------------
// CUSTOMER: List own environments
// ---------------------------------------------------------------------------
router.get(
  "/fleet/environments",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as any).localUser;
    if (!user?.orgId) {
      res.status(403).json({ message: "No organisation" });
      return;
    }

    const rows = await db
      .select()
      .from(customerEnvironmentsTable)
      .where(
        and(
          eq(customerEnvironmentsTable.orgId, user.orgId),
          eq(customerEnvironmentsTable.active, true),
        ),
      )
      .orderBy(customerEnvironmentsTable.name);

    res.json(rows.map((r) => serializeEnv(r)));
  },
);

// ---------------------------------------------------------------------------
// CUSTOMER: Latest snapshot for own environment
// ---------------------------------------------------------------------------
router.get(
  "/fleet/environments/:id/snapshots",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as any).localUser;
    if (!user?.orgId) { res.status(403).json({ message: "No organisation" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    // Verify environment belongs to user's org
    const [env] = await db
      .select({ orgId: customerEnvironmentsTable.orgId })
      .from(customerEnvironmentsTable)
      .where(eq(customerEnvironmentsTable.id, id))
      .limit(1);

    if (!env || env.orgId !== user.orgId) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h
    const rows = await db
      .select()
      .from(healthSnapshotsTable)
      .where(
        and(
          eq(healthSnapshotsTable.environmentId, id),
          gte(healthSnapshotsTable.createdAt, since),
        ),
      )
      .orderBy(desc(healthSnapshotsTable.createdAt))
      .limit(300);

    res.json(rows.map(serializeSnapshot));
  },
);

export default router;
