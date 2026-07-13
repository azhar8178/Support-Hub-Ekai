import { Router, type IRouter } from "express";
import { db, pushReceiptQueueTable, ticketsTable } from "@workspace/db";
import { count, eq, inArray, lte } from "drizzle-orm";

const router: IRouter = Router();

export interface HealthSubsystems {
  db: { status: "healthy" | "degraded"; latencyMs: number | null };
  pushQueueDepth: number;
  slaBreachCount: number;
  openTicketCount: number;
  emailConfigured: boolean;
  storageConfigured: boolean;
}

export type HealthOverallStatus = "healthy" | "degraded" | "offline";

export interface RichHealthStatus extends HealthSubsystems {
  status: HealthOverallStatus;
  timestamp: string;
}

const OPEN_STATUSES = ["new", "triaged", "in_progress", "awaiting_customer"] as const;

/** Run each subsystem check in isolation — never throws. */
export async function collectHealthStatus(): Promise<RichHealthStatus> {
  const now = new Date();

  // --- DB health (ping + latency) ---
  let dbStatus: "healthy" | "degraded" = "degraded";
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await db.execute("select 1");
    dbLatencyMs = Date.now() - t0;
    dbStatus = "healthy";
  } catch {
    // degraded
  }

  // --- Open ticket count ---
  let openTicketCount = 0;
  try {
    const [row] = await db
      .select({ n: count() })
      .from(ticketsTable)
      .where(inArray(ticketsTable.status, [...OPEN_STATUSES]));
    openTicketCount = Number(row?.n ?? 0);
  } catch {
    // best-effort
  }

  // --- SLA breach count (open tickets past resolution deadline) ---
  let slaBreachCount = 0;
  try {
    const [row] = await db
      .select({ n: count() })
      .from(ticketsTable)
      .where(
        inArray(ticketsTable.status, [...OPEN_STATUSES]),
      );
    // We count tickets with a past resolution deadline among open ones
    const openRows = await db
      .select({ resolutionDeadline: ticketsTable.resolutionDeadline })
      .from(ticketsTable)
      .where(inArray(ticketsTable.status, [...OPEN_STATUSES]));
    slaBreachCount = openRows.filter(
      (t) => t.resolutionDeadline != null && t.resolutionDeadline <= now,
    ).length;
    void row; // suppress unused warning
  } catch {
    // best-effort
  }

  // --- Push receipt queue depth ---
  let pushQueueDepth = 0;
  try {
    const [row] = await db
      .select({ n: count() })
      .from(pushReceiptQueueTable)
      .where(lte(pushReceiptQueueTable.dueAt, now));
    pushQueueDepth = Number(row?.n ?? 0);
  } catch {
    // best-effort
  }

  // --- Config presence ---
  const emailConfigured = !!(
    process.env["AWS_ACCESS_KEY_ID"] &&
    process.env["AWS_SECRET_ACCESS_KEY"] &&
    process.env["EMAIL_FROM"]
  );
  const storageConfigured = !!(process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"]);

  // Derive overall status: if DB is down, we're degraded at minimum.
  const status: HealthOverallStatus = dbStatus === "degraded" ? "degraded" : "healthy";

  return {
    status,
    timestamp: now.toISOString(),
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    pushQueueDepth,
    slaBreachCount,
    openTicketCount,
    emailConfigured,
    storageConfigured,
  };
}

router.get("/healthz", async (_req, res) => {
  try {
    const health = await collectHealthStatus();
    res.json(health);
  } catch {
    res.status(500).json({ status: "offline", timestamp: new Date().toISOString() });
  }
});

export default router;
