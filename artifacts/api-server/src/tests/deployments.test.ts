import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  deploymentsTable,
  deploymentHeartbeatsTable,
  ticketsTable,
  usersTable,
  type Organisation,
  type User,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { Fixtures } from "./fixtures";
import { runFleetAlerts, runAutoEscalation } from "../lib/sweeps";

// ---------------------------------------------------------------------------
// Clerk test double (same pattern as authz tests)
// ---------------------------------------------------------------------------
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => ({
    userId: (req.headers["x-test-clerk-user"] as string | undefined) ?? null,
  }),
  clerkMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@uninvited.example.com` },
        emailAddresses: [],
      }),
    },
  },
}));

// Mock Slack so fleet alerts don't need a real webhook
vi.mock("../lib/slack", () => ({
  sendSlackFleetAlert: vi.fn().mockResolvedValue(undefined),
  sendSlackAlert: vi.fn().mockResolvedValue(undefined),
}));

// Mock notifyUsers to avoid push/notification side effects
vi.mock("../lib/notify", () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  getAgentAndAdminIds: vi.fn().mockResolvedValue([]),
}));

const { default: app } = await import("../app");
import { sendSlackFleetAlert } from "../lib/slack";
import { notifyUsers } from "../lib/notify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const VALID_API_KEY = "test-api-key-valid-12345";

const fx = new Fixtures();
const deploymentIds: number[] = [];

/** Insert a deployment row directly, bypassing the API */
async function createDeployment(opts: {
  name: string;
  apiKey?: string;
  status?: "healthy" | "degraded" | "offline";
  lastSeenAt?: Date | null;
  lastAlertedAt?: Date | null;
}): Promise<typeof deploymentsTable.$inferSelect> {
  const apiKeyHash = hashKey(opts.apiKey ?? VALID_API_KEY);
  const [row] = await db
    .insert(deploymentsTable)
    .values({
      name: opts.name,
      url: `https://${opts.name}.example.com`,
      apiKeyHash,
      status: opts.status ?? "offline",
      lastSeenAt: opts.lastSeenAt ?? null,
      lastAlertedAt: opts.lastAlertedAt ?? null,
    })
    .returning();
  deploymentIds.push(row!.id);
  return row!;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let org: Organisation;
let customer: User;
let agent: User;
let admin: User;

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

beforeAll(async () => {
  org = await fx.createOrg("Deployment Test Org");
  customer = await fx.createUser({
    name: "DepCust",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-depcust-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "DepAgent",
    role: "ekai_agent",
    clerkUserId: `clerk-depagent-${fx.suffix}`,
  });
  admin = await fx.createUser({
    name: "DepAdmin",
    role: "admin",
    clerkUserId: `clerk-depadmin-${fx.suffix}`,
  });
});

afterAll(async () => {
  // Remove heartbeats first (FK), then deployments
  if (deploymentIds.length > 0) {
    await db
      .delete(deploymentHeartbeatsTable)
      .where(inArray(deploymentHeartbeatsTable.deploymentId, deploymentIds));
    await db
      .delete(deploymentsTable)
      .where(inArray(deploymentsTable.id, deploymentIds));
  }
  await fx.cleanup();
});

// ---------------------------------------------------------------------------
// POST /api/admin/deployments/heartbeat
// ---------------------------------------------------------------------------
describe("POST /api/admin/deployments/heartbeat", () => {
  let dep: typeof deploymentsTable.$inferSelect;

  beforeAll(async () => {
    dep = await createDeployment({ name: `hb-dep-${fx.suffix}`, apiKey: VALID_API_KEY });
  });

  it("accepts a valid API key and records the heartbeat", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: VALID_API_KEY, health: { status: "healthy" } });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("ok");

    // Row should be updated
    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.status).toBe("healthy");
    expect(updated!.lastSeenAt).not.toBeNull();

    // Heartbeat history should have a new row
    const beats = await db
      .select()
      .from(deploymentHeartbeatsTable)
      .where(eq(deploymentHeartbeatsTable.deploymentId, dep.id));
    expect(beats.length).toBeGreaterThanOrEqual(1);
    expect(beats[0]!.status).toBe("healthy");
  });

  it("derives status 'degraded' from payload", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: VALID_API_KEY, health: { status: "degraded" } });

    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.status).toBe("degraded");
  });

  it("derives status 'offline' from an unknown payload status value", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: VALID_API_KEY, health: { status: "unknown_garbage" } });

    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.status).toBe("offline");
  });

  it("resets lastAlertedAt to null when recovering to healthy", async () => {
    // Set lastAlertedAt to a past date
    await db
      .update(deploymentsTable)
      .set({ lastAlertedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(deploymentsTable.id, dep.id));

    await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: VALID_API_KEY, health: { status: "healthy" } });

    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.lastAlertedAt).toBeNull();
  });

  it("rejects a request with no API key with 401", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ health: { status: "healthy" } });

    expect(res.status).toBe(401);
  });

  it("rejects a request with no health payload with 401", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: VALID_API_KEY });

    expect(res.status).toBe(401);
  });

  it("rejects an invalid API key with 401", async () => {
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: "totally-wrong-key", health: { status: "healthy" } });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid api key/i);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat pruning — rows older than 24 h must be removed after each write
// ---------------------------------------------------------------------------
describe("heartbeat pruning", () => {
  const PRUNE_API_KEY = "test-prune-api-key-67890";
  let pruneDep: typeof deploymentsTable.$inferSelect;

  beforeAll(async () => {
    pruneDep = await createDeployment({
      name: `prune-dep-${fx.suffix}`,
      apiKey: PRUNE_API_KEY,
    });
  });

  it("removes rows clearly older than 24 hours and keeps rows within the window", async () => {
    const now = Date.now();

    // Insert a row 25 hours old — well outside the 24-hour window
    const [oldRow] = await db
      .insert(deploymentHeartbeatsTable)
      .values({
        deploymentId: pruneDep.id,
        status: "healthy" as const,
        recordedAt: new Date(now - 25 * 3600_000),
      })
      .returning();

    // Insert a row 23 hours old — inside the 24-hour window
    const [recentRow] = await db
      .insert(deploymentHeartbeatsTable)
      .values({
        deploymentId: pruneDep.id,
        status: "healthy" as const,
        recordedAt: new Date(now - 23 * 3600_000),
      })
      .returning();

    // Trigger a heartbeat — this inserts a new row and prunes stale ones
    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: PRUNE_API_KEY, health: { status: "healthy" } });

    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(deploymentHeartbeatsTable)
      .where(eq(deploymentHeartbeatsTable.deploymentId, pruneDep.id));

    const remainingIds = new Set(remaining.map((r) => r.id));

    // The 25-hour-old row must be gone
    expect(remainingIds.has(oldRow!.id)).toBe(false);
    // The 23-hour-old row must still be present
    expect(remainingIds.has(recentRow!.id)).toBe(true);
  });

  it("prunes a row just over 24 h old but keeps a row just under 24 h old", async () => {
    // Clear existing heartbeats so IDs are unambiguous
    await db
      .delete(deploymentHeartbeatsTable)
      .where(eq(deploymentHeartbeatsTable.deploymentId, pruneDep.id));

    const now = Date.now();

    // Just outside the window: 24 h + 1 min ago — should be pruned
    const [justOutside] = await db
      .insert(deploymentHeartbeatsTable)
      .values({
        deploymentId: pruneDep.id,
        status: "healthy" as const,
        recordedAt: new Date(now - 24 * 3600_000 - 60_000),
      })
      .returning();

    // Just inside the window: 24 h - 1 min ago — should survive
    const [justInside] = await db
      .insert(deploymentHeartbeatsTable)
      .values({
        deploymentId: pruneDep.id,
        status: "healthy" as const,
        recordedAt: new Date(now - 24 * 3600_000 + 60_000),
      })
      .returning();

    const res = await request(app)
      .post("/api/admin/deployments/heartbeat")
      .send({ apiKey: PRUNE_API_KEY, health: { status: "healthy" } });

    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(deploymentHeartbeatsTable)
      .where(eq(deploymentHeartbeatsTable.deploymentId, pruneDep.id));

    const remainingIds = new Set(remaining.map((r) => r.id));

    // The row 1 minute past the cutoff must be deleted
    expect(remainingIds.has(justOutside!.id)).toBe(false);
    // The row 1 minute before the cutoff must remain
    expect(remainingIds.has(justInside!.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/deployments — admin only
// ---------------------------------------------------------------------------
describe("GET /api/admin/deployments", () => {
  it("returns 200 with deployment list for admin", async () => {
    const res = await request(app)
      .get("/api/admin/deployments")
      .set(asUser(admin));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 403 for a non-admin agent", async () => {
    const res = await request(app)
      .get("/api/admin/deployments")
      .set(asUser(agent));

    expect(res.status).toBe(403);
  });

  it("returns 403 for a customer", async () => {
    const res = await request(app)
      .get("/api/admin/deployments")
      .set(asUser(customer));

    expect(res.status).toBe(403);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/deployments");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/deployments/:id — admin only
// ---------------------------------------------------------------------------
describe("DELETE /api/admin/deployments/:id", () => {
  it("returns 403 for a non-admin agent", async () => {
    const dep = await createDeployment({ name: `del-agent-${fx.suffix}` });
    const res = await request(app)
      .delete(`/api/admin/deployments/${dep.id}`)
      .set(asUser(agent));

    expect(res.status).toBe(403);
    // Deployment should still exist
    const [still] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(still).toBeDefined();
  });

  it("returns 403 for a customer", async () => {
    const dep = await createDeployment({ name: `del-cust-${fx.suffix}` });
    const res = await request(app)
      .delete(`/api/admin/deployments/${dep.id}`)
      .set(asUser(customer));

    expect(res.status).toBe(403);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const dep = await createDeployment({ name: `del-unauth-${fx.suffix}` });
    const res = await request(app).delete(`/api/admin/deployments/${dep.id}`);
    expect(res.status).toBe(401);
  });

  it("returns 204 and removes the deployment for an admin", async () => {
    const dep = await createDeployment({ name: `del-ok-${fx.suffix}` });
    const res = await request(app)
      .delete(`/api/admin/deployments/${dep.id}`)
      .set(asUser(admin));

    expect(res.status).toBe(204);

    // Should be gone (cascade also removes from deploymentIds tracking, but
    // we still track the id — just let the afterAll no-op on it)
    const [gone] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(gone).toBeUndefined();
  });

  it("returns 404 when deleting a non-existent deployment", async () => {
    const res = await request(app)
      .delete("/api/admin/deployments/999999999")
      .set(asUser(admin));

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Fleet alerting sweep (runFleetAlerts)
// ---------------------------------------------------------------------------
describe("runFleetAlerts", () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  it("marks a deployment offline and fires a Slack alert when no heartbeat for >10 min", async () => {
    const staleTs = new Date(Date.now() - 11 * 60_000); // 11 minutes ago
    const dep = await createDeployment({
      name: `fleet-stale-${fx.suffix}`,
      status: "healthy",
      lastSeenAt: staleTs,
      lastAlertedAt: null,
    });

    vi.mocked(sendSlackFleetAlert).mockClear();

    await runFleetAlerts(new Date());

    // Status should have been updated to offline
    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.status).toBe("offline");

    // At least one Slack alert should mention our specific deployment
    const calls = vi.mocked(sendSlackFleetAlert).mock.calls.map((c) => c[0] as string);
    const ourAlert = calls.find((msg) => msg.includes(dep.name));
    expect(ourAlert).toBeDefined();
    expect(ourAlert).toMatch(/offline/i);

    // lastAlertedAt should be set
    expect(updated!.lastAlertedAt).not.toBeNull();
  });

  it("does not alert the specific cooldown deployment again within the 30-minute window", async () => {
    const staleTs = new Date(Date.now() - 11 * 60_000);
    const recentAlert = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
    const cooldownDep = await createDeployment({
      name: `fleet-cooldown-${fx.suffix}`,
      status: "offline",
      lastSeenAt: staleTs,
      lastAlertedAt: recentAlert,
    });

    vi.mocked(sendSlackFleetAlert).mockClear();

    await runFleetAlerts(new Date());

    // No alert for our cooldown deployment specifically
    const calls = vi.mocked(sendSlackFleetAlert).mock.calls.map((c) => c[0] as string);
    const cooldownAlert = calls.find((msg) => msg.includes(cooldownDep.name));
    expect(cooldownAlert).toBeUndefined();
  });

  it("does not alert for a healthy deployment with a recent heartbeat", async () => {
    const recentTs = new Date(Date.now() - 2 * 60_000); // 2 minutes ago
    await createDeployment({
      name: `fleet-healthy-${fx.suffix}`,
      status: "healthy",
      lastSeenAt: recentTs,
      lastAlertedAt: null,
    });

    vi.mocked(sendSlackFleetAlert).mockClear();

    await runFleetAlerts(new Date());

    expect(sendSlackFleetAlert).not.toHaveBeenCalled();
  });

  it("alerts as degraded when db subsystem reports degraded in health JSON", async () => {
    const recentTs = new Date(Date.now() - 2 * 60_000);
    const dep = await createDeployment({
      name: `fleet-degraded-${fx.suffix}`,
      status: "healthy",
      lastSeenAt: recentTs,
      lastAlertedAt: null,
    });

    // Inject a degraded health JSON directly
    await db
      .update(deploymentsTable)
      .set({ lastHealthJson: { db: { status: "degraded" } } })
      .where(eq(deploymentsTable.id, dep.id));

    vi.mocked(sendSlackFleetAlert).mockClear();

    await runFleetAlerts(new Date());

    const [updated] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, dep.id));
    expect(updated!.status).toBe("degraded");

    const calls = vi.mocked(sendSlackFleetAlert).mock.calls.map((c) => c[0] as string);
    const ourAlert = calls.find((msg) => msg.includes(dep.name));
    expect(ourAlert).toBeDefined();
    expect(ourAlert).toMatch(/degraded/i);
  });

  it("continues processing remaining deployments when one throws", async () => {
    const staleTs = new Date(Date.now() - 11 * 60_000); // 11 minutes ago — will be offline

    // Two deployments that both need alerting
    const depA = await createDeployment({
      name: `fleet-throw-a-${fx.suffix}`,
      status: "healthy",
      lastSeenAt: staleTs,
      lastAlertedAt: null,
    });
    const depB = await createDeployment({
      name: `fleet-throw-b-${fx.suffix}`,
      status: "healthy",
      lastSeenAt: staleTs,
      lastAlertedAt: null,
    });

    // Make sendSlackFleetAlert throw only when the message mentions depA
    vi.mocked(sendSlackFleetAlert).mockClear();
    vi.mocked(sendSlackFleetAlert).mockImplementation(async (msg: string) => {
      if (msg.includes(depA.name)) {
        throw new Error("Simulated Slack failure for depA");
      }
    });

    // Should not throw at the top level
    await expect(runFleetAlerts(new Date())).resolves.toBeUndefined();

    // Restore mock to non-throwing for other tests
    vi.mocked(sendSlackFleetAlert).mockResolvedValue(undefined);

    // depB should have been alerted despite depA throwing
    const [updatedB] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, depB.id));
    expect(updatedB!.lastAlertedAt).not.toBeNull();

    // At least one call should mention depB
    const calls = vi.mocked(sendSlackFleetAlert).mock.calls.map((c) => c[0] as string);
    const bAlert = calls.find((msg) => msg.includes(depB.name));
    expect(bAlert).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Auto-escalation sweep (runAutoEscalation)
// ---------------------------------------------------------------------------
describe("runAutoEscalation", () => {
  it("assigns the least-loaded agent to an unassigned ticket at ≥75% resolution SLA", async () => {
    // Create a ticket with a resolution deadline already 75%+ elapsed
    const now = new Date();
    // Set a deadline 10 minutes from now, but started far enough in the past
    // that 75%+ is consumed. Use simple wall-clock (P1 uses 24x7 clock).
    // 75% elapsed: deadline is at 100%, so set deadline such that only 25% remains.
    // E.g. total window = 4 h (240 min), deadline = now + 60 min (25% left = 75% elapsed)
    const resolutionDeadline = new Date(now.getTime() + 60 * 60_000); // 60 min from now
    // createdAt implicitly set by DB; we need a ticket that was opened long enough ago.
    // The ticket's createdAt defaults to now, so we can't set it retroactively here.
    // Instead, create a P1 ticket and set both deadlines directly via DB:
    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      title: `Escalate me ${fx.suffix}`,
      severity: "P1",
      status: "new",
      resolutionDeadline,
    });

    // Override createdAt to 3 hours ago so that 75%+ of the window has elapsed
    await db
      .update(ticketsTable)
      .set({ createdAt: new Date(now.getTime() - 3 * 3600_000) } as Record<string, unknown>)
      .where(eq(ticketsTable.id, ticket.id));

    vi.mocked(notifyUsers).mockClear();

    await runAutoEscalation(now);

    const [updated] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticket.id));

    // Ticket should now have an assigned agent
    expect(updated!.assignedToId).not.toBeNull();

    // The assigned agent should be one of our existing staff (agent or admin)
    const staffIds = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.role, ["ekai_agent", "admin"]),
          eq(usersTable.active, true),
        ),
      );
    const staffIdSet = new Set(staffIds.map((r) => r.id));
    expect(staffIdSet.has(updated!.assignedToId!)).toBe(true);

    // notifyUsers should have been called for the assigned agent
    expect(notifyUsers).toHaveBeenCalled();
  });

  it("does not assign an already-assigned ticket", async () => {
    const resolutionDeadline = new Date(Date.now() + 60 * 60_000);
    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      title: `Already assigned ${fx.suffix}`,
      severity: "P1",
      status: "new",
      resolutionDeadline,
    });

    // Assign to agent upfront
    await db
      .update(ticketsTable)
      .set({ assignedToId: agent.id })
      .where(eq(ticketsTable.id, ticket.id));

    vi.mocked(notifyUsers).mockClear();
    await runAutoEscalation(new Date());

    const [updated] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticket.id));
    // Still assigned to the original agent
    expect(updated!.assignedToId).toBe(agent.id);
  });

  it("does not escalate a ticket below the 75% threshold", async () => {
    // Deadline is 8 hours away out of a small window — well under 75%
    const resolutionDeadline = new Date(Date.now() + 8 * 3600_000);
    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      title: `Not yet ${fx.suffix}`,
      severity: "P1",
      status: "new",
      resolutionDeadline,
    });

    vi.mocked(notifyUsers).mockClear();
    await runAutoEscalation(new Date());

    const [updated] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticket.id));
    // Should remain unassigned
    expect(updated!.assignedToId).toBeNull();
  });
});
