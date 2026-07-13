import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  db,
  deploymentsTable,
  deploymentHeartbeatsTable,
} from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function serializeDeployment(row: typeof deploymentsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    status: row.status,
    heartbeatMode: row.heartbeatMode,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastHealthJson: row.lastHealthJson ?? null,
    createdAt: row.createdAt.toISOString(),
    slackWebhookUrl: row.slackWebhookUrl ?? null,
  };
}

// --- List deployments ---
router.get(
  "/admin/deployments",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(deploymentsTable)
      .orderBy(deploymentsTable.name);
    res.json(rows.map(serializeDeployment));
  },
);

// --- Register a deployment ---
router.post(
  "/admin/deployments",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const { name, url, heartbeatMode } = req.body as {
      name?: string;
      url?: string;
      heartbeatMode?: string;
    };
    if (!name?.trim() || !url?.trim()) {
      res.status(400).json({ message: "name and url are required" });
      return;
    }

    const mode: "poll" | "push" =
      heartbeatMode === "push" ? "push" : "poll";

    let apiKey: string | undefined;
    let apiKeyHash: string | null = null;

    if (mode === "push") {
      apiKey = randomBytes(32).toString("base64url");
      apiKeyHash = hashApiKey(apiKey);
    }

    const [row] = await db
      .insert(deploymentsTable)
      .values({
        name: name.trim(),
        url: url.trim(),
        heartbeatMode: mode,
        apiKeyHash,
        status: "offline",
      })
      .returning();

    logger.info(
      { deploymentId: row!.id, name: row!.name, mode },
      "deployment registered",
    );

    res.status(201).json({
      ...serializeDeployment(row!),
      ...(apiKey ? { apiKey } : {}),
    });
  },
);

// --- Update a deployment ---
// Supports: name, url, slackWebhookUrl, heartbeatMode
// Switching to "push" generates a new API key (returned once).
// Switching to "poll" clears the API key hash.
router.patch(
  "/admin/deployments/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw ?? "", 10);
    const { name, url, slackWebhookUrl, heartbeatMode } = req.body as {
      name?: string;
      url?: string;
      slackWebhookUrl?: string | null;
      heartbeatMode?: string;
    };

    // Load current row to detect mode transition
    const [current] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, id));

    if (!current) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }

    const updates: Partial<typeof deploymentsTable.$inferInsert> = {};

    if (name !== undefined) updates.name = name.trim();
    if (url !== undefined) updates.url = url.trim();
    if (slackWebhookUrl !== undefined) updates.slackWebhookUrl = slackWebhookUrl ?? null;

    let newApiKey: string | undefined;

    if (heartbeatMode !== undefined) {
      const newMode: "poll" | "push" = heartbeatMode === "push" ? "push" : "poll";
      updates.heartbeatMode = newMode;

      if (newMode === "push" && current.heartbeatMode !== "push") {
        // Generate a fresh API key when switching to push
        newApiKey = randomBytes(32).toString("base64url");
        updates.apiKeyHash = hashApiKey(newApiKey);
      } else if (newMode === "poll" && current.heartbeatMode !== "poll") {
        // Clear API key when switching to poll
        updates.apiKeyHash = null;
      }
    }

    const [row] = await db
      .update(deploymentsTable)
      .set(updates)
      .where(eq(deploymentsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }

    logger.info({ deploymentId: id, updates: Object.keys(updates) }, "deployment updated");
    res.json({
      ...serializeDeployment(row),
      ...(newApiKey ? { apiKey: newApiKey } : {}),
    });
  },
);

// --- Delete a deployment ---
router.delete(
  "/admin/deployments/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw ?? "", 10);

    // Belt-and-suspenders: explicitly delete heartbeat rows before removing the
    // deployment. The schema has ON DELETE CASCADE as the primary guard, but an
    // explicit delete here makes the cleanup self-documenting and ensures
    // heartbeat rows are never silently orphaned if that constraint is ever
    // dropped or altered by a future migration.
    await db
      .delete(deploymentHeartbeatsTable)
      .where(eq(deploymentHeartbeatsTable.deploymentId, id));

    const [row] = await db
      .delete(deploymentsTable)
      .where(eq(deploymentsTable.id, id))
      .returning({ id: deploymentsTable.id });
    if (!row) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }
    logger.info({ deploymentId: id }, "deployment removed");
    res.status(204).end();
  },
);

// --- Receive a heartbeat from a push-mode client deployment ---
// This endpoint does NOT use Clerk auth — it uses a deployment API key.
router.post("/admin/deployments/heartbeat", async (req, res): Promise<void> => {
  const { apiKey, health } = req.body as {
    apiKey?: string;
    health?: Record<string, unknown>;
  };

  if (!apiKey || !health) {
    res.status(401).json({ message: "apiKey and health payload are required" });
    return;
  }

  const keyHash = hashApiKey(apiKey);
  const [deployment] = await db
    .select()
    .from(deploymentsTable)
    .where(eq(deploymentsTable.apiKeyHash, keyHash));

  if (!deployment) {
    res.status(401).json({ message: "Invalid API key" });
    return;
  }

  // Guard: poll-mode deployments have no API key; they should not be pushing
  if (deployment.heartbeatMode !== "push") {
    res.status(400).json({
      message:
        "This deployment is configured for hub-poll mode. " +
        "Switch it to push mode in the fleet settings before sending heartbeats.",
    });
    return;
  }

  await recordHeartbeat(deployment, health);

  logger.info(
    { deploymentId: deployment.id, status: health["status"] },
    "heartbeat received (push)",
  );
  res.json({ message: "ok" });
});

/**
 * Shared helper: record a health snapshot for a deployment, insert a heartbeat
 * history row, and prune rows older than 24 h.
 * Used by both the push endpoint and the hub-poll sweep.
 */
export async function recordHeartbeat(
  deployment: typeof deploymentsTable.$inferSelect,
  health: Record<string, unknown>,
): Promise<void> {
  const reportedStatus = (health["status"] as string | undefined) ?? "offline";
  const derivedStatus: "healthy" | "degraded" | "offline" =
    reportedStatus === "healthy"
      ? "healthy"
      : reportedStatus === "degraded"
        ? "degraded"
        : "offline";

  await db
    .update(deploymentsTable)
    .set({
      status: derivedStatus,
      lastSeenAt: new Date(),
      lastHealthJson: health,
      ...(derivedStatus === "healthy" ? { lastAlertedAt: null } : {}),
    })
    .where(eq(deploymentsTable.id, deployment.id));

  await db.insert(deploymentHeartbeatsTable).values({
    deploymentId: deployment.id,
    status: derivedStatus,
    healthJson: health,
  });

  // Prune heartbeats older than 24 h for this deployment
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  await db
    .delete(deploymentHeartbeatsTable)
    .where(
      and(
        eq(deploymentHeartbeatsTable.deploymentId, deployment.id),
        lt(deploymentHeartbeatsTable.recordedAt, cutoff),
      ),
    );
}

// --- Get heartbeat history for a deployment ---
router.get(
  "/admin/deployments/:id/heartbeats",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw ?? "", 10);
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await db
      .select()
      .from(deploymentHeartbeatsTable)
      .where(
        and(
          eq(deploymentHeartbeatsTable.deploymentId, id),
          gte(deploymentHeartbeatsTable.recordedAt, since),
        ),
      )
      .orderBy(desc(deploymentHeartbeatsTable.recordedAt));
    res.json(
      rows.map((r) => ({
        id: r.id,
        deploymentId: r.deploymentId,
        status: r.status,
        healthJson: r.healthJson ?? null,
        recordedAt: r.recordedAt.toISOString(),
      })),
    );
  },
);

export default router;
