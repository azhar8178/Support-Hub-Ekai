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
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastHealthJson: row.lastHealthJson ?? null,
    createdAt: row.createdAt.toISOString(),
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
    const { name, url } = req.body as { name?: string; url?: string };
    if (!name?.trim() || !url?.trim()) {
      res.status(400).json({ message: "name and url are required" });
      return;
    }

    const apiKey = randomBytes(32).toString("base64url");
    const apiKeyHash = hashApiKey(apiKey);

    const [row] = await db
      .insert(deploymentsTable)
      .values({
        name: name.trim(),
        url: url.trim(),
        apiKeyHash,
        status: "offline",
      })
      .returning();

    logger.info({ deploymentId: row!.id, name: row!.name }, "deployment registered");

    res.status(201).json({
      ...serializeDeployment(row!),
      apiKey, // shown once — caller must store this
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

// --- Receive a heartbeat from a client deployment ---
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

  const reportedStatus = (health["status"] as string | undefined) ?? "offline";
  const derivedStatus: "healthy" | "degraded" | "offline" =
    reportedStatus === "healthy" ? "healthy" : reportedStatus === "degraded" ? "degraded" : "offline";

  await db
    .update(deploymentsTable)
    .set({
      status: derivedStatus,
      lastSeenAt: new Date(),
      lastHealthJson: health,
      // Reset lastAlertedAt only when recovering to healthy
      ...(derivedStatus === "healthy" ? { lastAlertedAt: null } : {}),
    })
    .where(eq(deploymentsTable.id, deployment.id));

  // Persist heartbeat history row
  await db.insert(deploymentHeartbeatsTable).values({
    deploymentId: deployment.id,
    status: derivedStatus,
    healthJson: health,
  });

  // Prune heartbeats older than 24 h
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  await db
    .delete(deploymentHeartbeatsTable)
    .where(
      and(
        eq(deploymentHeartbeatsTable.deploymentId, deployment.id),
        lt(deploymentHeartbeatsTable.recordedAt, cutoff),
      ),
    );

  logger.info(
    { deploymentId: deployment.id, status: derivedStatus },
    "heartbeat received",
  );
  res.json({ message: "ok" });
});

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
